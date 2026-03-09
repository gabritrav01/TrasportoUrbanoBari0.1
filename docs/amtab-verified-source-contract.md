# Trasporto Urbano Bari - Contratto tecnico fonte AMTAB verificata (V1)

Data riferimento: 2026-03-09  
Stato: corrente, allineato all'attuale `amtabRealGateway`  
Perimetro: solo parti osservate in codice/repo. Ogni incertezza e marcata `TODO`.

## 1) Endpoint / file / feed effettivamente usati

## 1.1 Feed statico GTFS AMTAB (ZIP)

- Tipo: feed ufficiale statico
- URL runtime default: `https://www.amtabservizio.it/gtfs/google_transit.zip`
- Override env: `AMTAB_REAL_STOPS_FEED_URL`
- Implementazione: `lambda/services/providers/amtab/clients/amtabApiClient.js` (`fetchGtfsStaticZipRaw`)
- Metodo accesso:
  - HTTP `GET`
  - `Accept: application/zip, application/octet-stream, */*`
  - timeout per richiesta: `AMTAB_REAL_GATEWAY_TIMEOUT_MS` (default `3500ms`)

Payload atteso (osservato dal parser):

- Archivio ZIP GTFS
- File richiesto: `stops.txt` (obbligatorio)
- File usati:
  - `routes.txt`
  - `trips.txt`
  - `stop_times.txt`
  - `calendar.txt` (se disponibile)
  - `calendar_dates.txt` (se disponibile)

Entita estratte:

- `Stop` (da `stops.txt`, via `parseStopsRaw -> mapRawStopToStop`)
- `Line` (da `routes.txt`, via `mapRawLineToLine`)
- `ScheduledArrival` (da `stop_times + trips + calendar/calendar_dates`)
- Mapping ausiliario `routeShortNameByRouteId` per arrivi realtime

Frequenza aggiornamento:

- Fonte AMTAB: **non dichiarata nel repo**  
  `TODO(CONTRACT_FREQ_STATIC): misurare frequenza reale pubblicazione GTFS (hash ZIP + Last-Modified).`
- Cache locale gateway: `staticCacheTtlMs = 6h`

Limiti noti:

- Se `stops.txt` manca: errore bloccante `AMTAB_REAL_GTFS_PARSE_ERROR`.
- `routes.txt` opzionale: se assente, mapping linea meno preciso.
- Se mancano `trips` o `stop_times`, il gateway continua a funzionare ma riduce il ramo scheduled statico.

## 1.2 Feed GTFS-RT TripUpdates AMTAB (JSON)

- Tipo: feed ufficiale dinamico
- URL runtime default: `https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates`
- Override env: `AMTAB_REAL_TRIP_UPDATES_URL`
- Implementazione: `lambda/services/providers/amtab/clients/amtabApiClient.js` (`fetchTripUpdatesRaw`)
- Metodo accesso:
  - HTTP `GET`
  - `Accept: application/json, text/plain, */*`
  - timeout per richiesta: `AMTAB_REAL_GATEWAY_TIMEOUT_MS` (default `3500ms`)

Payload atteso (osservato dal parser):

- JSON con varianti case-insensitive sulle chiavi:
  - `Header`/`header` con `Timestamp`/`timestamp`
  - `Entities`/`entities`/`entity`
  - `TripUpdate`/`tripUpdate`/`trip_update`
  - `Trip`, `Vehicle`, `StopTimeUpdate`
- Timestamps accettati in secondi/millisecondi/ISO/`HH:mm` (parser flessibile)

Entita estratte:

- `Arrival` raw (da `TripUpdate.StopTimeUpdate`) via `parseArrivalsRaw`
- Metadati feed:
  - `headerTimestampEpochMs`
  - `fetchedAtEpochMs`
  - diagnostica `discarded`, `duplicates`, `contradictions`

Frequenza aggiornamento:

- Fonte AMTAB: **non dichiarata nel repo**  
  `TODO(CONTRACT_FREQ_RT): misurare cadenza reale da drift di Header.Timestamp su 24h.`
- Cache locale gateway: `tripUpdatesCacheTtlMs = 15s`

