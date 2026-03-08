# Security Policy

## Versioni supportate

Il progetto e in fase iniziale. Le patch di sicurezza vengono applicate alla linea attiva:

| Versione | Supporto |
| --- | --- |
| 0.x | Si |
| < 0.1.0 | No |

## Segnalazione vulnerabilita

Non aprire issue pubbliche con dettagli sensibili.

Canale preferito:

1. GitHub Security Advisory privata (tab Security del repository).

Se il canale non e disponibile:

1. Apri una issue minima senza PoC ne dettagli tecnici sensibili.
2. Richiedi un contatto privato ai maintainer.

## Cosa includere nella segnalazione

- componente coinvolto (`lambda/`, `skill-package/`, pipeline)
- impatto stimato
- passi di riproduzione
- eventuale proof-of-concept minima
- workaround temporaneo, se disponibile

## Tempi di gestione

- presa in carico iniziale: entro 5 giorni lavorativi
- valutazione tecnica: entro 10 giorni lavorativi
- rilascio fix: in base alla severita e alla complessita

## Buone pratiche per contributori

- non committare segreti o token reali
- usa solo variabili ambiente per credenziali
- verifica sempre `.gitignore` prima del commit
