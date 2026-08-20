import React, { useMemo } from 'react';
import { ConstellationSnapshot, ActiveSatelliteState } from '../../state/constellationStore';
import { AgentRoleState, ConnectionState } from '../../types/protocol';
import { CentralHermesOrb } from '../orb/CentralHermesOrb';
import { SatelliteOrb } from './SatelliteOrb';
import { DelegationBeams, BeamCoordinates } from './DelegationBeams';
import { DirectModeIndicator } from './DirectModeIndicator';

export interface ConstellationViewProps {
  constellation: ConstellationSnapshot;
  mainState: AgentRoleState;
  connectionState?: ConnectionState;
  detail?: string;
  volume: number;
  isListening: boolean;
  isPushToTalk: boolean;
  targetAgentId: string | null;
  onToggleListening: () => void;
  onPttDown: () => void;
  onPttUp: () => void;
  onSelectAgent: (agentId: string) => void;
  onExitDirectMode: () => void;
}

export const ConstellationView: React.FC<ConstellationViewProps> = ({
  constellation,
  mainState,
  connectionState,
  detail,
  volume,
  isListening,
  isPushToTalk,
  targetAgentId,
  onToggleListening,
  onPttDown,
  onPttUp,
  onSelectAgent,
  onExitDirectMode,
}) => {
  // Combine all satellites to render (active + non-dormant first, or all with dormant styling)
  const allSatellites = useMemo(() => {
    return [...constellation.activeSatellites, ...constellation.dormantSatellites];
  }, [constellation.activeSatellites, constellation.dormantSatellites]);

  // Radius for orbiting satellites
  const radius = 175;
  const containerSize = 480;
  const centerPos = { x: containerSize / 2, y: containerSize / 2 };

  // Calculate satellite positions symmetrically
  const satelliteLayout = useMemo(() => {
    const total = allSatellites.length;
    const posMap = new Map<string, BeamCoordinates>();
    const elementPositions: Array<{
      satellite: ActiveSatelliteState;
      x: number;
      y: number;
      style: React.CSSProperties;
    }> = [];

    if (total === 0) return { posMap, elementPositions };

    allSatellites.forEach((sat, index) => {
      // Start from -pi/2 (top) and space evenly
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / total;
      const x = centerPos.x + radius * Math.cos(angle);
      const y = centerPos.y + radius * Math.sin(angle);

      posMap.set(sat.agent.id, { x, y, color: sat.agent.color });

      elementPositions.push({
        satellite: sat,
        x,
        y,
        style: {
          left: `${x}px`,
          top: `${y}px`,
          transform: 'translate(-50%, -50%)',
        },
      });
    });

    return { posMap, elementPositions };
  }, [allSatellites, centerPos.x, centerPos.y, radius]);

  const directTargetAgent = useMemo(() => {
    if (!targetAgentId) return null;
    return allSatellites.find((s) => s.agent.id === targetAgentId)?.agent ?? null;
  }, [targetAgentId, allSatellites]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center select-none overflow-hidden">
      {/* Top Direct Mode Notification Banner */}
      <div className="absolute top-4 z-30">
        <DirectModeIndicator
          targetAgent={directTargetAgent}
          onExit={onExitDirectMode}
        />
      </div>

      {/* Radial Constellation Field */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: `${containerSize}px`, height: `${containerSize}px` }}
        data-testid="constellation-field"
      >
        {/* SVG Delegation Beams */}
        <DelegationBeams
          beams={constellation.delegationBeams}
          center={centerPos}
          satellitePositions={satelliteLayout.posMap}
          width={containerSize}
          height={containerSize}
        />

        {/* Orbit track circle guide */}
        <div
          className="absolute rounded-full border border-slate-800/60 pointer-events-none"
          style={{
            width: `${radius * 2}px`,
            height: `${radius * 2}px`,
            left: `${centerPos.x - radius}px`,
            top: `${centerPos.y - radius}px`,
          }}
        />

        {/* Center Voice Agent Orb */}
        <div
          className="absolute z-20"
          style={{
            left: `${centerPos.x}px`,
            top: `${centerPos.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <CentralHermesOrb
            state={mainState}
            connectionState={connectionState}
            detail={detail}
            agentName={constellation.orchestrator?.name && constellation.orchestrator.name.toLowerCase() !== 'hermes' ? constellation.orchestrator.name : undefined}
            volume={volume}
            isListening={isListening}
            isPushToTalk={isPushToTalk}
            onToggleListening={onToggleListening}
            onPttDown={onPttDown}
            onPttUp={onPttUp}
          />
        </div>

        {/* Orbiting Satellite Orbs */}
        {satelliteLayout.elementPositions.map(({ satellite, style }) => (
          <SatelliteOrb
            key={satellite.agent.id}
            satellite={satellite}
            isDirectTarget={satellite.agent.id === targetAgentId}
            onSelect={onSelectAgent}
            positionStyle={style}
          />
        ))}
      </div>
    </div>
  );
};
