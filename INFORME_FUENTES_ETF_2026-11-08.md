# Fuentes de datos de ETF, emisor por emisor

**Medido el 8 de noviembre de 2026.** Encargo de solo lectura para el paso 3 del plan de datos. No se ha tocado código, configuración ni base alguna. Óscar decide; aquí se mide y se propone.

## Lo esencial

- **Seis emisores cubren el 86 % de la lista de 300 y se leen sin navegador**: Amundi, iShares, Xtrackers, Invesco, SPDR y Vanguard, 257 de 300 ETF. Cinco dan valor liquidativo diario desde el lanzamiento. Invesco da una serie de crecimiento, de la que se deduce.
- **El lector de iShares que ya tenemos no funciona.** La web cambió de plataforma, y la ruta `.ajax` que usa `1-extractor/fetchers/gestoras.py` da 404 (o HTML) en lugar de un CSV. Además solo cubría posiciones de 4 ISIN. El plan decía «iShares existe»: hay que rehacerlo. La vía nueva es mejor: un solo Excel con casi todo.
- **HSBC, WisdomTree, VanEck y UBS no dan histórico de valor liquidativo sin navegador.** Los tres primeros sí dan documentos o el dato del día. UBS rechaza toda petición sin navegador (403) y su web pide aceptar un aviso de inversor. Ninguno pesa en la lista de 300: 9 ETF entre los cuatro.
- **«Resuelve los 18 ETF sin métricas» ya no describe el problema.** Desde la decisión del 04-11 (§11 del método), 31 de los 32 ETF del universo llevan métricas sobre precio de mercado. El único sin ellas es el ETC de oro, que no tiene método. El valor liquidativo no los resolvería: cambiaría su serie.
- **El paso de precio a valor liquidativo importa poco en subyacente europeo y bastante en el resto.** En 12 meses, la volatilidad cambia entre 0,1 y 0,2 puntos en Europa, y entre 0,6 y 1,3 en Estados Unidos, mundo y Japón. El signo no es siempre el mismo.

**Orden propuesto:** iShares, Amundi, Xtrackers, Vanguard, SPDR, Invesco. Los otros cuatro se dejan para más adelante. Los motivos y las decisiones que necesita Óscar están en las secciones 5 y 8.

## 1. Tabla emisor por dato

**S** = se obtuvo sin navegador. **Nav** = solo con navegador. **No** = no encontrado. **?** = no medido. PDF y HTML indican el formato cuando no es un fichero o JSON por ETF.

| Emisor | Histórico VL | VL del día | Patrimonio y fecha | TER | Política | Dividendos | Réplica | Índice | Composición | KID/folleto | EMT/EET | Clase | Región |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **iShares** | S | S | S | S | S | S (HTML) | S | S | S | S | No | S | No |
| **Amundi** | S | S | S | S | S | S | S | S | S (ver nota) | S (ya en extractor) | ? | S | Parcial |
| **Xtrackers** | S | S | S | S | S | No | S | S | S | S (ya en extractor) | No | S | S |
| **Vanguard** | S | S | S | S | S | S | S | S | S | S | No | S | S |
| **SPDR** | S | S | S | S | S | No | S (HTML) | S (HTML) | S | S | No | S | No |
| **Invesco** | Derivable | S | S | S | S | ? | S | S | Índice | S | **S** | No | No |
| **HSBC** | Nav | Nav | S (PDF, mensual) | S (PDF) | S (PDF) | S (PDF, último) | S (PDF) | S (PDF) | S (XLS) | S (factsheet) | ? | No | No |
| **WisdomTree** | No | Nav | Nav | S (PDF) | S (PDF) | ? | S (PDF) | S (PDF) | Nav | S | **S** | No | No |
| **VanEck** | No | S (HTML) | S (HTML) | S (HTML) | ? | ? | ? | ? | Nav | S | ? | No | No |
| **UBS** | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |

