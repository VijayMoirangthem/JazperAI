"use client";
import { useOfficeText } from "./useOfficeText";
export function ActionBar({ onRoster, onPeople, onAppearance, onChat, onEdit, onTasks, onAttention, onActivity, onMinutes, onThreads, onModeration, onPhoto, onSettings }: { onRoster(): void; onPeople(): void; onAppearance(): void; onChat(): void; onEdit(): void; onTasks(): void; onAttention(): void; onActivity(): void; onMinutes(): void; onThreads(): void; onModeration(): void; onPhoto(): void; onSettings(): void }) {
  const button = "rounded px-2 py-1 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300";
  const t = useOfficeText();
  return <div className="absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap justify-center gap-1 rounded-xl bg-slate-950/85 p-2 text-xs text-white shadow-xl ring-1 ring-white/15">
    <button className={button} title={t("appearanceHint")} onClick={onAppearance}>{t("appearance")}</button>
    <button className={button} title={t("rosterHint")} onClick={onRoster}>{t("roster")}</button><button className={button} title={t("peopleHint")} onClick={onPeople}>{t("people")}</button>
    <button className={button} title={t("chatHint")} onClick={onChat}>{t("chat")}</button>
    <button className={button} title={t("editHint")} onClick={onEdit}>{t("edit")}</button>
    <button className={button} title={t("tasksHint")} onClick={onTasks}>{t("tasks")}</button>
    <button className={button} title={t("attentionHint")} onClick={onAttention}>{t("attention")}</button>
    <button className={button} title={t("activityHint")} onClick={onActivity}>{t("activity")}</button>
    <button className={button} title={t("minutesHint")} onClick={onMinutes}>{t("minutes")}</button>
    <button className={button} title={t("agentsHint")} onClick={onThreads}>{t("agents")}</button>
    <button className={button} title={t("reportsHint")} onClick={onModeration}>{t("reports")}</button>
    <button className={button} title={t("photoHint")} onClick={onPhoto}>{t("photo")}</button>
    <button className={button} title={t("settingsHint")} onClick={onSettings}>{t("settings")}</button>
    <span className="px-2 py-1 opacity-60">{t("cameraHint")}</span>
  </div>;
}
