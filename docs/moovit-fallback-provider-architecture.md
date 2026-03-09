# Trasporto Urbano Bari - MoovitFallbackProvider (architettura prudente)

Data: 2026-03-09
Stato: riferimento (fallback opzionale)

Obiettivo:
definire un fallback provider opzionale e secondario, mai primario, utile solo quando la fonte AMTAB non produce dati usabili.

## 0) Principi non negoziabili

- Moovit e solo fallback teorico/opzionale.
- Se non esiste una integrazione autorizzata e stabile, il provider resta disattivato.
- No scraping aggressivo: no bypass anti-bot, no estrazione massiva, no reverse engineering invasivo.
- Rispetto esplicito di termini d'uso e limiti legali.

## 1) Condizioni di attivazione

Attivazione solo se tutte le condizioni sono vere:

1. `MOOVIT_FALLBACK_ENABLED=true` (feature flag esplicita, default `false`).
2. Fonte primaria AMTAB assente/non usabile per la richiesta corrente.
3. Policy legale interna OK (`MOOVIT_USAGE_ALLOWED=true` o equivalente).

Trigger tecnici consigliati:

- timeout/retry esauriti su AMTAB.
- circuit breaker AMTAB in stato `OPEN`.
- risposta primaria vuota o scartata da reliability filter.

Regola di precedenza:

- prima AMTAB (realtime -> scheduled)
- poi Moovit fallback
- poi eventuale risposta degradata senza arrivi

## 2) Limiti tecnici e di affidabilita

Limiti attesi:

- schema dati non controllato a priori.
- instabilita endpoint/contratti nel tempo.
- possibile assenza di realtime affidabile.
- rischio di mismatch IDs stop/line rispetto al modello AMTAB.

Limiti operativi consigliati:

- timeout brevi (es. 1.5s-2.5s) e pochi retry.
- no polling frequente.
- cache breve su dati dinamici per ridurre chiamate.
- fallback disabilitabile in runtime.

Valutazione affidabilita:

- confidence base piu bassa della primaria.
- preferire `predictionType=scheduled` o `inferred` se realtime non verificabile.

## 3) Campi minimi che il provider puo fornire

Minimo utile per integrazione con shape normalizzate:

### Stop

- `id`
- `name`
- `source='fallback'`
- `sourceName='moovit_fallback'`
- `confidence`

Opzionali: `aliases`, `coordinates`, `lineIds`.

### Line

- `id`
- `code`
- `source='fallback'`
- `sourceName='moovit_fallback'`
- `confidence`

Opzionali: `destinationName`, `destinationTargetId`, `stopIds`.

### DestinationTarget

- `id`
- `name`
- `source='fallback'`
- `sourceName='moovit_fallback'`
- `confidence`

### Arrival

- `stopId`
- `lineId`
- `destinationName`
- almeno uno tra `etaMinutes`, `predictedEpochMs`, `scheduledEpochMs`
- `predictionType` (`scheduled` o `inferred` di default)
- `asOfEpochMs`
- `source='fallback'`
- `sourceName='moovit_fallback'`
- `confidence`

## 4) Come evitare contaminazione dei dati ufficiali

Regole di isolamento:

- non scrivere dati Moovit nel catalogo AMTAB canonico.
- cache separata per namespace (es. `moovit:*` vs `amtab:*`).
- ID fallback con namespace dedicato (es. prefisso `MOOVIT_` o mapping esplicito).
- niente aggiornamento automatico alias/lookup ufficiali con record fallback.
- niente merge silenzioso con record ufficiali: primary vince sempre se presente.

Regole di consumo:

- fallback usato solo se primary non disponibile o non affidabile.
- nei risultati finali mantenere tracciabilita per record (`source`, `sourceName`, `confidence`).

## 5) Come segnare chiaramente source e confidence

Convenzioni consigliate:

- `source`: sempre `fallback` per record provenienti da Moovit fallback.
- `sourceName`: sempre `moovit_fallback` (o variante stabile di progetto).
- `predictionType`:
  - `realtime` solo se supportato e verificabile.
  - altrimenti `scheduled` o `inferred`.
- `confidence` (range suggerito):
  - `0.55-0.70` dato strutturato coerente
  - `0.40-0.55` dato parziale
  - `<0.40` da scartare (`reliabilityBand=discard`)

Comportamento voce Alexa:

- se risposta include fallback:
  - `caution`: formula prudente breve
  - `degraded`: dichiarare stima meno affidabile

## Sintesi

MoovitFallbackProvider va progettato come componente opzionale, isolato e conservativo:

- attivo solo con flag + policy legale + fallimento primaria
- dato sempre marcato `fallback`
- confidence piu prudente della primaria
- nessuna contaminazione del catalogo ufficiale AMTAB
- nessuna dipendenza da scraping aggressivo
