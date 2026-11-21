# Criterio: nivel de índice o ETF cuando existen los dos

*07-11-2026 · sesión de trabajo «criterio índice/ETF» (Opus 5.5, esfuerzo alto), por encargo de la directora
tras la decisión 31. Solo lectura: nada de esto está en el código, en `config/indices.csv` ni en ninguna base.
Lo medido sale de `1-extractor/data/funds/*.json`, del catálogo y las series de la bolsa `INDX` de EODHD, de
las series `.EUFUND` y `.XETRA` del mismo proveedor y de los cambios y el €STR del BCE, con un cliente HTTP
propio que no toca `cache/http`. Las cifras de la §2 son una **previsión** con `core.metricas.relativas` tal
como está, no cifras publicadas. Scripts en el scratchpad de la sesión, fuera del repositorio.*

## Lo que hay que saber antes de leer

- **De las 19 filas con proxy instrumento, solo 3 tienen la serie del índice con su variante en EODHD:**
  EURO STOXX 50 NR (`SX5T`), S&P 500 NR (`SPXNTR`) y STOXX Europe 600 NR (`SXXR`, que el catálogo llama
  «STXE 600 NRT» y por eso no lo ve un filtro por «STOXX Europe 600»). Las otras 16 son MSCI (12 filas),
  Bloomberg de renta fija (2) y TOPIX TR (1), que no están, más una que no se puede verificar. Miden hoy a
  **6 fondos** con cifra de los **227** que tienen relativas contra un instrumento: el 2,6 %.
- **El ETF no es «el índice menos su coste».** Medido a cierre de mes: el iShares del EURO STOXX 50 **gana** a
  su índice NR 0,22-0,46 puntos al año y el Amundi del STOXX 600 **gana** al suyo 0,24-0,32, con un TER del 0,10
  y el 0,07 %. Un índice *net return* descuenta la retención máxima sobre el dividendo y un fondo UCITS
  irlandés o luxemburgués recupera parte por convenio: lo que el ETF saca a su índice es fiscalidad, no
  gestión. Solo el Vanguard del S&P 500 va por detrás de su NTR, 0,06-0,22 puntos. Así que **cambiar al
  nivel de índice no baja los alfas de forma homogénea**: en 4 de los 6 fondos los sube.
- **La diferencia que importa es de 0,0 a 0,5 puntos de alfa**, en el sentido que marque cada familia, y de
  nada en beta, R² y tracking error: los tres ETF explican su índice con un R² del 99,2 al 99,96 %. Es un
  orden de magnitud menos que la dispersión del alfa del mismo fondo entre ventanas (Eleva: −7,3 a un año,
  −1,9 a tres) y menos que el error de muestreo de un alfa a doce meses.
- **Recomiendo la opción B con la vigilancia de la C:** el proxy aprobado y en producción prevalece; el nivel
  de índice entra en las filas **nuevas** cuando no hay instrumento aprobado o cuando el que hay no pasa la
  comprobación; y las tres filas que tienen las dos series se **vigilan** una vez al año midiendo el ETF contra
  su índice, con un umbral que hoy ninguna roza. Cero retiradas, cero cifras cambiadas, una regla escrita y
  un script de lectura. El argumento de fondo no es la inercia: para quien selecciona fondos, la pregunta que
  responde el alfa contra un ETF es «¿habría hecho mejor el cliente con la alternativa pasiva que sí puede
  comprar?», y esa es la decisión que el asesor toma; el nivel de índice no se puede comprar.

## 1 · Las 19 filas, una a una

Fuente: `config/indices.csv` del 07-11, `data/funds` (fondos cuyo índice declarado resuelve a la fila con
`core.indices.proxy_de`), y el catálogo `/exchange-symbol-list/INDX` descargado hoy (1.681 series). «Con cifra»
son los fondos que hoy publican `riesgo.relativas` contra esa fila; «resuelven» incluye además los ETF (que no
reciben relativas, §11) y los fondos sin cifra por KID, divisa o serie. El TER es el de `costes.ter_pct` del
propio proxy en `data/funds`.

