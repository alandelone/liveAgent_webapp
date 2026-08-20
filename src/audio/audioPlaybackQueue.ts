export interface AudioPlaybackMetrics {
  chunksPlayed: number;
  totalBytesPlayed: number;
  isPlaying: boolean;
  bufferedChunks: number;
}

export class AudioPlaybackQueue {
  private queue: Uint8Array[] = [];
  private isPlaying = false;
  private isProcessing = false;
  private chunksPlayed = 0;
  private totalBytesPlayed = 0;
  private volume = 0;
  private onVolumeChangeListeners: Set<(volume: number) => void> = new Set();
  private onPlaybackStateChangeListeners: Set<(isPlaying: boolean) => void> = new Set();

  public enqueueChunk(chunk: ArrayBuffer | Uint8Array): void {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    this.queue.push(bytes);
    this.processQueue();
  }

  public stop(): void {
    this.queue = [];
    this.isPlaying = false;
    this.isProcessing = false;
    this.volume = 0;
    this.notifyVolume(0);
    this.notifyState(false);
  }

  public flush(): void {
    this.stop();
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentVolume(): number {
    return this.volume;
  }

  public getMetrics(): AudioPlaybackMetrics {
    return {
      chunksPlayed: this.chunksPlayed,
      totalBytesPlayed: this.totalBytesPlayed,
      isPlaying: this.isPlaying,
      bufferedChunks: this.queue.length,
    };
  }

  public onVolumeChange(listener: (volume: number) => void): () => void {
    this.onVolumeChangeListeners.add(listener);
    return () => this.onVolumeChangeListeners.delete(listener);
  }

  public onPlaybackStateChange(listener: (isPlaying: boolean) => void): () => void {
    this.onPlaybackStateChangeListeners.add(listener);
    return () => this.onPlaybackStateChangeListeners.delete(listener);
  }

  private processQueue(): void {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.notifyState(true);
    }

    const chunk = this.queue.shift();
    if (!chunk) {
      this.isProcessing = false;
      return;
    }

    // Calculate approximate RMS volume from PCM chunk for visualizer
    this.volume = this.calculateRms(chunk);
    this.notifyVolume(this.volume);

    this.chunksPlayed++;
    this.totalBytesPlayed += chunk.byteLength;

    // Simulate audio playback timing or play via AudioContext
    // In headless/test or browser without blocking UI thread:
    const simulatedDurationMs = Math.max(10, Math.min(100, Math.round(chunk.byteLength / 32))); // 16kHz 16-bit mono is ~32 bytes/ms

    setTimeout(() => {
      if (!this.isPlaying) {
        this.isProcessing = false;
        return;
      }

      this.isProcessing = false;
      if (this.queue.length > 0) {
        this.processQueue();
      } else {
        this.isPlaying = false;
        this.volume = 0;
        this.notifyVolume(0);
        this.notifyState(false);
      }
    }, simulatedDurationMs);
  }

  private calculateRms(chunk: Uint8Array): number {
    if (chunk.length === 0) return 0;
    let sum = 0;
    // Interpret as 16-bit PCM samples
    const sampleCount = Math.floor(chunk.length / 2);
    if (sampleCount === 0) return 0;

    const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let i = 0; i < sampleCount; i++) {
      const sample = dataView.getInt16(i * 2, true) / 32768.0;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / sampleCount);
    return Math.min(1.0, rms * 3.0); // Boosted normalized 0..1 range
  }

  private notifyVolume(vol: number): void {
    this.onVolumeChangeListeners.forEach((l) => l(vol));
  }

  private notifyState(playing: boolean): void {
    this.onPlaybackStateChangeListeners.forEach((l) => l(playing));
  }
}
