# Informe de sesión — Audit de consistencia F3 (70G) → enrutado por población + contrato equity (70H)

**Fecha:** 2026-06-29
**Repo:** `BBDD-ACTIVOS-FINANCIEROS`
**Fase:** F3 (regresión + piloto) del plan reconciliado de consolidación Data Platform
**Modo de trabajo:** Claude diagnostica, dirige e implementa lo que puede; Codex ejecuta solo lo que requiere su entorno (creds Firestore, commit).

---

## 1. Punto de partida

La sesión arrancó con el audit **70G** ya corrido por Codex (read-only, sin gate de escritura). Resultado de la 1ª corrida:

```
checked 758 · matched 171 · drifted 573 · live_missing 14 · no_canonical 0
```

573 de 758 (76%) marcados como "drift". A primera vista, eso **suspende** el gate de F3 ("0 cambios inesperados vs lo ya escrito").

---

## 2. Diagnóstico: el problema estaba en el instrumento, no en el dato

Tras montar el repo y leer `src/loader/auditConsistency.ts` + `src/ingestion/fondosdb/fondosDbMapper.ts`, encontré **dos bugs en el propio audit** que inflaban el drift:

- **Bug 1 — `listings`:** el mapper de fondos emite `listings: []` como placeholder (L104), y el doc vivo lo tiene poblado por otra tubería. El audit comparaba `[]` vs `[…]` → drift falso (479 casos). La nota del script decía "ignora listings", pero como el mapper **sí emite la clave**, el audit la recorría.
- **Bug 2 (el de más impacto) — unión de claves:** `diffPaths` hacía la unión `[...keys(expected), ...keys(live)]`. El "solo campos del mapper" solo se cumplía en el nivel superior; un nivel más abajo, **cualquier subcampo enriquecido presente solo en `live` se marcaba como drift**. Por eso `DE0005140008` driftaba en `identifiers.ticker/aliases/eodhd_code` — campos que el enriquecido EODHD pone y el mapper de fondos no.

> Nota de honestidad: mi primera hipótesis (un agregador de histograma sin filtro) era **errónea**. Leyendo el código real se vio la causa verdadera. Por eso pedí montar el repo en vez de seguir especulando.

**Codex aplicó el parche** (set `IGNORE_TOP` + diff one-directional sobre `keys(expected)`). 2ª corrida:

```
matched 171 → 265 (+94) · drifted 573 → 479
```

Los buckets fantasma colapsaron: `risk` 1054→36; `listings`/`identifiers`/`source_metadata` desaparecidos. Confirmado que los bugs 1 y 2 eran casi toda la señal falsa.

---

## 3. Caracterización del drift honesto

"479 drift" sigue siendo *suma de campos*. Lo que importa para el gate es **cuántos docs driftan en un campo de referencia real**. Lo calculé sobre `drifts.json`:

| Clase | Docs | Lectura |
|---|---|---|
| Solo bloques esperados (no es fallo) | **357** | NAV refresh (`performance.valuation.*` en 404 docs) + republicar (`portfolio_exposure` 160, `fixed_income_profile` 207) |
| Tocan referencia | 122 | de los cuales **119 = patrón EQUITY exacto** |
| Referencia genuina no-equity | **~3** | a mirar individualmente |

**Confirmación del patrón equity:** los 73 docs con drift en `asset_type` driftan *los 73* también en `has_listing` + `costs` + `fixed_income_profile`. Prefijos ISIN: ES 35, DE 13, FR 13, NL 6, IT 4, FI 1, LU 1. Es la firma inequívoca de las **acciones eodhd de 36 campos**.

**Conclusión:** F3 nunca estuvo suspendido. La regresión sobre la población de **fondos está esencialmente limpia**; el "drift" era (a) el instrumento y (b) una población (acciones) sin oráculo propio.

El **chat previo** (extractor `fondosdb`, 542 fondos) confirmó que `DE0005140008` (Deutsche Bank), `DE0005190003` (BMW), SAP, Siemens… son acciones sacadas por eodhd con 36 campos y sin TER — exactamente los ISIN que driftaban.

---

## 4. Causa raíz y decisión

