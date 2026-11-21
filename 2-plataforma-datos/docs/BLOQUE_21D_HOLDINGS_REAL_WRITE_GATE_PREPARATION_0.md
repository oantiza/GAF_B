# Bloque 21D — Holdings Real Write Gate Preparation

## Contexto

Este bloque prepara el write gate real de holdings FondosDB sin ejecutar ningún write ni delete en Firestore. Sigue al Bloque 21C, que emitió decisión `NEEDS_SMALL_FIX_BEFORE_WRITE_PREPARATION` identificando tres fixes procedimentales menores.

---

## ¿Qué se preparó?

Se crearon los siguientes archivos nuevos:

| Archivo | Propósito |
|---|---|
| `scripts/runHoldingsRealWriteGatePreparation.ts` | Script de preparación con todos los guards de seguridad |
| `tests/holdingsRealWriteGatePreparation.test.ts` | 14 tests unitarios cubriendo guards, batch, rollback y verifier |
| `artifacts/fondosdb_holdings_real_write_gate_preparation_0/real_write_preparation_summary.json` | Resumen de estado con todos los contadores |
| `artifacts/fondosdb_holdings_real_write_gate_preparation_0/batch_size_assertion.json` | Assert explícito batch size < 500 |
| `artifacts/fondosdb_holdings_real_write_gate_preparation_0/rollback_policy_manifest.json` | Política de rollback conservadora documentada |
| `artifacts/fondosdb_holdings_real_write_gate_preparation_0/post_write_verifier_plan.json` | Plan de verificación post-write (460 EXISTS + 25 NOT_EXISTS) |
| `artifacts/fondosdb_holdings_real_write_gate_preparation_0/safety_check_summary.json` | Resumen de safety: writes=0, deletes=0 |
| `artifacts/fondosdb_holdings_real_write_gate_preparation_0/preparation_summary.md` | Markdown de resumen legible |
| `docs/BLOQUE_21D_HOLDINGS_REAL_WRITE_GATE_PREPARATION_0.md` | Este documento |
| `package.json` | Nuevo script `preparation:holdings-real-write-gate` |

---

## ¿Por qué NO se hizo write real?

El bloque 21D es **preparación pura**. Las razones para no escribir en esta fase:

1. **Política de seguridad incremental**: El proyecto sigue una cadena preview → gate → write. El write real requiere autorización explícita (`authorized=true`, `can_write=true`) que solo se activa en el bloque siguiente.
2. **Pre-write snapshot pendiente**: Antes del write real se necesita un snapshot live read-only de todos los 460 paths SET para capturar overwrite candidates. Este snapshot no se ha tomado aún.
3. **FIRESTORE_REAL_WRITE_ENABLED no activado**: El flag de seguridad principal permanece inactivo. El script bloquea inmediatamente si detectara el flag activo.
4. **approved=false / can_write=false**: El `write_approval_manifest.json` del gate preview mantiene estos valores hasta autorización explícita.

---

## Batch Size: 485 / 500

| Métrica | Valor |
|---|---|
| Total operaciones planificadas | 485 |
| Límite Firestore batch commit | 500 |
| Margen disponible | **15 ops libres** |
| Batches necesarios | 1 |
| Dentro del límite | ✅ SÍ |

> **Nota de riesgo**: El margen es ajustado (15 ops). Si en futuras actualizaciones del plan se añaden fondos antes de ejecutar el write real, el total podría superar 500. El script bloquea automáticamente si `total_ops >= 500`.

---

## Política de Rollback

**Tipo**: `CONSERVATIVE_FIRST_PARTIAL_INGEST`
**Pre-write snapshot requerido**: SÍ (obligatorio antes de autorizar write real)

### Estrategia para SETs (460 operaciones)

| Caso | Acción de rollback |
|---|---|
| Path NO existía antes del write (nuevo documento) | DELETE del documento creado |
| Path SÍ existía antes del write (overwrite) | Restaurar payload previo desde snapshot pre-write |

### Estrategia para DELETEs (25 operaciones)

| Tipo de DELETE | Caso | Acción de rollback |
|---|---|---|
| `holdings/manifest/chunks/*` (8 ops — CHUNKED shrink) | Chunk existía → lo borramos | Recrear con payload del snapshot pre-write |
| `holdings/latest` (17 ops — SINGLE→CHUNKED) | Latest existía → lo borramos | Recrear con payload del snapshot pre-write |
| Cualquier DELETE | Path no existía (idempotente) | Sin acción necesaria |

### Condiciones bloqueantes antes del write real

1. Pre-write live snapshot NO tomado para todos los paths planificados.
2. Algún overwrite candidate sin payload capturado en snapshot.
3. `FIRESTORE_REAL_WRITE_ENABLED` no está en `true`.
4. Total ops >= 500.
5. Algún path fuera de `assets/{fund_asset_id}/holdings/`.
6. Alguna operación bajo los 91 excluded missing root assets.

---

## Plan de Verificación Post-Write

| Check | Detalle |
|---|---|
| **verify_exists** | 460 paths (todos los SET) deben existir en Firestore |
| **verify_not_exists** | 25 paths (todos los DELETE) deben NO existir en Firestore |
| **root_asset_touch_check** | 0 documentos `^assets/[^/]+$` deben haber sido tocados |
| **missing_roots_touch_check** | 0 operaciones bajo los 91 asset_ids excluidos |
| **firestore_writes_expected** | 460 |
| **firestore_deletes_expected** | 25 |

El verifier se ejecutará **inmediatamente después** del write gate real, en una sesión de solo lectura.

---

## Decisión Final

**`READY_FOR_REAL_WRITE_AUTHORIZATION`**

Todos los guards de seguridad pasaron:

| Guard | Resultado |
|---|---|
| Batch size < 500 | ✅ PASS (485/500, margen 15) |
| Missing root violations | ✅ 0 |
| Paths outside holdings scope | ✅ 0 |
| Root asset touches | ✅ 0 |
| Forbidden writes | ✅ 0 |
| Invalid document paths | ✅ 0 |
| FIRESTORE_REAL_WRITE_ENABLED active | ✅ NO |
| npm test | ✅ 90 archivos / 482 tests PASS |

---

## Pasos siguientes para Write Real (Bloque 22+)

1. Tomar **live readonly snapshot** de los 460 SET paths y 25 DELETE paths.
2. Capturar payloads de **overwrite candidates** (paths ya existentes).
3. Actualizar `write_approval_manifest.json` con `authorized=true`, `can_write=true`.
4. Ejecutar el write gate con `FIRESTORE_REAL_WRITE_ENABLED=true` en sesión controlada.
5. Ejecutar el **post-write verifier** inmediatamente.
6. Confirmar `verify_exists` (460) y `verify_not_exists` (25).

---

## Confirmación de Seguridad

| Acción | Estado |
|---|---|
| Firestore writes ejecutados | 0 |
| Firestore deletes ejecutados | 0 |
| FIRESTORE_REAL_WRITE_ENABLED activado | NO |
| Credenciales impresas | NO |
| .env / .env.local tocados | NO |
| imports/ modificado | NO |
| Commit | NO |
| Push | NO |
| Deploy | NO |
