"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ExternalLink, File as FileIcon, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, Grid2X2, List, Search, X } from "lucide-react";
import { useFileViewer, type ViewerFile } from "@/stores/fileViewerStore";
import { resolveViewer } from "@/viewers/registry";
import { useDrafts } from "@/chat/draftStore";
import { RpcClient } from "@/lib/rpcClient";

// The FastAPI launcher deliberately binds IPv4 loopback.  Using localhost here
// can resolve to IPv6 (::1) on Windows and makes file fetching fail in Electron.
const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const G = "application/vnd.google-apps.";
interface DriveFile { id: string; name: string; src?: string; size?: number; mimeType?: string; mime?: string; modifiedTime?: string; modified?: string; webViewLink?: string; webUrl?: string }
const mimeOf = (file: { mime?: string; mimeType?: string }) => file.mime ?? file.mimeType ?? "application/octet-stream";

const kindOf = (mime: string): "doc" | "sheet" | "slides" | "pdf" | "image" | "audio" | "video" | "text" | "folder" | "other" =>
  mime === G + "document" ? "doc" : mime === G + "spreadsheet" ? "sheet" : mime === G + "presentation" ? "slides" : mime === G + "folder" ? "folder" : mime === "application/pdf" ? "pdf"
    : mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video"
      : mime.startsWith("text/") || ["application/json", "application/xml", "application/javascript"].includes(mime) ? "text" : "other";

const Icon = ({ mime }: { mime: string }) => {
  const k = kindOf(mime), p = { size: 15, className: "shrink-0 opacity-70" };
  return k === "audio" ? <FileAudio {...p} /> : k === "video" ? <FileVideo {...p} /> : k === "image" ? <FileImage {...p} /> : k === "sheet" ? <FileSpreadsheet {...p} /> : k === "folder" ? <Folder {...p} /> : k === "doc" || k === "text" || k === "pdf" || k === "slides" ? <FileText {...p} /> : <FileIcon {...p} />;
};

