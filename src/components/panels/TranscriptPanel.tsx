import React, { useEffect, useRef } from 'react';
import { TranscriptTurn } from '../../state/transcriptStore';
import { ManifestStore } from '../../state/manifestStore';
import { MessageSquare, User, FileCode, AlertTriangle, X } from 'lucide-react';
import { getAgentIcon } from '../constellation/SatelliteOrb';

export interface TranscriptPanelProps {
  turns: TranscriptTurn[];
  manifestStore: ManifestStore;
  onClose?: () => void;
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  turns,
  manifestStore,
  onClose,
}) => {
  const scrollEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new text
  useEffect(() => {
    if (typeof scrollEndRef.current?.scrollIntoView === 'function') {
      scrollEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [turns]);

  return (
    <div
      className="flex flex-col h-full bg-surface/90 backdrop-blur-md border-r border-slate-800 text-slate-100 select-text overflow-hidden"
      data-testid="transcript-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-surface-elevated/40">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-hermes" />
          <span className="text-sm font-semibold text-white">Transcripts</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
            {turns.length}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Message List */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {turns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 py-12">
            <MessageSquare className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-xs">No transcripts yet.</p>
            <p className="text-[11px] text-slate-600 mt-1">Speak or type a prompt to start.</p>
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.turnId} className="space-y-3">
              {/* User Bubble */}
              {turn.userText && (
                <div className="flex items-start justify-end gap-2">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-600 px-3.5 py-2 text-sm text-white shadow-md">
                    <p className="whitespace-pre-wrap break-words">{turn.userText}</p>
                    {turn.isPartialUserText && (
                      <span className="inline-block w-1.5 h-3 ml-1 bg-white/60 animate-pulse align-middle" />
                    )}
                  </div>
                  <div className="w-6 h-6 rounded-full bg-indigo-700 flex items-center justify-center text-white text-xs shrink-0 mt-1">
                    <User className="w-3.5 h-3.5" />
                  </div>
                </div>
              )}

              {/* Agent Responses */}
              {turn.agentResponses.map((resp, i) => {
                const agent = manifestStore.getAgentById(resp.agentId) || {
                  id: resp.agentId,
                  name: resp.agentId === 'hermes' ? 'Agent' : resp.agentId,
                  color: '#6366F1',
                  icon: 'brain',
                };
                const displayName = agent.name === 'Hermes' ? 'Agent' : agent.name;

                return (
                  <div key={i} className="flex items-start gap-2.5">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs shrink-0 mt-1"
                      style={{ backgroundColor: agent.color }}
                    >
                      {getAgentIcon(agent.icon)}
                    </div>
                    <div className="flex-1 max-w-[85%] rounded-2xl rounded-tl-sm bg-surface-elevated border border-slate-700/60 px-3.5 py-2.5 text-sm text-slate-200 shadow-sm">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs font-semibold text-white" style={{ color: agent.color }}>
                          {displayName}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap break-words leading-relaxed text-xs sm:text-sm">
                        {resp.text}
                        {!resp.isFinal && (
                          <span className="inline-block w-1.5 h-3 ml-1 bg-hermes animate-pulse align-middle" />
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}

              {/* Artifact attachments */}
              {turn.artifacts.map((art) => (
                <div
                  key={art.name}
                  className="ml-8 p-3 rounded-xl bg-slate-900 border border-slate-700/80 text-xs shadow-md space-y-1.5"
                >
                  <div className="flex items-center justify-between text-slate-300">
                    <div className="flex items-center gap-1.5 font-medium">
                      <FileCode className="w-4 h-4 text-cyan-400" />
                      <span>{art.name}</span>
                    </div>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      {art.artifactType}
                    </span>
                  </div>
                  {art.preview && (
                    <pre className="p-2 rounded bg-black/50 text-[11px] font-mono text-slate-300 overflow-x-auto">
                      {art.preview}
                    </pre>
                  )}
                </div>
              ))}

              {/* Error notice */}
              {turn.error && (
                <div className="ml-8 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{turn.error.message}</span>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={scrollEndRef} />
      </div>
    </div>
  );
};
