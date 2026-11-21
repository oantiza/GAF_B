# Runbook — Nivel 3: validación end-to-end y activación admin-first (Robust Frontier v2)

> **Registro histórico.** Desde el 05-11-2026 (decisión 61 de la auditoría, `docs/rediseno-2026-11/DECISIONES_AUDITORIA_2026-11-04.md`) todos los objetivos salen del motor regularizado. La rejilla se ha borrado, y con ella `BDB_ACTIVOS_ENABLE_ROBUST_FRONTIER_V2`, `VITE_BDB_ENABLE_ROBUST_FRONTIER_V2`, `_use_robust_v2`, los scripts A/B y `test_dispatch_routing.py`: lo que aquí se dice de volver a v1 ya no se puede hacer.

**Rama:** `feature/robust-frontier-v2` · **Objetivo:** validar v2 en la app real y exponerlo **primero a admins** sin cambiar los números a los usuarios que siguen en v1. Todo gated, sin escrituras a la maestra.

## 0. Idea clave — por qué el admin-first es posible en el proyecto compartido

El dispatch enruta a v2 **por petición**, no de forma global:

- `repository._use_robust_v2(objective)` = flag de backend ON **y** `objective == "TARGET_RISK"`.
- `optimize_portfolio` usa ese predicado → **v2 solo para peticiones TARGET_RISK** (las que envía el frontend con su flag ON).
- El cap de `main.optimize_portfolio` está **alineado**: 25 activos solo si TARGET_RISK (v2); el resto queda en 10 (límite seguro del grid v1).

Efecto: con el flag de **backend ON desplegado globalmente**, quien envía `MAX_SHARPE` (frontend v1) sigue en el motor clásico con **números sin cambios**; solo quien envía `TARGET_RISK` (frontend v2) usa el motor robusto. La exposición se controla entonces **solo con el flag de frontend** (qué build lo lleva).

## 1. Estado en la rama (a commitear por Codex)

| Estado | Fichero | Cambio |
|---|---|---|
| M | `functions_python/optimization/repository.py` | helper `_use_robust_v2` + dispatch por objetivo |
| M | `functions_python/main.py` | cap alineado con el enrutado (25 solo TARGET_RISK) |
| A | `functions_python/tests/test_dispatch_routing.py` | 3 tests del enrutado |
| A | `functions_python/scripts/ab_from_firestore.py` | A/B sobre datos reales (Nivel 1) |
| A | `docs/RELEASE_NOTE_frontier_v2.md` · `docs/RUNBOOK_NIVEL3_frontier_v2.md` | documentación |

Preflight (verde en sandbox): `tsc -b` · `pytest tests/test_robust_engine.py tests/test_dispatch_routing.py` → **12/12**.

## 2. Matriz de activación

| Backend flag | Frontend flag (build) | Objetivo enviado | Motor | Quién |
|---|---|---|---|---|
| OFF | OFF | MAX_SHARPE | v1 | todos (hoy) |
| **ON** | OFF | MAX_SHARPE | v1 | usuarios normales → **sin cambios** |
| **ON** | ON (build admin) | TARGET_RISK | **v2** | admins (canal preview) |
| **ON** | ON (build prod) | TARGET_RISK | **v2** | todos (rollout total) |

El backend ON es **seguro de desplegar globalmente** desde el principio: el enrutado por objetivo protege a los usuarios en v1.

## 3. Procedimiento (gated — lo ejecuta Codex/usuario en Windows)

1. **Commit** de la rama (git nativo Windows; no commitear desde bash).
2. **Preflight**: `npx tsc -b` verde · `pytest functions_python/tests/test_robust_engine.py functions_python/tests/test_dispatch_routing.py` → 12/12.
3. **Backend flag**: añadir `BDB_ACTIVOS_ENABLE_ROBUST_FRONTIER_V2=true` a `functions_python/.env`.
4. **Deploy de functions** (gated): con `BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY="YES_I_UNDERSTAND_SHARED_PROJECT"`, `firebase deploy --only functions`. Deja el hosting de producción intacto (frontend flag OFF ⇒ usuarios normales siguen en v1).
5. **Build admin** con `VITE_BDB_ENABLE_ROBUST_FRONTIER_V2=true` → **canal preview** de hosting: `firebase hosting:channel:deploy admin-frontier-v2`. URL temporal solo para admins; producción (canal live) NO se toca.
6. **Validar** en la URL preview (sección 4).
7. **Rollout total** solo si PASS (sección 6).

## 4. Validación en la app (admin, sobre el canal preview)

Con carteras **reales** de 5, 10, 19 y 25 activos EUR con histórico común. Para cada una:

- La frontera calcula sin error (1ª llamada fría ~1-2 s por warm-up de cvxpy; siguientes ~0,1 s).
- El **slider 1↔10** mueve el punto "Tu objetivo" a lo largo de la frontera; el rango viable es coherente.
- "Máx. Sharpe (**referencia**)" etiquetado como tal; exclusiones y warnings legibles.
- **Control de no-regresión v1**: la MISMA cartera (≤10 activos) en el **canal live** (usuario normal, MAX_SHARPE) devuelve los **mismos números que hoy**.
- **Control de cap**: una cartera >10 en el canal live (v1) sigue **capada a 10** (rechazo limpio, no timeout).

## 5. Comparación A/B (opcional, refuerzo)

Correr `python scripts/ab_from_firestore.py <ISIN...>` con las mismas cestas (Nivel 1) y contrastar los números que muestra la UI del canal preview. Deben coincidir con la rama v2.

## 6. Criterios de aceptación

- v2 responde y **escala a 25** sin error ni timeout.
- **v1 intacto**: mismos números que hoy para MAX_SHARPE ≤10 (usuarios normales).
- **UI**: objetivo, rango viable, exclusiones y warnings correctos; copy aprobado (Nivel 2).
- Tiempos aceptables (fría ~1-2 s; caliente ~0,1 s).
- **Cero escrituras** a la maestra (la callable es solo lectura).

Si todo PASS → rollout total: activar `VITE_BDB_ENABLE_ROBUST_FRONTIER_V2=true` en el build de **producción** y desplegar hosting (gated). El backend ya está ON.

## 7. Rollback (instantáneo, sin migración)

- **Revertir exposición**: quitar el flag de frontend del build de producción (o borrar el canal preview) → todos vuelven a MAX_SHARPE/v1 al instante.
- **Desactivar del todo**: `BDB_ACTIVOS_ENABLE_ROBUST_FRONTIER_V2=false` en `functions_python/.env` + redeploy de functions.
- No hay datos que revertir: nada se escribió.

## 8. Guardarraíles (no negociable)

- `optimize_portfolio` es **solo lectura** de la maestra: no escribe ni borra.
- **Deploy siempre gated** (env de aprobación). Los deploys los hace Codex/usuario en Windows.
- **No commitear desde bash**; typecheck real = `tsc -b`.
- **No mergear a master** hasta pasar el Nivel 3 con nueva aprobación explícita.
