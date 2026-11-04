"""Safe, optional file conversions used by the file viewer.

Converters never execute a document.  Results live in a local disk cache and
optional binaries are discovered rather than assumed to be installed.
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path


CACHE = Path(__file__).resolve().parents[4] / "storage" / "file_cache"
OFFICE = {".doc", ".docx", ".odt", ".rtf", ".ppt", ".pptx", ".xls", ".xlsx", ".ods"}
EBOOKS = {".mobi", ".azw", ".azw3"}


class ConverterMissing(RuntimeError):
    pass


def _target(source: Path, stamp: str, mode: str, suffix: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(f"{source.resolve()}:{stamp}:{mode}".encode()).hexdigest()
    return CACHE / f"{digest}{suffix}"


def office_to_pdf(source: Path, stamp: str) -> Path:
    if source.suffix.lower() not in OFFICE:
        raise ValueError("this is not an Office document")
    out = _target(source, stamp, "pdf", ".pdf")
    if out.exists():
        return out
    soffice = shutil.which("soffice")
    if not soffice:
        raise ConverterMissing("converter missing: install LibreOffice (winget install TheDocumentFoundation.LibreOffice)")
    work = out.parent / (out.stem + ".work")
    work.mkdir(exist_ok=True)
    try:
        proc = subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", str(work), str(source)], capture_output=True, text=True, timeout=90, check=False)
        made = work / f"{source.stem}.pdf"
        if proc.returncode != 0 or not made.exists():
            raise RuntimeError((proc.stderr or proc.stdout or "LibreOffice conversion failed").strip()[:500])
        shutil.move(str(made), str(out))
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)


def image_thumb(source: Path, stamp: str) -> Path:
    out = _target(source, stamp, "thumb", ".jpg")
    if out.exists():
        return out
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise ConverterMissing("thumbnail support needs Pillow") from exc
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((512, 512))
        image.save(out, "JPEG", quality=82, optimize=True)
    return out


def media_thumb(source: Path, stamp: str) -> Path:
    out = _target(source, stamp, "thumb", ".jpg")
    if out.exists():
        return out
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ConverterMissing("converter missing: install ffmpeg (winget install Gyan.FFmpeg)")
    proc = subprocess.run([ffmpeg, "-y", "-ss", "00:00:01", "-i", str(source), "-frames:v", "1", "-vf", "scale=512:-2", str(out)], capture_output=True, text=True, timeout=45, check=False)
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError((proc.stderr or "ffmpeg thumbnail conversion failed")[-500:])
    return out


def video_to_mp4(source: Path, stamp: str) -> Path:
    out = _target(source, stamp, "mp4", ".mp4")
    if out.exists(): return out
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg: raise ConverterMissing("converter missing: install ffmpeg (winget install Gyan.FFmpeg)")
    proc = subprocess.run([ffmpeg, "-y", "-i", str(source), "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", str(out)], capture_output=True, text=True, timeout=600, check=False)
    if proc.returncode != 0 or not out.exists(): raise RuntimeError((proc.stderr or "ffmpeg video conversion failed")[-500:])
    return out


def image_to_jpeg(source: Path, stamp: str) -> Path:
    out = _target(source, stamp, "jpeg", ".jpg")
    if out.exists(): return out
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg: raise ConverterMissing("converter missing: install ffmpeg (winget install Gyan.FFmpeg)")
    proc = subprocess.run([ffmpeg, "-y", "-i", str(source), "-frames:v", "1", "-q:v", "2", str(out)], capture_output=True, text=True, timeout=60, check=False)
    if proc.returncode != 0 or not out.exists(): raise RuntimeError((proc.stderr or "image conversion failed")[-500:])
    return out


def srt_to_vtt(source: Path, stamp: str) -> Path:
    """Convert a local subtitle sidecar without invoking any external program."""
    if source.suffix.lower() != ".srt":
        raise ValueError("this is not an SRT subtitle file")
    out = _target(source, stamp, "vtt", ".vtt")
    if out.exists():
        return out
    raw = source.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    # WebVTT uses a period rather than a comma in cue timestamps. Numeric cue ids are valid VTT cue ids.
    out.write_text("WEBVTT\n\n" + raw.replace(",", "."), encoding="utf-8")
    return out


def ebook_to_epub(source: Path, stamp: str) -> Path:
    """Convert Kindle formats into EPUB when Calibre is installed.

    Calibre's command-line converter is deliberately discovered at runtime: the
    browser never attempts to parse or execute a Kindle container itself.
    """
    if source.suffix.lower() not in EBOOKS:
        raise ValueError("this is not a Kindle ebook")
    out = _target(source, stamp, "epub", ".epub")
    if out.exists():
        return out
    converter = shutil.which("ebook-convert")
    if not converter:
        raise ConverterMissing("converter missing: install Calibre (winget install Calibre.Calibre)")
    proc = subprocess.run([converter, str(source), str(out)], capture_output=True, text=True, timeout=180, check=False)
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError((proc.stderr or proc.stdout or "Calibre conversion failed").strip()[-500:])
    return out
