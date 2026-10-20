import { create } from "zustand";

export interface ChatIntent { id: string; label: string; kind: "dm" | "room" | "comms"; crew?: string }

interface ChatIntentState {
  intent: ChatIntent | null;
  open: (i: ChatIntent) => void;
  consume: () => void;
}

/** "Open this channel in Team Chat" request from other panels (Office 2 proximity chip, ID card). */
export const useChatIntent = create<ChatIntentState>((set) => ({
  intent: null,
  open: (i) => set({ intent: { ...i } }),
  consume: () => set({ intent: null }),
}));
