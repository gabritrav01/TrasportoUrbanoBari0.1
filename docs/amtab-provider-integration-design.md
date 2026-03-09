# Trasporto Urbano Bari - Progettazione reale AmtabProvider (integrazione dati)

Data: 2026-03-09  
Ambito: trasformazione dello stub AMTAB in una architettura pronta all'integrazione con fonti reali, senza inventare endpoint non verificati.

## 1) Obiettivo e vincoli

- Mantenere la stessa interfaccia `TransportProvider` usata dalla skill.
- Separare responsabilita per ridurre accoppiamento tra dominio e fonte dati.
- Tenere funzionante il fallback su catalogo locale (stub) finche le fonti reali non sono integrate.
- Prevedere punti espliciti per cache, retry, fallback e futura osservabilita.

## 2) Struttura interna realizzata

`lambda/services/providers/amtabProvider.js` ora e un orchestratore che compone sottocomponenti.

### Componenti

- `providerShapes` (contratto dominio): [`lambda/services/providers/domain/providerShapes.js`](../lambda/services/providers/domain/providerShapes.js)
  - Shape definitive, enum (`source`, `predictionType`) e helper `ProviderResult`/`ProviderError`.
- `normalizer`: [`lambda/services/providers/amtab/normalizer.js`](../lambda/services/providers/amtab/normalizer.js)
  - Normalizza entita dominio (`Stop`, `Line`, `DestinationTarget`, `Arrival`, `RouteOption`).
- `cacheAdapter`: [`lambda/services/providers/amtab/cacheAdapter.js`](../lambda/services/providers/amtab/cacheAdapter.js)
  - Cache in-memory TTL per query ripetute.
- `retryAdapter`: [`lambda/services/providers/amtab/retryAdapter.js`](../lambda/services/providers/amtab/retryAdapter.js)
  - Retry con backoff per chiamate verso fonti instabili.
- `amtabApiClient` (astrazione fonte): [`lambda/services/providers/amtab/amtabApiClient.js`](../lambda/services/providers/amtab/amtabApiClient.js)
  - Contratto a hook; nessun endpoint hardcoded.
- `stopDataSource`: [`lambda/services/providers/amtab/stopDataSource.js`](../lambda/services/providers/amtab/stopDataSource.js)
  - Ricerca fermate e nearest.
- `linesDataSource`: [`lambda/services/providers/amtab/linesDataSource.js`](../lambda/services/providers/amtab/linesDataSource.js)
  - Ricerca linee e linee serventi fermata.
- `destinationResolverAdapter`: [`lambda/services/providers/amtab/destinationResolverAdapter.js`](../lambda/services/providers/amtab/destinationResolverAdapter.js)
  - Risoluzione destinazioni.
- `arrivalsDataSource`: [`lambda/services/providers/amtab/arrivalsDataSource.js`](../lambda/services/providers/amtab/arrivalsDataSource.js)
  - Arrivi realtime/scheduled e fallback da headway.
- `routePlanner`: [`lambda/services/providers/amtab/routePlanner.js`](../lambda/services/providers/amtab/routePlanner.js)
  - Percorsi diretti origin/destination.

## 3) Contratto della sorgente dati (astratto)

L'integrazione reale entra tramite `apiClient` e i suoi hook opzionali:

- `searchStops(query)`
- `nearestStops(lat, lon, limit)`
- `searchLines(query)`
- `getLinesServingStop(stopId)`
- `resolveDestination(query)`
- `findRoutes(originStopIds, destinationTargetIds)`
- `getStopArrivals(stopId)`
- `getRealtimePredictions(stopId, lineId)`
- `getScheduledArrivals(stopId, lineId)`
- `ping()`

Se uno hook manca o fallisce, i data source applicano fallback a dati locali/stimati.

Esempio di wiring (senza endpoint hardcoded):

```js
const provider = createAmtabProvider({
  apiClient: createAmtabApiClient({
    searchStops: async (query) => stopGateway.search(query),
    getRealtimePredictions: async (stopId, lineId) =>
      realtimeGateway.getPredictions({ stopId, lineId }),
    getScheduledArrivals: async (stopId, lineId) =>
      scheduleGateway.getArrivals({ stopId, lineId })
  })
});
```

## 4) Flussi dati per metodo

## 4.1 `searchStops(query)`

### Cosa cerca

- Fermate candidate per testo libero.

### Flusso

1. Normalizzazione query (`normalizer.searchText`).
2. Cache lookup `amtab:stops:search:<query>`.
3. Tentativo `apiClient.searchStops(query)` con retry.
4. Se remoto valido: normalizza + registra in indice locale + ranking.
5. Se remoto assente/fallito: ranking su catalogo locale normalizzato.

### Come documentarlo nel codice

- Data source: `stopDataSource`.
- Fallback: automatico su catalogo locale.

## 4.2 `nearestStops(lat, lon)`

### Cosa cerca

- Fermate piu vicine con distanza.

### Flusso

1. Validazione coordinate.
2. Cache lookup `amtab:stops:nearest:<lat>:<lon>:<limit>`.
3. Tentativo `apiClient.nearestStops(lat, lon, limit)` con retry.
4. Se remoto valido: normalizzazione entry + registrazione stop.
5. Fallback: distanza Haversine su catalogo locale.

### Note

- Dati remoti e locali passano entrambi nel normalizzatore.

## 4.3 `getStopArrivals(stopId)`

### Cosa cerca

- Prossimi arrivi aggregati per fermata.

### Flusso

1. Cache lookup `amtab:arrivals:stop:<stopId>`.
2. Tentativo bulk remoto `apiClient.getStopArrivals(stopId)` con retry.
3. Se bulk remoto presente: normalizzazione + sort ETA.
4. Se bulk assente:
   - ricava linee da `linesDataSource.getLinesServingStop(stopId)`
   - per ogni linea: prova realtime, altrimenti scheduled
   - aggrega, deduplica, ordina.

