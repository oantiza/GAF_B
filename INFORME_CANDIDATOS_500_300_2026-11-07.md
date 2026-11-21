# Informe: candidatos para las 500 acciones y los 300 ETF (decisión 36)

*07-11-2026. Encargo de medición, solo lectura, para que Óscar fije el corte de la decisión 36. No se ha
tocado código, configuración ni base alguna; no hay commits. Peticiones a EODHD consumidas: **371 de las
400** autorizadas (11 catálogos por bolsa, dos de ellas devolvieron 404, y 360 series `/eod` de seis meses).
Las listas por corte están en el scratchpad de la sesión, con su ruta completa en el §6. Publicado también
como artefacto para leerlo en el móvil.*

## Lo esencial

1. **Los ocho índices europeos suman 238 acciones distintas y las 238 cotizan en los once mercados**
   (cinco están en dos o tres índices a la vez). El universo actual ya tiene **126**; faltan **112**. Con
   las 100 del universo que están fuera de los once MIC (80 de EE. UU. y 20 suizas, británicas, japonesas,
   canadienses y australianas), la **base por criterio son 338 acciones**: 162 menos que 500.
2. **Las 82 acciones del universo actual que no están en ningún índice son casi todas españolas (80 del
   continuo) y negocian poco:** mediana de 0,18 M€ al día; solo 19 de las 77 medidas superan 1 M€. La
   acción de índice menos negociada del universo mueve 4,5 M€ y la mediana de las de índice, 53 M€. **El
   criterio decidido, aplicado tal cual, las saca a casi todas.** Esta es la decisión de verdad del informe.
3. **Fuera de índice hay 1.021 acciones ordinarias en los once mercados.** Medí el efectivo negociado de 6
   meses de 360 (las 260 con más centros de negociación en FIRDS y 100 al azar del resto): **182 superan
   1 M€ al día y 88 superan 5 M€**; estimando sobre las 770 con símbolo en EODHD, unas **211 superan 1 M€**.
   Italia casi no está medida (EODHD no sirvió el catálogo de Milán) y 251 no tienen símbolo en EODHD.
4. **ETF: FIRDS da 4.089 ISIN en los once mercados, que son 2.731 fondos distintos** (el resto son clases y
   cotizaciones del mismo fondo) de 36 marcas reconocibles. El patrimonio **sí se obtiene de las páginas de
   los emisores**, pero cada uno lo publica de una forma distinta (ocho emisores medidos, dos no alcanzados)
   y no hay una vía común: para 300 ETF hace falta un lector por emisor o una fuente con licencia.
5. **Recomendación:** corte de **500 acciones con la variante «se conserva el continuo español»**
   (umbral de 5,6 M€/día para las nuevas) y **300 ETF por bloques de las carteras modelo**, con el
   patrimonio como criterio diferido hasta tener fuente. Ambas abajo, con las alternativas.

## 1. Fuentes de pertenencia a índice, medidas antes de usarlas

EODHD no da componentes de índice en nuestro plan (`/fundamentals` devuelve 403). Busqué una fuente
gratuita y reproducible por índice. Resultado, por índice:

| Índice | Fuente usada | Fecha de la fuente | Componentes | Con ISIN de la fuente | En FIRDS | En los once MIC | Ya en universo | Faltan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IBEX 35 | **BME, oficial** (ficha del índice; el ISIN va en el enlace de cada valor) | 06-11-2026 17:35 | 35 | 35 | 35 | 35 | 35 | 0 |
| DAX 40 | Wikipedia DE (ISIN) **cotejada nombre a nombre con Deutsche Börse** («Zugehörige Werte», 40 nombres, 2 páginas) | 06-11-2026 | 40 | 40 | 40 | 40 | 40 | 0 |
| CAC 40 | **Euronext, oficial** (ventana «Index composition» con ISIN) | 06-11-2026 | 40 | 40 | 40 | 40 | 40 | 0 |
| AEX | **Euronext, oficial** | 06-11-2026 | **29** | 29 | 29 | 29 | 7 | 22 |
| FTSE MIB | **Borsa Italiana, oficial** (lista A-Z del índice, 2 páginas, ISIN en el enlace); coincide 40/40 con Wikipedia EN e IT | 07-11-2026 | 40 | 40 | 40 | 40 | 7 | 33 |
| BEL 20 | **Euronext, oficial** | 06-11-2026 | 20 | 20 | 20 | 20 | 1 | 19 |
| PSI | **Euronext, oficial** | 06-11-2026 | 16 | 16 | 16 | 16 | 0 | 16 |
| OMX Helsinki 25 | Wikipedia EN (**solo ticker**) → ISIN por el catálogo EODHD de Helsinki | 07-11-2026 | 25 | 24 (Kojamo no está en el catálogo EODHD/HE) | 24 | 24 | 1 | 23 |
| **Total (ISIN distintos)** | | | | | **238** | **238** | **126** | **112** |

