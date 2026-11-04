import { useEffect, useState } from "react";
import type { ViewerProps } from "../registry";

export default function FontViewer({ file, contentUrl }: ViewerProps) {
  const [sample, setSample] = useState("The quick brown fox jumps over the lazy dog 0123456789"); const family = `jasper-font-${file.id.replace(/[^a-z0-9]/gi, "")}`;
  useEffect(() => { const face = new FontFace(family, `url(${contentUrl})`); face.load().then(x => document.fonts.add(x)).catch(() => undefined); return () => { document.fonts.delete(face); }; }, [contentUrl, family]);
  return <div className="h-full overflow-auto p-6"><h2 className="mb-4 text-lg">{file.name}</h2><input aria-label="Font specimen" value={sample} onChange={e => setSample(e.target.value)} className="mb-5 w-full rounded bg-white/10 p-2 text-sm outline-none" /><div style={{ fontFamily: family }} className="space-y-5"><p className="text-5xl">{sample}</p><p className="text-3xl">{sample}</p><p className="text-xl">{sample}</p><p className="text-base">{sample}</p></div></div>;
}
