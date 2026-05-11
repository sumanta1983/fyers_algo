"""Engine config — env loading and constants."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# python_engine/engine/config.py → fyers_algo/
PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


REDIS = {
    "host": os.environ.get("REDIS_HOST", "localhost"),
    "port": int(os.environ.get("REDIS_PORT", "6379")),
    "db": int(os.environ.get("REDIS_DB", "0")),
    "password": os.environ.get("REDIS_PASSWORD") or None,
}

POSTGRES = {
    "host": os.environ.get("POSTGRES_HOST", "localhost"),
    "port": int(os.environ.get("POSTGRES_PORT", "5432")),
    "user": os.environ.get("POSTGRES_USER", "postgres"),
    "password": os.environ.get("POSTGRES_PASSWORD", "postgres"),
    "dbname": os.environ.get("POSTGRES_DB", "fyers_algo"),
}

# Pub/sub channels (must match node_backend's publishers).
CANDLE_PATTERN = "candle.closed.*"
STRATEGY_CHANGED = "strategy.changed"

def signal_channel(symbol: str) -> str:
    return f"signal.{symbol}"


IST = "Asia/Kolkata"
