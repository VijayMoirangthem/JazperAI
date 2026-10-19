"use client";

import { useEffect, useState } from "react";
import { Users, ExternalLink } from "lucide-react";

const API = "http://localhost:8000/api/contacts";

interface Contact {
  id: string; name: string; company: string | null;
  title: string | null; email: string | null;
  linkedin_url: string | null; phone: string | null;
  relationship_type: string; last_contact_at: string | null;
  notes: string; tags: string[]; created_at: string;
}

type RelType = "recruiter" | "hiring_manager" | "connection" | "colleague" | "other";

const REL_COLORS: Record<RelType, { bg: string; color: string; border: string }> = {
  recruiter:      { bg: "color-mix(in srgb, #8b5cf6 12%, transparent)", color: "#a78bfa", border: "color-mix(in srgb, #8b5cf6 30%, transparent)" },
  hiring_manager: { bg: "color-mix(in srgb, #3b82f6 12%, transparent)", color: "#60a5fa", border: "color-mix(in srgb, #3b82f6 30%, transparent)" },
  connection:     { bg: "color-mix(in srgb, #22c55e 12%, transparent)", color: "#4ade80", border: "color-mix(in srgb, #22c55e 30%, transparent)" },
  colleague:      { bg: "color-mix(in srgb, #f59e0b 12%, transparent)", color: "#fbbf24", border: "color-mix(in srgb, #f59e0b 30%, transparent)" },
  other:          { bg: "color-mix(in srgb, #6b7280 12%, transparent)", color: "#9ca3af", border: "color-mix(in srgb, #6b7280 30%, transparent)" },
};

const REL_LABELS: Record<RelType, string> = {
  recruiter:      "Recruiter",
  hiring_manager: "Hiring Manager",
  connection:     "Connection",
  colleague:      "Colleague",
  other:          "Other",
};

