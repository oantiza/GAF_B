> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Carteras de los fondos: informe de cierre

*14-10-2026, tarde. Encargo de Óscar: «continúa hasta solucionar todo lo pendiente sin preguntar, con doble pasada, y al terminar auditoría final completa e informe». Este informe cierra la parte de carteras. El análisis de partida está en [CARTERAS_FONDOS_DUENO_2026-10-14.md](CARTERAS_FONDOS_DUENO_2026-10-14.md).*

---

## 0. Resumen

1. **Código: todo hecho, verificado dos veces y fusionado en `master` de los tres repositorios.** No hay push.
   - **Plataforma** (`d1ff201`):
     - El republish ya no puede hacer retroceder una cartera.
     - Ya no reescribe las 16 raíces de renta fija que deja igual.
     - Tiene herramientas para reparar y restaurar carteras.
     - Las carteras llevan procedencia (`master/holdings.v1.2`) y hay una regla para que una cartera parcial más nueva no pise una completa reciente.
   - **Extractor** (`74306ee`): exporta la procedencia de cada cartera.
   - **App** (`ee2c323`): caché de contratos al día.
2. **Firestore: no he escrito nada.** El clasificador de Claude Code bloquea las escrituras en la maestra, también con el permiso general de Óscar. Las dejo preparadas en §4, con copia, pasada en seco y número exacto.
   - Copia: `2026-10-14T13-25-46-499Z`, PASS, 25.073 documentos.
3. **Pasada en seco final contra Firestore** (`master` `d1ff201`, canónico del 13-10):
   - Carteras: 5 sustituciones y **0 retrocesos** (antes, 757 escrituras y 445 retrocesos).
   - Raíces: **0** a reescribir (antes, 16 cada vez).
   - Árboles mixtos: 16, todos reparables sin cambiar lo que ve el asesor.
4. **Lo que falta no depende de esta sesión.** Para la escritura de carteras con el extractor al día hace falta:
   1. Que termine el refresco del extractor que lanzó la sesión principal.
   2. Que se fusione su rama `fecha-cartera-y-dividendos` (la fecha de la cartera sale de las filas, no del snapshot).
   3. Regenerar el canónico.

   Sin el paso 2 no se debe republicar: en unos 59 fondos la fecha declarada es más nueva que la de las filas.

   La regla D3 definitiva la está terminando la sesión principal en `mejoras-republish-2026-10-14`, encima de este `master` (§3.3.8).
5. **Riesgo vigilado.** El `update --all` de la sesión principal también pasa por las 74 acciones. Su bloque `fundamentales` no lo genera ningún código del repositorio y no está protegido. Hay copia intacta y aviso enviado (§5).

---

## 1. Qué se ha hecho

### 1.1 Plataforma (`2-plataforma-datos`, `master` `d1ff201`)

| Commit | Qué hace |
|---|---|
| `12d61cf` | **Regla «gana la más reciente».** La cartera del canónico solo sustituye a la viva si es de fecha posterior, o de la misma fecha con más posiciones.<br>Contadores y listas por motivo (`holdings_kept.json`, `holdings_replaced.json`).<br>Antes de escribir vuelve a leer la viva, y rechaza un plan manipulado.<br>Modo `--holdings-only`. |
| `866a3dc` | **D6.** `rewriteDrift` compara lo que se escribiría (el documento fusionado) con lo vivo, no el canónico crudo. Las 16 raíces de renta fija con `field_provenance` dejan de reescribirse en cada pasada y dejan de fallar el postverify. |
| `3b98f03` | **`holdings:repair` y `holdings:restore`.**<br>Repair arregla los árboles mixtos (`latest` y `manifest` a la vez). Solo actúa si lo que lee la app es idéntico antes y después: la comprobación imita `readmodel/firestore_client._load_holdings_uncached`.<br>Restore deja `assets/{id}/holdings` como en una copia de `backup:export`, que `restore:roots` no cubría. |
| `d1ff201` | **Procedencia de cartera.**<br>`master/holdings.v1.2` es v1.1 más `provenance` opcional: fuente, endpoint, id, fecha de obtención, huella, de dónde sale la fecha, cobertura y posiciones declaradas.<br>`canonical/fondosdb-holdings.v1` declara `procedencia` por línea.<br>**Regla D3:** si el canónico es más reciente pero declara `TOP_N` o `PARTIAL`, y la viva tiene más posiciones (más de 10) y como mucho 6 meses menos, se conserva la viva (`KEEP_COMPLETE_OVER_PARTIAL`). Sin procedencia, manda la fecha.<br>La procedencia no cuenta para decidir si una cartera está desfasada: un refresco con la misma cartera no reescribe. |

