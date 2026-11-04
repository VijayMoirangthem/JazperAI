import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import mammoth from "mammoth";
import DOMPurify from "dompurify";
import type { ViewerProps } from "../registry";

export default function DocxViewer({ contentUrl }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null); const [error, setError] = useState("");
  useEffect(() => { let alive = true; fetch(contentUrl).then(r => r.arrayBuffer()).then(async data => { if (!host.current || !alive) return; host.current.replaceChildren(); try { await renderAsync(data, host.current, undefined, { inWrapper: true }); } catch { const html = await mammoth.convertToHtml({ arrayBuffer: data }).then(x => x.value); if (host.current) host.current.innerHTML = DOMPurify.sanitize(html); } }).catch(e => alive && setError(String(e.message))); return () => { alive = false; }; }, [contentUrl]);
  return error ? <div className="p-4 text-red-300">{error}</div> : <div ref={host} className="h-full overflow-auto bg-white p-8 text-black" />;
}
