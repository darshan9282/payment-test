import { v4 as uuidv4 } from 'uuid';
import { GatewayResponse } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { gatewayCircuitBreaker } from './circuit-breaker.service';

const GATEWAY_ERRORS = [
  { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' },
  { code: 'CARD_DECLINED', message: 'Card declined by issuer' },
  { code: 'INVALID_CARD', message: 'Invalid card details' },
  { code: 'PROCESSING_ERROR', message: 'Gateway processing error' },
  { code: 'FRAUD_DETECTED', message: 'Transaction flagged as fraudulent' },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulateGatewayRequest(amount: number, currency: string): Promise<GatewayResponse> {
  const { successRate, timeoutRate, minDelayMs, maxDelayMs, timeoutMs } = config.gateway;

  const delay = Math.random() * (maxDelayMs - minDelayMs) + minDelayMs;
  const rand = Math.random();

  // Race: simulate network delay vs timeout
  const delayPromise = sleep(delay).then((): GatewayResponse => {
    const failureRate = 1 - successRate - timeoutRate;

    if (rand < timeoutRate) {
      // This branch won't be hit since timeout wins the race below
      throw new Error('Gateway timeout');
    }

    if (rand < timeoutRate + failureRate) {
      const err = GATEWAY_ERRORS[Math.floor(Math.random() * GATEWAY_ERRORS.length)];
      return { success: false, error: err.message, code: err.code };
    }

    return { success: true, transactionId: `txn_${uuidv4()}` };
  });

  if (rand < timeoutRate) {
    const timeoutPromise = sleep(timeoutMs).then((): never => {
      throw new Error('Gateway request timed out');
    });
    return Promise.race([delayPromise, timeoutPromise]);
  }

  return delayPromise;
}

export async function chargePayment(
  paymentId: string,
  amount: number,
  currency: string
): Promise<GatewayResponse> {
  logger.info('Charging via external gateway', { paymentId, amount, currency });

  try {
    const response = await gatewayCircuitBreaker.execute(() =>
      simulateGatewayRequest(amount, currency)
    );
    logger.info('Gateway response received', { paymentId, success: response.success });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown gateway error';
    logger.error('Gateway call failed', { paymentId, error: message });
    return { success: false, error: message, code: 'GATEWAY_ERROR' };
  }
}
