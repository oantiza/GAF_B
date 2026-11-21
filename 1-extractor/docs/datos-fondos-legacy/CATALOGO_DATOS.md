# CATÁLOGO EXHAUSTIVO DE DATOS EXTRAÍBLES POR FONDO/ETF

**Fecha:** 10-06-2026 · Complementa a PLAN.md. Inventario campo a campo de todo lo que se puede extraer de cada fuente, con el endpoint/método exacto.

**Cómo se ha obtenido:** análisis del código fuente completo de `mstarpy` (la librería que envuelve las APIs internas reales que alimentan las fichas de Morningstar), verificación en vivo de justETF, y documentación oficial CNMV. Las fichas web de Morningstar y FT están en la lista de bloqueo de mis herramientas en este entorno, pero sus APIs quedan totalmente documentadas abajo; en tu PC funcionan (mstarpy existe precisamente para eso).

**Resumen:** Morningstar expone ~50 bloques de datos (≈600+ campos efectivos) por fondo a través de 4 APIs; justETF ~70 campos por ETF + histórico completo de cotizaciones; CNMV la cartera íntegra valorada de todo fondo español. Casi cada métrica viene por triplicado: **fondo / categoría / índice**, lo que multiplica el valor analítico.

---

## 1. MORNINGSTAR — la fuente más rica

### 1.0 Infraestructura real (descubierta en el código)

| API | URL base | Para qué |
|---|---|---|
| **SAL (global)** | `api-global.morningstar.com/sal-service/v1/{fund\|etf}/{endpoint}/{secId}/data` + apikey pública + token sesión | Todos los bloques de la ficha (cartera, riesgo, costes, ESG…) |
| **LT (legacy europea)** | `lt.morningstar.com/api/rest.svc/klr5zyak8x/security_details/{secId}?viewId=…` | Snapshot, MiFID/EMT, sostenibilidad |
| **TimeSeries** | `us-api.morningstar.com/QS-markets/chartservice/v2/timeseries` (token bearer) | Series históricas NAV/totalReturn |
| **Screener** | búsqueda por ISIN/nombre con `securityDataPoints` arbitrarios | Datos masivos de miles de fondos en una petición |
| **Realtime** | `morningstar.com/api/v2/stores/realtime` | Cotización intradía (ETFs) |
| **Documents** | `global.morningstar.com/api/v1/{mercado}/investments/funds/{secId}/documents` | KID, folleto, informes (PDF) |

Acceso: `mstarpy` gestiona apikey y tokens; desde v10 inicializa la sesión abriendo Chrome una vez y después todo va por API pura. Cada método de abajo = una llamada JSON.

### 1.1 Identificación y datos generales
`quote(v7)` · `metaData()` · `investmentLookup()` · `snapshot()` (LT)

Nombre legal, ISIN, secId, ticker, categoría Morningstar, índice benchmark oficial y el asignado por Morningstar, divisa base, domicilio, estructura legal/UCITS, fecha de lanzamiento (clase y fondo), gestora, estado (abierto/cerrado a nuevas suscripciones), inversión mínima inicial/adicional, VL último + fecha + variación día, máx/mín 52 semanas, patrimonio de la clase y del fondo + fecha, yield 12 meses, frecuencia de valoración. Para ETF además: bid/ask, prima/descuento sobre NAV, volumen.

### 1.2 Rentabilidad
`trailingReturn(duration=daily|monthly|quarterly, v3)` — rentabilidades acumuladas y anualizadas: 1 día, 1 semana, 1/3/6 meses, YTD, 1/3/5/10/15 años y desde lanzamiento. **Cada horizonte ×3: fondo, categoría, índice + percentil dentro de la categoría y nº de fondos del peer group.** Con cierre a día, fin de mes o fin de trimestre.

`performanceTable()` — rentabilidad por años naturales (≈10 años) y por trimestres de cada año, fondo vs categoría vs índice (la tabla "Rentabilidades anuales" de la ficha).

`historicalData(v4)` — serie de crecimiento de 10.000 € desde lanzamiento (fondo/categoría/índice), base del gráfico principal.

`nav(start,end,frequency)` / `TimeSeries(["nav","totalReturn"])` — **serie histórica diaria/mensual/trimestral de VL y rentabilidad total entre fechas arbitrarias** (permite reconstruir cualquier métrica propia).

### 1.3 Riesgo
`riskVolatility()` — **alpha, beta, R², volatilidad (desv. típica), ratio Sharpe — cada uno a 1, 3, 5 y 10 años, para fondo, categoría e índice** (la matriz completa de la pestaña Riesgo).

`maxDrawDown(year=N)` — máxima caída del periodo, fechas pico-valle, nº de meses de caída y de recuperación, peor mes/trimestre; comparado con índice y categoría.

