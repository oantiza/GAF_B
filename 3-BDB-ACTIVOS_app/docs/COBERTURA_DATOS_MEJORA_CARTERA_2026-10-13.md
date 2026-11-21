# Cobertura de datos para «Mejorar cartera» (fase 0)

**Fuente:** copia local verificada `2026-10-13T11-37-00-001Z` (solo lectura, sin Firestore).  
**Generado por:** `functions_python/scripts/audit_cobertura_equivalencia.py`.  
**Regla de ventana:** 48 semanas por anio (la del optimizador), desde la ultima fecha de la serie, respetando `usable_from`/`blocked` de `fund_history_policies.json`.

## Resumen por vehiculo

## Vehiculo FUND

Activos: **756** (invertibles: 756, estado ACCEPTED: 560)

| Dato | Con dato |
|---|---|
| Serie EUR que cubre 3A (>= 144 semanas) | 718 (95 %) |
| Serie EUR que cubre 5A (>= 240 semanas) | 703 (93 %) |
| Serie con `usable_from` (recorte CNMV) | 68 (9 %) |
| Serie bloqueada por politica | 11 (1 %) |
| Serie con problema (divisa/esquema/calidad) | 0 (0 %) |
| metrics/latest en semanal (WEEKLY) | 713 (94 %) |
| metrics/latest en diario u otra frecuencia | 36 (5 %) |
| metrics/latest sin frecuencia uniforme | 7 (1 %) |
| Tracking error frente a su benchmark (risk) | 708 (94 %) |
| Coste corriente (TER) | 755 (100 %) |
| Categoria | 755 (100 %) |
| Region | 755 (100 %) |
| Texto de estrategia | 0 (0 %) |
| Politica de distribucion (campo) | 0 (0 %) |
| Distribucion INFERIDA del nombre (Acc/Dist/Inc/Cap) | 335 (44 %) |
| Cobertura de divisa INFERIDA del nombre (Hedged/H) | 54 (7 %) |
| Clase declarada (share_class) | 0 (0 %) |
| Fecha de lanzamiento | 0 (0 %) |
| Patrimonio | 2 (0 %) |
| Mezcla de activos (pms_exposure) | 754 (100 %) |
| Sectores | 574 (76 %) |
| Regiones RV | 592 (78 %) |
| Tamanos de empresa | 571 (76 %) |
| Estilo RV (equity_styles) | 569 (75 %) |
| Perfil RF: algun dato (fixed_income_profile) | 752 (99 %) |
| Perfil RF: duracion | 223 (29 %) |
| Perfil RF: calidad crediticia media (avg_credit_quality) | 356 (47 %) |
| Perfil RF: reparto por calidad (credit_quality) | 239 (32 %) |
| Perfil RF: reparto por vencimiento (maturity_allocation) | 346 (46 %) |
| Perfil RF: % IG / % HY | 238 (31 %) |
| Exposicion: duracion por tramos (portfolio_exposure.duration) | 346 (46 %) |
| Exposicion: credito por tramos (portfolio_exposure.credit) | 238 (31 %) |
| Exposicion: tipos de bono (portfolio_exposure.bond_types) | 738 (98 %) |

**Utilizables como candidato hoy** (invertible + serie 3A + TER + categoria): **718 (95 %)**

## Vehiculo ETF

Activos: **19** (invertibles: 19, estado ACCEPTED: 9)

