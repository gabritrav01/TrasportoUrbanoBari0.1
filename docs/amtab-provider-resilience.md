# Trasporto Urbano Bari - Resilienza provider AMTAB

Data: 2026-03-09  
Obiettivo: mantenere la skill utile anche con fonti lente, parziali o non disponibili.

## 1) Linee guida tecniche

## 1.1 Timeout per chiamate remote

Principio:

- timeout aggressivo per realtime (priorita latenza voce).
- timeout piu ampio per scheduled/static.

Valori consigliati:

- realtime: `1400ms`
- scheduled: `2200ms`
- lookup statici (stop/line/destination): `2500ms`

Regola:

- timeout per singola attempt, non infinito.
- budget totale per intent Alexa idealmente entro `~4-5s` lato provider.

## 1.2 Retry policy

Politica minima:

- massimo `2` attempt (1 retry) per realtime.
- massimo `2-3` attempt per scheduled/static.
- backoff esponenziale breve con jitter (gia supportabile con `retryAdapter`).

Retry solo su errori retryable:

- network (`ECONNRESET`, `ENOTFOUND`, ecc.)
- timeout
- HTTP `408/425/429/5xx`

No retry (o retry singolo molto prudente) su:

- `400/401/403/404`
- payload semanticamente invalido non transitorio.

## 1.3 Circuit breaker semplificato

Per categoria endpoint:

- `realtime`
- `scheduled`
- `staticLookup`

Parametri consigliati:

- realtime: open dopo `4` failure consecutive, cooldown `30s`
- scheduled: open dopo `5`, cooldown `45s`
- staticLookup: open dopo `6`, cooldown `60s`

Stati:

- `CLOSED`: traffico normale
- `OPEN`: niente chiamate remote, uso fallback
- `HALF_OPEN`: una probe call; se OK chiude, se KO riapre

## 1.4 Fallback catena dati

Ordine raccomandato per arrivi:

1. ufficiale realtime
2. ufficiale scheduled
3. fonte secondaria (se autorizzata/abilitata)
4. stima locale da headway o cache stale controllata
5. nessun arrivo disponibile (risposta vocale degradata ma utile)

Regola qualità:

- non servire realtime stale oltre soglia (es. `45s`).
- scheduled puo avere finestra stale maggiore (es. `10m`) se fonte down.

## 1.5 Fallback fonte ufficiale -> secondaria

Attivare fallback secondaria solo quando:

- official in timeout/failure ripetuta
- circuit breaker official in stato OPEN
- official restituisce payload vuoto/incompleto oltre soglia consecutiva

Marcare sempre il dato:

- `sourceTier: primary|secondary|local_fallback`
- `degradationReason`

## 1.6 Degradazione elegante risposta vocale Alexa

Pattern consigliato:

- se realtime manca ma scheduled disponibile:
  - "In questo momento i tempi in tempo reale non sono disponibili, ti leggo gli orari programmati."
- se si usa fonte secondaria:
  - "Sto usando una fonte alternativa, i tempi potrebbero variare."
- se destinazione risolta ma arrivi assenti:
  - "Ho trovato la destinazione, ma non vedo passaggi imminenti. Posso dirti le linee utili."
- se nessun dato attendibile:
  - "Al momento non riesco a recuperare passaggi affidabili. Vuoi riprovare tra poco?"

## 2) Helper JS / pseudocodice

Helper disponibile:

- `lambda/services/providers/amtab/resilienceHelpers.js`

Funzioni principali:

- `withTimeout(...)`
- `isRetryableError(...)`
- `createSimpleCircuitBreaker(...)`
- `executeWithResilience(...)`
- `selectBestArrivals(...)`
- `buildVoiceDegradationHint(...)`

Pseudoflusso arrivi resiliente:

