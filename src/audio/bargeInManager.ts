import { HermesClient } from '../protocol/HermesClient';
import { AgentStateMachine } from '../state/agentStateMachine';
import { AudioPlaybackQueue } from './audioPlaybackQueue';

export interface BargeInMetrics {
  totalInterruptions: number;
  lastInterruptionTimestamp: number | null;
}

export class BargeInManager {
  private totalInterruptions = 0;
  private lastInterruptionTimestamp: number | null = null;
  private onInterruptionListeners: Set<() => void> = new Set();

  constructor(
    private client: HermesClient,
    private stateMachine: AgentStateMachine,
    private playbackQueue: AudioPlaybackQueue
  ) {}

  /**
   * Trigger voice barge-in / interruption
   */
  public triggerInterruption(): void {
    const snap = this.stateMachine.getSnapshot();

    // 1. Immediately stop TTS audio playback queue
    this.playbackQueue.stop();

    // 2. Send USER_INTERRUPT to Hermes
    this.client.sendEvent({
      type: 'USER_INTERRUPT',
      sessionId: this.client.getSessionId(),
      turnId: snap.currentTurnId ?? `turn_${Date.now()}`,
    });

    // 3. Update state machine optimistically to interrupted -> listening
    this.stateMachine.predictState('interrupted', 'Interrupted by user speech');

    // 4. Update metrics
    this.totalInterruptions++;
    this.lastInterruptionTimestamp = Date.now();

    // Notify listeners
    this.onInterruptionListeners.forEach((l) => l());

    // Switch to listening turn after a brief 50ms pause
    setTimeout(() => {
      this.stateMachine.predictState('listening', 'Listening for new prompt');
    }, 50);
  }

  public getMetrics(): BargeInMetrics {
    return {
      totalInterruptions: this.totalInterruptions,
      lastInterruptionTimestamp: this.lastInterruptionTimestamp,
    };
  }

  public onInterruption(listener: () => void): () => void {
    this.onInterruptionListeners.add(listener);
    return () => this.onInterruptionListeners.delete(listener);
  }
}
