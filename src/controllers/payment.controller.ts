import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import * as paymentService from '../services/payment.service';
import { handleWebhookCallback } from '../services/webhook.service';
import { gatewayCircuitBreaker } from '../services/circuit-breaker.service';
import { retryQueue } from '../queues/retry.queue';
import { PaymentStatus } from '../types';
import { logger } from '../utils/logger';

export async function createPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { amount, currency, customerId, description, metadata } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' });
      return;
    }
    if (!currency || !/^[a-zA-Z]{3}$/.test(currency)) {
      res.status(400).json({ error: 'currency must be a valid 3-letter ISO 4217 code' });
      return;
    }
    if (!customerId || typeof customerId !== 'string') {
      res.status(400).json({ error: 'customerId is required' });
      return;
    }

    const payment = await paymentService.createPayment({
      amount,
      currency,
      customerId,
      description,
      metadata,
    });

    res.status(201).json({ data: payment });
  } catch (err) {
    next(err);
  }
}

export async function getPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ error: 'Invalid payment ID' });
      return;
    }

    const payment = await paymentService.getPayment(req.params.id);
    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    res.json({ data: payment });
  } catch (err) {
    next(err);
  }
}

export async function listPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { customerId, status, page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

    if (status && !Object.values(PaymentStatus).includes(status as PaymentStatus)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${Object.values(PaymentStatus).join(', ')}` });
      return;
    }

    const result = await paymentService.listPayments(
      customerId as string | undefined,
      status as PaymentStatus | undefined,
      pageNum,
      limitNum
    );

    res.json({
      data: result.payments,
      meta: { total: result.total, page: result.page, limit: result.limit },
    });
  } catch (err) {
    next(err);
  }
}

export async function retryPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ error: 'Invalid payment ID' });
      return;
    }

    const payment = await paymentService.retryFailedPayment(req.params.id);
    res.json({ data: payment });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found or not in FAILED')) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ error: 'Invalid payment ID' });
      return;
    }

    if (!req.body.status) {
      res.status(400).json({ error: 'Webhook payload must include status' });
      return;
    }

    const result = await handleWebhookCallback({
      paymentId: req.params.id,
      status: req.body.status,
      transactionId: req.body.transactionId,
      timestamp: req.body.timestamp || new Date().toISOString(),
      signature: req.body.signature,
    });

    res.json({ received: true, accepted: result.accepted, reason: result.reason });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export function getHealth(_req: Request, res: Response): void {
  res.json({
    status: 'ok',
    circuitBreaker: gatewayCircuitBreaker.getStats(),
    queue: { size: retryQueue.getQueueSize() },
    timestamp: new Date().toISOString(),
  });
}
