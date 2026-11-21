# Inventario de formato de cifras y fechas, y de vocabulario

*Anexo de la auditoría del 13-11-2026: las funciones de formato que hay, el formato escrito a mano, las incoherencias por tipo de dato, la lectura de cifras escritas por el usuario y los términos que conviven para cada concepto. Rutas relativas a `3-BDB-ACTIVOS_app`.*

## A. Inventario de funciones de formato

### A.1 Los tres módulos base

**`src/core/format.ts`** — el de toda la app salvo el Gestor. Importado por **148 ficheros** (`from ".../core/format"`).

| Función | Línea | Recibe | Decimales | Millares 4 cifras | Espacio antes de unidad | Signo + | Menos | Ausente | Uso medido |
|---|---|---|---|---|---|---|---|---|---|
| `fmtPct` | 18 | **fracción** (0,123) | 2 por defecto | no (`1234,56 %`) | espacio normal U+0020 antes de `%` | no | `−` (U+2212); **«−0,00 %» en negativos que redondean a cero** | `N/D` | 393 llamadas, 104 ficheros |
| `fmtNum` | 40 | número | 2 | **no** (`1234,56`) | — | no | `−`; «−0,00» | `N/D` | 100 llamadas, 50 ficheros |
| `fmtMiles` | 57 | número | 0 | sí (`useGrouping:"always"`) | — | no | `−` | `N/D` | 55 llamadas, 21 ficheros |
| `fmtEur` | 77 | euros | **0 por defecto** | sí | NBSP U+00A0 (lo pone `Intl`) | no | `−` | `N/D` | 180 llamadas, 44 ficheros |
| `fmtDate` | 122 | ISO día o instante | — | — | — | — | — | `N/D` | `13/11/2026`; día en UTC, instante en hora local; ~120 llamadas, 26 ficheros |
| `fmtDateLong` | 138 | ídem | — | — | — | — | — | `N/D` | `viernes, 13 de noviembre de 2026`; 5 llamadas, 3 ficheros |
| `fmtDateTime` | 159 | ídem | — | — | — | — | — | `N/D` | `13/11/2026 · 13:45`; 6 llamadas, 4 ficheros |
| `fmtDayShort` | 185 | ídem | — | — | — | — | — | `N/D` | `13 nov 2026` (**`sept`** en septiembre); **siempre en UTC, también los instantes**; 124 llamadas, 38 ficheros |
| `fmtDateWith` | 114 | ISO + opciones | — | — | — | — | — | `null` | 7 llamadas, 5 ficheros |
| `pctColumnDigits` | 36 | puntos | 0 ó 1 | — | — | — | — | — | 2 ficheros |

**`src/gestor/ui/formato.ts`** — la pantalla del Gestor de carteras (26 ficheros de `src/gestor/ui`). No usa `core/format`.

| Función | Línea | Recibe | Decimales | Millares | Espacio | Signo + | Menos / cero | Ausente |
|---|---|---|---|---|---|---|---|---|
| `importe` | 21 | importe + divisa | 2 | sí | **espacio normal** | no | `−`, sin signo en cero | no admite `null` |
| `importeRedondo` | 26 | ídem | 0 | sí | normal | no | ídem | — |
| `importeConSigno` | 31 | ídem | 2 | sí | normal | sí | ídem | — |
| `porcentaje` / `porcentajeConSigno` | 37/41 | **fracción** | 2 | sí | normal | /sí | ídem | — |
| `puntos` | 47 | fracción | 2 | sí | normal | sí | ídem | — · unidad **«pp»** |
| `ratio` | 53 | número | 2 | sí | — | no | ídem | — |
| `titulos` | 58 | Decimal | 0–6 | sí | — | no | ídem | — |
| `precio` | 64 | número | 2–4 | sí | normal | no | ídem | — |
| `fecha` / `fechaLarga` / `fechaCorta` | 73/78/83 | `Dia` | — | — | — | — | — | — · escritas a mano: `13 nov 2026` (**`sep`**), `13 de noviembre de 2026`, `13/11/2026` |
| `valorDeMetrica` | 90 | valor + formato | según formato | | | | | |
| Símbolos | 18 | `EUR→€`, **`USD→$`**, `GBP→£`, resto el código | | | | | | |

**`src/gestor/informes/formato.ts`** — los PDF y el Excel del Gestor (31 ficheros). Delega en `core/format`.

| Función | Línea | Diferencia con la pantalla del Gestor |
|---|---|---|
| `importe` / `importeConSigno` | 22/29 | EUR por `fmtEur` (NBSP); **otra divisa con su código ISO: «1.234,56 USD»**; ausente **«No disponible»** |
| `porcentaje` / `porcentajeConSigno` | 35/40 | por `fmtPct` + `sinSignoEnCero`; ausente «No disponible» |
| `puntos` | 46 | unidad **«p.p.»** (asesor) o **«puntos»** (cliente) |
| `numero` | 52 | por `fmtNum` (**sin millares en cuatro cifras**) |
| `titulos` / `precio` | 61/67 | ausente **cadena vacía** (no «No disponible») |
| `fechaLarga` / `fechaCorta` | 75/81 | por `Intl` / `fmtDate`; `MESES_CORTOS` en **«Ene», «Feb»…** (mayúscula) |
| `periodoEnPalabras` / `periodoCorto` | 95/100 | «Del 1 de enero de 2026 al …», «01/01/2026 – 13/11/2026» |

### A.2 Funciones locales (reescriben o envuelven), agrupadas por lo que hacen

Recuento: **unas 95 funciones locales en ~70 ficheros**, además de las 37 exportadas por los tres módulos. Las agrupo:

