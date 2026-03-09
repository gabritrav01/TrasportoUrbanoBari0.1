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
const { normalizeSource, SOURCE_TYPES } = require('./domain/providerShapes');

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
    this.logger = options.logger || console;
    this.runtimeDataMode = String(options.runtimeDataMode || 'stub').trim().toLowerCase();
    this.cachePolicy = options.cachePolicy || {};
    this.resiliencePolicy = options.resiliencePolicy || {};
    this.reliabilityPolicy = options.reliabilityPolicy || {};
    const requestedDefaultSource = normalizeSource(options.defaultSource, SOURCE_TYPES.FALLBACK);
    this.defaultSource =
      this.runtimeDataMode === 'amtab_real'
        ? requestedDefaultSource
        : SOURCE_TYPES.FALLBACK;
    this.defaultSourceName =
      typeof options.defaultSourceName === 'string' ? options.defaultSourceName : this.providerName;
    this.hasRealtimeHooks = [
      options.searchStops,
      options.searchLines,
      options.getStopArrivals,
      options.getRealtimePredictions,
      options.getScheduledArrivals
    ].some((hook) => typeof hook === 'function');

    if (this.runtimeDataMode !== 'amtab_real' && requestedDefaultSource === SOURCE_TYPES.OFFICIAL) {
      this.logger.warn(
        '[AmtabProvider] defaultSource=official requested outside amtab_real mode -> forced to fallback'
      );
    }
    if (this.runtimeDataMode === 'amtab_real' && this.hasRealtimeHooks) {
      this.logger.info('[AmtabProvider] amtab_real mode active with real gateway hooks');
    }
    if (this.runtimeDataMode === 'amtab_real' && !this.hasRealtimeHooks) {
      this.logger.warn(
        '[AmtabProvider] amtab_real mode requested but no real gateway hooks configured; using stub catalog fallback'
      );
    }

    this.normalizer = options.normalizer || createAmtabNormalizer();
    this.cacheAdapter =
      options.cacheAdapter ||
      createMemoryCacheAdapter({
        defaultTtlMs:
          this.cachePolicy.adapter && typeof this.cachePolicy.adapter.defaultTtlMs === 'number'
            ? this.cachePolicy.adapter.defaultTtlMs
            : 30000,
        defaultStaleIfErrorTtlMs:
          this.cachePolicy.adapter && typeof this.cachePolicy.adapter.defaultStaleIfErrorTtlMs === 'number'
            ? this.cachePolicy.adapter.defaultStaleIfErrorTtlMs
            : 0,
        defaultNegativeTtlMs:
          this.cachePolicy.adapter && typeof this.cachePolicy.adapter.defaultNegativeTtlMs === 'number'
            ? this.cachePolicy.adapter.defaultNegativeTtlMs
            : 5000,
        defaultInFlightDedupe:
          this.cachePolicy.adapter && this.cachePolicy.adapter.defaultInFlightDedupe !== undefined
            ? Boolean(this.cachePolicy.adapter.defaultInFlightDedupe)
            : true,
        maxEntries:
          this.cachePolicy.adapter && typeof this.cachePolicy.adapter.maxEntries === 'number'
            ? this.cachePolicy.adapter.maxEntries
            : 2500,
        logger: this.logger
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
        logger: this.logger,
        resiliencePolicy: this.resiliencePolicy,
        defaultLimit: typeof options.nearestStopsLimit === 'number' ? options.nearestStopsLimit : 5,
        searchTtlMs:
          this.cachePolicy.stop && typeof this.cachePolicy.stop.searchTtlMs === 'number'
            ? this.cachePolicy.stop.searchTtlMs
            : undefined,
        searchStaleIfErrorTtlMs:
          this.cachePolicy.stop && typeof this.cachePolicy.stop.searchStaleIfErrorTtlMs === 'number'
            ? this.cachePolicy.stop.searchStaleIfErrorTtlMs
            : undefined,
        searchNegativeTtlMs:
          this.cachePolicy.stop && typeof this.cachePolicy.stop.searchNegativeTtlMs === 'number'
            ? this.cachePolicy.stop.searchNegativeTtlMs
            : undefined,
        nearestTtlMs:
          this.cachePolicy.stop && typeof this.cachePolicy.stop.nearestTtlMs === 'number'
            ? this.cachePolicy.stop.nearestTtlMs
            : undefined,
        nearestStaleIfErrorTtlMs:
          this.cachePolicy.stop && typeof this.cachePolicy.stop.nearestStaleIfErrorTtlMs === 'number'
            ? this.cachePolicy.stop.nearestStaleIfErrorTtlMs
            : undefined,
        nearestNegativeTtlMs:
          this.cachePolicy.stop && typeof this.cachePolicy.stop.nearestNegativeTtlMs === 'number'
            ? this.cachePolicy.stop.nearestNegativeTtlMs
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
        logger: this.logger,
        resiliencePolicy: this.resiliencePolicy,
        searchTtlMs:
          this.cachePolicy.line && typeof this.cachePolicy.line.searchTtlMs === 'number'
            ? this.cachePolicy.line.searchTtlMs
            : undefined,
        searchStaleIfErrorTtlMs:
          this.cachePolicy.line && typeof this.cachePolicy.line.searchStaleIfErrorTtlMs === 'number'
            ? this.cachePolicy.line.searchStaleIfErrorTtlMs
            : undefined,
        searchNegativeTtlMs:
          this.cachePolicy.line && typeof this.cachePolicy.line.searchNegativeTtlMs === 'number'
            ? this.cachePolicy.line.searchNegativeTtlMs
            : undefined,
        byStopTtlMs:
          this.cachePolicy.line && typeof this.cachePolicy.line.byStopTtlMs === 'number'
            ? this.cachePolicy.line.byStopTtlMs
            : undefined,
        byStopStaleIfErrorTtlMs:
          this.cachePolicy.line && typeof this.cachePolicy.line.byStopStaleIfErrorTtlMs === 'number'
            ? this.cachePolicy.line.byStopStaleIfErrorTtlMs
            : undefined,
        byStopNegativeTtlMs:
          this.cachePolicy.line && typeof this.cachePolicy.line.byStopNegativeTtlMs === 'number'
            ? this.cachePolicy.line.byStopNegativeTtlMs
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
        logger: this.logger,
        resiliencePolicy: this.resiliencePolicy,
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
        logger: this.logger,
        linesDataSource: this.linesDataSource,
        providerName: this.providerName,
        now: typeof options.now === 'function' ? options.now : undefined,
        realtimeTtlMs:
          this.cachePolicy.arrival && typeof this.cachePolicy.arrival.realtimeTtlMs === 'number'
            ? this.cachePolicy.arrival.realtimeTtlMs
            : undefined,
        realtimeStaleIfErrorTtlMs:
          this.cachePolicy.arrival &&
          typeof this.cachePolicy.arrival.realtimeStaleIfErrorTtlMs === 'number'
            ? this.cachePolicy.arrival.realtimeStaleIfErrorTtlMs
            : undefined,
        realtimeNegativeTtlMs:
          this.cachePolicy.arrival &&
          typeof this.cachePolicy.arrival.realtimeNegativeTtlMs === 'number'
            ? this.cachePolicy.arrival.realtimeNegativeTtlMs
            : undefined,
        scheduledTtlMs:
          this.cachePolicy.arrival && typeof this.cachePolicy.arrival.scheduledTtlMs === 'number'
            ? this.cachePolicy.arrival.scheduledTtlMs
            : undefined,
        scheduledStaleIfErrorTtlMs:
          this.cachePolicy.arrival &&
          typeof this.cachePolicy.arrival.scheduledStaleIfErrorTtlMs === 'number'
            ? this.cachePolicy.arrival.scheduledStaleIfErrorTtlMs
            : undefined,
        scheduledNegativeTtlMs:
          this.cachePolicy.arrival &&
          typeof this.cachePolicy.arrival.scheduledNegativeTtlMs === 'number'
            ? this.cachePolicy.arrival.scheduledNegativeTtlMs
            : undefined,
        stopArrivalsTtlMs:
          this.cachePolicy.arrival && typeof this.cachePolicy.arrival.stopArrivalsTtlMs === 'number'
            ? this.cachePolicy.arrival.stopArrivalsTtlMs
            : undefined,
        stopArrivalsStaleIfErrorTtlMs:
          this.cachePolicy.arrival &&
          typeof this.cachePolicy.arrival.stopArrivalsStaleIfErrorTtlMs === 'number'
            ? this.cachePolicy.arrival.stopArrivalsStaleIfErrorTtlMs
            : undefined,
        stopArrivalsNegativeTtlMs:
          this.cachePolicy.arrival &&
          typeof this.cachePolicy.arrival.stopArrivalsNegativeTtlMs === 'number'
            ? this.cachePolicy.arrival.stopArrivalsNegativeTtlMs
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
        logger: this.logger,
        resiliencePolicy: this.resiliencePolicy,
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
