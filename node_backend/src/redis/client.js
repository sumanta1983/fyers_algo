'use strict';

const Redis = require('ioredis');

const config = require('../config');

const client = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  db: config.redis.db,
  password: config.redis.password,
  // Keep retries unbounded with capped delay — short Redis blips shouldn't kill the app.
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(50 * times, 2000),
});

module.exports = client;
