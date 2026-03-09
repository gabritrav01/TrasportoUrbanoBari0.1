'use strict';

/**
 * parseArrivalsRaw
 *
 * Input example (TripUpdates-like payload):
 * {
 *   Header: { Timestamp: 1773072000 },
 *   Entities: [{
 *     TripUpdate: {
 *       Trip: { RouteId: 'R1', TripId: 'T100', TripHeadsign: 'Stazione' },
 *       Vehicle: { Id: 'BUS_12' },
 *       StopTimeUpdate: [{
 *         StopId: 'STOP_100',
 *         Arrival: { Time: 1773072300, ScheduledTime: 1773072240 }
 *       }]
 *     }
 *   }]
 * }
 *
 * Output example (intermediate raw arrival record):
 * {
 *   stopId: 'STOP_100',
 *   lineId: '1',
 *   lineNumber: '1',
 *   routeId: 'R1',
 *   destinationName: 'Stazione',
 *   scheduledEpochMs: 1773072240000,
 *   realtimeEpochMs: 1773072300000,
 *   predictedEpochMs: 1773072300000,
 *   recordType: 'realtime',
 *   vehicleId: 'BUS_12',
 *   tripId: 'T100',
 *   asOfEpochMs: 1773072000000,
 *   rawIndex: 0
 * }
 *
 * TODO(AMTAB_ARRIVALS_SOURCE_FIELDS):
 * - Confirm official AMTAB fields for delay/status in TripUpdates JSON and map them.
 * - Confirm if vehicle identifier is always exposed as Vehicle.Id or alternative field names.
 */

const { parseTripUpdatesPayload } = require('./tripUpdatesParser');
const {
  DEFAULT_SERVICE_TIME_ZONE,
  parseFlexibleTimeValue
} = require('../../domain/timeParsing');

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toUpperToken(value) {
  return toText(value).toUpperCase();
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

function normalizeStopId(value) {
  const token = toUpperToken(value);
  if (!token) {
    return '';
  }
  return token
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9:_/-]/g, '');
}

function normalizeLineToken(value) {
  const text = toText(value);
  if (!text) {
    return '';
  }
  return text.replace(/\s+/g, '');
}

function normalizeDestination(value) {
  return toText(value).replace(/\s+/g, ' ');
}

function parseFlexibleEpochMs(value, context) {
  const referenceEpochMs =
    context && typeof context.referenceEpochMs === 'number' ? context.referenceEpochMs : Date.now();
  return parseFlexibleTimeValue(value, {
    referenceEpochMs,
    serviceDate: context && context.serviceDate,
    serviceTimeZone:
      (context && typeof context.serviceTimeZone === 'string' && context.serviceTimeZone.trim()) ||
      DEFAULT_SERVICE_TIME_ZONE,
    allowRollover: context ? context.allowRollover !== false : true,
    rolloverReferenceEpochMs:
      context && typeof context.rolloverReferenceEpochMs === 'number'
        ? context.rolloverReferenceEpochMs
        : undefined,
    rolloverPastMinutes:
      context && typeof context.rolloverPastMinutes === 'number' ? context.rolloverPastMinutes : 2,
    interpretSecondsOfDay: context ? context.interpretSecondsOfDay !== false : true
  });
}

function resolveRecordType(realtimeEpochMs, scheduledEpochMs) {
  if (typeof realtimeEpochMs === 'number') {
    return 'realtime';
  }
  if (typeof scheduledEpochMs === 'number') {
    return 'scheduled';
  }
  return 'discard';
}

function resolveLineId(routeId, routeShortNameByRouteId, fallbackLineId) {
  if (fallbackLineId) {
    return normalizeLineToken(fallbackLineId);
  }
  const shortName = routeShortNameByRouteId && routeShortNameByRouteId.get(routeId);
  if (shortName) {
    return normalizeLineToken(shortName);
  }
  return normalizeLineToken(routeId);
}

