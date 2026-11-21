# 🧬 Plan de Clonado — Legacy BDB-FONDOS → BDB-ACTIVOS (multi-activo)

> Objetivo (encargo Oscar, 2026-06-24): **empezar de cero y clonar exactamente el legacy `BDB-FONDOS`, excepto el módulo de Jubilación**, conservando la **estética y estilo actuales** de BDB-ACTIVOS (navy/teal/oro) y **adaptándolo a los nuevos activos** consumiendo la **base de datos nueva (BBDD-ACTIVOS-FINANCIEROS)**.
>
> Decisiones cerradas: ① reconstruir entero; ② usar la BD nueva; ③ copia de seguridad reversible hecha (`backup/pre-clon-legacy-2026-06-24` + tag).

---

## 1. Principio rector

| Dimensión | De dónde sale |
|---|---|
| **Funcionalidad / módulos / flujos** | **Legacy BDB-FONDOS** (clon exacto, menos Jubilación) |
| **Estética / design system / look** | **BDB-ACTIVOS actual** (navy `#0C1A2E` + teal `#2DD4BF` + oro `#D4AF37`, Inter + IBM Plex Mono, barra lateral) |
| **Datos / backend** | **BBDD-ACTIVOS-FINANCIEROS** nueva (contrato `AssetForBdb`, multi-activo FUND/ETF/STOCK/INDEX) |

Es decir: **el legacy pone el QUÉ y el CÓMO; la app actual pone el ASPECTO; la BD nueva pone los DATOS.**

---

## 2. Inventario de módulos del legacy (navegación `App.tsx`)

Estados de vista del legacy: `DASHBOARD · MIBOUTIQUE · XRAY · POSITIONS · RETIREMENT · COMPARATOR · ANALYTICS · ADMIN` (+ ruta print `/print/macro-report`).

| # | Módulo legacy | Clon | Contenido principal | Nota de adaptación |
|---|---|---|---|---|
| 1 | **Dashboard** (mesa de trabajo) | ✅ | Sidebar "Universo de Inversión", Header, Controls, PortfolioTable, PortfolioMetricsCards, EfficientFrontierChart, ComparativeFundHistoryChart, DataQualityBadge, AssetDistributionWidget + ~12 modales (Costs, Tactical, MacroTactical, OptimizationReview/Strategy/Suggestions, SharpeMaximizer, SavedPortfolios, FundDetail, FundSwap, PortfolioAnalysis, Confirm) + optimizador (callable) | Núcleo. ISIN→`asset_id`; coste/TER opcional para STOCK/ETF |
| 2 | **Comparador** | ✅ | ComparatorControlDeck, GroupedBarChart, RiskMap, ComparisonSelector, FundComparator, PortfolioComparator + PDF | Multi-activo en el mismo flujo |
| 3 | **Posiciones** | ✅ | PositionsAnalyzer, FileUpload, PositionsTable, RetrocessionComparisonModal | Retrocesiones: sólo aplican a fondos; gate para STOCK/ETF |
| 4 | **X-Ray** | ✅ | AssetAllocationSection, HoldingsTable, XRayHeader, XRayMetrics, XRayReportGenerator (+pdf) | Holdings/look-through: depende de datos de la BD nueva |
| 5 | **X-Ray Analytics** | ✅ | XRayAnalyticsPage (useXRayAnalytics) | Analítica avanzada de cartera |
| 6 | **Mi Boutique** | ✅ | DeepResearchSection, InformeMensual, dashboard | Research curado / informe mensual |
| 7 | **Macro / Estrategia** | ✅ | ReportDashboard (Summary, AssetAllocation, EconomicCalendar, FullReport, Strategy, Pulse), WeeklyReportDashboard, PrintMacroStrategyReport | Independiente de tipo de activo |
| 8 | **Admin** (back-office) | ⚠️ a confirmar | AdminDashboard, FundAuditor, OptimizerConstraintsPanel, ParserPanel, Retrocesiones (Manager/Panel/Preview/Summary), ReviewQueuePanel, SettingsPanel, ArtifactsPanel | Muy atado a operaciones de fondos (parser Morningstar, retro). Puede no mapear a la BD nueva |
| — | **Jubilación** (Retirement) | ❌ **EXCLUIDO** | RetirementCalculatorPage + components/retirement | Por encargo, fuera |

