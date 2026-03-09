# Trasporto Urbano Bari - Modulo normalizzazione arrivi

Data: 2026-03-09  
Implementazione: `lambda/services/providers/domain/arrivalNormalizer.js`

## 1) API del modulo (Node.js)

Factory:

```js
const { createArrivalNormalizer } = require('../domain/arrivalNormalizer');

const arrivalNormalizer = createArrivalNormalizer({
  now: () => Date.now(),
  logger: console,
  dedupeWindowMs: 60000,
  pastToleranceMinutes: 2,
  farFutureMinutes: 360
});
```

Metodi:

- `normalizeSingle(rawEntry, context)`:
  - converte un record grezzo in `Arrival` uniforme.
- `normalizeBatch(rawEntries, context)`:
  - normalizza un array, deduplica, raccoglie warning/errori.
- `dedupeArrivals(arrivals, context)`:
  - deduplica una lista gia normalizzata.

Context supportato:

- `defaults`: fallback campi mancanti (`stopId`, `lineId`, `source`, `predictionType`, ecc.).
- `source`, `sourceName`: metadata sorgente batch.
- `serviceDate`: `Date` usata per parsing orari tipo `HH:mm[:ss]`.

## 2) Esempio input/output (fonti miste)

Input grezzo:

```json
[
  {
    "stop_id": "01020456",
    "route_short_name": "2/",
    "trip_headsign": "Policlinico di Bari",
    "expectedTime": "2026-03-09T08:34:00Z",
    "plannedTime": "2026-03-09T08:30:00Z",
    "source": "official"
  },
  {
    "stopId": "01020456",
    "lineCode": "2/",
    "destination": "Policlinico di Bari",
    "minutesToArrival": 4,
    "timestamp": 1773045000000,
    "predictionType": "inferred",
    "source": "public"
  },
  {
    "stop_code": "01020456",
    "line": "2/",
    "destinationName": "Policlinico di Bari",
    "scheduledTime": "08:30:00",
    "source": "fallback"
  }
]
```

Output normalizzato (`result.arrivals`):

```json
[
  {
    "id": "arr:01020456:2/:realtime:1773045240000",
    "stopId": "01020456",
    "lineId": "2/",
    "destinationTargetId": null,
    "destinationName": "Policlinico di Bari",
    "etaMinutes": 4,
    "predictionType": "realtime",
    "scheduledEpochMs": 1773045000000,
    "predictedEpochMs": 1773045240000,
    "delaySeconds": 240,
    "asOfEpochMs": 1773045000000,
    "isRealtime": true,
    "source": "official",
    "sourceName": "",
    "confidence": 0.9,
    "providerTripId": null,
    "metadata": null
  }
]
```

Nota:

- i 3 record sono stati deduplicati in 1 arrivo perche stessa fermata/linea/destinazione/finestra temporale.
- il record `official/realtime` vince su `public/inferred` e `fallback/scheduled`.

## 3) Regole di deduplica implementate

Key di deduplica:

- `stopId`
- `lineId`
- `destinationTargetId` (o `destinationName` se target assente)
- `predictionType`
- bucket temporale (`dedupeWindowMs`, default 60s) basato su:
  - `predictedEpochMs`, altrimenti
  - `scheduledEpochMs`, altrimenti
  - `asOfEpochMs + etaMinutes`

Se due record collidono sul key:

1. priorita `source`: `official > public > fallback`
2. poi priorita `predictionType`: `realtime > inferred > scheduled`
3. poi `confidence` piu alta
4. poi `asOfEpochMs` piu recente

Risultato:

- viene mantenuto un solo arrivo per key.
- i duplicati scartati sono tracciati in `result.duplicates`.

## 4) Gestione errori e logging

Errori hard (record scartato):

- `stopId` o `lineId` mancanti dopo normalizzazione.
- assenza contemporanea di `etaMinutes`, `predictedEpochMs`, `scheduledEpochMs`.
- record non validabile dalla shape `Arrival`.

Ogni errore viene serializzato in forma `ProviderError` (`code`, `message`, `retriable`, `source`, `details`, `occurredAtEpochMs`) e incluso in `result.errors`.

Warning (record tenuto o scartato in base al caso):

- ETA troppo nel passato (`pastToleranceMinutes`, default 2).
- arrivo troppo nel futuro (`farFutureMinutes`, default 360).
- drift anomalo tra `predictedEpochMs` e `scheduledEpochMs` (> 60 minuti).

Logging:

- `warn`: record scartati in batch.
- `debug`: conteggio warning/deduplica.
- `error`: da usare a livello data source per errori di chiamata sorgente (network/upstream).

## 5) Parsing timestamp supportato

Formati accettati:

- epoch milliseconds (`1773045240000`)
- epoch seconds (`1773045240`)
- ISO-8601 (`2026-03-09T08:34:00Z`)
- orario `HH:mm` o `HH:mm:ss` (risolto su `serviceDate`)

## 6) Campi normalizzati automaticamente

- normalizzazione `stopId`: da campi `stopId/stop_id/stopCode/stop_code/...`
- normalizzazione `lineId`: da `lineId/line/lineCode/route_id/route_short_name/...`
- normalizzazione destinazione:
  - ID: `destinationTargetId/destination_id/...`
  - nome: `destinationName/destination/headsign/trip_headsign/...`
- distinzione `realtime/scheduled/inferred` basata su campi espliciti o inferenza timestamp
- `etaMinutes` calcolato se non presente