| # | Fila (variante) | Con cifra / resuelven | Proxy actual · clase · TER | Serie del índice en EODHD con esa variante |
|---|---|---:|---|---|
| 1 | MSCI Europe (NR) | 46 / 51 | Vanguard European Stock Index `IE0007987708` · VL · 0,12 % | **No hay** (EODHD no tiene MSCI) |
| 2 | MSCI World (NR) | 38 / 46 | Vanguard Global Stock Index `IE00B03HD191` · VL · 0,18 % | No hay |
| 3 | MSCI EM (NR) | 16 / 19 | Vanguard EM Stock Index `IE0031786696` · VL · 0,23 % | No hay |
| 4 | MSCI ACWI (NR) | 58 / 71 | iShares MSCI ACWI `IE00B6R52259` · precio · 0,20 % | No hay |
| 5 | MSCI AC Asia ex Japan (NR) | 12 / 13 | Amundi `LU1900068161` · precio · 0,50 % | No hay |
| 6 | MSCI Europe Small Cap (NR) | 8 / 9 | SPDR `IE00BKWQ0M75` · precio · 0,30 % | No hay |
| 7 | MSCI EM Latin America 10/40 (NR) | 6 / 7 | iShares `IE00B27YCK28` · precio · 0,20 % | No hay |
| 8 | MSCI EM Asia (NR) | 6 / 7 | iShares `IE00B5L8K969` · precio · 0,20 % | No hay |
| 9 | TOPIX (TR) | 5 / 8 | Amundi Japan Topix `LU1681037609` · precio · 0,20 % | **No con la variante verificable.** Hay `TOPX` (TOPIX, JPY, precio, desde 08-2011) y `TOPXDV` («Topix DV», JPY, desde 06-2003), que deriva +2,25 a +2,45 % al año sobre `TOPX`: lleva dividendos, pero el catálogo no dice si es bruta o neta |
| 10 | MSCI EMU (NR) | 8 / 9 | iShares Core MSCI EMU `IE00B53QG562` · precio · 0,12 % | No hay |
| 11 | MSCI AC Asia Pac ex Japan (NR) | 5 / 6 | Amundi `LU1900068328` · precio · 0,60 % | No hay |
| 12 | MSCI World/Health Care (NR) | 4 / 5 | Xtrackers `IE00BM67HK77` · precio · 0,25 % | No hay |
| 13 | Bloomberg Euro Corp (TR) | 3 / 5 | SPDR Bloomberg Euro Corporate `IE00B3T9LM79` · precio · 0,12 % | No hay (de Bloomberg, EODHD solo tiene los de materias primas) |
| 14 | **STOXX Europe 600 (NR)** | 3 / 4 | Amundi Core STOXX Europe 600 `LU0908500753` · precio · 0,07 % · serie `LYP6.XETRA` desde 09-2017 | **Sí: `SXXR`** «STXE 600 NRT», EUR, desde 31-12-1991, sin mes vacío; deriva +2,44/+2,58/+2,58 % al año sobre el precio `SXXP` a 1/3/5 años (el dividendo neto europeo) |
| 15 | Bloomberg Euro Agg Bond (TR) | 3 / 4 | iShares Euro Aggregate Bond Index `LU0836513423` · VL · 0,53 % | No hay |
| 16 | **S&P 500 (NR)** | 2 / 8 | Vanguard U.S. 500 Stock Index `IE0032126645` · VL · 0,10 % · desde 09-2002 | **Sí: `SPXNTR`** «S&P 500 Net TR», USD, desde 29-03-1996, sin mes vacío (`SP500NTR` es la misma serie desde 02-2015, deriva 0,00) |
| 17 | MSCI India (NR) | 4 / 5 | iShares MSCI India `IE00BZCQB185` · precio · 0,65 % | No hay |
| 18 | **EURO STOXX 50 (NR)** | 1 / 3 | iShares Core EURO STOXX 50 `IE00B53L3W79` · precio · 0,10 % · serie `SXRT.XETRA` desde 03-2010 | **Sí: `SX5T`** «ESTX 50 EUR NRt», EUR, desde 31-12-1986; **sin dato de 12-2012 a 02-2013** y **un día por detrás** del precio (última 05-11 contra 06-11); deriva +2,22/+2,36/+2,42 % sobre `SX5E` |
| 19 | MSCI EMU Small Cap (NR) | 2 / 3 | iShares MSCI EMU Small Cap `IE00B3VWMM18` · precio · 0,58 % | No hay |

