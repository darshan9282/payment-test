import { Request, Response, NextFunction } from 'express';
import { IdempotencyRecord } from '../models/idempotency.model';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  if (!idempotencyKey) {
    res.status(400).json({ error: 'Idempotency-Key header is required' });
    return;
  }

  if (idempotencyKey.length > 255) {
    res.status(400).json({ error: 'Idempotency-Key must be 255 characters or fewer' });
    return;
  }

  try {
    const existing = await IdempotencyRecord.findOne({ key: idempotencyKey });

    if (existing) {
      logger.info('Returning cached idempotent response', { idempotencyKey });
      res.status(existing.responseStatus).json(existing.responseBody);
      return;
    }

    // Intercept res.json to persist the response before sending
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      // Only cache successful responses (2xx)
      if (status >= 200 && status < 300) {
        IdempotencyRecord.create({
          key: idempotencyKey,
          responseStatus: status,
          responseBody: body,
          expiresAt: new Date(Date.now() + config.idempotency.ttlSeconds * 1000),
        }).catch((err: unknown) => logger.error('Failed to persist idempotency record', { err }));
      }
      return originalJson(body);
    };

    next();
  } catch (err) {
    logger.error('Idempotency middleware error', { err });
    next(err);
  }
}
