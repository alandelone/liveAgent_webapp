import { AgentDescriptor, AgentManifestEvent } from '../types/protocol';
import { HermesEventBus } from '../protocol/eventBus';

export type ManifestListener = (agents: AgentDescriptor[]) => void;

export class ManifestStore {
  private agents: Map<string, AgentDescriptor> = new Map();
  private listeners: Set<ManifestListener> = new Set();
  private unsubscriber: (() => void) | null = null;

  constructor(eventBus?: HermesEventBus) {
    if (eventBus) {
      this.attach(eventBus);
    }
  }

  public attach(eventBus: HermesEventBus): void {
    if (this.unsubscriber) {
      this.unsubscriber();
    }
    this.unsubscriber = eventBus.on('AGENT_MANIFEST', (event: AgentManifestEvent) => {
      this.setManifest(event.agents);
    });
  }

  public setManifest(agentsList: AgentDescriptor[]): void {
    this.agents.clear();
    agentsList.forEach((agent) => {
      this.agents.set(agent.id, agent);
    });
    this.notify();
  }

  public getAgents(): AgentDescriptor[] {
    return Array.from(this.agents.values());
  }

  public getAgentById(id: string): AgentDescriptor | undefined {
    return this.agents.get(id);
  }

  public getOrchestrator(): AgentDescriptor | undefined {
    return this.getAgents().find((a) => a.isOrchestrator || a.id === 'hermes');
  }

  public getSideAgents(): AgentDescriptor[] {
    const orchestrator = this.getOrchestrator();
    return this.getAgents().filter((a) => a.id !== orchestrator?.id);
  }

  public subscribe(listener: ManifestListener): () => void {
    this.listeners.add(listener);
    listener(this.getAgents());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public clear(): void {
    this.agents.clear();
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getAgents();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[ManifestStore] Error in listener:', err);
      }
    });
  }
}
