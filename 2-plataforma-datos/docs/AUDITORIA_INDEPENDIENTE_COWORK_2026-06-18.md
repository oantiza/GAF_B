# Auditoría independiente — BBDD-ACTIVOS-FINANCIEROS

**Fecha:** 2026-06-18
**Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS` · rama `master` · remoto `origin` = `github.com/oantiza/BBDD-ACTIVOS-FINANCIEROS`
**Método:** lectura de estructura y módulos clave + ejecución real de `tsc --noEmit` + intento de `vitest` + barridos de patrones de riesgo + revisión de git e higiene de secretos.

---

## 1. Veredicto general

Proyecto **sólido, maduro y bien organizado**. Es una plataforma de datos (SSOT en Firestore) para activos financieros con una arquitectura de seguridad encomiable: todo write pasa por *dry-run → write-gate → real-write → closeout-audit*, con guard por variable de entorno y contrato de paths que impide tocar subcolecciones sensibles. **El typecheck pasa limpio** y la cobertura de tests es muy alta (103 archivos de test ≈ 1:1 con los módulos).

Veredicto: **apto y coherente con el estado documentado.** Las pegas son de **calidad de tipos y de higiene**, no de corrección funcional. Ninguna referencia falsa ni ruta incorrecta detectada.

---

## 2. Resultados objetivos (ejecutados ahora)

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ **0 errores** (limpio). *Nota: la nota del status doc que decía "arreglar tsc --noEmit" está desactualizada; hoy pasa.* |
| `vitest run` (tests) | ⚠️ **No ejecutable en este entorno Linux**: `node_modules` está instalado para Windows y `vitest 4` usa `rolldown` con binario nativo (`rolldown-binding.linux-x64-gnu.node`) ausente. **Hay que correr `npm test` en tu Windows.** Existen **103** archivos de test. |
| Git | rama `master`, remoto GitHub correcto. Árbol con cambios **sin commitear** (ver §6). |
| Secretos en git | ✅ **Ninguno trackeado** (`.env.local`, `serviceAccount*.json` ignorados y no presentes en `git ls-files`). |

---

## 3. Estructura y stack

- **Stack:** TypeScript (ESM `nodenext`, `strict: true`), runner `tsx`, tests `vitest`; deps de runtime mínimas y correctas (`firebase-admin`, `dotenv`).
- **Tamaño:** ~110 módulos en `src/`, **98 scripts** ejecutables (`scripts/run*.ts`), **103 tests**, ~110 docs de bloque (`docs/BLOQUE_*`).
- **Capas de `src/`:**
  - `providers/` (eodhd, openfigi) — clientes + mappers + dry-runs (52 exports).
  - `ingestion/` — el núcleo: writers/verifiers/gates de Firestore, importadores FondosDB, lotes "vanilla" (408 exports; capa más grande).
  - `normalizers/`, `validators/`, `quality/`, `metrics/`, `mappers/` — transformación y control de calidad.
  - `readModels/`, `reporting/`, `api/`, `contracts/`, `schemas/`, `types/` — capa de lectura pública tipada y contratos.
  - `consumerPreview/` — simulación de consumo (incluye el Screener export).
- **`EODHD-MCP-Server/`** es un servidor MCP de terceros **vendorizado** y **gitignored** (no forma parte del repo ni se audita como código propio).
- **`imports/fondosdb_2026-06-12/`** es el paquete de entrada de FondosDB (versionado por fecha, gitignored, no se modifica).

---

## 4. Arquitectura y seguridad (lo mejor del proyecto)

- **Patrón de escritura gateado:** cada activo/serie se procesa como `dry-run → write-gate → real-write → closeout-audit`, con artefactos por paso. Reduce a casi cero el riesgo de escrituras accidentales.
- **Guard de escritura real:** `FIRESTORE_REAL_WRITE_ENABLED` (por defecto ausente/`false`) comprobado en los puntos de escritura. Documentado en `.env.example` junto con límites (`..._MAX_ASSETS`, `..._MAX_OPS`).
- **Contrato de paths (`src/ingestion/firestorePathContract.ts`):** sólido y bien tipado. Bloquea tocar `metrics/`, `listings/`, `price_series/` y el path legacy de chunks; obliga al path correcto `holdings/manifest/chunks/{chunk_id}`. Es la pieza que evita *phantom parents*.
- **Higiene de secretos:** `.gitignore` cubre `.env*` (salvo `.env.example`), `serviceAccount*.json`, `firebase-keys/`, `imports/`, `artifacts/` y el server MCP. `.env.local` tiene claves reales (EODHD/OpenFIGI/Firebase) pero **no está trackeado**. Correcto.

---

## 5. Calidad de código — hallazgos

1. **Uso elevado de `any` (~347 coincidencias en `src`), concentrado en `ingestion` (231) y `readModels` (60).** Es la grieta principal de seguridad de tipos: la capa más crítica (escritura) es la menos tipada. El `strict:true` queda parcialmente neutralizado ahí. *Recomendado: tipar progresivamente los payloads de ingestión.*
2. **`src/normalizers/assetNormalizer.ts` está completamente en `any`** (`normalizeAsset(asset: any): any`). Funciona (normaliza vacíos→null, mayúsculas ISIN/ticker/divisa, `asset_type` por defecto `UNKNOWN`), pero el normalizador central debería estar tipado contra el schema de `types/assets.ts`. Además contiene **código muerto**: `if (normalized.retrocession === 0) normalized.retrocession = 0;` (no-op).
3. **21 `console.log` en `src/`** (no en `scripts/`). El logging debería vivir en los `scripts/`/runners, no en la librería; en `src/` ensucia y puede filtrar datos en consumidores.
4. **0 `TODO`/`FIXME`/`@ts-ignore`** → muy limpio en ese aspecto.

---

## 6. Estado de git / trabajo sin commitear (acciones)

`git status` muestra:
- `M package.json` (añade el script `dryrun:stock-universe`).
- `?? scripts/runStockUniverseDryRun.ts` (nuevo, sin trackear).
- `?? data/stock_universe/` (nuevo, sin trackear).

Es decir, **el pipeline de "universo de acciones" (stocks) está en construcción y aún sin commitear.** Conecta con la pregunta previa sobre "cargar acciones": el repo de datos contempla `asset_type` STOCK, pero esa ingesta concreta es trabajo en curso. *Recomendado: commitear o aislar en rama para no perderlo y para que el árbol quede limpio.*

---

## 7. Estado funcional (según docs + verificado donde fue posible)

- **FondosDB root assets:** ciclo cerrado — 405 documentos raíz (404 fondos + 1 IWDA), shape de 14 secciones, hash vivo == payload (404/404). Nada pendiente de escribir.
- **Holdings:** 460 SET verificados, sin phantom parents (387 SINGLE_DOCUMENT + 17 CHUNKED).
- **Capa pública:** `Public Contracts v1`, `Search Layer` tipado y `Cost & Performance Guardrails` implementados.
- **Activos de mercado:** AAPL/SPY/QQQ/IWDA + lote diversificado escritos; GSPC.INDX y AAPU.US en `COMPLETE_LATER`.
- Docs citados existen, incluido `SCREENER_STATIC_DATASET_EXPORT_CONTRACT_V0.md` y los `BLOQUE_*`.

---

## 8. Recomendaciones priorizadas

**Alta**
1. Correr `npm ci && npm test` en Windows y fijar el resultado (los tests no pudieron ejecutarse aquí por plataforma). Añadir `tsc --noEmit` + `vitest` como *gate* de commit.
2. Resolver el árbol de git sucio: commitear/ramificar el trabajo de `stock_universe` (acciones).

**Media**
3. Reducir `any` en `ingestion`/`readModels`; empezar por tipar `normalizeAsset` contra `types/assets.ts` y quitar el no-op de `retrocession`.
4. Sacar los `console.log` de `src/` a los runners (o un logger con niveles).

**Baja / higiene**
5. Unificar política de `artifacts/` y `.gitattributes` (LF), y **fijar versiones** de devDependencies (hoy exactas, mantenerlo). Reducir duplicación de lógica por activo (muchos `firestore*PilotWriter`/`*CloseoutAudit` casi idénticos por símbolo → considerar parametrizar).

---

## 9. Alcance y límites de esta auditoría

- **Sí** se ejecutó `tsc --noEmit` (limpio) y se intentaron los tests (bloqueados por binario nativo de plataforma).
- **Sí** se revisaron: estructura completa, config, status doc, contrato de paths, normalizador, distribución de `any`/`console.log`, git y secretos.
- **No** se hizo lectura línea-a-línea exhaustiva de los 300+ ficheros (`src` + `scripts` + `tests`); se priorizaron los módulos críticos y los barridos automáticos. Para una certificación 100% formal, el cierre es: ejecutar `npm test` verde en Windows + revisión dirigida de los módulos `ingestion` con más `any`.
- No se modificó ningún archivo del proyecto (este informe es el único añadido, y queda sin trackear por git).
