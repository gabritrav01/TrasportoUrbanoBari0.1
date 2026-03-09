# Trasporto Urbano Bari - Shape normalizzate definitive del provider dati

Data: 2026-03-09  
File sorgente shape: `lambda/services/providers/domain/providerShapes.js`

## 1) Scopo

Definire un contratto stabile e indipendente dal formato grezzo delle fonti (AMTAB, GTFS, GTFS-RT, fallback).  
L'app Alexa deve consumare solo shape normalizzate, mai payload raw.

## 2) Convenzioni globali (obbligatorie)

## 2.1 `source`

Valori ammessi:

- `official`: dato da fonte ufficiale del gestore (es. feed AMTAB dichiarato ufficiale).
- `public`: dato da fonte pubblica non primaria ma pubblicamente accessibile e tracciabile.
- `fallback`: dato derivato/inferito/cache/stub o da fallback interno.

Regola:

- qualunque valore non riconosciuto viene normalizzato a `fallback`.

## 2.2 `predictionType`

Valori ammessi:

- `realtime`: previsione con componente temporale aggiornata da feed realtime.
- `scheduled`: orario teorico da programmazione.
- `inferred`: stima derivata (es. inferenza da altri segnali o fallback algoritmico).

Regola:

- se `predictionType` manca, viene inferito da timestamp e/o `isRealtime`.

## 2.3 `confidence`

Range obbligatorio:

- numero reale `0..1`.

Interpretazione consigliata:

- `>= 0.85`: alta affidabilita.
- `0.60 - 0.84`: media affidabilita.
- `< 0.60`: bassa affidabilita.

Regola:

- valori fuori range vengono clampati in `0..1`.
- se assente, viene applicato un default per shape.

## 2.4 ID conventions

- `id` sempre stringa canonica interna, stabile nel tempo.
- eventuali ID esterni vanno in campi `provider*Id` (es. `providerStopId`).
- gli ID canonical non devono dipendere da etichette testuali localizzate.

## 2.5 Timestamp conventions

- tutti i timestamp sono `epoch milliseconds UTC`.
- nessun timestamp normalizzato in secondi.
- campi supportati:
  - `scheduledEpochMs`
  - `predictedEpochMs`
  - `asOfEpochMs`
  - `fetchedAtEpochMs`
  - `staleAtEpochMs`
  - `occurredAtEpochMs`

## 2.6 Nullability conventions

- i campi obbligatori non possono essere `null`.
- i campi opzionali possono essere `null` se realmente sconosciuti.
- evitare stringhe sentinella (`"N/A"`, `"unknown"`) nei campi opzionali: usare `null`.

## 3) Shape definitive

## 3.1 Stop

Campi:

| Campo | Tipo | Req | Semantica |
|---|---|---|---|
| `id` | `string` | si | ID canonico fermata |
| `name` | `string` | si | Nome parlabile fermata |
| `aliases` | `string[]` | no | Sinonimi/varianti |
| `coordinates.lat` | `number \\| null` | no | Latitudine WGS84 |
| `coordinates.lon` | `number \\| null` | no | Longitudine WGS84 |
| `lineIds` | `string[]` | no | Linee serventi note |
| `source` | `'official'\\|'public'\\|'fallback'` | si | Classe origine dato |
| `sourceName` | `string` | no | Nome tecnico sorgente |
| `confidence` | `number` | si | Qualita del mapping |
| `providerStopId` | `string \\| null` | no | ID originale provider |
| `metadata` | `object \\| null` | no | Extra non core |

Esempio realistico:

```json
{
  "id": "STOP_01011101",
  "name": "Ancona Green",
  "aliases": ["ancona", "ancona green"],
  "coordinates": { "lat": 41.151684, "lon": 16.738664 },
  "lineIds": ["01", "07"],
  "source": "official",
  "sourceName": "amtab_gtfs_static",
  "confidence": 0.95,
  "providerStopId": "01011101",
  "metadata": null
}
```

## 3.2 Line

Campi:

| Campo | Tipo | Req | Semantica |
|---|---|---|---|
| `id` | `string` | si | ID canonico linea |
| `code` | `string` | si | Codice parlabile linea (`id` default) |
| `aliases` | `string[]` | no | Varianti vocali |
| `destinationTargetId` | `string \\| null` | no | Destinazione canonica associata |
| `destinationName` | `string` | no | Nome destinazione human readable |
| `stopIds` | `string[]` | no | Sequenza/insieme fermate note |
| `firstMinute` | `number \\| null` | no | Inizio servizio (min da mezzanotte) |
| `lastMinute` | `number \\| null` | no | Fine servizio (min da mezzanotte) |
| `headwayMinutes` | `number \\| null` | no | Frequenza teorica |
| `source` | enum source | si | Classe origine |
| `sourceName` | `string` | no | Nome sorgente |
| `confidence` | `number` | si | Affidabilita mapping linea |
| `providerLineId` | `string \\| null` | no | ID linea provider |
| `metadata` | `object \\| null` | no | Extra non core |