Dos correcciones a lo que decía el encargo: la fila del EURO STOXX 50 NR mide hoy a **1 fondo** con cifra
(FON FINECO INVERSIÓN, `ES0137396000`), no a 3: los otros dos que resuelven a ella son los dos ETF de
iShares, que no reciben relativas. Y en la del S&P 500 NR, de 8 que resuelven solo 2 tienen cifra (las dos
clases de Fidelity): 3 son ETF, Capital Group tiene KID sin índice y FON FINECO INVERSIÓN AMÉRICA
(`ES0139113007`) **no tiene serie en EODHD**, así que no se puede medir contra nada.

Las derivas `SX5T`/`SX5E` que mido (2,2-2,4) no coinciden con las del informe del camino C (2,6-3,1): la mía es
log(NR/PR) entre cierres de mes a 1, 3 y 5 años exactos hasta octubre de 2026. Las dos dicen lo mismo —es la
NR— y no cambian nada de lo que sigue, pero conviene que quien escriba la nota de la fila use una sola.

## 2 · Lo medido donde existen las dos series

Método: `core.metricas.relativas` tal como está, rentabilidades mensuales a cierre de octubre de 2026, €STR
del BCE, todo en euros (el S&P convertido con `EXR D.USD.EUR.SP00.A`). La columna «ETF» reproduce **exactamente**
la cifra que hoy publica cada fondo en `data/funds`, lo que valida la previsión; la columna «índice» es lo que
publicaría si la fila cambiase de proxy. Alfa y rentabilidad activa en puntos anuales; R² y TE en %.

### 2.1 · El proxy contra su propio índice (coste + tracking + fiscalidad)

Deriva: log(ETF/índice) anualizado entre cierres de mes. Positivo = el ETF gana al índice.

| Fila | Proxy / índice | Deriva 1a | 3a | 5a | 10a | R² ETF~índice 1a/3a/5a | TE 1a/3a/5a |
|---|---|---:|---:|---:|---:|---|---|
| EURO STOXX 50 NR | `SXRT.XETRA` / `SX5T` | **+0,22** | **+0,46** | **+0,44** | +0,46 | 99,96 / 99,91 / 99,91 | 0,26 / 0,36 / 0,45 |
| STOXX Europe 600 NR | `LYP6.XETRA` / `SXXR` | **+0,25** | **+0,32** | **+0,24** | — (desde 2017) | 99,90 / 99,72 / 99,80 | 0,40 / 0,58 / 0,59 |
| S&P 500 NR | Vanguard `IE0032126645` / `SPXNTR` | −0,11 | −0,22 | −0,19 | −0,06 | 99,51 / 99,66 / 99,17 | 0,75 / 0,76 / 1,31 |

Lectura: los dos ETF europeos **ganan** a su índice neto más de lo que cuestan. Los índices NR de STOXX
descuentan la retención máxima de cada país sobre el dividendo; un UCITS irlandés recupera parte por
convenio, y la diferencia (0,3-0,5 puntos) más que paga un TER del 0,07-0,10 %. El Vanguard del S&P 500 va
por detrás de su NTR entre 0,06 y 0,22: el NTR de S&P descuenta un 30 % y un fondo irlandés paga el 15 %, pero
su TER del 0,10 y el ruido de la hora de cierre (TE del 0,75-1,3 % para un fondo índice, el triple que los
dos ETF europeos, porque el valor liquidativo en euros se fija con un cambio distinto del de las 14:15 del
BCE con que convertimos el índice) se lo comen.

### 2.2 · Los seis fondos, contra el proxy y contra el índice

