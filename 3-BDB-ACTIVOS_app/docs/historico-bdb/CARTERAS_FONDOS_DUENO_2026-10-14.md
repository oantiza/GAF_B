> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Carteras de los fondos: protección del republish y dueño único

> **Actualización (14-10, tarde).** Las decisiones D3, D4, D6 y D7, la procedencia en el extractor y las herramientas de reparación y restauración ya están hechas y en `master` de los tres repositorios. El estado final, la auditoría y las escrituras pendientes para Óscar están en [INFORME_CIERRE_CARTERAS_2026-10-14.md](INFORME_CIERRE_CARTERAS_2026-10-14.md). Este documento queda como análisis de partida.

*14-10-2026. Parte 1 hecha: `12d61cf` en la rama `carteras-mas-reciente` de `2-plataforma-datos`, ya fusionada en `master` (fast-forward a las 14:58). Sin push y sin escrituras en Firestore: las pasadas en seco solo leyeron. La de después de la fusión está en §1.6. Parte 2: análisis de solo lectura, sin código.*

---

## 0. Resumen

1. **El republish ya no puede hacer retroceder una cartera, en ningún modo.** La del canónico solo sustituye a la viva si es de fecha posterior, o de la misma fecha con más posiciones. Si no, se conserva la viva y se cuenta por motivo.
2. **Pasada en seco real contra Firestore (`--ids all`, solo lectura).**
   - Antes: el republish escribía 757 de 769 carteras, 445 de ellas hacia atrás.
   - Ahora: sustituye **5**, conserva **445** por más recientes y **318** por empate (misma fecha y mismas posiciones). **0 retrocesos.**
   - Las 5 son ETF con el top 10 de iShares, Vanguard e Invesco, 2-3 meses más nuevas en el canónico.
3. **Los 318 empates son casi todos la misma cartera.**
   - 290 solo difieren en el `holding_id`.
   - 22 tienen los mismos nombres y pesos y otros campos distintos.
   - 6 difieren de verdad: 5 ETF temáticos del 11-07 y un redondeo de 0,0002 puntos.
4. **Para escribir solo esas 5 carteras hay un modo nuevo, `--holdings-only`.** Sin él, una escritura completa arrastraría también:
   - 16 raíces de renta fija que se reescriben sin cambiar nada.
   - 15 métricas puente.
   - El `search_index` y su reconciliación.
5. **La pasada en seco destapa tres problemas de datos en las carteras vivas.** Ninguno lo crea este cambio (§1.4):
   - 21 vivas más recientes con menos del 80 % de las posiciones del canónico.
   - 16 árboles mixtos (`latest` + `manifest` + chunks). En 11 hay tres copias de la cartera y quien recorra todo el árbol suma ~300 % de pesos.
   - Ninguna cartera guarda su fuente.
6. **Parte 2: las 445 carteras más recientes salen casi todas de la misma fuente que el extractor.**
   - 427 son de la API `sal-service` de Morningstar, y 18 de informes semestrales en PDF.
   - El extractor va por detrás porque sirve la familia `cartera` de una caché de julio: 635 de 758 descargas.
   - Por eso el primer paso de la opción A es refrescar esa caché, tomar la fecha de las filas y exportar la procedencia por cartera hasta un contrato `holdings.v1.2` (§2.4).
   - Estimación por fuente en §2.5 y decisiones para Óscar en §3.

---

## 1. Parte 1: protección del republish (opción C)

### 1.1 Qué cambia

Rama `carteras-mas-reciente` de `2-plataforma-datos`, commit `12d61cf`. Toca 4 ficheros: +452 −20, de ellas 256 de tests.

| Fichero | Cambio |
|---|---|
| `src/loader/holdingsRepublish.ts` | Función pura `decideHoldingsRepublish(expected, live, stale)`: decide qué hacer con cada cartera que difiere. El plan solo lleva operaciones si la decisión permite escribir.<br>`executeHoldingsRepublish` rechaza un plan cuya decisión no permita escribir (`HOLDINGS_REGRESSION_BLOCKED`). Antes del batch vuelve a leer la cartera viva: si cambió desde el plan, se para (`HOLDINGS_CONCURRENT_MODIFICATION`). |
| `src/loader/republish.ts` | Contadores nuevos en `republish_summary.json`. Artefactos nuevos `holdings_kept.json` y `holdings_replaced.json`. Avisos en `warnings`.<br>Modo `--holdings-only`. Una cartera conservada ya no cuenta como deriva del activo. |
| `src/loader/auditConsistency.ts` | `holdings_drifts.json` incluye la decisión. |
| `tests/republishTransactional.test.ts` | 15 tests nuevos y uno adaptado (ver §1.2). |

**La regla.** Las fechas se comparan como `YYYY-MM-DD`; si llevan hora, se descarta. «Posiciones» es el `holdings_count` declarado o, si falta, el recuento real.

| Decisión | Cuándo | ¿Escribe? | Contador |
|---|---|---|---|
| `UNCHANGED` | La viva coincide con el canónico | No | — |
| `CREATE` | No hay cartera viva | Sí | `holdings_to_replace` |
| `REPLACE_NEWER` | El canónico es de fecha posterior | Sí | `holdings_to_replace`; si además trae menos posiciones, también `holdings_replace_newer_but_shorter` (informativo) |
| `REPLACE_MORE_COMPLETE` | Misma fecha y el canónico trae más posiciones | Sí | `holdings_to_replace` |
| `REPAIR_LAYOUT` | Misma fecha y mismo contenido: solo cambia la forma de guardarla (`latest`/chunks, recuento declarado) | Sí | `holdings_to_replace` |
| `KEEP_NEWER_LIVE` | La viva es de fecha posterior | No | `holdings_kept_newer_live` |
| `KEEP_MORE_COMPLETE` | Misma fecha y la viva trae más posiciones | No | `holdings_kept_more_complete` |
| `KEEP_SAME_DATE_TIE` | Misma fecha, mismas posiciones y contenido distinto | No | `holdings_kept_same_date_tie` |
| `KEEP_UNDATED` | Falta la fecha (o no es válida) en la viva o en el canónico | No; avisa | `holdings_kept_undated` + `warnings[]` |

**Decisiones de diseño.**

- **No hay forma de forzar el canónico.** Ningún flag, ni `--accept-canonical`, permite escribir una cartera más antigua. Si algún día hace falta, se decide aparte.
- **El empate se conserva.** El encargo decía «en los demás casos, conservarla». Lo cuento aparte (`holdings_kept_same_date_tie`) porque la pasada muestra que es el caso más numeroso, y casi todo es la misma cartera (§1.4).
- **La reparación de forma sí escribe.** Si la fecha y el contenido coinciden, reescribir no cambia la cartera: arregla un recuento declarado o pasa de `latest` a chunks. Tiene test propio.
- **Un árbol corrupto con chunks sobrantes y la misma fecha ya no se poda.** Antes lo hacía el test «poda chunks sobrantes». Ahora se conserva como empate, y ese test usa un canónico más reciente. Solo se poda al sustituir.

### 1.2 Tests

`npm run typecheck`: en verde. `npx vitest run`: **106 ficheros, 575 tests, en verde**. Lo pasé dos veces, la segunda después de añadir `--holdings-only`.

Tests nuevos, en el bloque `republish de carteras: gana la mas reciente`:

| Caso | Resultado esperado |
|---|---|
| Canónico más nuevo | Sustituye (`REPLACE_NEWER`) y la viva queda con la fecha nueva |
| Canónico más nuevo con menos posiciones | Sustituye: gana la fecha |
| Canónico más antiguo | Conserva (`KEEP_NEWER_LIVE`): 0 operaciones y documentos intactos |
| Viva más reciente con la forma del 28-09 (`holdings.v1.1`, `holding_name`/`holding_weight`) | Conserva |
| Misma fecha, canónico más completo | Sustituye (`REPLACE_MORE_COMPLETE`) |
| Misma fecha, canónico menos completo | Conserva (`KEEP_MORE_COMPLETE`) |
| Misma fecha, mismas posiciones, contenido distinto | Conserva (`KEEP_SAME_DATE_TIE`) |
| Misma fecha y contenido, recuento declarado mal | Repara (`REPAIR_LAYOUT`) |
| Sin cartera viva | Crea (`CREATE`) |
| Viva sin fecha | Conserva y avisa (`HOLDINGS_UNDATED … viva`) |
| Canónico sin fecha | Conserva y avisa (`HOLDINGS_UNDATED … canonico`) |
| La viva cambia entre el plan y la escritura | `HOLDINGS_CONCURRENT_MODIFICATION`, sin escribir |
| Plan manipulado (`replace: true` con decisión de conservar) | `HOLDINGS_REGRESSION_BLOCKED`, sin escribir |
| Contadores del resumen | Suma de 5 casos mezclados |
| Normalización de la fecha | `YYYY-MM-DD` y con hora valen; `2026-08`, `31/08/2026`, `''` y `null` no |

