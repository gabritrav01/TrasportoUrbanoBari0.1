# Trasporto Urbano Bari

Skill Alexa Custom (`it-IT`) per il trasporto urbano di Bari, con backend Node.js in ambiente Alexa-hosted.

## Panoramica

La skill gestisce:

- prossimi arrivi a fermata
- linee e direzioni verso destinazione
- richieste "da qui" / "vicino a me"
- preferiti utente persistiti su DynamoDB

Stato attuale (2026-03-09):

- provider AMTAB reale integrato con flag runtime `TRANSPORT_DATA_MODE=amtab_real`
- feed ufficiali usati: GTFS statico + GTFS-RT TripUpdates
- scheduled derivato da `stop_times + trips + calendar/calendar_dates`
- fallback controllato su catalogo stub con provenance prudente (mai promotion implicita a `official`)
- Moovit fallback disabilitato di default (`MOOVIT_FALLBACK_ENABLED=false`)
- geocoding ancora stub (centro Bari) in attesa provider reale

## Struttura repository

```text
.
|-- lambda/
|   |-- index.js                    # entrypoint obbligatorio Alexa-hosted
|   |-- package.json
|   |-- config/
|   |-- handlers/
|   |-- repositories/
|   |-- resolvers/
|   |-- services/
|   |   `-- providers/
|   |-- tests/
|   `-- utils/
|-- skill-package/
|   |-- skill.json
|   `-- interactionModels/
|       `-- custom/
|           `-- it-IT.json
|-- docs/
|-- .env.example
|-- .gitignore
|-- CONTRIBUTING.md
|-- LICENSE
|-- README.md
`-- SECURITY.md
```

## Import skill nella Alexa Developer Console

1. Pubblica il repository su GitHub come repository pubblico.
2. Apri Alexa Developer Console e crea una nuova skill Custom.
3. Seleziona **Import skill**.
4. Inserisci URL repository, branch e percorso root del progetto.
5. Verifica che nella root siano presenti entrambe le cartelle richieste:
- `skill-package/`
- `lambda/` (con `lambda/index.js` come entrypoint)
6. Completa l import e apri il modello linguistico `it-IT`.
7. Esegui **Build Model** e testa dal tab **Test**.

Se la console non trova i file richiesti, controlla struttura e branch selezionato.

## Sviluppo locale

Prerequisiti:

- Node.js 18 LTS
- npm

Setup:

```powershell
cd lambda
npm ci
```

Comandi principali:

```powershell
cd lambda
npm run lint
npm test
npm run test:integration:amtab-real
npm run smoke:amtab-real
```

## Configurazione ambiente

Riferimento: `.env.example`

Variabili principali:

- `TRANSPORT_DATA_MODE=stub|amtab_real`
- `MOOVIT_FALLBACK_ENABLED=false` (default raccomandato)
- `AMTAB_REAL_STOPS_FEED_URL`
- `AMTAB_REAL_TRIP_UPDATES_URL`
- `AMTAB_REAL_GATEWAY_TIMEOUT_MS`
- `DYNAMODB_PERSISTENCE_TABLE_NAME`

Nota: il progetto non carica automaticamente `.env`; usa variabili di shell o configurazione runtime.

## Deploy e test funzionali

1. Esegui lint e test in locale.
2. Commit e push sul branch collegato.
3. In Alexa Developer Console sincronizza il codice dal repository.
4. Esegui deploy Lambda dal tab **Code**.
5. Ricostruisci il modello `it-IT` se hai cambiato interaction model.
6. Verifica utterance e risposte nel tab **Test**.

## Stato integrazione dati

Completato:

- gateway reale AMTAB (`amtabRealGateway`)
- parsing GTFS statico (`stops`, `routes`, `trips`, `stop_times`, `calendar`, `calendar_dates`)
- parsing GTFS-RT TripUpdates
- mapping shape normalizzate (`Stop`, `Line`, `Arrival`)
- scoring affidabilita e provenance guardrail
- fallback controllato a stub + cache/resilienza
- suite smoke e integrazione provider reale

Ancora aperto:

- geocoding reale (`lambda/services/geocodingService.js`)
- eventuale supporto GTFS-RT protobuf/VehiclePosition
- validazione legale/rate-limit operativi AMTAB

## Documentazione tecnica

Indice aggiornato in [docs/README.md](docs/README.md).

## Limiti repository pubblico

- Non committare segreti (API key/token solo via env).
- Mantenere struttura Alexa-hosted (`skill-package/` + `lambda/`).
- Mantenere `lambda/index.js` come entrypoint Lambda.
- Usare solo integrazioni distribuibili pubblicamente e coerenti con termini d uso.
