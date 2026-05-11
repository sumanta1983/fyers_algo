'use strict';

// Strategy management routes.
//
// PUT /strategies/active writes strategy_state and publishes `strategy.changed`
// on Redis. The Python engine subscribes to that channel and hot-swaps the
// in-memory strategy class on receipt (see python_engine/engine/main.py).

const config = require('../../config');

const STRATEGY_CHANGED = 'strategy.changed';

const activeBodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
  },
};

async function routes(app, { pool, redis }) {
  app.get('/strategies', async () => ({ strategies: config.app.strategies }));

  app.get('/strategies/active', async () => {
    const { rows } = await pool.query(
      'SELECT active_strategy, updated_at FROM strategy_state WHERE id = 1',
    );
    if (rows.length === 0) {
      // Migrations seed this row, so absence is a setup error rather than a 404.
      throw app.httpErrors?.internalServerError?.('strategy_state row missing')
        ?? new Error('strategy_state row missing');
    }
    return { active: rows[0].active_strategy, updated_at: rows[0].updated_at };
  });

  app.put(
    '/strategies/active',
    { schema: { body: activeBodySchema } },
    async (req, reply) => {
      const { name } = req.body;
      if (!config.app.strategies.includes(name)) {
        reply.code(400);
        return { error: `unknown strategy: ${name}`, known: config.app.strategies };
      }

      const { rows } = await pool.query(
        `UPDATE strategy_state
            SET active_strategy = $1, updated_at = NOW()
          WHERE id = 1
          RETURNING active_strategy, updated_at`,
        [name],
      );
      if (rows.length === 0) {
        reply.code(500);
        return { error: 'strategy_state row missing' };
      }

      await redis.publish(STRATEGY_CHANGED, JSON.stringify({ name }));
      req.log.info({ name }, 'active strategy changed');
      return { active: rows[0].active_strategy, updated_at: rows[0].updated_at };
    },
  );
}

module.exports = routes;
