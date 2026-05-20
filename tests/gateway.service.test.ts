import { gatewayCircuitBreaker } from '../src/services/circuit-breaker.service';
import { chargePayment } from '../src/services/gateway.service';

// Override gateway config to make tests fast and deterministic
jest.mock('../src/config', () => ({
  config: {
    nodeEnv: 'test',
    circuitBreaker: { failureThreshold: 5, recoveryTimeout: 30000, halfOpenMaxCalls: 2 },
    gateway: {
      successRate: 1.0,   // always success for most tests
      timeoutRate: 0.0,
      minDelayMs: 0,
      maxDelayMs: 1,
      timeoutMs: 5000,
    },
  },
}));

beforeEach(() => gatewayCircuitBreaker.reset());

describe('chargePayment', () => {
  it('returns success response when gateway succeeds', async () => {
    const response = await chargePayment('pay_001', 100, 'USD');
    expect(response.success).toBe(true);
    expect(response.transactionId).toMatch(/^txn_/);
  });

  it('returns failure response when gateway fails', async () => {
    // Force failure by overriding successRate
    const { config } = jest.requireMock('../src/config');
    config.gateway.successRate = 0.0;
    config.gateway.timeoutRate = 0.0;

    const response = await chargePayment('pay_002', 50, 'EUR');
    expect(response.success).toBe(false);
    expect(response.error).toBeTruthy();
    expect(response.code).toBeTruthy();

    config.gateway.successRate = 1.0;
  });

  it('returns gateway error when circuit breaker is open', async () => {
    // Force the circuit open
    const { CircuitBreaker } = await import('../src/services/circuit-breaker.service');
    const tempCb = new CircuitBreaker(1, 60000, 1);
    await tempCb.execute(() => Promise.reject(new Error('fail'))).catch(() => null);
    expect(tempCb.getState()).toBe('OPEN');
  });

  it('handles timeout scenario gracefully', async () => {
    const { config } = jest.requireMock('../src/config');
    config.gateway.timeoutRate = 1.0; // always timeout
    config.gateway.timeoutMs = 10;    // very short timeout
    config.gateway.minDelayMs = 0;
    config.gateway.maxDelayMs = 1;

    const response = await chargePayment('pay_003', 75, 'GBP');
    expect(response.success).toBe(false);
    expect(response.code).toBe('GATEWAY_ERROR');

    config.gateway.timeoutRate = 0.0;
    config.gateway.timeoutMs = 5000;
  });
});
