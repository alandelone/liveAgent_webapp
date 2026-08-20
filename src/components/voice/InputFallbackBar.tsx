import React, { useState } from 'react';
import { Send, Mic, Radio } from 'lucide-react';
import clsx from 'clsx';

export interface InputFallbackBarProps {
  onSendText: (text: string) => void;
  isListening: boolean;
  isPushToTalk: boolean;
  onTogglePtt: (enabled: boolean) => void;
  onToggleListening: () => void;
  disabled?: boolean;
}

export const InputFallbackBar: React.FC<InputFallbackBarProps> = ({
  onSendText,
  isListening,
  isPushToTalk,
  onTogglePtt,
  onToggleListening,
  disabled = false,
}) => {
  const [inputText, setInputText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim() && !disabled) {
      onSendText(inputText.trim());
      setInputText('');
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-3 bg-surface/80 backdrop-blur-md border border-slate-800 rounded-2xl shadow-xl">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        {/* Mic / PTT Quick Toggle */}
        <button
          type="button"
          onClick={() => onTogglePtt(!isPushToTalk)}
          className={clsx(
            'p-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all',
            isPushToTalk
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
              : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
          )}
          title={isPushToTalk ? 'Push-To-Talk Enabled' : 'Continuous / Tap Mode'}
        >
          <Radio className="w-4 h-4" />
          <span className="hidden sm:inline">{isPushToTalk ? 'PTT On' : 'PTT Off'}</span>
        </button>

        {/* Text Input */}
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={isListening ? 'Listening... or type message / code here...' : 'Type message, code, or command...'}
          disabled={disabled}
          className="flex-1 bg-slate-900/90 border border-slate-700/80 focus:border-hermes focus:ring-1 focus:ring-hermes rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
        />

        {/* Send Button */}
        <button
          type="submit"
          disabled={!inputText.trim() || disabled}
          className={clsx(
            'p-2.5 rounded-xl flex items-center justify-center transition-all',
            inputText.trim() && !disabled
              ? 'bg-hermes hover:bg-indigo-500 text-white shadow-md shadow-hermes/30 cursor-pointer'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
          )}
          title="Send message"
        >
          <Send className="w-4 h-4" />
        </button>

        {/* Mic Action Button */}
        <button
          type="button"
          onClick={onToggleListening}
          disabled={disabled}
          className={clsx(
            'p-2.5 rounded-xl border flex items-center justify-center transition-all',
            isListening
              ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
              : 'bg-indigo-600/20 text-indigo-400 border-indigo-500/40 hover:bg-indigo-600/30'
          )}
          title={isListening ? 'Stop listening' : 'Start listening'}
        >
          <Mic className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