Nota de Amundi y de cualquier réplica sintética: en un ETF por swap la composición publicada es la **cesta de sustitución**, no el índice. El Amundi Japan Topix muestra Apple como primera posición. Sirve para saber qué garantía hay, y no para decir en qué invierte el fondo.

## 2. Cómo se obtiene, emisor por emisor

Muestra: los ETF del universo si los hay; si no, los de la lista de 300 o, cuando esa lista no tiene ninguno, los de mayor presencia en FIRDS.

### iShares (referencia)
- **ETF:** IE00B4L5Y983, IE00B5BMR087, IE00B0M62Q58.
- **Vía:** `https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v1/get-fund-document?appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=ishares-uk&locale=en_GB&portfolioId={id}&component=fundDownloadV2&userType=individual`.
- **Formato:** XML SpreadsheetML, 2-3 MB, sin cookies ni JavaScript. Hojas: `Historical NAVs`, `Key Facts`, `Holdings`, `Exposure Breakdowns`, `Growth of Hypothetical 10,000`.
- **Dato medido:** VL desde 25-09-2009, 4.379 filas, último 06-11-2026 (USD 140,99). Patrimonio de fondo y de clase a 06-11. Posiciones a 05-11.
- **Dividendos:** no van en el Excel. Vienen en el HTML de la página, en una tabla con `exDate` (comprobado en IE00B0M62Q58).
- **Clasificación:** `Asset Class` y sectores; región solo por desglose de exposición.
- **Punto débil:** la URL va por id propio (`portfolioId`), no por ISIN. La lista de productos sin navegador no trae los ids (0 enlaces en el HTML). Hay que hacer la correspondencia una vez y guardarla, como ya hace `gestoras.csv`.
- **Estabilidad:** ya rompió una vez. La página nueva no tiene enlaces `.ajax`; el HTML de la clásica da 200 con HTML en UK y 404 en la URL de `gestoras.csv`. No se probaron los fondos domiciliados en Alemania (DE0005933956, DE000A0F5UJ7), que pueden estar en otro sitio.

### Amundi
- **ETF:** LU0908500753, LU1900068161, LU1681037609. Para dividendos, FR0007052782.
- **Vía:** POST JSON a `https://www.amundietf.fr/mapi/ProductAPI/getProductsData`, con `"context":{"countryIso":"FRA","languageIso":"fr","userProfileName":"INSTIT"}`, `"productIds":[ISIN]`, `"productType":"PRODUCT"`, `characteristics` e `historics` como objetos `{"indicator":"officialNav"}`. Sin cookies ni JavaScript.
- **Dato medido:** VL diario desde el lanzamiento (LU0908500753: 3.467 días desde abril de 2013, último 04-11-2026), VL ajustado, patrimonio histórico, dividendos con fecha (FR0007052782: 24 pagos, 2012-2025), TER, réplica, índice y composición con pesos y fecha.
- **Catálogo:** la misma llamada sin `productIds` devuelve los 686 productos. Es el único emisor que da catálogo y datos juntos por API.
- **Clasificación:** `ASSET_CLASS` en 686 de 686. `ETF_CLASSIFICATION1` en 280 (Developed Market, Emerging Market, Govies, Corporates, Cash). Región vacía en todos. Con los 103 Amundi de la lista de 300, la clase del emisor coincide con la de nombre en 102. El que no: LU0832435464, un ETF de futuros de VIX que la clasificación por nombre puso en «RV EE. UU.» y Amundi llama Alternatives.
- **Punto débil:** es una API interna sin documentar. Con `countryIso` GBR en el dominio `.co.uk` el mismo cuerpo dio 400, y `DocumentAPI` devolvió vacío (no se investigó más). Fecha de lanzamiento: en LU0908500753 dice 2024 con VL desde 2013, porque hereda historia tras la fusión de Lyxor; no sirve para decidir la ventana.

