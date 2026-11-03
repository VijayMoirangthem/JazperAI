"use client";
import { useEffect, useState } from "react";
import { useOfficeText } from "./useOfficeText";
type Approval = { id: string; agent?: string; action?: string; description?: string; tier?: number };
export function AttentionInbox({ onClose }: { onClose(): void }) {
  const [items, setItems] = useState<Approval[]>([]);
  const t = useOfficeText();
  const refresh = () => fetch("/api/approvals/pending").then(response => response.json()).then(value => setItems(value.approvals ?? [])).catch(() => setItems([]));
  const [busy, setBusy] = useState<string | null>(null);
  // Reconcile with the server: requests resolved elsewhere (desktop panel, phone) disappear without a manual reload.
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 8000);
    return () => window.clearInterval(timer);
  }, []);
  const resolve = async (item: Approval, decision: "approve" | "deny") => { if (busy) return; setBusy(item.id); const response = await fetch(`/api/approvals/${item.id}/${decision}`, { method: "POST" }).catch(() => null); setBusy(null); if (!response?.ok) { refresh(); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: t("approvalFailed"), priority: "error" } })); return; } window.dispatchEvent(new CustomEvent("office3:approval-resolved", { detail: { agent: item.agent, approved: decision === "approve" } })); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: decision === "approve" ? t("approvalGranted") : t("approvalDenied"), priority: decision === "approve" ? "success" : "info" } })); refresh(); };
  return <aside className="absolute right-3 top-14 z-40 w-96 rounded-xl bg-slate-950/95 p-4 text-white shadow-2xl ring-1 ring-white/15"><button className="float-right text-xs opacity-70" onClick={onClose}>{t("helpClose")}</button><h2 className="mb-3 text-sm font-semibold">{t("attentionInbox")}</h2>{items.length === 0 ? <p className="text-xs opacity-60">{t("noApprovals")}</p> : items.map(item => <article key={item.id} className="mb-2 rounded-lg bg-slate-900 p-3 text-xs"><div className="font-semibold">{item.agent || t("agent")} · {item.action || t("approval")}{(item.tier ?? 0) >= 3 && <span className="ml-2 rounded bg-rose-900 px-1">Tier 3</span>}</div><p className="my-2 text-amber-200">{t("untrustedRequest", { description: item.description || t("reviewBefore") })}</p><button className="mr-2 rounded bg-emerald-700 px-2 py-1" disabled={busy === item.id} onClick={() => resolve(item, "approve")}>{t("approve")}</button><button className="rounded bg-rose-800 px-2 py-1" disabled={busy === item.id} onClick={() => resolve(item, "deny")}>{t("deny")}</button></article>)}</aside>;
}
