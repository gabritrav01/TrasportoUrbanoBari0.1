'use strict';

/**
 * parseStopsRaw
 *
 * Input example (GTFS-like row):
 * {
 *   stop_id: 'STOP_123',
 *   stop_code: '123',
 *   stop_name: 'Stazione Centrale',
 *   stop_lat: '41.1177',
 *   stop_lon: '16.8697',
 *   direction: 'Centro'
 * }
 *
 * Output example (intermediate raw stop record):
 * {
 *   stopId: 'STOP_123',
 *   stopName: 'Stazione Centrale',
 *   stopCode: '123',
 *   coordinates: { lat: 41.1177, lon: 16.8697 },
 *   direction: 'Centro',
 *   side: null,
 *   platformCode: null,
 *   rawIndex: 0,
 *   raw: { ...originalRow }
 * }
 *
 * TODO(AMTAB_SOURCE_FIELDS):
 * - Verify official side/platform fields published by AMTAB (if any) and map them here.
 * - Verify if direction should be inferred from headsign or dedicated stop-level field.
 */

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
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

function normalizeStopId(value) {
  const token = toText(value).toUpperCase();
  if (!token) {
    return '';
  }
  return token
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9:_/-]/g, '');
}

function normalizeStopName(value) {
  return toText(value).replace(/\s+/g, ' ');
}

function pickFirst(source, keys) {
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

function parseCoordinates(record) {
  const lat = toNumberOrNull(
    pickFirst(record, ['stop_lat', 'stopLat', 'lat', 'latitude', 'y'])
  );
  const lon = toNumberOrNull(
    pickFirst(record, ['stop_lon', 'stopLon', 'lon', 'lng', 'longitude', 'x'])
  );

  const hasLat = typeof lat === 'number';
  const hasLon = typeof lon === 'number';
  if (!hasLat || !hasLon) {
    return {
      coordinates: null,
      issues: ['missing_coordinates']
    };
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return {
      coordinates: null,
      issues: ['invalid_coordinates_range']
    };
  }

  return {
    coordinates: { lat, lon },
    issues: []
  };
}

function scoreRawStopCompleteness(record) {
  let score = 0;
  if (record.coordinates) {
    score += 2;
  }
  if (record.stopCode) {
    score += 1;
  }
  if (record.direction) {
    score += 1;
  }
  if (record.side) {
    score += 1;
  }
  if (record.platformCode) {
    score += 1;
  }
  return score;
}

function chooseBestRecord(existingRecord, nextRecord) {
  const existingScore = scoreRawStopCompleteness(existingRecord);
  const nextScore = scoreRawStopCompleteness(nextRecord);
  if (nextScore > existingScore) {
    return nextRecord;
  }
  return existingRecord;
}

function normalizeRow(row, index) {
  const stopId = normalizeStopId(
    pickFirst(row, ['stop_id', 'stopId', 'id', 'stop_code', 'stopCode', 'code', 'fermata_id'])
  );
  const stopName = normalizeStopName(
    pickFirst(row, ['stop_name', 'stopName', 'name', 'stop_desc', 'description', 'fermata_nome'])
  );
  const stopCode = toText(
    pickFirst(row, ['stop_code', 'stopCode', 'code'])
  );

  if (!stopId) {
    return {
      record: null,
      discardedReason: 'missing_stop_id',
      index
    };
  }
  if (!stopName) {
    return {
      record: null,
      discardedReason: 'missing_stop_name',
      index
    };
  }

  const coordinatesParse = parseCoordinates(row);
  const direction = toText(
    pickFirst(row, ['direction', 'stop_direction', 'dir', 'headsign', 'trip_headsign'])
  );
  const side = toText(
    pickFirst(row, ['side', 'lato', 'stop_side', 'platform_side'])
  );
  const platformCode = toText(
    pickFirst(row, ['platform_code', 'platformCode', 'bay', 'stall'])
  );

  return {
    record: {
      stopId,
      stopName,
      stopCode: stopCode || null,
      coordinates: coordinatesParse.coordinates,
      direction: direction || null,
      side: side || null,
      platformCode: platformCode || null,
      rawIndex: index,
      raw: row
    },
    discardedReason: null,
    issues: coordinatesParse.issues
  };
}

function resolveRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.rows)) {
    return payload.rows;
  }
  return [];
}

function parseStopsRawWithReport(payload, options = {}) {
  const logger = options.logger || console;
  const rows = resolveRows(payload);
  const discarded = [];
  const warnings = [];
  const dedupeMap = new Map();

  rows.forEach((row, index) => {
    const normalized = normalizeRow(row, index);
    if (!normalized.record) {
      discarded.push({
        index,
        reason: normalized.discardedReason
      });
      return;
    }

    if (normalized.issues && normalized.issues.length) {
      warnings.push({
        index,
        stopId: normalized.record.stopId,
        issues: normalized.issues
      });
    }

    if (!dedupeMap.has(normalized.record.stopId)) {
      dedupeMap.set(normalized.record.stopId, normalized.record);
      return;
    }

    dedupeMap.set(
      normalized.record.stopId,
      chooseBestRecord(dedupeMap.get(normalized.record.stopId), normalized.record)
    );
  });

  const maxDiscardLog = typeof options.maxDiscardLog === 'number' ? Math.max(0, options.maxDiscardLog) : 20;
  discarded.slice(0, maxDiscardLog).forEach((entry) => {
    logger.warn(
      '[AMTAB parseStopsRaw] discarded stop record',
      { index: entry.index, reason: entry.reason }
    );
  });
  if (discarded.length > maxDiscardLog) {
    logger.warn(
      '[AMTAB parseStopsRaw] additional discarded records not logged',
      { hiddenCount: discarded.length - maxDiscardLog }
    );
  }

  return {
    records: Array.from(dedupeMap.values()),
    discarded,
    warnings,
    inputCount: rows.length
  };
}

function parseStopsRaw(payload, options = {}) {
  return parseStopsRawWithReport(payload, options).records;
}

module.exports = {
  parseStopsRaw,
  parseStopsRawWithReport
};
