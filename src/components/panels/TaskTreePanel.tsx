import React, { useState } from 'react';
import { TaskNode } from '../../state/taskTreeStore';
import { ManifestStore } from '../../state/manifestStore';
import { Network, CheckCircle2, Loader2, AlertCircle, ChevronDown, ChevronRight, Terminal, X } from 'lucide-react';
import { getAgentIcon } from '../constellation/SatelliteOrb';
import clsx from 'clsx';

export interface TaskTreePanelProps {
  tasks: TaskNode[];
  manifestStore: ManifestStore;
  onClose?: () => void;
}

export const TaskTreePanel: React.FC<TaskTreePanelProps> = ({
  tasks,
  manifestStore,
  onClose,
}) => {
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});

  const toggleLogs = (taskId: string) => {
    setExpandedLogs((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const runningCount = tasks.filter((t) => t.status === 'running').length;

  return (
    <div
      className="flex flex-col h-full bg-surface/90 backdrop-blur-md border-l border-slate-800 text-slate-100 select-none overflow-hidden"
      data-testid="task-tree-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-surface-elevated/40">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Execution Tree</span>
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 animate-pulse">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              {runningCount} active
            </span>
          )}
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

      {/* Task Nodes List */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 py-12">
            <Network className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-xs">No active or completed tasks.</p>
            <p className="text-[11px] text-slate-600 mt-1">Delegated agent tasks will appear here.</p>
          </div>
        ) : (
          tasks.map((task) => {
            const targetAgent = manifestStore.getAgentById(task.toAgentId) || {
              id: task.toAgentId,
              name: task.toAgentId,
              color: '#3B82F6',
              icon: 'cpu',
            };

            const isExpanded = !!expandedLogs[task.taskId];

            return (
              <div
                key={task.taskId}
                className="p-3 rounded-xl bg-surface-elevated/70 border border-slate-700/60 shadow-sm transition-all"
                data-testid={`task-node-${task.taskId}`}
              >
                {/* Agent & Task Name */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs shrink-0"
                      style={{ backgroundColor: targetAgent.color }}
                    >
                      {getAgentIcon(targetAgent.icon)}
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-white block">
                        {targetAgent.name}
                      </span>
                      <span className="text-[11px] text-slate-300 block line-clamp-1">
                        {task.taskName}
                      </span>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {task.status === 'running' && (
                      <span className="flex items-center gap-1 text-[10px] text-blue-400 font-mono">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {task.progress}%
                      </span>
                    )}
                    {task.status === 'completed' && (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Done
                      </span>
                    )}
                    {task.status === 'failed' && (
                      <span className="flex items-center gap-1 text-[10px] text-rose-400 font-mono">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Failed
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-1.5 bg-slate-800 rounded-full mt-2.5 overflow-hidden">
                  <div
                    className={clsx(
                      'h-full transition-all duration-300',
                      task.status === 'completed'
                        ? 'bg-emerald-500'
                        : task.status === 'failed'
                        ? 'bg-rose-500'
                        : 'bg-blue-500 animate-pulse'
                    )}
                    style={{ width: `${task.progress}%` }}
                  />
                </div>

                {/* Result Summary */}
                {task.resultSummary && (
                  <div className="mt-2.5 p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 text-[11px] text-emerald-300">
                    <span className="font-semibold block mb-0.5">Result:</span>
                    {task.resultSummary}
                  </div>
                )}

                {/* Execution Logs Drawer */}
                {task.logs.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => toggleLogs(task.taskId)}
                      className="flex items-center justify-between w-full text-[10px] text-slate-400 hover:text-slate-200 transition-colors py-0.5"
                    >
                      <div className="flex items-center gap-1">
                        <Terminal className="w-3 h-3" />
                        <span>Logs ({task.logs.length})</span>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="mt-1.5 p-2 rounded-lg bg-black/60 font-mono text-[10px] text-slate-300 space-y-1 max-h-32 overflow-y-auto">
                        {task.logs.map((log, li) => (
                          <div key={li} className="break-all leading-tight">
                            &gt; {log}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Read-only Invariant Notice */}
      <div className="px-4 py-2 border-t border-slate-800 text-[10px] font-mono text-slate-500 text-center bg-surface-elevated/20">
        Read-Only Telemetry
      </div>
    </div>
  );
};
