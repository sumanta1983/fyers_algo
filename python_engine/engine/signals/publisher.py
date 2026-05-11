"""Persist a Signal to Postgres (idempotent) and publish it on Redis."""
from __future__ import annotations

import json

import redis.asyncio as aioredis
from psycopg.types.json import Json

from engine.config import signal_channel
from engine.data.store import pg_pool
from engine.strategies.base import Signal


async def emit(signal: Signal, redis: aioredis.Redis) -> bool:
    """Insert + publish. Returns True if a new row was created, False on conflict."""
    pool = await pg_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO signals (candle_ts, symbol, strategy, side, price, reason)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (strategy, symbol, candle_ts, side) DO NOTHING
                RETURNING id
                """,
                (
                    signal.candle_ts,
                    signal.symbol,
                    signal.strategy,
                    signal.side,
                    signal.price,
                    Json(signal.reason),
                ),
            )
            row = await cur.fetchone()

    if row is None:
        return False

    payload = json.dumps(
        {
            "symbol": signal.symbol,
            "side": signal.side,
            "price": signal.price,
            "candle_ts": signal.candle_ts.isoformat(),
            "strategy": signal.strategy,
            "reason": signal.reason,
        }
    )
    await redis.publish(signal_channel(signal.symbol), payload)
    return True
