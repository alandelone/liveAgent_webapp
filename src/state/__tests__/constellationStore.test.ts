import { describe, it, expect } from 'vitest';
import { HermesEventBus } from '../../protocol/eventBus';
import { ManifestStore } from '../manifestStore';
import { ConstellationStore } from '../constellationStore';
import seedData from '../../../test-fixtures/seed-data.json';

describe('ManifestStore & ConstellationStore (FEAT-004)', () => {
  it('loads agent manifest and distinguishes orchestrator from side agents', () => {
    const bus = new HermesEventBus();
    const manifestStore = new ManifestStore(bus);

    bus.handleRawMessage(seedData.manifest);

    expect(manifestStore.getAgents()).toHaveLength(6);
    const orchestrator = manifestStore.getOrchestrator();
    expect(orchestrator).toBeDefined();
    expect(orchestrator?.id).toBe('local-supervisor');
    expect(manifestStore.getSideAgents()).toHaveLength(5);
  });

  it('manages active constellation dynamically based on state and delegation tasks', () => {
    const bus = new HermesEventBus();
    const manifestStore = new ManifestStore(bus);
    const constellationStore = new ConstellationStore(manifestStore, bus, { dormantTimeoutMs: 1000 });

    bus.handleRawMessage(seedData.manifest);

    let snapshot = constellationStore.getSnapshot();
    expect(snapshot.orchestrator?.id).toBe('local-supervisor');
    expect(snapshot.orchestratorState).toBe('idle');
    // Initially all 5 side agents are dormant
    expect(snapshot.activeSatellites).toHaveLength(0);
    expect(snapshot.dormantSatellites).toHaveLength(5);

    // Local Supervisor delegates a task to research agent
    bus.handleRawMessage({
      type: 'TASK_START',
      seq: 12,
      taskId: 'task-501',
      fromAgentId: 'local-supervisor',
      toAgentId: 'research',
      taskName: 'Scan documentation in /docs',
    });

    snapshot = constellationStore.getSnapshot();
    expect(snapshot.delegationBeams).toHaveLength(1);
    expect(snapshot.delegationBeams[0].toAgentId).toBe('research');
    // Research is now active
    expect(snapshot.activeSatellites).toHaveLength(1);
    expect(snapshot.activeSatellites[0].agent.id).toBe('research');

    // Research task completes
    bus.handleRawMessage({
      type: 'TASK_COMPLETE',
      seq: 15,
      taskId: 'task-501',
      agentId: 'research',
      resultSummary: 'Extracted 14 architectural sections.',
    });

    snapshot = constellationStore.getSnapshot();
    expect(snapshot.delegationBeams).toHaveLength(0);
  });
});
