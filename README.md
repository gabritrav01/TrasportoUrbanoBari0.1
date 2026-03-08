# Trasporto Urbano Bari

Skill Alexa Custom (`it-IT`) per il trasporto urbano di Bari, con backend Node.js in ambiente Alexa-hosted.

## Panoramica

Il progetto fornisce una skill vocale che gestisce:

- prossimi arrivi a fermata
- linee verso una destinazione
- richieste "da qui" / "vicino a me"
- preferiti utente persistiti su DynamoDB
- risposta "breve" o "completa"
- gestione delle ambiguita con chiarimento

Lo stato attuale e pensato per sviluppo e validazione: il catalogo trasporti e la geocodifica sono in parte stub e pronti per integrazione con sorgenti AMTAB reali.

## Struttura cartelle

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
|   `-- utils/
|-- skill-package/
|   |-- skill.json
|   `-- interactionModels/
|       `-- custom/
|           `-- it-IT.json
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
7. Esegui **Build Model** e poi testa dal tab **Test**.

Se la console non trova i file richiesti, controlla prima la struttura cartelle e il branch selezionato.

## Sviluppo locale

Prerequisiti:

- Node.js 18 LTS (compatibile con `engines.node >=16`)
- npm

Setup:

```powershell
cd lambda
npm ci
```

Test locali:

```powershell
cd lambda
npm run lint
npm test
```

Variabili ambiente:

- Usa `.env.example` come riferimento.
- In locale imposta le variabili nel terminale o nel runner (questo progetto non carica automaticamente `.env`).

Esempio PowerShell:

```powershell
$env:AMTAB_API_BASE_URL="https://api.example"
$env:AMTAB_API_KEY="replace_me"
$env:MOOVIT_API_BASE_URL="https://api.example"
$env:MOOVIT_API_KEY="replace_me"
$env:DYNAMODB_PERSISTENCE_TABLE_NAME="TrasportoUrbanoBariSkillTable"
```

## Deploy e test funzionali

Per una skill Alexa-hosted importata da Git:

1. Esegui lint/test in locale.
2. Commit e push su branch collegato.
3. Nella Alexa Developer Console sincronizza il codice dal repository.
4. Esegui deploy del codice Lambda dal tab **Code**.
5. Ricostruisci il modello `it-IT` se hai modificato interaction model.
6. Verifica gli utterance nel tab **Test**.

## Come adattare i dati AMTAB reali

Punti principali da completare:

1. `lambda/services/providers/stubCatalog.js`
- sostituire stop/linee/destinazioni stub con dati ufficiali e mapping ID stabili.
2. `lambda/services/providers/amtabProvider.js`
- implementare chiamate realtime e mapping payload nel metodo `getRealtimePredictions`.
- implementare healthcheck reale nel metodo `ping`.
3. `lambda/services/providers/moovitFallbackProvider.js`
- integrare fallback reale solo se autorizzato contrattualmente.
4. `lambda/services/geocodingService.js`
- sostituire geocodifica stub con provider reale (gestione timeout, retry, quote, cache).
5. `skill-package/skill.json`
- sostituire URL placeholder (icone, privacy, termini) con URL validi di produzione.

## Limiti e vincoli del repository pubblico

- Non committare segreti: token/API key solo tramite environment variables.
- Mantenere la struttura Alexa-hosted corretta (`skill-package/` + `lambda/`).
- Mantenere `lambda/index.js` come entrypoint Lambda.
- Trattandosi di repo pubblico, usare solo dati e integrazioni distribuibili pubblicamente.

## Roadmap Versione 1

1. Integrazione realtime AMTAB in produzione.
2. Geocodifica reale per flussi "da qui/vicino a me".
3. Miglioramento copertura test (unit + integrazione).
4. Hardening error handling e telemetria operativa.
5. Revisione NLP it-IT con utterance reali e riduzione ambiguita.
