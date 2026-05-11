"""Persist Fyers tokens to Redis (with TTL) and a JSON backup file.

Both node_backend and python_engine read the access_token from Redis under
`token:fyers:access`. The JSON backup at `app_token/token.json` lets us
re-hydrate Redis if the cache is wiped while the token is still valid.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import redis
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

load_dotenv(PROJECT_ROOT / ".env")

BACKUP_FILE = PROJECT_ROOT / "app_token" / "token.json"

# Redis schema (see plan/plan_phase_1.md).
ACCESS_KEY = "token:fyers:access"
REFRESH_KEY = "token:fyers:refresh"
CLIENT_KEY = "token:fyers:client_id"

# Fyers access tokens expire daily (≈06:00 IST). 23h gives a safety margin.
ACCESS_TTL_SECONDS = 23 * 60 * 60
# Fyers refresh tokens last ~15 days; expire ours one day earlier.
REFRESH_TTL_SECONDS = 14 * 24 * 60 * 60


@dataclass(frozen=True)
class TokenBundle:
    access_token: str
    refresh_token: Optional[str]
    client_id: str
    generated_at: str  # ISO-8601 with offset


def _redis_client() -> redis.Redis:
    return redis.Redis(
        host=os.environ.get("REDIS_HOST", "localhost"),
        port=int(os.environ.get("REDIS_PORT", "6379")),
        db=int(os.environ.get("REDIS_DB", "0")),
        password=os.environ.get("REDIS_PASSWORD") or None,
        decode_responses=True,
    )


def save_tokens(
    access_token: str,
    refresh_token: Optional[str],
    client_id: str,
) -> TokenBundle:
    bundle = TokenBundle(
        access_token=access_token,
        refresh_token=refresh_token,
        client_id=client_id,
        generated_at=datetime.now(timezone.utc).astimezone().isoformat(),
    )

    r = _redis_client()
    pipe = r.pipeline()
    pipe.set(ACCESS_KEY, access_token, ex=ACCESS_TTL_SECONDS)
    if refresh_token:
        pipe.set(REFRESH_KEY, refresh_token, ex=REFRESH_TTL_SECONDS)
    pipe.set(CLIENT_KEY, client_id)
    pipe.execute()

    BACKUP_FILE.parent.mkdir(parents=True, exist_ok=True)
    BACKUP_FILE.write_text(json.dumps(asdict(bundle), indent=2))
    return bundle


def get_access_token() -> Optional[str]:
    return _redis_client().get(ACCESS_KEY)


def get_refresh_token() -> Optional[str]:
    return _redis_client().get(REFRESH_KEY)


def get_client_id() -> Optional[str]:
    val = _redis_client().get(CLIENT_KEY)
    return val or os.environ.get("FYERS_CLIENT_ID")


def load_from_backup() -> Optional[TokenBundle]:
    if not BACKUP_FILE.exists():
        return None
    return TokenBundle(**json.loads(BACKUP_FILE.read_text()))
