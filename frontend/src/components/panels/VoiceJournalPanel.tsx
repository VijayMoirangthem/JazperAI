"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Mic, Square, Trash2, RefreshCw, BookOpen, Loader2 } from "lucide-react";

const API = "http://localhost:8000";

interface JournalEntry {
  id: string;
  transcription: string;
  duration_seconds: number;
  created_at: string | null;
}

function fmtDuration(s: number): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtDate(ts: string | null): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
}

type RecordState = "idle" | "recording" | "uploading";

export function VoiceJournalPanel() {
  const [entries, setEntries]       = useState<JournalEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [recState, setRecState]     = useState<RecordState>("idle");
  const [elapsed, setElapsed]       = useState(0);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [micError, setMicError]     = useState<string | null>(null);

  const mediaRecRef  = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/voice-journal`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function startRecording() {
    setMicError(null);
    setLastTranscript(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); };
      mr.start(250);
      mediaRecRef.current = mr;
      startTimeRef.current = Date.now();
      setElapsed(0);
      setRecState("recording");

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (e) {
      setMicError(e instanceof Error ? e.message : "Microphone access denied");
    }
  }

  async function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!mediaRecRef.current) return;

    const duration = (Date.now() - startTimeRef.current) / 1000;
    setRecState("uploading");

    await new Promise<void>(resolve => {
      if (!mediaRecRef.current) { resolve(); return; }
      mediaRecRef.current.onstop = () => resolve();
      mediaRecRef.current.stop();
    });

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    const form = new FormData();
    form.append("audio", blob, "journal.webm");
    form.append("duration", String(duration));

    try {
      const res = await fetch(`${API}/api/voice-journal/record`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLastTranscript(data.transcription || "(empty)");
      await load();
    } catch (e) {
      setMicError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setRecState("idle");
      mediaRecRef.current = null;
    }
  }

  async function deleteEntry(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
    try {
      await fetch(`${API}/api/voice-journal/${id}`, { method: "DELETE" });
    } catch { load(); }
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Mic size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Voice Journal</span>
        <button
          onClick={load}
          style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}
        >
          <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
        </button>
      </div>

      {/* Recorder */}
      <div style={{
        padding: "var(--sp-4) var(--sp-3)",
        borderBottom: "var(--border)", flexShrink: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-3)",
      }}>
        <button
          onClick={recState === "recording" ? stopRecording : startRecording}
          disabled={recState === "uploading"}
          style={{
            width: 64, height: 64, borderRadius: "var(--r-full)", border: "none",
            cursor: recState === "uploading" ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: recState === "recording"
              ? "#ef4444"
              : recState === "uploading"
              ? "var(--color-surface-raised)"
              : "var(--color-accent)",
            color: "#fff",
            boxShadow: recState === "recording" ? "0 0 0 6px #ef444430" : "0 4px 16px rgba(0,0,0,0.25)",
            transition: "all 0.2s ease",
          }}
        >
          {recState === "uploading"
            ? <Loader2 size={24} className="sj-spin" />
            : recState === "recording"
            ? <Square size={22} />
            : <Mic size={26} />
          }
        </button>

        <div style={{ textAlign: "center" }}>
          {recState === "recording" && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s ease infinite" }} />
              <span style={{ fontSize: 13, color: "#ef4444", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                {fmtDuration(elapsed) || "0s"}
              </span>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>recording — tap to stop</span>
            </div>
          )}
          {recState === "uploading" && (
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Transcribing…</span>
          )}
          {recState === "idle" && !lastTranscript && (
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Tap to start recording</span>
          )}
          {micError && (
            <span style={{ fontSize: 11, color: "#ef4444" }}>{micError}</span>
          )}
        </div>

        {lastTranscript && recState === "idle" && (
          <div className="sj-card" style={{
            width: "100%", background: "color-mix(in srgb, var(--color-accent) 6%, var(--color-surface-raised))",
            borderColor: "color-mix(in srgb, var(--color-accent) 25%, transparent)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
              <BookOpen size={10} style={{ color: "var(--color-accent)" }} />
              <span style={{ fontSize: 11, color: "var(--color-accent)", fontWeight: 600 }}>Transcribed & Saved</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.6, margin: 0 }}>
              {lastTranscript}
            </p>
          </div>
        )}
      </div>

      {/* Past entries */}
      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading && entries.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : error ? (
          <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", padding: "var(--sp-4)" }}>{error}</p>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>🎙️</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              No journal entries yet. Tap the mic to record your first one.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {entries.map(entry => (
              <div key={entry.id} style={{
                padding: "var(--sp-3)",
                borderBottom: "1px solid var(--color-border-lo)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                  <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                    {fmtDate(entry.created_at)}
                  </span>
                  {entry.duration_seconds > 0 && (
                    <span style={{
                      fontSize: 9, padding: "1px 5px", borderRadius: "var(--r-full)",
                      background: "var(--color-surface-raised)", color: "var(--color-text-muted)",
                      border: "var(--border)",
                    }}>
                      {fmtDuration(entry.duration_seconds)}
                    </span>
                  )}
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    title="Delete"
                    style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 2, display: "flex" }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.65, margin: 0 }}>
                  {entry.transcription || <em style={{ color: "var(--color-text-muted)" }}>No transcription</em>}
                </p>
              </div>
            ))}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
