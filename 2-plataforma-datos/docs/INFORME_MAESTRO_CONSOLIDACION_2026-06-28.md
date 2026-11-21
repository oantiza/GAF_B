# Informe maestro — Consolidación de la plataforma de datos BDB

*Preparado el 2026-06-28. Documento técnico de decisión. Define la situación actual, el diagnóstico, qué se conserva y qué se reescribe (y por qué), la arquitectura objetivo y el plan por fases. Pensado para revisarlo **antes** de empezar a construir.*

---

## 0. Resumen ejecutivo

El sistema BDB funciona y tiene piezas de mucho valor, pero está **disperso en dos carpetas padre** y su capa de ingesta está **sobre-ingenierizada** (≈90 scripts de un solo uso, valores hardcodeados) hasta el punto de que cargar fondos nuevos —algo que debería ser un comando— se ha vuelto un viacrucis. Ese es el dolor que acabas de sufrir, y la causa de la familia de bugs "el dato está pero no sale".

**La recomendación, en una frase:** conservar el extractor (`fondosdb`) y la **lógica de mapeo** ya probada en producción, **formalizar el contrato de datos** (hoy implícito y triplicado), **reconstruir limpia la orquestación** en un único cargador parametrizado, y **juntarlo todo bajo un solo padre**. No es reescribir por reescribir: es quitar el andamiaje de investigación que ya cumplió su función y dejar una tubería reproducible.

**El principio rector** —y el porqué de fondo de casi todas las decisiones— es **consistencia**: los 273 fondos que faltan deben quedar en la maestra con la **misma forma exacta** que los 404 que ya están en producción. Cualquier decisión que arriesgue que los nuevos diverjan de los viejos es, por definición, peor; aunque suene a "hacerlo más a fondo".

---

## 1. Situación actual

### 1.1 Las piezas

| Proyecto | Carpeta hoy | Rol | Tech |
|---|---|---|---|
| **fondosdb** | `Proyectos\DATOS FONDOS\fondosdb` | **Adquirir** el máximo de datos por activo (Morningstar / CNMV / justETF / gestoras; históricos vía EODHD) | Python |
| **BBDD-ACTIVOS-FINANCIEROS** | `Documents\BBDD-ACTIVOS-FINANCIEROS` | **Ingerir**: mapea el canónico y escribe la maestra con write-gates (contract-first) | TypeScript |
| **BDB-ACTIVOS** | `Documents\BDB-ACTIVOS` | **La app**: lee la maestra y la presenta | React + functions_python |
| **BDB-FONDOS / -CORE** | `Documents\BDB-FONDOS…` | **Legacy**: el origen del clon | mixto |

### 1.2 El flujo de datos real

```
fondosdb (fetch)
   └─ export_bdb/{ISIN}.json   ← canónico, 1 fichero por activo  (≈574)
   └─ export/fondos.ndjson     ← "universal" (rentabilidad, riesgo, ESG…)
   └─ export/posiciones.ndjson ← holdings (cartera) por fondo
        │
        ▼
BBDD-ACTIVOS-FINANCIEROS (ingesta)
   └─ reader → mapper (canónico → asset) → dry-run → write-gate
        │
        ▼
Maestra Firestore  bbdd-activos-financieros
   └─ assets/{ISIN}                 ← documento raíz
   └─ assets/{ISIN}/holdings/latest ← (o manifest+chunks si es grande)
   └─ assets/{ISIN}/price_series/…  ← históricos (EODHD)
   └─ assets/{ISIN}/metrics/latest  ← métricas derivadas
        │
        ▼
BDB-ACTIVOS (app)  → SOLO lee la maestra
```

### 1.3 La maestra (esquema real)

La maestra es la **fuente de verdad**. Cada activo es `assets/{ISIN}` con subcolecciones (`holdings`, `price_series`, `metrics`, `listings`). El problema no es el esquema —es razonable— sino que **no está escrito en ningún sitio único**: vive implícito en tres lugares a la vez (el adaptador de fondosdb, el mapper de la ingesta y el lector de la app). Cuando uno de los tres asume algo distinto, aparece un bug.

### 1.4 Estado de los datos (según la auditoría previa)

| Métrica | Valor |
|---|---|
| Fondos fetcheados en fondosdb | ≈758 |
| Canónicos en `export_bdb` | ≈574 |
| Cargados en la maestra (lote inicial) | 404 |
| **Faltan en la maestra** | **273** |
| └─ listos para cargar ya (canónico + `quality.ok`) | 90 |
| └─ necesitan re-export de fondosdb | 183 |
| └─ sin datos aprovechables | 0 |

La conclusión clave: **no falta dato**. Los 90 están listos; los 183 solo necesitan que fondosdb los vuelva a exportar. El cuello de botella es **operativo** (empaquetado y orquestación), no de datos.

