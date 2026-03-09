'use strict';

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toUpperToken(value) {
  return toText(value).toUpperCase();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toEpochMsOrNull(value) {
  const text = toText(value);
  if (!text) {
    return null;
  }

  const numeric = toNumberOrNull(text);
  if (numeric !== null) {
    if (numeric > 1000000000000) {
      return Math.round(numeric);
    }
    if (numeric > 1000000000) {
      return Math.round(numeric * 1000);
    }
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function pickValue(source, keys) {
  if (!source || typeof source !== 'object') {
    return null;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return null;
}

function pickObject(source, keys) {
  const value = pickValue(source, keys);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function pickArray(source, keys) {
  const value = pickValue(source, keys);
  return Array.isArray(value) ? value : [];
}

function parseTripUpdatesPayload(payload, fallbackTimestampEpochMs) {
  const header = pickObject(payload, ['Header', 'header']) || {};
  const entities = pickArray(payload, ['Entities', 'entities', 'entity']);
  const headerTimestampEpochMs =
    toEpochMsOrNull(pickValue(header, ['Timestamp', 'timestamp'])) || fallbackTimestampEpochMs;

  return {
    header,
    entities,
    headerTimestampEpochMs
  };
}

function buildRawArrivalRows({ payload, fallbackTimestampEpochMs, stopIdFilter }) {
  const parsed = parseTripUpdatesPayload(payload, fallbackTimestampEpochMs);
  const targetStopId = stopIdFilter ? toUpperToken(stopIdFilter) : null;
  const rows = [];

  parsed.entities.forEach((entity, entityIndex) => {
    const tripUpdate = pickObject(entity, ['TripUpdate', 'tripUpdate', 'trip_update']);
    if (!tripUpdate) {
      return;
    }

    const trip = pickObject(tripUpdate, ['Trip', 'trip']) || {};
    const routeId = toUpperToken(pickValue(trip, ['RouteId', 'routeId', 'route_id']));
    const tripId = toText(pickValue(trip, ['TripId', 'tripId', 'trip_id']));
    const destinationName = toText(
      pickValue(trip, ['TripHeadsign', 'tripHeadsign', 'trip_headsign']) ||
      pickValue(entity, ['DestinationName', 'destinationName'])
    );

    const stopTimeUpdates = pickArray(tripUpdate, ['StopTimeUpdate', 'stopTimeUpdate', 'stop_time_update']);
    stopTimeUpdates.forEach((stopTimeUpdate, updateIndex) => {
      const stopId = toUpperToken(
        pickValue(stopTimeUpdate, ['StopId', 'stopId', 'stop_id']) ||
        pickValue(stopTimeUpdate, ['StopCode', 'stopCode', 'stop_code'])
      );
      if (!stopId) {
        return;
      }
      if (targetStopId && stopId !== targetStopId) {
        return;
      }

      const arrivalData = pickObject(stopTimeUpdate, ['Arrival', 'arrival']) || {};
      const departureData = pickObject(stopTimeUpdate, ['Departure', 'departure']) || {};
      const predictedEpochMs =
        toEpochMsOrNull(pickValue(arrivalData, ['Time', 'time'])) ||
        toEpochMsOrNull(pickValue(departureData, ['Time', 'time']));
      const scheduledEpochMs =
        toEpochMsOrNull(pickValue(arrivalData, ['ScheduledTime', 'scheduledTime', 'scheduled_time'])) ||
        toEpochMsOrNull(pickValue(departureData, ['ScheduledTime', 'scheduledTime', 'scheduled_time']));

      if (predictedEpochMs === null && scheduledEpochMs === null) {
        return;
      }

      rows.push({
        entityIndex,
        updateIndex,
        stopId,
        routeId,
        tripId,
        destinationName,
        predictedEpochMs,
        scheduledEpochMs,
        asOfEpochMs: parsed.headerTimestampEpochMs
      });
    });
  });

  return {
    headerTimestampEpochMs: parsed.headerTimestampEpochMs,
    entitiesCount: parsed.entities.length,
    rows
  };
}

module.exports = {
  parseTripUpdatesPayload,
  buildRawArrivalRows
};

