import { describe, it, expect } from "vitest";
import {
  CaptureStartSchema,
  ClientHelloSchema,
  TaskCancelSchema,
  parseIncomingServerEvent,
} from "../schemas";
import seedData from "../../../test-fixtures/seed-data.json";

describe("Protocol Schemas (FEAT-001)", () => {
  it("validates seed-data manifest event against AGENT_MANIFEST schema", () => {
    const parsed = parseIncomingServerEvent(seedData.manifest);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "AGENT_MANIFEST") {
      expect(parsed.data.type).toBe("AGENT_MANIFEST");
      expect(parsed.data.agents).toHaveLength(6);
      expect(parsed.data.agents[0].id).toBe("local-supervisor");
      expect(parsed.data.agents[0].isOrchestrator).toBe(true);
    }
  });

  it("validates seed-data replayTimeline events against schema", () => {
    for (const item of seedData.replayTimeline) {
      const parsed = parseIncomingServerEvent(item.event);
      expect(parsed.success, `Failed parsing ${item.event.type}`).toBe(true);
    }
  });

  it("validates CLIENT_HELLO schema", () => {
    const validClientHello = {
      type: "CLIENT_HELLO",
      protocolVersion: 2,
      sessionId: "sess_123",
      lastSeq: 42,
      capabilities: ["audio_pcm_s16le_16k_mono_20ms"],
    };
    const result = ClientHelloSchema.safeParse(validClientHello);
    expect(result.success).toBe(true);
  });

  it("validates protocol-v2 capture and idempotent task commands", () => {
    expect(
      CaptureStartSchema.safeParse({
        type: "CAPTURE_START",
        sessionId: "sess_123",
        captureId: "capture_1",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
          frameMs: 20,
        },
      }).success,
    ).toBe(true);
    expect(
      TaskCancelSchema.safeParse({
        type: "TASK_CANCEL",
        sessionId: "sess_123",
        taskId: "task_1",
        commandId: "cmd_1",
      }).success,
    ).toBe(true);
  });

  it.each(["COMMAND_ACK", "TASK_STATE", "STATE_SNAPSHOT"] as const)(
    "parses %s as a protocol-v2 server event",
    (type) => {
      const common = {
        type,
        seq: 50,
        sessionId: "sess_123",
        timestamp: 1_700_000_000_000,
      };
      const payload =
        type === "COMMAND_ACK"
          ? {
              ...common,
              commandId: "cmd_1",
              commandType: "TASK_CANCEL",
              outcome: "ACCEPTED",
            }
          : type === "TASK_STATE"
            ? {
                ...common,
                taskId: "task_1",
                state: "BLOCKED_POLICY",
                reasonCode: "EXTERNAL_SIDE_EFFECT_NOT_ALLOWED",
              }
            : {
                ...common,
                orchestratorId: "supervisor",
                activeTaskIds: ["task_1"],
              };
      expect(parseIncomingServerEvent(payload).success).toBe(true);
    },
  );

  it("gracefully handles forward compatibility for unknown event types", () => {
    const futureEvent = {
      type: "FUTURE_QUANTUM_EVENT",
      seq: 999,
      quantumPayload: { qubit: 4 },
    };
    const parsed = parseIncomingServerEvent(futureEvent);
    expect(parsed.success).toBe(false);
    if (!parsed.success && "isUnknownType" in parsed) {
      expect(parsed.isUnknownType).toBe(true);
      expect(parsed.eventType).toBe("FUTURE_QUANTUM_EVENT");
    }
  });

  it("safely rejects malformed payloads without crashing", () => {
    const invalidPayload = {
      type: "AGENT_STATE",
      seq: "not-a-number",
      agentId: 1234,
    };
    const parsed = parseIncomingServerEvent(invalidPayload);
    expect(parsed.success).toBe(false);
  });
});
