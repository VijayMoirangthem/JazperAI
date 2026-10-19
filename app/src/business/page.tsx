"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Sparkles, Wrench } from "lucide-react";

const API = "http://localhost:8000";

interface Message {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
}

const STARTERS = [
  "Add a client called Acme Corp — contact is Jane at jane@acme.com",
  "Create a project called Website Redesign for Acme Corp",
  "Show me all active projects",
  "What's our current outstanding invoice balance?",
];

function ToolPills({ tools }: { tools: string[] }) {
  if (!tools.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {tools.map((t, i) => (
        <span key={i} className="biz-badge biz-badge-accent">
          <Wrench size={9} /> {t.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

export default function BusinessChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || loading) return;

    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: "user", content: message }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/business/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: data.response, toolsUsed: data.tool_calls_made || [] },
      ]);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `Something went wrong reaching Jazper: ${e instanceof Error ? e.message : "unknown error"}. Is the backend running?`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 60px)" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="biz-page" style={{ paddingTop: messages.length ? 32 : 0, maxWidth: 760 }}>

          {messages.length === 0 && (
            <div style={{ paddingTop: "10vh" }}>
              <div style={{ textAlign: "center", marginBottom: 40 }}>
                <div
                  style={{
                    width: 52, height: 52, borderRadius: 14, margin: "0 auto 18px",
                    background: "linear-gradient(135deg, var(--biz-accent), #8B8FF8)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Sparkles size={24} color="white" />
                </div>
                <h1 className="biz-page-title" style={{ fontSize: 24 }}>Talk to Jazper</h1>
                <p className="biz-page-subtitle" style={{ maxWidth: 440, margin: "0 auto" }}>
                  Jazper runs the business — clients, projects, your team, invoicing.
                  Ask it to do something, not just show you something.
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {STARTERS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => send(s)}
                    className="biz-card biz-card-hover"
                    style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--biz-border)", fontSize: 12.5, color: "var(--biz-text-muted)", lineHeight: 1.5 }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "80%" }}>
                  <div
                    style={{
                      padding: "11px 16px",
                      borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                      background: m.role === "user" ? "var(--biz-accent)" : "var(--biz-surface)",
                      border: m.role === "user" ? "none" : "1px solid var(--biz-border)",
                      color: m.role === "user" ? "white" : "var(--biz-text)",
                      fontSize: 13.5,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.content}
                  </div>
                  {m.role === "assistant" && <ToolPills tools={m.toolsUsed || []} />}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div
                  className="biz-mono"
                  style={{
                    padding: "11px 16px", borderRadius: "14px 14px 14px 4px",
                    background: "var(--biz-surface)", border: "1px solid var(--biz-border)",
                    color: "var(--biz-text-muted)", fontSize: 12.5,
                    display: "flex", alignItems: "center", gap: 8,
                  }}
                >
                  <Loader2 size={13} className="biz-spin" /> Jazper is working…
                </div>
              </div>
            )}
          </div>
          <div ref={bottomRef} />
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--biz-border)", background: "var(--biz-bg-elevated)", padding: "16px 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            className="biz-textarea"
            placeholder="Ask Jazper to create a client, check a project's status, invoice someone…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            style={{ flex: 1, maxHeight: 140 }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="biz-btn biz-btn-primary biz-btn-icon"
            style={{ height: 40, width: 40 }}
          >
            {loading ? <Loader2 size={15} className="biz-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
