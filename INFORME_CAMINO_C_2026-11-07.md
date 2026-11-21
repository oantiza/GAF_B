# Camino C · la serie del índice de EODHD · fase 1

*07-11-2026 · sesión de trabajo «camino C» (Opus 5.5, esfuerzo alto), por encargo de la directora.
Solo lectura: nada de esto está en el código ni en `config/indices.csv`. Lo medido sale de
`1-extractor/data/funds/*.json`, de la bolsa `INDX` de EODHD con nuestro plan y de los cambios del BCE;
los scripts están en el scratchpad de la sesión, fuera del repositorio. Las cifras de la §3 son una
**previsión** de lo que escribiría el extractor con el método vigente, no cifras publicadas.*

## Lo que cambia respecto al encargo

- **El universo medible es la mitad del que decía el encargo.** De los 11 ISIN, 2 ya están retirados por
  decisión 20 (KID compuesto), 1 queda fuera por la misma decisión (su KID no declara índice), 2 son
  ETF, que hoy no reciben relativas (§11 del método), 1 declara una variante (IBEX 35 NR) que EODHD no
  tiene, y 1 es una **clase cubierta que el detector no reconoce**. Quedan **4 fondos limpios**, más
  **1 añadido** que al encargo se le escapó (MyInvestor S&P 500 Equiponderado, con serie exacta en EODHD).
- **EODHD tiene las series, con un agujero.** IBEX 35 en PR y TR desde 1991 y 2011; EURO STOXX 50 en
  precio (`SX5E`) y en **net return** (`SX5T`, que el catálogo llama «ESTX 50 EUR NRt» y por eso un filtro
  por «STOXX» no lo ve; lo localizó el contraste de códigos que envió la directora); S&P 500 en PR, TR y NTR
  desde 1927, 1988 y 1996; S&P 500 Equal Weighted en PR, TR y NTR. **No tiene** el IBEX 35 Net Return. Todas
  en euros salvo las del S&P, en dólares. Ningún mes sin dato salvo `SX5T`, que no trae nada de 12-2012 a
  02-2013 (hoy fuera de las tres ventanas; el método no publica una ventana con hueco). Las variantes se
  comportan como dicen: la razón TR/PR deriva un **3,7-3,9 % anual en el IBEX**, un **1,2-1,6 % en el S&P 500**
  y la NR/PR un **2,5-3,1 % en el EURO STOXX 50**, que es la rentabilidad por dividendo de cada mercado.
- **El nivel de un índice se lee de `close`, no de `adjusted_close`.** `vl_fondos.serie_de_simbolo` toma el
  cierre ajustado para todo lo que no sea `.EUFUND`, que es lo correcto para un ETF (reinvierte sus repartos).
  En las 7 series de índice medidas los dos campos son idénticos en las 76.000 filas, pero un índice no tiene
  nada que ajustar y el ajustado de EODHD no es una serie Total Return oficial: la rama nueva debe pedir
  `close` explícitamente, para que una diferencia futura entre los dos campos no entre sin que nadie lo decida.
- **`/search` no sirve para índices en nuestro plan** (devuelve ETF y acciones, nunca `INDX`); la lista de
  la bolsa `/exchange-symbol-list/INDX` sí, con nombre y divisa de los 1.681. El símbolo irá fijo en la fila.
- **La tabla de proxies no admite hoy dos variantes del mismo índice.** `core/indices.carga` indexa por el
  nombre plegado: «S&P 500 (TR) (1970)» y «S&P 500 NR USD» caen en la misma clave `s p 500`, así que una fila
  nueva del S&P 500 TR **pisaría en silencio** la del S&P 500 NR (Vanguard, 3 fondos). La fase 2 tiene que
  indexar por (nombre, variante) antes de añadir ninguna fila. Lo mismo pasaría con IBEX 35 PR y TR.
- **Dos hallazgos fuera del encargo que condicionan la fase 2** (§4.5): el camino B dio por **confirmado
  completo** el índice de CaixaBank Small & Mid Caps España cuando su KID declara un compuesto (30 % IBEX
  Small Cap + 50 % IBEX Medium Cap + 20 % IBEX 35), porque escribe el porcentaje **detrás** del nombre; y la
  clase «AH (EUR)» de Morgan Stanley es **cubierta** según su propio KID («clase de participaciones con
  cobertura cambiaria») y `clase_cubierta` dice `False`. Con una fila del S&P 500 TR, ese fondo publicaría
  una beta de 1,2-1,4 con un R² del 46 %, que es el tipo de cambio y no el gestor.

## 1 · El universo, fondo a fondo

Criterio del encargo: `identificacion.indice_benchmark_oficial` sobre `data/funds`, familias IBEX, STOXX
y S&P sin proxy aprobado. Ninguno tiene relativas hoy. Lo que decide si se puede medir es lo que ya aplica
`vl_fondos._escribe_relativas`: KID (decisión 20), clase cubierta, tipo (los ETF no pasan por ahí) y
proxy con la variante declarada.

