# Trasporto Urbano Bari - Review integrazione nuovo design provider AMTAB

Data: 2026-03-09  
Obiettivo: integrare il design modulare AMTAB senza rompere intent/handler Alexa esistenti.

## 1) Elenco file modificati

## Runtime policy e wiring

- `lambda/config/providerRuntimePolicy.js` (nuovo)
- `lambda/services/transitService.js`
- `lambda/services/providers/amtabProvider.js`

## Data source / dominio

- `lambda/services/providers/amtab/stopDataSource.js`
- `lambda/services/providers/amtab/linesDataSource.js`
- `lambda/services/providers/amtab/destinationResolverAdapter.js`
- `lambda/services/providers/amtab/arrivalsDataSource.js`
- `lambda/services/providers/domain/reliabilityScoring.js`

## Servizi e formatter (compatibili con handler esistenti)

- `lambda/services/transportService.js`
- `lambda/utils/formatter.js`
- `lambda/services/providers/amtab/index.js`

## 2) Patch architetturali applicate (consigliate e ora operative)

## A) Policy centralizzata

Introdotta `providerRuntimePolicy` con:

- cache TTL per statico/dinamico
- timeout e circuit breaker policy
- soglie reliability (`direct/disclaimer`)

Beneficio:

- niente TTL hardcoded sparsi, tuning piu semplice.

## B) Provider AMTAB policy-driven

`createAmtabProvider(...)` ora riceve e propaga:

- `cachePolicy`
- `resiliencePolicy`
- `reliabilityPolicy`
- `defaultSource`
- `defaultSourceName`

Beneficio:

- passaggio da mock a dati reali con minima modifica di configurazione.

## C) Arrivals pipeline completa

In `arrivalsDataSource`:

1. chiamata remota resiliente (`executeWithResilience`)
2. normalizzazione (`arrivalNormalizer`)
3. scoring affidabilita (`filterRecordsByReliability`)
4. filtro low-confidence (`discard`)
5. deduplica arrivi e sort

Beneficio:

- output piu stabile e robusto in condizioni reali.

## D) Compatibilita con intent/handler

Nessuna modifica a intent/handler Alexa.

Aggiornamenti non breaking:

- `transportService` propaga `reliabilityBand` nei blocchi arrivi
- `formatter` aggiunge disclaimer solo quando necessario

## 3) Interfacce aggiornate

## `createAmtabProvider(options)` (estesa)

Nuove option supportate:

- `cachePolicy`
- `resiliencePolicy`
- `reliabilityPolicy`
- `defaultSource`
- `defaultSourceName`

## Data source option (estese)

- `stopDataSource`: `searchTtlMs`, `nearestTtlMs`
- `linesDataSource`: `searchTtlMs`, `byStopTtlMs`
- `destinationResolverAdapter`: `resolveTtlMs`
- `arrivalsDataSource`: TTL dinamici + policy resilienza + policy affidabilita

## Shape arrivi in output (compatibile + arricchita)

Campi aggiuntivi utili:

- `freshness`
- `reliabilityBand`
- `scoreBreakdown`
- `coherenceReasons`

Campi storici (`lineId`, `destinationName`, `etaMinutes`, ecc.) restano invariati.

## 4) Wiring in `lambda/index.js`

Non necessario.

Motivo:

- `lambda/index.js` usa gia `createSkillHandler()` e il wiring provider avviene in `transitService`.
- le patch sono state inserite nel punto corretto (`createTransitService`), senza toccare bootstrap Alexa.

## 5) TODO prioritizzati per primi test reali

## P0 - pronto test reale minimo

1. Collegare hook reali AMTAB in `apiClient` (stop/line/destination/arrivals).
2. Aggiungere fixture reali (JSON) e test integrazione su `arrivalsDataSource`.
3. Validare fallback chain:
   - realtime ufficiale
   - scheduled ufficiale
   - fallback secondario

## P1 - robustezza operativa

1. Estendere circuit breaker anche a stop/line/destination data source.
2. Aggiungere metriche:
   - timeout rate
   - retry count
   - percentuale disclaimer/discard
3. Uniformare logger strutturato (requestId, stopId, lineId, sourceTier).

## P2 - quality e scala

1. Introdurre L2 cache persistente (DynamoDB) per statico e fallback scheduled.
2. Aggiungere test end-to-end sui principali intent Alexa con dati semireali.
3. Introdurre feature flag per rollout graduale fonte ufficiale.

## Stato attuale

Integrazione architetturale effettuata senza rompere l'architettura esistente:

- intent/handler invariati
- provider reso configurabile e resiliente
- pipeline arrivi pronta a passare da mock a dati veri con patch minime.