### Arquitectura de soporte a portar
- **Motor quant:** `engine/portfolioAnalyticsEngine.ts`, `utils/portfolioAnalyticsEngine.ts`, `utils/statistics.ts`, `utils/analytics.ts`, `utils/benchmarkUtils.ts`, `utils/rulesEngine.ts` (suitability/perfiles de riesgo), `utils/fundSwapper.ts`.
- **Taxonomía/normalización:** `utils/normalizer.ts`, `utils/taxonomyTranslators.ts`, `utils/fundTaxonomy.ts`, `utils/classificationAuditor.ts`.
- **Hooks:** `usePortfolio`, `usePortfolioActions`, `usePortfolioStats`, `useDashboardData`, `useAssets`, `useFundHistory`, `useHistoryPresence`, `useSavedPortfolios`, `useSyntheticBenchmarks`, `useXRayData`, `useXRayAnalytics`, `useTheme`, `useAdminAuth`.
- **Export/PDF:** `pdfGenerator`, `generatePortfolioReport`, `comparatorPdfGenerator`, `exportList`, `fonts` (jspdf + html2canvas).
- **Estado/UI:** `context/ToastContext`, charts (Chart.js + recharts), modals, common.
- **Backend:** `functions_python/` (api, endpoints, models, services) — optimizador y análisis quant en Python.

---

## 3. Reglas de adaptación fondo → multi-activo

| Concepto legacy (fondos) | Equivalente multi-activo (BD nueva) |
|---|---|
| `isin` como clave | `asset_id` (ISIN cuando exista; ticker/figi para STOCK/ETF/INDEX) |
| `historico_vl_v2` (NAV) | serie de precios de la BD nueva — **acciones/ETF YA tienen histórico** (confirmado 2026-06-24); fondos según cobertura |
| `classification_v2` (EQUITY/FIXED_INCOME/…) | `economic_asset_class` + `instrument_type` (FUND/ETF/STOCK/INDEX) separados |
| TER / costes / **retrocesiones** | opcionales; STOCK/ETF sin TER ni retro → ocultar/gate |
| `risk_profiles` / suitability | se mantiene el motor; perfiles desde la BD nueva o seed local |
| VIP funds / FundSwap | "VIP assets" / AssetSwap multi-activo |
| INDEX | benchmark / no invertible (igual que en la app actual) |

**Estados "bloqueado por datos":** acciones/ETF **ya tienen histórico** en la BD nueva (2026-06-24), así que el grueso de módulos NO queda bloqueado. Si algún input puntual faltara (holdings/look-through, alguna métrica), el módulo **se construye igualmente** y muestra un estado claro de "pendiente de datos" en vez de romper — mismo patrón que ya usa la app actual.

---

## 4. Arquitectura objetivo

```
BDB-ACTIVOS (React 19 + TS + Vite, estética actual)
  └─ módulos clonados del legacy (menos Jubilación)
      └─ motor quant portado (TS) + adaptado a multi-activo
          └─ capa de datos (adapters)  ── LOCAL_MOCK / STATIC_EXPORT / LIVE_API
              └─ BBDD-ACTIVOS-FINANCIEROS (Firestore, contrato AssetForBdb)
                  └─ backend callable (Python) — optimize_portfolio, compare_assets, …
```

- Se **conserva** la conexión validada a la BD nueva (adapters + contrato `AssetForBdb`) por ser el puente a "los nuevos activos".
- **Firebase NO es compartido** (confirmado 2026-06-24): sin la restricción de "proyecto compartido". El **deploy** del backend lo decides tú; aquí se entrega el código + pasos, y no despliego ni hago push sin tu autorización explícita.

---

## 5. Orden de ejecución

1. ✅ Backup reversible (git).
2. Doc de plan (este).
3. **Shell + navegación** (módulos legacy, estética actual) → app arrancable.
4. **Capa de datos** → BBDD-ACTIVOS.
5. **Motor quant** portado y adaptado.
6. **Dashboard** (núcleo) → desbloquea la mayoría.
7. Comparador → Posiciones → X-Ray(+Analytics) → Mi Boutique → Macro → Admin.
8. Backend de apoyo (código; deploy delegado).
9. Verificación continua: `tsc -b` + `vite build` + `eslint` + `vitest` verdes en cada hito.

---

## 6. Restricciones / avisos

- **Deploy / Firebase**: NO es compartido (confirmado 2026-06-24) — sin la barrera de proyecto compartido. Aun así no despliego ni hago push sin tu autorización explícita; entrego código + pasos.
- **Datos de acciones/ETF**: histórico de precios **ya disponible** (confirmado 2026-06-24). Quedan por verificar coberturas puntuales por módulo (holdings/look-through, métricas concretas).
- **Admin**: pendiente de confirmar alcance (ver §2, fila 8).
- Reversible: todo el estado previo está en `backup/pre-clon-legacy-2026-06-24`.
