import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import type { ViewerProps } from "../registry";

type ParsedMail = { headers: string[]; body: string; html?: string; attachments: string[] };

const cleanHtml = (value: string) => DOMPurify.sanitize(value, { FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "img", "style"], FORBID_ATTR: ["style", "srcset"] });

export default function EmailViewer({ contentUrl, file }: ViewerProps) {
  const [mail, setMail] = useState<ParsedMail | null>(null); const [error, setError] = useState("");
  useEffect(() => { let alive = true; const read = async () => {
    try {
      const response = await fetch(contentUrl); if (!response.ok) throw new Error("Could not read this email.");
      if (/\.msg$/i.test(file.name)) {
        const [{ default: MsgReader }, bytes] = await Promise.all([import("@kenjiuno/msgreader"), response.arrayBuffer()]);
        const value = new MsgReader(bytes).getFileData();
        const recipients = (value.recipients ?? []).map((row: any) => row.email ?? row.name).filter(Boolean).join(", ");
        const html = value.bodyHtml || (value.html ? new TextDecoder().decode(value.html) : "");
        if (alive) setMail({ headers: [["From", value.senderName || value.senderEmail].filter(Boolean).join(": "), value.subject ? `Subject: ${value.subject}` : "", recipients ? `To: ${recipients}` : ""].filter(Boolean), body: value.body || "", html, attachments: (value.attachments ?? []).map((item: any) => item.fileName || item.fileNameShort || "Attachment") });
      } else {
        const raw = await response.text(); const [head = "", body = ""] = raw.split(/\r?\n\r?\n/, 2);
        if (alive) setMail({ headers: head.split(/\r?\n/).filter(Boolean).filter(x => /^(from|to|cc|subject|date):/i.test(x)), body, html: /content-type:\s*text\/html/i.test(head) ? body : "", attachments: [] });
      }
    } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Could not read this email."); }
  }; void read(); return () => { alive = false; }; }, [contentUrl, file.name]);
  if (error) return <div className="p-6 text-sm text-amber-300">{error}</div>;
  if (!mail) return <div className="p-6 text-sm opacity-60">Loading email…</div>;
  const html = mail.html ? cleanHtml(mail.html) : "";
  return <div className="h-full overflow-auto p-6"><div className="mb-5 space-y-1 rounded bg-white/5 p-3 text-sm">{mail.headers.map(x => <div key={x}>{x}</div>)}{mail.attachments.length > 0 && <div className="pt-2 text-xs opacity-60">Attachments: {mail.attachments.join(", ")}</div>}</div>{html ? <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{mail.body}</pre>}</div>;
}
