# AMTAB Real Smoke Suite

Smoke suite operativa per primo test con dati reali senza passare dagli handler Alexa.

## Flussi coperti

- `next arrivals by stop` -> `transportService.getNextArrivalsByStop`
- `line direction arrivals` -> `transportService.getLineDirectionArrivals`
- `routes to destination` -> `transportService.getRoutesToDestination`

## Requisiti runtime

- `TRANSPORT_DATA_MODE=amtab_real` (forzato automaticamente dallo script)
- `MOOVIT_FALLBACK_ENABLED=false` (forzato a `false` se non presente)
- eventuali endpoint custom:
  - `AMTAB_REAL_STOPS_FEED_URL`
  - `AMTAB_REAL_TRIP_UPDATES_URL`

## Esecuzione

```bash
npm run smoke:amtab-real
```

Con input custom:

```bash
npm run smoke:amtab-real -- --input tests/smoke/amtab-real-smoke.input.example.json
```

Con snapshot disabilitato:

```bash
npm run smoke:amtab-real -- --no-snapshot
```

## Output

Lo script stampa in console una tabella per ogni flusso con i campi:

- `source`
- `sourceName`
- `predictionType`
- `confidence`
- `reliabilityBand`
- `freshness`

Snapshot JSON scritti in:

- `tests/smoke/output/amtab-real-smoke-latest.json`
- `tests/smoke/output/amtab-real-smoke-<timestamp>.json`
