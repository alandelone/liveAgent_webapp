import React, { useState } from 'react';
import { Server, CheckCircle2, AlertCircle, RefreshCw, X, Link } from 'lucide-react';
import clsx from 'clsx';
import { ConnectionState } from '../../types/protocol';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUrl: string;
  connectionState: ConnectionState;
  onConnect: (url: string) => void;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  currentUrl,
  connectionState,
  onConnect,
}) => {
  const [url, setUrl] = useState(currentUrl);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onConnect(url.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5 text-white">
            <div className="p-2 rounded-lg bg-hermes/20 text-hermes border border-hermes/30">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Server Endpoint</h2>
              <p className="text-xs text-slate-400">Configure WebSocket connection</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Link className="w-3.5 h-3.5 text-hermes" />
              WebSocket URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="ws://localhost:8765/ws"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-hermes focus:ring-1 focus:ring-hermes transition-all font-mono"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Presets:</span>
            <button
              type="button"
              onClick={() => setUrl('ws://localhost:8765/ws')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-mono"
            >
              localhost:8765
            </button>
            <button
              type="button"
              onClick={() => setUrl('ws://127.0.0.1:8765/ws')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-mono"
            >
              127.0.0.1:8765
            </button>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">Current Status:</span>
            <span
              className={clsx(
                'font-medium capitalize flex items-center gap-1.5',
                connectionState === 'connected' && 'text-emerald-400',
                connectionState === 'connecting' && 'text-blue-400',
                connectionState === 'reconnecting' && 'text-amber-400',
                (connectionState === 'disconnected' || connectionState === 'error') && 'text-rose-400'
              )}
            >
              {connectionState === 'connected' && <CheckCircle2 className="w-3.5 h-3.5" />}
              {connectionState === 'connecting' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {connectionState === 'reconnecting' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {(connectionState === 'disconnected' || connectionState === 'error') && (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
              {connectionState}
            </span>
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-hermes hover:bg-hermes-hover rounded-xl shadow-lg shadow-hermes/20 transition-colors"
            >
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
