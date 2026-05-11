'use strict';

const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const required = ['FYERS_CLIENT_ID', 'REDIS_HOST'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(`Missing env vars: ${missing.join(', ')}. Check .env at project root.`);
}

const watchlist = (process.env.WATCHLIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

module.exports = {
  fyers: {
    clientId: process.env.FYERS_CLIENT_ID,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    db: parseInt(process.env.REDIS_DB || '0', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'fyers_algo',
  },
  app: {
    port: parseInt(process.env.NODE_BACKEND_PORT || '4000', 10),
    host: process.env.NODE_BACKEND_HOST || '0.0.0.0',
    tz: process.env.TZ || 'Asia/Kolkata',
    watchlist,
    // Mirrors python_engine/engine/strategies/registry.py. PUT /strategies/active
    // validates against this set so we never write an unknown name into
    // strategy_state (which would leave the engine stuck on its last-known good
    // strategy after the next strategy.changed event).
    strategies: ['ema_crossover'],
  },
};
