export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  customerId: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayResponse {
  success: boolean;
  transactionId?: string;
  error?: string;
  code?: string;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
}

export interface WebhookPayload {
  paymentId: string;
  status: string;
  transactionId?: string;
  timestamp: string;
  signature?: string;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}
