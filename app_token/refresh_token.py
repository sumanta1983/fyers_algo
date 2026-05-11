"""Refresh-token flow is DISCONTINUED.

Per Fyers (see fyers_api_docs/token_ttl_and_refresh.txt):

    "Refresh token will be discontinued from 1st April."

Today's date is past that cutoff, so there is no working unattended-refresh
path. Re-auth daily via `python -m app_token.generate_token`.

This module is kept as a clear no-op so that any cron job pointing at it
fails loudly instead of silently doing nothing.
"""
from __future__ import annotations

import sys


def main() -> int:
    print(
        "Fyers refresh-token endpoint is discontinued (see "
        "fyers_api_docs/token_ttl_and_refresh.txt).\n"
        "Run:  python -m app_token.generate_token\n"
        "to re-auth manually each day.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
