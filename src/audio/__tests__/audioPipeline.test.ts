import { describe, it, expect, vi } from 'vitest';
import { AudioPlaybackQueue, PlaybackBackend, WorkletMessage } from '../audioPlaybackQueue';
import { EchoSuppressor } from '../echoSuppressor';
import { BargeInManager } from '../bargeInManager';
import { acousticInputMode, VoiceController } from '../voiceController';
import { HermesEventBus } from '../../protocol/eventBus';
import { HermesClient } from '../../protocol/HermesClient';
import { AgentStateMachine } from '../../state/agentStateMachine';

class FakePlaybackBackend implements PlaybackBackend {
  public messages: Array<Record<string, unknown>> = [];
  private listener: ((message: WorkletMessage) => void) | null = null;
  async prepare(listener: (message: WorkletMessage) => void) { this.listener = listener; }
  configure(generation: number, sampleRateHz: number) { this.messages.push({ type: 'configure', generation, sampleRateHz }); }
  push(generation: number, samples: Float32Array) { this.messages.push({ type: 'samples', generation, samples: Array.from(samples) }); }
  end(generation: number) { this.messages.push({ type: 'end', generation }); }
  stop(generation: number) { this.messages.push({ type: 'stop', generation }); }
  async close() { this.messages.push({ type: 'close' }); }
  emit(message: WorkletMessage) { this.listener?.(message); }
}

const startEvent = {
  type: 'TTS_START' as const, seq: 1, agentId: 'supervisor', turnId: 'turn', streamId: 'stream',
  format: { encoding: 'pcm_f32le' as const, sampleRateHz: 24000 as const, channels: 1 as const, chunkFrames: 2400 },
};

