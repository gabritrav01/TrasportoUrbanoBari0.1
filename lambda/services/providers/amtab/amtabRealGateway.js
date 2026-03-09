'use strict';

const { normalizeText, sortByEta } = require('../../../resolvers/transportDataResolver');
const {
  SOURCE_TYPES,
  PREDICTION_TYPES
} = require('../domain/providerShapes');
const { createAmtabRealApiClient, createGatewayError } = require('./clients/amtabApiClient');
const { mapRawArrivalToArrival } = require('./mappers/mapRawArrivalToArrival');
const { mapRawLineToLine } = require('./mappers/mapRawLineToLine');
const { mapRawStopToStop } = require('./mappers/mapRawStopToStop');
const { parseZipEntries, extractZipEntry } = require('./parsers/zipParser');
const { parseCsvTable } = require('./parsers/csvParser');
const {
  buildGtfsStaticScheduleContext,
  normalizeGtfsDateKey,
  toIsoDateFromDateKey,
  weekdayKeyForDateKey,
  isServiceActiveOnDate
} = require('./parsers/gtfsStaticScheduleParser');
const { parseStopsRawWithReport } = require('./parsers/parseStopsRaw');
const { parseArrivalsRawWithReport } = require('./parsers/parseArrivalsRaw');
const { parseTripUpdatesPayload } = require('./parsers/tripUpdatesParser');
const {
  DEFAULT_SERVICE_TIME_ZONE,
  parseFlexibleTimeValue,
  resolveServiceDateParts
} = require('../domain/timeParsing');

const DEFAULTS = Object.freeze({
  stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
  tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates',
  requestTimeoutMs: 3500,
  staticCacheTtlMs: 6 * 60 * 60 * 1000,
  tripUpdatesCacheTtlMs: 15000,
  scheduledWindowPastMinutes: 2,
  scheduledWindowAheadMinutes: 240,
  scheduledMaxResults: 8
});

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toUpperToken(value) {
  return toText(value).toUpperCase();
}

function safeReliabilityThresholds(policy) {
  if (!policy || typeof policy !== 'object') {
    return undefined;
  }
  if (!policy.thresholds || typeof policy.thresholds !== 'object') {
    return undefined;
  }
  return policy.thresholds;
}

function canonicalizeLineToken(value) {
  return normalizeText(value || '').replace(/[^a-z0-9]/g, '');
}

function lineMatches(candidateLineId, requestedLineId) {
  if (!requestedLineId) {
    return true;
  }
  return canonicalizeLineToken(candidateLineId) === canonicalizeLineToken(requestedLineId);
}

function extractZipEntryFlexible(zipBuffer, entries, fileName) {
  const direct = extractZipEntry(zipBuffer, entries, fileName);
  if (direct) {
    return direct;
  }

  const safeTarget = toText(fileName).toLowerCase();
  if (!safeTarget) {
    return null;
  }

  for (const entryName of entries.keys()) {
    const normalizedEntry = toText(entryName).replace(/\\/g, '/').toLowerCase();
    if (!normalizedEntry) {
      continue;
    }
    if (normalizedEntry === safeTarget || normalizedEntry.endsWith(`/${safeTarget}`)) {
      return extractZipEntry(zipBuffer, entries, entryName);
    }
  }
  return null;
}

function toGtfsDateKey(parts) {
  if (!parts || !Number.isFinite(parts.year) || !Number.isFinite(parts.month) || !Number.isFinite(parts.day)) {
    return '';
  }
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return normalizeGtfsDateKey(`${year}${month}${day}`);
}

function buildServiceDateCandidates(referenceEpochMs, serviceTimeZone) {
  const nowParts = resolveServiceDateParts(null, referenceEpochMs, serviceTimeZone);
  const previousParts = resolveServiceDateParts(null, referenceEpochMs - 24 * 60 * 60 * 1000, serviceTimeZone);
  const uniqueDateKeys = Array.from(new Set([toGtfsDateKey(nowParts), toGtfsDateKey(previousParts)].filter(Boolean)));

  return uniqueDateKeys
    .map((dateKey) => ({
      dateKey,
      isoDate: toIsoDateFromDateKey(dateKey),
      weekdayKey: weekdayKeyForDateKey(dateKey)
    }))
    .filter((entry) => entry.isoDate && entry.weekdayKey);
}

