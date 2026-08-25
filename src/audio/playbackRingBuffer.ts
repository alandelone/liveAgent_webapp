export interface RingRenderResult {
  output: Float32Array;
  drained: boolean;
  rms: number;
}

export class PlaybackRingBuffer {
  private readonly data: Float32Array;
  private readIndex = 0;
  private writeIndex = 0;
  private buffered = 0;
  private started = false;
  private ended = false;
  private underrunFrames = 0;
  private overrunFrames = 0;

  constructor(
    capacityFrames = 48_000,
    private readonly startWatermarkFrames = 4_800,
  ) {
    if (capacityFrames < startWatermarkFrames || startWatermarkFrames < 1) throw new RangeError("invalid playback ring bounds");
    this.data = new Float32Array(capacityFrames);
  }

  public write(samples: Float32Array): number {
    const accepted = Math.min(samples.length, this.data.length - this.buffered);
    for (let index = 0; index < accepted; index++) {
      const value = samples[index];
      this.data[this.writeIndex] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
      this.writeIndex = (this.writeIndex + 1) % this.data.length;
    }
    this.buffered += accepted;
    this.overrunFrames += samples.length - accepted;
    return accepted;
  }

  public end(): void {
    this.ended = true;
  }

  public render(frameCount: number): RingRenderResult {
    const output = new Float32Array(frameCount);
    if (!this.started && (this.buffered >= this.startWatermarkFrames || (this.ended && this.buffered > 0))) this.started = true;
    let sum = 0;
    if (this.started) {
      const available = Math.min(frameCount, this.buffered);
      for (let index = 0; index < available; index++) {
        const value = this.data[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.data.length;
        output[index] = value;
        sum += value * value;
      }
      this.buffered -= available;
      if (available < frameCount && !this.ended) this.underrunFrames += frameCount - available;
    }
    return { output, drained: this.ended && this.started && this.buffered === 0, rms: Math.sqrt(sum / Math.max(1, frameCount)) };
  }

  public reset(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.buffered = 0;
    this.started = false;
    this.ended = false;
    this.underrunFrames = 0;
    this.overrunFrames = 0;
  }

  public metrics() {
    return { bufferedFrames: this.buffered, underrunFrames: this.underrunFrames, overrunFrames: this.overrunFrames };
  }
}
