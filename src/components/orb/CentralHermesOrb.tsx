import React from 'react';
import { AgentRoleState, ConnectionState } from '../../types/protocol';
import { Mic, Brain, Volume2, Cog, AlertCircle, Sparkles, RefreshCw, Radio } from 'lucide-react';
import clsx from 'clsx';

export interface CentralHermesOrbProps {
  state: AgentRoleState;
  connectionState?: ConnectionState;
  detail?: string;
  agentName?: string;
  volume?: number; // 0..1 audio reactivity
  isListening?: boolean;
  isPushToTalk?: boolean;
  onToggleListening?: () => void;
  onPttDown?: () => void;
  onPttUp?: () => void;
}

export const CentralHermesOrb: React.FC<CentralHermesOrbProps> = ({
  state,
  connectionState,
  detail,
  agentName,
  volume = 0,
  isListening = false,
  isPushToTalk = false,
  onToggleListening,
  onPttDown,
  onPttUp,
}) => {
  // Normalize volume 0..1
  const vol = Math.min(1, Math.max(0, volume));
  const orbScale = 1 + vol * 0.28;

  const isConnected = connectionState === undefined || connectionState === 'connected';

  const renderIcon = () => {
    if (!isConnected) {
      switch (connectionState) {
        case 'reconnecting':
          return <RefreshCw className="w-12 h-12 text-amber-300 animate-spin" />;
        case 'connecting':
          return <Radio className="w-12 h-12 text-blue-300 animate-pulse" />;
        default:
          return <AlertCircle className="w-12 h-12 text-rose-400" />;
      }
    }

    switch (state) {
      case 'listening':
        return (
          <Mic
            className="w-12 h-12 text-cyan-300 transition-transform duration-100"
            style={{ transform: `scale(${1 + vol * 0.25})` }}
          />
        );
      case 'thinking':
      case 'delegating':
        return <Brain className="w-12 h-12 text-purple-200 animate-spin" style={{ animationDuration: '4s' }} />;
      case 'speaking':
        return (
          <Volume2
            className="w-12 h-12 text-emerald-300 transition-transform duration-100"
            style={{ transform: `scale(${1 + vol * 0.3})` }}
          />
        );
      case 'executing':
        return <Cog className="w-12 h-12 text-blue-300 animate-spin" style={{ animationDuration: '2.5s' }} />;
      case 'error':
        return <AlertCircle className="w-12 h-12 text-rose-300" />;
      default:
        return <Sparkles className="w-12 h-12 text-indigo-200" />;
    }
  };

  const getGradient = () => {
    if (!isConnected) {
      switch (connectionState) {
        case 'reconnecting':
          return 'from-amber-600 via-orange-600 to-slate-800 shadow-amber-500/40';
        case 'connecting':
          return 'from-blue-600 via-indigo-700 to-slate-800 shadow-blue-500/40';
        default:
          return 'from-slate-700 via-slate-800 to-slate-900 shadow-slate-700/40';
      }
    }

    switch (state) {
      case 'listening':
        return 'from-cyan-600 via-sky-500 to-indigo-600 shadow-cyan-500/40';
      case 'thinking':
      case 'delegating':
        return 'from-purple-600 via-indigo-600 to-fuchsia-600 shadow-purple-500/40';
      case 'speaking':
        return 'from-emerald-600 via-teal-500 to-indigo-600 shadow-emerald-500/40';
      case 'executing':
        return 'from-blue-600 via-indigo-600 to-cyan-600 shadow-blue-500/40';
      case 'interrupted':
        return 'from-amber-600 via-orange-500 to-rose-600 shadow-amber-500/40';
      case 'error':
        return 'from-rose-600 via-red-500 to-orange-600 shadow-rose-500/40';
      default:
        return 'from-indigo-600 via-hermes to-purple-600 shadow-hermes/40';
    }
  };

  const getTagInfo = () => {
    if (!isConnected) {
      switch (connectionState) {
        case 'reconnecting':
          return {
            label: 'reconnecting',
            className: 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse',
            dot: 'bg-amber-400 animate-ping',
          };
        case 'connecting':
          return {
            label: 'connecting',
            className: 'bg-blue-500/20 text-blue-300 border-blue-500/40 animate-pulse',
            dot: 'bg-blue-400',
          };
        default:
          return {
            label: 'offline',
            className: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
            dot: 'bg-rose-400',
          };
      }
    }

    switch (state) {
      case 'idle':
        return {
          label: 'idle',
          className: 'bg-slate-800/80 text-slate-300 border-slate-700/60',
          dot: 'bg-emerald-400',
        };
      case 'listening':
        return {
          label: 'listening',
          className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse',
          dot: 'bg-cyan-400',
        };
      case 'thinking':
      case 'delegating':
        return {
          label: state,
          className: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
          dot: 'bg-purple-400',
        };
      case 'speaking':
        return {
          label: 'speaking',
          className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          dot: 'bg-emerald-400',
        };
      case 'executing':
        return {
          label: 'executing',
          className: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
          dot: 'bg-blue-400',
        };
      case 'error':
        return {
          label: 'error',
          className: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          dot: 'bg-rose-400',
        };
      default:
        return {
          label: state,
          className: 'bg-slate-800/80 text-slate-300 border-slate-700/60',
          dot: 'bg-indigo-400',
        };
    }
  };

  const getStatusText = () => {
    if (!isConnected) {
      switch (connectionState) {
        case 'reconnecting':
          return 'Reconnecting to server...';
        case 'connecting':
          return 'Connecting to server...';
        default:
          return 'Offline';
      }
    }
    if (detail) return detail;
    switch (state) {
      case 'listening':
        return 'Listening...';
      case 'thinking':
        return 'Thinking...';
      case 'speaking':
        return 'Speaking...';
      case 'executing':
        return 'Executing tasks...';
      case 'delegating':
        return 'Delegating to subagents...';
      case 'interrupted':
        return 'Interrupted';
      case 'error':
        return 'Connection or agent error';
      default:
        return '';
    }
  };

  const tagInfo = getTagInfo();
  const statusText = getStatusText();
  const showAgentBadge = agentName && agentName.toLowerCase() !== 'hermes';

  return (
    <div className="relative flex flex-col items-center select-none" data-testid="central-hermes-orb">
      {/* Sound-Reactive Concentric Wave Ripples */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Wave Ring 1 (Inner Wave) */}
        <div
          className="absolute w-36 h-36 rounded-full border border-cyan-400/50 bg-cyan-500/5 pointer-events-none transition-all duration-100 ease-out"
          style={{
            transform: `scale(${1.12 + vol * 0.45})`,
            opacity: isListening ? Math.max(0.25, vol * 0.85) : Math.max(0.12, vol * 0.85),
            boxShadow: `0 0 ${15 + vol * 30}px rgba(56, 189, 248, ${0.15 + vol * 0.4})`,
          }}
        />

        {/* Wave Ring 2 (Middle Wave) */}
        <div
          className="absolute w-36 h-36 rounded-full border border-indigo-400/40 bg-indigo-500/5 pointer-events-none transition-all duration-150 ease-out"
          style={{
            transform: `scale(${1.28 + vol * 0.9})`,
            opacity: isListening ? Math.max(0.15, vol * 0.65) : Math.max(0.08, vol * 0.65),
            boxShadow: `0 0 ${20 + vol * 40}px rgba(99, 102, 241, ${0.1 + vol * 0.3})`,
          }}
        />

        {/* Wave Ring 3 (Outer Wave) */}
        <div
          className="absolute w-36 h-36 rounded-full border border-purple-400/30 bg-purple-500/5 pointer-events-none transition-all duration-200 ease-out"
          style={{
            transform: `scale(${1.48 + vol * 1.4})`,
            opacity: isListening ? Math.max(0.08, vol * 0.45) : Math.max(0.04, vol * 0.45),
            boxShadow: `0 0 ${25 + vol * 50}px rgba(168, 85, 247, ${0.05 + vol * 0.25})`,
          }}
        />

        {/* Wave Ring 4 (Ambient Ripple when voice is loud or listening active) */}
        {(vol > 0.08 || (isListening && vol > 0.02)) && (
          <div
            className="absolute w-36 h-36 rounded-full border border-cyan-300/20 pointer-events-none transition-all duration-300 ease-out"
            style={{
              transform: `scale(${1.7 + vol * 1.9})`,
              opacity: vol * 0.35,
            }}
          />
        )}
      </div>

      {/* Main Orb Sphere */}
      <button
        type="button"
        data-testid="orb-button"
        onClick={!isPushToTalk ? onToggleListening : undefined}
        onMouseDown={isPushToTalk ? onPttDown : undefined}
        onMouseUp={isPushToTalk ? onPttUp : undefined}
        onTouchStart={isPushToTalk ? onPttDown : undefined}
        onTouchEnd={isPushToTalk ? onPttUp : undefined}
        disabled={!isConnected}
        className={clsx(
          'relative z-10 w-36 h-36 rounded-full bg-gradient-to-tr flex items-center justify-center shadow-2xl transition-transform duration-100 ease-out transform active:scale-95 focus:outline-none focus:ring-4 focus:ring-hermes/50',
          getGradient(),
          isConnected ? 'cursor-pointer' : 'cursor-not-allowed opacity-90',
          state === 'idle' && vol === 0 && isConnected && 'hover:scale-105 animate-pulse-slow'
        )}
        style={{ transform: `scale(${orbScale})` }}
        aria-label={`Voice agent orb: current state ${tagInfo.label}`}
      >
        {/* Inner specular gloss */}
        <div className="absolute inset-2 rounded-full bg-white/10 blur-[1px] pointer-events-none" />
        <div className="relative z-10">{renderIcon()}</div>
      </button>

      {/* State & Connection Tag Indicator */}
      <div className="mt-6 text-center max-w-xs transition-opacity duration-200">
        <div className="flex items-center justify-center gap-2">
          {showAgentBadge && (
            <span className="text-base font-bold text-white tracking-wide">{agentName}</span>
          )}
          <span
            className={clsx(
              'text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 shadow-sm',
              tagInfo.className
            )}
          >
            <span className={clsx('w-1.5 h-1.5 rounded-full', tagInfo.dot)} />
            {tagInfo.label}
          </span>
        </div>
        {statusText && (
          <p className="text-xs text-slate-400 mt-1.5 truncate px-2" title={statusText}>
            {statusText}
          </p>
        )}
      </div>
    </div>
  );
};
