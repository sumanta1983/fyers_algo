# Plan — Multi-stock intraday signal engine on Fyers

## Context

You want a system that, at app start, subscribes to a watchlist on Fyers, evaluates a strategy continuously across all of those symbols on 1-minute candles, and emits BUY/SELL signals for intraday trading. **v1 is signal-only** — no real orders placed. Strategies are pluggable so you can swap them. Universe is **5–20 symbols in v1**, but the architecture should scale to ~100+ without rewrites.

The repo is greenfield: only empty folders (`app_token/`, `node_backend/`, `python_engine/`) and a `.env` with Fyers credentials exist.

## Architecture

Polyglot split, matching your stack:

```
        ┌──────────────────────────────────────────┐
        │                Fyers Cloud                │
        └───────┬───────────────────────────────────┘
                │ Data WebSocket (LTP + tick)
                ▼
   ┌────────────────────────┐
   │  node_backend          │
   │  - WS subscriber       │   tick → HSET ltp:<sym>
   │  - tick handler        │ ────────────────────────► Redis
   │  - 1-min aggregator    │   candle close ─► PUB candle.closed.<sym>
   │  - REST + dashboard WS │ ─────────► PostgreSQL (candles_1m)
   └─────────┬──────────────┘
             │ REST
             ▼                                 SUB candle.closed.*
        Next.js dashboard            ┌────────────────────────────┐
             ▲                       │   python_engine            │
             │  signal events        │   - strategy registry      │
             │ (Redis → Node WS)     │   - active strategy eval   │
             └───────────────────────┤   - signal publisher       │
                                     └────────┬───────────────────┘
                                              │ PUB signal.<sym>
                                              ▼
                                Redis ─► Node ─► dashboard
                                Postgres signals table
```

**Why this split:** Node owns I/O (WebSocket, broker REST, dashboard) where its event loop is best. Python owns math (pandas, indicators, backtesting). Redis is the message bus + hot cache so the two languages don't have to share process state. Postgres is the system of record for anything you'd want to query after the fact.

## Folder structure

```
fyers_algo/
├── .env                          (exists; do not commit secrets)
├── .env.example                  (template — commit this)
├── docker-compose.yml            (redis + postgres for local dev)
├── README.md
│
├── app_token/                    Python — Fyers OAuth & token refresh
│   ├── generate_token.py         interactive: opens auth URL, exchanges code → access_token
│   ├── refresh_token.py          run daily (cron) to refresh token
│   └── token_store.py            write token to Redis with TTL (and a backup file)
│
├── node_backend/
│   ├── package.json
│   ├── src/
│   │   ├── index.js              entry — boots WS, aggregator, API server
│   │   ├── config.js             reads .env, watchlist config
│   │   ├── fyers/
│   │   │   ├── client.js         REST wrapper (historical candles, profile)
│   │   │   └── websocket.js      WS subscribe/unsubscribe, auto-reconnect, batched subs
│   │   ├── ingestion/
│   │   │   ├── tickHandler.js    tick → Redis HSET (LTP + bid/ask)
│   │   │   └── candleAggregator.js  rolling 1-min OHLCV → Postgres + Redis pub
│   │   ├── api/                  Fastify routes
│   │   │   ├── watchlist.js      CRUD watchlist
│   │   │   ├── signals.js        list/stream signals
│   │   │   └── strategies.js     get/set active strategy
│   │   ├── ws/                   dashboard push (LTP, signals)
│   │   ├── db/                   pg pool
│   │   └── redis/                ioredis client + helpers
│   └── migrations/               sql migrations (run via node-pg-migrate or similar)
│
├── python_engine/
│   ├── pyproject.toml            (or requirements.txt)
│   ├── engine/
│   │   ├── main.py               entry — subscribes to Redis candle events, runs eval loop
│   │   ├── config.py
│   │   ├── data/
│   │   │   ├── store.py          Postgres + Redis access
│   │   │   └── candle_loader.py  load lookback window per symbol
│   │   ├── indicators/           EMA, RSI, VWAP, ATR — pure functions on a DataFrame
│   │   ├── strategies/
│   │   │   ├── base.py           Strategy ABC: evaluate(symbol, df) -> Signal | None
│   │   │   ├── registry.py       name → class mapping
│   │   │   └── ema_crossover.py  v1 strategy (9/21 EMA on close)
│   │   └── signals/
│   │       └── publisher.py      Redis PUB + insert into signals table
│   ├── backtest/
│   │   ├── runner.py             CLI: --strategy --symbol --from --to
│   │   └── report.py             P&L, win rate, max drawdown
│   └── tests/
│
├── frontend/                     Next.js dashboard (Phase 4)
│   └── …
│
└── temp_data/                    (exists)
```

## Key data structures

**Postgres**
- `instruments(symbol PK, exchange, lot_size, tick_size, …)`
- `watchlists(id, name)` + `watchlist_symbols(watchlist_id, symbol)`
- `candles_1m(symbol, ts, open, high, low, close, volume, PRIMARY KEY(symbol, ts))` — partitioned by date if you ever go to large universes
- `signals(id, ts, symbol, strategy, side, price, reason JSONB)`
- `strategy_state(active_strategy text, updated_at)` — single-row table