| ISIN | Fondo | Índice declarado | KID (camino B) | Serie EODHD | Medible |
|---|---|---|---|---|---|
| `ES0137381036` | Gesconsult Renta Variable Iberia | Ibex 35 TR | **COMPUESTO** (85 % Ibex 35 TR + 15 % PSI 20 TR) | `IBEXTR` | No: ya retirado por la decisión 20 |
| `ES0138800034` | CaixaBank Small & Mid Caps España | Ibex 35 TR | CONFIRMADO_COMPLETO, **falso**: el KID declara 30 % IBEX Small Cap NR + 50 % IBEX Medium Cap NR + 20 % IBEX 35 NR | `IBEXTR` | **No debería**: es un compuesto. Medido contra el IBEX 35 TR sale beta 0,60 y R² 66 % (§3) |
| `LU0563745743` | Bestinver Tordesillas Iberia A | BME IBEX 35 TR | **COMPUESTO** (90 % IGBM TR + 10 % PSI All Share) | `IBEXTR` | No: ya retirado por la decisión 20 |
| `LU1066281574` | SIH FCP Equity Spain A | BME IBEX 35 TR | **KID_SIN_INDICE** («sin referencia a parámetros verificables») | `IBEXTR` | No: decisión 20. Además la serie empieza en 04-2025 |
| `ES0105336038` | Acción IBEX 35 ETF (BBVA) | BME IBEX 35 PR | CONFIRMADO_COMPLETO | `IBEX` | **No hoy**: es ETF y los ETF no reciben relativas (§11). Ver §4.4 |
| `LU0995386439` | EDM Inversión Spanish Equity R | BME IBEX 35 **NR** | CONFIRMADO_COMPLETO («IBEX35 NET RETURN») | **No hay NR** en EODHD; solo `IBEX` (PR) e `IBEXTR` | **No con la regla vigente**: la variante no coincide. Ver §4.3 |
| `ES0155142005` | Intermoney Variable Euro | EURO STOXX 50 **Price** | CONFIRMADO_COMPLETO («EuroStoxx 50», sin variante) | `SX5E` (= `STOXX50E`), precio | **Sí**, base `PRICE_RETURN`: beta, R² y tracking error; sin alfa. Ver §4.2 |
| `LU0266117927` | Morgan Stanley US Advantage **AH (EUR)** | S&P 500 (TR) (1970) | CONFIRMADO_COMPLETO | `SP500TR`, USD → EUR | **No debería**: su KID dice que es clase cubierta y `clase_cubierta` = False. Ver §4.5 |
| `LU0683600562` | AB Select US Equity A Acc (USD) | S&P 500 (TR) (1970) | CONFIRMADO_COMPLETO | `SP500TR`, USD → EUR | **Sí**: la clase en dólares se convierte a euros antes de calcular (decisión 10), como el índice |
| `LU0787776565` | AB Select US Equity A EUR Acc | S&P 500 (TR) (1970) | CONFIRMADO_COMPLETO | `SP500TR`, USD → EUR | **Sí** |
| `US78462F1030` | SPDR S&P 500 ETF Trust (USD) | S&P 500 (TR) (1970) | SIN_KID | `SP500TR` | **No hoy**: ETF (§11) |
| `ES0165242001` | **MyInvestor S&P 500 Equiponderado** (añadido) | S&P 500 Equal Weighted TR USD | CONFIRMADO_COMPLETO | `SPXEWTR`, USD → EUR | **Sí** |

Otros que se miraron y **no** son del camino C: Sycomore Europe Happy@Work (`LU1301026388`, EURO STOXX
**GR**): EODHD tiene `SXXE` (precio) y `SXXT` (**net** return, pese a llamarse «NRT Index TR»), no la
gross; variante distinta, fuera. STOXX Europe 600 NR y S&P 500 NR ya tienen proxy ETF o fondo índice y no
hay razón para cambiarlos: un proxy aprobado y en producción no se sustituye por una serie de índice
sin una decisión que diga por qué (§4.1 explica que no son comparables entre sí). Los ETF sectoriales
STOXX Europe 600 Banks (`SX7R` existe), EURO STOXX Optimised Banks y los STOXX Global temáticos son ETF
y quedan fuera por §11. Las series de Nasdaq, DAX y S&P sectoriales/globales (`S&P Global Luxury`,
`S&P Global Infrastructure`, 1-2 fondos cada una) no se midieron: no eran del encargo y no cambian la
decisión de hoy; constan en el scratchpad por si Óscar quiere ampliar el camino C después.

