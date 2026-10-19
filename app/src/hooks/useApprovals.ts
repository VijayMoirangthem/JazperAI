"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ApprovalRequest = {
  id:          string;
  agent:       string;
  action_type: string;
  description: string;
  payload:     Record<string, unknown>;
  status:      string;
  created_at:  string;
};

export function useApprovals() {
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${API}/api/approvals/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "approval_requested") {
          const req: ApprovalRequest = ev;
          setPending((prev) =>
            prev.find((p) => p.id === req.id) ? prev : [...prev, req]
          );
        } else if (ev.type === "approval_resolved" || ev.type === "approval_auto_approved") {
          setPending((prev) => prev.filter((p) => p.id !== ev.id));
        }
      } catch { /* malformed */ }
    };

    es.onerror = () => {
      // SSE auto-reconnects — backend may be starting up
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  const approve = useCallback(async (id: string) => {
    await fetch(`${API}/api/approvals/${id}/approve`, { method: "POST" });
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const deny = useCallback(async (id: string) => {
    await fetch(`${API}/api/approvals/${id}/deny`, { method: "POST" });
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { pending, approve, deny };
}