| Fondo | Ventana | Beta ETF → índice | R² | Alfa de Jensen | Rent. activa | TE | IR |
|---|---|---|---|---|---|---|---|
| **FON FINECO INVERSIÓN** `ES0137396000` (EURO STOXX 50 NR) | 1a | 0,562 → 0,562 | 93,5 → 93,8 | +0,71 → **+0,83** | −3,37 → −3,15 | 6,52 → 6,50 | −0,52 → −0,48 |
| | 3a | 0,466 → 0,469 | 79,5 → 79,8 | −0,66 → **−0,48** | −8,48 → −8,00 | 7,05 → 6,98 | −1,20 → −1,15 |
| | 5a | 0,507 → 0,507 | 84,3 → 84,2 | +0,10 → **+0,32** | −4,43 → −3,99 | 8,04 → 8,04 | −0,55 → −0,50 |
| **Fidelity America E-Acc-EUR** `LU0115759606` (S&P 500 NR) | 1a | 0,367 → 0,381 | 16,7 → 18,0 | +4,22 → **+4,01** | −3,91 → −4,03 | 11,05 → 10,91 | −0,35 → −0,37 |
| | 3a | 0,770 → 0,769 | 56,3 → 57,3 | −7,13 → **−7,30** | −11,03 → −11,26 | 9,07 → 8,99 | −1,22 → −1,25 |
| | 5a | 0,699 → 0,717 | 56,7 → 58,1 | −2,63 → **−2,93** | −5,80 → −5,96 | 9,77 → 9,51 | −0,59 → −0,63 |
| **Fidelity US Equity A-Acc-EUR** `LU0275692696` (S&P 500 NR) | 1a | 1,239 → 1,223 | 83,8 → 81,7 | −11,63 → **−11,55** | −8,55 → −8,66 | 6,35 → 6,62 | −1,35 → −1,31 |
| | 3a | 0,945 → 0,935 | 77,7 → 77,4 | −9,22 → **−9,26** | −10,15 → −10,38 | 6,46 → 6,51 | −1,57 → −1,59 |
| | 5a | 0,752 → 0,764 | 71,9 → 72,1 | −4,86 → **−5,11** | −7,47 → −7,64 | 7,63 → 7,51 | −0,98 → −1,02 |
| **GVC Gaesco Europa** `ES0140643034` (STOXX 600 NR) | 1a | 1,057 → 1,041 | 87,5 → 86,8 | +2,13 → **+2,59** | +2,90 → +3,14 | 4,74 → 4,84 | +0,61 → +0,65 |
| | 3a | 1,076 → 1,092 | 73,1 → 72,3 | +1,46 → **+1,61** | +2,53 → +2,88 | 6,74 → 6,86 | +0,38 → +0,42 |
| | 5a | 1,284 → 1,305 | 76,0 → 76,2 | +1,60 → **+1,79** | +3,78 → +4,04 | 9,87 → 9,92 | +0,38 → +0,41 |
| **DNCA Value Europe B** `LU0284396289` (STOXX 600 NR) | 1a | 0,949 → 0,939 | 93,4 → 93,5 | +1,43 → **+1,79** | +0,72 → +0,96 | 3,02 → 3,03 | +0,24 → +0,32 |
| | 3a | 0,882 → 0,899 | 80,5 → 80,4 | +4,15 → **+4,22** | +2,49 → +2,84 | 4,61 → 4,58 | +0,54 → +0,62 |
| | 5a | 0,936 → 0,951 | 80,0 → 80,2 | +3,27 → **+3,40** | +2,78 → +3,04 | 6,02 → 5,97 | +0,46 → +0,51 |
| **Eleva European Selection A2** `LU1111642820` (STOXX 600 NR) | 1a | 1,146 → 1,130 | 83,9 → 83,4 | −7,33 → **−6,84** | −5,34 → −5,10 | 6,14 → 6,18 | −0,87 → −0,82 |
| | 3a | 1,074 → 1,098 | 85,7 → 86,0 | −1,94 → **−1,90** | −0,90 → −0,55 | 4,56 → 4,55 | −0,20 → −0,12 |
| | 5a | 1,015 → 1,032 | 91,0 → 91,3 | −1,05 → **−0,90** | −0,93 → −0,66 | 4,06 → 4,01 | −0,23 → −0,17 |

