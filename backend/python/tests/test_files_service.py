from pathlib import Path

import pytest

from core.files.service import ATTACHMENTS, FileService, MAX_BYTES


def test_attachment_round_trip_and_normalisation(tmp_path, monkeypatch):
    monkeypatch.setattr("core.files.service.ATTACHMENTS", tmp_path)
    service = FileService()
    ref = service.save_attachment("Quarterly plan!.md", b"# plan", "text/markdown")
    assert ref.src == "attachment"
    assert ref.id.endswith("Quarterly_plan_.md")
    path, mime, again = service.open_path("attachment", ref.id)
    assert path.read_bytes() == b"# plan" and mime == "text/markdown" and again.name == ref.name


def test_attachment_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr("core.files.service.ATTACHMENTS", tmp_path)
    service = FileService()
    with pytest.raises(FileNotFoundError):
        service.open_path("attachment", "../.env")


def test_attachment_size_cap(tmp_path, monkeypatch):
    monkeypatch.setattr("core.files.service.ATTACHMENTS", tmp_path)
    service = FileService()
    with pytest.raises(OverflowError):
        service.save_attachment("large.bin", b"x" * (MAX_BYTES + 1))


def test_capabilities_always_offer_safe_remedies():
    tools = FileService().capabilities()["tools"]
    assert set(tools) == {"libreoffice", "ffmpeg", "7zip"}
    assert all(item["install"].startswith("winget install ") for item in tools.values())
