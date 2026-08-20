import { describe, it, expect, vi } from 'vitest';
import { AudioPlaybackQueue } from '../audioPlaybackQueue';
import { EchoSuppressor } from '../echoSuppressor';
import { BargeInManager } from '../bargeInManager';
import { VoiceController } from '../voiceController';
import { HermesEventBus } from '../../protocol/eventBus';
import { HermesClient } from '../../protocol/HermesClient';
import { AgentStateMachine } from '../../state/agentStateMachine';

describe('Streaming Voice Pipeline, Echo Cancellation & Barge-in (FEAT-006 & FEAT-007)', () => {
  it('audio playback queue enqueues chunks, notifies volume, and can be flushed instantly', () => {
    const queue = new AudioPlaybackQueue();
    const volListener = vi.fn();
    queue.onVolumeChange(volListener);

    // Create synthetic 16-bit PCM buffer (100 samples)
    const buffer = new Int16Array(100);
    for (let i = 0; i < 100; i++) {
      buffer[i] = 10000;
    }

    queue.enqueueChunk(buffer.buffer);
    expect(queue.getIsPlaying()).toBe(true);
    expect(volListener).toHaveBeenCalled();

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

  it('barge-in immediately halts TTS, sends USER_INTERRUPT, and resets turn without affecting tasks', () => {
    const eventBus = new HermesEventBus();
    const sentEvents: any[] = [];
    eventBus.on('client_event', (ev) => sentEvents.push(ev));

    const client = new HermesClient({}, eventBus);
    // Mock sendEvent to dispatch through eventBus directly for unit test
    vi.spyOn(client, 'sendEvent').mockImplementation((ev) => {
      eventBus.emitClientEvent(ev);
    });

    const stateMachine = new AgentStateMachine(eventBus);
    const playbackQueue = new AudioPlaybackQueue();
    const bargeIn = new BargeInManager(client, stateMachine, playbackQueue);

    // Setup active playback & speaking state
    stateMachine.predictState('speaking');
    stateMachine.setTurnId('turn_888');
    const dummyChunk = new Uint8Array([1, 2, 3, 4]);
    playbackQueue.enqueueChunk(dummyChunk);
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
});
