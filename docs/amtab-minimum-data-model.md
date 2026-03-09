# Trasporto Urbano Bari - Modello dati minimo per provider reale

Data: 2026-03-09
Scopo: definire il contratto dati minimo (runtime) per sostituire i dati stub e far funzionare davvero la skill con sorgenti AMTAB/MUVT reali.

## 1) Principi di modellazione

- Modello orientato al contratto usato dal codice (`TransportProvider`, resolver, formatter, handler).
- Ogni entita include:
  - campi obbligatori per far funzionare la skill (`Core`)
  - campi opzionali/migliorativi (`Enhancement`)
- I dati possono provenire da GTFS statico, GTFS-RT, o mapping interno derivato.

## 2) Panorama entita e criticita

| Entita | Necessita per V1 | Note |
|---|---|---|
| `Stop` | Indispensabile | base ricerca fermata, nearby, preferiti |
| `Line` | Indispensabile | base filtri linea e risposte \"linea X\" |
| `TripDirection` | Indispensabile (logica) | necessario per direzione/capolinea e arrivi coerenti |
| `ArrivalPrediction` | Indispensabile se realtime | se assente, fallback scheduled |
| `ScheduledArrival` | Indispensabile | fallback stabile e baseline |
| `DestinationTarget` | Indispensabile | intent \"verso destinazione\" |
| `RouteOption` | Indispensabile | intent \"che linee vanno a...\" |
| `PlaceAlias` | Migliorativo forte | ranking semantico, ambiguita |
| `StopAlias` | Migliorativo forte | risoluzione robusta nomi colloquiali |

## 3) Definizione rigorosa delle entita

## 3.1 Stop

Origine codice: `TransportProvider`/`amtabProvider`/resolver.

### Campi obbligatori (`Core`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `id` | `string` | Core | chiave stabile (`stop_id`) |
| `name` | `string` | Core | usato nella voce Alexa |
| `coordinates.lat` | `number` | Core per \"vicino a me\" | per nearest stops |
| `coordinates.lon` | `number` | Core per \"vicino a me\" | per nearest stops |

### Campi opzionali (`Enhancement`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `aliases` | `string[]` | Enhancement | migliora matching NLU |
| `lineIds` | `string[]` | Enhancement | migliora ranking semantico |
| `source` | `string` | Enhancement | audit/debug provider |

### Esempio

```json
{
  "id": "01011101",
  "name": "Ancona-Green",
  "coordinates": { "lat": 41.151684, "lon": 16.738664 },
  "aliases": ["ancona green", "ancona"],
  "lineIds": ["01", "07"],
  "source": "amtab_gtfs_static"
}
```

### Fonti candidate

- GTFS statico: `stops.txt` (Core), `stop_name`, `stop_lat`, `stop_lon`.
- Derivazione da `stop_times.txt` + `trips/routes` per `lineIds`.
- Alias manuali (`StopAlias`) per sinonimi colloquiali.

### Indispensabilita

- Indispensabile.

## 3.2 Line

### Campi obbligatori (`Core`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `id` | `string` | Core | `route_id` o `route_short_name` normalizzato |
| `destinationTargetId` | `string` | Core | necessario per filtri direzione |
| `destinationName` | `string` | Core | fallback parlato se destination non risolta |
| `stopIds` | `string[]` | Core | usato per direzione/linea e fallback stop |

### Campi opzionali (`Enhancement`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `aliases` | `string[]` | Enhancement | \"2 barra\", \"linea c\" |
| `source` | `string` | Enhancement | audit/debug |
| `routeColor` | `string` | Enhancement | opzionale per future UI card |

### Esempio

```json
{
  "id": "02/",
  "destinationTargetId": "DEST_POLICLINICO",
  "destinationName": "Policlinico di Bari",
  "stopIds": ["01000123", "01000456", "01000999"],
  "aliases": ["linea 2 barra", "due barra"],
  "source": "amtab_gtfs_static"
}
```

### Fonti candidate

- GTFS statico: `routes.txt`, `trips.txt`, `stop_times.txt`.
- Mapping interno per associare linea -> `DestinationTarget`.

### Indispensabilita

- Indispensabile.

## 3.3 TripDirection

Nota: nel codice non esiste come classe esplicita, ma e implicitamente necessario per coerenza direzione/capolinea/arrivi.

### Campi obbligatori (`Core`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `id` | `string` | Core | `trip_id` |
| `lineId` | `string` | Core | riferimento a `Line.id` |
| `directionId` | `string|number` | Core | `direction_id` o equivalente |
| `destinationTargetId` | `string` | Core | join con destinazione |
| `destinationName` | `string` | Core | parlato coerente |
| `stopSequence` | `Array<{stopId:string,seq:number}>` | Core | ordine fermate della corsa |
| `serviceId` | `string` | Core | validita calendario |

