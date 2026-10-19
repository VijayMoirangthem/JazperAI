"use client";

import { useEffect } from "react";

const NUM_MAP: Record<string, string> = {
  "1": "dashboard",
  "2": "chat",
  "3": "tasks",
  "4": "notifications",
  "5": "history",
  "6": "memory",
  "7": "logs",
  ",": "settings",
};

// Ctrl/Cmd + key shortcuts
const CTRL_MAP: Record<string, string> = {
  "k": "search",
  "n": "compose",
};

export function useKeyboardShortcuts(onNavigate: (v: string) => void) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;

      // Ctrl/Cmd shortcuts work from anywhere
      if (e.ctrlKey || e.metaKey) {
        const mapped = CTRL_MAP[e.key.toLowerCase()];
        if (mapped) {
          e.preventDefault();
          onNavigate(mapped);
        }
        return;
      }

      // Number shortcuts only when not typing
      if (isEditable || e.altKey) return;
      const mapped = NUM_MAP[e.key];
      if (mapped) {
        e.preventDefault();
        onNavigate(mapped);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNavigate]);
}
