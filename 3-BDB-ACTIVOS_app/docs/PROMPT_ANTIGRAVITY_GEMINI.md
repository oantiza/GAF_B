# Prompt para Gemini 3.1 Pro (Antigravity) — continuar BDB-ACTIVOS

Eres un agente de programación trabajando en el repositorio **BDB-ACTIVOS** (`C:\Users\oanti\Documents\BDB-ACTIVOS`). Lee este encargo entero antes de tocar nada.

## Contexto
- App de banca privada: **React 19 + TypeScript + Vite 8 (rolldown) + Firebase** (Auth, Firestore, Functions en Python 2ª gen, region europe-west1). Proyecto Firebase: **`bbdd-activos-financieros`**.
- Es un **clon multi-activo** (fondos, ETF, acciones, índices) del legacy **BDB-FONDOS** (`C:\Users\oanti\Documents\BDB-FONDOS`, frontend en `frontend/src`). Objetivo: **paridad funcional** con el legacy, manteniendo la estética actual **dark navy/teal/oro** (variables CSS en `src/index.css`). Fuera de alcance: módulo Jubilación. Admin: opcional.
- Fuente de datos única = **BBDD en vivo** (callables: `search_assets`, `get_asset_detail`, `compare_assets`, `get_price_series`, `backtest_portfolio`, `optimize_portfolio`, `analyze_portfolio`, `get_weekly_report`, `get_economic_calendar`).

## Fuente de verdad de lo que falta
Usa las incidencias activas y el historial del repositorio como referencia de paridad.

## Ya hecho (Fase 1, compila en verde)
Kit de gráficos SVG propio en `src/charts/`: **RiskReturnMap** (mapa riesgo-retorno con capa de benchmarks), **GroupedBars**, **Donut**; perfiles de referencia en `src/core/benchmarkProfiles.ts`. Integrados: mapa riesgo-retorno en Dashboard y X-Ray; comparador de carteras A/B con gráficos + export PDF; informe X-Ray en PDF (`src/reports/xrayPdf.tsx`); comparador PDF (`src/reports/comparePdf.tsx`); Markdown real (`src/components/MarkdownView.tsx`); calendario económico rico; gráficos del macro (matriz de riesgos de cola, barras SAA/TAA, donuts) en `MiBoutique.tsx`. Importar posiciones = **solo carga de CSV**. `CostsModal` = **retrocesión manual editable por fondo × coeficiente**.

## REGLAS DURAS (no las rompas)
1. **Gráficos**: usa SIEMPRE el kit SVG propio de `src/charts/`. **No añadas Chart.js, Recharts ni ninguna librería de charting.** Reutiliza el patrón de `FrontierPanel.tsx` / `AssetComparison.tsx`.
2. **Tema**: colores solo vía variables CSS de `src/index.css` (`--surface`, `--surface-2/3`, `--border`, `--teal`, `--teal-text`, `--teal-soft`, `--gold`, `--gold-text`, `--text`, `--text-muted`, `--red`, `--green`, etc.). Nada de hex hardcodeados que rompan el dark mode. Epígrafes en oro, botones de cálculo en teal.
3. **PDFs**: `@react-pdf/renderer` con **import dinámico** (`await import("...")`) y fallback a `window.print()` si falla — nunca import estático en componentes (no inflar el bundle principal). Fuente Helvetica integrada (soporta acentos y €). **Markdown**: `react-markdown` + `remark-gfm`.
4. **No añadas dependencias** salvo que sea imprescindible y lo justifiques al usuario.
5. El build DEBE quedar **verde**: `npm run build` (= `tsc -b && vite build`). Córrelo tras cada cambio. Mantén **eslint** limpio (`npm run lint`).
6. **PowerShell 5.x**: NO admite `&&`. Comandos en líneas separadas (`git add -A` y luego `git commit -m "..."`).
7. **NO** despliegues Firebase ni toques datos de producción (lo decide el usuario). **NO** ejecutes operaciones financieras.
8. **Bloqueado por datos — NO inventes**: la **retrocesión por fondo** y el **style box de Renta Fija** (duración/crédito) no los expone la BBDD nueva; déjalos manuales/gated como están.
9. Los **perfiles de referencia** del mapa (`benchmarkProfiles.ts`) son orientativos; no los presentes como índices reales.
10. Cambios **mínimos y localizados**; no refactorices de más. Sigue los patrones existentes de `PortfolioBuilder.tsx` y sus paneles.

## Trabajo pendiente (Fase 2, en este orden)
1. **Vista táctica: cartera actual vs óptima (Máx Sharpe).** Generaliza `src/components/BacktestComparison.tsx` (hoy compara contra una equiponderada) para enfrentar la cartera actual a la cartera **óptima de máximo Sharpe** que devuelve la frontera histórica real (`fetchHistoricalFrontier` / `FrontierHistoricalView`, objetivo `MAX_SHARPE`). Vista dual con métricas a ambos lados (CAGR/Vol/Sharpe/MaxDD vía `backtest_portfolio`, ya desplegado) + gráfico comparativo rebase-100 + botón "Aplicar pesos óptimos".
2. **Maximizador de Sharpe.** Dado el universo, propone qué activo añadir (p.ej. al 5%, reescalando el resto) que más sube el Sharpe, vía backtest. Necesita un **callable nuevo** en `functions_python` que escanee candidatos + UI (modal/panel). Coordina con el usuario antes de cualquier deploy.
3. **Asignación macro por sliders.** UI con sliders por bucket (RV/RF/Alternativos y regiones) que reescala la cartera a esos targets. Lógica de cliente; reutiliza `src/core/generatePortfolio.ts`.
4. **Estrategias de aportación de capital** al optimizar: "aportar dinero nuevo" / "proporcional" / "redistribuir". Lógica de cliente sobre pesos y capital, respetando candados.
5. **Pulido fino del informe** (ver PDF de auditoría) con el kit SVG: style box RV 3×3, heatmap de correlación visual, donuts adicionales, etc.

## Cómo trabajar (por cada tarea)
- Implementa con cambios mínimos siguiendo los patrones existentes.
- Corre `npm run build` hasta verde y `npm run lint` limpio.
- Arranca `npm run dev` y **verifica en el navegador** (`localhost:5173`) que renderiza y que no rompes otros módulos.
- Deja un resumen breve de qué archivos tocaste y por qué.
- Si algo está bloqueado por datos o requiere deploy, déjalo gated/manual y **avísalo en vez de inventar**.
- Commit al final de cada bloque (el usuario revisa). Mensajes de commit claros.