**En números:** de 11 ISIN del encargo, 4 medibles con la regla vigente (ES0155142005 solo beta/R²/TE,
LU0683600562, LU0787776565) más 1 añadido (ES0165242001). Las decisiones de §4 pueden sumar EDM (§4.3) y
el ETF del IBEX (§4.4), o quitar Morgan Stanley y CaixaBank si no se arreglan antes los detectores (§4.5).

## 2 · Lo medido en EODHD

Fuente: `/exchange-symbol-list/INDX` (nombre y divisa) y `/eod/{símbolo}.INDX` (serie diaria, cierre),
el 07-11-2026. `close` y `adjusted_close` son idénticos en todas (0 diferencias): un nivel de índice no se
ajusta. Ningún mes sin dato entre la primera y la última fecha; ningún mes con menos de 10 sesiones en los
últimos diez años.

| Símbolo | Nombre en EODHD | Divisa | Primera fecha | Última | Meses | Observaciones |
|---|---|---|---|---|---|---|
| `IBEX` | IBEX 35 Index | EUR | 1991-09-06 | 2026-11-06 | 423 | PR |
| `IBEXTR` | IBEX Total Return | EUR | 2011-10-28 | 2026-11-06 | 182 | TR; 15 años: cubre las tres ventanas |
| `STOXX50E` / `SX5E` | Euro Stoxx 50 | EUR | 1986-12-31 | 2026-11-06 | 480 | Precio. Dos símbolos, misma serie (6.170,49 el 06-11) |
| `SX5T` | ESTX 50 EUR NRt | EUR | 1986-12-31 | 2026-11-05 | 477 | **NR del EURO STOXX 50.** Sin dato de 12-2012 a 02-2013; va un día por detrás del precio |
| `SXXE` / `SXXT` | EURO STOXX (amplio) PR / NR | EUR | 1991-12-31 | 2026-11-06 | 420 | No es el 50. Sirvió para medir el dividendo de la zona euro |
| `GSPC` | S&P 500 Index | USD | 1927-12-30 | 2026-11-06 | 1.188 | PR |
| `SP500TR` / `SPXTR` | S&P 500 TR | USD | 1988-01-04 / 1988-02-08 | 2026-11-06 | 467 / 466 | TR; **misma serie** (deriva entre ambas 0,000 %) |
| `SPXNTR` / `SP500NTR` | S&P 500 Net TR | USD | 1996-03-29 / 2015-02-10 | 2026-11-06 | 369 / 142 | NTR; misma serie |
| `SPXEW` / `SPXEWTR` / `SPXEWNTR` | S&P 500 Equal Weighted PR / TR / NTR | USD | 1989-12-29 / 1989-12-29 / 1998-12-31 | 2026-11-06 | 444 / 444 / 336 | |
| — | IBEX 35 Net Return | — | — | — | — | **No está** (ni en la lista ni por búsqueda) |
| — | IBEX 35 TR «J»/«INDJ», NR «Y»/«INDY»; EURO STOXX 50 GR `SX5GT`; S&P 500 `SPXT`, `SPTR500N` | — | — | — | — | Códigos de BME, STOXX y S&P DJI citados por ChatGPT: **ninguno es código de EODHD** (comprobado en el catálogo). El único que casa, con otro nombre, es `SX5T` |

### La variante es la que dice: razón TR/PR

Deriva anualizada de log(TR/PR) a cierre de mes, en puntos porcentuales por año. Si la serie «TR» fuera
otra cosa, no derivaría a este ritmo ni tan estable.

| Par | 1 año | 3 años | 5 años | 10 años | Año a año 2020-2025 | Lectura |
|---|---:|---:|---:|---:|---|---|
| `IBEXTR` / `IBEX` | 3,30 | 3,95 | 3,94 | 3,73 | 3,2 · 2,6 · 3,7 · 4,2 · 4,4 · 4,0 | Rentabilidad por dividendo del IBEX 35: coherente con el 3-5 % esperado. 2021 (2,6) es el año de los recortes de dividendo |
| `SP500TR` / `GSPC` | 1,06 | 1,24 | 1,40 | 1,62 | 1,8 · 1,4 · 1,6 · 1,6 · 1,4 · 1,3 | Rentabilidad por dividendo del S&P 500, que baja con la subida de precios: coherente |
| `SPXNTR` / `GSPC` | 0,74 | 0,87 | 0,98 | 1,14 | 1,3 · 1,0 · 1,2 · 1,2 · 1,0 · 0,9 | Net ≈ 70 % del bruto: la retención del 30 % de S&P sobre el dividendo. Confirma que es NTR |
| `SX5T` / `SX5E` | 3,06 | 2,65 | 2,60 | 2,48 | 2,0 · 1,9 · 2,5 · 2,5 · 2,5 · 2,5 | Dividendo neto del EURO STOXX 50: confirma que `SX5T` es la NR, y mide el sesgo de la base PR de Intermoney (§4.2) |
| `SXXT` / `SXXE` | 2,19 | 2,40 | 2,41 | 2,29 | 1,8 · 1,8 · 2,4 · 2,5 · 2,5 · 2,5 | Dividendo neto de la zona euro amplia; coherente con el del 50 |
| `SPXEWTR` / `SPXEW` | 1,66 | 1,81 | 1,87 | 1,91 | 2,1 · 1,7 · 1,9 · 2,1 · 1,9 · 1,9 | Equiponderado: más dividendo que el ponderado, como corresponde |

