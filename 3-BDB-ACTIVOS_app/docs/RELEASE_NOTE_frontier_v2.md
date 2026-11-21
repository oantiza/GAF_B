# Release note — Robust Frontier Engine v2

> **Registro histórico.** Desde el 05-11-2026 (decisión 61 de la auditoría, `docs/rediseno-2026-11/DECISIONES_AUDITORIA_2026-11-04.md`) todos los objetivos salen del motor regularizado. La rejilla se ha borrado, y con ella `BDB_ACTIVOS_ENABLE_ROBUST_FRONTIER_V2`, `VITE_BDB_ENABLE_ROBUST_FRONTIER_V2`, `_use_robust_v2`, los scripts A/B y `test_dispatch_routing.py`: lo que aquí se dice de volver a v1 ya no se puede hacer.

**Rama:** `feature/robust-frontier-v2` · **Estado:** v2 en **PRODUCCIÓN** (frontend flag ON + backend ON) desde 2026-07-01; todos los usuarios en v2. Pendiente: **smoke funcional en prod** (ejercitar el cálculo en vivo; el bundle correcto ya está desplegado).

## Qué cambia

Sustituye el motor de la **frontera histórica real** (v1: enumeración en rejilla + covarianza muestral + media histórica) por un motor robusto v2, todo detrás de flags:

- **Covarianza:** Ledoit-Wolf (OAS como fallback según la ratio T/N).
- **Retornos esperados:** media aritmética anualizada con **shrinkage James-Stein** hacia la media global. Modos alternativos: `RISK_ONLY`, `EQUAL_RETURN` (no default).
- **Solver:** CLA + fallback QP (PyPortfolioOpt). Elimina la explosión combinatoria de la rejilla.
- **Objetivo por defecto:** `TARGET_RISK` en modo `FRONTIER_PERCENTILE` — el slider 1-10 es un **percentil de la frontera factible**, no una volatilidad absoluta. `frontier_percentile = (slider − 1) / 9`.
- **Máximo Sharpe → referencia analítica**, nunca "cartera sugerida".
- **Cap de activos:** 10 → **25** (solo con v2).
- **Diagnósticos** en la respuesta: `condition_number`, `min_eigenvalue`, `T/N`, shrinkage, `effective_number_of_positions`, `hhi`, `coverage_loss_weight`, `return_signal_status`, rango de volatilidad viable, `realized_volatility`, etc.
- **Warnings:** `RETURN_SIGNAL_WEAK`, `FRONTIER_RISK_RANGE_NARROW`, `COVERAGE_LOSS_ABOVE_10PCT`, `MAX_SHARPE_UNDEFINED_FALLBACK`, `TARGET_ABSOLUTE_VOL_CLIPPED_*` (modo avanzado).

## Contrato

`portfolio-frontier.v1` **no-breaking**: todos los campos añadidos son opcionales (`methodology.*`, `diagnostics`, `target_portfolio`). Clientes existentes siguen funcionando.

## Flags (ambos OFF por defecto — activar JUNTOS)

- **Backend** (functions env): `BDB_ACTIVOS_ENABLE_ROBUST_FRONTIER_V2`
- **Frontend** (build): `VITE_BDB_ENABLE_ROBUST_FRONTIER_V2`

## Impacto en resultados (IMPORTANTE)

Los números **difieren** respecto a v1, y es esperado — v2 es más correcto:

- Ledoit-Wolf estabiliza la covarianza → **menor volatilidad** en mín-vol y máx-Sharpe (mejor diversificación, matriz bien condicionada).
- El **máximo Sharpe es una referencia**, no una recomendación: sobre serie histórica tiende a ser **optimista in-sample**. En la validación real subió hasta **Sharpe 2,14 con 25 activos** — síntoma clásico de sobreajuste. Por eso el objetivo por defecto es el percentil de riesgo, no el máx-Sharpe.
- El slider es **riesgo relativo** (posición en la frontera viable de la cartera), no una volatilidad absoluta.

## Validación

