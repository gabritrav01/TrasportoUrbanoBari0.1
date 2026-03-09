'use strict';

const DEFAULT_SERVICE_TIME_ZONE = 'Europe/Rome';
const CLOCK_TIME_PATTERN = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;

const FORMATTER_CACHE = new Map();

function getDateTimeFormatter(timeZone) {
  const key = `datetime:${timeZone}`;
  if (FORMATTER_CACHE.has(key)) {
    return FORMATTER_CACHE.get(key);
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  FORMATTER_CACHE.set(key, formatter);
  return formatter;
}

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

function toEpochMsNumberOrNull(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) {
    return null;
  }
  if (numeric > 1000000000000) {
    return Math.round(numeric);
  }
  if (numeric > 1000000000) {
    return Math.round(numeric * 1000);
  }
  return null;
}

function formatToPartMap(formatter, epochMs) {
  const parts = formatter.formatToParts(new Date(epochMs));
  const map = {};
  parts.forEach((part) => {
    if (part.type === 'literal') {
      return;
    }
    map[part.type] = part.value;
  });
  return map;
}

function getZonedDateTimeParts(epochMs, timeZone) {
  const formatter = getDateTimeFormatter(timeZone);
  const map = formatToPartMap(formatter, epochMs);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function getOffsetMsForTimeZone(epochMs, timeZone) {
  const parts = getZonedDateTimeParts(epochMs, timeZone);
  const asUtcEpochMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );
  return asUtcEpochMs - epochMs;
}

function zonedDateTimeToEpochMs(parts, timeZone) {
  const utcGuessEpochMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    parts.millisecond || 0
  );

  const offsetInitialMs = getOffsetMsForTimeZone(utcGuessEpochMs, timeZone);
  let epochMs = utcGuessEpochMs - offsetInitialMs;
  const offsetRefinedMs = getOffsetMsForTimeZone(epochMs, timeZone);
  if (offsetRefinedMs !== offsetInitialMs) {
    epochMs = utcGuessEpochMs - offsetRefinedMs;
  }
  return epochMs;
}

function parseYyyyMmDd(value) {
  const text = toText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function resolveServiceDateParts(serviceDate, referenceEpochMs, timeZone) {
  const parsedString = parseYyyyMmDd(serviceDate);
  if (parsedString) {
    return parsedString;
  }

  if (serviceDate instanceof Date && !Number.isNaN(serviceDate.getTime())) {
    const parts = getZonedDateTimeParts(serviceDate.getTime(), timeZone);
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day
    };
  }

  if (typeof serviceDate === 'number' && Number.isFinite(serviceDate)) {
    const parts = getZonedDateTimeParts(serviceDate, timeZone);
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day
    };
  }

  if (
    serviceDate &&
    typeof serviceDate === 'object' &&
    Number.isFinite(serviceDate.year) &&
    Number.isFinite(serviceDate.month) &&
    Number.isFinite(serviceDate.day)
  ) {
    return {
      year: Number(serviceDate.year),
      month: Number(serviceDate.month),
      day: Number(serviceDate.day)
    };
  }

  const reference = typeof referenceEpochMs === 'number' ? referenceEpochMs : Date.now();
  const parts = getZonedDateTimeParts(reference, timeZone);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day
  };
}

function resolveMidnightEpochMs(referenceEpochMs, options = {}) {
  const timeZone = toText(options.serviceTimeZone) || DEFAULT_SERVICE_TIME_ZONE;
  const serviceDateParts = resolveServiceDateParts(options.serviceDate, referenceEpochMs, timeZone);
  return zonedDateTimeToEpochMs(
    {
      year: serviceDateParts.year,
      month: serviceDateParts.month,
      day: serviceDateParts.day,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0
    },
    timeZone
  );
}

function parseClockTimeToEpochMs(clockText, options = {}) {
  const match = toText(clockText).match(CLOCK_TIME_PATTERN);
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

  const referenceEpochMs =
    typeof options.referenceEpochMs === 'number' ? options.referenceEpochMs : Date.now();
  const midnightEpochMs = resolveMidnightEpochMs(referenceEpochMs, options);
  let candidateEpochMs = midnightEpochMs + ((hours * 60 + minutes) * 60 + seconds) * 1000;

  const allowRollover = options.allowRollover !== false;
  if (allowRollover) {
    const rolloverReferenceEpochMs =
      typeof options.rolloverReferenceEpochMs === 'number' ? options.rolloverReferenceEpochMs : null;
    const rolloverPastMinutes =
      typeof options.rolloverPastMinutes === 'number' && options.rolloverPastMinutes >= 0
        ? options.rolloverPastMinutes
        : 2;
    if (rolloverReferenceEpochMs !== null) {
      const thresholdMs = rolloverPastMinutes * 60 * 1000;
      let guard = 0;
      while (candidateEpochMs < rolloverReferenceEpochMs - thresholdMs && guard < 4) {
        candidateEpochMs += 24 * 60 * 60 * 1000;
        guard += 1;
      }
    }
  }

  return candidateEpochMs;
}

function parseLocalDateTimeToEpochMs(text, options = {}) {
  const match = toText(text).match(LOCAL_DATETIME_PATTERN);
  if (!match) {
    return null;
  }
  const timeZone = toText(options.serviceTimeZone) || DEFAULT_SERVICE_TIME_ZONE;
  return zonedDateTimeToEpochMs(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] || 0),
      millisecond: Number((match[7] || '0').padEnd(3, '0'))
    },
    timeZone
  );
}

function parseFlexibleTimeValue(value, options = {}) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (value > 1000000000000) {
      return Math.round(value);
    }
    if (value > 1000000000) {
      return Math.round(value * 1000);
    }
    if (value >= 0 && value <= 86400 && options.interpretSecondsOfDay !== false) {
      const referenceEpochMs =
        typeof options.referenceEpochMs === 'number' ? options.referenceEpochMs : Date.now();
      const midnightEpochMs = resolveMidnightEpochMs(referenceEpochMs, options);
      let candidateEpochMs = midnightEpochMs + Math.round(value * 1000);
      if (options.allowRollover !== false && typeof options.rolloverReferenceEpochMs === 'number') {
        const rolloverPastMinutes =
          typeof options.rolloverPastMinutes === 'number' && options.rolloverPastMinutes >= 0
            ? options.rolloverPastMinutes
            : 2;
        const thresholdMs = rolloverPastMinutes * 60 * 1000;
        let guard = 0;
        while (candidateEpochMs < options.rolloverReferenceEpochMs - thresholdMs && guard < 4) {
          candidateEpochMs += 24 * 60 * 60 * 1000;
          guard += 1;
        }
      }
      return candidateEpochMs;
    }
    return null;
  }

  const text = toText(value);
  if (!text) {
    return null;
  }

  const numericEpoch = toEpochMsNumberOrNull(text);
  if (numericEpoch !== null) {
    return numericEpoch;
  }

  const clockEpochMs = parseClockTimeToEpochMs(text, options);
  if (clockEpochMs !== null) {
    return clockEpochMs;
  }

  const localDateTimeEpochMs = parseLocalDateTimeToEpochMs(text, options);
  if (localDateTimeEpochMs !== null) {
    return localDateTimeEpochMs;
  }

  const isoEpochMs = Date.parse(text);
  if (!Number.isNaN(isoEpochMs)) {
    return isoEpochMs;
  }
  return null;
}

module.exports = {
  DEFAULT_SERVICE_TIME_ZONE,
  resolveServiceDateParts,
  resolveMidnightEpochMs,
  parseClockTimeToEpochMs,
  parseFlexibleTimeValue
};
