import { HermesEventBus } from '../protocol/eventBus';

export interface TaskNode {
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  taskName: string;
  progress: number;
  logs: string[];
  status: 'running' | 'completed' | 'failed';
  resultSummary?: string;
  startedAt: number;
  completedAt?: number;
}

export type TaskTreeListener = (tasks: TaskNode[]) => void;

export class TaskTreeStore {
  private tasks: Map<string, TaskNode> = new Map();
  private taskOrder: string[] = [];
  private listeners: Set<TaskTreeListener> = new Set();
  private unsubscribers: Array<() => void> = [];

  constructor(eventBus?: HermesEventBus) {
    if (eventBus) {
      this.attach(eventBus);
    }
  }

  public attach(eventBus: HermesEventBus): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];

    const u1 = eventBus.on('TASK_START', (ev) => {
      const node: TaskNode = {
        taskId: ev.taskId,
        fromAgentId: ev.fromAgentId,
        toAgentId: ev.toAgentId,
        taskName: ev.taskName,
        progress: 0,
        logs: [],
        status: 'running',
        startedAt: Date.now(),
      };
      this.tasks.set(ev.taskId, node);
      if (!this.taskOrder.includes(ev.taskId)) {
        this.taskOrder.push(ev.taskId);
      }
      this.notify();
    });

    const u2 = eventBus.on('TASK_PROGRESS', (ev) => {
      const node = this.tasks.get(ev.taskId);
      if (node) {
        node.progress = ev.progress;
        if (ev.log && !node.logs.includes(ev.log)) {
          node.logs.push(ev.log);
        }
        this.notify();
      }
    });

    const u3 = eventBus.on('TASK_COMPLETE', (ev) => {
      const node = this.tasks.get(ev.taskId);
      if (node) {
        node.progress = 100;
        node.status = 'completed';
        node.resultSummary = ev.resultSummary;
        node.completedAt = Date.now();
        this.notify();
      }
    });

    const u4 = eventBus.on('ERROR', (ev) => {
      // If error matches an agent working on a task, mark as failed
      if (ev.agentId) {
        for (const task of this.tasks.values()) {
          if (task.toAgentId === ev.agentId && task.status === 'running') {
            task.status = 'failed';
            task.logs.push(`Error: ${ev.message}`);
            this.notify();
          }
        }
      }
    });

    this.unsubscribers.push(u1, u2, u3, u4);
  }

  public getTasks(): TaskNode[] {
    return this.taskOrder.map((id) => this.tasks.get(id)!).filter(Boolean);
  }

  public getTaskById(taskId: string): TaskNode | undefined {
    return this.tasks.get(taskId);
  }

  public getRunningTasksCount(): number {
    return this.getTasks().filter((t) => t.status === 'running').length;
  }

  public clear(): void {
    this.tasks.clear();
    this.taskOrder = [];
    this.notify();
  }

  public subscribe(listener: TaskTreeListener): () => void {
    this.listeners.add(listener);
    listener(this.getTasks());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const list = this.getTasks();
    this.listeners.forEach((listener) => {
      try {
        listener(list);
      } catch (err) {
        console.error('[TaskTreeStore] Error in listener:', err);
      }
    });
  }
}
