# AMTAB Real Gateway

Data aggiornamento: 2026-03-09  
Stato: corrente (allineato al codice)

## Scopo

`amtabRealGateway` integra feed AMTAB verificati senza dipendenze Alexa, producendo dati normalizzati pronti per il provider:

- GTFS statico: stop, linee, scheduled derivato da `stop_times + trips + calendar/calendar_dates`
- GTFS-RT TripUpdates: arrivi realtime/scheduled dinamici
- provenance e reliability coerenti (`source`, `sourceName`, `predictionType`, `confidence`, `freshness`, `reliabilityBand`)

## Moduli principali

- `lambda/services/providers/amtab/amtabRealGateway.js`
- `lambda/services/providers/amtab/clients/amtabApiClient.js`
- `lambda/services/providers/amtab/parsers/zipParser.js`
- `lambda/services/providers/amtab/parsers/csvParser.js`
- `lambda/services/providers/amtab/parsers/gtfsStaticScheduleParser.js`
- `lambda/services/providers/amtab/parsers/parseStopsRaw.js`
- `lambda/services/providers/amtab/parsers/parseArrivalsRaw.js`
- `lambda/services/providers/amtab/parsers/tripUpdatesParser.js`
- `lambda/services/providers/amtab/mappers/*.js`

## Feed usati

- GTFS statico: `https://www.amtabservizio.it/gtfs/google_transit.zip`
- GTFS-RT TripUpdates: `https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates`

Parametri runtime:

- `AMTAB_REAL_STOPS_FEED_URL`
- `AMTAB_REAL_TRIP_UPDATES_URL`
- `AMTAB_REAL_GATEWAY_TIMEOUT_MS`

## Metodi esposti dal gateway

- `fetchStopsRaw()`
- `fetchLinesRaw()`
- `fetchTripUpdatesRaw()`
- `fetchArrivalsRaw(stopId)`
- `searchStops(query)`
- `searchLines(query)`
- `getStopArrivals(stopId)`
- `getRealtimePredictions(stopId, lineId)`
- `getScheduledArrivals(stopId, lineId)`
- `ping()`

## Flusso dati (attuale)

1. `loadStaticData()` scarica/parsa ZIP GTFS, indicizza stop/linee e schedule statico.
2. `loadTripUpdatesData()` scarica/parsa TripUpdates JSON con cache corta.
3. `getStopArrivals()` normalizza arrivi TripUpdates e applica guardrail provenance.
4. `getScheduledArrivals()` prova prima schedule statico; se vuoto/fallito fa fallback scheduled da TripUpdates.
5. `ping()` valida che feed statico e TripUpdates siano parseabili.

## Comportamenti importanti

- cache interna:
  - statico `6h`
  - TripUpdates `15s`
- `extractZipEntryFlexible`: supporta file GTFS con path annidati nel ZIP
- schedule statico:
  - attivazione servizio con `calendar` + `calendar_dates`
  - supporto orari GTFS anche oltre 24:00
  - filtro finestra temporale configurabile (`scheduledWindowPastMinutes`, `scheduledWindowAheadMinutes`)
- provenance guard:
  - record `inferred` non possono restare `official`

## Esempi sintetici

Stop normalizzato da GTFS statico:

```json
{
  "id": "STOP_1",
  "name": "Stazione Centrale",
  "source": "official",
  "sourceName": "amtab_gtfs_static"
}
```

Arrival realtime da TripUpdates:

```json
{
  "stopId": "STOP_1",
  "lineId": "1",
  "predictionType": "realtime",
  "source": "official",
  "sourceName": "amtab_gtfs_rt_tripupdates"
}
```

Arrival scheduled da GTFS statico:

```json
{
  "stopId": "STOP_1",
  "lineId": "1",
  "predictionType": "scheduled",
  "source": "official",
  "sourceName": "amtab_gtfs_static"
}
```

## Test collegati

- `lambda/tests/providers/amtab-real-gateway.smoke.test.js`
- `lambda/tests/integration/amtab-real-provider.integration.test.js`
- `lambda/tests/providers/raw-domain-mappers.test.js`

## Stato aperto (residuo reale)

- validazione legale/rate-limit operativi AMTAB
- eventuale supporto GTFS-RT protobuf/VehiclePosition
- osservabilita avanzata (metriche/alert feed stale)
