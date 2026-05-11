'use strict';

const ACCESS_KEY = 'token:fyers:access';
const CLIENT_KEY = 'token:fyers:client_id';

/**
 * Load Fyers credentials from Redis (populated by `python -m app_token.generate_token`).
 * Returns both the raw access token (needed by the REST SDK) and the joined
 * "clientId:accessToken" string (the form the data-WebSocket SDK expects).
 * @param {import('ioredis').Redis} redis
 * @returns {Promise<{accessToken: string, clientId: string, wsToken: string}>}
 */
async function loadFyersToken(redis) {
  const [accessToken, clientIdFromRedis] = await redis.mget(ACCESS_KEY, CLIENT_KEY);
  if (!accessToken) {
    throw new Error(
      `No Fyers access token in Redis (key "${ACCESS_KEY}"). ` +
        'Run: python -m app_token.generate_token',
    );
  }
  const clientId = clientIdFromRedis || process.env.FYERS_CLIENT_ID;
  if (!clientId) throw new Error('FYERS_CLIENT_ID is not set in .env or Redis.');
  return {
    accessToken,
    clientId,
    wsToken: `${clientId}:${accessToken}`,
  };
}

module.exports = { loadFyersToken };
