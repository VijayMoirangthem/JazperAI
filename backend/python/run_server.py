"""Launch the API. On Windows the selector event loop is required by psycopg3 async (LangGraph Postgres checkpointer),
and uvicorn only selects it with --reload; this launcher makes it explicit for every mode.
Usage: python run_server.py [--port 8000] [--reload]"""
import argparse
import asyncio
import sys

import uvicorn

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--reload", action="store_true")
    a = ap.parse_args()
    uvicorn.run("main:app", host="127.0.0.1", port=a.port, reload=a.reload, loop="asyncio")