Los 6 tests anteriores de carteras siguen igual, salvo el de chunks sobrantes (§1.1).

### 1.3 Pasada en seco real contra Firestore

Comando, desde el worktree de la rama, solo lectura: sin `--write` y con `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` sin definir.
```powershell
npm run republish:fondosdb -- --input C:\Users\oanti\Proyectos\BDB\1-extractor --ids all
```

- Canónico: `1-extractor/export`, del 13-10 a las 15:30.
- Run: `republish_2026-10-14T12-16-11-767Z`, en el scratchpad de esta sesión. Los JSON de `holdings_kept.json` y `holdings_replaced.json` están copiados en la carpeta de notas compartida (§4).
- Comparado con la pasada anterior, `runs/republish_2026-10-14T11-37-40-062Z` en `2-plataforma-datos`.

| | Antes (11:37, código anterior) | Ahora (rama `carteras-mas-reciente`) |
|---|---|---|
| Carteras comprobadas | 769 | 769 |
| Distintas del canónico | 757 | 768 (ver nota) |
| **Se escriben** | **757** (833 docs + 48 borrados) | **5** (5 docs, 0 borrados) |
| Retroceden de fecha | 445 | **0** |
| Conservadas por más recientes | — | 445 |
| Conservadas por más completas (misma fecha) | — | 0 |
| Conservadas por empate (misma fecha y posiciones) | — | 318 |
| Conservadas sin fecha | — | 0 |
| Sustituidas con menos posiciones | — | 0 |

**Nota sobre 757 frente a 768.** La pasada de las 11:37 se lanzó desde la copia principal de `2-plataforma-datos`. Esa copia tiene sin commitear, de otra sesión, un cambio en `src/mappers/fondosHoldingsMapper.ts` que cambia cómo se genera el `holding_id`.
- Con ese mapper, 12 carteras coincidían con la viva. Son 9 escritas el 13-10 y 3 el 01-10, ya con el `holding_id` nuevo.
- Con el de `master`, esas 12 difieren solo en el `holding_id`. Al revés pasa con una (IE00B3Q19T94).
- Ninguna se escribe con la regla nueva: son empates. Cuando ese cambio de mapper llegue a `master`, tampoco provocará reescrituras de carteras de la misma fecha.

**Las 5 sustituciones.** Todas son `REPLACE_NEWER` y ninguna pierde posiciones.

| ISIN | Fondo | Viva | Canónico |
|---|---|---|---|
| IE00B0M62Q58 | iShares MSCI World UCITS ETF USD (Dist) | 16-07-2026, 10 | 24-09-2026, 10 |
| IE00B3XXRP09 | Vanguard S&P 500 UCITS ETF | 30-06-2026, 10 | 31-08-2026, 10 |
| IE00B3YCGJ38 | Invesco S&P 500 UCITS ETF | 31-05-2026, 1 | 31-08-2026, 1 (solo cambia la fecha) |
| IE00B4L5Y983 | iShares Core MSCI World UCITS ETF USD (Acc) | 16-07-2026, 10 | 24-09-2026, 10 |
| IE00B5BMR087 | iShares Core S&P 500 UCITS ETF USD (Acc) | 16-07-2026, 10 | 25-09-2026, 10 |

**Las 445 conservadas por más recientes.** Coincide con el análisis previo.

- **Ventaja de la viva, en meses.**

  | Meses | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 18 |
  |---|---|---|---|---|---|---|---|---|---|
  | Fondos | 32 | 250 | 122 | 18 | 14 | 3 | 2 | 3 | 1 |

  Mediana 2, p90 3, máximo 18.
- **Fecha de la viva.** 228 de agosto, 149 de julio, 56 de junio, 9 de mayo y 3 de marzo de 2026.
- **Fecha del canónico.** 236 de mayo, 113 de junio, 53 de marzo, 24 de abril, 7 de julio, y 12 de 2025 o antes.
- **Por ISIN.** 328 LU, 48 IE, 35 ES, 30 FR, 3 DE y 1 BE.
- **Cobertura.**
  - 219: top 10 en las dos.
  - 213: completa (más de 30 posiciones) en las dos.
  - 8: intermedia (11-30) en las dos.
  - 5: cambian de tramo.

**El resto del plan** no cambia con esta rama. Con `--ids all` y sin `--root-only` se reescribirían también:
- 16 raíces, todas en `fixed_income_profile`. Son las que tienen `field_provenance`: el canónico no trae el dato y la viva lo conserva, así que la reescritura no cambia nada (§3, D6).
- 15 `metrics/latest` puente.
- El `search_index`.

Además hay 19 conflictos de dueño, los mismos que antes, y 1 reclasificado (IE00B4ND3602, OTHER → ETF). Con `--holdings-only` todo eso desaparece: `--ids all --holdings-only` da 5 carteras, 0 raíces, 0 métricas y 0 `search_index` (run `republish_2026-10-14T12-21-06-794Z`).

### 1.4 Lo que destapa la pasada en seco

Nada de esto lo introduce el cambio. Son datos que ya están en la maestra y que la regla conserva.

**a) Los 318 empates.** Script de solo lectura `runs/inspect/classifyTies.ts` en el worktree, sin versionar. Compara posición a posición la viva con la que generaría el canónico.

| Qué difiere | Fondos | Escritas |
|---|---|---|
| Solo el `holding_id` | 290 | 28-09 (269), 11-07 (9), 13-10 (9), 01-10 (3) |
| Mismos nombres y pesos, otros campos (forma `holdings.v1.1` del 28-09) | 22 | 28-09 y 29-09 |
| Nombres o pesos distintos | 6 | Ver abajo |

Los 6 que difieren de verdad:
- 5 ETF escritos el 11-07, con fecha 03-07 o 09-07 y top 10: IE0002PG6CA6 VanEck Rare Earth, IE000DR59CI3 iShares Energy Storage & Hydrogen, IE000M7V94E1, IE000X59ZHE2 iShares AI Infrastructure e IE00B53L3W79. La suma de pesos difiere entre 0,17 y 7,8 puntos con la misma fecha declarada.
- LU1883342880, con 1.357 posiciones y una diferencia de 0,0002 puntos.

Conservarlas no pierde nada que el canónico tenga mejor.

**b) Vivas más recientes pero con muchas menos posiciones.**
- En 119 de las 445 la viva tiene menos posiciones que el canónico. La mediana es el 93 %.
- En 21 tiene menos del 80 %, y en 12 menos del 50 %. Ejemplos:
  - Robeco Global Consumer Trends (LU0187079347): la viva de 30-06 tiene 45 posiciones que suman el 96,6 %; el canónico de 31-05, 386 que suman el 100 %.
  - LU0320896664: 104 frente a 548.
  - LU0203975437: 116 frente a 543.

La viva suma entre el 93 % y el 99 % del peso con muchas menos líneas.
- **Origen.** 16 de las 21 son de `carteras-prioritarias` (28-09): informes semestrales en PDF que solo listan los valores identificados, sin derivados ni efectivo. Es el caso de los fondos de Robeco. Las otras 5 vienen de Morningstar: 3 de fase 2 y 2 de `tablet-carteras` (§2.1).
- **Decisión.** La regla de Óscar las conserva. Si se prefiere la completa cuando la viva es parcial, es la decisión D3.

**c) 16 árboles mixtos.** Tienen `holdings/latest` y además `holdings/manifest` con chunks.
- **11 de ellos**: la pasada del 28-09 escribió `latest` y sobrescribió el `manifest` con un documento `SINGLE_DOCUMENT`, pero dejó los chunks antiguos de la carga de las 05:48 de ese día. Quedan tres copias de la cartera, y quien sume todo el árbol ve ~300 % de pesos. Ejemplos: IE00B03HCZ61 Vanguard Global Stock Index, IE00B53H0P79, LU1883327816 y LU1362999481 (284 %, porque los chunks son de otra fecha).
- **Lo que ve el asesor.** El read model (`readmodel/firestore_client.py:274-309`) lee primero `latest`: la cartera nueva.
- **Lo que ve el republish.** Ve el árbol como `MIXED`, con la fecha del `manifest`, igual a la de `latest`. Lo conserva por más reciente.
- **Cuando el canónico sea más nuevo**, la sustitución limpia el árbol: escribe `manifest` y chunks y borra `latest`.
- **Mientras tanto**, sigue mixto. Es la decisión D7.

