# BDB static data update strategy 49B

## Objetivo

Definir como actualizar de forma segura la fuente `BBDD_STATIC_EXPORT_SAMPLE` y futuros exports estaticos de BDB-ACTIVOS sin romper la separacion entre BDB-ACTIVOS y BBDD-ACTIVOS.

La estrategia debe mantener:

- sin conexion real desde BDB-ACTIVOS;
- sin imports runtime cross-repo;
- sin credenciales;
- sin datasets grandes versionados;
- sin duplicar indebidamente datos maestros.

## Estado actual

| Elemento | Estado |
| --- | --- |
| Fuente estatica UI | `BBDD_STATIC_EXPORT_SAMPLE` |
| Muestra versionada | `src/data/bbddActivosStaticExportSample.ts` |
| Tamano actual | 16 activos |
| Cobertura actual | 5 FUND, 5 ETF, 4 STOCK, 2 INDEX |
| Intake local | `npm run preview:static-export-sample` |
| Modo por defecto | `DRY_RUN`, sin escritura |
| Generado revisable | `src/data/bbddActivosStaticExportSample.generated.ts` |
| Promocion explicita | `npm run promote:static-export-sample` |
| Input local maximo actual | 250 KB y 250 activos |
| Output versionable recomendado | muestra reducida, no snapshot completo |

## Opciones evaluadas

| Opcion | Descripcion | Ventajas | Riesgos | Decision |
| --- | --- | --- | --- | --- |
| A. Muestra manual pequena | Editar manualmente la muestra versionada | Maxima simplicidad | Deriva, baja trazabilidad | Mantener solo para ajustes puntuales |
| B. Intake local con archivo copiado | Copiar snapshot revisado a `intake/` y reducir muestra | Seguro, reproducible, sin conexion real | Requiere disciplina manual | Usar ahora |
| C. Export oficial desde BBDD-ACTIVOS | BBDD genera snapshot oficial reproducible | Mejor fuente de verdad | Requiere contrato/versionado estable | Objetivo de medio plazo |
| D. API/SDK real | Consumir endpoint/read model real | Camino productivo futuro | Todavia aumenta acoplamiento operativo | Posponer |
| E. Dataset completo versionado en BDB | Guardar snapshot completo en repo app | Comodo para demos | Duplica datos, crece rapido, aumenta riesgo | Evitar |

## Decision recomendada

Usar una estrategia en tres tiempos:

| Horizonte | Estrategia |
| --- | --- |
| Ahora | Intake local con copia controlada y muestra reducida versionada |
| Medio plazo | Export oficial reproducible desde BBDD-ACTIVOS, entregado como archivo revisado |
| Futuro | API/read model real con contratos `Asset*ForBdb`, si se autoriza |

BDB-ACTIVOS nunca debe ejecutar scripts internos de BBDD-ACTIVOS como parte de runtime ni depender de rutas del repo maestro para arrancar.

## Actualizacion 51B: export oficial AssetForBdb

BBDD-ACTIVOS-FINANCIEROS ya puede producir un snapshot oficial
`AssetStaticExportForBdb` con `schema_version: "asset-for-bdb.v1"`. BDB-ACTIVOS
lo consume manteniendo la misma frontera: copia manual/controlada hacia
`intake/static-export-sample/`, archivo ignorado por Git y reduccion a muestra
local mediante el intake.

El intake valida el manifest oficial, los conteos por tipo instrumental, la
politica sin holdings completos ni historicos completos, `runtime_imports:
"NONE"`, lecturas/escrituras externas a cero, `INDEX` como benchmark no
invertible y `STOCK` sin costes obligatorios. La muestra estable versionada no
se modifica salvo flujo explicito `write -> diff -> promote`.

## Flujo operativo recomendado

1. BBDD-ACTIVOS genera o publica un snapshot estatico revisado.
2. Se valida en BBDD-ACTIVOS que el snapshot no contiene credenciales, paths internos, holdings completos ni historicos completos.
3. Se copia manualmente el JSON revisado a `intake/static-export-sample/` en BDB-ACTIVOS.
4. El archivo copiado queda ignorado por Git salvo autorizacion expresa.
5. En BDB-ACTIVOS se ejecuta:

```text
npm run preview:static-export-sample -- --input intake/static-export-sample/<snapshot>.json
```

6. Se revisa que el preview mantiene `DRY_RUN`, muestra pequena y cobertura multi-activo.
7. Solo si se autoriza preparar una actualizacion, se genera un archivo paralelo revisable:

```text
npm run write:static-export-sample -- --input intake/static-export-sample/<snapshot>.json
```