Lo que se aprendió midiendo, y conviene guardar:

- **Euronext publica la composición oficial con ISIN**, pero en una ventana aparte
  (`live.euronext.com/popout-page/getIndexComposition/<ISIN del índice>-<MIC>`) que solo se arma con
  JavaScript; la petición directa devuelve el dato cifrado. Vale para CAC 40, AEX, BEL 20 y PSI. **La
  lista del AEX trae 29 filas y el índice tiene 25 valores nominales**: no lo he podido explicar (puede
  mezclar la composición vigente con una revisión pendiente). Hay que mirarlo antes de dar los 29 por
  buenos.
- **BME y Borsa Italiana** publican la lista con el ISIN en el enlace de cada valor. **Deutsche Börse**
  publica solo nombres, paginados y por JavaScript; sin ISIN. **Nasdaq** exige registro para ver la
  ponderación del OMXH25, y su web nórdica redirige a nasdaq.com.
- **Wikipedia va atrasada o trae ISIN caducados.** La española del IBEX tenía 3 valores de 35 mal
  (Aena y Ferrovial con su ISIN anterior, y Meliá en lugar de Puig); la inglesa, Aena con el ISIN viejo.
  La alemana del DAX da los 40 nombres correctos pero **Fresenius con su ISIN anterior** `DE0005785604`
  (el vigente, `DE000FRE5EN2`, es el del universo). El catálogo de EODHD de Helsinki da UPM con el ISIN
  anterior `FI0009005987` (vigente: `FI4000603337`). Las cuatro las detectó FIRDS porque el ISIN viejo
  solo aparecía en MTF, no en el mercado principal: **cruzar siempre con FIRDS antes de dar un ISIN por
  bueno**.
- Un casado por nombre habría sido necesario solo para el OMXH25; con el catálogo de EODHD se perdió
  1 de 25.

Nada de esto va a producción: son listas para medir, guardadas en el scratchpad (§6).

## 2. Acciones

### 2.1 El universo actual (312) contra el criterio

| Grupo | Acciones | Qué son |
| --- | --- | --- |
| En uno de los ocho índices | 126 | 35 IBEX, 40 DAX, 40 CAC, 7 AEX, 7 FTSE MIB, 1 BEL 20, 1 OMXH25 (5 valores cuentan en dos índices) |
| Fuera de los once MIC | 100 | 80 de EE. UU. («S&P 500 ya cubierto»: son 80, no 500) y **20 que no son EE. UU. ni de los once mercados**: 4 suizas, 3 británicas, 3 japonesas, 3 canadienses, 2 australianas, 4 irlandesas de EE. UU. (Linde, Eaton, Medtronic, Seagate) y `ES0125140A14` sin nombre. El criterio decidido no dice nada de ellas |
| En los once MIC y fuera de índice | 82 | 80 del continuo español, 1 Xetra, 1 Ámsterdam. Mediana de efectivo diario **0,18 M€**; 19 de 77 medidas superan 1 M€, 12 superan 2 M€ |
| Bajas | 4 | Aena ISIN viejo, Siemens Gamesa, NH, CAM |

Las 112 de índice que faltan, por mercado: 33 Milán, 23 Helsinki, 22 Ámsterdam, 19 Bruselas, 16 Lisboa.
Lista completa con índice y MIC en `acciones_indices_europeos.csv`.

