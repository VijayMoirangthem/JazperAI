"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, X } from "lucide-react";

const API = "http://localhost:8000/api/knowledge";

interface KnowledgeItem {
  id: string; title: string; source_type: string;
  source_url: string | null; source_file: string | null;
  tags: string[]; char_count: number; created_at: string;
}

function relativeTime(iso: string) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return "< 1h ago";
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

const SOURCE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  paste: { bg: "color-mix(in srgb, #6366f1 12%, transparent)", color: "#818cf8", border: "color-mix(in srgb, #6366f1 30%, transparent)" },
  url:   { bg: "color-mix(in srgb, #10b981 12%, transparent)", color: "#34d399", border: "color-mix(in srgb, #10b981 30%, transparent)" },
  file:  { bg: "color-mix(in srgb, #f59e0b 12%, transparent)", color: "#fbbf24", border: "color-mix(in srgb, #f59e0b 30%, transparent)" },
};

const PILL: (active: boolean) => React.CSSProperties = (active) => ({
  padding: "3px 12px", borderRadius: "var(--r-full)", border: "none",
  cursor: "pointer", fontSize: 11, fontWeight: 500,
  background: active ? "var(--color-accent)" : "transparent",
  color: active ? "#fff" : "var(--color-text-muted)",
  transition: "background 0.15s",
});

type AddTab = "paste" | "url" | "file";

