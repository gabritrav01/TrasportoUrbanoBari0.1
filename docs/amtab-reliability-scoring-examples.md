# AMTAB Reliability Scoring - Esempi

Data aggiornamento: 2026-03-09  
Stato: corrente

## 1) Official realtime fresco -> `direct`

Input:

```json
{
  "stopId": "STOP_100",
  "lineId": "1",
  "source": "official",
  "sourceName": "amtab_gtfs_rt_tripupdates",
  "predictionType": "realtime",
  "confidence": 0.92,
  "freshness": { "ageSec": 5, "freshnessScore": 0.96, "bucket": "fresh" }
}
```

Output atteso:

```json
{
  "reliabilityBand": "direct",
  "confidence": 0.92
}
```

## 2) Official scheduled -> `caution` (policy prudente default)

Input:

```json
{
  "stopId": "STOP_200",
  "lineId": "2",
  "source": "official",
  "sourceName": "amtab_gtfs_static",
  "predictionType": "scheduled",
  "confidence": 0.9,
  "freshness": { "ageSec": 120, "freshnessScore": 0.75, "bucket": "aging" }
}
```

Output atteso:

```json
{
  "reliabilityBand": "caution",
  "confidence": 0.9
}
```

## 3) Fallback inferred/headway -> `degraded`

Input:

```json
{
  "stopId": "STOP_300",
  "lineId": "3",
  "source": "fallback",
  "sourceName": "amtab_primary:headway_inferred",
  "predictionType": "inferred",
  "confidence": 0.55,
  "freshness": { "ageSec": 80, "freshnessScore": 0.45, "bucket": "aging" }
}
```

Output atteso:

```json
{
  "reliabilityBand": "degraded",
  "confidence": 0.55
}
```

## 4) Dato vecchio o incompleto -> `discard`

Input:

```json
{
  "stopId": "STOP_400",
  "lineId": "4",
  "source": "fallback",
  "sourceName": "amtab_fallback",
  "predictionType": "realtime",
  "confidence": 0.35,
  "freshness": { "ageSec": 800, "freshnessScore": 0.05, "bucket": "stale" }
}
```

Output atteso:

```json
{
  "reliabilityBand": "discard",
  "confidence": 0.35
}
```

## 5) Guardrail provenance: `inferred` mai `official`

Input:

```json
{
  "predictionType": "inferred",
  "source": "official"
}
```

Output atteso:

```json
{
  "predictionType": "inferred",
  "source": "public"
}
```