---

## 2. Diagnóstico técnico

### 2.1 Lo que está bien (y hay que conservar)

**El extractor `fondosdb` es la joya.** La profundidad por activo es real, no nominal. Una muestra (Bestinfond FI, `ES0114673033`) trae, en un solo fichero canónico: asignación de activos, sectores, regiones (macro y detalle), estilo de renta variable (market cap × value/blend/growth), perfil de renta fija (duración, calidad crediticia, vencimientos, cupones, YTW), top-10 de posiciones, costes (TER, comisión, MiFID), objetivo del fondo, una clasificación `v2` con confianza y trazabilidad de fuentes, y bloques de `quality`/`validation` con su propio diagnóstico (`calidad_fondosdb: ALTO`). Eso es exactamente lo que un buen sistema necesita por activo, y reproducirlo costaría meses.

**La lógica de mapeo está probada en producción.** `mapFondosDbFund()` no es trivial: valida ISIN con dígito de control (Luhn), decide rechazo/revisión por reglas explícitas (RF crítica sin duración/yield/calidad, calidad `BAJO`, duplicados, asignación sospechosa), y normaliza a una forma estable (`asset_id`, `identity`, `classification`, `product`, `costs`, `performance`, `risk`, `sustainability`, `portfolio_exposure`, `fixed_income_profile`, `quality`, `source_metadata`). **Esa lógica es la que produjo los 404 que ya están en producción.**

**La app es un consumidor read-only sano.** Lee la maestra y la presenta; no escribe. Su separación es correcta.

### 2.2 Lo que está mal (el dolor real)

**Orquestación sobre-ingenierizada.** El `package.json` de la ingesta tiene **≈90 scripts**, la mayoría de un solo uso: `vanilla-batch-selection`, `vanilla-batch-2`, `vanilla-batch-3`, pilots por ticker (`aapl-…`, `spy-…`, `qqq-…`, `iwda-…`), correcciones puntuales de OpenFIGI, decenas de `preview:*` y `closeout-audit`. Fue un andamiaje de investigación para sacar el primer lote con cuidado extremo. Cumplió su función, pero hoy **nadie sabe qué comando corre para cargar un fondo nuevo**, y ese es justo tu problema.

**Acoplamiento hardcodeado que bloquea cargas nuevas.** El reader exige un paquete con un manifiesto de **fecha fija** (`manifest_fondosdb_to_bbdd_activos_2026-06-12.json`) y un **recuento exacto** (`importableFiles.length !== 496`). Un export fresco de fondosdb —con otra fecha y otro número de ficheros— **falla en validación** (`BLOCKED_SAFE`). Esto no es seguridad, es fragilidad: ata la tubería a un instante concreto del pasado.

**Deriva de esquema (schema drift).** Como el contrato está implícito en tres sitios, derivan entre sí. Síntomas que ya hemos visto: el falso `MISSING_HOLDINGS` (el dato de holdings estaba, pero la ruta de lectura lo pedía sin máscara → "no está"), y el descuadre de colecciones (`fondos` vs `assets`: el subidor Python de fondosdb escribe a una colección `fondos`, mientras la maestra real es `assets`). Son **la misma causa raíz**: nadie valida contra un contrato único.

**Dispersión física.** Dos carpetas padre (`Documents` y `Proyectos`) para una sola tubería lógica. Difícil de encontrar y de operar; el "salto" entre repos es donde se pierde el hilo.

---

## 3. Principios de diseño (el porqué rector)

1. **Consistencia primero.** Es un sistema de datos: lo que entra nuevo debe ser idéntico en forma a lo que ya está. Por eso se **conservan las decisiones de mapeo**; re-derivarlas a ciegas arriesga que los 273 nuevos queden con otra forma que los 404 viejos — el peor resultado posible.
2. **Una sola fuente de verdad.** La maestra manda. Un único contrato la describe. Quien produce (data-platform) escribe; quien consume (app) lee. Nadie más escribe.
3. **Seguridad por diseño.** Toda escritura pasa por gate: dry-run obligatorio, `create-only`, idempotente, autorización explícita. Nunca borra.
4. **Reproducibilidad.** Cargar fondos = **un comando**, agnóstico de fecha y de recuento. Si hay que repetirlo dentro de seis meses, funciona igual.
5. **Separación de responsabilidades.** El productor de datos y la app evolucionan a ritmos y riesgos distintos; se mantienen separados aunque convivan bajo un mismo padre.

---

## 4. Arquitectura objetivo

**Un solo padre. Tres capas. Un contrato. Una fuente de verdad.**

