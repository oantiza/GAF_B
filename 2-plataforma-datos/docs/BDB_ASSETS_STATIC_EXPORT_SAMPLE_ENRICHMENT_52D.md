# BDB Assets Static Export Sample Enrichment 52D

## Motivo

BDB-ACTIVOS valido en 52B la muestra oficial `AssetForBdb` de 16 activos, pero
decidio en 52C no promoverla todavia como muestra estable. La razon principal
fue que el export oficial, aunque contractual, perdia calidad funcional para
UI/reporting frente a la muestra estable actual:

- menos activos `COVERED`;
- ausencia de una senal equivalente a `performance_preview`;
- cambio completo del universo de activos.

Este bloque enriquece el export oficial sin convertirlo en dataset completo y
sin mover logica de UI a BBDD-ACTIVOS-FINANCIEROS.

## Campos añadidos

Cada `AssetDetailForBdb` exportado incluye ahora:

| Campo | Uso |
| --- | --- |
| `performance_preview` | Vista compacta de retorno, riesgo y valor reciente para UI/reporting. |
| `available_sections` | Secciones declarativas que BDB-ACTIVOS puede mapear sin inferencias fragiles. |
| `data_quality_summary` | Resumen compacto de cobertura y disponibilidad de datos. |

`performance_preview` usa los datos mock ya presentes en `metrics` y ultimo
valor disponible en la fixture local. Se marca como `MOCK_PROXY` y lleva
`proxy_note`; no pretende ser una serie real ni un calculo productivo.

## Cobertura

La muestra sigue teniendo 16 activos:

| Tipo | Activos |
| --- | ---: |
| FUND | 5 |
| ETF | 5 |
| STOCK | 4 |
| INDEX | 2 |

El export mejora la señal de cobertura para UI/reporting:

- 14 activos invertibles con `coverage_status: "COMPLETE"`;
- 2 indices benchmark con `coverage_status: "ROOT_ONLY"`;
- flags de calidad conservados para indicar faltas concretas como
  `MISSING_HOLDINGS` o `NON_INVESTABLE_BENCHMARK`.

## Limites

Este enriquecimiento no incluye:

- holdings completos;
- historicos completos;
- arrays masivos de puntos;
- dataset grande;
- retrocesiones;
- suitability real;
- credenciales;
- imports runtime desde BDB-ACTIVOS;
- lecturas o escrituras externas.

El manifest mantiene `schema_version: "asset-for-bdb.v1"` porque los campos son
aditivos y opcionales para consumidores existentes.

## Validacion esperada en BDB-ACTIVOS

El siguiente bloque en BDB-ACTIVOS deberia copiar el JSON generado a
`intake/static-export-sample/bdb-assets-for-bdb.preview.json` y repetir:

```text
preview -> write -> diff
```

La revision deberia comprobar si el generated oficial conserva:

- 16 activos;
- FUND, ETF, STOCK e INDEX;
- 14 activos `COVERED` tras el mapeo de intake;
- `performance_preview` o seccion equivalente consumible;
- PMS exposure;
- INDEX benchmark/no invertible;
- STOCK sin costes obligatorios;
- ausencia de holdings completos e historicos completos.

Solo entonces BDB-ACTIVOS deberia decidir si promueve la muestra oficial como
muestra estable.