### 1.2 Extractor (`1-extractor`, `master` `74306ee`)

**Bloque `procedencia` por línea en `export/posiciones.ndjson`.** Lleva:
- fuente y endpoint (de `meta.procedencia`);
- SecId;
- `fetched_at`;
- sha256 de la respuesta guardada;
- de dónde sale la fecha;
- cobertura;
- posiciones declaradas y supresión.

**Cobertura.** Usa la regla de la pasada de calidad del 28-09: «completa» si cada página trae todas las filas que declara y el total cuadra con el resumen. Contra las 425 respuestas de aquella pasada coincide en 221 de 223 top 10 y en 183 de 199 completas; las diferencias son de fechas distintas.

**Lo que no toca.** `fetchers/morningstar.py` (la fecha de la cartera) lo tiene la sesión principal en su rama `fecha-cartera-y-dividendos`.

### 1.3 App (`3-BDB-ACTIVOS_app`, `master` `ee2c323`)

- **Caché de contratos** sincronizada con `holdings.v1.2`. Sin ella, `check:contracts` y el predeploy fallarían.
- **La app solo lee carteras.** Su alta de fondos escribe v1.1, que valida en v1.2. No hace falta desplegar.

### 1.4 Datos

- **Firestore.** Ninguna escritura.
  - Copia nueva `2026-10-14T13-25-46-499Z`, PASS, 25.073 documentos y 18 usuarios, sin `meta/backup_status`.
  - Está en `2-plataforma-datos/data/backups/`, idéntica a la del worktree.
- **Extractor.**
  - Copias de `data/funds`, `export` y `export_bdb` en `reports/baseline/*_20261014_pre_cartera`, de las 15:57 y comprobadas idénticas.
  - Mi refresco de cartera lo paré al ver que la sesión principal tenía en marcha el suyo (`update --all --familias cartera`, desde las 14:59), para no tener dos procesos escribiendo en `data/funds`.

---

## 2. Verificación (doble pasada)

| Cambio | 1.ª pasada | 2.ª pasada |
|---|---|---|
| Regla «gana la más reciente» | 15 tests propios | En seco contra Firestore: 5 sustituciones y 0 retrocesos, comprobado aparte con `compare_runs.py` |
| `--holdings-only` | En seco con `--ids all`: 0 raíces, 0 métricas, 0 índice | En seco con los 5 ISIN, desde `master` limpio y desde la copia principal: mismo plan |
| D6 (`rewriteDrift`) | 4 tests: legado conservado, otro campo, clave obsoleta y postverify | En seco contra Firestore: `root_to_republish` 16 → 0 y `root_unchanged_after_merge` 16 |
| `holdings:repair` | 6 tests: los dos patrones, sin regla, chunks que no cuadran, árbol no mixto y cambio concurrente | En seco contra Firestore: 16 mixtos, 11 + 5 reparables, 38 documentos, cuadrado con un análisis independiente en Python sobre la copia |
| `holdings:restore` | 3 tests | En seco con los 5 ETF contra la copia nueva: «iguales», así que el lector de copias cuadra con Firestore |
| `holdings.v1.2` + D3 | 11 tests: contrato, v1.1 valida en v1.2, manifest troceado, lector del paquete y 5 casos de D3 | En seco final con `d1ff201`: mismo resultado que antes, D3 inactiva porque no hay procedencia en el canónico de hoy |
| Procedencia en el extractor | 9 tests (`test_exporta_procedencia.py`) | Prototipo sobre 805 respuestas en caché frente a la fase 2 |
| Caché de contratos | `sync --check` en la app y en el extractor | Tests de contratos de la app (66) y del extractor |

**Suites completas en `master`:**

| Repositorio | Comprobaciones | Resultado |
|---|---|---|
| Plataforma | typecheck y vitest | **108 ficheros, 600 tests** |
| Extractor | pytest y ruff | **140 tests**; ruff limpio |
| App | pytest | **782 pasan, 5 omitidos** |
| App | vitest | **154 ficheros, 1.030 tests** |

Todos los ficheros tocados están en LF, y las rutas largas se manejan con `core.longpaths`.

---

## 3. Auditoría final

### 3.1 Repositorios

