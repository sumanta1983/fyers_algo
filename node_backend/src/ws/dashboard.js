'use strict';

// Dashboard WebSocket bridge.
//
// A single Redis psubscribe('signal.*') connection fans out to every connected
// dashboard client. Per-client filtering by ?symbol=NSE:RELIANCE-EQ is applied
// just before send. Clients receive plain JSON envelopes.
//
// We use ONE dedicated ioredis connection for psubscribe (the caller passes it
// in as redisSub.duplicate()) because pubsub puts the connection into a mode
// that can't be used for regular commands.

const SIGNAL_PATTERN = 'signal.*';
const HEARTBEAT_MS = 30_000;

async function registerSignalsWs(app, { redisSub }) {
  const clients = new Set();

  redisSub.on('pmessage', (_pattern, channel, message) => {
    let payload;
    try {
      payload = JSON.parse(message);
    } catch (err) {
      app.log.warn({ err, channel }, 'bad signal payload on redis');
      return;
    }
    const envelope = JSON.stringify({ type: 'signal', ...payload });
    for (const c of clients) {
      if (c.filterSymbol && c.filterSymbol !== payload.symbol) continue;
      if (c.socket.readyState === 1) {
        try {
          c.socket.send(envelope);
        } catch (err) {
          app.log.warn({ err }, 'ws send failed');
        }
      }
    }
  });

  await redisSub.psubscribe(SIGNAL_PATTERN);
  app.log.info({ pattern: SIGNAL_PATTERN }, 'ws bridge psubscribed');

  app.get('/ws/signals', { websocket: true }, (socket, req) => {
    const filterSymbol = typeof req.query.symbol === 'string' ? req.query.symbol : null;
    const entry = { socket, filterSymbol };
    clients.add(entry);
    app.log.info({ clients: clients.size, filterSymbol }, 'ws client connected');

    try {
      socket.send(JSON.stringify({ type: 'hello', filterSymbol }));
    } catch (_err) {
      // Connection may have closed between accept and first send; ignore.
    }

    const heartbeat = setInterval(() => {
      if (socket.readyState === 1) {
        try {
          socket.ping();
        } catch (_err) {
          // Connection dropped; the 'close' handler will clean up.
        }
      }
    }, HEARTBEAT_MS);

    socket.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(entry);
      app.log.info({ clients: clients.size }, 'ws client disconnected');
    });

    socket.on('error', (err) => {
      app.log.warn({ err }, 'ws client error');
    });
  });
}

module.exports = { registerSignalsWs };
