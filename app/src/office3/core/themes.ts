export interface OfficeTheme { id: string; label: string; floor: string; wall: string; accent: string; sky: string; light: "day" | "night"; }
export const THEMES: readonly OfficeTheme[] = [
  { id: "tech-startup", label: "Tech startup", floor: "#334155", wall: "#cbd5e1", accent: "#38bdf8", sky: "#dbeafe", light: "day" },
  { id: "trading", label: "Trading company", floor: "#1f2937", wall: "#d1d5db", accent: "#22c55e", sky: "#e0f2fe", light: "day" },
  { id: "agency", label: "Agency", floor: "#713f12", wall: "#fef3c7", accent: "#ec4899", sky: "#fdf2f8", light: "day" },
  { id: "executive", label: "Executive suite", floor: "#3f2a1d", wall: "#e7e5e4", accent: "#eab308", sky: "#f5f5f4", light: "day" },
  { id: "publisher", label: "Publisher", floor: "#44403c", wall: "#fafaf9", accent: "#f97316", sky: "#fff7ed", light: "day" },
  { id: "night-owl", label: "Night owl", floor: "#111827", wall: "#334155", accent: "#a78bfa", sky: "#020617", light: "night" },
  { id: "blueprint", label: "Blueprint", floor: "#0c4a6e", wall: "#e0f2fe", accent: "#f8fafc", sky: "#082f49", light: "night" },
];
export const themeById = (id: string): OfficeTheme => THEMES.find(theme => theme.id === id) ?? THEMES[0];
