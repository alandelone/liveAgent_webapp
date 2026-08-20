import React from 'react';
import { ActiveSatelliteState } from '../../state/constellationStore';
import {
  BookOpen,
  Code,
  Globe,
  Cpu,
  Brain,
  FileText,
  Terminal,
  Bot,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import clsx from 'clsx';

export interface SatelliteOrbProps {
  satellite: ActiveSatelliteState;
  isDirectTarget?: boolean;
  onSelect?: (agentId: string) => void;
  positionStyle?: React.CSSProperties;
}

export function getAgentIcon(iconName: string) {
  switch (iconName) {
    case 'book-open':
      return <BookOpen className="w-5 h-5" />;
    case 'code':
      return <Code className="w-5 h-5" />;
    case 'globe':
      return <Globe className="w-5 h-5" />;
    case 'cpu':
      return <Cpu className="w-5 h-5" />;
    case 'brain':
      return <Brain className="w-5 h-5" />;
    case 'file-text':
      return <FileText className="w-5 h-5" />;
    case 'terminal':
      return <Terminal className="w-5 h-5" />;
    default:
      return <Bot className="w-5 h-5" />;
  }
}

export const SatelliteOrb: React.FC<SatelliteOrbProps> = ({
  satellite,
  isDirectTarget = false,
  onSelect,
  positionStyle,
}) => {
  const { agent, state, detail, isDormant } = satellite;
  const isWorking = state === 'executing' || state === 'tool_call' || state === 'delegated';

  return (
    <div
      style={positionStyle}
      className={clsx(
        'absolute transition-all duration-500 flex flex-col items-center select-none z-10',
        isDormant ? 'opacity-40 scale-90' : 'opacity-100 scale-100'
      )}
      data-testid={`satellite-orb-${agent.id}`}
    >
      {/* Orb Button */}
      <button
        type="button"
        onClick={() => onSelect?.(agent.id)}
        className={clsx(
          'relative w-14 h-14 rounded-full flex items-center justify-center transition-transform active:scale-90 hover:scale-110 cursor-pointer shadow-lg',
          isDirectTarget
            ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-background scale-110'
            : isWorking
            ? 'animate-pulse'
            : ''
        )}
        style={{
          backgroundColor: '#1E293B',
          borderColor: agent.color || '#6366F1',
          borderWidth: '2px',
          boxShadow: isWorking
            ? `0 0 20px ${agent.color}60`
            : `0 0 10px ${agent.color}30`,
        }}
        title={`${agent.name} (${state}) - Tap for Direct Mode`}
      >
        <div style={{ color: agent.color || '#6366F1' }}>
          {getAgentIcon(agent.icon)}
        </div>

        {/* Live execution spinner badge */}
        {isWorking && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-white shadow-sm">
            <Loader2 className="w-3 h-3 animate-spin" />
          </span>
        )}

        {state === 'completed' && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-sm">
            <CheckCircle2 className="w-3 h-3" />
          </span>
        )}
      </button>

      {/* Agent Name & State Label */}
      <div className="mt-2 text-center pointer-events-none">
        <span className="text-xs font-semibold text-slate-200 block truncate max-w-[80px]">
          {agent.name}
        </span>
        {detail ? (
          <span className="text-[9px] text-slate-400 block truncate max-w-[90px]" title={detail}>
            {detail}
          </span>
        ) : (
          <span className="text-[9px] text-slate-500 uppercase font-mono block">
            {state}
          </span>
        )}
      </div>
    </div>
  );
};
