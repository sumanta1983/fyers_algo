'use strict';

// Historical 1-min candle backfill via fyers-api-v3 REST SDK.
// On boot we fetch a lookback window per symbol so the Python engine has
// indicator history available before the first live candle closes.

const { fyersModel: FyersAPI } = require('fyers-api-v3');

const DEFAULT_LOOKBACK_MINUTES = 60;
// Per Fyers docs: "always use a range_to of the previous minute to ensure
// completed candle data". So range_to = now - 60 seconds.
const COMPLETED_MINUTE_LAG_SECONDS = 60;

const INSERT_BACKFILL_SQL = `
  INSERT INTO candles_1m (symbol, ts, open, high, low, close, volume)
  VALUES ($1, to_timestamp($2), $3, $4, $5, $6, $7)
  ON CONFLICT (symbol, ts) DO NOTHING
`;

function buildClient({ clientId, accessToken, redirectUrl }) {
  const fyers = new FyersAPI();
  fyers.setAppId(clientId);
  if (redirectUrl) fyers.setRedirectUrl(redirectUrl);
  fyers.setAccessToken(accessToken);
  return fyers;
}

/**
 * Fetch & UPSERT (DO NOTHING) historical 1-min candles for a single symbol.
 * @returns {Promise<number>} number of candles inserted (or already present).
 */
async function backfillSymbol(symbol, fyers, pool, { lookbackMinutes = DEFAULT_LOOKBACK_MINUTES } = {}) {
  const rangeTo = Math.floor(Date.now() / 1000) - COMPLETED_MINUTE_LAG_SECONDS;
  const rangeFrom = rangeTo - lookbackMinutes * 60;

  const response = await fyers.getHistory({
    symbol,
    resolution: '1',
    date_format: '0',
    range_from: String(rangeFrom),
    range_to: String(rangeTo),
    cont_flag: '1',
  });

  if (!response || response.s !== 'ok' || !Array.isArray(response.candles)) {
    const msg = response?.message || 'unknown error';
    throw new Error(`getHistory(${symbol}) returned non-ok: ${msg}`);
  }

  const rows = response.candles; // [[epoch_s, open, high, low, close, volume], ...]
  if (rows.length === 0) return 0;

  // Single multi-row insert.
  const values = [];
  const placeholders = [];
  rows.forEach((row, i) => {
    const [ts, o, h, l, c, v] = row;
    const base = i * 7;
    placeholders.push(
      `($${base + 1}, to_timestamp($${base + 2}), $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
    );
    values.push(symbol, ts, o, h, l, c, v);
  });

  await pool.query(
    `INSERT INTO candles_1m (symbol, ts, open, high, low, close, volume)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (symbol, ts) DO NOTHING`,
    values,
  );

  return rows.length;
}

/**
 * Backfill all symbols sequentially. Failures on one symbol don't abort the rest —
 * the live aggregator will still produce candles even if backfill is partial.
 */
async function backfillWatchlist({ symbols, clientId, accessToken, redirectUrl, pool, logger, lookbackMinutes }) {
  const fyers = buildClient({ clientId, accessToken, redirectUrl });
  let total = 0;
  for (const symbol of symbols) {
    try {
      const n = await backfillSymbol(symbol, fyers, pool, { lookbackMinutes });
      total += n;
      logger.info({ symbol, count: n }, 'backfill done');
    } catch (err) {
      logger.error({ err: err.message, symbol }, 'backfill failed (continuing)');
    }
  }
  return total;
}

module.exports = { backfillWatchlist, backfillSymbol, _INSERT_BACKFILL_SQL: INSERT_BACKFILL_SQL };
