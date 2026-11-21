# Scripts de BDB-ACTIVOS

Actualizado: 2026-11-05 (decision 106: el proyecto de cada programa sale de
`functions_python/master_project.py`, que rechaza el de BDB; retirados los tres que solo servian
para BDB, y `tests/barreraDeBdb.test.ts` barre los repositorios).
Revision anterior: 2026-09-29 (auditoria S-04/S-11: gates en `set_admin.py`, inventario completo y
typecheck de `tests/`).

Este repo es consumidor de la maestra. Los scripts se clasifican por efecto operativo: lectura,
escritura local, escritura app-owned y operaciones sensibles sobre maestra/Auth.

## Scripts npm

| Comando | Efecto |
|---|---|
| `npm run dev`, `npm run build`, `npm run preview`, `npm test`, `npm run lint`, `npm run typecheck` | Local, no escribe Firestore. |
| `npm run test:functions`, `npm run test:all`, `npm run test:ci` | Suites Python de functions / todo junto / variante CI. Locales. |
| `npm run check:bundle`, `npm run check:contracts` | Presupuesto del bundle inicial y validacion de contratos. Locales. |
| `npm run shots:ui`, `npm run shots:estrecha` | Capturas con Playwright de las rutas principales contra el servidor de desarrollo local (`AUDIT_BASE`, por defecto `http://localhost:5174`): en los seis anchos de trabajo, o en los cuatro estrechos (1025, 1100, 1180 y 1240). Entran con el usuario local del emulador (`BDB_SHOTS_EMAIL`, `BDB_SHOTS_PASSWORD`). |
| `node scripts/auditoriaFrontend.mjs <etiqueta> [anchos] [filtro]` | El recorrido de la interfaz con Playwright: cada pantalla con su captura y sus medidas (desborde, letra pequena, textos cortados, cajas que se desplazan de lado, consola, accesibilidad con axe-core y Modo cliente). Sustituye a `npm run audit:ui`, retirado el 19-11-2026. Entra con el usuario local del emulador; no escribe Firestore. |
| `node scripts/deadCssD3.mjs` | Censo de CSS muerto: sale con codigo 1 ante una clase sin referencia o un token sin consumidor. Corre tambien dentro de `npm test` (`tests/deadCssCensus.test.ts`). |
| `npm run smoke:informe`, `npm run smoke:pdf` | Pruebas de humo del flujo de informe y del PDF contra el servidor de desarrollo local (`AUDIT_BASE`). `smoke:informe` entra con el usuario local del emulador. No escriben Firestore. |
| `npx tsc -p tsconfig.test.json` | Typecheck de `tests/**` (Vitest) junto a `src/**`. No esta en package.json; ejecutar a mano antes de entregar cambios en tests. |
| `npm run smoke:firestore-rules` | Lee/probe de reglas: espera que `assets/` deniegue lectura sin auth. |
| `npm run smoke:commercial-retro-rules` | Smoke de reglas de retrocesiones. Solo con un proyecto `demo-` y emuladores. |
| `npm run preview:static-export-sample` | Valida intake de muestra estatica sin escribir. |
| `npm run validate:static-export-canary` | Valida muestra/canary local sin escribir Firestore. |
| `npm run diff:static-export-sample` | Diff local; no escribe. |
| `npm run sync:contracts` | Escribe cache local en `functions_python/contracts_cache/`; no escribe Firestore. |
| `npm run write:static-export-sample` | Escribe generado local ignorado por Git. |
| `npm run promote:static-export-sample` | Promueve muestra estatica local versionable. |

## Solo Lectura (maestra o local)

- `plan_capitalgroup_refresh.py`: plan de refresco de cuatro clases de Capital Group; lee Firestore y la web de la gestora y escribe solo en local (`--output`). No escribe Firestore.
- `plan_price_history_repair.py`: plan de reparacion acotado; lee Firestore y escribe solo evidencia local (`--out`). No escribe Firestore.
- `verify_price_currency.py`: verifica la divisa de cada documento de precios contra EODHD. No escribe (requiere `EODHD_API_KEY`).
- `functions_python/scripts/dryrun_metrics_fondos.py`: pasada en seco de metricas de fondos sobre la copia local. No abre Firestore.

## Escrituras Locales o App-Owned

- `buildStaticExportSample.mjs`: genera o promueve la muestra estatica local segun flags.
- `syncContractsCache.mjs`: copia schemas desde `../2-plataforma-datos/contracts` a la cache local de functions.

## Operaciones Live Sensibles

No ejecutar sin aprobacion explicita, dry-run previo y backup cuando toque. Todos toman el proyecto
de `functions_python/master_project.py`, que solo admite `gestor-activos-local` y
`bdb-gestor-de-activos`, y con `--write` exigen el gate maestro:

