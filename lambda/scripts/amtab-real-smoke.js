'use strict';

const fs = require('fs');
const path = require('path');
const { createTransitService } = require('../services/transitService');

const REQUIRED_PROVENANCE_FIELDS = Object.freeze([
  'source',
  'sourceName',
  'predictionType',
  'confidence',
  'reliabilityBand',
  'freshness'
]);

const RELIABILITY_BANDS = new Set(['direct', 'caution', 'degraded', 'discard']);
const DEFAULT_INPUT_PATH = path.resolve(__dirname, '../tests/smoke/amtab-real-smoke.input.example.json');
const DEFAULT_SNAPSHOT_DIR = path.resolve(__dirname, '../tests/smoke/output');

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  function readFlagValue(flagName) {
    const index = args.indexOf(flagName);
    if (index === -1 || index === args.length - 1) {
      return null;
    }
    return args[index + 1];
  }

  return {
    inputPath: readFlagValue('--input') || process.env.AMTAB_SMOKE_INPUT_PATH || DEFAULT_INPUT_PATH,
    snapshotDir: readFlagValue('--snapshot-dir') || process.env.AMTAB_SMOKE_SNAPSHOT_DIR || DEFAULT_SNAPSHOT_DIR,
    maxRows: Math.max(1, Number(readFlagValue('--max-rows')) || 10),
    writeSnapshot: !args.includes('--no-snapshot')
  };
}

function ensureRuntimeMode() {
  if (process.env.TRANSPORT_DATA_MODE !== 'amtab_real') {
    process.env.TRANSPORT_DATA_MODE = 'amtab_real';
  }
  if (process.env.MOOVIT_FALLBACK_ENABLED === undefined || process.env.MOOVIT_FALLBACK_ENABLED === '') {
    process.env.MOOVIT_FALLBACK_ENABLED = 'false';
  }
}

function readInputFile(inputPath) {
  const resolvedPath = path.resolve(inputPath);
  const payload = fs.readFileSync(resolvedPath, 'utf8');
  return {
    resolvedPath,
    data: JSON.parse(payload)
  };
}

function toNonEmptyString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function toStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => toNonEmptyString(value)).filter(Boolean);
}

function summarizeFreshness(freshness) {
  if (!freshness || typeof freshness !== 'object') {
    return 'n/a';
  }
  const bucket = toNonEmptyString(freshness.bucket) || 'unknown';
  const score =
    typeof freshness.freshnessScore === 'number' && Number.isFinite(freshness.freshnessScore)
      ? freshness.freshnessScore.toFixed(2)
      : 'n/a';
  const age =
    typeof freshness.ageSec === 'number' && Number.isFinite(freshness.ageSec)
      ? `${Math.round(freshness.ageSec)}s`
      : 'n/a';
  return `${bucket} score=${score} age=${age}`;
}

function toProvenanceRecord(entry, extras = {}) {
  const record = entry && typeof entry === 'object' ? entry : {};
  return {
    ...extras,
    source: record.source !== undefined ? record.source : null,
    sourceName: record.sourceName !== undefined ? record.sourceName : null,
    predictionType: record.predictionType !== undefined ? record.predictionType : null,
    confidence: record.confidence !== undefined ? record.confidence : null,
    reliabilityBand: record.reliabilityBand !== undefined ? record.reliabilityBand : null,
    freshness: record.freshness !== undefined ? record.freshness : null
  };
}

function validateArrivalProvenance(flowName, records) {
  const errors = [];
  const warnings = [];
  const safeRecords = Array.isArray(records) ? records : [];

  safeRecords.forEach((record, index) => {
    REQUIRED_PROVENANCE_FIELDS.forEach((fieldName) => {
      if (record[fieldName] === undefined || record[fieldName] === null) {
        errors.push(`[${flowName}] record ${index} missing ${fieldName}`);
      }
    });

    if (record.reliabilityBand && !RELIABILITY_BANDS.has(String(record.reliabilityBand).toLowerCase())) {
      errors.push(`[${flowName}] record ${index} has invalid reliabilityBand=${record.reliabilityBand}`);
    }
    if (
      typeof record.confidence !== 'number' ||
      !Number.isFinite(record.confidence) ||
      record.confidence < 0 ||
      record.confidence > 1
    ) {
      errors.push(`[${flowName}] record ${index} has invalid confidence=${record.confidence}`);
    }
  });

  if (!safeRecords.length) {
    warnings.push(`[${flowName}] no records returned`);
  }

  return { errors, warnings };
}