**d) Ninguna cartera dice de dónde viene.**
- El documento no tiene campo de fuente.
- Solo algunas posiciones llevan `source` o `raw_source`: en la copia de las 11:18, la primera posición lo lleva en 293 de 771 documentos.
- Es el motivo de la parte 2.

### 1.5 Pasos para escribir de verdad

Siguen las reglas de Óscar: copia, pasada en seco con números y aprobación explícita. Se escriben solo las 5 carteras.

1. **Código.** Ya está en `master` (`12d61cf`). La herramienta es local: no hay despliegue.
   - **Desde dónde lanzar los pasos 3 y 4.** La copia principal tiene sin commitear el cambio de `holding_id` de otra sesión en `fondosHoldingsMapper.ts`. Desde ahí, las 5 carteras se escribirían con los `holding_id` de ese cambio; las posiciones son las mismas (comprobado, §1.6).
   - Lánzalos desde un worktree limpio de `master` (por ejemplo el de §4, que está en `12d61cf`), o espera a que ese cambio se commitee o se descarte.
2. **Copia.**
   ```powershell
   cd C:\Users\oanti\Proyectos\BDB\2-plataforma-datos
   npm run backup:export
   ```
3. **Pasada en seco, solo carteras.** Tiene que dar exactamente esto:
   - `holdings_to_replace 5`, `holdings_to_set 5`, `holdings_to_delete 0`.
   - `root_to_republish 0`, `metrics_to_set 0` y `search_index_to_set 0`.
   - `holdings_kept_*` en 0, porque son los 5 ISIN.

   Si el extractor ha exportado entretanto, repite primero con `--ids all --holdings-only` y usa la lista de `holdings_replaced.json`.
   ```powershell
   $env:FIREBASE_PROJECT_ID="bbdd-activos-financieros"
   npm run republish:fondosdb -- --input ..\1-extractor --ids IE00B0M62Q58,IE00B3XXRP09,IE00B3YCGJ38,IE00B4L5Y983,IE00B5BMR087 --holdings-only
   ```
4. **Con la aprobación de Óscar, la escritura.**
   ```powershell
   $env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES="YES_I_UNDERSTAND_MASTER_DB_WRITES"
   npm run republish:fondosdb -- --input ..\1-extractor --ids IE00B0M62Q58,IE00B3XXRP09,IE00B3YCGJ38,IE00B4L5Y983,IE00B5BMR087 --holdings-only --write
   Remove-Item Env:\BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES
   ```
   - Escribe 5 documentos `holdings/latest` y un registro en `ingestion_runs`.
   - Cada cartera se escribe en un batch atómico, con recomprobación previa y postverificación.
5. **Verificación.**
   - Repite la pasada en seco con `--ids all --holdings-only`. Debe dar `holdings_to_replace 0` y las mismas 445 + 318 conservadas.
   - En la app, la ficha de IE00B4L5Y983 muestra la cartera a 24-09-2026.
6. **Reversión.**
   - `restore:roots` no cubre carteras.
   - Las 5 anteriores están en la copia del paso 2: son documentos `assets/{isin}/holdings/latest`, de una sola pieza.
   - Para volver atrás hay que reescribir esos 5 documentos desde la copia. No hay herramienta para esto: haría falta un script de pocas líneas, o ampliar `restore:roots` con `--holdings`.
   - El riesgo es bajo: son top 10 de ETF y la viva actual es 2-3 meses más antigua.

**Republish completo (raíces, métricas puente y `search_index`).** Es una tarea aparte; con esta rama ya no toca carteras más recientes. Las 16 raíces de renta fija se reescriben en cada pasada sin cambiar nada: ver D6.

<details>
<summary>Diff del código (src, sin tests)</summary>

