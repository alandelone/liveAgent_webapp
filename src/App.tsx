import React, { useEffect, useState } from 'react';
import { HermesEventBus } from './protocol/eventBus';
import { HermesClient } from './protocol/HermesClient';
import { ManifestStore } from './state/manifestStore';
import { ConstellationStore, ConstellationSnapshot } from './state/constellationStore';
import { ConnectionStore, ConnectionSnapshot } from './state/connectionStore';
import { AgentStateMachine, StateMachineSnapshot } from './state/agentStateMachine';
import { ModeStore, ModeSnapshot } from './state/modeStore';
import { TranscriptStore, TranscriptTurn } from './state/transcriptStore';
import { TaskTreeStore, TaskNode } from './state/taskTreeStore';
import { LayoutStore, LayoutSnapshot } from './state/layoutStore';
import { VoiceController } from './audio/voiceController';

import { ConstellationView } from './components/constellation/ConstellationView';
import { InputFallbackBar } from './components/voice/InputFallbackBar';
import { TranscriptPanel } from './components/panels/TranscriptPanel';
import { TaskTreePanel } from './components/panels/TaskTreePanel';
import { MobileDrawer } from './components/panels/MobileDrawer';
import { ConnectionModal } from './components/panels/ConnectionModal';

import {
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  MessageSquare,
  Network,
} from 'lucide-react';
import clsx from 'clsx';

const getInitialWsUrl = (): string => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const wsParam = params.get('ws');
    if (wsParam) return wsParam;
    const stored = localStorage.getItem('hermes_ws_url');
    if (stored) return stored;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_HERMES_WS_URL) {
    return import.meta.env.VITE_HERMES_WS_URL as string;
  }
  return 'ws://localhost:8765/ws';
};

const eventBus = new HermesEventBus();
const initialWsUrl = getInitialWsUrl();
const client = new HermesClient({ url: initialWsUrl }, eventBus);
const manifestStore = new ManifestStore(eventBus);
const constellationStore = new ConstellationStore(manifestStore, eventBus);
const connectionStore = new ConnectionStore(eventBus, client.getSessionId());
const stateMachine = new AgentStateMachine(eventBus);
const modeStore = new ModeStore(client, manifestStore);
const transcriptStore = new TranscriptStore(eventBus);
const taskTreeStore = new TaskTreeStore(eventBus);
const layoutStore = new LayoutStore();
const voiceController = new VoiceController(client, stateMachine);