**Redis**
- `ltp:<symbol>` HASH `{price, ts, bid, ask}` — last tick, TTL ~5min
- `candle:<symbol>:1m` HASH — currently-forming candle
- `token:fyers` STRING with TTL — access token
- pub/sub: `candle.closed.<symbol>` and `signal.<symbol>`

## Strategy interface (so swapping is trivial)

```python
# engine/strategies/base.py
class Strategy(ABC):
    name: str
    lookback: int  # how many 1-min candles needed

    @abstractmethod
    def evaluate(self, symbol: str, df: pd.DataFrame) -> Optional[Signal]:
        """df indexed by ts ascending, columns: open/high/low/close/volume."""
```

`registry.py` maps `"ema_crossover" → EmaCrossover`. The engine reads the active strategy name from Postgres on boot (and on a Redis pub event from the API when you change it from the dashboard) and calls `evaluate()` on every `candle.closed` event for that symbol.

v1 implementation: **9/21 EMA crossover on 1-min close** with a no-trade window in the first 5 minutes after open and a hard stop emitting signals after 15:15 IST (intraday squareoff buffer).

## Build milestones

Each milestone is independently runnable so you can validate end-to-end early.

1. **Bootstrap (½ day)** — `docker-compose.yml` for redis+pg, `.env.example`, schema migrations, README with run steps.
2. **Auth (½ day)** — `app_token/generate_token.py` (Fyers OAuth code → access_token), write to Redis with TTL. Daily refresh script.
3. **Live tick → Redis (1 day)** — `node_backend` boots, reads watchlist, subscribes via Fyers WS, writes LTP to Redis. Verify by `redis-cli HGETALL ltp:NSE:RELIANCE-EQ` during market hours. Mind the WS subscription limit (per Fyers docs in `temp_data/websocket.png`) — batch subscribes and use a single WS instance per process.
4. **1-min aggregation → Postgres (1 day)** — roll ticks into OHLCV, write on minute close, publish `candle.closed.<symbol>`. Add a backfill from Fyers historical REST so Phase 5 has lookback data on cold start.
5. **Python strategy engine (1–2 days)** — `engine/main.py` subscribes to `candle.closed.*`, loads the lookback window via `candle_loader.py`, runs the active strategy, publishes signals to Redis + inserts into `signals` table. Implement `EmaCrossover` first.
6. **Signal API + dashboard WS (½ day)** — Node exposes `GET /signals` (recent), WS push `signal` events, REST to switch active strategy.
7. **Minimal Next.js dashboard (1–2 days)** — watchlist editor, live LTP grid (subscribe to Node WS), signals feed, strategy selector dropdown.
8. **Backtest CLI (1 day)** — `python -m backtest.runner --strategy ema_crossover --symbol NSE:RELIANCE-EQ --from 2026-04-01 --to 2026-04-30` reads `candles_1m` from Postgres, replays through the same `Strategy.evaluate()`, prints P&L. Critical: backtest and live must call the **same strategy class** so behavior matches.

After v1, the natural extensions are: paper-trading order layer, risk manager (max positions, per-symbol exposure cap, daily loss limit), then live order placement behind a feature flag.

## Critical implementation notes

- **Single Fyers WS instance per process** (per their docs). For 5–20 symbols this is one connection; for 100+ symbols later you may need multiple processes if you hit the per-connection subscription cap.
- **Auto-reconnect with exponential backoff** in `fyers/websocket.js`, and re-subscribe the watchlist on reconnect — Fyers does not persist subscriptions across reconnects.
- **Token expiry is daily.** Fail loudly on 401 from REST/WS so the cron-refreshed token is picked up; do not silently retry.
- **Time source matters.** Aggregate candles by exchange time (IST), not server time, otherwise candles drift if your machine clock is off.
- **No look-ahead in strategies.** The DataFrame passed to `evaluate()` must end at the most recently closed candle — never include the in-progress candle. Same rule in backtests.
- **Idempotent signal writes.** A strategy emitting "BUY" for the same `(strategy, symbol, candle_ts)` twice should not insert twice — unique constraint on those three columns.
- **Intraday squareoff buffer.** Stop emitting BUYs after 15:15 IST so positions aren't held past the 15:30 close.

## Verification

End-to-end smoke test, run during market hours after Phase 5:
1. `docker compose up -d` — Redis + Postgres healthy.
2. `python app_token/generate_token.py` — token in Redis.
3. `node node_backend/src/index.js` — logs show "subscribed N symbols", `redis-cli HGETALL ltp:NSE:RELIANCE-EQ` returns a fresh price.
4. After ≥30 min: `psql -c "SELECT count(*) FROM candles_1m WHERE symbol='NSE:RELIANCE-EQ'"` returns >0 and grows each minute.
5. `python -m engine.main` — logs "evaluating ema_crossover on NSE:RELIANCE-EQ" each minute.
6. Force a crossover on a synthetic symbol (or wait for a real one) → row appears in `signals` table; dashboard WS shows the alert.
7. `python -m backtest.runner --strategy ema_crossover --symbol NSE:RELIANCE-EQ --from <last week>` — produces a P&L report using the same strategy class.

## Open items deferred from v1

- Risk manager / position sizing — needed before paper or live trading, not before signals.
- Multi-strategy concurrent evaluation — v1 runs one active strategy; design supports many but UI gates to one.
- Auth on the dashboard — assume localhost-only for v1.
- Production deployment — Docker Compose locally is enough for v1.
