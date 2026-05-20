import mongoose, { Document, Schema } from 'mongoose';

export interface IIdempotencyRecord extends Document {
  key: string;
  responseStatus: number;
  responseBody: unknown;
  expiresAt: Date;
}

const IdempotencySchema = new Schema<IIdempotencyRecord>({
  key: { type: String, required: true, unique: true, index: true },
  responseStatus: { type: Number, required: true },
  responseBody: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
});

// TTL index — MongoDB auto-deletes expired records
IdempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyRecord = mongoose.model<IIdempotencyRecord>(
  'IdempotencyRecord',
  IdempotencySchema
);
