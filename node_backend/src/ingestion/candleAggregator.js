'use strict';

// 1-minute candle aggregator.
//
// Per-symbol state is held in memory until the minute closes, then UPSERTed
// into candles_1m and published on Redis pub/sub channel `candle.closed.<symbol>`
// (consumed by the Python strategy engine in M5).
//
// A minute closes when:
//   (a) we see a tick whose floor(exch_feed_time / 60) is greater than the
//       running candle's minute, OR
//   (b) the periodic scan detects a candle whose minute is now in the past
//       (catches symbols that stop trading near the end of the day).
//
// Volume model: each minute's volume = (vol_traded_today at last tick of minute)
//   - (vol_traded_today at first tick of minute). This loses a fraction of a
//   second around the boundary but matches what we can observe from ticks.

const QUOTE_TYPES = new Set(['sf', 'if']);
const STALE_SCAN_INTERVAL_MS = 30_000;
const PUB_CHANNEL = (symbol) => `candle.closed.${symbol}`;

const UPSERT_SQL = `
  INSERT INTO candles_1m (symbol, ts, open, high, low, close, volume)
  VALUES ($1, to_timestamp($2), $3, $4, $5, $6, $7)
  ON CONFLICT (symbol, ts) DO UPDATE
    SET open   = EXCLUDED.open,
        high   = EXCLUDED.high,
        low    = EXCLUDED.low,
        close  = EXCLUDED.close,
        volume = EXCLUDED.volume
`;

class CandleAggregator {
  constructor({ pool, redis, logger }) {
    this.pool = pool;
    this.redis = redis;
    this.logger = logger;
    this.openCandles = new Map(); // symbol → candle state
    this.staleTimer = null;
  }

  start() {
    if (this.staleTimer) return;
    this.staleTimer = setInterval(
      () => this.flushStale().catch((err) => this.logger.error({ err }, 'flushStale failed')),
      STALE_SCAN_INTERVAL_MS,
    );
    // Don't keep the event loop alive just for this timer.
    if (typeof this.staleTimer.unref === 'function') this.staleTimer.unref();
  }

  async stop() {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    await this.flushAll();
  }

  async handleTick(tick) {
    if (!tick || !QUOTE_TYPES.has(tick.type)) return;
    if (!tick.symbol || tick.ltp == null) return;

    const exchTime = tick.exch_feed_time || Math.floor(Date.now() / 1000);
    const minuteTs = Math.floor(exchTime / 60) * 60;
    const cumVol = Number(tick.vol_traded_today ?? 0);
    const price = Number(tick.ltp);

    const current = this.openCandles.get(tick.symbol);

    if (!current) {
      this.openCandles.set(tick.symbol, {
        minute_ts: minuteTs,
        open: price,
        high: price,
        low: price,
        close: price,
        vol_start: cumVol,
        vol_last: cumVol,
      });
      return;
    }

    if (minuteTs > current.minute_ts) {
      // Roll: close the previous minute, open a new one with this tick.
      await this.finalize(tick.symbol, current);
      this.openCandles.set(tick.symbol, {
        minute_ts: minuteTs,
        open: price,
        high: price,
        low: price,
        close: price,
        vol_start: cumVol,
        vol_last: cumVol,
      });
      return;
    }

    if (minuteTs < current.minute_ts) {
      // Out-of-order tick (clock skew or replay). Ignore.
      return;
    }

    if (price > current.high) current.high = price;
    if (price < current.low) current.low = price;
    current.close = price;
    if (cumVol > current.vol_last) current.vol_last = cumVol;
  }

  async finalize(symbol, candle) {
    const volume = Math.max(0, candle.vol_last - candle.vol_start);
    try {
      await this.pool.query(UPSERT_SQL, [
        symbol,
        candle.minute_ts,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        volume,
      ]);
      const payload = JSON.stringify({
        symbol,
        ts: candle.minute_ts,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume,
      });
      await this.redis.publish(PUB_CHANNEL(symbol), payload);
      this.logger.debug({ symbol, ts: candle.minute_ts, close: candle.close, volume }, 'candle.closed');
    } catch (err) {
      this.logger.error({ err, symbol, candle }, 'failed to persist candle');
    }
  }

  async flushStale() {
    const nowMinute = Math.floor(Date.now() / 1000 / 60) * 60;
    for (const [symbol, candle] of this.openCandles) {
      if (candle.minute_ts < nowMinute) {
        await this.finalize(symbol, candle);
        this.openCandles.delete(symbol);
      }
    }
  }

  async flushAll() {
    for (const [symbol, candle] of this.openCandles) {
      await this.finalize(symbol, candle);
    }
    this.openCandles.clear();
  }
}

module.exports = { CandleAggregator };
