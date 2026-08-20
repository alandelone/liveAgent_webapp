import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HermesClient } from '../HermesClient';
import { HermesEventBus } from '../eventBus';

// Mock WebSocket implementation for unit testing client logic
class FakeWebSocket {
  public static OPEN = 1;
  public static CLOSED = 3;
  public readyState = FakeWebSocket.OPEN;
  public binaryType = 'arraybuffer';
  public sentMessages: any[] = [];

  public onopen: (() => void) | null = null;
  public onmessage: ((ev: MessageEvent) => void) | null = null;
  public onclose: ((ev: CloseEvent) => void) | null = null;
  public onerror: ((err: any) => void) | null = null;

  constructor(public url: string) {
    setTimeout(() => {
      if (this.onopen) {
        this.onopen();
      }
    }, 10);
  }

  public send(data: any) {
    this.sentMessages.push(data);
  }

  public close(code = 1000, reason = 'Normal closure') {
    this.readyState = FakeWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason } as CloseEvent);
    }
  }

  public simulateServerMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
    }
  }
}

describe('HermesClient (FEAT-002)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects, sends CLIENT_HELLO with protocolVersion and sessionId, and transitions to connected', () => {
    const eventBus = new HermesEventBus();
    const client = new HermesClient(
      {
        url: 'ws://localhost:8765/ws',
        sessionId: 'test-session-123',
        WebSocketClass: FakeWebSocket as unknown as typeof WebSocket,
      },
      eventBus
    );

    client.connect();
    expect(client.getState()).toBe('connecting');

    vi.advanceTimersByTime(20);
    expect(client.getState()).toBe('connected');

    const metrics = client.getMetrics();
    expect(metrics.totalEventsSent).toBe(1);
    expect(client.getSessionId()).toBe('test-session-123');
  });

  it('includes lastSeq in CLIENT_HELLO when reconnecting after events were received', () => {
    const eventBus = new HermesEventBus();
    eventBus.setLastSeenSeq(42);

    const client = new HermesClient(
      {
        url: 'ws://localhost:8765/ws',
        sessionId: 'test-session-123',
        WebSocketClass: FakeWebSocket as unknown as typeof WebSocket,
      },
      eventBus
    );

    client.connect();
    vi.advanceTimersByTime(20);

    expect(client.getState()).toBe('connected');
    const sentEvents = (client as any).ws.sentMessages;
    const helloEvent = JSON.parse(sentEvents[0]);

    expect(helloEvent.type).toBe('CLIENT_HELLO');
    expect(helloEvent.protocolVersion).toBe(1);
    expect(helloEvent.sessionId).toBe('test-session-123');
    expect(helloEvent.lastSeq).toBe(42);
  });

  it('automatically triggers reconnection with exponential backoff on unexpected close', () => {
    const eventBus = new HermesEventBus();
    const client = new HermesClient(
      {
        url: 'ws://localhost:8765/ws',
        sessionId: 'test-session-123',
        minReconnectDelayMs: 500,
        maxReconnectDelayMs: 8000,
        reconnectMultiplier: 2,
        autoReconnect: true,
        WebSocketClass: FakeWebSocket as unknown as typeof WebSocket,
      },
      eventBus
    );

    client.connect();
    vi.advanceTimersByTime(20);
    expect(client.getState()).toBe('connected');

    // Simulate unexpected drop
    (client as any).ws.close(1006, 'Connection lost');
    expect(client.getState()).toBe('reconnecting');
    expect(client.getMetrics().reconnectAttempts).toBe(1);

    // Fast-forward backoff delay
    vi.advanceTimersByTime(1000);
    // Reconnect attempt triggered
    vi.advanceTimersByTime(20);
    expect(client.getState()).toBe('connected');
  });
});
