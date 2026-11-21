# BDB AssetForBdb Promotion Decision 51D

## Estado actual

BDB-ACTIVOS consume `BBDD_STATIC_EXPORT_SAMPLE` desde la muestra estable
versionada:

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

BBDD-ACTIVOS-FINANCIEROS produce ya un export oficial `AssetForBdb` revisable.
En BDB-ACTIVOS se consume mediante copia controlada a:

```text
intake/static-export-sample/bdb-assets-for-bdb.preview.json
```

Ese archivo queda ignorado por Git y no forma parte de la muestra estable.

## Resultado de 51C

La prueba de flujo completo con el export oficial confirmo:

- preview oficial correcto en `DRY_RUN`
- write correcto contra `src/data/bbddActivosStaticExportSample.generated.ts`
- diff correcto con codigo 1 por diferencias esperadas
- generated temporal eliminado al cierre
- promote no ejecutado
- muestra oficial generada de 4 activos:

| Tipo | Activos |
| --- | ---: |
| FUND | 1 |
| ETF | 1 |
| STOCK | 1 |
| INDEX | 1 |

El generated conserva `INDEX` como benchmark no invertible y permite `STOCK`
sin costes obligatorios.

## Opciones evaluadas

| Opcion | Decision |
| --- | --- |
| Promover ahora la muestra oficial de 4 activos | No recomendada: reduce demasiado la cobertura de UI, comparador, cartera y reporting. |
| Mantener la muestra estable actual de 16 activos | Recomendada para la experiencia local principal. |
| Mantener la oficial de 4 activos como canary contractual/intake | Recomendada: valida el contrato `asset-for-bdb.v1` sin degradar la muestra de UI. |
| Pedir a BBDD-ACTIVOS una muestra oficial mayor | Recomendada como siguiente paso antes de promover. |
| Mantener ambas | Recomendada: estable 16 para UI, oficial 4 para validacion de contrato. |

## Decision

No promover ahora la muestra oficial reducida de 4 activos.

La muestra estable de 16 activos se mantiene como fuente principal de la app
porque da mejor cobertura para buscador, comparador, cartera y reporting. El
export oficial de 4 activos queda como canary contractual para validar que el
intake acepta `AssetForBdb`, que no hay imports runtime cross-repo y que la
semantica multi-activo sigue protegida.

## Riesgos

| Riesgo | Mitigacion |
| --- | --- |
| Promover una muestra demasiado pequena y empobrecer la UI | Mantener la muestra estable de 16 activos. |
| Deriva entre contrato oficial e intake BDB | Ejecutar el canary oficial de 4 activos en preview/write/diff cuando cambie el contrato. |
| Duplicar dataset maestro en BDB | Mantener el JSON oficial copiado en intake ignorado por Git. |
| Tratar indices como invertibles | Tests e intake exigen `role: "BENCHMARK"` e `is_investable: false`. |
| Exigir costes a acciones | Tests e intake validan `STOCK` sin TER/costes obligatorios. |

## Proximos pasos

1. Pedir en BBDD-ACTIVOS-FINANCIEROS una muestra oficial `AssetForBdb` mayor y
   controlada, idealmente con cobertura cercana a 16-40 activos.
2. Repetir en BDB-ACTIVOS el flujo `preview -> write -> diff` con esa muestra.
3. Promover solo si el diff mantiene o mejora la cobertura funcional de UI,
   cartera y reporting.
4. Mantener sin cambios la regla de no importar runtime desde el repo maestro y
   no versionar snapshots completos.