### Campi opzionali (`Enhancement`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `headsign` | `string` | Enhancement | raffinamento direzione |
| `shapeId` | `string` | Enhancement | uso futuro mappe |
| `blockId` | `string` | Enhancement | clustering veicolo/corse |

### Esempio

```json
{
  "id": "trip_02A_12345",
  "lineId": "02/",
  "directionId": 0,
  "destinationTargetId": "DEST_POLICLINICO",
  "destinationName": "Policlinico di Bari",
  "serviceId": "FER",
  "stopSequence": [
    { "stopId": "01000123", "seq": 1 },
    { "stopId": "01000456", "seq": 2 }
  ]
}
```

### Fonti candidate

- GTFS statico: `trips.txt`, `stop_times.txt`, `calendar*.txt`.

### Indispensabilita

- Indispensabile a livello logico.

## 3.4 ArrivalPrediction (realtime)

### Campi obbligatori (`Core`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `stopId` | `string` | Core | fermata target |
| `lineId` | `string` | Core | linea passaggio |
| `destinationName` | `string` | Core | parlato Alexa |
| `etaMinutes` | `number` | Core | calcolo frasi \"tra N minuti\" |
| `predictedEpochMs` | `number` | Core realtime | timestamp previsione |
| `isRealtime` | `boolean` | Core | deve essere `true` |

### Campi opzionali (`Enhancement`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `destinationTargetId` | `string` | Enhancement | join semantico |
| `scheduledEpochMs` | `number` | Enhancement | confronto teorico vs previsione |
| `source` | `string` | Enhancement | provider tracing |
| `tripId` | `string` | Enhancement | disambiguazione avanzata |

### Esempio

```json
{
  "stopId": "01000456",
  "lineId": "02/",
  "destinationTargetId": "DEST_POLICLINICO",
  "destinationName": "Policlinico di Bari",
  "etaMinutes": 4,
  "scheduledEpochMs": 1773055200000,
  "predictedEpochMs": 1773055440000,
  "source": "amtab_gtfs_rt_tripupdates",
  "isRealtime": true
}
```

### Fonti candidate

- GTFS-RT `TripUpdates` (primario).
- GTFS-RT `VehiclePosition` (supporto inferenziale, meno diretto per ETA).

### Indispensabilita

- Indispensabile per esperienza realtime; migliorativa rispetto a V1 solo scheduled.

## 3.5 ScheduledArrival

### Campi obbligatori (`Core`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `stopId` | `string` | Core | fermata target |
| `lineId` | `string` | Core | linea passaggio |
| `destinationName` | `string` | Core | parlato Alexa |
| `etaMinutes` | `number` | Core | ordinamento e voce |
| `scheduledEpochMs` | `number` | Core | timestamp teorico |
| `isRealtime` | `boolean` | Core | deve essere `false` |

### Campi opzionali (`Enhancement`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `destinationTargetId` | `string` | Enhancement | join semantico |
| `predictedEpochMs` | `number|null` | Enhancement | null se solo teorico |
| `source` | `string` | Enhancement | tracing |
| `tripId` | `string` | Enhancement | debug/analisi |

### Esempio

```json
{
  "stopId": "01000456",
  "lineId": "02/",
  "destinationTargetId": "DEST_POLICLINICO",
  "destinationName": "Policlinico di Bari",
  "etaMinutes": 7,
  "scheduledEpochMs": 1773055620000,
  "predictedEpochMs": null,
  "source": "amtab_gtfs_static",
  "isRealtime": false
}
```

### Fonti candidate

- GTFS statico (`trips + stop_times + calendar_dates/calendar`).

### Indispensabilita

- Indispensabile (fallback stabile anche con feed realtime vuoti).

## 3.6 DestinationTarget

### Campi obbligatori (`Core`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `id` | `string` | Core | chiave destinazione |
| `name` | `string` | Core | parlato Alexa |
| `targetStopIds` | `string[]` | Core | fermate target della destinazione |

### Campi opzionali (`Enhancement`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `aliases` | `string[]` | Enhancement | ranking NLU |
| `source` | `string` | Enhancement | tracing |
| `geoHint` | `{lat:number,lon:number}` | Enhancement | future prossimita |

### Esempio

```json
{
  "id": "DEST_POLICLINICO",
  "name": "Policlinico di Bari",
  "aliases": ["policlinico", "ospedale policlinico"],
  "targetStopIds": ["01000456", "01000457"],
  "source": "derived_from_gtfs"
}
```

