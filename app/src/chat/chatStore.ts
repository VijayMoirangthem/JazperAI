import { create } from "zustand";

export interface Attachment { name: string; mime: string; size: number; text?: string; dataUrl?: string }
export interface ChatMessage {
  id: string;
  from: string; // "you" | agent slug | "system"
  text: string;
  ts: number;
  status?: "sent" | "delivered" | "read";
  streaming?: boolean;
  attachments?: Attachment[];
  ui?: { kind: "credentials" | "oauth" | "suggestions"; items?: { id: string; name: string; why: string; status: string; connectable: boolean; untested?: boolean }[]; connector: string; secrets?: { name: string; label: string }[]; url?: string; provider?: string; done?: boolean };
  phase?: boolean;
  tool?: { name: string; label: string; status: "running" | "ok" | "error"; result?: string; untrusted?: string };
  meta?: { route?: { slugs: string[]; source: string; confidence: number }; tokens?: number };
}
export type ApprovalLevel = "ask" | "auto_edits" | "approve_for_me" | "full";

interface ChatState {
  threads: Record<string, ChatMessage[]>;
  lastRead: Record<string, string>; // channel -> last message id the user has seen
  approvalLevel: Record<string, ApprovalLevel>;
  push: (channel: string, m: ChatMessage) => void;
  patch: (channel: string, id: string, p: Partial<ChatMessage>) => void;
  append: (channel: string, id: string, delta: string) => void;
  markRead: (channel: string) => void;
  clear: (channel: string) => void;
  remove: (channel: string, id: string) => void;
  truncateFrom: (channel: string, id: string) => void;
  setApprovalLevel: (slug: string, l: ApprovalLevel) => void;
}

const KEY = "jasper.chat.v2";
const load = (): Partial<ChatState> => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
};
const saved = load();

export const useChat = create<ChatState>((set, get) => ({
  threads: saved.threads ?? {},
  lastRead: saved.lastRead ?? {},
  approvalLevel: saved.approvalLevel ?? {},
  push: (c, m) => set((s) => ({ threads: { ...s.threads, [c]: [...(s.threads[c] ?? []), m] } })),
  patch: (c, id, p) => set((s) => ({ threads: { ...s.threads, [c]: (s.threads[c] ?? []).map((m) => (m.id === id ? { ...m, ...p } : m)) } })),
  append: (c, id, d) => set((s) => ({ threads: { ...s.threads, [c]: (s.threads[c] ?? []).map((m) => (m.id === id ? { ...m, text: m.text + d } : m)) } })),
  markRead: (c) => { const t = get().threads[c] ?? []; if (t.length) set((s) => ({ lastRead: { ...s.lastRead, [c]: t[t.length - 1].id } })); },
  remove: (c, id) => set((s) => ({ threads: { ...s.threads, [c]: (s.threads[c] ?? []).filter((m) => m.id !== id) } })),
  truncateFrom: (c, id) => set((s) => { const l = s.threads[c] ?? []; const i = l.findIndex((m) => m.id === id); return { threads: { ...s.threads, [c]: i < 0 ? l : l.slice(0, i) } }; }),
  clear: (c) => set((s) => ({ threads: { ...s.threads, [c]: [] }, lastRead: { ...s.lastRead, [c]: "" } })),
  setApprovalLevel: (slug, l) => set((s) => ({ approvalLevel: { ...s.approvalLevel, [slug]: l } })),
}));

useChat.subscribe((s) => {
  try {
    // streaming placeholders and attachment payloads are not persisted
    const threads = Object.fromEntries(Object.entries(s.threads).map(([k, v]) => [k,
      v.slice(-300).map((m) => ({ ...m, streaming: false, attachments: m.attachments?.map(({ dataUrl: _d, text: _t, ...a }) => a) }))]));
    localStorage.setItem(KEY, JSON.stringify({ threads, lastRead: s.lastRead, approvalLevel: s.approvalLevel }));
  } catch { /* storage unavailable */ }
});

/** Index of the first message after `lastRead` that the user did not write (the unread divider position), or -1. */
export function firstUnreadIndex(messages: readonly ChatMessage[], lastReadId: string | undefined): number {
  if (!lastReadId) return messages.findIndex((m) => m.from !== "you");
  const i = messages.findIndex((m) => m.id === lastReadId);
  for (let j = i + 1; j < messages.length; j++) if (messages[j].from !== "you") return j;
  return -1;
}