### 2.2 Efectivo negociado fuera de índice: qué se midió y hasta dónde llega

- **Conjunto:** 1.021 acciones ordinarias (CFI `ES*`) de FIRDS en los once mercados que no están en índice
  ni en el universo. Por mercado: Xetra 265, París 263, Milán 155, Helsinki 126, Ámsterdam 86, Bruselas 82,
  Dublín 17, Lisboa 14, Luxemburgo 8, Madrid 5.
- **Símbolo en EODHD:** 770 de las 1.021, casado por ISIN con el catálogo de cada bolsa. **Milán no:**
  EODHD devolvió 404 para `MI` y `MIL`, así que 154 de las 155 italianas quedan sin medir. Tampoco tienen
  símbolo 251 del resto (sobre todo valores pequeños).
- **Muestra:** 360 series `/eod` de 6 meses (07-05 a 06-11-2026), efectivo = cierre × volumen por sesión,
  mediana de las sesiones con volumen, todo en euros. Estrato 1: las 260 con más centros de negociación en
  FIRDS. Estrato 2: 100 al azar de las 510 restantes, proporcional por mercado. **Cobertura: 47 % de las
  770 con símbolo, 35 % del conjunto.**
- **El número de centros de negociación de FIRDS sirve de proxy de liquidez** (Spearman 0,67 con la
  mediana negociada): las de 40 o más centros tienen una mediana de 2,1 M€/día; las de 30-39, 0,08 M€;
  por debajo, cero. Es gratis y está ya en la base: vale para ordenar lo que no se ha medido.

| Umbral de efectivo diario | En la muestra (360) | Estimado sobre las 770 con símbolo |
| --- | --- | --- |
| ≥ 1 M€ | 182 | ~211 |
| ≥ 2 M€ | 137 | ~153 |
| ≥ 5 M€ | 88 | ~100 |
| ≥ 10 M€ | 50 | ~58 |

Las más negociadas que no están en ningún índice: Soitec (40,8 M€/día), Bank of Ireland (34,9), Lufthansa
(34,9), Kingspan (31,0), Aixtron (27,6), Thyssenkrupp (25,4), Aurubis, Rexel, Alstom, Hensoldt, Evonik,
TUI, Renk, Nordex, Nexans. Lista completa de las 360 en `liquidez_fuera_indice.csv`.

### 2.3 Los tres cortes

Criterio aplicado tal cual: base = índices (238) + las 100 fuera de los once MIC = **338**; el resto se
ordena por efectivo negociado, mezclando las 82 del universo fuera de índice con las 360 medidas.

| Corte | Composición | Efectivo del último que entra | Del universo actual salen | Por mercado (primer MIC) |
| --- | --- | --- | --- | --- |
| **400** | 338 + 62 nuevas | 7,7 M€/día | **82** (todo el continuo español fuera del IBEX) | Xetra 65, París 60, Milán 40, Ámsterdam 39, Madrid 33, Helsinki 23, Bruselas 19, Lisboa 17, Dublín 2, EE. UU./otros 102 |
| **500** | 338 + 150 nuevas + 12 del universo | 1,6 M€/día | **70** | Xetra 108, París 91, Ámsterdam 49, Madrid 44, Milán 40, Helsinki 25, Bruselas 22, Lisboa 17, Dublín 2, EE. UU./otros 102 |
| **600** | 338 + 229 nuevas + 33 del universo | 0,38 M€/día | **49** | Xetra 146, París 109, Madrid 66, Ámsterdam 55, Milán 41, Helsinki 33, Bruselas 28, Lisboa 17, Dublín 3, EE. UU./otros 102 |

**Variante «se conserva el continuo español»**: las 82 del universo fuera de índice se quedan por decisión
(están porque un asesor en España las necesita, no por liquidez) y el efectivo solo completa.

| Corte | Composición | Efectivo del último que entra | Por mercado de las nuevas |
| --- | --- | --- | --- |
| 400 | no cabe: la base ya son 420 | — | — |
| **500** | 420 + 80 nuevas | **5,6 M€/día** | Xetra 39, París 31, Ámsterdam 8, Dublín 2 |
| **600** | 420 + 180 nuevas | 1,0 M€/día | Xetra 81, París 69, Ámsterdam 18, Bruselas 6, Helsinki 3, Dublín 2, Milán 1 |