### Fonti candidate

- Derivazione da GTFS (`trip_headsign`, capolinea, fermate terminali).
- Alias da configurazione locale/manuale.

### Indispensabilita

- Indispensabile.

## 3.7 RouteOption

### Campi obbligatori (`Core`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `id` | `string` | Core | chiave opzione percorso |
| `originStopId` | `string` | Core | stop di partenza |
| `destinationTargetId` | `string` | Core | destinazione richiesta |
| `lineIds` | `string[]` | Core | almeno una linea |
| `transfers` | `number` | Core | per ranking futuro |

### Campi opzionali (`Enhancement`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `estimatedMinutes` | `number|null` | Enhancement | non usato oggi in voice |
| `source` | `string` | Enhancement | tracing |
| `confidence` | `number` | Enhancement | ranking percorsi |

### Esempio

```json
{
  "id": "route:01000123:DEST_POLICLINICO:02/",
  "originStopId": "01000123",
  "destinationTargetId": "DEST_POLICLINICO",
  "lineIds": ["02/"],
  "transfers": 0,
  "estimatedMinutes": 19,
  "source": "computed_from_gtfs"
}
```

### Fonti candidate

- Derivazione da rete GTFS (grafo linee/stop/trip).
- Alternativa: endpoint journey planner (se ufficiale/documentato).

### Indispensabilita

- Indispensabile per intent \"linee verso destinazione\".

## 3.8 PlaceAlias

Entita semantica (resolver), non direttamente nel `TransportProvider`.

### Campi obbligatori (`Core`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `id` | `string` | Core | chiave place |
| `placeType` | `string` | Core | `area`/`poi`/`spoken_target` |
| `spokenForms` | `string[]` | Core | trigger linguistici |

### Campi opzionali (`Enhancement`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `displayName` | `string` | Enhancement | leggibilita |
| `linkedStopIds` | `string[]` | Enhancement forte | boost ranking fermate |
| `linkedDestinationIds` | `string[]` | Enhancement forte | boost ranking destinazioni |
| `confidence` | `string` | Enhancement | peso ranking |
| `note` | `string` | Enhancement | manutenzione |

### Esempio

```json
{
  "id": "PLACE_POLICLINICO",
  "displayName": "Policlinico di Bari",
  "placeType": "poi",
  "spokenForms": ["policlinico", "ospedale policlinico"],
  "linkedStopIds": ["01000456"],
  "linkedDestinationIds": ["DEST_POLICLINICO"],
  "confidence": "high"
}
```

### Fonti candidate

- Configurazione curata manualmente.
- Arricchimento da toponomastica locale.

### Indispensabilita

- Migliorativo forte (precisione NLU/ambiguity).

## 3.9 StopAlias

Entita semantica (resolver), non direttamente nel `TransportProvider`.

### Campi obbligatori (`Core`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `key` | `string` | Core | identificativo alias |
| `queryTokens` | `string[]` | Core | token ricercabili |
| `mappedStopIds` | `string[]` | Core | fermate target |

### Campi opzionali (`Enhancement`)

| Campo | Tipo | Necessita | Note |
|---|---|---|---|
| `canonicalLabel` | `string` | Enhancement | espansioni query |
| `placeId` | `string` | Enhancement | collegamento PlaceAlias |
| `confidence` | `string` | Enhancement | peso ranking |
| `note` | `string` | Enhancement | manutenzione |

### Esempio

```json
{
  "key": "stazione",
  "canonicalLabel": "Stazione Centrale Piazza Moro",
  "queryTokens": ["stazione", "piazza moro", "centrale"],
  "mappedStopIds": ["01000123", "01000124"],
  "placeId": "PLACE_STAZIONE_CENTRALE",
  "confidence": "high"
}
```

### Fonti candidate

- Configurazione curata manualmente.
- Derivazione semi-automatica da nomi fermata + sinonimi locali.

### Indispensabilita

- Migliorativo forte.

## 4) Dipendenze tra entita

| Entita sorgente | Relazione | Entita target | Uso |
|---|---|---|---|
| `Line` | 1:N | `TripDirection` | direzioni/corse di linea |
| `TripDirection` | N:M (sequenza) | `Stop` | stop order per corsa |
| `TripDirection` | N:1 | `DestinationTarget` | capolinea/destinazione |
| `ScheduledArrival` | N:1 | `Stop` | arrivo su fermata |
| `ScheduledArrival` | N:1 | `Line` | arrivo di linea |
| `ArrivalPrediction` | N:1 | `Stop` | previsione su fermata |
| `ArrivalPrediction` | N:1 | `Line` | previsione di linea |
| `RouteOption` | N:1 | `DestinationTarget` | destinazione richiesta |
| `RouteOption` | N:1 | `Stop` (origin) | stop partenza |
| `RouteOption` | N:M | `Line` | linee candidate |
| `StopAlias` | N:M | `Stop` | risoluzione linguistica |
| `PlaceAlias` | N:M | `Stop`/`DestinationTarget` | boost semantico |

