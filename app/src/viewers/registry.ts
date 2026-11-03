import type { ComponentType } from "react";

export interface FileViewerRef { src: string; id: string; name: string; mime: string; size?: number; modified?: string; webUrl?: string }
export interface ViewerProps { file: FileViewerRef; contentUrl: string; siblings?: FileViewerRef[] }
export interface ViewerPlugin {
  id: string; label: string; priority?: number;
  mimes?: (string | RegExp)[]; extensions?: string[];
  capabilities?: { edit?: boolean; search?: boolean; thumbnails?: boolean };
  load: () => Promise<{ default: ComponentType<ViewerProps> }>;
}

const viewers: ViewerPlugin[] = [];
export const registerViewer = (viewer: ViewerPlugin) => { viewers.push(viewer); viewers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)); };
export const allViewers = () => [...viewers];
const extension = (name: string) => name.toLowerCase().split(".").pop() ?? "";
const matches = (value: string, candidates: (string | RegExp)[] = []) => candidates.some((x) => typeof x === "string" ? value === x || value.startsWith(x.endsWith("/") ? x : "\u0000") : x.test(value));
export const sniffMime = (bytes?: Uint8Array): string | undefined => {
  if (!bytes?.length) return undefined;
  const starts = (...v: number[]) => v.every((n, i) => bytes[i] === n);
  const ascii = (at: number, value: string) => value.split("").every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "application/zip";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, "GIF8")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
  if (ascii(0, "fLaC")) return "audio/flac";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (ascii(0, "ID3") || starts(0xff, 0xfb) || starts(0xff, 0xf3)) return "audio/mpeg";
  if (ascii(4, "ftyp")) return "video/mp4";
  if (ascii(0, "glTF")) return "model/gltf-binary";
  return undefined;
};
export const resolveViewer = (file: Pick<FileViewerRef, "name" | "mime">, bytes?: Uint8Array): ViewerPlugin | undefined => {
  const byMime = viewers.find((v) => matches(file.mime, v.mimes));
  const byExtension = viewers.find((v) => (v.extensions ?? []).includes(extension(file.name)));
  const detected = sniffMime(bytes);
  return byMime ?? byExtension ?? viewers.find((v) => matches(detected ?? "", v.mimes)) ?? viewers.find((v) => v.id === "unknown");
};

registerViewer({ id: "media", label: "Media", priority: 50, mimes: ["audio/", "video/", "application/vnd.apple.mpegurl", "application/x-mpegurl"], extensions: ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "mp4", "webm", "mov", "mkv", "avi", "wmv", "m3u8"], capabilities: { search: true }, load: () => import("./native/MediaViewer") });
registerViewer({ id: "image", label: "Image", priority: 40, mimes: ["image/"], extensions: ["heic", "heif", "avif", "svg", "cr2", "cr3", "nef", "arw", "dng", "raf", "orf"], capabilities: { thumbnails: true }, load: () => import("./native/ImageViewer") });
registerViewer({ id: "google-doc", label: "Google document", priority: 60, mimes: ["application/vnd.google-apps.document"], capabilities: { edit: true, search: true }, load: () => import("./native/HtmlViewer") });
registerViewer({ id: "google-sheet", label: "Google sheet", priority: 60, mimes: ["application/vnd.google-apps.spreadsheet"], capabilities: { edit: true, search: true }, load: () => import("./native/SpreadsheetViewer") });
registerViewer({ id: "google-slides", label: "Google slides", priority: 60, mimes: ["application/vnd.google-apps.presentation"], capabilities: { edit: true }, load: () => import("./native/FrameViewer") });
registerViewer({ id: "pdf", label: "PDF", priority: 40, mimes: ["application/pdf"], extensions: ["pdf"], capabilities: { search: true, thumbnails: true }, load: () => import("./native/PdfViewer") });
registerViewer({ id: "docx", label: "Word document", priority: 45, extensions: ["docx"], capabilities: { search: true }, load: () => import("./native/DocxViewer") });
registerViewer({ id: "spreadsheet", label: "Spreadsheet", priority: 45, mimes: ["text/csv", "text/tab-separated-values"], extensions: ["xlsx", "xls", "ods", "csv", "tsv"], capabilities: { edit: true, search: true }, load: () => import("./native/SpreadsheetViewer") });
registerViewer({ id: "office", label: "Office conversion", priority: 30, extensions: ["doc", "odt", "rtf", "ppt", "pptx"], load: () => import("./native/FrameViewer") });
registerViewer({ id: "archive", label: "Archive", priority: 35, extensions: ["zip", "tar", "gz", "tgz", "7z", "rar"], capabilities: { search: true }, load: () => import("./native/ArchiveViewer") });
registerViewer({ id: "ebook", label: "Ebook", priority: 35, extensions: ["epub", "mobi", "azw", "azw3"], capabilities: { search: true }, load: () => import("./native/EbookViewer") });
registerViewer({ id: "3d", label: "3D model", priority: 35, extensions: ["glb", "gltf", "obj", "stl"], load: () => import("./native/ModelViewer") });
registerViewer({ id: "font", label: "Font specimen", priority: 35, extensions: ["ttf", "otf", "woff", "woff2"], load: () => import("./native/FontViewer") });
registerViewer({ id: "email", label: "Email", priority: 35, extensions: ["eml", "msg"], load: () => import("./native/EmailViewer") });
registerViewer({ id: "notebook", label: "Jupyter notebook", priority: 35, extensions: ["ipynb"], capabilities: { search: true }, load: () => import("./native/NotebookViewer") });
registerViewer({ id: "markdown", label: "Markdown", priority: 25, extensions: ["md", "mdx"], capabilities: { edit: true, search: true }, load: () => import("./native/MarkdownViewer") });
registerViewer({ id: "text", label: "Text & code", priority: 10, mimes: ["text/", "application/xml", "application/javascript"], extensions: ["json", "yaml", "yml", "py", "ts", "tsx", "js", "jsx", "log", "txt"], capabilities: { edit: true, search: true }, load: () => import("./native/CodeViewer") });
registerViewer({ id: "unknown", label: "Unknown", priority: -100, load: () => import("./native/UnknownViewer") });
