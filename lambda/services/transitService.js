'use strict';

const { createTransportService } = require('./transportService');
const { createAmtabProvider } = require('./providers/amtabProvider');
const { createMoovitFallbackProvider } = require('./providers/moovitFallbackProvider');
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

function createTransitService() {
  const transportDataMode = resolveTransportDataMode(process.env.TRANSPORT_DATA_MODE);
  const moovitFallbackEnabled = resolveBooleanFlag(process.env.MOOVIT_FALLBACK_ENABLED, false);
  const amtabDefaultSource = transportDataMode === TRANSPORT_DATA_MODES.AMTAB_REAL ? 'official' : 'fallback';
  const amtabDefaultSourceName =
    transportDataMode === TRANSPORT_DATA_MODES.AMTAB_REAL ? 'amtab_primary' : 'amtab_stub_local';

  const amtabProvider = createAmtabProvider({
    // TODO(AMTAB_CONFIG): valorizzare con endpoint/token ufficiali.
    apiBaseUrl: process.env.AMTAB_API_BASE_URL || '',
    apiKey: process.env.AMTAB_API_KEY || '',
    cachePolicy: PROVIDER_RUNTIME_POLICY.cache,
    resiliencePolicy: PROVIDER_RUNTIME_POLICY.resilience,
    reliabilityPolicy: PROVIDER_RUNTIME_POLICY.reliability,
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

  return createTransportService({
    primaryProvider: amtabProvider,
    fallbackProvider
  });
}

module.exports = {
  createTransitService
};
