import { connectTestDB, disconnectTestDB, clearTestDB } from './setup';
import { Payment } from '../src/models/payment.model';
import { PaymentStatus } from '../src/types';
import { handleWebhookCallback } from '../src/services/webhook.service';

beforeAll(async () => connectTestDB());
afterAll(async () => disconnectTestDB());
afterEach(async () => clearTestDB());

async function createPaymentInState(status: PaymentStatus) {
  return Payment.create({
    customerId: 'cust_001',
    amount: 50,
    currency: 'USD',
    status,
    maxRetries: 3,
  });
}

describe('handleWebhookCallback', () => {
  it('updates PROCESSING payment to SUCCESS', async () => {
    const payment = await createPaymentInState(PaymentStatus.PROCESSING);

    const result = await handleWebhookCallback({
      paymentId: payment.id,
      status: 'SUCCESS',
      transactionId: 'txn_abc123',
      timestamp: new Date().toISOString(),
    });

    expect(result.accepted).toBe(true);

    const updated = await Payment.findById(payment.id);
    expect(updated?.status).toBe(PaymentStatus.SUCCESS);
    expect(updated?.transactionId).toBe('txn_abc123');
    expect(updated?.webhookReceived).toBe(true);
  });

  it('updates PENDING payment to FAILED', async () => {
    const payment = await createPaymentInState(PaymentStatus.PENDING);

    const result = await handleWebhookCallback({
      paymentId: payment.id,
      status: 'FAILED',
      timestamp: new Date().toISOString(),
    });

    expect(result.accepted).toBe(true);
    const updated = await Payment.findById(payment.id);
    expect(updated?.status).toBe(PaymentStatus.FAILED);
  });

  it('ignores duplicate SUCCESS webhook (already in SUCCESS)', async () => {
    const payment = await createPaymentInState(PaymentStatus.SUCCESS);

    const result = await handleWebhookCallback({
      paymentId: payment.id,
      status: 'SUCCESS',
      timestamp: new Date().toISOString(),
    });

    expect(result.accepted).toBe(true);
    expect(result.reason).toContain('already in target state');
  });

  it('rejects invalid transition from SUCCESS to FAILED', async () => {
    const payment = await createPaymentInState(PaymentStatus.SUCCESS);

    const result = await handleWebhookCallback({
      paymentId: payment.id,
      status: 'FAILED',
      timestamp: new Date().toISOString(),
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('not allowed');

    // State must remain SUCCESS
    const unchanged = await Payment.findById(payment.id);
    expect(unchanged?.status).toBe(PaymentStatus.SUCCESS);
  });

  it('throws for unknown payment', async () => {
    await expect(
      handleWebhookCallback({
        paymentId: '507f1f77bcf86cd799439011',
        status: 'SUCCESS',
        timestamp: new Date().toISOString(),
      })
    ).rejects.toThrow('not found');
  });

  it('throws for invalid status value', async () => {
    const payment = await createPaymentInState(PaymentStatus.PROCESSING);
    await expect(
      handleWebhookCallback({
        paymentId: payment.id,
        status: 'UNKNOWN_STATUS',
        timestamp: new Date().toISOString(),
      })
    ).rejects.toThrow('Invalid status');
  });

  it('stores processedAt timestamp from webhook', async () => {
    const payment = await createPaymentInState(PaymentStatus.PROCESSING);
    const ts = '2026-01-15T10:30:00.000Z';

    await handleWebhookCallback({
      paymentId: payment.id,
      status: 'SUCCESS',
      transactionId: 'txn_999',
      timestamp: ts,
    });

    const updated = await Payment.findById(payment.id);
    expect(updated?.processedAt?.toISOString()).toBe(ts);
  });
});
