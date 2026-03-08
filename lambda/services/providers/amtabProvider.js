'use strict';

const { TransportProvider } = require('./transportProvider');
const { STOPS, DESTINATION_TARGETS, LINES, buildCatalogIndexes } = require('./stubCatalog');
const {
  normalizeText,
  topRankedMatches,
  haversineDistanceMeters,
  scheduleMinutesFromHeadway,
  sortByEta
} = require('../../resolvers/transportDataResolver');

class AmtabProvider extends TransportProvider {
  constructor(options = {}) {
    super('amtab-provider');
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
      const realtime = await this.getRealtimePredictions(stopId, line.id);
      if (realtime.length) {
        arrivals.push(...realtime);
        continue;
      }

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

    const routes = [];
    originIds.forEach((originStopId) => {
      destinationIds.forEach((destinationTargetId) => {
        const matchingLines = this.catalog.lines.filter(
          (line) => line.destinationTargetId === destinationTargetId && line.stopIds.includes(originStopId)
        );

        matchingLines.forEach((line) => {
          routes.push({
            id: `route:${originStopId}:${destinationTargetId}:${line.id}`,
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
    // TODO(AMTAB_REALTIME): integrare endpoint ufficiale realtime AMTAB/MUVT.
    // Esempio placeholder endpoint:
    // GET ${AMTAB_API_BASE_URL}/realtime/predictions?stopId=<STOP_ID>&lineId=<LINE_ID>
    // Header: Authorization Bearer ${AMTAB_API_TOKEN}
    // Mapping richiesto:
    //   expectedTime -> predictedEpochMs
    //   plannedTime  -> scheduledEpochMs
    //   destination  -> destinationName / destinationTargetId
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

  async ping() {
    // TODO(AMTAB_HEALTHCHECK): verificare endpoint ufficiale disponibilita API.
    return true;
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