function dedupeTimeKey(record, bucketMs) {
  const ts = typeof record.realtimeEpochMs === 'number' ? record.realtimeEpochMs : record.scheduledEpochMs;
  if (typeof ts !== 'number') {
    return 'na';
  }
  return String(Math.floor(ts / bucketMs));
}

function dedupeKey(record, bucketMs) {
  const destinationToken = normalizeDestination(record.destinationName || '').toLowerCase();
  return [
    record.stopId,
    record.lineId || record.lineNumber || record.routeId || 'na',
    destinationToken || 'na',
    dedupeTimeKey(record, bucketMs)
  ].join('|');
}

function contradictionKey(record) {
  const destinationToken = normalizeDestination(record.destinationName || '').toLowerCase();
  return [
    record.stopId,
    record.lineId || record.lineNumber || record.routeId || 'na',
    toText(record.tripId || record.vehicleId || 'na').toUpperCase(),
    destinationToken || 'na'
  ].join('|');
}

function scoreCompleteness(record) {
  let score = 0;
  if (record.recordType === 'realtime') {
    score += 3;
  } else if (record.recordType === 'scheduled') {
    score += 1;
  }
  if (typeof record.scheduledEpochMs === 'number') {
    score += 1;
  }
  if (typeof record.realtimeEpochMs === 'number') {
    score += 2;
  }
  if (record.tripId) {
    score += 1;
  }
  if (record.vehicleId) {
    score += 1;
  }
  if (record.destinationName) {
    score += 1;
  }
  return score;
}

function choosePreferredRecord(current, candidate) {
  const currentScore = scoreCompleteness(current);
  const candidateScore = scoreCompleteness(candidate);
  if (candidateScore > currentScore) {
    return candidate;
  }
  if (candidateScore < currentScore) {
    return current;
  }

  if (candidate.asOfEpochMs !== current.asOfEpochMs) {
    return candidate.asOfEpochMs > current.asOfEpochMs ? candidate : current;
  }

  return current;
}

function resolveRowsFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.rows)) {
    return payload.rows;
  }
  return [];
}

