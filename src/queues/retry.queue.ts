import { Payment } from '../models/payment.model';
import { PaymentStatus } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { chargePayment } from '../services/gateway.service';

interface QueueJob {
  paymentId: string;
  scheduledAt: number;
}

/**
 * In-memory queue for payment processing with exponential backoff retry.
 * Guarantees at-most-one concurrent processing per payment via the processing Set
 * and an atomic PENDING → PROCESSING state transition in MongoDB.
 */
export class RetryQueue {
  private jobs: QueueJob[] = [];
  private readonly processing = new Set<string>();
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
    logger.info('Retry queue started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Retry queue stopped');
  }

  enqueue(paymentId: string, delayMs = 0): void {
    this.jobs.push({ paymentId, scheduledAt: Date.now() + delayMs });
    logger.debug('Payment enqueued', { paymentId, delayMs });
  }

  private tick(): void {
    if (!this.running) return;

    const now = Date.now();
    const ready = this.jobs.filter(
      (j) => j.scheduledAt <= now && !this.processing.has(j.paymentId)
    );

    // Remove ready jobs from the queue before dispatching
    const readyIds = new Set(ready.map((j) => j.paymentId));
    this.jobs = this.jobs.filter((j) => !readyIds.has(j.paymentId) || j.scheduledAt > now);

    for (const job of ready) {
      this.processing.add(job.paymentId);
      this.processJob(job.paymentId).finally(() => this.processing.delete(job.paymentId));
    }

    this.timer = setTimeout(() => this.tick(), 500).unref();
  }

  private async processJob(paymentId: string): Promise<void> {
    const { maxAttempts, baseDelay, maxDelay } = config.retry;

    // Atomic PENDING → PROCESSING transition prevents race conditions
    const payment = await Payment.findOneAndUpdate(
      { _id: paymentId, status: PaymentStatus.PENDING },
      { $set: { status: PaymentStatus.PROCESSING } },
      { new: true }
    );

    if (!payment) {
      logger.debug('Payment not in PENDING state, skipping', { paymentId });
      return;
    }

    logger.info('Processing payment', { paymentId, attempt: payment.retryCount + 1 });

    try {
      const response = await chargePayment(paymentId, payment.amount, payment.currency);

      if (response.success) {
        await Payment.findByIdAndUpdate(paymentId, {
          $set: {
            status: PaymentStatus.SUCCESS,
            transactionId: response.transactionId,
            processedAt: new Date(),
            gatewayError: undefined,
          },
        });
        logger.info('Payment succeeded', { paymentId, transactionId: response.transactionId });
        return;
      }

      await this.scheduleRetry(paymentId, payment.retryCount + 1, maxAttempts, baseDelay, maxDelay, response.error);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      logger.error('Unexpected error processing payment', { paymentId, error: message });
      await this.scheduleRetry(paymentId, payment.retryCount + 1, maxAttempts, baseDelay, maxDelay, message);
    }
  }

  private async scheduleRetry(
    paymentId: string,
    newRetryCount: number,
    maxAttempts: number,
    baseDelay: number,
    maxDelay: number,
    error?: string
  ): Promise<void> {
    if (newRetryCount >= maxAttempts) {
      await Payment.findOneAndUpdate(
        { _id: paymentId, status: PaymentStatus.PROCESSING },
        {
          $set: {
            status: PaymentStatus.FAILED,
            retryCount: newRetryCount,
            gatewayError: error,
            failedAt: new Date(),
          },
        }
      );
      logger.warn('Payment failed — max retries exhausted', { paymentId, retryCount: newRetryCount });
      return;
    }

    // Exponential backoff: baseDelay * 2^(attempt-1), capped at maxDelay
    const backoffMs = Math.min(baseDelay * Math.pow(2, newRetryCount - 1), maxDelay);
    const nextRetryAt = new Date(Date.now() + backoffMs);

    await Payment.findOneAndUpdate(
      { _id: paymentId, status: PaymentStatus.PROCESSING },
      {
        $set: {
          status: PaymentStatus.PENDING,
          retryCount: newRetryCount,
          gatewayError: error,
          nextRetryAt,
        },
      }
    );

    logger.info('Payment retry scheduled', { paymentId, attempt: newRetryCount, backoffMs });
    this.enqueue(paymentId, backoffMs);
  }

  getQueueSize(): number {
    return this.jobs.length;
  }

  isProcessing(paymentId: string): boolean {
    return this.processing.has(paymentId);
  }
}

export const retryQueue = new RetryQueue();
