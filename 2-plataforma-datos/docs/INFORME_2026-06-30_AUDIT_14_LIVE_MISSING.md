# Informe — Auditoría y cierre de los 14 `live_missing` (F3)

**Fecha:** 2026-06-30 · **Repo:** `2-plataforma-datos` · **Modo:** Claude diagnostica/implementa lo offline; Codex/usuario corre lo gated (creds Firestore, re-export, commit).

---

## 1. Qué es `live_missing` (definición exacta del código)

En `src/loader/auditConsistency.ts`, con `--ids all`, los candidatos salen del **canónico del extractor** (`pkg.rawByIsin.keys()`), no de Firestore. Para cada ISIN consulta `assets/{ISIN}`; si `!snap.exists` ⇒ `live_missing++` (L122).

Por tanto **`live_missing` = ISIN que el extractor produce pero que NO existe en la maestra**. No es basura viva ni deriva: son activos del extractor que quedaron **fuera de la maestra a propósito** (retenidos/rechazados en la carga 70D–70F).

Universo verificado: `export_bdb/` tiene 759 `.json`; `listImportableJsonFiles` excluye `_resumen.json` ⇒ **758 ISIN únicos** (0 duplicados) = `checked` del audit. Último audit: `matched 744 · drifted 0 · live_missing 14`.

Cuadre exacto con la confirmación esperada en 70F: **`SKIP_EXISTS 744 + REVIEW_HOLD 7 + BLOCKED_REJECTED 7 = 758`**. Los 14 son esos `7 + 7`.

---

## 2. Los 14, identificados y caracterizados

### Grupo A — 7 cargables (calidad BAJO, multiactivo) → `loader_lists/retener_nuevos.txt`

Tienen nombre, ISIN válido, `validation.ok=true`, `v.errors=[]`. Su única marca es `calidad_fondosdb=BAJO`, que en el mapper es **REVIEW, no rechazo** (`auditConsistency`/`fondoDbMapper` L52). Todos `mixed`/`Mixto`: es el **mismo patrón** que los 13 retenidos que ya se cargaron en 70D (falsos positivos de calidad por multiactivo/apalancamiento).

| ISIN | Nombre | calidad | tipo |
|---|---|---|---|
| DE0005318406 | DWS ESG Stiftungsfonds LD | BAJO | mixed |
| ES0116848005 | Global Allocation R FI | BAJO | mixed |
| FR0010041822 | Edmond de Rothschild Patrimoine A | BAJO | mixed |
| LU0119195963 | Goldman Sachs Patrimonial Balanced - P Cap EUR | BAJO | mixed |
| LU0121216526 | Goldman Sachs Patrimonial Aggressive - X Cap EUR | BAJO | mixed |
| LU1883327816 | Amundi Funds - Global Multi-Asset A EUR (C) | BAJO | mixed |
| LU1883340322 | Amundi Funds - Pioneer Flexible Opportunities A EUR (C) | BAJO | mixed |

### Grupo B — 7 NO cargables (sin `identity.name`, BLOQUEADO)

`name=None` en el canónico **y también ausente en `export/fondos.ndjson`** (universal). El mapper los rechaza por `identity.name ausente` (L46 ⇒ `status:REJECTED, asset:null`). `calidad=BLOQUEADO`, `type=other`. No son cerrables desde la plataforma: el dato no existe aguas arriba.

`ES0127097030 · ES0133593030 · ES0141116030 · IE00B4XYLM55 · LU0049842692 · LU0188151095 · LU0564184074`

---

## 3. Verificación realizada (offline, sin creds)

- **Universo y cuadre:** reproducido `pkg.rawByIsin` (758 únicos; `_resumen.json` excluido); `744 + 7 + 7 = 758`.
- **Caracterización:** leídos los 14 canónicos en `export_bdb/` + cruce con `export/fondos.ndjson` → Grupo A con nombre y `BAJO`; Grupo B sin nombre en **ninguna** de las dos fuentes.
- **Pertenencia a listas:** los 7 de A están solo en `retener_nuevos.txt`; los 7 de B no están en ninguna lista de carga (no solapan con lo ya escrito).
- **Comportamiento del mapper:** confirmado por código — A ⇒ REVIEW (cargable con `--include-review`), B ⇒ REJECTED por falta de nombre.
- **Validación de contrato del Grupo A:** respaldada por **precedente** — los 13 retenidos del mismo patrón (mixto/BAJO) se cargaron en 70D con `postverify_ok 13/13`, y el writer valida `validators.masterAsset` antes de escribir (`writer.ts:106`). *(La ejecución directa del mapper en sandbox no fue posible: el `node_modules` del repo es de Windows y `tsx`/esbuild es nativo; no afecta a la conclusión.)*

---

## 4. Plan de cierre

**Grupo A (7) — cerrar cargando como REVIEW (recomendado).** Consistente con 70D/70F. Gated, create-only, postverify. Lo corre Codex/usuario:

```bash
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
  npm run load:fondosdb -- --input "<dir extractor>" \
  --ids loader_lists/retener_nuevos.txt --include-review --targets root,holdings --write
```

Esperado: 7 CREATE, `postverify_ok 7/7`. Maestra **744 → 751**; `live_missing 14 → 7`.

**Grupo B (7) — frente extractor (fondosdb).** No cerrable por la plataforma: requiere re-export que resuelva `identity.name`. Hasta entonces es una **exclusión legítima y esperada** (`BLOCKED_REJECTED`), no un agujero. Entran solos en el siguiente `--ids missing` cuando tengan nombre.

**Audit (opcional, cero riesgo, lo hace Claude).** Instrumentar `auditConsistency.ts` para volcar `live_missing_ids` (y, si se quiere, una allowlist de los 7 BLOCKED esperados) → el gate F3 deja de contar ruido y el cierre queda trazable.

---

## 5. Estado tras este informe

- F3 ya estaba verde (`drifted 0`). Los 14 `live_missing` quedan **explicados y clasificados**: 7 cargables (decisión de cargar/retener) + 7 bloqueados aguas arriba.
- Cerrar el Grupo A baja el residual a 7; el Grupo B se cierra solo con el próximo re-export del extractor.