### Note

- Questo e il nodo principale dove convive realtime/scheduled.

## 4.4 `getLinesServingStop(stopId)`

### Cosa cerca

- Linee che transitano nella fermata.

### Flusso

1. Cache lookup `amtab:lines:stop:<stopId>`.
2. Tentativo `apiClient.getLinesServingStop(stopId)` con retry.
3. Se remoto valido: normalizza + aggiorna indice linee.
4. Fallback: indice locale linea->stop.

## 4.5 `resolveDestination(query)`

### Cosa cerca

- Destinazioni/capolinea coerenti con query utente.

### Flusso

1. Normalizzazione query.
2. Cache lookup `amtab:destinations:search:<query>`.
3. Tentativo `apiClient.resolveDestination(query)` con retry.
4. Se remoto valido: normalizza + registra.
5. Fallback: ranking su catalogo destinazioni locale.

## 4.6 `findRoutes(originStopIds, destinationTargetIds)`

### Cosa cerca

- Opzioni percorso (V1: diretto, senza cambi).

### Flusso

1. Sanitizza array input.
2. Cache lookup `amtab:routes:<origins>:<destinations>`.
3. Tentativo `apiClient.findRoutes(...)` con retry.
4. Se remoto valido: normalizza route option.
5. Fallback: matching diretto su linee locali (`destinationTargetId` + `originStopId`).

### Nota evolutiva

- Il planner puo essere sostituito in futuro con journey planner ufficiale mantenendo il contratto.

## 4.7 `getRealtimePredictions(stopId, lineId)`

### Cosa cerca

- Previsioni realtime per coppia fermata-linea.

### Flusso

1. Cache lookup `amtab:arrivals:realtime:<stopId>:<lineId>`.
2. Tentativo `apiClient.getRealtimePredictions(stopId, lineId)` con retry.
3. Normalizzazione con default da metadata linea (destinazione).
4. Ordinamento per ETA.
5. Se assente/errore: ritorna array vuoto (fallback demandato al chiamante).

## 4.8 `getScheduledArrivals(stopId, lineId)`

### Cosa cerca

- Arrivi programmati (teorici) per coppia fermata-linea.

### Flusso

1. Cache lookup `amtab:arrivals:scheduled:<stopId>:<lineId>`.
2. Tentativo `apiClient.getScheduledArrivals(stopId, lineId)` con retry.
3. Se remoto presente: normalizzazione e sort.
4. Fallback locale: generazione da headway (`firstMinute`, `lastMinute`, `headwayMinutes`) della linea.

## 5) Distinzione dati statici vs dinamici

## Dati statici (bootstrap/base)

- Fermate, linee, destinazioni (catalogo).
- Alias e metadata descrittivi.
- Usati da: `stopDataSource`, `linesDataSource`, `destinationResolverAdapter`, `routePlanner`.

## Dati dinamici (runtime)

- Arrivi realtime e scheduled attuali.
- Freshness, latenza, instabilita fonte.
- Usati da: `arrivalsDataSource`.

## Strategia

- Statico per copertura minima sempre disponibile.
- Dinamico per precisione quando la sorgente e aggiornata.
- Degrado controllato verso scheduled/local quando realtime manca.

## 6) Punti di cache, retry e fallback

## Cache

- Fermate query: TTL 60s.
- Nearest: TTL 15s.
- Linee per fermata: TTL 30s.
- Destinazioni query: TTL 60s.
- Realtime per stop+linea: TTL 15s.
- Scheduled per stop+linea: TTL 45s.
- Arrivi aggregati stop: TTL 10s.
- Route planning: TTL 30s.

## Retry

- Applicato ai metodi `apiClient.*` via `retryAdapter.execute(...)`.
- Configurabile: `maxAttempts`, `baseDelayMs`, `maxDelayMs`, `jitterMs`.

## Fallback

- Se API non disponibile:
  - search/resolve -> catalogo locale.
  - line serving stop -> indice locale.
  - scheduled -> headway locale.
  - getStopArrivals -> compose realtime/scheduled per linea.
  - routes -> matching diretto locale.

## 7) Suggerimenti anti-accoppiamento con la fonte

1. Mantenere la sorgente dietro `apiClient` (mai consumare payload raw nei resolver/handler).
2. Far passare ogni dato nel `normalizer` prima di entrare nel dominio.
3. Non usare nomi campo provider-specific nel resto del codice skill.
4. Tenere mapping ID esterno -> ID dominio in un livello dedicato (se necessario).
5. Versionare il contratto interno del provider per evitare regressioni quando cambia la fonte.
6. Inserire test per normalizzazione e fallback, non per endpoint specifici.
7. Aggiungere feature flag per attivare gradualmente realtime reale in produzione.

## 8) Stato attuale e step pratici successivi

## Gia implementato

- Refactor di `amtabProvider` in orchestratore componentizzato.
- Sottocomponenti richiesti disponibili e collegati.
- Compatibilita mantenuta con `TransportService` e resolver esistenti.

## Da fare per integrazione AMTAB reale

1. Implementare hook `apiClient` solo con endpoint verificati (fonti ufficiali).
2. Agganciare parser GTFS/GTFS-RT nel layer `apiClient` o in adapter dedicato.
3. Aggiungere health metrics su:
   - rate errori
   - freshness realtime
   - percentuale fallback scheduled.
4. Introdurre test automatici su:
   - normalizzazione feed reali
   - fallback in caso feed vuoto/stale
   - coerenza voce Alexa (linea/destinazione/minuti).