Dos cosas que ningún corte arregla solo: **Milán** entra solo por el FTSE MIB (40) porque no se pudo medir
su liquidez, y **Lisboa, Bruselas y Helsinki** entran solo por índice (16, 20, 24): sus valores fuera de
índice no alcanzan los umbrales. Y las **20 acciones fuera de EE. UU. y de los once mercados** (Nestlé,
Novartis, Roche, UBS, AstraZeneca, HSBC, Rolls-Royce, Toyota…) van en los 338 porque ya están, pero el
criterio no las ampara: hay que decidir si el alcance las incluye (decisión 34 nombra Suiza como «para
cuando entre»).

## 3. ETF

### 3.1 Qué hay en FIRDS

| Medida | Valor |
| --- | --- |
| ISIN con CFI de ETF (`CE*`) vivos en los once MIC | **4.089** |
| Fondos distintos (quitando clases y cotizaciones del mismo nombre) | **2.731** |
| LEI distintos | 2.561: FIRDS lleva el LEI del **subfondo**, no del emisor; no sirve para contar emisores |
| Marcas reconocibles por el nombre | 36, más 334 ISIN de otras |
| Por marca (ISIN) | Amundi 625 (incluye Lyxor), iShares 607, Xtrackers 433, Invesco 293, UBS 286, JPMorgan 215, BNP Paribas 195, SPDR 163, Vanguard 129, WisdomTree 91, HSBC 80, First Trust 68, Fidelity 63, L&G 63, Global X 57, Deka 53, Franklin 51, VanEck 41 |
| Por mercado | Xetra 3.095, Milán ETFplus 2.095, Dublín 960, París 701, Ámsterdam 357, Luxemburgo 159, Bruselas 13, Madrid 6, Helsinki 1 |
| Divisa nominal | EUR 1.894, USD 1.797, GBP 291, CHF 38, JPY 32 |
| Del universo actual (32 ETF) | 27 ISIN están; son 26 fondos |

### 3.2 Patrimonio: se obtiene, pero emisor a emisor

Medido sobre páginas de producto de los emisores (no se usó ningún agregador):

| Emisor | Cómo se obtiene | Cifra medida | Fecha del dato |
| --- | --- | --- | --- |
| SPDR (State Street) | **Lista completa en JSON** (`fundfinder`, 179 ETF UCITS) con AUM y fecha; 2 sin AUM | 20 fondos de muestra, p. ej. S&P 400 U.S. Mid Cap $5.790 M, FTSE EPRA Europe ex UK €112,9 M | 06-11-2026 |
| iShares | HTML de la página de producto, JSON-LD servido por el servidor (`curl`); la URL lleva un id de producto, no el ISIN | Core MSCI World: USD 147.025 M | 06-11-2026 |
| Xtrackers | Página de producto por ISIN, solo con JavaScript (navegador) | MSCI World 1C: 22,51 B GBP | 05-11-2026 |
| Amundi | Página de producto con el ISIN al final de la URL, solo con JavaScript | Core MSCI World: 18.916 M USD | no muestra fecha junto a la cifra |
| Invesco | Página de producto, solo con JavaScript; el HTML servido trae el campo sin la cifra | S&P 500 Acc: $55,74 B | 05-11-2026 |
| HSBC | **Ficha mensual PDF por ISIN** (API de documentos, `curl` + `pdftotext`) | MSCI World: USD 19.217 M | 30-09-2026 |
| WisdomTree | Página de producto, solo con JavaScript; `curl` recibe 403 | Physical Gold (ETC): US$6.768 M | 05-11-2026 |
| Vanguard | HTML de la página con JSON embebido (`AUM.fundAssetAmount` por divisa, fecha 31-10-2026), pero varias cifras USD en la misma página: **no identificada sin leer la estructura** | — | 31-10-2026 |
| UBS, VanEck | **No alcanzados**: no encontré la URL de producto sin buscador; VanEck publica los valores liquidativos por nota de prensa | — | — |

