import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ViewerProps } from "../registry";

type Cell = { cell_type?: string; source?: string[] | string; execution_count?: number | null; outputs?: Array<{ output_type?: string; text?: string[] | string; data?: Record<string, string[] | string> }> };
const sourceOf = (value?: string[] | string) => Array.isArray(value) ? value.join("") : value ?? "";
const clean = (value: string) => DOMPurify.sanitize(value, { FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "link"], FORBID_ATTR: ["style", "srcset"] });

export default function NotebookViewer({ contentUrl }: ViewerProps) {
  const [cells, setCells] = useState<Cell[]>([]); const [error, setError] = useState("");
  useEffect(() => { let active = true; fetch(contentUrl + "&mode=text").then(async r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<{ cells?: Cell[] }>; }).then(doc => active && setCells((doc.cells ?? []).slice(0, 500))).catch(reason => active && setError(reason instanceof Error ? reason.message : "Could not read notebook.")); return () => { active = false; }; }, [contentUrl]);
  const rendered = useMemo(() => cells.map((cell, index) => ({ cell, index, source: sourceOf(cell.source), markdown: cell.cell_type === "markdown" ? clean(String(marked.parse(sourceOf(cell.source)))) : "" })), [cells]);
  if (error) return <div className="p-5 text-sm text-amber-300">Notebook could not be rendered: {error}</div>;
  return <div className="h-full overflow-auto bg-[#111] p-4"><div className="mb-3 text-xs opacity-60">Jupyter notebook · {cells.length} cells · output is displayed but never executed</div>{rendered.map(({ cell, index, source, markdown }) => <section key={index} className="mb-3 overflow-hidden rounded-lg border border-white/10 bg-black/20">{cell.cell_type === "markdown" ? <article className="prose prose-invert max-w-none p-4 text-sm" dangerouslySetInnerHTML={{ __html: markdown }} /> : <><div className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-3 py-1 text-xs opacity-60">In [{cell.execution_count ?? " "}]</div><pre className="overflow-auto p-3 text-xs leading-5 text-sky-100">{source}</pre></>}{cell.outputs?.map((output, outputIndex) => { const text = sourceOf(output.text); const html = sourceOf(output.data?.["text/html"]); const image = sourceOf(output.data?.["image/png"]); return <div key={outputIndex} className="border-t border-white/10 bg-white/[0.03] p-3 text-sm">{image ? <img className="max-w-full" alt="Notebook output" src={`data:image/png;base64,${image}`} /> : html ? <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: clean(html) }} /> : <pre className="whitespace-pre-wrap font-mono text-xs">{text || sourceOf(output.data?.["text/plain"])}</pre>}</div>; })}</section>)}</div>;
}
