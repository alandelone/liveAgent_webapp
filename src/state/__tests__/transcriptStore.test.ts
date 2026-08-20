import { describe, it, expect } from 'vitest';
import { HermesEventBus } from '../../protocol/eventBus';
import { TranscriptStore } from '../transcriptStore';

describe('TranscriptStore (FEAT-012)', () => {
  it('records user STT turns and streams incremental agent TEXT_DELTA deltas', () => {
    const bus = new HermesEventBus();
    const transcriptStore = new TranscriptStore(bus);

    // Initial STT
    bus.handleRawMessage({
      type: 'STT_FINAL',
      seq: 2,
      turnId: 'turn_001',
      text: 'Analyze the codebase docs.',
    });

    let turns = transcriptStore.getTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].userText).toBe('Analyze the codebase docs.');
    expect(turns[0].agentResponses).toHaveLength(0);

    // First text delta chunk
    bus.handleRawMessage({
      type: 'TEXT_DELTA',
      seq: 3,
      agentId: 'hermes',
      turnId: 'turn_001',
      delta: 'Understood. ',
      isFinal: false,
    });

    turns = transcriptStore.getTurns();
    expect(turns[0].agentResponses).toHaveLength(1);
    expect(turns[0].agentResponses[0].text).toBe('Understood. ');
    expect(turns[0].agentResponses[0].isFinal).toBe(false);

    // Second text delta chunk
    bus.handleRawMessage({
      type: 'TEXT_DELTA',
      seq: 4,
      agentId: 'hermes',
      turnId: 'turn_001',
      delta: 'Scanning documentation.',
      isFinal: true,
    });

    turns = transcriptStore.getTurns();
    expect(turns[0].agentResponses[0].text).toBe('Understood. Scanning documentation.');
    expect(turns[0].agentResponses[0].isFinal).toBe(true);
  });

  it('attaches artifacts to active turns', () => {
    const bus = new HermesEventBus();
    const transcriptStore = new TranscriptStore(bus);

    bus.emitClientEvent({
      type: 'USER_TEXT',
      sessionId: 'sess_1',
      turnId: 'turn_002',
      text: 'Show me the patch',
    });

    bus.handleRawMessage({
      type: 'ARTIFACT',
      seq: 150,
      agentId: 'coding',
      taskId: 'task-502',
      artifactType: 'code_patch',
      name: 'fix.patch',
      preview: 'diff --git a/file.ts',
    });

    const turns = transcriptStore.getTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].artifacts).toHaveLength(1);
    expect(turns[0].artifacts[0].name).toBe('fix.patch');
    expect(turns[0].artifacts[0].artifactType).toBe('code_patch');
  });
});
