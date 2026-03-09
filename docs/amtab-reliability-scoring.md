# AMTAB Bari - Scoring affidabilita fonti dati

Data: 2026-03-09  
Modulo di riferimento: `lambda/services/providers/domain/reliabilityScoring.js`

## Obiettivo

Assegnare a ogni record normalizzato (soprattutto `Arrival`) un livello affidabilita coerente e spiegabile, usando:

- `source`
- `predictionType`
- `freshness`
- `confidence`

L'obiettivo operativo e decidere se:

1. usare subito il dato,
2. usarlo con disclaimer,
3. scartarlo.

## 1) Formula di scoring semplice

Score base (range `0..1`):

```txt
confidenceRaw =
  0.35 * sourceScore +
  0.30 * freshnessScore +
  0.20 * completenessScore +
  0.15 * coherenceScore
```

Pesi:

- `sourceScore` (35%)
- `freshnessScore` (30%)
- `completenessScore` (20%)
- `coherenceScore` (15%)

Guard rail (penalita hard):

- se `completenessScore < 0.40`: `confidence = confidenceRaw * 0.60`
- se `coherenceScore < 0.40`: `confidence = confidence * 0.70`
- per `arrival`, se `freshnessScore < 0.20`: `confidence = confidence * 0.50`

Output finale:

- `confidence` clampata in `0..1`
- `reliabilityBand`: `direct | disclaimer | discard`

## 2) Combinazione delle componenti

## 2.1 Ufficialita della fonte (`sourceScore`)

Mapping:

- `official = 1.00`
- `public = 0.78`
- `fallback = 0.55`

Nota:

- `source` non riconosciuta viene normalizzata a `fallback`.

## 2.2 Eta del dato (`freshnessScore`)

Campo output:

```json
{
  "freshness": {
    "ageSec": 18,
    "freshnessScore": 0.97,
    "bucket": "fresh"
  }
}
```

Profili consigliati:

- `arrival/realtime`: fresh <= 20s, stale >= 180s
- `arrival/scheduled`: fresh <= 120s, stale >= 1800s
- `arrival/inferred`: fresh <= 60s, stale >= 900s
- `stop/line`: fresh <= 12h, stale >= 48h
- `destination`: fresh <= 24h, stale >= 72h

Funzione:

- decadimento lineare da `1` (fresh) a `0` (stale threshold).

## 2.3 Completezza record (`completenessScore`)

Valuta presenza campi minimi + campi utili.

Esempio `Arrival`:

- required: `stopId`, `lineId`
- optional pesati: `destinationName`, `etaMinutes`, `scheduledEpochMs`, `predictedEpochMs`, `asOfEpochMs`

Formula:

```txt
completenessScore = 0.70 * requiredRatio + 0.30 * optionalRatio
```

## 2.4 Coerenza rispetto ad altri dati (`coherenceScore`)

Per `Arrival`, penalizzare:

- `predictionType=realtime` ma `predictedEpochMs` assente
- `predictionType=scheduled` ma `scheduledEpochMs` assente
- drift forte tra `etaMinutes` e timestamp derivati
- contraddizioni cross-source

Bonus lieve:

- consenso cross-source (>=2 fonti coerenti).

## 3) Soglie consigliate

- `confidence >= 0.80` -> `direct`
  - dato usabile direttamente.
- `0.60 <= confidence < 0.80` -> `disclaimer`
  - dato usabile con avviso.
- `< 0.60` -> `discard`
  - dato scartato dal parlato (eventualmente loggato).

## 4) Reazione del formatter Alexa

Regole pratiche:

## Band `direct`

- risposta standard, nessun disclaimer.

Esempio:

- "Linea 2 barra per Policlinico tra 4 minuti."

## Band `disclaimer`

- risposta con prefisso/suffisso breve.

Esempi:

- "I tempi potrebbero variare leggermente. Linea 2 barra per Policlinico tra 7 minuti."
- "Ti do la migliore stima disponibile in questo momento."

## Band `discard`

- non leggere il tempo.
- se restano altri arrivi validi, usare solo quelli.
- se tutti scartati:
  - degradare a informazione utile non temporale (linee, fermate, invito a riprovare).

Esempio:

- "Al momento non ho tempi abbastanza affidabili. Posso dirti le linee disponibili per la destinazione."

## 5) Esempi concreti (con calcolo)

## Caso A - Ufficiale realtime fresco e completo

- `sourceScore=1.00`
- `freshnessScore=0.95`
- `completenessScore=0.95`
- `coherenceScore=0.90`

```txt
confidenceRaw = 0.35*1.00 + 0.30*0.95 + 0.20*0.95 + 0.15*0.90
              = 0.96
band = direct
```

## Caso B - Ufficiale scheduled, dato in aging

- `sourceScore=1.00`
- `freshnessScore=0.55`
- `completenessScore=0.65`
- `coherenceScore=0.75`

```txt
confidenceRaw = 0.7575
band = disclaimer
```

## Caso C - Public realtime stale e contraddittorio

- `sourceScore=0.78`
- `freshnessScore=0.15`
- `completenessScore=0.80`
- `coherenceScore=0.35`

```txt
confidenceRaw = 0.5305
hard penalty coherence<0.40 => 0.5305 * 0.70 = 0.3713
hard penalty freshness<0.20 (arrival) => 0.3713 * 0.50 = 0.1856
band = discard
```

## Caso D - Fallback scheduled ma coerente

- `sourceScore=0.55`
- `freshnessScore=0.90`
- `completenessScore=0.85`
- `coherenceScore=0.80`

```txt
confidenceRaw = 0.7525
band = disclaimer
```

## Caso E - Destinazione trovata ma arrivi mancanti

Situazione:

- `DestinationTarget` confidence alta (`>=0.85`)
- tutti `Arrival` scartati (`band=discard`)

Comportamento:

- non dare tempi.
- proporre output alternativo: linee candidate + richiesta retry.

Esempio parlato:

- "Ho trovato la destinazione, ma non vedo passaggi affidabili ora. Vuoi le linee disponibili?"

## 6) Integrazione minima consigliata

1. Applicare `scoreRecordReliability(...)` agli arrivi prima del formatter.
2. Filtrare `discard`.
3. Se presenti `disclaimer`, aggiungere `buildAlexaReliabilityHint(...)` alla risposta.
4. Loggare breakdown punteggi per tuning continuo.
