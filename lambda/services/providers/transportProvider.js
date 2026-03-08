'use strict';

/**
 * Normalized domain shapes used by the transport layer.
 *
 * Stop:
 * {
 *   id: string,
 *   name: string,
 *   aliases: string[],
 *   coordinates: { lat: number, lon: number },
 *   lineIds: string[],
 *   source: string
 * }
 *
 * DestinationTarget:
 * {
 *   id: string,
 *   name: string,
 *   aliases: string[],
 *   targetStopIds: string[],
 *   source: string
 * }
 *
 * Arrival:
 * {
 *   stopId: string,
 *   lineId: string,
 *   destinationTargetId: string,
 *   destinationName: string,
 *   etaMinutes: number,
 *   scheduledEpochMs: number|null,
 *   predictedEpochMs: number|null,
 *   source: string,
 *   isRealtime: boolean
 * }
 *
 * RouteOption:
 * {
 *   id: string,
 *   originStopId: string,
 *   destinationTargetId: string,
 *   lineIds: string[],
 *   transfers: number,
 *   estimatedMinutes: number|null,
 *   source: string
 * }
 */
class TransportProvider {
  constructor(providerName) {
    this.providerName = providerName || 'unknown-provider';
  }

  async searchStops() {
    throw new Error(`${this.providerName}.searchStops not implemented`);
  }

  async nearestStops() {
    throw new Error(`${this.providerName}.nearestStops not implemented`);
  }

  async getStopArrivals() {
    throw new Error(`${this.providerName}.getStopArrivals not implemented`);
  }

  async getLinesServingStop() {
    throw new Error(`${this.providerName}.getLinesServingStop not implemented`);
  }

  async resolveDestination() {
    throw new Error(`${this.providerName}.resolveDestination not implemented`);
  }

  async findRoutes() {
    throw new Error(`${this.providerName}.findRoutes not implemented`);
  }

  async getRealtimePredictions() {
    throw new Error(`${this.providerName}.getRealtimePredictions not implemented`);
  }

  async getScheduledArrivals() {
    throw new Error(`${this.providerName}.getScheduledArrivals not implemented`);
  }
}

module.exports = {
  TransportProvider
};
