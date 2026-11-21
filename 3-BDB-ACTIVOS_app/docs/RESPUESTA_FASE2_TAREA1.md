# Respuesta al plan de Fase 2 — adelante con la Tarea 1 (con estas precisiones)

Plan aprobado. Confirmado: **sí** al fallback a la cartera equiponderada cuando `optimize_portfolio` no esté activa; **sí** a NO desplegar ni modificar el backend en la Tarea 2 sin coordinar antes.

## Respuestas a tus preguntas

**P1 — ¿toggle o reemplazo?** Implementa un **toggle** "vs Equiponderada / vs Máx Sharpe", por defecto en **Máx Sharpe**. La equiponderada siempre funciona (no necesita flag ni callable) y es una buena base; Máx Sharpe es el objetivo óptimo. Si Máx Sharpe no está disponible (flag off / error / no desplegado), cae automáticamente a equiponderada con una nota visible. El panel nunca debe quedar inútil.

**P2 — ¿dónde van los sliders macro (Tarea 3)?** En la **pila de paneles bajo la tabla de posiciones, junto a Optimizador/Frontera**, NO arriba con Preselección/Importar. Reescala la cartera existente (reclasificar + ajustar a targets), así que es una herramienta de rebalanceo y debe agruparse con el optimizador.

## Cautelas técnicas para la Tarea 1 (formas REALES del código — respétalas)

1. Los pesos óptimos están en `state.model.maxSharpe.weights`, **solo cuando `state.status === "result"`**. Es un **array** `{ assetId: string; weight: number }[]` con `weight` en **decimal** (0,40 = 40 %). NO es un `Record`, ni `maxSharpe.weights` a secas. (Ver `src/types/portfolioFrontier.ts`: `FrontierViewModel.maxSharpe` es `FrontierPointView`, cuyo `weights` es `FrontierWeightView[]`.)

2. `fetchBacktest(weights, period)` espera `{ asset_id: string; weight: number }[]` con `weight` decimal (igual que los arrays `current` y `equal` actuales de `BacktestComparison`). Construye la propuesta así:
   ```ts
   const proposedWeights = model.maxSharpe.weights.map((w) => ({ asset_id: w.assetId, weight: w.weight }));
   ```

3. El botón "Aplicar pesos óptimos" → `onApplyWeights` espera un **`Record<string, number>` de decimales** (en `PortfolioBuilder`, `applyOptimizedWeights` ya multiplica ×100 y solo recorre las posiciones existentes). Pásale:
   ```ts
   onApplyWeights(Object.fromEntries(model.maxSharpe.weights.map((w) => [w.assetId, w.weight])));
   ```

4. Para llamar a `fetchHistoricalFrontier` usa el MISMO input que `FrontierPanel.tsx`:
   ```ts
   { assetIds: <ids invertibles>, currentWeights: <Record<assetId, decimal>>, window: period, objective: "MAX_SHARPE" }
   ```
   `FrontierWindow` y `BacktestWindow` comparten valores (1Y/3Y/5Y/10Y): `period` vale directo.

5. **El camino Máx Sharpe solo se activa con `isRealFrontierEnabled() === true`**, que exige `VITE_BDB_ENABLE_REAL_FRONTIER=true` en `.env.local` Y la callable `optimize_portfolio` desplegada. Si no, `fetchHistoricalFrontier` devuelve `{ status: "idle" }` → debe caer a equiponderada. (Avísame para activar el flag al probar.)

6. **NO borres** el código de la equiponderada: es el fallback.

7. Ojo al **tope de ~8 activos** del backtest (heredado de `build_rebased_series`): con carteras grandes el backtest puede venir recortado. No bloquea, pero tenlo en cuenta.

## Verificación (añade esto)

Prueba **los dos caminos**: con el flag ON debe salir "Máx Sharpe"; con el flag OFF debe caer a "Equiponderada". El toggle/etiquetas deben reflejar cuál se usó. Y como siempre: `npm run build` y `npm run lint` en verde, y repaso en `localhost:5173`.