```diff
diff --git a/src/loader/auditConsistency.ts b/src/loader/auditConsistency.ts
index 15504da..b26a709 100644
--- a/src/loader/auditConsistency.ts
+++ b/src/loader/auditConsistency.ts
@@ -103,7 +103,7 @@ async function main(): Promise<void> {
     const liveMissingIds: string[] = [];
     const noCanonicalIds: string[] = [];
     const canonicalInvalidIds: string[] = [];
-    const holdingsStale: Array<{ asset_id: string; reasons: string[]; expected_as_of_date: string | null; live_as_of_date: string | null }> = [];
+    const holdingsStale: Array<{ asset_id: string; reasons: string[]; decision: string; expected_as_of_date: string | null; live_as_of_date: string | null }> = [];
 
     for (let i = 0; i < candidates.length; i += 250) {
         const chunk = candidates.slice(i, i + 250);
@@ -161,6 +161,7 @@ async function main(): Promise<void> {
                         holdingsStale.push({
                             asset_id: isin,
                             reasons: holdingsPlan.reasons,
+                            decision: holdingsPlan.decision,
                             expected_as_of_date: holdingsPlan.expected_as_of_date,
                             live_as_of_date: holdingsPlan.live_as_of_date
                         });
diff --git a/src/loader/holdingsRepublish.ts b/src/loader/holdingsRepublish.ts
index c92e3d3..8c35e6e 100644
--- a/src/loader/holdingsRepublish.ts
+++ b/src/loader/holdingsRepublish.ts
@@ -26,10 +26,91 @@ export interface HoldingsTreeState {
     documents: HoldingsTreeDocument[];
 }
 
+/**
+ * Que se hace con la cartera viva cuando difiere del canonico. Regla «gana la mas reciente»
+ * (decision de Oscar, 14-10-2026): la cartera del canonico solo sustituye a la viva si es mas
+ * reciente, o si tiene la misma fecha y mas posiciones. En cualquier otro caso se conserva la viva.
+ *
+ * Motivo: la pasada «calidad de fondos fase 2» del 28-09 (output/calidad-fondos-fase2-2026-09-28,
+ * fuera de git) escribio carteras mas recientes que las del extractor. La pasada en seco del 14-10
+ * con el republish anterior habria refrescado 757 de 769 carteras y en 445 la habria hecho
+ * retroceder (mediana 2 meses, maximo 18). Hasta que el extractor sea la unica via con fuente y
+ * fecha por cartera, el republish no puede hacer retroceder ninguna, en ningun modo.
+ */
+export type HoldingsDecision =
+    /** Viva y canonico coinciden: nada que escribir. */
+    | 'UNCHANGED'
+    /** No hay cartera viva. */
+    | 'CREATE'
+    /** El canonico es de fecha posterior. */
+    | 'REPLACE_NEWER'
+    /** Misma fecha y el canonico tiene mas posiciones. */
+    | 'REPLACE_MORE_COMPLETE'
+    /** Misma fecha y mismo contenido: solo cambia como se guarda (latest/chunks, recuento declarado). */
+    | 'REPAIR_LAYOUT'
+    /** La viva es de fecha posterior: se conserva. */
+    | 'KEEP_NEWER_LIVE'
+    /** Misma fecha y la viva tiene mas posiciones: se conserva. */
+    | 'KEEP_MORE_COMPLETE'
+    /** Misma fecha, mismas posiciones y contenido distinto: no hay criterio para elegir, se conserva. */
+    | 'KEEP_SAME_DATE_TIE'
+    /** Falta la fecha en la viva o en el canonico: no se puede comparar, se conserva y se avisa. */
+    | 'KEEP_UNDATED';
+
+const WRITING_DECISIONS: ReadonlySet<HoldingsDecision> = new Set<HoldingsDecision>([
+    'CREATE',
+    'REPLACE_NEWER',
+    'REPLACE_MORE_COMPLETE',
+    'REPAIR_LAYOUT'
+]);
+
+export function decisionWrites(decision: HoldingsDecision): boolean {
+    return WRITING_DECISIONS.has(decision);
+}
+
+/** 'YYYY-MM-DD' (admite un sufijo de hora); cualquier otra cosa cuenta como sin fecha. */
+export function normalizeHoldingsDate(value: unknown): string | null {
+    if (typeof value !== 'string') return null;
+    const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value.trim());
+    if (!match) return null;
+    return Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`)) ? null : match[1];
+}
+
+type ComparableTree = Pick<HoldingsTreeState, 'mode' | 'as_of_date' | 'content_hash' | 'holdings_count'>;
+
+export function decideHoldingsRepublish(
+    expected: ComparableTree,
+    live: ComparableTree,
+    stale: boolean
+): { decision: HoldingsDecision; warning: string | null } {
+    if (!stale) return { decision: 'UNCHANGED', warning: null };
+    if (live.mode === 'NONE') return { decision: 'CREATE', warning: null };
+    const expectedDate = normalizeHoldingsDate(expected.as_of_date);
+    const liveDate = normalizeHoldingsDate(live.as_of_date);
+    if (!expectedDate || !liveDate) {
+        const missing = [!liveDate ? 'viva' : null, !expectedDate ? 'canonico' : null].filter(Boolean).join(' y ');
+        return {
+            decision: 'KEEP_UNDATED',
+            warning: `HOLDINGS_UNDATED: sin fecha valida en ${missing} (viva ${JSON.stringify(live.as_of_date)}, canonico ${JSON.stringify(expected.as_of_date)}); se conserva la viva.`
+        };
+    }
+    if (expectedDate > liveDate) return { decision: 'REPLACE_NEWER', warning: null };
+    if (expectedDate < liveDate) return { decision: 'KEEP_NEWER_LIVE', warning: null };
+    if (expected.content_hash === live.content_hash) return { decision: 'REPAIR_LAYOUT', warning: null };
+    if (expected.holdings_count > live.holdings_count) return { decision: 'REPLACE_MORE_COMPLETE', warning: null };
+    if (expected.holdings_count < live.holdings_count) return { decision: 'KEEP_MORE_COMPLETE', warning: null };
+    return { decision: 'KEEP_SAME_DATE_TIE', warning: null };
+}
+
 export interface HoldingsRepublishPlan {
     asset_id: string;
+    /** La viva difiere del canonico (fecha, contenido o forma). No implica que se vaya a escribir. */
     stale: boolean;
     reasons: string[];
+    decision: HoldingsDecision;
+    /** Se escribe la cartera del canonico. Solo si `decision` lo permite (ver decideHoldingsRepublish). */
+    replace: boolean;
+    warning: string | null;
     expected_mode: HoldingsTreeMode;
     live_mode: HoldingsTreeMode;
     expected_as_of_date: string | null;
@@ -169,10 +250,15 @@ export async function planHoldingsRepublish(
 
     const expectedPaths = new Set(expected.document_paths);
     const stale = reasons.length > 0;
+    const { decision, warning } = decideHoldingsRepublish(expected, live, stale);
+    const replace = decisionWrites(decision);
     return {
         asset_id: assetId,
         stale,
         reasons,
+        decision,
+        replace,
+        warning,
         expected_mode: expected.mode,
         live_mode: live.mode,
         expected_as_of_date: expected.as_of_date,
@@ -183,8 +269,8 @@ export async function planHoldingsRepublish(
         live_count: live.holdings_count,
         expected_chunk_count: expected.chunk_count,
         live_chunk_count: live.chunk_count,
-        set_operations: stale ? operations : [],
-        delete_paths: stale
+        set_operations: replace ? operations : [],
+        delete_paths: replace
             ? live.document_paths.filter((documentPath) => !expectedPaths.has(documentPath))
             : [],
         expected_document_paths: expected.document_paths,
@@ -227,7 +313,21 @@ export async function executeHoldingsRepublish(
     db: admin.firestore.Firestore,
     plan: HoldingsRepublishPlan
 ): Promise<HoldingsRepublishResult> {
-    if (!plan.stale) return { sets_executed: 0, deletes_executed: 0, postverify_ok: true };
+    if (!plan.replace) return { sets_executed: 0, deletes_executed: 0, postverify_ok: true };
+    if (!decisionWrites(plan.decision)) {
+        throw new Error(`HOLDINGS_REGRESSION_BLOCKED: ${plan.asset_id} (${plan.decision})`);
+    }
+
+    // La decision se tomo sobre la cartera viva que leyo el plan. Si alguien la ha cambiado
+    // despues, se para: escribir ahora podria hacer retroceder una cartera mas reciente.
+    const current = await readPersistedHoldingsTree(db, plan.asset_id);
+    const unchangedSincePlan = current.mode === plan.live_mode
+        && current.as_of_date === plan.live_as_of_date
+        && current.content_hash === plan.live_hash
+        && samePaths(current.document_paths, plan.live_document_paths);
+    if (!unchangedSincePlan) {
+        throw new Error(`HOLDINGS_CONCURRENT_MODIFICATION: ${plan.asset_id} cambio entre el plan y la escritura.`);
+    }
 
     for (const operation of plan.set_operations) validateHoldingsOperation(operation);
     for (const deletePath of plan.delete_paths) {
diff --git a/src/loader/republish.ts b/src/loader/republish.ts
index 0e04989..df715da 100644
--- a/src/loader/republish.ts
+++ b/src/loader/republish.ts
@@ -9,6 +9,9 @@
  * Enrutado por poblacion (fondo -> mapFondosDbFund, accion -> buildStockRow). Las metricas de FONDO
  * solo son de esta tuberia como PUENTE: mientras el documento vivo falte o sea el trailing de
  * Morningstar del canonico. Si ya es calculo propio de la app, no se toca (ver ownsMetrics).
+ * Las CARTERAS (holdings) siguen la regla «gana la mas reciente»: la del canonico solo sustituye a
+ * la viva si es de fecha posterior, o de la misma fecha con mas posiciones; nunca retrocede una
+ * cartera, en ningun modo (ver holdingsRepublish.decideHoldingsRepublish y holdings_kept.json).
  *
  *   # dry-run (no escribe): que se republicaria y que campos
  *   npm run republish:fondosdb -- --input "<dir>" --ids all --dry-run
@@ -17,6 +20,8 @@
  *     npm run republish:fondosdb -- --input "<dir>" --ids all --write
  *   # solo docs raiz (sin metrics, search_index ni ingestion_runs):
  *   npm run republish:fondosdb -- --input "<dir>" --ids A,B --root-only --write
+ *   # solo carteras (sin raiz, metrics ni search_index; deja el registro en ingestion_runs):
+ *   npm run republish:fondosdb -- --input "<dir>" --ids A,B --holdings-only --write
  *
  * Read-modify-write por documento: newDoc = { ...live, ...ownedOverrides }; set(newDoc) (sin merge,
  * pero construido desde el vivo => nada se pierde). Dry-run por defecto. Postverify (re-diff = 0).
@@ -34,6 +39,7 @@ import { buildFundMetricsLatest } from './metricsLatest';
 import { buildSearchIndexDocument, mergeSearchIndexDocument, SEARCH_INDEX_PATH } from './searchIndex';
 import {
     executeHoldingsRepublish,
+    HoldingsDecision,
     HoldingsRepublishPlan,
     planHoldingsRepublish
 } from './holdingsRepublish';
@@ -340,12 +346,72 @@ export function mergeMetricsPreservingRefreshOwned(expected: any, live: any): an
     return out;
 }
 
+export interface HoldingsDecisionRow {
+    asset_id: string;
+    decision: HoldingsDecision;
+    replace: boolean;
+    live_as_of_date: string | null;
+    expected_as_of_date: string | null;
+    live_count: number;
+    expected_count: number;
+    reasons: string[];
+    warning: string | null;
+}
+
+export function holdingsDecisionRow(plan: HoldingsRepublishPlan): HoldingsDecisionRow {
+    return {
+        asset_id: plan.asset_id,
+        decision: plan.decision,
+        replace: plan.replace,
+        live_as_of_date: plan.live_as_of_date,
+        expected_as_of_date: plan.expected_as_of_date,
+        live_count: plan.live_count,
+        expected_count: plan.expected_count,
+        reasons: plan.reasons,
+        warning: plan.warning
+    };
+}
+
+/** Contadores del resumen para una cartera que difiere del canonico. */
+export function countHoldingsDecision(
+    summary: {
+        holdings_to_replace: number;
+        holdings_to_set: number;
+        holdings_to_delete: number;
+        holdings_kept_newer_live: number;
+        holdings_kept_more_complete: number;
+        holdings_kept_same_date_tie: number;
+        holdings_kept_undated: number;
+        holdings_by_decision: Record<string, number>;
+        holdings_replace_newer_but_shorter: number;
+    },
+    plan: HoldingsRepublishPlan
+): void {
+    summary.holdings_by_decision[plan.decision] = (summary.holdings_by_decision[plan.decision] || 0) + 1;
+    if (plan.replace) {
+        summary.holdings_to_replace++;
+        summary.holdings_to_set += plan.set_operations.length;
+        summary.holdings_to_delete += plan.delete_paths.length;
+        if (plan.decision === 'REPLACE_NEWER' && plan.expected_count < plan.live_count) {
+            summary.holdings_replace_newer_but_shorter++;
+        }
+        return;
+    }
+    if (plan.decision === 'KEEP_NEWER_LIVE') summary.holdings_kept_newer_live++;
+    else if (plan.decision === 'KEEP_MORE_COMPLETE') summary.holdings_kept_more_complete++;
+    else if (plan.decision === 'KEEP_SAME_DATE_TIE') summary.holdings_kept_same_date_tie++;
+    else if (plan.decision === 'KEEP_UNDATED') summary.holdings_kept_undated++;
+}
+
 async function main(): Promise<void> {
     const argv = process.argv.slice(2);
     const paths = resolvePaths(argv);
     const write = hasFlag(argv, '--write');
     const onlySearchIndex = hasFlag(argv, '--only-search-index');
     const rootOnly = hasFlag(argv, '--root-only');
+    // Solo carteras: escribe exactamente lo que lista holdings_replaced.json, sin raices, metricas ni search_index.
+    const holdingsOnly = hasFlag(argv, '--holdings-only');
+    if (rootOnly && holdingsOnly) throw new Error('--root-only y --holdings-only son incompatibles.');
     // Conflictos de dueno resueltos a favor del canonico: lista de ISIN o 'all' (decision explicita).
     const acceptCanonicalArg = (getFlag(argv, '--accept-canonical') || '').trim();
     const acceptCanonical = (isin: string) => acceptCanonicalArg === 'all'
@@ -381,6 +447,7 @@ async function main(): Promise<void> {
         run_id: runId,
         write,
         root_only: rootOnly,
+        holdings_only: holdingsOnly,
         checked: 0,
         matched: 0,
         to_republish: 0,
@@ -389,9 +456,20 @@ async function main(): Promise<void> {
         // Fondos cuyo metrics/latest ya es calculo propio de la app: no se tocan.
         metrics_app_owned: 0,
         holdings_checked: 0,
+        // Carteras que difieren del canonico; de ellas, solo se escriben las de holdings_to_replace.
         holdings_stale: 0,
+        holdings_to_replace: 0,
         holdings_to_set: 0,
         holdings_to_delete: 0,
+        // Regla «gana la mas reciente» (holdingsRepublish.decideHoldingsRepublish): carteras vivas
+        // que se conservan aunque difieran. Lista en holdings_kept.json.
+        holdings_kept_newer_live: 0,
+        holdings_kept_more_complete: 0,
+        holdings_kept_same_date_tie: 0,
+        holdings_kept_undated: 0,
+        holdings_by_decision: {} as Record<string, number>,
+        // Sustituciones en las que el canonico es mas reciente pero trae menos posiciones (informativo).
+        holdings_replace_newer_but_shorter: 0,
         republished: 0,
         metrics_set: 0,
         holdings_refreshed: 0,
@@ -411,6 +489,7 @@ async function main(): Promise<void> {
         // Raices que el republish no reescribe porque perderia algo que no es suyo (ver mergeOwnedDetailed).
         ownership_conflicts: 0,
         legacy_kept: {} as Record<string, number>,
+        warnings: [] as Array<{ asset_id: string; warning: string }>,
         errors: [] as Array<{ asset_id: string; error: string }>
     };
     const plan: Array<{
@@ -429,6 +508,8 @@ async function main(): Promise<void> {
     // (mergeOwned dejaria restos de la poblacion vieja); se apartan para tratamiento manual/dedicado.
     const reclassified: Array<{ asset_id: string; from: string; to: string }> = [];
     const ownershipConflicts: Array<{ asset_id: string; population: string; paths: string[]; drift: string[] }> = [];
+    // Una fila por cartera que difiere del canonico: las que se escriben y las que se conservan.
+    const holdingsDecisions: HoldingsDecisionRow[] = [];
 
     if (!onlySearchIndex) for (let i = 0; i < candidates.length; i += 250) {
         const chunk = candidates.slice(i, i + 250);
@@ -493,8 +574,8 @@ async function main(): Promise<void> {
             // fuente de ninguna. Los fondos siguen igual: sus metricas SI son
             // suyas, copiadas de Morningstar.
             const metricsLive = !rootOnly && metricsSnaps[j].exists ? (metricsSnaps[j].data() || {}) : null;
-            const metricsOwned = ownsMetrics(isStock, rootOnly, metricsLive);
-            if (!isStock && !rootOnly && !metricsOwned) summary.metrics_app_owned++;
+            const metricsOwned = !holdingsOnly && ownsMetrics(isStock, rootOnly, metricsLive);
+            if (!isStock && !rootOnly && !holdingsOnly && !metricsOwned) summary.metrics_app_owned++;
             expectedMetrics = metricsOwned ? buildFundMetricsLatest(expected) : null;
             // El payload owned debe validar su contrato (seguridad).
             const contract = validateCurrentRoot(expected, isStock);
@@ -511,7 +592,7 @@ async function main(): Promise<void> {
                 reclassified.push({ asset_id: isin, from: String(live.asset_type), to: String(expected.asset_type) });
                 continue;
             }
-            let rootDrift = ownedDrift(expected, live);
+            let rootDrift = holdingsOnly ? [] : ownedDrift(expected, live);
             let merged: MergeOwnedResult | null = null;
             if (rootDrift.length > 0) {
                 try {
@@ -534,12 +615,14 @@ async function main(): Promise<void> {
                     holdingsPlan = await planHoldingsRepublish(db, isin, records, new Date().toISOString());
                     if (holdingsPlan.stale) {
                         summary.holdings_stale++;
-                        summary.holdings_to_set += holdingsPlan.set_operations.length;
-                        summary.holdings_to_delete += holdingsPlan.delete_paths.length;
+                        countHoldingsDecision(summary, holdingsPlan);
+                        holdingsDecisions.push(holdingsDecisionRow(holdingsPlan));
+                        if (holdingsPlan.warning) summary.warnings.push({ asset_id: isin, warning: holdingsPlan.warning });
                     }
                 }
             }
-            const holdingsDrift = holdingsPlan?.stale
+            // Solo cuenta como deriva lo que se va a escribir: una cartera viva conservada no se toca.
+            const holdingsDrift = holdingsPlan?.replace
                 ? holdingsPlan.reasons.map((reason) => `holdings.${reason}`)
                 : [];
             if (rootDrift.length === 0 && metricsDrift.length === 0 && holdingsDrift.length === 0) {
@@ -564,7 +647,7 @@ async function main(): Promise<void> {
                 operations: [
                     ...(rootDrift.length > 0 ? ['root:set_owned'] : []),
                     ...(metricsDrift.length > 0 ? ['metrics:set_complete'] : []),
-                    ...(holdingsPlan?.stale ? ['holdings:set_complete'] : []),
+                    ...(holdingsPlan?.replace ? ['holdings:set_complete'] : []),
                     ...(holdingsPlan?.delete_paths.length ? ['holdings:delete_obsolete'] : [])
                 ],
                 drift_fields: [...new Set([
@@ -606,7 +689,7 @@ async function main(): Promise<void> {
                         const afterMetrics = (await db.doc(`assets/${isin}/metrics/latest`).get()).data() || {};
                         if (metricsOwnedDiff(expectedMetrics, afterMetrics).length === 0) summary.postverify_ok++; else summary.postverify_failed++;
                     }
-                    if (holdingsPlan?.stale) {
+                    if (holdingsPlan?.replace) {
                         const result = await executeHoldingsRepublish(db, holdingsPlan);
                         summary.holdings_refreshed++;
                         summary.holdings_set += result.sets_executed;
@@ -620,7 +703,7 @@ async function main(): Promise<void> {
         }
     }
 
-    if (!rootOnly) {
+    if (!rootOnly && !holdingsOnly) {
         const searchIndexUpdatedAt = new Date().toISOString();
         const searchIndexIncoming = buildSearchIndexDocument(pkg, stockRowByIsin, searchIndexUpdatedAt);
         const searchIndexSnap = await db.doc(SEARCH_INDEX_PATH).get();
@@ -664,7 +747,7 @@ async function main(): Promise<void> {
         }
     }
 
-    if (write && !rootOnly) {
+    if (write && !rootOnly && !holdingsOnly) {
         try {
             await reconcileSearchIndexLive(db, true);
         } catch (e: any) {
@@ -680,7 +763,11 @@ async function main(): Promise<void> {
     fs.writeFileSync(path.join(outDir, 'republish_plan.json'), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
     fs.writeFileSync(path.join(outDir, 'reclassified.json'), JSON.stringify(reclassified, null, 2) + '\n', 'utf-8');
     fs.writeFileSync(path.join(outDir, 'ownership_conflicts.json'), JSON.stringify(ownershipConflicts, null, 2) + '\n', 'utf-8');
+    fs.writeFileSync(path.join(outDir, 'holdings_replaced.json'), JSON.stringify(holdingsDecisions.filter((row) => row.replace), null, 2) + '\n', 'utf-8');
+    fs.writeFileSync(path.join(outDir, 'holdings_kept.json'), JSON.stringify(holdingsDecisions.filter((row) => !row.replace), null, 2) + '\n', 'utf-8');
     console.log(`[republish] write=${write} checked=${summary.checked} matched=${summary.matched} conflictos_dueno=${summary.ownership_conflicts} a_republicar=${summary.to_republish} root=${summary.root_to_republish} metrics=${summary.metrics_to_set} metricas_app=${summary.metrics_app_owned} holdings_stale=${summary.holdings_stale}/${summary.holdings_checked} search_index=${summary.search_index_to_set} (fund ${summary.by_population.fund} / stock ${summary.by_population.stock}) reclasificados=${summary.reclassified}`);
+    console.log(`[republish] carteras: se sustituyen ${summary.holdings_to_replace} de ${summary.holdings_stale} distintas; se conservan ${summary.holdings_kept_newer_live} por mas recientes, ${summary.holdings_kept_more_complete} por mas completas, ${summary.holdings_kept_same_date_tie} por empate y ${summary.holdings_kept_undated} sin fecha (holdings_kept.json)`);
+    if (summary.holdings_kept_undated > 0) console.warn(`[republish] aviso: ${summary.holdings_kept_undated} carteras sin fecha comparable; se conservan las vivas (ver warnings en republish_summary.json).`);
     if (write) console.log(`[republish] roots=${summary.republished} metrics=${summary.metrics_set} holdings=${summary.holdings_refreshed} sets=${summary.holdings_set} deletes=${summary.holdings_deleted} search_index=${summary.search_index_set} postverify ${summary.postverify_ok}/${summary.postverify_ok + summary.postverify_failed} errores=${summary.errors.length}`);
     else console.log('[republish] DRY-RUN: 0 escrituras. Revisa republish_plan.json.');
     console.log(`[republish] artefactos en ${outDir}`);
```

</details>

### 1.6 Pasada en seco después de la fusión

Pasadas de solo lectura del 14-10 a las 15:21, con `master` en `12d61cf` y el mismo canónico (`posiciones.ndjson` del 13-10 a las 15:30). Artefactos en `runs-merge/` del scratchpad.

| Pasada | Desde | Resultado |
|---|---|---|
| `--ids all --holdings-only` | Worktree limpio de `master` | 769 carteras comprobadas y 768 distintas. **5 sustituciones** (todas `REPLACE_NEWER`). Se conservan 445 por más recientes, 318 por empate, 0 por más completas y 0 sin fecha. Raíces, métricas y `search_index`: 0 |
| `--ids <los 5> --holdings-only` | Worktree limpio de `master` | 5 de 5 se sustituyen; 5 documentos, 0 borrados; nada más |
| `--ids <los 5> --holdings-only` | Copia principal (con cambios sin commitear) | Mismo plan: 5 de 5 |

- **Retrocesos: 0.** Lo comprueba un script aparte, `compare_runs.py`, que mira las fechas y los recuentos de cada sustitución.
- **Mismo resultado que antes de la fusión.** `holdings_kept.json` es idéntico al de la pasada de las 12:16.
- **El documento depende de la copia desde la que se lance.**

  | Copia | `holding_id` de las dos primeras posiciones de IE00B4L5Y983 |
  |---|---|
  | `master` limpio | `503c16db83602707`, `86a3284edc126253` |
  | Copia principal | `c0f4e038e0a19f0b`, `3f7bce9a7966de72` |

  Las posiciones son las mismas. Por eso el paso 1 de §1.5 pide lanzar la escritura desde una copia limpia.

---

## 2. Parte 2: la pasada del 28-09 y cómo llevar sus fuentes al extractor (opción A)

Es un análisis de solo lectura de:
- `3-BDB-ACTIVOS_app/output/` (en particular `calidad-fondos-fase2-2026-09-28`, que abrevio `F2`);
- los planes aplicados (`*-plan.pickle.gz`, abiertos con un unpickler restringido);
- el código del extractor.

El informe detallado, con referencias `fichero:línea` y la marca de verificado o inferido en cada afirmación, está en la carpeta de notas (§4).

### 2.1 De dónde salen las carteras más recientes

**La fase 2 no usó gestoras, CNMV ni PDF para las carteras.**
- **Fuente.** Las 425 que escribió vienen de la API `sal-service` de Morningstar: `GET https://api-global.morningstar.com/sal-service/v1/fund/portfolio/holding/v2/{SecId}/data`, con `premiumNum` y `freeNum` a 10.000.
- **Cómo se obtuvo.**
  - Usó el código de la app: `fund_ingest.resolve_fund` para pasar de ISIN a SecId con el screener `lt`, y `fund_ingest._sal_get` para la descarga.
  - Tomó la clave de Secret Manager.
  - Es una API JSON: no hubo scraping ni PDF.
  - Referencias: `F2/refresh_provider.py:12-56` y `functions_python/fund_ingest.py:35,104-119,199-277`.
- **Lo que hay en `documents/` y `pages/`.** Son KID y fichas de renta fija, no carteras.

**Lectura.** El 28-09, entre las 07:22 y las 07:26 UTC, leyó 626 fondos. Eran los marcados en `meta/fund_data_quality` como `POSICIONES_ANTIGUAS`, `SOLO_POSICIONES_PRINCIPALES`, `SIN_POSICIONES` o `RENTA_FIJA_INCOMPLETA`.

| Resultado (`F2/holdings-candidates.json`) | Fondos |
|---|---:|
| Escritas (`CANDIDATE`) | **425** |
| No sustituidas: una respuesta parcial no pisa una cartera guardada de más de 10 filas (`PARTIAL_WOULD_REPLACE_FULL`, `F2/analyze_provider.py:29`) | 140 |
| Misma fecha sin más filas (`NO_IMPROVEMENT`) | 57 |
| Vacías o sin datos | 4 |

**Fecha y cobertura de las 425.** La definición de cobertura es la del propio script: completa si trae todas las filas que Morningstar declara.

| `as_of_date` | Completa | Top 10 (Morningstar suprime el resto) | Parcial | Total |
|---|---:|---:|---:|---:|
| 2025-06 | 2 | 0 | 0 | 2 |
| 2026-03 | 3 | 0 | 0 | 3 |
| 2026-05 | 8 | 1 | 0 | 9 |
| 2026-06 | 29 | 6 | 0 | 35 |
| 2026-07 | 105 | 29 | 1 | 135 |
| 2026-08 | 52 | 187 | 2 | 241 |
| **Total** | **199** | **223** | **3** | **425** |

- **Las completas** tienen una mediana de 121 posiciones y sus pesos suman el 100 %.
- **Las top 10** suman de media el 34 % del peso.
- **Gestoras más frecuentes:** BlackRock 41, Schroders 34, DWS 17, M&G 17, Nordea 15, Amundi 15, MSIM 14 e Invesco 13.

**Los 445 fondos que el republish conserva por más recientes vienen de tres pasadas del 28-09.** Los reconstruyó el agente a partir de los planes, y coinciden uno a uno con los `KEEP_NEWER_LIVE` de la pasada en seco de §1.3.

| Pasada (último escritor) | Fuente | Fondos | Cobertura en Firestore |
|---|---|---:|---|
| Fase 2 (07:46Z) | Morningstar SAL | **398** | 216 top 10 (el canónico también tiene ≤10 en esos 216), 181 completas, 1 parcial |
| `tablet-carteras` (08:26Z) | Morningstar SAL (respuestas de fase 2 aplazadas y fechas corregidas) | **29** | Parciales: recuento o fecha del resumen distintos del detalle |
| `carteras-prioritarias` (09:09Z) | Informes semestrales en PDF: Robeco 14, formato CNMV de gestoras ES 3 (Azvalor Managers, Panda y Magallanes) y Ostrum 1, desde `finect.com/doclegal` | **18** | Parciales documentales: solo valores identificados, mediana del 42 % de las filas del canónico |

**Otras pasadas que escribieron carteras.**
- **`mejora-datos-fondos` (28-09, 05:48Z).** Normalizó 797 documentos: cambió el `holding_id`, el recuento y el `updated_at`, no los datos. De ahí salen 269 de los 290 empates de §1.4 que solo difieren en el `holding_id`. El `updated_at` del 28-09 no basta para atribuir una cartera a la fase 2.
- **`completar-resto` (29-09).** Escribió 1 cartera, desde la caché del extractor.
- **`alta-robeco` (29-09).** Escribió 1 top 10, desde una ficha en PDF.
- **No escribieron carteras:** `nordea-alpha15`, `alta-river`, las `gestoras-*` (solo precios y métricas), `documentacion-fondos` y `tmp/`.
- **Sin revisar:** `almer-2026-09-27`, que tiene planes del 27-09 con 73 rutas `holdings/latest`.

**Dónde quedó la fuente.**
- **En el documento `holdings`, en ninguna parte.** La fase 2 lo escribió con `schema_version: "holdings.v1.1"`, sin el prefijo `master.`.
- **En `assets/{isin}/fund_profile/latest.holdings_review`.** Guarda `source: "Morningstar SAL"`, `response_sha256`, `as_of_date`, `available_positions`, `reported_positions`, `full_holdings_loaded` y `portfolio_suppression`. No guarda URL ni SecId.
- **En local.** La respuesta íntegra está en `F2/provider/{isin}.json`, con el SecId y `fetched_at`. `carteras-prioritarias` y `tablet-carteras` guardaron además la URL, las páginas y el `sha256` del PDF.
- **[I]** No he comprobado si `holdings_review` sigue vivo: una republicación del perfil lo habría borrado.

### 2.2 La misma pasada: riesgo y renta fija

**Las 481 `risk.sri_kid_evidence`.**
- **Origen.** 478 son de la ejecución `fund-quality-phase2-2026-09-28` y 3 de `fund-risk-reconciliation-2026-09-28`, de la misma carpeta.
- **Cómo se produjeron.**
  1. Se volvieron a descargar todos los KID enlazados: 543 preexistentes y 206 de la fase documental.
  2. Se validó que el ISIN exacto apareciera en el PDF.
  3. El SRI se leyó con **el parser del propio extractor**, `1-extractor/core/kid.py`.
- **Cuándo se escribió una evidencia.** Solo si el KID tenía menos de 12 meses y una frase explícita de clase de riesgo que coincidiera con el SRI. Se descartaron 271.
- **Campos.** `sri`, `date` (fecha impresa en el KID), `url`, `sha256`, `document_type`, `verified_isin`, `source`, `verified_at`, `verification_run` y `evidence` (la frase literal).

| Fuente del KID | Evidencias |
|---|---:|
| Espejo de Deutsche Bank España (`servicios.deutsche-bank.es`) | 210 |
| Webs de gestoras: DWS 27, Andbank 21, Invesco 20, M&G 14, Fidelity 13, Goldman Sachs 9, BlackRock 8, Candriam 6, Amundi 3, Capital Group 3 y Sunny 2 | 126 |
| Copia del productor en Finect/Morningstar (`documenttype=299`) | 96 |
| CNMV | 38 |
| AMF (GECO) | 8 |
| Allfunds | 3 |

Fechas de los KID: 301 tenían 6 meses o menos y 180 entre 6 y 12 meses a 28-09.

**Las 23 `fixed_income_profile.field_provenance`.**
- **Fase 2: 17 fondos y 48 campos.** Sobre todo `yield_to_maturity` (13), `avg_credit_quality` (11) y `modified_duration` (10), con fechas a 31-08 y 31-07. Fuentes:
  - fichas mensuales en PDF desde Finect (`documenttype=52`), leídas a mano: 11 fondos;
  - Trea: 2;
  - March AM: 2;
  - Morningstar `fixedIncomeStyle`: 2.
- **`cierre-sin-eodhd-2026-09-28`: los otros 6.** Salen de fichas a 31-08.
- **Qué guarda cada campo.** `as_of_date`, `source`, `url`, `sha256`, `verified_isin`, `checked_at`, `run_id`, `evidence` y `unit`. Lo que viene de Morningstar lleva `response_sha256`, sin URL.

Su sitio definitivo ya está decidido: `config/correcciones.json` del extractor (D4 del documento de propiedad de campos). Este análisis no lo cambia.

### 2.3 El extractor hoy

**Usa la misma fuente.**
- `morningstar_lt` pide el mismo endpoint, con los mismos parámetros (`1-extractor/fetchers/morningstar_lt.py:155`).
- De las 769 carteras del canónico, 756 salen de `sal_position`, 9 de justETF, 2 del snapshot de ETF y 2 no tienen procedencia.
- El adaptador está declarado como «API interna del sitio… No licenciada; puede cortarse sin aviso (ocurrió el 03-09)» (`core/adquisicion/registro.py:177-187`).

**Las carteras van por detrás por la caché, no por la fuente.**
- **Fechas de descarga.** Según `provenance.endpoints` de `export_bdb/*.json`, de 758 descargas de `sal_position`:
  - **635 son de julio de 2026**;
  - 2 de junio, 109 de septiembre y 12 de octubre.
- **La causa.** El TTL nominal de la familia `cartera` es de 30 días. Pero con `update --familias X`, las familias que no se piden se sirven de la caché **sin caducidad** (`core/http.py:106-107`).
- **Un ejemplo.** La actualización del 29-09 sirvió `cartera` entera desde la caché: 0 peticiones y 696 aciertos (`logs/fondosdb_20260929.log`).
- **Fecha del canónico.** Mayo (323) y junio (203) de 2026.

**La fecha no siempre corresponde a las filas.**
- **De dónde sale.** La `fecha` sale del snapshot `lt` (`morningstar_lt.py:661`). `fetchers/morningstar.py:246` busca `portfolioDate` en la raíz de la respuesta de posiciones, pero ahí no existe: está en `holdingSummary`.
- **Cuántas fallan.** En 74 de 756 fondos la fecha publicada no es la de las filas. En 59 de ellos las filas son más antiguas. Ejemplo: ES0126542036 sale a 31-05, pero sus filas son de 28-02.
- **El precedente.** Es el mismo error que cometió la fase 2 y que corrigió `tablet-carteras`. La app ya toma la fecha del detalle (`functions_python/fund_ingest.py:510-524`).

**No exporta la procedencia.**
- Cada línea de `export/posiciones.ndjson` lleva solo `isin`, `parte`, `total_partes`, `fecha` y `posiciones` (`core/exporta.py:89-91`).
- `export/manifest.json` tampoco la lleva.
- La procedencia existe, pero solo en `data/funds/{isin}.json` (`meta.procedencia`) y en `export_bdb/{isin}.json` (`provenance.fields` y `provenance.endpoints` con `fetched_at`). En ningún sitio guarda la URL ni la huella de la respuesta.

**Otras fuentes de cartera que ya tiene o le faltan.**
- **CNMV (informe semestral, FONDCART).** El adaptador `cnmv` ya lee la cartera completa con valor de mercado y la guarda en `cartera.cnmv.posiciones`.
  - `exporta.py` no la exporta.
  - Hay 85 fondos ES con ese bloque, todos a 31-12-2025: los periodos de 2026 no se han procesado.
- **Informes semestrales o anuales en PDF.** No hay adaptador.
- **Fichas de gestora.** Solo existe el adaptador de iShares (CSV), que no está en `prioridad_fuentes`, así que nunca se ejecuta.

### 2.4 Propuesta: el extractor como única vía, con fuente y fecha por cartera

La regla de la parte 1 ya hace que, en cuanto el canónico sea más reciente, la cartera se sustituya sola. Lo que falta es que el extractor llegue antes que nadie y diga de dónde sale cada cartera.

**Paso 1. Refrescar la familia `cartera` en el extractor.** No escribe en Firestore.
```powershell
cd C:\Users\oanti\Proyectos\BDB\1-extractor
python main.py update --familias cartera
```
- **Por qué basta.** Es la misma fuente que usaron las 427 carteras de fase 2 y `tablet-carteras`. **[I]** Con una descarga de octubre, el canónico pasaría a ser más reciente que la viva en casi todas.
- **Las 18 de PDF.** Probablemente también quedarían superadas por una cartera completa de Morningstar posterior a 30-06.
- **El riesgo.** Es la API no licenciada: se cayó el 03-09.
- **Antes de republicar, mirar `holdings_replace_newer_but_shorter`.** Una respuesta top 10 más nueva sustituiría a una completa más antigua: la fase 2 encontró 140 casos así. Ver D3.

**Paso 2. Fecha de las filas, no del snapshot.**
- En `fetchers/morningstar.py`, cuando las posiciones vienen de `sal_position`, tomar `cartera.fecha` del detalle: `portfolioLastestDateFooter` o, en su defecto, `holdingSummary.portfolioDate`. Es la misma corrección que ya tiene la app.
- Hacer lo mismo con `peso_top10_pct`.
- Arregla las 74 incoherentes.

**Paso 3. Procedencia por cartera, de punta a punta.**
- **Extractor.** Cada línea de `posiciones.ndjson` lleva un bloque `procedencia`, y `manifest.json` repite fuente, fecha y cobertura por fondo:
  ```json
  {"isin": "...", "parte": 1, "total_partes": 1, "fecha": "2026-09-30",
   "procedencia": {
     "fuente": "morningstar_lt", "endpoint": "sal_position", "id_fuente": "F0GBR04PDI",
     "url": null, "obtenido": "2026-10-15T04:12:00Z", "sha256_respuesta": "…",
     "fecha_de": "detalle_posiciones", "cobertura": "completa",
     "posiciones_declaradas": 386, "supresion_proveedor": false, "run_id": "…"},
   "posiciones": [...]}
  ```
- **Contrato.** `holdings.v1.2` (propuesta). Añade a `latest` y a `manifest` un objeto `provenance`, con `x-owner: plataforma`, porque lo copia la plataforma desde el canónico:

  | Campo | Tipo | Ejemplo |
  |---|---|---|
  | `source` | string, obligatorio | `morningstar_lt`, `cnmv_semestral`, `informe_gestora_pdf`, `justetf` |
  | `endpoint` | string \| null | `sal_position`, `FONDCART` |
  | `source_id` | string \| null | SecId o nº de registro CNMV |
  | `document_url` | string \| null | URL del PDF; nunca la de una API con clave |
  | `retrieved_at` | string, ISO, obligatorio | |
  | `response_sha256` | string \| null | |
  | `as_of_date_basis` | enum | `holdings_detail` \| `snapshot` \| `document` |
  | `coverage` | enum, obligatorio | `COMPLETE` \| `TOP_N` \| `PARTIAL` |
  | `declared_holdings_count` | number \| null | |
  | `provider_suppression` | boolean \| null | |
  | `extractor_run_id` | string \| null | |

  `schema_version` pasa a `master.holdings.v1.2`. Los documentos v1.1 siguen siendo válidos y se leen como de procedencia desconocida.
- **Plataforma.** `buildHoldingsOperations` copia `provenance`. `decideHoldingsRepublish` puede pasar a usar `coverage`. Por ejemplo: un `TOP_N` o `PARTIAL` más nuevo no sustituye a un `COMPLETE` más antiguo salvo que lo decida Óscar. Es la regla de la fase 2 llevada a la plataforma (D3).
- **App.** El read model puede enseñar «Cartera a 30-09-2026 · Morningstar · completa» en la ficha.
- **Las vivas actuales.** No hace falta migrarlas: las que no tengan `provenance` las sustituirá el canónico en cuanto sea más reciente. Para las 445 de hoy se podría rellenar `provenance` desde `F2/provider/*.json` y los planes. Hay que decidirlo: D5.

**Paso 4. CNMV para los fondos españoles.**
- Procesar los semestres de 2026 y exportar `cartera.cnmv.posiciones` cuando sea posterior a la de Morningstar, o más completa con la misma fecha.
- Es la cartera oficial completa, con valor de mercado.

**Paso 5. Informes semestrales en PDF (Robeco, Ostrum, Pictet/Azvalor).** Solo si, después del paso 1, siguen quedando fondos con la viva más reciente. Su cobertura es parcial por naturaleza.

**Cuando estén los pasos 1-3**, ningún script de la app tiene que volver a escribir carteras. `fund_ingest` también escribe carteras al dar de alta un fondo; se puede dejar como está (crea, no sustituye) o pasarlo por el extractor.

### 2.5 Estimación por fuente

Las estimaciones son mías y no están medidas. La cobertura se cuenta sobre las 445 carteras que hoy son más recientes en Firestore, y sobre el total del canónico (769).

| Pieza | Fondos que cubre | Trabajo estimado | Riesgo / nota |
|---|---|---|---|
| 1. Refresco de `cartera` (Morningstar SAL) | 427 de los 445 directamente; las 756 de SAL del canónico | 0,5 días: ejecutar, revisar el log y repetir la pasada en seco del republish | API no licenciada. Revisar las sustituciones top 10 sobre completas (D3) |
| 2. Fecha del detalle de posiciones | 756; corrige 74 | 0,5-1 día con tests | Puede adelantar o atrasar fechas: la pasada en seco lo enseña |
| 3. Procedencia: extractor + contrato `holdings.v1.2` + plataforma + read model | 769 | 2,5-3,5 días: extractor 1, contrato y plataforma 1-1,5, app 0,5-1 | Cambio de contrato: mismo orden que en propiedad de campos (plataforma → app → backup → republish) |
| 4. CNMV semestral para fondos ES | 85 fondos ES; 3 de los 445 | 1,5-2 días | Hay que fijar qué gana entre CNMV y Morningstar |
| 5. Informes semestrales en PDF | 15-18 de los 445 | 3-5 días y mantenimiento por gestora | Cobertura parcial; seguramente innecesario después del paso 1 |
| Fichas de gestora en PDF (top N) | 2 (Eleva, alta de Robeco) | No compensa | — |

---

## 3. Decisiones para Óscar

| # | Decisión | Recomendación |
|---|---|---|
| D1 | ¿Escritura de las 5 carteras de ETF con `--holdings-only` (§1.5), lanzada desde una copia limpia de `master`? La fusión ya está hecha. | Sí. Son 5 top 10 de ETF de 2-3 meses más nuevos, sin pérdida de posiciones. |
| D2 | ¿Refrescar ahora la familia `cartera` del extractor (§2.4, paso 1)? | Sí, antes de cualquier republish completo. Es lo que convierte al extractor en el más reciente. No escribe en Firestore. |
| D3 | Regla de cobertura: ¿una cartera top 10 o parcial más nueva puede sustituir a una completa más antigua? ¿Y debe conservarse una viva parcial (las 21 de §1.4 b) frente a una completa un mes más antigua? | Ahora: dejar la regla como está y revisar `holdings_replace_newer_but_shorter` en cada pasada en seco. Con la procedencia (paso 3): que lo completo gane a lo parcial salvo que pase de un umbral de antigüedad, igual que hizo la fase 2. |
| D4 | ¿Aprobar el contrato `holdings.v1.2` con `provenance`, con dueño la plataforma? | Sí. Es la pieza que falta para la opción A. |
| D5 | ¿Rellenar `provenance` en las 445 vivas actuales desde los artefactos del 28-09? | No. Que las sustituya el canónico después del paso 1. Solo merecería la pena si alguna sigue siendo más reciente después. |
| D6 | Las 16 raíces de renta fija que el republish reescribe en cada pasada sin cambiar nada (`field_provenance` conservado) | Corregir `ownedDrift` para que no cuente lo que conserva `keepLegacyAppData`. Es una tarea pequeña de la plataforma. |
| D7 | Los 16 árboles de carteras mixtos (§1.4 c) | Limpiarlos con una pasada propia (en seco, copia y aprobación) que deje solo la forma buena, o esperar a que el canónico más nuevo los sustituya. |
| D8 | ¿Exportar las carteras CNMV de los fondos ES (paso 4)? ¿Adaptador de informes en PDF (paso 5)? | CNMV sí, después de los pasos 1-3. Los PDF, no por ahora. |

Por otro lado, la copia principal de `2-plataforma-datos` tiene sin commitear un cambio de otra sesión en `fondosHoldingsMapper.ts`, que cambia el `holding_id`. Con esta rama ese cambio ya no provoca reescrituras de carteras. Pero conviene que entre en `master` después de esta rama, para que las pasadas en seco de las dos copias den lo mismo (§1.3).

---

## 4. Artefactos

**Código.**
- `2-plataforma-datos`, rama `carteras-mas-reciente`, commit `12d61cf`. Worktree en el scratchpad de esta sesión:
  `C:\Users\oanti\AppData\Local\Temp\claude\C--Users-oanti-Proyectos-BDB-3-BDB-ACTIVOS-app--claude-worktrees-angry-shtern-141679\3f9c6528-7cb2-4a7a-a915-e1b08652c08a\scratchpad\pc`
- Tiene un enlace a `node_modules` de la copia principal. Para quitarlo:
  ```powershell
  git -C C:\Users\oanti\Proyectos\BDB\2-plataforma-datos worktree remove --force <ruta>
  ```
  La rama se conserva.

**Datos.** Carpeta de notas compartida, `carteras-fondos-dueno/`:
- `republish_summary.json`, `holdings_replaced.json` y `holdings_kept.json` de la pasada en seco `republish_2026-10-14T12-16-11-767Z`.
- `empates_clasificados.json`: los 318 empates por tipo de diferencia.
- `fase2_fuentes_carteras.md`: el informe detallado de la parte 2.
- `fase2_carteras_por_fondo.csv`: 425 filas, con fuente, URL del endpoint, fecha, posiciones, cobertura y gestora.
- `carteras_firestore_mas_recientes_445.csv`: último escritor, fuente, fechas, ventaja y cobertura de cada uno de los 445.
