"use client";

import { useEffect, useState } from "react";
import { useOfficeText } from "./useOfficeText";

type TaskId = "reception" | "desk" | "roster" | "conversation";
type Progress = Record<TaskId, boolean>;
const STORAGE_KEY = "office3.welcome-checklist";
const emptyProgress = (): Progress => ({ reception: false, desk: false, roster: false, conversation: false });

const loadProgress = (): Progress => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...emptyProgress(), ...(stored && typeof stored === "object" ? stored : {}) };
  } catch { return emptyProgress(); }
};

/** A small first-week path which is intentionally local until people/accounts become shared. */
export function WelcomeChecklist({ onOpenRoster }: { onOpenRoster(): void }) {
  const [progress, setProgress] = useState<Progress>(() => emptyProgress());
  const [open, setOpen] = useState(false);
  const t = useOfficeText();
  useEffect(() => { const next = loadProgress(); setProgress(next); setOpen(!Object.values(next).every(Boolean)); }, []);
  const complete = (id: TaskId) => setProgress(current => {
    if (current[id]) return current;
    const next = { ...current, [id]: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  });
  useEffect(() => {
    const interaction = (event: Event) => { if ((event as CustomEvent<string>).detail === "reception") complete("reception"); };
    const desk = () => complete("desk");
    const conversation = () => complete("conversation");
    window.addEventListener("office3:interaction", interaction);
    window.addEventListener("office3:return-to-desk", desk);
    window.addEventListener("office3:open-conversation", conversation);
    return () => { window.removeEventListener("office3:interaction", interaction); window.removeEventListener("office3:return-to-desk", desk); window.removeEventListener("office3:open-conversation", conversation); };
  }, []);
  const completeCount = Object.values(progress).filter(Boolean).length;
  if (!open) return <button type="button" className="absolute right-3 top-14 z-30 rounded-lg bg-slate-950/85 px-2 py-1 text-[11px] text-slate-200 shadow ring-1 ring-white/15" onClick={() => setOpen(true)}>{t("welcome", { count: completeCount })}</button>;
  return <section className="absolute right-3 top-14 z-30 w-60 rounded-xl bg-slate-950/95 p-3 text-xs text-slate-100 shadow-xl ring-1 ring-white/15" aria-label={t("welcome", { count: completeCount })}><div className="flex items-center justify-between"><strong>{t("firstDay")}</strong><button type="button" className="opacity-70 hover:opacity-100" aria-label={t("collapseWelcome")} onClick={() => setOpen(false)}>×</button></div><p className="mt-1 text-[11px] text-slate-400">{t("savedDevice", { count: completeCount })}</p><ul className="mt-2 space-y-1.5"><li className={progress.reception ? "text-emerald-300" : ""}>{progress.reception ? "✓" : "○"} {t("visitReception")}</li><li className={progress.desk ? "text-emerald-300" : ""}>{progress.desk ? "✓" : "○"} {t("returnDesk")}</li><li><button type="button" className={progress.roster ? "text-emerald-300" : "text-left hover:text-blue-200"} onClick={() => { complete("roster"); onOpenRoster(); }}>{progress.roster ? "✓" : "○"} {t("openRoster")}</button></li><li className={progress.conversation ? "text-emerald-300" : ""}>{progress.conversation ? "✓" : "○"} {t("startConversation")}</li></ul>{completeCount === 4 ? <p className="mt-2 text-emerald-300">{t("ready")}</p> : null}</section>;
}
