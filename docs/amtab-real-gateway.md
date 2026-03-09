# AMTAB Real Gateway (V1 minima)

## Scopo

`amtabRealGateway` collega una fonte reale ufficiale AMTAB a una pipeline ridotta:

- fermate statiche da GTFS statico
- arrivi da GTFS-Realtime TripUpdates

Senza scraping aggressivo e senza toccare gli handler Alexa.

## Struttura moduli

- `lambda/services/providers/amtab/amtabRealGateway.js`
  - orchestration, cache locale, mapping raw -> dominio normalizzato, scoring affidabilita
- `lambda/services/providers/amtab/clients/amtabApiClient.js`
  - fetch HTTP puro con timeout/errori espliciti
- `lambda/services/providers/amtab/parsers/zipParser.js`
  - parsing ZIP GTFS statico
- `lambda/services/providers/amtab/parsers/csvParser.js`
  - parsing CSV GTFS (`stops.txt`, `routes.txt`)
- `lambda/services/providers/amtab/parsers/parseStopsRaw.js`
  - parser raw fermate con validazione minima e logging record scartati
- `lambda/services/providers/amtab/parsers/parseArrivalsRaw.js`
  - parser raw arrivi con estrazione campi core, deduplica e detection contraddizioni
- `lambda/services/providers/amtab/parsers/tripUpdatesParser.js`
  - helper basso livello per header/entities TripUpdates

## Metodi raw esposti dal gateway

- `fetchStopsRaw()`
- `fetchLinesRaw()`
- `fetchTripUpdatesRaw()`
- `fetchArrivalsRaw(stopId)`

Questi metodi non dipendono da Alexa SDK e non richiedono handler intent.

## Esempio parser fermate raw

Input raw (riga da `stops.txt`):

```json
{
  "stop_id": "STOP_100",
  "stop_code": "100",
  "stop_name": "Stazione Centrale",
  "stop_lat": "41.1177",
  "stop_lon": "16.8697",
  "direction": "Centro",
  "lato": "A"
}
```

Output intermedio (`parseStopsRaw`):

```json
{
  "stopId": "STOP_100",
  "stopName": "Stazione Centrale",
  "stopCode": "100",
  "coordinates": { "lat": 41.1177, "lon": 16.8697 },
  "direction": "Centro",
  "side": "A",
  "platformCode": null,
  "rawIndex": 0
}
```

Record scartato (esempio): mancano `stop_id` o `stop_name`, con log warning.

## Esempio parser arrivi raw

Input raw (estratto TripUpdates):

```json
{
  "Header": { "Timestamp": 1773072000 },
  "Entities": [
    {
      "TripUpdate": {
        "Trip": { "RouteId": "R1", "TripId": "TRIP_100", "TripHeadsign": "Stazione" },
        "Vehicle": { "Id": "BUS_10" },
        "StopTimeUpdate": [
          { "StopId": "STOP_100", "Arrival": { "Time": 1773072300, "ScheduledTime": 1773072240 } }
        ]
      }
    }
  ]
}
```

Output intermedio (`parseArrivalsRaw`):

```json
{
  "stopId": "STOP_100",
  "lineId": "1",
  "lineNumber": "1",
  "routeId": "R1",
  "destinationName": "Stazione",
  "scheduledEpochMs": 1773072240000,
  "realtimeEpochMs": 1773072300000,
  "predictedEpochMs": 1773072300000,
  "recordType": "realtime",
  "vehicleId": "BUS_10",
  "tripId": "TRIP_100",
  "asOfEpochMs": 1773072000000
}
```

Casi edge gestiti:

- timestamp numerico secondi/millisecondi
- timestamp ISO-8601
- timestamp orario `HH:mm[:ss]` con reference date
- record senza stop/line/timestamp scartati con log warning
- record duplicati deduplicati con scelta record piu completo
- record contraddittori (drift timestamp elevato) tracciati in `contradictions`

## Fonti usate (verificate)

- GTFS statico: `https://www.amtabservizio.it/gtfs/google_transit.zip`
- GTFS-Realtime TripUpdates: `https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates`

## Mapping esempi input/output

### 1) Stop da `stops.txt`

Input (riga CSV):

```text
stop_id,stop_code,stop_name,stop_lat,stop_lon
1234,1234,Bari Stazione Centrale,41.1177,16.8697
```

Output (shape `Stop`):

```json
{
  "id": "1234",
  "name": "Bari Stazione Centrale",
  "aliases": ["1234"],
  "coordinates": { "lat": 41.1177, "lon": 16.8697 },
  "source": "official",
  "sourceName": "amtab_gtfs_static",
  "confidence": 0.96,
  "metadata": {
    "feed": "gtfs_static",
    "freshness": { "ageSec": 0, "freshnessScore": 1, "bucket": "fresh" },
    "reliabilityBand": "direct",
    "predictionType": "scheduled"
  }
}
```

### 2) Arrival da `TripUpdates`

Input (estratto payload):

```json
{
  "TripUpdate": {
    "Trip": { "RouteId": "R1", "TripId": "T100", "TripHeadsign": "Stazione" },
    "StopTimeUpdate": [
      { "StopId": "1234", "Arrival": { "Time": 1773071400 } }
    ]
  }
}
```

Output (shape `Arrival`):

```json
{
  "stopId": "1234",
  "lineId": "R1",
  "destinationName": "Stazione",
  "predictionType": "realtime",
  "predictedEpochMs": 1773071400000,
  "scheduledEpochMs": null,
  "source": "official",
  "sourceName": "amtab_gtfs_rt_tripupdates",
  "confidence": 0.9,
  "freshness": { "ageSec": 5, "freshnessScore": 0.97, "bucket": "fresh" },
  "reliabilityBand": "direct"
}
```

## Fallback e failure mode

- Se feed reale non raggiungibile o payload non valido: errore esplicito (`AMTAB_REAL_*`).
- Il provider AMTAB degrada su dati stub/catalogo senza marcarli `official`.
- Nessun uso di Moovit come primaria.

## Passaggio da hook stub a gateway reale

1. Imposta `TRANSPORT_DATA_MODE=amtab_real`.
2. Configura:
   - `AMTAB_REAL_STOPS_FEED_URL`
   - `AMTAB_REAL_TRIP_UPDATES_URL`
   - `AMTAB_REAL_GATEWAY_TIMEOUT_MS`
3. `transitService` collega il gateway reale ai hook provider:
   - `searchStops`
   - `searchLines`
   - `getStopArrivals`
   - `getRealtimePredictions`
   - `getScheduledArrivals`
   - `ping`
4. Se la fonte reale fallisce, i data source esistenti fanno fallback al catalogo stub senza promuoverlo a `official`.

## TODO espliciti (da completare)

- TODO: scheduled robusto da `stop_times.txt + trips + calendar`.
- TODO: validare policy/rate-limit ufficiale AMTAB e limiti operativi.
- TODO: valutare VehiclePosition come supporto addizionale (non primario).
- TODO: aggiungere monitoraggio freshness e alert su feed vuoti prolungati.
- TODO: confermare campi ufficiali AMTAB per lato/direzione/piattaforma fermata (se pubblicati).
- TODO: confermare campi ufficiali AMTAB per delay/status/occupancy nei payload arrivi realtime.
