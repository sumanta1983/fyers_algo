'use strict';

const pino = require('pino');

// Pretty-print in dev (TTY); JSON otherwise.
const transport = process.stdout.isTTY
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
  : undefined;

module.exports = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
});
