import React from 'react';
import { DelegationBeam } from '../../state/constellationStore';

export interface BeamCoordinates {
  x: number;
  y: number;
  color?: string;
}

export interface DelegationBeamsProps {
  beams: DelegationBeam[];
  center: { x: number; y: number };
  satellitePositions: Map<string, BeamCoordinates>;
  width?: number;
  height?: number;
}

export const DelegationBeams: React.FC<DelegationBeamsProps> = ({
  beams,
  center,
  satellitePositions,
  width = 600,
  height = 600,
}) => {
  if (beams.length === 0) {
    return null;
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-testid="delegation-beams-svg"
    >
      <defs>
        <filter id="beam-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {beams.map((beam) => {
        const targetPos = satellitePositions.get(beam.toAgentId);
        if (!targetPos) return null;

        const color = targetPos.color || '#6366F1';
        const startX = center.x;
        const startY = center.y;
        const endX = targetPos.x;
        const endY = targetPos.y;

        return (
          <g key={beam.taskId} className="delegation-beam-group">
            {/* Background glowing blurred line */}
            <line
              x1={startX}
              y1={startY}
              x2={endX}
              y2={endY}
              stroke={color}
              strokeWidth="4"
              strokeOpacity="0.4"
              filter="url(#beam-glow)"
            />

            {/* Active animated dashed pulse line */}
            <line
              x1={startX}
              y1={startY}
              x2={endX}
              y2={endY}
              stroke={color}
              strokeWidth="2"
              strokeDasharray="6 6"
              className="animate-pulse"
            >
              <animate
                attributeName="stroke-dashoffset"
                values="24;0"
                dur="1s"
                repeatCount="indefinite"
              />
            </line>

            {/* Particle head pulse at target */}
            <circle
              cx={endX}
              cy={endY}
              r="6"
              fill={color}
              className="animate-ping"
              opacity="0.75"
            />
          </g>
        );
      })}
    </svg>
  );
};
