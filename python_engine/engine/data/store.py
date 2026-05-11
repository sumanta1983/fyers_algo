"""Singleton-ish accessors for the Postgres pool and Redis clients.

The engine needs:
- one async pg pool (used by candle_loader + signals.publisher)
- two redis connections — one for pub/sub (blocks the connection it's on),
  one for publish + general ops. Created on demand by `make_redis()`.
"""
from __future__ import annotations

from typing import Optional

import redis.asyncio as aioredis
from psycopg_pool import AsyncConnectionPool

from engine.config import POSTGRES, REDIS

_pg_pool: Optional[AsyncConnectionPool] = None


def _conninfo() -> str:
    return (
        f"host={POSTGRES['host']} port={POSTGRES['port']} "
        f"user={POSTGRES['user']} password={POSTGRES['password']} "
        f"dbname={POSTGRES['dbname']}"
    )


async def pg_pool() -> AsyncConnectionPool:
    global _pg_pool
    if _pg_pool is None:
        _pg_pool = AsyncConnectionPool(
            _conninfo(),
            min_size=1,
            max_size=4,
            open=False,
        )
        await _pg_pool.open()
    return _pg_pool


def make_redis() -> aioredis.Redis:
    return aioredis.Redis(
        host=REDIS["host"],
        port=REDIS["port"],
        db=REDIS["db"],
        password=REDIS["password"],
        decode_responses=True,
    )


async def close() -> None:
    global _pg_pool
    if _pg_pool is not None:
        await _pg_pool.close()
        _pg_pool = None
