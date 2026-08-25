import { describe, it, expect } from "vitest";
import { HermesEventBus } from "../../protocol/eventBus";
import { AgentStateMachine } from "../agentStateMachine";

describe("AgentStateMachine (FEAT-005)", () => {
  const publishManifest = (bus: HermesEventBus) => {
    bus.handleRawMessage({
      type: "AGENT_MANIFEST",
      seq: 1,
      agents: [
        {
          id: "supervisor",
          name: "Supervisor",
          color: "#6366F1",
          icon: "brain",
          isOrchestrator: true,
        },
        {
          id: "hermes",
          name: "Hermes",
          color: "#F59E0B",
          icon: "sparkles",
          isOrchestrator: false,
        },
      ],
    });
  };

  it("predicts optimistic state on local user action and reconciles with Hermes events", () => {
    const bus = new HermesEventBus();
    const stateMachine = new AgentStateMachine(bus);
    publishManifest(bus);

    expect(stateMachine.getSnapshot().mainState).toBe("idle");
    expect(stateMachine.getSnapshot().isOptimistic).toBe(false);

    // User taps mic -> optimistic prediction
    stateMachine.predictState("listening", "Microphone active");
    expect(stateMachine.getSnapshot().mainState).toBe("listening");
    expect(stateMachine.getSnapshot().isListening).toBe(true);
    expect(stateMachine.getSnapshot().isOptimistic).toBe(true);

    // Local Supervisor responds with authoritative AGENT_STATE
    bus.handleRawMessage({
      type: "AGENT_STATE",
      seq: 10,
      agentId: "supervisor",
      state: "thinking",
      detail: "Supervisor is analyzing question",
    });

    const snapshot = stateMachine.getSnapshot();
    expect(snapshot.mainState).toBe("thinking");
    expect(snapshot.isThinking).toBe(true);
    expect(snapshot.isOptimistic).toBe(false);
    expect(snapshot.detail).toBe("Supervisor is analyzing question");
  });

  it("transitions state on TTS_START and TTS_END", () => {
    const bus = new HermesEventBus();
    const stateMachine = new AgentStateMachine(bus);
    publishManifest(bus);

    bus.handleRawMessage({
      type: "TTS_START",
      seq: 20,
      agentId: "supervisor",
      turnId: "turn_42",
      streamId: "stream_42",
      format: {
        encoding: "pcm_f32le",
        sampleRateHz: 24000,
        channels: 1,
        chunkFrames: 2400,
      },
    });

    expect(stateMachine.getSnapshot().mainState).toBe("speaking");
    expect(stateMachine.getSnapshot().isSpeaking).toBe(true);
    expect(stateMachine.getSnapshot().currentTurnId).toBe("turn_42");

    bus.handleRawMessage({
      type: "TTS_END",
      seq: 21,
      agentId: "supervisor",
      turnId: "turn_42",
      streamId: "stream_42",
      outcome: "COMPLETED",
    });

    expect(stateMachine.getSnapshot().mainState).toBe("idle");
    expect(stateMachine.getSnapshot().isSpeaking).toBe(false);
  });
});
