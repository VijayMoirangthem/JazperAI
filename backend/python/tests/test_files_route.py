from fastapi import FastAPI
import httpx
import pytest
import pytest_asyncio

from api.routes.files import router


def app() -> FastAPI:
    api = FastAPI()
    api.include_router(router, prefix="/api/v1/files")
    return api


@pytest_asyncio.fixture
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url="http://test") as value:
        yield value


async def test_sources_and_capabilities_are_available_without_external_services(client):
    assert (await client.get("/api/v1/files/sources")).status_code == 200
    body = (await client.get("/api/v1/files/capabilities")).json()
    assert body["maxBytes"] == 200 * 1024 * 1024


async def test_attachment_content_honours_range(tmp_path, monkeypatch, client):
    monkeypatch.setattr("core.files.service.ATTACHMENTS", tmp_path)
    from core.files.service import FileService
    service = FileService()
    ref = service.save_attachment("sample.txt", b"abcdef", "text/plain")
    response = await client.get(f"/api/v1/files/content?src=attachment&id={ref.id}", headers={"Range": "bytes=1-3"})
    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 1-3/6"
    assert response.content == b"bcd"


async def test_attachment_traversal_is_not_readable(client):
    response = await client.get("/api/v1/files/content?src=attachment&id=../.env")
    assert response.status_code in {403, 404}
