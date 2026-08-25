import { describe, expect, it, vi } from "vitest";
import { HermesClient } from "../../protocol/HermesClient";
import { HermesEventBus } from "../../protocol/eventBus";
import { ManifestStore } from "../manifestStore";
import { ModeStore } from "../modeStore";

const supervisorManifest = [
  {
    id: "supervisor",
    name: "Local Supervisor",
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
  {
    id: "coding",
    name: "Coding",
    color: "#3B82F6",
    icon: "code",
    isOrchestrator: false,
  },
];

describe("Manifest-driven orchestrator identity (FEAT-014)", () => {
  it("selects only the isOrchestrator entry and treats Hermes as a side agent", () => {
    const store = new ManifestStore();
    store.setManifest(supervisorManifest);

    expect(store.getOrchestrator()?.id).toBe("supervisor");
    expect(store.getSideAgents().map((agent) => agent.id)).toEqual([
      "hermes",
      "coding",
    ]);
  });

  it("rejects manifests with zero or multiple orchestrators", () => {
    const store = new ManifestStore();
    expect(() =>
      store.setManifest(
        supervisorManifest.map((agent) => ({
          ...agent,
          isOrchestrator: false,
        })),
      ),
    ).toThrow("exactly one orchestrator");
    expect(() =>
      store.setManifest(
        supervisorManifest.map((agent) => ({
          ...agent,
          isOrchestrator: agent.id !== "coding",
        })),
      ),
    ).toThrow("exactly one orchestrator");
  });

  it("clears direct mode by targeting the manifest orchestrator", () => {
    const bus = new HermesEventBus();
    const client = new HermesClient({}, bus);
    const send = vi
      .spyOn(client, "sendEvent")
      .mockImplementation(() => undefined);
    const manifest = new ManifestStore();
    manifest.setManifest(supervisorManifest);
    const mode = new ModeStore(client, manifest);

    mode.setTargetAgent("hermes");
    expect(mode.getSnapshot().isDirectMode).toBe(true);
    mode.clearTargetAgent();

    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetAgentId: "supervisor" }),
    );
    expect(mode.getSnapshot().isDirectMode).toBe(false);
  });
});
