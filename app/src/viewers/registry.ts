import type { ComponentType } from "react";

export interface FileViewerRef { src: string; id: string; name: string; mime: string; size?: number; modified?: string; webUrl?: string }
export interface ViewerProps { file: FileViewerRef; contentUrl: string }
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
export const resolveViewer = (file: Pick<FileViewerRef, "name" | "mime">): ViewerPlugin | undefined => viewers.find((v) => matches(file.mime, v.mimes) || (v.extensions ?? []).includes(extension(file.name)));

registerViewer({ id: "media", label: "Media", priority: 50, mimes: ["audio/", "video/"], extensions: ["mp3", "wav", "flac", "ogg", "m4a", "mp4", "webm", "mov", "mkv"], capabilities: { search: true }, load: () => import("./native/MediaViewer") });
registerViewer({ id: "image", label: "Image", priority: 40, mimes: ["image/"], extensions: ["heic", "avif", "svg"], capabilities: { thumbnails: true }, load: () => import("./native/ImageViewer") });
registerViewer({ id: "pdf", label: "PDF", priority: 40, mimes: ["application/pdf"], extensions: ["pdf"], capabilities: { search: true, thumbnails: true }, load: () => import("./native/FrameViewer") });
registerViewer({ id: "office", label: "Office document", priority: 30, extensions: ["doc", "docx", "odt", "rtf", "ppt", "pptx", "xls", "xlsx", "ods"], load: () => import("./native/FrameViewer") });
registerViewer({ id: "text", label: "Text & code", priority: 10, mimes: ["text/", "application/json", "application/xml", "application/javascript"], extensions: ["md", "mdx", "json", "yaml", "yml", "py", "ts", "tsx", "js", "jsx", "log", "csv", "tsv", "txt", "ipynb"], capabilities: { edit: true, search: true }, load: () => import("./native/TextViewer") });
