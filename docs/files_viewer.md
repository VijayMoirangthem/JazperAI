# Jazper file viewers

The in-app file surface accepts a `FileRef`: `{ src, id, name, mime, size, modified, webUrl? }`. It is source-agnostic: Drive, permitted local folders, chat attachments and storage use the same `/api/v1/files` endpoints. File bytes are served with HTTP Range support and are never executed.

## Adding a format

1. Create a lazy React viewer in `app/src/viewers/` that accepts `ViewerProps`.
2. Register it in `app/src/viewers/registry.ts` with MIME and extension matchers, priority and optional `edit`, `search` and `thumbnails` capabilities.
3. If a browser cannot render the original bytes, add a converter behind `core/files` and expose the result through `mode=html|pdf|thumb`. Optional system programs must be detected and reported by `/api/v1/files/capabilities`; never invoke an installer without the HITL approval gate.
4. Add resolver and Electron coverage for a representative fixture, plus failure coverage when the converter is absent.

The built-in fallback viewers cover text/code, images, PDF/converted Office files and native audio/video. Plugins must sanitize untrusted markup and must not execute embedded scripts or open network connections.

Optional Windows converters: LibreOffice (`winget install TheDocumentFoundation.LibreOffice`), FFmpeg (`winget install Gyan.FFmpeg`) and 7-Zip (`winget install 7zip.7zip`). Their live availability is returned by `/api/v1/files/capabilities`.
