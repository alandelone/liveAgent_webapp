import { HermesEventBus } from '../protocol/eventBus';
import { HermesProtocolEvent } from '../types/protocol';

export interface RecordedTraceEntry {
  recordedAt: number;
  relativeTimeMs: number;
  direction: 'inbound' | 'outbound';
  payload: HermesProtocolEvent | Record<string, unknown>;
}

export class SessionRecorder {
  private startTime: number | null = null;
  private entries: RecordedTraceEntry[] = [];
  private unsubscribers: Array<() => void> = [];
  private isRecording = false;

  constructor(private eventBus?: HermesEventBus) {}

  public startRecording(eventBus?: HermesEventBus): void {
    if (eventBus) {
      this.eventBus = eventBus;
    }
    if (!this.eventBus) {
      throw new Error('Cannot start recording: No EventBus provided');
    }

    this.stopRecording();
    this.entries = [];
    this.startTime = Date.now();
    this.isRecording = true;

    // Record server events (inbound)
    const unsubServer = this.eventBus.on('all', (event) => {
      if (!this.isRecording || !this.startTime) return;
      this.entries.push({
        recordedAt: Date.now(),
        relativeTimeMs: Date.now() - this.startTime,
        direction: 'inbound',
        payload: event,
      });
    });

    // Record client events (outbound)
    const unsubClient = this.eventBus.on('client_event', (event) => {
      if (!this.isRecording || !this.startTime) return;
      this.entries.push({
        recordedAt: Date.now(),
        relativeTimeMs: Date.now() - this.startTime,
        direction: 'outbound',
        payload: event,
      });
    });

    this.unsubscribers.push(unsubServer, unsubClient);
  }

  public stopRecording(): RecordedTraceEntry[] {
    this.isRecording = false;
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
    return [...this.entries];
  }

  public exportToJsonl(): string {
    return this.entries.map((entry) => JSON.stringify(entry)).join('\n');
  }

  public getEntries(): ReadonlyArray<RecordedTraceEntry> {
    return this.entries;
  }
}