Limiti noti:

- Feed puo essere vuoto (`Entities: []`), caso gia documentato nel progetto.
- Parser corrente usa JSON; non e implementato decoder protobuf GTFS-RT.
  `TODO(CONTRACT_RT_PROTOBUF): verificare se endpoint puo restituire protobuf e aggiungere supporto.`
- Campi delay/status/occupancy non ancora mappati.
  `TODO(CONTRACT_RT_FIELDS): confermare campi ufficiali AMTAB e mapparli.`

## 1.3 File GTFS realmente consumati in runtime

- `stops.txt` (obbligatorio): id, nome, coordinate fermata
- `routes.txt`: id linea, short/long name
- `trips.txt`: `trip_id`, `route_id`, `service_id`, `trip_headsign`, `direction_id`
- `stop_times.txt`: schedule per fermata/trip
- `calendar.txt` + `calendar_dates.txt`: validita servizio
- Non ancora consumati: `shapes.txt` (non necessario per V1 runtime)
  `TODO(CONTRACT_GTFS_EXT): valutare uso di shapes/altri file per route planning avanzato.`

## 2) Mapping verso shape dominio

## 2.1 Mapping `Stop`

Sorgente raw:

- `parseStopsRaw` normalizza righe GTFS in record intermedi:
  - `stopId`, `stopName`, `stopCode`, `coordinates`, `direction`, `side`, `platformCode`

Mapping dominio:

- Mapper: `lambda/services/providers/amtab/mappers/mapRawStopToStop.js`
- Shape target: `normalizeStopShape` (`providerShapes`)

Campi principali:

- `Stop.id` <- `stopId` (normalizzato uppercase/safe token)
- `Stop.name` <- `stopName`
- `Stop.aliases` <- `stopCode` + alias raw
- `Stop.coordinates` <- `coordinates.lat/lon`
- `Stop.source` <- `official|public|fallback` con guardrail (mai official non verificato)
- `Stop.sourceName` <- default `amtab_gtfs_static` se official
- `Stop.confidence` <- default by source + scoring
- `Stop.freshness`, `Stop.reliabilityBand` <- `scoreRecordReliability`

Gap attuale:

- `Stop.lineIds` non e ancora popolato sistematicamente da join statico.
  `TODO(CONTRACT_STOP_LINE_LINK): arricchire `lineIds` a livello fermata.`

## 2.2 Mapping `Arrival`

Sorgente raw:

- `parseArrivalsRaw` da TripUpdates produce:
  - `stopId`, `lineId/lineNumber`, `routeId`, `destinationName`
  - `realtimeEpochMs`, `scheduledEpochMs`, `predictedEpochMs`
  - `recordType` (`realtime|scheduled`)
  - `tripId`, `vehicleId`, `asOfEpochMs`
  - dedupe/contradiction report

Mapping dominio:

- Mapper: `lambda/services/providers/amtab/mappers/mapRawArrivalToArrival.js`
- Shape target: `normalizeArrivalShape` (`providerShapes`)

Campi principali:

- `Arrival.stopId` <- raw `stopId`
- `Arrival.lineId` <- raw `lineId|lineNumber|routeId`
- `Arrival.destinationName` <- raw `destination/headsign`
- `Arrival.predictionType` <- da `recordType` + timestamp disponibili
- `Arrival.predictedEpochMs` <- realtime
- `Arrival.scheduledEpochMs` <- scheduled
- `Arrival.asOfEpochMs` <- header/feed timestamp
- `Arrival.source`/`sourceName` <- official/public/fallback con guardrail
- `Arrival.confidence` <- default by source+type, poi scoring
- `Arrival.freshness`, `Arrival.reliabilityBand` <- scoring + policy

Regole chiave gia implementate:

- `inferred` non puo restare `official` (viene degradato almeno a `public`)
- `scheduled` non e promosso automaticamente a `direct`
- `reliabilityBand` mancante viene trattato in modo prudente (`caution` by default)

## 2.3 Mapping `Line`

Sorgente raw:

- `routes.txt` (record GTFS route)

Mapping dominio:

