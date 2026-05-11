"""Strategy ABC + Signal dataclass — the contract for all strategy modules."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import ClassVar, Literal, Optional

import pandas as pd


@dataclass(frozen=True)
class Signal:
    symbol: str
    side: Literal["BUY", "SELL"]
    price: float
    candle_ts: datetime  # tz-aware, IST
    strategy: str
    reason: dict = field(default_factory=dict)


class Strategy(ABC):
    name: ClassVar[str]
    lookback: ClassVar[int]

    @abstractmethod
    def evaluate(self, symbol: str, df: pd.DataFrame) -> Optional[Signal]:
        """Return a Signal if the strategy fires on the last row of df, else None.

        df is sorted ascending by ts (tz-aware, IST), with columns
        open / high / low / close / volume. The last row is the most recently
        closed 1-min candle. Strategies must not mutate df in place.
        """
