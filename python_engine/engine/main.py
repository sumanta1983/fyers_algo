"""Engine entry point.

Subscribes to Redis `candle.closed.*`, runs the active strategy on each
just-closed candle, persists+publishes signals.

Run from project root:
    cd python_engine && python -m engine.main
"""
from __future__ import annotations

import asyncio
import json
import logging
import signal as os_signal
import sys
from datetime import datetime, timezone

from engine.config import CANDLE_PATTERN, STRATEGY_CHANGED
from engine.data.candle_loader import load_lookback
from engine.data.store import close as close_store, make_redis, pg_pool
from engine.signals.publisher import emit as emit_signal
from engine.strategies import registry
from engine.strategies.base import Strategy

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
log = logging.getLogger("engine")

QUEUE_MAX = 1000
GET_MESSAGE_TIMEOUT = 1.0


async def get_active_strategy_name() -> str:
    pool = await pg_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT active_strategy FROM strategy_state WHERE id = 1")
            row = await cur.fetchone()
    if not row:
        raise RuntimeError(
            "strategy_state row missing — did node_backend/migrations/001_init.sql run?"
        )
    return row[0]


class Engine:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=QUEUE_MAX)
        self.strategy: Strategy | None = None
        self.redis_pub = make_redis()
        self.redis_sub = make_redis()
        self.shutdown = asyncio.Event()

    async def load_strategy(self) -> None:
        name = await get_active_strategy_name()
        self.strategy = registry.get(name)
        log.info("active strategy: %s (lookback=%d)", self.strategy.name, self.strategy.lookback)

    async def subscribe_loop(self) -> None:
        pubsub = self.redis_sub.pubsub()
        await pubsub.psubscribe(CANDLE_PATTERN)
        await pubsub.subscribe(STRATEGY_CHANGED)
        log.info("subscribed: %s + %s", CANDLE_PATTERN, STRATEGY_CHANGED)
        try:
            while not self.shutdown.is_set():
                msg = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=GET_MESSAGE_TIMEOUT,
                )
                if msg is None:
                    continue
                mtype = msg.get("type")

                if mtype == "message" and msg.get("channel") == STRATEGY_CHANGED:
                    log.info("strategy.changed received")
                    try:
                        await self.load_strategy()
                    except Exception:
                        log.exception("failed to reload strategy")
                    continue

                if mtype == "pmessage":
                    try:
                        payload = json.loads(msg["data"])
                    except (TypeError, ValueError):
                        log.warning("bad candle payload: %r", msg.get("data"))
                        continue
                    try:
                        self.queue.put_nowait(payload)
                    except asyncio.QueueFull:
                        log.error("eval queue full; dropping %s", payload.get("symbol"))
        finally:
            try:
                await pubsub.punsubscribe()
                await pubsub.unsubscribe()
            except Exception:
                pass
            await pubsub.aclose()

    async def worker_loop(self) -> None:
        while not self.shutdown.is_set():
            try:
                payload = await asyncio.wait_for(self.queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            try:
                await self.evaluate(payload)
            except Exception:
                log.exception("evaluation failed for %r", payload)

    async def evaluate(self, payload: dict) -> None:
        if self.strategy is None:
            log.warning("no active strategy loaded; skipping evaluation")
            return
        symbol = payload.get("symbol")
        ts_epoch = payload.get("ts")
        if not symbol or ts_epoch is None:
            log.warning("malformed candle payload: %r", payload)
            return

        # node_backend publishes ts as unix seconds (UTC-equivalent).
        end_ts = datetime.fromtimestamp(ts_epoch, tz=timezone.utc)

        df = await load_lookback(symbol, self.strategy.lookback, end_ts)
        if df.empty:
            log.debug("no candles in window for %s", symbol)
            return

        result = self.strategy.evaluate(symbol, df)
        if result is None:
            log.debug("evaluated %s on %s -> None", self.strategy.name, symbol)
            return

        inserted = await emit_signal(result, self.redis_pub)
        if inserted:
            log.info(
                "SIGNAL %s %s @ %.2f (%s @ %s)",
                result.side,
                symbol,
                result.price,
                self.strategy.name,
                result.candle_ts.isoformat(),
            )
        else:
            log.debug(
                "duplicate signal skipped: %s %s @ %s",
                result.side,
                symbol,
                result.candle_ts,
            )

    async def run(self) -> None:
        await self.load_strategy()
        sub_task = asyncio.create_task(self.subscribe_loop(), name="subscribe_loop")
        wrk_task = asyncio.create_task(self.worker_loop(), name="worker_loop")
        try:
            await self.shutdown.wait()
        finally:
            log.info("shutting down")
            sub_task.cancel()
            wrk_task.cancel()
            await asyncio.gather(sub_task, wrk_task, return_exceptions=True)
            await self.redis_pub.aclose()
            await self.redis_sub.aclose()
            await close_store()


async def _main_async() -> None:
    engine = Engine()
    loop = asyncio.get_running_loop()
    for sig in (os_signal.SIGINT, os_signal.SIGTERM):
        loop.add_signal_handler(sig, engine.shutdown.set)
    await engine.run()


def main() -> int:
    try:
        asyncio.run(_main_async())
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
