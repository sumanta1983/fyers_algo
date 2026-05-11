"""9 / 21 EMA crossover on 1-min close — v1 strategy."""
from __future__ import annotations

from datetime import time
from typing import Optional

import pandas as pd

from engine.indicators.ema import ema
from engine.strategies.base import Signal, Strategy

# Skip the first 5 minutes of the session (opening volatility) and the last
# 15 minutes before close (intraday squareoff buffer — no fresh entries).
NO_TRADE_BEFORE = time(9, 20)
NO_TRADE_AFTER = time(15, 15)


class EmaCrossover(Strategy):
    name = "ema_crossover"
    lookback = 30

    FAST = 9
    SLOW = 21

    def evaluate(self, symbol: str, df: pd.DataFrame) -> Optional[Signal]:
        # Need one bar before the current to detect a crossover edge.
        if len(df) < self.SLOW + 1:
            return None

        last_ts = df.index[-1]
        local_t = last_ts.time()
        if local_t < NO_TRADE_BEFORE or local_t >= NO_TRADE_AFTER:
            return None

        close = df["close"]
        ema_fast = ema(close, self.FAST)
        ema_slow = ema(close, self.SLOW)

        prev_fast, prev_slow = float(ema_fast.iloc[-2]), float(ema_slow.iloc[-2])
        cur_fast, cur_slow = float(ema_fast.iloc[-1]), float(ema_slow.iloc[-1])

        if prev_fast <= prev_slow and cur_fast > cur_slow:
            side = "BUY"
        elif prev_fast >= prev_slow and cur_fast < cur_slow:
            side = "SELL"
        else:
            return None

        return Signal(
            symbol=symbol,
            side=side,
            price=float(close.iloc[-1]),
            candle_ts=last_ts.to_pydatetime(),
            strategy=self.name,
            reason={
                "ema_fast": cur_fast,
                "ema_slow": cur_slow,
                "prev_ema_fast": prev_fast,
                "prev_ema_slow": prev_slow,
                "fast_period": self.FAST,
                "slow_period": self.SLOW,
            },
        )
