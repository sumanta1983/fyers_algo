"""Unit tests for the EMA crossover strategy. Pure pandas — no DB / Redis."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from engine.strategies.ema_crossover import EmaCrossover

IST = ZoneInfo("Asia/Kolkata")


def _make_df(closes: list[float], start: datetime) -> pd.DataFrame:
    n = len(closes)
    idx = pd.date_range(start, periods=n, freq="1min", tz=IST)
    return pd.DataFrame(
        {
            "open": closes,
            "high": [c + 0.5 for c in closes],
            "low": [c - 0.5 for c in closes],
            "close": closes,
            "volume": [1000] * n,
        },
        index=idx,
    )


def test_buy_signal_on_upward_crossover():
    # 25 flat bars at 100, then a sharp jump to 200.
    # ema9 reacts faster than ema21 → ema9 crosses above ema21 on the jump.
    closes = [100.0] * 25 + [200.0]
    df = _make_df(closes, datetime(2026, 5, 8, 10, 0, tzinfo=IST))

    signal = EmaCrossover().evaluate("NSE:TEST-EQ", df)

    assert signal is not None
    assert signal.side == "BUY"
    assert signal.symbol == "NSE:TEST-EQ"
    assert signal.price == 200.0


def test_sell_signal_on_downward_crossover():
    # 25 flat bars at 200, then sharp drop to 100 — ema9 crosses below ema21.
    closes = [200.0] * 25 + [100.0]
    df = _make_df(closes, datetime(2026, 5, 8, 10, 0, tzinfo=IST))

    signal = EmaCrossover().evaluate("NSE:TEST-EQ", df)

    assert signal is not None
    assert signal.side == "SELL"


def test_no_signal_before_no_trade_window():
    # 08:30 IST start → final bar lands at ~08:55, before NO_TRADE_BEFORE (09:20).
    closes = [100.0] * 25 + [200.0]
    df = _make_df(closes, datetime(2026, 5, 8, 8, 30, tzinfo=IST))

    assert EmaCrossover().evaluate("NSE:TEST-EQ", df) is None


def test_no_signal_after_squareoff_buffer():
    # 15:00 IST start → final bar lands at ~15:25, past NO_TRADE_AFTER (15:15).
    closes = [100.0] * 25 + [200.0]
    df = _make_df(closes, datetime(2026, 5, 8, 15, 0, tzinfo=IST))

    assert EmaCrossover().evaluate("NSE:TEST-EQ", df) is None


def test_no_signal_when_too_few_candles():
    closes = [100.0] * 5
    df = _make_df(closes, datetime(2026, 5, 8, 10, 0, tzinfo=IST))

    assert EmaCrossover().evaluate("NSE:TEST-EQ", df) is None


def test_no_signal_on_flat_series():
    closes = [100.0] * 30
    df = _make_df(closes, datetime(2026, 5, 8, 10, 0, tzinfo=IST))

    assert EmaCrossover().evaluate("NSE:TEST-EQ", df) is None