### Xtrackers
- **ETF:** LU0290358497, IE00BM67HK77, IE00BJ0KDQ92. Para el campo de reparto, LU0292096186.
- **Vía:** GET JSON por ISIN en `https://etf.deutsche-am.com/api/pdp/en-gb/etf/{ISIN}/performancechart` (VL e índice) y `/holdings`. Posiciones en Excel: `https://etf.deutsche-am.com/etfdata/export/GBR/ENG/excel/product/constituent/{ISIN}/`. Los datos de ficha van en `/pdpMetaTagsTealium`.
- **Dato medido:** IE00BJ0KDQ92, 3.207 puntos desde 22-07-2014, último 05-11-2026 (154,9108 USD, igual al de la página). Patrimonio, TER, clase de activo, región, estrategia y política con fecha.
- **Dividendos:** no hallados. En el ETF que reparte probado, la serie solo trae VL. La ficha tiene un Excel de «Historical Data» cuyo enlace no se identificó sin hacer clic.
- **Clasificación:** la mejor junto con Vanguard: `Asset class` (Equities, Fixed Income) y `Region` (Developed Markets/Global, Eurozone/Europe, Sector).
- **Punto débil:** el nombre del fichero (`pdpMetaTagsTealium`) es de analítica web, y el dominio ya cambió una vez de `etf.dws.com` a `etf.deutsche-am.com`.

### Vanguard
- **ETF:** IE00B3XXRP09 (id 9503), IE00BK5BQT80 (9679) y el id 9520.
- **Vía:** POST GraphQL a `https://www.vanguard.co.uk/gpx/graphql` con cabecera `x-consumer-id: uk0`. La consulta `funds(portIds)` da `pricingDetails.navPrices(startDate,endDate,limit)`, `profile`, `distributionDetails` y `borHoldings`. Sin `limit` solo devuelve un registro.
- **Dato medido:** VWCE, 1.882 VL desde 23-07-2019. Dividendos con fecha ex, de pago y de registro. TER, réplica, índice, patrimonio con fecha (`TNA`), mercados con su `portId`.
- **Clasificación:** `assetClassificationLevel1` y `marketRegionFocus` (USA, Global, Europe). El nivel 2 (Growth, Growth and Income) no sirve para los bloques.
- **Punto débil:** id propio, aunque aparece en la URL y en `<meta name="isin">` de la página. Introspección cerrada: si cambia el esquema, avisa con un error. Se comprobó el nombre del emisor de las posiciones, no el campo de peso.
- **Documentos:** `https://fund-docs.vanguard.com/{isin}-en.pdf` (KID), y factsheet con el `portId` en el nombre.

### SPDR (State Street)
- **ETF:** IE00BFY0GT14 (SPPW), IE00BKWQ0M75 (SMC), IE00B6YX5C33 (SPY5).
- **Vía:** catálogo JSON `https://www.ssga.com/bin/v1/ssmp/fund/fundfinder?country=uk&language=en_gb&role=intermediary&product=etfs&ui=fund-finder` (179 ETF, con TER, VL, patrimonio, fecha y la ruta de cada documento). Con `country=ie` llega vacío. Ficheros: `https://www.ssga.com/library-content/products/fund-data/etfs/emea/navhist-emea-en-{ticker}-{bolsa}.xlsx` y `holdings-daily-emea-en-…xlsx`.
- **Dato medido:** VL diario con participaciones y patrimonio por fila; último 06-11-2026. Posiciones a 05-11 con ISIN y sector. Réplica e índice en el HTML de cada ETF.
- **Dividendos:** no hallados en los ficheros ni en el HTML sin navegador.
- **Clasificación:** categorías del catálogo: `assetclass` (Equity 94, Fixed Income 74…) e `income`. La categoría de región viene sin nombres, inservible.
- **Punto débil:** ninguno serio. Es la vía más sencilla, y el catálogo da la URL exacta de cada fichero.

