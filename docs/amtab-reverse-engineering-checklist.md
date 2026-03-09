# Trasporto Urbano Bari - Checklist di Reverse Engineering Prudente (AMTAB/MUVT)

Data: 2026-03-09  
Stato: riferimento  
Uso previsto: analisi tecnica controllata di sito/app per individuare fonti dati utili alla skill Alexa.

## Regole operative prima di iniziare

- [ ] Leggere termini d'uso e policy legali del canale analizzato.
- [ ] Evitare bypass di autenticazioni, cifrature o protezioni anti-bot.
- [ ] Limitare il rate delle richieste durante i test.
- [ ] Salvare solo metadata tecnici necessari (no dati personali utenti).
- [ ] Separare chiaramente evidenze `ufficiale`, `probabile`, `ipotetica`.

## Setup sessione

- [ ] Creare cartella sessione: `docs/re-notes/YYYY-MM-DD/`.
- [ ] Preparare file:
  - [ ] `traffic-log.md`
  - [ ] `endpoint-catalog.md`
  - [ ] `entity-mapping.md`
  - [ ] `open-questions.md`
- [ ] Definire ambiente test (browser desktop, mobile web, app se disponibile).
- [ ] Sincronizzare orologio macchina (utile per confronto timestamp feed).

## Checklist tecnica (operativa)

## 1) Analisi traffico di rete (web/app)

### Cosa cercare

- Chiamate XHR/fetch/websocket durante azioni utente:
  - apertura mappa/linee
  - selezione fermata
  - richiesta arrivi
  - filtro linea/direzione
- Dominio chiamato, path, metodo HTTP, query params, payload, response headers.
- Frequenza polling (es. ogni 10s/20s/30s).

### Come riconoscerlo

- Pattern endpoint tipici: `api`, `gtfs`, `realtime`, `trip`, `stop`, `line`, `route`, `arrival`.
- Endpoint dati spesso con response `application/json`, `application/protobuf`, `text/csv`, `application/zip`.
- Polling realtime: richieste ripetute con stessa route e timestamp crescente.

### Come documentarlo

- Per ogni chiamata:
  - URL completo (mascherando eventuali token)
  - metodo
  - status code
  - content-type
  - esempio response (snippet breve)
  - azione UI che la genera
- Salvare in `endpoint-catalog.md` con etichetta `Ufficiale/Probabile/Ipotetica`.

## 2) Identificazione API e formato dati

### Cosa cercare

- API REST/JSON.
- API GraphQL (`/graphql`, payload con `query`/`operationName`).
- Feed statici GTFS (`google_transit.zip`, `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`).
- Feed realtime GTFS-RT (JSON o protobuf con header/version/timestamp/entities).
- File statici accessori (PDF orari, CSV, JSON embedded in HTML).

### Come riconoscerlo

- JSON: oggetti/array con chiavi semantiche (`stop_id`, `route_id`, `arrival_time`).
- GraphQL: POST con corpo contenente query testuale.
- GTFS statico: ZIP con file `.txt` standard.
- GTFS-RT protobuf: content-type binario, payload non leggibile senza decoder.
- GTFS-RT JSON: presenza campi tipo `Header`, `Entities`, `Timestamp`.

### Come documentarlo

- Catalogare per fonte:
  - formato (`REST JSON`, `GraphQL`, `GTFS ZIP`, `GTFS-RT JSON/Protobuf`, `PDF`)
  - entita esposte
  - campi chiave osservati
  - stabilita percepita (bassa/media/alta)

## 3) Entita dominio: stop, linee, arrivi, destinazioni

### Cosa cercare

- Identificativi fermata (`stop_id`, `stop_code`, codici numerici/alfanumerici).
- Identificativi linea (`route_id`, `lineCode`, `lineid`, `route_short_name`).
- Identificativi corsa/direzione (`trip_id`, `direction_id`, capolinea/destination text).
- Relazioni:
  - fermata -> linee servite
  - linea -> capolinea/direzioni
  - corsa -> sequenza fermate/ETA

### Come riconoscerlo

