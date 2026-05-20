import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/payment-gateway',
  nodeEnv: process.env.NODE_ENV || 'development',

  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '3', 10),
    baseDelay: parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10),
    maxDelay: parseInt(process.env.RETRY_MAX_DELAY_MS || '30000', 10),
  },

  circuitBreaker: {
    failureThreshold: parseInt(process.env.CB_FAILURE_THRESHOLD || '5', 10),
    recoveryTimeout: parseInt(process.env.CB_RECOVERY_TIMEOUT_MS || '30000', 10),
    halfOpenMaxCalls: parseInt(process.env.CB_HALF_OPEN_MAX_CALLS || '2', 10),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },

  gateway: {
    successRate: parseFloat(process.env.GATEWAY_SUCCESS_RATE || '0.7'),
    timeoutRate: parseFloat(process.env.GATEWAY_TIMEOUT_RATE || '0.1'),
    minDelayMs: parseInt(process.env.GATEWAY_MIN_DELAY_MS || '100', 10),
    maxDelayMs: parseInt(process.env.GATEWAY_MAX_DELAY_MS || '2000', 10),
    timeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_MS || '5000', 10),
  },

  idempotency: {
    ttlSeconds: parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || '86400', 10),
  },
};