export const App: React.FC = () => {
  const [connection, setConnection] = useState<ConnectionSnapshot>(connectionStore.getSnapshot());
  const [constellation, setConstellation] = useState<ConstellationSnapshot>(constellationStore.getSnapshot());
  const [agentState, setAgentState] = useState<StateMachineSnapshot>(stateMachine.getSnapshot());
  const [mode, setMode] = useState<ModeSnapshot>(modeStore.getSnapshot());
  const [turns, setTurns] = useState<TranscriptTurn[]>(transcriptStore.getTurns());
  const [tasks, setTasks] = useState<TaskNode[]>(taskTreeStore.getTasks());
  const [layout, setLayout] = useState<LayoutSnapshot>(layoutStore.getSnapshot());
  const [volume, setVolume] = useState<number>(0);
  const [isPtt, setIsPtt] = useState<boolean>(voiceController.getIsPushToTalk());
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);
  const [currentWsUrl, setCurrentWsUrl] = useState<string>(initialWsUrl);

  useEffect(() => {
    const unsubConn = connectionStore.subscribe(setConnection);
    const unsubConst = constellationStore.subscribe(setConstellation);
    const unsubState = stateMachine.subscribe(setAgentState);
    const unsubMode = modeStore.subscribe(setMode);
    const unsubTranscript = transcriptStore.subscribe(setTurns);
    const unsubTasks = taskTreeStore.subscribe(setTasks);
    const unsubLayout = layoutStore.subscribe(setLayout);
    const unsubVol = voiceController.playbackQueue.onVolumeChange(setVolume);
    const unsubMicVol = voiceController.onMicVolumeChange((vol) => {
      if (stateMachine.getSnapshot().isListening) {
        setVolume(vol);
      }
    });

    // Auto connect
    client.connect();

    return () => {
      unsubConn();
      unsubConst();
      unsubState();
      unsubMode();
      unsubTranscript();
      unsubTasks();
      unsubLayout();
      unsubVol();
      unsubMicVol();
      voiceController.dispose();
      client.disconnect();
    };
  }, []);

  const handleToggleListening = () => {
    voiceController.toggleListening();
  };

  const handlePttDown = () => {
    voiceController.handlePttPress();
  };

  const handlePttUp = () => {
    voiceController.handlePttRelease();
  };

  const handleSendText = (text: string) => {
    voiceController.sendText(text);
  };

  const handleTogglePtt = (enabled: boolean) => {
    voiceController.setPushToTalk(enabled);
    setIsPtt(enabled);
  };

  const handleSelectAgent = (agentId: string) => {
    if (mode.targetAgentId === agentId) {
      modeStore.clearTargetAgent();
    } else {
      modeStore.setTargetAgent(agentId);
    }
  };

  const handleExitDirectMode = () => {
    modeStore.clearTargetAgent();
  };

  const handleUpdateWsUrl = (newUrl: string) => {
    setCurrentWsUrl(newUrl);
    if (typeof window !== 'undefined') {
      localStorage.setItem('hermes_ws_url', newUrl);
    }
    client.disconnect();
    client.connect(newUrl);
  };

  const activeTaskCount = tasks.filter((t) => t.status === 'running').length;

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-slate-100 select-none overflow-hidden">
      {/* Header bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-surface/60 backdrop-blur-md z-30 shrink-0">
        <div className="flex items-center gap-3">
          {/* Left panel toggle (desktop) */}
          <button
            type="button"
            onClick={() => layoutStore.toggleLeftPanel()}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title={layout.isLeftPanelOpen ? 'Collapse Transcripts' : 'Open Transcripts'}
          >
            {layout.isLeftPanelOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>

          <div>
            <h1 className="text-sm font-semibold text-white tracking-wide">Live Agent</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile Drawer Trigger Buttons */}
          <div className="flex lg:hidden items-center gap-1.5">
            <button
              type="button"
              onClick={() => layoutStore.setMobileDrawer('transcript')}
              className={clsx(
                'px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1 transition-colors',
                turns.length > 0
                  ? 'bg-slate-800 border-slate-700 text-slate-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-500'
              )}
            >
              <MessageSquare className="w-3.5 h-3.5 text-hermes" />
              <span>{turns.length}</span>
            </button>

            <button
              type="button"
              onClick={() => layoutStore.setMobileDrawer('tasks')}
              className={clsx(
                'px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1 transition-colors',
                activeTaskCount > 0
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300 animate-pulse'
                  : 'bg-slate-900/60 border-slate-800 text-slate-500'
              )}
            >
              <Network className="w-3.5 h-3.5 text-cyan-400" />
              <span>{tasks.length}</span>
            </button>
          </div>

          {/* Settings Button */}
          <button
            type="button"
            onClick={() => setIsConnectionModalOpen(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Connection Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Right panel toggle (desktop) */}
          <button
            type="button"
            onClick={() => layoutStore.toggleRightPanel()}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title={layout.isRightPanelOpen ? 'Collapse Tasks' : 'Open Tasks'}
          >
            {layout.isRightPanelOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {/* Main 3-Pane Responsive Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Pane: Transcripts (Desktop) */}
        {layout.isLeftPanelOpen && (
          <aside className="hidden lg:flex w-80 xl:w-96 shrink-0 h-full z-10 transition-all">
            <TranscriptPanel
              turns={turns}
              manifestStore={manifestStore}
              onClose={() => layoutStore.setLeftPanelOpen(false)}
            />
          </aside>
        )}

        {/* Center Pane: Spatial Constellation Voice Room */}
        <main className="flex-1 flex flex-col justify-between relative overflow-hidden bg-background">
          {/* Spatial background glow */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
            <div className="w-96 h-96 rounded-full bg-hermes/10 filter blur-3xl animate-pulse-slow" />
          </div>

          {/* Spatial Constellation Field */}
          <div className="flex-1 relative flex items-center justify-center overflow-hidden">
            <ConstellationView
              constellation={constellation}
              mainState={agentState.mainState}
              connectionState={connection.state}
              detail={agentState.detail}
              volume={volume}
              isListening={agentState.isListening}
              isPushToTalk={isPtt}
              targetAgentId={mode.targetAgentId}
              onToggleListening={handleToggleListening}
              onPttDown={handlePttDown}
              onPttUp={handlePttUp}
              onSelectAgent={handleSelectAgent}
              onExitDirectMode={handleExitDirectMode}
            />
          </div>

          {/* Bottom Input Fallback & Mode Control Bar */}
          <footer className="pb-5 pt-2 px-4 z-20 shrink-0">
            <InputFallbackBar
              onSendText={handleSendText}
              isListening={agentState.isListening}
              isPushToTalk={isPtt}
              onTogglePtt={handleTogglePtt}
              onToggleListening={handleToggleListening}
              disabled={connection.state !== 'connected'}
            />
          </footer>
        </main>

        {/* Right Pane: Task Tree & Logs (Desktop) */}
        {layout.isRightPanelOpen && (
          <aside className="hidden lg:flex w-80 xl:w-96 shrink-0 h-full z-10 transition-all">
            <TaskTreePanel
              tasks={tasks}
              manifestStore={manifestStore}
              onClose={() => layoutStore.setRightPanelOpen(false)}
            />
          </aside>
        )}
      </div>

      {/* Mobile Drawers */}
      <MobileDrawer
        isOpen={layout.mobileDrawer === 'transcript'}
        onClose={() => layoutStore.closeMobileDrawer()}
        title="Streaming Transcripts"
      >
        <TranscriptPanel turns={turns} manifestStore={manifestStore} />
      </MobileDrawer>

      <MobileDrawer
        isOpen={layout.mobileDrawer === 'tasks'}
        onClose={() => layoutStore.closeMobileDrawer()}
        title="Multi-Agent Task Tree"
      >
        <TaskTreePanel tasks={tasks} manifestStore={manifestStore} />
      </MobileDrawer>

      {/* Connection Settings Modal */}
      <ConnectionModal
        isOpen={isConnectionModalOpen}
        onClose={() => setIsConnectionModalOpen(false)}
        currentUrl={currentWsUrl}
        connectionState={connection.state}
        onConnect={handleUpdateWsUrl}
      />
    </div>
  );
};

export default App;
