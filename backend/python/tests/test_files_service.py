from pathlib import Path
import zipfile

import pytest

from core.files.service import ATTACHMENTS, FileService, MAX_BYTES


def test_attachment_round_trip_and_normalisation(tmp_path, monkeypatch):
    monkeypatch.setattr("core.files.service.ATTACHMENTS", tmp_path)
    service = FileService()
    ref = service.save_attachment("Quarterly plan!.md", b"# plan", "text/markdown")
    assert ref.src == "attachment"
    assert ref.id.endswith("Quarterly_plan_.md") and ref.name == "Quarterly_plan_.md"
    path, mime, again = service.open_path("attachment", ref.id)
    assert path.read_bytes() == b"# plan" and mime == "text/markdown" and again.name == ref.name


def test_attachment_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr("core.files.service.ATTACHMENTS", tmp_path)
    service = FileService()
    with pytest.raises(FileNotFoundError):
        service.open_path("attachment", "../.env")


def test_local_provider_blocks_escape_and_secret_files(tmp_path, monkeypatch):
    root, outside = tmp_path / "allowed", tmp_path / "outside"
    root.mkdir(); outside.mkdir()
    (root / ".env").write_text("SECRET=value", encoding="utf-8")
    (outside / "report.txt").write_text("outside", encoding="utf-8")
    monkeypatch.setattr("agents.workspaces.roots_for", lambda _slug: [{"path": str(root), "mode": "read-write", "label": "allowed"}])
    service = FileService()
    with pytest.raises(PermissionError, match="secret"):
        service.meta("local", str(root / ".env"))
    with pytest.raises(PermissionError, match="outside"):
        service.meta("local", str(outside / "report.txt"))


def test_attachment_size_cap(tmp_path, monkeypatch):
    monkeypatch.setattr("core.files.service.ATTACHMENTS", tmp_path)
    service = FileService()
    with pytest.raises(OverflowError):
        service.save_attachment("large.bin", b"x" * (MAX_BYTES + 1))


def test_archive_listing_hides_and_extraction_rejects_path_traversal(tmp_path, monkeypatch):
    attachments, allowed = tmp_path / "attachments", tmp_path / "allowed"
    attachments.mkdir(); allowed.mkdir()
    archive = attachments / "unsafe.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("safe.txt", "okay")
        bundle.writestr("../escape.txt", "blocked")
    monkeypatch.setattr("core.files.service.ATTACHMENTS", attachments)
    service = FileService()
    rows = service.archive_entries("attachment", archive.name)
    assert [row["name"] for row in rows] == ["safe.txt"]
    monkeypatch.setattr(service, "_local", lambda _: allowed)
    with pytest.raises(PermissionError, match="path traversal"):
        service.extract_archive("attachment", archive.name, str(allowed))


def test_capabilities_always_offer_safe_remedies():
    tools = FileService().capabilities()["tools"]
    assert set(tools) == {"libreoffice", "ffmpeg", "7zip", "calibre"}
    assert all(item["install"].startswith("winget install ") for item in tools.values())


def test_url_provider_is_opt_in_and_blocks_private_hosts(monkeypatch):
    service = FileService()
    with pytest.raises(PermissionError, match="disabled"):
        service.meta("url", "https://example.com/report.pdf")
    monkeypatch.setenv("JASPER_FILES_ALLOW_URLS", "1")
    with pytest.raises(PermissionError, match="private"):
        service.meta("url", "https://127.0.0.1/report.pdf")
