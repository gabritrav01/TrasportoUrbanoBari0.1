'use strict';

const DEFAULT_TIMEOUT_MS = 3500;

function createGatewayError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details && typeof details === 'object') {
    error.details = details;
  }
  return error;
}

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function createAmtabRealApiClient(options = {}) {
  const fetchFn = options.fetchFn || global.fetch;
  if (typeof fetchFn !== 'function') {
    throw createGatewayError(
      'AMTAB_REAL_CLIENT_CONFIG_ERROR',
      'Global fetch is not available. Provide fetchFn in createAmtabRealApiClient options.'
    );
  }

  const logger = options.logger || console;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const requestTimeoutMs =
    typeof options.requestTimeoutMs === 'number' && options.requestTimeoutMs > 0
      ? Math.floor(options.requestTimeoutMs)
      : DEFAULT_TIMEOUT_MS;
  const stopsFeedUrl = options.stopsFeedUrl || '';
  const tripUpdatesUrl = options.tripUpdatesUrl || '';

  async function requestBuffer(url, requestLabel, acceptHeader) {
    const target = toText(url);
    if (!target) {
      throw createGatewayError(
        'AMTAB_REAL_CLIENT_CONFIG_ERROR',
        `Missing URL for ${requestLabel}`
      );
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetchFn(target, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: acceptHeader || '*/*'
        }
      });

      if (!response.ok) {
        throw createGatewayError(
          'AMTAB_REAL_CLIENT_HTTP_ERROR',
          `HTTP ${response.status} while calling ${requestLabel}`,
          {
            status: response.status,
            url: target
          }
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return {
        url: target,
        fetchedAtEpochMs: now(),
        status: response.status,
        buffer: Buffer.from(arrayBuffer)
      };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw createGatewayError(
          'AMTAB_REAL_CLIENT_TIMEOUT',
          `Timeout while calling ${requestLabel}`,
          {
            timeoutMs: requestTimeoutMs,
            url: target
          }
        );
      }
      if (error && error.code) {
        throw error;
      }

      logger.error(`AMTAB real api client request failed: ${requestLabel}`, error);
      throw createGatewayError(
        'AMTAB_REAL_CLIENT_UNAVAILABLE',
        `Unable to call ${requestLabel}`,
        {
          url: target,
          reason: error && error.message ? error.message : String(error)
        }
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async function requestJson(url, requestLabel) {
    const response = await requestBuffer(url, requestLabel, 'application/json, text/plain, */*');
    const payloadText = response.buffer.toString('utf8');
    try {
      return {
        ...response,
        payload: JSON.parse(payloadText)
      };
    } catch (error) {
      throw createGatewayError(
        'AMTAB_REAL_CLIENT_PARSE_ERROR',
        `Invalid JSON payload from ${requestLabel}`,
        {
          url: response.url,
          reason: error && error.message ? error.message : String(error)
        }
      );
    }
  }

  async function fetchGtfsStaticZipRaw() {
    return requestBuffer(stopsFeedUrl, 'amtab_gtfs_static_zip', 'application/zip, application/octet-stream, */*');
  }

  async function fetchTripUpdatesRaw() {
    return requestJson(tripUpdatesUrl, 'amtab_gtfs_rt_tripupdates');
  }

  return {
    fetchGtfsStaticZipRaw,
    fetchTripUpdatesRaw
  };
}

module.exports = {
  createAmtabRealApiClient,
  createGatewayError
};

