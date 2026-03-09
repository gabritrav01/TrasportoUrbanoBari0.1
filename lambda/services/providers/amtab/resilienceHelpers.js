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

function buildResilienceErrorDetails(error, extras = {}) {
  const safeError = error || {};
  return {
    ...extras,
    code: safeError.code || 'UNKNOWN',
    retryable: isRetryableError(safeError),
    message: safeError.message || String(safeError),
    httpStatus: typeof safeError.httpStatus === 'number' ? safeError.httpStatus : null
  };
}

function logResilienceFailure(logger, message, error, extras = {}) {
  const safeLogger = logger || createNoopLogger();
  const details = buildResilienceErrorDetails(error, extras);
  if (typeof safeLogger.warn === 'function') {
    safeLogger.warn(message, details);
    return;
  }
  if (typeof safeLogger.error === 'function') {
    safeLogger.error(message, details);
  }
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

function createResilientExecutor(options = {}) {
  const logger = options.logger || createNoopLogger();
  const retryAdapter = options.retryAdapter || null;
  const resiliencePolicy = options.resiliencePolicy || {};
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  const timeoutsMs = {
    realtime:
      resiliencePolicy.timeoutsMs && typeof resiliencePolicy.timeoutsMs.realtime === 'number'
        ? resiliencePolicy.timeoutsMs.realtime
        : RESILIENCE_DEFAULTS.timeoutsMs.realtime,
    scheduled:
      resiliencePolicy.timeoutsMs && typeof resiliencePolicy.timeoutsMs.scheduled === 'number'
        ? resiliencePolicy.timeoutsMs.scheduled
        : RESILIENCE_DEFAULTS.timeoutsMs.scheduled,
    staticLookup:
      resiliencePolicy.timeoutsMs && typeof resiliencePolicy.timeoutsMs.staticLookup === 'number'
        ? resiliencePolicy.timeoutsMs.staticLookup
        : RESILIENCE_DEFAULTS.timeoutsMs.staticLookup
  };

  const circuitBreakerOptions = {
    realtime:
      (resiliencePolicy.circuitBreaker && resiliencePolicy.circuitBreaker.realtime) ||
      RESILIENCE_DEFAULTS.circuitBreaker.realtime,
    scheduled:
      (resiliencePolicy.circuitBreaker && resiliencePolicy.circuitBreaker.scheduled) ||
      RESILIENCE_DEFAULTS.circuitBreaker.scheduled,
    staticLookup:
      (resiliencePolicy.circuitBreaker && resiliencePolicy.circuitBreaker.staticLookup) ||
      RESILIENCE_DEFAULTS.circuitBreaker.staticLookup
  };

  const circuitBreakers = options.circuitBreakers || {
    realtime: createSimpleCircuitBreaker({ ...circuitBreakerOptions.realtime, now }),
    scheduled: createSimpleCircuitBreaker({ ...circuitBreakerOptions.scheduled, now }),
    staticLookup: createSimpleCircuitBreaker({ ...circuitBreakerOptions.staticLookup, now })
  };

  async function run(config = {}) {
    const operationName = config.operationName || 'amtab.operation';
    const category = config.category || 'staticLookup';
    const executeFn = config.executeFn;
    const suppressFailureLog =
      config.suppressFailureLog !== undefined ? Boolean(config.suppressFailureLog) : true;

    return executeWithResilience({
      operationName,
      category,
      timeoutMs: timeoutsMs[category] || RESILIENCE_DEFAULTS.timeoutsMs.staticLookup,
      retryAdapter,
      circuitBreaker: circuitBreakers[category] || null,
      logger,
      suppressFailureLog,
      executeFn
    });
  }

  return {
    run,
    timeoutsMs,
    circuitBreakers
  };
}

async function executeWithResilience(options = {}) {
  const operationName = options.operationName || 'amtab.operation';
  const category = options.category || 'scheduled';
  const logger = options.logger || createNoopLogger();
  const retryAdapter = options.retryAdapter || null;
  const circuitBreaker = options.circuitBreaker || null;
  const timeoutMs = options.timeoutMs || RESILIENCE_DEFAULTS.timeoutsMs.scheduled;
  const suppressFailureLog = options.suppressFailureLog === true;
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
    if (!suppressFailureLog) {
      logger.warn(`${operationName} failed (${category})`, {
        code: error && error.code ? error.code : 'UNKNOWN',
        retryable: isRetryableError(error)
      });
    }
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
  buildResilienceErrorDetails,
  logResilienceFailure,
  withTimeout,
  createSimpleCircuitBreaker,
  createResilientExecutor,
  executeWithResilience,
  selectBestArrivals,
  buildVoiceDegradationHint
};
