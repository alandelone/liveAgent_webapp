import React from 'react';
import { AgentDescriptor } from '../../types/protocol';
import { getAgentIcon } from './SatelliteOrb';
import { X } from 'lucide-react';

export interface DirectModeIndicatorProps {
  targetAgent: AgentDescriptor | null;
  onExit: () => void;
}

export const DirectModeIndicator: React.FC<DirectModeIndicatorProps> = ({
  targetAgent,
  onExit,
}) => {
  if (!targetAgent) return null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 rounded-full bg-slate-900/90 border border-cyan-500/40 shadow-lg shadow-cyan-500/10 backdrop-blur-md animate-fade-in"
      data-testid="direct-mode-indicator"
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-white"
        style={{ backgroundColor: targetAgent.color || '#3B82F6' }}
      >
        {getAgentIcon(targetAgent.icon)}
      </div>

      <div className="flex flex-col">
        <span className="text-[10px] uppercase font-mono tracking-wider text-cyan-400 font-bold">
          Direct Agent Mode
        </span>
        <span className="text-xs font-semibold text-slate-100">
          Talking directly to {targetAgent.name}
        </span>
      </div>

      <button
        type="button"
        onClick={onExit}
        className="ml-2 p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors flex items-center gap-1 text-[11px]"
        title="Return to Orchestrator Mode"
        data-testid="exit-direct-mode-button"
      >
        <X className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Exit</span>
      </button>
    </div>
  );
};
