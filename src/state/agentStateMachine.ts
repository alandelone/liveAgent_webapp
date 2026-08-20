import { AgentRoleState } from '../types/protocol';
import { HermesEventBus } from '../protocol/eventBus';

export interface StateMachineSnapshot {
  mainState: AgentRoleState;
  detail?: string;
  currentTurnId: string | null;
  isListening: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  isExecuting: boolean;
  isOptimistic: boolean;
  lastStateChangeTimestamp: number;
}

export type StateMachineListener = (snapshot: StateMachineSnapshot) => void;

export class AgentStateMachine {
  private mainState: AgentRoleState = 'idle';
  private detail?: string;
  private currentTurnId: string | null = null;
  private isOptimistic = false;
  private lastStateChangeTimestamp: number = Date.now();
  private listeners: Set<StateMachineListener> = new Set();
  private unsubscribers: Array<() => void> = [];

  constructor(eventBus?: HermesEventBus) {
    if (eventBus) {
      this.attach(eventBus);
    }
  }

  public attach(eventBus: HermesEventBus): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];

    // Reconcile with authoritative AGENT_STATE from Hermes
    const u1 = eventBus.on('AGENT_STATE', (ev) => {
      if (ev.agentId === 'hermes' || !ev.agentId) {
        this.reconcileState(ev.state, ev.detail);
      }
    });

    // When Hermes starts speaking via TTS
    const u2 = eventBus.on('TTS_START', (ev) => {
      if (ev.agentId === 'hermes' || !ev.agentId) {
        this.currentTurnId = ev.turnId;
        this.reconcileState('speaking');
      }
    });

    // When TTS ends
    const u3 = eventBus.on('TTS_END', () => {
      if (this.mainState === 'speaking') {
        this.reconcileState('idle');
      }
    });

    // When STT final arrives
    const u4 = eventBus.on('STT_FINAL', (ev) => {
      this.currentTurnId = ev.turnId;
      if (this.mainState === 'listening') {
        this.reconcileState('thinking');
      }
    });

    this.unsubscribers.push(u1, u2, u3, u4);
  }

  /**
   * Optimistically predict state transition from local UI actions (e.g. mic tap)
   */
  public predictState(newState: AgentRoleState, detail?: string): void {
    this.mainState = newState;
    this.detail = detail;
    this.isOptimistic = true;
    this.lastStateChangeTimestamp = Date.now();
    this.notify();
  }

  /**
   * Reconcile local state with authoritative Hermes event
   */
  public reconcileState(authoritativeState: AgentRoleState, detail?: string): void {
    this.mainState = authoritativeState;
    this.detail = detail;
    this.isOptimistic = false;
    this.lastStateChangeTimestamp = Date.now();
    this.notify();
  }

  public setTurnId(turnId: string | null): void {
    this.currentTurnId = turnId;
    this.notify();
  }

  public getSnapshot(): StateMachineSnapshot {
    return {
      mainState: this.mainState,
      detail: this.detail,
      currentTurnId: this.currentTurnId,
      isListening: this.mainState === 'listening',
      isSpeaking: this.mainState === 'speaking',
      isThinking: this.mainState === 'thinking' || this.mainState === 'delegating',
      isExecuting: this.mainState === 'executing',
      isOptimistic: this.isOptimistic,
      lastStateChangeTimestamp: this.lastStateChangeTimestamp,
    };
  }

  public subscribe(listener: StateMachineListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reset(): void {
    this.mainState = 'idle';
    this.detail = undefined;
    this.currentTurnId = null;
    this.isOptimistic = false;
    this.lastStateChangeTimestamp = Date.now();
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[AgentStateMachine] Error in listener:', err);
      }
    });
  }
}
