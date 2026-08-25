export const CURRENT_PROTOCOL_VERSION = 2;
export const LEGACY_TEXT_PROTOCOL_VERSION = 1;
export const PCM_FRAME_BYTES = 640;

export type AgentRoleState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "executing"
  | "delegating"
  | "waiting"
  | "interrupted"
  | "error"
  | "delegated"
  | "tool_call"
  | "background"
  | "completed";

export interface AgentDescriptor {
  id: string;
  name: string;
  color: string;
  icon: string;
  isOrchestrator?: boolean;
}

export interface ClientHelloEvent {
  type: "CLIENT_HELLO";
  protocolVersion: number;
  sessionId: string;
  lastSeq?: number | null;
  capabilities?: string[];
}

export interface AgentManifestEvent {
  type: "AGENT_MANIFEST";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agents: AgentDescriptor[];
}

export interface AgentStateEvent {
  type: "AGENT_STATE";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  state: AgentRoleState;
  detail?: string;
}

export interface UserSpeechStartEvent {
  type: "USER_SPEECH_START";
  seq?: number;
  sessionId: string;
  turnId: string;
  timestamp?: number;
}

export interface UserSpeechEndEvent {
  type: "USER_SPEECH_END";
  seq?: number;
  sessionId: string;
  turnId: string;
  timestamp?: number;
}

export interface UserTextEvent {
  type: "USER_TEXT";
  sessionId: string;
  turnId: string;
  text: string;
  timestamp?: number;
}

export interface UserTargetEvent {
  type: "USER_TARGET";
  sessionId: string;
  targetAgentId: string;
  timestamp?: number;
}

export interface UserInterruptEvent {
  type: "USER_INTERRUPT";
  sessionId: string;
  turnId: string;
  timestamp?: number;
  commandId?: string;
}

export interface CaptureStartEvent {
  type: "CAPTURE_START";
  sessionId: string;
  captureId: string;
  format: {
    encoding: "pcm_s16le";
    sampleRateHz: 16000;
    channels: 1;
    frameMs: 20;
  };
  appliedAudioSettings?: Record<string, boolean | number | string>;
}

export interface CaptureEndEvent {
  type: "CAPTURE_END";
  sessionId: string;
  captureId: string;
}

export interface STTPartialEvent {
  type: "STT_PARTIAL";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  turnId: string;
  text: string;
}

export interface STTFinalEvent {
  type: "STT_FINAL";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  turnId: string;
  text: string;
}

export interface TextDeltaEvent {
  type: "TEXT_DELTA";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  turnId: string;
  delta: string;
  isFinal: boolean;
}

export interface TTSStartEvent {
  type: "TTS_START";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  turnId: string;
  streamId: string;
  format: {
    encoding: "pcm_f32le";
    sampleRateHz: 24000;
    channels: 1;
    chunkFrames: number;
  };
  clauseIndex?: number;
  synthesisMs?: number;
}

export interface TTSEndEvent {
  type: "TTS_END";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  turnId: string;
  streamId: string;
  outcome: "COMPLETED" | "INTERRUPTED" | "FAILED" | "TEXT_ONLY";
  reasonCode?: string;
}

export interface TaskStartEvent {
  type: "TASK_START";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  taskName: string;
}

export interface TaskProgressEvent {
  type: "TASK_PROGRESS";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  taskId: string;
  agentId: string;
  progress: number;
  log?: string;
}

export interface TaskCompleteEvent {
  type: "TASK_COMPLETE";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  taskId: string;
  agentId: string;
  resultSummary?: string;
}

export interface TaskCancelEvent {
  type: "TASK_CANCEL";
  taskId: string;
  sessionId?: string;
  timestamp?: number;
  commandId: string;
}

export interface CommandAckEvent {
  type: "COMMAND_ACK";
  seq: number;
  sessionId: string;
  timestamp: number;
  commandId: string;
  commandType: "USER_INTERRUPT" | "TASK_CANCEL";
  outcome: "ACCEPTED" | "ALREADY_APPLIED" | "REJECTED";
  reasonCode?: string;
}

export interface TaskStateEvent {
  type: "TASK_STATE";
  seq: number;
  sessionId: string;
  timestamp: number;
  turnId?: string;
  taskId: string;
  state:
    | "QUEUED"
    | "RUNNING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED"
    | "TIMED_OUT"
    | "BLOCKED_POLICY";
  reasonCode?: string;
  message?: string;
}

export interface StateSnapshotEvent {
  type: "STATE_SNAPSHOT";
  seq: number;
  sessionId: string;
  timestamp: number;
  orchestratorId: string;
  activeTurnId?: string;
  activeTaskIds: string[];
}

export interface ArtifactEvent {
  type: "ARTIFACT";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  taskId: string;
  artifactType: "file" | "code_patch" | "report" | "image";
  name: string;
  contentUrl?: string;
  preview?: string;
}

export interface ErrorEvent {
  type: "ERROR";
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId?: string;
  code: string;
  message: string;
  recoverable?: boolean;
}

export type HermesServerEvent =
  | AgentManifestEvent
  | AgentStateEvent
  | UserSpeechStartEvent
  | UserSpeechEndEvent
  | STTPartialEvent
  | STTFinalEvent
  | TextDeltaEvent
  | TTSStartEvent
  | TTSEndEvent
  | TaskStartEvent
  | TaskProgressEvent
  | TaskCompleteEvent
  | TaskStateEvent
  | CommandAckEvent
  | StateSnapshotEvent
  | ArtifactEvent
  | ErrorEvent;

export type HermesClientEvent =
  | ClientHelloEvent
  | UserSpeechStartEvent
  | UserSpeechEndEvent
  | UserTextEvent
  | UserTargetEvent
  | UserInterruptEvent
  | CaptureStartEvent
  | CaptureEndEvent
  | TaskCancelEvent;

export type HermesProtocolEvent = HermesServerEvent | HermesClientEvent;

export type ConnectionState =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
