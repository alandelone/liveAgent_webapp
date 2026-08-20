import { describe, it, expect } from 'vitest';
import { HermesEventBus } from '../../protocol/eventBus';
import { TaskTreeStore } from '../taskTreeStore';

describe('TaskTreeStore (FEAT-013)', () => {
  it('builds task execution hierarchy from seed data TASK events', () => {
    const bus = new HermesEventBus();
    const taskStore = new TaskTreeStore(bus);

    expect(taskStore.getTasks()).toHaveLength(0);

    // TASK_START
    bus.handleRawMessage({
      type: 'TASK_START',
      seq: 12,
      taskId: 'task-501',
      fromAgentId: 'hermes',
      toAgentId: 'research',
      taskName: 'Scan documentation in /docs',
    });

    expect(taskStore.getTasks()).toHaveLength(1);
    const task = taskStore.getTaskById('task-501');
    expect(task).toBeDefined();
    expect(task?.status).toBe('running');
    expect(task?.toAgentId).toBe('research');
    expect(taskStore.getRunningTasksCount()).toBe(1);

    // TASK_PROGRESS
    bus.handleRawMessage({
      type: 'TASK_PROGRESS',
      seq: 14,
      taskId: 'task-501',
      agentId: 'research',
      progress: 50,
      log: 'Parsed 7 of 14 sections',
    });

    expect(task?.progress).toBe(50);
    expect(task?.logs).toContain('Parsed 7 of 14 sections');

    // TASK_COMPLETE
    bus.handleRawMessage({
      type: 'TASK_COMPLETE',
      seq: 15,
      taskId: 'task-501',
      agentId: 'research',
      resultSummary: 'Extracted 14 architectural sections.',
    });

    expect(task?.status).toBe('completed');
    expect(task?.progress).toBe(100);
    expect(task?.resultSummary).toBe('Extracted 14 architectural sections.');
    expect(taskStore.getRunningTasksCount()).toBe(0);
  });
});
