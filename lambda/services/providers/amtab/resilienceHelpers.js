'use strict';

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const RESILIENCE_DEFAULTS = Object.freeze({
  timeoutsMs: {
    realtime: 1400,
    scheduled: 2200,
    staticLookup: 2500
  },
  circuitBreaker: {
    realtime: { failureThreshold: 4, openIntervalMs: 30000, halfOpenMaxCalls: 1 },
    scheduled: { failureThreshold: 5, openIntervalMs: 45000, halfOpenMaxCalls: 1 },
    staticLookup: { failureThreshold: 6, openIntervalMs: 60000, halfOpenMaxCalls: 1 }
  }
});

function createNoopLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

function createTimeoutError(operationName, timeoutMs) {
  const error = new Error(`${operationName || 'operation'} timed out after ${timeoutMs}ms`);
  error.code = 'TIMEOUT';
  error.timeoutMs = timeoutMs;
  error.retryable = true;
  return error;
}

function isRetryableError(error) {
  if (!error) {
    return false;
  }

  if (error.retryable === true) {
    return true;
  }

  if (error.code && ['TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) {
    return true;
  }

  if (typeof error.httpStatus === 'number' && RETRYABLE_HTTP_STATUS.has(error.httpStatus)) {
    return true;
  }

  return false;
}

async function withTimeout(operationFn, timeoutMs, operationName) {
  if (typeof operationFn !== 'function') {
    throw new Error('withTimeout requires an operation function');
  }

  const safeTimeoutMs = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 2000;
  let timeoutHandle = null;
  try {
    return await Promise.race([
      operationFn(),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createTimeoutError(operationName, safeTimeoutMs));
        }, safeTimeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function createSimpleCircuitBreaker(options = {}) {
  const failureThreshold =
    typeof options.failureThreshold === 'number' && options.failureThreshold > 0
      ? Math.floor(options.failureThreshold)
      : 5;
  const openIntervalMs =
    typeof options.openIntervalMs === 'number' && options.openIntervalMs > 0 ? options.openIntervalMs : 30000;
  const halfOpenMaxCalls =
    typeof options.halfOpenMaxCalls === 'number' && options.halfOpenMaxCalls > 0
      ? Math.floor(options.halfOpenMaxCalls)
      : 1;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  let state = 'CLOSED';
  let consecutiveFailures = 0;
  let openedAtEpochMs = 0;
  let halfOpenCalls = 0;
  let lastError = null;

  function moveToOpen(error) {
    state = 'OPEN';
    openedAtEpochMs = now();
    lastError = error || null;
    halfOpenCalls = 0;
  }

  function moveToHalfOpen() {
    state = 'HALF_OPEN';
    halfOpenCalls = 0;
  }

  function moveToClosed() {
    state = 'CLOSED';
    consecutiveFailures = 0;
    openedAtEpochMs = 0;
    lastError = null;
    halfOpenCalls = 0;
  }

  function getState() {
    if (state === 'OPEN') {
      const elapsed = now() - openedAtEpochMs;
      if (elapsed >= openIntervalMs) {
        moveToHalfOpen();
      }
    }

    return {
      state,
      consecutiveFailures,
      openedAtEpochMs,
      lastError
    };
  }

  function canExecute() {
    const snapshot = getState();
    if (snapshot.state === 'OPEN') {
      return false;
    }
    if (snapshot.state === 'HALF_OPEN' && halfOpenCalls >= halfOpenMaxCalls) {
      return false;
    }
    if (snapshot.state === 'HALF_OPEN') {
      halfOpenCalls += 1;
    }
    return true;
  }

  function recordSuccess() {
    moveToClosed();
  }

  function recordFailure(error) {
    consecutiveFailures += 1;
    lastError = error || null;

    if (state === 'HALF_OPEN') {
      moveToOpen(error);
      return;
    }

    if (consecutiveFailures >= failureThreshold) {
      moveToOpen(error);
    }
  }

  return {
    canExecute,
    recordSuccess,
    recordFailure,
    getState
  };
}

async function executeWithResilience(options = {}) {
  const operationName = options.operationName || 'amtab.operation';
  const category = options.category || 'scheduled';
  const logger = options.logger || createNoopLogger();
  const retryAdapter = options.retryAdapter || null;
  const circuitBreaker = options.circuitBreaker || null;
  const timeoutMs = options.timeoutMs || RESILIENCE_DEFAULTS.timeoutsMs.scheduled;
  const executeFn = options.executeFn;

  if (typeof executeFn !== 'function') {
    throw new Error(`${operationName}: executeFn is required`);
  }

  if (circuitBreaker && !circuitBreaker.canExecute()) {
    const error = new Error(`${operationName}: circuit open`);
    error.code = 'CIRCUIT_OPEN';
    error.retryable = true;
    throw error;
  }

  try {
    const result = retryAdapter && typeof retryAdapter.execute === 'function'
      ? await withTimeout(
          () => retryAdapter.execute(`${operationName}.${category}`, executeFn),
          timeoutMs,
          operationName
        )
      : await withTimeout(executeFn, timeoutMs, operationName);

    if (circuitBreaker) {
      circuitBreaker.recordSuccess();
    }
    return result;
  } catch (error) {
    if (circuitBreaker) {
      circuitBreaker.recordFailure(error);
    }
    logger.warn(`${operationName} failed (${category})`, {
      code: error && error.code ? error.code : 'UNKNOWN',
      retryable: isRetryableError(error)
    });
    throw error;
  }
}

function selectBestArrivals(primaryArrivals, fallbackArrivals) {
  const primary = Array.isArray(primaryArrivals) ? primaryArrivals : [];
  if (primary.length) {
    return primary;
  }
  return Array.isArray(fallbackArrivals) ? fallbackArrivals : [];
}

function buildVoiceDegradationHint(context = {}) {
  const reason = context.reason || 'unknown';
  const usedPredictionType = context.usedPredictionType || null;
  const sourceTier = context.sourceTier || null;

  if (reason === 'realtime_unavailable' && usedPredictionType === 'scheduled') {
    return 'In questo momento i tempi in tempo reale non sono disponibili. Ti leggo gli orari programmati.';
  }
  if (reason === 'official_down' && sourceTier === 'secondary') {
    return 'Sto usando una fonte alternativa. I tempi potrebbero variare.';
  }
  if (reason === 'arrivals_missing_but_destination_found') {
    return 'Ho trovato la destinazione, ma non vedo passaggi imminenti.';
  }
  if (reason === 'degraded_no_arrivals') {
    return 'Al momento non riesco a recuperare passaggi attendibili.';
  }
  return '';
}

module.exports = {
  RESILIENCE_DEFAULTS,
  RETRYABLE_HTTP_STATUS,
  isRetryableError,
  withTimeout,
  createSimpleCircuitBreaker,
  executeWithResilience,
  selectBestArrivals,
  buildVoiceDegradationHint
};
