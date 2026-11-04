import { useEffect, useState } from "react";
import type { ViewerProps } from "../registry";

/** Probe conversion output first so a missing optional converter produces a remedy, not a blank iframe. */
export default function FrameViewer({ file, contentUrl }: ViewerProps) {
  const [state, setState] = useState<{ ready: boolean; error: string }>(() => ({ ready: false, error: "" }));
  useEffect(() => { let live = true; setState({ ready: false, error: "" }); fetch(contentUrl, { headers: { Range: "bytes=0-1" } }).then(async response => { if (response.ok) { if (live) setState({ ready: true, error: "" }); return; } const detail = await response.json().catch(() => ({ detail: response.statusText })); throw new Error(detail.detail || response.statusText); }).catch(error => live && setState({ ready: false, error: error instanceof Error ? error.message : "Preview is unavailable." })); return () => { live = false; }; }, [contentUrl]);
  if (state.error) return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"><strong>Preview unavailable</strong><p className="max-w-lg text-sm opacity-70">{state.error}</p><p className="text-xs opacity-50">If this is an Office or media conversion, install the named optional tool from Files → capabilities, then retry.</p><a href={contentUrl.replace(/&mode=[^&]+/, "")} download={file.name} className="rounded bg-indigo-600 px-3 py-2 text-sm">Download original</a></div>;
  if (!state.ready) return <div className="p-4 text-sm opacity-60">Preparing {file.name}…</div>;
  return <iframe title={file.name} sandbox="allow-downloads" src={contentUrl} className="h-full w-full border-0 bg-neutral-900" />;
}
