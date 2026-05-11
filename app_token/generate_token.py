"""Interactive Fyers OAuth — opens the login page, prompts for the auth_code,
exchanges it for {access_token, refresh_token}, and persists both to Redis
(+ a JSON backup file).

Adapted from temp_data/Authentication.py. Run from the project root:

    python -m app_token.generate_token
    # or
    python app_token/generate_token.py

The auth_code is extracted from the redirect URL after login, e.g.:
    https://trade.fyers.in/api-login/redirect-uri/index.html?s=ok&code=200&auth_code=eyJ0...
"""
from __future__ import annotations

import os
import sys
import webbrowser
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

load_dotenv(PROJECT_ROOT / ".env")

# Imported after sys.path tweak so `python app_token/generate_token.py` works.
from fyers_apiv3 import fyersModel  # noqa: E402

from app_token.token_store import save_tokens  # noqa: E402


def main() -> int:
    client_id = os.environ.get("FYERS_CLIENT_ID")
    secret_key = os.environ.get("FYERS_SECRET_KEY")
    redirect_uri = os.environ.get("FYERS_REDIRECT_URL")
    response_type = os.environ.get("FYERS_RESPONSE_TYPE", "code")
    grant_type = os.environ.get("FYERS_GRANT_TYPE", "authorization_code")

    missing = [
        name
        for name, val in {
            "FYERS_CLIENT_ID": client_id,
            "FYERS_SECRET_KEY": secret_key,
            "FYERS_REDIRECT_URL": redirect_uri,
        }.items()
        if not val
    ]
    if missing:
        print(f"Missing env vars: {', '.join(missing)}. Check .env.", file=sys.stderr)
        return 2

    session = fyersModel.SessionModel(
        client_id=client_id,
        secret_key=secret_key,
        redirect_uri=redirect_uri,
        response_type=response_type,
        grant_type=grant_type,
    )

    auth_url = session.generate_authcode()
    print("Opening Fyers login in your default browser...")
    print(f"If it doesn't open, visit:\n  {auth_url}\n")
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass  # headless environments — user can still copy the URL

    auth_code = input("Paste auth_code from the redirect URL: ").strip()
    if not auth_code:
        print("Empty auth_code; aborting.", file=sys.stderr)
        return 1

    session.set_token(auth_code)
    response = session.generate_token()

    if not isinstance(response, dict) or "access_token" not in response:
        print("Token exchange failed.", file=sys.stderr)
        print(f"Response: {response}", file=sys.stderr)
        return 1

    bundle = save_tokens(
        access_token=response["access_token"],
        refresh_token=response.get("refresh_token"),
        client_id=client_id,
    )

    print()
    print("Access token saved.")
    print("  Redis: token:fyers:access (TTL 23h), token:fyers:refresh (TTL 14d)")
    print(f"  Backup: app_token/token.json")
    print(f"  Generated: {bundle.generated_at}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
