# Trasporto Urbano Bari - Review integrazione provider AMTAB

Data aggiornamento: 2026-03-09  
Stato: storico (fase integrazione architetturale completata)

## Scopo del documento

Questo file mantiene una vista sintetica della fase di integrazione architetturale gia eseguita, senza duplicare i dettagli implementativi correnti.

Per lo stato operativo aggiornato usare:

- `docs/amtab-real-gateway.md`
- `docs/amtab-verified-source-contract.md`
- `docs/provider-normalized-shapes.md`

## Esito fase integrazione

Completato:

- wiring runtime `TRANSPORT_DATA_MODE=stub|amtab_real`
- gateway reale AMTAB collegato al provider senza modificare handler Alexa
- pipeline dati con normalizzazione + scoring affidabilita + provenance coerente
- fallback controllato a catalogo stub
- Moovit disabilitato di default

Completato in seguito:

- scheduled statico da `stop_times + trips + calendar/calendar_dates`
- smoke e integration test dedicati provider reale
- guardrail runtime: nessun record `inferred` resta `official`

## Rischi residui (attuali)

- policy legale/rate-limit AMTAB da formalizzare
- supporto protobuf GTFS-RT eventuale (oggi parser JSON)
- monitoraggio operativo avanzato (feed stale, drift, alerting)

## Nota

Il contenuto di questo file e mantenuto come contesto evolutivo.  
Per decisioni implementative correnti, prevale la documentazione marcata `Corrente` in `docs/README.md`.

