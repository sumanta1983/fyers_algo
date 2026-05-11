# Local staging — validate the cloud setup before pushing to a droplet

Purpose: prove that the **production build** of the dashboard works, that
**Caddy reverse-proxies correctly** (including the WebSocket upgrade), and
that **basic auth is enforced** — all on your laptop, before you provision
the droplet. systemd is not exercised locally; the unit files are trivial
wrappers and the risk lives in Caddy + production builds.

## Prerequisites

- Local Postgres + Redis already running (you have this).
- Project venv + `npm install` already done in `node_backend/` and `next_frontend/` (you have this).
- A Fyers token in Redis (you have this).
- `caddy` installed. On Ubuntu 24.04:
  ```bash
  sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt update && sudo apt -y install caddy
  ```
  Then disable the always-on systemd service (we'll run Caddy ad-hoc):
  ```bash
  sudo systemctl disable --now caddy
  ```

## One-time prep

### 1. Production build the dashboard

```bash
cd next_frontend
npm run build
cd ..
```
This catches issues `npm run dev` hides — TS errors at build time, env-var
mistakes, missing deps in the production tree.

### 2. Tell the frontend where the API lives

Create `next_frontend/.env.local` so the production build hits Caddy at
`api.localhost` instead of `localhost:4000`:
```bash
echo "NEXT_PUBLIC_API_BASE=https://api.localhost" > next_frontend/.env.local
# Then re-build so the env baking takes effect:
( cd next_frontend && npm run build )
```
(Public env vars in Next are baked at build time — every change requires a rebuild.)

### 3. Update CORS for the staging origin

The Node backend allows the origin in `DASHBOARD_ORIGIN`. Add to `.env`:
```
DASHBOARD_ORIGIN=https://dashboard.localhost
```
(Or comma-separate to keep both: `DASHBOARD_ORIGIN=http://localhost:3000,https://dashboard.localhost`)

### 4. Generate a basic-auth hash for staging

```bash
caddy hash-password
# Enter a throwaway password twice → it prints $2a$14$...
```
Paste the hash into both blocks of `deploy/Caddyfile.local`, replacing the
`REPLACE_WITH_...` placeholder.

### 5. (Optional, recommended) Install Caddy's local CA

So the browser doesn't warn about the self-signed cert on `*.localhost`:
```bash
sudo caddy trust
```
You can skip this and click through the browser warning, but you'll lose
the lock icon and some WebSocket clients fail on bad certs.

## Run staging

Four terminals (same as your usual dev flow, with `next dev` swapped for
`next start`, plus Caddy on top):

**Terminal A — Node backend** (unchanged)
```bash
cd node_backend && node src/index.js
```

**Terminal B — Python engine** (unchanged)
```bash
source .venv/bin/activate && cd python_engine && python -m engine.main
```

**Terminal C — Next.js in production mode**
```bash
cd next_frontend && npm run start
# Now serving from .next/ (production build), NOT next dev
```

**Terminal D — Caddy**
```bash
sudo caddy run --config deploy/Caddyfile.local --adapter caddyfile
# `sudo` because Caddy binds 443. Or grant the cap once:
#   sudo setcap 'cap_net_bind_service=+ep' $(which caddy)
# Then run without sudo.
```

## Verify

```bash
# Basic auth + TLS termination
curl -u algo:<your-staging-password> https://api.localhost/health
# → {"status":"ok"}

# Basic auth required
curl -i https://api.localhost/health
# → HTTP/2 401

# Browser
xdg-open https://dashboard.localhost
# Log in with algo / <staging-password>. Dashboard loads.
# Live signals card shows "open" status (WS upgrade through Caddy works).
```

Synthetic-signal smoke test:
```bash
redis-cli -p 6380 -a "$REDIS_PASSWORD" PUBLISH signal.NSE:RELIANCE-EQ \
  '{"symbol":"NSE:RELIANCE-EQ","side":"BUY","price":2904.5,"candle_ts":"2026-05-11T10:23:00+05:30","strategy":"ema_crossover","reason":{}}'
# → appears in the dashboard "Live signals" card within ~1s
```

If all four checks pass, your cloud deploy will work too — only differences
from there:
- `local_certs` → automatic Let's Encrypt (Caddy handles this when you remove the `local_certs` line)
- `dashboard.localhost` / `api.localhost` → real subdomains
- Manual `caddy run` → `systemctl enable --now caddy`
- Manual three terminals → three `fyers-*.service` systemd units
- Local Redis on port 6380 → cloud Redis on default 6379 (update `.env`)

## Clean up after staging

```bash
# Stop Caddy (Ctrl+C in its terminal), then:
sudo caddy untrust   # remove the local CA from your trust store
rm next_frontend/.env.local    # if you don't want the staging API base sticky
# Revert DASHBOARD_ORIGIN in .env if you added it
```

The production build in `next_frontend/.next/` is harmless to leave around —
`npm run dev` ignores it.
