'use strict';

// GET /signals — paginated/filterable view of the signals table.
// Filters: symbol, strategy, side, since (ISO8601). Default limit 100, max 500.

const LIMIT_DEFAULT = 100;
const LIMIT_MAX = 500;

const querySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    symbol: { type: 'string', minLength: 1 },
    strategy: { type: 'string', minLength: 1 },
    side: { type: 'string', enum: ['BUY', 'SELL'] },
    since: { type: 'string', format: 'date-time' },
    limit: { type: 'integer', minimum: 1, maximum: LIMIT_MAX, default: LIMIT_DEFAULT },
  },
};

async function routes(app, { pool }) {
  app.get('/signals', { schema: { querystring: querySchema } }, async (req) => {
    const { symbol, strategy, side, since, limit = LIMIT_DEFAULT } = req.query;

    const where = [];
    const params = [];
    if (symbol) {
      params.push(symbol);
      where.push(`symbol = $${params.length}`);
    }
    if (strategy) {
      params.push(strategy);
      where.push(`strategy = $${params.length}`);
    }
    if (side) {
      params.push(side);
      where.push(`side = $${params.length}`);
    }
    if (since) {
      params.push(since);
      where.push(`ts >= $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT id, ts, candle_ts, symbol, strategy, side, price::float8 AS price, reason
         FROM signals
         ${whereSql}
         ORDER BY ts DESC
         LIMIT $${params.length}`,
      params,
    );
    return { signals: rows };
  });
}

module.exports = routes;
