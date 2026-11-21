# BDB Assets Static Export 51A

## Objetivo

Definir el primer export oficial `Asset*ForBdb` para que `BDB-ACTIVOS` pueda
consumir un snapshot estatico pequeno y revisable, sin imports runtime entre
repositorios y sin activar conexion real.

## Superficie exportada

- `AssetSearchForBdb`
- `AssetDetailForBdb`
- `AssetMetricsForBdb`
- `AssetCostsForBdb`
- `AssetPmsExposureForBdb`
- `AssetHoldingSummaryForBdb`
- `AssetStaticExportForBdb`
- `AssetStaticExportManifestForBdb`

La superficie mantiene compatibilidad con los contratos `Fund*ForBdb`
existentes, pero el nombre oficial para consumo nuevo pasa a ser `Asset*ForBdb`
porque el universo incluye fondos, ETFs, acciones e indices.

## Reglas de negocio

- `instrument_type` separa `FUND`, `ETF`, `STOCK` e `INDEX`.
- `economic_asset_class` sigue describiendo la exposicion economica, por
  ejemplo `EQUITY` para acciones e indices de renta variable.
- `INDEX` se exporta como benchmark no invertible:
  - `role: "BENCHMARK"`
  - `is_investable: false`
  - `NON_INVESTABLE_BENCHMARK` en `quality_flags`
- `STOCK` no requiere TER ni costes de fondo.
- Holdings completos no se exportan; solo `holdings_summary` con
  `full_holdings_loaded: false`.
- Historicos completos no se exportan; solo se conserva
  `history_available_years`.

## Preview local

El script:

```text
npm run preview:bdb-assets-static-export
```

genera:

```text
artifacts/bdb-assets-static-export-preview/bdb-assets-for-bdb.preview.json
```

`artifacts/` esta ignorado por git. El preview se alimenta solo de fixtures
mock locales del ACL y valida:

- cobertura minima de `FUND`, `ETF`, `STOCK` e `INDEX`
- benchmark no invertible para indices
- acciones sin costes obligatorios
- ausencia de holdings completos, posiciones y series historicas completas
- tamano inferior a 250 KB
- sin rutas locales absolutas ni fragmentos de credenciales

## Seguridad

Este bloque no habilita lectura ni escritura real. El export es local,
determinista y no debe incluir credenciales, SDKs de consumidor, paths internos
ni datasets grandes.
