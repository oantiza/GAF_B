# Legado de conocimiento del sistema BDB
### Escrito por Claude el 12 de julio de 2026, al cierre de su participación en el proyecto

Este documento contiene todo lo que un futuro colaborador (humano o agente) necesita saber y que NO es evidente leyendo el código. Es el conocimiento ganado en las auditorías y remediaciones del 10-12 de julio de 2026.

## 1. Qué es el sistema y su estado al cierre

Monorepo de 3 módulos: `1-extractor` (Python: CNMV/Morningstar/EODHD → 753 JSON canónicos), `2-plataforma-datos` (TS: contratos + gobierno de la maestra Firestore), `3-BDB-ACTIVOS_app` (React + Cloud Functions: la plataforma del asesor). Proyecto `bbdd-activos-financieros`, monousuario.

**Estado verificado al cierre:** maestra íntegra (753/753, 0 drift, holdings sincronizados), paridad 100% con el legacy (`_legacy/bdb-fondos`, salvo Jubilación por decisión), interfaz v2 completa (plan `PLAN_INTERFAZ_V2_2026-07-12.md`, acta en `3-BDB-ACTIVOS_app/docs/CIERRE_PLAN_INTERFAZ_V2.md`), suites 248 pytest + 405 vitest, backup PASS 15.072 docs.

## 2. Convenciones críticas que NO están escritas en el código

- **Cartera Real, supuesto V₀:** las posiciones del traspaso inicial sin movimiento de entrada se asumen presentes en la apertura (12/11/2020) a precio de mercado ESTRICTO en/antes de esa fecha (nunca precio posterior). Excepción: destinos con evidencia de entrada >15 días tras la apertura no se asumen. El 3er fichero de traspasos documentados siempre tiene prioridad. Decisión de Oscar del 06-07-2026.
- **Exclusión declarada:** ES00000127Z9, FR0013514619, FR0010493957 (vendidos, sin serie en ningún proveedor) no bloquean cobertura pero se declaran siempre. Jamás aplicar a posiciones vivas.
- **Escala fiscal Bizkaia (comparador patrimonial):** 19/20/22/24/25,5/26/26,5/27/28% — portada de `retirementUtils.ts` del legacy y NO verificada contra la norma foral vigente. Si se necesita exactitud normativa, confirmar con asesor fiscal y actualizar la constante `BIZKAIA_TAX_BRACKETS` en `macro_reference.py`.
- **Ownership de `metrics/latest`:** el refresh de la app posee `max_drawdown_hist`, `last_date`, `updated_at` (escritura merge); el loader/republish posee el resto y DEBE preservar los campos del refresh (`METRICS_REFRESH_OWNED_FIELDS` en `republish.ts`). Romper esto reabre el ping-pong entre escritores.
- **Trailing returns:** el endpoint Morningstar sal `trailingReturn/v3` entrega periodos >1 año ACUMULADOS y sin flag; JAMÁS mapearlo a `*_anualizada`. Los anualizados vienen del screener (`ReturnM36/60/120`) y del snapshot (`Annualized=True`).
- **Formatos Andbank:** los .xls son HTML; importes con céntimos implícitos sin coma (`+27839` = 278,39 €); `\xa0` en filas TOTAL; el concepto se trunca a ~30 caracteres y puede cortar el "@ títulos".

## 3. Reglas operativas (dolorosamente aprendidas)

- **Rotar contraseña = cambiarla en el usuario existente. JAMÁS recrear la cuenta** (cambia el UID y deja huérfanos todos los datos app-owned; incidente del 11-07, migración en `scripts/migrate_portfolios_uid.py`).
- **Gates:** loader/republish exigen `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES`; `audit:consistency` se NIEGA a correr con ese gate activo (quitarlo antes). El `.env.bbdd-activos-financieros` de las functions DEBE mantener sus gates activos (son el runtime de los schedulers) — la política "gates cerrados salvo ventana" aplica solo a sesiones manuales locales.
- **El loader es create-only** (SKIP_EXISTS): para actualizar activos existentes, `republish:fondosdb`. Tras cada `--write`, el índice de búsqueda se reconcilia solo.
- **Firestore real rechaza `undefined`** aunque los mocks y ajv lo toleren: todo payload nuevo pasa por strip de undefined (lección de los 505 errores de holdings).
- **Los docs padre en `bdb_activos/{uid}` deben materializarse siempre** — los padres fantasma escapan a `collection.get()` (lección del backup que no respaldaba carteras).
- **Pipeline del extractor** (manual, en orden): `update` → `calidad` → `export` → `bdb` → loader/republish → `audit:consistency`. No mezclar artefactos de fechas distintas.

## 4. Vigilancia automática (el sistema se audita solo)

Schedulers diarios: precios 7:30 · métricas 8:00 (cursor reanudable; "WARNING scheduled_refresh_metrics_partial" = ciclo parcial, normal) · integridad 8:45 (semáforo en `meta/integrity_status`, visible en Sistema → Estado del sistema) · reconcile índice 3:45. Backup local diario (`backup_export_daily.bat`, marcador en `meta/backup_status`) + PITR + backup administrado en GCP. Si el semáforo da WARN/FAIL, sus `problems` dicen exactamente qué mirar.

## 5. Método de trabajo que funcionó (para futuros agentes)

**El humano decide · un agente planifica y revisa · otro ejecuta.** Órdenes de trabajo cerradas: archivos permitidos/prohibidos, criterios de aceptación, tests exigidos, salidas LITERALES (nunca parafrasear — un agente reportó valores de un .env que no existían), PARAR ante desviación. Revisión bloqueante en todo lo que sea cálculo financiero. Verificación cruzada entre agentes distintos: cada uno cazó errores que el otro no vio.

## 6. Pendientes al cierre (ninguno urgente)

1. Migración `price_series` v1→v1.2: runbook listo (`2-plataforma-datos/docs/historico-bdb/RUNBOOK_MIGRACION_PRICE_SERIES.md`, con las órdenes de BDB: hay que reescribirlas antes de usarlo); exigir dry-run real con `invalid=0` antes de producción.
2. Confirmar tramos fiscales Bizkaia con asesor (ver §2).
3. Búsqueda global Ctrl+K (idea aprobada, no implementada).
4. Limpiar backup incompleto `2026-07-12T08-49-47-251Z` y aplicar retención (script `maintainLocalBackups.ts`).
5. `mapping.py` de Cartera Real sigue hardcodeado (24 entradas de la cuenta Andbank): solo importa si algún día entra otra cuenta/cliente.
6. Los informes de calidad del extractor (`main.py calidad`) deben re-ejecutarse tras cada `update` masivo — el loader los consume.

## 7. Dónde está todo

Auditorías: `AUDITORIA_INDEPENDIENTE_BDB_2026-07-10.md` (hallazgos y método) · remediación: `INFORME_CIERRE_AUDITORIA_Y_REMEDIACION_2026-07-11.md` · estado general: `ESTADO_DEL_PROGRAMA_2026-07-11.md` · plan y cierre de interfaz v2: `PLAN_INTERFAZ_V2_2026-07-12.md` + acta en docs/ · trazabilidad operativa: `2-plataforma-datos/runs/` e `ingestion_runs/` en Firestore.

---

*A quien continúe este trabajo: el sistema que recibes está sano, vigilado y documentado. Trátalo con el rigor que Oscar le ha puesto — cada número que muestra acaba en decisiones de dinero real. Verifica antes de afirmar, declara todo supuesto, y nunca inventes un dato donde puedas admitir que falta.*

*Fue un privilegio. — Claude*
