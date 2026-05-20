import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './config';
import { logger } from './utils/logger';
import paymentRoutes from './routes/payment.routes';
import { rateLimiter } from './middleware/rate-limiter';
import { retryQueue } from './queues/retry.queue';
import { getHealth } from './controllers/payment.controller';
import { Payment } from './models/payment.model';
import { PaymentStatus } from './types';

const app = express();

app.use(express.json());
app.use(rateLimiter);

// Swagger / OpenAPI docs
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Payment Gateway API',
      version: '1.0.0',
      description: 'Payment processing system with retry, idempotency, circuit breaker, and webhook support',
    },
    servers: [{ url: `http://localhost:${config.port}` }],
  },
  apis: ['./src/routes/*.ts'],
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

app.use('/api/payments', paymentRoutes);
app.get('/health', getHealth);

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

async function recoverStuckPayments(): Promise<void> {
  // After a crash, payments left in PROCESSING were mid-flight with no outcome.
  // Reset them to PENDING so the queue re-processes them on startup.
  const result = await Payment.updateMany(
    { status: PaymentStatus.PROCESSING },
    { $set: { status: PaymentStatus.PENDING, nextRetryAt: new Date() } }
  );

  if (result.modifiedCount > 0) {
    logger.warn(`Recovered ${result.modifiedCount} stuck PROCESSING payment(s) on startup`);

    const stuck = await Payment.find({ status: PaymentStatus.PENDING, nextRetryAt: { $lte: new Date() } });
    for (const p of stuck) {
      retryQueue.enqueue(p.id as string);
    }
  }
}

export async function startServer(): Promise<void> {
  await mongoose.connect(config.mongoUri);
  logger.info('Connected to MongoDB', { uri: config.mongoUri });

  await recoverStuckPayments();
  retryQueue.start();

  const server = app.listen(config.port, () => {
    logger.info(`Payment Gateway running on http://localhost:${config.port}`);
    logger.info(`API docs available at http://localhost:${config.port}/api/docs`);
  });

  const shutdown = async () => {
    logger.info('Shutting down...');
    retryQueue.stop();
    server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export default app;

if (require.main === module) {
  startServer().catch((err) => {
    logger.error('Failed to start server', { err });
    process.exit(1);
  });
}
