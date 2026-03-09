'use strict';

const PROVIDER_RUNTIME_POLICY = Object.freeze({
  cache: {
    adapter: {
      defaultTtlMs: 30000,
      maxEntries: 3000
    },
    stop: {
      searchTtlMs: 5 * 60 * 1000,
      nearestTtlMs: 20 * 1000
    },
    line: {
      searchTtlMs: 5 * 60 * 1000,
      byStopTtlMs: 60 * 1000
    },
    destination: {
      resolveTtlMs: 10 * 60 * 1000
    },
    arrival: {
      realtimeTtlMs: 12 * 1000,
      scheduledTtlMs: 90 * 1000,
      stopArrivalsTtlMs: 10 * 1000
    }
  },
  resilience: {
    timeoutsMs: {
      realtime: 1400,
      scheduled: 2200,
      staticLookup: 2500
    },
    circuitBreaker: {
      realtime: {
        failureThreshold: 4,
        openIntervalMs: 30000,
        halfOpenMaxCalls: 1
      },
      scheduled: {
        failureThreshold: 5,
        openIntervalMs: 45000,
        halfOpenMaxCalls: 1
      },
      staticLookup: {
        failureThreshold: 6,
        openIntervalMs: 60000,
        halfOpenMaxCalls: 1
      }
    }
  },
  reliability: {
    thresholds: {
      direct: 0.8,
      disclaimer: 0.6
    }
  }
});

module.exports = {
  PROVIDER_RUNTIME_POLICY
};
