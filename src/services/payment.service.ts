import { Payment, IPayment } from '../models/payment.model';
import { PaymentRequest, PaymentStatus } from '../types';
import { retryQueue } from '../queues/retry.queue';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function createPayment(data: PaymentRequest): Promise<IPayment> {
  const payment = await Payment.create({
    ...data,
    currency: data.currency.toUpperCase(),
    status: PaymentStatus.PENDING,
    maxRetries: config.retry.maxAttempts,
  });

  logger.info('Payment created', { paymentId: payment.id, amount: data.amount, currency: data.currency });

  retryQueue.enqueue(payment.id as string);

  return payment;
}

export async function getPayment(paymentId: string): Promise<IPayment | null> {
  return Payment.findById(paymentId);
}

export async function listPayments(
  customerId?: string,
  status?: PaymentStatus,
  page = 1,
  limit = 20
): Promise<{ payments: IPayment[]; total: number; page: number; limit: number }> {
  const filter: Record<string, unknown> = {};
  if (customerId) filter.customerId = customerId;
  if (status) filter.status = status;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  return { payments: payments as IPayment[], total, page, limit };
}

export async function retryFailedPayment(paymentId: string): Promise<IPayment> {
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: PaymentStatus.FAILED },
    {
      $set: {
        status: PaymentStatus.PENDING,
        retryCount: 0,
        gatewayError: undefined,
        failedAt: undefined,
        nextRetryAt: undefined,
      },
    },
    { new: true }
  );

  if (!payment) {
    throw new Error('Payment not found or not in FAILED state');
  }

  retryQueue.enqueue(paymentId);
  logger.info('Manual retry initiated', { paymentId });
  return payment;
}
