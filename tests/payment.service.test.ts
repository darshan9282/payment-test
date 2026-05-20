import { connectTestDB, disconnectTestDB, clearTestDB } from './setup';
import { Payment } from '../src/models/payment.model';
import { PaymentStatus } from '../src/types';

// Mock the retry queue so we don't start background processing
jest.mock('../src/queues/retry.queue', () => ({
  retryQueue: {
    enqueue: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    getQueueSize: jest.fn().mockReturnValue(0),
    isProcessing: jest.fn().mockReturnValue(false),
  },
}));

import { createPayment, getPayment, listPayments, retryFailedPayment } from '../src/services/payment.service';
import { retryQueue } from '../src/queues/retry.queue';

const BASE_PAYMENT = {
  amount: 100,
  currency: 'USD',
  customerId: 'cust_001',
  description: 'Test payment',
};

beforeAll(async () => connectTestDB());
afterAll(async () => disconnectTestDB());
afterEach(async () => clearTestDB());

describe('createPayment', () => {
  it('creates payment in PENDING state', async () => {
    const payment = await createPayment(BASE_PAYMENT);

    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.amount).toBe(100);
    expect(payment.currency).toBe('USD');
    expect(payment.customerId).toBe('cust_001');
    expect(payment.retryCount).toBe(0);
  });

  it('enqueues payment for processing', async () => {
    const payment = await createPayment(BASE_PAYMENT);
    expect(retryQueue.enqueue).toHaveBeenCalledWith(payment.id);
  });

  it('uppercases currency', async () => {
    const payment = await createPayment({ ...BASE_PAYMENT, currency: 'eur' });
    expect(payment.currency).toBe('EUR');
  });

  it('persists to database', async () => {
    const payment = await createPayment(BASE_PAYMENT);
    const found = await Payment.findById(payment.id);
    expect(found).not.toBeNull();
    expect(found?.amount).toBe(100);
  });
});

describe('getPayment', () => {
  it('returns payment by id', async () => {
    const created = await createPayment(BASE_PAYMENT);
    const found = await getPayment(created.id);
    expect(found?.id).toBe(created.id);
  });

  it('returns null for unknown id', async () => {
    const result = await getPayment('507f1f77bcf86cd799439011');
    expect(result).toBeNull();
  });
});

describe('listPayments', () => {
  beforeEach(async () => {
    await createPayment({ ...BASE_PAYMENT, customerId: 'cust_A' });
    await createPayment({ ...BASE_PAYMENT, customerId: 'cust_A' });
    await createPayment({ ...BASE_PAYMENT, customerId: 'cust_B' });
  });

  it('returns all payments when no filter', async () => {
    const { payments, total } = await listPayments();
    expect(total).toBe(3);
    expect(payments).toHaveLength(3);
  });

  it('filters by customerId', async () => {
    const { payments, total } = await listPayments('cust_A');
    expect(total).toBe(2);
    expect(payments.every((p) => p.customerId === 'cust_A')).toBe(true);
  });

  it('filters by status', async () => {
    await Payment.updateMany({}, { $set: { status: PaymentStatus.SUCCESS } });
    const { total } = await listPayments(undefined, PaymentStatus.SUCCESS);
    expect(total).toBe(3);
  });

  it('respects pagination', async () => {
    const { payments } = await listPayments(undefined, undefined, 1, 2);
    expect(payments).toHaveLength(2);
  });
});

describe('retryFailedPayment', () => {
  it('resets a FAILED payment to PENDING', async () => {
    const created = await createPayment(BASE_PAYMENT);
    await Payment.findByIdAndUpdate(created.id, {
      $set: { status: PaymentStatus.FAILED, retryCount: 3, failedAt: new Date() },
    });

    const retried = await retryFailedPayment(created.id);

    expect(retried.status).toBe(PaymentStatus.PENDING);
    expect(retried.retryCount).toBe(0);
  });

  it('throws when payment is not in FAILED state', async () => {
    const created = await createPayment(BASE_PAYMENT);
    await expect(retryFailedPayment(created.id)).rejects.toThrow(
      'not found or not in FAILED state'
    );
  });

  it('re-enqueues the payment', async () => {
    const created = await createPayment(BASE_PAYMENT);
    await Payment.findByIdAndUpdate(created.id, { $set: { status: PaymentStatus.FAILED } });
    (retryQueue.enqueue as jest.Mock).mockClear();

    await retryFailedPayment(created.id);

    expect(retryQueue.enqueue).toHaveBeenCalledWith(created.id);
  });
});
