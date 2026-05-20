import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later.',
    retryAfterSeconds: Math.ceil(config.rateLimit.windowMs / 1000),
  },
});

// Tighter limiter specifically for payment creation
export const paymentCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Payment creation rate limit exceeded. Max 10 payments per minute.' },
  keyGenerator: (req) => req.headers['x-customer-id']?.toString() || req.ip || 'unknown',
});
