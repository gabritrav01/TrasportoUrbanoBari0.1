# Trasporto Urbano Bari - Fonti dati AMTAB

Data analisi: 2026-03-09 (timezone Europe/Rome)

## Obiettivo del report

Identificare tutte le fonti candidate per:

- fermate
- linee
- arrivi per fermata
- destinazioni/capolinea
- dati real-time o programmati

Vincolo applicato: nessun endpoint inventato. Ogni endpoint riportato sotto e stato trovato su pagine ufficiali o in documentazione pubblica collegata.

## Criteri di classificazione

- Ufficiale: sorgente AMTAB o canale dichiarato da AMTAB.
- Probabile: sorgente non primaria ma collegata da canali ufficiali o chiaramente usata nel servizio.
- Ipotetica: sorgente plausibile ma non confermata con documentazione tecnica diretta.

## Fonti candidate

### S1) Portale AMTAB "OpenMobilityData" (hub ufficiale)

- Classe: Ufficiale
- URL: https://www.amtab.bari.it/it/openmobilitydata
- Cosa potrebbe offrire: link canonical a GTFS statico, GTFS-Realtime, documentazione tecnica e strumenti correlati.
- Vantaggi: punto unico ufficiale; facile monitoraggio delle variazioni URL.
- Limiti: pagina indice, non e il feed dati in se.
- Rischio di instabilita: Medio (eventuali cambi CMS/path).
- Rischio legale/ToS: Basso-Medio (fonte ufficiale, ma licenza non esplicitata in pagina).
- Priorita di utilizzo: 1

### S2) GTFS statico AMTAB

- Classe: Ufficiale
- URL: https://www.amtabservizio.it/gtfs/google_transit.zip (linkato da OpenMobilityData)
- Cosa potrebbe offrire: fermate, linee, corse, stop_times, calendario servizio, shapes, transfer.
- Verifica tecnica eseguita: download riuscito; archivio valido con file standard GTFS.
- Evidenza sintetica: stops=1114, routes=66, trips=4818, stop_times=161178, calendar_dates=730.
- Vantaggi: formato standard, adatto a bootstrap completo del dominio trasporto.
- Limiti: dato programmato, non realtime; serve refresh periodico.
- Rischio di instabilita: Basso-Medio (URL abbastanza stabile ma non versionato).
- Rischio legale/ToS: Medio (non e chiarita una licenza open esplicita nel feed).
- Priorita di utilizzo: 1

### S3) GTFS-Realtime AMTAB (VehiclePosition, TripUpdates)