describe('Streaming Voice Pipeline, Echo Cancellation & Barge-in (FEAT-006, FEAT-007 & FEAT-027)', () => {
  it('fails closed to push-to-talk unless browser AEC is actually applied', () => {
    expect(acousticInputMode({})).toBe('push_to_talk');
    expect(acousticInputMode({ echoCancellation: false })).toBe('push_to_talk');
    expect(acousticInputMode({ echoCancellation: true })).toBe('hands_free');
  });
  it('transfers real float32 samples to the playback backend and can be flushed instantly', async () => {
    const backend = new FakePlaybackBackend();
    const queue = new AudioPlaybackQueue(backend);
    const volListener = vi.fn();
    queue.onVolumeChange(volListener);
    queue.startStream(startEvent);
    queue.startStream({ ...startEvent, streamId: 'nested-stream' });
    expect(queue.getActiveStreamId()).toBe('stream');
    expect(queue.getMetrics().invalidChunks).toBe(1);
    await Promise.resolve();
    const buffer = new Float32Array([0.25, -0.5, 0.75]);
    queue.enqueueChunk(buffer.buffer);
    expect(queue.getIsPlaying()).toBe(true);
    expect(backend.messages.some((message) => message.type === 'samples')).toBe(true);
    backend.emit({ type: 'metrics', generation: 2, rms: 0.25, bufferedFrames: 3, underrunFrames: 0, overrunFrames: 0, renderedFrames: 3 });
    expect(volListener).toHaveBeenCalledWith(0.75);

    // Instant flush / stop
    queue.flush();
    expect(queue.getIsPlaying()).toBe(false);
    expect(queue.getCurrentVolume()).toBe(0);
  });

  it('echo suppressor detects TTS playback and suppresses low-energy acoustic reflections', () => {
    const suppressor = new EchoSuppressor({ echoGracePeriodMs: 200 });

    expect(suppressor.isEchoSuppressed()).toBe(false);

    suppressor.setTtsPlaying(true);
    expect(suppressor.isEchoSuppressed()).toBe(true);
    // Low energy is suppressed
    expect(suppressor.shouldSuppressAudioInput(0.3)).toBe(true);
    // High energy (intentional barge-in) penetrates suppression barrier
    expect(suppressor.shouldSuppressAudioInput(0.8)).toBe(false);

    suppressor.setTtsPlaying(false);
    // Within 200ms grace period, still suppressed
    expect(suppressor.isEchoSuppressed()).toBe(true);
  });

  it('barge-in immediately halts TTS, sends USER_INTERRUPT, and resets turn without affecting tasks', async () => {
    const eventBus = new HermesEventBus();
    const sentEvents: any[] = [];
    eventBus.on('client_event', (ev) => sentEvents.push(ev));

    const client = new HermesClient({}, eventBus);
    // Mock sendEvent to dispatch through eventBus directly for unit test
    vi.spyOn(client, 'sendEvent').mockImplementation((ev) => {
      eventBus.emitClientEvent(ev);
    });

    const stateMachine = new AgentStateMachine(eventBus);
    const playbackQueue = new AudioPlaybackQueue(new FakePlaybackBackend());
    const bargeIn = new BargeInManager(client, stateMachine, playbackQueue);

    // Setup active playback & speaking state
    stateMachine.predictState('speaking');
    stateMachine.setTurnId('turn_888');
    playbackQueue.startStream(startEvent);
    await Promise.resolve();
    const dummyChunk = new Float32Array([0.1, 0.2]);
    playbackQueue.enqueueChunk(dummyChunk.buffer);
    expect(playbackQueue.getIsPlaying()).toBe(true);

    // Trigger barge-in
    bargeIn.triggerInterruption();

    // 1. Playback queue is immediately halted
    expect(playbackQueue.getIsPlaying()).toBe(false);

    // 2. USER_INTERRUPT was dispatched
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].type).toBe('USER_INTERRUPT');
    expect(sentEvents[0].turnId).toBe('turn_888');

    // 3. Metrics recorded
    expect(bargeIn.getMetrics().totalInterruptions).toBe(1);
  });

  it('voice controller handles text fallback and push-to-talk modes', () => {
    const eventBus = new HermesEventBus();
    const sentEvents: any[] = [];
    eventBus.on('client_event', (ev) => sentEvents.push(ev));

    const client = new HermesClient({}, eventBus);
    vi.spyOn(client, 'sendEvent').mockImplementation((ev) => {
      eventBus.emitClientEvent(ev);
    });

    const stateMachine = new AgentStateMachine(eventBus);
    const controller = new VoiceController(client, stateMachine);

    // Text fallback
    controller.sendText('git status --short');
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].type).toBe('USER_TEXT');
    expect(sentEvents[0].text).toBe('git status --short');
    expect(stateMachine.getSnapshot().mainState).toBe('thinking');

    // PTT mode toggle
    controller.setPushToTalk(true);
    expect(controller.getIsPushToTalk()).toBe(true);

    controller.handlePttPress();
    expect(stateMachine.getSnapshot().isListening).toBe(true);

    controller.handlePttRelease();
    expect(stateMachine.getSnapshot().mainState).toBe('thinking');
  });

  it('keeps presentation speaking until the real worklet reports drained', async () => {
    const eventBus = new HermesEventBus();
    const client = new HermesClient({}, eventBus);
    const stateMachine = new AgentStateMachine(eventBus);
    const backend = new FakePlaybackBackend();
    const controller = new VoiceController(client, stateMachine, { playbackBackend: backend });
    eventBus.handleRawMessage({
      type: 'AGENT_MANIFEST', seq: 0, agents: [{ id: 'supervisor', name: 'Supervisor', color: '#000', icon: 'brain', isOrchestrator: true }],
    });
    eventBus.handleRawMessage(startEvent);
    await Promise.resolve();
    eventBus.emitAudio(new Float32Array([0.1, 0.2]).buffer);
    eventBus.handleRawMessage({
      type: 'TTS_END', seq: 2, agentId: 'supervisor', turnId: 'turn', streamId: 'stream', outcome: 'COMPLETED',
    });
    expect(stateMachine.getSnapshot().isSpeaking).toBe(true);
    backend.emit({ type: 'drained', generation: 2 });
    expect(stateMachine.getSnapshot().mainState).toBe('idle');
    controller.dispose();
  });

  it('reactivates event subscriptions after a development lifecycle cleanup', async () => {
    const eventBus = new HermesEventBus();
    const client = new HermesClient({}, eventBus);
    const stateMachine = new AgentStateMachine(eventBus);
    const backend = new FakePlaybackBackend();
    const controller = new VoiceController(client, stateMachine, { playbackBackend: backend });

    controller.dispose();
    controller.activate();
    eventBus.handleRawMessage(startEvent);
    await Promise.resolve();
    eventBus.emitAudio(new Float32Array([0.1, 0.2]).buffer);

    expect(controller.playbackQueue.getMetrics().chunksPlayed).toBe(1);
    controller.dispose();
  });

  it('records authoritative acoustic interruption stop latency', async () => {
    const eventBus = new HermesEventBus();
    const client = new HermesClient({}, eventBus);
    const stateMachine = new AgentStateMachine(eventBus);
    const backend = new FakePlaybackBackend();
    const controller = new VoiceController(client, stateMachine, { playbackBackend: backend });
    const listener = vi.fn();
    controller.onAcousticInterruption(listener);

    eventBus.handleRawMessage(startEvent);
    await Promise.resolve();
    eventBus.emitAudio(new Float32Array([0.1, 0.2]).buffer);
    eventBus.handleRawMessage({
      type: 'USER_SPEECH_START', sessionId: 'session', turnId: 'barge', seq: 2,
    });
    eventBus.handleRawMessage({
      type: 'TTS_END', seq: 3, agentId: 'supervisor', turnId: 'turn', streamId: 'stream', outcome: 'INTERRUPTED',
    });

    expect(controller.playbackQueue.getIsPlaying()).toBe(false);
    expect(controller.getAcousticInterruptionMetrics().totalAuthoritativeInterruptions).toBe(1);
    expect(controller.getAcousticInterruptionMetrics().lastStopLatencyMs).not.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