| Dato | Con dato |
|---|---|
| Serie EUR que cubre 3A (>= 144 semanas) | 17 (89 %) |
| Serie EUR que cubre 5A (>= 240 semanas) | 16 (84 %) |
| Serie con `usable_from` (recorte CNMV) | 0 (0 %) |
| Serie bloqueada por politica | 0 (0 %) |
| Serie con problema (divisa/esquema/calidad) | 1 (5 %) |
| metrics/latest en semanal (WEEKLY) | 18 (95 %) |
| metrics/latest en diario u otra frecuencia | 1 (5 %) |
| metrics/latest sin frecuencia uniforme | 0 (0 %) |
| Tracking error frente a su benchmark (risk) | 9 (47 %) |
| Coste corriente (TER) | 11 (58 %) |
| Categoria | 19 (100 %) |
| Region | 11 (58 %) |
| Texto de estrategia | 0 (0 %) |
| Politica de distribucion (campo) | 0 (0 %) |
| Distribucion INFERIDA del nombre (Acc/Dist/Inc/Cap) | 10 (53 %) |
| Cobertura de divisa INFERIDA del nombre (Hedged/H) | 1 (5 %) |
| Clase declarada (share_class) | 0 (0 %) |
| Fecha de lanzamiento | 0 (0 %) |
| Patrimonio | 10 (53 %) |
| Mezcla de activos (pms_exposure) | 13 (68 %) |
| Sectores | 11 (58 %) |
| Regiones RV | 11 (58 %) |
| Tamanos de empresa | 11 (58 %) |
| Estilo RV (equity_styles) | 11 (58 %) |
| Perfil RF: algun dato (fixed_income_profile) | 11 (58 %) |
| Perfil RF: duracion | 0 (0 %) |
| Perfil RF: calidad crediticia media (avg_credit_quality) | 0 (0 %) |
| Perfil RF: reparto por calidad (credit_quality) | 0 (0 %) |
| Perfil RF: reparto por vencimiento (maturity_allocation) | 0 (0 %) |
| Perfil RF: % IG / % HY | 0 (0 %) |
| Exposicion: duracion por tramos (portfolio_exposure.duration) | 0 (0 %) |
| Exposicion: credito por tramos (portfolio_exposure.credit) | 0 (0 %) |
| Exposicion: tipos de bono (portfolio_exposure.bond_types) | 8 (42 %) |

**Utilizables como candidato hoy** (invertible + serie 3A + TER + categoria): **9 (47 %)**

## Fondos por clase economica

| Clase | Fondos | Invertibles | Serie 3A | Serie 5A | TER | Categoria | Region | Distribucion | Mezcla | Sectores | Regiones RV | Tamanos | Perfil RF | Utilizables |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EQUITY | 441 | 441 | 423 | 418 | 440 | 440 | 440 | 0 | 440 | 437 | 438 | 438 | 438 | 423 |
| FIXED_INCOME | 200 | 200 | 188 | 179 | 200 | 200 | 200 | 0 | 200 | 34 | 48 | 29 | 200 | 188 |
| MIXED | 99 | 99 | 91 | 91 | 99 | 99 | 99 | 0 | 98 | 96 | 98 | 96 | 98 | 91 |
| OTHER | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 0 | 10 | 7 | 8 | 8 | 10 | 10 |
| MONEY_MARKET | 6 | 6 | 6 | 5 | 6 | 6 | 6 | 0 | 6 | 0 | 0 | 0 | 6 | 6 |

## Categorias con mas fondos utilizables (candidatos por categoria)

