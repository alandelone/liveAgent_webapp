import { ConnectionState } from '../types/protocol';
import { HermesEventBus, SeqGapInfo } from '../protocol/eventBus';

export interface ConnectionSnapshot {
  state: ConnectionState;
  sessionId: string;
  lastSeenSeq: number | null;
  missedSeqCount: number;
  lastGap: SeqGapInfo | null;
}

export type ConnectionListener = (snapshot: ConnectionSnapshot) => void;

export class ConnectionStore {
  private state: ConnectionState = 'disconnected';
  private sessionId = '';
  private lastGap: SeqGapInfo | null = null;
  private listeners: Set<ConnectionListener> = new Set();
  private unsubscribers: Array<() => void> = [];

  constructor(private eventBus?: HermesEventBus, initialSessionId = '') {
    this.sessionId = initialSessionId;
    if (eventBus) {
      this.attach(eventBus);
    }
  }

  public attach(eventBus: HermesEventBus): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];

    const u1 = eventBus.on('connection_state', (state) => {
      this.state = state;
      this.notify();
    });

    const u2 = eventBus.on('seq_gap', (gap) => {
      this.lastGap = gap;
      this.notify();
    });

    this.unsubscribers.push(u1, u2);
  }

  public setSessionId(id: string): void {
    this.sessionId = id;
    this.notify();
  }

  public getSnapshot(): ConnectionSnapshot {
    return {
      state: this.state,
      sessionId: this.sessionId,
      lastSeenSeq: this.eventBus ? this.eventBus.getLastSeenSeq() : null,
      missedSeqCount: this.eventBus ? this.eventBus.getMissedSeqCount() : 0,
      lastGap: this.lastGap,
    };
  }

  public subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snap);
      } catch (e) {
        console.error('[ConnectionStore] Error in listener:', e);
      }
    });
  }
}
