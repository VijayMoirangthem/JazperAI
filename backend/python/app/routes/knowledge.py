"""Phase 11B — Knowledge base CRUD + RAG search endpoints."""
import io
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from app.services.knowledge_service import ingest, ingest_url, search, get_all, delete_item

router = APIRouter()


class PasteRequest(BaseModel):
    title: str
    content: str
    tags: list[str] = []


class URLRequest(BaseModel):
    url: str


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


@router.get("")
def list_items(limit: int = 50):
    return {"items": get_all(limit)}


@router.post("/paste")
def add_paste(body: PasteRequest):
    if not body.content.strip():
        raise HTTPException(400, "Content is empty")
    result = ingest(body.title, body.content, source_type="paste", tags=body.tags)
    return result


@router.post("/url")
def add_url(body: URLRequest):
    try:
        result = ingest_url(body.url)
        return result
    except Exception as e:
        raise HTTPException(422, str(e))


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    filename = file.filename or "document"
    content_bytes = await file.read()

    if filename.lower().endswith(".pdf"):
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content_bytes))
            parts = [p.extract_text() for p in reader.pages if p.extract_text()]
            text = "\n".join(parts).strip()
        except Exception as e:
            raise HTTPException(422, f"PDF parse error: {e}")
    else:
        text = content_bytes.decode("utf-8", errors="replace").strip()

    if not text:
        raise HTTPException(422, "Could not extract text from file")

    result = ingest(filename, text, source_type="file", source_file=filename)
    return result


@router.post("/search")
def search_knowledge(body: SearchRequest):
    results = search(body.query, body.top_k)
    return {"results": results}


@router.delete("/{item_id}")
def remove_item(item_id: str):
    delete_item(item_id)
    return {"ok": True}
