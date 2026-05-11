'use strict';

// Fyers tick `type` values (see fyers_api_docs/market_data.txt):
//   cn  = connection ack       sub = subscribe ack       unsub = unsubscribe ack
//   sf  = equity / option      if  = index               dp    = market depth
const QUOTE_TYPES = new Set(['sf', 'if']);

const LTP_TTL_SECONDS = 5 * 60;

/**
 * Persist a quote tick to Redis at `ltp:<symbol>` and refresh its TTL.
 * Control messages (cn/sub/unsub) and depth (dp) are ignored — depth isn't subscribed in v1.
 * @param {object} tick - raw FyersSocket message
 * @param {import('ioredis').Redis} redis
 * @param {import('pino').Logger} logger
 */
async function handleTick(tick, redis, logger) {
  if (!tick || typeof tick !== 'object') return;

  // Control / non-quote messages — log subscribe acks once, ignore the rest.
  if (!QUOTE_TYPES.has(tick.type)) {
    if (tick.type === 'sub' || tick.type === 'cn') {
      logger.debug({ tick }, 'fyers ws control message');
    }
    return;
  }

  if (!tick.symbol || tick.ltp == null) return; // malformed — skip rather than crash

  const key = `ltp:${tick.symbol}`;
  // Numeric fields stored as strings (Redis HSET); reader parses as needed.
  const fields = {
    price: tick.ltp,
    bid_price: tick.bid_price ?? 0,
    ask_price: tick.ask_price ?? 0,
    bid_size: tick.bid_size ?? 0,
    ask_size: tick.ask_size ?? 0,
    last_traded_qty: tick.last_traded_qty ?? 0,
    vol_traded_today: tick.vol_traded_today ?? 0,
    avg_trade_price: tick.avg_trade_price ?? 0,
    open_price: tick.open_price ?? 0,
    high_price: tick.high_price ?? 0,
    low_price: tick.low_price ?? 0,
    prev_close_price: tick.prev_close_price ?? 0,
    // exch_feed_time is unix epoch seconds; ts_ms is our wall clock.
    exch_feed_time: tick.exch_feed_time ?? 0,
    ts_ms: Date.now(),
  };

  const pipe = redis.pipeline();
  pipe.hset(key, fields);
  pipe.expire(key, LTP_TTL_SECONDS);
  await pipe.exec();
}

module.exports = { handleTick };
