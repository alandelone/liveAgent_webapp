import { PCM_FRAME_BYTES } from "./pcm";

export interface AudioTransport {
  isOpen(): boolean;
  bufferedAmount(): number;
  send(frame: Uint8Array): void;
}

export interface AudioUplinkMetrics {
  queuedFrames: number;
  sentFrames: number;
  droppedOldestFrames: number;
  invalidFrames: number;
}

export class BrowserAudioUplink {
  public static readonly MAX_FRAMES = 100;
  public static readonly HIGH_WATER_BYTES = 128 * 1024;
  public static readonly LOW_WATER_BYTES = 32 * 1024;

  private queue: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private stopped = false;
  private sentFrames = 0;
  private droppedOldestFrames = 0;
  private invalidFrames = 0;

  constructor(
    private readonly transport: AudioTransport,
    private readonly pollMs = 10,
  ) {}

  public enqueue(frame: Uint8Array): void {
    if (this.stopped) return;
    if (frame.byteLength !== PCM_FRAME_BYTES) {
      this.invalidFrames++;
      throw new Error(`PCM frame must be ${PCM_FRAME_BYTES} bytes`);
    }
    this.queue.push(Uint8Array.from(frame));
    if (this.queue.length > BrowserAudioUplink.MAX_FRAMES) {
      this.queue.shift();
      this.droppedOldestFrames++;
    }
    this.drain();
  }

  public drain(): void {
    if (this.stopped || !this.transport.isOpen()) return;
    const buffered = this.transport.bufferedAmount();
    if (this.paused && buffered > BrowserAudioUplink.LOW_WATER_BYTES) {
      this.schedule();
      return;
    }
    this.paused = false;
    while (this.queue.length > 0) {
      if (this.transport.bufferedAmount() >= BrowserAudioUplink.HIGH_WATER_BYTES) {
        this.paused = true;
        this.schedule();
        return;
      }
      const frame = this.queue.shift();
      if (!frame) break;
      this.transport.send(frame);
      this.sentFrames++;
    }
  }

  public stop(): void {
    this.stopped = true;
    this.queue = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  public getMetrics(): AudioUplinkMetrics {
    return {
      queuedFrames: this.queue.length,
      sentFrames: this.sentFrames,
      droppedOldestFrames: this.droppedOldestFrames,
      invalidFrames: this.invalidFrames,
    };
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, this.pollMs);
  }
}
