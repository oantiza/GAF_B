# Proxies a aprobar · paso 2, camino A

*06-11-2026 · sesión de Code (Opus 5.5). Cada fila es un proxy que Óscar aprueba o rechaza, con los
criterios de `1-extractor/core/indices.py` —acumulación, sin cubrir, variante correcta, réplica
física y tamaño— y el criterio por tipo de candidato de la «Revisión del plan de datos». Nada de
esto está en `config/indices.csv` todavía: entra cuando él lo marque.*

## Lo que cambia respecto al traspaso

- **Son unos 16 fondos, no 66.** El traspaso calculaba pasar de 289 a unos 355 fondos con
  relativas. Al contar solo los que se pueden medir de verdad —clase sin cubrir, métricas en euros
  y la variante que declaran—, lo limpio da **9 fondos**, **16** con la equivalencia de renta fija
  y **20** con el S&P 500.
- **La verificación con justETF no sirve.** La de las 20:47 acabó a las 21:09 y dejó
  `reports/_verifica_proxies.json`. Trae solo el nombre de cada ETF, y además mal: da como
  cubierto el EURO STOXX 50 en euros. justETF cambió su página y `justetf_scraping` ya no lee
  esos campos. Los datos de abajo salen de FIRDS (ESMA, `cache/firds/firds.sqlite`) y de las
  series de EODHD. La ficha de ETF de EODHD (`/fundamentals`) no está en nuestro plan: da 403.
- **El CFI no basta para saber si un ETF acumula.** Tres clases que su nombre llama de
  acumulación figuran en FIRDS como de reparto (cuarta letra `I`): `IE00BYXYYK40`,
  `IE00BQ70R696` e `IE00BP3QZB59`. La comprobación buena es la que ya hace el sistema sobre la
  serie del proxy (`riesgo.historial_precios.politica`) en cuanto entra en el universo.
- **El camino B no se puede saltar del todo.** En 4 de los 6 fondos que según Morningstar
  declaran el JPM GBI-EM Global Diversified (`LU0910636546`, `LU0910636892`, `LU1670631016`,
  `LU1670631289`), el KID declara un índice **compuesto** («50 % GBI-EM + 25 % EMBI…», «un
  tercio por…»). Morningstar se queda con una pieza. Esos fondos no reciben proxy.
- **Casi todos los «no coincide» del KID con JPM eran falsos**: la comparación buscaba «JPM» y
  el KID escribe «J.P. Morgan». Medido otra vez: 4 de los 6 KID del EMBI nombran el índice.
- **Lo que no he podido comprobar** —réplica física, tamaño y coste corriente de cada ETF— va
  como «sin verificar». El coste corriente del proxy entra entero en el alfa del fondo.

## 1 · Caso limpio: mismo índice y variante, ETF de acumulación

| Índice declarado | Fondos medibles | Proxy | Comprobado | Recomendación |
|---|---|---|---|---|
| MSCI India NR | 4 (el KID nombra el índice en los 4) | iShares MSCI India UCITS ETF USD (Acc), `IE00BZCQB185` | FIRDS: clase Acc, CFI de acumulación (`CEOGES`). EODHD: `NDIA.AS` en euros desde 11-2021, 61 meses. No está en el universo: hay que darlo de alta. Réplica, tamaño y coste sin verificar | **Sí.** La ventana de 5 años va justa. Fuera: GR (2), 10/40 (3) e IMI (1), que son otro índice o variante |
| EURO STOXX 50 NR | 3 (1 KID nombra la marca, 2 sin KID) | iShares Core EURO STOXX 50 (Acc), `IE00B53L3W79` | Ya está en el universo (`SXRT.XETRA`, métricas en euros). FIRDS: acumulación (`CEOGMS`). EODHD: serie desde 2014 | **Sí.** La alternativa de UBS (`LU0950668367`) solo tiene 5 meses de serie en EODHD |
| MSCI EMU Small Cap (NR) | 2 | iShares MSCI EMU Small Cap (Acc), `IE00B3VWMM18` | FIRDS: acumulación (`CEOGES`). EODHD: `SXRJ.XETRA` desde 11-2009. Hay que darlo de alta. Réplica y coste sin verificar | **Sí** |

## 2 · Equivalente de otro proveedor en renta fija amplia

| Índice declarado | Fondos medibles | Proxy | Comprobado | Recomendación |
|---|---|---|---|---|
| ICE BofA Euro Corporate TR | 7 (6 KID nombran el índice, 1 la marca) | **La fila que ya existe** de Bloomberg Euro Corp TR (SPDR `IE00B3T9LM79`, ya en el universo), con `equivalente_de = ICE BofA Euro Corporate` | Sin instrumento nuevo. Los dos son índices amplios de crédito en euros con grado de inversión | **Sí, pero cuando la ficha lo diga.** Hasta que el contrato y la app lean `equivalente_de`, la ficha diría «contra Bloomberg Euro Corp» sin avisar de que no es el índice del fondo |
| BofA ML 1-3 Euro Government | 1 | SPDR Bloomberg 1-3 Year Euro Government, `IE00B6YX5F63` | Reparte: iría con cierre ajustado, como las filas de LatAm y Euro Corp. Serie desde 2011. Hay que darlo de alta | **Esperar:** un alta por un solo fondo |

## 3 · Mismo índice, otra variante

La diferencia es la retención sobre el dividendo, unas décimas al año (aproximado), y va entera
al alfa. Solo vale si consta en la nota.