**En resumen, por fondo y ventana (18 pares):** el alfa cambia entre −0,31 y +0,49 puntos; sube en los 12 pares
europeos (mediana +0,17) y baja en 5 de los 6 americanos (mediana −0,21). La beta se mueve como mucho 0,024, el
R² como mucho 2,1 puntos (Fidelity US Equity a un año) y el tracking error 0,27. Ningún signo cambia, ningún
fondo pasa de «bate» a «no bate», y el orden de los tres fondos del STOXX 600 entre sí es el mismo contra las
dos series. Lo que sí cambia de forma sistemática es la rentabilidad activa, en lo que el ETF gana o pierde
contra su índice (§2.1), porque es una resta directa.

### 2.3 · Las acciones: S&P 500 NR por Vanguard

Las 86 acciones de la bolsa US publican solo beta y R² a 3 y 5 años (decisión 24), mensual, contra el valor
liquidativo del Vanguard en euros. Medidas seis contra `SPXNTR` en euros:

| Acción | Beta 3a / 5a por Vanguard | por `SPXNTR` | R² 3a / 5a por Vanguard | por `SPXNTR` |
|---|---|---|---|---|
| Eaton `ETN.US` | 1,359 / 1,219 | 1,336 / 1,221 | 33,8 / 39,0 | 33,3 / 38,0 |
| Stellantis `STLA.US` | 1,388 / 1,204 | 1,376 / 1,219 | 23,4 / 22,5 | 23,4 / 22,4 |
| Medtronic `MDT.US` | 0,257 / 0,426 | 0,288 / 0,467 | 1,9 / 7,0 | 2,4 / 8,1 |
| Linde `LIN.US` | 0,365 / 0,566 | 0,371 / 0,576 | 6,6 / 19,7 | 7,0 / 19,8 |
| Apple `AAPL.US` | 0,828 / 1,184 | 0,814 / 1,194 | 23,4 / 47,2 | 23,0 / 46,6 |
| JPMorgan `JPM.US` | 0,972 / 0,939 | 0,983 / 0,953 | 36,5 / 35,8 | 38,1 / 35,9 |

La beta se mueve 0,00-0,04 y el R² hasta 1,6 puntos: para una acción, que no publica alfa, el coste del
comparador es irrelevante por construcción (una deriva constante no cambia una pendiente) y la hora de
cierre tampoco se nota con rentabilidades mensuales. Las 202 acciones europeas van contra el Vanguard del
MSCI Europe y no tienen alternativa en EODHD. **No hay razón medida para tratar a las acciones distinto de los
fondos:** el criterio es de la fila, y la fila sirve a los dos.

## 3 · Las opciones, con sus consecuencias

Las tres parten de lo que ya está decidido y construido: `NIVEL_DE_INDICE` existe como clase de serie, el
contrato lleva `INDEX_LEVEL` y `source_series_id`, y la §3 del método pone `benchmark.series_class` en la
identidad comparable (decisión 23). Ninguna opción exige tocar eso. Lo que decide cada una es **qué fila se
cambia y qué regla se escribe para las que vengan.**

