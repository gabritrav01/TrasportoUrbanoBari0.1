# AMTAB Reliability Scoring - Esempi Input/Output

## 1) Official realtime fresco -> `direct`

Input (arrival):

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

Output qualità:

```json
{
  "reliabilityBand": "direct",
  "confidence": 0.92,
  "freshness": { "ageSec": 5, "freshnessScore": 0.96, "bucket": "fresh" }
}
```

## 2) Official scheduled -> `caution` (policy default)

Input (arrival):

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

Output qualità:

```json
{
  "reliabilityBand": "caution",
  "confidence": 0.9
}
```

## 3) Inferred/headway fallback -> `degraded`

Input (arrival):

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

Output qualità:

```json
{
  "reliabilityBand": "degraded",
  "confidence": 0.55
}
```

## 4) ProviderResult vuoto o incompleto -> non `direct`

Input (provider result):

```json
{
  "ok": true,
  "source": "official",
  "predictionType": "realtime",
  "confidence": 0.95,
  "data": []
}
```

Output qualità:

```json
{
  "source": "official",
  "predictionType": "realtime",
  "confidence": 0.95,
  "freshness": { "ageSec": null, "freshnessScore": 0.5, "bucket": "unknown" },
  "reliabilityBand": "caution"
}
```
