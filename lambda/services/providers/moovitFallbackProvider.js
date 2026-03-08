'use strict';

const { TransportProvider } = require('./transportProvider');
const { STOPS, DESTINATION_TARGETS, LINES, buildCatalogIndexes } = require('./stubCatalog');
const {
  topRankedMatches,
  haversineDistanceMeters,
  scheduleMinutesFromHeadway,
  sortByEta
} = require('../../resolvers/transportDataResolver');

class MoovitFallbackProvider extends TransportProvider {
  constructor(options = {}) {
    super('moovit-fallback-provider');
    this.options = options;
    this.catalog = {
      stops: STOPS,
      destinationTargets: DESTINATION_TARGETS,
      lines: LINES
    };
    this.indexes = buildCatalogIndexes();
  }

  async searchStops(query) {
    return topRankedMatches(this.catalog.stops, query, (stop) => [stop.name].concat(stop.aliases || []));
  }

  async nearestStops(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return [];
    }

    return this.catalog.stops
      .map((stop) => ({
        stop,
        distanceMeters: Math.round(haversineDistanceMeters(lat, lon, stop.coordinates.lat, stop.coordinates.lon))
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 5);
  }

  async getStopArrivals(stopId) {
    const lines = await this.getLinesServingStop(stopId);
    const arrivals = [];
    for (const line of lines) {
      const scheduled = await this.getScheduledArrivals(stopId, line.id);
      arrivals.push(...scheduled);
    }
    return sortByEta(arrivals);
  }

  async getLinesServingStop(stopId) {
    return this.catalog.lines.filter((line) => line.stopIds.includes(stopId));
  }

  async resolveDestination(query) {
    return topRankedMatches(
      this.catalog.destinationTargets,
      query,
      (destinationTarget) => [destinationTarget.name].concat(destinationTarget.aliases || [])
    );
  }

  async findRoutes(originStopIds, destinationTargetIds) {
    const originIds = Array.isArray(originStopIds) ? originStopIds : [];
    const destinationIds = Array.isArray(destinationTargetIds) ? destinationTargetIds : [];
    if (!originIds.length || !destinationIds.length) {
      return [];
    }

    // TODO(MOOVIT_FALLBACK): integrare endpoint route planning fallback.
    const routes = [];
    originIds.forEach((originStopId) => {
      destinationIds.forEach((destinationTargetId) => {
        this.catalog.lines
          .filter((line) => line.stopIds.includes(originStopId) && line.destinationTargetId === destinationTargetId)
          .forEach((line) => {
            routes.push({
              id: `fallback-route:${originStopId}:${destinationTargetId}:${line.id}`,
              originStopId,
              destinationTargetId,
              lineIds: [line.id],
              transfers: 0,
              estimatedMinutes: null,
              source: this.providerName
            });
          });
      });
    });

    return routes;
  }

  async getRealtimePredictions(stopId, lineId) {
    // TODO(MOOVIT_REALTIME): integrare endpoint realtime fallback se disponibile.
    void stopId;
    void lineId;
    return [];
  }

  async getScheduledArrivals(stopId, lineId) {
    const line = this.indexes.lineById.get(lineId);
    if (!line || !line.stopIds.includes(stopId)) {
      return [];
    }

    const etaMinutesList = scheduleMinutesFromHeadway({
      firstMinute: line.firstMinute,
      lastMinute: line.lastMinute,
      headwayMinutes: line.headwayMinutes,
      referenceDate: new Date(),
      limit: 3
    });

    const now = Date.now();
    return etaMinutesList.map((etaMinutes) => ({
      stopId,
      lineId: line.id,
      destinationTargetId: line.destinationTargetId,
      destinationName: line.destinationName,
      etaMinutes,
      scheduledEpochMs: now + etaMinutes * 60 * 1000,
      predictedEpochMs: null,
      source: this.providerName,
      isRealtime: false
    }));
  }

  async searchLines(query) {
    return topRankedMatches(this.catalog.lines, query, (line) => [line.id].concat(line.aliases || []));
  }

  getStopById(stopId) {
    return this.indexes.stopById.get(stopId) || null;
  }

  getDestinationById(destinationId) {
    return this.indexes.destinationById.get(destinationId) || null;
  }

  getLineById(lineId) {
    return this.indexes.lineById.get(lineId) || null;
  }

  getCatalog() {
    return this.catalog;
  }

  static create(options) {
    return new MoovitFallbackProvider(options);
  }
}

function createMoovitFallbackProvider(options) {
  return MoovitFallbackProvider.create(options);
}

module.exports = {
  MoovitFallbackProvider,
  createMoovitFallbackProvider
};