export function KnowledgePanel() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [addTab, setAddTab] = useState<AddTab>("paste");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Paste form
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [pasteTags, setPasteTags] = useState("");
  const [pasteLoading, setPasteLoading] = useState(false);
  const [pasteError, setPasteError] = useState("");
  const [pasteSuccess, setPasteSuccess] = useState(false);

  // URL form
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [urlSuccess, setUrlSuccess] = useState(false);

  // File form
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [fileSuccess, setFileSuccess] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  async function fetchItems() {
    setLoading(true);
    try {
      const r = await fetch(API);
      const data = await r.json();
      setItems(Array.isArray(data) ? data : (data.items ?? []));
    } catch { setItems([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchItems(); }, []);

  async function deleteItem(id: string) {
    setDeletingId(id);
    try {
      await fetch(`${API}/${id}`, { method: "DELETE" });
      setItems(prev => prev.filter(item => item.id !== id));
    } finally { setDeletingId(null); }
  }

  async function addPaste() {
    setPasteLoading(true); setPasteError(""); setPasteSuccess(false);
    try {
      const tags = pasteTags.split(",").map(t => t.trim()).filter(Boolean);
      const r = await fetch(`${API}/paste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: pasteTitle, content: pasteContent, tags }),
      });
      if (!r.ok) throw new Error(await r.text());
      setPasteTitle(""); setPasteContent(""); setPasteTags("");
      setPasteSuccess(true);
      setTimeout(() => setPasteSuccess(false), 2500);
      await fetchItems();
    } catch (e) { setPasteError(e instanceof Error ? e.message : String(e)); }
    finally { setPasteLoading(false); }
  }

  async function addUrl() {
    setUrlLoading(true); setUrlError(""); setUrlSuccess(false);
    try {
      const r = await fetch(`${API}/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput }),
      });
      if (!r.ok) throw new Error(await r.text());
      setUrlInput("");
      setUrlSuccess(true);
      setTimeout(() => setUrlSuccess(false), 2500);
      await fetchItems();
    } catch (e) { setUrlError(e instanceof Error ? e.message : String(e)); }
    finally { setUrlLoading(false); }
  }

  async function addFile(file: File) {
    setFileLoading(true); setFileError(""); setFileSuccess(false);
    setFileName(file.name);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const r = await fetch(`${API}/upload`, { method: "POST", body: formData });
      if (!r.ok) throw new Error(await r.text());
      setFileSuccess(true);
      setFileName(null);
      setTimeout(() => setFileSuccess(false), 2500);
      await fetchItems();
    } catch (e) { setFileError(e instanceof Error ? e.message : String(e)); }
    finally { setFileLoading(false); }
  }

  const filtered = items.filter(item =>
    item.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <BookOpen size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Knowledge Base</span>
        {items.length > 0 && (
          <span style={{
            marginLeft: "var(--sp-2)", fontSize: 10, fontWeight: 600,
            background: "var(--color-surface-float)", padding: "1px 7px",
            borderRadius: "var(--r-full)", color: "var(--color-text-muted)",
            border: "var(--border)",
          }}>
            {items.length}
          </span>
        )}
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={() => setAddMode(m => !m)}
            style={{
              padding: "3px 12px", borderRadius: "var(--r-sm)", border: "var(--border)",
              cursor: "pointer", fontSize: 11, fontWeight: 500,
              background: addMode ? "var(--color-accent)" : "transparent",
              color: addMode ? "#fff" : "var(--color-text-muted)",
              transition: "background 0.15s",
            }}
          >
            {addMode ? "← Back" : "+ Add"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto", padding: "var(--sp-3) var(--sp-4)" }}>

        {/* ── ADD VIEW ── */}
        {addMode && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, background: "var(--color-surface-raised)", padding: 3, borderRadius: "var(--r-md)", border: "var(--border)" }}>
              {(["paste", "url", "file"] as AddTab[]).map(t => (
                <button key={t} style={{ ...PILL(addTab === t), flex: 1, textTransform: "capitalize" }} onClick={() => setAddTab(t)}>
                  {t === "paste" ? "Paste Text" : t === "url" ? "URL" : "File"}
                </button>
              ))}
            </div>

            {/* Paste */}
            {addTab === "paste" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <input
                  className="sj-input"
                  placeholder="Title"
                  value={pasteTitle}
                  onChange={e => setPasteTitle(e.target.value)}
                />
                <textarea
                  className="sj-textarea"
                  placeholder="Paste your content here…"
                  value={pasteContent}
                  onChange={e => setPasteContent(e.target.value)}
                  rows={8}
                  style={{ resize: "vertical" }}
                />
                <input
                  className="sj-input"
                  placeholder="Tags (comma-separated)"
                  value={pasteTags}
                  onChange={e => setPasteTags(e.target.value)}
                />
                {pasteError && <p style={{ fontSize: 11, color: "#f87171" }}>{pasteError}</p>}
                {pasteSuccess && <p style={{ fontSize: 11, color: "#34d399" }}>Added successfully!</p>}
                <button
                  onClick={addPaste}
                  disabled={pasteLoading || !pasteTitle.trim() || !pasteContent.trim()}
                  style={{
                    padding: "6px 16px", borderRadius: "var(--r-sm)",
                    background: "var(--color-accent)", border: "none",
                    color: "#fff", fontSize: 12, cursor: "pointer",
                    opacity: pasteLoading || !pasteTitle.trim() || !pasteContent.trim() ? 0.5 : 1,
                    alignSelf: "flex-start",
                  }}
                >
                  {pasteLoading ? "Adding…" : "Add"}
                </button>
              </div>
            )}

            {/* URL */}
            {addTab === "url" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <input
                  className="sj-input"
                  placeholder="https://..."
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  type="url"
                />
                {urlError && <p style={{ fontSize: 11, color: "#f87171" }}>{urlError}</p>}
                {urlSuccess && <p style={{ fontSize: 11, color: "#34d399" }}>Fetched & added!</p>}
                <button
                  onClick={addUrl}
                  disabled={urlLoading || !urlInput.trim()}
                  style={{
                    padding: "6px 16px", borderRadius: "var(--r-sm)",
                    background: "var(--color-accent)", border: "none",
                    color: "#fff", fontSize: 12, cursor: "pointer",
                    opacity: urlLoading || !urlInput.trim() ? 0.5 : 1,
                    alignSelf: "flex-start",
                  }}
                >
                  {urlLoading ? "Fetching…" : "Fetch & Add"}
                </button>
              </div>
            )}

            {/* File */}
            {addTab === "file" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  style={{ display: "none" }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) addFile(file);
                    e.target.value = "";
                  }}
                />
                <div
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: "2px dashed var(--color-border)",
                    borderRadius: "var(--r-md)",
                    padding: "32px 16px",
                    textAlign: "center",
                    cursor: fileLoading ? "not-allowed" : "pointer",
                    opacity: fileLoading ? 0.6 : 1,
                    transition: "border-color 0.15s",
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    {fileLoading
                      ? `Uploading ${fileName ?? "file"}…`
                      : "Click to pick a PDF, TXT, or MD file"}
                  </div>
                </div>
                {fileError && <p style={{ fontSize: 11, color: "#f87171" }}>{fileError}</p>}
                {fileSuccess && <p style={{ fontSize: 11, color: "#34d399" }}>File uploaded & added!</p>}
              </div>
            )}
          </div>
        )}

        {/* ── LIST VIEW ── */}
        {!addMode && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {/* Search */}
            <input
              className="sj-input"
              placeholder="Search knowledge items…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />

            {loading && <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</p>}

            {!loading && filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "var(--sp-6) 0", color: "var(--color-text-muted)" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📚</div>
                <p style={{ fontSize: 12 }}>
                  {search ? "No items match your search." : "No knowledge items yet. Add a document, URL, or paste text."}
                </p>
              </div>
            )}

            {filtered.map(item => {
              const sc = SOURCE_COLORS[item.source_type] ?? SOURCE_COLORS.paste;
              return (
                <div key={item.id} className="sj-card">
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>
                        {item.title}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "1px 7px",
                          borderRadius: "var(--r-full)",
                          background: sc.bg, color: sc.color,
                          border: `1px solid ${sc.border}`,
                          textTransform: "capitalize",
                        }}>
                          {item.source_type}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          {(item.char_count / 1000).toFixed(1)}k chars
                        </span>
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          {relativeTime(item.created_at)}
                        </span>
                      </div>
                      {item.tags.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {item.tags.map(tag => (
                            <span key={tag} style={{
                              fontSize: 10, padding: "1px 6px", borderRadius: "var(--r-sm)",
                              background: "var(--color-surface-float)", border: "var(--border)",
                              color: "var(--color-text-muted)",
                            }}>
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => deleteItem(item.id)}
                      disabled={deletingId === item.id}
                      title="Delete"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "#ef4444", padding: 2, flexShrink: 0,
                        opacity: deletingId === item.id ? 0.4 : 0.7,
                        display: "flex", alignItems: "center",
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
