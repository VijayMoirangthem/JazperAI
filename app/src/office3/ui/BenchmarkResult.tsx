"use client";

import { useEffect, useState } from "react";

type Benchmark = { elapsedMs: number; samples: number; fpsMedian: number; fpsP95: number; fpsP99: number; frameP50Ms: number; frameP95Ms: number; frameP99Ms: number; calls: number; triangles: number; people: number; heapMb: number | null; screenshot: string };
type StoredBaseline = Benchmark & { savedAt: number };
const baselineKey = "office3.benchmark-baseline";
const readBaseline = (): StoredBaseline | null => { try { const value = JSON.parse(localStorage.getItem(baselineKey) ?? "null"); return value && typeof value.frameP95Ms === "number" && typeof value.fpsMedian === "number" && Number.isSafeInteger(value.people) && typeof value.savedAt === "number" ? value as StoredBaseline : null; } catch { return null; } };

const download = (name: string, source: BlobPart, type: string) => {
  const url = URL.createObjectURL(new Blob([source], { type })), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Visible result surface for the V3-L3 renderer-only benchmark mode. */
export function BenchmarkResult() {
  const [result, setResult] = useState<Benchmark | null>(null);
  const [baseline, setBaseline] = useState<StoredBaseline | null>(null);
  useEffect(() => { setBaseline(readBaseline()); const complete = (event: Event) => setResult((event as CustomEvent<Benchmark>).detail); window.addEventListener("office3:benchmark-complete", complete); return () => window.removeEventListener("office3:benchmark-complete", complete); }, []);
  if (!result) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const json = JSON.stringify({ ...result, screenshot: undefined }, null, 2);
  const compatibleBaseline = baseline?.people === result.people ? baseline : null;
  const p95Delta = compatibleBaseline ? Math.round((result.frameP95Ms - compatibleBaseline.frameP95Ms) / Math.max(.01, compatibleBaseline.frameP95Ms) * 100) : null;
  const saveBaseline = () => { const next: StoredBaseline = { ...result, screenshot: "", savedAt: Date.now() }; try { localStorage.setItem(baselineKey, JSON.stringify(next)); setBaseline(next); } catch { window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Benchmark baseline could not be stored on this device.", priority: "warning" } })); } };
  return <aside className="absolute bottom-3 right-3 z-50 w-80 rounded-xl bg-slate-950/95 p-3 text-xs text-white shadow-2xl ring-1 ring-emerald-300/30"><button type="button" className="float-right text-slate-400 hover:text-white" aria-label="Hide benchmark result" onClick={() => setResult(null)}>×</button><h2 className="font-semibold text-emerald-200">Office benchmark complete</h2><p className="mt-1 text-slate-300">{result.people} people · {result.samples} frames · {(result.elapsedMs / 1000).toFixed(1)} s</p><div className="mt-2 grid grid-cols-3 gap-1 rounded bg-slate-900 p-2 text-center"><span>Median<br /><strong>{result.fpsMedian} fps</strong></span><span>P95<br /><strong>{result.fpsP95} fps</strong></span><span>P99<br /><strong>{result.fpsP99} fps</strong></span></div><p className="mt-2 text-slate-400">{result.calls} calls · {(result.triangles / 1000).toFixed(0)}k tris{result.heapMb === null ? "" : ` · ${result.heapMb} MB heap`}</p>{baseline && !compatibleBaseline && <p className="mt-2 rounded bg-amber-950/70 p-2 text-amber-100">Baseline uses {baseline.people} people; save a matching baseline to compare this run.</p>}{p95Delta !== null && <p className={`mt-2 rounded p-2 ${p95Delta > 10 ? "bg-rose-950/70 text-rose-100" : "bg-emerald-950/60 text-emerald-100"}`}>P95 frame time vs baseline: {p95Delta > 0 ? "+" : ""}{p95Delta}% {p95Delta > 10 ? "regression" : "within budget"}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" className="rounded bg-emerald-700 px-2 py-1 hover:bg-emerald-600" onClick={() => download(`office3-bench-${stamp}.json`, json, "application/json")}>Download JSON</button><button type="button" className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600" onClick={() => { const link = document.createElement("a"); link.href = result.screenshot; link.download = `office3-bench-${stamp}.png`; link.click(); }}>Download PNG</button><button type="button" className="rounded bg-blue-700 px-2 py-1 hover:bg-blue-600" onClick={saveBaseline}>Save baseline</button>{baseline && <button type="button" className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600" onClick={() => { localStorage.removeItem(baselineKey); setBaseline(null); }}>Clear baseline</button>}</div></aside>;
}