- Campi ricorrenti tra endpoint diversi con stessi valori.
- Coerenza tra dati rete e UI (nome fermata, numero linea, capolinea mostrati all'utente).
- Presenza di codici stabili anche quando cambia lingua/label.

### Come documentarlo

- Mantenere `entity-mapping.md` con tabelle:
  - `stop_id` <-> `stop_name`
  - `route_id`/`lineCode` <-> linea visualizzata
  - `trip_id`/`direction_id` <-> destinazione/capolinea
- Annotare mismatch o ambiguita da risolvere.

## 4) Endpoint \"arrivi per fermata\"

### Cosa cercare

- Chiamata generata quando si apre una fermata o si cerca \"prossimi arrivi\".
- Parametri principali: `stop_id`, `stop_code`, coordinate, linea opzionale.
- Indicatori di previsione vs orario teorico.

### Come riconoscerlo

- Response con lista passaggi imminenti (`eta`, `minutes`, `expected`, `scheduled`).
- Presenza contemporanea di tempo previsto e tempo programmato.
- Ordinamento tipico per tempo crescente.

### Come documentarlo

- Per ogni endpoint arrivi:
  - schema JSON/protobuf decodificato
  - campo identificativo fermata
  - campi tempo con semantica
  - esempio di 3 record reali (anonymized se necessario)

## 5) Endpoint \"linea e direzione\"

### Cosa cercare

- Chiamata generata quando selezioni una linea e una direzione/capolinea.
- Parametri possibili: `route_id`, `lineCode`, `direction_id`, `trip_headsign`, `destination`.
- Eventuale endpoint separato per varianti corsa.

### Come riconoscerlo

- Response con elenco fermate linea o corse per direzione.
- Presenza di `headsign`/`destination` e distinzione andata/ritorno.
- Coerenza con libretti orari/GTFS statico.

### Come documentarlo

- Tracciare mappa:
  - linea -> direzioni disponibili
  - direzione -> fermate principali
  - direzione -> arrivi associati
- Segnare dove la direzione e testuale vs numerica.

## 6) Timestamp, timezone, freshness

### Cosa cercare

- Formati timestamp:
  - unix seconds/milliseconds
  - ISO-8601
  - orario locale `HH:mm`
- Timezone implicita o esplicita.
- Indicatore di freshness feed (`timestamp`, `last_update`, `server_time`).

### Come riconoscerlo

- Unix seconds: numeri 10 cifre; milliseconds: 13 cifre.
- ISO: pattern `YYYY-MM-DDTHH:mm:ssZ`.
- Drift percepibile tra ora sistema e ora feed.

### Come documentarlo

- Annotare per ogni endpoint:
  - formato timestamp
  - conversione in locale
  - staleness misurata (`now - feed_timestamp`)
- Definire soglie operative suggerite (es. stale > 120s).

## 7) Caching e comportamento HTTP

### Cosa cercare

- Header: `Cache-Control`, `ETag`, `Last-Modified`, `Expires`, `Age`.
- Supporto conditional requests (`If-None-Match`, `If-Modified-Since`).
- CDN/proxy (header `Via`, `X-Cache`, `CF-*`).

### Come riconoscerlo

- Risposte `304 Not Modified`.
- TTL espliciti (`max-age=...`).
- Cambi di payload solo a intervalli regolari.

### Come documentarlo

- Tabella endpoint con:
  - cacheability
  - TTL osservato
  - strategia client consigliata
- Note su impatto quota/rate limit.

## 8) Token, sessioni, autenticazione

### Cosa cercare

- Header/cookie di sessione (`Authorization`, `Bearer`, cookie app-specifici).
- Token temporanei in query o body.
- Eventuali chiavi pubbliche in JS bundle.

### Come riconoscerlo

- Endpoint che funzionano solo dopo bootstrap/session init.
- Errori `401/403` senza token valido.
- Token con scadenza (JWT o equivalenti).

### Come documentarlo

- Documentare meccanismo senza salvare segreti:
  - dove nasce il token
  - durata
  - endpoint che lo richiedono
- Mascherare sempre valori sensibili nei log (`***`).

## 9) Realtime vs scheduled (previsionale vs teorico)

### Cosa cercare

- Campi distinti per:
  - orario teorico/programmazione (`scheduled_time`)
  - previsione (`predicted_time`, `expected_time`, delay)
- Flag realtime (`is_realtime`, `source`, `realtime_available`).

### Come riconoscerlo

- Differenze tra orario previsto e teorico sulla stessa corsa.
- Feed che in alcune fasce torna vuoto ma statico resta disponibile.
- Campo delay positivo/negativo o stato \"on time\".

### Come documentarlo

- Definire matrice per endpoint:
  - solo scheduled
  - realtime + scheduled
  - realtime assente/fallback
- Allegare esempi concreti con timestamp convertiti.

## 10) Ricerca feed statici nascosti o alternativi

### Cosa cercare

- Riferimenti in HTML/JS a:
  - `.json`, `.geojson`, `.csv`, `.zip`, `.pb`
  - `gtfs`, `openmobility`, `download`, `export`
- Sitemap, robots, pagine \"open data\", \"download\", \"developer\".

### Come riconoscerlo

- URL raggiungibili direttamente via browser/curl.
- File scaricabili senza autenticazione.
- Naming coerente con dominio trasporti.

### Come documentarlo

- Inserire in `endpoint-catalog.md` come `Candidato statico`.
- Segnare stato:
  - `verificato`
  - `non raggiungibile`
  - `richiede autorizzazione`

## Template rapido per ogni evidenza

```md
### Evidenza ID: E-XXX
- Fonte: AMTAB / MUVT / altro
- Classificazione: Ufficiale / Probabile / Ipotetica
- URL: ...
- Azione che la genera: ...
- Metodo + status: GET 200
- Content-Type: ...
- Entita trovate: stop / line / arrivi / destinazioni
- Identificativi chiave: ...
- Timestamp format: ...
- Realtime o scheduled: ...
- Cache/Auth: ...
- Rischio legale/ToS: basso/medio/alto
- Decisione: usa in V1 / fallback / scarta
```

## Exit criteria della sessione

- [ ] Almeno un endpoint o feed verificato per fermate.
- [ ] Almeno un endpoint o feed verificato per linee/capolinea.
- [ ] Almeno un endpoint o feed verificato per arrivi fermata.
- [ ] Chiarita distinzione realtime vs scheduled.
- [ ] Mappati identificativi tecnici (`stop_id`, `route_id`, `trip/direction`).
- [ ] Valutati token/sessioni/caching.
- [ ] Aggiornato `docs/amtab-data-sources.md` con nuove evidenze confermate.
