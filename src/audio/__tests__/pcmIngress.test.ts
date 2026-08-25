import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserAudioUplink, AudioTransport } from "../audioUplink";
import { PcmCapture } from "../pcmCapture";
import { encodePcmS16Le, PCM_FRAME_BYTES, StatefulPcmFramer } from "../pcm";
import { HermesClient } from "../../protocol/HermesClient";

describe("PCM capture primitives (FEAT-018)", () => {
  afterEach(() => vi.useRealTimers());

  it("resamples 48 kHz across split callbacks into one exact 20 ms frame", () => {
    const framer = new StatefulPcmFramer(48_000);
    const source = Float32Array.from({ length: 960 }, (_, index) => Math.sin(index / 20));
    const frames = [
      ...framer.push([source.slice(0, 127)]),
      ...framer.push([source.slice(127, 511)]),
      ...framer.push([source.slice(511)]),
    ];
    expect(frames).toHaveLength(1);
    expect(frames[0].byteLength).toBe(PCM_FRAME_BYTES);
    expect(framer.getPendingTargetSamples()).toBe(0);
  });

  it("preserves fractional phase for 44.1 kHz and downmixes channels", () => {
    const framer = new StatefulPcmFramer(44_100);
    const left = new Float32Array(4_410).fill(0.5);
    const right = new Float32Array(4_410).fill(-0.25);
    const frames = [
      ...framer.push([left.slice(0, 999), right.slice(0, 999)]),
      ...framer.push([left.slice(999), right.slice(999)]),
    ];
    expect(frames).toHaveLength(5);
    expect(frames.every((frame) => frame.byteLength === PCM_FRAME_BYTES)).toBe(true);
    expect(new DataView(frames[0].buffer).getInt16(0, true)).toBeCloseTo(4096, -1);
  });

  it("clips and writes signed little-endian PCM", () => {
    const encoded = encodePcmS16Le(Float32Array.from([-2, -1, 0, 1, 2]));
    const view = new DataView(encoded.buffer);
    expect([0, 1, 2, 3, 4].map((index) => view.getInt16(index * 2, true))).toEqual([
      -32768,
      -32768,
      0,
      32767,
      32767,
    ]);
  });

  it("bounds uplink at 100 frames and drops the oldest while saturated", () => {
    vi.useFakeTimers();
    let buffered = BrowserAudioUplink.HIGH_WATER_BYTES;
    const sent: Uint8Array[] = [];
    const transport: AudioTransport = {
      isOpen: () => true,
      bufferedAmount: () => buffered,
      send: (frame) => sent.push(frame),
    };
    const uplink = new BrowserAudioUplink(transport, 5);
    for (let index = 0; index < 101; index++) {
      const frame = new Uint8Array(PCM_FRAME_BYTES);
      frame[0] = index;
      uplink.enqueue(frame);
    }
    expect(uplink.getMetrics()).toMatchObject({ queuedFrames: 100, droppedOldestFrames: 1 });
    buffered = 0;
    vi.advanceTimersByTime(5);
    expect(sent).toHaveLength(100);
    expect(sent[0][0]).toBe(1);
    expect(uplink.getMetrics().sentFrames).toBe(100);
  });

  it("does not send while closed and rejects malformed frames", () => {
    const send = vi.fn();
    const uplink = new BrowserAudioUplink({
      isOpen: () => false,
      bufferedAmount: () => 0,
      send,
    });
    uplink.enqueue(new Uint8Array(PCM_FRAME_BYTES));
    expect(send).not.toHaveBeenCalled();
    expect(() => uplink.enqueue(new Uint8Array(12))).toThrow(/640 bytes/);
    expect(uplink.getMetrics()).toMatchObject({ queuedFrames: 1, invalidFrames: 1 });
  });

  it("reports applied settings before sending worklet PCM and tears down once", async () => {
    const sentEvents: unknown[] = [];
    const sentAudio: Uint8Array[] = [];
    const tracks = [{
      getSettings: () => ({
        sampleRate: 48_000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      }),
      stop: vi.fn(),
    }];
    const stream = { getAudioTracks: () => tracks, getTracks: () => tracks } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    let createdNode: { port: { onmessage: ((event: MessageEvent) => void) | null }; disconnect: () => void } | null = null;
    class FakeWorkletNode {
      port = { onmessage: null as ((event: MessageEvent) => void) | null };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        createdNode = this;
      }
    }
    class FakeAudioContext {
      state: AudioContextState = "running";
      destination = {} as AudioDestinationNode;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
      createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() });
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockImplementation(async () => {
        this.state = "closed";
      });
    }
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });

    const client = {
      getSessionId: () => "session_pcm",
      sendEvent: (event: unknown) => sentEvents.push(event),
      canSendAudio: () => true,
      getBufferedAmount: () => 0,
      sendAudio: (frame: Uint8Array) => sentAudio.push(frame),
    } as unknown as HermesClient;
    const capture = new PcmCapture(client);
    const volumes: number[] = [];
    capture.onVolumeChange((volume) => volumes.push(volume));
    await capture.start();
    expect((sentEvents[0] as { type: string }).type).toBe("CAPTURE_START");
    expect((sentEvents[0] as { appliedAudioSettings: { sampleRate: number } }).appliedAudioSettings.sampleRate).toBe(48_000);
    const pcm = new ArrayBuffer(PCM_FRAME_BYTES);
    const pcmView = new DataView(pcm);
    for (let offset = 0; offset < PCM_FRAME_BYTES; offset += 2) pcmView.setInt16(offset, 16_384, true);
    createdNode!.port.onmessage?.({ data: { type: "pcm", buffer: pcm } } as MessageEvent);
    expect(sentAudio).toHaveLength(1);
    expect(volumes[volumes.length - 1]).toBeCloseTo(0.5, 5);
    await capture.stop();
    await capture.stop();
    expect(sentEvents.filter((event) => (event as { type: string }).type === "CAPTURE_END")).toHaveLength(1);
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(volumes[volumes.length - 1]).toBe(0);
  });
});
