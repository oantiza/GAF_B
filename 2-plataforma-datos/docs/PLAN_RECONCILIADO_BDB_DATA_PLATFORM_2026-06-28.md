# Plan reconciliado — BDB Data Platform

*2026-06-28. Documento de decisión **definitivo**. Funde el "Informe maestro de consolidación" (Claude, 2026-06-28) y el "Plan maestro BDB Data Platform / BDB-ACTIVOS" (ChatGPT 5.5 Pro, 2026-06-28). Supersede a ambos como plan de trabajo. El segundo cita al primero como fuente: no son visiones rivales, sino la misma dirección, y este documento toma lo mejor de cada uno.*

---

## 0. Por qué este documento

Dos análisis independientes convergieron en la misma arquitectura. Eso es señal fuerte de que el rumbo es correcto. Las diferencias son de **grado y secuencia**, no de fondo. Este plan:

- Conserva el **consenso** (la base sólida en la que ambos coinciden).
- **Adopta** del plan de ChatGPT el rigor extra que mejora el mío (diff V1/V2, gate propio, trazabilidad de runs, read models, `schema_version`).
- **Ajusta** tres puntos donde su plan arriesga sobre-ingeniería o retrasa lo urgente.

---

## 1. Consenso (lo que ambos planes comparten)

Esto está cerrado y no se rediscute:

- **Conservar `fondosdb`** como extractor; es la pieza de mayor valor.
- **Contratos como fuente de verdad**, antes de cargar más datos.
- **Un cargador único parametrizado** reemplaza los ≈90 scripts sueltos.
- **`data-platform` separado de la app.** La maestra manda; la plataforma escribe; la app **solo lee**.
- **Escrituras seguras:** dry-run por defecto, `create-only`, sin deletes, postverify obligatorio.
- **No mover carpetas como primer paso.** No cargar los 273 a ciegas. No reescribir `fondosdb`. No tocar el legacy todavía.
- **Consistencia:** lo nuevo debe igualar en forma a los 404 ya en producción; se valida con diff.

---

## 2. Qué adopto del plan de ChatGPT (mejora mi informe)

| Aporte | Qué es | Por qué lo adopto |
|---|---|---|
| **Diff V1/V2 + golden tests** | Si se mejora el mapper, se hace en paralelo con V1 como oráculo y diff campo a campo | Es la forma correcta de evolucionar el mapper **demostrando** que los 404 no cambian. Superior a mi "reusa el mapper". |
| **Gate propio de plataforma** | `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES`, distinto del gate de la app | La app nunca debe poder escribir la maestra. Separa responsabilidades de escritura. |
| **`ingestion_runs/{run_id}` + `audit/{run_id}`** | Cada carga deja plan, diff, rechazados, write_summary y postverify | Trazabilidad y recuperación. Puedes auditar "qué pasó en esta carga" meses después. |
| **Read models por consumidor** | `assetForBdb`, `assetForScreener`, `assetForReporting` + guards | La forma limpia de no exponer la maestra cruda y matar la deriva de esquema. |
| **`schema_version` + `updated_at`** en la raíz | Versionado por documento | Barato; habilita migraciones futuras. |
| **Normalización común + quality engine** | `normalizePercentage/Fraction/Date/Isin…` + reglas de calidad con cobertura y explicación | Centraliza conversiones hoy dispersas (el problema real 0.25 vs 25 vs 25%). |
| **Mover carpetas al FINAL** | El movimiento físico es la última fase | Correcto: no disrumpir rutas hasta que contratos + cargador estén probados. (Mi informe lo ponía a media tabla; cedo: va al final.) |

---

## 3. Dónde ajusto (mis reparos, reconciliados)

| Ajuste | Su plan | Mi ajuste | Por qué |
|---|---|---|---|
| **Desacoplar los 90** | Carga los 90 (Fase 9) **después** del V2 y el diff masivo (Fases 4-5) | Los 90 cargan **vía V1** a través del cargador+gate nuevos, **sin esperar al V2** | V1 hizo los 404 correctamente; los 90 son el mismo tipo de fondo. Bloquearlos detrás de meses de V2 retrasa lo único urgente. |
| **Dimensionar (YAGNI)** | 3 capas de contrato + read models por consumidor + `generated-py` desde ya | `canonical`+`master` **ahora**; `public`/read-models/`generated-py` **cuando aparezca el 2º consumidor** (el screener) | Hoy el único consumidor es BDB-ACTIVOS. No construir la generalización antes del segundo caso real. |
| **V2 quirúrgico** | "El mapper puede rehacerse entero" | V2 arregla **defectos identificados por el diff** (p. ej. mezcla pct/fracción), no reescribe por reescribir | "Rehacer entero" invita a scope creep. El valor está donde V1 tiene defectos concretos. |
| **70A opcional** | Primera acción = 70A, otro pase de diseño read-only completo | Entre los dos informes ya hay diseño suficiente; **empezamos a construir los contratos** | Un tercer pase de diseño es coste con poco retorno. |

**Defecto concreto verificable** que justifica la normalización: el propio canónico mezcla unidades — `ms.*` en porcentajes (0–100) y `portfolio_exposure_v2` en fracciones (0–1). El quality/normalize engine de V2 debe resolverlo, con test.

