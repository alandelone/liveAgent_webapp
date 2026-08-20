export const CURRENT_PROTOCOL_VERSION = 1;

export type AgentRoleState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'executing'
  | 'delegating'
  | 'waiting'
  | 'interrupted'
  | 'error'
  | 'delegated'
  | 'tool_call'
  | 'background'
  | 'completed';

export interface AgentDescriptor {
  id: string;
  name: string;
  color: string;
  icon: string;
  isOrchestrator?: boolean;
}

export interface ClientHelloEvent {
  type: 'CLIENT_HELLO';
  protocolVersion: number;
  sessionId: string;
  lastSeq?: number | null;
  capabilities?: string[];
}

export interface AgentManifestEvent {
  type: 'AGENT_MANIFEST';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agents: AgentDescriptor[];
}

export interface AgentStateEvent {
  type: 'AGENT_STATE';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  state: AgentRoleState;
  detail?: string;
}

export interface UserSpeechStartEvent {
  type: 'USER_SPEECH_START';
  sessionId: string;
  turnId: string;
  timestamp?: number;
}

export interface UserSpeechEndEvent {
  type: 'USER_SPEECH_END';
  sessionId: string;
  turnId: string;
  timestamp?: number;
}

export interface UserTextEvent {
  type: 'USER_TEXT';
  sessionId: string;
  turnId: string;
  text: string;
  timestamp?: number;
}

export interface UserTargetEvent {
  type: 'USER_TARGET';
  sessionId: string;
  targetAgentId: string;
  timestamp?: number;
}

export interface UserInterruptEvent {
  type: 'USER_INTERRUPT';
  sessionId: string;
  turnId: string;
  timestamp?: number;
}

export interface STTPartialEvent {
  type: 'STT_PARTIAL';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  turnId: string;
  text: string;
}

export interface STTFinalEvent {
  type: 'STT_FINAL';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  turnId: string;
  text: string;
}

export interface TextDeltaEvent {
  type: 'TEXT_DELTA';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  turnId: string;
  delta: string;
  isFinal: boolean;
}

export interface TTSStartEvent {
  type: 'TTS_START';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  turnId: string;
}

export interface TTSEndEvent {
  type: 'TTS_END';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  turnId: string;
}

export interface TaskStartEvent {
  type: 'TASK_START';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  taskName: string;
}

export interface TaskProgressEvent {
  type: 'TASK_PROGRESS';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  taskId: string;
  agentId: string;
  progress: number;
  log?: string;
}

export interface TaskCompleteEvent {
  type: 'TASK_COMPLETE';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  taskId: string;
  agentId: string;
  resultSummary?: string;
}

export interface TaskCancelEvent {
  type: 'TASK_CANCEL';
  taskId: string;
  sessionId?: string;
  timestamp?: number;
}

export interface ArtifactEvent {
  type: 'ARTIFACT';
  seq: number;
  sessionId?: string;
  timestamp?: number;
  agentId: string;
  taskId: string;
  artifactType: 'file' | 'code_patch' | 'report' | 'image';
  name: string;
  contentUrl?: string;
  preview?: string;
}

export interface ErrorEvent {
  type: 'ERROR';
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
  | STTPartialEvent
  | STTFinalEvent
  | TextDeltaEvent
  | TTSStartEvent
  | TTSEndEvent
  | TaskStartEvent
  | TaskProgressEvent
  | TaskCompleteEvent
  | ArtifactEvent
  | ErrorEvent;

export type HermesClientEvent =
  | ClientHelloEvent
  | UserSpeechStartEvent
  | UserSpeechEndEvent
  | UserTextEvent
  | UserTargetEvent
  | UserInterruptEvent
  | TaskCancelEvent;

export type HermesProtocolEvent = HermesServerEvent | HermesClientEvent;

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