function relativeTime(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return "< 1h ago";
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

const EMPTY_FORM = {
  name: "", company: "", title: "", email: "",
  linkedin_url: "", phone: "", notes: "",
  relationship_type: "recruiter" as RelType,
};

export function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [touchingId, setTouchingId] = useState<string | null>(null);

  async function fetchContacts(q = "") {
    setLoading(true);
    try {
      const url = q ? `${API}?q=${encodeURIComponent(q)}` : API;
      const r = await fetch(url);
      const data = await r.json();
      setContacts(Array.isArray(data) ? data : (data.contacts ?? []));
    } catch { setContacts([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchContacts(); }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => fetchContacts(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  async function deleteContact(id: string) {
    setDeletingId(id);
    try {
      await fetch(`${API}/${id}`, { method: "DELETE" });
      setContacts(prev => prev.filter(c => c.id !== id));
    } finally { setDeletingId(null); }
  }

  async function touchContact(id: string) {
    setTouchingId(id);
    try {
      await fetch(`${API}/${id}/touch`, { method: "POST" });
      await fetchContacts(search);
    } finally { setTouchingId(null); }
  }

  async function saveContact() {
    setSaving(true); setSaveError("");
    try {
      const body = {
        name: form.name.trim(),
        company: form.company.trim() || null,
        title: form.title.trim() || null,
        email: form.email.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim(),
        relationship_type: form.relationship_type,
      };
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      setForm({ ...EMPTY_FORM });
      setAddMode(false);
      await fetchContacts(search);
    } catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  function setF(patch: Partial<typeof form>) { setForm(prev => ({ ...prev, ...patch })); }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--color-surface-raised)", border: "var(--border)",
    borderRadius: "var(--r-sm)", padding: "var(--sp-2) var(--sp-3)",
    fontSize: 12, color: "var(--color-text)", outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <Users size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Contacts</span>
        {contacts.length > 0 && (
          <span style={{
            marginLeft: "var(--sp-2)", fontSize: 10, fontWeight: 600,
            background: "var(--color-surface-float)", padding: "1px 7px",
            borderRadius: "var(--r-full)", color: "var(--color-text-muted)",
            border: "var(--border)",
          }}>
            {contacts.length}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto", padding: "var(--sp-3) var(--sp-4)", position: "relative" }}>

        {/* ── ADD FORM ── */}
        {addMode && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-1)" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>Add Contact</span>
              <button
                onClick={() => { setAddMode(false); setForm({ ...EMPTY_FORM }); setSaveError(""); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-muted)", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <input style={inputStyle} placeholder="Name *" value={form.name} onChange={e => setF({ name: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
              <input style={inputStyle} placeholder="Company" value={form.company} onChange={e => setF({ company: e.target.value })} />
              <input style={inputStyle} placeholder="Title" value={form.title} onChange={e => setF({ title: e.target.value })} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
              <input style={inputStyle} placeholder="Email" type="email" value={form.email} onChange={e => setF({ email: e.target.value })} />
              <input style={inputStyle} placeholder="Phone" value={form.phone} onChange={e => setF({ phone: e.target.value })} />
            </div>
            <input style={inputStyle} placeholder="LinkedIn URL" value={form.linkedin_url} onChange={e => setF({ linkedin_url: e.target.value })} />

            <select
              value={form.relationship_type}
              onChange={e => setF({ relationship_type: e.target.value as RelType })}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              {(Object.keys(REL_LABELS) as RelType[]).map(k => (
                <option key={k} value={k}>{REL_LABELS[k]}</option>
              ))}
            </select>

            <textarea
              style={{ ...inputStyle, resize: "vertical" } as React.CSSProperties}
              placeholder="Notes"
              value={form.notes}
              onChange={e => setF({ notes: e.target.value })}
              rows={3}
            />

            {saveError && <p style={{ fontSize: 11, color: "#f87171" }}>{saveError}</p>}

            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button
                onClick={saveContact}
                disabled={saving || !form.name.trim()}
                style={{
                  padding: "6px 20px", borderRadius: "var(--r-sm)",
                  background: "var(--color-accent)", border: "none",
                  color: "#fff", fontSize: 12, cursor: "pointer",
                  opacity: saving || !form.name.trim() ? 0.5 : 1,
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setAddMode(false); setForm({ ...EMPTY_FORM }); setSaveError(""); }}
                style={{
                  padding: "6px 16px", borderRadius: "var(--r-sm)",
                  background: "transparent", border: "var(--border)",
                  color: "var(--color-text-muted)", fontSize: 12, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>

            <div style={{ borderTop: "var(--border)", marginTop: "var(--sp-2)", paddingTop: "var(--sp-3)" }} />
          </div>
        )}

        {/* ── LIST VIEW ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <input
            className="sj-input"
            placeholder="Search contacts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {loading && <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</p>}

          {!loading && contacts.length === 0 && (
            <div style={{ textAlign: "center", padding: "var(--sp-6) 0", color: "var(--color-text-muted)" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>👥</div>
              <p style={{ fontSize: 12 }}>No contacts yet. Click "+ Add Contact" to get started.</p>
            </div>
          )}

          {contacts.map(contact => {
            const relType = contact.relationship_type as RelType;
            const rc = REL_COLORS[relType] ?? REL_COLORS.other;
            return (
              <div key={contact.id} className="sj-card">
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Name + badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                        {contact.name}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "1px 7px",
                        borderRadius: "var(--r-full)",
                        background: rc.bg, color: rc.color, border: `1px solid ${rc.border}`,
                      }}>
                        {REL_LABELS[relType] ?? contact.relationship_type}
                      </span>
                      {contact.linkedin_url && (
                        <a
                          href={contact.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          title="LinkedIn"
                          style={{ color: "#60a5fa", display: "flex", alignItems: "center" }}
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>

                    {/* Company / title */}
                    {(contact.company || contact.title) && (
                      <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 3px 0" }}>
                        {[contact.title, contact.company].filter(Boolean).join(" @ ")}
                      </p>
                    )}

                    {/* Email */}
                    {contact.email && (
                      <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "0 0 4px 0" }}>
                        ✉ {contact.email}
                      </p>
                    )}

                    {/* Last contact */}
                    <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0 }}>
                      Last contact: {relativeTime(contact.last_contact_at)}
                    </p>

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-2)" }}>
                      <button
                        onClick={() => touchContact(contact.id)}
                        disabled={touchingId === contact.id}
                        style={{
                          padding: "3px 10px", borderRadius: "var(--r-sm)",
                          background: "var(--color-surface-float)", border: "var(--border)",
                          color: "var(--color-text-muted)", fontSize: 10, cursor: "pointer",
                          opacity: touchingId === contact.id ? 0.5 : 1,
                        }}
                      >
                        {touchingId === contact.id ? "Saving…" : "Contacted Today"}
                      </button>
                      <button
                        onClick={() => deleteContact(contact.id)}
                        disabled={deletingId === contact.id}
                        style={{
                          padding: "3px 10px", borderRadius: "var(--r-sm)",
                          background: "transparent", border: "1px solid color-mix(in srgb, #ef4444 30%, transparent)",
                          color: "#f87171", fontSize: 10, cursor: "pointer",
                          opacity: deletingId === contact.id ? 0.4 : 1,
                        }}
                      >
                        {deletingId === contact.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Floating "+ Add Contact" button */}
        {!addMode && (
          <div style={{ position: "sticky", bottom: 0, paddingTop: "var(--sp-3)", background: "var(--color-bg)" }}>
            <button
              onClick={() => setAddMode(true)}
              style={{
                width: "100%", padding: "8px 0", borderRadius: "var(--r-sm)",
                background: "var(--color-accent)", border: "none",
                color: "#fff", fontSize: 12, fontWeight: 500, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <Users size={12} /> + Add Contact
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
