import { useStore } from '@/store/store';
import { focusAgent, focusDepartmentZone, focusTeam } from '@/scene/office/floorNavigation';

/** Hierarchical org chart — Division › Dept › Team › Agent (click focuses floor). */
export function OrgChartPanel() {
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

  const goAgent = (id: string, floorId?: string) => {
    if (floorId) setCurrentFloorId(floorId);
    setFloorViewMode('floor');
    window.setTimeout(() => focusAgent(id, camera), 60);
  };

  const goDept = (zoneId: string, floorId?: string) => {
    if (floorId) setCurrentFloorId(floorId ?? 'floor-1');
    setFloorViewMode('floor');
    window.setTimeout(
      () => focusDepartmentZone(zoneId, camera, zones, floorMapSize.width, floorMapSize.height),
      60,
    );
  };

  const goTeam = (teamId: string, floorId?: string) => {
    if (floorId) setCurrentFloorId(floorId);
    setFloorViewMode('floor');
    window.setTimeout(() => focusTeam(teamId, camera, floorMapSize.width, floorMapSize.height), 60);
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
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--cth-ink-300)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
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
      <div data-scroll-panel style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, fontSize: 12 }}>
        {floors.map((floor) => {
          const floorZones = zones.filter((z) => (z.floorId ?? 'floor-1') === floor.id);
          return (
            <div key={floor.id} style={{ marginBottom: 16 }}>
              <button
                type="button"
                onClick={() => { setCurrentFloorId(floor.id); setFloorViewMode('floor'); }}
                style={{ fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13 }}
              >
                {floor.label}
              </button>
              {floorZones.map((zone) => {
                const deptTeams = teams.filter((t) => t.departmentId === zone.id || zone.departments.includes(t.departmentId));
                return (
                  <div key={zone.id} style={{ marginLeft: 12, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => goDept(zone.id, floor.id)}
                      style={{
                        fontWeight: 600,
                        color: zone.color,
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {zone.label}
                    </button>
                    {deptTeams.map((team) => {
                      const members = filtered.filter(
                        (a) => a.teamId === team.id && (a.floorId ?? 'floor-1') === floor.id,
                      );
                      if (members.length === 0 && filter !== 'all') return null;
                      return (
                        <div key={team.id} style={{ marginLeft: 16, marginTop: 4 }}>
                          <button
                            type="button"
                            onClick={() => goTeam(team.id, floor.id)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11 }}
                          >
                            {team.name.replace(/ Team$/, '')} ({members.length})
                          </button>
                          <div style={{ marginLeft: 12, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {members.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => goAgent(a.id, floor.id)}
                                style={{
                                  fontSize: 10,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  border: '1px solid var(--cth-ink-300)',
                                  background: a.deploymentStatus === 'planned' ? 'var(--cth-paper-200)' : 'white',
                                  cursor: 'pointer',
                                }}
                              >
                                {a.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
