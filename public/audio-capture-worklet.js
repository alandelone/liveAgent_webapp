const TARGET_RATE = 16000;
const FRAME_SAMPLES = 320;

class LiveAgentPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE;
    this.source = [];
    this.position = 0;
    this.output = [];
    this.sourceSamples = 0;
    this.outputSamples = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const length = Math.min(...channels.map((channel) => channel.length));
    for (let index = 0; index < length; index++) {
      let mixed = 0;
      for (const channel of channels) mixed += channel[index];
      this.source.push(mixed / channels.length);
    }
    this.sourceSamples += length;

    while (this.position + 1 < this.source.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      this.output.push(this.source[left] + (this.source[left + 1] - this.source[left]) * fraction);
      this.position += this.step;
    }
    const consumed = Math.floor(this.position);
    if (consumed > 0) {
      this.source.splice(0, consumed);
      this.position -= consumed;
    }

    while (this.output.length >= FRAME_SAMPLES) {
      const buffer = new ArrayBuffer(FRAME_SAMPLES * 2);
      const view = new DataView(buffer);
      for (let index = 0; index < FRAME_SAMPLES; index++) {
        const sample = Math.max(-1, Math.min(1, this.output.shift()));
        const value = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
        view.setInt16(index * 2, value, true);
      }
      this.outputSamples += FRAME_SAMPLES;
      this.port.postMessage(
        { type: "pcm", buffer, sourceSamples: this.sourceSamples, outputSamples: this.outputSamples },
        [buffer],
      );
    }
    return true;
  }
}

registerProcessor("live-agent-pcm-capture", LiveAgentPcmCapture);
