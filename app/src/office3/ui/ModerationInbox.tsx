"use client";

import { useEffect, useState } from "react";
import { loadOfficePersonSession, officePersonAuthHeaders } from "../core/auth";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
type Report = { id: number; conversation_id: string; message_id: number; reporter: string; reason: string; at: number; sender?: string; text?: string };

export function ModerationInbox({ onClose }: { onClose(): void }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => fetch(`${API}/api/v1/office/conversation-reports`, { headers: officePersonAuthHeaders() }).then(response => response.ok ? response.json() : Promise.reject()).then(value => { if (active) setReports(value.reports ?? []); }).catch(() => { if (active) setError("Unable to load moderation reports."); });
    load(); const timer = window.setInterval(load, 8000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const resolve = (id: number, status: "reviewed" | "dismissed") => {
    fetch(`${API}/api/v1/office/conversation-reports/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ moderator: loadOfficePersonSession()?.personId ?? "founder", status }) })
      .then(response => { if (!response.ok) throw Error("resolution failed"); setReports(current => current.filter(report => report.id !== id)); })
      .catch(() => setError("Unable to resolve this report."));
  };
  return <aside className="absolute right-3 top-14 z-40 max-h-[calc(100%-5rem)] w-80 overflow-auto rounded-xl bg-slate-950/95 p-4 text-white shadow-2xl ring-1 ring-white/15">
    <button className="float-right text-xs opacity-70" onClick={onClose}>Close</button><h2 className="mb-1 text-sm font-semibold">Moderation reports</h2><p className="mb-3 text-[11px] opacity-60">Founder review queue for reported Office messages.</p>
    {error && <p className="mb-2 rounded bg-rose-950 p-2 text-xs text-rose-200">{error}</p>}
    {reports.length === 0 ? <p className="text-xs opacity-60">No pending message reports.</p> : reports.map(report => <article key={report.id} className="mb-2 rounded bg-slate-900 p-2 text-xs"><div className="font-medium">{report.sender ?? "Deleted sender"} · report #{report.id}</div><p className="mt-1 rounded bg-black/20 p-1 text-slate-200">{report.text ?? "Original message is no longer available."}</p><p className="mt-1 text-amber-200">Reason: {report.reason}</p><p className="mt-1 opacity-60">Reported by {report.reporter}</p><div className="mt-2 flex gap-1"><button className="rounded bg-emerald-700 px-2 py-1" onClick={() => resolve(report.id, "reviewed")}>Reviewed</button><button className="rounded bg-slate-700 px-2 py-1" onClick={() => resolve(report.id, "dismissed")}>Dismiss</button></div></article>)}
  </aside>;
}