```js
async function getStopArrivalsResilient(stopId, lineId) {
  try {
    const realtime = await executeWithResilience({
      operationName: 'arrivals.realtime',
      category: 'realtime',
      timeoutMs: 1400,
      circuitBreaker: cbRealtime,
      retryAdapter,
      executeFn: () => primary.getRealtimePredictions(stopId, lineId)
    });
    if (realtime.length) {
      return { arrivals: realtime, mode: 'realtime', sourceTier: 'primary' };
    }
  } catch (_error) {
    // passa a scheduled
  }

  try {
    const scheduled = await executeWithResilience({
      operationName: 'arrivals.scheduled',
      category: 'scheduled',
      timeoutMs: 2200,
      circuitBreaker: cbScheduled,
      retryAdapter,
      executeFn: () => primary.getScheduledArrivals(stopId, lineId)
    });
    if (scheduled.length) {
      return {
        arrivals: scheduled,
        mode: 'scheduled',
        sourceTier: 'primary',
        voiceHint: buildVoiceDegradationHint({
          reason: 'realtime_unavailable',
          usedPredictionType: 'scheduled'
        })
      };
    }
  } catch (_error) {
    // passa a secondaria
  }

  const secondary = await secondaryProvider.getStopArrivals(stopId);
  if (secondary.length) {
    return {
      arrivals: secondary,
      mode: 'scheduled',
      sourceTier: 'secondary',
      voiceHint: buildVoiceDegradationHint({ reason: 'official_down', sourceTier: 'secondary' })
    };
  }

  return {
    arrivals: [],
    mode: 'none',
    sourceTier: 'local_fallback',
    voiceHint: buildVoiceDegradationHint({ reason: 'degraded_no_arrivals' })
  };
}
```

## 3) Scenari operativi

## Scenario A - Fonte ufficiale lenta

Condizione:

- realtime supera `1400ms`.

Comportamento:

- timeout + eventuale retry rapido.
- se ancora lenta: fallback immediato a scheduled.
- messaggio vocale: realtime momentaneamente non disponibile.

## Scenario B - Fonte ufficiale down

Condizione:

- errori consecutivi, circuito realtime/scheduled in `OPEN`.

Comportamento:

- saltare chiamate official finche circuito aperto.
- usare secondaria o cache stale controllata.
- log/metriche con severita warning/error.

## Scenario C - Risposta incompleta

Condizione:

- destinazione/linea presente ma timestamp mancanti o incoerenti.

Comportamento:

- normalizzatore scarta record invalidi.
- se resta almeno un arrivo valido, rispondere con quelli.
- altrimenti fallback scheduled/secondaria.

## Scenario D - Dati contraddittori

Condizione:

- realtime molto distante da scheduled (drift anomalo) o duplicati conflittuali.

Comportamento:

- deduplica per priorita fonte (`official > public > fallback`) e confidence.
- warning diagnostico.
- se drift oltre soglia critica, preferire scheduled + disclaimer.

## Scenario E - Destinazione trovata ma arrivi mancanti

Condizione:

- resolver destinazione OK, nessun passaggio trovato.

Comportamento:

- risposta utile, non errore secco.
- offrire alternative:
  - linee dirette note
  - fermate vicine
  - invito a riprovare.

Esempio parlato:

- "Ho trovato la destinazione, ma non vedo passaggi imminenti. Posso dirti le linee disponibili."

## 4) Integrazione pratica nel progetto attuale

File rilevanti:

- `lambda/services/providers/amtab/arrivalsDataSource.js`
- `lambda/services/providers/amtab/retryAdapter.js`
- `lambda/services/providers/amtab/resilienceHelpers.js`
- `lambda/services/transportService.js`
- `lambda/utils/formatter.js`

Passi minimi:

1. istanziare circuit breaker distinti per categoria in `amtabProvider`.
2. usare `executeWithResilience` nei metodi remote dei data source.
3. aggiungere `voiceHint`/`degradationReason` nel risultato servizio.
4. far leggere il hint al formatter solo quando presente.
