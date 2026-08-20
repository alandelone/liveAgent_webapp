import { AgentDescriptor, AgentRoleState } from '../types/protocol';
import { HermesEventBus } from '../protocol/eventBus';
import { ManifestStore } from './manifestStore';

export interface ActiveSatelliteState {
  agent: AgentDescriptor;
  state: AgentRoleState;
  detail?: string;
  lastActiveTimestamp: number;
  isDormant: boolean;
}

export interface DelegationBeam {
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  taskName: string;
  startedAt: number;
}

export interface ConstellationSnapshot {
  orchestrator: AgentDescriptor | null;
  orchestratorState: AgentRoleState;
  orchestratorDetail?: string;
  activeSatellites: ActiveSatelliteState[];
  dormantSatellites: ActiveSatelliteState[];
  delegationBeams: DelegationBeam[];
}

export type ConstellationListener = (snapshot: ConstellationSnapshot) => void;

export class ConstellationStore {
  private orchestratorState: AgentRoleState = 'idle';
  private orchestratorDetail?: string;
  private agentStates: Map<string, { state: AgentRoleState; detail?: string; lastActive: number }> = new Map();
  private beams: Map<string, DelegationBeam> = new Map();
  private listeners: Set<ConstellationListener> = new Set();
  private unsubscribers: Array<() => void> = [];
  private dormantTimeoutMs: number;

  constructor(
    private manifestStore: ManifestStore,
    eventBus?: HermesEventBus,
    options: { dormantTimeoutMs?: number } = {}
  ) {
    this.dormantTimeoutMs = options.dormantTimeoutMs ?? 5000;
    this.manifestStore.subscribe(() => this.notify());

    if (eventBus) {
      this.attach(eventBus);
    }
  }

  public attach(eventBus: HermesEventBus): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];

    const u1 = eventBus.on('AGENT_STATE', (ev) => {
      const orchestrator = this.manifestStore.getOrchestrator();
      if (orchestrator && ev.agentId === orchestrator.id) {
        this.orchestratorState = ev.state;
        this.orchestratorDetail = ev.detail;
      } else {
        this.agentStates.set(ev.agentId, {
          state: ev.state,
          detail: ev.detail,
          lastActive: Date.now(),
        });
      }
      this.notify();
    });

    const u2 = eventBus.on('TASK_START', (ev) => {
      this.beams.set(ev.taskId, {
        taskId: ev.taskId,
        fromAgentId: ev.fromAgentId,
        toAgentId: ev.toAgentId,
        taskName: ev.taskName,
        startedAt: Date.now(),
      });
      // Mark target agent as active
      const current = this.agentStates.get(ev.toAgentId);
      this.agentStates.set(ev.toAgentId, {
        state: current?.state ?? 'delegated',
        detail: ev.taskName,
        lastActive: Date.now(),
      });
      this.notify();
    });

    const u3 = eventBus.on('TASK_PROGRESS', (ev) => {
      this.agentStates.set(ev.agentId, {
        state: 'executing',
        detail: ev.log,
        lastActive: Date.now(),
      });
      this.notify();
    });

    const u4 = eventBus.on('TASK_COMPLETE', (ev) => {
      this.beams.delete(ev.taskId);
      const current = this.agentStates.get(ev.agentId);
      if (current) {
        this.agentStates.set(ev.agentId, {
          state: 'idle',
          detail: ev.resultSummary,
          lastActive: Date.now(),
        });
      }
      this.notify();
    });

    this.unsubscribers.push(u1, u2, u3, u4);
  }

  public getSnapshot(): ConstellationSnapshot {
    const orchestrator = this.manifestStore.getOrchestrator() || null;
    const sideAgents = this.manifestStore.getSideAgents();
    const now = Date.now();

    const activeSatellites: ActiveSatelliteState[] = [];
    const dormantSatellites: ActiveSatelliteState[] = [];

    sideAgents.forEach((agent) => {
      const stateInfo = this.agentStates.get(agent.id) || {
        state: 'idle' as AgentRoleState,
        detail: undefined,
        lastActive: 0,
      };

      const hasActiveBeam = Array.from(this.beams.values()).some((b) => b.toAgentId === agent.id);
      const isWorking = stateInfo.state !== 'idle' && stateInfo.state !== 'completed';
      const recentlyActive = now - stateInfo.lastActive < this.dormantTimeoutMs && stateInfo.lastActive > 0;

      const isActive = hasActiveBeam || isWorking || recentlyActive;

      const satelliteState: ActiveSatelliteState = {
        agent,
        state: stateInfo.state,
        detail: stateInfo.detail,
        lastActiveTimestamp: stateInfo.lastActive,
        isDormant: !isActive,
      };

      if (isActive) {
        activeSatellites.push(satelliteState);
      } else {
        dormantSatellites.push(satelliteState);
      }
    });

    return {
      orchestrator,
      orchestratorState: this.orchestratorState,
      orchestratorDetail: this.orchestratorDetail,
      activeSatellites,
      dormantSatellites,
      delegationBeams: Array.from(this.beams.values()),
    };
  }

  public subscribe(listener: ConstellationListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reset(): void {
    this.orchestratorState = 'idle';
    this.orchestratorDetail = undefined;
    this.agentStates.clear();
    this.beams.clear();
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[ConstellationStore] Error in listener:', err);
      }
    });
  }
}
