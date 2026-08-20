import { HermesEventBus } from '../protocol/eventBus';
import { RecordedTraceEntry } from './sessionRecorder';

export interface ReplayerOptions {
  speedMultiplier?: number;
  instant?: boolean;
}

export class SessionReplayer {
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private isPlaying = false;

  constructor(private eventBus: HermesEventBus) {}

  public static parseJsonl(jsonlString: string): RecordedTraceEntry[] {
    return jsonlString
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as RecordedTraceEntry);
  }

  public async play(
    entries: RecordedTraceEntry[],
    options: ReplayerOptions = {}
  ): Promise<void> {
    this.stop();
    this.isPlaying = true;

    const speed = options.speedMultiplier ?? 1.0;
    const instant = options.instant ?? false;

    if (instant) {
      entries.forEach((entry) => {
        if (entry.direction === 'inbound') {
          this.eventBus.handleRawMessage(entry.payload);
        } else {
          this.eventBus.emitClientEvent(entry.payload as any);
        }
      });
      this.isPlaying = false;
      return;
    }

    return new Promise((resolve) => {
      let completedCount = 0;
      if (entries.length === 0) {
        this.isPlaying = false;
        resolve();
        return;
      }

      entries.forEach((entry, index) => {
        const delay = Math.round(entry.relativeTimeMs / speed);
        const timer = setTimeout(() => {
          if (!this.isPlaying) return;

          if (entry.direction === 'inbound') {
            this.eventBus.handleRawMessage(entry.payload);
          } else {
            this.eventBus.emitClientEvent(entry.payload as any);
          }

          completedCount++;
          if (completedCount === entries.length || index === entries.length - 1) {
            this.isPlaying = false;
            resolve();
          }
        }, delay);

        this.timers.push(timer);
      });
    });
  }

  public stop(): void {
    this.isPlaying = false;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