function validateRoutes(flowName, routes, provenanceRecords) {
  const errors = [];
  const warnings = [];
  const safeRoutes = Array.isArray(routes) ? routes : [];

  safeRoutes.forEach((route, index) => {
    if (!toNonEmptyString(route && route.lineId)) {
      errors.push(`[${flowName}] route ${index} missing lineId`);
    }
    if (!toNonEmptyString(route && route.destinationName)) {
      errors.push(`[${flowName}] route ${index} missing destinationName`);
    }
  });

  if (!safeRoutes.length) {
    warnings.push(`[${flowName}] no routes returned`);
  }

  const hasMissingRouteProvenance = (provenanceRecords || []).some((record) =>
    REQUIRED_PROVENANCE_FIELDS.some((fieldName) => record[fieldName] === null)
  );
  if (hasMissingRouteProvenance) {
    warnings.push(
      `[${flowName}] route result does not expose full provenance fields; logged as null where unavailable`
    );
  }

  return { errors, warnings };
}

async function resolveByIdOrQuery(params) {
  const {
    kindLabel,
    fixedId,
    query,
    fallbackQueries,
    fetchByQuery
  } = params;

  const fixed = toNonEmptyString(fixedId);
  if (fixed) {
    return {
      id: fixed,
      strategy: 'explicit_id',
      queryUsed: null,
      candidatesCount: null
    };
  }

  const orderedQueries = [];
  const mainQuery = toNonEmptyString(query);
  if (mainQuery) {
    orderedQueries.push(mainQuery);
  }
  toStringArray(fallbackQueries).forEach((candidate) => {
    if (!orderedQueries.includes(candidate)) {
      orderedQueries.push(candidate);
    }
  });

  for (const queryCandidate of orderedQueries) {
    const candidates = await fetchByQuery(queryCandidate);
    if (Array.isArray(candidates) && candidates.length > 0) {
      const first = candidates[0];
      return {
        id: first.id,
        strategy: 'query',
        queryUsed: queryCandidate,
        candidatesCount: candidates.length
      };
    }
  }

  throw new Error(`Unable to resolve ${kindLabel} from input query/id`);
}

function printHeader(title) {
  console.log('\n============================================================');
  console.log(title);
  console.log('============================================================');
}

function printFlowResult(flowName, flowData, maxRows) {
  printHeader(`Smoke Flow: ${flowName}`);
  console.log(`Status: ${flowData.status}`);
  console.log('Resolved input:', flowData.resolvedInput);
  console.log(`Raw result count: ${flowData.rawCount}`);

  const tableRows = (flowData.provenanceRecords || []).slice(0, maxRows).map((record) => ({
    label: record.label || null,
    source: record.source,
    sourceName: record.sourceName,
    predictionType: record.predictionType,
    confidence:
      typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? Number(record.confidence.toFixed(3))
        : record.confidence,
    reliabilityBand: record.reliabilityBand,
    freshness: summarizeFreshness(record.freshness)
  }));

  if (tableRows.length > 0) {
    console.table(tableRows);
  } else {
    console.log('No records to show.');
  }

  if (flowData.warnings.length) {
    console.log('Warnings:');
    flowData.warnings.forEach((warning) => console.log(` - ${warning}`));
  }
  if (flowData.errors.length) {
    console.log('Errors:');
    flowData.errors.forEach((error) => console.log(` - ${error}`));
  }
}