### Conversión a euros

Las del S&P llegan en dólares. Se convierten como ya se hace con los ETF proxy en francos o dólares:
`cambios_bce.serie_en_euros(serie, "USD", http)`, con `EXR D.USD.EUR.SP00.A` del BCE desde 1999, tolerancia
de 7 días en festivos de TARGET. La divisa **no** puede salir de `vl_fondos.divisa()` (usa `/search`, que no
ve índices): sale de la lista de la bolsa `INDX`, que la trae, o se declara en la fila. En la §3 la conversión
está hecha así y las dos clases de AB (una en dólares, otra en euros) dan beta 0,83 y 0,87 a un año contra la
misma serie: la conversión es coherente.

## 3 · Qué saldría, con el método vigente

Calculado con `core/metricas.relativas` tal como está, rentabilidades mensuales a cierre de octubre de 2026,
€STR del BCE, fondo y índice en euros. **Previsión, no cifra publicada.** Alfa y rentabilidad activa en
puntos porcentuales anuales; R² y tracking error en %.

| Fondo | Contra | Base | Ventana | Beta | R² | Alfa Jensen | Rent. activa | TE | IR |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| AB Select US Equity A Acc (USD) | `SP500TR` | TR | 1a / 3a / 5a | 0,83 / 0,93 / 0,88 | 96 / 97 / 96 | +0,06 / −0,40 / −0,31 | −2,22 / −1,70 / −1,65 | 2,5 / 2,4 / 3,1 | −0,88 / −0,71 / −0,53 |
| AB Select US Equity A EUR Acc | `SP500TR` | TR | 1a / 3a | 0,87 / 0,93 | 96 / 96 | −0,68 / −0,51 | −2,39 / −1,80 | 2,3 / 2,5 | −1,02 / −0,73 |
| MyInvestor S&P 500 Equiponderado | `SPXEWTR` | TR | 1a / 3a / 5a | 0,98 / 0,98 / 0,98 | 96 / 96 / 95 | −0,63 / −1,07 / −2,38 | −0,98 / −1,36 / −2,55 | 2,3 / 2,5 / 3,3 | −0,43 / −0,53 / −0,78 |
| Intermoney Variable Euro | `SX5E` | **PR** | 1a / 3a / 5a | 1,00 / 0,94 / 0,94 | 98 / 97 / 98 | — | — | 1,9 / 2,1 / 2,4 | — |
| *Intermoney, ilustrativo con base TR (lo que la regla evita)* | `SX5E` | *TR* | 1a / 3a / 5a | — | — | *+0,82 / +1,31 / +1,25* | *+0,84 / +0,66 / +0,87* | — | — |
| EDM Spanish Equity R (declara NR; §4.3) | `IBEXTR` | TR | 1a / 3a / 5a | 0,57 / 0,62 / 0,78 | 67 / 70 / 77 | −0,81 / −2,91 / −7,30 | −8,43 / −12,93 / −11,17 | 8,4 / 7,6 / 7,3 | −1,00 / −1,70 / −1,53 |
| *CaixaBank Small & Mid Caps (compuesto; no debería)* | `IBEXTR` | TR | 1a / 3a / 5a | *0,60 / 0,63 / 0,72* | *66 / 67 / 80* | *−5,02 / −1,73 / −3,91* | *−12,06 / −11,69 / −8,85* | *8,4 / 7,9 / 7,0* | |
| *Morgan Stanley US Advantage AH (EUR) (cubierta; no debería)* | `SP500TR` | TR | 1a / 3a / 5a | *1,21 / 1,32 / 1,43* | ***49 / 47 / 46*** | *−31,9 / −3,8 / −19,7* | | *13,3 / 18,6 / 22,8* | |
| *Acción IBEX 35 ETF (`BBVAI.MC`, precio ajustado; §4.4)* | `IBEX` | PR | 1a / 3a / 5a | *1,01 / 0,98 / 0,99* | *99,5 / 98,6 / 99,0* | — | — | *1,00 / 1,65 / 1,50* | |
| *idem, ilustrativo contra `IBEXTR`* | `IBEXTR` | TR | 1a / 3a / 5a | *0,99 / 0,98 / 0,98* | *99,95 / 99,5 / 99,7* | *−0,45 / −0,35 / −0,28* | *−0,65 / −0,76 / −0,61* | *0,34 / 0,95 / 0,89* | |

Lo que dicen estas cifras, leídas como gestor:

- **Los tres fondos del S&P 500 salen como se espera** de un fondo activo con R² alto y de un fondo índice con
  coste: AB con beta 0,85-0,93 y alfa en torno a cero; MyInvestor con beta 0,98 y rentabilidad activa de
  −1 a −2,5 puntos, que es coste corriente más tracking (su TER no está verificado aquí). Las dos clases de AB
  coinciden entre sí, lo que valida la conversión del índice a euros.
- **Intermoney es casi un índice** (R² 97-98 %, TE 2 %). Con base PR no se publica alfa, y la fila ilustrativa
  enseña por qué: contra el precio saldría un alfa de +0,8 a +1,3 que no es gestión, es el dividendo del
  EURO STOXX 50 (2,3-2,5 % neto en la zona euro, §2) menos lo que el fondo cobra.
- **EDM contra el IBEX 35 TR** da beta 0,6-0,8 y R² 67-77 %: un fondo de bolsa española con mucho peso fuera
  del IBEX, no un error de serie. El alfa contra TR está **infravalorado** respecto al NR que declara, por la
  retención que BME descuenta del dividendo: del orden de 0,7 puntos al año si la retención es del 19 % sobre
  un 3,7-3,9 % de dividendo (estimación; el NR no se puede medir porque EODHD no lo tiene).
- **CaixaBank y Morgan Stanley confirman los dos hallazgos** por la cifra: beta 0,6 y R² 66 % para un fondo
  que dice seguir el IBEX 35 es la mezcla small/mid que su KID declara; y R² del 46 % con beta 1,2-1,4 y TE
  del 13-23 % para un fondo de gran capitalización americana es el EUR/USD que la clase cubre y la serie del
  índice en euros no.
- **El ETF del IBEX contra el IBEX PR** da un tracking error de 1,0-1,65 % que contra el TR es 0,34-0,95 %:
  el cierre ajustado del ETF reinvierte sus repartos y es retorno total, así que compararlo con el precio
  mete el calendario de dividendos en el TE. La variante declarada (PR) no es la que casa con su serie.

## 4 · Las cuestiones que decide Óscar

### 4.1 · Qué es un nivel de índice para el método, y cómo se publica

**El problema.** Un alfa contra el nivel del índice y un alfa contra un ETF proxy no son la misma cifra:
el ETF lleva dentro su coste corriente (0,10-0,65 % según la fila) y su tracking, y el índice no lleva
nada. Un fondo medido contra el S&P 500 TR directo saldrá con **0,1-0,6 puntos menos de alfa** que el mismo
fondo medido contra un ETF del mismo índice. Por la §3 del método, dos cifras solo se comparan si
coinciden en el estimador, y aquí difieren en el **comparador**: hay que publicarlo de forma que nadie
ordene una contra otra sin saberlo.

**Los tres campos ya están separados.** La fila de `indices.csv` dice el símbolo que se mide (`proxy`), la
variante exacta y su base (`variante`, `base`: la NR y la TR son variantes distintas y la fila publica la que
mide, nunca «la de retorno total» sin más) y sobre qué serie (`clase_de_serie`); la fuente la añade el
identificador `EODHD:…` de la opción A. No hace falta una columna nueva para distinguirlos.

**Dónde encaja hoy.** El dato ya viaja con `relative.benchmark.series_class` (`NAV | MARKET_PRICE | RATE`),
que en el extractor es `indice_clase_de_serie` (`VALOR_LIQUIDATIVO | PRECIO_DE_MERCADO | TASA`) y en la
plataforma `CLASE_DE_SERIE`. Ese campo responde «sobre qué serie se midió», y el nivel de índice es
exactamente una clase de serie más, con su propio ruido (ninguno: ni desfase de cierre ni coste).

**Opciones.**

| | A · Clase de serie nueva + identificador de fuente (recomendada) | B · Clase nueva y el ISIN del índice en `instrument_id` | C · Proxy sintético: dar de alta el índice como instrumento |
|---|---|---|---|
| Extractor | `CLASES_DE_SERIE += NIVEL_DE_INDICE`; la columna `proxy` lleva el símbolo `IBEXTR.INDX` (como `ESTR_BCE` no es un ISIN) | Igual, más una columna con el ISIN del índice | Un instrumento `INDEX` en `fondos.csv` y en la base |
| Contrato | `series_class` enum + `INDEX_LEVEL`; campo nuevo `relative.benchmark.source_series_id` con patrón `^EODHD:[A-Z0-9.-]+\.INDX$`, obligatorio cuando `series_class = INDEX_LEVEL`; `instrument_id` ausente con `x-absence: NOT_APPLICABLE` en ese caso; lo mismo en `relative_withdrawal` | `instrument_id` = `ES0SI0000005` | Tipo de instrumento nuevo, bloques, tarjeta: rompe la ficha (decisión 2 de hoy) |
| Verdad del dato | `instrument_id` significa «instrumento de esta base» y el índice no lo es: no se afirma nada falso. `source_series_id` repite el patrón que ya usa `riesgo.historial_precios.source_listing_id` (`EODHD:{símbolo}`) | El ISIN del IBEX 35 (`ES0SI0000005`) es el del **precio**; el TR tiene otro que no he podido verificar. Y la ficha diría «lo replica el activo ES0SI0000005», falso dos veces | Es lo más completo, y lo más caro; no para 5 fondos |
| Ficha | «Medido contra la serie del propio índice (EODHD: IBEXTR.INDX). Sin coste de réplica: su alfa no se ordena con el de un fondo medido contra un ETF» | Igual, con el riesgo del ISIN | Ficha de índice que hoy no existe |