- `tsc -b` verde · `pytest test_robust_engine.py` → **9/9**.
- End-to-end por la callable real (contrato `portfolio-frontier.v1`) → OK.
- **A/B Nivel 1 sobre datos reales** (25 fondos EUR, 156 observaciones comunes, sin exclusiones):

  | N | v1 (rejilla/muestral) | v2 (Ledoit-Wolf / CLA-QP) |
  |---:|---|---|
  | 5 | min-vol 11,38%; máx-Sharpe 11,63% (sh 1,23); 651 cand; 22 ms | min-vol 11,07%; rango 11,07-11,76%; ENB 3,8 |
  | 10 | min-vol 10,68%; **85.228 cand; 7 s** | min-vol 10,10%; rango 10,10-11,43%; ENB 4,4 |
  | 19 | **rechazada (cap >10)** | min-vol 9,29%; rango 9,29-11,09%; ENB 5,6 |
  | 25 | **rechazada (cap >10)** | min-vol 4,27%; rango 4,27-12,22%; ENB 5,9 |

  **Latencia:** los ~2 s medidos son **por proceso** (cada corrida del script paga una vez el *warm-up* de cvxpy, ~1,5-2 s). En Cloud Functions **caliente**, tras la primera llamada, cada cálculo es **~0,1 s**. No citar "2 s" como latencia de request.

## Nivel 3 (preview admin-first) — PASS

Validado en canal preview (`admin-frontier-v2`) con functions en flag ON y hosting de producción intacto. Fix adicional: `CAP_COMPARE_IDS` 20 → 25 (`d1f3753`) para poder leer 25 activos en el preview.

Cestas reales (ISIN del A/B, equiponderadas) — punto "Tu objetivo" (slider 5):

| N | Cobertura | Tu objetivo | Puntos | Warnings |
|---:|---:|---|---:|---|
| 5 | 5/5 | Rent 15,88% · Vol 11,34% · Sharpe 1,23 | 6 | rango estrecho |
| 10 | 10/10 | Rent 14,75% · Vol 10,68% · Sharpe 1,20 | 10 | — |
| 19 | 19/19 | Rent 15,46% · Vol 9,88% · Sharpe 1,37 | 8 | — |
| 25 | 25/25 | Rent 14,32% · Vol 8,96% · Sharpe 1,38 | 10 | — |

- Caso 25: 25/25 activos, rango viable 4,3%–13,5%, sin exclusiones. Máx. Sharpe etiquetado "referencia": Vol 4,38% / Sharpe 2,14 — coincide *exacto* con el A/B offline (motor determinista; sobreajuste reproducido).
- "Rango estrecho" solo en N=5, consistente con el rango 11,07–11,76% del A/B.
- **No-regresión v1**: canal live sin slider ni "Tu objetivo"; 5 activos MAX_SHARPE = mismos números que hoy; cap live >10 rechaza limpio ("Maximo 10 activos por peticion").
- Subprueba abierta (menor): el arrastre del slider vía automatización no dispara el `onChange` de React (limitación del harness, no bug); control y rango viable presentes. Cierre: arrastre manual o inyección del evento `input` con el setter nativo.

## Rollout (gate)

1. **Nivel 1** — A/B offline sobre datos reales: **hecho**.
2. **Nivel 2** — UI preview (copy/layout): **hecho**.
3. **Nivel 3** — preview admin-first end-to-end: **PASS** (sección anterior).
4. **Rollout total** — **EJECUTADO** (deploy solo hosting con `VITE_BDB_ENABLE_ROBUST_FRONTIER_V2=true`, gated; doc `b03e765`). Todos los usuarios en v2. Pendiente: smoke funcional en prod (frontera 25/25 + aplicar techo + slider).
5. **Rollback** = apagar los flags (instantáneo, sin migración).

## Fase 2 — constraints por grupo (EN esta rama)

Implementado y validado en sandbox (24 tests Python + `tsc -b` verde): límites (techo/suelo) de exposición por **divisa, clase de activo, región, vehículo y subtipo** — los campos que existen en `contracts/master/asset.v1`. `add_sector_constraints` apilable en varias dimensiones, QP forzado, infactibilidad → aviso `GROUP_CONSTRAINTS_INFEASIBLE` (se ignora, no rompe), exposición del objetivo siempre en `diagnostics.group_exposures`, y panel `GroupConstraintsPanel` tras el flag v2. Contrato extendido de forma aditiva. Enrutado admin-first intacto (v2 solo para `TARGET_RISK`). **No** hay constraint por gestora/emisor: ese campo no existe en la maestra (dependería del otro pipeline de datos).

## Pendiente (fases siguientes)

Shrinkage jerárquico a priors por clase (decidido no hacerlo el 05-11-2026, decisión 95: la medida y el porqué están en la §13 de `METODO_PROPIO_METRICAS_2026-11-01.md`), restricción de turnover (rotación vs cartera actual), panel de objetivos completo, A/B formal automatizado, y Cloud Run si crece la dependencia o el uso.
