import { create } from "zustand";

const KEY = "jasper.chat.drafts.v1";
const load = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
};

/** Unsent message per channel, kept in localStorage: switching chats or tabs (or restarting) never loses typed text. */
export const useDrafts = create<{ text: Record<string, string>; set: (channel: string, text: string) => void }>((set) => ({
  text: load(),
  set: (channel, value) => set((s) => {
    const text = { ...s.text, [channel]: value };
    if (!value) delete text[channel];
    try { localStorage.setItem(KEY, JSON.stringify(text)); } catch { /* storage unavailable */ }
    return { text };
  }),
}));
