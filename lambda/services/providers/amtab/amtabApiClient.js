'use strict';

const { isProviderResult, unwrapProviderResultData } = require('../domain/providerShapes');

function createAmtabApiClient(options = {}) {
  const hooks = {
    searchStops: options.searchStops,
    nearestStops: options.nearestStops,
    searchLines: options.searchLines,
    getLinesServingStop: options.getLinesServingStop,
    resolveDestination: options.resolveDestination,
    findRoutes: options.findRoutes,
    getStopArrivals: options.getStopArrivals,
    getRealtimePredictions: options.getRealtimePredictions,
    getScheduledArrivals: options.getScheduledArrivals,
    ping: options.ping
  };

  async function callArrayHook(hookName, args) {
    const hook = hooks[hookName];
    if (typeof hook !== 'function') {
      return [];
    }
    const response = await hook(...args);
    if (Array.isArray(response)) {
      return response;
    }

    if (isProviderResult(response)) {
      if (response.ok === false && response.error) {
        console.error(`AMTAB apiClient hook returned ProviderResult error for ${hookName}`, response.error);
      }
      return unwrapProviderResultData(response);
    }

    return [];
  }

  async function callBooleanHook(hookName, args, fallbackValue) {
    const hook = hooks[hookName];
    if (typeof hook !== 'function') {
      return fallbackValue;
    }
    const response = await hook(...args);
    if (isProviderResult(response)) {
      return Boolean(response.ok);
    }
    return Boolean(response);
  }

  return {
    async searchStops(query) {
      return callArrayHook('searchStops', [query]);
    },

    async nearestStops(lat, lon, limit) {
      return callArrayHook('nearestStops', [lat, lon, limit]);
    },

    async searchLines(query) {
      return callArrayHook('searchLines', [query]);
    },

    async getLinesServingStop(stopId) {
      return callArrayHook('getLinesServingStop', [stopId]);
    },

    async resolveDestination(query) {
      return callArrayHook('resolveDestination', [query]);
    },

    async findRoutes(originStopIds, destinationTargetIds) {
      return callArrayHook('findRoutes', [originStopIds, destinationTargetIds]);
    },

    async getStopArrivals(stopId) {
      return callArrayHook('getStopArrivals', [stopId]);
    },

    async getRealtimePredictions(stopId, lineId) {
      return callArrayHook('getRealtimePredictions', [stopId, lineId]);
    },

    async getScheduledArrivals(stopId, lineId) {
      return callArrayHook('getScheduledArrivals', [stopId, lineId]);
    },

    async ping() {
      return callBooleanHook('ping', [], true);
    }
  };
}

module.exports = {
  createAmtabApiClient
};