async function runNextArrivalsByStopFlow(transportService, input) {
  const config = input.nextArrivalsByStop || {};
  const fallbackQueries = input.fallbackQueries || {};
  const stopResolution = await resolveByIdOrQuery({
    kindLabel: 'stop',
    fixedId: config.stopId,
    query: config.stopQuery,
    fallbackQueries: fallbackQueries.stops,
    fetchByQuery: (query) => transportService.searchStops(query)
  });
  const lineResolution = await resolveByIdOrQuery({
    kindLabel: 'line',
    fixedId: config.lineId,
    query: config.lineQuery,
    fallbackQueries: fallbackQueries.lines,
    fetchByQuery: (query) => transportService.searchLines(query)
  }).catch(() => null);

  const rawResult = await transportService.getNextArrivalsByStop({
    stopId: stopResolution.id,
    lineId: lineResolution ? lineResolution.id : null
  });
  const provenanceRecords = (rawResult || []).map((entry) =>
    toProvenanceRecord(entry, {
      label: `linea ${entry.lineId || 'n/a'} -> ${entry.destinationName || 'n/a'}`
    })
  );
  const validation = validateArrivalProvenance('nextArrivalsByStop', provenanceRecords);

  return {
    flowName: 'nextArrivalsByStop',
    resolvedInput: {
      stop: stopResolution,
      line: lineResolution
    },
    rawCount: Array.isArray(rawResult) ? rawResult.length : 0,
    rawResult: Array.isArray(rawResult) ? rawResult : [],
    provenanceRecords,
    warnings: validation.warnings,
    errors: validation.errors
  };
}

async function runLineDirectionArrivalsFlow(transportService, input) {
  const config = input.lineDirectionArrivals || {};
  const fallbackQueries = input.fallbackQueries || {};
  const lineResolution = await resolveByIdOrQuery({
    kindLabel: 'line',
    fixedId: config.lineId,
    query: config.lineQuery,
    fallbackQueries: fallbackQueries.lines,
    fetchByQuery: (query) => transportService.searchLines(query)
  });
  const stopResolution = await resolveByIdOrQuery({
    kindLabel: 'stop',
    fixedId: config.stopId,
    query: config.stopQuery,
    fallbackQueries: fallbackQueries.stops,
    fetchByQuery: (query) => transportService.searchStops(query)
  }).catch(() => null);
  const destinationResolution = await resolveByIdOrQuery({
    kindLabel: 'destination',
    fixedId: config.destinationId,
    query: config.destinationQuery,
    fallbackQueries: fallbackQueries.destinations,
    fetchByQuery: (query) => transportService.resolveDestination(query)
  }).catch(() => null);

  const rawResult = await transportService.getLineDirectionArrivals({
    lineId: lineResolution.id,
    destinationId: destinationResolution ? destinationResolution.id : null,
    stopId: stopResolution ? stopResolution.id : null
  });
  const provenanceRecords = (rawResult || []).map((entry) =>
    toProvenanceRecord(entry, {
      label: `linea ${entry.lineId || 'n/a'} -> ${entry.destinationName || 'n/a'}`
    })
  );
  const validation = validateArrivalProvenance('lineDirectionArrivals', provenanceRecords);

  return {
    flowName: 'lineDirectionArrivals',
    resolvedInput: {
      line: lineResolution,
      stop: stopResolution,
      destination: destinationResolution
    },
    rawCount: Array.isArray(rawResult) ? rawResult.length : 0,
    rawResult: Array.isArray(rawResult) ? rawResult : [],
    provenanceRecords,
    warnings: validation.warnings,
    errors: validation.errors
  };
}

async function runRoutesToDestinationFlow(transportService, input) {
  const config = input.routesToDestination || {};
  const fallbackQueries = input.fallbackQueries || {};
  const destinationResolution = await resolveByIdOrQuery({
    kindLabel: 'destination',
    fixedId: config.destinationId,
    query: config.destinationQuery,
    fallbackQueries: fallbackQueries.destinations,
    fetchByQuery: (query) => transportService.resolveDestination(query)
  });
  const fromStopResolution = await resolveByIdOrQuery({
    kindLabel: 'fromStop',
    fixedId: config.fromStopId,
    query: config.fromStopQuery,
    fallbackQueries: fallbackQueries.stops,
    fetchByQuery: (query) => transportService.searchStops(query)
  }).catch(() => null);

  const rawResult = await transportService.getRoutesToDestination({
    destinationId: destinationResolution.id,
    fromStopId: fromStopResolution ? fromStopResolution.id : null
  });
  const provenanceRecords = (rawResult || []).map((entry) =>
    toProvenanceRecord(entry, {
      label: `linea ${entry.lineId || 'n/a'} -> ${entry.destinationName || 'n/a'}`
    })
  );
  const validation = validateRoutes('routesToDestination', rawResult, provenanceRecords);

  return {
    flowName: 'routesToDestination',
    resolvedInput: {
      destination: destinationResolution,
      fromStop: fromStopResolution
    },
    rawCount: Array.isArray(rawResult) ? rawResult.length : 0,
    rawResult: Array.isArray(rawResult) ? rawResult : [],
    provenanceRecords,
    warnings: validation.warnings,
    errors: validation.errors
  };
}

