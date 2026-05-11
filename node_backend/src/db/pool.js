'use strict';

const { Pool } = require('pg');

const config = require('../config');

const pool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  user: config.postgres.user,
  password: config.postgres.password,
  database: config.postgres.database,
  max: 8,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Idle client failure — pg recreates clients on demand, so log & continue.
  // eslint-disable-next-line no-console
  console.error('pg pool error', err);
});

module.exports = pool;
