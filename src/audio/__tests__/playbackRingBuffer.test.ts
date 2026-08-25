import { describe, expect, it } from "vitest";
import { PlaybackRingBuffer } from "../playbackRingBuffer";

describe("PlaybackRingBuffer (FEAT-027)", () => {
  it("renders exact received samples only after the startup watermark", () => {
    const ring = new PlaybackRingBuffer(8, 4);
    ring.write(new Float32Array([0.25, -0.5, 0.75]));
    expect(Array.from(ring.render(2).output)).toEqual([0, 0]);
    ring.write(new Float32Array([1]));
    expect(Array.from(ring.render(4).output)).toEqual([0.25, -0.5, 0.75, 1]);
  });

  it("zero-fills underruns, drops newest overruns, and drains deterministically", () => {
    const ring = new PlaybackRingBuffer(4, 1);
    expect(ring.write(new Float32Array([0.5, 0.5, 0.5, 0.5, 0.9]))).toBe(4);
    expect(ring.metrics().overrunFrames).toBe(1);
    expect(Array.from(ring.render(3).output)).toEqual([0.5, 0.5, 0.5]);
    expect(Array.from(ring.render(3).output)).toEqual([0.5, 0, 0]);
    expect(ring.metrics().underrunFrames).toBe(2);
    ring.write(new Float32Array([0.25]));
    ring.end();
    expect(ring.render(1).drained).toBe(true);
  });

  it("reset removes all buffered and terminal state", () => {
    const ring = new PlaybackRingBuffer(4, 1);
    ring.write(new Float32Array([1]));
    ring.end();
    ring.reset();
    expect(ring.metrics()).toEqual({ bufferedFrames: 0, underrunFrames: 0, overrunFrames: 0 });
    expect(Array.from(ring.render(1).output)).toEqual([0]);
  });
});
