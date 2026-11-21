# BDB AssetForBdb Larger Sample Decision 52C

## Objetivo

Documentar la decision posterior a 52B sobre la muestra oficial mayor
`AssetForBdb` de 16 activos producida por BBDD-ACTIVOS-FINANCIEROS.

52B probo el flujo de consumo controlado en BDB-ACTIVOS:

```text
preview -> write -> diff
```

El objetivo era comprobar si la muestra oficial mayor ya podia sustituir a la
muestra estable versionada que consume la app.

## Estado de la muestra estable

BDB-ACTIVOS sigue consumiendo como fuente principal:

```text
src/data/bbddActivosStaticExportSample.ts
```

La muestra estable actual contiene 16 activos:

| Tipo | Activos |
| --- | ---: |
| FUND | 5 |
| ETF | 5 |
| STOCK | 4 |
| INDEX | 2 |

En 52B la muestra estable mantenia 14 activos `COVERED`, 1 `UNKNOWN` y 1
`UNCOVERED`. Tambien mantenia secciones de UI como `performance_preview` en 10
activos.

## Estado de la muestra oficial mayor

La muestra oficial copiada al intake fue:

```text
intake/static-export-sample/bdb-assets-for-bdb.preview.json
```

Ese archivo queda ignorado por Git y no forma parte de la muestra estable.

La muestra oficial mayor contiene:

| Tipo | Activos |
| --- | ---: |
| FUND | 5 |
| ETF | 5 |
| STOCK | 4 |
| INDEX | 2 |

Propiedades confirmadas:

- schema `asset-for-bdb.v1`;
- PMS exposure presente;
- `INDEX` como benchmark no invertible;
- `STOCK` sin costes obligatorios;
- sin holdings completos;
- sin historicos completos;
- sin imports runtime cross-repo.

## Resultado de 52B

| Paso | Resultado |
| --- | --- |
| Preview oficial con `--sample-size 16` | OK |
| Write a `src/data/bbddActivosStaticExportSample.generated.ts` | OK |
| Revision del generated | OK |
| Diff contra muestra estable | Codigo 1 por diferencias reales esperadas |
| Promote | No ejecutado |
| Muestra estable | Intacta |
| Generated temporal | Eliminado |
| Artifact oficial | Ignorado por Git |

## Comparacion

| Criterio | Muestra estable | Generated oficial 52B |
| --- | ---: | ---: |
| Total | 16 | 16 |
| FUND | 5 | 5 |
| ETF | 5 | 5 |
| STOCK | 4 | 4 |
| INDEX | 2 | 2 |
| `COVERED` | 14 | 7 |
| `UNKNOWN` | 1 | 7 |
| `UNCOVERED` | 1 | 2 |
| Activos con `performance_preview` | 10 | 0 |
| Activos con PMS exposure | 0 | 16 |

La muestra oficial mejora la validacion contractual `AssetForBdb` y aporta PMS
exposure. Sin embargo, cambia completamente el universo de activos, reduce la
cobertura visible para UI y reporting, y elimina secciones que la muestra
estable usa para una experiencia local mas rica.

## Decision

No promover todavia la muestra oficial mayor de 16 activos.

La muestra oficial queda como canary contractual/intake de mayor cobertura que
el canary inicial de 4 activos. La muestra estable actual se mantiene como
fuente principal de UI, cartera y reporting hasta que el export oficial iguale o
mejore de forma clara la cobertura funcional.

## Motivos para no promover

- cambia completamente el universo de activos;
- reduce `COVERED` de 14 a 7;
- elimina `performance_preview`;
- no es una mejora inequivoca para UI/reporting;
- promover ahora podria empobrecer la experiencia local aunque el contrato sea
  correcto.

## Requisitos para una futura muestra promovible

Una futura muestra oficial `AssetForBdb` deberia:

- mantener 16 o mas activos;
- conservar FUND, ETF, STOCK e INDEX;
- mantener o mejorar la cobertura respecto a la muestra estable;
- incluir `performance_preview` o un equivalente contractual consumible por la
  app;
- conservar PMS exposure;
- conservar `INDEX` como benchmark no invertible;
- conservar `STOCK` sin costes obligatorios;
- excluir holdings completos;
- excluir historicos completos;
- evitar datasets grandes;
- mantener `runtime_imports: "NONE"` y lecturas/escrituras externas a cero.

## Siguiente recomendacion

Pedir a BBDD-ACTIVOS-FINANCIEROS una muestra oficial enriquecida que mantenga
el contrato `asset-for-bdb.v1`, pero que preserve o mejore la cobertura UI de la
muestra estable actual. Despues repetir en BDB-ACTIVOS el flujo:

```text
preview -> write -> diff
```

Solo promover si el diff confirma una mejora funcional clara para UI, cartera y
reporting.
