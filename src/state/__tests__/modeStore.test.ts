import { describe, it, expect, vi } from 'vitest';
import { HermesEventBus } from '../../protocol/eventBus';
import { HermesClient } from '../../protocol/HermesClient';
import { ManifestStore } from '../manifestStore';
import { ModeStore } from '../modeStore';
import seedData from '../../../test-fixtures/seed-data.json';

describe('ModeStore & Direct Agent Mode (FEAT-010)', () => {
  it('dispatches USER_TARGET to Hermes when entering and exiting Direct Agent Mode', () => {
    const bus = new HermesEventBus();
    const sentEvents: any[] = [];
    bus.on('client_event', (ev) => sentEvents.push(ev));

    const client = new HermesClient({}, bus);
    vi.spyOn(client, 'sendEvent').mockImplementation((ev) => {
      bus.emitClientEvent(ev);
    });

    const manifestStore = new ManifestStore(bus);
    bus.handleRawMessage(seedData.manifest);

    const modeStore = new ModeStore(client, manifestStore);

    expect(modeStore.getSnapshot().isDirectMode).toBe(false);
    expect(modeStore.getSnapshot().targetAgentId).toBeNull();

    // Select 'coding' agent
    modeStore.setTargetAgent('coding');
    expect(modeStore.getSnapshot().isDirectMode).toBe(true);
    expect(modeStore.getSnapshot().targetAgentId).toBe('coding');
    expect(modeStore.getSnapshot().targetAgent?.name).toBe('Coding');

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].type).toBe('USER_TARGET');
    expect(sentEvents[0].targetAgentId).toBe('coding');

    // Exit direct mode
    modeStore.clearTargetAgent();
    expect(modeStore.getSnapshot().isDirectMode).toBe(false);
    expect(modeStore.getSnapshot().targetAgentId).toBeNull();

    expect(sentEvents).toHaveLength(2);
    expect(sentEvents[1].type).toBe('USER_TARGET');
    expect(sentEvents[1].targetAgentId).toBe('hermes');
  });
});
