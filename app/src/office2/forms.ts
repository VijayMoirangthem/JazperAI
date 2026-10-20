export const SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/; // same rule as BotIn.slug in backend/python/api/routes/bots.py

/** "Forge Bot 2" -> "forge-bot-2". Non a-z0-9 characters become "-", runs collapse, edges are trimmed, max 40 chars. Empty string when nothing is left. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
}

export interface EmployeeForm { slug: string; name: string; role: string; crew: string; prompt: string }

/** First problem as a sentence for the dialog, or null when the form can be submitted. */
export function validateEmployee(f: EmployeeForm, existingSlugs: readonly string[], mode: "add" | "edit"): string | null {
  if (!f.name.trim()) return "Name is required.";
  if (!SLUG_RE.test(f.slug)) return "Slug must be 2-63 characters: a-z, 0-9, dot, underscore or dash, starting with a letter or digit.";
  if (mode === "add" && existingSlugs.includes(f.slug)) return "That slug is already taken.";
  if (!f.role.trim()) return "Role is required.";
  if (!f.crew.trim()) return "Crew is required.";
  if (!f.prompt.trim()) return "Prompt is required.";
  return null;
}
