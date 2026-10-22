"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ExternalLink, File as FileIcon, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, Search, X } from "lucide-react";
import { useFileViewer, type ViewerFile } from "@/stores/fileViewerStore";
import { resolveViewer } from "@/viewers/registry";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const G = "application/vnd.google-apps.";
interface DriveFile { id: string; name: string; mimeType?: string; mime?: string; modifiedTime?: string; webViewLink?: string }

const kindOf = (mime: string): "doc" | "sheet" | "slides" | "pdf" | "image" | "audio" | "video" | "text" | "folder" | "other" =>
  mime === G + "document" ? "doc" : mime === G + "spreadsheet" ? "sheet" : mime === G + "presentation" ? "slides" : mime === G + "folder" ? "folder" : mime === "application/pdf" ? "pdf"
    : mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video"
      : mime.startsWith("text/") || ["application/json", "application/xml", "application/javascript"].includes(mime) ? "text" : "other";

const Icon = ({ mime }: { mime: string }) => {
  const k = kindOf(mime), p = { size: 15, className: "shrink-0 opacity-70" };
  return k === "audio" ? <FileAudio {...p} /> : k === "video" ? <FileVideo {...p} /> : k === "image" ? <FileImage {...p} /> : k === "sheet" ? <FileSpreadsheet {...p} /> : k === "folder" ? <Folder {...p} /> : k === "doc" || k === "text" || k === "pdf" || k === "slides" ? <FileText {...p} /> : <FileIcon {...p} />;
};

function useText(url: string | null) {
  const [state, setState] = useState<{ text?: string; error?: string; loading: boolean }>({ loading: !!url });
  useEffect(() => {
    if (!url) return;
    let live = true;
    setState({ loading: true });
    fetch(url).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({ detail: r.statusText }))).detail ?? r.statusText); return r.text(); })
      .then((text) => live && setState({ text, loading: false })).catch((e) => live && setState({ error: String(e.message ?? e), loading: false }));
    return () => { live = false; };
  }, [url]);
  return state;
}

function Csv({ url }: { url: string }) {
  const { text, error, loading } = useText(url);
  if (loading) return <div className="p-4 text-sm opacity-60">Loading sheet…</div>;
  if (error) return <div className="p-4 text-sm text-red-300">{error}</div>;
  const rows = (text ?? "").split(/\r?\n/).filter(Boolean).slice(0, 1000).map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) ?? []);
  return (
    <div className="h-full overflow-auto p-3"><table className="text-xs"><tbody>
      {rows.map((r, i) => <tr key={i} className={i === 0 ? "sticky top-0 bg-neutral-800 font-semibold" : ""}>{r.map((c, j) => <td key={j} className="border border-white/10 px-2 py-1">{c}</td>)}</tr>)}
    </tbody></table></div>
  );
}

function Viewer({ file }: { file: ViewerFile }) {
  const plugin = useMemo(() => resolveViewer(file), [file]);
  const Component = useMemo(() => plugin ? lazy(plugin.load) : null, [plugin]);
  const src = `${API}/api/v1/files/content?src=${encodeURIComponent(file.src)}&id=${encodeURIComponent(file.id)}${file.mime === "application/vnd.google-apps.presentation" ? "&mode=pdf" : ""}`;
  if (!Component) return <div className="p-6 text-sm opacity-70">No viewer is installed for {file.mime || file.name}. Ask Jazper to add support, or download it.</div>;
  return <Suspense fallback={<div className="p-4 text-sm opacity-60">Loading {plugin?.label} viewer…</div>}><Component file={file} contentUrl={src} /></Suspense>;
}

export function FilesPanel() {
  const { tabs, active, open, close, activate } = useFileViewer();
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<(DriveFile & { src?: string; size?: number; modified?: string })[]>([]);
  const [source, setSource] = useState("drive");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`${API}/api/v1/files?src=${source}&limit=40&q=${encodeURIComponent(q)}`).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({ detail: r.statusText }))).detail ?? r.statusText); return r.json(); })
        .then((d) => { setFiles(d.files ?? []); setErr(null); }).catch((e) => setErr(String(e.message ?? e)));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, source]);
  const cur = tabs.find((t) => `${t.src}:${t.id}` === active);

  return (
    <div className="flex h-full min-h-[560px]" data-testid="files-panel">
      <aside className="flex w-72 shrink-0 flex-col border-r border-white/10">
        <div className="flex border-b border-white/10 p-1 text-xs">{["drive", "local", "attachment", "storage"].map((s) => <button key={s} onClick={() => setSource(s)} className={`rounded px-2 py-1 capitalize ${source === s ? "bg-white/10" : "opacity-60"}`}>{s === "local" ? "This PC" : s}</button>)}</div><div className="flex items-center gap-2 border-b border-white/10 px-3 py-2"><Search size={14} className="opacity-50" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${source}`} className="w-full bg-transparent text-sm outline-none" /></div>
        <div className="min-h-0 flex-1 overflow-auto">
          {err && <div className="p-3 text-xs text-red-300">{err}</div>}
          {files.map((f) => { const mime = f.mime ?? f.mimeType ?? "application/octet-stream"; const id = f.id; const key = `${f.src ?? source}:${id}`; return (
            <button key={key} onClick={() => mime !== G + "folder" && open({ src: f.src ?? source, id, name: f.name, mime, size: f.size, modified: f.modified })} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-white/5 ${active === key ? "bg-white/10" : ""}`}>
              <Icon mime={mime} /><span className="truncate">{f.name}</span>
            </button>
          ); })}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 px-2 pt-2">
          {tabs.map((t) => (
            <div key={`${t.src}:${t.id}`} className={`flex max-w-[220px] items-center gap-2 rounded-t-lg px-3 py-1.5 text-sm ${`${t.src}:${t.id}` === active ? "bg-white/10" : "opacity-60 hover:opacity-100"}`}>
              <button onClick={() => activate(`${t.src}:${t.id}`)} className="flex min-w-0 items-center gap-2"><Icon mime={t.mime} /><span className="truncate">{t.name}</span></button>
              <button aria-label={`Close ${t.name}`} onClick={() => close(`${t.src}:${t.id}`)}><X size={12} /></button>
            </div>
          ))}
          {cur?.webUrl && <button className="ml-auto flex items-center gap-1 px-3 text-xs opacity-70 hover:opacity-100" onClick={() => window.open(cur.webUrl, "_blank")}><ExternalLink size={12} />Open in browser</button>}
        </div>
        <div className="min-h-0 flex-1" data-testid="files-viewer">
          {cur ? <Viewer key={cur.id} file={cur} /> : <div className="flex h-full items-center justify-center text-sm opacity-50">Pick a file, or ask Jazper to open one.</div>}
        </div>
      </section>
    </div>
  );
}
