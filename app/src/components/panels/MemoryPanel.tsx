"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, Plus, Trash2, Search, Edit2, Check, X, RefreshCw, AlertTriangle, User, Save } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Tab = "profile" | "core" | "extracted" | "auto";

interface CoreMemory   { id: string; content: string; created_at: string; updated_at: string; }
interface ExtractedMemory { id: string; content: string; session_id: string; created_at: string; }
interface AutoMemory   { id: string; content: string; metadata: Record<string,string>; created_at: string; }
interface SearchResult { id: string; content: string; score: number; created_at: string; }

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Core tab ──────────────────────────────────────────────────────────────────

function CoreTab() {
  const [memories, setMemories] = useState<CoreMemory[]>([]);
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/memory/core`);
      const d = await r.json();
      setMemories(d.memories ?? []);
    } catch { /* backend not running */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!draft.trim()) return;
    await fetch(`${API}/api/memory/core`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: draft.trim() }),
    });
    setDraft("");
    load();
  }

  async function save(id: string) {
    await fetch(`${API}/api/memory/core/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editVal.trim() }),
    });
    setEditId(null);
    load();
  }

  async function remove(id: string) {
    await fetch(`${API}/api/memory/core/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", height: "100%" }}>
      <p className="sj-micro" style={{ color: "var(--color-text-muted)" }}>
        These facts are injected into <strong>every</strong> prompt — use them for things Jazper should always know about you.
      </p>

      {/* Add new */}
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <textarea
          className="sj-textarea"
          placeholder="e.g. I'm a software developer based in Karachi..."
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={2}
          style={{ flex: 1 }}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } }}
        />
        <button className="sj-btn-icon" onClick={add} disabled={!draft.trim()} style={{ alignSelf: "flex-end" }}>
          <Plus size={13} />
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {loading && <p className="sj-micro">Loading...</p>}
        {!loading && memories.length === 0 && (
          <p className="sj-micro" style={{ color: "var(--color-text-muted)" }}>No core memories yet. Add something above.</p>
        )}
        {memories.map(m => (
          <div key={m.id} className="sj-card" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
            {editId === m.id ? (
              <>
                <textarea
                  className="sj-textarea"
                  value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  rows={2}
                  style={{ flex: 1, fontSize: 12 }}
                  autoFocus
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button className="sj-btn-icon" onClick={() => save(m.id)} title="Save"><Check size={11} /></button>
                  <button className="sj-btn-icon" onClick={() => setEditId(null)} title="Cancel"><X size={11} /></button>
                </div>
              </>
            ) : (
              <>
                <p style={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: "var(--color-text-primary)" }}>{m.content}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                  <button className="sj-btn-icon" onClick={() => { setEditId(m.id); setEditVal(m.content); }} title="Edit"><Edit2 size={11} /></button>
                  <button className="sj-btn-icon" onClick={() => remove(m.id)} title="Delete"><Trash2 size={11} /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Extracted tab ─────────────────────────────────────────────────────────────

function ExtractedTab() {
  const [memories, setMemories] = useState<ExtractedMemory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/memory/extracted`);
      const d = await r.json();
      setMemories(d.memories ?? []);
    } catch { /* backend not running */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    await fetch(`${API}/api/memory/extracted/${id}`, { method: "DELETE" });
    setMemories(prev => prev.filter(m => m.id !== id));
  }

  async function clearAll() {
    await fetch(`${API}/api/memory/extracted`, { method: "DELETE" });
    setMemories([]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p className="sj-micro" style={{ color: "var(--color-text-muted)" }}>
          Facts automatically extracted by Jazper from your conversations.
        </p>
        {memories.length > 0 && (
          <button className="sj-btn-icon" onClick={clearAll} title="Clear all" style={{ color: "var(--color-error, #f87171)" }}>
            <Trash2 size={11} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {loading && <p className="sj-micro">Loading...</p>}
        {!loading && memories.length === 0 && (
          <p className="sj-micro" style={{ color: "var(--color-text-muted)" }}>No extracted memories yet. Keep chatting!</p>
        )}
        {memories.map(m => (
          <div key={m.id} className="sj-card" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
            <p style={{ flex: 1, fontSize: 12, color: "var(--color-text-primary)" }}>{m.content}</p>
            <span className="sj-micro" style={{ flexShrink: 0 }}>{timeAgo(m.created_at)}</span>
            <button className="sj-btn-icon" onClick={() => remove(m.id)} title="Delete"><Trash2 size={11} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Auto tab ──────────────────────────────────────────────────────────────────

function AutoTab() {
  const [memories, setMemories] = useState<AutoMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/memory/auto?limit=50`);
      const d = await r.json();
      setMemories(d.memories ?? []);
      setTotal(d.total ?? 0);
    } catch { /* backend not running */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    await fetch(`${API}/api/memory/auto/${id}`, { method: "DELETE" });
    setMemories(prev => prev.filter(m => m.id !== id));
    setTotal(t => t - 1);
  }

  async function clearAll() {
    await fetch(`${API}/api/memory/auto`, { method: "DELETE" });
    setMemories([]);
    setTotal(0);
    setSearchResults(null);
  }

  async function search() {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const r = await fetch(`${API}/api/memory/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim(), top_k: 10 }),
      });
      const d = await r.json();
      setSearchResults(d.results ?? []);
    } catch { setSearchResults([]); }
    setSearching(false);
  }

  const displayed = searchResults !== null ? searchResults : memories;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", height: "100%" }}>
      {/* Search bar */}
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <input
          className="sj-input"
          placeholder="Semantic search across memories..."
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
          onKeyDown={e => e.key === "Enter" && search()}
          style={{ flex: 1 }}
        />
        <button className="sj-btn-icon" onClick={search} disabled={searching} title="Search">
          <Search size={13} />
        </button>
        {searchResults !== null && (
          <button className="sj-btn-icon" onClick={() => { setSearchResults(null); setSearchQuery(""); }} title="Clear search">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Stats + clear */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="sj-micro">
          {searchResults !== null
            ? `${searchResults.length} results`
            : `${total} conversation turns stored`}
        </span>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <button className="sj-btn-icon" onClick={load} title="Refresh"><RefreshCw size={11} /></button>
          {total > 0 && (
            <button className="sj-btn-icon" onClick={clearAll} title="Clear all" style={{ color: "var(--color-error, #f87171)" }}>
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {(loading || searching) && <p className="sj-micro">Loading...</p>}
        {!loading && !searching && displayed.length === 0 && (
          <p className="sj-micro" style={{ color: "var(--color-text-muted)" }}>
            {searchResults !== null ? "No matching memories found." : "No auto memories yet. Start chatting!"}
          </p>
        )}
        {displayed.map((m: AutoMemory | SearchResult) => (
          <div key={m.id} className="sj-card" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 11, color: "var(--color-text-primary)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {m.content}
              </p>
              <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                <span className="sj-micro">{timeAgo(m.created_at)}</span>
                {"score" in m && (
                  <span className="sj-badge" style={{ fontSize: 9 }}>
                    {Math.round((m as SearchResult).score * 100)}% match
                  </span>
                )}
              </div>
            </div>
            <button className="sj-btn-icon" onClick={() => remove(m.id)} title="Delete"><Trash2 size={11} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Profile tab ───────────────────────────────────────────────────────────────

const SECTIONS = [
  { key: "bio",         label: "Background / About Me",        placeholder: "e.g. I'm a software developer from Manipur, India, currently based in Karachi. I have 3 years of experience building web applications..." },
  { key: "work",        label: "Work & Experience",             placeholder: "e.g. I've worked at X as a full-stack developer. My strongest areas are React, Python, and system design..." },
  { key: "goals",       label: "Goals & Ambitions",            placeholder: "e.g. I'm actively looking for a senior developer role. Long-term I want to build my own product..." },
  { key: "preferences", label: "Preferences & Working Style",  placeholder: "e.g. I prefer async communication, remote work, and direct feedback. I dislike unnecessary meetings..." },
  { key: "context",     label: "Current Focus",                placeholder: "e.g. I'm currently building Sir Jazper OS, a personal AI assistant. I'm also learning system design..." },
  { key: "notes",       label: "Always Remember",              placeholder: "e.g. I go by Vijay. Don't suggest things I've already tried. My timezone is PKT (UTC+5)..." },
];

interface UserProfile {
  full_name: string; location: string; email: string; phone: string;
  current_role: string; experience_years: string; availability: string;
  work_type: string; salary_expectation: string; skills: string[];
  sections: Record<string, string>;
}

const EMPTY_PROFILE: UserProfile = {
  full_name: "", location: "", email: "", phone: "",
  current_role: "", experience_years: "", availability: "",
  work_type: "", salary_expectation: "", skills: [],
  sections: Object.fromEntries(SECTIONS.map(s => [s.key, ""])),
};

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </label>
      <input
        type={type}
        className="sj-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ fontSize: 12 }}
      />
    </div>
  );
}

function ProfileTab() {
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [skillInput, setSkillInput] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/profile/`);
        const d = await r.json();
        setProfile({
          ...EMPTY_PROFILE, ...d,
          sections: { ...EMPTY_PROFILE.sections, ...(d.sections || {}) },
          skills: d.skills || [],
        });
      } catch { /* backend offline */ }
      setLoading(false);
    })();
  }, []);

  function set(field: keyof UserProfile, value: string) {
    setProfile(p => ({ ...p, [field]: value }));
  }

  function setSection(key: string, value: string) {
    setProfile(p => ({ ...p, sections: { ...p.sections, [key]: value } }));
  }

  function addSkill() {
    const s = skillInput.trim();
    if (!s || profile.skills.includes(s)) return;
    setProfile(p => ({ ...p, skills: [...p.skills, s] }));
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setProfile(p => ({ ...p, skills: p.skills.filter(s => s !== skill) }));
  }

  async function save() {
    setSaving(true);
    try {
      await fetch(`${API}/api/profile/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { console.error(e); }
    setSaving(false);
  }

  if (loading) return <p className="sj-micro">Loading...</p>;

  const fieldStyle = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>

      {/* Identity */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)", paddingBottom: "var(--sp-2)", borderBottom: "var(--border)" }}>
          <User size={12} style={{ color: "var(--color-accent)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Identity</span>
        </div>
        <div style={fieldStyle}>
          <Field label="Full Name"  value={profile.full_name}  onChange={v => set("full_name", v)}  placeholder="Vijay Moirangthem" />
          <Field label="Location"   value={profile.location}   onChange={v => set("location", v)}   placeholder="Karachi, Pakistan" />
          <Field label="Email"      value={profile.email}      onChange={v => set("email", v)}      placeholder="you@email.com" type="email" />
          <Field label="Phone"      value={profile.phone}      onChange={v => set("phone", v)}      placeholder="+92 300 0000000" />
        </div>
      </section>

      {/* Work */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)", paddingBottom: "var(--sp-2)", borderBottom: "var(--border)" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Work</span>
        </div>
        <div style={fieldStyle}>
          <Field label="Current Role"       value={profile.current_role}      onChange={v => set("current_role", v)}      placeholder="Full-Stack Developer" />
          <Field label="Experience"         value={profile.experience_years}  onChange={v => set("experience_years", v)}  placeholder="3 years" />
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Availability</label>
            <select className="sj-input" value={profile.availability} onChange={e => set("availability", e.target.value)} style={{ fontSize: 12, width: "100%" }}>
              <option value="">Not set</option>
              <option value="Immediately">Immediately</option>
              <option value="2 weeks notice">2 weeks notice</option>
              <option value="1 month notice">1 month notice</option>
              <option value="Not currently looking">Not currently looking</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Preferred Work Type</label>
            <select className="sj-input" value={profile.work_type} onChange={e => set("work_type", e.target.value)} style={{ fontSize: 12, width: "100%" }}>
              <option value="">Not set</option>
              <option value="Remote">Remote</option>
              <option value="Hybrid">Hybrid</option>
              <option value="On-site">On-site</option>
              <option value="Flexible">Flexible</option>
            </select>
          </div>
          <Field label="Salary Expectation" value={profile.salary_expectation} onChange={v => set("salary_expectation", v)} placeholder="e.g. $3000–5000/mo or Open" />
        </div>
      </section>

      {/* Skills */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)", paddingBottom: "var(--sp-2)", borderBottom: "var(--border)" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Skills</span>
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
          <input
            className="sj-input"
            value={skillInput}
            onChange={e => setSkillInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
            placeholder="Type a skill and press Enter..."
            style={{ flex: 1, fontSize: 12 }}
          />
          <button className="sj-btn-icon" onClick={addSkill} disabled={!skillInput.trim()}><Plus size={12} /></button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
          {profile.skills.map(skill => (
            <span key={skill} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: "var(--color-surface-raised)", border: "var(--border-hi)",
              borderRadius: "var(--r-sm)", padding: "2px 8px", fontSize: 11,
              color: "var(--color-text-primary)",
            }}>
              {skill}
              <button onClick={() => removeSkill(skill)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 0, display: "flex" }}>
                <X size={9} />
              </button>
            </span>
          ))}
          {profile.skills.length === 0 && <span className="sj-micro" style={{ color: "var(--color-text-muted)" }}>No skills added yet</span>}
        </div>
      </section>

      {/* Freeform sections */}
      {SECTIONS.map(s => (
        <section key={s.key}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)", paddingBottom: "var(--sp-2)", borderBottom: "var(--border)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: s.key === "notes" ? "var(--color-accent)" : "var(--color-text-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {s.label}
            </span>
          </div>
          <textarea
            className="sj-textarea"
            value={profile.sections[s.key] || ""}
            onChange={e => setSection(s.key, e.target.value)}
            placeholder={s.placeholder}
            rows={s.key === "notes" ? 3 : 4}
            style={{ fontSize: 12, width: "100%", resize: "vertical" }}
          />
        </section>
      ))}

      {/* Save button */}
      <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: "var(--sp-4)" }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            display: "flex", alignItems: "center", gap: "var(--sp-2)",
            background: saved ? "var(--color-accent)" : "var(--color-surface-raised)",
            border: "var(--border-hi)", borderRadius: "var(--r-sm)",
            padding: "8px 20px", fontSize: 12, fontWeight: 600, cursor: "pointer",
            color: saved ? "#000" : "var(--color-text-primary)",
            transition: "var(--ease-snap)",
          }}
        >
          {saved ? <Check size={13} /> : <Save size={13} />}
          {saving ? "Saving..." : saved ? "Saved!" : "Save Profile"}
        </button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "profile",   label: "Profile" },
  { id: "core",      label: "Core" },
  { id: "extracted", label: "Extracted" },
  { id: "auto",      label: "Auto" },
];

type ConfirmAction = "memories" | "everything" | null;

export function MemoryPanel() {
  const [tab, setTab] = useState<Tab>("profile");
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [clearing, setClearing] = useState(false);

  async function runClear(action: ConfirmAction) {
    if (!action) return;
    setClearing(true);
    try {
      const endpoint = action === "everything" ? "/api/memory/clear-everything" : "/api/memory/clear-memories";
      await fetch(`${API}${endpoint}`, { method: "DELETE" });
      // Force reload the page so all tabs refresh
      window.location.reload();
    } catch (e) {
      console.error("Clear failed", e);
    }
    setClearing(false);
    setConfirm(null);
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <Brain size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Memory</span>
        <div className="sj-ml-auto sj-flex sj-items-center sj-gap-2">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "2px 8px",
                borderRadius: "var(--r-xs)", fontSize: 11, fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? "var(--color-text-primary)" : "var(--color-text-muted)",
                borderBottom: tab === t.id ? "1px solid var(--color-accent)" : "1px solid transparent",
                transition: "var(--ease-snap)",
              }}
            >
              {t.label}
            </button>
          ))}

          {/* Divider */}
          <span style={{ width: 1, height: 12, background: "var(--color-border-hi)", margin: "0 4px" }} />

          <button
            onClick={() => setConfirm("memories")}
            title="Clear all memories (keeps chat history)"
            style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 6px",
              borderRadius: "var(--r-xs)", fontSize: 10, color: "#f59e0b", display: "flex", alignItems: "center", gap: 3 }}
          >
            <Trash2 size={10} /> Clear Memories
          </button>

          <button
            onClick={() => setConfirm("everything")}
            title="Clear memories AND all chat history"
            style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 6px",
              borderRadius: "var(--r-xs)", fontSize: 10, color: "#f87171", display: "flex", alignItems: "center", gap: 3 }}
          >
            <AlertTriangle size={10} /> Clear Everything
          </button>
        </div>
      </div>

      {/* Confirm dialog */}
      {confirm && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div className="sj-card" style={{ maxWidth: 360, width: "90%", padding: "var(--sp-5)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <AlertTriangle size={16} style={{ color: "#f87171", flexShrink: 0 }} />
              <p className="sj-subheading">
                {confirm === "everything" ? "Clear Everything?" : "Clear All Memories?"}
              </p>
            </div>
            <p className="sj-micro" style={{ color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              {confirm === "everything"
                ? "This will permanently delete all memories AND your entire chat history. This cannot be undone."
                : "This will permanently delete all core, extracted, and auto memories. Your chat history will be kept."}
            </p>
            <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirm(null)}
                style={{ background: "none", border: "var(--border-hi)", cursor: "pointer", padding: "6px 14px",
                  borderRadius: "var(--r-sm)", fontSize: 12, color: "var(--color-text-secondary)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => runClear(confirm)}
                disabled={clearing}
                style={{ background: "#f87171", border: "none", cursor: "pointer", padding: "6px 14px",
                  borderRadius: "var(--r-sm)", fontSize: 12, fontWeight: 600, color: "#fff", opacity: clearing ? 0.6 : 1 }}
              >
                {clearing ? "Clearing..." : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-4)" }}>
        {tab === "profile"   && <ProfileTab />}
        {tab === "core"      && <CoreTab />}
        {tab === "extracted" && <ExtractedTab />}
        {tab === "auto"      && <AutoTab />}
      </div>
    </div>
  );
}
