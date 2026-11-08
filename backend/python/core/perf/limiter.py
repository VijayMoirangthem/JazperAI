"""A resizable async concurrency limiter (a semaphore whose limit can change while running) with live statistics.

Used to cap simultaneous agent calls and background jobs. Safe across threads/event loops: bookkeeping is guarded by a lock
and each waiter is woken on the loop that created it. Cancellation never leaks a slot.
"""
from __future__ import annotations

import asyncio
import threading
from collections import deque
from contextlib import asynccontextmanager


class ResizableLimiter:
    def __init__(self, name: str, limit: int):
        self.name = name
        self._limit = max(1, int(limit))
        self._running = 0
        self._waiters: deque[tuple[asyncio.Future, asyncio.AbstractEventLoop]] = deque()
        self._lk = threading.Lock()
        self.peak = 0
        self.completed = 0

    # --- sizing ---
    @property
    def limit(self) -> int:
        return self._limit

    def set_limit(self, n: int) -> None:
        with self._lk:
            self._limit = max(1, int(n))
        self._wake()

    # --- stats ---
    @property
    def running(self) -> int:
        return self._running

    @property
    def waiting(self) -> int:
        with self._lk:
            return sum(1 for f, _ in self._waiters if not f.done())

    def stats(self) -> dict:
        return {"name": self.name, "limit": self._limit, "running": self._running, "waiting": self.waiting,
                "peak": self.peak, "completed": self.completed}

    # --- internals ---
    def _wake(self) -> None:
        with self._lk:
            n = max(0, self._limit - self._running)
            woken = []
            while n > 0 and self._waiters:
                fut, loop = self._waiters.popleft()
                if not fut.done():
                    woken.append((fut, loop))
                    n -= 1
        for fut, loop in woken:
            loop.call_soon_threadsafe(lambda f=fut: f.done() or f.set_result(None))

    async def _acquire(self) -> None:
        while True:
            with self._lk:
                if self._running < self._limit:
                    self._running += 1
                    self.peak = max(self.peak, self._running)
                    return
                loop = asyncio.get_running_loop()
                fut = loop.create_future()
                self._waiters.append((fut, loop))
            try:
                await fut
            except asyncio.CancelledError:
                with self._lk:
                    try:
                        self._waiters.remove((fut, loop))
                    except ValueError:
                        pass
                self._wake()  # we may have been the one that was just woken; pass the slot on
                raise

    def _release(self) -> None:
        with self._lk:
            self._running = max(0, self._running - 1)
            self.completed += 1
        self._wake()

    @asynccontextmanager
    async def slot(self):
        await self._acquire()
        try:
            yield
        finally:
            self._release()


# Process-wide limiters, sized from PerfSettings by core.perf.runtime.apply().
agent_tasks = ResizableLimiter("agent_tasks", 3)
background_jobs = ResizableLimiter("background_jobs", 2)