**Porcentaje que recibe «puntos» (12,3) y divide por 100 en el sitio.** `fmtPct(x / 100, …)` aparece **144 veces en 63
ficheros**. Funciones con nombre: `pctPoint` (`charts/oaa/chartFormatters.ts:7`), `formatHoldingWeight`
(`components/AssetHoldingsSection.tsx:11`, 2 dec.), `formatPercent` (`components/HistoricalStressCards.tsx:18`, 1 dec.,
ausente «N/D»; `components/PortfolioXray.tsx:36`, 1 dec.; `components/RiskContributionChart.tsx:21`, 1 dec.),
`percentLabel` (`charts/oaa/OaaStyleBoxChart.tsx:10`, 0 dec.), `fmt` (`charts/GeoDistributionMap.tsx:44`, 1 dec.),
`fmtPercentValue` (`reports/informeDeClientePdf.tsx:238`), `porcentaje` (`pages/JubilacionPage.tsx:51`, 0 ó 1 dec.),
`pct` (`core/asignacionTactica.ts:108`, 0 ó 1), `cifraDeLaCrisis` (`core/crisisPasadas.ts:89`, 1, quita el signo del
cero), `fmtRetroPoints` (`core/positionsShared.ts:30`, con «+»), `retroDe`/`retroMediaDe`
(`reports/internalPortfolioReportPdf.tsx:229,232`), `pesoDeLimite` (`adapters/tablaDeComposicion.tsx:84`, `fmtNum` + «%»
a mano), `peso` (`components/CambiosDePeso.tsx:36`, `fmtNum` + « %»), `benchmarkProfiles.ts:72` (`Math.round` + « %»).

**Porcentaje que recibe fracción (envoltorios de `fmtPct`).** `pctDecimal` (`chartFormatters.ts:3`, 1 dec.),
`formatDecimalAsPercent` (`adapters/portfolioFrontierAdapter.ts:58`, 2), `fmtDecimalPct` (`components/AdminInspector.tsx:41`,
1, ausente **«—»**), `formatWeight` (`components/PortfolioConstraintsPanel.tsx:13`, 1), `pct` (`components/FrontierPanel.tsx:35`, 1;
`components/WealthComparator.tsx:47`, 2; `reports/assetComparePdf.tsx:153`, **1**; `adapters/comparativaDeActivos.ts:490`, **2**;
`adapters/tablaDeRendimiento.tsx:52`, 2; `adapters/componerFicha.ts:186`, 2 con `Number(valor)`), `fmtPercentDecimal`
(`informeDeClientePdf.tsx:234`, 1), `pct` (`internalPortfolioReportPdf.tsx:202`, 1, quita signo del cero), `porcentaje`
(`reports/costsPdf.tsx:32`, 2, ausente «Falta el dato»), `cifraEnPorcentaje` (`core/seguimientoPeriodico.ts:128`).
Y uno **escrito a mano con `toFixed`**: `pctText` (`core/internalPortfolioReport.ts:880`: `(value*100).toFixed(d).replace(".", ",") + " %"`, guion como menos).

**Porcentaje con «+».** Trece implementaciones: `pctConSigno` (`componerFicha.ts:193`, `fichaDelEmisor.ts:37`), `conSigno`
(`comparativaDeActivos.ts:491`, `components/tabla/PlanoRiesgoRetorno.tsx:70`), `escribirVariacion`
(`components/AssetHistoryChart.tsx:36`, 1 dec.), `pctSigned` (`internalPortfolioReportPdf.tsx:203`), `porcentajeConSigno`
(los dos del Gestor), `fmtRetroPoints`, `signed` (`components/PortfolioImprovementPanel.tsx:105` y su copia exacta
`reports/improvementProposalPdf.tsx:77`), `signed` (`reports/comparePdf.tsx:94`), `diferencia`
(`components/MetricasComparativas.tsx:18`). Solo cinco quitan el signo a lo que redondea a cero.

**Diferencia en puntos.** «pp»: `gestor/ui/formato.ts:47`, `comparePdf.tsx:96`, `PortfolioImprovementPanel.tsx:105`,
`improvementProposalPdf.tsx:77`, `MetricasComparativas.tsx:18`, `CambiosDePeso.tsx`. «p.p.»: `gestor/informes/formato.ts:46`,
`internalPortfolioReportPdf.tsx:267`. «puntos»: papel de cliente del Gestor y frase de portada de `comparePdf.tsx`.

**Importe en euros.** `fmtEur` (0 dec. por defecto) y sus envoltorios: `fmtEuro` (`informeDeClientePdf.tsx:247`), `eur`
(`internalPortfolioReportPdf.tsx:205`, 0), `formatEurValue` (`reports/realPortfolioPdf.tsx:223`, 0), `euros`
(`costsPdf.tsx:31`, 0, «< 1 €» por debajo de medio euro), `euros` y `cifra` (`components/jubilacion/*.tsx`, 0),
`cifraEnEuros`/`cifraConSigno` (`seguimientoPeriodico.ts:121,123`, 2), `eurosConSigno` (`core/propuestaDeCambio.ts:60`, 2),
`importe` (`CambiosDePeso.tsx:43`, 0 con «+»; `asignacionTactica.ts:253`, 0 ó 2 según sea entero), `eurosExactos`
(`core/jubilacion/fiscal.ts:183`, 0 ó 2), `enEuros` (`core/capitalDeLaComparativa.ts:75`). **Fuera de `fmtEur`:**
`euros` (`components/planes/FichaDelPlan.tsx:35`: `fmtNum(v, 2) + " €"`, sin millares), `celdaDelValor`
(`core/planes/lectura.ts:85`: `fmtNum(v, 5) + " €"`), `euros` (`gestor/motor/integridad.ts:171`: `toFixed(2).replace(".", ",") + " " + divisa`),
`importeEnTexto` (`gestor/importacion/andbank/comun.ts:145`: millares a mano, guion `-`), `euroDisplayFormat`
(`components/ui/EuroAmountInput.tsx:7`, 0–2 dec., sin «€»), `formatPlainEurAmount` (`core/eurAmount.ts:275`, sin millares, a propósito).

