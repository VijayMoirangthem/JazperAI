import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useStore } from '@/store/store';
import { useFloorNavigation } from '@/hooks/useFloorNavigation';
import { focusDepartmentZone, focusFloor, focusTeam } from '@/scene/office/floorNavigation';

const btnStyle: CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 4,
  background: 'var(--cth-surface-100)',
  color: 'var(--cth-ink-600)',
  fontSize: 12,
  cursor: 'pointer',
  pointerEvents: 'auto',
};

interface FloorNavBarProps {
  onOpenGoTo?: () => void;
}

function isActiveStatus(status: string): boolean {
  return ['working', 'thinking', 'compacting', 'blocked', 'waiting'].includes(status);
}

/** Floor navigation bar — zoom, wings, breadcrumbs Floor › Dept › Team › Agent. */
export function FloorNavBar({ onOpenGoTo }: FloorNavBarProps) {
  const camera = useStore((s) => s.floorCamera);
  const zones = useStore((s) => s.departmentZones);
  const visibleZoneRange = useStore((s) => s.visibleZoneRange);
  const setVisibleZoneRange = useStore((s) => s.setVisibleZoneRange);
  const selectedId = useStore((s) => s.selectedId);
  const agents = useStore((s) => s.agents);
  const showMinimap = useStore((s) => s.showMinimap);
  const setShowMinimap = useStore((s) => s.setShowMinimap);
  const floorMapSize = useStore((s) => s.floorMapSize);
  const orgFloors = useStore((s) => s.orgFloors);
  const orgTeams = useStore((s) => s.orgTeams);
  const currentFloorId = useStore((s) => s.currentFloorId);
  const setCurrentFloorId = useStore((s) => s.setCurrentFloorId);
  const setFloorViewMode = useStore((s) => s.setFloorViewMode);
  const floorViewMode = useStore((s) => s.floorViewMode);
  const agentRosterFilter = useStore((s) => s.agentRosterFilter);
  const setAgentRosterFilter = useStore((s) => s.setAgentRosterFilter);
  const setOrgAdminOpen = useStore((s) => s.setOrgAdminOpen);
  const setKeyboardHelpOpen = useStore((s) => s.setKeyboardHelpOpen);

  const [zoomLevel, setZoomLevel] = useState(1);

  const focusZone = useCallback((zoneId: string) => {
    focusDepartmentZone(zoneId, camera, zones, floorMapSize.width, floorMapSize.height);
  }, [camera, zones, floorMapSize]);

  useFloorNavigation(camera, zones, focusZone);

  useEffect(() => {
    if (!camera) return;
    const id = window.setInterval(() => setZoomLevel(camera.getZoom()), 120);
    return () => window.clearInterval(id);
  }, [camera]);

  const expandedZones = zones.filter((z) => z.expanded && (z.floorId ?? 'floor-1') === currentFloorId);
  const [start, end] = visibleZoneRange;
  const wingWidth = end - start + 1;
  const canPanLeft = start > 0;
  const canPanRight = end < expandedZones.length - 1;

  const shiftWings = (dir: -1 | 1) => {
    const newStart = Math.max(0, Math.min(expandedZones.length - wingWidth, start + dir));
    setVisibleZoneRange([newStart, newStart + wingWidth - 1]);
  };

  const selectedAgent = agents.find((a) => a.id === selectedId);
  const selectedZone = selectedAgent
    ? zones.find((z) => z.departments.includes(selectedAgent.departmentId ?? ''))
    : undefined;
  const selectedTeam = selectedAgent?.teamId
    ? orgTeams.find((t) => t.id === selectedAgent.teamId)
    : undefined;
  const floorLabel =
    orgFloors.find((f) => f.id === currentFloorId)?.label ?? 'Floor 1';
  const floorIdx = orgFloors.findIndex((f) => f.id === currentFloorId);

  const shiftFloor = (dir: -1 | 1) => {
    if (orgFloors.length < 2) return;
    const next = Math.max(0, Math.min(orgFloors.length - 1, floorIdx + dir));
    const f = orgFloors[next];
    if (f) {
      setCurrentFloorId(f.id);
      focusFloor(f.id, camera);
    }
  };

  if (!camera) return null;

  const crumbBtn: CSSProperties = {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    font: 'inherit',
    fontWeight: 600,
    padding: 0,
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        right: 8,
        pointerEvents: 'none',
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '6px 10px',
        background: 'rgba(255, 255, 255, 0.88)',
        borderRadius: 8,
        backdropFilter: 'blur(6px)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        zIndex: 20,
      }}
    >
      <button
        type="button"
        onClick={() => shiftFloor(-1)}
        disabled={floorIdx <= 0}
        title="Previous floor"
        style={{ ...btnStyle, opacity: floorIdx > 0 ? 1 : 0.4 }}
      >
        ◀
      </button>
      <span
        style={{
          fontSize: 10,
          fontFamily: 'var(--cth-font-mono)',
          pointerEvents: 'auto',
          maxWidth: 140,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {floorLabel}
      </span>
      <button
        type="button"
        onClick={() => shiftFloor(1)}
        disabled={floorIdx >= orgFloors.length - 1}
        title="Next floor"
        style={{ ...btnStyle, opacity: floorIdx < orgFloors.length - 1 ? 1 : 0.4 }}
      >
        ▶
      </button>

      <button
        type="button"
        onClick={() => shiftWings(-1)}
        disabled={!canPanLeft}
        title="Previous department wing"
        style={{ ...btnStyle, opacity: canPanLeft ? 1 : 0.4 }}
      >
        ◀
      </button>

      <div
        style={{
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          fontSize: 11,
          fontFamily: 'var(--cth-font-ui)',
          color: 'var(--cth-ink-700)',
          pointerEvents: 'auto',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => camera.resetZoom()}
          style={{ ...crumbBtn, color: 'var(--cth-ink-800)' }}
        >
          {floorLabel}
        </button>
        {selectedZone && (
          <>
            <span style={{ opacity: 0.5 }}>›</span>
            <button
              type="button"
              onClick={() => focusZone(selectedZone.id)}
              style={{ ...crumbBtn, color: selectedZone.color }}
            >
              {selectedZone.label}
            </button>
          </>
        )}
        {selectedTeam && (
          <>
            <span style={{ opacity: 0.5 }}>›</span>
            <button
              type="button"
              onClick={() => focusTeam(selectedTeam.id, camera, floorMapSize.width, floorMapSize.height)}
              style={{ ...crumbBtn, color: 'var(--cth-ink-700)' }}
            >
              {selectedTeam.name.replace(/ Team$/, '')}
            </button>
          </>
        )}
        {selectedAgent && (
          <>
            <span style={{ opacity: 0.5 }}>›</span>
            <span style={{ fontWeight: 500 }}>{selectedAgent.name}</span>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => shiftWings(1)}
        disabled={!canPanRight}
        title="Next department wing"
        style={{ ...btnStyle, opacity: canPanRight ? 1 : 0.4 }}
      >
        ▶
      </button>

      {/* Visible wing chips with agent counts */}
      <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto', flexWrap: 'wrap' }}>
        {expandedZones.slice(start, end + 1).map((zone) => {
          const deptAgents = agents.filter((a) => zone.departments.includes(a.departmentId ?? ''));
          const active = deptAgents.filter((a) => isActiveStatus(a.status)).length;
          return (
            <button
              key={zone.id}
              type="button"
              onClick={() => focusZone(zone.id)}
              title={`${zone.label}: ${deptAgents.length} agents, ${active} active`}
              style={{
                fontSize: 9,
                fontFamily: 'var(--cth-font-mono)',
                padding: '2px 6px',
                borderRadius: 4,
                border: `1px solid ${zone.color}`,
                background: selectedZone?.id === zone.id ? zone.color : 'transparent',
                color: selectedZone?.id === zone.id ? '#fff' : zone.color,
                cursor: 'pointer',
              }}
            >
              {zone.label.slice(0, 10)} {deptAgents.length}/{active}
            </button>
          );
        })}
      </div>

      <div style={{ marginLeft: 8, display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
        <button type="button" onClick={() => camera.zoomOut()} disabled={zoomLevel <= 0.3} title="Zoom out (-)" style={btnStyle}>
          −
        </button>
        <span style={{ fontSize: 11, fontFamily: 'var(--cth-font-mono)', minWidth: 36, textAlign: 'center' }}>
          {zoomLevel.toFixed(1)}x
        </span>
        <button type="button" onClick={() => camera.zoomIn()} disabled={zoomLevel >= 3} title="Zoom in (+)" style={btnStyle}>
          +
        </button>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, pointerEvents: 'auto', alignItems: 'center' }}>
        <select
          value={agentRosterFilter}
          onChange={(e) => setAgentRosterFilter(e.target.value as 'deployed' | 'planned' | 'all')}
          style={{ fontSize: 10, padding: '2px 4px' }}
          title="Roster filter"
        >
          <option value="deployed">Deployed</option>
          <option value="planned">Planned</option>
          <option value="all">All</option>
        </select>
        <button
          type="button"
          onClick={() => setFloorViewMode(floorViewMode === 'floor' ? 'orgchart' : 'floor')}
          title="Toggle org chart"
          style={{ ...btnStyle, width: 'auto', padding: '0 8px', fontSize: 10 }}
        >
          {floorViewMode === 'floor' ? 'Org' : 'Floor'}
        </button>
        {onOpenGoTo && (
          <button
            type="button"
            onClick={onOpenGoTo}
            title="Go to… (Ctrl+K)"
            style={{ ...btnStyle, width: 'auto', padding: '0 8px', fontSize: 10, fontFamily: 'var(--cth-font-mono)' }}
          >
            Go to ⌘K
          </button>
        )}
        <button
          type="button"
          onClick={() => setOrgAdminOpen(true)}
          title="Manage organization"
          style={{ ...btnStyle, width: 'auto', padding: '0 8px', fontSize: 10 }}
        >
          Manage
        </button>
        <button
          type="button"
          onClick={() => setKeyboardHelpOpen(true)}
          title="Keyboard shortcuts (?)"
          style={btnStyle}
        >
          ?
        </button>
        <button type="button" onClick={() => camera.resetZoom()} title="Reset view (0)" style={btnStyle}>
          ⌂
        </button>
        <button
          type="button"
          onClick={() => setShowMinimap(!showMinimap)}
          title="Toggle minimap (m)"
          style={{ ...btnStyle, width: 32 }}
        >
          {showMinimap ? '▾' : '▴'}
        </button>
      </div>
    </div>
  );
}
