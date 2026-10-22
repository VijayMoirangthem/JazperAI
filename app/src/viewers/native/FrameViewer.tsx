import type { ViewerProps } from "../registry";
export default function FrameViewer({ file, contentUrl }: ViewerProps) { return <iframe title={file.name} sandbox="allow-downloads" src={contentUrl} className="h-full w-full border-0 bg-neutral-900" />; }
