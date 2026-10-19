"use client";

import { useState, useEffect, useCallback } from "react";

export type IdeThemeId = "vs-dark" | "hc-black" | "light";

export interface IdeSettings {
  theme: IdeThemeId;
  fontFamily: string;
  fontSize: number;
  autosave: boolean;
  autosaveIntervalMs: number;
}

export const IDE_FONT_PRESETS = [
  "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
  "'JetBrains Mono', monospace",
  "'Fira Code', monospace",
  "'Source Code Pro', monospace",
  "Consolas, monospace",
];

export const IDE_THEME_PRESETS: { id: IdeThemeId; label: string }[] = [
  { id: "vs-dark", label: "Dark (default)" },
  { id: "hc-black", label: "High Contrast" },
  { id: "light", label: "Light" },
];

export const DEFAULT_IDE_SETTINGS: IdeSettings = {
  theme: "vs-dark",
  fontFamily: IDE_FONT_PRESETS[0],
  fontSize: 13,
  autosave: false,
  autosaveIntervalMs: 1500,
};

const KEY = "sj-ide-settings";

export function useIdeSettings() {
  const [settings, setSettings] = useState<IdeSettings>(DEFAULT_IDE_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setSettings({ ...DEFAULT_IDE_SETTINGS, ...JSON.parse(raw) });
    } catch { /* ignore corrupt storage */ }
  }, []);

  const save = useCallback((next: IdeSettings) => {
    setSettings(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore quota errors */ }
  }, []);

  return { settings, save };
}