### Invesco
- **ETF:** IE00B3YCGJ38, IE00B3Q19T94, IE00B60SX394.
- **Vía:** GET JSON por ISIN en `https://dng-api.invesco.com/cache/v1/accounts/en_GB/shareclasses/{ISIN}`: `/keyStats`, `?variationType=fundDetails`, `?variationType=generalSecurityInformation`, `/holdings/index`, `/performance/rolling?variationType=ALL&baseline=10000`. Con el agente de herramienta del extractor.
- **Dato medido:** VL y patrimonio a 05-11. Réplica (`Synthetic`), índice por ticker Bloomberg, comisión de gestión y de swap por separado.
- **Sin histórico directo de VL:** solo «crecimiento de 10.000» diario desde el lanzamiento. Se deduce el VL escalando con el último publicado. Vale para rentabilidades, y hay que declararlo como serie derivada.
- **Composición:** `holdings/index` es la del índice (a 23-09-2026 en el S&P 500); no se midió la cartera real.
- **EMT/EET/EPT:** Invesco publica **un CSV único** con toda la gama (`https://www.invesco.com/content/dam/invesco/emea/en/product-documents/etf/umbrella/other/emt-report_en_invesco-combined.csv`), 1.981 filas, generado el 15-09-2026. Es el único emisor de los grandes que lo da en bloque.
- **Punto a comprobar:** `aum` (55.740 M) no cuadra con VL por participaciones de la clase (40.650 M). Parece ser del subfondo. No se ha verificado.

### HSBC
- **ETF:** IE00B4X9L533, IE00B5KQNG97, IE00B5SSQT16.
- **Sin navegador:** `https://www.assetmanagement.hsbc.co.uk/api/v1/download/document/{isin}/gb/en/factsheet` (PDF mensual: VL, patrimonio, cargo corriente, réplica, índice, política, último dividendo, dato a 30-09-2026) y `/holdings` (XLS antiguo, 3 de 3 respondieron).
- **Con navegador:** la API `/api/v1/nav/funds` exige un token de sesión de la página (401 sin él). No se llegó a la ficha de producto.
- **Histórico de VL:** no obtenido. Las notas diarias de «Net Asset Value» en la Bolsa de Londres existen, pero no se han medido como fuente.

### WisdomTree
- **ETF:** IE0002Y8CX98, IE00BLPK3577, IE0007M3MLF3.
- **Sin navegador:** `https://dataspanapi.wisdomtree.com/pdr/documents/{FACTSHEET|PRIIP_KID|PROSPECTUS}/UCITS/…/{ISIN}/` (PDF, 3 de 3) y EMT en bloque, `…/EMT/ETP/EU/EN-GB/EMT-V42/` (XLSX, 356 filas, generado el 23-09-2026, 134 líneas IE).
- **Con navegador:** la web pasa por una comprobación de Cloudflare; sin navegador da 403 y no se ha intentado sortear. `www.wisdomtree.com/api/fund-holdings/{id}` también.
- **Histórico de VL:** no localizado.

### VanEck
- **ETF:** IE0002PG6CA6, IE000M7V94E1. El tercero (NL0010408704) no se alcanzó porque no se encontró su ruta.
- **Sin navegador:** `https://www.vaneck.com/ie/en/investments/{slug}/overview/` (HTML, sin cookies; la pestaña `/holdings/` sí las pide) trae ISIN, VL y patrimonio a 06-11-2026, y fecha de lanzamiento. KID en `globalassets/home/ucits/documents/kids/…`.
- **Con navegador:** la tabla de posiciones no viene en el HTML (0 filas). Hay una llamada `POST /Main/FundListingUcits/GetFundData/` cuyo cuerpo no se ha reproducido.
- **Histórico de VL:** no localizado. La página `/ie/en/nav/` es un glosario.
- **Punto débil:** la URL va por un nombre propio (`nuclear-etf`, `rare-earth-etf`), sin ISIN.

### UBS
- **Sin navegador:** todo `ubs.com` responde 403 (Akamai). No se ha intentado sortear.
- **Con navegador:** la página de ETF carga, y queda detrás de un aviso de tipo de inversor que no acepté sin autorización de Óscar. **No se midió ningún dato de UBS.**

