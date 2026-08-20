import { describe, it, expect } from 'vitest';
import { HermesEventBus } from '../../protocol/eventBus';
import { AgentStateMachine } from '../agentStateMachine';

describe('AgentStateMachine (FEAT-005)', () => {
  it('predicts optimistic state on local user action and reconciles with Hermes events', () => {
    const bus = new HermesEventBus();
    const stateMachine = new AgentStateMachine(bus);

    expect(stateMachine.getSnapshot().mainState).toBe('idle');
    expect(stateMachine.getSnapshot().isOptimistic).toBe(false);

    // User taps mic -> optimistic prediction
    stateMachine.predictState('listening', 'Microphone active');
    expect(stateMachine.getSnapshot().mainState).toBe('listening');
    expect(stateMachine.getSnapshot().isListening).toBe(true);
    expect(stateMachine.getSnapshot().isOptimistic).toBe(true);

    // Hermes responds with authoritative AGENT_STATE
    bus.handleRawMessage({
      type: 'AGENT_STATE',
      seq: 10,
      agentId: 'hermes',
      state: 'thinking',
      detail: 'Hermes is analyzing question',
    });

    const snapshot = stateMachine.getSnapshot();
    expect(snapshot.mainState).toBe('thinking');
    expect(snapshot.isThinking).toBe(true);
    expect(snapshot.isOptimistic).toBe(false);
    expect(snapshot.detail).toBe('Hermes is analyzing question');
  });

  it('transitions state on TTS_START and TTS_END', () => {
    const bus = new HermesEventBus();
    const stateMachine = new AgentStateMachine(bus);

    bus.handleRawMessage({
      type: 'TTS_START',
      seq: 20,
      agentId: 'hermes',
      turnId: 'turn_42',
    });

    expect(stateMachine.getSnapshot().mainState).toBe('speaking');
    expect(stateMachine.getSnapshot().isSpeaking).toBe(true);
    expect(stateMachine.getSnapshot().currentTurnId).toBe('turn_42');

    bus.handleRawMessage({
      type: 'TTS_END',
      seq: 21,
      agentId: 'hermes',
      turnId: 'turn_42',
    });

    expect(stateMachine.getSnapshot().mainState).toBe('idle');
    expect(stateMachine.getSnapshot().isSpeaking).toBe(false);
  });
});