| Categoria | Fondos utilizables |
|---|---|
| EAA Fund EUR Ultra Short-Term Bond | 27 |
| EAA Fund Global Large-Cap Growth Equity | 26 |
| EAA Fund Other Equity | 22 |
| EAA Fund Global Large-Cap Blend Equity | 22 |
| EAA Fund EUR Moderate Allocation - Global | 21 |
| EAA Fund Europe Large-Cap Blend Equity | 21 |
| EAA Fund Sector Equity Technology | 20 |
| EAA Fund Global Emerging Markets Equity | 19 |
| EAA Fund EUR Flexible Allocation - Global | 18 |
| EAA Fund EUR Diversified Bond - Short Term | 18 |
| EAA Fund Global Emerging Markets Bond - EUR Hedged | 18 |
| EAA Fund Asia ex-Japan Equity | 18 |
| EAA Fund EUR Corporate Bond | 15 |
| EAA Fund EUR Aggressive Allocation - Global | 12 |
| EAA Fund Global Small/Mid-Cap Equity | 12 |
| EAA Fund Europe Flex-Cap Equity | 12 |
| EAA Fund EUR Flexible Bond | 12 |
| EAA Fund Global Flex-Cap Equity | 11 |
| EAA Fund Sector Equity Healthcare | 11 |
| EAA Fund Europe Large-Cap Growth Equity | 10 |
| EAA Fund EUR High Yield Bond | 10 |
| EAA Fund Global Large-Cap Value Equity | 10 |
| EAA Fund Europe Large-Cap Value Equity | 10 |
| EAA Fund India Equity | 10 |
| EAA Fund Sector Equity Ecology | 10 |
| EAA Fund EUR Cautious Allocation | 9 |
| EAA Fund Eurozone Large-Cap Equity | 9 |
| EAA Fund EUR Cautious Allocation - Global | 9 |
| EAA Fund EUR Diversified Bond | 9 |
| EAA Fund US Large-Cap Blend Equity | 9 |
| EAA Fund Global High Yield Bond - EUR Hedged | 9 |
| EAA Fund Sector Equity Alternative Energy | 9 |
| EAA Fund Spain Equity | 8 |
| EAA Fund Global Equity Income | 8 |
| EAA Fund Latin America Equity | 8 |
| EAA Fund Fixed Term Bond | 7 |
| EAA Fund Multistrategy EUR | 7 |
| EAA Fund Europe Small-Cap Equity | 7 |
| EAA Fund Global Flexible Bond - EUR Hedged | 7 |
| EAA Fund Global Inflation-Linked Bond - EUR Hedged | 7 |

Categorias con un solo fondo utilizable (sin sustituto dentro de la categoria): **31 de 122**.

## Valores de distribucion y frecuencia de metricas

Distribucion (fondos): {'None': 756}

Frecuencia metrics/latest (fondos): {'WEEKLY': 713, 'PROVIDER': 36, 'None': 7}

Banda crediticia RF (fondos con perfil): {'None': 396, 'IG': 264, 'HY/sin grado': 92}

## Familias con mas de una clase (mismo fondo, distinta clase)

Familias detectadas por nombre normalizado: **74** con mas de una clase, que agrupan 152 activos. Deteccion heuristica: confirmar con correlacion ~1 en la fase 3.

| Familia | Clases | Ejemplos (id · TER) |
|---|---|---|
| cartera renta fija horizonte | 3 | ES0116419005 · 0.70 %, ES0162295002 · 0.70 %, ES0162296000 · 0.32 % |
| polar capital funds polar capital healthcare opportunities | 3 | IE00B28YJQ65 · 1.60 %, IE00B3NLSS43 · 1.60 %, IE00BKSBDB61 · 1.60 % |
| blackrock global funds world mining e2 | 3 | LU0090845842 · 2.56 %, LU0172157363 · 2.56 %, LU0326425351 · 2.56 % |
| schroder international selection global climate change equit | 3 | LU0302445910 · 1.83 %, LU0302446645 · 1.83 %, LU0302446991 · 2.43 % |
| cartesio | 2 | ES0116567035 · 0.63 %, ES0182527038 · 0.87 % |
| gesconsult | 2 | ES0138922002 · 0.62 %, ES0138922036 · 0.74 % |
| ubs corto plazo | 2 | ES0155598008 · 0.17 %, ES0155598032 · 0.23 % |
| mutuafondo corto plazo | 2 | ES0165142003 · 0.53 %, ES0165142037 · 0.30 % |
| gesconsult leon valores mixto flexible | 2 | ES0175604000 · 1.72 %, ES0175604034 · 2.18 % |
| sigma investment house megatrends | 2 | ES0184949008 · 2.31 %, ES0184949016 · 1.76 % |
| carmignac investissement | 2 | FR0010148981 · 2.45 %, FR0010312660 · 3.18 % |
| edr euro sustainable credit | 2 | FR0010172767 · 1.10 %, FR0013201001 · 1.25 % |
| co valor | 2 | FR0011253624 · 1.58 %, FR0011261197 · 1.93 % |
| amundi ultra short term bond responsible | 2 | FR0011365212 · 0.36 %, FR0050000860 · 0.32 % |
| edr short duration credit | 2 | FR0013460920 · 0.85 %, FR0013460961 · 0.85 % |
| axa im equity trust axa im all country asia pacific ex japan | 2 | IE0031069499 · 1.80 %, IE0034277479 · 2.57 % |
| polar capital funds polar capital global technology | 2 | IE00BM95B621 · 1.59 %, IE00BZ4D7648 · 1.59 % |
| fidelity msci world index | 2 | IE00BYX5NX33 · 0.12 %, IE00BYX5P602 · 0.17 % |
| aegon global diversified | 2 | IE00BYYPF474 · 1.17 %, IE00BYYPF581 · 1.17 % |
| invesco funds invesco euro ultra short term debt | 2 | LU0102737730 · 0.39 %, LU0102737904 · 0.26 % |
| schroder international selection emerging europe | 2 | LU0106817157 · 1.85 %, LU0106819104 · 2.45 % |
| fidelity funds global financial services | 2 | LU0114722738 · 2.64 %, LU1391767586 · 1.90 % |
| fidelity funds global industrials | 2 | LU0114723033 · 2.68 %, LU2504555777 · 1.94 % |
| fidelity funds iberia | 2 | LU0115765678 · 2.67 %, LU0261948904 · 1.93 % |
| fidelity funds world | 2 | LU0115769746 · 2.63 %, LU1084165304 · 1.88 % |

