# Lighter memory model (plan item 1.4)

**Status: evaluation tooling is built; NO migration has been applied.** The decision to switch needs data from your own memories, which needs a
database and about 3 GB of free RAM (not available during the implementation-only phase).

## Why
`BAAI/bge-m3` (about 2 GB in RAM, ~25 s to load cold) is excellent and multilingual, but it is the reason memory recall is skipped whenever the PC is
short of RAM (chat no longer waits for it: see `docs/PERFORMANCE.md`). A model of about 0.5 GB would let recall work on this PC all the time.

## Step 1: measure (read-only, safe)
    cd backend\python
    ..\.venv\Scripts\python.exe ..\..\scripts\memory_model_eval.py --yes

Compares `intfloat/multilingual-e5-small` and `paraphrase-multilingual-MiniLM-L12-v2` (both 384-dimensional, both handle Hindi) with bge-m3 on your real
memories: neighbour overlap, "finds a memory from its own first words", load time, RAM, speed, and the similarity thresholds that suit each candidate.
It writes only a report in `storage/eval/`. Logic is unit-tested in `tests/test_memory_eval.py`.

## Step 2: decide
The script's verdict says "good enough" only if overlap with bge-m3 is at least 60% and the candidate finds a memory from its own words at least 90% of the
time (and not noticeably worse than bge-m3). Also try the Hindi/Hinglish examples you care about by hand.

## Step 3: migrate (NOT done; do it only after Step 2, with a backup)
The vectors are `vector(1024)` in `shared.memory_chunks.embedding`; a 384-dimensional model needs a new column. The safe sequence:
1. `ALTER TABLE shared.memory_chunks ADD COLUMN embedding_v2 vector(384)` (nullable) and an HNSW/IVFFlat index on it.
2. Back up the database (`scripts/backup.ps1`).
3. Backfill `embedding_v2` by re-embedding every chunk's `content` with the new model, in batches, resumable (skip rows that already have it).
4. Add a setting `MEMORY_EMBED_MODEL` (default: current) read by `embedding_service.embed_memory` and `memory.consolidate.similar/store`, choosing the column and model.
   Store BOTH columns for new memories until the switch is final.
5. Replace `RELATED_SIM`, `DUPLICATE_SIM` and the recall floor with the thresholds the script suggested for the new model (the current values are tuned for bge-m3's scale
   and would be wrong: e5-style models score unrelated text around 0.7-0.8).
6. Run the quality test set (`docs/EVALUATION.md`) before and after; keep the old column for a week; then drop it.
Rollback = set `MEMORY_EMBED_MODEL` back (the old column is untouched until the end).

## What is deliberately not automated
Steps 3-6 change stored data and thresholds that affect what Jasper remembers; they are written down rather than coded until the numbers from Step 1 exist.
