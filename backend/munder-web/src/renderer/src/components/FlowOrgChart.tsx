import { useMemo } from 'react';
import { useStore } from '@/store/store';
import { focusAgent, focusDepartmentZone, focusTeam } from '@/scene/office/floorNavigation';

/**
 * Interactive org chart — visual node graph (Division → Dept → Team → Agent).
 * Click any node to focus the floor camera.
 */
export function FlowOrgChart() {
  const floors = useStore((s) => s.orgFloors);
  const zones = useStore((s) => s.departmentZones);
  const teams = useStore((s) => s.orgTeams);
  const agents = useStore((s) => s.agents);
  const filter = useStore((s) => s.agentRosterFilter);
  const setFilter = useStore((s) => s.setAgentRosterFilter);
  const camera = useStore((s) => s.floorCamera);
  const floorMapSize = useStore((s) => s.floorMapSize);
  const setFloorViewMode = useStore((s) => s.setFloorViewMode);
  const setCurrentFloorId = useStore((s) => s.setCurrentFloorId);

  const filtered = agents.filter((a) => {
    if (filter === 'deployed') return a.deploymentStatus === 'deployed' || !a.deploymentStatus;
    if (filter === 'planned') return a.deploymentStatus === 'planned' || a.deploymentStatus === 'catalogue';
    return true;
  });

  const layout = useMemo(() => {
    const nodes: Array<{
      id: string;
      label: string;
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      type: 'floor' | 'dept' | 'team' | 'agent';
      floorId?: string;
      zoneId?: string;
      teamId?: string;
      agentId?: string;
    }> = [];
    const edges: Array<{ from: string; to: string }> = [];

    const colW = 140;
    const rowH = 36;
    let y = 20;

    for (const floor of floors) {
      const floorId = `floor-${floor.id}`;
      nodes.push({
        id: floorId,
        label: floor.label,
        x: 20,
        y,
        w: colW,
        h: 32,
        color: '#6366f1',
        type: 'floor',
        floorId: floor.id,
      });
      const floorZones = zones.filter((z) => (z.floorId ?? 'floor-1') === floor.id);
      let deptY = y;
      floorZones.forEach((zone, zi) => {
        const deptId = `dept-${zone.id}`;
        const dx = 20 + colW + 24 + zi * (colW + 12);
        nodes.push({
          id: deptId,
          label: zone.label,
          x: dx,
          y: deptY,
          w: colW,
          h: 28,
          color: zone.color,
          type: 'dept',
          floorId: floor.id,
          zoneId: zone.id,
        });
        edges.push({ from: floorId, to: deptId });

        const deptTeams = teams.filter((t) =>
          t.departmentId === zone.id || zone.departments.includes(t.departmentId),
        );
        let teamY = deptY + 36;
        deptTeams.forEach((team, ti) => {
          const teamId = `team-${team.id}`;
          const ty = teamY + ti * 32;
          nodes.push({
            id: teamId,
            label: team.name.replace(/ Team$/, ''),
            x: dx + colW + 16,
            y: ty,
            w: colW - 10,
            h: 24,
            color: zone.color,
            type: 'team',
            floorId: floor.id,
            teamId: team.id,
          });
          edges.push({ from: deptId, to: teamId });

          const members = filtered.filter(
            (a) => a.teamId === team.id && (a.floorId ?? 'floor-1') === floor.id,
          );
          members.slice(0, 6).forEach((a, mi) => {
            const agentNodeId = `agent-${a.id}`;
            nodes.push({
              id: agentNodeId,
              label: a.name,
              x: dx + colW + 16 + colW,
              y: ty + mi * 22,
              w: colW,
              h: 20,
              color: '#94a3b8',
              type: 'agent',
              floorId: floor.id,
              agentId: a.id,
            });
            edges.push({ from: teamId, to: agentNodeId });
          });
        });
        deptY += Math.max(rowH, deptTeams.length * 32 + 40);
      });
      y = deptY + 40;
    }

    const maxX = Math.max(400, ...nodes.map((n) => n.x + n.w + 20));
    const maxY = Math.max(300, ...nodes.map((n) => n.y + n.h + 20));
    return { nodes, edges, width: maxX, height: maxY };
  }, [floors, zones, teams, filtered]);

  const onNode = (n: typeof layout.nodes[0]) => {
    if (n.type === 'floor' && n.floorId) {
      setCurrentFloorId(n.floorId);
      setFloorViewMode('floor');
    } else if (n.type === 'dept' && n.zoneId && n.floorId) {
      setCurrentFloorId(n.floorId);
      setFloorViewMode('floor');
      window.setTimeout(
        () => focusDepartmentZone(n.zoneId!, camera, zones, floorMapSize.width, floorMapSize.height),
        60,
      );
    } else if (n.type === 'team' && n.teamId && n.floorId) {
      setCurrentFloorId(n.floorId);
      setFloorViewMode('floor');
      window.setTimeout(() => focusTeam(n.teamId!, camera, floorMapSize.width, floorMapSize.height), 60);
    } else if (n.type === 'agent' && n.agentId && n.floorId) {
      setCurrentFloorId(n.floorId);
      setFloorViewMode('floor');
      window.setTimeout(() => focusAgent(n.agentId!, camera), 60);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 15,
        background: 'var(--cth-cream-50)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--cth-ink-300)',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 12 }}>Org chart</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'deployed' | 'planned' | 'all')}
          style={{ fontSize: 11, padding: '2px 6px' }}
        >
          <option value="deployed">Deployed</option>
          <option value="planned">Planned</option>
          <option value="all">All</option>
        </select>
        <button
          type="button"
          onClick={() => setFloorViewMode('floor')}
          style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}
        >
          ← Floor view
        </button>
      </div>
      <div data-scroll-panel style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
        <svg width={layout.width} height={layout.height} style={{ display: 'block' }}>
          {layout.edges.map((e, i) => {
            const from = layout.nodes.find((n) => n.id === e.from);
            const to = layout.nodes.find((n) => n.id === e.to);
            if (!from || !to) return null;
            return (
              <line
                key={i}
                x1={from.x + from.w / 2}
                y1={from.y + from.h}
                x2={to.x + to.w / 2}
                y2={to.y}
                stroke="var(--cth-ink-300)"
                strokeWidth={1}
              />
            );
          })}
          {layout.nodes.map((n) => (
            <g key={n.id} onClick={() => onNode(n)} style={{ cursor: 'pointer' }}>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={4}
                fill={n.color}
                fillOpacity={0.2}
                stroke={n.color}
                strokeWidth={1}
              />
              <text
                x={n.x + n.w / 2}
                y={n.y + n.h / 2 + 4}
                textAnchor="middle"
                fontSize={n.type === 'agent' ? 9 : 10}
                fontFamily="var(--cth-font-ui)"
                fill="var(--cth-ink-900)"
              >
                {n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
