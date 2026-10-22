"use client";
export function ActionBar({ onRoster, onAppearance, onChat, onEdit, onTasks, onAttention, onActivity, onMinutes, onThreads, onSettings }: { onRoster(): void; onAppearance(): void; onChat(): void; onEdit(): void; onTasks(): void; onAttention(): void; onActivity(): void; onMinutes(): void; onThreads(): void; onSettings(): void }) {
  return <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-xl bg-slate-950/85 p-2 text-xs text-white shadow-xl ring-1 ring-white/15">
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onAppearance}>Appearance</button>
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onRoster}>Roster</button>
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onChat}>Chat</button>
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onEdit}>Edit</button>
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onTasks}>Tasks</button>
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onAttention}>Attention</button>
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onActivity}>Activity</button>
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onMinutes}>Minutes</button>
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onThreads}>Agents</button>
    <button className="rounded px-2 py-1 hover:bg-slate-700" onClick={onSettings}>Settings</button>
    <span className="px-2 py-1 opacity-60">Q/E rotate · T view</span>
  </div>;
}
