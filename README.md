# fyers_algo

Multi-stock intraday signal engine on Fyers (NSE/BSE).
v1: signals only — no real orders placed. See [plan/plan_phase_1.md](plan/plan_phase_1.md).

## Stack

- **Node.js** — Fyers REST + WebSocket client, tick → Redis, 1-min candle aggregator → Postgres, dashboard backend.
- **Python** — strategy engine (pandas indicators), backtest CLI.
- **Redis** — hot cache (LTP, in-progress candle, access token), pub/sub bus between Node and Python.
- **PostgreSQL** — historical 1-min candles, signals log, strategy state.
- **Next.js** — dashboard (`next_frontend/`).

## Repo layout

```
fyers_algo/
├── app_token/           Python — Fyers OAuth + token refresh
├── node_backend/        Node — broker I/O, ingestion, API
│   └── migrations/      SQL migrations (auto-applied by Postgres on first init)
├── python_engine/       Python — strategy engine + backtest
├── next_frontend/       Next.js dashboard
├── fyers_api_docs/      Extracted Fyers API reference (markdown / screenshots)
├── plan/                Phase plans (plan_phase_1.md is current)
├── temp_data/           Scratch / reference assets
├── .env                 Secrets (gitignored)
├── .env.example         Template — copy to .env and fill in
└── docker-compose.yml   Local Redis + Postgres
```

## Setup (one-time)

1. **Install local tooling:** Docker (with `docker compose`), Node.js 20+, Python 3.11+, `redis-cli` and `psql` clients (optional but useful).
2. **Configure env:**
   ```bash
   cp .env.example .env
   # then edit .env and put your real Fyers CLIENT_ID / SECRET_KEY
   ```
   Use `FOO=bar` syntax — no spaces around `=`, no quotes.
3. **Start infrastructure:**
   ```bash
   docker compose up -d
   docker compose ps          # both services should be "healthy"
   ```
   First boot of the postgres container runs every `*.sql` in `node_backend/migrations/` once. To re-apply after changing migrations during dev, wipe the volume:
   ```bash
   docker compose down -v && docker compose up -d
   ```
4. **Verify DB schema:**
   ```bash
   docker exec -it fyers_algo_postgres \
     psql -U postgres -d fyers_algo -c "\dt"
   ```
   You should see `instruments`, `watchlists`, `watchlist_symbols`, `candles_1m`, `signals`, `strategy_state`.

## Daily run order (after each milestone is built)

```bash
docker compose up -d                                 # Redis + Postgres
python app_token/generate_token.py                   # Fyers OAuth → token in Redis
node node_backend/src/index.js                       # WS subscriber + aggregator + API
python -m engine.main                                # strategy engine
cd next_frontend && npm run dev                      # dashboard at http://localhost:3000
```

## Python setup

The repo uses one shared `requirements.txt` for `app_token/` and `python_engine/`:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Generating a Fyers access token

```bash
python -m app_token.generate_token        # opens browser, prompts for auth_code
```

After login, Fyers redirects to your `FYERS_REDIRECT_URL` with `auth_code` in the query string — copy that value and paste it into the prompt. The script writes the access + refresh token to:
- Redis: `token:fyers:access` (TTL 23h), `token:fyers:refresh` (TTL 14d)
- Backup file: `app_token/token.json` (gitignored)

Verify the token is in Redis:
```bash
docker exec -it fyers_algo_redis redis-cli GET token:fyers:access
```

> **Note on refresh tokens:** Fyers discontinued the refresh-token endpoint as of 1 April. `refresh_token.py` is intentionally a no-op that fails loudly so any cron pointing at it is obvious. Re-run `generate_token` each trading day.

## Running the Node backend (M3+)

The Node backend handles broker I/O — Fyers WebSocket subscribe, tick → Redis, 1-min candle aggregation (M4), dashboard API (M6).

```bash
cd node_backend
npm install
node src/index.js
```

After it boots during market hours (09:15–15:30 IST), the LTP cache fills:
```bash
docker exec -it fyers_algo_redis redis-cli -a "$REDIS_PASSWORD" HGETALL ltp:NSE:RELIANCE-EQ
```

Outside market hours the WS connects but no ticks arrive — that's expected, not a bug.

## Running the Python strategy engine (M5+)

```bash
cd python_engine
python -m engine.main
```

