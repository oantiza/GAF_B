# `src/loader/` — el escritor de la base nueva

Aquí solo queda `baseNuevaWriter.ts`, el escritor de la base nueva (`bdb-gestor-de-activos`): destino fijo en código,
emulador impuesto, forma validada contra `contracts/base-nueva/` y dueño de cada ruta. Sus barreras están en la
cabecera del propio fichero, y lo usan los guiones `runBaseNueva*`, `runCarterasWrite` y `runPlanesWrite`, y la
subida a la nube a través de `src/ingestion/baseNueva/partesDeLaSubida.ts`.

## Lo que hubo aquí

Hasta el 21-11-2026 esta carpeta era **el cargador de la maestra vieja** (`assets/…`, `metrics/latest`,
`meta/search_index` en `gestor-activos-local`): `cli.ts` (`load:fondosdb`), `republish.ts` (`republish:fondosdb`),
`auditConsistency.ts`, `reclassifyStock.ts`, `archiveAssets.ts` y sus piezas (`planner`, `writer`, `packageReader`,
`ownership`, `metricsLatest`, `searchIndex*`, `holdings*`, `driftCriteria`, `ingestionRun`, `types`). Se borró con
la base vieja por decisión de Óscar (decisiones 30 a 39, sobre `CENSO_BASE_VIEJA_2026-11-21.md` de la raíz), junto
con los contratos de `contracts/master/` contra los que validaba. El estado anterior está en la etiqueta de Git
`referencia-base-vieja-2026-11-21`.
