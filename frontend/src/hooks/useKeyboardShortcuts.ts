"use client";

import { useEffect } from "react";

type View = "dashboard" | "chat" | "history" | "tasks" | "memory" | "logs" | "browser" | "settings" | "jobs" | "gmail" | "jobapply" | "notifications";

const KEY_MAP: Record<string, View> = {
  "1": "dashboard",
  "2": "chat",
  "3": "tasks",
  "4": "notifications",
  "5": "history",
  "6": "memory",
  "7": "logs",
  ",": "settings",
};

export function useKeyboardShortcuts(onNavigate: (v: View) => void) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Ignore when typing in input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      // Ignore when modifier keys (except g-prefix) are held
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const mapped = KEY_MAP[e.key];
      if (mapped) {
        e.preventDefault();
        onNavigate(mapped);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNavigate]);
}
