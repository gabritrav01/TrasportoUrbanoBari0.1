# AMTAB Bari - Scoring affidabilita

Data aggiornamento: 2026-03-09  
Modulo sorgente: `lambda/services/providers/domain/reliabilityScoring.js` + `qualityScoring.js`  
Stato: corrente

## Obiettivo

Assegnare a ogni record normalizzato (`Arrival`, `Stop`, `Line`, `ProviderResult`) una qualita coerente usando:

- `source` (`official|public|fallback`)
- `predictionType` (`realtime|scheduled|inferred`)
- `freshness`
- `confidence`
- `reliabilityBand` (`direct|caution|degraded|discard`)

## Formula base

```txt
confidenceRaw =
  0.35 * sourceScore +
  0.30 * freshnessScore +
  0.20 * completenessScore +
  0.15 * coherenceScore
```

Pesi:

- source: `0.35`
- freshness: `0.30`
- completeness: `0.20`
- coherence: `0.15`

## Source score

- `official = 1.00`
- `public = 0.78`
- `fallback = 0.55`

## Freshness profiles principali

- `arrival/realtime`: fresh <= 20s, stale >= 180s
- `arrival/scheduled`: fresh <= 120s, stale >= 1800s
- `arrival/inferred`: fresh <= 60s, stale >= 900s
- `stop/line`: fresh <= 12h, stale >= 48h

## Guard rail hard

- `completenessScore < 0.40` -> penalita forte
- `coherenceScore < 0.40` -> penalita forte
- `arrival` con `freshnessScore < 0.20` -> penalita forte

## Soglie default band

Valori da `qualityScoring.DEFAULT_THRESHOLDS`:

- `direct >= 0.82`
- `caution >= 0.62`
- `degraded >= 0.45`
- `< 0.45 => discard`

## Policy applicata dopo la classificazione

Regole rilevanti:

- `predictionType=inferred` non puo risultare migliore di `degraded`
- `source!=official` non puo restare `direct`
- `scheduled` non e `direct` salvo policy esplicita (`allowScheduledDirect=true`)
- bassa freshness o bassa completezza degradano/scartano

## Impatto su risposta Alexa

- `direct`: risposta normale
- `caution`: formula prudente breve
- `degraded`: esplicitare che e una stima meno affidabile
- `discard`: non leggere il record come risultato principale

## Riferimenti codice

- scoring record: `scoreRecordReliability(...)`
- scoring provider result: `scoreProviderResultQuality(...)`
- hint voce: `buildAlexaReliabilityHint(...)`

