# Respuesta al plan de Fase 2 — Tarea 2 (Maximizador de Sharpe)

Plan aprobado en estructura (adaptador + modal inline tipo `CostsModal` + integración en `PortfolioBuilder`). Dos decisiones y varias cautelas.

## Respuestas a tus preguntas

**Q1 — ¿mock o error mientras no hay backend?** Ni datos ficticios ni un panel muerto. Por preferencia:

1. **PREFERIDO — Maximizador aproximado en CLIENTE (sin backend, sin datos falsos).** Reutiliza el método aproximado que ya usa la app en `src/core/frontier.ts` (la "Frontera eficiente (aproximada)"): busca candidatos reales del universo con `search_assets` según los filtros, y para cada uno calcula el **Sharpe proyectado** de la cartera al añadirlo al 5% (reescalando el resto al 95%), usando retorno/volatilidad por activo + correlaciones asumidas por clase. Rankea por ΔSharpe. Etiquétalo **"(aproximado)"** igual que la frontera. Deja el adaptador `maximize_sharpe` como *seam* para la versión exacta (backtest real) cuando se despliegue. Esto da una herramienta que **funciona ya**, con datos reales, y no requiere desplegar nada.
2. **ACEPTABLE (más rápido) —** estado controlado "pendiente de despliegue del backend" por defecto, y un **mock SOLO tras un flag de dev** (`VITE_BDB_MOCK_SHARPE=true`), nunca en el camino normal. Si vas por aquí, los candidatos del mock deben ir claramente marcados como muestra.

**NO** metas activos ficticios en el camino por defecto (es una herramienta financiera; engaña). Si dudas, ve por la opción 1.

**Q2 — checkbox "priorizar retrocesiones":** sí, **ocúltalo** (o deshabilitado con tooltip "pendiente de datos"). La BBDD nueva no expone retrocesión (bloqueado por datos, igual que en `CostsModal`). De acuerdo.

## Cautelas técnicas

- **currentSharpe**: el campo correcto es `summary.weighted_metrics.sharpe_3y` (tipo `BdbManualPortfolioSummary`), NO `summary.metrics.sharpe`. Úsalo como base para el delta; si es `undefined`, degrada con aviso.
- **Añadir al 5%**: define explícito el comportamiento — recomiendo **añadir el candidato al 5% y reescalar las posiciones existentes proporcionalmente al 95%** (como el legacy). Si lo dejas más simple (añadir al 5% sin reescalar), avisa al usuario de que use "Normalizar 100%". Reutiliza el flujo de añadir activo que ya existe (`AssetSearch.handleAddToPortfolio` / `onAddAsset`).
- **Escaneo de candidatos**: `search_assets` viene paginado/limitado; pagina por lotes (replica el "Escanear siguientes 10" del legacy) en vez de pedir todo de golpe.
- **Estética**: inline `CSSProperties` + variables CSS (navy/teal/oro), patrón de `CostsModal.tsx` / `FundSwapModal.tsx`. Nada de Tailwind ni hex hardcodeados.
- **Filtros** (clase, región): reutiliza `AssetSearchFilters` / el patrón de `AssetPicker`.
- **Botón "Maximizar Sharpe"**: el `portfolio-header` ya tiene varios botones (Ver reporting, Costes, Alternativas, Exportar CSV, Resetear); cabe, pero si queda apretado, valóralo también junto al `OptimizerPanel`/`FrontierPanel`.
- **Sin deploy** de Firebase ni nuevas callables en producción hasta coordinarlo. Si vas por la opción 1, no necesitas tocar backend en absoluto para la v1.
- `npm run build` y `npm run lint` en verde, y repaso en `localhost:5173`.

## Verificación (añade)

- Si opción 1: comprobar que rankea candidatos reales y que "añadir al 5%" deja la suma de pesos coherente (100% si reescalas, o el aviso de normalizar).
- Si opción 2: comprobar el estado "pendiente de backend" sin flag, y el mock SOLO con el flag.
