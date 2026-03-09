'use strict';

const { TransportProvider } = require('./transportProvider');
const { STOPS, DESTINATION_TARGETS, LINES } = require('./stubCatalog');
const { createAmtabNormalizer } = require('./amtab/normalizer');
const { createMemoryCacheAdapter } = require('./amtab/cacheAdapter');
const { createRetryAdapter } = require('./amtab/retryAdapter');
const { createAmtabApiClient } = require('./amtab/amtabApiClient');
const { createStopDataSource } = require('./amtab/stopDataSource');
const { createLinesDataSource } = require('./amtab/linesDataSource');
const { createDestinationResolverAdapter } = require('./amtab/destinationResolverAdapter');
const { createArrivalsDataSource } = require('./amtab/arrivalsDataSource');
const { createRoutePlanner } = require('./amtab/routePlanner');

function createRawCatalog(catalogOverride) {
  const override = catalogOverride || {};
  return {
    stops: Array.isArray(override.stops) ? override.stops : STOPS,
    destinationTargets: Array.isArray(override.destinationTargets)
      ? override.destinationTargets
      : DESTINATION_TARGETS,
    lines: Array.isArray(override.lines) ? override.lines : LINES
  };
}

function createNormalizedCatalog(rawCatalog, normalizer) {
  return {
    stops: (rawCatalog.stops || []).map((stop) => normalizer.normalizeStop(stop)).filter(Boolean),
    destinationTargets: (rawCatalog.destinationTargets || [])
      .map((destinationTarget) => normalizer.normalizeDestinationTarget(destinationTarget))
      .filter(Boolean),
    lines: (rawCatalog.lines || []).map((line) => normalizer.normalizeLine(line)).filter(Boolean)
  };
}

class AmtabProvider extends TransportProvider {
  constructor(options = {}) {
    super('amtab-provider');
    this.options = options;
    this.cachePolicy = options.cachePolicy || {};
    this.resiliencePolicy = options.resiliencePolicy || {};
    this.reliabilityPolicy = options.reliabilityPolicy || {};
    this.defaultSource = typeof options.defaultSource === 'string' ? options.defaultSource : 'fallback';
    this.defaultSourceName =
      typeof options.defaultSourceName === 'string' ? options.defaultSourceName : this.providerName;

    this.normalizer = options.normalizer || createAmtabNormalizer();
    this.cacheAdapter =
      options.cacheAdapter ||
      createMemoryCacheAdapter({
        defaultTtlMs:
          this.cachePolicy.adapter && typeof this.cachePolicy.adapter.defaultTtlMs === 'number'
            ? this.cachePolicy.adapter.defaultTtlMs
            : 30000,
        maxEntries:
          this.cachePolicy.adapter && typeof this.cachePolicy.adapter.maxEntries === 'number'
            ? this.cachePolicy.adapter.maxEntries
            : 2500
      });
    this.retryAdapter =
      options.retryAdapter ||
      createRetryAdapter({
        maxAttempts: typeof options.maxAttempts === 'number' ? options.maxAttempts : 2,
        baseDelayMs: typeof options.retryBaseDelayMs === 'number' ? options.retryBaseDelayMs : 120
      });

    this.apiClient =
      options.apiClient ||
      createAmtabApiClient({
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
      });

    const rawCatalog = createRawCatalog(options.catalog);
    this.catalog = createNormalizedCatalog(rawCatalog, this.normalizer);

    this.stopDataSource =
      options.stopDataSource ||
      createStopDataSource({
        catalog: this.catalog,
        normalizer: this.normalizer,
        cacheAdapter: this.cacheAdapter,
        apiClient: this.apiClient,
        retryAdapter: this.retryAdapter,
        defaultLimit: typeof options.nearestStopsLimit === 'number' ? options.nearestStopsLimit : 5,
        searchTtlMs:
          this.cachePolicy.stop && typeof this.cachePolicy.stop.searchTtlMs === 'number'
            ? this.cachePolicy.stop.searchTtlMs
            : undefined,
        nearestTtlMs:
          this.cachePolicy.stop && typeof this.cachePolicy.stop.nearestTtlMs === 'number'
            ? this.cachePolicy.stop.nearestTtlMs
            : undefined
      });

    this.linesDataSource =
      options.linesDataSource ||
      createLinesDataSource({
        catalog: this.catalog,
        normalizer: this.normalizer,
        cacheAdapter: this.cacheAdapter,
        apiClient: this.apiClient,
        retryAdapter: this.retryAdapter,
        searchTtlMs:
          this.cachePolicy.line && typeof this.cachePolicy.line.searchTtlMs === 'number'
            ? this.cachePolicy.line.searchTtlMs
            : undefined,
        byStopTtlMs:
          this.cachePolicy.line && typeof this.cachePolicy.line.byStopTtlMs === 'number'
            ? this.cachePolicy.line.byStopTtlMs
            : undefined
      });

    this.destinationResolverAdapter =
      options.destinationResolverAdapter ||
      createDestinationResolverAdapter({
        catalog: this.catalog,
        normalizer: this.normalizer,
        cacheAdapter: this.cacheAdapter,
        apiClient: this.apiClient,
        retryAdapter: this.retryAdapter,
        resolveTtlMs:
          this.cachePolicy.destination && typeof this.cachePolicy.destination.resolveTtlMs === 'number'
            ? this.cachePolicy.destination.resolveTtlMs
            : undefined
      });

    this.arrivalsDataSource =
      options.arrivalsDataSource ||
      createArrivalsDataSource({
        normalizer: this.normalizer,
        cacheAdapter: this.cacheAdapter,
        apiClient: this.apiClient,
        retryAdapter: this.retryAdapter,
        linesDataSource: this.linesDataSource,
        providerName: this.providerName,
        now: typeof options.now === 'function' ? options.now : undefined,
        realtimeTtlMs:
          this.cachePolicy.arrival && typeof this.cachePolicy.arrival.realtimeTtlMs === 'number'
            ? this.cachePolicy.arrival.realtimeTtlMs
            : undefined,
        scheduledTtlMs:
          this.cachePolicy.arrival && typeof this.cachePolicy.arrival.scheduledTtlMs === 'number'
            ? this.cachePolicy.arrival.scheduledTtlMs
            : undefined,
        stopArrivalsTtlMs:
          this.cachePolicy.arrival && typeof this.cachePolicy.arrival.stopArrivalsTtlMs === 'number'
            ? this.cachePolicy.arrival.stopArrivalsTtlMs
            : undefined,
        defaultSource: this.defaultSource,
        defaultSourceName: this.defaultSourceName,
        resiliencePolicy: this.resiliencePolicy,
        reliabilityPolicy: this.reliabilityPolicy
      });

    this.routePlanner =
      options.routePlanner ||
      createRoutePlanner({
        normalizer: this.normalizer,
        cacheAdapter: this.cacheAdapter,
        apiClient: this.apiClient,
        retryAdapter: this.retryAdapter,
        linesDataSource: this.linesDataSource,
        providerName: this.providerName
      });
  }

