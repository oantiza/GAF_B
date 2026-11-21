# Runbook — Rollout total v2 (frontera + Fase 2)

> **Registro histórico.** Desde el 05-11-2026 (decisión 61 de la auditoría, `docs/rediseno-2026-11/DECISIONES_AUDITORIA_2026-11-04.md`) todos los objetivos salen del motor regularizado. La rejilla se ha borrado, y con ella `BDB_ACTIVOS_ENABLE_ROBUST_FRONTIER_V2`, `VITE_BDB_ENABLE_ROBUST_FRONTIER_V2`, `_use_robust_v2`, los scripts A/B y `test_dispatch_routing.py`: lo que aquí se dice de volver a v1 ya no se puede hacer.

**Rama:** `feature/robust-frontier-v2` · certificada verde (24 tests Python + `tsc -b` EXIT=0) · Nivel 3 (frontera) **PASS** · backend ya con flag ON. **Es exposición a TODOS los usuarios: no ejecutar sin OK explícito de Oscar.**

## Riesgo a cubrir

El flag de **frontend** enciende a la vez la frontera v2 **y** el panel de Fase 2. La frontera pasó Nivel 3, pero el **panel de Fase 2 no se ha visto en preview** (solo sandbox). Por eso el Gate 0.

## Gate 0 — smoke de Fase 2 en preview (recomendado, ~5 min)

Codex reconstruye el canal preview con el build ACTUAL (ya incluye el panel):

```
# build con VITE_BDB_ENABLE_ROBUST_FRONTIER_V2=true
firebase hosting:channel:deploy admin-frontier-v2
```

En la URL preview, con una cartera de ~15-25 activos:
1. Aparece la sección **"Límites por grupo"** con la exposición actual por divisa/clase/región/vehículo/subtipo.
2. Fijar un techo (p.ej. divisa USD máx 20%) → **Aplicar límites** → la exposición baja del techo y la frontera recalcula.
3. Techo imposible (p.ej. una clase única al 5%) → aviso **"los límites eran incompatibles… se han ignorado"** (no rompe).

Si PASS → seguir. Si algo chirría → ajustar en la rama antes de producción.

## Paso 1 — commit pendiente

```
M docs/RELEASE_NOTE_frontier_v2.md
git commit -m "docs(frontier-v2): release-note al día (Fase 2 en rama)"
```

## Paso 2 — activar producción (gated)

```
# build de producción con VITE_BDB_ENABLE_ROBUST_FRONTIER_V2=true
BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY="YES_I_UNDERSTAND_SHARED_PROJECT" firebase deploy --only hosting
```

El backend ya está ON (no tocar).

## Paso 3 — verificación post-deploy (producción)

- La web muestra el slider **"Nivel de riesgo relativo"**, **"Tu objetivo"** y el panel **"Límites por grupo"**.
- Una cartera de 25 activos optimiza (25/25); aplicar un techo funciona.
- Tiempos ~0,1 s en caliente (1ª llamada ~1-2 s).
- **Tras el rollout, TODOS los usuarios pasan a v2** (ya no hay v1 en la app).

## Paso 4 (opcional) — merge `feature/robust-frontier-v2` → `master`.

## Rollback (instantáneo, sin migración)

- Build de producción con `VITE_BDB_ENABLE_ROBUST_FRONTIER_V2=false` + deploy hosting → todos vuelven a v1.
- El backend puede quedarse ON (inerte sin el frontend v2).

## Guardarraíles

`optimize_portfolio` es **solo lectura**. Deploy siempre **gated**. No mergear ni desplegar sin OK explícito.
