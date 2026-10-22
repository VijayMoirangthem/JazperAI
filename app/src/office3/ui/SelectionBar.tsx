"use client";
export function SelectionBar({ count, onClear }: { count: number; onClear(): void }) { if (!count) return null; return <div className="absolute bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-slate-950/90 px-3 py-2 text-xs text-white shadow-xl">{count} selected <button className="ml-3 rounded bg-slate-700 px-2 py-1" onClick={onClear}>Clear</button></div>; }
