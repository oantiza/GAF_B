# Bloque 7F-0A - Representative ETF Live Dry-Run Candidate Acquisition

## Objetivo

Generar artifacts locales seguros para evaluar ETFs representativos antes de
preparar cualquier write real en Firestore.

Este cierre queda en estado `BLOCKED_SAFE`: el script, los artifacts y las
auditorias read-only quedaron preparados, pero no se pudo ejecutar EODHD live
porque `EODHD_API_TOKEN` no esta definido en `.env.local`.

## 7F-0A-FIX - Carga explicita de `.env.local`

Se reviso `scripts/runRepresentativeEtfLiveDryRun.ts` y se confirmo que no
cargaba `.env.local` directamente, sino que dependia de la carga indirecta del
cliente EODHD.

Fix aplicado:

```ts
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
```

La comprobacion posterior por nombres de variables, sin imprimir valores,
confirma que `.env.local` contiene:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_PATH`
- `FIRESTORE_LIVE_READONLY`

No contiene `EODHD_API_TOKEN`; esa es la causa del bloqueo actual.

## Tickers solicitados

1. `SPY.US`
2. `QQQ.US`
3. `IWDA.LSE`

## Endpoints EODHD

Endpoints planificados, sin token en artifacts:

1. `/search/SPY`
2. `/search/QQQ`
3. `/search/IWDA`

Endpoints ejecutados live en esta corrida: `0`.

No se uso `/exchange-symbol-list`, no se uso bulk, no se uso
`/fundamentals` y no se preparo ninguna llamada OpenFIGI live.

## Artifacts

Carpeta: `artifacts/representative_etf_live_dryrun_0/`

- `candidate_requests.json`
- `candidate_raw_responses.json`
- `mapped_assets.json`
- `validation_report.json`
- `selection_recommendation.json`
- `dryrun_summary.json`

## Resultado de adquisicion

- Candidates requested: `3`
- Candidates found: `0`
- Candidates valid: `0`
- Candidates review: `0`
- Candidates blocked: `3`
- `.env.local` cargado explicitamente: `SI`
- `EODHD_API_TOKEN` disponible: `NO`
- Motivo comun de bloqueo: `EODHD_API_TOKEN_NOT_AVAILABLE`

## Calidad de identificadores

No se obtuvo ningun payload EODHD live, por lo que no hay ISIN, ticker/listing
confirmado ni exchange confirmado para los tres candidatos.

Estado por candidato:

| Candidate | Found | Status | Identifier quality |
| --- | ---: | --- | --- |
| `SPY.US` | `false` | `BLOCKED` | Token no disponible; sin payload live |
| `QQQ.US` | `false` | `BLOCKED` | Token no disponible; sin payload live |
| `IWDA.LSE` | `false` | `BLOCKED` | Token no disponible; sin payload live |

## Confirmaciones de seguridad

- Firestore writes = `0`
- Firestore deletes = `0`
- EODHD live = `NO`, bloqueado antes de llamar API porque `EODHD_API_TOKEN` no esta definido en `.env.local`
- EODHD live dry-run solicitado = `SI`, con `EODHD_LIVE_DRYRUN=true` durante la ejecucion
- EODHD fundamentals = `NO`
- OpenFIGI live = `NO`
- API key impresa = `NO`
- Credenciales Firebase impresas = `NO`
- Deploy = `NO`
- Commit = `NO`
- Push = `NO`
- Write plan real preparado = `NO`
- `FIRESTORE_REAL_WRITE_ENABLED` activado = `NO`

## Tests y auditorias

- `npm test`: `164/164 PASS`
- `npm run firestore:post-write-closeout-audit`: `PASS`, writes/deletes del bloque `0/0`
- `npm run firestore:aapl-enriched-closeout-audit`: `PASS`, AAPL intacto, writes/deletes del bloque `0/0`
- `npm run firestore:diversified-closeout-audit`: `PASS`, diversificado intacto, writes/deletes del bloque `0/0`
- `npm run dryrun:representative-etf-live` con `EODHD_LIVE_DRYRUN=true`: `BLOCKED_SAFE`, `EODHD_API_TOKEN_NOT_AVAILABLE`

## Recomendacion para 7F-1

No reabrir 7F-1 todavia.

Reintentar 7F-0A cuando `EODHD_API_TOKEN` este disponible para el proceso y
mantener las mismas restricciones:

- maximo 3 candidatos
- maximo 3 requests principales
- solo `/search`
- sin `/fundamentals`
- sin OpenFIGI live
- sin preparar write real

Reabrir 7F-1 solo si el nuevo dry-run encuentra candidatos `OK` o `REVIEW`
con `asset_type=ETF`, ticker/listing claro y exchange claro. Si falta ISIN pero
el ticker/exchange es solido, mantener el candidato en `REVIEW`, no en `OK`.