function assignFlowStatus(flowData) {
  if (flowData.errors.length > 0) {
    return 'FAIL';
  }
  if (flowData.warnings.length > 0) {
    return 'WARN';
  }
  return 'PASS';
}

function buildSnapshot(config, inputInfo, flowResults) {
  const nowIso = new Date().toISOString();
  const flows = {};
  flowResults.forEach((flowData) => {
    flows[flowData.flowName] = {
      status: flowData.status,
      resolvedInput: flowData.resolvedInput,
      rawCount: flowData.rawCount,
      warnings: flowData.warnings,
      errors: flowData.errors,
      provenanceRecords: flowData.provenanceRecords,
      rawResult: flowData.rawResult
    };
  });

  const allErrors = flowResults.flatMap((flowData) =>
    flowData.errors.map((message) => ({ flow: flowData.flowName, message }))
  );
  const allWarnings = flowResults.flatMap((flowData) =>
    flowData.warnings.map((message) => ({ flow: flowData.flowName, message }))
  );

  return {
    generatedAt: nowIso,
    runtime: {
      transportDataMode: process.env.TRANSPORT_DATA_MODE || null,
      moovitFallbackEnabled: process.env.MOOVIT_FALLBACK_ENABLED || null
    },
    inputFile: inputInfo,
    config: {
      snapshotDir: config.snapshotDir,
      maxRows: config.maxRows
    },
    summary: {
      status: allErrors.length ? 'FAIL' : allWarnings.length ? 'WARN' : 'PASS',
      flowCount: flowResults.length,
      errorCount: allErrors.length,
      warningCount: allWarnings.length
    },
    flows,
    errors: allErrors,
    warnings: allWarnings
  };
}

function writeSnapshot(snapshotDir, snapshot) {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const safeTimestamp = snapshot.generatedAt.replace(/[:.]/g, '-');
  const latestPath = path.join(snapshotDir, 'amtab-real-smoke-latest.json');
  const timestampPath = path.join(snapshotDir, `amtab-real-smoke-${safeTimestamp}.json`);
  const payload = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(latestPath, payload, 'utf8');
  fs.writeFileSync(timestampPath, payload, 'utf8');
  return {
    latestPath,
    timestampPath
  };
}

async function main() {
  const config = parseCliArgs(process.argv.slice(2));
  ensureRuntimeMode();

  const inputInfo = readInputFile(config.inputPath);
  const smokeInput = inputInfo.data || {};
  const transportService = createTransitService();

  const flowRunners = [
    runNextArrivalsByStopFlow,
    runLineDirectionArrivalsFlow,
    runRoutesToDestinationFlow
  ];

  const flowResults = [];
  for (const runFlow of flowRunners) {
    try {
      const flowData = await runFlow(transportService, smokeInput);
      flowData.status = assignFlowStatus(flowData);
      flowResults.push(flowData);
      printFlowResult(flowData.flowName, flowData, config.maxRows);
    } catch (error) {
      const flowName = runFlow.name.replace(/^run|Flow$/g, '');
      const failed = {
        flowName,
        status: 'FAIL',
        resolvedInput: null,
        rawCount: 0,
        rawResult: [],
        provenanceRecords: [],
        warnings: [],
        errors: [error && error.message ? error.message : String(error)]
      };
      flowResults.push(failed);
      printFlowResult(flowName, failed, config.maxRows);
    }
  }

  const snapshot = buildSnapshot(config, inputInfo, flowResults);
  let snapshotPaths = null;
  if (config.writeSnapshot) {
    snapshotPaths = writeSnapshot(config.snapshotDir, snapshot);
  }

  printHeader('Smoke Summary');
  console.log(`Status: ${snapshot.summary.status}`);
  console.log(`Errors: ${snapshot.summary.errorCount}`);
  console.log(`Warnings: ${snapshot.summary.warningCount}`);
  if (snapshotPaths) {
    console.log(`Snapshot latest: ${snapshotPaths.latestPath}`);
    console.log(`Snapshot timestamped: ${snapshotPaths.timestampPath}`);
  } else {
    console.log('Snapshot writing disabled by --no-snapshot');
  }

  if (snapshot.summary.errorCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[smoke] fatal error', error);
  process.exitCode = 1;
});