`riskScore()` — Morningstar Risk Score numérico. · `riskReturnSummary()` — calificación cualitativa riesgo/retorno (Bajo…Alto) a 3/5/10 años. · `riskReturnScatterplot()` — pares riesgo-retorno del fondo y de todos los fondos de su categoría (para situarlo en la nube).

### 1.4 Cartera — posiciones completas
`position(v2)` / `holdings(type)` con `premiumNum=10000` — **la cartera ÍNTEGRA, no solo el top 10**: cientos o miles de posiciones divididas en equity/bonos/otros. Por posición: nombre, ticker, ISIN/secId, peso %, nº títulos, valor de mercado, divisa, sector, país, fecha primera compra, variación de posición vs periodo anterior, si es nueva, P/E del valor, y si la posición es a su vez un fondo: su rating. Más: nº total de posiciones, % cartera en top 10, ratio de rotación, fecha de la cartera.

### 1.5 Desglose renta variable
- `sector(v2)` — peso en los 11 sectores (tecnología, salud, financiero, consumo cíclico/defensivo, industria, energía, materiales, utilities, inmobiliario, comunicación) **fondo/categoría/índice**.
- `regionalSector()` y `regionalSectorIncludeCountries()` — 3 superregiones, ~10 regiones y desglose **por país**, fondo/cat/índice.
- `marketCapitalization()` — % gigante/grande/mediana/pequeña/micro + capitalización media, fondo/cat/índice.
- `equityStyle(v2)` — ratios de valoración de la cartera vs cat vs índice: P/E, P/B, P/CF, P/Ventas (prospectivos), rentabilidad por dividendo, y crecimientos esperados/históricos de beneficios, ventas, cash-flow y valor contable.
- `allocationWeighting()` + `ownershipZone()` + `equityStyleBoxHistory()` — **Style Box** completo: peso en las 9 celdas (value/blend/growth × large/mid/small), centroide y zona de dispersión, e histórico del style box por años.
- `financialMetrics()` — calidad de la cartera: ROA, ROE, ROIC, margen neto, deuda/capital, cobertura de intereses… vs categoría.
- `factorProfile()` — exposición a 7 factores (estilo, yield, momentum, calidad, volatilidad, liquidez, tamaño) con histórico de 5 años y rango de la categoría.

### 1.6 Desglose renta fija
- `fixedIncomeStyle()` — **duración efectiva y modificada, vencimiento efectivo, calidad crediticia media, yield to maturity, cupón medio** + style box RF (calidad × sensibilidad a tipos), fondo/categoría.
- `creditQuality()` — % por escalón AAA / AA / A / BBB / BB / B / <B / sin calificar, fondo/cat/índice.
- `maturitySchedule()` — escalera de vencimientos (1-3, 3-5, 5-7, 7-10, 10-15, 15-20, 20-30, 30+ años).
- `couponRange()` — distribución por tramos de cupón. · `multiLevelFixedIncomeData(primary,secondary)` — cruces duración×sector, yield-to-worst×región, calidad×sector…

### 1.7 Asignación de activos
`allocationMap(v3)` — % RV / RF / liquidez / otros (y convertibles/preferentes) en **largo, corto y neto**, para fondo, categoría e índice.

### 1.8 Costes (todos los que existen)
- `investmentFee()` — comisión de gestión máxima y gastos corrientes.
- `feeLevel(v1)` — TER del fondo vs mediana de su categoría + calificación (Bajo→Alto) + percentil.
- `salesFees()` — comisiones máximas de suscripción, reembolso y diferidas (solo fondos).
- `historicalExpenses()` — **TER histórico por años** (solo fondos).
- `feeMifid()` (LT) — **plantilla EMT MiFID II completa**: costes ex-ante de entrada, salida, corrientes, de transacción e incidentales (comisión de éxito) — el desglose regulatorio exacto que usan los comercializadores.
- `costIllustration()` + `costProjection()` — proyección del efecto de costes en € a 1/3/5/10 años sobre una inversión tipo.
- `otherFee()` — exenciones/reembolsos de gastos. · `taxes()` — solo fondos USA.

### 1.9 Ratings Morningstar
- Estrellas: overall y a 3/5/10 años (vía `quote`/screener) + `historicalRating()` — **serie histórica mensual del rating**.
- `morningstarOpinion(v3)` / `morningstarAnalyst()` — **Medalist Rating** (Gold/Silver/Bronze/Neutral/Negative), si es cobertura de analista o algorítmica, % cobertura, notas de los 3 pilares (People / Process / Parent), fecha y texto del análisis (parcialmente premium).
- `medaListComparables()` — fondos comparables sugeridos con sus ratings y métricas clave.

