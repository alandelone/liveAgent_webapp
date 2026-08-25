import { describe, it, expect, afterEach } from 'vitest';
import { MockHermesServer } from '../mockServer';
import { WebSocket } from 'ws';
import seedData from '../../../test-fixtures/seed-data.json';

describe('Deterministic MockHermesServer (FEAT-003)', () => {
  let server: MockHermesServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('serves AGENT_MANIFEST and replays timeline deterministically against seed-data.json', async () => {
    server = new MockHermesServer({
      port: 9876,
      autoStartReplay: false,
      seedFixture: seedData,
    });
    const port = await server.start();
    expect(port).toBe(9876);

    const receivedEvents: any[] = [];
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'CLIENT_HELLO',
            protocolVersion: 1,
            sessionId: 'mock-session-001',
            lastSeq: null,
          })
        );
      });

      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        receivedEvents.push(parsed);
        // Expect manifest + initialTranscripts (2 items) = 3 items immediately
        if (receivedEvents.length === 3) {
          resolve();
        }
      });
    });

    expect(receivedEvents[0].type).toBe('AGENT_MANIFEST');
    expect(receivedEvents[0].agents).toHaveLength(6);
    expect(receivedEvents[1].type).toBe('STT_FINAL');
    expect(receivedEvents[2].type).toBe('TEXT_DELTA');

    ws.close();
  });

  it('replays missing sequence gaps on reconnect scenario with lastSeq', async () => {
    server = new MockHermesServer({
      port: 9877,
      autoStartReplay: false,
      seedFixture: seedData,
    });
    const port = await server.start();

    const receivedEvents: any[] = [];
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        // Send CLIENT_HELLO with lastSeq: 13 (as defined in seedData reconnectScenario)
        ws.send(
          JSON.stringify({
            type: 'CLIENT_HELLO',
            protocolVersion: 1,
            sessionId: 'mock-session-001',
            lastSeq: 13,
          })
        );
      });

      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        receivedEvents.push(parsed);
        // 1 manifest + 3 replayed events (seq 14, 15, 16)
        if (receivedEvents.length === 4) {
          resolve();
        }
      });
    });

    expect(receivedEvents[0].type).toBe('AGENT_MANIFEST');
    expect(receivedEvents[1].seq).toBe(14);
    expect(receivedEvents[1].type).toBe('TASK_PROGRESS');
    expect(receivedEvents[2].seq).toBe(15);
    expect(receivedEvents[2].type).toBe('TASK_COMPLETE');
    expect(receivedEvents[3].seq).toBe(16);
    expect(receivedEvents[3].type).toBe('AGENT_STATE');

    ws.close();
  });
});
