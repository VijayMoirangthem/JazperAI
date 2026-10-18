"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Brain, RefreshCw, Play, Star, ChevronRight, ChevronLeft,
  Trash2, Plus, Loader2, CheckCircle2, MessageSquare,
} from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

type Mode = "setup" | "practice" | "review" | "history";

interface Question { q: string; category: "behavioral" | "technical" | "situational" | "culture" }
interface Answer   { question: string; answer: string; score: number; feedback: string; tips: string[]; created_at?: string }
interface Session  { id: string; company: string; role: string; questions: Question[]; created_at: string }

const CAT_META: Record<string, { label: string; color: string }> = {
  behavioral:   { label: "Behavioral",   color: "#8b5cf6" },
  technical:    { label: "Technical",    color: "#3b82f6" },
  situational:  { label: "Situational",  color: "#f59e0b" },
  culture:      { label: "Culture Fit",  color: "#22c55e" },
};

function ScoreDots({ score }: { score: number }) {
  const filled = Math.round(score);
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: "50%",
          background: i < filled
            ? (score >= 7 ? "#22c55e" : score >= 5 ? "#f59e0b" : "#ef4444")
            : "var(--color-surface-raised)",
          border: "1px solid var(--color-border)",
        }} />
      ))}
      <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 4, color: score >= 7 ? "#22c55e" : score >= 5 ? "#f59e0b" : "#ef4444", fontFamily: "var(--font-mono)" }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