El audit re-mapeaba **todo** con `mapFondosDbFund`, incluidas las 73 acciones que en realidad se escribieron por una **tubería stock propia ya existente**: `src/ingestion/fondosdbStockAssets.ts` → `buildStockRow()` (L187, privada), que produce `asset_type:"STOCK"`, identifiers con ticker/eodhd_code/aliases, `listings[]` y `has_listing:Boolean(listingId)` **computado**, `fundamentals`, y sin `fixed_income_profile`. Selecciona por `classification_v2.asset_type==="stock"`.

**Decisión del usuario (2026-06-29):** las acciones reciben **contrato + mapper equity propio**. El mapper ya existe (buildStockRow); faltaba el contrato y el enrutado.

---

## 5. Cambios implementados (Claude, verificados en sandbox)

| # | Archivo | Cambio |
|---|---|---|
| 1 | `src/loader/auditConsistency.ts` | **Enrutado por población**: importa `readStockRows`; construye mapa `isin→root` stock; las acciones se juzgan contra `buildStockRow`, los fondos contra `mapFondosDbFund`. Excluye `performance.valuation.*` del drift (refresh-owned, vía `IGNORE_PATH_PREFIXES`). Añade `by_population` y `stock_population` al summary. |
| 2 | `contracts/canonical/fondosdb-stock.v1.schema.json` | **Nuevo contrato canónico equity**: describe el JSON crudo de acción (`ms.stock` con ticker/exchange/fundamentals, `classification_v2.asset_type='stock'`). `additionalProperties:true`, estilo idéntico al de fondos. |
| 3 | `contracts/validators.ts` | Cablea el nuevo esquema → `validators.canonicalStock`. |

**Verificación (en el sandbox, sin tocar la máquina del usuario):**

- `tsc --noEmit` → **0 errores**.
- El esquema `fondosdb-stock.v1` **compila en ajv** y acepta una acción de muestra (Deutsche Bank).

---

## 6. Hallazgo abierto: las acciones no validan `master/asset.v1`

Al revisar el contrato maestro encontré que los docs stock **no validan `master/asset.v1`** — 5 desajustes reales:

1. `identifiers.ticker/eodhd_code/aliases` no permitidos (`additionalProperties:false`, solo `isin`).
2. `listings[].source_listing_id` no permitido.
3. `fundamentals` (top-level) no permitido.
4. `quality`: les falta el `status` requerido y sobra `history_trace`.
5. `source_metadata`: campos stock (`source_history`, `source_listing_id`, `firestore_import_block`) no permitidos.

Es decir, el "573/573 validan" de F1 **solo cubrió fondos**; las acciones quedaron fuera del contrato maestro.

**No bloquea F3** (el audit compara acción-vs-acción directamente, sin pasar por `assertValid`). **Recomendación:** aplazar el contrato master-stock a **F4**, cuando las acciones se recarguen por el loader nuevo y de verdad pasen por la validación. Alternativa, si se quiere completitud ya: crear un `master/asset-stock.v1.schema.json` separado (archivo nuevo, cero riesgo para los 573 fondos). **Decisión pendiente del usuario.**

---

## 7. Qué queda para Codex / próximos pasos

1. **Correr el audit v3** (necesita creds Firestore, entorno de Codex):
   ```bash
   npm run audit:consistency -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all
   ```
   Esperado: `by_population.stock` ≈ todo `matched`; `fund` con solo el residuo de republicar (exposure/FI) + ~3 misc.
2. **Commit** de los 3 cambios (no se commitea desde bash por la corrupción de índice recurrente).
3. **Decidir** contrato master-stock: aplazar a F4 (recomendado) o crear la variante separada ahora.
4. Con F3 limpia por población → **piloto de fondos** (las acciones ya tuvieron `fondosdbStockPilotRealWrite` / Ready64).

**Fleco menor:** `fondosDbMapper.ts` L119 hardcodea `product.has_listing:false` — incorrecto para fondos/ETF cotizados; computar o excluir (baja prioridad).

---

## Archivos tocados en esta sesión

- `src/loader/auditConsistency.ts` — enrutado por población + exclusión NAV + by_population.
- `contracts/canonical/fondosdb-stock.v1.schema.json` — **nuevo**, contrato canónico equity.
- `contracts/validators.ts` — `validators.canonicalStock`.
- `docs/INFORME_SESION_2026-06-29_AUDIT_F3_EQUITY.md` — este informe.
- Memoria de Claude actualizada (`data-platform-consolidacion.md` + índice).