**Importe en otra divisa o grande.** `money` (`components/AssetDetail.tsx:85`: `Intl` con `currency` → «1.234 US$»; por
encima del millón `notation:"compact"` → «2500 M €», «1500 M US$»), `importeGrande` (`core/cifrasDeFicha.ts:14`:
«1.007,8 M€», «12,3 B€», «500.000€», «1.500,0 M USD»), `importeNegociado` (`core/loNegociado.ts:33`: «150 M€», «330 M CHF»,
«56.000 $»), `escribirImporte` (`core/agendaDeMercado.ts:136`: 2–4 dec., **sin millares**, «0,50 €» / «1,25 USD»),
`componerLista.ts:295` (`fmtMiles(v/1e6,1) + " M€"`), ejes compactos `eurosDelEje` (`GraficosDeJubilacion.tsx:36`),
`ejeEnEuros` (`gestor/informes/papel/graficos.tsx:131`), `compacto` (`reports/jubilacionPdf.tsx:137`) → «250 mil €»; y
`internalPortfolioReportPdf.tsx:772` → **«250 k€»**.

**Número sin unidad / ratio / precio.** `chartNumber`/`base100` (`chartFormatters.ts:11,15`, 1 dec.), `formatRatio`
(`portfolioFrontierAdapter.ts:63`), `ratio` (`assetComparePdf.tsx:154`, `internalPortfolioReportPdf.tsx:204`), `num`
(`componerFicha.ts:199`, `tablaDeRendimiento.tsx:53`), `fmtNumber` (`informeDeClientePdf.tsx:243`), `formatMetric`
(`components/AssetDetailMetrics.tsx:14`, `reports/realPortfolioPdf.tsx:211`), `precio` (`core/cifrasDeFicha.ts:7`: 2–4
dec. según `String(numero)`, ausente «Falta el dato»), `formatoDeAnos` (`core/perfilYHorizonte.ts:90`), `numberFormat`
(`pages/SystemStatusPage.tsx:99`, sin millares), `formatEuropeanNumber` (`core/commercialRetroCsv.ts:598`, sin millares),
`formatCorrectionValue` (`core/opsLocal.ts:34`, guion), `ejeEnBase100` (`gestor/informes/papel/graficos.tsx:132`),
`toLocaleString("es-ES")` en `AdminFundQuality.tsx:46,48,64`, `DialogoDeVersiones.tsx:31,35`, `fundQualityBackend.ts:23`
(todos **sin millares en cuatro cifras**: «1234 observaciones», «1234 movimientos»).

**Fechas.** Además de la familia `fmtDate*` y las tres del Gestor: `fmtDate` local (`informeDeClientePdf.tsx:223`, UTC,
devuelve el texto si no es fecha), `fmtDate` local (`pages/AdminPage.tsx:294`, ausente «—»), `formatDate`
(`HistoricalStressCards.tsx:23`: **«08 mar 2020»** con cero), `formatDate` (`pages/StrategyPage.tsx:92`: «08 mar 2020»),
`formatDate` (`SystemStatusPage.tsx:124`: `dateStyle:"medium"`, y con hora «13 nov 2026, 15:04» en `Europe/Madrid`),
`formatDate` (`realPortfolioPdf.tsx:218`), `longDate` (`internalPortfolioReportPdf.tsx:299`), `shortDate`
(`informeDeClientePdf.tsx:586`: «sept 26»), `fechaYHora` (`gestor/ui/dialogos/DialogoDeVersiones.tsx:22`: «13 nov 2026,
15:04»), `textoDeGuardada`/`diaDeGuardada` (`core/textosDeCartera.ts:23,47`: hora local), `fechaEnTexto`
(`andbank/comun.ts:214`), `EconomicCalendarPanel.tsx:99,110` (`toLocaleDateString` «viernes, 13 de noviembre», sin año,
y `toLocaleTimeString`), `EarningsPanel.tsx:55` (`fmtDateLong`, con año), fechas de emisión de los PDF
(`costsPdf.tsx:137`, `improvementProposalPdf.tsx:109`, `jubilacionPdf.tsx:242`: `dateStyle:"long"`), `fechaDeCopia`
(`gestor/almacen/copias.ts:36`), `diaLocal` (`core/fechaLocal.ts:13`, la que corrige el día de un instante; 7 ficheros).

**Texto del servidor reescrito.** `textoEnPantalla` y `cifrasEnPantalla` (`core/glosarioDePantalla.ts:129,138`): la
segunda cambia `.` por `,` entre dígitos, `-` por `−` y pone NBSP antes de `%`/`pp` (ver FMT-02).

## B. Formato escrito a mano

| Tipo | Recuento | Notas |
|---|---|---|
| `toFixed(` (todas) | 87 en 33 ficheros | la mayoría son coordenadas de SVG o claves; **para mostrar: 14** (abajo) |
| `replace(".", ",")` | 15 en 12 ficheros | 9 para mostrar, 6 para exportar o rellenar un campo |
| `toLocaleString("es-ES")` | 7 en 3 ficheros | todos con locale; ninguno con `useGrouping:"always"` |
| `toLocaleDateString` / `toLocaleTimeString` | 1 + 1 | `EconomicCalendarPanel.tsx`, con locale |
| `new Intl.NumberFormat` fuera de los módulos | 19 en 14 ficheros | 6 sin agrupación de cuatro cifras |
| `new Intl.DateTimeFormat` fuera de `core/format` | 22 en 12 ficheros | formatos: `13/11/2026`, `13 nov 2026`, `08 mar 2020`, `13 de noviembre de 2026`, `sept 26`, `13 nov 2026, 15:04` |
| `fmtNum(…) + " %"` a mano | 17 | en lugar de `fmtPct` |
| `fmtPct(x / 100)` (multiplica/divide en el sitio) | 144 en 63 ficheros | dos unidades de entrada conviven |
| `" pp"` a mano | 7 | |
| `" €"` / `" €"` / `" M€"` / `" k€"` a mano | 18 | |
| Fecha ISO `AAAA-MM-DD` interpolada en un mensaje visible | 9 (`gestor/motor`) | ver FMT-03 |
| `toISOString().slice(0,10)` para «hoy» o un instante | 5 visibles (`AdminRetrocessions.tsx:82,87`, `commercialRetroCsv.ts:37,160`, `internalPortfolioReportPdf.tsx:1877` con `savedAt.slice(0,10)`) | día UTC |

