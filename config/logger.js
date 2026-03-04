/**
 * Structured logger using pino.
 * 
 * Usage:
 *   const logger = require('../config/logger');
 *   logger.info({ userId, action: 'login' }, 'User logged in');
 *   logger.error({ err, endpoint: '/api/posts' }, 'Database error');
 *   logger.warn({ ip: req.ip }, 'Suspicious activity');
 * 
 * In production: JSON output for log aggregation (ELK, CloudWatch, etc.)
 * In development: Pretty-printed colored output
 */
const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  ...(isProduction ? {
    // Production: JSON logs for aggregation
    formatters: {
      level(label) {
        return { level: label };
      }
    },
    timestamp: pino.stdTimeFunctions.isoTime
  } : {
    // Development: pretty print
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname'
      }
    }
  })
});

module.exports = logger;