function normalizeDirectArrivalRow(rawRow, index, options) {
  const referenceEpochMs = options.referenceEpochMs;
  const routeShortNameByRouteId = options.routeShortNameByRouteId;
  const fallbackAsOf = options.asOfEpochMs;
  const serviceTimeZone = options.serviceTimeZone || DEFAULT_SERVICE_TIME_ZONE;
  const serviceDate = options.serviceDate;

  const stopId = normalizeStopId(
    pickValue(rawRow, ['stopId', 'stop_id', 'stopCode', 'stop_code', 'stop'])
  );
  const routeId = toUpperToken(
    pickValue(rawRow, ['routeId', 'route_id', 'lineRouteId', 'line_route_id'])
  );
  const lineIdCandidate = pickValue(rawRow, ['lineId', 'line_id', 'lineNumber', 'line_number', 'line']);
  const lineId = resolveLineId(routeId, routeShortNameByRouteId, lineIdCandidate);
  const lineNumber = normalizeLineToken(
    pickValue(rawRow, ['lineNumber', 'line_number', 'lineId', 'line_id', 'line'])
  ) || lineId;
  const destinationName = normalizeDestination(
    pickValue(rawRow, ['destinationName', 'destination', 'headsign', 'tripHeadsign', 'trip_headsign', 'direction'])
  );
  const tripId = toText(pickValue(rawRow, ['tripId', 'trip_id'])) || null;
  const vehicleId = toText(pickValue(rawRow, ['vehicleId', 'vehicle_id', 'vehicle'])) || null;

  const asOfEpochMs =
    parseFlexibleEpochMs(
      pickValue(rawRow, ['asOfEpochMs', 'as_of_epoch_ms', 'timestamp', 'feedTimestamp', 'updatedAt']),
      {
        referenceEpochMs,
        serviceDate,
        serviceTimeZone,
        allowRollover: false
      }
    ) || fallbackAsOf || referenceEpochMs;

  const realtimeEpochMs =
    parseFlexibleEpochMs(
      pickValue(rawRow, ['realtimeEpochMs', 'realtime_time', 'predictedEpochMs', 'predicted_time', 'expectedTime']),
      {
        referenceEpochMs,
        serviceDate,
        serviceTimeZone,
        rolloverReferenceEpochMs: asOfEpochMs,
        rolloverPastMinutes: options.clockRolloverPastMinutes
      }
    ) || null;
  const scheduledEpochMs =
    parseFlexibleEpochMs(
      pickValue(rawRow, ['scheduledEpochMs', 'scheduled_time', 'scheduledTime', 'plannedTime', 'arrivalTime']),
      {
        referenceEpochMs,
        serviceDate,
        serviceTimeZone,
        rolloverReferenceEpochMs: asOfEpochMs,
        rolloverPastMinutes: options.clockRolloverPastMinutes
      }
    ) || null;

  const recordType = resolveRecordType(realtimeEpochMs, scheduledEpochMs);

  if (!stopId) {
    return { record: null, discardedReason: 'missing_stop_id', index };
  }
  if (!lineId && !lineNumber && !routeId) {
    return { record: null, discardedReason: 'missing_line_id', index };
  }
  if (recordType === 'discard') {
    return { record: null, discardedReason: 'missing_timestamps', index };
  }

  return {
    record: {
      stopId,
      lineId: lineId || lineNumber || routeId,
      lineNumber: lineNumber || lineId || routeId || null,
      routeId: routeId || null,
      destinationName: destinationName || null,
      scheduledEpochMs,
      realtimeEpochMs,
      predictedEpochMs: realtimeEpochMs,
      recordType,
      vehicleId,
      tripId,
      asOfEpochMs,
      rawIndex: index,
      raw: rawRow
    }
  };
}

