import { useEffect, useState } from 'react';
import { useStore } from '@/store/store';
import { agentsOnFloor } from '@/scene/office/officeLayout';

interface MinimapProps {
  onZoneClick?: (zoneId: string) => void;
}

/** Minimap — SVG overview with viewport rectangle and agent dots. */
export function Minimap({ onZoneClick }: MinimapProps) {
  const camera = useStore((s) => s.floorCamera);
  const zones = useStore((s) => s.departmentZones);
  const floorMapSize = useStore((s) => s.floorMapSize);
  const agents = useStore((s) => s.agents);
  const currentFloorId = useStore((s) => s.currentFloorId);
  const agentWorldPositions = useStore((s) => s.agentWorldPositions);
  const rosterFilter = useStore((s) => s.agentRosterFilter);
  const floorAgents = agentsOnFloor(agents, currentFloorId, rosterFilter);

  const mw = 200;
  const mh = 120;
  const mapW = floorMapSize.width || 960;
  const mapH = floorMapSize.height || 800;

  const [viewport, setViewport] = useState({ x: 0, y: 0, width: mapW, height: mapH });

  useEffect(() => {
    if (!camera) return;
    const tick = () => setViewport(camera.getVisibleBounds());
    tick();
    const id = window.setInterval(tick, 120);
    return () => window.clearInterval(id);
  }, [camera]);

  const expanded = zones.filter((z) => z.expanded);
  const zoneWidth = expanded.length > 0 ? (mw - 8) / expanded.length : mw;

  const scaleX = mw / mapW;
  const scaleY = mh / mapH;

  const vpX = (viewport.x - viewport.width / 2) * scaleX;
  const vpY = (viewport.y - viewport.height / 2) * scaleY;
  const vpW = viewport.width * scaleX;
  const vpH = viewport.height * scaleY;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        right: 8,
        width: mw,
        height: mh,
        zIndex: 20,
        background: 'var(--cth-paper-200)',
        border: '1px solid var(--cth-ink-400)',
        borderRadius: 6,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        pointerEvents: 'auto',
      }}
    >
      <svg width={mw} height={mh} viewBox={`0 0 ${mw} ${mh}`}>
        {expanded.map((zone, idx) => {
          const x = idx * zoneWidth + 2;
          const w = zoneWidth - 2;
          const count = floorAgents.filter((a) => zone.departments.includes(a.departmentId ?? '')).length;
          return (
            <g
              key={zone.id}
              onClick={() => onZoneClick?.(zone.id)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={x}
                y={2}
                width={w}
                height={mh - 4}
                fill={zone.color}
                fillOpacity={0.25}
                stroke={zone.color}
                strokeWidth={0.5}
              />
              <text
                x={x + w / 2}
                y={14}
                textAnchor="middle"
                fontSize={8}
                fontFamily="var(--cth-font-display)"
                fill={zone.color}
                fontWeight="600"
              >
                {zone.label.slice(0, 8).toUpperCase()}
              </text>
              {count > 0 && (
                <text
                  x={x + w / 2}
                  y={26}
                  textAnchor="middle"
                  fontSize={7}
                  fontFamily="var(--cth-font-mono)"
                  fill={zone.color}
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}
        <rect
          x={Math.max(0, vpX)}
          y={Math.max(0, vpY)}
          width={Math.min(vpW, mw)}
          height={Math.min(vpH, mh)}
          fill="white"
          fillOpacity={0.12}
          stroke="white"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
        {floorAgents.map((a) => {
          const pos = agentWorldPositions[a.id];
          let dotX: number;
          let dotY: number;
          if (pos) {
            dotX = pos.x * scaleX;
            dotY = pos.y * scaleY;
          } else {
            const zoneIdx = expanded.findIndex((z) => z.departments.includes(a.departmentId ?? ''));
            const zx = zoneIdx >= 0 ? zoneIdx * zoneWidth + zoneWidth / 2 : mw / 2;
            const hash = a.id.split('').reduce((h, c) => h + c.charCodeAt(0), 0);
            dotX = zx + (hash % 5) * 4 - 8;
            dotY = 40 + (hash % 7) * 8;
          }
          const inView = pos
            ? pos.x >= viewport.x - viewport.width / 2
              && pos.x <= viewport.x + viewport.width / 2
              && pos.y >= viewport.y - viewport.height / 2
              && pos.y <= viewport.y + viewport.height / 2
            : true;
          return (
            <circle
              key={a.id}
              cx={Math.max(4, Math.min(mw - 4, dotX))}
              cy={Math.max(4, Math.min(mh - 4, dotY))}
              r={inView ? 2.5 : 2}
              fill={a.status === 'blocked' ? '#ef4444' : inView ? '#6366f1' : '#94a3b8'}
              opacity={inView ? 0.9 : 0.45}
            />
          );
        })}
      </svg>
    </div>
  );
}
