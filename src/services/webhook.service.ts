import { Payment } from '../models/payment.model';
import { PaymentStatus, WebhookPayload } from '../types';
import { logger } from '../utils/logger';

// Only these transitions are legal from a webhook
const VALID_TRANSITIONS: Partial<Record<PaymentStatus, PaymentStatus[]>> = {
  [PaymentStatus.PENDING]: [PaymentStatus.SUCCESS, PaymentStatus.FAILED],
  [PaymentStatus.PROCESSING]: [PaymentStatus.SUCCESS, PaymentStatus.FAILED],
};

export async function handleWebhookCallback(payload: WebhookPayload): Promise<{
  accepted: boolean;
  reason?: string;
}> {
  const { paymentId, status, transactionId, timestamp } = payload;

  const targetStatus = status.toUpperCase() as PaymentStatus;

  if (!Object.values(PaymentStatus).includes(targetStatus)) {
    throw new Error(`Invalid status in webhook payload: ${status}`);
  }

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    throw new Error(`Payment ${paymentId} not found`);
  }

  // Idempotent: duplicate success/failure webhook — already in terminal state
  if (payment.status === targetStatus) {
    logger.info('Duplicate webhook received — already in target state', { paymentId, status: targetStatus });
    return { accepted: true, reason: 'already in target state' };
  }

  const allowedTargets = VALID_TRANSITIONS[payment.status] ?? [];
  if (!allowedTargets.includes(targetStatus)) {
    logger.warn('Invalid webhook state transition rejected', {
      paymentId,
      from: payment.status,
      to: targetStatus,
    });
    // Return accepted so the caller doesn't retry — just silently ignore
    return { accepted: false, reason: `transition ${payment.status} → ${targetStatus} not allowed` };
  }

  const update: Record<string, unknown> = {
    status: targetStatus,
    webhookReceived: true,
  };

  if (targetStatus === PaymentStatus.SUCCESS) {
    update.transactionId = transactionId;
    update.processedAt = new Date(timestamp);
    update.gatewayError = undefined;
  } else if (targetStatus === PaymentStatus.FAILED) {
    update.failedAt = new Date(timestamp);
  }

  // Optimistic concurrency: only update if status hasn't changed since we read it
  const updated = await Payment.findOneAndUpdate(
    { _id: paymentId, status: payment.status },
    { $set: update },
    { new: true }
  );

  if (!updated) {
    logger.warn('Webhook update lost race — concurrent state change', { paymentId });
    return { accepted: false, reason: 'concurrent update conflict' };
  }

  logger.info('Payment updated via webhook', { paymentId, status: targetStatus });
  return { accepted: true };
}