**Recomiendo A**, y añadir a la §3 del método la frase que falta: la identidad comparable de una métrica
relativa es `(method, window, benchmark.series_class)`; una lista que ordene por alfa agrupa por las tres.
Hoy ninguna pantalla ordena por alfa (medido el 02-11), así que la regla vuelve a llegar antes que su primer
infractor. Lo escribe la directora en `METODO_PROPIO_METRICAS_2026-11-01.md`, no esta sesión.

**Consecuencias de A.** La tarjeta y la ficha siguen diciendo «contra su índice» (`DECLARED_BENCHMARK_PROXY`
en `calidadYTarjeta.ts`, que es un nombre interno y no se enseña). El texto de modo interno «No tenemos la
serie del índice: lo replica el activo X» deja de ser verdad y se sustituye cuando `series_class` sea
`INDEX_LEVEL`. La prueba `test_todo_proxy_de_mercado_esta_en_el_universo` no afecta (solo mira
`PRECIO_DE_MERCADO`); hará falta una hermana: todo `NIVEL_DE_INDICE` acaba en `.INDX` y está en la lista
de la bolsa.

### 4.2 · La variante PR: Intermoney contra el EURO STOXX 50 Price

**Mantengo la convención del proyecto:** se mide contra la variante que el fondo declara, con
`base = PRICE_RETURN` en la fila y en `base_indice`, y `metricas.relativas` ya hace lo correcto: publica beta,
R² y tracking error, y **no** alfa, rentabilidad activa ni ratio de información. La §3 lo cuantifica: contra el
precio, el alfa de Intermoney saldría +0,8 a +1,3, que es dividendo, no gestión.

Lo que la ficha tiene que avisar, porque **será el primer `PRICE_RETURN` de la base** y hoy no hay texto para
ello: la sección «Frente a su índice» enseñará tres filas (beta, R², TE) y ninguna de alfa, y sin nota se lee
como un hueco. Propuesta de nota, en los dos modos: «Su índice es de precio: excluye los dividendos, así que no
publicamos alfa ni rentabilidad activa contra él, que saldrían infladas por el dividendo del mercado. La beta,
el R² y el tracking error sí se sostienen». La aptitud «Medir su alfa» ya no se concede sin alfa, así que la
tarjeta no promete nada que la ficha no dé.

**Alternativa que no recomiendo:** medirlo contra la variante NR del EURO STOXX 50, que sí existe en EODHD
(`SX5T`). El fondo declara el precio: el KID de Intermoney dice «EuroStoxx 50» sin más, y Morningstar le
atribuye «Price». Cambiar la variante por conveniencia es justo lo que la regla de la variante prohíbe; si
Óscar quiere el alfa de Intermoney, lo que hay que decidir es que la variante declarada por el fondo es la NR,
con el folleto delante, y entonces entra por la fila NR.

**Lo que `SX5T` sí abre, y no propongo hoy:** la fila EURO STOXX 50 NR (3 fondos, proxy ETF `IE00B53L3W79`
aprobado el 06-11) podría pasar al nivel de índice. No lo propongo porque es un proxy aprobado y en producción,
y cambiarlo cambia el comparador de esos 3 fondos (§4.1: el alfa contra el ETF lleva su 0,10 % de coste
dentro). Si Óscar lo quiere, es una fila que se cambia con nota, no una decisión de este encargo.

### 4.3 · EDM declara el IBEX 35 Net Return, que EODHD no tiene

| | A · Sin relativas hasta tener la serie NR (recomendada) | B · Equivalencia explícita NR → TR, publicando la declarada | C · Fila «NR» sobre la serie TR |
|---|---|---|---|
| Qué se publica | Nada; `relative_absence` no tiene motivo para esto hoy (sería un hueco, no una afirmación) | Beta, R² y TE exactos; alfa **infravalorado** ~0,7 puntos/año (estimación), con `equivalente_de = "BME IBEX 35 NR EUR"` | Una variante que no es la de la serie: un dato falso |
| Código | Ninguno | `proxy_de` tiene que dejar pasar una equivalencia con variante distinta cuando la fila la declara (hoy la bloquea); el contrato y la ficha tienen que leer `equivalente_de`, que desde el 06-11 se escribe y **nadie lee** | Ninguno, y por eso es tentador |
| Riesgo | Un fondo sin cifras, dicho | La equivalencia cruzada de variante abre una puerta que la tabla entera tiene cerrada por una razón medida (4,9 puntos a un año con la clase cubierta) | Alto |

