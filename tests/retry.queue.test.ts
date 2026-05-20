import { connectTestDB, disconnectTestDB, clearTestDB } from './setup';
import { Payment } from '../src/models/payment.model';
import { PaymentStatus } from '../src/types';

jest.mock('../src/services/gateway.service');

// Expose recoverStuckPayments for testing by extracting its logic inline
async function recoverStuckPayments(queue: { enqueue: (id: string) => void }) {
  const result = await Payment.updateMany(
    { status: PaymentStatus.PROCESSING },
    { $set: { status: PaymentStatus.PENDING, nextRetryAt: new Date() } }
  );
  if (result.modifiedCount > 0) {
    const stuck = await Payment.find({ status: PaymentStatus.PENDING });
    for (const p of stuck) queue.enqueue(p.id as string);
  }
  return result.modifiedCount;
}

beforeAll(async () => connectTestDB());
afterAll(async () => disconnectTestDB());
afterEach(async () => {
  await clearTestDB();   // must be awaited — un-awaited cleanup races with the next test
  jest.clearAllMocks();
});

async function createPendingPayment() {
  return Payment.create({
    customerId: 'cust_001',
    amount: 50,
    currency: 'USD',
    status: PaymentStatus.PENDING,
    maxRetries: 3,
  });
}

describe('Exponential backoff formula', () => {
  it('calculates correct delays', () => {
    const base = 1000;
    const max = 30000;
    expect(Math.min(base * Math.pow(2, 0), max)).toBe(1000);
    expect(Math.min(base * Math.pow(2, 1), max)).toBe(2000);
    expect(Math.min(base * Math.pow(2, 2), max)).toBe(4000);
    expect(Math.min(base * Math.pow(2, 10), max)).toBe(30000);
  });
});

describe('Concurrency control', () => {
  it('prevents duplicate PROCESSING via atomic findOneAndUpdate', async () => {
    const payment = await createPendingPayment();

    // Two workers race to claim the same payment simultaneously
    const [first, second] = await Promise.all([
      Payment.findOneAndUpdate(
        { _id: payment._id, status: PaymentStatus.PENDING },
        { $set: { status: PaymentStatus.PROCESSING } },
        { new: true }
      ),
      Payment.findOneAndUpdate(
        { _id: payment._id, status: PaymentStatus.PENDING },
        { $set: { status: PaymentStatus.PROCESSING } },
        { new: true }
      ),
    ]);

    // MongoDB serialises the two atomic ops — exactly one wins, one gets null
    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect((winners[0] as typeof first)?.status).toBe(PaymentStatus.PROCESSING);
  });

  it('final document status is PROCESSING after race', async () => {
    const payment = await createPendingPayment();

    await Promise.all([
      Payment.findOneAndUpdate(
        { _id: payment._id, status: PaymentStatus.PENDING },
        { $set: { status: PaymentStatus.PROCESSING } }
      ),
      Payment.findOneAndUpdate(
        { _id: payment._id, status: PaymentStatus.PENDING },
        { $set: { status: PaymentStatus.PROCESSING } }
      ),
    ]);

    const final = await Payment.findById(payment._id);
    expect(final?.status).toBe(PaymentStatus.PROCESSING);
  });
});

describe('Partial failure recovery (crash recovery)', () => {
  it('resets stuck PROCESSING payments to PENDING on startup', async () => {
    // Simulate a crash: payment left in PROCESSING state
    await Payment.create({
      customerId: 'cust_crash',
      amount: 99,
      currency: 'USD',
      status: PaymentStatus.PROCESSING,
      maxRetries: 3,
    });

    const enqueueSpy = jest.fn();
    const recovered = await recoverStuckPayments({ enqueue: enqueueSpy });

    expect(recovered).toBe(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const payment = await Payment.findOne({ customerId: 'cust_crash' });
    expect(payment?.status).toBe(PaymentStatus.PENDING);
  });

  it('does not touch SUCCESS or FAILED payments on startup', async () => {
    await Payment.create([
      { customerId: 'c1', amount: 10, currency: 'USD', status: PaymentStatus.SUCCESS, maxRetries: 3 },
      { customerId: 'c2', amount: 10, currency: 'USD', status: PaymentStatus.FAILED, maxRetries: 3 },
    ]);

    const enqueueSpy = jest.fn();
    const recovered = await recoverStuckPayments({ enqueue: enqueueSpy });

    expect(recovered).toBe(0);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