  async searchStops(query) {
    return this.stopDataSource.searchStops(query);
  }

  async nearestStops(lat, lon) {
    return this.stopDataSource.nearestStops(lat, lon);
  }

  async getStopArrivals(stopId) {
    return this.arrivalsDataSource.getStopArrivals(stopId);
  }

  async getLinesServingStop(stopId) {
    return this.linesDataSource.getLinesServingStop(stopId);
  }

  async resolveDestination(query) {
    return this.destinationResolverAdapter.resolveDestination(query);
  }

  async findRoutes(originStopIds, destinationTargetIds) {
    return this.routePlanner.findRoutes(originStopIds, destinationTargetIds);
  }

  async getRealtimePredictions(stopId, lineId) {
    return this.arrivalsDataSource.getRealtimePredictions(stopId, lineId);
  }

  async getScheduledArrivals(stopId, lineId) {
    return this.arrivalsDataSource.getScheduledArrivals(stopId, lineId);
  }

  async searchLines(query) {
    return this.linesDataSource.searchLines(query);
  }

  getStopById(stopId) {
    return this.stopDataSource.getStopById(stopId);
  }

  getDestinationById(destinationId) {
    return this.destinationResolverAdapter.getDestinationById(destinationId);
  }

  getLineById(lineId) {
    return this.linesDataSource.getLineById(lineId);
  }

  getCatalog() {
    return {
      stops: this.stopDataSource.listStops(),
      destinationTargets: this.destinationResolverAdapter.listDestinationTargets(),
      lines: this.linesDataSource.listLines()
    };
  }

  async ping() {
    try {
      return this.apiClient.ping();
    } catch (error) {
      console.error('AMTAB provider ping failed', error);
      return false;
    }
  }

  static create(options) {
    return new AmtabProvider(options);
  }
}

function createAmtabProvider(options) {
  return AmtabProvider.create(options);
}

module.exports = {
  AmtabProvider,
  createAmtabProvider
};
