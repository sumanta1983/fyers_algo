# M5 Plan — Python strategy engine

## Context

M1–M4 give us live 1-min OHLCV in Postgres and a Redis pub/sub event (`candle.closed.<symbol>`) every time a minute closes. **M5 is the Python service that consumes those events, runs an active strategy, and emits BUY/SELL signals.**

Out of scope for M5 (deferred):
- HTTP API to expose signals or change the active strategy → M6
- Dashboard UI → M7
- Backtest CLI → M8 (it'll reuse this same `Strategy` interface)
- Risk manager / paper-trade order layer → post-v1

## Data flow

```
node_backend → PUB candle.closed.<symbol>  (already shipped in M4)
                          ↓
            Redis SUB pattern: candle.closed.*
                          ↓
              python_engine/engine/main.py
                          ↓
       load lookback window from candles_1m (Postgres)
                          ↓
   strategies.registry[active].evaluate(symbol, df) → Signal | None
                          ↓
          (if Signal) signals.publisher.emit(signal)
                ↓                              ↓
   INSERT INTO signals (Postgres)    PUB signal.<symbol> (Redis)
```

The engine **never calls Fyers directly** — that's `node_backend`'s job. This keeps Python's only job pandas math.

## Files

```
python_engine/
├── __init__.py
├── engine/
│   ├── __init__.py
│   ├── main.py                # entry: asyncio loop, Redis psubscribe, dispatch
│   ├── config.py              # reads .env, project paths
│   ├── data/
│   │   ├── __init__.py
│   │   ├── store.py           # psycopg + redis clients (singleton accessors)
│   │   └── candle_loader.py   # load last N candles_1m for a symbol → DataFrame
│   ├── indicators/
│   │   ├── __init__.py
│   │   └── ema.py             # ema(series, span) — pure pandas, no SDK
│   ├── strategies/
│   │   ├── __init__.py
│   │   ├── base.py            # Strategy ABC + Signal dataclass
│   │   ├── registry.py        # name → class map; get_active()/refresh()
│   │   └── ema_crossover.py   # v1 strategy
│   └── signals/
│       ├── __init__.py
│       └── publisher.py       # INSERT signals row + Redis PUB
└── tests/
    ├── __init__.py
    └── test_ema_crossover.py  # synthetic crossover → expected Signal
```

## Key types

**`Signal`** — what `Strategy.evaluate()` returns:
```python
@dataclass(frozen=True)
class Signal:
    symbol: str
    side: Literal["BUY", "SELL"]
    price: float                 # close of the triggering candle
    candle_ts: datetime          # the candle's open time, tz-aware (IST)
    strategy: str                # name from the registry
    reason: dict                 # JSONB-serializable diagnostic payload
```

**`Strategy`** — the ABC:
```python
class Strategy(ABC):
    name: ClassVar[str]
    lookback: ClassVar[int]      # min rows the engine must load before calling

    @abstractmethod
    def evaluate(self, symbol: str, df: pd.DataFrame) -> Optional[Signal]:
        """df is sorted ascending by ts; the last row is the just-closed candle.
        Columns: open, high, low, close, volume. ts is the index (tz-aware)."""
```

## EMA crossover (v1 strategy)

- Indicators: `ema9 = ema(close, 9)`, `ema21 = ema(close, 21)`.
- **BUY** when previous row had `ema9 <= ema21` and current row has `ema9 > ema21`.
- **SELL** when previous row had `ema9 >= ema21` and current row has `ema9 < ema21`.
- `lookback = 30` (warm-up margin over the 21-period EMA).
- **Skip windows** (return `None`):
  - First 5 minutes of the session (`< 09:20 IST`) — opening volatility.
  - After 15:15 IST — intraday squareoff buffer; no fresh entries.
- `reason` payload includes both EMAs and the previous values, for auditability in the signals table.

## Active-strategy resolution & hot-swap

- On boot: `SELECT active_strategy FROM strategy_state WHERE id = 1;` → load class from registry.
- Subscribe to Redis channel `strategy.changed` (set by M6's API when the user picks a different strategy in the dashboard). On message, re-read `strategy_state` and swap the in-memory class.
- Until M6 ships, hot-swap is just a future-proofing hook; restart the engine to pick up changes.

## Engine main loop (asyncio)

- `redis.asyncio.Redis` client with **two connections**: one for `psubscribe('candle.closed.*')`, one for queries / publishes (Redis pub/sub blocks the connection it's on).
- Single `asyncio.Queue` between the subscriber coroutine and the worker:
  - Subscriber pushes `(symbol, payload)` onto the queue.
  - Worker pops, loads lookback, runs `evaluate()`, publishes signal.
- Worker is **single-consumer** for v1 — strategy evaluation is fast (ms), and serializing keeps DB traffic predictable. If profiling later shows queue lag, fan out to N workers.
- Crashes in the worker are caught and logged; the loop never dies on a bad candle.

## Idempotency

- The `signals` table already has `UNIQUE (strategy, symbol, candle_ts, side)` (M1 schema).
- Publisher uses `INSERT ... ON CONFLICT DO NOTHING`. If the engine crashes mid-batch and re-processes a candle, no dupes.

## Critical implementation notes

- **Lookback window must end at the just-closed candle** (`ts <= payload.ts`). Never include an in-progress candle — the candle aggregator already excludes the current minute, but assert the invariant in `candle_loader` to catch regressions.
- **Time zone handling**: PG returns `TIMESTAMPTZ`, psycopg gives `datetime` with tzinfo. Convert to IST (`Asia/Kolkata`) once in `candle_loader`, downstream code stays tz-aware. Don't compare naive vs aware datetimes.
- **Pandas DataFrame layout**: index = ts (tz-aware), columns `open/high/low/close/volume` with `float64`/`int64` dtypes. Build it once in `candle_loader`, never mutate downstream — strategies receive a `.copy()` if they need to add indicator columns.
- **First-of-day**: when the lookback window is shorter than `strategy.lookback` (e.g. engine starts at 09:30 with only 15 candles), `evaluate()` returns `None` — never raise. The strategy itself is responsible for that check.
- **Logging**: `logger.bind(symbol=..., strategy=...)` per evaluation so logs are filterable.
- **Don't import `node_backend` Python isn't there.** The two services share state through Postgres + Redis only.

## Verification

1. **Unit:** `pytest python_engine/tests/test_ema_crossover.py` — synthetic price series with a known crossover at index 25 returns `Signal(side='BUY', candle_ts=...)`. No DB / Redis touched.
2. **Integration (off-hours OK):**
   - `python -m engine.main` boots, logs `subscribed to candle.closed.*`, loaded `ema_crossover`.
   - Manually publish a fake candle to drive an evaluation:
     ```bash
     redis-cli -a "$REDIS_PASSWORD" PUBLISH candle.closed.NSE:RELIANCE-EQ '{"symbol":"NSE:RELIANCE-EQ","ts":1714900800,"open":2900,"high":2905,"low":2898,"close":2904,"volume":12345}'
     ```
   - Expect a log line `evaluated ema_crossover on NSE:RELIANCE-EQ -> None` (since one synthetic candle won't trigger a crossover, but the dispatch path is exercised end-to-end).
3. **Live (market hours):** start node_backend + engine simultaneously. Within a few minutes the engine logs `evaluated …` per symbol per minute. If the strategy fires, a row appears in `signals` and `redis-cli PSUBSCRIBE 'signal.*'` shows the event.

## Open questions to revisit before starting

- **Single active strategy in v1 vs multi-strategy concurrent?** Plan_phase_1 says single → confirmed. Multi is a v2 concern.
- **Should the engine also write candles for symbols Fyers misses?** No — Postgres is the source of truth from `node_backend`. Engine is read-only on candles.
- **Where does `FYERS_PIN` belong if we ever wire token refresh?** Not relevant to M5 (engine doesn't auth with Fyers), but the answer will be: env var on the `app_token/` side only.