## 3. Cuánto cambia la métrica al pasar de precio a valor liquidativo

12 meses hasta 05/06-11-2026. Prima = cierre / VL − 1. Volatilidad = desviación típica de los **12 rendimientos mensuales** × √12, el estimador del método. VL en USD convertido a euros con el cambio del BCE del día, cuando la línea cotiza en euros. Cierre ajustado de EODHD.

| ETF | Línea | Prima media | Prima máx. | Corr. mensual | Corr. diaria | Vol. precio | Vol. VL | Diferencia |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Amundi Core Stoxx 600 | LYP6.XETRA | +0,21 % | 0,87 % | 0,9994 | 0,994 | 11,74 | 11,89 | −0,15 |
| SPDR MSCI Europe Small Cap | SMC.PA | +0,04 % | 0,84 % | 0,9983 | 0,951 | 14,36 | 14,23 | +0,13 |
| iShares Core MSCI World | EUNL.XETRA | +0,07 % | 1,89 % | 0,9866 | 0,677 | 11,46 | 10,51 | **+0,95** |
| iShares Core MSCI World, en USD | IWDA.LSE | +0,07 % | 1,64 % | 0,9922 | 0,799 | 14,97 | 13,64 | **+1,33** |
| Vanguard FTSE All-World | VWCE.XETRA | +0,11 % | 1,51 % | 0,9887 | 0,742 | 12,40 | 11,84 | +0,56 |
| Xtrackers World Health Care | XDWH.XETRA | +0,06 % | 1,56 % | 0,9938 | 0,847 | 15,37 | 15,92 | −0,55 |
| Invesco S&P 500, VL derivado | P500.XETRA | +0,04 % | 2,33 % | 0,9780 | 0,638 | 12,79 | 11,59 | **+1,20** |
| Amundi Japan Topix (swap) | TPXE.PA | +0,19 % | 3,47 % | 0,9769 | 0,504 | 16,40 | 17,42 | **−1,02** |

Lectura:

- **Con subyacente europeo la serie casi no cambia.** Correlación de 0,99 o más, y unas décimas de volatilidad. Aquí el valor liquidativo aporta exactitud, pero poca diferencia.
- **Fuera de Europa, el desfase domina.** XETRA cierra a las 17:30 y el VL sale después del cierre de Estados Unidos, o antes en Japón. La correlación diaria cae a 0,5-0,8 y es la misma causa que en la decisión 11.
- **El sentido no es siempre el que dice el §11.** El método lo llama sesgo «en contra del ETF», y en 2 de los 6 casos fuera de Europa el precio sale **menos** volátil que el VL (Xtrackers −0,55, Topix −1,02). Con 12 observaciones las volatilidades tienen un error amplio. Lo que se mide es ruido de sincronía, no un sesgo de signo fijo. Propongo revisar esa frase.
- **La prima media es muy pequeña** (0,04 % a 0,21 %). Las máximas de 1,5 a 3,5 % vienen del desfase, no de un descuento real.
- **Control de la divisa.** IWDA.LSE, en dólares como su VL, da +1,33 sin intervenir el cambio; el efecto no viene del BCE.
- **Trampa encontrada en EODHD.** P500 tuvo un desdoblamiento de 100 a 1 el 15-12-2025. El `close` no lo recoge; `adjusted_close` sí. Quien use el cierre sin ajustar verá una prima del 10.000 %. El extractor usa el ajustado.

## 4. Clasificación del emisor frente a la del nombre

La clasificación por nombre del 07-11 necesita ocho bloques: renta variable global, Europa, EE. UU., emergentes y cuatro de renta fija.

