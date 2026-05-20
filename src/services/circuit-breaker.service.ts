import { CircuitBreakerState } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;

  constructor(
    private readonly failureThreshold = config.circuitBreaker.failureThreshold,
    private readonly recoveryTimeout = config.circuitBreaker.recoveryTimeout,
    private readonly halfOpenMaxCalls = config.circuitBreaker.halfOpenMaxCalls
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.recoveryTimeout) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenCalls = 0;
        logger.info('Circuit breaker → HALF_OPEN');
      } else {
        throw new Error('Circuit breaker is OPEN — gateway temporarily unavailable');
      }
    }

    if (
      this.state === CircuitBreakerState.HALF_OPEN &&
      this.halfOpenCalls >= this.halfOpenMaxCalls
    ) {
      throw new Error('Circuit breaker HALF_OPEN — probe call limit reached');
    }

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenCalls++;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      logger.info('Circuit breaker → CLOSED (recovered)');
    }
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (
      this.state === CircuitBreakerState.HALF_OPEN ||
      this.failureCount >= this.failureThreshold
    ) {
      this.state = CircuitBreakerState.OPEN;
      logger.warn(`Circuit breaker → OPEN (failures: ${this.failureCount})`);
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getStats(): { state: CircuitBreakerState; failureCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenCalls = 0;
  }
}

export const gatewayCircuitBreaker = new CircuitBreaker();
