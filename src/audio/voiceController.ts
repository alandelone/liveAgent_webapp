import { HermesClient } from "../protocol/HermesClient";
import { AgentStateMachine } from "../state/agentStateMachine";
import { AudioPlaybackQueue, PlaybackBackend } from "./audioPlaybackQueue";
import { EchoSuppressor } from "./echoSuppressor";
import { BargeInManager } from "./bargeInManager";
import { AppliedAudioSettings, PcmCapture } from "./pcmCapture";

export interface VoiceControllerConfig {
  pushToTalkDefault?: boolean;
  playbackBackend?: PlaybackBackend;
}

export interface AcousticInterruptionMetrics {
  totalAuthoritativeInterruptions: number;
  lastStopLatencyMs: number | null;
}

export const acousticInputMode = (settings: Readonly<Record<string, boolean | number | string>>): "hands_free" | "push_to_talk" =>
  settings.echoCancellation === true ? "hands_free" : "push_to_talk";

export class VoiceController {
  public readonly playbackQueue: AudioPlaybackQueue;
  public readonly echoSuppressor: EchoSuppressor;
  public readonly bargeInManager: BargeInManager;
  public readonly pcmCapture: PcmCapture;
  private isPttMode: boolean;
  private isPttActive = false;
  private currentMicVolume = 0;
  private micVolumeListeners = new Set<(volume: number) => void>();
  private pushToTalkModeListeners = new Set<(enabled: boolean) => void>();
  private appliedAudioSettingsListeners = new Set<(settings: Readonly<AppliedAudioSettings>) => void>();
  private acousticInterruptionListeners = new Set<(metrics: AcousticInterruptionMetrics) => void>();
  private authoritativeSpeechStartAt: number | null = null;
  private acousticInterruptionMetrics: AcousticInterruptionMetrics = {
    totalAuthoritativeInterruptions: 0,
    lastStopLatencyMs: null,
  };
  private unsubscribers: Array<() => void> = [];

  constructor(
    public readonly client: HermesClient,
    public readonly stateMachine: AgentStateMachine,
    config: VoiceControllerConfig = {},
  ) {
    this.playbackQueue = new AudioPlaybackQueue(config.playbackBackend);
    this.echoSuppressor = new EchoSuppressor();
    this.bargeInManager = new BargeInManager(this.client, this.stateMachine, this.playbackQueue);
    this.pcmCapture = new PcmCapture(client);
    this.isPttMode = config.pushToTalkDefault ?? true;
    this.attach();
  }

  private attach(): void {
    if (this.unsubscribers.length > 0) return;
    this.unsubscribers.push(
      this.client.eventBus.on("TTS_START", (event) => this.playbackQueue.startStream(event)),
      this.client.eventBus.onAudio((chunk) => this.playbackQueue.enqueueChunk(chunk)),
      this.client.eventBus.on("USER_SPEECH_START", () => {
        if (this.playbackQueue.getIsPlaying()) {
          this.authoritativeSpeechStartAt = this.now();
        }
      }),
      this.client.eventBus.on("TTS_END", (event) => {
        this.playbackQueue.endStream(event);
        if (event.outcome === "INTERRUPTED" && this.authoritativeSpeechStartAt !== null) {
          this.acousticInterruptionMetrics = {
            totalAuthoritativeInterruptions:
              this.acousticInterruptionMetrics.totalAuthoritativeInterruptions + 1,
            lastStopLatencyMs: Math.max(0, this.now() - this.authoritativeSpeechStartAt),
          };
          this.authoritativeSpeechStartAt = null;
          this.acousticInterruptionListeners.forEach((listener) =>
            listener(this.getAcousticInterruptionMetrics()),
          );
        }
        if (event.outcome === "COMPLETED" && this.playbackQueue.getIsPlaying()) {
          this.stateMachine.predictState("speaking", "Draining synthesized audio");
        }
      }),
      this.playbackQueue.onPlaybackStateChange((isPlaying) => {
        this.echoSuppressor.setTtsPlaying(isPlaying);
        const snapshot = this.stateMachine.getSnapshot();
        if (isPlaying && !snapshot.isSpeaking) {
          this.stateMachine.predictState("speaking", "Playing synthesized audio");
        } else if (!isPlaying && snapshot.isSpeaking) {
          this.stateMachine.predictState("idle", "Voice playback complete");
        }
      }),
      this.playbackQueue.onPlaybackError((message) => {
        this.stateMachine.predictState("error", `${message}; response remains available as text`);
      }),
      this.pcmCapture.onAppliedAudioSettingsChange((settings) => {
        this.appliedAudioSettingsListeners.forEach((listener) => listener(settings));
      }),
      this.pcmCapture.onVolumeChange((volume) => {
        this.currentMicVolume = volume;
        this.micVolumeListeners.forEach((listener) => listener(volume));
      }),
    );
  }

