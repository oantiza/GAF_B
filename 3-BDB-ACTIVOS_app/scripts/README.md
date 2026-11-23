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
| `npm run smoke:commercial-retro-rules` | Smoke de reglas de retrocesiones, las de produccion (`4-base-nueva/firestore.rules`). Solo con un proyecto `demo-` y emuladores; como se arrancan, en la cabecera de `testCommercialRetroEmulators.mjs`. |
| `npm run preview:static-export-sample` | Valida intake de muestra estatica sin escribir. |
| `npm run validate:static-export-canary` | Valida muestra/canary local sin escribir Firestore. |
| `npm run diff:static-export-sample` | Diff local; no escribe. |
| `npm run sync:contracts` | Escribe cache local en `functions_python/contracts_cache/`; no escribe Firestore. |
| `npm run write:static-export-sample` | Escribe generado local ignorado por Git. |
| `npm run promote:static-export-sample` | Promueve muestra estatica local versionable. |

## Solo Lectura (maestra o local)

- `functions_python/scripts/dryrun_metrics_fondos.py`: pasada en seco de metricas de fondos sobre la copia local. No abre Firestore.

## Escrituras Locales o App-Owned

- `buildStaticExportSample.mjs`: genera o promueve la muestra estatica local segun flags.
- `syncContractsCache.mjs`: copia schemas desde `../2-plataforma-datos/contracts` a la cache local de functions.

## Operaciones Live Sensibles

No ejecutar sin aprobacion explicita, dry-run previo y backup cuando toque. Todos toman el proyecto
de `functions_python/master_project.py`, que solo admite `gestor-activos-local` y
`bdb-gestor-de-activos`, y con `--write` exigen el gate maestro:

- `functions_python/scripts/improve_fund_data.py`: `--prepare` solo lee y deja plan + backup local; `--apply-sha256 <hash>` ESCRIBE roots de fondos.
- `functions_python/scripts/migrate_metrics_latest.py`: normaliza `metrics/latest` heredados. Dry-run; `--write --approval ...` ESCRIBE.
- `functions_python/scripts/migrate_portfolios_uid.py`: migra carteras app-owned entre UIDs. Dry-run; `--write --approval ...` ESCRIBE (y `--delete-source` borra).
- `functions_python/scripts/migrate_provisional_roots.py`: normaliza roots provisionales EODHD. Dry-run; `--write --approval ...` ESCRIBE.
- `functions_python/scripts/run_metrics_refresh.py`: ciclos del refresco de drawdown. Dry-run; `--write --approval ...` ESCRIBE `metrics/*` (fija el gate maestro en el proceso).

(Los once guiones Python de esta carpeta —`delete_asset.py`, `load_missing_price_series.py`, `repair_price_series.py`,
`reload_from_eodhd.py`, `extend_history_to_15y.py`, `set_admin.py`, `ingest_dow_msci_world_top100.py`,
`ingest_requested_equity_universes.py`, `plan_capitalgroup_refresh.py`, `plan_price_history_repair.py` y
`verify_price_currency.py`— y `smokeFirestoreRulesNoAuth.mjs` se borraron el 21-11-2026 con la base vieja (decisiones
30 a 39 del censo `CENSO_BASE_VIEJA_2026-11-21.md`): todos leian o escribian `assets/`, que la base nueva no tiene. El
claim de administrador se pone hoy con `npm run nube:administrador`, en `2-plataforma-datos`. Siguen en la etiqueta
`referencia-base-vieja-2026-11-21`.)

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

1. Crear backup maestro: la copia de la plataforma (`backup:export`) se borro con la base vieja el 21-11-2026, y este procedimiento era de ella.
2. Ejecutar dry-run o preview sin gates de escritura.
3. Revisar paths previstos y alcance.
4. Activar gate solo para la consola/ejecucion concreta.
5. Ejecutar write.
6. Revisar postverify/auditoria y apagar gates.

Los comandos que cargaban la maestra vieja (`load:fondosdb`, `republish:fondosdb`, `audit:consistency`) se borraron de `2-plataforma-datos` con ella el 21-11-2026; la base nueva la escribe la plataforma con `baseNueva:*`.
