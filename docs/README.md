# Documentazione Tecnica - Trasporto Urbano Bari

Ultimo aggiornamento: 2026-03-09

## Come leggere questa cartella

- `Corrente`: descrive lo stato implementato nel codice.
- `Riferimento`: linee guida operative ancora valide.
- `Storico`: documento di design/review utile come contesto, ma non autoritativo per lo stato runtime.

## Indice documenti

| Documento | Stato | Uso consigliato |
|---|---|---|
| `amtab-verified-source-contract.md` | Corrente | Contratto tecnico implementabile della fonte AMTAB verificata |
| `amtab-real-gateway.md` | Corrente | Architettura e comportamento del gateway AMTAB reale |
| `provider-normalized-shapes.md` | Corrente | Shape dominio normalizzate e convenzioni di provenance |
| `amtab-reliability-scoring.md` | Corrente | Regole di scoring affidabilita e reliability band |
| `amtab-reliability-scoring-examples.md` | Corrente | Esempi pratici input/output scoring |
| `amtab-caching-strategy.md` | Riferimento | Strategia cache (TTL, stale-if-error, negative cache, dedupe) |
| `amtab-provider-resilience.md` | Riferimento | Timeout, retry, circuit breaker, fallback |
| `amtab-data-sources.md` | Riferimento | Mappa fonti candidate e priorita integrazione |
| `amtab-minimum-data-model.md` | Riferimento | Modello dati minimo per provider reale |
| `arrival-normalizer-module.md` | Corrente | Regole normalizzazione arrivi multi-fonte |
| `amtab-reverse-engineering-checklist.md` | Riferimento | Checklist prudente di analisi tecnica fonte/app |
| `moovit-fallback-provider-architecture.md` | Riferimento | Design fallback Moovit opzionale/non primario |
| `amtab-provider-integration-design.md` | Storico | Design iniziale integrazione provider |
| `amtab-provider-integration-review.md` | Storico | Review fase di integrazione architetturale |

## Nota operativa

Quando trovi discrepanze tra documenti:

1. prevale il codice in `lambda/services/providers/*`;
2. poi prevalgono i documenti marcati `Corrente`;
3. i documenti `Storico` vanno letti come contesto evolutivo.