  public activate(): void {
    this.attach();
  }

  public startListening(): void {
    void this.playbackQueue.prepare().catch(() => undefined);
    const snapshot = this.stateMachine.getSnapshot();
    if (snapshot.isSpeaking || this.playbackQueue.getIsPlaying()) {
      this.bargeInManager.triggerInterruption();
      return;
    }
    this.stateMachine.setTurnId(null);
    this.stateMachine.predictState("listening", "Microphone active");
    void this.pcmCapture.start()
      .then(() => {
        if (acousticInputMode(this.pcmCapture.getAppliedAudioSettings()) === "push_to_talk") {
          this.setPushToTalk(true);
          this.stateMachine.predictState("listening", "Echo cancellation unavailable; push-to-talk is required");
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Microphone capture unavailable";
        this.stateMachine.predictState("error", message);
      });
  }

  public stopListening(): void {
    if (!this.stateMachine.getSnapshot().isListening) return;
    void this.pcmCapture.stop();
    this.stateMachine.predictState("thinking", "Finalizing speech...");
  }

  public toggleListening(): void {
    if (this.stateMachine.getSnapshot().isListening) this.stopListening();
    else this.startListening();
  }

  public handlePttPress(): void {
    this.isPttActive = true;
    this.startListening();
  }

  public handlePttRelease(): void {
    if (!this.isPttActive) return;
    this.isPttActive = false;
    this.stopListening();
  }

  public sendText(text: string): void {
    void this.playbackQueue.prepare().catch(() => undefined);
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.stateMachine.getSnapshot().isSpeaking) this.bargeInManager.triggerInterruption();
    const turnId = `turn_${Date.now()}`;
    this.stateMachine.setTurnId(turnId);
    this.stateMachine.predictState("thinking", `Processing "${trimmed.substring(0, 30)}..."`);
    this.client.sendEvent({
      type: "USER_TEXT",
      sessionId: this.client.getSessionId(),
      turnId,
      text: trimmed,
    });
  }

  public setPushToTalk(enabled: boolean): void {
    if (this.isPttMode === enabled) return;
    this.isPttMode = enabled;
    this.pushToTalkModeListeners.forEach((listener) => listener(enabled));
  }

  public getIsPushToTalk(): boolean {
    return this.isPttMode;
  }

  public setSimulatedMicVolume(volume: number): void {
    this.currentMicVolume = volume;
    this.micVolumeListeners.forEach((listener) => listener(volume));
    if (volume > 0.3 && this.stateMachine.getSnapshot().isSpeaking) {
      if (!this.echoSuppressor.shouldSuppressAudioInput(volume, 0.6)) {
        this.bargeInManager.triggerInterruption();
      }
    }
  }

  public getCurrentMicVolume(): number {
    return this.currentMicVolume;
  }

  public onMicVolumeChange(listener: (volume: number) => void): () => void {
    this.micVolumeListeners.add(listener);
    return () => this.micVolumeListeners.delete(listener);
  }

  public onPushToTalkModeChange(listener: (enabled: boolean) => void): () => void {
    this.pushToTalkModeListeners.add(listener);
    return () => this.pushToTalkModeListeners.delete(listener);
  }

  public onAppliedAudioSettingsChange(
    listener: (settings: Readonly<AppliedAudioSettings>) => void,
  ): () => void {
    this.appliedAudioSettingsListeners.add(listener);
    listener(this.pcmCapture.getAppliedAudioSettings());
    return () => this.appliedAudioSettingsListeners.delete(listener);
  }

  public getAcousticInterruptionMetrics(): AcousticInterruptionMetrics {
    return { ...this.acousticInterruptionMetrics };
  }

  public onAcousticInterruption(
    listener: (metrics: AcousticInterruptionMetrics) => void,
  ): () => void {
    this.acousticInterruptionListeners.add(listener);
    return () => this.acousticInterruptionListeners.delete(listener);
  }

  private now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  public dispose(): void {
    void this.pcmCapture.stop();
    void this.playbackQueue.dispose();
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
  }
}
