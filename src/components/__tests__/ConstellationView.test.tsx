import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConstellationView } from '../constellation/ConstellationView';
import { ConstellationSnapshot } from '../../state/constellationStore';

const mockConstellation: ConstellationSnapshot = {
  orchestrator: { id: 'hermes', name: 'Hermes', color: '#6366F1', icon: 'brain', isOrchestrator: true },
  orchestratorState: 'idle',
  activeSatellites: [
    {
      agent: { id: 'research', name: 'Research', color: '#A855F7', icon: 'book-open' },
      state: 'executing',
      detail: 'Scanning files',
      lastActiveTimestamp: Date.now(),
      isDormant: false,
    },
  ],
  dormantSatellites: [
    {
      agent: { id: 'coding', name: 'Coding', color: '#3B82F6', icon: 'code' },
      state: 'idle',
      detail: undefined,
      lastActiveTimestamp: 0,
      isDormant: true,
    },
  ],
  delegationBeams: [
    {
      taskId: 'task-501',
      fromAgentId: 'hermes',
      toAgentId: 'research',
      taskName: 'Scan documentation in /docs',
      startedAt: Date.now(),
    },
  ],
};

describe('ConstellationView & Multi-Agent Visuals (FEAT-009 & FEAT-010)', () => {
  it('renders central orb, satellite orbs, and active delegation beams', () => {
    const handleToggleListening = vi.fn();
    const handleSelectAgent = vi.fn();
    const handleExitDirectMode = vi.fn();

    render(
      <ConstellationView
        constellation={mockConstellation}
        mainState="idle"
        volume={0}
        isListening={false}
        isPushToTalk={false}
        targetAgentId={null}
        onToggleListening={handleToggleListening}
        onPttDown={vi.fn()}
        onPttUp={vi.fn()}
        onSelectAgent={handleSelectAgent}
        onExitDirectMode={handleExitDirectMode}
      />
    );

    // Verify center orb rendered
    expect(screen.getByTestId('central-hermes-orb')).toBeInTheDocument();

    // Verify satellite orbs rendered
    expect(screen.getByTestId('satellite-orb-research')).toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Scanning files')).toBeInTheDocument();
    expect(screen.getByTestId('satellite-orb-coding')).toBeInTheDocument();
    expect(screen.getByText('Coding')).toBeInTheDocument();

    // Verify delegation beams rendered
    expect(screen.getByTestId('delegation-beams-svg')).toBeInTheDocument();
  });

  it('selects an agent for Direct Mode when satellite orb is clicked', () => {
    const handleSelectAgent = vi.fn();

    render(
      <ConstellationView
        constellation={mockConstellation}
        mainState="idle"
        volume={0}
        isListening={false}
        isPushToTalk={false}
        targetAgentId={null}
        onToggleListening={vi.fn()}
        onPttDown={vi.fn()}
        onPttUp={vi.fn()}
        onSelectAgent={handleSelectAgent}
        onExitDirectMode={vi.fn()}
      />
    );

    const codingOrb = screen.getByTestId('satellite-orb-coding').querySelector('button')!;
    fireEvent.click(codingOrb);

    expect(handleSelectAgent).toHaveBeenCalledWith('coding');
  });

  it('displays DirectModeIndicator when targetAgentId is active', () => {
    const handleExit = vi.fn();

    render(
      <ConstellationView
        constellation={mockConstellation}
        mainState="idle"
        volume={0}
        isListening={false}
        isPushToTalk={false}
        targetAgentId="research"
        onToggleListening={vi.fn()}
        onPttDown={vi.fn()}
        onPttUp={vi.fn()}
        onSelectAgent={vi.fn()}
        onExitDirectMode={handleExit}
      />
    );

    expect(screen.getByTestId('direct-mode-indicator')).toBeInTheDocument();
    expect(screen.getByText('Talking directly to Research')).toBeInTheDocument();

    const exitBtn = screen.getByTestId('exit-direct-mode-button');
    fireEvent.click(exitBtn);
    expect(handleExit).toHaveBeenCalledTimes(1);
  });
});
