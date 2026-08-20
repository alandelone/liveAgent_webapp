import { describe, it, expect } from 'vitest';
import { parseIncomingServerEvent, ClientHelloSchema } from '../schemas';
import seedData from '../../../test-fixtures/seed-data.json';

describe('Protocol Schemas (FEAT-001)', () => {
  it('validates seed-data manifest event against AGENT_MANIFEST schema', () => {
    const parsed = parseIncomingServerEvent(seedData.manifest);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'AGENT_MANIFEST') {
      expect(parsed.data.type).toBe('AGENT_MANIFEST');
      expect(parsed.data.agents).toHaveLength(5);
      expect(parsed.data.agents[0].id).toBe('hermes');
      expect(parsed.data.agents[0].isOrchestrator).toBe(true);
    }
  });

  it('validates seed-data replayTimeline events against schema', () => {
    for (const item of seedData.replayTimeline) {
      const parsed = parseIncomingServerEvent(item.event);
      expect(parsed.success, `Failed parsing ${item.event.type}`).toBe(true);
    }
  });

  it('validates CLIENT_HELLO schema', () => {
    const validClientHello = {
      type: 'CLIENT_HELLO',
      protocolVersion: 1,
      sessionId: 'sess_123',
      lastSeq: 42,
      capabilities: ['audio_pcm_16k'],
    };
    const result = ClientHelloSchema.safeParse(validClientHello);
    expect(result.success).toBe(true);
  });

  it('gracefully handles forward compatibility for unknown event types', () => {
    const futureEvent = {
      type: 'FUTURE_QUANTUM_EVENT',
      seq: 999,
      quantumPayload: { qubit: 4 },
    };
    const parsed = parseIncomingServerEvent(futureEvent);
    expect(parsed.success).toBe(false);
    if (!parsed.success && 'isUnknownType' in parsed) {
      expect(parsed.isUnknownType).toBe(true);
      expect(parsed.eventType).toBe('FUTURE_QUANTUM_EVENT');
    }
  });

  it('safely rejects malformed payloads without crashing', () => {
    const invalidPayload = {
      type: 'AGENT_STATE',
      seq: 'not-a-number',
      agentId: 1234,
    };
    const parsed = parseIncomingServerEvent(invalidPayload);
    expect(parsed.success).toBe(false);
  });
});