**Recomiendo A.** Es un fondo, la regla protege a 289, y la fila TR del IBEX 35 que propongo en §5 queda
lista para EDM el día que haya serie NR o se decida B con su contrato y su ficha. Si Óscar prefiere B,
es un encargo propio (extractor, contrato y app), no un apéndice de este.

### 4.4 · Los ETF: Acción IBEX 35 ETF y SPDR S&P 500

Hoy ningún ETF recibe relativas (§11 del método, 04-11): «compararían un cierre de mercado con un proxy de
valor liquidativo». Contra un nivel de índice esa objeción cae a medias: el IBEX cierra a la vez que
`BBVAI.MC`. Pero la §3 enseña otra: el cierre **ajustado** del ETF reinvierte sus repartos y es retorno total,
y el índice que declara es de **precio**; el TE contra el PR (1,0-1,65) triplica el real (0,34-0,95 contra el
TR). Medirlo contra la variante declarada daría una cifra peor que la que hoy no tiene. **Recomiendo dejar
los ETF fuera del camino C**, sin cambiar la §11: abrirlos exige decidir antes qué variante casa con un
cierre ajustado, y eso es una decisión de método para los 25 ETF, no para uno. El SPDR además está en dólares
y sin KID.

### 4.5 · Dos detectores que fallan, y que la fase 2 arrastraría

1. **Camino B, compuestos con el porcentaje detrás del nombre.** `core/indice_kid.py` cuenta «porcentaje
   seguido de nombre» («50 % MSCI World») y la frase de CaixaBank escribe «IBEX Small Cap Net Return en un
   30 %, del IBEX Medium Cap en un 50 % y del IBEX 35 Net Return en un 20 %». Medido sobre los 679 con KID:
   es el **único** CONFIRMADO_COMPLETO con dos «en un NN %» en la frase. Con una fila del IBEX 35 TR, el
   extractor le publicaría beta 0,6 y alfa −5 contra un índice que no es el suyo. Arreglo: admitir la pieza
   «nombre + en un NN %» en `_PIEZA_PORCENTUAL`, con prueba sobre esta frase; es territorio del extractor y
   cabe en la fase 2 si Óscar lo aprueba. Si no, la fila del IBEX 35 TR **no debe entrar** hasta que esté.
2. **Clase cubierta «AH (EUR)».** `core/derivados._cobertura_divisa` busca «hedged», «H EUR», «(H)» y no
   reconoce el sufijo de Morgan Stanley. Son **2 clases** en el universo (`LU0266117927` US Advantage y
   `LU0712123511` Global Fixed Income Opportunities), las dos con el KID diciendo «clase de participaciones con
   cobertura cambiaria». Arreglo: el patrón `\bAH\b \(`, o mejor, que la cobertura se lea también del KID como
   ya se lee la política de reparto. Con una fila del S&P 500 TR y sin este arreglo, US Advantage publicaría
   un R² del 46 %. Mismo territorio y misma condición que el anterior.

Los dos son defectos de hoy, no del camino C, pero el camino C es lo que les daría cifras. Pido la
decisión aquí para no publicarlas.

## 5 · Filas propuestas para `config/indices.csv`

Una por índice y variante, nota «propuesta para Óscar, 07-11-2026». **No entran hasta que las marque**, y
**ninguna puede entrar antes de que `carga` indexe por (nombre, variante)**: hoy la del S&P 500 TR pisaría la
del S&P 500 NR y la del IBEX 35 PR pisaría la del TR (misma clave plegada).

| benchmark | variante | proxy | clase_de_serie | base | fondos | nota | equivalente_de |
|---|---|---|---|---|---|---|---|
| BME IBEX 35 | TR | `IBEXTR.INDX` | NIVEL_DE_INDICE | TOTAL_RETURN | 0 hoy (2 retirados por KID, 1 sin índice, 1 compuesto mal leído) | «Serie del índice en EODHD, EUR, desde 10-2011; TR/PR deriva 3,7-3,9 %/año; propuesta para Óscar, 07-11-2026» | `Ibex 35` |
| BME IBEX 35 | PR | `IBEX.INDX` | NIVEL_DE_INDICE | PRICE_RETURN | 0 (solo el ETF, fuera por §11) | «Serie del índice en EODHD, EUR, desde 09-1991; solo beta, R² y TE; propuesta para Óscar, 07-11-2026» | `Ibex 35` |
| EURO STOXX 50 | PR | `SX5E.INDX` | NIVEL_DE_INDICE | PRICE_RETURN | 1 (Intermoney) | «Serie del índice en EODHD, EUR, desde 12-1986; el fondo declara “Price”; solo beta, R² y TE; propuesta para Óscar, 07-11-2026» | |
| S&P 500 | TR | `SP500TR.INDX` | NIVEL_DE_INDICE | TOTAL_RETURN | 2 limpios (AB ×2) + MS AH si se arregla la cobertura | «Serie del índice en EODHD, USD convertida con el BCE, desde 01-1988; TR/PR deriva 1,2-1,6 %/año; propuesta para Óscar, 07-11-2026» | |
| S&P 500 Equal Weighted | TR | `SPXEWTR.INDX` | NIVEL_DE_INDICE | TOTAL_RETURN | 1 (MyInvestor) | «Serie del índice en EODHD, USD convertida con el BCE, desde 12-1989; TR/PR deriva 1,7-1,9 %/año; propuesta para Óscar, 07-11-2026» | |