| Repositorio | `master` | Copia principal | Push |
|---|---|---|---|
| `2-plataforma-datos` | `d1ff201` | Cambios sin commitear de **otra sesión**: `fondosHoldingsMapper.ts` (cambia el `holding_id`), `searchIndex.ts`, `runBackupExport.ts`, `reconcileSearchIndexLive.ts` y tests. No los he tocado. | No (`origin/master` está detrás) |
| `1-extractor` | `74306ee` | `config/correcciones.json` sin commitear (de otra sesión). Rama `fecha-cartera-y-dividendos` de la sesión principal sin fusionar. | No |
| `3-BDB-ACTIVOS_app` | `ee2c323` (+ commit de estos documentos) | Limpia, salvo `.claude/launch.json` sin seguimiento | No |

### 3.2 Firestore: estado frente a la pasada en seco final (`d1ff201`, canónico del 13-10)

| Qué | Pasada en seco |
|---|---|
| Raíces a reescribir | **0** (16 sin cambios tras el merge) |
| Conflictos de dueño | 19 (D4, sin cambios) |
| Métricas puente | 15 (sesión de métricas, sin cambios) |
| Carteras | 769 comprobadas y 768 distintas. Se sustituyen **5**. Se conservan 445 por más recientes y 318 por empate. 0 sin fecha y **0 retrocesos**. |
| Árboles mixtos | 16, todos reparables, 38 documentos |
| `search_index` | 1, el de siempre |

### 3.3 Hallazgos de esta auditoría

1. **Escrituras de la maestra.** El clasificador las bloquea a Claude. Todas las escrituras de este trabajo quedan para Óscar (§4).
2. **Copia principal de la plataforma.** Tiene trabajo sin commitear de otra sesión que cambia cómo se genera el `holding_id`. Si se lanza la escritura de carteras desde ahí, se escriben con ese esquema. Hay que lanzarla desde un worktree limpio de `master`, o esperar a que esa sesión commitee.
3. **Fecha de las carteras del extractor.** No coincide con la de las filas en ~74 fondos (59 con filas más antiguas). El arreglo está hecho en la rama de la sesión principal, sin fusionar.
4. **ETF de justETF.** En 4 de los 5 ETF las posiciones salen de justETF y la fecha del snapshot de Morningstar. La procedencia nueva lo deja a la vista (`fuente: justetf`, `fecha_de: snapshot`). En top 10 de ETF el riesgo es bajo.
5. **CNMV.** La cartera oficial más reciente (`FONDCART`) es la de 2025-12: los ZIP mensuales de 2026 no traen cartera. Hoy no aporta carteras más nuevas (D8 cerrado por ahora).
6. **Dos `update` a la vez sobre `data/funds`.** El mío y el de la sesión principal estuvieron ~30 minutos en paralelo. Mismo código y misma caché; las escrituras de fichas son atómicas. Paré el mío.
7. **Las 74 acciones y el `update --all`.** Su bloque `fundamentales` (`bdb.fundamentals-summary.v1`) no lo genera ningún código del repositorio. Si `update` reescribe las fichas, puede perderse. A las 16:30 seguían intactas. Hay copia y aviso a la sesión principal (§5).
8. **Coordinación de D3.** La sesión principal sigue con D3 en la rama `mejoras-republish-2026-10-14`, encima de este `master` (`d1ff201`).
   - El commit `8701bdd` añade una regla simétrica por recuento: una cartera es «corta» si tiene menos del 80 % de las posiciones de la otra, y «mucho más antigua» si le saca más de 183 días.
   - Convive con la de procedencia de `d1ff201`.
   - Con ella, la pasada en seco da 26 sustituciones (5 más recientes + 21 vivas parciales sustituidas por el canónico completo) y 0 retrocesos de fecha en completas.
   - Esa rama tiene cambios sin commitear y no está fusionada. **La regla D3 vigente será la que fusione esa sesión.** Los números de §4.2 y §4.3 se rehacen entonces.

---

## 4. Escrituras para Óscar

Todas siguen el mismo orden: copia (ya hecha: `2026-10-14T13-25-46-499Z`), pasada en seco con el número exacto, escritura con la puerta solo en ese proceso, y verificación. Lánzalas desde una copia limpia de `master`; ese worktree es el directorio de trabajo de todos los comandos de §4.
```powershell
git -C C:\Users\oanti\Proyectos\BDB\2-plataforma-datos worktree add --detach C:\BDB-pm master
New-Item -ItemType Junction -Path C:\BDB-pm\node_modules -Target C:\Users\oanti\Proyectos\BDB\2-plataforma-datos\node_modules
cd C:\BDB-pm
```

