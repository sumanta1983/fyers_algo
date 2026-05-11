'use strict';

// Fastify HTTP + WebSocket server for the dashboard backend.
//
// Routes (M6):
//   GET    /health                 — liveness probe
//   GET    /signals                — recent signals (filterable)
//   GET    /strategies             — known strategy names
//   GET    /strategies/active      — current active strategy
//   PUT    /strategies/active      — set active strategy + notify engine
//   WS     /ws/signals             — push signal events to dashboard

const Fastify = require('fastify');
const websocket = require('@fastify/websocket');

const config = require('../config');
const signalsRoutes = require('./routes/signals');
const strategiesRoutes = require('./routes/strategies');
const { registerSignalsWs } = require('../ws/dashboard');

async function buildServer({ pool, redis, redisSub, logger }) {
  const app = Fastify({ loggerInstance: logger });

  await app.register(websocket);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(signalsRoutes, { pool });
  await app.register(strategiesRoutes, { pool, redis });
  await app.register(registerSignalsWs, { redisSub });

  return app;
}

async function startApi({ pool, redis, redisSub, logger }) {
  const app = await buildServer({ pool, redis, redisSub, logger });
  await app.listen({ host: config.app.host, port: config.app.port });
  logger.info({ host: config.app.host, port: config.app.port }, 'api listening');
  return app;
}

module.exports = { startApi, buildServer };