| Emisor | Clase de activo | Región | ¿Sustituye a la del nombre? |
|---|---|---|---|
| Vanguard | Sí | Sí (`marketRegionFocus`) | Sí, para renta variable. Renta fija sin comprobar |
| Xtrackers | Sí | Sí | Sí |
| Amundi | Sí (686/686) | Parcial (280 con clase ETF) | Clase sí; región a medias |
| iShares | Sí | Solo por desglose de exposición | Clase sí; región calculada con el desglose |
| SPDR | Sí | No | Clase sí |
| Invesco, HSBC, WisdomTree, VanEck | No hallada | No | No |

**Ningún emisor da de forma directa los ocho bloques.** Hay que traducir. Con la clase de activo y la exposición geográfica se distingue renta variable por zona; la renta fija a corto, corporativa y de gobierno necesita además duración o `ETF_CLASSIFICATION1`. Alternativa sin construir: el texto de objetivo del KID, o el EMT, que no trae clase de activo.

## 5. Orden de construcción propuesto

Conteos por nombre del emisor. En la lista de 300, 34 ETF son de otras marcas (BNP Paribas, Deka, JPMorgan…) que no están en los nueve adaptadores del plan.

| Orden | Emisor | Lista 300 | Universo (32) | Facilidad | Por qué aquí |
|---|---|---:|---:|---|---|
| 1 | **iShares** | 62 | 16 | Media | Hay que rehacerlo, y es la mitad del universo. Falta la correspondencia ISIN → id |
| 2 | **Amundi** | 103 | 4 | Alta | El mayor peso en la lista; datos y catálogo en una llamada |
| 3 | **Xtrackers** | 53 | 2 | Alta | JSON por ISIN y clasificación completa. Falta el reparto |
| 4 | **Vanguard** | 7 | 1 | Media-alta | Pocos ETF, datos muy completos, buenos dividendos |
| 5 | **SPDR** | 13 | 2 UCITS | Alta | Ficheros y catálogo por URL. Falta el reparto |
| 6 | **Invesco** | 19 | 2 UCITS | Media | VL derivado; aporta EMT/EET en bloque |
| Aparte | VanEck | 5 | 2 | Baja | Sin histórico de VL libre |
| Aparte | UBS | 4 | 0 | Bloqueado | Sin acceso sin navegador |
| Aparte | HSBC | 0 | 0 | Baja | Sin histórico; solo PDF mensual |
| Aparte | WisdomTree | 0 | 0 | Baja | Sin histórico; EMT útil si entra algún ETF suyo |

**Los seis primeros: 257 de 300 y 27 de los 32 del universo.** Estos 27 incluyen el ETC de oro de iShares, que no tiene método. Los 5 restantes son SPY y QQQ (de Estados Unidos, no UCITS), los dos VanEck y el Acción IBEX de BBVA.

Una forma común para todos, heredada del lector de iShares: un fichero por emisor en `fetchers/`, con correspondencia ISIN → id propio cuando haga falta, crudo guardado con fecha, y salida de VL, política, dividendos, TER, patrimonio, réplica, índice, composición y clasificación con fecha de dato.

## 6. Los 18 ETF sin métricas del 03-11

El informe de aquella fecha no daba la lista. Se reconstruye desde `fondos.csv` a esa fecha: 20 ETF, menos XEON (quedó como fondo) y el ETC. **Hoy los 18 tienen métricas sobre precio**, comprobado en `export/fondos.ndjson`. No se leyó la base, conforme al encargo.

Si se quisiera pasarlos a valor liquidativo:

| Grupo | ETF | Con VL del emisor |
|---|---|---|
| iShares (10) | IE00B4L5Y983, IE00B5BMR087, IE00B0M62Q58, IE000DR59CI3, IE000X59ZHE2, IE00B53L3W79, IE00B6R52259, IE00BDBRDM35, DE0005933956, DE000A0F5UJ7 | Sí. Sin probar los dos alemanes y el id de cada uno |
| Vanguard (1) | IE00B3XXRP09 | Sí |
| Invesco UCITS (2) | IE00B3YCGJ38, IE00B3Q19T94 | Derivado |
| VanEck (2) | IE0002PG6CA6, IE000M7V94E1 | No |
| Estados Unidos (2) | US46090E1038 (QQQ), US78462F1030 (SPY) | Fuera de este plan |
| BBVA (1) | ES0105336038 (Acción IBEX) | Fuera de este plan |

