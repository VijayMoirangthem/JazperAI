import { useEffect, useState } from "react";
import type { ViewerProps } from "../registry";
export default function TextViewer({ contentUrl }: ViewerProps) { const [text, setText] = useState("Loading…"); useEffect(() => { let mounted = true; fetch(contentUrl).then((r) => r.text()).then((v) => mounted && setText(v)).catch((e) => mounted && setText(String(e))); return () => { mounted = false; }; }, [contentUrl]); return <pre className="h-full overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5">{text}</pre>; }
