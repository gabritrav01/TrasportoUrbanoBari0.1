'use strict';

const {
  withTimeout,
  isRetryableError,
  createSimpleCircuitBreaker,
  executeWithResilience
} = require('../../services/providers/amtab/resilienceHelpers');

describe('AMTAB resilience helpers', () => {
  test('withTimeout returns result when operation completes in time', async () => {
    const result = await withTimeout(async () => 'ok', 50, 'quick-op');
    expect(result).toBe('ok');
  });

  test('withTimeout throws TIMEOUT on slow operations', async () => {
    await expect(withTimeout(() => new Promise(() => {}), 15, 'slow-op')).rejects.toEqual(
      expect.objectContaining({
        code: 'TIMEOUT',
        retryable: true
      })
    );
  });

  test('isRetryableError recognizes retryable network-like failures', () => {
    expect(isRetryableError({ code: 'TIMEOUT' })).toBe(true);
    expect(isRetryableError({ httpStatus: 503 })).toBe(true);
    expect(isRetryableError({ code: 'VALIDATION', httpStatus: 400 })).toBe(false);
  });

  test('circuit breaker opens after threshold and recovers to half-open/closed', () => {
    let nowMs = 0;
    const breaker = createSimpleCircuitBreaker({
      failureThreshold: 2,
      openIntervalMs: 100,
      now: () => nowMs
    });

    expect(breaker.canExecute()).toBe(true);
    breaker.recordFailure(new Error('first failure'));
    expect(breaker.getState().state).toBe('CLOSED');

    breaker.recordFailure(new Error('second failure'));
    expect(breaker.getState().state).toBe('OPEN');
    expect(breaker.canExecute()).toBe(false);

    nowMs = 120;
    expect(breaker.canExecute()).toBe(true);
    expect(breaker.getState().state).toBe('HALF_OPEN');

    breaker.recordSuccess();
    expect(breaker.getState().state).toBe('CLOSED');
  });

  test('executeWithResilience rejects when circuit is open', async () => {
    const breaker = createSimpleCircuitBreaker({
      failureThreshold: 1,
      openIntervalMs: 1000,
      now: () => 0
    });
    breaker.recordFailure(new Error('boom'));

    await expect(
      executeWithResilience({
        operationName: 'amtab.test',
        category: 'realtime',
        timeoutMs: 20,
        circuitBreaker: breaker,
        executeFn: async () => 'ok'
      })
    ).rejects.toEqual(expect.objectContaining({ code: 'CIRCUIT_OPEN' }));
  });

  test('executeWithResilience uses retry adapter when provided', async () => {
    const retryAdapter = {
      execute: jest.fn(async (_name, operationFn) => operationFn())
    };

    const result = await executeWithResilience({
      operationName: 'amtab.retry',
      category: 'scheduled',
      timeoutMs: 30,
      retryAdapter,
      executeFn: async () => 'retried-result'
    });

    expect(result).toBe('retried-result');
    expect(retryAdapter.execute).toHaveBeenCalledTimes(1);
  });
});