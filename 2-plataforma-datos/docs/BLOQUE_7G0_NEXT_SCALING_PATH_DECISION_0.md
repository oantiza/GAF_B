# Bloque 7G-0 - Next Scaling Path Decision

## Objetivo

Evaluar de forma segura el siguiente paso despues del ciclo 7F, sin escribir en
Firestore, sin activar write gates, sin usar live APIs y sin hacer commit/push.

## Estado actual

- Firestore writes acumulados: `15`
- Firestore deletes acumulados: `0`
- AAPL asset/listings + price_series/metrics: `PASS`
- AAPU/GSPC piloto diversificado: `PASS`, ambos mantienen estado `REVIEW`
- SPY/QQQ representative ETF pilot: `PASS`
- Tests: `178/178 PASS`
- Ultimo commit local: `6cf0de0`
- Working tree al inicio: limpio
- Push/Deploy: `NO`

## Artifacts revisados

- `artifacts/representative_etf_live_dryrun_0/`
- `artifacts/firestore_representative_etf_pilot_write_0/`
- `artifacts/firestore_representative_etf_closeout_0/`
- `artifacts/firestore_aapl_price_series_pilot_write_0/`
- `artifacts/firestore_aapl_enriched_closeout_0/`
- `artifacts/firestore_diversified_pilot_write_0/`
- `artifacts/firestore_diversified_closeout_0/`

## Opciones comparadas

| Opcion | Beneficio | Riesgo | Live APIs | Rollback | Valor schema | Recomendacion |
| --- | --- | --- | --- | --- | --- | --- |
| A - IWDA.LSE UCITS/Europa | Primer ETF UCITS/Europa, 1 root + 1 listing | Bajo | No | Bajo | Alto | Recomendada |
| B - SPY/QQQ price_series + metrics | Reusa patron AAPL en ETF existente | Bajo/medio | Posible si faltan precios locales | Bajo/medio | Medio | Segunda opcion |
| C - Batch 10-25 roots/listings | Expande cobertura rapido | Alto | Posible | Alto | Medio/alto | Diferir |
| D - OpenFIGI live SPY/QQQ/IWDA | Mejora identificadores sin writes | Medio | Si | Ninguno | Medio/alto | Opcional si hay dudas |

## Evidencia clave

IWDA.LSE ya esta en artifacts locales de 7F-0A:

- Asset ID / ISIN: `IE00B4L5Y983`
- Asset type: `ETF`
- Nombre: `iShares Core MSCI World UCITS ETF USD (Acc)`
- Listing ID: `EODHD_IWDA.LSE`
- Exchange: `LSE`
- Currency: `USD`
- Closeout 7F-1B confirmo IWDA written: `NO`

SPY/QQQ ya estan escritos y verificados como roots + listings, pero no tienen
`price_series` ni `metrics`. AAPL ya probo el patron de price_series/metrics
con 21 observaciones y metricas derivadas.

## Decision

Opcion recomendada: **A - IWDA.LSE UCITS/Europa pilot**.

Motivo: aporta el mayor aprendizaje incremental con el menor riesgo. Es el
primer caso no-USA/UCITS con ISIN claro y listing europeo, usando solo artifacts
existentes y un alcance maximo de 1 asset root + 1 listing.

## Opciones descartadas por ahora

- B - SPY/QQQ price_series + metrics: segura, pero menos incremental que IWDA
  porque no amplia geografia/listing y puede requerir preparacion adicional de
  precios.
- C - Batch 10-25 roots/listings: prematura antes de validar otro caso no-USA o
  mejorar identificadores; aumenta bastante rollback y verificacion.
- D - OpenFIGI live: util si aparecen dudas de identificadores, pero introduce
  una dependencia live y no ejercita el write path.

## Artifacts generados

Carpeta: `artifacts/next_scaling_path_decision_0/`

- `decision_matrix.json`
- `current_firestore_state_summary.json`
- `risk_assessment.json`
- `recommended_next_block.json`
- `rejected_options.json`

## Resultados de ejecucion

- `npm test`: `178/178 PASS`
- `npm run firestore:post-write-closeout-audit`: `PASS`
- `npm run firestore:aapl-enriched-closeout-audit`: `PASS`
- `npm run firestore:diversified-closeout-audit`: `PASS`
- `npm run firestore:representative-etf-closeout-audit`: `PASS`

## Confirmacion de seguridad

- Firestore writes nuevos = `0`
- Firestore deletes nuevos = `0`
- Commit = `NO`
- Push = `NO`
- Deploy = `NO`
- Tokens impresos = `NO`
- Credenciales impresas = `NO`
- EODHD live usado en 7G-0 = `NO`
- OpenFIGI live usado en 7G-0 = `NO`
- EODHD fundamentals usado en 7G-0 = `NO`
- BDB-FONDOS tocado = `NO`
- BDB-FONDOS-CORE tocado = `NO`

## Prompt propuesto para el siguiente bloque

```text
Bloque:
7G-1 - IWDA.LSE UCITS/Europe Pilot Write

Objetivo:
Preparar un write real controlado para IWDA.LSE usando solo artifacts locales
de representative_etf_live_dryrun_0, con maximo 1 asset root + 1 listing.

Seleccion:
- IWDA.LSE
- Asset ID / ISIN: IE00B4L5Y983
- Listing: EODHD_IWDA.LSE

Restricciones:
- NO price_series
- NO metrics
- NO EODHD live
- NO OpenFIGI live
- NO fundamentals
- NO tocar SPY/QQQ/AAPL/AAPU/GSPC
- NO writes hasta confirmacion explicita

Pre-write:
- npm test
- auditorias read-only existentes
- snapshot read-only de IWDA asset/listing missing
- generar real_write_plan, rollback_manifest, approval_manifest y verification_plan
- detenerse antes del write real
```
