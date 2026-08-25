import type { TTSEndEvent, TTSStartEvent } from "../types/protocol";

const MAX_CHUNK_BYTES = 9_600;
const MAX_PENDING_CHUNKS = 20;

export interface AudioPlaybackMetrics {
  chunksPlayed: number;
  totalBytesPlayed: number;
  isPlaying: boolean;
  bufferedChunks: number;
  underrunFrames: number;
  overrunFrames: number;
  droppedChunks: number;
  invalidChunks: number;
  renderedFrames: number;
}

export type WorkletMessage =
  | { type: "audible-start"; generation: number }
  | { type: "metrics"; generation: number; rms: number; bufferedFrames: number; underrunFrames: number; overrunFrames: number; renderedFrames: number }
  | { type: "drained"; generation: number };

export interface PlaybackBackend {
  prepare(onMessage: (message: WorkletMessage) => void): Promise<void>;
  configure(generation: number, sampleRateHz: number): void;
  push(generation: number, samples: Float32Array): void;
  end(generation: number): void;
  stop(generation: number): void;
  close(): Promise<void>;
}

export class BrowserAudioWorkletBackend implements PlaybackBackend {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;

  public async prepare(onMessage: (message: WorkletMessage) => void): Promise<void> {
    if (this.context && this.node) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    if (typeof window === "undefined") throw new Error("Audio playback requires a browser window");
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is unavailable");
    const context = new AudioContextClass({ sampleRate: 24_000 });
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio-playback-worklet.js`);
    const node = new AudioWorkletNode(context, "live-agent-pcm-playback", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (event: MessageEvent<WorkletMessage>) => onMessage(event.data);
    node.connect(context.destination);
    this.context = context;
    this.node = node;
    if (context.state === "suspended") await context.resume();
  }

  public configure(generation: number, sampleRateHz: number): void {
    this.node?.port.postMessage({ type: "configure", generation, sampleRateHz });
  }

  public push(generation: number, samples: Float32Array): void {
    this.node?.port.postMessage({ type: "samples", generation, samples: samples.buffer }, [samples.buffer]);
  }

  public end(generation: number): void {
    this.node?.port.postMessage({ type: "end", generation });
  }

  public stop(generation: number): void {
    this.node?.port.postMessage({ type: "stop", generation });
  }

  public async close(): Promise<void> {
    this.node?.disconnect();
    this.node = null;
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
  }
}

export class AudioPlaybackQueue {
  private activeStreamId: string | null = null;
  private generation = 0;
  private pending: Uint8Array[] = [];
  private ready = false;
  private endRequested = false;
  private isPlaying = false;
  private chunksPlayed = 0;
  private totalBytesPlayed = 0;
  private volume = 0;
  private underrunFrames = 0;
  private overrunFrames = 0;
  private bufferedFrames = 0;
  private droppedChunks = 0;
  private invalidChunks = 0;
  private renderedFrames = 0;
  private onVolumeChangeListeners = new Set<(volume: number) => void>();
  private onPlaybackStateChangeListeners = new Set<(isPlaying: boolean) => void>();
  private onPlaybackErrorListeners = new Set<(message: string) => void>();
  private onMetricsChangeListeners = new Set<(metrics: AudioPlaybackMetrics) => void>();

  constructor(private readonly backend: PlaybackBackend = new BrowserAudioWorkletBackend()) {}

  public prepare(): Promise<void> {
    return this.backend.prepare((message) => this.handleWorkletMessage(message));
  }

  public startStream(event: TTSStartEvent): void {
    if (this.activeStreamId !== null) {
      this.invalidChunks++;
      return;
    }
    this.stop();
    this.activeStreamId = event.streamId;
    this.endRequested = false;
    this.generation++;
    const generation = this.generation;
    this.isPlaying = true;
    this.renderedFrames = 0;
    this.notifyState(true);
    this.notifyMetrics();
    void this.prepare()
      .then(() => {
        if (generation !== this.generation || this.activeStreamId !== event.streamId) return;
        this.backend.configure(generation, event.format.sampleRateHz);
        this.ready = true;
        const chunks = this.pending;
        this.pending = [];
        chunks.forEach((chunk) => this.pushChunk(chunk));
        if (this.endRequested) this.backend.end(generation);
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        const message = error instanceof Error ? error.message : "Audio playback unavailable";
        this.onPlaybackErrorListeners.forEach((listener) => listener(message));
        this.stop();
      });
  }

  public enqueueChunk(chunk: ArrayBuffer | Uint8Array): void {
    if (!this.activeStreamId) {
      this.invalidChunks++;
      return;
    }
    const source = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (source.byteLength === 0 || source.byteLength > MAX_CHUNK_BYTES || source.byteLength % 4 !== 0) {
      this.invalidChunks++;
      return;
    }
    const bytes = Uint8Array.from(source);
    if (!this.ready) {
      if (this.pending.length >= MAX_PENDING_CHUNKS) {
        this.pending.shift();
        this.droppedChunks++;
      }
      this.pending.push(bytes);
      return;
    }
    this.pushChunk(bytes);
  }

  public endStream(event: TTSEndEvent): void {
    if (event.streamId !== this.activeStreamId) {
      this.invalidChunks++;
      return;
    }
    if (event.outcome === "COMPLETED" && this.ready) {
      this.backend.end(this.generation);
      return;
    }
    if (event.outcome === "COMPLETED") {
      this.endRequested = true;
      return;
    }
    this.stop();
  }

  public stop(): void {
    this.generation++;
    this.backend.stop(this.generation);
    this.activeStreamId = null;
    this.pending = [];
    this.ready = false;
    this.endRequested = false;
    this.bufferedFrames = 0;
    this.isPlaying = false;
    this.volume = 0;
    this.notifyVolume(0);
    this.notifyState(false);
    this.notifyMetrics();
  }

  public flush(): void {
    this.stop();
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentVolume(): number {
    return this.volume;
  }

  public getActiveStreamId(): string | null {
    return this.activeStreamId;
  }

  public getMetrics(): AudioPlaybackMetrics {
    return {
      chunksPlayed: this.chunksPlayed,
      totalBytesPlayed: this.totalBytesPlayed,
      isPlaying: this.isPlaying,
      bufferedChunks: this.pending.length + Math.ceil(this.bufferedFrames / 2_400),
      underrunFrames: this.underrunFrames,
      overrunFrames: this.overrunFrames,
      droppedChunks: this.droppedChunks,
      invalidChunks: this.invalidChunks,
      renderedFrames: this.renderedFrames,
    };
  }

  public onMetricsChange(listener: (metrics: AudioPlaybackMetrics) => void): () => void {
    this.onMetricsChangeListeners.add(listener);
    listener(this.getMetrics());
    return () => this.onMetricsChangeListeners.delete(listener);
  }

  public onVolumeChange(listener: (volume: number) => void): () => void {
    this.onVolumeChangeListeners.add(listener);
    return () => this.onVolumeChangeListeners.delete(listener);
  }

  public onPlaybackStateChange(listener: (isPlaying: boolean) => void): () => void {
    this.onPlaybackStateChangeListeners.add(listener);
    return () => this.onPlaybackStateChangeListeners.delete(listener);
  }

  public onPlaybackError(listener: (message: string) => void): () => void {
    this.onPlaybackErrorListeners.add(listener);
    return () => this.onPlaybackErrorListeners.delete(listener);
  }

  public async dispose(): Promise<void> {
    this.stop();
    await this.backend.close();
  }

  private pushChunk(bytes: Uint8Array): void {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const samples = new Float32Array(copy);
    this.backend.push(this.generation, samples);
    this.chunksPlayed++;
    this.totalBytesPlayed += bytes.byteLength;
    this.notifyMetrics();
  }

  private handleWorkletMessage(message: WorkletMessage): void {
    if (message.generation !== this.generation) return;
    if (message.type === "metrics") {
      this.volume = Math.min(1, Math.max(0, message.rms * 3));
      this.bufferedFrames = message.bufferedFrames;
      this.underrunFrames = message.underrunFrames;
      this.overrunFrames = message.overrunFrames;
      this.renderedFrames = message.renderedFrames;
      this.notifyVolume(this.volume);
      this.notifyMetrics();
    } else if (message.type === "drained") {
      this.activeStreamId = null;
      this.ready = false;
      this.isPlaying = false;
      this.volume = 0;
      this.notifyVolume(0);
      this.notifyState(false);
      this.notifyMetrics();
    }
  }

  private notifyVolume(volume: number): void {
    this.onVolumeChangeListeners.forEach((listener) => listener(volume));
  }

  private notifyState(playing: boolean): void {
    this.onPlaybackStateChangeListeners.forEach((listener) => listener(playing));
  }

  private notifyMetrics(): void {
    const metrics = this.getMetrics();
    this.onMetricsChangeListeners.forEach((listener) => listener(metrics));
  }
}
