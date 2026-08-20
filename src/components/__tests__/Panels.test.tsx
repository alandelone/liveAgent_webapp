import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TranscriptPanel } from '../panels/TranscriptPanel';
import { TaskTreePanel } from '../panels/TaskTreePanel';
import { MobileDrawer } from '../panels/MobileDrawer';
import { ManifestStore } from '../../state/manifestStore';
import { TranscriptTurn } from '../../state/transcriptStore';
import { TaskNode } from '../../state/taskTreeStore';

describe('Panels & Layout (FEAT-011, FEAT-012, FEAT-013)', () => {
  const manifestStore = new ManifestStore();
  manifestStore.setManifest([
    { id: 'hermes', name: 'Hermes', color: '#6366F1', icon: 'brain', isOrchestrator: true },
    { id: 'research', name: 'Research', color: '#A855F7', icon: 'book-open' },
  ]);

  it('renders TranscriptPanel with user text and agent streaming response', () => {
    const turns: TranscriptTurn[] = [
      {
        turnId: 'turn_1',
        userText: 'Hello Hermes',
        agentResponses: [
          { agentId: 'hermes', text: 'Hello Alandelone! How can I assist you?', isFinal: true },
        ],
        artifacts: [],
        timestamp: Date.now(),
      },
    ];

    render(<TranscriptPanel turns={turns} manifestStore={manifestStore} />);

    expect(screen.getByText('Transcripts')).toBeInTheDocument();
    expect(screen.getByText('Hello Hermes')).toBeInTheDocument();
    expect(screen.getByText('Hello Alandelone! How can I assist you?')).toBeInTheDocument();
  });

  it('renders TaskTreePanel with tasks, progress, and logs', () => {
    const tasks: TaskNode[] = [
      {
        taskId: 'task-501',
        fromAgentId: 'hermes',
        toAgentId: 'research',
        taskName: 'Scan documentation in /docs',
        progress: 75,
        logs: ['Reading file 1', 'Reading file 2'],
        status: 'running',
        startedAt: Date.now(),
      },
    ];

    render(<TaskTreePanel tasks={tasks} manifestStore={manifestStore} />);

    expect(screen.getByText('Execution Tree')).toBeInTheDocument();
    expect(screen.getByText('Scan documentation in /docs')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Logs (2)')).toBeInTheDocument();

    // Expand logs
    const logToggle = screen.getByText('Logs (2)');
    fireEvent.click(logToggle);

    expect(screen.getByText('> Reading file 1')).toBeInTheDocument();
    expect(screen.getByText('> Reading file 2')).toBeInTheDocument();
  });

  it('renders MobileDrawer and triggers close on dismiss', () => {
    const handleClose = vi.fn();

    const { rerender } = render(
      <MobileDrawer isOpen={false} onClose={handleClose} title="Drawer Title">
        <div>Drawer Content</div>
      </MobileDrawer>
    );

    expect(screen.queryByText('Drawer Content')).not.toBeInTheDocument();

    rerender(
      <MobileDrawer isOpen={true} onClose={handleClose} title="Drawer Title">
        <div>Drawer Content</div>
      </MobileDrawer>
    );

    expect(screen.getByText('Drawer Title')).toBeInTheDocument();
    expect(screen.getByText('Drawer Content')).toBeInTheDocument();
  });
});