### 1.10 Sostenibilidad / ESG
- `esgData()` + `sustainability()` (LT) — globos de sostenibilidad (1-5), Sustainability Score y percentil en categoría, ESG Risk corporativo y soberano, % cartera cubierta, clasificación **SFDR artículo 6/8/9** (también vía screener `dataPoint`).
- `esgRisk()` — desglose del riesgo ESG. 
- `carbonMetrics()` — Carbon Risk Score, intensidad de carbono, % ingresos de combustibles fósiles, designación Low Carbon.
- `productInvolvement()` — **% de cartera en cada actividad controvertida**: armas controvertidas, armas de fuego civiles, contratos militares, tabaco, alcohol, juego, entretenimiento adulto, carbón térmico, petróleo y gas (y arenas bituminosas), nuclear, pieles, OGM, ensayos con animales, anticonceptivos…
- `proxyVotingManagement()` / `proxyVotingShareHolder()` — historial de voto de la gestora en juntas.

### 1.11 Equipo gestor y gestora
- `people()` — gestores actuales e históricos: nombre, fecha de inicio/salida, antigüedad (tenure medio y del más veterano), biografía, titulaciones (CFA…), otros fondos que gestionan, e inversión personal en el fondo (fondos US).
- `parentSummary()` — la gestora: AUM total, nº de fondos, tenure medio de sus gestores, ratio de retención de gestores, % de fondos con rating alto…
- `parentMstarRating()`, `parentMedaListRating()`, `parentMedal()`, `parentRatingRecentChange()`, `starRatingFundAsc/Desc()`, `analystRating*()` — distribución de ratings de toda la casa, sus mejores/peores fondos, subidas/bajadas recientes.
- `graphData()` — **AUM y flujos netos históricos** de la gestora.

### 1.12 Distribuciones
`distribution(annual|latest)` — dividendos/cupones repartidos por año y último pago: importe por participación, fecha, yield de distribución.

### 1.13 Documentos oficiales
`getDocumentInformation(mercado)` + `downloadDocument(mercado, tipo, idioma)` — lista y **descarga directa del PDF**: KID PRIIPs, folleto, informe anual/semestral, por mercado de comercialización e idioma, con fecha de vigencia. (Permite alimentar la extracción de PDFs del §4 sin visitar webs de gestoras.)

### 1.14 Screener masivo
`dataPoint([...])` / `screener_universe` — cualquier datapoint para **miles de fondos en pocas peticiones** filtrando por universo (p.ej. todos los fondos a la venta en España), categoría, gestora, rating, TER… Campos: name, isin, secId, OngoingCharge, priipsKidCosts, standardDeviation, ratings, rentabilidades M0–M120, SFDR, yield… `search_filter()` lista todas las claves de filtro. **Es la vía eficiente para la carga inicial de cientos de fondos** (los bloques 1.1–1.13 se reservan para el detalle fondo a fondo).

### 1.15 Intradía
`RealtimeData("quotes")` — cotización en tiempo real (ETFs): último, bid/ask, volumen.

---

## 2. JUSTETF — ETFs UCITS (✅ verificada en vivo el 10-06-2026)

| Función | Qué devuelve |
|---|---|
| `load_overview()` | Tabla de **los ~4.070 ETFs UCITS** con 42 columnas: ISIN, WKN, ticker, valor suizo, nombre, fecha lanzamiento y antigüedad, estrategia (long-only/activo/apalancado-corto), domicilio, divisa, cobertura de divisa, préstamo de valores, réplica (física/sintética/muestreo), política distribución, TER, tamaño del fondo, nº posiciones, rentabilidades 1m/3m/6m/YTD/1a/3a/5a/desde inicio + por años naturales recientes, dividend yield, **volatilidad 1/3/5a, retorno-por-riesgo (Sharpe aprox.) 1/3/5a, max drawdown total/1a/3a/5a**. Enriquecible con clase de activo, región, índice, bolsas de cotización |
| `get_etf_overview(ISIN)` | Ficha completa: descripción, índice replicado, TER, tamaño, réplica, divisa, distribución, domicilio, **asignación íntegra por países y sectores, top 10 posiciones con ISIN y peso**, cotización gettex en vivo (bid/ask/cambio día) |
| `load_chart(ISIN)` | **Histórico completo desde lanzamiento** (serie diaria): cotización, rentabilidad relativa, dividendos pagados y acumulados, valor con dividendos y con dividendos reinvertidos (9 series) — permite calcular cualquier métrica de riesgo/retorno propia |
| `compare_charts()` | Comparativa normalizada entre varios ETFs |
| `load_live_quote(ISIN)` | Tiempo real gettex: last, bid, ask, mid, spread absoluto/relativo/%, variación diaria |

---