Las dos del IBEX se proponen aunque hoy no midan a nadie: dejan el índice listo (EDM si §4.3 cambia; los
fondos que entren con ese índice) y cuestan una fila. Si Óscar prefiere solo lo que mide hoy, entran las tres
últimas. **No propongo** fila del IBEX 35 NR ni del EURO STOXX 50 NR por nivel de índice: no hay serie.

## 6 · Lo que no se pudo medir

- **IBEX 35 Net Return**: no está en EODHD (ni como `IBEXNR` ni con los códigos de BME). La retención que BME
  aplica al NR (y con ella el sesgo exacto de medir EDM contra el TR) no se ha medido; el 0,7 es una
  estimación con el 19 %.
- **Pendiente, no decidido:** los 3 fondos del EURO STOXX 50 NR siguen con su proxy ETF aprobado
  (`IE00B53L3W79`); pasarlos al nivel de índice `SX5T` sería otra decisión de Óscar, con nota en la fila.
- **El ISIN del IBEX Total Return** y la correspondencia símbolo-ISIN de los índices: `/search` por ISIN no
  devuelve índices y `/fundamentals` da 403 en nuestro plan. Por eso la opción B de §4.1 no se puede verificar.
- **Coste corriente de los fondos previstos** (para leer la rentabilidad activa de MyInvestor como coste): no
  se consultó la ficha de costes; no hacía falta para decidir.
- **La ficha en pantalla** no se ha mirado: fase 1 no toca la app. Los textos de §4.1 y §4.2 son propuestas.
- **La cobertura del universo más allá de IBEX/STOXX/S&P** (Nasdaq Biotechnology, DAX, S&P Global…): no era del
  encargo; constan 28 índices declarados sin proxy cuya familia existe en EODHD, en el scratchpad.

## 7 · Lo que tocaría la fase 2, si se aprueba

- `1-extractor`: `carga` por (nombre, variante) con prueba de que dos variantes conviven y de que el S&P 500
  NR sigue casando; `CLASES_DE_SERIE` con `NIVEL_DE_INDICE`; rama en `_serie_del_proxy` que pide
  la serie de `<símbolo>.INDX` leyendo `close` y no `adjusted_close`, toma la divisa de la lista de la bolsa y
  convierte con el BCE; las filas
  aprobadas (CRLF, notas entre comillas); los dos detectores de §4.5 si Óscar los aprueba; pasada sin red sobre
  el universo del camino C midiendo qué cambia y restaurando lo ajeno. Ninguna cifra publicada cambia hasta la
  pasada autorizada.
- `2-plataforma-datos`: `INDEX_LEVEL` en `series_class`, `source_series_id` en `benchmark` y en
  `relative_withdrawal`, traducción `NIVEL_DE_INDICE → INDEX_LEVEL`, mapper (líneas 1775-1800 y 2551-2561) con
  `instrument_id` ausente y `NOT_APPLICABLE` cuando la clase es nivel de índice.
- `3-BDB-ACTIVOS_app`: la nota de «Frente a su índice» para `INDEX_LEVEL` (§4.1) y para `return_basis =
  PRICE_RETURN` (§4.2); la frase «lo replica el activo…» solo cuando hay `instrument_id`. Con `diseno-pantalla`.
- Fuera de esta sesión: la §3 del método con `benchmark.series_class` en la identidad comparable (directora).

## Cómo se reproduce

Scripts de solo lectura en el scratchpad de la sesión (`eodhd/mide_indices.py`, `eodhd/preview_relativas.py`):
lista de la bolsa `INDX` y series `/eod` guardadas en JSON; derivas TR/PR a cierre de mes;
previsión con `core/metricas.relativas`, `fetchers/vl_fondos.serie` y `fetchers/cambios_bce.serie_en_euros`
a través de un cliente HTTP propio que no toca la caché del extractor. El universo, con
`core/indices.pliega` y `variante_de` sobre `data/funds`.