## 5) Mapping entita -> metodi TransportProvider

| Metodo provider | Input | Output | Entita coinvolte |
|---|---|---|---|
| `searchStops(query)` | `query:string` | `Stop[]` | Stop, StopAlias/PlaceAlias (indiretto via resolver) |
| `nearestStops(lat,lon)` | coordinate | `{stop:Stop,distanceMeters}[]` | Stop |
| `getLinesServingStop(stopId)` | `stopId` | `Line[]` | Stop, Line |
| `searchLines(query)` (estensione usata) | `query` | `Line[]` | Line |
| `resolveDestination(query)` | `query` | `DestinationTarget[]` | DestinationTarget, PlaceAlias (indiretto) |
| `findRoutes(originStopIds,destinationTargetIds)` | ids | `RouteOption[]` | Stop, DestinationTarget, Line, RouteOption, TripDirection |
| `getRealtimePredictions(stopId,lineId)` | ids | `ArrivalPrediction[]` | ArrivalPrediction, Stop, Line, TripDirection |
| `getScheduledArrivals(stopId,lineId)` | ids | `ScheduledArrival[]` | ScheduledArrival, Stop, Line, TripDirection |
| `getStopArrivals(stopId)` | `stopId` | arrivi ordinati | ArrivalPrediction/ScheduledArrival |

## 6) Campi realmente necessari alla risposta vocale Alexa

## 6.1 Arrivi fermata (`NextArrivalsByStopIntent`, `NextArrivalsByNearbyIntent`)

Campi minimi runtime:

- `Stop.name`
- `Arrival.lineId`
- `Arrival.destinationName`
- `Arrival.etaMinutes`

Campi utili ma non strettamente necessari alla frase:

- `Stop.id` (azioni successive/preferiti)
- `distanceMeters` (solo per nearby ambiguity prompt)
- `scheduledEpochMs`/`predictedEpochMs` (telemetria, spiegazioni avanzate)

## 6.2 Linee verso destinazione (`RoutesToDestinationIntent`)

Campi minimi runtime:

- `DestinationTarget.id`
- `DestinationTarget.name`
- `RouteOption.lineIds[0]` (o linea principale)
- `RouteOption.originStopId` (se partenza esplicita)
- `Stop.name` (se partenza esplicita)

## 6.3 Arrivi linea+direzione (`LineDirectionArrivalsIntent`)

Campi minimi runtime:

- `Line.id`
- `Line.destinationName` (fallback)
- `DestinationTarget.name` (se risolto)
- `Stop.name` (se fermata esplicita)
- `Arrival.lineId`
- `Arrival.destinationName`
- `Arrival.etaMinutes`

## 7) Sorgenti dati consigliate per popolare il modello

| Entita | Fonte primaria consigliata | Fonte secondaria |
|---|---|---|
| Stop | GTFS statico `stops.txt` | mapping locale alias |
| Line | GTFS `routes.txt` + `trips/stop_times` | mapping locale synonyms |
| TripDirection | GTFS `trips.txt` + `stop_times.txt` | nessuna |
| ScheduledArrival | GTFS statico + calendario | PDF orari (solo fallback/manuale) |
| ArrivalPrediction | GTFS-RT `TripUpdates` | GTFS-RT `VehiclePosition` (inferenza) |
| DestinationTarget | derivazione da capolinea/headsign + mapping | alias manuali |
| RouteOption | calcolo su rete GTFS | planner ufficiale se API documentata |
| PlaceAlias | configurazione locale | arricchimento progressivo |
| StopAlias | configurazione locale | generazione semi-automatica |

## 8) Criterio \"go-live minimo\"

Per un provider reale funzionante in produzione base:

- obbligatori: `Stop`, `Line`, `TripDirection`, `ScheduledArrival`, `DestinationTarget`, `RouteOption`
- realtime consigliato ma non bloccante: `ArrivalPrediction`
- migliorativi NLU: `StopAlias`, `PlaceAlias`

Ordine implementativo pratico:

1. Stop + Line + TripDirection da GTFS statico
2. ScheduledArrival robusto
3. DestinationTarget + RouteOption
4. ArrivalPrediction realtime
5. Alias semantici (StopAlias/PlaceAlias) tuning continuo
