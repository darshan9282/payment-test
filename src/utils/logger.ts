import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

export const logger = winston.createLogger({
  level: config.nodeEnv === 'test' ? 'silent' : config.nodeEnv === 'production' ? 'info' : 'debug',
  format: combine(timestamp(), errors({ stack: true }), json()),
  defaultMeta: { service: 'payment-gateway' },
  transports: [
    new winston.transports.Console({
      format: config.nodeEnv === 'production' ? json() : combine(colorize(), simple()),
    }),
  ],
});
