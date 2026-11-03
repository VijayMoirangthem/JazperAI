#!/usr/bin/env node
/**
 * Builds the Office 3 look catalogue and its lightweight local thumbnail set.
 *
 * The source GLBs remain authoritative for the live turntable.  These SVGs are
 * intentionally deterministic catalogue cards, so opening the gallery never
 * needs to decode fifty GLBs just to show its first frame.  A future renderer
 * capture pass can replace an individual card with a PNG at the same path in
 * the index without changing the UI contract.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(scriptDir);
const characterDir = join(appDir, "public", "office3", "characters");
const looksDir = join(appDir, "public", "office3", "looks");
const thumbsDir = join(looksDir, "thumbs");
const priorIndexPath = join(looksDir, "index.json");
const swatches = ["#38bdf8", "#a78bfa", "#34d399", "#f59e0b", "#fb7185", "#60a5fa", "#f472b6", "#22c55e"];

const escapeXml = (value) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
const hash = (value) => [...value].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 7);
const thumbnail = (id) => {
  const seed = hash(id), primary = swatches[seed % swatches.length], accent = swatches[(seed >>> 3) % swatches.length];
  const label = escapeXml(id.replace(/^office-/, "").slice(0, 12).toUpperCase());
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${label} Office look"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs><rect width="160" height="160" rx="18" fill="url(#bg)"/><circle cx="80" cy="52" r="25" fill="#fed7aa"/><path d="M52 51c2-30 56-31 57 1-12-11-42-14-57-1Z" fill="#334155"/><path d="M38 137c4-42 25-58 42-58s38 16 42 58" fill="${accent}"/><path d="M55 137V99m50 38V99" stroke="#172554" stroke-width="10" stroke-linecap="round"/><rect x="14" y="122" width="132" height="24" rx="10" fill="#020617" fill-opacity=".55"/><text x="80" y="139" fill="white" font-family="system-ui,sans-serif" font-size="13" font-weight="700" text-anchor="middle">${label}</text></svg>`;
};

const files = (await readdir(characterDir)).filter(file => file.endsWith(".glb")).sort();
const existing = JSON.parse(await readFile(priorIndexPath, "utf8"));
const existingById = new Map(existing.map(look => [look.id, look]));
await mkdir(thumbsDir, { recursive: true });
const looks = await Promise.all(files.map(async (file, index) => {
  const id = basename(file, ".glb");
  const prior = existingById.get(id) ?? {};
  await writeFile(join(thumbsDir, `${id}.svg`), thumbnail(id));
  return {
    id,
    file: `/office3/characters/${file}`,
    gender: prior.gender ?? (index % 2 ? "b" : "a"),
    bodyType: prior.bodyType ?? ["a", "b", "c"][index % 3],
    paletteRegions: prior.paletteRegions ?? ["skin", "hair", "top", "bottom", "shoes"],
    thumbnail: `/office3/looks/thumbs/${id}.svg`,
  };
}));
await writeFile(priorIndexPath, `${JSON.stringify(looks, null, 2)}\n`);
console.log(`Built ${looks.length} Office 3 looks and thumbnails.`);
