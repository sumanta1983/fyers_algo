'use strict';

const { fyersDataSocket: FyersSocket } = require('fyers-api-v3');

/**
 * Start the Fyers Data WebSocket subscriber.
 * The SDK handles connect/reconnect; we just wire callbacks and subscribe on connect.
 *
 * Modes (per Fyers docs):
 *   - FullMode (default): full quote — ltp, vol_traded_today, bid/ask, OHL, etc. (type='sf'/'if')
 *   - LiteMode: ltp + symbol only.
 * We use FullMode because the candle aggregator needs vol_traded_today for per-minute volume.
 *
 * @param {object} opts
 * @param {string} opts.token - "clientId:accessToken"
 * @param {string[]} opts.symbols - e.g. ['NSE:RELIANCE-EQ']
 * @param {(tick: object) => void | Promise<void>} opts.onTick
 * @param {import('pino').Logger} opts.logger
 * @returns {object} the underlying FyersSocket instance (for shutdown)
 */
function startSubscriber({ token, symbols, onTick, logger }) {
  const fyers = new FyersSocket(token);

  fyers.on('connect', () => {
    logger.info({ count: symbols.length }, 'fyers ws connected, subscribing');
    // Single subscribe call — SDK batches under the hood.
    fyers.subscribe(symbols); // FullMode by default; no depth (no 2nd arg).
    fyers.autoreconnect();
  });

  fyers.on('message', (msg) => {
    Promise.resolve()
      .then(() => onTick(msg))
      .catch((err) => logger.error({ err, msg }, 'tick handler threw'));
  });

  fyers.on('error', (err) => logger.error({ err }, 'fyers ws error'));
  fyers.on('close', () => logger.warn('fyers ws closed (sdk will reconnect)'));

  fyers.connect();
  return fyers;
}

module.exports = { startSubscriber };