Logs once per closed candle (per symbol). When the active strategy fires, you'll see `SIGNAL BUY NSE:RELIANCE-EQ @ 2904.50 (ema_crossover @ 2026-05-08T10:23:00+05:30)` and a row in the `signals` table.

**Switch the active strategy** — use M6's API (the engine reloads on the `strategy.changed` Redis pub it triggers):
```bash
curl -X PUT http://localhost:4000/strategies/active \
  -H "content-type: application/json" \
  -d '{"name":"ema_crossover"}'
```

**Smoke test (off-hours OK)** — fires a synthetic candle so you can see the dispatch path without market data:
```bash
docker exec -it fyers_algo_redis redis-cli -a "$REDIS_PASSWORD" PUBLISH \
  candle.closed.NSE:RELIANCE-EQ \
  '{"symbol":"NSE:RELIANCE-EQ","ts":1714900800,"open":2900,"high":2905,"low":2898,"close":2904,"volume":12345}'
```
Engine logs `evaluated ema_crossover on NSE:RELIANCE-EQ -> None` (no crossover from one candle, but the path was exercised end-to-end).

**Unit tests:**
```bash
cd python_engine && pytest -q
```

## Dashboard API (M6+)

Boots as part of `node src/index.js` (host/port from `NODE_BACKEND_HOST` / `NODE_BACKEND_PORT`, defaults `0.0.0.0:4000`).

| Method | Path                    | Purpose                                                        |
|--------|-------------------------|----------------------------------------------------------------|
| GET    | `/health`               | Liveness probe.                                                |
| GET    | `/signals`              | Recent signals. Query: `symbol`, `strategy`, `side`, `since` (ISO8601), `limit` (≤500, default 100). |
| GET    | `/strategies`           | Known strategy names (validation set for PUT below).           |
| GET    | `/strategies/active`    | Current active strategy + `updated_at`.                        |
| PUT    | `/strategies/active`    | Body: `{"name":"<strategy>"}`. Updates `strategy_state` and publishes `strategy.changed` so the engine hot-swaps. |
| WS     | `/ws/signals`           | Push channel; receives every `signal.*` event as `{type:"signal", ...}`. Optional `?symbol=...` filter. |

**Quick checks:**
```bash
curl http://localhost:4000/health
curl 'http://localhost:4000/signals?symbol=NSE:RELIANCE-EQ&limit=10'
curl http://localhost:4000/strategies/active

# Subscribe to live signals (requires `websocat` or similar)
websocat ws://localhost:4000/ws/signals
```

When you add a new strategy to `python_engine/engine/strategies/registry.py`, also append its name to `app.strategies` in `node_backend/src/config.js` — the PUT endpoint validates against that list to avoid leaving the engine on a stale strategy.

## Milestone status

- [x] **M1 — Bootstrap.** docker-compose, schema, env template, README.
- [x] **M2 — Auth.** Fyers OAuth flow, access token in Redis with TTL. (Refresh-token endpoint discontinued by Fyers — re-auth daily via `generate_token`.)
- [x] **M3 — Live tick → Redis.** WS subscriber + auto-reconnect.
- [x] **M4 — 1-min aggregation → Postgres.** OHLCV roll-up + `candle.closed` pub + historical backfill on boot.
- [x] **M5 — Python strategy engine.** Strategy ABC + `ema_crossover` + signal publisher.
- [x] **M6 — Signal API + dashboard WS.** Fastify HTTP (`/signals`, `/strategies`) + `/ws/signals` Redis bridge.
- [x] **M7 — Next.js dashboard (lean).** Signals feed + recent-history table + strategy switcher. (LTP grid + watchlist editor deferred to M7b.)
- [ ] **M8 — Backtest CLI.**

## Cloud deployment

See [deploy/README.md](deploy/README.md) for the DigitalOcean single-VM runbook
(systemd units, Caddy reverse proxy with TLS + basic auth, daily token ritual).

## Conventions

- All times stored as `TIMESTAMPTZ`; container `TZ=Asia/Kolkata` so `psql` displays IST.
- Symbols use Fyers format: `EXCHANGE:NAME-SERIES`, e.g. `NSE:RELIANCE-EQ`.
- Never commit `.env` or `app_token/token.json`.
- Strategies live in `python_engine/engine/strategies/` and register via `registry.py`.
- Backtest and live evaluation must call the **same** `Strategy.evaluate()` — no parallel implementations.