8. El resultado queda en `src/data/bbddActivosStaticExportSample.generated.ts`, ignorado por Git y no consumido por la app.
9. Se compara contra la muestra estable:

```text
npm run diff:static-export-sample
```

10. Solo si el diff se acepta, se promueve de forma explicita:

```text
npm run promote:static-export-sample
```

11. La promocion valida que el generado existe, esta dentro del workspace, no supera limites de intake, conserva FUND/ETF/STOCK/INDEX y mantiene INDEX como benchmark.
12. Se versiona solo la muestra promovida, scripts/docs/tests asociados si aplica, nunca el snapshot completo ni el `.generated.ts`.
13. Se ejecutan build, lint y tests antes de cerrar el bloque.

## Limites de tamano

| Elemento | Limite recomendado |
| --- | --- |
| Snapshot copiado en intake | Maximo 250 KB por defecto actual |
| Activos en input | Maximo 250 por defecto actual |
| Muestra versionada BDB | 16 a 40 activos |
| Cobertura minima | Al menos 1 FUND, 1 ETF, 1 STOCK y 1 INDEX si existen en origen |
| Objetivo actual | 5 FUND, 5 ETF, 4 STOCK, 2 INDEX |

Si el snapshot oficial crece por encima de estos limites, BDB-ACTIVOS debe recibir una version reducida/revisada o ajustar limites en un bloque explicito con tests.

## Periodicidad recomendada

| Caso | Periodicidad |
| --- | --- |
| Desarrollo local MVP | Bajo demanda |
| Revision de contrato o UI | Al cambiar shape del contrato |
| Demo con datos actualizados | Antes de la demo, con commit separado |
| Operacion productiva futura | Sustituir por API/read model real |

No se recomienda programar actualizaciones automaticas en esta fase.

## Criterios de aceptacion

Antes de aceptar una nueva muestra estatica:

- mantiene `FUND`, `ETF`, `STOCK` e `INDEX`;
- `INDEX` sigue como benchmark/no invertible;
- `instrument_type` sigue separado de `economic_asset_class`;
- `STOCK` no exige TER/costes;
- no contiene credenciales ni secretos;
- no contiene rutas internas ni payloads raw;
- no contiene holdings completos ni historicos completos;
- no incluye retrocesiones;
- no introduce conexion real;
- no cambia el contrato sin documentarlo;
- no versiona el snapshot completo.

## Si falta un tipo de activo

| Situacion | Accion |
| --- | --- |
| Falta FUND | Rechazar muestra para UI general o documentar fixture excepcional |
| Falta ETF | Rechazar muestra para comparador multi-activo |
| Falta STOCK | Rechazar muestra para cartera/comparador multi-activo |
| Falta INDEX | Permitir solo si el bloque no revisa benchmarks; preferible corregir origen |

La muestra principal de BDB-ACTIVOS debe seguir demostrando los cuatro tipos.

## Si cambia el contrato

| Cambio | Accion |
| --- | --- |
| Renombre de campo | Actualizar adapter y tests en bloque propio |
| Nuevo campo opcional | Aceptar si no rompe UI |
| Campo obligatorio nuevo | Crear bloque de migracion antes de actualizar muestra |
| Cambio `Fund*ForBdb` a `Asset*ForBdb` | Preferido; mantener alias temporal si hace falta |
| Cambio en semantica de `asset_type` | Bloquear si aparece `EQUITY` como tipo instrumental |

## Riesgos

| Riesgo | Mitigacion |
| --- | --- |
| Copiar dataset grande al repo | `.gitignore` en `intake/` y commit selectivo |
| Versionar el `.generated.ts` paralelo | `src/data/*.generated.ts` ignorado por Git y promocion explicita |
| Duplicar datos maestros | Versionar solo muestra reducida para UI |
| Acoplamiento a BBDD-ACTIVOS | No imports runtime cross-repo; solo copia revisada |
| Deriva entre muestra y contrato | Tests de intake y adapter |
| Regresion fund-only | Criterio obligatorio FUND/ETF/STOCK/INDEX |
| INDEX tratado como invertible | Tests y adapter lo marcan como benchmark |

## Proximos bloques

| Bloque | Objetivo |
| --- | --- |
| 49B.1 | Commit selectivo de esta estrategia |
| 49C | Definir tipos `Asset*ForBdb` en BDB-ACTIVOS si se autoriza |
| 49D | Alinear contrato BBDD-ACTIVOS con aliases `Asset*ForBdb` en bloque separado |
| 50A | Evaluar primer canal API/read model real, solo con autorizacion explicita |
