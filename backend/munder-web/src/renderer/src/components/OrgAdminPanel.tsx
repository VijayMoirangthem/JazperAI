import { useCallback, useEffect, useState } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';

type Tab = 'floors' | 'departments' | 'teams' | 'reassign' | 'activate' | 'zones';

interface DivisionRow {
  id: string;
  name: string;
  label: string;
  order_index: number;
  map_theme: string;
}

interface TeamRow {
  id: string;
  name: string;
  department_id: string;
  division_id?: string;
  order_index: number;
}

interface DeptRow {
  id: string;
  name: string;
  description?: string;
  badge_color?: string;
  division_id?: string;
  floor_id?: string;
  head_agent?: string;
}

interface CatalogueAgent {
  agent_id: string;
  codename: string;
  name: string;
  status: string;
  department: string;
  title?: string;
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function OrgAdminPanel() {
  const open = useStore((s) => s.orgAdminOpen);
  const setOpen = useStore((s) => s.setOrgAdminOpen);
  const agents = useStore((s) => s.agents);
  const addAgent = useStore((s) => s.addAgent);
  const orgTeams = useStore((s) => s.orgTeams);
  const zones = useStore((s) => s.departmentZones);
  const updateAgent = useStore((s) => s.updateAgent);
  const updateZone = useStore((s) => s.updateZone);
  const reorderZones = useStore((s) => s.reorderZones);
  const setDepartmentZones = useStore((s) => s.setDepartmentZones);

  const [tab, setTab] = useState<Tab>('floors');
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueAgent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [newFloorId, setNewFloorId] = useState('');
  const [newFloorLabel, setNewFloorLabel] = useState('');
  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDept, setNewTeamDept] = useState('');
  const [newDeptId, setNewDeptId] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [reassignAgentId, setReassignAgentId] = useState('');
  const [reassignTeam, setReassignTeam] = useState('');
  const [reassignDept, setReassignDept] = useState('');
  const [reassignFloor, setReassignFloor] = useState('');
  const [reassignDesk, setReassignDesk] = useState('');
  const [activateId, setActivateId] = useState('');
  const [activateTeam, setActivateTeam] = useState('');
  const [editingDept, setEditingDept] = useState<string | null>(null);
  const [editDeptName, setEditDeptName] = useState('');
  const [editDeptColor, setEditDeptColor] = useState('');
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [d, t, dept, cat] = await Promise.all([
        api<{ divisions: DivisionRow[] }>('/api/org/divisions'),
        api<{ teams: TeamRow[] }>('/api/org/teams'),
        api<{ departments: DeptRow[] }>('/api/org/departments'),
        api<{ agents: CatalogueAgent[] }>('/api/org/catalogue'),
      ]);
      setDivisions(d.divisions);
      setTeams(t.teams);
      setDepartments(dept.departments);
      setCatalogue(cat.agents);
      setError('');
      try {
        const live = await api<{
          divisions?: DivisionRow[];
          teams?: TeamRow[];
          departments?: Array<{ id: string; name: string; badge_color?: string; floor_id?: string }>;
        }>('/api/agents/live');
        if (live.divisions?.length) {
          useStore.getState().setOrgFloors(live.divisions.map((f) => ({
            id: f.id,
            label: f.label,
            divisionId: f.id,
            mapTheme: f.map_theme,
          })));
        }
        if (live.teams?.length) {
          useStore.getState().setOrgTeams(live.teams.map((t) => ({
            id: t.id,
            name: t.name,
            departmentId: t.department_id,
            divisionId: t.division_id,
          })));
        }
      } catch { /* live refresh optional */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const onAddFloor = async () => {
    if (!newFloorId.trim() || !newFloorLabel.trim()) return;
    setBusy(true);
    try {
      await api('/api/org/divisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newFloorId.trim(),
          name: newFloorLabel.trim(),
          label: newFloorLabel.trim(),
          order_index: divisions.length,
        }),
      });
      setNewFloorId('');
      setNewFloorLabel('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteFloor = async (id: string) => {
    if (!confirm(`Remove floor "${id}"?`)) return;
    setBusy(true);
    try {
      await api(`/api/org/divisions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAddDept = async () => {
    if (!newDeptId.trim() || !newDeptName.trim()) return;
    setBusy(true);
    try {
      await api('/api/org/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newDeptId.trim(),
          name: newDeptName.trim(),
          badge_color: editDeptColor || '#94a3b8',
          floor_id: reassignFloor || 'floor-1',
        }),
      });
      setNewDeptId('');
      setNewDeptName('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSaveDept = async (id: string) => {
    setBusy(true);
    try {
      await api(`/api/org/departments/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editDeptName,
          badge_color: editDeptColor,
        }),
      });
      updateZone(id, { label: editDeptName, color: editDeptColor });
      setEditingDept(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteDept = async (id: string) => {
    if (!confirm(`Delete department "${id}"? Agents must be reassigned first.`)) return;
    setBusy(true);
    try {
      await api(`/api/org/departments/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onMergeDepts = async () => {
    if (!mergeSource || !mergeTarget) return;
    setBusy(true);
    try {
      await api('/api/org/merge-departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: mergeSource, target_id: mergeTarget }),
      });
      setMergeSource('');
      setMergeTarget('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAddTeam = async () => {
    if (!newTeamId.trim() || !newTeamName.trim() || !newTeamDept.trim()) return;
    setBusy(true);
    try {
      await api('/api/org/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newTeamId.trim(),
          name: newTeamName.trim(),
          department_id: newTeamDept.trim(),
          order_index: teams.length,
        }),
      });
      setNewTeamId('');
      setNewTeamName('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteTeam = async (id: string) => {
    if (!confirm(`Remove team "${id}"?`)) return;
    setBusy(true);
    try {
      await api(`/api/org/teams/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onReassign = async () => {
    if (!reassignAgentId.trim()) return;
    setBusy(true);
    try {
      const body: Record<string, string | number> = { agent_id: reassignAgentId.trim() };
      if (reassignTeam) body.team_id = reassignTeam;
      if (reassignDept) body.department = reassignDept;
      if (reassignFloor) body.floor_id = reassignFloor;
      if (reassignDesk) body.desk_slot = parseInt(reassignDesk, 10);
      await api('/api/org/reassign-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      updateAgent(reassignAgentId.trim(), {
        teamId: reassignTeam || undefined,
        departmentId: reassignDept || undefined,
        floorId: reassignFloor || undefined,
        deskSlot: reassignDesk ? parseInt(reassignDesk, 10) : undefined,
      });
      setReassignAgentId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onActivate = async (agentId: string, teamId?: string) => {
    setBusy(true);
    try {
      await api('/api/org/activate-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          team_id: teamId || activateTeam || undefined,
          floor_id: reassignFloor || 'floor-1',
        }),
      });
      const existing = agents.find((a) => a.id === agentId);
      if (existing) {
        updateAgent(agentId, { deploymentStatus: 'deployed', status: 'working' });
      } else {
        try {
          const card = await api<Record<string, unknown>>(`/api/agents/${encodeURIComponent(agentId)}`);
          if (card.codename) {
            addAgent({
              id: String(card.codename),
              name: String(card.name ?? card.codename),
              character: 'jim',
              accent: 'sky',
              description: String(card.title ?? ''),
              project: 'coos',
              tmuxTarget: '',
              cwd: '',
              status: 'working',
              action: 'activated',
              progress: 0,
              departmentId: String(card.department ?? ''),
              teamId: card.team_id as string | undefined,
              floorId: (card.floor_id as string) ?? 'floor-1',
              title: card.title as string | undefined,
              deploymentStatus: 'deployed',
            });
          }
        } catch { /* refresh will pick up on reload */ }
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const moveZone = async (zoneId: string, dir: -1 | 1) => {
    const sorted = [...zones].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((z) => z.id === zoneId);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= sorted.length) return;
    reorderZones(sorted[idx].order, sorted[target].order);
    const reordered = [...sorted];
    const [item] = reordered.splice(idx, 1);
    reordered.splice(target, 0, item);
    const withOrder = reordered.map((z, i) => ({ ...z, order: i }));
    setDepartmentZones(withOrder);
    try {
      for (const z of withOrder) {
        const deptId = z.departments[0];
        if (!deptId) continue;
        await api(`/api/org/departments/${encodeURIComponent(deptId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ floor_position: { order: z.order, zone_id: z.id } }),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  const tabBtn = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        padding: '6px 10px',
        border: 'none',
        cursor: 'pointer',
        background: tab === key ? 'var(--cth-cream-100)' : 'transparent',
        fontFamily: 'var(--cth-font-display)',
        fontSize: 9,
        color: tab === key ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)',
        boxShadow: tab === key ? 'inset 0 -2px 0 var(--cth-sky)' : 'none',
      }}
    >
      {label.toUpperCase()}
    </button>
  );

  const deptIds = departments.map((d) => d.id);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={() => setOpen(false)}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(760px, 100%)', maxHeight: '88vh' }}>
        <PixelPanel variant="dialog" title="MANAGE ORGANIZATION" noPadding>
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '82vh' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--cth-ink-300)' }}>
              {tabBtn('floors', 'Floors')}
              {tabBtn('departments', 'Depts')}
              {tabBtn('teams', 'Teams')}
              {tabBtn('reassign', 'Reassign')}
              {tabBtn('activate', 'Activate')}
              {tabBtn('zones', 'Layout')}
            </div>

            <div data-scroll-panel style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {error && (
                <div style={{ fontSize: 12, color: 'var(--cth-coral)', padding: 8, background: 'var(--cth-coral-light)' }}>
                  {error}
                </div>
              )}

              {tab === 'floors' && (
                <>
                  {divisions.map((d) => (
                    <div key={d.id} style={rowStyle}>
                      <span style={{ flex: 1, fontSize: 13 }}>{d.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-mono)' }}>{d.id}</span>
                      <PixelButton variant="destructive" size="sm" onClick={() => onDeleteFloor(d.id)} disabled={busy}>Remove</PixelButton>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input placeholder="floor-id" value={newFloorId} onChange={(e) => setNewFloorId(e.target.value)} style={inputStyle} />
                    <input placeholder="Label" value={newFloorLabel} onChange={(e) => setNewFloorLabel(e.target.value)} style={inputStyle} />
                    <PixelButton variant="primary" size="sm" onClick={onAddFloor} disabled={busy}>Add floor</PixelButton>
                  </div>
                </>
              )}

              {tab === 'departments' && (
                <>
                  {departments.map((d) => (
                    <div key={d.id} style={rowStyle}>
                      {editingDept === d.id ? (
                        <>
                          <input value={editDeptName} onChange={(e) => setEditDeptName(e.target.value)} style={inputStyle} />
                          <input type="color" value={editDeptColor || d.badge_color || '#94a3b8'} onChange={(e) => setEditDeptColor(e.target.value)} style={{ width: 36, height: 28 }} />
                          <PixelButton variant="primary" size="sm" onClick={() => onSaveDept(d.id)} disabled={busy}>Save</PixelButton>
                          <PixelButton variant="secondary" size="sm" onClick={() => setEditingDept(null)}>Cancel</PixelButton>
                        </>
                      ) : (
                        <>
                          <span style={{ width: 12, height: 12, borderRadius: 2, background: d.badge_color ?? '#94a3b8' }} />
                          <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{d.id}</span>
                          <PixelButton variant="secondary" size="sm" onClick={() => {
                            setEditingDept(d.id);
                            setEditDeptName(d.name);
                            setEditDeptColor(d.badge_color ?? '#94a3b8');
                          }}>Edit</PixelButton>
                          <PixelButton variant="destructive" size="sm" onClick={() => onDeleteDept(d.id)} disabled={busy}>Delete</PixelButton>
                        </>
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input placeholder="dept-id" value={newDeptId} onChange={(e) => setNewDeptId(e.target.value)} style={inputStyle} />
                    <input placeholder="Name" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} style={inputStyle} />
                    <PixelButton variant="primary" size="sm" onClick={onAddDept} disabled={busy}>Add dept</PixelButton>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11 }}>Merge:</span>
                    <select value={mergeSource} onChange={(e) => setMergeSource(e.target.value)} style={inputStyle}>
                      <option value="">Source…</option>
                      {deptIds.map((id) => <option key={id} value={id}>{id}</option>)}
                    </select>
                    <span>→</span>
                    <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={inputStyle}>
                      <option value="">Target…</option>
                      {deptIds.map((id) => <option key={id} value={id}>{id}</option>)}
                    </select>
                    <PixelButton variant="secondary" size="sm" onClick={onMergeDepts} disabled={busy || !mergeSource || !mergeTarget}>Merge</PixelButton>
                  </div>
                </>
              )}

              {tab === 'teams' && (
                <>
                  {teams.map((t) => (
                    <div key={t.id} style={rowStyle}>
                      <span style={{ flex: 1, fontSize: 13 }}>{t.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{t.department_id}</span>
                      <PixelButton variant="destructive" size="sm" onClick={() => onDeleteTeam(t.id)} disabled={busy}>Remove</PixelButton>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input placeholder="team-id" value={newTeamId} onChange={(e) => setNewTeamId(e.target.value)} style={inputStyle} />
                    <input placeholder="Team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} style={inputStyle} />
                    <select value={newTeamDept} onChange={(e) => setNewTeamDept(e.target.value)} style={inputStyle}>
                      <option value="">Dept…</option>
                      {deptIds.map((id) => <option key={id} value={id}>{id}</option>)}
                    </select>
                    <PixelButton variant="primary" size="sm" onClick={onAddTeam} disabled={busy}>Add team</PixelButton>
                  </div>
                </>
              )}

              {tab === 'reassign' && (
                <>
                  <select value={reassignAgentId} onChange={(e) => setReassignAgentId(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                    <option value="">Agent…</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                  </select>
                  <select value={reassignTeam} onChange={(e) => setReassignTeam(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                    <option value="">Team (optional)…</option>
                    {(teams.length ? teams : orgTeams.map((t) => ({ id: t.id, name: t.name }))).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <select value={reassignDept} onChange={(e) => setReassignDept(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                    <option value="">Department (optional)…</option>
                    {deptIds.map((id) => <option key={id} value={id}>{id}</option>)}
                  </select>
                  <select value={reassignFloor} onChange={(e) => setReassignFloor(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                    <option value="">Floor (optional)…</option>
                    {divisions.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                  <input placeholder="Desk slot (number)" value={reassignDesk} onChange={(e) => setReassignDesk(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                  <PixelButton variant="primary" size="sm" onClick={onReassign} disabled={busy || !reassignAgentId}>Reassign</PixelButton>
                </>
              )}

              {tab === 'activate' && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--cth-ink-600)' }}>
                    Catalogue / standby positions — activate to deploy on the floor.
                  </div>
                  <select value={activateTeam} onChange={(e) => setActivateTeam(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                    <option value="">Default team…</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {catalogue.map((a) => (
                    <div key={a.codename} style={rowStyle}>
                      <span style={{ flex: 1, fontSize: 13 }}>{a.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{a.title ?? a.department}</span>
                      <PixelButton variant="primary" size="sm" onClick={() => onActivate(a.codename)} disabled={busy}>
                        Activate
                      </PixelButton>
                    </div>
                  ))}
                  {catalogue.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>No catalogue agents — all positions may already be active.</div>
                  )}
                </>
              )}

              {tab === 'zones' && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--cth-ink-600)' }}>
                    Reorder department wings on the floor (left ↔ right).
                  </div>
                  {[...zones].sort((a, b) => a.order - b.order).map((z, i, arr) => (
                    <div key={z.id} style={rowStyle}>
                      <span style={{ width: 12, height: 12, background: z.color, borderRadius: 2 }} />
                      <span style={{ flex: 1, fontSize: 13 }}>{z.label}</span>
                      <PixelButton variant="secondary" size="sm" onClick={() => moveZone(z.id, -1)} disabled={i === 0}>◀</PixelButton>
                      <PixelButton variant="secondary" size="sm" onClick={() => moveZone(z.id, 1)} disabled={i === arr.length - 1}>▶</PixelButton>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div style={{ padding: 12, borderTop: '1px solid var(--cth-ink-300)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <PixelButton variant="secondary" size="sm" onClick={() => void refresh()} disabled={busy}>Refresh</PixelButton>
              <PixelButton variant="secondary" size="sm" onClick={() => setOpen(false)}>Close</PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 8,
  border: '1px solid var(--cth-ink-300)',
  borderRadius: 4,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  border: '1px solid var(--cth-ink-700)',
  borderRadius: 4,
  background: 'var(--cth-cream-100)',
  minWidth: 100,
};