function applyArrivalProvenanceGuard(arrival) {
  if (!arrival || typeof arrival !== 'object') {
    return arrival;
  }

  if (arrival.predictionType === PREDICTION_TYPES.INFERRED && arrival.source === SOURCE_TYPES.OFFICIAL) {
    return {
      ...arrival,
      source: SOURCE_TYPES.PUBLIC,
      sourceName: arrival.sourceName || 'amtab_public_unverified',
      reliabilityBand: arrival.reliabilityBand === 'discard' ? 'discard' : 'degraded'
    };
  }

  return arrival;
}

function createAmtabRealGateway(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const logger = options.logger || console;
  const reliabilityPolicy = options.reliabilityPolicy || {};
  const serviceTimeZone =
    typeof options.serviceTimeZone === 'string' && options.serviceTimeZone.trim()
      ? options.serviceTimeZone.trim()
      : DEFAULT_SERVICE_TIME_ZONE;
  const scheduledWindowPastMinutes =
    typeof options.scheduledWindowPastMinutes === 'number' && options.scheduledWindowPastMinutes >= 0
      ? Math.floor(options.scheduledWindowPastMinutes)
      : DEFAULTS.scheduledWindowPastMinutes;
  const scheduledWindowAheadMinutes =
    typeof options.scheduledWindowAheadMinutes === 'number' && options.scheduledWindowAheadMinutes > 0
      ? Math.floor(options.scheduledWindowAheadMinutes)
      : DEFAULTS.scheduledWindowAheadMinutes;
  const scheduledMaxResults =
    typeof options.scheduledMaxResults === 'number' && options.scheduledMaxResults > 0
      ? Math.floor(options.scheduledMaxResults)
      : DEFAULTS.scheduledMaxResults;

  const staticCacheTtlMs =
    typeof options.staticCacheTtlMs === 'number' && options.staticCacheTtlMs > 0
      ? Math.floor(options.staticCacheTtlMs)
      : DEFAULTS.staticCacheTtlMs;
  const tripUpdatesCacheTtlMs =
    typeof options.tripUpdatesCacheTtlMs === 'number' && options.tripUpdatesCacheTtlMs > 0
      ? Math.floor(options.tripUpdatesCacheTtlMs)
      : DEFAULTS.tripUpdatesCacheTtlMs;

  const apiClient =
    options.apiClient ||
    createAmtabRealApiClient({
      fetchFn: options.fetchFn,
      logger,
      now,
      requestTimeoutMs:
        typeof options.requestTimeoutMs === 'number' ? options.requestTimeoutMs : DEFAULTS.requestTimeoutMs,
      stopsFeedUrl: options.stopsFeedUrl || process.env.AMTAB_REAL_STOPS_FEED_URL || DEFAULTS.stopsFeedUrl,
      tripUpdatesUrl: options.tripUpdatesUrl || process.env.AMTAB_REAL_TRIP_UPDATES_URL || DEFAULTS.tripUpdatesUrl
    });

  const cache = {
    staticData: null,
    staticFetchedAtEpochMs: 0,
    tripUpdatesData: null,
    tripUpdatesFetchedAtEpochMs: 0
  };

  async function loadStaticData() {
    const nowEpochMs = now();
    if (cache.staticData && nowEpochMs - cache.staticFetchedAtEpochMs < staticCacheTtlMs) {
      return cache.staticData;
    }

    const zipResponse = await apiClient.fetchGtfsStaticZipRaw();
    const entries = parseZipEntries(zipResponse.buffer);
    const stopsBuffer = extractZipEntryFlexible(zipResponse.buffer, entries, 'stops.txt');
    if (!stopsBuffer) {
      throw createGatewayError(
        'AMTAB_REAL_GTFS_PARSE_ERROR',
        'stops.txt not found in GTFS static feed'
      );
    }

    const routesBuffer = extractZipEntryFlexible(zipResponse.buffer, entries, 'routes.txt');
    const tripsBuffer = extractZipEntryFlexible(zipResponse.buffer, entries, 'trips.txt');
    const stopTimesBuffer = extractZipEntryFlexible(zipResponse.buffer, entries, 'stop_times.txt');
    const calendarBuffer = extractZipEntryFlexible(zipResponse.buffer, entries, 'calendar.txt');
    const calendarDatesBuffer = extractZipEntryFlexible(zipResponse.buffer, entries, 'calendar_dates.txt');
    const rawStopsRows = parseCsvTable(stopsBuffer.toString('utf8'));
    const parsedStops = parseStopsRawWithReport(
      { rows: rawStopsRows },
      { logger }
    );
    const routesRows = routesBuffer ? parseCsvTable(routesBuffer.toString('utf8')) : [];
    const tripsRows = tripsBuffer ? parseCsvTable(tripsBuffer.toString('utf8')) : [];
    const stopTimesRows = stopTimesBuffer ? parseCsvTable(stopTimesBuffer.toString('utf8')) : [];
    const calendarRows = calendarBuffer ? parseCsvTable(calendarBuffer.toString('utf8')) : [];
    const calendarDatesRows = calendarDatesBuffer ? parseCsvTable(calendarDatesBuffer.toString('utf8')) : [];

    const routeShortNameByRouteId = new Map();
    routesRows.forEach((row) => {
      const routeId = toUpperToken(row.route_id);
      const routeShortName = toText(row.route_short_name || row.route_long_name || row.route_id);
      if (routeId && routeShortName) {
        routeShortNameByRouteId.set(routeId, routeShortName);
      }
    });

    const staticScheduleContext = buildGtfsStaticScheduleContext({
      tripsRows,
      stopTimesRows,
      calendarRows,
      calendarDatesRows,
      routeShortNameByRouteId
    });

    const parsed = {
      fetchedAtEpochMs: zipResponse.fetchedAtEpochMs || nowEpochMs,
      source: SOURCE_TYPES.OFFICIAL,
      sourceName: 'amtab_gtfs_static',
      endpoint: zipResponse.url,
      stopsRows: parsedStops.records,
      stopsDiscarded: parsedStops.discarded,
      stopsWarnings: parsedStops.warnings,
      linesRows: routesRows,
      routeShortNameByRouteId,
      staticScheduleContext
    };

    if (parsedStops.discarded.length) {
      logger.warn('[AMTAB real gateway] discarded stop records during raw parsing', {
        discardedCount: parsedStops.discarded.length,
        inputCount: parsedStops.inputCount
      });
    }
    if (!tripsRows.length || !stopTimesRows.length) {
      logger.warn('[AMTAB real gateway] static GTFS schedule files missing or empty; scheduled fallback may be limited', {
        hasTrips: tripsRows.length > 0,
        hasStopTimes: stopTimesRows.length > 0
      });
    }
    if (staticScheduleContext.stats.skippedStopTimes > 0) {
      logger.warn('[AMTAB real gateway] skipped invalid stop_times rows while building static schedule index', {
        skippedStopTimes: staticScheduleContext.stats.skippedStopTimes,
        stopTimesCount: staticScheduleContext.stats.stopTimesCount
      });
    }

    cache.staticData = parsed;
    cache.staticFetchedAtEpochMs = nowEpochMs;
    return parsed;
  }

  async function loadTripUpdatesData() {
    const nowEpochMs = now();
    if (cache.tripUpdatesData && nowEpochMs - cache.tripUpdatesFetchedAtEpochMs < tripUpdatesCacheTtlMs) {
      return cache.tripUpdatesData;
    }

    const response = await apiClient.fetchTripUpdatesRaw();
    const parsedPayload = parseTripUpdatesPayload(response.payload, response.fetchedAtEpochMs || nowEpochMs);

    const parsed = {
      fetchedAtEpochMs: response.fetchedAtEpochMs || nowEpochMs,
      source: SOURCE_TYPES.OFFICIAL,
      sourceName: 'amtab_gtfs_rt_tripupdates',
      endpoint: response.url,
      header: parsedPayload.header,
      headerTimestampEpochMs: parsedPayload.headerTimestampEpochMs,
      entities: parsedPayload.entities,
      payload: response.payload
    };

    cache.tripUpdatesData = parsed;
    cache.tripUpdatesFetchedAtEpochMs = nowEpochMs;
    return parsed;
  }

  async function fetchStopsRaw() {
    try {
      const data = await loadStaticData();
      return {
        source: data.source,
        sourceName: data.sourceName,
        endpoint: data.endpoint,
        fetchedAtEpochMs: data.fetchedAtEpochMs,
        rows: data.stopsRows.slice(),
        discarded: Array.isArray(data.stopsDiscarded) ? data.stopsDiscarded.slice() : [],
        warnings: Array.isArray(data.stopsWarnings) ? data.stopsWarnings.slice() : []
      };
    } catch (error) {
      logger.error('AMTAB real gateway fetchStopsRaw failed', error);
      if (error && error.code) {
        throw error;
      }
      throw createGatewayError(
        'AMTAB_REAL_GATEWAY_UNAVAILABLE',
        'Unable to fetch AMTAB GTFS static stops',
        {
          reason: error && error.message ? error.message : String(error)
        }
      );
    }
  }

  async function fetchLinesRaw() {
    try {
      const data = await loadStaticData();
      return {
        source: data.source,
        sourceName: data.sourceName,
        endpoint: data.endpoint,
        fetchedAtEpochMs: data.fetchedAtEpochMs,
        rows: data.linesRows.slice()
      };
    } catch (error) {
      logger.error('AMTAB real gateway fetchLinesRaw failed', error);
      if (error && error.code) {
        throw error;
      }
      throw createGatewayError(
        'AMTAB_REAL_GATEWAY_UNAVAILABLE',
        'Unable to fetch AMTAB GTFS static lines',
        {
          reason: error && error.message ? error.message : String(error)
        }
      );
    }
  }

  async function fetchTripUpdatesRaw() {
    try {
      const data = await loadTripUpdatesData();
      return {
        source: data.source,
        sourceName: data.sourceName,
        endpoint: data.endpoint,
        fetchedAtEpochMs: data.fetchedAtEpochMs,
        headerTimestampEpochMs: data.headerTimestampEpochMs,
        entities: data.entities.slice(),
        payload: data.payload
      };
    } catch (error) {
      logger.error('AMTAB real gateway fetchTripUpdatesRaw failed', error);
      if (error && error.code) {
        throw error;
      }
      throw createGatewayError(
        'AMTAB_REAL_GATEWAY_UNAVAILABLE',
        'Unable to fetch AMTAB GTFS-RT TripUpdates',
        {
          reason: error && error.message ? error.message : String(error)
        }
      );
    }
  }

  async function fetchArrivalsRaw(stopId) {
    if (!stopId) {
      return {
        source: SOURCE_TYPES.OFFICIAL,
        sourceName: 'amtab_gtfs_rt_tripupdates',
        fetchedAtEpochMs: now(),
        rows: [],
        discarded: [],
        duplicates: [],
        contradictions: [],
        warnings: []
      };
    }

    try {
      const [tripUpdatesRaw, linesRaw] = await Promise.all([
        fetchTripUpdatesRaw(),
        fetchLinesRaw()
      ]);

      const routeShortNameByRouteId = new Map();
      linesRaw.rows.forEach((lineRow) => {
        const routeId = toUpperToken(lineRow.route_id);
        const lineId = toText(lineRow.route_short_name || lineRow.route_long_name || lineRow.route_id);
        if (routeId && lineId) {
          routeShortNameByRouteId.set(routeId, lineId);
        }
      });

      const parsed = parseArrivalsRawWithReport(tripUpdatesRaw.payload, {
        logger,
        stopIdFilter: stopId,
        fallbackTimestampEpochMs: tripUpdatesRaw.fetchedAtEpochMs,
        routeShortNameByRouteId
      });

      if (parsed.discarded.length) {
        logger.warn('[AMTAB real gateway] discarded arrival records during raw parsing', {
          discardedCount: parsed.discarded.length,
          inputCount: parsed.inputCount
        });
      }

      return {
        source: tripUpdatesRaw.source,
        sourceName: tripUpdatesRaw.sourceName,
        endpoint: tripUpdatesRaw.endpoint,
        fetchedAtEpochMs: tripUpdatesRaw.fetchedAtEpochMs,
        headerTimestampEpochMs: parsed.headerTimestampEpochMs,
        rows: parsed.records,
        discarded: parsed.discarded,
        duplicates: parsed.duplicates,
        contradictions: parsed.contradictions,
        warnings: parsed.warnings
      };
    } catch (error) {
      logger.error('AMTAB real gateway fetchArrivalsRaw failed', error);
      if (error && error.code) {
        throw error;
      }
      throw createGatewayError(
        'AMTAB_REAL_GATEWAY_UNAVAILABLE',
        'Unable to derive raw arrivals from GTFS-RT TripUpdates',
        {
          reason: error && error.message ? error.message : String(error)
        }
      );
    }
  }

  async function searchStops(query) {
    const raw = await fetchStopsRaw();
    const nowEpochMs = now();
    const thresholds = safeReliabilityThresholds(reliabilityPolicy);
    const normalized = raw.rows
      .map((row) =>
        mapRawStopToStop(row, {
          nowEpochMs,
          referenceEpochMs: raw.fetchedAtEpochMs,
          source: raw.source,
          sourceName: raw.sourceName,
          verifiedOfficial: raw.source === SOURCE_TYPES.OFFICIAL,
          predictionType: PREDICTION_TYPES.SCHEDULED,
          thresholds
        })
      )
      .filter(Boolean);
    if (!query) {
      return normalized;
    }

    const normalizedQuery = normalizeText(query);
    return normalized.filter((stop) => {
      const candidates = [stop.name].concat(stop.aliases || []).map((value) => normalizeText(value));
      return candidates.some((candidate) => candidate.includes(normalizedQuery));
    });
  }

  async function getStopArrivals(stopId) {
    const raw = await fetchArrivalsRaw(stopId);
    const nowEpochMs = now();
    const thresholds = safeReliabilityThresholds(reliabilityPolicy);
    const contradictionCount = Array.isArray(raw.contradictions) ? raw.contradictions.length : 0;

    const arrivals = raw.rows
      .map((rawArrival) => {
        return mapRawArrivalToArrival(rawArrival, {
          nowEpochMs,
          referenceEpochMs: raw.headerTimestampEpochMs || raw.fetchedAtEpochMs,
          source: raw.source,
          sourceName: raw.sourceName,
          verifiedOfficial: raw.source === SOURCE_TYPES.OFFICIAL,
          thresholds,
          contradictionCount
        });
      })
      .map((arrival) => applyArrivalProvenanceGuard(arrival))
      .filter(Boolean);

    return sortByEta(arrivals);
  }

  async function getRealtimePredictions(stopId, lineId) {
    const arrivals = await getStopArrivals(stopId);
    return arrivals.filter((arrival) => {
      return arrival.predictionType === PREDICTION_TYPES.REALTIME && lineMatches(arrival.lineId, lineId);
    });
  }

  function buildScheduledRawRowsFromStatic(staticData, stopId, lineId) {
    const stopToken = toUpperToken(stopId);
    if (!stopToken || !staticData || !staticData.staticScheduleContext) {
      return [];
    }

    const scheduleEntries = staticData.staticScheduleContext.scheduleByStopId.get(stopToken) || [];
    if (!scheduleEntries.length) {
      return [];
    }

    const nowEpochMs = now();
    const serviceDateCandidates = buildServiceDateCandidates(nowEpochMs, serviceTimeZone);
    const dedupeKeys = new Set();
    const scheduledRows = [];

    serviceDateCandidates.forEach((serviceDateCandidate) => {
      scheduleEntries.forEach((entry) => {
        if (!lineMatches(entry.lineId, lineId)) {
          return;
        }
        if (
          !isServiceActiveOnDate(
            staticData.staticScheduleContext.serviceCalendar,
            entry.serviceId,
            serviceDateCandidate.dateKey,
            serviceDateCandidate.weekdayKey
          )
        ) {
          return;
        }

        const scheduledEpochMs = parseFlexibleTimeValue(entry.arrivalTimeText, {
          referenceEpochMs: nowEpochMs,
          serviceDate: serviceDateCandidate.isoDate,
          serviceTimeZone,
          allowRollover: false,
          interpretSecondsOfDay: false
        });
        if (typeof scheduledEpochMs !== 'number') {
          return;
        }

        const etaMinutes = Math.round((scheduledEpochMs - nowEpochMs) / 60000);
        if (etaMinutes < -scheduledWindowPastMinutes || etaMinutes > scheduledWindowAheadMinutes) {
          return;
        }

        const dedupeKey = `${entry.tripId}|${entry.stopId}|${entry.lineId}|${scheduledEpochMs}`;
        if (dedupeKeys.has(dedupeKey)) {
          return;
        }
        dedupeKeys.add(dedupeKey);

        scheduledRows.push({
          stopId: entry.stopId,
          lineId: entry.lineId,
          lineNumber: entry.lineNumber || entry.lineId,
          routeId: entry.routeId,
          destinationName: entry.destinationName,
          scheduledEpochMs,
          predictedEpochMs: null,
          realtimeEpochMs: null,
          recordType: PREDICTION_TYPES.SCHEDULED,
          tripId: entry.tripId,
          asOfEpochMs: nowEpochMs,
          source: SOURCE_TYPES.OFFICIAL,
          sourceName: 'amtab_gtfs_static',
          rawIndex: `${serviceDateCandidate.dateKey}:${entry.tripId}:${entry.stopSequence || 'na'}`,
          metadata: {
            serviceDate: serviceDateCandidate.isoDate,
            serviceDateKey: serviceDateCandidate.dateKey,
            weekdayKey: serviceDateCandidate.weekdayKey,
            directionId: entry.directionId
          }
        });
      });
    });

    scheduledRows.sort((left, right) => left.scheduledEpochMs - right.scheduledEpochMs);
    if (scheduledRows.length > scheduledMaxResults) {
      return scheduledRows.slice(0, scheduledMaxResults);
    }
    return scheduledRows;
  }

  async function getScheduledArrivals(stopId, lineId) {
    if (!stopId) {
      return [];
    }

    const nowEpochMs = now();
    const thresholds = safeReliabilityThresholds(reliabilityPolicy);
    try {
      const staticData = await loadStaticData();
      const scheduledRawRows = buildScheduledRawRowsFromStatic(staticData, stopId, lineId);
      const scheduledArrivals = scheduledRawRows
        .map((rawArrival) =>
          mapRawArrivalToArrival(rawArrival, {
            nowEpochMs,
            referenceEpochMs: nowEpochMs,
            source: SOURCE_TYPES.OFFICIAL,
            sourceName: 'amtab_gtfs_static',
            verifiedOfficial: true,
            predictionType: PREDICTION_TYPES.SCHEDULED,
            thresholds
          })
        )
        .map((arrival) => applyArrivalProvenanceGuard(arrival))
        .filter(Boolean);

      if (scheduledArrivals.length) {
        return sortByEta(scheduledArrivals);
      }
    } catch (error) {
      logger.warn('[AMTAB real gateway] static scheduled derivation failed, fallback to TripUpdates scheduled', {
        code: error && error.code ? error.code : 'UNKNOWN',
        message: error && error.message ? error.message : String(error)
      });
    }

    const arrivals = await getStopArrivals(stopId);
    return arrivals.filter((arrival) => {
      return arrival.predictionType === PREDICTION_TYPES.SCHEDULED && lineMatches(arrival.lineId, lineId);
    });
  }

  async function searchLines(query) {
    const raw = await fetchLinesRaw();
    const nowEpochMs = now();
    const thresholds = safeReliabilityThresholds(reliabilityPolicy);
    const normalized = raw.rows
      .map((row) =>
        mapRawLineToLine(row, {
          nowEpochMs,
          referenceEpochMs: raw.fetchedAtEpochMs,
          source: raw.source,
          sourceName: raw.sourceName,
          verifiedOfficial: raw.source === SOURCE_TYPES.OFFICIAL,
          predictionType: PREDICTION_TYPES.SCHEDULED,
          thresholds
        })
      )
      .filter(Boolean);
    if (!query) {
      return normalized;
    }
    const normalizedQuery = normalizeText(query);
    return normalized.filter((line) => {
      const candidates = [line.id, line.code].concat(line.aliases || []).map((entry) => normalizeText(entry));
      return candidates.some((candidate) => candidate.includes(normalizedQuery));
    });
  }

  async function ping() {
    const [stopsRaw, tripUpdatesRaw] = await Promise.all([
      fetchStopsRaw(),
      fetchTripUpdatesRaw()
    ]);
    if (!Array.isArray(stopsRaw.rows) || !stopsRaw.rows.length) {
      throw createGatewayError(
        'AMTAB_REAL_GATEWAY_HEALTHCHECK_FAILED',
        'AMTAB GTFS static feed returned zero stops'
      );
    }
    if (!Array.isArray(tripUpdatesRaw.entities)) {
      throw createGatewayError(
        'AMTAB_REAL_GATEWAY_HEALTHCHECK_FAILED',
        'AMTAB GTFS-RT TripUpdates payload is not parseable'
      );
    }
    return true;
  }

  return {
    fetchStopsRaw,
    fetchArrivalsRaw,
    fetchLinesRaw,
    fetchTripUpdatesRaw,
    searchStops,
    searchLines,
    getStopArrivals,
    getRealtimePredictions,
    getScheduledArrivals,
    ping
  };
}

module.exports = {
  createAmtabRealGateway
};