**Los 30 más visibles para el usuario** (fichero:línea · fragmento · lo que sale):

1. `gestor/motor/integridad.ts:206` · `` `Hay ${n} movimientos iguales el ${primero.fechaOperacion}…por ${euros(…)}` `` · «el 2026-03-14 … por 1500,00 EUR» (pantalla Gestor y PDF del asesor)
2. `gestor/motor/integridad.ts:217` · `` `queda en negativo desde el ${tramo.desde} (llega a ${euros(tramo.minimo…)})` `` · «desde el 2026-03-14 (llega a -1250,40 EUR)», guion y sin millares
3. `gestor/motor/integridad.ts:242` · `` `${quien} pesa un ${(…*100).toFixed(1).replace(".", ",")} % de la cartera.` ``
4. `gestor/motor/integridad.ts:256` · `` `La cartera no cuadra con el extracto del ${conciliacion.extracto.fecha}` `` · fecha ISO
5. `gestor/motor/libro.ts:256` · `` `El ${apunte.fecha} salen ${pedidos.toFixed()} títulos … solo había ${…toFixed()}` `` · «El 2026-03-14 salen 12.5 títulos»: **punto decimal**
6. `gestor/motor/libro.ts:190` · `` `No hay tipo de cambio ${divisa}/${base} para el ${apunte.fecha}` ``
7. `gestor/motor/valoracion.ts:420` · `` `el precio de la compra del ${mayor.fecha} queda un ${(…*100).toFixed(1).replace(".", ",")} %` ``
8. `gestor/motor/valoracion.ts:458` · `` `No hay tipo de cambio ${divisa}/${base} desde el ${fecha}` ``
9. `gestor/motor/valoracion.ts:595` · `` `${nombre} no tiene ningún precio desde el ${dia}` ``
10. `core/planes/lectura.ts:85` · `` `${fmtNum(plan.valor.importe, 5)} €` `` · «1234,56789 €» junto a «12.345,67890 €»
11. `components/planes/FichaDelPlan.tsx:35` · eje del gráfico del valor: `` `${fmtNum(valor, 2)} €` ``
12. `core/cifrasDeFicha.ts:23` · `` `${fmtMiles(numero)}${simbolo}` `` · «500.000€» sin espacio
13. `components/AssetDetail.tsx:96-101` · `notation:"compact"` · «2500 M €», «1500 M US$»
14. `reports/internalPortfolioReportPdf.tsx:772` · `` `${Math.round(g / 1000)} k€` `` · «250 k€»
15. `components/jubilacion/GraficosDeJubilacion.tsx:36` · `` `${compacto.format(valor)} €` `` · «250 mil €»
16. `core/internalPortfolioReport.ts:881` · `pctText` con `toFixed` · puntos de revisión del informe completo
17. `core/internalPortfolioReport.ts:928` · `` `cubre el ${coverage.toFixed(1).replace(".", ",")} % del peso` ``
18. `core/internalPortfolioReport.ts:950` · `` `Número efectivo de posiciones ${….toFixed(1).replace(".", ",")}` ``
19. `adapters/portfolioHorizon.ts:110` · `` `${analysis.coverageWeightPercent.toFixed(1).replace(".", ",")} % del peso` ``
20. `components/EconomicCalendarPanel.tsx:99` · `toLocaleDateString("es-ES", { weekday:"long", day:"2-digit", month:"long" })` · «viernes, 13 de noviembre» (sin año; `EarningsPanel` lo pone con año)
21. `components/EconomicCalendarPanel.tsx:110` · `toLocaleTimeString` · hora sin zona dicha
22. `components/AdminFundQuality.tsx:46` · `` `${fondo.history_observations.toLocaleString("es-ES")} observaciones` `` · «1234 observaciones»
23. `gestor/ui/dialogos/DialogoDeVersiones.tsx:35` · `` `${n.toLocaleString("es-ES")} movimientos` `` · «1234 movimientos»
24. `gestor/ui/dialogos/DialogoDeVersiones.tsx:22-25` · fecha y hora con `padStart` a mano · «13 nov 2026, 15:04»
25. `components/HistoricalStressCards.tsx:32` · `day:"2-digit", month:"short"` · «08 mar 2020»
26. `reports/comparePdf.tsx:464` · `Fecha de emisión: ${fmtDate(…)}` · «13/11/2026», frente a «viernes, 13 de noviembre de 2026» de `assetComparePdf.tsx:376`
27. `components/CambiosDePeso.tsx:36` · `` `${fmtNum(valor)} %` `` · peso con 2 decimales
28. `adapters/tablaDeComposicion.tsx:95-98` · `` `Fijado · ${pesoDeLimite(…)} %` `` · límites de peso
29. `charts/EuroYieldCurveChart.tsx:66` · `` `${fmtNum(Number(value), 1)} %` `` · eje
30. `core/medidaDeLaCartera.ts:137` · `fmtPct(…).replace(" %", " %")` · parche local del espacio

## C. Incoherencias por tipo de dato

