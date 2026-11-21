# BDB-ACTIVOS local MVP closeout 49D

## Objetivo del proyecto

BDB-ACTIVOS es la nueva app local multi-activo para trabajar sobre fondos, ETFs, acciones, indices, carteras e informes. La fase actual ha servido para construir y validar el MVP local sin conexion real y sin acoplarse a estructuras internas de BBDD-ACTIVOS.

## Arquitectura actual

```text
BDB-ACTIVOS UI
  -> AssetDataSource
    -> LOCAL_MOCK
    -> BBDD_CONTRACT_FIXTURE
    -> BBDD_STATIC_EXPORT_SAMPLE
```

La UI consume una frontera comun (`AssetDataSource`) y no lee almacenamiento real, credenciales, rutas internas ni repos externos en runtime.

## Rutas principales

| Ruta | Uso |
| --- | --- |
| `src/app` | App local principal |
| `src/components` | Buscador, ficha, comparador, cartera y reporting |
| `src/adapters` | Frontera de datos y adapters locales |
| `src/types` | Tipos internos BDB y contratos BBDD-shaped |
| `src/data` | Fixtures y muestra estatica versionada |
| `intake/static-export-sample` | Zona local para snapshots copiados/controlados |
| `scripts/buildStaticExportSample.mjs` | Intake/reduccion de muestra estatica |
| `docs` | Estrategias, contrato y cierre de fase |

## Estado Git actual

| Punto | Estado |
| --- | --- |
| Rama | `master` |
| Ultimo commit esperado | `17a0af6 docs: add static data update strategy` |
| Remoto GitHub | No configurado |
| Estado esperado antes de este informe | Limpio |

## Funcionalidad construida

| Bloque funcional | Estado |
| --- | --- |
| Scaffold React + TypeScript + Vite | Hecho |
| Buscador universal multi-activo | Hecho |
| Ficha de activo | Hecho |
| Comparador multi-activo | Hecho |
| Cartera con pesos manuales | Hecho |
| Reporting local | Hecho |
| Selector de fuente | Hecho |
| Intake local seguro | Hecho |
| Contrato documental BDB/BBDD | Hecho |
| Estrategia de actualizacion estatica | Hecho |

## Fuentes de datos disponibles

| Fuente | Estado | Uso |
| --- | --- | --- |
| `LOCAL_MOCK` | Activa local | Desarrollo UI base |
| `BBDD_CONTRACT_FIXTURE` | Activa local | Ensayar shape de contratos BBDD |
| `BBDD_STATIC_EXPORT_SAMPLE` | Activa local | Probar muestra estatica controlada |

Todas declaran `isRealConnection: false`.

## Estado de la muestra estatica

| Punto | Valor |
| --- | --- |
| Archivo | `src/data/bbddActivosStaticExportSample.ts` |
| Origen declarado | Snapshot preview local de BBDD-ACTIVOS |
| Total origen | 50 activos |
| Muestra versionada | 16 activos |
| Cobertura | 5 FUND, 5 ETF, 4 STOCK, 2 INDEX |
| INDEX | Benchmark/no invertible |
| Dataset completo en repo | No |

## Estado del intake local

| Punto | Estado |
| --- | --- |
| Comando | `npm run preview:static-export-sample` |
| Modo por defecto | `DRY_RUN` |
| Escritura por defecto | No |
| Flag de escritura | `--write` |
| Input maximo actual | 250 KB y 250 activos |
| Zona de snapshots | `intake/static-export-sample` |
| Snapshots copiados | Ignorados por Git salvo excepciones controladas |

## Decisiones cerradas

- BDB-ACTIVOS es app consumidora, no base maestra.
- BBDD-ACTIVOS conserva datos maestros y contratos/read models.
- BDB-ACTIVOS no consume Firestore crudo ni paths internos.
- La app sigue siendo multi-activo: `FUND`, `ETF`, `STOCK`, `INDEX`.
- `instrument_type` y `economic_asset_class` permanecen separados.
- `INDEX` puede aparecer como benchmark, pero no como posicion invertible.
- `STOCK` no exige TER/costes.
- La muestra estatica es pequena y versionada; el snapshot completo no se versiona.
- La siguiente integracion real debe pasar por contratos `Asset*ForBdb` o canal API/read model autorizado.

## Validaciones actuales

| Validacion | Estado esperado |
| --- | --- |
| `npm run preview:static-export-sample` | OK, `DRY_RUN`, `wrote: false` |
| `npm run build` | OK |
| `npm run lint` | OK |
| `npm test` | OK, 64 tests |

## Seguridad confirmada

| Riesgo | Estado |
| --- | --- |
| Firestore desde BDB-ACTIVOS | No |
| Firebase desde BDB-ACTIVOS | No |
| Conexion real | No |
| Credenciales | No |
| Deploy | No |
| Push | No |
| Persistencia real | No |
| Export real de informes | No |
| Optimizacion real | No |
| Suitability real | No |
| Retrocesiones | No |

## Riesgos pendientes

| Riesgo | Mitigacion recomendada |
| --- | --- |
| Contratos actuales con nombres `Fund*ForBdb` | Migrar a `Asset*ForBdb` o crear aliases en bloque separado |
| Falta de remoto GitHub propio | Decidir repositorio antes de abrir fase colaborativa |
| Deriva entre muestra y contrato maestro | Mantener intake + tests y actualizar muestras en bloques pequenos |
| API/read model real aun no conectado | Posponer hasta autorizacion y contrato estable |
| Reporting/optimizacion/suitability reales | Mantener fuera hasta bloques especificos |

## Proximos bloques recomendados

| Bloque | Objetivo |
| --- | --- |
| 49D.1 | Commit selectivo de este informe de cierre |
| 49C | Decidir repo GitHub propio para BDB-ACTIVOS |
| 50A | Planificar canal real BDB-ACTIVOS -> BBDD-ACTIVOS |

## Recomendacion sobre GitHub/remoto

Crear un repo GitHub propio para BDB-ACTIVOS antes de avanzar a integraciones reales. Debe ser independiente de BBDD-ACTIVOS-FINANCIEROS, BDB-FONDOS legacy, Screener y otros proyectos. El primer push deberia hacerse con revision de historial local y sin incluir snapshots grandes ni archivos de credenciales.

## Recomendacion de siguiente fase

Cerrar la fase MVP local/export estatico. La siguiente fase deberia ser de producto/infraestructura:

1. decidir repositorio remoto propio;
2. formalizar tipos `Asset*ForBdb` si se autoriza;
3. preparar plan de integracion real via contrato/API/read model;
4. mantener el MVP local como banco de pruebas estable.
