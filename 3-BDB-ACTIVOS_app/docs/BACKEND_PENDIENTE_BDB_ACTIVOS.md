# Backend pendiente — BDB-ACTIVOS (paquete para rematar la paridad)

> ⚠️ **HISTÓRICO (marcado 2026-07-28): no seguir.** Todo lo que este documento
> daba por pendiente está desplegado y en producción desde hace semanas.
> Además cita piezas que ya no existen (`MiBoutique.tsx`, `fetchWeeklyReport`)
> y propone `jspdf`+`html2canvas` cuando el enfoque vigente es
> `@react-pdf/renderer`. Se conserva solo como historia del proyecto.
> El estado real: `docs/PANEL_DE_CONTROL.md` y la auditoría 27-07 (raíz).

> **ESTADO 2026-06-24:** los 4 callables (`backtest_portfolio`, `get_weekly_report`, `analyze_portfolio`, `get_economic_calendar`) ya están **codificados y registrados** en `functions_python`, con sus adaptadores y consumidores en el front (tsc+eslint verdes, py_compile OK). Lo que queda es **desplegar** y configurar claves/datos (ver más abajo).

> El frontend de paridad está hecho (módulos clonados/adaptados, `tsc -b` verde). Lo que queda para paridad total con el legacy **depende de backend que despliegas tú** (Firebase **NO** compartido) o de añadir librerías de PDF. Proyecto: **`bbdd-activos-financieros`** · región **`europe-west1`** · callables 2ª gen.
>
> Aviso 2ª gen: cada callable nueva necesita el binding **`allUsers → roles/run.invoker`** en su servicio Cloud Run; sin él da `internal`/CORS en el front.

---

## 1. `backtest_portfolio` (callable) — PRIORITARIO
Desbloquea: **Dashboard** (Táctico, Sharpe maximizer, comparativa histórica actual‑vs‑propuesta), **X‑Ray Analytics** (RiskMap con benchmarks sintéticos), **Comparador** (métricas multiperiodo reales).

```ts
// Input
{ positions: { asset_id: string; weight: number }[];   // weight 0..1
  period: "1Y" | "3Y" | "5Y" | "10Y";
  benchmarks?: string[]; }                              // ids opcionales

// Output
{ metrics: { cagr: number; volatility: number; sharpe: number; max_drawdown: number; rf_rate: number };
  portfolio_series: { date: string; value: number }[];           // rebasada a 100
  benchmark_series: Record<string, { date: string; value: number }[]>;
  correlation_matrix: number[][];                                 // orden = positions
  synthetics: { id: string; label: string; color: string; volatility: number; annual_return: number }[];
  effective_ids: string[]; }
```
Notas: reutiliza las `price_series` ya cargadas; RF ≈ €STR (ya disponible en el módulo Macro). El front consumirá esto en lugar de los cálculos locales aproximados.

## 2. `WeeklyReport` — Firestore + generación LLM
Desbloquea: **Macro y estrategia** (Mi Boutique) con datos reales (hoy usa mock).

- Callable **`get_weekly_report`** YA CODIFICADA (lee la colección app-owned **`bdb_activos_reports`**, último doc `type == "WEEKLY_REPORT"` por `date`). El job LLM solo tiene que **ESCRIBIR** ahí.
- Esquema = el tipo **`WeeklyReport`** ya definido en `src/types/weeklyReport.ts`:
  `{ id, date, author, provider?, summary{ headline, narrative, keyEvents[], kpis[{label,value,trend}], marketTemperature, tailRisks[{risk,probability,impact}] }, assetAllocation{ overview, classes[{assetClass,strategicWeight,tacticalWeight,view,rationale}], regionsEquity[], regionsFixedIncome[], sectors[] }, fullReport{ narrative(markdown) } }`
- Generación: job/cron LLM (como el legacy con Gemini). **El front YA lo consume** (`fetchWeeklyReport` + `MiBoutique.tsx`): al poblar la colección y desplegar, sale el informe real; si no, mock con badge «Muestra».

## 3. `analyze_portfolio` (callable, LLM) — opcional
Desbloquea: modal de análisis profundo de cartera (PortfolioAnalysis del legacy).

## 4. `get_economic_calendar` (callable) — opcional
Desbloquea: pestaña de calendario económico dentro de Macro y estrategia.

## 5. Verificar ya desplegado (de la fase previa)
Confirmar live en `bbdd-activos-financieros`: `region map`, modo **diario** de rebase, `category`, ventana **1Y**, **candados** del optimizador, `get_macro_reference` (IPC INE / Letras BdE), `get_price_series`. (Si alguno no está desplegado, varias vistas degradan a aproximado.)

## 6. Frontend (no backend) — librerías PDF
Para los **informes PDF** (X‑Ray completo/resumen, comparador): añadir a `package.json` **`jspdf`** + **`html2canvas`** (`npm install` en Windows) y clonar el generador del legacy (`utils/pdfGenerator`, `comparatorPdfGenerator`).

---

## Deploy (lo ejecutas tú)
```bash
# en BDB-ACTIVOS, con el flag de barrera del repo:
set BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY=YES_I_UNDERSTAND_SHARED_PROJECT   # (Windows)
firebase deploy --only functions
```
Tras desplegar una callable 2ª gen nueva, añade el binding `allUsers → roles/run.invoker` a su servicio Cloud Run.

## Orden sugerido
1. `backtest_portfolio` (desbloquea más cosas) → 2. poblar `reports`/WeeklyReport → 3. PDF deps → 4. `analyze_portfolio` / calendario (opcionales).
