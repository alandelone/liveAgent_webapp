import { z } from 'zod';

export const AgentRoleStateSchema = z.enum([
  'idle',
  'listening',
  'thinking',
  'speaking',
  'executing',
  'delegating',
  'waiting',
  'interrupted',
  'error',
  'delegated',
  'tool_call',
  'background',
  'completed',
]);

export const AgentDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string(),
  icon: z.string(),
  isOrchestrator: z.boolean().optional(),
});

export const ClientHelloSchema = z.object({
  type: z.literal('CLIENT_HELLO'),
  protocolVersion: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  lastSeq: z.number().int().nullable().optional(),
  capabilities: z.array(z.string()).optional(),
});

export const AgentManifestSchema = z.object({
  type: z.literal('AGENT_MANIFEST'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  agents: z.array(AgentDescriptorSchema),
});

export const AgentStateSchema = z.object({
  type: z.literal('AGENT_STATE'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  agentId: z.string().min(1),
  state: AgentRoleStateSchema,
  detail: z.string().optional(),
});

export const UserSpeechStartSchema = z.object({
  type: z.literal('USER_SPEECH_START'),
  sessionId: z.string(),
  turnId: z.string(),
  timestamp: z.number().optional(),
});

export const UserSpeechEndSchema = z.object({
  type: z.literal('USER_SPEECH_END'),
  sessionId: z.string(),
  turnId: z.string(),
  timestamp: z.number().optional(),
});

export const UserTextSchema = z.object({
  type: z.literal('USER_TEXT'),
  sessionId: z.string(),
  turnId: z.string(),
  text: z.string(),
  timestamp: z.number().optional(),
});

export const UserTargetSchema = z.object({
  type: z.literal('USER_TARGET'),
  sessionId: z.string(),
  targetAgentId: z.string(),
  timestamp: z.number().optional(),
});

export const UserInterruptSchema = z.object({
  type: z.literal('USER_INTERRUPT'),
  sessionId: z.string(),
  turnId: z.string(),
  timestamp: z.number().optional(),
});

export const STTPartialSchema = z.object({
  type: z.literal('STT_PARTIAL'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  turnId: z.string(),
  text: z.string(),
});

export const STTFinalSchema = z.object({
  type: z.literal('STT_FINAL'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  turnId: z.string(),
  text: z.string(),
});

export const TextDeltaSchema = z.object({
  type: z.literal('TEXT_DELTA'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  agentId: z.string(),
  turnId: z.string(),
  delta: z.string(),
  isFinal: z.boolean(),
});

export const TTSStartSchema = z.object({
  type: z.literal('TTS_START'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  agentId: z.string(),
  turnId: z.string(),
});

export const TTSEndSchema = z.object({
  type: z.literal('TTS_END'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  agentId: z.string(),
  turnId: z.string(),
});

export const TaskStartSchema = z.object({
  type: z.literal('TASK_START'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  taskId: z.string(),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  taskName: z.string(),
});

export const TaskProgressSchema = z.object({
  type: z.literal('TASK_PROGRESS'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  taskId: z.string(),
  agentId: z.string(),
  progress: z.number(),
  log: z.string().optional(),
});

export const TaskCompleteSchema = z.object({
  type: z.literal('TASK_COMPLETE'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  taskId: z.string(),
  agentId: z.string(),
  resultSummary: z.string().optional(),
});

export const TaskCancelSchema = z.object({
  type: z.literal('TASK_CANCEL'),
  taskId: z.string(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
});

export const ArtifactSchema = z.object({
  type: z.literal('ARTIFACT'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  agentId: z.string(),
  taskId: z.string(),
  artifactType: z.enum(['file', 'code_patch', 'report', 'image']),
  name: z.string(),
  contentUrl: z.string().optional(),
  preview: z.string().optional(),
});

export const ErrorSchema = z.object({
  type: z.literal('ERROR'),
  seq: z.number().int(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
  agentId: z.string().optional(),
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().optional(),
});

export const HermesServerEventSchema = z.discriminatedUnion('type', [
  AgentManifestSchema,
  AgentStateSchema,
  STTPartialSchema,
  STTFinalSchema,
  TextDeltaSchema,
  TTSStartSchema,
  TTSEndSchema,
  TaskStartSchema,
  TaskProgressSchema,
  TaskCompleteSchema,
  ArtifactSchema,
  ErrorSchema,
]);

export function parseIncomingServerEvent(data: unknown) {
  if (typeof data !== 'object' || data === null) {
    return { success: false as const, error: 'Expected object payload' };
  }

  const record = data as Record<string, unknown>;
  const eventType = record.type;

  if (typeof eventType !== 'string') {
    return { success: false as const, error: 'Missing or non-string "type" field' };
  }

  const result = HermesServerEventSchema.safeParse(data);
  if (!result.success) {
    return {
      success: false as const,
      isUnknownType: !HermesServerEventSchema.optionsMap.has(eventType),
      eventType,
      error: result.error,
    };
  }

  return {
    success: true as const,
    data: result.data,
  };
}