| Tipo de dato | Formas | Ejemplos de salida y dónde |
|---|---|---|
| **Importe en euros** | 7 | «1.234 €» NBSP, 0 dec. (`fmtEur` por defecto: Diseño, Análisis, PDF de cartera) · «1.234,56 €» NBSP (`fmtEur(v,2)`: informes del Gestor, seguimiento) · «1.234,56 €» espacio normal (pantalla del Gestor) · «1234,56 €» sin millares (`planes/lectura.ts:85`, `FichaDelPlan.tsx:35`) · «1500,00 EUR» con guion (`integridad.ts:171`) · «1.234,56» + «€» a mano (`andbank/comun.ts:145`) · «< 1 €» (`costsPdf.tsx:31`) |
| **Importe grande** | 5 | «1.007,8 M€» (`cifrasDeFicha`, `componerLista`) · «2500 M €» (`AssetDetail` compacto) · «150 M€» (`loNegociado`) · «250 mil €» (ejes de Jubilación y del Gestor) · «250 k€» (`internalPortfolioReportPdf.tsx:772`); y «12,3 B€» para el billón español |
| **Importe en otra divisa** | 4 | «1.234,56 $» (pantalla Gestor) · «1.234,56 USD» (informes Gestor) · «1.234 US$» (`AssetDetail`) · «1.500,0 M USD» (`cifrasDeFicha`) |
| **Rentabilidad (%)** | 5 | «+7,46 %» (comparativa y ficha, 2 dec. con signo) · «7,5 %» (PDF de comparativa, 1 dec. sin signo) · «7,5 %» (Análisis `medidaDeLaCartera.ts:450`, 1 dec.) · «+7,46 %» (Gestor, 2 dec.) · «−0,00 %» en lo que redondea a cero, fuera del Gestor y del informe completo |
| **Peso de cartera** | 5 | «56,0 %» (`PortfolioXray`, 1) · «56,00 %» (`CambiosDePeso`, `OptimizationPreviewPanel`, `CostsModal`, 2) · «40 %» / «33,3 %» (`asignacionTactica`, `pesoDeLimite`, `medidaDeLaCartera`, 0 ó 1) · «40 %» (`benchmarkProfiles`, `Math.round`) · «56,0» sin «%» (`BdbActivosApp.tsx:80`, total del raíl) |
| **Volatilidad** | 2 | 2 dec. (ficha, comparativa, planes, Gestor) · 1 dec. (Análisis, PDF de comparativa, informe de cliente, informe completo) |
| **Ratio (Sharpe…)** | 1 | «1,25» en todas partes (2 dec.). Coherente |
| **Precio / valor liquidativo** | 5 | 2 dec. (`fmtNum` por defecto) · 2–4 «real» (`cifrasDeFicha.precio`, `String(n)`) · 2–4 (Gestor pantalla e informe) · 2–4 sin millares (`agendaDeMercado`) · 5 dec. sin millares (planes) |
| **Títulos / participaciones** | 3 | 0–6 dec. con millares (Gestor) · `toFixed()` con **punto** (`libro.ts:256`) · `fmtNum` (otros) |
| **Fecha** | 7 | «13/11/2026» (`fmtDate`) · «13 nov 2026» / «13 sept 2026» (`fmtDayShort`) · «13 nov 2026» / «13 sep 2026» (Gestor) · «08 mar 2020» (`HistoricalStressCards`, `StrategyPage`) · «13 de noviembre de 2026» (Gestor, PDF) · «viernes, 13 de noviembre de 2026» (`fmtDateLong`) · «2026-11-13» (avisos del motor del Gestor) |
| **Fecha y hora** | 3 | «13/11/2026 · 13:45» (`fmtDateTime`) · «13 nov 2026, 15:04» (`DialogoDeVersiones`, `SystemStatusPage`) · «Guardada el 3 nov 2026, 12:30» (`textosDeCartera`) |
| **Periodo** | 4 | «01/01/2026 – 13/11/2026» (Gestor) · «Del 1 de enero de 2026 al 13 de noviembre de 2026» (papel del Gestor) · «3 años» (`ventanaEnPalabras`) · «1A / 3A / Vol 3A» (columnas del papel, `comparativaDeActivos.ts:107-114`) |
| **Mes** | 3 | «ene» (`NOMBRE_DEL_MES`, pantalla Gestor) · «Ene» (`MESES_CORTOS`, informes Gestor) · «sept 26» (`informeDeClientePdf.tsx:588`) |
| **Diferencia en puntos** | 3 | «+1,23 pp» · «+1,23 p.p.» · «1,2 puntos» |
| **Puntos básicos** | 0 | no se usan en ningún texto |
| **Ausencia** | 7 | «N/D» (`core/format`, 38 literales y 29 ficheros con `ND`) · «No disponible» (Gestor informes) · «Falta el dato» / «Falta» (`textoDeAusencia`, 39 ficheros) · «No aplica» · «—» (42 literales) · «-» · cadena vacía (Gestor `titulos`/`precio`, `FichaDelPlan`, ejes) |

**Las que verá un asesor como contradicción:**
1. Comparativa de activos: «+7,46 %» en pantalla, «7,5 %» en el PDF de la misma comparación (FMT-01).
2. Gestor: «+0,85 pp» en pantalla y «+0,85 p.p.» en su informe del asesor; «12.400,00 $» en pantalla y «12.400,00 USD» en el PDF (FMT-04).
3. Gestor: «13 sep 2026» en la pantalla del Gestor y «13 sept 2026» en el resto de la app (FMT-09).
4. Gestor: el mismo indicador se llama «Máxima caída» en pantalla y «Mayor caída» en el informe del cliente, y «Caída máxima» en el resto de la app (FMT-11).
5. Planes: el valor de la participación «1234,56789 €» sin punto de millar y, en otra fila, «12.345,67890 €» (FMT-06).

## D. Lectura de cifras escritas por el usuario

