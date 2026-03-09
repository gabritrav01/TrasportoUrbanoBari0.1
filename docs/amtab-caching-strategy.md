# Trasporto Urbano Bari - Strategia caching provider dati

Data: 2026-03-09  
Stato: riferimento  
Ambiente target: Alexa-hosted skill (Node.js, Lambda managed, no infrastruttura complessa obbligatoria).

## Obiettivi

- Ridurre chiamate remote (costo e latenza).
- Evitare risposte con dati troppo vecchi.
- Separare cache statica e dinamica.
- Mantenere implementazione semplice in Alexa-hosted.
- Permettere crescita graduale verso cache persistente senza riscrivere il provider.

## 1) Cosa cachare

## Dati statici (basso churn)

- fermate (`Stop`)
- linee (`Line`)
- mapping destinazioni (`DestinationTarget`)

Chiavi consigliate:

- `amtab:v{catalogVersion}:static:stops:*`
- `amtab:v{catalogVersion}:static:lines:*`
- `amtab:v{catalogVersion}:static:destinations:*`

Nota:

- usare `catalogVersion` (hash feed GTFS o data snapshot) per invalidazione bulk semplice.

## Dati dinamici (alto churn)

- arrivi realtime (`Arrival` predictionType `realtime`)
- arrivi scheduled (`Arrival` predictionType `scheduled`)

Chiavi consigliate:

- `amtab:dynamic:arrivals:realtime:{stopId}:{lineId}`
- `amtab:dynamic:arrivals:scheduled:{stopId}:{lineId}`
- `amtab:dynamic:arrivals:stop:{stopId}` (aggregato)

## Cache negative (opzionale ma utile)

- lookup senza risultati (`stop`, `line`, `destination`) con TTL corto.
- evita query ripetute verso fonte su input problematici.

Chiave tipo:

- `amtab:negative:{queryKind}:{normalizedQuery}`

## 2) TTL consigliati

Strategia raccomandata: doppio TTL

- `freshTtlMs`: dato servibile come fresco.
- `staleIfErrorMs`: dato servibile solo se refresh remoto fallisce.

| Tipo dato | freshTtlMs consigliato | staleIfErrorMs consigliato | Motivazione |
|---|---:|---:|---|
| Fermate | `12h` | `48h` | dataset quasi statico, update non frequenti |
| Linee | `12h` | `48h` | simile a fermate, variazioni non minute-by-minute |
| Mapping destinazioni | `24h` | `72h` | cambia raramente, spesso derivato da statico |
| Arrivi realtime | `12s` | `45s` | minimizzare hit remote ma evitare stale eccessivo |
| Arrivi scheduled | `90s` | `10m` | dato teorico; breve cache per ridurre ricalcolo/remote |

TTL addizionali utili:

- cache negative: `30s` (massimo `60s`)
- nearest stops geospaziale: `15s - 30s`
- search testuale (stop/line/destination): `5m - 10m`

## 3) Invalidazione

## Time-based

- invalidazione automatica su TTL (base minima sempre attiva).

## Version-based (fortemente consigliata per statico)

- al cambio `catalogVersion` invalidare implicitamente tutte le chiavi statiche tramite namespace versione.
- non serve scan/delete massivo.

## Event-based

- quando fonte ufficiale segnala aggiornamento (nuovo GTFS snapshot), forzare bump versione.

## Manuale (operativo)

- env var `CACHE_BUST_TOKEN` letta a bootstrap:
  - se cambia, aumenta namespace cache.
- utile per rollback/hotfix senza interventi infrastrutturali.

## 4) Fallback quando cache e fonte remota falliscono

Ordine proposto:

1. Se presente dato `fresh`: servire fresh.
2. Se remote fallisce e presente dato `staleIfError`: servire stale con flag diagnostico.
3. Se manca cache:
   - per arrivi: degradare da `realtime` a `scheduled`.
   - per scheduled: usare stima locale da headway (gia disponibile nel provider attuale).
4. Se anche scheduled non disponibile:
   - usare provider fallback secondario (`moovitFallbackProvider`) se abilitato.
5. Ultima linea:
   - risposta "nessun passaggio imminente disponibile" senza inventare dati.

Regola operativa:

- mai servire oltre `staleIfErrorMs` per realtime.
- per statico si puo servire stale lungo solo se marcato `fallback` e monitorato.

## 5) Memoria vs file temporanei vs DynamoDB

| Opzione | Pro | Contro | Raccomandazione |
|---|---|---|---|
| In-memory (`Map`) | semplicissima, veloce, zero setup | persa su cold start, non condivisa tra istanze | base obbligatoria in Alexa-hosted |
| File temporanei (`/tmp`) | facile snapshot locale, sopravvive warm container | non condiviso, fragile su rotazioni, gestione I/O | opzionale, non primaria |
| DynamoDB | persistente, condivisa multi-container, TTL nativo | setup AWS e complessita maggiore | consigliata fase 2 per statico e fallback scheduled |

Proposta concreta:

- Fase 1 (subito): solo in-memory + stale-if-error.
- Fase 2 (quando serve resilienza cross-container): aggiungere DynamoDB come L2 per statico e scheduled.
- Evitare `/tmp` come unica strategia.

## 6) Integrazione con i servizi esistenti

Punti codice attuali:

- `lambda/services/providers/amtab/cacheAdapter.js`
- `lambda/services/providers/amtabProvider.js`
- `lambda/services/providers/amtab/stopDataSource.js`
- `lambda/services/providers/amtab/linesDataSource.js`
- `lambda/services/providers/amtab/destinationResolverAdapter.js`
- `lambda/services/providers/amtab/arrivalsDataSource.js`
- `lambda/services/transitService.js`

Integrazione minima suggerita:

1. Introdurre config centralizzata `lambda/config/cachePolicy.js`.
2. Passare `cachePolicy` in `createTransitService -> createAmtabProvider`.
3. Sostituire TTL hardcoded nei data source con valori policy.
4. Estendere `cacheAdapter` con metadati `freshUntil/staleUntil`.
5. Nei metodi dinamici usare pattern:
   - prova remote refresh
   - se errore, usa stale entro finestra.

Esempio policy:

```js
module.exports = {
  static: {
    stops: { freshTtlMs: 12 * 60 * 60 * 1000, staleIfErrorMs: 48 * 60 * 60 * 1000 },
    lines: { freshTtlMs: 12 * 60 * 60 * 1000, staleIfErrorMs: 48 * 60 * 60 * 1000 },
    destinationMap: { freshTtlMs: 24 * 60 * 60 * 1000, staleIfErrorMs: 72 * 60 * 60 * 1000 }
  },
  dynamic: {
    realtimeArrivals: { freshTtlMs: 12 * 1000, staleIfErrorMs: 45 * 1000 },
    scheduledArrivals: { freshTtlMs: 90 * 1000, staleIfErrorMs: 10 * 60 * 1000 }
  },
  negative: {
    queryMiss: { freshTtlMs: 30 * 1000, staleIfErrorMs: 60 * 1000 }
  }
};
```

## Proposta finale (sintesi)

- Tenere L1 in-memory come default, subito.
- Separare statico/dinamico con TTL diversi e namespace chiave dedicati.
- Usare stale-if-error per resilienza senza servire dati troppo vecchi.
- Preparare interfaccia L2 (DynamoDB) ma attivarla solo quando serve continuita multi-container.
