import mongoose, { Document, Schema } from 'mongoose';
import { PaymentStatus } from '../types';

export interface IPayment extends Document {
  customerId: string;
  amount: number;
  currency: string;
  description?: string;
  status: PaymentStatus;
  retryCount: number;
  maxRetries: number;
  transactionId?: string;
  gatewayError?: string;
  nextRetryAt?: Date;
  processedAt?: Date;
  failedAt?: Date;
  metadata?: Record<string, unknown>;
  webhookReceived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    customerId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      validate: { validator: (v: string) => /^[A-Z]{3}$/.test(v), message: 'Invalid currency' },
    },
    description: { type: String },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
      index: true,
    },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    transactionId: { type: String, sparse: true },
    gatewayError: { type: String },
    nextRetryAt: { type: Date },
    processedAt: { type: Date },
    failedAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
    webhookReceived: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    versionKey: '__v',
  }
);

// Composite index for retry queue polling
PaymentSchema.index({ status: 1, nextRetryAt: 1 });
PaymentSchema.index({ customerId: 1, createdAt: -1 });

export const Payment = mongoose.model<IPayment>('Payment', PaymentSchema);