```
C:\Users\oanti\Proyectos\BDB\
├── data-platform/          ← productor de la maestra
│   ├── acquire/            ← fondosdb (Python). CONSERVAR tal cual.
│   ├── ingest/             ← mappers + cargador único + gate (TS)
│   ├── contracts/          ← ESQUEMA CANÓNICO versionado (la verdad del schema)
│   └── data/               ← cachés y exports intermedios
├── app/                    ← BDB-ACTIVOS. SOLO lee. Importa contracts/ para tipar.
└── _legacy/                ← BDB-FONDOS / -CORE (archivado, solo consulta)
```

**El contrato (`contracts/`) es la pieza central.** Tiene dos capas, ambas versionadas:

- **Contrato canónico** — la forma de `export_bdb/{ISIN}.json` (salida de fondosdb = entrada de la ingesta).
- **Contrato maestro** — la forma de `assets/{ISIN}` y `holdings/*` (salida de la ingesta = entrada de la app).

La ingesta **valida contra el contrato al escribir**; la app **lo importa para tipar la lectura**. Eso cierra de raíz la familia de bugs de deriva de esquema.

**El cargador único** reemplaza los ≈90 scripts por uno solo, parametrizado:

```
cargar  --ids <lista | faltantes | quality-ok>  --dry-run | --write
```

que lee el canónico, **reusa la lógica de mapeo existente**, valida contra el contrato, hace diff contra la maestra (existentes vs faltantes) y escribe gated (`create-only`, idempotente). Agnóstico de fecha y de recuento.

---

## 5. Qué se conserva, qué se reescribe — y por qué

| Componente | Decisión | Por qué |
|---|---|---|
| **Extractor `fondosdb`** | **Conservar** tal cual | Es la joya; profundidad real por activo; superior a la fuente anterior. Reescribir = tirar meses. |
| **Lógica de mapeo** (`mapFondosDbFund`, holdings) | **Conservar** (refactor a módulo limpio, mismo comportamiento) | Produjo los 404 en producción. Re-derivarla arriesga divergencia → maestra con dos formas. Consistencia manda. |
| **Esquema de la maestra** | **Conservar** (formalizar como contrato) | La app y los 404 ya dependen de él. Solo hay que **escribirlo** en un sitio único. |
| **La app (BDB-ACTIVOS)** | **Conservar** | Consumidor read-only sano; otro ritmo de release. Solo gana el tipado desde `contracts/`. |
| **Orquestación (≈90 scripts)** | **Reescribir** → un cargador único | Andamiaje de investigación; nadie sabe qué correr; hardcodeos que bloquean cargas nuevas. |
| **Reader / empaquetado** (fecha fija + recuento 496) | **Reescribir** agnóstico de fecha/recuento | Es el bloqueo real (`BLOCKED_SAFE`) que impide cargar exports frescos. |
| **Contrato de datos** | **Nuevo** (`contracts/`) | Mayor valor; mata la familia de bugs "el dato está pero no sale". |
| **Disposición de carpetas** | **Reorganizar** (un padre) | Accesibilidad y fin del "salto" entre repos. |

**El matiz importante sobre "hacerlo a fondo":** hacerlo bien **no** significa reescribir el mapeo. En un sistema de datos, "lo mejor" es la consistencia y el contrato explícito. Lo que se reescribe es lo que está objetivamente mal (la orquestación y el empaquetado frágil); lo que codifica corrección (el mapeo) se conserva y se limpia, no se tira.

---

## 6. Plan por fases

Incremental, sin romper lo que funciona. Marco lo que **hago yo** (preparar código, esquemas, dry-runs) frente a lo que **ejecutas tú** (toolchain TS y escrituras gated corren en tu máquina, no en mi entorno).

**Fase 0 — Congelar.** Backup/ZIP de los tres repos activos. Confirmar este informe. *(Tú: backup. Yo: nada destructivo.)*

**Fase 1 — Contrato canónico (en marcha).** Extraer el esquema real (canónico + maestro) a `contracts/` versionado, a partir de los datos reales y de los tipos existentes. *(Yo: lo construyo. Tú: revisas.)* — **Es el cimiento; ya he leído las formas reales para empezar.**

**Fase 2 — Cargador único.** Construir el cargador parametrizado que reusa los mappers, valida contra el contrato y escribe gated. *(Yo: lo escribo. Tú: lo corres en dry-run.)*

**Fase 3 — Estructura consolidada.** Preparar el layout `BDB/` y el README de tubería; mover los repos bajo un padre. *(Yo: layout + scripts. Tú: ejecutas los movimientos —rompen IDE/git/rutas, deben ser tuyos.)*

**Fase 4 — Primer uso real: los 273.** Dry-run de los 90 listos → revisar → autorizas → write gated → post-verify. Después, re-export de fondosdb para los 183 y misma rutina. *(Yo: preparo y reviso. Tú: autorizas y escribes.)*

**Fase 5 — Retirar el legacy.** Confirmada la paridad, archivar BDB-FONDOS/-CORE en `_legacy/`.