export function InterviewPrepPanel() {
  const toast = useToast();

  const [mode, setMode]             = useState<Mode>("setup");
  const [company, setCompany]       = useState("");
  const [role, setRole]             = useState("");
  const [jobDesc, setJobDesc]       = useState("");
  const [generating, setGenerating] = useState(false);

  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [questions, setQuestions]   = useState<Question[]>([]);
  const [qIdx, setQIdx]             = useState(0);
  const [answers, setAnswers]       = useState<Answer[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [rating, setRating]         = useState<Answer | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);

  const [sessions, setSessions]     = useState<Session[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const textRef = useRef<HTMLTextAreaElement>(null);

  // Load history on mount
  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await fetch(`${API}/api/interview-prep/sessions`);
      if (res.ok) setSessions((await res.json()).sessions || []);
    } catch { /* silent */ } finally { setHistLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function generate() {
    if (!company.trim() || !role.trim()) { toast("Enter company and role first", "warning"); return; }
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/interview-prep/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, role, job_description: jobDesc }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessionId(data.session_id);
      setQuestions(data.questions || []);
      setAnswers([]);
      setQIdx(0);
      setCurrentAnswer("");
      setRating(null);
      setMode("practice");
      toast(`${data.questions?.length || 0} questions generated for ${company}`, "success");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setGenerating(false); }
  }

  async function rateAnswer() {
    const q = questions[qIdx];
    if (!q || !currentAnswer.trim()) { toast("Write your answer first", "warning"); return; }
    setRatingLoading(true);
    try {
      const res = await fetch(`${API}/api/interview-prep/rate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.q, answer: currentAnswer, company, role }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ans: Answer = { question: q.q, answer: currentAnswer, score: data.score, feedback: data.feedback, tips: data.tips || [] };
      setRating(ans);
      setAnswers(prev => {
        const updated = [...prev];
        updated[qIdx] = ans;
        return updated;
      });
    } catch (e) {
      toast(`Rating failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setRatingLoading(false); }
  }

  function nextQ() {
    if (qIdx < questions.length - 1) {
      setQIdx(qIdx + 1);
      setCurrentAnswer(answers[qIdx + 1]?.answer || "");
      setRating(answers[qIdx + 1] || null);
      setTimeout(() => textRef.current?.focus(), 50);
    } else {
      setMode("review");
    }
  }

  function prevQ() {
    if (qIdx > 0) {
      setQIdx(qIdx - 1);
      setCurrentAnswer(answers[qIdx - 1]?.answer || "");
      setRating(answers[qIdx - 1] || null);
    }
  }

  async function deleteSession(id: string) {
    setSessions(prev => prev.filter(s => s.id !== id));
    try { await fetch(`${API}/api/interview-prep/sessions/${id}`, { method: "DELETE" }); }
    catch { loadHistory(); }
  }

  const answeredCount  = answers.filter(Boolean).length;
  const avgScore       = answers.filter(Boolean).length > 0
    ? answers.filter(Boolean).reduce((s, a) => s + a.score, 0) / answers.filter(Boolean).length
    : 0;

  const q = questions[qIdx];

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Brain size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Interview Prep</span>
        {mode !== "setup" && (
          <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: "var(--sp-2)" }}>
            {company} · {role}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)" }}>
          {mode !== "history" && (
            <button onClick={() => setMode("history")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--color-text-muted)" }}>
              History
            </button>
          )}
          {mode !== "setup" && (
            <button
              onClick={() => { setMode("setup"); setSessionId(null); setQuestions([]); setAnswers([]); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--color-accent)" }}
            >
              + New Session
            </button>
          )}
        </div>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>

        {/* ── SETUP ────────────────────────────────────────────────── */}
        {mode === "setup" && (
          <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)", maxWidth: 480, margin: "0 auto" }}>
            <div style={{ textAlign: "center", padding: "var(--sp-4) 0" }}>
              <div style={{ fontSize: 40, marginBottom: "var(--sp-2)" }}>🎯</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>Interview Prep</p>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: "var(--sp-1)" }}>
                Generate a tailored question set, practice your answers, get AI coaching.
              </p>
            </div>

            <input className="sj-input" placeholder="Company name  (e.g. Google)" value={company} onChange={e => setCompany(e.target.value)} style={{ fontSize: 13 }} />
            <input className="sj-input" placeholder="Role  (e.g. Senior Software Engineer)" value={role} onChange={e => setRole(e.target.value)} style={{ fontSize: 13 }} />
            <textarea
              className="sj-input"
              placeholder="Job description  (optional — paste for better questions)"
              value={jobDesc}
              onChange={e => setJobDesc(e.target.value)}
              rows={4}
              style={{ fontSize: 12, resize: "vertical" }}
            />
            <button
              onClick={generate}
              disabled={generating || !company.trim() || !role.trim()}
              style={{
                padding: "10px", borderRadius: "var(--r-sm)", border: "none",
                background: generating || !company.trim() || !role.trim() ? "var(--color-surface-raised)" : "var(--color-accent)",
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: generating || !company.trim() || !role.trim() ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-2)",
                opacity: !company.trim() || !role.trim() ? 0.5 : 1,
              }}
            >
              {generating ? <><Loader2 size={14} className="sj-spin" /> Generating questions…</> : <><Play size={14} /> Generate Interview Questions</>}
            </button>

            {sessions.length > 0 && (
              <div style={{ marginTop: "var(--sp-2)" }}>
                <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: "var(--sp-2)" }}>Recent sessions:</p>
                {sessions.slice(0, 3).map(s => (
                  <div
                    key={s.id}
                    onClick={() => { setCompany(s.company); setRole(s.role); }}
                    style={{ padding: "var(--sp-2) var(--sp-3)", borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: 12, color: "var(--color-text-muted)", background: "var(--color-surface-raised)", marginBottom: 4, display: "flex", justifyContent: "space-between" }}
                  >
                    <span>{s.company} · {s.role}</span>
                    <span style={{ fontSize: 10 }}>{s.questions?.length || 0}q</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PRACTICE ─────────────────────────────────────────────── */}
        {mode === "practice" && q && (
          <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {/* Progress */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <div style={{ flex: 1, height: 4, background: "var(--color-surface-raised)", borderRadius: "var(--r-full)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${((qIdx + 1) / questions.length) * 100}%`, background: "var(--color-accent)", borderRadius: "var(--r-full)", transition: "width 0.3s" }} />
              </div>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)", flexShrink: 0, fontFamily: "var(--font-mono)" }}>
                {qIdx + 1} / {questions.length}
              </span>
            </div>

            {/* Category + Question */}
            <div className="sj-card" style={{ padding: "var(--sp-4)" }}>
              {q.category && (
                <span style={{
                  display: "inline-block", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-full)",
                  background: `${CAT_META[q.category]?.color || "#6b7280"}18`,
                  border: `1px solid ${CAT_META[q.category]?.color || "#6b7280"}44`,
                  color: CAT_META[q.category]?.color || "#6b7280",
                  marginBottom: "var(--sp-3)", textTransform: "uppercase", letterSpacing: "0.06em",
                }}>
                  {CAT_META[q.category]?.label || q.category}
                </span>
              )}
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text)", lineHeight: 1.6, margin: 0 }}>{q.q}</p>
            </div>

            {/* Answer textarea */}
            <textarea
              ref={textRef}
              className="sj-input"
              placeholder="Type your answer here… Use the STAR method for behavioral questions (Situation, Task, Action, Result)"
              value={currentAnswer}
              onChange={e => { setCurrentAnswer(e.target.value); setRating(null); }}
              rows={5}
              style={{ fontSize: 13, resize: "vertical", lineHeight: 1.6 }}
              autoFocus
            />

            {/* Rate button */}
            <button
              onClick={rateAnswer}
              disabled={ratingLoading || !currentAnswer.trim()}
              style={{
                padding: "8px", borderRadius: "var(--r-sm)", border: "none",
                background: ratingLoading || !currentAnswer.trim() ? "var(--color-surface-raised)" : "var(--color-accent)",
                color: "#fff", fontSize: 12, fontWeight: 600,
                cursor: ratingLoading || !currentAnswer.trim() ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-2)",
                opacity: !currentAnswer.trim() ? 0.5 : 1,
              }}
            >
              {ratingLoading ? <><Loader2 size={12} className="sj-spin" /> Rating…</> : <><Star size={12} /> Rate My Answer</>}
            </button>

            {/* Rating result */}
            {rating && (
              <div className="sj-card" style={{ background: rating.score >= 7 ? "#14532d18" : rating.score >= 5 ? "#78350f18" : "#7f1d1d18", borderColor: rating.score >= 7 ? "#22c55e44" : rating.score >= 5 ? "#f59e0b44" : "#ef444444" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-3)" }}>
                  <span className="sj-label">AI Coach Feedback</span>
                  <ScoreDots score={rating.score} />
                </div>
                <p style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.65, margin: "0 0 var(--sp-3)" }}>{rating.feedback}</p>
                {rating.tips.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                    {rating.tips.map((tip, i) => (
                      <div key={i} style={{ display: "flex", gap: "var(--sp-2)", fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                        <span style={{ color: "var(--color-accent)", flexShrink: 0, fontWeight: 700 }}>{i + 1}.</span>
                        <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Nav */}
            <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
              <button onClick={prevQ} disabled={qIdx === 0} style={{ flex: 1, padding: "8px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", cursor: qIdx === 0 ? "not-allowed" : "pointer", opacity: qIdx === 0 ? 0.4 : 1, fontSize: 12, color: "var(--color-text-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                <ChevronLeft size={12} /> Previous
              </button>
              <button onClick={nextQ} style={{ flex: 1, padding: "8px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                {qIdx < questions.length - 1 ? <><ChevronRight size={12} /> Next</> : <><CheckCircle2 size={12} /> Finish Review</>}
              </button>
            </div>
          </div>
        )}

        {/* ── REVIEW ───────────────────────────────────────────────── */}
        {mode === "review" && (
          <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {/* Summary */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-2)" }}>
              {[
                { label: "Questions",  value: questions.length },
                { label: "Answered",   value: answeredCount },
                { label: "Avg Score",  value: answeredCount > 0 ? avgScore.toFixed(1) : "—" },
              ].map(c => (
                <div key={c.label} className="sj-metric-card">
                  <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-1)", fontSize: 9 }}>{c.label}</span>
                  <div className="sj-metric" style={{ fontSize: 22, color: c.label === "Avg Score" && answeredCount > 0 ? (avgScore >= 7 ? "#22c55e" : avgScore >= 5 ? "#f59e0b" : "#ef4444") : undefined }}>
                    {c.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Q&A list */}
            {questions.map((q, i) => {
              const a = answers[i];
              return (
                <div key={i} className="sj-card" style={{ padding: "var(--sp-3)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {q.category && (
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: "var(--r-full)", background: `${CAT_META[q.category]?.color || "#6b7280"}18`, border: `1px solid ${CAT_META[q.category]?.color || "#6b7280"}44`, color: CAT_META[q.category]?.color || "#6b7280", marginRight: "var(--sp-2)", fontWeight: 700 }}>
                          {CAT_META[q.category]?.label}
                        </span>
                      )}
                      <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text)", marginTop: "var(--sp-1)", lineHeight: 1.5 }}>{q.q}</p>
                    </div>
                    {a && <ScoreDots score={a.score} />}
                  </div>
                  {a ? (
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--color-border-lo)", paddingTop: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                      {a.answer.length > 200 ? a.answer.slice(0, 200) + "…" : a.answer}
                    </div>
                  ) : (
                    <button onClick={() => { setQIdx(i); setCurrentAnswer(""); setRating(null); setMode("practice"); }} style={{ fontSize: 11, color: "var(--color-accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      Answer this →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── HISTORY ──────────────────────────────────────────────── */}
        {mode === "history" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "var(--sp-3) var(--sp-4)", borderBottom: "var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="sj-label">Past Sessions</span>
              <button onClick={() => { setMode("setup"); loadHistory(); }} style={{ fontSize: 11, color: "var(--color-accent)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                <Plus size={11} /> New
              </button>
            </div>
            {histLoading ? (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
            ) : sessions.length === 0 ? (
              <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
                <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>🎤</div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No prep sessions yet. Start one above.</p>
              </div>
            ) : sessions.map(s => (
              <div key={s.id} style={{ padding: "var(--sp-3)", borderBottom: "1px solid var(--color-border-lo)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <MessageSquare size={14} style={{ color: "var(--color-icon)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)" }}>{s.company} · {s.role}</div>
                  <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                    {s.questions?.length || 0} questions · {new Date(s.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => { setCompany(s.company); setRole(s.role); setQuestions(s.questions || []); setAnswers([]); setQIdx(0); setCurrentAnswer(""); setRating(null); setMode("practice"); }}
                  style={{ fontSize: 11, color: "var(--color-accent)", background: "none", border: "none", cursor: "pointer" }}
                >
                  Re-practice
                </button>
                <button onClick={() => deleteSession(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex" }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