Esempio realistico:

```json
{
  "id": "02/",
  "code": "02/",
  "aliases": ["linea 2 barra", "due barra"],
  "destinationTargetId": "DEST_POLICLINICO",
  "destinationName": "Policlinico di Bari",
  "stopIds": ["STOP_01011101", "STOP_01020456"],
  "firstMinute": 300,
  "lastMinute": 1410,
  "headwayMinutes": 12,
  "source": "official",
  "sourceName": "amtab_gtfs_static",
  "confidence": 0.9,
  "providerLineId": "02/",
  "metadata": null
}
```

## 3.3 DestinationTarget

Campi:

| Campo | Tipo | Req | Semantica |
|---|---|---|---|
| `id` | `string` | si | ID canonico destinazione |
| `name` | `string` | si | Nome destinazione parlabile |
| `aliases` | `string[]` | no | Sinonimi |
| `targetStopIds` | `string[]` | no | Fermate target collegate |
| `source` | enum source | si | Classe origine |
| `sourceName` | `string` | no | Nome sorgente |
| `confidence` | `number` | si | Affidabilita mapping |
| `providerDestinationId` | `string \\| null` | no | ID esterno |
| `metadata` | `object \\| null` | no | Extra |

Esempio realistico:

```json
{
  "id": "DEST_POLICLINICO",
  "name": "Policlinico di Bari",
  "aliases": ["policlinico", "ospedale policlinico"],
  "targetStopIds": ["STOP_01020456"],
  "source": "official",
  "sourceName": "derived_from_gtfs",
  "confidence": 0.88,
  "providerDestinationId": null,
  "metadata": null
}
```

## 3.4 Arrival

Campi:

| Campo | Tipo | Req | Semantica |
|---|---|---|---|
| `id` | `string` | si | ID tecnico arrivo (deterministico) |
| `stopId` | `string` | si | Fermata di arrivo |
| `lineId` | `string` | si | Linea |
| `destinationTargetId` | `string \\| null` | no | Target destinazione |
| `destinationName` | `string` | no | Nome destinazione per voce |
| `etaMinutes` | `number \\| null` | no | ETA rispetto a `asOfEpochMs` |
| `predictionType` | enum predictionType | si | natura del dato temporale |
| `scheduledEpochMs` | `number \\| null` | no | orario teorico |
| `predictedEpochMs` | `number \\| null` | no | orario previsto reale |
| `delaySeconds` | `number \\| null` | no | `predicted - scheduled` |
| `asOfEpochMs` | `number` | si | timestamp osservazione |
| `isRealtime` | `boolean` | si | compatibilita legacy (`predictionType === realtime`) |
| `source` | enum source | si | classe origine |
| `sourceName` | `string` | no | nome sorgente |
| `confidence` | `number` | si | affidabilita previsione |
| `providerTripId` | `string \\| null` | no | trip/corsa esterna |
| `metadata` | `object \\| null` | no | extra |

Differenza reale vs programmato:

- realtime (`predictionType = realtime`): tipicamente `predictedEpochMs` valorizzato, `confidence` alta.
- scheduled (`predictionType = scheduled`): tipicamente `scheduledEpochMs` valorizzato, `predictedEpochMs = null`.
- inferred (`predictionType = inferred`): stima derivata, confidence mediamente piu bassa.

Esempio realtime:

```json
{
  "id": "arr:STOP_01020456:02/:realtime:1773055440000",
  "stopId": "STOP_01020456",
  "lineId": "02/",
  "destinationTargetId": "DEST_POLICLINICO",
  "destinationName": "Policlinico di Bari",
  "etaMinutes": 4,
  "predictionType": "realtime",
  "scheduledEpochMs": 1773055200000,
  "predictedEpochMs": 1773055440000,
  "delaySeconds": 240,
  "asOfEpochMs": 1773055205000,
  "isRealtime": true,
  "source": "official",
  "sourceName": "amtab_gtfs_rt_tripupdates",
  "confidence": 0.93,
  "providerTripId": "trip_02A_12345",
  "metadata": null
}
```

Esempio scheduled:

