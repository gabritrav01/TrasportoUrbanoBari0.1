'use strict';

const { createTransportService } = require('./transportService');
const { createAmtabProvider } = require('./providers/amtabProvider');
const { createMoovitFallbackProvider } = require('./providers/moovitFallbackProvider');
const { createAmtabRealGateway } = require('./providers/amtab/amtabRealGateway');
const { PROVIDER_RUNTIME_POLICY } = require('../config/providerRuntimePolicy');

const TRANSPORT_DATA_MODES = Object.freeze({
  STUB: 'stub',
  AMTAB_REAL: 'amtab_real'
});

function resolveTransportDataMode(rawValue) {
  const normalized = String(rawValue || TRANSPORT_DATA_MODES.STUB).trim().toLowerCase();
  if (normalized === TRANSPORT_DATA_MODES.AMTAB_REAL) {
    return TRANSPORT_DATA_MODES.AMTAB_REAL;
  }
  return TRANSPORT_DATA_MODES.STUB;
}

function resolveBooleanFlag(rawValue, fallbackValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return Boolean(fallbackValue);
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return Boolean(fallbackValue);
}

function createGatewayHookWithFallbackLog({ methodName, gatewayMethod, logger }) {
  return async (...args) => {
    try {
      return await gatewayMethod(...args);
    } catch (error) {
      logger.warn(
        `[TransitService] amtab_real ${methodName} failed -> fallback to provider stub catalog`,
        {
          code: error && error.code ? error.code : 'UNKNOWN',
          message: error && error.message ? error.message : String(error)
        }
      );
      throw error;
    }
  };
}

function createTransitService() {
  const logger = console;
  const transportDataMode = resolveTransportDataMode(process.env.TRANSPORT_DATA_MODE);
  const moovitFallbackEnabled = resolveBooleanFlag(process.env.MOOVIT_FALLBACK_ENABLED, false);
  let effectiveMode = transportDataMode;
  let amtabRealGateway = null;

  if (transportDataMode === TRANSPORT_DATA_MODES.AMTAB_REAL) {
    try {
      amtabRealGateway = createAmtabRealGateway({
        stopsFeedUrl: process.env.AMTAB_REAL_STOPS_FEED_URL,
        tripUpdatesUrl: process.env.AMTAB_REAL_TRIP_UPDATES_URL,
        requestTimeoutMs: process.env.AMTAB_REAL_GATEWAY_TIMEOUT_MS
          ? Number(process.env.AMTAB_REAL_GATEWAY_TIMEOUT_MS)
          : undefined,
        reliabilityPolicy: PROVIDER_RUNTIME_POLICY.reliability,
        logger
      });
      logger.info('[TransitService] TRANSPORT_DATA_MODE=amtab_real -> AMTAB real gateway enabled');
    } catch (error) {
      effectiveMode = TRANSPORT_DATA_MODES.STUB;
      amtabRealGateway = null;
      logger.warn('[TransitService] AMTAB real gateway initialization failed -> using stub mode', {
        code: error && error.code ? error.code : 'UNKNOWN',
        message: error && error.message ? error.message : String(error)
      });
    }
  } else {
    logger.info('[TransitService] TRANSPORT_DATA_MODE=stub -> using local stub catalog only');
  }

  const amtabDefaultSource = effectiveMode === TRANSPORT_DATA_MODES.AMTAB_REAL ? 'official' : 'fallback';
  const amtabDefaultSourceName =
    effectiveMode === TRANSPORT_DATA_MODES.AMTAB_REAL ? 'amtab_primary' : 'amtab_stub_local';

  const providerHooks = amtabRealGateway
    ? {
      searchStops: createGatewayHookWithFallbackLog({
        methodName: 'searchStops',
        gatewayMethod: (query) => amtabRealGateway.searchStops(query),
        logger
      }),
      searchLines: createGatewayHookWithFallbackLog({
        methodName: 'searchLines',
        gatewayMethod: (query) => amtabRealGateway.searchLines(query),
        logger
      }),
      getStopArrivals: createGatewayHookWithFallbackLog({
        methodName: 'getStopArrivals',
        gatewayMethod: (stopId) => amtabRealGateway.getStopArrivals(stopId),
        logger
      }),
      getRealtimePredictions: createGatewayHookWithFallbackLog({
        methodName: 'getRealtimePredictions',
        gatewayMethod: (stopId, lineId) => amtabRealGateway.getRealtimePredictions(stopId, lineId),
        logger
      }),
      getScheduledArrivals: createGatewayHookWithFallbackLog({
        methodName: 'getScheduledArrivals',
        gatewayMethod: (stopId, lineId) => amtabRealGateway.getScheduledArrivals(stopId, lineId),
        logger
      }),
      ping: createGatewayHookWithFallbackLog({
        methodName: 'ping',
        gatewayMethod: () => amtabRealGateway.ping(),
        logger
      })
    }
    : {};

  const amtabProvider = createAmtabProvider({
    // TODO(AMTAB_CONFIG): valorizzare con endpoint/token ufficiali.
    apiBaseUrl: process.env.AMTAB_API_BASE_URL || '',
    apiKey: process.env.AMTAB_API_KEY || '',
    cachePolicy: PROVIDER_RUNTIME_POLICY.cache,
    resiliencePolicy: PROVIDER_RUNTIME_POLICY.resilience,
    reliabilityPolicy: PROVIDER_RUNTIME_POLICY.reliability,
    runtimeDataMode: effectiveMode,
    logger,
    ...providerHooks,
    defaultSource: amtabDefaultSource,
    defaultSourceName: amtabDefaultSourceName
  });

  const fallbackProvider = moovitFallbackEnabled
    ? createMoovitFallbackProvider({
      // TODO(MOOVIT_CONFIG): valorizzare solo se fallback realmente autorizzato.
      apiBaseUrl: process.env.MOOVIT_API_BASE_URL || '',
      apiKey: process.env.MOOVIT_API_KEY || '',
      defaultSource: 'fallback',
      defaultSourceName: 'moovit_fallback'
    })
    : null;

  if (!fallbackProvider) {
    logger.info('[TransitService] Moovit fallback provider disabled (default)');
  }

  return createTransportService({
    primaryProvider: amtabProvider,
    fallbackProvider,
    runtimeDataMode: effectiveMode,
    logger
  });
}

module.exports = {
  createTransitService
};