## 7. Fuente con licencia en vez de nueve lectores

**Qué la justificaría:**
- **Riesgo.** Las seis vías buenas son, salvo SPDR, APIs internas sin documentar. Dos han cambiado de forma visible ya: iShares rompió, y WisdomTree y DWS migraron de dominio.
- **Lo que no se puede cubrir.** Histórico de VL de HSBC, WisdomTree, VanEck y UBS, y las 34 marcas restantes de la lista de 300.
- **Condiciones de uso.** No se han leído las de cada web. Si alguna prohíbe la extracción automática, cambiaría la propuesta.

**Coste público:** no lo hay de los proveedores que importan. Morningstar, FE fundinfo, Trackinsight y justETF no publican tarifa; se pide presupuesto. Como referencia de terceros, Datarade lista el API de ETF de Cbonds desde 315-350 USD al mes, sin haber comprobado su contenido. Un extractor de justETF en Apify, a 31 USD por 1.000 registros, no es una licencia y no lo recomiendo. El plan actual de EODHD no incluye fundamentales (`/api/fundamentals/` dio 403).

**Mi recomendación:** construir los seis, con la salvedad de condiciones de uso, y pedir un presupuesto solo si Óscar quiere el paso a 300 con las marcas que faltan. Si el presupuesto supera lo que cuesta mantener seis lectores, no compensa. No hay datos todavía para hacer esa comparación con cifras.

## 8. Decisiones que necesita Óscar

1. **Qué construir.** Recomiendo los seis primeros y aparcar los otros cuatro.
2. **Si el valor liquidativo sustituye al precio en las métricas.** Aporta poco en subyacente europeo. Fuera de Europa, cambia cifras en más de un punto de volatilidad. El §11 fijó precio de mercado; cambiarlo es otra decisión. Recomiendo guardar la serie de VL y decidir después, con más datos.
3. **Revisar las condiciones de uso** de iShares, Amundi, Xtrackers, Vanguard, SPDR e Invesco antes de escribir código. Lo necesita él o alguien con autorización.
4. **UBS:** si quiere medirlo, tiene que autorizar aceptar el aviso de inversor, o facilitar otra vía.

Las decisiones 36 y 38 siguen vigentes: los ETF se quedan en 32 hasta que él diga.

## 9. Límites y lo no medido

- **Un solo día.** Todo se midió el 08-11-2026, domingo. No se ha comprobado que las vías respondan igual otros días ni con volumen.
- **Agente.** Se usó el `User-Agent` configurado en el extractor y, en Invesco, su agente de herramienta. Los 403 de UBS y WisdomTree no se han intentado esquivar.
- **Navegador.** Solo para ver qué llamadas hace la web, en Xtrackers, WisdomTree, VanEck, HSBC y UBS. Claude in Chrome estaba desactivado y usé el navegador integrado. No se aceptó ningún aviso de inversor ni de cookies.
- **Sin medir:** condiciones de uso; EMT de iShares, Amundi, Xtrackers, Vanguard, SPDR, HSBC y VanEck; dividendos de Invesco; composición real de Invesco; peso de posiciones de Vanguard; fecha de las posiciones de HSBC; ETF de iShares domiciliados en Alemania; la mayoría de datos de VanEck; todo UBS.
- **Comparación:** 8 pares, 12 observaciones mensuales. Para el iShares y el Vanguard mundiales, el VL en euros usa el cambio del BCE de las 14:15, que tampoco coincide con la hora del VL.
- **Conteos por emisor** en la lista de 300 salen de la clasificación por nombre del 07-11.
- **EODHD:** 11 peticiones de un máximo de 60.

Scripts y descargas en el espacio temporal de la sesión; no se han añadido al repositorio.