| Lector | Dónde | `1.234,56` | `1,234.56` | `1234.5` | `12.500` | `1,234,567` | vacío | espacios | `%` / `€` | `EUR` | menos `−` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `parseEuropeanNumber` (`core/numberFormat.ts:32`) | `EuroAmountInput` (importes y **pesos** del Diseño, Jubilación, comisión en €), importaciones, retrocesiones | 1234,56 | 1234,56 | 1234,5 | **12500** | 1234567 | NaN | se quitan | se quitan | se quita | sí |
| `leerCifra` (`gestor/motor/decimal.ts:113`) | formulario de movimientos, ajustes, selector de activo, plantilla | 1234,56 | 1234,56 | 1234,5 | **12500** | **no válido** | `undefined` | se quitan | `%`, `€`, `$` se quitan | **no válido** | sí |
| `Number(texto)` sobre `<input type="number">` | `FormularioDeJubilacion.tsx:104` (edades, %), `PortfolioManagementFee.tsx:11,19` (comisión %), `CostsModal.tsx:46` (retrocesión), `WealthComparator.tsx:157` (tipo del depósito), `EfectoDeLosCostes.tsx:36`, `PositionsWorkbench.tsx:1045`, `OptimizerPanel.tsx:362-403`, `PortfolioImprovementPanel.tsx:322-346` | lo decide el navegador | ídem | 1234,5 | 12,5 o vacío según navegador | — | 0 o `null` | — | rechazado por el navegador | — | — |
| `parseFloat(t.replace(",", "."))` | `core/opsLocal.ts:30` (correcciones del panel de operaciones) | **texto** (no casa) | texto | 1234,5 | texto | texto | `null` | — | — | — | no |

- **No he encontrado `parseFloat`/`Number` directo sobre un `<input type="text">` de importe**: los importes y pesos ya
  pasan por `EuroAmountInput` (el comentario de `PortfolioPositionsTable.tsx:170` cuenta el fallo que lo motivó). Lo que
  queda con `Number` son campos `type="number"` de porcentajes y edades, donde quien interpreta la coma es el navegador
  (`lang="es"` solo lo tienen algunos: `PortfolioManagementFee`, `EfectoDeLosCostes`, `PositionsWorkbench`,
  `PortfolioImprovementPanel`, `FormularioDeJubilacion`). Confianza: sospecha; hay que probar «0,5» y «0.5» en Chrome,
  Edge y Firefox con el idioma del sistema en español.
- Los dos lectores propios difieren en `1,234,567` y en «1.500 EUR»; y los dos leen «12.500» como doce mil quinientos,
  lo que en un campo de **peso** (que también usa `EuroAmountInput`, `PortfolioPositionsTable.tsx:172`) convierte un
  «12.500» tecleado a la inglesa en 12.500 %. El campo lo rechazaría solo si hay un máximo; no lo he comprobado.

## E. Vocabulario

El glosario (`src/core/glosarioDePantalla.ts:7-21`, decisión 28) fija: Rentabilidad anualizada; Caída máxima; Coste
corriente; Costes de operación; Índice de referencia; Cartera de referencia; Perfil de riesgo; Producto (Fondo, ETF,
Acción); Clase de activo; Activo (no «Instrumento»); Datos disponibles; Peso medido; Costes conocidos. Excluye el papel
(los PDF siguen como estaban) y se aplica solo a los textos que pasan por `textoEnPantalla` (25 sitios).

Recuentos en todos los textos de `src` (cadenas + JSX, sin pruebas). Ejemplos fichero:línea.

