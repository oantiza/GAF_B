# BDB static export strategy 48E

## Estado actual

BDB-ACTIVOS ya tiene tres fuentes locales de datos:

| Fuente | Uso actual | Riesgo |
| --- | --- | --- |
| LOCAL_MOCK | Desarrollo UI local y tests base | Bajo |
| BBDD_CONTRACT_FIXTURE | Validar forma de contratos BBDD-ACTIVOS | Bajo |
| BBDD_STATIC_EXPORT_SAMPLE | Probar una muestra estatica controlada del export BBDD-ACTIVOS | Bajo si sigue siendo pequena |

La muestra estatica actual tiene 16 activos derivados de un snapshot preview de 50 activos:

| Tipo | Cobertura actual |
| --- | --- |
| FUND | Incluido |
| ETF | Incluido |
| STOCK | Incluido |
| INDEX | Incluido como benchmark/no invertible |

## Referencia BBDD-ACTIVOS revisada read-only

| Elemento | Observacion |
| --- | --- |
| `artifacts/screener-static-dataset-export-preview/screener-assets.mock.preview.json` | Snapshot preview local, sin conexion real desde BDB-ACTIVOS |
| `scripts/runScreenerStaticDatasetExportPreview.ts` | Generador del preview en el repo maestro, con limites y validaciones |
| `docs/SCREENER_STATIC_DATASET_EXPORT_CONTRACT_V0.md` | Contrato conceptual del export estatico |
| `preview:screener-static-export` | Script del repo maestro; no debe ejecutarse desde BDB-ACTIVOS |

BDB-ACTIVOS no debe importar runtime del repo maestro ni depender de rutas internas para funcionar.

## Problema a resolver

Hay que poder actualizar `BBDD_STATIC_EXPORT_SAMPLE` de forma reproducible sin:

- copiar datasets grandes;
- leer Firestore o Firebase;
- introducir credenciales;
- acoplar BDB-ACTIVOS a scripts internos del repo maestro;
- mezclar datos maestros con logica PMS, suitability, reporting o carteras.

## Opciones

| Opcion | Descripcion | Ventajas | Riesgos | Encaje |
| --- | --- | --- | --- | --- |
| A. Mantener muestra manual versionada | Actualizar a mano una muestra pequena en `src/data/` | Maxima seguridad, simple, auditable | Deriva manual, menor reproducibilidad | Buena como estado actual |
| B. Script local de reduccion | BDB-ACTIVOS recibe un JSON copiado localmente y genera la muestra pequena | Reproducible, testeable, sin conexion real | Hay que blindar tamano, campos y rutas | Buena como siguiente mejora controlada |
| C. Export oficial versionado desde BBDD-ACTIVOS | El repo maestro produce snapshots estables y BDB-ACTIVOS solo consume una copia revisada | Mejor frontera, fuente maestra clara, prepara API futura | Requiere disciplina de versionado y contrato | Recomendacion estrategica |
| D. Esperar a API/SDK | No automatizar muestras hasta tener canal publico real | Evita trabajo intermedio | Bloquea validacion UI con datos realistas | Solo si se prioriza API inmediata |

## Recomendacion

Adoptar C como direccion estrategica y mantener A como mecanismo actual.

Para el siguiente paso practico, introducir B solo como intake local seguro:

1. El repo maestro genera o publica un snapshot estatico revisado.
2. BDB-ACTIVOS recibe una copia local controlada del JSON, sin imports cross-repo.
3. Un proceso local reduce el snapshot a una muestra pequena y determinista.
4. Solo se versiona la muestra reducida y los tests asociados.
5. El snapshot completo queda fuera del commit salvo autorizacion expresa.

## Reglas para futuras muestras

| Regla | Motivo |
| --- | --- |
| Maximo pequeno y documentado de activos | Evitar dataset grande en el repo app |
| Cobertura minima FUND/ETF/STOCK/INDEX | Mantener validacion multi-activo |
| INDEX no invertible | Separar benchmark de cartera invertible |
| `instrument_type` separado de `economic_asset_class` | Evitar repetir ambiguedades legacy |
| Sin `funds_v3`, `historico_vl_v2`, `std_perf` ni `std_perf_norm` crudos | Evitar acoplamiento legacy |
| Sin retrocesiones en datos maestros | Mantener frontera PMS/comercial |
| Sin Firebase, Firestore, credenciales ni conexion real | Mantener BDB-ACTIVOS local y seguro |
| Sin imports runtime desde otros repos | Mantener independencia del nuevo proyecto |

## Propuesta de bloques siguientes

| Bloque | Objetivo |
| --- | --- |
| 48E.1 | Commit selectivo de este documento de estrategia |
| 48F | Crear intake local seguro desde snapshot copiado, con limites de tamano y tests |
| 48G | Revisar visualmente la app con una muestra regenerada |

La decision recomendada es no conectar aun con datos reales. Primero conviene formalizar el intake local y sus guardrails.
