import { HermesEventBus } from '../protocol/eventBus';
import { ArtifactEvent, ErrorEvent } from '../types/protocol';

export interface AgentTextResponse {
  agentId: string;
  text: string;
  isFinal: boolean;
}

export interface TranscriptTurn {
  turnId: string;
  userText?: string;
  isPartialUserText?: boolean;
  agentResponses: AgentTextResponse[];
  artifacts: ArtifactEvent[];
  error?: ErrorEvent;
  timestamp: number;
}

export type TranscriptListener = (turns: TranscriptTurn[]) => void;

export class TranscriptStore {
  private turns: Map<string, TranscriptTurn> = new Map();
  private turnOrder: string[] = [];
  private listeners: Set<TranscriptListener> = new Set();
  private unsubscribers: Array<() => void> = [];

  constructor(eventBus?: HermesEventBus) {
    if (eventBus) {
      this.attach(eventBus);
    }
  }

  public attach(eventBus: HermesEventBus): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];

    const u1 = eventBus.on('client_event', (ev) => {
      if (ev.type === 'USER_TEXT') {
        this.ensureTurn(ev.turnId);
        const turn = this.turns.get(ev.turnId)!;
        turn.userText = ev.text;
        turn.isPartialUserText = false;
        this.notify();
      }
    });

    const u2 = eventBus.on('STT_PARTIAL', (ev) => {
      this.ensureTurn(ev.turnId);
      const turn = this.turns.get(ev.turnId)!;
      turn.userText = ev.text;
      turn.isPartialUserText = true;
      this.notify();
    });

    const u3 = eventBus.on('STT_FINAL', (ev) => {
      this.ensureTurn(ev.turnId);
      const turn = this.turns.get(ev.turnId)!;
      turn.userText = ev.text;
      turn.isPartialUserText = false;
      this.notify();
    });

    const u4 = eventBus.on('TEXT_DELTA', (ev) => {
      this.ensureTurn(ev.turnId);
      const turn = this.turns.get(ev.turnId)!;
      let resp = turn.agentResponses.find((r) => r.agentId === ev.agentId);
      if (!resp) {
        resp = { agentId: ev.agentId, text: '', isFinal: false };
        turn.agentResponses.push(resp);
      }
      resp.text += ev.delta;
      resp.isFinal = ev.isFinal;
      this.notify();
    });

    const u5 = eventBus.on('ARTIFACT', (ev) => {
      // Attach artifact to latest turn or match turn
      const currentTurnId = this.turnOrder[this.turnOrder.length - 1];
      if (currentTurnId) {
        const turn = this.turns.get(currentTurnId)!;
        turn.artifacts.push(ev);
        this.notify();
      }
    });

    const u6 = eventBus.on('ERROR', (ev) => {
      const currentTurnId = this.turnOrder[this.turnOrder.length - 1];
      if (currentTurnId) {
        const turn = this.turns.get(currentTurnId)!;
        turn.error = ev;
        this.notify();
      }
    });

    this.unsubscribers.push(u1, u2, u3, u4, u5, u6);
  }

  public getTurns(): TranscriptTurn[] {
    return this.turnOrder.map((id) => this.turns.get(id)!).filter(Boolean);
  }

  public clear(): void {
    this.turns.clear();
    this.turnOrder = [];
    this.notify();
  }

  public subscribe(listener: TranscriptListener): () => void {
    this.listeners.add(listener);
    listener(this.getTurns());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureTurn(turnId: string): void {
    if (!this.turns.has(turnId)) {
      this.turns.set(turnId, {
        turnId,
        agentResponses: [],
        artifacts: [],
        timestamp: Date.now(),
      });
      this.turnOrder.push(turnId);
    }
  }

  private notify(): void {
    const list = this.getTurns();
    this.listeners.forEach((listener) => {
      try {
        listener(list);
      } catch (err) {
        console.error('[TranscriptStore] Error in listener:', err);
      }
    });
  }
}