## 3. CNMV — todos los fondos españoles (oficial, gratuito, XML)

Descarga masiva desde [cnmv.es → Descarga de información individual de IIC](https://www.cnmv.es/portal/publicaciones/descarga-informacion-individual) y datos.gob.es:

- **Fichero mensual** por fondo: VL, patrimonio, nº partícipes.
- **Informe trimestral/semestral (IPP, XML con esquema publicado)**: comisiones efectivamente aplicadas (gestión sobre patrimonio y/o resultados, depositario), **ratio de gastos (TER) del trimestre y acumulado**, rentabilidades trimestrales y anuales, volatilidad, índice de referencia, **ratio de rotación de cartera**, evolución patrimonio/partícipes/VL, política de inversión, y la joya: **inventario completo de la cartera valorado posición a posición con ISIN** (RV, RF, IIC, depósitos, derivados…) con % sobre patrimonio.
- **Registros oficiales**: nº registro CNMV, gestora, depositario, fechas, folleto y DFI/KID en PDF.
- Información financiera intermedia también en **XBRL**.

Cobertura: ~todos los FI españoles (los ~5.000 del mercado nacional). Sin límites de peticiones, sin scraping, máxima fiabilidad legal.

---

## 4. KID PRIIPs (PDF) — campos regulatorios

Vía `downloadDocument` de Morningstar o web de la gestora; extracción con `pdfplumber`:
**SRI** (indicador de riesgo 1-7), escenarios de rentabilidad (tensión/desfavorable/moderado/favorable a 1 año y al periodo recomendado), **costes totales y reducción del rendimiento (RIY)**, desglose: entrada, salida, corrientes, transacción, éxito; periodo de mantenimiento recomendado; objetivo y política de inversión (texto).

---

## 5. Fuentes complementarias

- **yfinance** (ETFs con ticker): OHLCV histórico, dividendos, splits, AUM, beta, ratios de la cartera, top holdings. Gratis, robusto.
- **Gestoras directamente**: iShares, Vanguard, Amundi, Xtrackers publican **la cartera completa diaria en CSV/Excel descargable** en la página de cada ETF — fetcher por gestora si quieres posiciones exactas al día (más fresco que Morningstar trimestral).
- **FT (markets.ft.com)**: ficha por ISIN con resumen, riesgo, holdings y gestores. Bloqueada desde mis herramientas en este entorno; en tu PC utilizable como fallback. 
- **EODHD** (de pago, ~60 €/mes): solo si algún día quieres sustituir todo por una API comercial con SLA.

---

## 6. Matriz bloque × fuente (prioridad de extracción)

| Bloque | 1ª fuente | Respaldo |
|---|---|---|
| Identificación | Morningstar quote/metaData | justETF (ETF), CNMV (ES) |
| TER/costes corrientes | Morningstar investmentFee/feeMifid | justETF, CNMV (aplicadas reales), KID |
| Comisiones venta/éxito | Morningstar salesFees + feeMifid | CNMV, KID |
| Rentabilidades trailing | Morningstar trailingReturn (con percentiles) | justETF, CNMV |
| Rentabilidad por años | Morningstar performanceTable | justETF, CNMV |
| Serie histórica VL | Morningstar TimeSeries | justETF chart (ETF, desde inicio) |
| Riesgo (vol, Sharpe, α, β, R²) | Morningstar riskVolatility | justETF (ETF), cálculo propio sobre series |
| Max drawdown | Morningstar maxDrawDown | justETF |
| Cartera completa | Morningstar position (10.000 posiciones) | CNMV IPP (ES, oficial), CSV gestora (ETF, diario) |
| Sectores/países | Morningstar sector/regionalSector | justETF |
| Style box / valoración | Morningstar (exclusivo) | — |
| Renta fija (duración, calidad…) | Morningstar (exclusivo) | — |
| Estrellas / Medalist | Morningstar (exclusivo) | — |
| ESG / SFDR / carbono | Morningstar (exclusivo) | — |
| Gestores / gestora | Morningstar people/parent | FT |
| Distribuciones | Morningstar distribution | justETF chart (dividendos) |
| SRI y escenarios PRIIPs | KID PDF | feeMifid/screener (priipsKidCosts) |
| Documentos PDF | Morningstar documents | Web gestora |
| Flujos netos / AUM hist. | Morningstar graphData | — |
| Intradía (ETF) | justETF live | Morningstar realtime, yfinance |

**Conclusión operativa:** Morningstar aporta ~75% del valor (y todo lo exclusivo: ratings, style box, ESG, RF, percentiles); justETF da redundancia total para ETFs con cero fricción; CNMV da la verdad oficial de los fondos españoles. El esquema JSON v2 completo está en `esquema_fondo.json`.
