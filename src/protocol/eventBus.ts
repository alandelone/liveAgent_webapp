import {
  HermesServerEvent,
  HermesClientEvent,
  ConnectionState,
} from '../types/protocol';
import { parseIncomingServerEvent } from './schemas';

export type EventBusListener<T> = (data: T) => void;

export interface SeqGapInfo {
  expected: number;
  received: number;
}

export class HermesEventBus {
  private listeners: Map<string, Set<EventBusListener<any>>> = new Map();
  private audioListeners: Set<EventBusListener<ArrayBuffer | Uint8Array>> = new Set();
  private lastSeenSeq: number | null = null;
  private missedSeqCount: number = 0;

  /**
   * Subscribe to a specific Hermes server event type or special event
   */
  public on<K extends HermesServerEvent['type']>(
    type: K,
    listener: EventBusListener<Extract<HermesServerEvent, { type: K }>>
  ): () => void;
  public on(type: 'all', listener: EventBusListener<HermesServerEvent>): () => void;
  public on(type: 'client_event', listener: EventBusListener<HermesClientEvent>): () => void;
  public on(type: 'connection_state', listener: EventBusListener<ConnectionState>): () => void;
  public on(type: 'seq_gap', listener: EventBusListener<SeqGapInfo>): () => void;
  public on(type: 'unknown_event', listener: EventBusListener<Record<string, unknown>>): () => void;
  public on(type: 'parse_error', listener: EventBusListener<{ raw: unknown; error: unknown }>): () => void;
  public on(type: string, listener: EventBusListener<any>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => this.off(type, listener);
  }

  public off(type: string, listener: EventBusListener<any>): void {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(type);
      }
    }
  }

  /**
   * Subscribe to binary audio chunks
   */
  public onAudio(listener: EventBusListener<ArrayBuffer | Uint8Array>): () => void {
    this.audioListeners.add(listener);
    return () => {
      this.audioListeners.delete(listener);
    };
  }

  /**
   * Emit binary audio frame
   */
  public emitAudio(chunk: ArrayBuffer | Uint8Array): void {
    this.audioListeners.forEach((listener) => {
      try {
        listener(chunk);
      } catch (err) {
        console.error('[EventBus] Error in audio listener:', err);
      }
    });
  }

  /**
   * Emit a client-originated event
   */
  public emitClientEvent(event: HermesClientEvent): void {
    this.emitInternal('client_event', event);
  }

  /**
   * Emit a server event directly
   */
  public emitServerEvent(event: HermesServerEvent): void {
    this.emitInternal(event.type, event);
    this.emitInternal('all', event);
  }

  /**
   * Process raw message received from WebSocket
   */
  public handleRawMessage(raw: unknown): void {
    if (raw instanceof ArrayBuffer || raw instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw))) {
      this.emitAudio(raw as ArrayBuffer | Uint8Array);
      return;
    }

    let parsedPayload: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsedPayload = JSON.parse(raw);
      } catch (err) {
        this.emitInternal('parse_error', { raw, error: err });
        return;
      }
    }

    const parsed = parseIncomingServerEvent(parsedPayload);
    if (!parsed.success) {
      if ('isUnknownType' in parsed && parsed.isUnknownType) {
        // Forward compatibility: unknown event types are passed to unknown_event listeners without crashing
        console.warn(`[EventBus] Received unknown event type "${parsed.eventType}", ignoring for forward compatibility`);
        this.emitInternal('unknown_event', parsedPayload as Record<string, unknown>);
        return;
      }
      this.emitInternal('parse_error', { raw: parsedPayload, error: parsed.error });
      return;
    }

    const event = parsed.data;

    // Sequence tracking & gap detection
    if ('seq' in event && typeof event.seq === 'number') {
      if (this.lastSeenSeq !== null) {
        if (event.seq > this.lastSeenSeq + 1) {
          const gap: SeqGapInfo = {
            expected: this.lastSeenSeq + 1,
            received: event.seq,
          };
          this.missedSeqCount += (event.seq - this.lastSeenSeq - 1);
          console.warn(`[EventBus] Sequence gap detected: expected seq ${gap.expected}, received ${gap.received}`);
          this.emitInternal('seq_gap', gap);
        }
      }
      this.lastSeenSeq = Math.max(this.lastSeenSeq ?? 0, event.seq);
    }

    // Emit typed event & catch-all 'all'
    this.emitInternal(event.type, event);
    this.emitInternal('all', event);
  }

  public emitConnectionState(state: ConnectionState): void {
    this.emitInternal('connection_state', state);
  }

  public getLastSeenSeq(): number | null {
    return this.lastSeenSeq;
  }

  public getMissedSeqCount(): number {
    return this.missedSeqCount;
  }

  public setLastSeenSeq(seq: number | null): void {
    this.lastSeenSeq = seq;
  }

  public reset(): void {
    this.lastSeenSeq = null;
    this.missedSeqCount = 0;
  }

  private emitInternal(type: string, data: any): void {
    const set = this.listeners.get(type);
    if (set) {
      set.forEach((listener) => {
        try {
          listener(data);
        } catch (err) {
          console.error(`[EventBus] Error in listener for "${type}":`, err);
        }
      });
    }
  }
}
