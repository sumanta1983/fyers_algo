"""Load lookback windows of 1-min candles from Postgres into a pandas DataFrame."""
from __future__ import annotations

from datetime import datetime

import pandas as pd

from engine.config import IST
from engine.data.store import pg_pool


async def load_lookback(symbol: str, lookback: int, end_ts: datetime) -> pd.DataFrame:
    """Return up to `lookback` candles for `symbol`, ending at end_ts (inclusive).

    Index: tz-aware ts in IST, ascending.
    Columns: open, high, low, close, volume (float / int64).
    Returns an empty DataFrame with those columns when no rows exist.

    Invariants:
      - Last row's ts equals end_ts when the just-closed candle is in the table.
      - Caller must never receive an in-progress candle: end_ts is the close
        time of a finalised candle (passed in by the engine's evaluator).
    """
    pool = await pg_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT ts, open, high, low, close, volume
                  FROM candles_1m
                 WHERE symbol = %s AND ts <= %s
                 ORDER BY ts DESC
                 LIMIT %s
                """,
                (symbol, end_ts, lookback),
            )
            rows = await cur.fetchall()

    cols = ["open", "high", "low", "close", "volume"]
    if not rows:
        return pd.DataFrame(columns=cols)

    rows.reverse()  # to ascending
    df = pd.DataFrame(rows, columns=["ts", *cols])
    df["ts"] = pd.to_datetime(df["ts"], utc=True).dt.tz_convert(IST)
    df = df.set_index("ts")
    # psycopg returns Decimal for NUMERIC; force native dtypes for downstream math.
    df = df.astype({"open": float, "high": float, "low": float, "close": float, "volume": "int64"})
    return df
