# Provider Data Tests (Jest)

Questa cartella contiene una suite Jest per il provider dati AMTAB.

## Copertura principale

- normalizzazione fermate
- normalizzazione arrivi
- deduplica arrivi
- fallback realtime -> scheduled
- scoring affidabilita
- gestione errori/timeout e resilience helpers

## Esecuzione locale

1. Installa dipendenze nella cartella `lambda/`:

```bash
npm install
```

2. Esegui tutti i test:

```bash
npm test
```

3. Esegui un singolo file:

```bash
npm test -- tests/providers/arrivals-data-source.test.js
```