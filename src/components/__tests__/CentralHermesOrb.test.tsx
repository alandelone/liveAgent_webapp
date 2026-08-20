import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CentralHermesOrb } from '../orb/CentralHermesOrb';

describe('CentralHermesOrb (FEAT-008)', () => {
  it('renders correctly in idle state with clean UI and optional custom agent label', () => {
    const { rerender } = render(<CentralHermesOrb state="idle" agentName="SpecialAgent" />);
    expect(screen.getByTestId('central-hermes-orb')).toBeInTheDocument();
    expect(screen.getByTestId('orb-button')).toBeInTheDocument();

    rerender(<CentralHermesOrb state="listening" agentName="CustomAgent" />);
    expect(screen.getByText('CustomAgent')).toBeInTheDocument();
    expect(screen.getByText('listening')).toBeInTheDocument();
    expect(screen.getByText('Listening...')).toBeInTheDocument();
  });

  it('triggers onToggleListening callback when orb is clicked in tap mode', () => {
    const handleToggle = vi.fn();
    render(<CentralHermesOrb state="idle" isListening={false} onToggleListening={handleToggle} />);

    const button = screen.getByTestId('orb-button');
    fireEvent.click(button);

    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it('supports Push-to-Talk touch and mouse hold interactions', () => {
    const handlePttDown = vi.fn();
    const handlePttUp = vi.fn();

    render(
      <CentralHermesOrb
        state="idle"
        isPushToTalk={true}
        onPttDown={handlePttDown}
        onPttUp={handlePttUp}
      />
    );

    const button = screen.getByTestId('orb-button');

    fireEvent.mouseDown(button);
    expect(handlePttDown).toHaveBeenCalledTimes(1);

    fireEvent.mouseUp(button);
    expect(handlePttUp).toHaveBeenCalledTimes(1);
  });

  it('renders distinct visual status text across states', () => {
    const { rerender } = render(<CentralHermesOrb state="listening" isListening={true} />);
    expect(screen.getByText('Listening...')).toBeInTheDocument();

    rerender(<CentralHermesOrb state="thinking" />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();

    rerender(<CentralHermesOrb state="speaking" />);
    expect(screen.getByText('Speaking...')).toBeInTheDocument();

    rerender(<CentralHermesOrb state="executing" detail="Running test suite" />);
    expect(screen.getByText('Running test suite')).toBeInTheDocument();
  });

  it('renders connection state badges and indicators when disconnected or reconnecting', () => {
    const { rerender } = render(<CentralHermesOrb state="idle" connectionState="reconnecting" />);
    expect(screen.getByText('reconnecting')).toBeInTheDocument();
    expect(screen.getByText('Reconnecting to server...')).toBeInTheDocument();

    rerender(<CentralHermesOrb state="idle" connectionState="connected" />);
    expect(screen.getByText('idle')).toBeInTheDocument();
  });
});
