import { AgentDescriptor } from "../types/protocol";
import { HermesClient } from "../protocol/HermesClient";
import { ManifestStore } from "./manifestStore";

export interface ModeSnapshot {
  isDirectMode: boolean;
  targetAgentId: string | null;
  targetAgent: AgentDescriptor | null;
}

export type ModeListener = (snapshot: ModeSnapshot) => void;

export class ModeStore {
  private targetAgentId: string | null = null;
  private listeners: Set<ModeListener> = new Set();

  constructor(
    private client: HermesClient,
    private manifestStore: ManifestStore,
  ) {
    this.manifestStore.subscribe(() => this.notify());
  }

  public setTargetAgent(agentId: string | null): void {
    const orchestratorId = this.manifestStore.getOrchestrator()?.id;
    if (!agentId || agentId === orchestratorId) {
      this.clearTargetAgent();
      return;
    }

    this.targetAgentId = agentId;
    this.client.sendEvent({
      type: "USER_TARGET",
      sessionId: this.client.getSessionId(),
      targetAgentId: agentId,
    });
    this.notify();
  }

  public clearTargetAgent(): void {
    this.targetAgentId = null;
    const orchestrator = this.manifestStore.getOrchestrator();
    if (!orchestrator) {
      throw new Error(
        "Cannot clear direct mode without an orchestrator manifest entry",
      );
    }
    this.client.sendEvent({
      type: "USER_TARGET",
      sessionId: this.client.getSessionId(),
      targetAgentId: orchestrator.id,
    });
    this.notify();
  }

  public getSnapshot(): ModeSnapshot {
    const isDirectMode =
      this.targetAgentId !== null &&
      this.targetAgentId !== this.manifestStore.getOrchestrator()?.id;
    const targetAgent = this.targetAgentId
      ? (this.manifestStore.getAgentById(this.targetAgentId) ?? null)
      : null;

    return {
      isDirectMode,
      targetAgentId: this.targetAgentId,
      targetAgent,
    };
  }

  public subscribe(listener: ModeListener): () => void {
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
      } catch (err) {
        console.error("[ModeStore] Error in listener:", err);
      }
    });
  }
}