function normalizeFromTripUpdatesPayload(payload, options) {
  const parsed = parseTripUpdatesPayload(payload, options.fallbackTimestampEpochMs || Date.now());
  const routeShortNameByRouteId = options.routeShortNameByRouteId || new Map();
  const stopIdFilter = options.stopIdFilter ? normalizeStopId(options.stopIdFilter) : null;
  const rows = [];

  parsed.entities.forEach((entity, entityIndex) => {
    const tripUpdate = pickObject(entity, ['TripUpdate', 'tripUpdate', 'trip_update']);
    if (!tripUpdate) {
      return;
    }
    const trip = pickObject(tripUpdate, ['Trip', 'trip']) || {};
    const vehicle = pickObject(tripUpdate, ['Vehicle', 'vehicle']) || {};
    const routeId = toUpperToken(pickValue(trip, ['RouteId', 'routeId', 'route_id']));
    const tripId = toText(pickValue(trip, ['TripId', 'tripId', 'trip_id'])) || null;
    const vehicleId = toText(
      pickValue(vehicle, ['Id', 'id', 'VehicleId', 'vehicleId']) ||
      pickValue(tripUpdate, ['VehicleId', 'vehicleId'])
    ) || null;
    const destinationName = normalizeDestination(
      pickValue(trip, ['TripHeadsign', 'tripHeadsign', 'trip_headsign']) ||
      pickValue(entity, ['DestinationName', 'destinationName'])
    );
    const lineId = resolveLineId(routeId, routeShortNameByRouteId, null);

    const stopTimeUpdates = pickArray(tripUpdate, ['StopTimeUpdate', 'stopTimeUpdate', 'stop_time_update']);
    stopTimeUpdates.forEach((stopTimeUpdate, updateIndex) => {
      const stopId = normalizeStopId(
        pickValue(stopTimeUpdate, ['StopId', 'stopId', 'stop_id', 'StopCode', 'stopCode', 'stop_code'])
      );
      if (!stopId) {
        rows.push({
          record: null,
          discardedReason: 'missing_stop_id',
          index: `${entityIndex}:${updateIndex}`
        });
        return;
      }
      if (stopIdFilter && stopIdFilter !== stopId) {
        return;
      }

      const arrivalData = pickObject(stopTimeUpdate, ['Arrival', 'arrival']) || {};
      const departureData = pickObject(stopTimeUpdate, ['Departure', 'departure']) || {};

      const realtimeEpochMs =
        parseFlexibleEpochMs(
          pickValue(arrivalData, ['Time', 'time']) || pickValue(departureData, ['Time', 'time']),
          { referenceEpochMs: parsed.headerTimestampEpochMs }
        ) || null;
      const scheduledEpochMs =
        parseFlexibleEpochMs(
          pickValue(arrivalData, ['ScheduledTime', 'scheduledTime', 'scheduled_time']) ||
            pickValue(departureData, ['ScheduledTime', 'scheduledTime', 'scheduled_time']),
          { referenceEpochMs: parsed.headerTimestampEpochMs }
        ) || null;

      const recordType = resolveRecordType(realtimeEpochMs, scheduledEpochMs);
      if (recordType === 'discard') {
        rows.push({
          record: null,
          discardedReason: 'missing_timestamps',
          index: `${entityIndex}:${updateIndex}`
        });
        return;
      }

      rows.push({
        record: {
          stopId,
          lineId: lineId || routeId || null,
          lineNumber: lineId || routeId || null,
          routeId: routeId || null,
          destinationName: destinationName || null,
          scheduledEpochMs,
          realtimeEpochMs,
          predictedEpochMs: realtimeEpochMs,
          recordType,
          vehicleId,
          tripId,
          asOfEpochMs: parsed.headerTimestampEpochMs,
          sourceEntityIndex: entityIndex,
          sourceUpdateIndex: updateIndex,
          rawIndex: `${entityIndex}:${updateIndex}`,
          raw: stopTimeUpdate
        }
      });
    });
  });

  return {
    headerTimestampEpochMs: parsed.headerTimestampEpochMs,
    normalizedRows: rows
  };
}