| Índice declarado | Fondos medibles | Proxy | Comprobado | Recomendación |
|---|---|---|---|---|
| S&P 500 TR («(1970)» es el año base) | 4 (3 KID nombran el índice) | El proxy NR que ya existe (Vanguard `IE0032126645`) | Desde `0c52fd4` ya casa por nombre, pero pide TR y la fila es NR. Admitirlo pide un cambio pequeño: que una fila acepte otra variante solo si lo declara, con nota | **Sí**, con el cambio de código y la nota |
| NASDAQ Biotechnology TR | 2 | Invesco Nasdaq Biotech UCITS ETF, `IE00BQ70R696` | Serie desde 2014. El nombre dice Acc y el CFI, reparto. Réplica sin verificar; si es sintético, choca con el criterio de réplica física | **Esperar** a leer su KID |
| Russell 1000 Value y Growth | 5 (2 TR, 3 NR) | iShares `US4642875987`, Vanguard `US92206C6802` | ETF de EE. UU., de reparto, en dólares. Darlos de alta los pondría en el Buscador como si se pudieran comprar, y no son UCITS | **No por ahora.** Antes hace falta una marca de «solo proxy» en el universo |

## 4 · No valen para el alfa

Otra construcción u otro universo cambian lo que se mide.

- **MSCI China 10/40** (4), **India 10/40** (3), **Brazil 10/40** (3): los ETF replican el índice
  sin el tope por emisor.
- **MSCI Europe Value y World Value** (6): según el traspaso, los ETF replican «Value Exposure
  Select» o «Enhanced Value», no el Value clásico.
- **FTSE Gold Mines** (3 medibles): los ETF siguen otros índices de mineras.
- **Euro Aggregate 1-3** (6): el agregado lleva corporativos y los candidatos son solo de deuda
  pública.
- **MSCI ACWI Financials** (4): el candidato es de MSCI World, sin emergentes.
- **JPM GBI-EM Global Diversified** (6): 4 son compuestos según su KID.
- **FTSE World Europe ex UK** (2) con FTSE Developed Europe ex UK: familias distintas de FTSE.
  Dudoso; se puede medir la correlación de las dos series antes de decidir.

## 5 · Fuera del camino A

- **IBEX 35** (PR 1, TR 3, NR 1) y **EURO STOXX 50 Price** (1): camino C, con la serie del
  índice de EODHD (`IBEX`, `IBEXTR`), cada fondo contra la variante que declara.
- **JPM EMBI Global Diversified**: de 7 fondos, 5 son clases cubiertas. Quedan 2, y hay que
  comprobar en el KID de cada candidato que es «Diversified» y no «Core». Esperar.
- **«MSCI All Countries World (NTR)»** (1) es MSCI ACWI con otro nombre: lo resuelve un alias de
  nombre, no un proxy.

## Lo que ya está hecho, sin aprobación

Commit `0c52fd4` en `1-extractor`, con las 787 pruebas en verde:

- **Normalización** en `indices.pliega` y `variante_de`: lee «Net TR», «Net Total Return»,
  «(NTR)», «Gross», «Price» al final, «Index», «in EUR» y el año base entre paréntesis. Da proxy
  a **7 fondos más** cuyo nombre ya significaba su fila; ninguno pierde ni cambia de proxy.
- **Columna `equivalente_de`** en `config/indices.csv`: la fila es la del índice que de verdad se
  mide, y el resultado escribe aparte el declarado, en `riesgo.relativas.equivalente_de`. No la
  usa ninguna fila. La plataforma y la app no la leen todavía.
- **De paso:** seis notas de `indices.csv` llevaban una coma sin comillas que partía la fila.
  Corregido sin cambiar ningún valor, con una prueba que lo vigila.

Nada de esto cambia una cifra publicada hasta la próxima pasada del extractor.

## Lo que decide Óscar

- [ ] MSCI India NR → `IE00BZCQB185`, con su alta en el universo
- [ ] EURO STOXX 50 NR → `IE00B53L3W79`
- [ ] MSCI EMU Small Cap → `IE00B3VWMM18`, con su alta
- [x] ICE BofA Euro Corporate como equivalente de la fila de Bloomberg Euro Corp, activado cuando
      la ficha lo diga (contrato y app en el mismo cambio). **Hecho el 08-11-2026:** mide a 5 fondos, no a
      7. De los 8 que lo declaran, 2 están retirados por KID compuesto (Invesco y Carmignac Credit) y el
      BlackRock A1 reparte, así que no tiene cifras propias. No hay serie del ICE BofA con que contrastar la
      equivalencia: lo medible es que el R² de los cinco (88-97 %) cae en el rango de los que declaran el
      Bloomberg de verdad (92-97 %).
- [x] ~~S&P 500 TR contra el proxy NR, con nota, y el cambio de código que lo permite~~ **Superado el
      07-11-2026** por el camino C (decisión 28, `e99711c` del extractor): la fila `S&P 500,TR,SP500TR.INDX`
      mide a los dos AB Select US Equity contra la serie del propio índice en su variante exacta, Morgan
      Stanley AH (EUR) queda fuera por clase cubierta (decisión 27) y el SPDR S&P 500 por ETF (decisión 26).
      Comprobado en `export/fondos.ndjson` el 08-11-2026. El cambio de código que admitiría otra variante
      declarada **no se construye**: medir un TR contra un proxy NR cuando existe la serie TR sería un paso atrás

## Cómo se reproduce

Scripts de solo lectura en el scratchpad de la sesión (fuera del repositorio): FIRDS por ISIN con
`esma_firds.ficha`; serie mensual de EODHD con `/search` y `/eod`; fondos por índice y KID con la
lógica de `1-extractor/reports/_kid_indice.py`.
