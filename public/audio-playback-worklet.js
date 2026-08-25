const CAPACITY_FRAMES = 48000;
const START_WATERMARK_FRAMES = 4800;

class LiveAgentPcmPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(CAPACITY_FRAMES);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.buffered = 0;
    this.generation = 0;
    this.started = false;
    this.ended = false;
    this.underrunFrames = 0;
    this.overrunFrames = 0;
    this.renderedFrames = 0;
    this.metricCountdown = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(message) {
    if (!message || !Number.isInteger(message.generation)) return;
    if (message.type === "configure") {
      this.reset(message.generation);
      return;
    }
    if (message.type === "stop") {
      this.reset(message.generation);
      return;
    }
    if (message.generation !== this.generation) return;
    if (message.type === "samples" && message.samples instanceof ArrayBuffer) {
      const samples = new Float32Array(message.samples);
      const accepted = Math.min(samples.length, CAPACITY_FRAMES - this.buffered);
      for (let index = 0; index < accepted; index++) {
        this.ring[this.writeIndex] = Number.isFinite(samples[index]) ? Math.max(-1, Math.min(1, samples[index])) : 0;
        this.writeIndex = (this.writeIndex + 1) % CAPACITY_FRAMES;
      }
      this.buffered += accepted;
      this.overrunFrames += samples.length - accepted;
    } else if (message.type === "end") {
      this.ended = true;
    }
  }

  reset(generation) {
    this.generation = generation;
    this.readIndex = 0;
    this.writeIndex = 0;
    this.buffered = 0;
    this.started = false;
    this.ended = false;
    this.underrunFrames = 0;
    this.overrunFrames = 0;
    this.renderedFrames = 0;
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    if (!this.started && (this.buffered >= START_WATERMARK_FRAMES || (this.ended && this.buffered > 0))) {
      this.started = true;
      this.port.postMessage({ type: "audible-start", generation: this.generation });
    }
    let sum = 0;
    if (this.started) {
      const available = Math.min(output.length, this.buffered);
      for (let index = 0; index < available; index++) {
        const sample = this.ring[this.readIndex];
        this.readIndex = (this.readIndex + 1) % CAPACITY_FRAMES;
        output[index] = sample;
        sum += sample * sample;
      }
      this.buffered -= available;
      this.renderedFrames += available;
      if (available < output.length && !this.ended) this.underrunFrames += output.length - available;
    }
    this.metricCountdown -= output.length;
    if (this.metricCountdown <= 0) {
      this.metricCountdown = Math.round(sampleRate / 10);
      this.port.postMessage({
        type: "metrics", generation: this.generation,
        rms: Math.sqrt(sum / Math.max(1, output.length)), bufferedFrames: this.buffered,
        underrunFrames: this.underrunFrames, overrunFrames: this.overrunFrames, renderedFrames: this.renderedFrames,
      });
    }
    if (this.ended && this.started && this.buffered === 0) {
      this.ended = false;
      this.started = false;
      this.port.postMessage({ type: "drained", generation: this.generation });
    }
    return true;
  }
}

registerProcessor("live-agent-pcm-playback", LiveAgentPcmPlayback);
