# Contributing

Grazie per voler contribuire a Trasporto Urbano Bari.

## Prerequisiti

- Node.js 18 LTS (o superiore a 16)
- npm
- account Alexa Developer (per test end-to-end)

## Setup locale

```powershell
cd lambda
npm ci
npm run lint
npm test
```

## Workflow consigliato

1. Crea un branch dedicato (`feature/...`, `fix/...`, `docs/...`).
2. Mantieni le modifiche piccole e focalizzate.
3. Aggiorna la documentazione quando cambi struttura, flussi o intent.
4. Esegui sempre `npm run lint` e `npm test` in `lambda/` prima della PR.

## Pull Request checklist

- [ ] Nessun segreto/API key nel diff
- [ ] Test locali eseguiti con esito positivo
- [ ] Documentazione aggiornata (README o note tecniche)
- [ ] Compatibilita Alexa-hosted verificata (`skill-package/`, `lambda/`, `lambda/index.js`)

## Convenzioni tecniche

- Usa JavaScript CommonJS coerente con il progetto.
- Mantieni naming descrittivo e funzioni piccole.
- Evita refactor non richiesti nello stesso commit di una fix funzionale.

## Issue

Per bug o miglioramenti apri una issue con:

1. comportamento atteso
2. comportamento attuale
3. passi per riprodurre
4. eventuali log/errori rilevanti