**Muestra: 27 ETF con patrimonio y fecha** (20 SPDR + 7 de otros seis emisores), 1 sin identificar
(Vanguard), 2 emisores sin medir. Conclusión: **para una lista de 300 el patrimonio no sale hoy de una
sola vía**; hace falta un lector por emisor (ocho vías distintas medidas) o una fuente con licencia (§4).
Hasta entonces, el número de centros de negociación de FIRDS y el emisor son los únicos criterios de
tamaño disponibles sin coste.

### 3.3 Las clases de activo de las carteras modelo

Las carteras modelo del generador (`generador_de_carteras.py`, decisión 122) se construyen con **ocho
bloques**: liquidez y renta fija a muy corto EUR, renta fija a corto plazo EUR, renta fija euro
diversificada, renta fija corporativa euro, renta variable global, Europa, EE. UU. y emergentes. Los ETF de
FIRDS casados a esos bloques **por palabras del nombre** (aproximación: sin clasificación del emisor), solo
marcas grandes:

| Bloque | Fondos candidatos | Cuota propuesta | 200 | 300 | 400 |
| --- | --- | --- | --- | --- | --- |
| RV global | 310 | 20 % | 40 | 60 | 80 |
| RV Europa | 351 | 17 % | 34 | 51 | 68 |
| RV EE. UU. | 326 | 17 % | 34 | 51 | 68 |
| RV emergentes | 151 | 10 % | 20 | 30 | 40 |
| RF euro gobierno / diversificada | 99 | 12 % | 24 | 36 | 48 |
| RF corporativa EUR | 80 | 10 % | 20 | 30 | 40 |
| RF a corto plazo EUR | 41 | 8 % | 16 | 24 | 32 |
| Liquidez y RF a muy corto EUR | 52 | 6 % | 12 | 18 | 24 |

Dentro de cada bloque, el orden es: primero los que ya tiene el universo, luego por centros de negociación
en FIRDS y por número de clases. Por marca, el corte de 300 queda Amundi 103, iShares 62, Xtrackers 53,
Invesco 19, SPDR 13, BNP Paribas 12, Deka 12, Vanguard 7; **18 de los 26 fondos del universo actual** caen
dentro de los tres cortes (los 8 restantes son sectoriales o de materias primas, fuera de los ocho
bloques). Las cuotas son una propuesta mía para que la renta fija no quede ahogada por los 1.000 ETF de
renta variable; la renta variable global y Europa pesan más porque son los bloques que más usan las
carteras. Son las listas `etf_corte_200/300/400.csv`; **la clasificación por nombre debe sustituirse por la
del emisor (o la del KID/EMT) antes de dar de alta nada**: 1.691 de los 4.089 ISIN no casan con ningún
bloque por nombre, y entre ellos hay fondos que sí pertenecen.

## 4. Lo que no se puede medir hoy y qué lo resolvería

| Qué falta | Por qué | Qué lo resolvería | Coste |
| --- | --- | --- | --- |
| Patrimonio de los 2.731 ETF de una vez | Cada emisor lo publica distinto; dos no se alcanzan sin buscador | **Un lector por emisor** (ocho vías medidas, gratis, frágil) o una fuente con licencia: el plan de fundamentales de EODHD (incluye datos de ETF y componentes de índice, hoy 403 en nuestro plan) o una licencia de datos de un agregador | EODHD: su web publica los planes; el nuestro no incluye `/fundamentals`. No tengo la tarifa verificada hoy: hay que mirarla en su página de precios antes de decidir. Agregadores (justETF, Morningstar): licencia comercial, precio bajo consulta |
| Liquidez de las 155 acciones de Milán fuera de índice | EODHD devolvió 404 para el catálogo de Milán (`MI` y `MIL`) | Confirmar con EODHD el código de bolsa de Borsa Italiana; o leer el volumen de la propia Borsa Italiana | Dentro de la cuota si el código existe |
| Liquidez de 251 acciones sin símbolo en EODHD | No están en los catálogos de EODHD | Son valores pequeños; probablemente no entran en ningún corte | — |
| Composición oficial del DAX con ISIN | Deutsche Börse publica solo nombres | STOXX/ISS publica la composición en su web con registro; o casar los 40 nombres con FIRDS como hice | Gratis con registro |
| Ponderación oficial del OMXH25 | Nasdaq exige registro | Registro gratuito en indexes.nasdaqomx.com | Gratis |
| Por qué el AEX trae 29 filas | No medido | Leer el aviso de revisión de Euronext (documentos del índice) | — |
| Clasificación de los ETF por clase de activo | Solo por nombre | El EMT de cada ETF (paso 3 del plan de datos) o la clasificación del emisor | Gratis, es trabajo |

