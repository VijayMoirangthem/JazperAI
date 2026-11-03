export type JazperFileLink = {
  src: "drive" | "local" | "attachment" | "storage" | "url";
  id: string;
  name: string;
  mime: string;
  size?: number;
  modified?: string;
  webUrl?: string;
};

const SOURCES = new Set<JazperFileLink["src"]>(["drive", "local", "attachment", "storage", "url"]);

/** Parse only Jazper's own file URI format; URLs with missing IDs stay plain text. */
export function parseJazperFileLink(token: string): JazperFileLink | null {
  try {
    const url = new URL(token);
    if (url.protocol !== "jazper:" || url.hostname !== "open") return null;
    const src = url.searchParams.get("src");
    const id = url.searchParams.get("id");
    if (!src || !SOURCES.has(src as JazperFileLink["src"]) || !id || id.length > 4096) return null;
    const size = Number(url.searchParams.get("size"));
    return {
      src: src as JazperFileLink["src"], id,
      name: url.searchParams.get("name")?.slice(0, 255) || "file",
      mime: url.searchParams.get("mime")?.slice(0, 255) || "application/octet-stream",
      ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
      ...(url.searchParams.get("modified") ? { modified: url.searchParams.get("modified")!.slice(0, 255) } : {}),
      ...(url.searchParams.get("webUrl")?.startsWith("https://") ? { webUrl: url.searchParams.get("webUrl")! } : {}),
    };
  } catch { return null; }
}