```json
{
  "id": "arr:STOP_01020456:02/:scheduled:1773055620000",
  "stopId": "STOP_01020456",
  "lineId": "02/",
  "destinationTargetId": "DEST_POLICLINICO",
  "destinationName": "Policlinico di Bari",
  "etaMinutes": 7,
  "predictionType": "scheduled",
  "scheduledEpochMs": 1773055620000,
  "predictedEpochMs": null,
  "delaySeconds": null,
  "asOfEpochMs": 1773055205000,
  "isRealtime": false,
  "source": "official",
  "sourceName": "amtab_gtfs_static",
  "confidence": 0.76,
  "providerTripId": null,
  "metadata": null
}
```

## 3.5 RouteOption

Campi:

| Campo | Tipo | Req | Semantica |
|---|---|---|---|
| `id` | `string` | si | ID opzione percorso |
| `originStopId` | `string` | si | fermata origine |
| `destinationTargetId` | `string` | si | target destinazione |
| `lineIds` | `string[]` | si | linee usate |
| `transfers` | `number` | si | numero cambi |
| `estimatedMinutes` | `number \\| null` | no | durata stimata |
| `predictionType` | enum predictionType | si | natura stima percorso |
| `source` | enum source | si | classe origine |
| `sourceName` | `string` | no | nome sorgente |
| `confidence` | `number` | si | affidabilita opzione |
| `metadata` | `object \\| null` | no | extra |

Esempio realistico:

```json
{
  "id": "route:STOP_01011101:DEST_POLICLINICO:02/",
  "originStopId": "STOP_01011101",
  "destinationTargetId": "DEST_POLICLINICO",
  "lineIds": ["02/"],
  "transfers": 0,
  "estimatedMinutes": 19,
  "predictionType": "inferred",
  "source": "official",
  "sourceName": "computed_from_gtfs",
  "confidence": 0.72,
  "metadata": null
}
```

## 3.6 ProviderResult

Campi:

| Campo | Tipo | Req | Semantica |
|---|---|---|---|
| `ok` | `boolean` | si | esito operazione provider |
| `source` | enum source | si | classe sorgente risultato |
| `sourceName` | `string` | no | nome sorgente |
| `predictionType` | enum predictionType \\| null | no | natura dominante del payload |
| `confidence` | `number \\| null` | no | confidence aggregata risposta |
| `fetchedAtEpochMs` | `number` | si | istante fetch |
| `staleAtEpochMs` | `number \\| null` | no | deadline freshness |
| `warnings` | `string[]` | no | warning non bloccanti |
| `data` | `any[]` | si | payload normalizzato |
| `error` | `ProviderError \\| null` | no | errore strutturato |
| `meta` | `object \\| null` | no | metadata diagnostici |

Esempio:

```json
{
  "ok": true,
  "source": "official",
  "sourceName": "amtab_gtfs_rt_tripupdates",
  "predictionType": "realtime",
  "confidence": 0.9,
  "fetchedAtEpochMs": 1773055205000,
  "staleAtEpochMs": 1773055325000,
  "warnings": [],
  "data": [{ "id": "arr:..." }],
  "error": null,
  "meta": { "httpStatus": 200, "cacheHit": false }
}
```

## 3.7 ProviderError

Campi:

| Campo | Tipo | Req | Semantica |
|---|---|---|---|
| `code` | `string` | si | codice tassonomia errore (`NETWORK`, `AUTH`, ecc.) |
| `message` | `string` | si | messaggio tecnico sintetico |
| `retriable` | `boolean` | si | indica se retry consigliato |
| `source` | enum source | si | classe sorgente errore |
| `sourceName` | `string` | no | nome sorgente |
| `httpStatus` | `number \\| null` | no | status HTTP se applicabile |
| `occurredAtEpochMs` | `number` | si | timestamp errore |
| `details` | `object \\| null` | no | dettagli strutturati |
| `cause` | `string \\| null` | no | causa sintetica |

Esempio:

```json
{
  "code": "RATE_LIMIT",
  "message": "Too many requests from upstream",
  "retriable": true,
  "source": "official",
  "sourceName": "amtab_gtfs_rt_tripupdates",
  "httpStatus": 429,
  "occurredAtEpochMs": 1773055205000,
  "details": { "retryAfterSeconds": 30 },
  "cause": "upstream_throttle"
}
```

## 4) Regola di isolamento dal raw payload

Pipeline obbligatoria:

1. gateway sorgente legge payload raw.
2. gateway mappa su shape interne tramite `providerShapes`.
3. data source usa solo shape normalizzate.
4. resolver/handler Alexa consumano solo entita normalizzate.

Divieto:

- accedere a campi raw provider (`trip_update`, `route_short_name`, ecc.) fuori dal layer di mapping.
