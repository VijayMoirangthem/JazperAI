"use client";
import { useEffect, useState } from "react";
import { useOfficeText } from "./useOfficeText";
type Approval = { id: string; agent?: string; action?: string; description?: string; tier?: number };
export function AttentionInbox({ onClose }: { onClose(): void }) {
  const [items, setItems] = useState<Approval[]>([]);
  const t = useOfficeText();
  const refresh = () => fetch("/api/approvals/pending").then(response => response.json()).then(value => setItems(value.approvals ?? [])).catch(() => setItems([]));
  useEffect(() => { refresh(); }, []);
  const resolve = async (item: Approval, decision: "approve" | "deny") => { const response = await fetch(`/api/approvals/${item.id}/${decision}`, { method: "POST" }); if (!response.ok) { window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: t("approvalFailed"), priority: "error" } })); return; } window.dispatchEvent(new CustomEvent("office3:approval-resolved", { detail: { agent: item.agent, approved: decision === "approve" } })); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: decision === "approve" ? t("approvalGranted") : t("approvalDenied"), priority: decision === "approve" ? "success" : "info" } })); refresh(); };
  return <aside className="absolute right-3 top-14 z-40 w-96 rounded-xl bg-slate-950/95 p-4 text-white shadow-2xl ring-1 ring-white/15"><button className="float-right text-xs opacity-70" onClick={onClose}>{t("helpClose")}</button><h2 className="mb-3 text-sm font-semibold">{t("attentionInbox")}</h2>{items.length === 0 ? <p className="text-xs opacity-60">{t("noApprovals")}</p> : items.map(item => <article key={item.id} className="mb-2 rounded-lg bg-slate-900 p-3 text-xs"><div className="font-semibold">{item.agent || t("agent")} · {item.action || t("approval")}</div><p className="my-2 text-amber-200">{t("untrustedRequest", { description: item.description || t("reviewBefore") })}</p><button className="mr-2 rounded bg-emerald-700 px-2 py-1" onClick={() => resolve(item, "approve")}>{t("approve")}</button><button className="rounded bg-rose-800 px-2 py-1" onClick={() => resolve(item, "deny")}>{t("deny")}</button></article>)}</aside>;
}