| Concepto | Términos y recuento | Ejemplos de los minoritarios |
|---|---|---|
| Activo | activo/s 448 · producto/s 44 · instrumento/s 7 · vehículo 3 | `adapters/baseNuevaLectura.ts:228` «no tiene el instrumento»; `reports/costsPdf.tsx:238` «vehículo» |
| Cartera | cartera/s 965 · propuesta/s 63 · borrador 13 · portfolio 20 (todos en mensajes de contrato) | `adapters/analyzePortfolioBackend.ts:29` «analyze_portfolio response» |
| Posición | posición/es 488 · línea/s 69 · títulos 80 · participaciones 15 | `componerFicha.ts:410` «la línea en la divisa de origen» |
| Peso | peso/s 327 · reparto 39 · asignación 14 · «% de la cartera» 7 · allocation 17 (nombres de categoría) | `CapitalContributionPanel.tsx:30` «tu asignación» |
| Rentabilidad | rentabilidad/es 360 · rendimiento/s 45 · retorno 3 | `componerFicha.ts:1603` «Rendimiento 12 meses»; `realPortfolioPdf.tsx:828-830` «Retorno último 1 año» |
| Anualizada | «rentabilidad anualizada» 55 · «al año» 39 · «rentabilidad anual» 3 · CAGR 1 | **Gestor: «Rentabilidad anual»** (`gestor/motor/metricas/rentabilidadAnualizada.ts:5`), «Rentabilidad por año» (`informes/secciones/cliente/notas.tsx:21`); `PortfolioComparator.tsx:242` «(CAGR)» |
| Volatilidad | volatilidad 137 · desviación (típica) 12 · «vol.» 4 | `FrontierHistoricalView.tsx:138` «Vol. del modelo»; `PlanoRiesgoRetorno.tsx:71` «vol.» |
| Caída máxima | «caída máxima» 41 · «máxima caída» 27 · «máx. caída» 15 · «mayor caída» 6 · «peor caída» 1 | **Gestor: «Máxima caída»** (`gestor/motor/metricas/maximaCaida.ts:5`) en pantalla; «Mayor caída» en su informe de cliente (`notas.tsx:26`); «Peor caída» (`AssetDetailMetrics.tsx:63`) |
| Índice de referencia | referencia 186 · índice 69 · cartera de referencia 34 · benchmark 10 · índice de referencia 8 | `realPortfolioBackend.ts:307` «Alta de benchmark/serie comparativa en la maestra» (llega a pantalla si no pasa por el glosario) |
| Coste | coste/s 305 · coste corriente 96 · comisión/es 80 · gastos 49 · gastos corrientes 22 · TER 1 | **Gestor pantalla: «Gastos corrientes de los fondos»** (`gestor/ui/analisis/BloqueIngresosYCostes.tsx:79`) y sus informes (`informes/secciones/costes/productos.tsx:27`); `core/labels.ts:270` «Gastos corrientes (TER)»; `GeneradorDeBorrador.tsx:72` «Gasto corriente» |
| Valor | importe 182 · valor 171 · patrimonio 60 · saldo 33 · valor de mercado 19 · valoración 4 | |
| Movimiento | movimiento/s 123 · operación/es 98 · apunte/s 9 | `VistaCuentas.tsx:179` «Últimos apuntes en» junto a «Movimientos» del mismo Gestor |
| Resultado | resultado 66 · pérdida/s 17 · plusvalía/s 11 · ganancia/s 10 · beneficios 3 | |
| Análisis | análisis 56 · radiografía 6 | `CarterasGuardadasPage.tsx:202,350` «Ver la radiografía de», «para ver su radiografía» — la pantalla se llama «Análisis» en el menú (`app/navModel.tsx:135`) |
| Diseño | «Diseño de cartera» (menú) · Constructor 0 · Builder 0 | coherente en texto (solo el código dice `PortfolioBuilder`) |
| Guardar | guardar 48 · guardada 25 · grabar 0 | coherente |
| Eliminar | quitar/a 21 · eliminar 9 · borrar/a 14 | **misma pantalla**: `AdminRetrocessions.tsx:697,994` «Borrar» y `:981` «Eliminar retrocesión comercial»; Gestor «Borrar» (`VistaMovimientos.tsx:72`) y «Quitar» (`DialogoDeAjustes.tsx:120`); `RealAnalysisHistory.tsx:59` «Eliminar» |
| Cancelar | cancelar 26 · cerrar 16 · volver 20 · descartar 2 | coherente con su uso |
| Cliente | cliente/s 127 · inversor 4 · partícipe 0 | coherente |
| Informe | informe/s 135 · documento/s 83 · reporte 0 | **dos nombres por informe**: «Informe del cliente» (Gestor, `DialogoDeInformes.tsx:32`) / «informe de cliente» (`PortfolioReport.tsx:484`); «Informe del asesor» (Gestor) / «informe interno» (`PortfolioReport.tsx:547`) |
| Exportar | descargar 34 · generar 32 · exportar 8 | «Generar el PDF» (Gestor), «Descargar informe de cliente» (Informes), «Generar informe de cliente» (`OptimizerPanel.tsx:474`), «Exportar Excel» (`PositionsWorkbench.tsx:1071`) / «Datos en Excel» (Gestor) |
| Añadir | añadir/añade 53 · incluir/incluye 56 · agregar 0 | coherente |
| Tipo sin riesgo | «tipo sin riesgo» 39 · «tasa sin riesgo» 5 · «libre de riesgo» 5 · «tasa libre de riesgo» 1 · €STR 40 | `componerFicha.ts:324` «tipo libre de riesgo»; `entradaDeComparativa.ts:76` «La tasa sin riesgo» (la traduce el glosario) |
| Divisa | divisa/s 172 · moneda/s 5 | `gestor/informes/secciones/cliente/resultado.tsx:57` «en otras monedas» |
| Valor liquidativo | precio 103 · valor liquidativo 36 · cotización 13 · VL 2 · NAV 1 | `componerFicha.ts:1022` «al VL del día» sin explicar |

**Siglas sin explicar en pantalla.** `YTD` (`pages/RealPortfolioPage.tsx:187`, `reports/realPortfolioPdf.tsx:665`,
`core/labels.ts:269` «Rentabilidad YTD»), `TWR anual` (`adapters/tablaDeRendimiento.tsx:249`), `TIR`
(`RealAnalysisHistory.tsx:81`, `WealthComparator.tsx:103`), `VL` (`componerFicha.ts:1022`), `SRRI` («5 SRRI» en
`internalPortfolioReportPdf.tsx:244`), `VaR`/`CVaR` (`internalPortfolioReportPdf.tsx:1552`), `KID` (49 textos), `€STR`
(40), `TER` (1). Las de la ficha (`SRI, del KID de PRIIPs`) llevan su procedencia pero no su significado.

**Anglicismos visibles.** «Tracking error» (14, `componerFicha.ts:240`), «swap» (siempre glosado: «una permuta (swap)»),
«YTD», «CAGR». En mensajes de contrato (`… response`, `Contrato de backend inválido en …`) y de configuración
(`adapters/baseNuevaLecturaSdk.ts:45-46` «Revisa VITE_FIREBASE_PROJECT_ID», además sin tildes) hay jerga interna que
puede llegar a un estado de error; no he comprobado qué pantallas los enseñan tal cual.

**Tratamiento.** Tuteo consistente: 161 imperativos de «tú» en 76 ficheros y 1 posible «usted» (`CambiosDePeso.tsx:80`
«Importe a mover», que es un sustantivo, no un imperativo). Coherente.

**Mayúsculas.** Títulos y botones en mayúscula inicial («Guardar y continuar», «Descargar informe de cliente»): no he
encontrado *Title Case*. Las mayúsculas sostenidas (`componerFicha.ts:51` «FONDO DE INVERSIÓN», «OTRO PRODUCTO») son
de la etiqueta de tipo, un estilo. Los meses cortos: «ene» en pantalla del Gestor, «Ene» en sus informes.

**Contradicción dentro del glosario.** La tabla dice que «Tipo de instrumento» pasa a «Producto»
(`glosarioDePantalla.ts:16`), y la sustitución que se ejecuta lo cambia a «Tipo de activo» (`:105`) (FMT-15).

## G. Propuesta

### G.1 Base del módulo único

