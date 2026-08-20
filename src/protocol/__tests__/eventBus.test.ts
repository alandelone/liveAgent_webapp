import { describe, it, expect, vi } from 'vitest';
import { HermesEventBus } from '../eventBus';
import { AgentStateEvent } from '../../types/protocol';

describe('HermesEventBus (FEAT-001)', () => {
  it('dispatches typed server events to subscribers', () => {
    const bus = new HermesEventBus();
    const handler = vi.fn();
    const allHandler = vi.fn();

    bus.on('AGENT_STATE', handler);
    bus.on('all', allHandler);

    const event: AgentStateEvent = {
      type: 'AGENT_STATE',
      seq: 1,
      agentId: 'hermes',
      state: 'thinking',
    };

    bus.handleRawMessage(JSON.stringify(event));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
    expect(allHandler).toHaveBeenCalledTimes(1);
    expect(allHandler).toHaveBeenCalledWith(event);
    expect(bus.getLastSeenSeq()).toBe(1);
  });

  it('detects sequence number gaps and emits seq_gap event', () => {
    const bus = new HermesEventBus();
    const gapHandler = vi.fn();
    bus.on('seq_gap', gapHandler);

    bus.handleRawMessage({
      type: 'AGENT_STATE',
      seq: 10,
      agentId: 'hermes',
      state: 'idle',
    });

    expect(bus.getLastSeenSeq()).toBe(10);
    expect(gapHandler).not.toHaveBeenCalled();

    // Jump from seq 10 to seq 15
    bus.handleRawMessage({
      type: 'AGENT_STATE',
      seq: 15,
      agentId: 'hermes',
      state: 'thinking',
    });

    expect(gapHandler).toHaveBeenCalledTimes(1);
    expect(gapHandler).toHaveBeenCalledWith({
      expected: 11,
      received: 15,
    });
    expect(bus.getLastSeenSeq()).toBe(15);
    expect(bus.getMissedSeqCount()).toBe(4);
  });

  it('multiplexes binary audio frames separately from JSON events', () => {
    const bus = new HermesEventBus();
    const audioHandler = vi.fn();
    const jsonHandler = vi.fn();

    bus.onAudio(audioHandler);
    bus.on('all', jsonHandler);

    const audioChunk = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    bus.handleRawMessage(audioChunk);

    expect(audioHandler).toHaveBeenCalledTimes(1);
    expect(audioHandler).toHaveBeenCalledWith(audioChunk);
    expect(jsonHandler).not.toHaveBeenCalled();
  });

  it('handles unknown events gracefully via unknown_event channel without crashing', () => {
    const bus = new HermesEventBus();
    const unknownHandler = vi.fn();
    bus.on('unknown_event', unknownHandler);

    bus.handleRawMessage({
      type: 'CUSTOM_NEW_EVENT',
      seq: 20,
      customData: true,
    });

    expect(unknownHandler).toHaveBeenCalledTimes(1);
    expect(unknownHandler).toHaveBeenCalledWith({
      type: 'CUSTOM_NEW_EVENT',
      seq: 20,
      customData: true,
    });
  });

  it('allows unsubscribing from event listeners', () => {
    const bus = new HermesEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.on('AGENT_STATE', handler);

    bus.handleRawMessage({
      type: 'AGENT_STATE',
      seq: 1,
      agentId: 'hermes',
      state: 'idle',
    });
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();

    bus.handleRawMessage({
      type: 'AGENT_STATE',
      seq: 2,
      agentId: 'hermes',
      state: 'thinking',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
