# Programa de cobertura de históricos (backfill de price_series)

Objetivo: cargar la serie EODHD completa (normalizada a EUR) de los activos de la maestra
sin ningún doc en `price_series` (~279 según el panel Admin a 2026-07-02; la cifra exacta
la da el inventario). No toca roots, ni metrics, ni meta/, ni series existentes.

## Diseño

Tres fases, patrón gated de plataforma (dry-run → create-only idempotente → postverify):

1. `coverage:inventory` — read-only. Recorre `assets/`, detecta quién no tiene serie y sus
   pistas (`identifiers.eodhd_code`, divisa). Se niega a correr con el gate activo.
2. `coverage:backfill-dryrun` — EODHD live, CERO Firestore. Resuelve símbolo (pista del root
   o `/search/{ISIN}`; para FUND prefiere `EUFUND`), baja la serie desde 1990, convierte a EUR
   (FX `EUR{MAJOR}.FOREX`, divisas menores GBX/ILA/ZAC, recorte pre-euro), construye docs por
   año y los valida contra `contracts/master/price-series` (ajv). Emite `backfill_plan.json`
   con acción LOAD/REVIEW por activo.
3. `coverage:backfill-write` — gated. Solo entradas LOAD del plan aprobado (alcance y símbolos
   congelados). Por activo: re-verifica que la serie sigue vacía, re-baja fresco a hoy,
   re-valida y escribe con `doc.create()` (create-only). Postverify re-lee lo creado.
   Sin deletes. Exit code 2 si hay mismatches o errores.

La forma de los docs replica EXACTAMENTE `functions_python/ingest_asset.py::_load_full_history`
(producción): `schema_version=asset-price-series.v1`, id `EODHD_{sym}_{year}`, `series_type`
NAV (FUND) / ADJUSTED_CLOSE / INDEX_LEVEL, fx a nivel doc y punto para divisas != EUR.

Código: `src/coverage/{types,seriesBuilder,eodhdHistory}.ts` + `scripts/runHistory*.ts`.
Test puro: `tests/historyBackfillSeriesBuilder.test.ts` (vitest; en Windows).

## Alternativa operativa: panel Admin de la app

La app (3-BDB-ACTIVOS_app) tiene la pestaña **Admin → Históricos** con el mismo flujo
(inventario → previsualizar → cargar por lotes con progreso y cancelación), servida por las
callables `admin_backfill_candidates` / `admin_backfill_history` (functions_python/history_backfill.py).
Misma forma de docs y mismas garantías (create-only, gate de master writes). Para uso operativo
del día a día usa el panel; este CLI queda para auditoría masiva y runs reproducibles en `runs/`.
Ambos son idempotentes entre sí: el que llegue segundo omite las series ya cargadas.

## Ejecución

Requisitos en `.env.local`: `FIREBASE_PROJECT_ID=gestor-activos-local`, credenciales
(lectura para 1 y 2*, `datastore.user` para 3), `EODHD_API_TOKEN`.
(*el dry-run no usa Firestore; solo necesita el token EODHD.)

```bash
# 1. Inventario (read-only) — usuario
npm run coverage:inventory

# 2. Dry-run (sin escrituras) — usuario; ~560 llamadas EODHD, ~3-5 min con sleep 300ms
npm run coverage:backfill-dryrun -- --candidates runs/history_coverage_<id>/missing_assets.json
#    Piloto opcional: -- --limit 10  · Revisar: run_summary.json, backfill_plan.json, review_assets.json

# 3. Escritura gated — Codex/Antigravity (indicar modelo), tras aprobar el plan
set BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES
npm run coverage:backfill-write -- --plan runs/history_backfill_dryrun_<id>/backfill_plan.json
#    Piloto recomendado: -- --limit 5, verificar postverify.json y el panel, luego el resto.

# 4. Confirmación
npm run coverage:inventory   # sin-serie debe caer a ~REVIEWs
```

## Después de la carga

- Métricas (mdd, etc.): las rellena el refresco semanal de métricas del backend de la app
  (`scheduled_refresh_metrics`) o recompute puntual desde el panel. No las escribe este programa.
- El refresco manual/diario de precios pasa a mantener al día los activos cargados (dejan de
  salir como "omitidos").
- Los REVIEW del plan (sin símbolo EODHD, sin datos, validación) quedan listados con motivo:
  decidir fuente alternativa o dejarlos documentados. No se escriben.

## Seguridad

Allowlist de project id; gate propio de plataforma (distinto del de la app); create-only
(nunca sobreescribe ni borra); validación de contrato antes de cada escritura; artifacts de
cada run en `runs/` (inventario, plan, resultados, postverify). El writer de este programa
SOLO escribe en `assets/{isin}/price_series/*`.