**`src/gestor/ui/formato.ts` como diseño y `src/core/format.ts` como punto de entrada.** El del Gestor es el mejor
hecho: agrupa siempre, quita el signo del cero, tiene `conSigno`, `puntos`, `titulos` y `precio` con decimales mínimos y
máximos, y recibe siempre fracciones; pero no admite ausencias y escribe a mano las fechas. `core/format.ts` es el que
importan 148 ficheros y resuelve bien el huso de las fechas «solo día». La propuesta es reescribir `core/format.ts` con
la API del Gestor, que el Gestor (pantalla e informes) importe de ahí, y retirar las ~95 funciones locales.

**Lo que le falta:**
1. **Una sola unidad de entrada: fracción.** Las 144 llamadas `fmtPct(x / 100)` muestran que hoy conviven puntos y
   fracciones. Ofrecer `porcentajeDePuntos()` solo como transición, y convertir en el adaptador.
2. **Ausencia fuera del formateador:** devolver `null` (o aceptar un `siFalta`), y que la pieza `Ausencia` pinte «Falta
   el dato» / «No aplica»; nada de «N/D» en pantalla.
3. **`signDisplay`:** `"negative"` por defecto (sin «−0,00»), `"exceptZero"` para `conSigno`.
4. **Agrupación siempre** (`useGrouping:"always"`), también en `numero` y en el papel (con la decisión de Óscar).
5. **Espacio duro** U+00A0 entre cifra y `%`, `€`, `pp`, código de divisa.
6. **Divisas:** «€» para el euro; código ISO para el resto («1.234,56 USD»).
7. **Precisión por tipo, no por pantalla:** `rentabilidad`, `volatilidad`, `peso`, `ratio`, `precio`, `titulos`,
   `importe`, `importeGrande`, `puntos`, cada uno con sus decimales fijos (la tabla de C, decidida una vez).
8. **Fechas:** `fecha` (13/11/2026), `fechaCorta` (13 nov 2026, con lista de meses propia), `fechaLarga` (13 de
   noviembre de 2026), `fechaYHora`, `periodo`, `fechaDeEmision`, todas con el criterio de huso de `displayDate`/`diaLocal`.
9. **Lector único** de cifras tecleadas (`numberFormat.ts`), con variante `Decimal` para el Gestor.
10. **Ejes de gráfico:** `ejeEnEuros` y `ejeEnPorcentaje` comunes (pantalla y PDF).

Cuidado: cambiar `fmtNum`/`fmtPct` mueve lo que imprimen los PDF que firma el asesor (comentario en `format.ts:53-56` y
regla del proyecto). La migración del papel necesita una decisión aparte.

### G.2 Concepto → término recomendado

| Concepto | Término recomendado | Por qué (mayoritario / glosario) | Deja de decirse |
|---|---|---|---|
| Lo que se mide o se elige | Activo | 448 textos; glosario | instrumento, vehículo |
| Fondo / ETF / Acción | Tipo de producto | glosario (y resolver FMT-15) | tipo de instrumento, tipo de activo |
| Conjunto de posiciones | Cartera | 965 | portfolio |
| Cartera propuesta por la app | Propuesta / Borrador (generador) | como hoy | |
| Línea de una cartera | Posición | 488 | línea (en pantalla) |
| Cantidad | Títulos (participaciones solo para fondos en el papel) | 80 | |
| Proporción en cartera | Peso | 327 | asignación, ponderación, % de cartera |
| Ganancia relativa | Rentabilidad | 360 | retorno, rendimiento (salvo «rendimiento por dividendo») |
| Media anual | Rentabilidad anualizada | 55 + glosario | rentabilidad anual, CAGR, TAE |
| Desde el 1 de enero | En lo que va de año | glosario | YTD |
| Dispersión | Volatilidad | 137 | desviación típica (solo en método), vol. |
| Peor caída desde máximos | Caída máxima | 41 + glosario | máxima caída, máx. caída, mayor caída, peor caída |
| Índice del fondo | Índice de referencia | glosario | benchmark |
| Conservador/Equilibrado… | Cartera de referencia | glosario | perfil de referencia |
| Lo que cobra el producto al año | Coste corriente | 96 + glosario | gastos corrientes, TER, OCF, gasto corriente |
| Lo que cobra la gestora o el banco | Comisión (de gestión, de depósito…) | 80 | |
| Valor total de la cartera | Patrimonio | 60 | valoración, valor de la cartera |
| Cifra en euros de una línea | Importe | 182 | |
| Asiento del libro | Movimiento | 123 | apunte, transacción |
| Compra/venta en mercado | Operación | 98 | |
| Ganancia o pérdida | Resultado (latente / realizado) | 66, Gestor | plusvalía (salvo fiscal), beneficio |
| Pantalla de una cartera | Análisis | menú | radiografía, X-Ray |
| Pantalla de diseño | Diseño de cartera | menú | constructor, builder |
| Guardar | Guardar | 48 | grabar |
| Sacar de una lista | Quitar | 21 | |
| Borrar del todo | Eliminar | | borrar |
| Salir sin cambiar | Cancelar (diálogo) / Cerrar (panel) | | |
| Para quién es el informe | Cliente | 127 | inversor, partícipe |
| Documento PDF | Informe (de cliente, del asesor, de costes) | 135 | reporte, informe interno |
| Bajar un fichero | Descargar | 34 | generar, exportar |
| Añadir | Añadir | 53 | agregar |
| Tipo libre de riesgo | Tipo sin riesgo | 39 + glosario | tasa (libre) de riesgo |
| Moneda | Divisa | 172 | moneda |
| Precio de un fondo | Valor liquidativo | 36 | VL, NAV |
| Diferencia entre porcentajes | puntos porcentuales «p.p.» (cliente: «puntos») | | pp |
| Dato que no está | Falta el dato / No aplica / Sin pedir | decisión | N/D, No disponible, — |
