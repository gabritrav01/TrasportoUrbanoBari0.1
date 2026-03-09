# AMTAB Real Provider Integration Tests

Suite di integrazione per il primo uso del provider reale nel progetto "Trasporto Urbano Bari".

## Copertura

- fetch fermate reali (gateway GTFS statico)
- fetch arrivi reali (gateway GTFS-RT TripUpdates)
- mapping verso shape normalizzate
- scoring affidabilita (campi `confidence`, `reliabilityBand`, `freshness`)
- fallback a stub con provenance corretta
- cache con `stale-if-error` e `in-flight dedupe`
- timeout e retry sui flussi realtime

## Esecuzione

Da `lambda/`:

```bash
npm test -- tests/integration/amtab-real-provider.integration.test.js
```

Suite completa:

```bash
npm test
```

## Note

- I test non dipendono dagli handler Alexa.
- La fonte reale e simulata con fixture locali e mock parziali del layer HTTP (`fetchFn`) per stabilita.
