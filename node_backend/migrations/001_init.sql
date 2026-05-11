-- Initial schema for fyers_algo.
-- Run automatically by the postgres container on first init
-- (mounted at /docker-entrypoint-initdb.d in docker-compose.yml).
-- All timestamps use TIMESTAMPTZ; client code converts to/from IST as needed.

BEGIN;

-- Instrument metadata. Symbol uses Fyers format e.g. "NSE:RELIANCE-EQ".
CREATE TABLE IF NOT EXISTS instruments (
    symbol       TEXT PRIMARY KEY,
    exchange     TEXT NOT NULL,
    series       TEXT,
    name         TEXT,
    lot_size     INTEGER NOT NULL DEFAULT 1,
    tick_size    NUMERIC(10, 4) NOT NULL DEFAULT 0.05,
    fy_token     TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlists (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    is_default   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlist_symbols (
    watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    symbol       TEXT NOT NULL,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (watchlist_id, symbol)
);

-- 1-minute OHLCV candles. ts is the candle OPEN time (truncated to minute, IST-aware via TZ).
CREATE TABLE IF NOT EXISTS candles_1m (
    symbol       TEXT NOT NULL,
    ts           TIMESTAMPTZ NOT NULL,
    open         NUMERIC(14, 4) NOT NULL,
    high         NUMERIC(14, 4) NOT NULL,
    low          NUMERIC(14, 4) NOT NULL,
    close        NUMERIC(14, 4) NOT NULL,
    volume       BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (symbol, ts)
);

CREATE INDEX IF NOT EXISTS idx_candles_1m_ts ON candles_1m (ts DESC);

-- Strategy signal events.
CREATE TABLE IF NOT EXISTS signals (
    id           BIGSERIAL PRIMARY KEY,
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    candle_ts    TIMESTAMPTZ NOT NULL,
    symbol       TEXT NOT NULL,
    strategy     TEXT NOT NULL,
    side         TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    price        NUMERIC(14, 4) NOT NULL,
    reason       JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Idempotency: a strategy must not emit the same side twice for the same candle close.
    UNIQUE (strategy, symbol, candle_ts, side)
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol_ts ON signals (symbol, ts DESC);
CREATE INDEX IF NOT EXISTS idx_signals_strategy_ts ON signals (strategy, ts DESC);

-- Single-row table holding the currently active strategy.
-- The Python engine reads this on boot and on a Redis pub event when changed.
CREATE TABLE IF NOT EXISTS strategy_state (
    id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    active_strategy   TEXT NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: default watchlist and default active strategy.
INSERT INTO watchlists (name, is_default)
    VALUES ('default', TRUE)
    ON CONFLICT (name) DO NOTHING;

INSERT INTO watchlist_symbols (watchlist_id, symbol)
    SELECT w.id, s.symbol
    FROM watchlists w
    CROSS JOIN (VALUES
        ('NSE:RELIANCE-EQ'),
        ('NSE:TCS-EQ'),
        ('NSE:INFY-EQ'),
        ('NSE:HDFCBANK-EQ'),
        ('NSE:ICICIBANK-EQ')
    ) AS s(symbol)
    WHERE w.name = 'default'
    ON CONFLICT DO NOTHING;

INSERT INTO strategy_state (id, active_strategy)
    VALUES (1, 'ema_crossover')
    ON CONFLICT (id) DO NOTHING;

COMMIT;