- Classe: Ufficiale
- URL: https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/VechiclePosition
- URL: https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates
- Cosa potrebbe offrire: stato mezzi in tempo reale e aggiornamenti viaggio (ETA/deviation se valorizzati).
- Verifica tecnica eseguita: endpoint raggiungibili in GET (HTTP 200), payload JSON con Header GTFS-RT e `Entities`.
- Nota osservata: alle 2026-03-08 23:47:15Z il payload era con `Entities: []` (probabile fascia bassa operativita/notturna o feed temporaneamente vuoto).
- Vantaggi: realtime ufficiale, integrabile con stop/route/trip GTFS statico.
- Limiti: possibile feed vuoto in alcune fasce; naming endpoint contiene typo (`VechiclePosition`).
- Rischio di instabilita: Medio (struttura sembra stabile, ma comportamento dati realtime variabile).
- Rischio legale/ToS: Medio (canale ufficiale, ma policy d'uso non chiaramente pubblicata).
- Priorita di utilizzo: 1

### S4) Documento tecnico GTFS-Realtime AMTAB

- Classe: Ufficiale
- URL: https://www.amtab.it/images/Servizio_Export_GTFS.pdf
- Cosa potrebbe offrire: parametri query supportati (`vehicleID`, `lineCode`, `lineid`) e semantica minima endpoint.
- Vantaggi: guida tecnica di riferimento lato provider.
- Limiti: documento storico, potenzialmente non allineato al comportamento attuale (es. output oggi JSON).
- Rischio di instabilita: Medio-Alto (drift tra doc e implementazione).
- Rischio legale/ToS: Basso-Medio.
- Priorita di utilizzo: 1

### S5) Pagina AMTAB "Linee e Orari"

- Classe: Ufficiale
- URL: https://www.amtab.it/it/linee-e-orari/
- Cosa potrebbe offrire: elenco linee lato utente, link a strumenti orari esterni (MUVT/orari).
- Vantaggi: valido cross-check funzionale per linee/capolinea esposti al pubblico.
- Limiti: fonte web human-facing, non ottimale come API machine-to-machine.
- Rischio di instabilita: Medio.
- Rischio legale/ToS: Basso-Medio.
- Priorita di utilizzo: 2

### S6) MUVT "Orari AMTAB" + PDF libretti linea

- Classe: Probabile (fortemente collegata ai canali ufficiali)
- URL base: https://www.muvt.app/en/orari-amtab/?lineid=01
- Esempi PDF emersi dalla pagina: `https://muvt.app/libretto/01-Bari Centrale - Santo Spirito .pdf` e analoghi per altre linee.
- Cosa potrebbe offrire: orari programmati per linea, capolinea, fermate intermedie e tabelle statiche.
- Vantaggi: utile fallback se GTFS statico temporaneamente indisponibile o per QA comparativo.
- Limiti: formato PDF non ideale; parsing fragile; naming file non sempre pulito.
- Rischio di instabilita: Alto (HTML/PDF possono cambiare senza preavviso).
- Rischio legale/ToS: Medio-Alto (scraping massivo da evitare senza conferma termini).
- Priorita di utilizzo: 2 (solo fallback/QA, non primaria)

### S7) Planner ro.autobus.it collegato da AMTAB

- Classe: Probabile
- URL: https://ro.autobus.it/TP/amtab/lines.aspx (linkato da OpenMobilityData)
- Cosa potrebbe offrire: viste linee/fermate e planning lato utente.
- Vantaggi: possibile fonte di verifica comparativa sui percorsi pubblicati.
- Limiti: non documentata come API pubblica; struttura web proprietaria.
- Rischio di instabilita: Alto.
- Rischio legale/ToS: Alto (terza parte; forte rischio su scraping/API non documentata).
- Priorita di utilizzo: 3 (solo verifica manuale)

### S8) QR/NFC di fermata (se presenti sul territorio)

- Classe: Ipotetica
- URL di riferimento generale servizio: https://www.muvt.app/en/transportation-app/
- Cosa potrebbe offrire: deep-link a pagina fermata o identificativo stop per query rapida.
- Vantaggi: utile per risoluzione immediata fermata reale (stop_id contestuale).
- Limiti: non abbiamo endpoint ufficiale documentato pubblico per questo canale.
- Rischio di instabilita: Alto.
- Rischio legale/ToS: Medio-Alto.
- Priorita di utilizzo: 3 (esplorativa, solo previa validazione legale)

### S9) Open data esterni (Comune/Regione/portali terzi)

- Classe: Ipotetica
- URL candidato (esplorativo): https://www.dati.puglia.it/group/trasporti
- Cosa potrebbe offrire: dataset ausiliari geospaziali o metadati mobilita.
- Vantaggi: puo integrare controlli di qualita o arricchimento geografico.
- Limiti: al momento nessuna evidenza forte di feed AMTAB completo equivalente a GTFS ufficiale.
- Rischio di instabilita: Medio-Alto.
- Rischio legale/ToS: Variabile (dipende dalla licenza dataset specifico).
- Priorita di utilizzo: 3

### S10) Moovit (ultima risorsa)

- Classe: Probabile/Ipotetica per integrazione tecnica diretta
- URL evidenza partnership locale: https://static-main.moovit.com/wp-content/uploads/2021/11/11105131/2021_11_11-Moovit_arriva_a_Bari.pdf
- Cosa potrebbe offrire: dati orari e realtime aggregati lato app.
- Vantaggi: copertura ampia e UX consolidata.
- Limiti: API non pubblica standard per uso libero; dipendenza da terza parte e contratti.
- Rischio di instabilita: Alto (policy/prodotto esterno).
- Rischio legale/ToS: Alto (uso dati soggetto a accordi commerciali/licenze).
- Priorita di utilizzo: 4 (solo se canali ufficiali non bastano e con autorizzazione formale)

## Conclusione: strategia consigliata per Versione 1

Strategia V1 raccomandata: **GTFS statico ufficiale + GTFS-RT ufficiale**, con fallback controllato.

1. Usare S2 (GTFS statico) come base canonica per stop/linee/trips/capolinea.
2. Usare S3 (GTFS-RT) per realtime quando disponibile; se `Entities` e vuoto o dato stale, fallback a programmato da GTFS statico.
3. Usare S5/S6 solo per QA e fallback manuale (non come pipeline principale).
4. Escludere Moovit dalla V1 operativa (S10) salvo accordo legale esplicito.

Mappatura diretta nel codice attuale:

- provider primario da implementare in [lambda/services/providers/amtabProvider.js](../lambda/services/providers/amtabProvider.js)
- config endpoint/env in [lambda/services/transitService.js](../lambda/services/transitService.js) e [.env.example](../.env.example)
- eliminazione progressiva dati stub in [lambda/services/providers/stubCatalog.js](../lambda/services/providers/stubCatalog.js)

## Piano operativo di verifica tecnica (step-by-step)

### Fase A - Verifica sorgenti e policy

1. Confermare per iscritto con AMTAB permesso d'uso dei feed in una skill pubblica e limiti di rate.
2. Registrare in `docs/` URL ufficiali canonical (S1-S4) e responsabile contatto tecnico.
3. Definire policy fallback: quando realtime manca, quando mostrare dato programmato.

### Fase B - Pipeline dati statici GTFS

1. Job schedulato (es. 1 volta/giorno) che scarica `google_transit.zip`.
2. Validazione file richiesti (`stops`, `routes`, `trips`, `stop_times`, `calendar_dates`).
3. Parsing e normalizzazione in storage applicativo (anche cache locale + snapshot versionato).
4. Generazione indici rapidi per ricerca fermata/linea/destinazione.
5. Test regressione su cardinalita minime (es. route_count > 0, stop_count > 1000).

### Fase C - Pipeline realtime GTFS-RT

1. Poll endpoint VehiclePosition/TripUpdates con intervallo prudente (es. 20-30s).
2. Monitorare `timestamp` feed e tasso di `Entities` vuote su varie fasce orarie.
3. Join realtime->statico via chiavi GTFS (`trip_id`, `route_id`, `stop_id` quando presenti).
4. Definire SLA interno: se feed stale oltre soglia (es. >120s) degradare a programmato.
5. Loggare metriche: success rate, latency, freshness, percentuale fallback.

### Fase D - Integrazione nel progetto Alexa

1. Implementare `getRealtimePredictions` in `amtabProvider` usando S3.
2. Sostituire gradualmente `stubCatalog` con dati da ingest GTFS.
3. Aggiornare resolver stop/line/destination per usare ID GTFS reali.
4. Aggiungere test automatici su mapping arrivi per fermata e linee verso destinazione.
5. Tenere `moovitFallbackProvider` disabilitato in V1, abilitabile solo con flag e autorizzazione.

### Fase E - Hardening e go-live

1. Alerting su downtime endpoint GTFS/GTFS-RT.
2. Circuit breaker su provider realtime.
3. Cache temporale per ridurre chiamate ripetute.
4. Runbook operativo (guasto feed, feed vuoto, mismatch statico/realtime).
5. Revisione legale finale prima pubblicazione skill.

## Decisione pratica per partire subito

- Avviare immediatamente S2 + S3 (priorita 1).
- Usare S6 solo per verifica umana dei risultati in fase di tuning.
- Tenere S10 (Moovit) fuori dallo scope V1.
