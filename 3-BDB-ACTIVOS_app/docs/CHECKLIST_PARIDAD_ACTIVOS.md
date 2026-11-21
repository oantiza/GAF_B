# Checklist de paridad legacy -> BDB-ACTIVOS (reusar / dejar / clonar / bloqueado)

> Criterio (Oscar, 2026-06-24): **reutiliza lo ya portado y util**, **deja lo que no haga falta clonar o ya sea mejor en el actual**, y **clona del legacy solo los huecos** hasta que la funcionalidad sea perfecta. Estetica actual; BD nueva (`bbdd-activos-financieros`). Excluidos: **Jubilacion** y **Admin**.
>
> Leyenda: **DEJAR** = ya esta en el actual (o es mejor) -> no se toca · **CLONAR** = hueco real a portar del legacy · **BLOQUEADO** = necesita backend/datos o deploy.
>
> Nota: la auditoria automatica sobrestimo algunos huecos (no leyo todo el codigo actual). Esta lista ya esta reconciliada con lo realmente hecho (memoria del proyecto). Antes de tocar cada modulo, se verifica el codigo real.

---

## 1. Dashboard (mesa de trabajo)  ·  actual = cockpit + Cartera + Buscador + Frontera + Optimizador
- **DEJAR**: capital EUR + edicion por EUR + candado + Normalizar 100%; optimizador real con candados por activo; frontera real; monitor de riesgo; metricas multi-periodo (Vol 1A / Rent 5A); composicion look-through; favoritos; import/export CSV; fondos VIP/ancla.
- **CLONAR**: panel de Controles (riesgo 1-10, nº de activos); CostsModal (retrocesion + coef. de margen); FundSwapModal (alternativas homogeneas); generar propuesta manual con restricciones; grafico historico actual vs propuesta.
- **BLOQUEADO**: backtest_portfolio (backtest 5A: series + correlacion + benchmarks sinteticos) -> Tactical/MacroTactical; SharpeMaximizer (usa backtest); suitability/risk_profiles (Firestore); PortfolioAnalysis (LLM).

## 2. Comparador
- **DEJAR**: comparacion con rebase-100 (diario/semanal); matriz de correlacion; selector de periodo; AssetPicker; comparar carteras A/B.
- **CLONAR**: RiskMap (scatter vol/retorno + benchmarks); tabla de metricas multi-periodo (1/3/5/10A); export PDF del comparativo.
- **BLOQUEADO**: metricas por periodo que dependan de backtest; (verificar) deploy de ventana 1Y.

## 3. Posiciones
- **DEJAR**: import (textarea/CSV); tabla de posiciones.
- **CLONAR**: analisis de retrocesion (findHomogeneousAlternatives) + RetrocessionComparisonModal + coef. de margen; formato CSV legacy `ISIN;Nombre;Total (EUR)`. **Crear vista "Posiciones"** (hoy vive dentro de Cartera).
- **GATE multi-activo**: retrocesion/alternativas homogeneas solo aplican a **fondos**; ocultar/gate en STOCK/ETF/INDEX.

## 4. X-Ray  ·  actual = 3 pestañas (Radiografia / Avanzada / Patrimonial), ya por encima del legacy
- **DEJAR (mejor en actual)**: estructura de 3 pestañas; look-through; analitica avanzada (correlacion, frontera); Comparador patrimonial (XIRR + IPC del INE + Letras del BdE).
- **CLONAR**: tarjetas KPI X-Ray (CAGR/Vol/Sharpe/MaxDD/Rf); AssetAllocationSection + SimpleStyleBox (value/blend/growth y duracion/credito) usando `exposure_detail` (equity_styles/regions ya expuestos); GlobalAllocationChart; EquityRegionChart; generador de informe **PDF** (completo/resumen, paginado).
- **BLOQUEADO**: estrategia semanal embebida en el PDF (Firestore `reports` type=STRATEGY).

## 5. X-Ray Analytics
- **DEJAR (mejor en actual)**: fusionado en la pestaña "Avanzada" de X-Ray -> no duplicar en el nav.
- **CLONAR (solo si quieres paridad estricta)**: RiskMap con 5 benchmarks sinteticos + selector de benchmark; explicacion dinamica de riesgo.
- **BLOQUEADO**: backtest_portfolio (benchmarkSeries + perfiles sinteticos); analyze_portfolio (LLM).

## 6. Mi Boutique  ·  FALTA por completo -> clonar entero
- **CLONAR (UI + tipos, con mock de respaldo como el legacy)**: tipos `WeeklyReport`; SummaryTab (titular/narrativa/KPIs/temperatura/eventos/tail risks); AssetAllocationTab (SAA vs TAA, regiones, sectores); FullReportTab (markdown); ReportDashboard. Restyle al tema actual.
- **BLOQUEADO**: datos reales = Firestore `reports` (WEEKLY_REPORT) generados por LLM. Se construye UI + mock; pasa a live tras el backend.

## 7. Macro
- **DEJAR (util y distinto)**: MacroPage con tipos BCE (€STR/DFR/MRO/MLF) = la Rf de la frontera.
- **CLONAR**: informe de **estrategia semanal** (mismo `WeeklyReport` que Mi Boutique) + **pagina de impresion** (PrintMacroStrategyReport).
- **BLOQUEADO**: WeeklyReport (Firestore/LLM).

---

## Backend (proyecto `bbdd-activos-financieros` · Firebase NO compartido · deploy lo decides tu)
Desbloquea varios modulos. Codigo aqui; deploy con tu OK.
- **backtest_portfolio** (metrics + series + correlacion + benchmarks sinteticos) -> Tactical, SharpeMaximizer, X-Ray Analytics, comparador multiperiodo.
- **analyze_portfolio** (LLM) -> modal PortfolioAnalysis.
- **WeeklyReport** (generacion LLM) + coleccion Firestore `reports` -> Mi Boutique + Macro estrategia.
- **calendario economico** (callable) -> pestaña calendario.
- **Ya codificado, verificar/forzar deploy** (de la fase previa): modo diario en rebase, `category`, ventana 1Y, `map_region` (fallback region RV), candados del optimizador, `get_macro_reference` (IPC/Letras), `get_price_series`.

## Excluidos
- **Jubilacion** (Retirement) — fuera por encargo.
- **Admin** (back-office: parser Morningstar, retrocesiones, auditor, cola de revision) — fuera por ahora.

## Decision estructural pendiente (barata)
El nav actual separa **Buscador / Cartera / Frontera**, que el legacy agrupa dentro de **Dashboard**. Por defecto se **mantiene el actual** (reuso + "mejor en el actual"). Si quieres el nav identico al legacy, se reestructura componiendo los componentes existentes en una sola vista Dashboard (barato, sin reescribir logica).