- Mapper: `lambda/services/providers/amtab/mappers/mapRawLineToLine.js`
- Shape target: `normalizeLineShape` (`providerShapes`)

Campi principali:

- `Line.id` <- `route_short_name` (fallback `route_id`)
- `Line.code` <- `route_short_name` (fallback `id`)
- `Line.aliases` <- `route_long_name`, `route_id`, alias raw
- `Line.destinationName` <- `route_long_name` o campi raw compatibili
- `Line.source/sourceName/confidence/freshness/reliabilityBand` <- come sopra

Gap attuale:

- Derivazione direzione/headsign a livello linea migliorabile (oggi orientata al trip/arrival).
  `TODO(CONTRACT_LINE_DIRECTION): consolidare direction/headsign canonici per linea.`

## 3) Rischi operativi residui

1. Contratto feed non versionato pubblicamente:
`TODO(CONTRACT_VERSIONING): introdurre contract tests contro snapshot reali periodici.`

2. Cadenza reale aggiornamento non formalizzata:
`TODO(CONTRACT_MONITORING): monitor su Header.Timestamp, feed vuoti e drift freshness.`

3. Scheduled dipendente da qualita feed statico:
`TODO(CONTRACT_SCHEDULE): aggiungere metriche di completezza schedule e fallback piu granulari.`

4. Policy/rate-limit/licenza non esplicitate nel codice:
`TODO(CONTRACT_LEGAL_RATE): formalizzare limiti chiamate e termini d'uso AMTAB per produzione.`

5. Possibili variazioni naming campi GTFS-RT:
`TODO(CONTRACT_SCHEMA_GUARDS): validazione schema + fallback parser versionato.`

## 4) Proposta concreta di implementazione nel gateway reale

## 4.1 Contratto runtime minimo (subito)

- Mantenere attuali metodi del gateway:
  - `fetchStopsRaw()`
  - `fetchLinesRaw()`
  - `fetchTripUpdatesRaw()`
  - `fetchArrivalsRaw(stopId)`
- Continuare a esportare shape normalizzate solo tramite mappers dominio (`Stop`, `Line`, `Arrival`).

## 4.2 Hardening immediato (priorita alta)

1. Aggiungere validator espliciti di contratto feed:
   - GTFS ZIP: presenza `stops.txt` (+ warning su `routes.txt` assente)
   - TripUpdates JSON: presenza header/entities parseabili
2. Persistire metriche minime per ogni fetch:
   - `sourceName`, `endpoint`, latenza, entityCount, discardedCount, contradictionsCount
3. Aggiungere stale detection su `headerTimestampEpochMs`:
   - se oltre soglia, degradare band e attivare fallback scheduled/stub.

## 4.3 Estensione successiva (priorita media)

1. Join statico+realtime piu ricco (`lineId`, `destinationTargetId`, coerenza trip).
2. Test integrazione contrattuali con fixture reali versionate (snapshot anonymized).
3. Supporto opzionale GTFS-RT protobuf se la fonte lo richiede.

## 4.4 Regole di fallback/provenance da mantenere

- Se `TRANSPORT_DATA_MODE=amtab_real` e fetch fallisce: fallback a stub controllato.
- Dati fallback/stub mai marcati `official`.
- `source`, `sourceName`, `predictionType`, `confidence`, `freshness`, `reliabilityBand` sempre valorizzati.

## 5) Riferimenti implementativi nel repo

- Gateway: `lambda/services/providers/amtab/amtabRealGateway.js`
- HTTP client: `lambda/services/providers/amtab/clients/amtabApiClient.js`
- Parser stops: `lambda/services/providers/amtab/parsers/parseStopsRaw.js`
- Parser arrivals: `lambda/services/providers/amtab/parsers/parseArrivalsRaw.js`
- Parser TripUpdates: `lambda/services/providers/amtab/parsers/tripUpdatesParser.js`
- Mappers dominio: `lambda/services/providers/amtab/mappers/*.js`
- Shape e scoring: `lambda/services/providers/domain/providerShapes.js`, `reliabilityScoring.js`, `qualityScoring.js`
