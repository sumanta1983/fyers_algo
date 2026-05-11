"""Strategy name → class registry. Add new strategies here."""
from __future__ import annotations

from typing import Type

from engine.strategies.base import Strategy
from engine.strategies.ema_crossover import EmaCrossover

_REGISTRY: dict[str, Type[Strategy]] = {
    EmaCrossover.name: EmaCrossover,
}


def get(name: str) -> Strategy:
    cls = _REGISTRY.get(name)
    if cls is None:
        raise KeyError(f"Unknown strategy: {name!r}. Known: {sorted(_REGISTRY)}")
    return cls()


def names() -> list[str]:
    return sorted(_REGISTRY)