function parseArrivalsRawWithReport(payload, options = {}) {
  const logger = options.logger || console;
  const maxDiscardLog = typeof options.maxDiscardLog === 'number' ? Math.max(0, options.maxDiscardLog) : 20;
  const contradictionThresholdMs =
    typeof options.contradictionThresholdMs === 'number' && options.contradictionThresholdMs > 0
      ? Math.floor(options.contradictionThresholdMs)
      : 10 * 60 * 1000;
  const dedupeWindowMs =
    typeof options.dedupeWindowMs === 'number' && options.dedupeWindowMs > 0
      ? Math.floor(options.dedupeWindowMs)
      : 60 * 1000;

  let parsedRows = [];
  let headerTimestampEpochMs = options.fallbackTimestampEpochMs || Date.now();

  if (payload && (Array.isArray(payload.Entities) || Array.isArray(payload.entities) || Array.isArray(payload.entity))) {
    const parsed = normalizeFromTripUpdatesPayload(payload, options);
    parsedRows = parsed.normalizedRows;
    headerTimestampEpochMs = parsed.headerTimestampEpochMs;
  } else {
    const rows = resolveRowsFromPayload(payload);
    parsedRows = rows.map((row, index) =>
      normalizeDirectArrivalRow(row, index, {
        referenceEpochMs: options.referenceEpochMs || Date.now(),
        routeShortNameByRouteId: options.routeShortNameByRouteId || new Map(),
        asOfEpochMs: options.fallbackTimestampEpochMs || Date.now(),
        serviceDate: options.serviceDate,
        serviceTimeZone: options.serviceTimeZone,
        clockRolloverPastMinutes: options.clockRolloverPastMinutes
      })
    );
  }

  const discarded = [];
  const records = [];
  parsedRows.forEach((entry, index) => {
    if (!entry || !entry.record) {
      const reason = entry && entry.discardedReason ? entry.discardedReason : 'invalid_record';
      discarded.push({
        index: entry && entry.index !== undefined ? entry.index : index,
        reason
      });
      return;
    }
    records.push(entry.record);
  });

  discarded.slice(0, maxDiscardLog).forEach((entry) => {
    logger.warn('[AMTAB parseArrivalsRaw] discarded arrival record', {
      index: entry.index,
      reason: entry.reason
    });
  });
  if (discarded.length > maxDiscardLog) {
    logger.warn('[AMTAB parseArrivalsRaw] additional discarded records not logged', {
      hiddenCount: discarded.length - maxDiscardLog
    });
  }

  const dedupeMap = new Map();
  const duplicates = [];
  const contradictions = [];

  records.forEach((record) => {
    const key = dedupeKey(record, dedupeWindowMs);
    if (!dedupeMap.has(key)) {
      dedupeMap.set(key, record);
      return;
    }

    const existing = dedupeMap.get(key);
    const selected = choosePreferredRecord(existing, record);
    const dropped = selected === existing ? record : existing;
    dedupeMap.set(key, selected);

    const selectedTs = selected.realtimeEpochMs || selected.scheduledEpochMs || null;
    const droppedTs = dropped.realtimeEpochMs || dropped.scheduledEpochMs || null;
    if (typeof selectedTs === 'number' && typeof droppedTs === 'number') {
      const driftMs = Math.abs(selectedTs - droppedTs);
      if (driftMs > contradictionThresholdMs) {
        contradictions.push({
          key: contradictionKey(selected),
          driftMs,
          keptRawIndex: selected.rawIndex,
          droppedRawIndex: dropped.rawIndex
        });
      }
    }

    duplicates.push({
      key,
      keptRawIndex: selected.rawIndex,
      droppedRawIndex: dropped.rawIndex
    });
  });

  const contradictionGroupMap = new Map();
  Array.from(dedupeMap.values()).forEach((record) => {
    const key = contradictionKey(record);
    if (!contradictionGroupMap.has(key)) {
      contradictionGroupMap.set(key, []);
    }
    contradictionGroupMap.get(key).push(record);
  });

  const contradictionMerged = [];
  contradictionGroupMap.forEach((group, key) => {
    if (!group.length) {
      return;
    }
    if (group.length === 1) {
      contradictionMerged.push(group[0]);
      return;
    }

    let selected = group[0];
    group.slice(1).forEach((candidate) => {
      const selectedTs = selected.realtimeEpochMs || selected.scheduledEpochMs || null;
      const candidateTs = candidate.realtimeEpochMs || candidate.scheduledEpochMs || null;
      if (typeof selectedTs === 'number' && typeof candidateTs === 'number') {
        const driftMs = Math.abs(selectedTs - candidateTs);
        if (driftMs > contradictionThresholdMs) {
          contradictions.push({
            key,
            driftMs,
            keptRawIndex: selected.rawIndex,
            droppedRawIndex: candidate.rawIndex
          });
        }
      }
      selected = choosePreferredRecord(selected, candidate);
    });

    contradictionMerged.push(selected);
  });

  if (contradictions.length) {
    logger.warn('[AMTAB parseArrivalsRaw] contradictory arrival records detected', {
      contradictions: contradictions.length
    });
  }

  return {
    records: contradictionMerged,
    discarded,
    duplicates,
    contradictions,
    warnings: contradictions.map((entry) => ({
      type: 'contradictory_arrival',
      key: entry.key,
      driftMs: entry.driftMs
    })),
    inputCount: parsedRows.length,
    headerTimestampEpochMs
  };
}

function parseArrivalsRaw(payload, options = {}) {
  return parseArrivalsRawWithReport(payload, options).records;
}

module.exports = {
  parseArrivalsRaw,
  parseArrivalsRawWithReport
};