function GridPreview({ src, id, mime, name }: { src: string; id: string; mime: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const thumbnail = `${API}/api/v1/files/content?src=${encodeURIComponent(src)}&id=${encodeURIComponent(id)}&mode=thumb`;
  if (failed) return <Icon mime={mime} />;
  return <img src={thumbnail} alt="" className="h-12 w-full rounded object-cover" onError={() => setFailed(true)} title={`${name} preview`} />;
}

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

function Viewer({ file, siblings }: { file: ViewerFile; siblings: ViewerFile[] }) {
  const [magic, setMagic] = useState<Uint8Array>();
  const rawSrc = `${API}/api/v1/files/content?src=${encodeURIComponent(file.src)}&id=${encodeURIComponent(file.id)}`;
  useEffect(() => { let alive = true; setMagic(undefined); if ((file.mime && file.mime !== "application/octet-stream") || /\.[a-z0-9]{1,8}$/i.test(file.name)) return; fetch(rawSrc, { headers: { Range: "bytes=0-31" } }).then(r => r.arrayBuffer()).then(b => alive && setMagic(new Uint8Array(b))).catch(() => undefined); return () => { alive = false; }; }, [file.id, file.mime, file.name, file.src, rawSrc]);
  const plugin = useMemo(() => resolveViewer(file, magic), [file, magic]);
  const Component = useMemo(() => plugin ? lazy(plugin.load) : null, [plugin]);
  const convert = file.mime === "application/vnd.google-apps.presentation" || /\.(doc|odt|rtf|ppt|pptx)$/i.test(file.name);
  const transcode = /\.(mkv|avi|wmv)$/i.test(file.name);
  const cameraRaw = /\.(hei[cf]|cr2|cr3|nef|arw|dng|raf|orf)$/i.test(file.name);
  const kindle = /\.(mobi|azw|azw3)$/i.test(file.name);
  const src = `${rawSrc}${convert ? "&mode=pdf" : transcode ? "&mode=transcode" : cameraRaw ? "&mode=jpeg" : kindle ? "&mode=epub" : ""}`;
  if (!Component) return <div className="p-6 text-sm opacity-70">No viewer is installed for {file.mime || file.name}. Ask Jazper to add support, or download it.</div>;
  const viewerSiblings = plugin?.id === "image" ? siblings.filter(item => mimeOf(item).startsWith("image/")) : plugin?.id === "media" ? siblings.filter(item => mimeOf(item).startsWith("audio/")) : [];
  return <Suspense fallback={<div className="p-4 text-sm opacity-60">Loading {plugin?.label} viewer…</div>}><Component file={file} contentUrl={src} siblings={viewerSiblings} /></Suspense>;
}

export function FilesPanel() {
  const { tabs, active, open, close, activate, starred, recent, records, dirty, toggleStar } = useFileViewer();
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [source, setSource] = useState("drive");
  const [path, setPath] = useState("");
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([]);
  const [folderTree, setFolderTree] = useState<Record<string, DriveFile[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<"name" | "size" | "modified">("name");
  const [typeFilter, setTypeFilter] = useState<"all" | "doc" | "sheet" | "pdf" | "image" | "audio" | "video" | "text" | "other">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [collection, setCollection] = useState<"source" | "recent" | "starred">("source");
  const [capabilities, setCapabilities] = useState<{ tools?: Record<string, { available: boolean; install: string }> }>({});
  const [changed, setChanged] = useState<string | null>(null);
  const [context, setContext] = useState<{ file: ViewerFile; x: number; y: number } | null>(null);
  const [reload, setReload] = useState(0);
  const [splitWith, setSplitWith] = useState<string | null>(() => localStorage.getItem("jasper.viewer.split") || null);
  useEffect(() => { try { if (splitWith) localStorage.setItem("jasper.viewer.split", splitWith); else localStorage.removeItem("jasper.viewer.split"); } catch { /* unavailable */ } }, [splitWith]);
  const upload = async (items: FileList | File[]) => {
    for (const file of Array.from(items)) { const data = new FormData(); data.append("file", file); const r = await fetch(`${API}/api/v1/files/upload`, { method: "POST", body: data }); if (!r.ok) setErr(`Upload failed: ${file.name}`); }
    setSource("attachment"); setPath(""); setQ(""); setReload(x => x + 1);
  };
  const browseFolder = (folder: { id: string; name: string }) => {
    setPath(folder.id);
    setTrail((old) => [...old.filter((item) => item.id !== folder.id), { id: folder.id, name: folder.name }]);
    setSelected([]);
  };
  const browseTrail = (index: number) => {
    const next = trail.slice(0, index + 1);
    setTrail(next);
    setPath(next.at(-1)?.id ?? "");
    setSelected([]);
  };
  const toggleFolder = async (folder: DriveFile & { src?: string }) => {
    const key = `${folder.src ?? source}:${folder.id}`;
    if (expandedFolders.includes(key)) { setExpandedFolders(items => items.filter(item => item !== key)); return; }
    setExpandedFolders(items => [...items, key]);
    if (folderTree[key]) return;
    try {
      const response = await fetch(`${API}/api/v1/files?src=${encodeURIComponent(folder.src ?? source)}&path=${encodeURIComponent(folder.id)}&limit=100`);
      if (!response.ok) throw new Error(response.statusText);
      const result = await response.json(); setFolderTree(tree => ({ ...tree, [key]: result.files ?? [] }));
    } catch { setFolderTree(tree => ({ ...tree, [key]: [] })); }
  };
  const manage = async (action: "rename" | "trash" | "copy" | "move" | "share", target = cur) => {
    if (!target) return;
    const name = action === "rename" ? window.prompt("New file name", target.name) : undefined;
    if (action === "rename" && (!name || name === target.name)) return;
    const destination = action === "copy" || action === "move" ? window.prompt(`${action === "copy" ? "Copy" : "Move"} to an allowed folder`) : undefined;
    if ((action === "copy" || action === "move") && !destination) return;
    const email = action === "share" ? window.prompt("Share with email address") : undefined;
    if (action === "share" && !email) return;
    const r = await fetch(`${API}/api/v1/files/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src: target.src, id: target.id, action, name, destination, email, role: "reader" }) });
    if (!r.ok) setErr((await r.json().catch(() => ({ detail: "Action blocked" }))).detail ?? "Action blocked");
    else {
      const result = await r.json().catch(() => null) as Partial<ViewerFile> | null;
      if (action === "trash") close(`${target.src}:${target.id}`);
      else if (result?.id && action !== "share") { close(`${target.src}:${target.id}`); open({ src: result.src ?? target.src, id: result.id, name: result.name ?? target.name, mime: result.mime ?? target.mime, size: result.size, modified: result.modified, webUrl: result.webUrl }); }
      setReload(x => x + 1);
    }
  };
  const ask = (task: string) => { if (!cur) return; const selected = (window.getSelection()?.toString() ?? "").trim().slice(0, 20_000); useDrafts.getState().set("dm:jasper", `${task} ${selected ? `this selected text from ${cur.name}:\n\n${selected}` : `this file: ${cur.name}`} (${cur.src}:${cur.id}).`); window.location.hash = "team_chat"; };
  const trashSelected = async () => {
    for (const key of selected) { const file = records[key] ?? tabs.find(t => `${t.src}:${t.id}` === key) ?? files.map(f => ({ src: f.src ?? source, id: f.id, name: f.name, mime: f.mime ?? f.mimeType ?? "", webUrl: f.webUrl ?? f.webViewLink })).find(f => `${f.src}:${f.id}` === key); if (!file) continue; const r = await fetch(`${API}/api/v1/files/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src: file.src, id: file.id, action: "trash" }) }); if (r.ok) close(key); }
    setSelected([]); setSelectionAnchor(null); setReload(x => x + 1);
  };
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`${API}/api/v1/files?src=${source}&limit=40&q=${encodeURIComponent(q)}&path=${encodeURIComponent(path)}`).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({ detail: r.statusText }))).detail ?? r.statusText); return r.json(); })
        .then((d) => { setFiles(d.files ?? []); setErr(null); }).catch((e) => setErr(String(e.message ?? e)));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, source, path, reload]);
  useEffect(() => { fetch(`${API}/api/v1/files/capabilities`).then(r => r.json()).then(setCapabilities).catch(() => undefined); }, []);
  useEffect(() => { const rpc = new RpcClient({ url: API.replace(/^http/, "ws") + "/ws/rpc", topics: ["file-changed"], onEvent: (event) => { const p = event.params as { src?: string; id?: string; name?: string }; if (p.src && p.id && `${p.src}:${p.id}` === active) { setChanged(`${p.name ?? "This file"} changed by Jazper.`); setReload(x => x + 1); } } }); rpc.start(); return () => rpc.stop(); }, [active]);
  const cur = tabs.find((t) => `${t.src}:${t.id}` === active);
  const split = tabs.find((t) => `${t.src}:${t.id}` === splitWith);
  const collectionFiles = collection === "source" ? files : (collection === "recent" ? recent : starred).map(key => records[key] ?? tabs.find(t => `${t.src}:${t.id}` === key)).filter((x): x is ViewerFile => !!x);
  const ordered = collectionFiles.filter(f => typeFilter === "all" || kindOf(mimeOf(f)) === typeFilter).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? (Number(b.size ?? 0) - Number(a.size ?? 0)) : String(b.modified ?? b.modifiedTime ?? "").localeCompare(String(a.modified ?? a.modifiedTime ?? "")));
  const folders = files.filter(file => mimeOf(file) === "inode/directory" || mimeOf(file) === G + "folder");
  const folderBranch = (folder: DriveFile & { src?: string }, depth = 0): React.ReactNode => {
    const key = `${folder.src ?? source}:${folder.id}`, openFolder = expandedFolders.includes(key), children = folderTree[key] ?? [];
    return <div key={key}><div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: `${depth * 12}px` }}><button aria-label={`${openFolder ? "Collapse" : "Expand"} ${folder.name}`} onClick={() => void toggleFolder(folder)} className="w-4 opacity-60">{openFolder ? "▾" : "▸"}</button><button onClick={() => browseFolder(folder)} className="min-w-0 truncate py-0.5 text-left hover:text-indigo-200">{folder.name}</button></div>{openFolder && children.filter(child => mimeOf(child) === "inode/directory" || mimeOf(child) === G + "folder").slice(0, 30).map(child => folderBranch({ ...child, src: child.src ?? folder.src ?? source }, depth + 1))}</div>;
  };
  const selectRow = (key: string, event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey && selectionAnchor) { const from = ordered.findIndex(item => `${item.src ?? source}:${item.id}` === selectionAnchor), to = ordered.findIndex(item => `${item.src ?? source}:${item.id}` === key); if (from >= 0 && to >= 0) setSelected(ordered.slice(Math.min(from, to), Math.max(from, to) + 1).map(item => `${item.src ?? source}:${item.id}`)); return true; }
    if (event.ctrlKey || event.metaKey) { setSelected(items => items.includes(key) ? items.filter(item => item !== key) : [...items, key]); setSelectionAnchor(key); return true; }
    return false;
  };
  const bulkManage = async (action: "copy" | "move") => {
    const destination = window.prompt(`${action === "copy" ? "Copy" : "Move"} ${selected.length} file(s) to an allowed folder`);
    if (!destination) return;
    let failures = 0;
    for (const key of selected) { const item = records[key] ?? tabs.find(tab => `${tab.src}:${tab.id}` === key) ?? files.map(file => ({ src: file.src ?? source, id: file.id, name: file.name, mime: mimeOf(file) })).find(file => `${file.src}:${file.id}` === key); if (!item) continue; const response = await fetch(`${API}/api/v1/files/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src: item.src, id: item.id, action, destination }) }); if (!response.ok) failures += 1; }
    setErr(failures ? `${failures} file action(s) were blocked or failed.` : null); setSelected([]); setSelectionAnchor(null); setReload(value => value + 1);
  };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select") || event.ctrlKey || event.metaKey || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      const at = ordered.findIndex(f => `${f.src ?? source}:${f.id}` === active);
      if (event.key === "Enter" && at >= 0) { const item = ordered[at]; const mime = mimeOf(item); if (mime === "inode/directory" || mime === G + "folder") browseFolder({ id: item.id, name: item.name }); else open({ ...item, src: item.src ?? source, mime }); event.preventDefault(); return; }
      if (!ordered.length) return;
      const next = Math.max(0, Math.min(ordered.length - 1, (at < 0 ? 0 : at) + (event.key === "ArrowDown" ? 1 : -1)));
      const f = ordered[next]; activate(`${f.src ?? source}:${f.id}`); event.preventDefault();
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, [active, activate, open, ordered, source, trail]);

  return (
    <div className="flex h-full min-h-[560px]" data-testid="files-panel" onClick={() => context && setContext(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files); }}>
      <aside className="flex w-72 shrink-0 flex-col border-r border-white/10">
        <div className="flex flex-wrap border-b border-white/10 p-1 text-xs">{["all", "drive", "local", "attachment", "storage", "url"].map((s) => <button key={s} onClick={() => { setCollection("source"); setSource(s); setPath(""); setTrail([]); setFolderTree({}); setExpandedFolders([]); }} className={`rounded px-2 py-1 capitalize ${collection === "source" && source === s ? "bg-white/10" : "opacity-60"}`}>{s === "all" ? "All files" : s === "local" ? "This PC" : s === "url" ? "Link" : s}</button>)}</div><div className="flex gap-2 border-b border-white/10 px-2 py-1 text-xs"><button onClick={() => setCollection("recent")} className={collection === "recent" ? "text-indigo-300" : "opacity-60"}>Recent</button><button onClick={() => setCollection("starred")} className={collection === "starred" ? "text-amber-300" : "opacity-60"}>Starred</button></div>{collection === "source" && <nav aria-label="Folder breadcrumb" className="flex min-h-7 items-center gap-1 overflow-x-auto border-b border-white/10 px-3 py-1 text-xs"><button onClick={() => browseTrail(-1)} className={!trail.length ? "opacity-40" : "hover:text-indigo-200"}>Files</button>{trail.map((item, index) => <span key={item.id} className="flex min-w-0 items-center gap-1"><span className="opacity-35">/</span><button onClick={() => browseTrail(index)} className={`truncate ${index === trail.length - 1 ? "opacity-60" : "hover:text-indigo-200"}`}>{item.name}</button></span>)}</nav>}<div className="flex items-center gap-2 border-b border-white/10 px-3 py-2"><Search size={14} className="opacity-50" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={source === "all" ? "Search every source" : source === "url" ? "Paste an HTTPS file URL" : `Search ${source}`} className="w-full bg-transparent text-sm outline-none" /><label className="cursor-pointer text-xs opacity-60">Upload<input className="hidden" type="file" multiple onChange={(e) => e.target.files && void upload(e.target.files)} /></label></div>
        <div className="flex items-center gap-2 border-b border-white/10 px-2 py-1 text-xs"><select aria-label="Sort files" className="bg-transparent" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="name">Name</option><option value="modified">Modified</option><option value="size">Size</option></select><select aria-label="Filter file type" className="max-w-20 bg-transparent" value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}><option value="all">All types</option><option value="doc">Docs</option><option value="sheet">Sheets</option><option value="pdf">PDFs</option><option value="image">Images</option><option value="audio">Audio</option><option value="video">Video</option><option value="text">Text/code</option><option value="other">Other</option></select><button aria-label="List view" onClick={() => setLayout("list")} className={layout === "list" ? "opacity-100" : "opacity-40"}><List size={14} /></button><button aria-label="Grid view" onClick={() => setLayout("grid")} className={layout === "grid" ? "opacity-100" : "opacity-40"}><Grid2X2 size={14} /></button>{selected.length > 0 && <span className="ml-auto flex items-center gap-2"><button onClick={() => void bulkManage("copy")}>Copy {selected.length}</button><button onClick={() => void bulkManage("move")}>Move</button><button className="text-red-300" onClick={() => void trashSelected()}>Trash</button></span>}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          {Object.entries(capabilities.tools ?? {}).filter(([, v]) => !v.available).map(([name, tool]) => <div key={name} className="m-2 rounded bg-amber-500/10 p-2 text-xs"><div>{name} is optional for some formats.</div><button className="mt-1 rounded bg-amber-500/20 px-2 py-1" onClick={() => void fetch(`${API}/api/v1/files/capabilities/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: name }) })}>Install with approval</button></div>)}
          {err && <div className="p-3 text-xs text-red-300">{err}</div>}
          {collection === "source" && source !== "all" && source !== "url" && folders.length > 0 && <details className="border-b border-white/10 px-2 py-1 text-xs" open><summary className="cursor-pointer font-medium opacity-70">Folders</summary><div role="tree" aria-label="Folder tree" className="max-h-44 overflow-auto py-1">{folders.slice(0, 30).map(folder => folderBranch(folder))}</div></details>}
          <div className={layout === "grid" ? "grid grid-cols-2 gap-1 p-1" : ""}>{ordered.map((f) => { const mime = mimeOf(f); const id = f.id; const key = `${f.src ?? source}:${id}`; const ref: ViewerFile = { src: f.src ?? source, id, name: f.name, mime, size: f.size, modified: f.modified ?? f.modifiedTime, webUrl: f.webUrl ?? ("webViewLink" in f ? f.webViewLink : undefined) }; return (
            <button key={key} onContextMenu={(e) => { e.preventDefault(); setContext({ file: ref, x: e.clientX, y: e.clientY }); }} onKeyDown={(e) => { if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return; e.preventDefault(); const box = e.currentTarget.getBoundingClientRect(); setContext({ file: ref, x: box.left + 12, y: box.top + 12 }); }} onClick={(e) => { if (selectRow(key, e)) return; mime === "inode/directory" || mime === G + "folder" ? browseFolder({ id, name: f.name }) : open(ref); }} className={`flex ${layout === "grid" ? "min-h-20 flex-col justify-center" : "w-full"} items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-white/5 ${active === key || selected.includes(key) ? "bg-white/10" : ""}`}>
              {layout === "grid" && /^(image|audio|video)\//.test(mime) ? <GridPreview src={f.src ?? source} id={id} mime={mime} name={f.name} /> : <Icon mime={mime} />}<span className="truncate">{f.name}</span>{layout === "grid" && <span className="text-[10px] capitalize opacity-50">{f.src ?? source}</span>}
            </button>
          ); })}</div>
          {context && <div role="menu" aria-label={`Actions for ${context.file.name}`} className="fixed z-50 min-w-40 rounded-lg border border-white/15 bg-[#161b26] p-1 text-xs shadow-2xl" style={{ left: Math.min(context.x, window.innerWidth - 190), top: Math.min(context.y, window.innerHeight - 230) }} onClick={e => e.stopPropagation()}>
            <button role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => { open(context.file); setContext(null); }}>Open</button>
            <button role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => { toggleStar(`${context.file.src}:${context.file.id}`, context.file); setContext(null); }}>{starred.includes(`${context.file.src}:${context.file.id}`) ? "Remove star" : "Star"}</button>
            {["local", "attachment", "drive"].includes(context.file.src) && <><button role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => { void manage("rename", context.file); setContext(null); }}>Rename</button><button role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => { void manage("copy", context.file); setContext(null); }}>Copy</button><button role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => { void manage("move", context.file); setContext(null); }}>Move</button>{context.file.src === "drive" && <button role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-white/10" onClick={() => { void manage("share", context.file); setContext(null); }}>Share…</button>}<button role="menuitem" className="block w-full rounded px-3 py-2 text-left text-red-300 hover:bg-white/10" onClick={() => { void manage("trash", context.file); setContext(null); }}>Trash</button></>}
          </div>}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 px-2 pt-2">
          {tabs.map((t) => (
            <div key={`${t.src}:${t.id}`} className={`flex max-w-[220px] items-center gap-2 rounded-t-lg px-3 py-1.5 text-sm ${`${t.src}:${t.id}` === active ? "bg-white/10" : "opacity-60 hover:opacity-100"}`}>
              <button onClick={() => activate(`${t.src}:${t.id}`)} className="flex min-w-0 items-center gap-2"><Icon mime={t.mime} /><span className="truncate">{t.name}</span>{dirty.includes(`${t.src}:${t.id}`) && <span aria-label="Unsaved changes" className="text-amber-300">●</span>}</button>
              <button aria-label={`Close ${t.name}`} onClick={() => close(`${t.src}:${t.id}`)}><X size={12} /></button>
            </div>
          ))}
          {cur?.webUrl && <button className="ml-auto flex items-center gap-1 px-3 text-xs opacity-70 hover:opacity-100" onClick={() => window.open(cur.webUrl, "_blank")}><ExternalLink size={12} />{cur.src === "drive" ? "Open in Google" : "Open in browser"}</button>}
          {cur?.src === "local" && (window as any).jasper?.openPath && <><button className="px-2 text-xs opacity-70 hover:opacity-100" onClick={() => void (window as any).jasper.openPath(cur.id)}>Open with app</button><button className="px-2 text-xs opacity-70 hover:opacity-100" onClick={() => void (window as any).jasper.revealPath(cur.id)}>Reveal</button></>}
          {cur && <button className={`px-2 text-xs ${starred.includes(`${cur.src}:${cur.id}`) ? "text-amber-300" : "opacity-70"}`} onClick={() => toggleStar(`${cur.src}:${cur.id}`, cur)}>{starred.includes(`${cur.src}:${cur.id}`) ? "★ Starred" : "☆ Star"}</button>}
          {tabs.length > 1 && <select aria-label="Split view file" className="max-w-36 bg-transparent px-2 text-xs" value={splitWith ?? ""} onChange={e => setSplitWith(e.target.value || null)}><option value="">Single view</option>{tabs.filter(t => `${t.src}:${t.id}` !== active).map(t => <option key={`${t.src}:${t.id}`} value={`${t.src}:${t.id}`}>Split: {t.name}</option>)}</select>}
          {cur && ["local", "attachment", "drive"].includes(cur.src) && <><button className="px-2 text-xs opacity-70 hover:opacity-100" onClick={() => void manage("rename")}>Rename</button><button className="px-2 text-xs opacity-70 hover:opacity-100" onClick={() => void manage("copy")}>Copy</button><button className="px-2 text-xs opacity-70 hover:opacity-100" onClick={() => void manage("move")}>Move</button>{cur.src === "drive" && <button className="px-2 text-xs opacity-70 hover:opacity-100" onClick={() => void manage("share")}>Share</button>}<button className="px-2 text-xs text-red-300 opacity-70 hover:opacity-100" onClick={() => void manage("trash")}>Trash</button></>}
          {cur && <details className="px-2 text-xs"><summary className="cursor-pointer opacity-70">Ask Jazper</summary><div className="absolute right-3 z-20 mt-1 flex gap-1 rounded bg-neutral-900 p-2"><button onClick={() => ask("Summarise")}>Summarise</button><button onClick={() => ask("Explain")}>Explain</button><button onClick={() => ask("Rewrite")}>Rewrite</button><button onClick={() => ask("Translate")}>Translate</button><button onClick={() => ask("Extract a table from")}>Extract table</button></div></details>}
          {cur && (window as any).jasper?.openFileWindow && <button className="flex items-center gap-1 px-3 text-xs opacity-70 hover:opacity-100" onClick={() => (window as any).jasper.openFileWindow(cur)}><ExternalLink size={12} />Pop out</button>}
        </div>
        <div className="relative min-h-0 flex-1" data-testid="files-viewer">
          {changed && <button onClick={() => setChanged(null)} className="absolute right-4 top-14 z-20 rounded bg-indigo-600 px-3 py-1 text-xs">{changed} ×</button>}
          {cur ? <div className={`flex h-full ${split ? "divide-x divide-white/10" : ""}`}><div className="min-w-0 flex-1"><Viewer key={`${cur.src}:${cur.id}:${reload}`} file={cur} siblings={ordered.filter(f => (f.src ?? source) === cur.src && /^(image|audio)\//.test(mimeOf(f))) as ViewerFile[]} /></div>{split && <div className="min-w-0 flex-1"><Viewer key={`${split.src}:${split.id}:${reload}`} file={split} siblings={ordered.filter(f => (f.src ?? source) === split.src && /^(image|audio)\//.test(mimeOf(f))) as ViewerFile[]} /></div>}</div> : <div className="flex h-full items-center justify-center text-sm opacity-50">Pick a file, or ask Jazper to open one.</div>}
        </div>
      </section>
    </div>
  );
}
