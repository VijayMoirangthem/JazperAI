# Jazper file viewers

The in-app file surface accepts a `FileRef`: `{ src, id, name, mime, size, modified, webUrl? }`. It is source-agnostic: Drive, permitted local folders, chat attachments and storage use the same `/api/v1/files` endpoints. File bytes are served with HTTP Range support and are never executed.

## Adding a format

1. Create a lazy React viewer in `app/src/viewers/` that accepts `ViewerProps`.
2. Register it in `app/src/viewers/registry.ts` with MIME and extension matchers, priority and optional `edit`, `search` and `thumbnails` capabilities.
3. If a browser cannot render the original bytes, add a converter behind `core/files` and expose the result through `mode=html|pdf|thumb`. Optional system programs must be detected and reported by `/api/v1/files/capabilities`; never invoke an installer without the HITL approval gate.
4. Add resolver and Electron coverage for a representative fixture, plus failure coverage when the converter is absent.

The built-in fallback viewers cover text/code, images, PDF/converted Office files, native audio/video, ZIP/TAR archives, EPUB, fonts, email and GLTF/GLB/OBJ/STL models. 7-Zip extends archive listing and approved extraction to 7Z/RAR; Calibre converts MOBI/AZW/AZW3 to EPUB. Plugins must sanitize untrusted markup and must not execute embedded scripts or open network connections.

Optional Windows converters: LibreOffice (`winget install TheDocumentFoundation.LibreOffice`), FFmpeg (`winget install Gyan.FFmpeg`), 7-Zip (`winget install 7zip.7zip`) and Calibre for MOBI/AZW conversion (`winget install Calibre.Calibre`). Their live availability is returned by `/api/v1/files/capabilities`.

## Shipped viewer modules

All viewer modules are lazy imports: PDF uses `pdfjs-dist`; Word uses `docx-preview` with `mammoth` fallback; sheets use `xlsx` and `papaparse`; Markdown and notebook markdown are sanitised with `dompurify` and rendered with `marked`; code uses Monaco. Jupyter notebook output is displayed but never executed. Google Docs can be edited in Jazper through TipTap, with a local draft, undo/redo and a diff review before the approval-gated save. Media uses `wavesurfer.js` and `hls.js`, including a persistent Media Session-aware mini player: keeping a track playing also queues sibling audio files for next/previous/shuffle/repeat. Images use `exifr`, archives use `jszip` with a safe backend listing fallback, EPUB uses `epubjs`, Outlook MSG uses `@kenjiuno/msgreader`, and GLTF/GLB/OBJ/STL use Three.js. Package versions and their upstream licence metadata are pinned in `app/package.json` and its lockfile.

The backend cache is keyed by file source, id, modification stamp and conversion mode. LibreOffice is used for Office-to-PDF conversion; FFmpeg supplies video conversion/posters when installed. A converter must fail with a capability remedy instead of breaking the viewer when its optional executable is absent. Conversion viewers probe output before embedding it, so the user gets that remedy and an original-file download rather than an opaque iframe failure.

## Verification commands

Run the focused checks from the repository root:

```powershell
cd app; npx tsc -p tsconfig.files.json --noEmit
cd app; npm test
cd backend\python; ..\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests\test_files_service.py tests\test_file_fastpaths.py
```

The Electron test launches the real desktop shell. Start dev services normally, or let Playwright start them. Use isolated output paths if another run has a locked `e2e/test-results` folder:

```powershell
cd e2e
$env:JASPER_E2E_OUTPUT = "$PWD\playwright-local-output"
$env:JASPER_E2E_SHOTS = "$PWD\files-local-shots"
$env:JASPER_E2E_UI_URL = "http://localhost:5174/" # only when 5173 is in use
npx playwright test tests/files.spec.ts
```

Without those environment variables, screenshots are written to `e2e/test-results/files/` for acceptance artifacts.
