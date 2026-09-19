/**
 * Logger — pino con pretty-print en dev.
 */

import pino from 'pino';
import { config, isDev } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l' },
      }
    : undefined,
});
