# AMTAB Simulated Local Fixtures

These fixtures are for local development and testing of the provider.

Important:
- all datasets in this folder are `simulated`
- they are placeholders
- they are not verified AMTAB official data
- they must not be presented as official transit information

## Files

- `stops.simulated.json`: stop records
- `lines.simulated.json`: line records
- `destinations.simulated.json`: destination target records
- `arrivals.realtime.simulated.json`: simulated realtime arrivals
- `arrivals.scheduled.simulated.json`: simulated scheduled arrivals
- `ambiguity-cases.simulated.json`: resolver ambiguity scenarios
- `error-cases.simulated.json`: malformed payloads and remote error scenarios
- `index.js`: convenience export for all fixtures

## Suggested usage

```js
const fixtures = require('../../fixtures/amtab-simulated');

const allStops = fixtures.stops.stops;
const allLines = fixtures.lines.lines;
const allDestinations = fixtures.destinations.destinationTargets;
const realtimeRecords = fixtures.arrivalsRealtime.records;
const scheduledRecords = fixtures.arrivalsScheduled.records;
```

## Design notes

- IDs use `SIM_*` to avoid confusion with production IDs.
- `source` defaults to `fallback` or `public` to avoid false official claims.
- each record includes `metadata.simulated: true` where useful.
- timestamps are fixed and deterministic for repeatable tests.
