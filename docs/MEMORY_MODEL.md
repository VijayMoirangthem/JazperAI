# Memory embeddings: cloud only (replaces the "lighter local model" plan)

**Decision (2026-11-15): no AI model runs on this PC.** Memory embeddings now come from a cloud API. The code is done; it is **switched off until you
choose a provider and the memories are re-embedded**, because vectors from different models cannot be compared (mixing them would silently return wrong memories).

## What changed
| Was local | Now |
|---|---|
| bge-m3 (about 2 GB) for memory | cloud embeddings API (`core/services/embedding_service.py`) |
| MiniLM for the code index | same API, 384-dimensional |
| faster-whisper fallback for voice notes | removed: cloud Whisper (Groq) with one retry, else a clear "unavailable" message |
| LM Studio fallback when providers are rate-limited | removed (`LOCAL_FALLBACK_ENABLED=False`); fallback is another cloud model |
| presidio/spaCy PII model | removed: regex redaction only (email, phone, IP, IBAN, UPI) |
| `faster-whisper`, `sentence-transformers` (torch) in requirements | removed |
Guard test: `tests/test_cloud_only.py` fails if any module imports a local-model library or a requirement brings one back.
Left alone on purpose: the LM Studio *management* route/panel (`api/routes/models.py`): it only talks to LM Studio if you start it yourself.
You can also delete the cached models on disk (about 8 GB: `%USERPROFILE%\.cache\huggingface\hub`); I did not delete anything.

## What you need to choose (needs YOUR key; a paid tier needs your approval)
Any provider with an **OpenAI-compatible `/embeddings` endpoint** that accepts a `dimensions` parameter and handles **Hindi**. Candidates (check current free-tier
limits and prices yourself; I cannot verify them from here):
| Provider | Endpoint (base URL) | Note |
|---|---|---|
| Jina AI (`jina-embeddings-v3`) | `https://api.jina.ai/v1` | multilingual, free allowance on signup |
| Google Gemini (`gemini-embedding-001`) | `https://generativelanguage.googleapis.com/v1beta/openai` | free tier, you already use Google |
| OpenAI (`text-embedding-3-small`) | `https://api.openai.com/v1` | paid, very cheap per million tokens |
| Voyage (`voyage-3`) | `https://api.voyageai.com/v1` | multilingual, free allowance |
Privacy: the (PII-sanitised) text of your memories is sent to that provider. Groq does not offer embeddings.

## Switch on (in this order)
1. Put the key in the vault: Settings > Secrets, name **`EMBEDDING_API_KEY`** (or env `EMBEDDING_API_KEY`).
2. In `backend/python/.env`: `EMBEDDING_BASE_URL=...` and `EMBEDDING_MODEL=...` (from the table), restart the backend.
3. **Check quality first (read-only, a few thousand tokens):**
       cd backend\python
       ..\.venv\Scripts\python.exe ..\..\scripts\memory_model_eval.py --yes
   It compares the cloud model with your stored memories: neighbour overlap, finds-a-memory-from-its-own-words, and the similarity thresholds that suit that model.
4. If it says GOOD ENOUGH: **back up** (`scripts\backup.ps1`), then
       ..\.venv\Scripts\python.exe ..\..\scripts\memory_reembed.py                 (dry run: counts + cost)
       ..\.venv\Scripts\python.exe ..\..\scripts\memory_reembed.py --apply --yes   (resumable; fills a new column)
       ..\.venv\Scripts\python.exe ..\..\scripts\memory_reembed.py --swap --yes    (one transaction; turns memory recall ON)
5. Recalibrate the thresholds from step 3 in `memory/consolidate.py` (`RELATED_SIM`, `DUPLICATE_SIM`) and the recall floor (0.5 in `recall`/`recall_multi`): they were tuned
   for bge-m3's score scale and are wrong for other models.
6. Run the quality test set (`docs/EVALUATION.md`) before and after.
Changing the provider or model later invalidates the memories again (recall switches itself off until you re-run step 4).

## Until then
Chat works normally, only without recalled memories (it already skips recall instead of waiting). **System health** shows "Memory (embeddings): not configured: memory recall is off".
**Not run live yet:** the SQL in `memory_reembed.py` and both scripts (they need the database and a key); the cloud client itself is unit-tested against a fake server.