## Inventario de claves presentes (numero de activos con la clave rellena)

- `classification`: asset_class (775), fondosdb_asset_type (774), fondosdb_asset_class (773), region_primary (766), confidence (765), morningstar_rating (707), asset_subtype (9), strategy_tags (1)
- `product`: has_listing (775), product_type (775), commercial_type (774), vehicle_complexity (773), fund_name (767)
- `costs`: management_fee_pct (765), ter_pct (763), mifid_ongoing_pct (753), entry_fee_max_pct (2), transaction_costs_pct (2), exit_fee_max_pct (2), performance_fee_pct (2), evidence (2), depositary_fee_pct (1), note (1), source (1), performance_fee_basis (1), kid_evidence (1), service_fee_pct (1), as_of_date (1)
- `risk`: sri_kid_1a7 (765), fecha_dato (764), volatilidad_pct (764), sharpe (751), srri_1a7 (726), r2 (724), beta (724), tracking_error_pct (717), alpha (613), kid_periodo_mantenimiento_anos (493), sri_kid_evidence (481), information_ratio (425), max_drawdown (12), rf_pct (10), historial_precios (10), max_drawdown_hist (2)
- `fixed_income_profile`: bond_sectors (746), avg_credit_quality (356), universal_vencimientos_pct (346), maturity_allocation (346), universal_ytw_distribucion_pct (318), ytw_distribution (318), credit_quality (239), investment_grade_pct (238), high_yield_pct (238), yield_to_maturity (218), modified_duration (197), effective_duration (188), effective_maturity (171), field_provenance (23), reported_yield_pct (6), reported_duration (5), yield_to_worst (3), current_yield (3), weighted_average_duration (2)
- `portfolio_exposure`: asset_mix (766), exposure_confidence (765), version (763), bond_types (746), equity_regions (603), sectors (585), market_caps (582), equity_styles (580), duration (346), credit (238), warnings (2), as_of_date (1), evidence (1), source (1), country_weights_pct (1), currency_weights_pct (1)

## Lectura para el plan

- Los criterios de la capa 1 (vehiculo, clase, categoria, region, distribucion) y la capa 2 (mezcla, sectores, regiones RV, tamanos) se evaluan con las columnas de arriba; un dato ausente se declara «sin dato» y nunca cuenta como coincidencia.
- El perfil de renta fija existe solo en la raiz: para usarlo en la app hay que mapearlo en `readmodel/mappers.map_asset_detail` (fase 1 del plan).
- La politica de distribucion, la clase y la fecha de lanzamiento NO existen como campo en la raiz: solo se pueden inferir del nombre y hay que marcarlas como inferidas.
- Las series de fondos son NAV: comparar solo dentro de la misma politica de distribucion (inferida), o avisar.
- La deteccion de familias por nombre tiene falsos positivos (fondos distintos de una misma gestora): confirmar siempre con correlacion de series.
