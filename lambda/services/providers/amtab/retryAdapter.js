'use strict';

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createRetryAdapter(options = {}) {
  const maxAttempts = typeof options.maxAttempts === 'number' && options.maxAttempts > 0 ? options.maxAttempts : 2;
  const baseDelayMs =
    typeof options.baseDelayMs === 'number' && options.baseDelayMs >= 0 ? options.baseDelayMs : 120;
  const maxDelayMs = typeof options.maxDelayMs === 'number' && options.maxDelayMs > 0 ? options.maxDelayMs : 1000;
  const jitterMs = typeof options.jitterMs === 'number' && options.jitterMs >= 0 ? options.jitterMs : 25;
  const shouldRetry =
    typeof options.shouldRetry === 'function'
      ? options.shouldRetry
      : (error) => !error || error.retryable !== false;

  async function execute(operationName, operationFn) {
    const safeOperationName = operationName || 'amtab.operation';
    if (typeof operationFn !== 'function') {
      throw new Error(`${safeOperationName}: operationFn must be a function`);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operationFn();
      } catch (error) {
        lastError = error;
        const canRetry = attempt < maxAttempts && shouldRetry(error, { attempt, maxAttempts, operationName: safeOperationName });
        if (!canRetry) {
          throw error;
        }

        const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
        await wait(exponential + jitter);
      }
    }

    throw lastError || new Error(`${safeOperationName}: retry adapter failed without explicit error`);
  }

  return {
    execute
  };
}

module.exports = {
  createRetryAdapter
};
