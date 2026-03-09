'use strict';

const JS_WEEKDAY_TO_GTFS = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday'
]);

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

function normalizeGtfsDateKey(value) {
  const text = toText(value);
  if (!text) {
    return '';
  }
  if (/^\d{8}$/.test(text)) {
    return text;
  }
  const normalized = text.replace(/-/g, '');
  if (/^\d{8}$/.test(normalized)) {
    return normalized;
  }
  return '';
}

function toIsoDateFromDateKey(dateKey) {
  const normalized = normalizeGtfsDateKey(dateKey);
  if (!normalized) {
    return '';
  }
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

function weekdayKeyForDateKey(dateKey) {
  const normalized = normalizeGtfsDateKey(dateKey);
  if (!normalized) {
    return null;
  }
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6));
  const day = Number(normalized.slice(6, 8));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const weekday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  return JS_WEEKDAY_TO_GTFS[weekday] || null;
}

function parseGtfsTimeToSeconds(value) {
  const text = toText(value);
  const match = text.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  if (hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function buildTripsById(tripsRows) {
  const byTripId = new Map();
  (Array.isArray(tripsRows) ? tripsRows : []).forEach((row) => {
    const tripId = toUpperToken(row.trip_id || row.tripId);
    if (!tripId) {
      return;
    }
    byTripId.set(tripId, {
      tripId,
      routeId: toUpperToken(row.route_id || row.routeId),
      serviceId: toUpperToken(row.service_id || row.serviceId),
      destinationName: toText(row.trip_headsign || row.tripHeadsign),
      directionId: toText(row.direction_id || row.directionId) || null
    });
  });
  return byTripId;
}

function buildServiceCalendar(calendarRows, calendarDatesRows) {
  const calendarByService = new Map();
  (Array.isArray(calendarRows) ? calendarRows : []).forEach((row) => {
    const serviceId = toUpperToken(row.service_id || row.serviceId);
    if (!serviceId) {
      return;
    }
    calendarByService.set(serviceId, {
      startDate: normalizeGtfsDateKey(row.start_date || row.startDate),
      endDate: normalizeGtfsDateKey(row.end_date || row.endDate),
      monday: toText(row.monday) === '1',
      tuesday: toText(row.tuesday) === '1',
      wednesday: toText(row.wednesday) === '1',
      thursday: toText(row.thursday) === '1',
      friday: toText(row.friday) === '1',
      saturday: toText(row.saturday) === '1',
      sunday: toText(row.sunday) === '1'
    });
  });

  const exceptionsByServiceDate = new Map();
  (Array.isArray(calendarDatesRows) ? calendarDatesRows : []).forEach((row) => {
    const serviceId = toUpperToken(row.service_id || row.serviceId);
    const dateKey = normalizeGtfsDateKey(row.date);
    const exceptionType = toNumberOrNull(row.exception_type || row.exceptionType);
    if (!serviceId || !dateKey || (exceptionType !== 1 && exceptionType !== 2)) {
      return;
    }
    exceptionsByServiceDate.set(`${serviceId}|${dateKey}`, exceptionType);
  });

  return {
    hasSignals: calendarByService.size > 0 || exceptionsByServiceDate.size > 0,
    calendarByService,
    exceptionsByServiceDate
  };
}

function isServiceActiveOnDate(serviceCalendar, serviceId, serviceDateKey, weekdayKey) {
  const safeServiceId = toUpperToken(serviceId);
  const dateKey = normalizeGtfsDateKey(serviceDateKey);
  if (!safeServiceId) {
    return true;
  }
  if (!dateKey) {
    return false;
  }
  const calendar = serviceCalendar || {};
  const exceptionsByServiceDate =
    calendar.exceptionsByServiceDate && typeof calendar.exceptionsByServiceDate.get === 'function'
      ? calendar.exceptionsByServiceDate
      : new Map();
  const calendarByService =
    calendar.calendarByService && typeof calendar.calendarByService.get === 'function'
      ? calendar.calendarByService
      : new Map();
  const hasSignals = calendar.hasSignals === true;

  if (!hasSignals) {
    return true;
  }

  const exception = exceptionsByServiceDate.get(`${safeServiceId}|${dateKey}`);
  if (exception === 1) {
    return true;
  }
  if (exception === 2) {
    return false;
  }

  const base = calendarByService.get(safeServiceId);
  if (!base) {
    return false;
  }

  const weekday = toText(weekdayKey).toLowerCase();
  if (!weekday || base[weekday] !== true) {
    return false;
  }
  if (base.startDate && dateKey < base.startDate) {
    return false;
  }
  if (base.endDate && dateKey > base.endDate) {
    return false;
  }
  return true;
}

function buildScheduleByStopId(stopTimesRows, tripsByTripId, routeShortNameByRouteId) {
  const scheduleByStopId = new Map();
  let skippedStopTimes = 0;

  (Array.isArray(stopTimesRows) ? stopTimesRows : []).forEach((row) => {
    const tripId = toUpperToken(row.trip_id || row.tripId);
    const stopId = toUpperToken(row.stop_id || row.stopId);
    const arrivalTimeText = toText(row.arrival_time || row.arrivalTime || row.departure_time || row.departureTime);
    const departureTimeText = toText(row.departure_time || row.departureTime || row.arrival_time || row.arrivalTime);
    const arrivalSeconds = parseGtfsTimeToSeconds(arrivalTimeText);
    const stopSequence = toNumberOrNull(row.stop_sequence || row.stopSequence);
    const trip = tripId ? tripsByTripId.get(tripId) : null;

    if (!tripId || !stopId || !arrivalTimeText || arrivalSeconds === null || !trip) {
      skippedStopTimes += 1;
      return;
    }

    const routeId = trip.routeId || toUpperToken(row.route_id || row.routeId);
    const lineId = toText(
      routeShortNameByRouteId.get(routeId) || row.route_short_name || row.routeShortName || routeId
    );
    if (!lineId) {
      skippedStopTimes += 1;
      return;
    }

    const entry = {
      stopId,
      tripId,
      routeId: routeId || null,
      lineId,
      lineNumber: lineId,
      destinationName: trip.destinationName || null,
      directionId: trip.directionId || null,
      serviceId: trip.serviceId || null,
      arrivalTimeText,
      departureTimeText,
      arrivalSeconds,
      stopSequence: stopSequence === null ? null : Math.round(stopSequence)
    };

    if (!scheduleByStopId.has(stopId)) {
      scheduleByStopId.set(stopId, []);
    }
    scheduleByStopId.get(stopId).push(entry);
  });

  scheduleByStopId.forEach((entries) => {
    entries.sort((a, b) => {
      if (a.arrivalSeconds !== b.arrivalSeconds) {
        return a.arrivalSeconds - b.arrivalSeconds;
      }
      if (a.lineId !== b.lineId) {
        return a.lineId.localeCompare(b.lineId);
      }
      return a.tripId.localeCompare(b.tripId);
    });
  });

  return {
    scheduleByStopId,
    skippedStopTimes
  };
}

function buildGtfsStaticScheduleContext(options = {}) {
  const tripsRows = Array.isArray(options.tripsRows) ? options.tripsRows : [];
  const stopTimesRows = Array.isArray(options.stopTimesRows) ? options.stopTimesRows : [];
  const calendarRows = Array.isArray(options.calendarRows) ? options.calendarRows : [];
  const calendarDatesRows = Array.isArray(options.calendarDatesRows) ? options.calendarDatesRows : [];
  const routeShortNameByRouteId =
    options.routeShortNameByRouteId && typeof options.routeShortNameByRouteId.get === 'function'
      ? options.routeShortNameByRouteId
      : new Map();

  const tripsByTripId = buildTripsById(tripsRows);
  const serviceCalendar = buildServiceCalendar(calendarRows, calendarDatesRows);
  const schedule = buildScheduleByStopId(stopTimesRows, tripsByTripId, routeShortNameByRouteId);

  return {
    tripsByTripId,
    serviceCalendar,
    scheduleByStopId: schedule.scheduleByStopId,
    stats: {
      tripsCount: tripsRows.length,
      stopTimesCount: stopTimesRows.length,
      calendarCount: calendarRows.length,
      calendarDatesCount: calendarDatesRows.length,
      scheduleStopCount: schedule.scheduleByStopId.size,
      skippedStopTimes: schedule.skippedStopTimes
    }
  };
}

module.exports = {
  normalizeGtfsDateKey,
  toIsoDateFromDateKey,
  weekdayKeyForDateKey,
  parseGtfsTimeToSeconds,
  buildGtfsStaticScheduleContext,
  isServiceActiveOnDate
};