- `delete_asset.py`: archiva/elimina activos; puede ser destructivo con `--hard`.
- `load_missing_price_series.py`: carga historicos faltantes en Firestore.
- `repair_price_series.py`: repara/borra documentos de series con backup. Desde el 05-11 exige el gate maestro.
- `reload_from_eodhd.py`: reemplaza series desde EODHD; borra docs viejos tras backup.
- `extend_history_to_15y.py`: extiende historicos existentes. Desde el 05-11 exige el gate maestro.
- `set_admin.py`: modifica custom claims de Firebase Auth. Desde el 29-09 exige `BDB_ACTIVOS_ENABLE_MASTER_WRITES` y `--project <proyecto-auth>` (debe coincidir con ADC y ser uno de los dos de aqui).
- `ingest_dow_msci_world_top100.py`: alta incremental (create-only) del Dow Jones y top-100 del MSCI World. Dry-run por defecto; `--write` ESCRIBE roots/series con los gates de la maestra.
- `ingest_requested_equity_universes.py`: alta incremental (create-only) de los universos de acciones pedidos el 21-08. Dry-run por defecto; `--write` ESCRIBE con los gates de la maestra.
- `functions_python/scripts/improve_fund_data.py`: `--prepare` solo lee y deja plan + backup local; `--apply-sha256 <hash>` ESCRIBE roots de fondos.
- `functions_python/scripts/migrate_metrics_latest.py`: normaliza `metrics/latest` heredados. Dry-run; `--write --approval ...` ESCRIBE.
- `functions_python/scripts/migrate_portfolios_uid.py`: migra carteras app-owned entre UIDs. Dry-run; `--write --approval ...` ESCRIBE (y `--delete-source` borra).
- `functions_python/scripts/migrate_provisional_roots.py`: normaliza roots provisionales EODHD. Dry-run; `--write --approval ...` ESCRIBE.
- `functions_python/scripts/run_metrics_refresh.py`: ciclos del refresco de drawdown. Dry-run; `--write --approval ...` ESCRIBE `metrics/*` (fija el gate maestro en el proceso).

(`publish_weekly_report.py`, `repair_hamco_history.py` y `smokeFirebaseTotp.mjs` se retiraron el
05-11, decision 106: llevaban fijo el proyecto de BDB y aqui no hacian falta. Un informe se publica
con el boton de la pantalla de Estrategia (`admin_publish_report`). Siguen en el historial de Git.)

(`refresh_stale_price_series.py` y `backfill_max_drawdown.py` se retiraron el
27-07: el primero duplicaba el job diario sobre un snapshot congelado y el
segundo escribia en `root.risk`, donde la arquitectura vigente lo prohibe. Tras
recargar un historico a mano, usar el recompute del panel admin — ademas de la
caida reconstruye el estado consolidado `metrics/drawdown_state`.)

## Gates

Deploy: desde esta carpeta no se despliega a ningún proyecto. `requireFirebaseDeployApproval.mjs`
lo rechaza con cualquier destino, y añadir uno es cambiar su lista de permitidos. El sitio, las
reglas y los índices se despliegan desde `4-base-nueva`.

Escrituras backend de la app sobre maestra:

```text
BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES
```

Schedulers (cada job exige el gate maestro MAS el suyo):

```text
PRICES_WRITE_ENABLED=true
METRICS_WRITE_ENABLED=true
SEARCH_INDEX_WRITE_ENABLED=true
INTEGRITY_WRITE_ENABLED=true
```

Plataforma de datos, desde `2-plataforma-datos`:

```text
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES
```

## Jobs (6, hora de Madrid)

- `scheduled_reconcile_search_index` (3:45 diario): indice de busqueda vs maestra.
- `scheduled_refresh_prices` (7:30 martes-sabado): precios EODHD; recoge el cierre del dia anterior (dom/lun no hay cierre nuevo).
- `scheduled_publish_weekly_report` (7:15 lunes): informe semanal app-owned.
- `scheduled_publish_daily_report` (7:00 lunes-viernes): informe diario app-owned.
- `scheduled_refresh_metrics` (8:30 diario) y `scheduled_refresh_metrics_0900`, `_0930`, `_1000`: una vuelta diaria de metrics/latest en cuatro ejecuciones con el mismo tope, por el cursor.
- `scheduled_integrity_check` (10:30 diario): semaforo + inventario admin (reconstruccion semanal o por censo/builder).
- Refresco manual admin: preview/dry-run primero; write solo con gate backend activo.

## Backup y Runbook de Escritura

1. Crear backup maestro desde plataforma: `2-plataforma-datos`, `npm run backup:export`.
2. Ejecutar dry-run o preview sin gates de escritura.
3. Revisar paths previstos y alcance.
4. Activar gate solo para la consola/ejecucion concreta.
5. Ejecutar write.
6. Revisar postverify/auditoria y apagar gates.

La app no sustituye a `load:fondosdb`, `republish:fondosdb` ni `audit:consistency`; esos comandos viven en `2-plataforma-datos`.
