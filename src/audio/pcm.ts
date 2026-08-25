export const TARGET_SAMPLE_RATE = 16_000;
export const PCM_FRAME_SAMPLES = 320;
export const PCM_FRAME_BYTES = PCM_FRAME_SAMPLES * 2;

export function encodePcmS16Le(samples: Float32Array): Uint8Array {
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < samples.length; index++) {
    const clipped = Math.max(-1, Math.min(1, samples[index]));
    const value = clipped < 0 ? Math.round(clipped * 32768) : Math.round(clipped * 32767);
    view.setInt16(index * 2, value, true);
  }
  return output;
}

export class StatefulPcmFramer {
  private source: number[] = [];
  private sourcePosition = 0;
  private framed: number[] = [];
  private readonly step: number;

  constructor(
    sourceSampleRate: number,
    targetSampleRate = TARGET_SAMPLE_RATE,
    private readonly frameSamples = PCM_FRAME_SAMPLES,
  ) {
    if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
      throw new Error("sourceSampleRate must be positive");
    }
    this.step = sourceSampleRate / targetSampleRate;
  }

  public push(channels: readonly Float32Array[]): Uint8Array[] {
    if (channels.length === 0) return [];
    const length = Math.min(...channels.map((channel) => channel.length));
    for (let index = 0; index < length; index++) {
      let mixed = 0;
      for (const channel of channels) mixed += channel[index];
      this.source.push(mixed / channels.length);
    }

    while (this.sourcePosition + 1 < this.source.length) {
      const left = Math.floor(this.sourcePosition);
      const fraction = this.sourcePosition - left;
      const sample = this.source[left] + (this.source[left + 1] - this.source[left]) * fraction;
      this.framed.push(sample);
      this.sourcePosition += this.step;
    }

    const consumed = Math.floor(this.sourcePosition);
    if (consumed > 0) {
      this.source.splice(0, consumed);
      this.sourcePosition -= consumed;
    }

    const frames: Uint8Array[] = [];
    while (this.framed.length >= this.frameSamples) {
      frames.push(encodePcmS16Le(Float32Array.from(this.framed.splice(0, this.frameSamples))));
    }
    return frames;
  }

  public getPendingTargetSamples(): number {
    return this.framed.length;
  }
}
