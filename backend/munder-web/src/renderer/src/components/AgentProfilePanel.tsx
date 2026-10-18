import { useState, useEffect } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelBadge } from './PixelBadge';
import { PixelButton } from './PixelButton';
import { SpritePortrait } from './SpritePortrait';
import { Icon } from './Icon';
import { useStore, type Agent, type AgentRegistryProfile } from '@/store/store';

function fmtTs(ts?: string | null): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return ts;
  }
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-display)' }}>
        {label.toUpperCase()}
      </span>
      <span style={{
        fontSize: 13,
        color: 'var(--cth-ink-900)',
        fontFamily: mono ? 'var(--cth-font-mono)' : 'var(--cth-font-ui)',
        lineHeight: '20px',
      }}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        fontFamily: 'var(--cth-font-display)',
        fontSize: 10,
        lineHeight: '14px',
        color: 'var(--cth-ink-500)',
        borderBottom: '1px solid var(--cth-ink-300)',
        paddingBottom: 4,
      }}>
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

export function AgentProfilePanel({ agent }: { agent: Agent }) {
  const profile = useStore((s) => s.agentProfiles[agent.id]);
  const loading = useStore((s) => s.agentProfileLoading[agent.id]);
  const orgTeams = useStore((s) => s.orgTeams);
  const orgFloors = useStore((s) => s.orgFloors);
  const zones = useStore((s) => s.departmentZones);
  const fetchAgentProfile = useStore((s) => s.fetchAgentProfile);
  const enqueueMessage = useStore((s) => s.enqueueMessage);
  const [messageText, setMessageText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editPrompt, setEditPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [goals, setGoals] = useState<Array<{ id: string; goal: string; status: string }>>([]);
  const [schedules, setSchedules] = useState<Array<{ id: string; name?: string; schedule?: string }>>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [gRes, sRes] = await Promise.all([
          fetch(`/api/agents/${encodeURIComponent(agent.id)}/goals?status=active`),
          fetch(`/api/agents/${encodeURIComponent(agent.id)}/schedules`),
        ]);
        if (gRes.ok) {
          const g = await gRes.json() as { goals?: Array<{ id: string; goal: string; status: string }> };
          if (alive) setGoals(g.goals ?? []);
        }
        if (sRes.ok) {
          const s = await sRes.json() as { schedules?: Array<{ id: string; name?: string; schedule?: string }> };
          if (alive) setSchedules(s.schedules ?? []);
        }
      } catch { /* ignore */ }
    };
    void load();
    return () => { alive = false; };
  }, [agent.id]);

  const team = orgTeams.find((t) => t.id === agent.teamId);
  const floor = orgFloors.find((f) => f.id === agent.floorId);
  const deptZone = zones.find((z) => z.departments.includes(agent.departmentId ?? ''));

  const p: AgentRegistryProfile | undefined = profile;
  const displayTitle = p?.title ?? agent.title ?? '—';
  const displayPrompt = p?.system_prompt_override || p?.system_prompt || '';

  const onSend = () => {
    const text = messageText.trim();
    if (!text) return;
    enqueueMessage(agent.id, text);
    setMessageText('');
  };

  const onSavePrompt = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt_override: promptDraft }),
      });
      if (res.ok) {
        await fetchAgentProfile(agent.id);
        setEditPrompt(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const onSpeak = async () => {
    try {
      await fetch(`/api/agents/${encodeURIComponent(agent.id)}/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Hello, I'm ${agent.name}.` }),
      });
    } catch { /* ignore */ }
  };

  return (
    <div
      data-scroll-panel
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        background: 'var(--cth-paper-200)',
      }}
    >
      {/* Header card */}
      <div style={{
        display: 'flex',
        gap: 12,
        padding: 12,
        background: 'var(--cth-cream-100)',
        border: '1px solid var(--cth-ink-300)',
        borderRadius: 4,
      }}>
        <div style={{
          width: 56, height: 56,
          background: `var(--cth-${agent.accent}-light)`,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {p?.avatar_emoji ? (
            <span style={{ fontSize: 28 }}>{p.avatar_emoji}</span>
          ) : (
            <SpritePortrait character={agent.character} scale={1.5} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--cth-font-display)',
            fontSize: 12,
            color: 'var(--cth-ink-900)',
          }}>
            {agent.name.toUpperCase()}
          </div>
          <div style={{ fontSize: 13, color: 'var(--cth-ink-700)', marginTop: 2 }}>
            {displayTitle}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <PixelBadge status={agent.status} />
            <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-mono)' }}>
              {agent.id}
            </span>
            {agent.deploymentStatus && (
              <span style={{
                fontSize: 10,
                padding: '1px 6px',
                background: 'var(--cth-cream-200)',
                borderRadius: 3,
                color: 'var(--cth-ink-600)',
              }}>
                {agent.deploymentStatus}
              </span>
            )}
          </div>
        </div>
      </div>

      {loading && !p && (
        <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', textAlign: 'center' }}>
          Loading employee record…
        </div>
      )}

      <Section title="Organization">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Floor" value={floor?.label ?? agent.floorId} />
          <Field label="Department" value={deptZone?.label ?? p?.department ?? agent.departmentId} />
          <Field label="Team" value={team?.name ?? agent.teamId} />
          <Field label="Desk slot" value={agent.deskSlot != null ? String(agent.deskSlot) : undefined} />
          <Field label="Reports to" value={
            p?.reports_to_name
              ? `${p.reports_to_name} (${p.reports_to_title ?? ''})`
              : p?.reports_to
          } />
          <Field label="Level" value={p?.level != null ? String(p.level) : undefined} />
        </div>
      </Section>

      <Section title="Role & capabilities">
        <Field label="Description" value={p?.description ?? agent.description} />
        {p?.capabilities && p.capabilities.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {p.capabilities.map((c) => (
              <span key={c} style={{
                fontSize: 10,
                padding: '2px 8px',
                background: 'var(--cth-sky-light)',
                borderRadius: 3,
                color: 'var(--cth-ink-800)',
              }}>
                {c}
              </span>
            ))}
          </div>
        )}
        {p?.tools_enabled && p.tools_enabled.length > 0 && (
          <Field label="Tools" value={p.tools_enabled.join(', ')} mono />
        )}
      </Section>

      <Section title="AI configuration">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Model" value={p?.model ?? agent.model} mono />
          <Field label="Temperature" value={p?.temperature != null ? String(p.temperature) : undefined} />
          <Field label="Max tokens" value={p?.max_tokens != null ? String(p.max_tokens) : undefined} />
          <Field label="Trust tier" value={p?.trust_tier} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-display)' }}>
              SYSTEM PROMPT
            </span>
            {!editPrompt && (
              <button
                type="button"
                onClick={() => { setPromptDraft(displayPrompt); setEditPrompt(true); }}
                style={{ fontSize: 11, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--cth-sky)' }}
              >
                Edit
              </button>
            )}
          </div>
          {editPrompt ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                rows={6}
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--cth-font-mono)',
                  padding: 8,
                  border: '1px solid var(--cth-ink-700)',
                  borderRadius: 4,
                  resize: 'vertical',
                  background: 'var(--cth-cream-100)',
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <PixelButton variant="primary" size="sm" onClick={onSavePrompt} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </PixelButton>
                <PixelButton variant="secondary" size="sm" onClick={() => setEditPrompt(false)}>
                  Cancel
                </PixelButton>
              </div>
            </div>
          ) : (
            <pre style={{
              fontSize: 11,
              fontFamily: 'var(--cth-font-mono)',
              whiteSpace: 'pre-wrap',
              margin: 0,
              padding: 8,
              background: 'var(--cth-cream-100)',
              border: '1px solid var(--cth-ink-300)',
              borderRadius: 4,
              maxHeight: 160,
              overflow: 'auto',
            }}>
              {displayPrompt || 'No system prompt configured.'}
            </pre>
          )}
        </div>
      </Section>

      <Section title="Activity">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Current action" value={agent.action} />
          <Field label="Health score" value={
            agent.healthScore != null ? `${Math.round(agent.healthScore)}%` : (p?.health_score != null ? `${Math.round(p.health_score)}%` : undefined)
          } />
          <Field label="Tasks completed" value={p?.tasks_completed != null ? String(p.tasks_completed) : undefined} />
          <Field label="Tasks failed" value={p?.tasks_failed != null ? String(p.tasks_failed) : undefined} />
        </div>
      </Section>

      <Section title="Timestamps">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Created" value={fmtTs(p?.created_at)} mono />
          <Field label="Updated" value={fmtTs(p?.updated_at)} mono />
          <Field label="Last active" value={fmtTs(p?.last_active)} mono />
        </div>
      </Section>

      {p?.direct_reports && p.direct_reports.length > 0 && (
        <Section title="Direct reports">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {p.direct_reports.map((r) => (
              <button
                key={r.agent_id}
                type="button"
                onClick={() => useStore.getState().selectAgent(r.agent_id)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  border: '1px solid var(--cth-ink-300)',
                  borderRadius: 4,
                  background: 'var(--cth-cream-100)',
                  cursor: 'pointer',
                  fontSize: 12,
                  textAlign: 'left',
                }}
              >
                <span>{r.name}</span>
                <span style={{ color: 'var(--cth-ink-500)', fontSize: 11 }}>{r.title}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {goals.length > 0 && (
        <Section title="Active goals">
          {goals.map((g) => (
            <div key={g.id} style={{ fontSize: 12, padding: '4px 0', color: 'var(--cth-ink-800)' }}>
              {g.goal}
            </div>
          ))}
        </Section>
      )}

      {schedules.length > 0 && (
        <Section title="Schedules">
          {schedules.map((s) => (
            <div key={s.id} style={{ fontSize: 12, padding: '4px 0', color: 'var(--cth-ink-700)' }}>
              {s.name ?? s.id} {s.schedule ? `· ${s.schedule}` : ''}
            </div>
          ))}
        </Section>
      )}

      <Section title="Send message">
        <textarea
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          placeholder={`Message ${agent.name}…`}
          rows={3}
          style={{
            fontSize: 13,
            padding: 8,
            border: '1px solid var(--cth-ink-700)',
            borderRadius: 4,
            resize: 'vertical',
            fontFamily: 'var(--cth-font-ui)',
            background: 'var(--cth-cream-100)',
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <PixelButton variant="primary" size="sm" onClick={onSend} disabled={!messageText.trim()}>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <Icon name="arrow-right" /> Send via hive
            </span>
          </PixelButton>
          <PixelButton variant="secondary" size="sm" onClick={onSpeak}>
            Speak
          </PixelButton>
          <PixelButton variant="secondary" size="sm" onClick={() => void fetchAgentProfile(agent.id)}>
            Refresh
          </PixelButton>
        </div>
      </Section>
    </div>
  );
}
