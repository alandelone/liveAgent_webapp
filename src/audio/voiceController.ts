import { HermesClient } from '../protocol/HermesClient';
import { AgentStateMachine } from '../state/agentStateMachine';
import { AudioPlaybackQueue } from './audioPlaybackQueue';
import { EchoSuppressor } from './echoSuppressor';
import { BargeInManager } from './bargeInManager';

export interface VoiceControllerConfig {
  pushToTalkDefault?: boolean;
}

export class VoiceController {
  public readonly playbackQueue: AudioPlaybackQueue;
  public readonly echoSuppressor: EchoSuppressor;
  public readonly bargeInManager: BargeInManager;
  private isPttMode: boolean;
  private isPttActive: boolean = false;
  private currentMicVolume: number = 0;
  private micVolumeListeners: Set<(vol: number) => void> = new Set();
  private unsubscribers: Array<() => void> = [];

  // Web Audio microphone capture
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private smoothedVolume: number = 0;

  constructor(
    public readonly client: HermesClient,
    public readonly stateMachine: AgentStateMachine,
    config: VoiceControllerConfig = {}
  ) {
    this.playbackQueue = new AudioPlaybackQueue();
    this.echoSuppressor = new EchoSuppressor();
    this.bargeInManager = new BargeInManager(this.client, this.stateMachine, this.playbackQueue);
    this.isPttMode = config.pushToTalkDefault ?? false;

    this.attach();
  }

  private attach(): void {
    // Pipe binary audio from server into playback queue
    const u1 = this.client.eventBus.onAudio((chunk) => {
      this.playbackQueue.enqueueChunk(chunk);
    });

    // Track playback state for echo suppression
    const u2 = this.playbackQueue.onPlaybackStateChange((isPlaying) => {
      this.echoSuppressor.setTtsPlaying(isPlaying);
    });

    this.unsubscribers.push(u1, u2);
  }

  private async startMicCapture(): Promise<void> {
    if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      return;
    }

    try {
      if (!this.mediaStream) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }

      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioCtxClass();
      }

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      this.analyser = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const processAudio = () => {
        if (!this.analyser) return;

        this.analyser.getByteFrequencyData(dataArray);

        // Compute average frequency power
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        // Normalize: regular speech typically falls in 0..120 range
        const rawVol = Math.min(1, Math.max(0, (avg / 70) * 1.2));

        // Fast attack, smooth decay
        if (rawVol > this.smoothedVolume) {
          this.smoothedVolume = this.smoothedVolume * 0.2 + rawVol * 0.8;
        } else {
          this.smoothedVolume = this.smoothedVolume * 0.85 + rawVol * 0.15;
        }

        const normalizedVol = Number(this.smoothedVolume.toFixed(3));
        this.setSimulatedMicVolume(normalizedVol);

        this.animFrameId = requestAnimationFrame(processAudio);
      };

      this.animFrameId = requestAnimationFrame(processAudio);
    } catch {
      // Microphone permissions denied or unsupported environment
    }
  }

  private stopMicCapture(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        this.audioCtx.close();
      } catch {
        // Ignore close errors
      }
      this.audioCtx = null;
    }

    this.smoothedVolume = 0;
    this.setSimulatedMicVolume(0);
  }

  private speechRecognizer: any = null;
  private transcribedSpeech: string = '';

  private startSpeechRecognition(): void {
    if (typeof window === 'undefined') return;
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    try {
      this.transcribedSpeech = '';
      const recognizer = new SpeechRec();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.lang = navigator.language || 'zh-CN';

      recognizer.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const currentText = (final + interim).trim();
        if (currentText) {
          this.transcribedSpeech = currentText;
          const turnId = this.stateMachine.getSnapshot().currentTurnId ?? `turn_${Date.now()}`;
          this.client.eventBus.emitServerEvent({
            type: 'STT_PARTIAL',
            seq: 999,
            turnId,
            text: currentText,
          });
        }
      };

      recognizer.onerror = () => {
        // Handled quietly
      };

      recognizer.start();
      this.speechRecognizer = recognizer;
    } catch {
      // Speech recognition not permitted or unavailable
    }
  }

  private stopSpeechRecognition(): void {
    if (this.speechRecognizer) {
      try {
        this.speechRecognizer.stop();
      } catch {
        // ignore
      }
      this.speechRecognizer = null;
    }

    const finalSpokenText = this.transcribedSpeech.trim();
    this.transcribedSpeech = '';

    if (finalSpokenText) {
      this.sendText(finalSpokenText);
    }
  }

  public startListening(): void {
    const snap = this.stateMachine.getSnapshot();

    // Check for barge-in if agent is currently speaking
    if (snap.isSpeaking) {
      this.bargeInManager.triggerInterruption();
      return;
    }

    const turnId = `turn_${Date.now()}`;
    this.stateMachine.setTurnId(turnId);
    this.stateMachine.predictState('listening', 'Microphone active');

    this.client.sendEvent({
      type: 'USER_SPEECH_START',
      sessionId: this.client.getSessionId(),
      turnId,
    });

    this.startMicCapture();
    this.startSpeechRecognition();
  }

  public stopListening(): void {
    const snap = this.stateMachine.getSnapshot();
    if (!snap.isListening) return;

    this.stopMicCapture();
    this.stopSpeechRecognition();

    this.stateMachine.predictState('thinking', 'Processing speech...');

    this.client.sendEvent({
      type: 'USER_SPEECH_END',
      sessionId: this.client.getSessionId(),
      turnId: snap.currentTurnId ?? `turn_${Date.now()}`,
    });
  }

  public toggleListening(): void {
    const snap = this.stateMachine.getSnapshot();
    if (snap.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  public handlePttPress(): void {
    this.isPttActive = true;
    this.startListening();
  }

  public handlePttRelease(): void {
    if (this.isPttActive) {
      this.isPttActive = false;
      this.stopListening();
    }
  }

  public sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Interrupt TTS if speaking
    if (this.stateMachine.getSnapshot().isSpeaking) {
      this.bargeInManager.triggerInterruption();
    }

    const turnId = `turn_${Date.now()}`;
    this.stateMachine.setTurnId(turnId);
    this.stateMachine.predictState('thinking', `Processing "${trimmed.substring(0, 30)}..."`);

    this.client.sendEvent({
      type: 'USER_TEXT',
      sessionId: this.client.getSessionId(),
      turnId,
      text: trimmed,
    });
  }

  public setPushToTalk(enabled: boolean): void {
    this.isPttMode = enabled;
  }

  public getIsPushToTalk(): boolean {
    return this.isPttMode;
  }

  public setSimulatedMicVolume(vol: number): void {
    this.currentMicVolume = vol;
    this.micVolumeListeners.forEach((l) => l(vol));

    // If speech detected and state is speaking, check echo suppressor before barge-in
    if (vol > 0.3 && this.stateMachine.getSnapshot().isSpeaking) {
      if (!this.echoSuppressor.shouldSuppressAudioInput(vol, 0.6)) {
        this.bargeInManager.triggerInterruption();
      }
    }
  }

  public getCurrentMicVolume(): number {
    return this.currentMicVolume;
  }

  public onMicVolumeChange(listener: (vol: number) => void): () => void {
    this.micVolumeListeners.add(listener);
    return () => this.micVolumeListeners.delete(listener);
  }

  public dispose(): void {
    this.stopMicCapture();
    this.stopSpeechRecognition();
    this.playbackQueue.stop();
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
  }
}
