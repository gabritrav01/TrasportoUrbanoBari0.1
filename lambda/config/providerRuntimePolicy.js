'use strict';

const PROVIDER_RUNTIME_POLICY = Object.freeze({
  cache: {
    adapter: {
      defaultTtlMs: 30000,
      defaultStaleIfErrorTtlMs: 0,
      defaultNegativeTtlMs: 5000,
      defaultInFlightDedupe: true,
      maxEntries: 3000
    },
    stop: {
      searchTtlMs: 5 * 60 * 1000,
      searchStaleIfErrorTtlMs: 20 * 60 * 1000,
      searchNegativeTtlMs: 20 * 1000,
      nearestTtlMs: 20 * 1000,
      nearestStaleIfErrorTtlMs: 60 * 1000,
      nearestNegativeTtlMs: 8 * 1000
    },
    line: {
      searchTtlMs: 5 * 60 * 1000,
      searchStaleIfErrorTtlMs: 20 * 60 * 1000,
      searchNegativeTtlMs: 25 * 1000,
      byStopTtlMs: 60 * 1000,
      byStopStaleIfErrorTtlMs: 3 * 60 * 1000,
      byStopNegativeTtlMs: 15 * 1000
    },
    destination: {
      resolveTtlMs: 10 * 60 * 1000
    },
    arrival: {
      realtimeTtlMs: 12 * 1000,
      realtimeStaleIfErrorTtlMs: 30 * 1000,
      realtimeNegativeTtlMs: 5 * 1000,
      scheduledTtlMs: 90 * 1000,
      scheduledStaleIfErrorTtlMs: 5 * 60 * 1000,
      scheduledNegativeTtlMs: 15 * 1000,
      stopArrivalsTtlMs: 10 * 1000,
      stopArrivalsStaleIfErrorTtlMs: 45 * 1000,
      stopArrivalsNegativeTtlMs: 7 * 1000
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
      direct: 0.82,
      caution: 0.62,
      degraded: 0.45
    },
    allowScheduledDirect: false
  }
});

module.exports = {
  PROVIDER_RUNTIME_POLICY
};
