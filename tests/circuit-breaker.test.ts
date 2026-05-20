import { CircuitBreaker } from '../src/services/circuit-breaker.service';
import { CircuitBreakerState } from '../src/types';

function failingOp(): Promise<never> {
  return Promise.reject(new Error('Simulated failure'));
}

function successOp(): Promise<string> {
  return Promise.resolve('ok');
}

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    // threshold=3, recovery=100ms, halfOpenMax=1
    cb = new CircuitBreaker(3, 100, 1);
  });

  it('starts in CLOSED state', () => {
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
  });

  it('executes operation successfully when CLOSED', async () => {
    const result = await cb.execute(successOp);
    expect(result).toBe('ok');
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
  });

  it('opens after failure threshold is reached', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(failingOp).catch(() => null);
    }
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
  });

  it('fast-fails without calling operation when OPEN', async () => {
    // Force open
    for (let i = 0; i < 3; i++) {
      await cb.execute(failingOp).catch(() => null);
    }

    const spy = jest.fn().mockResolvedValue('should not be called');
    await expect(cb.execute(spy)).rejects.toThrow('Circuit breaker is OPEN');
    expect(spy).not.toHaveBeenCalled();
  });

  it('transitions to HALF_OPEN after recovery timeout', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(failingOp).catch(() => null);
    }
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

    await new Promise((r) => setTimeout(r, 150)); // wait past recovery timeout

    // Next call should trigger HALF_OPEN probe
    await cb.execute(successOp).catch(() => null);
    // After success in half-open, should close
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
  });

  it('reopens on failure during HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(failingOp).catch(() => null);
    }

    await new Promise((r) => setTimeout(r, 150));

    await cb.execute(failingOp).catch(() => null);
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
  });

  it('limits probe calls in HALF_OPEN state', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(failingOp).catch(() => null);
    }

    await new Promise((r) => setTimeout(r, 150));

    // First probe: allowed (but we make it hang via a slow promise)
    const slowOp = () => new Promise<string>((r) => setTimeout(() => r('ok'), 500));
    cb.execute(slowOp).catch(() => null); // don't await, kick it off

    // Second probe should be rejected immediately due to halfOpenMaxCalls=1
    await expect(cb.execute(successOp)).rejects.toThrow('probe call limit reached');
  });

  it('resets to CLOSED via reset()', () => {
    cb.reset();
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(cb.getStats().failureCount).toBe(0);
  });

  it('exposes stats', async () => {
    await cb.execute(failingOp).catch(() => null);
    const stats = cb.getStats();
    expect(stats.failureCount).toBe(1);
    expect(stats.lastFailureTime).toBeGreaterThan(0);
  });
});
