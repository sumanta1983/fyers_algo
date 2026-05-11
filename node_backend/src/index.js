'use strict';

const config = require('./config');
const logger = require('./logger');
const redis = require('./redis/client');
const pool = require('./db/pool');
const { loadFyersToken } = require('./fyers/tokenLoader');
const { startSubscriber } = require('./fyers/websocket');
const { backfillWatchlist } = require('./fyers/historical');
const { handleTick } = require('./ingestion/tickHandler');
const { CandleAggregator } = require('./ingestion/candleAggregator');
const { startApi } = require('./api/server');

async function main() {
  if (config.app.watchlist.length === 0) {
    throw new Error('WATCHLIST is empty in .env — add at least one Fyers symbol.');
  }

  const { accessToken, clientId, wsToken } = await loadFyersToken(redis);
  logger.info({ clientId, watchlist: config.app.watchlist }, 'fyers token loaded');

  // Backfill historical 1-min candles before starting live ingestion so the
  // strategy engine has indicator history available on its first evaluation.
  logger.info('starting historical backfill');
  await backfillWatchlist({
    symbols: config.app.watchlist,
    clientId,
    accessToken,
    redirectUrl: process.env.FYERS_REDIRECT_URL,
    pool,
    logger,
  });

  const aggregator = new CandleAggregator({ pool, redis, logger });
  aggregator.start();

  // Dedicated ioredis connection for psubscribe('signal.*'); pubsub puts a
  // connection into a mode that can't be used for regular commands.
  const redisSub = redis.duplicate();
  const api = await startApi({ pool, redis, redisSub, logger });

  const fyers = startSubscriber({
    token: wsToken,
    symbols: config.app.watchlist,
    onTick: async (tick) => {
      // LTP cache + candle aggregation run in parallel — they're independent.
      await Promise.all([
        handleTick(tick, redis, logger),
        aggregator.handleTick(tick),
      ]);
    },
    logger,
  });

  let shuttingDown = false;
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ sig }, 'shutting down');
    try {
      if (typeof fyers.close === 'function') fyers.close();
    } catch (err) {
      logger.warn({ err }, 'error closing fyers ws');
    }
    await api.close().catch((err) => logger.warn({ err }, 'api close failed'));
    await aggregator.stop().catch((err) => logger.warn({ err }, 'aggregator stop failed'));
    await pool.end().catch(() => {});
    await redisSub.quit().catch(() => {});
    await redis.quit().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal: backend failed to start');
  process.exit(1);
});