---

## 4. Arquitectura objetivo (consensuada)

```
C:\Users\oanti\Proyectos\BDB\
├── data-platform/
│   ├── acquire/          ← fondosdb (Python). CONSERVAR. (+ eodhd, openfigi, providers)
│   ├── contracts/        ← canonical/ + master/ AHORA ; public/ + generated-* DESPUÉS
│   ├── ingest/           ← readers, mappers (V1 ahora, V2 después), validators, planner, writer, postverify, cli
│   ├── read-models/      ← cuando llegue el 2º consumidor
│   ├── runs/             ← ingestion_runs/<run_id> (plan, diff, rejected, write_summary, postverify)
│   └── docs/
├── app/  └── BDB-ACTIVOS ← SOLO lee. Importa contratos para tipar.
├── consumers/           ← screener y futuros (después)
└── _legacy/             ← BDB-FONDOS / -CORE (al final)
```

---

## 5. Secuencia de trabajo (la fusión)

Marco **[Yo]** = preparo código/esquemas/dry-runs (mi entorno no corre el toolchain TS ni escribe la maestra) y **[Tú]** = corres typecheck/tests y las escrituras gated en tu máquina.

| Fase | Qué | Quién | Salida / criterio de cierre |
|---|---|---|---|
| **F1 Contratos** | `contracts/canonical/` (fondosdb-fund, holdings) + `contracts/master/` (asset, holdings, price-series, metrics, listing) + validadores TS | [Yo] escribo · [Tú] revisas | Schemas versionados que **describen los 404 actuales** (no inventan forma nueva). |
| **F2 Cargador + gate** | Cargador único `load:fondosdb --ids … --dry-run\|--write`, reader agnóstico de fecha/recuento, planner (CREATE/UPDATE_SAFE/SKIP/BLOCKED/REEXPORT), writer create-only con gate propio + postverify | [Yo] escribo · [Tú] dry-run | Dry-run de los faltantes corre sin tocar nada. |
| **F3 Regresión + piloto** | Diff del cargador (vía V1) contra los **404 ya escritos**: debe reproducirlos sin cambios. Luego piloto de **5 activos** | [Yo] preparo · [Tú] write piloto | 0 cambios inesperados en los 404; 5 activos escritos y verificados; smoke en la app. |
| **F4 Cargar los 90** | Los 90 `quality.ok` **vía V1**, por lotes con postverify | [Yo] dry-run · [Tú] autorizas + write | 90 en la maestra, postverify OK, app los muestra. |
| **F5 Los 183** | Re-export en fondosdb → validar → cargar por lotes | [Tú] re-export · [Yo] dry-run · [Tú] write | 183 cargados; 273 cerrados. |
| **F6 Mapper V2 (paralelo)** | Side-by-side con V1 como oráculo, normalización + quality engine, **solo** donde el diff revele defectos; golden corpus | [Yo] escribo · [Tú] tests | V2 valida 100% contra schema, diff V1/V2 explicado, 0 pérdidas de holdings. **No sustituye a V1 hasta cumplir criterios.** |
| **F7 Read models / public** | Cuando llegue el 2º consumidor (screener) | — | Diferido. |
| **F8 Mover carpetas** | Crear `Proyectos\BDB\`, mover los repos, README workspace | [Tú] mueves · [Yo] preparo layout/scripts | Rutas limpias; todo bajo un padre. |
| **F9 Retirar legacy** | Archivar BDB-FONDOS/-CORE en `_legacy/` | [Tú] | Paridad confirmada. |

**Camino crítico al dolor inmediato:** F1 → F2 → F3 → **F4 (los 90)**. El V2 (F6) y todo lo demás van en paralelo o después, sin bloquear la carga.

---

## 6. Reglas del writer (consensuadas)

`dry-run` por defecto · `write` solo con el gate explícito de plataforma · `create-only` · sin deletes · allowlist de project id · batch limitado · postverify obligatorio · `write_summary` obligatorio · logs sin secretos.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Divergencia nuevos vs los 404 | Contrato `master` describe los 404; diff de regresión en F3; carga vía V1. |
| Escritura accidental en la maestra | Gate propio de plataforma; dry-run; create-only; postverify; **tú** ejecutas. |
| Sobre-ingeniería retrasa los 90 | Desacople: los 90 por el camino crítico F1-F4; V2 y capas públicas diferidas. |
| Rehacer el mapper pierde conocimiento | V1 como oráculo; V2 solo por equivalencia con diff. |
| Mover carpetas rompe rutas/IDE | Al final, tras contratos+cargador estables; con backup. |
| Corrupción índice git (Windows) | Receta conocida; no commitear desde el mount; `tsc -b` como typecheck real. |

---

## 8. Lo inmediato

Arranco **F1 (contratos)**. Empiezo por los esquemas que describen la realidad actual —el canónico de `fondosdb` y la forma maestra de los 404— para que el contrato **documente lo que ya hay**, no una forma nueva. Verifico contra un documento vivo de la maestra antes de fijarlos.
