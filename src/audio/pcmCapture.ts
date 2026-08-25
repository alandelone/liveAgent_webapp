import { HermesClient } from "../protocol/HermesClient";
import { BrowserAudioUplink } from "./audioUplink";
import { PCM_FRAME_BYTES } from "./pcm";

export type AppliedSetting = boolean | number | string;
export type AppliedAudioSettings = Record<string, AppliedSetting>;

export class PcmCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private uplink: BrowserAudioUplink | null = null;
  private captureId: string | null = null;
  private appliedAudioSettings: AppliedAudioSettings = {};
  private audioSettingsListeners = new Set<(settings: Readonly<AppliedAudioSettings>) => void>();
  private volumeListeners = new Set<(rms: number) => void>();

  constructor(private readonly client: HermesClient) {}

  public async start(): Promise<void> {
    if (this.captureId || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioContextClass();
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio-capture-worklet.js`);
    if (context.state === "suspended") await context.resume();

    const captureId = `capture_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
    const settings = stream.getAudioTracks()[0]?.getSettings() ?? {};
    const appliedAudioSettings: Record<string, AppliedSetting> = {};
    for (const key of ["sampleRate", "channelCount", "echoCancellation", "noiseSuppression", "autoGainControl"] as const) {
      const value = settings[key];
      if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        appliedAudioSettings[key] = value;
      }
    }
    this.appliedAudioSettings = appliedAudioSettings;
    this.audioSettingsListeners.forEach((listener) => listener(this.getAppliedAudioSettings()));

    this.stream = stream;
    this.context = context;
    this.captureId = captureId;
    this.uplink = new BrowserAudioUplink({
      isOpen: () => this.client.canSendAudio(),
      bufferedAmount: () => this.client.getBufferedAmount(),
      send: (frame) => this.client.sendAudio(frame),
    });
    this.client.sendEvent({
      type: "CAPTURE_START",
      sessionId: this.client.getSessionId(),
      captureId,
      format: { encoding: "pcm_s16le", sampleRateHz: 16_000, channels: 1, frameMs: 20 },
      appliedAudioSettings,
    });

    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "live-agent-pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    node.port.onmessage = (event: MessageEvent<{ type: string; buffer: ArrayBuffer }>) => {
      if (event.data?.type !== "pcm" || event.data.buffer.byteLength !== PCM_FRAME_BYTES) return;
      const frame = new Uint8Array(event.data.buffer);
      this.volumeListeners.forEach((listener) => listener(this.calculateRms(frame)));
      this.uplink?.enqueue(frame);
    };
    source.connect(node);
    node.connect(silentGain);
    silentGain.connect(context.destination);
    this.source = source;
    this.node = node;
    this.silentGain = silentGain;
  }

  public async stop(): Promise<void> {
    const captureId = this.captureId;
    this.captureId = null;
    if (captureId) {
      this.client.sendEvent({
        type: "CAPTURE_END",
        sessionId: this.client.getSessionId(),
        captureId,
      });
    }
    this.uplink?.stop();
    this.uplink = null;
    this.node?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    this.node = null;
    this.source = null;
    this.silentGain = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
    this.volumeListeners.forEach((listener) => listener(0));
  }

  public isActive(): boolean {
    return this.captureId !== null;
  }

  public getAppliedAudioSettings(): Readonly<AppliedAudioSettings> {
    return { ...this.appliedAudioSettings };
  }

  public onAppliedAudioSettingsChange(
    listener: (settings: Readonly<AppliedAudioSettings>) => void,
  ): () => void {
    this.audioSettingsListeners.add(listener);
    listener(this.getAppliedAudioSettings());
    return () => this.audioSettingsListeners.delete(listener);
  }

  public onVolumeChange(listener: (rms: number) => void): () => void {
    this.volumeListeners.add(listener);
    return () => this.volumeListeners.delete(listener);
  }

  private calculateRms(frame: Uint8Array): number {
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    let sumSquares = 0;
    for (let offset = 0; offset < frame.byteLength; offset += 2) {
      const sample = view.getInt16(offset, true) / 32_768;
      sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / (frame.byteLength / 2));
  }
}
