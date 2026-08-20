import {
  HermesClientEvent,
  ConnectionState,
  CURRENT_PROTOCOL_VERSION,
} from '../types/protocol';
import { HermesEventBus } from './eventBus';

export interface HermesClientConfig {
  url?: string;
  sessionId?: string;
  autoReconnect?: boolean;
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  reconnectMultiplier?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  WebSocketClass?: typeof WebSocket;
}

export interface ClientMetrics {
  reconnectAttempts: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastPingRttMs: number | null;
  totalEventsSent: number;
  totalAudioFramesSent: number;
}

export class HermesClient {
  public readonly eventBus: HermesEventBus;
  private config: Required<Omit<HermesClientConfig, 'WebSocketClass'>> & {
    WebSocketClass: typeof WebSocket;
  };
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPingTime: number | null = null;
  private isIntentionallyClosed = false;

  private metrics: ClientMetrics = {
    reconnectAttempts: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastPingRttMs: null,
    totalEventsSent: 0,
    totalAudioFramesSent: 0,
  };

  constructor(config: HermesClientConfig = {}, eventBus?: HermesEventBus) {
    this.eventBus = eventBus ?? new HermesEventBus();
    const defaultWs = typeof WebSocket !== 'undefined' ? WebSocket : (null as unknown as typeof WebSocket);

    const envUrl =
      typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_HERMES_WS_URL
        ? (import.meta.env.VITE_HERMES_WS_URL as string)
        : undefined;

    this.config = {
      url: config.url ?? envUrl ?? 'ws://localhost:8765/ws',
      sessionId: config.sessionId ?? `sess_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`,
      autoReconnect: config.autoReconnect ?? true,
      minReconnectDelayMs: config.minReconnectDelayMs ?? 500,
      maxReconnectDelayMs: config.maxReconnectDelayMs ?? 8000,
      reconnectMultiplier: config.reconnectMultiplier ?? 1.5,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 15000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 5000,
      WebSocketClass: config.WebSocketClass ?? defaultWs,
    };
  }

  public getUrl(): string {
    return this.config.url;
  }

  public connect(url?: string): void {
    if (url) {
      this.config.url = url;
    }
    this.isIntentionallyClosed = false;
    this.clearTimers();

    if (this.state === 'connected' && this.ws) {
      return;
    }

    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      const WS = this.config.WebSocketClass;
      if (!WS) {
        throw new Error('No WebSocket implementation available.');
      }

      this.ws = new WS(this.config.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
    } catch (err) {
      console.error('[HermesClient] Failed to initialize WebSocket:', err);
      this.setState('error');
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.isIntentionallyClosed = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }
    this.setState('disconnected');
    this.reconnectAttempts = 0;
  }

  public sendEvent(event: HermesClientEvent): void {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
      console.warn('[HermesClient] Cannot send event, socket is not open:', event.type);
      return;
    }

    const payload = JSON.stringify(event);
    this.ws.send(payload);
    this.metrics.totalEventsSent++;
    this.eventBus.emitClientEvent(event);
  }

  public sendAudio(chunk: ArrayBuffer | Uint8Array): void {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
      return;
    }

    this.ws.send(chunk);
    this.metrics.totalAudioFramesSent++;
  }

  public sendPing(): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.lastPingTime = Date.now();
    try {
      this.ws.send(JSON.stringify({ type: 'PING', timestamp: this.lastPingTime }));
    } catch (e) {
      console.error('[HermesClient] Failed to send ping:', e);
    }
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public getSessionId(): string {
    return this.config.sessionId;
  }

  public setSessionId(id: string): void {
    this.config.sessionId = id;
  }

  public getMetrics(): Readonly<ClientMetrics> {
    return { ...this.metrics };
  }

  private handleOpen(): void {
    this.setState('connected');
    this.reconnectAttempts = 0;
    this.metrics.lastConnectedAt = Date.now();

    // Send handshake CLIENT_HELLO with lastSeq for gap resumption
    const lastSeq = this.eventBus.getLastSeenSeq();
    this.sendEvent({
      type: 'CLIENT_HELLO',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      sessionId: this.config.sessionId,
      lastSeq: lastSeq,
      capabilities: ['audio_pcm_16k', 'audio_opus'],
    });

    this.startHeartbeat();
  }

  private handleMessage(ev: MessageEvent): void {
    const data = ev.data;

    // Check for pong heartbeat
    if (typeof data === 'string' && data.includes('"type":"PONG"')) {
      if (this.lastPingTime !== null) {
        this.metrics.lastPingRttMs = Date.now() - this.lastPingTime;
        this.lastPingTime = null;
      }
      if (this.heartbeatTimeoutTimer) {
        clearTimeout(this.heartbeatTimeoutTimer);
        this.heartbeatTimeoutTimer = null;
      }
      return;
    }

    this.eventBus.handleRawMessage(data);
  }

  private handleClose(ev: CloseEvent): void {
    this.metrics.lastDisconnectedAt = Date.now();
    this.stopHeartbeat();
    this.ws = null;

    if (this.isIntentionallyClosed) {
      this.setState('disconnected');
    } else {
      console.warn(`[HermesClient] WebSocket closed (${ev.code}: ${ev.reason}). Scheduling reconnect...`);
      this.setState('reconnecting');
      this.scheduleReconnect();
    }
  }

  private handleError(err: Event): void {
    console.error('[HermesClient] WebSocket error encountered:', err);
    if (!this.ws || this.ws.readyState !== 1) {
      this.setState('error');
    }
  }

  private scheduleReconnect(): void {
    if (!this.config.autoReconnect || this.isIntentionallyClosed) {
      return;
    }

    this.reconnectAttempts++;
    this.metrics.reconnectAttempts++;

    // Exponential backoff with random jitter (0.8 - 1.2)
    const baseDelay = Math.min(
      this.config.minReconnectDelayMs * Math.pow(this.config.reconnectMultiplier, this.reconnectAttempts - 1),
      this.config.maxReconnectDelayMs
    );
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.round(baseDelay * jitter);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      if (!this.isIntentionallyClosed) {
        this.connect();
      }
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.state === 'connected') {
        this.sendPing();
        this.heartbeatTimeoutTimer = setTimeout(() => {
          console.warn('[HermesClient] Heartbeat timeout! Disconnecting to trigger reconnect.');
          if (this.ws) {
            this.ws.close(4000, 'Heartbeat timeout');
          }
        }, this.config.heartbeatTimeoutMs);
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
  }

  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.eventBus.emitConnectionState(newState);
    }
  }
}
