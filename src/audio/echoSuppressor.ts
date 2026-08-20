export class EchoSuppressor {
  private isTtsPlaying = false;
  private echoGracePeriodMs: number;
  private lastTtsEndTime: number = 0;
  private enabled: boolean = true;

  constructor(options: { echoGracePeriodMs?: number; enabled?: boolean } = {}) {
    this.echoGracePeriodMs = options.echoGracePeriodMs ?? 300;
    this.enabled = options.enabled ?? true;
  }

  public setTtsPlaying(playing: boolean): void {
    if (this.isTtsPlaying && !playing) {
      this.lastTtsEndTime = Date.now();
    }
    this.isTtsPlaying = playing;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEchoSuppressed(): boolean {
    if (!this.enabled) {
      return false;
    }

    if (this.isTtsPlaying) {
      return true;
    }

    const elapsedSinceTtsEnd = Date.now() - this.lastTtsEndTime;
    return elapsedSinceTtsEnd < this.echoGracePeriodMs;
  }

  public shouldSuppressAudioInput(energyLevel: number, bargeInThreshold = 0.65): boolean {
    if (!this.isEchoSuppressed()) {
      return false;
    }
    // If energy exceeds intentional barge-in threshold, allow barge-in through
    return energyLevel < bargeInThreshold;
  }
}
