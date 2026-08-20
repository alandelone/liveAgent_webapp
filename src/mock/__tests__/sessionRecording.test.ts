import { describe, it, expect } from 'vitest';
import { HermesEventBus } from '../../protocol/eventBus';
import { SessionRecorder } from '../sessionRecorder';
import { SessionReplayer } from '../sessionReplayer';
import seedData from '../../../test-fixtures/seed-data.json';

describe('SessionRecorder & SessionReplayer (FEAT-003)', () => {
  it('records events and exports them to valid JSONL', () => {
    const bus = new HermesEventBus();
    const recorder = new SessionRecorder(bus);

    recorder.startRecording();

    bus.handleRawMessage(seedData.manifest);
    bus.handleRawMessage(seedData.replayTimeline[0].event);
    bus.emitClientEvent({
      type: 'USER_TEXT',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      text: 'Hello Hermes',
    });

    const entries = recorder.stopRecording();
    expect(entries).toHaveLength(3);

    const jsonl = recorder.exportToJsonl();
    const parsedEntries = SessionReplayer.parseJsonl(jsonl);
    expect(parsedEntries).toHaveLength(3);
    expect((parsedEntries[0].payload as any).type).toBe('AGENT_MANIFEST');
    expect((parsedEntries[1].payload as any).type).toBe('AGENT_STATE');
    expect((parsedEntries[2].payload as any).type).toBe('USER_TEXT');
  });

  it('replays recorded JSONL traces into a target event bus instantly', async () => {
    const bus = new HermesEventBus();
    const replayer = new SessionReplayer(bus);

    const receivedEvents: any[] = [];
    bus.on('all', (ev) => receivedEvents.push(ev));

    const jsonlSample = [
      JSON.stringify({
        recordedAt: Date.now(),
        relativeTimeMs: 0,
        direction: 'inbound',
        payload: seedData.manifest,
      }),
      JSON.stringify({
        recordedAt: Date.now(),
        relativeTimeMs: 10,
        direction: 'inbound',
        payload: seedData.replayTimeline[0].event,
      }),
    ].join('\n');

    const entries = SessionReplayer.parseJsonl(jsonlSample);
    await replayer.play(entries, { instant: true });

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0].type).toBe('AGENT_MANIFEST');
    expect(receivedEvents[1].type).toBe('AGENT_STATE');
  });
});