**Orden por valor/esfuerzo:** Fase 1 (contrato) y Fase 2 (cargador) dan el mayor retorno y desbloquean todo lo demás. La Fase 4 (los 273) es el primer uso real y resuelve tu dolor inmediato. La Fase 3 (mover carpetas) es la más molesta pero mecánica y se hace una vez.

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Escribir en la maestra compartida sin poder probar TS en mi entorno | Dry-run obligatorio primero; `create-only` idempotente; **tú** corres el write y verificas; post-verify por activo. |
| Divergencia de forma entre nuevos y viejos | Reusar la lógica de mapeo; validar ambos contra el mismo contrato. |
| Romper rutas/IDE al mover carpetas | Los movimientos los haces tú, con backup previo; son mecánicos y de una sola vez. |
| Los 183 que necesitan re-export | Frente separado (re-correr fondosdb); **no bloquean** a los 90 listos. |
| Reaparición de corrupción del índice git (Windows) | Mantener la receta conocida; no commitear desde el mount; `tsc -b` como typecheck real. |

---

## 8. Siguiente paso

La **Fase 1 (contrato)** ya está iniciada: he leído el mapper, una muestra canónica real (Bestinfond) y los tipos autoritativos, así que tengo las dos formas (canónica y maestra) para formalizarlas en `contracts/`.

**No avanzo a construir hasta que revises este informe.** Si lo apruebas, cierro el contrato canónico y sigo con el cargador único. Si quieres, te lo entrego también en Word o PDF.

---

## Anexo A — Forma canónica real (`export_bdb/{ISIN}.json`)

Claves de primer nivel observadas en la muestra real: `generated_at`, `isin`, `name`, `currency`, `fileName`, `stableBaseName`, `report_date`, `ms{…}`, `derived{…}`, `classification_v2{…}`, `portfolio_exposure_v2{…}`, `quality{…}`, `validation{…}`, `routing{…}`.

- `ms`: bloque Morningstar (categoría, ratings, `portfolio.asset_allocation`, `sectors`, `regions.macro|detail`, `equity_style.market_cap|style`, `fixed_income.*`, `holdings_top10[]`, `holdings_stats`, `costs`, `objective`).
- `derived`: clase de activo, región primaria, sector top, banderas (`is_sector_fund`, `is_thematic`, `is_index_like`), `confidence`, `portfolio_exposure`, `style_bias`.
- `classification_v2`: `asset_type`, `commercial_type`, regiones, `market_cap_bias`, `fixed_income_type`, `strategy_tags`, `vehicle_complexity`, `classification_confidence`, `sources_used`.
- `portfolio_exposure_v2`: `asset_mix`, `equity_regions`, `sectors`, `equity_styles`, `market_caps`, `bond_types`, `credit`, `duration` (en fracciones 0–1).
- `quality` / `validation`: `ok`, `warnings[]`, `errors[]`, `diagnostics.calidad_fondosdb` (`ALTO|MEDIO|BAJO`).

## Anexo B — Forma maestra (`assets/{ISIN}`, salida del mapper)

`asset_id`, `asset_type` (`FUND|ETF|STOCK|INDEX|OTHER|UNKNOWN`), `identity{name,currency}`, `identifiers{isin}`, `listings[]`, `classification{asset_class, fondosdb_asset_class, fondosdb_asset_type, asset_subtype, region_primary, strategy_tags, confidence}`, `product{product_type, commercial_type, vehicle_complexity, fund_name, has_listing}`, `costs{management_fee_pct, ter_pct, mifid_ongoing_pct}`, `performance`, `risk`, `sustainability`, `portfolio_exposure`, `fixed_income_profile`, `quality{fondosdb_bucket, fondosdb_ok, warnings, validation_errors, review_flags, status}`, `source_metadata{…}`.

Holdings (`assets/{ISIN}/holdings/*`): `asset_id`, `source_fund_isin`, `holding_id`, `as_of_date`, `name`, `identifiers{isin,ticker}`, `holding_type`, `weight_pct`, `currency`, `sector`, `country`, `source_metadata{source, file, part, total_parts}`.

## Anexo C — Evidencia de sobre-ingeniería

El `package.json` de la ingesta declara ≈90 scripts. Familias observadas: `dryrun:*` (synthetic, manual-csv, eodhd, stocks, openfigi, fondosdb-import…), pilots por ticker (`firestore:aapl-*`, `spy-*`, `qqq-*`, `iwda-*`), lotes (`vanilla-batch-*` 1/2/3), correcciones OpenFIGI (`openfigi-schema-shape-correction-*`), y una larga cola de `preview:*` y `*-closeout-audit`. Casi todos son de un solo uso. El cargador único los sustituye por un comando parametrizado.