| | **A · Prevalece el nivel de índice** siempre que exista con la variante | **B · Prevalece el proxy aprobado**; el nivel de índice, para filas nuevas | **C · Criterio por diferencia medida** (umbral de deriva o de R² del ETF contra su índice) |
|---|---|---|---|
| Filas que cambian hoy | 3 (EURO STOXX 50 NR → `SX5T`, S&P 500 NR → `SPXNTR`, STOXX 600 NR → `SXXR`) | 0 | 0 con cualquier umbral razonable: las tres pasan con R² ≥ 99,2 % y deriva ≤ 0,46 |
| Fondos que cambian de cifra | 6 (más las 86 acciones US, en beta y R² a 3 y 5 años) | 0 | 0 hoy |
| De cuánto | Alfa −0,3 a +0,5 según familia (§2.2); beta ≤ 0,02; rentabilidad activa en la deriva del ETF | — | — |
| Qué dice la ficha | Para 6 fondos: «medido contra la serie del propio índice (EODHD: …), sin coste de réplica» y, en §3 del método, que su alfa no se ordena con el de los 221 medidos contra un instrumento | Lo de hoy: «lo replica el activo X». La frase de nivel de índice solo en IBEX, S&P 500 TR, S&P 500 EW y EURO STOXX 50 PR, que ya la tienen | Lo de B, más una nota en la fila con la última medición del proxy contra su índice |
| Qué hay que retirar (§10) | 6 `relative_withdrawal` con fecha e intervalo (las cifras de Fidelity y FON FINECO datan de la primera pasada con proxy, las del STOXX 600 del 04-11) y la nube | Nada | Nada hoy; lo de A cuando una fila salte el umbral |
| Qué toca en código | `indices.csv` (3 filas: proxy, clase, nota); pasada con red sobre 6 fondos y 86 acciones; comprobación de que `source_series_id` viaja en la retirada; nada en `core/indices.py` ni en el contrato | `indices.csv` solo en la cabecera o en `docs/`: la regla escrita. Nada más | Lo de B más un script de lectura que mida una vez al año el proxy contra su índice en las filas con las dos series, y el umbral en el método |
| Comparabilidad entre fondos | Tres clases de serie conviven igual (12 filas MSCI siguen con instrumento); la §3 ya separa VL de precio de mercado desde el primer día, así que no hay homogeneidad que ganar: solo cambian 6 de 227 | Dos clases de instrumento conviven como hoy, más el nivel de índice en las filas que nacen sin instrumento | Igual que B |
| Dependencia | Tres filas más pendientes de la bolsa `INDX` de EODHD, que hoy enseña un hueco (`SX5T` 12-2012..02-2013) y un día de retraso | Igual que hoy: 5 filas de nivel de índice ya dependen de ella | Igual que B |
| Riesgo que no se ve a primera vista | El alfa contra un índice NR **sube** para todo fondo UCITS que recupere retención: la ventaja fiscal pasa a leerse como gestión. Contra el ETF, que la recupera igual, se neutraliza | Un ETF que un día se degrade (cambio de índice, cierre, muestreo peor) seguiría midiendo sin que nadie lo note | El umbral hay que elegirlo y medirlo; sin el script es papel |

### Lo que propongo: B con la vigilancia de C

**Regla general, para las 19 filas y las que vengan.** El comparador de una fila se elige al aprobarla, en
este orden, y no se cambia después porque aparezca otra serie:

1. **Si existe un instrumento aprobado y en producción, prevalece.** Es la alternativa que el cliente puede
   comprar, lleva la misma fiscalidad del dividendo que el fondo medido y su alfa responde a la pregunta del
   selector. Condición medible: R² contra su índice ≥ 99 % y deriva anual contra él dentro de ±0,5 puntos,
   cuando el índice exista en EODHD para comprobarlo (hoy, tres filas; las tres pasan).
2. **Si no hay instrumento aprobado, entra el nivel de índice** con la variante declarada, verificada por su
   deriva contra la de precio, sin mes vacío en los últimos cinco años y con divisa en el catálogo. Es lo que
   ya pasó con las cinco filas del 07-11, y lo que pasará con las que no tengan fondo índice ni ETF decente.
3. **Si el instrumento falla la condición del punto 1 en la medición anual**, la fila cambia al nivel de índice
   si lo hay, con retirada fechada (§10) de los fondos que midiese, o se queda sin comparador si no lo hay.