## 5. Recomendación

**Acciones: 500 con la variante que conserva el continuo español.** Razones: (a) el criterio puro saca
70-82 valores españoles que un asesor en España necesita tener aunque muevan 0,2 M€/día, y la liquidez ya
se publica en la ficha (decisión 108) para que el asesor la vea; (b) las 80 nuevas por liquidez entran con
un umbral de 5,6 M€/día, por encima del mínimo de las acciones de índice del universo (4,5 M€), así que no
se mete nada más ilíquido que lo que ya se considera bueno; (c) el corte de 600 bajaría el umbral a 1 M€ y
el de 400 obliga a elegir entre el continuo español y los índices nuevos. Antes de ejecutarlo hacen falta
tres decisiones tuyas: qué pasa con las **20 acciones fuera de EE. UU. y de los once mercados**, si las
**4 bajas** salen del universo (hoy están), y si Milán entra solo por el FTSE MIB hasta medir su liquidez.

**ETF: 300 por bloques, patrimonio diferido.** La lista `etf_corte_300.csv` cubre los ocho bloques de las
carteras modelo con las marcas grandes y conserva 18 de los 26 ETF actuales. El patrimonio mínimo que pide
la decisión 36 no se puede aplicar hoy a 300 fondos sin construir los lectores por emisor; propongo
fijar el **mínimo en 100 M€** (el mismo que usa el generador para fondos) y aplicarlo cuando llegue la fuente,
sacando de la lista lo que no lo alcance. Decisión tuya: si construimos los lectores (ocho emisores, gratis,
frágil) o pagamos una fuente.

## 6. Ficheros de la medición

Todos en el scratchpad de esta sesión, fuera del repositorio:
`C:\Users\oanti\AppData\Local\Temp\claude\dfba910fcae1a72b\eebbe11e-8b55-4875-9e04-342112264273\scratchpad\listas\`

| Fichero | Qué es |
| --- | --- |
| `acciones_corte_400.csv`, `acciones_corte_500.csv`, `acciones_corte_600.csv` | Los tres cortes con el criterio tal cual (ISIN, nombre, grupo, índices, MIC, efectivo, origen) |
| `acciones_corte_500_variante_conservar.csv`, `acciones_corte_600_variante_conservar.csv` | Las 80 y 180 acciones nuevas de la variante que conserva el universo |
| `acciones_indices_europeos.csv` | Las 238 de los ocho índices, con índice, CFI, MIC y si están en el universo |
| `acciones_universo_clasificado.csv` | Las 312 del universo con su grupo y su efectivo negociado (del export canónico) |
| `liquidez_fuera_indice.csv` | Las 360 medidas con `/eod`: efectivo mediano de 6 meses, sesiones, centros FIRDS, estrato |
| `pool_fuera_indice.json` | Las 1.021 acciones fuera de índice con su símbolo EODHD cuando lo hay |
| `idx_*.json`, `euronext_*.json`, `wiki_*.json` | Las composiciones descargadas, con fuente y fecha |
| `etf_corte_200.csv`, `etf_corte_300.csv`, `etf_corte_400.csv`, `etf_candidatos_todos.csv` | Los cortes de ETF por bloque y los 2.731 fondos con marca, bloque por nombre y centros |
| `aum_spdr.json`, `aum_muestra_emisores.json` | El patrimonio medido, con fuente, vía y fecha |
| `..\eodhd\peticiones.log` | Las 371 peticiones a EODHD, una por línea, con hora |

Las descargas crudas están en `..\descargas\` y los scripts en `..\scripts\`. El token de EODHD no aparece
en ningún fichero de la medición.
