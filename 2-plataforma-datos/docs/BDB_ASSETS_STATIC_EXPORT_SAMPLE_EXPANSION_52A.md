# BDB Assets Static Export Sample Expansion 52A

## Objetivo

Ampliar el preview oficial `AssetForBdb` desde el canary minimo de 4 activos a
una muestra controlada de 16 activos, mas util para validar UI, cartera y
reporting en BDB-ACTIVOS sin versionar datasets grandes ni activar conexion
real.

## Composicion

La muestra oficial ampliada queda en 16 activos:

| Tipo | Activos |
| --- | ---: |
| FUND | 5 |
| ETF | 5 |
| STOCK | 4 |
| INDEX | 2 |

## Criterio de seleccion

La seleccion es determinista y local:

- fixtures mock revisados dentro del ACL de BBDD-ACTIVOS-FINANCIEROS;
- orden estable, sin aleatoriedad;
- cobertura de varios fondos, ETFs y acciones;
- al menos dos indices benchmark si existen en el fixture;
- maximo operativo por defecto de 16 activos;
- techo explicito de 50 activos para evitar crecimientos accidentales.

## Limites y seguridad

El export mantiene `schema_version: "asset-for-bdb.v1"` y conserva el manifest
con politica de tamano:

- holdings completos excluidos; solo `holdings_summary`;
- historicos completos excluidos; solo `history_available_years`;
- `runtime_imports: "NONE"`;
- lecturas externas: `0`;
- escrituras externas: `0`;
- tamano maximo del JSON: 250 KB.

Los `INDEX` se mantienen como benchmarks no invertibles:

- `role: "BENCHMARK"`;
- `is_investable: false`;
- `NON_INVESTABLE_BENCHMARK` en `quality_flags`.

Los `STOCK` no requieren TER ni costes de fondo.

## Uso previsto por BDB-ACTIVOS

BDB-ACTIVOS debe seguir consumiendo el snapshot mediante copia/intake
controlado:

```text
intake/static-export-sample/bdb-assets-for-bdb.preview.json
```

El artifact generado por este repo queda en:

```text
artifacts/bdb-assets-static-export-preview/bdb-assets-for-bdb.preview.json
```

`artifacts/` no se versiona. BDB-ACTIVOS tampoco debe importar runtime desde
BBDD-ACTIVOS-FINANCIEROS; solo debe copiar un JSON revisado y ejecutar su flujo
`preview -> write -> diff -> promote` cuando haya autorizacion explicita.

## Criterio para promocion futura

La muestra de 16 activos ya cubre el objetivo minimo que BDB-ACTIVOS habia
marcado para no degradar UI, cartera ni reporting. Antes de promoverla en
BDB-ACTIVOS conviene repetir el flujo completo de intake y revisar el diff
contra la muestra estable vigente.