**Consecuencias.** Hoy, ninguna cifra cambia y nada se retira. Óscar aprueba filas nuevas con un criterio
escrito que no depende de él recordar la decisión 31. La §3 sigue como está: la identidad comparable ya lleva
la clase de serie, y lo medido dice que esa separación es prudente pero no urgente (≤ 0,5 puntos, sin cambio
de signo ni de orden). Si Óscar prefiere **A** por coherencia regulatoria —el KID nombra el índice, no un
ETF—, la cuenta es la de la tabla: 3 filas, 6 fondos, 6 retiradas y una pasada, y hay que aceptar que los alfas
europeos **suben** 0,1-0,5 por la fiscalidad y no por la gestión. No la recomiendo por eso último, pero no es
una opción mala: es un comparador legítimo con una consecuencia que hay que explicar en la ficha.

**Acciones.** El mismo criterio. La fila del S&P 500 NR sigue con Vanguard para las 86 acciones US; medido en
seis, la beta no se mueve más de 0,04. El día que la fila cambiase (punto 3), cambiaría para fondos y
acciones a la vez, porque es una sola fila.

## 4 · Límites

- **Lo que no está en EODHD** gobierna el alcance: sin MSCI, FTSE, Russell, Bloomberg de renta fija, ICE BofA,
  JPM ni iBoxx, 16 de las 19 filas y 221 de los 227 fondos con relativas contra instrumento **no tienen
  alternativa**. Cualquier criterio es, en la práctica, para 3 filas de hoy y para las que nazcan de familias
  STOXX, S&P, BME o Nikkei.
- **`SX5T` tiene un hueco** (12-2012 a 02-2013, hoy fuera de las tres ventanas) y **va un día por detrás** de las
  demás series de STOXX (última 05-11 frente a 06-11). Con rentabilidades mensuales a cierre de mes el retraso
  solo importa si el último día hábil del mes falta en el momento de la pasada; conviene que la rama de nivel
  de índice lo compruebe antes de dar un mes por cerrado.
- **La hora de cierre.** Un índice americano cierra a las 22:00 CET y se convierte con el cambio del BCE de las
  14:15; un fondo índice irlandés fija su valor liquidativo en euros con otro cambio y a otra hora; un ETF en
  XETRA cierra a las 17:30. Es lo que hace que el Vanguard tenga un TE del 0,75-1,3 % contra su propio índice
  cuando los dos ETF europeos tienen 0,3-0,6. Con rentabilidades mensuales el efecto en beta es ≤ 0,02
  (medido), pero contra un índice americano **el comparador «limpio» es el que más ruido de hora lleva**, no
  el que menos.
- **El nivel de índice no tiene coste y el fondo sí.** Contra el índice, el alfa mide gestión menos el coste
  corriente del fondo **menos la retención que el índice supone y el fondo no paga**; contra un ETF mide
  gestión menos la *diferencia* de costes, con la fiscalidad neutralizada. Las dos son cifras honestas con
  supuestos distintos, y por eso la §3 las separa. Lo que no es honesto es llamar «sin coste de réplica» a un
  comparador que para un fondo europeo resulta más generoso que el ETF.
- **`TOPXDV`** podría ser el TOPIX con dividendos, pero no sé si bruto o neto y el catálogo no lo dice. La fila
  TOPIX TR se queda con el Amundi hasta que alguien lo verifique con la metodología de JPX delante.
- **Dos derivas distintas para `SX5T`/`SX5E`** entre este informe y el del camino C (2,2-2,4 contra 2,6-3,1).
  No afecta a la conclusión, pero quien escriba la nota de una fila debe elegir un método y citarlo.
- **No se ha mirado la ficha en pantalla** ni se ha tocado la app: los textos de la §3 son propuestas.

## Cómo se reproduce

Scripts de solo lectura en el scratchpad de la sesión: `eodhd/inventario.py` (fondos por fila, desde
`data/funds` con `core.indices.proxy_de`), `eodhd/catalogo.py` (descarga del catálogo `INDX` y búsqueda por
familias), `eodhd/preview_relativas.py` (las tres familias: series, derivas, ETF contra índice y fondos contra
los dos comparadores con `core.metricas.relativas`), `eodhd/variantes.py` (verificación de variante por deriva
para STOXX 600 y TOPIX) y `eodhd/acciones.py` (seis acciones US). Caché HTTP propia en el scratchpad; el token
se lee de `config/secrets.json` y no aparece en ningún fichero de salida.