### 4.1 Reparar los 16 árboles mixtos (ya)

No cambia lo que ve el asesor: la herramienta lo comprueba antes y después.
```powershell
$env:FIREBASE_PROJECT_ID="bbdd-activos-financieros"
npm run holdings:repair -- --ids all
```
La pasada en seco tiene que dar: `mixtos=16`, `a_reparar=16` (`DUPLICATE_MANIFEST` 11 y `POINTER_LATEST` 5), `docs_a_borrar=38` y `sin_regla_o_inseguros=0`.
```powershell
$env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES="YES_I_UNDERSTAND_MASTER_DB_WRITES"
npm run holdings:repair -- --ids all --write
Remove-Item Env:\BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES
npm run holdings:repair -- --ids all
```
La última pasada, ya en seco, debe dar `mixtos=0`.

**Reversión:**
```powershell
npm run holdings:restore -- --backup C:\Users\oanti\Proyectos\BDB\2-plataforma-datos\data\backups\2026-10-14T13-25-46-499Z --ids IE00B03HCZ61,IE00B03HD191,IE00B11XYW43,IE00B11XZ103,IE00B53H0P79,IE00B5ZW6Z28,IE00B84J9L26,IE00BF2FJG67,LU0251131362,LU0261951957,LU1362999481,LU1882475392,LU1883327816,LU1883329432,LU1883342377,LU1883342880
```
Primero en seco; con `--write` y la puerta, de verdad.

### 4.2 Las 5 carteras de ETF (opcional ya; si no, entran en la 4.3)

```powershell
npm run republish:fondosdb -- --input C:\Users\oanti\Proyectos\BDB\1-extractor --ids IE00B0M62Q58,IE00B3XXRP09,IE00B3YCGJ38,IE00B4L5Y983,IE00B5BMR087 --holdings-only
```
La pasada en seco debe dar 5 de 5, nada más. Después, la misma línea con `--write` y la puerta. La reversión es `holdings:restore` con esos 5 ISIN.

### 4.3 Carteras con el extractor al día (cuando estén las tres condiciones de §0.4)

1. **Extractor.**
   - Fusionar `fecha-cartera-y-dividendos`.
   - Regenerar desde la caché, sin red: `python main.py update <fondos y ETF> --sin-caducidad --sin-historico`.
   - Regenerar el canónico con el paso «canónico» de operaciones (`export_bdb` y `export`, mismo `package_id`).
2. **Plataforma: nueva copia y pasada en seco.**
   ```powershell
   cd C:\Users\oanti\Proyectos\BDB\2-plataforma-datos; npm run backup:export; cd C:\BDB-pm
   npm run republish:fondosdb -- --input C:\Users\oanti\Proyectos\BDB\1-extractor --ids all --holdings-only
   ```
   Hay que revisar:
   - `holdings_to_replace` y `holdings_replaced.json`;
   - `holdings_kept_complete_over_partial`, la regla D3, que ya actuará porque el canónico traerá procedencia;
   - `holdings_replace_newer_but_shorter`.
3. **Con la aprobación**, la misma línea con `--write` y la puerta. Repetir la pasada en seco: tiene que dar 0 sustituciones.

---

## 5. Pendiente fuera de esta sesión

- **Sesión principal.**
  - Fusionar su rama del extractor (`fecha-cartera-y-dividendos`) y la de la plataforma (`mejoras-republish-2026-10-14`, D3 + MEDIA-9 + H06, encima de `d1ff201`).
  - Después, repetir la pasada en seco de §4.3.
  - Al terminar su `update --all`, comprobar las 74 acciones. Si alguna ha perdido `fundamentales`, restaurar solo ese bloque desde `reports/baseline/data_funds_20261014_pre_cartera/`.
- **Otra sesión en la copia principal de la plataforma.** Su trabajo sin commitear en `fondosHoldingsMapper.ts` y `searchIndex.ts`.
- **Push.** De los tres repositorios: la plataforma tiene en `master` los commits de propiedad de campos más los de carteras.
- **15 métricas puente.** Sin republicar; son de la sesión de métricas.
- **App, opcional.** Que `fund_ingest` escriba `provenance` en las altas, y enseñar «Cartera a fecha · fuente · cobertura» en la ficha (§2.4 del análisis).
