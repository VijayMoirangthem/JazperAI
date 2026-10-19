"""One MCP stdio connection, owned by a dedicated thread with its own event loop.

Why a thread: the API runs on the selector loop (required by psycopg3 async on Windows), and Windows subprocesses need the
Proactor loop. Isolating each connector keeps both working. Calls cross over with run_coroutine_threadsafe.
"""
import asyncio
import os
import sys
import threading
from concurrent.futures import TimeoutError as FutureTimeout

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class ConnectionError_(RuntimeError):
    pass


class Connection:
    def __init__(self, cid: str, command: list[str], env: dict[str, str] | None = None):
        self.cid, self.command, self.env = cid, command, env or {}
        self.tools: list[dict] = []
        self.error: str | None = None
        self._ready = threading.Event()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop: asyncio.Event | None = None
        self._session: ClientSession | None = None

    def start(self, timeout: float = 30) -> None:
        self._thread = threading.Thread(target=self._main, name=f"mcp-{self.cid}", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout) or self.error:
            raise ConnectionError_(self.error or "connector start timed out")

    def _main(self) -> None:
        loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._serve())
        except Exception as e:
            self.error = f"{type(e).__name__}: {str(e)[:160]}"
        finally:
            self._ready.set()
            loop.close()

    async def _serve(self) -> None:
        self._stop = asyncio.Event()
        params = StdioServerParameters(command=self.command[0], args=self.command[1:], env={**os.environ, **self.env})
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as session:
                await session.initialize()
                self._session = session
                self.tools = [{"name": t.name, "description": t.description or "", "schema": t.inputSchema,
                               "read_only": bool(getattr(getattr(t, "annotations", None), "readOnlyHint", False))} for t in (await session.list_tools()).tools]
                self._ready.set()
                await self._stop.wait()

    @property
    def alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive() and not self.error and self._session is not None)

    def call(self, name: str, args: dict, timeout: float = 60) -> dict:
        if not self.alive or self._loop is None or self._session is None:
            raise ConnectionError_("connector is not running")
        fut = asyncio.run_coroutine_threadsafe(self._session.call_tool(name, args), self._loop)
        try:
            res = fut.result(timeout)
        except FutureTimeout as e:
            fut.cancel()
            self.error = "call timed out (connector degraded)"
            raise ConnectionError_(self.error) from e
        except Exception as e:
            self.error = f"{type(e).__name__}: {str(e)[:120]}"
            raise ConnectionError_(self.error) from e
        text = "".join(getattr(c, "text", "") for c in res.content)
        return {"is_error": bool(res.isError), "text": text}

    def stop(self) -> None:
        if self._loop and self._stop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._stop.set)
        if self._thread:
            self._thread.join(timeout=5)
