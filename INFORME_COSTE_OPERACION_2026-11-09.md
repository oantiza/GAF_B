# Coste de operación: por qué difiere el proveedor (medición para la decisión 60)

9 de noviembre de 2026. Solo lectura: no se ha cambiado código ni escrito en ninguna base ni en la nube. Datos del emisor, **uso interno
para el desarrollo** (decisión 53).

## 0. Resumen

1. **El proveedor no se equivoca. Lo que falla es nuestra lectura.** Morningstar entrega dos cifras: `TransactionFeeEstimated` (ex ante)
   y `TransactionFeeActual` (ex post). El extractor coge primero la *Actual* y la guarda como `costes.mifid_emt_exante.transaccion_pct`.
2. **Comprobado en 21 de 21 ficheros EMT:** la cifra del proveedor coincide con el `08070` del emisor (costes de operación **ex post**, últimos
   12 meses), no con el `07130` (**ex ante**). La *Estimated* de Morningstar coincide con el `07130` en 23 de 23, como mucho a 0,05 pb.
3. **Las dos negativas son ex post** (−0,028 % y −0,003 %). Sus cifras ex ante son positivas: 0,089 % y 0,004 %.
4. **La diferencia es de definición** (cuánto costó el último año frente a cuánto se espera que cueste), no de redondeo, ni de fecha, ni un error del proveedor.
   La fecha igual (30-06-2026) lo escondía: en el ex post es el final del periodo, y en el ex ante, la fecha de referencia.
5. **El KID mide lo mismo que el `07130`**: lo redondea a dos decimales en 8 de 8. El ex post no le cuadra en los 6 en que se distinguen.
6. **En los 15 sin KID:** el cambio va de −14,8 a +3,6 pb. Dos pasan de «sin cifra» a tenerla. Solo uno cambia de verdad: `IE000DR59CI3`, cuyo total
   pasa de 0,73 % a 0,58 %.
7. **El fallo afecta a todo el catálogo, no solo a los 15:** 105 fichas publican el coste de operación del proveedor, y en 70 es la cifra ex post. Las mayores
   diferencias son de fondos (hasta 83 pb).
8. **Recomendación:** corregir la lectura en el extractor (*Estimated* primero) y dejar el EMT como comprobación, no como sustituto.
   Así la excepción a la 52 ya no hace falta y no se cruza con la 53 en el PDF de costes.
9. Si mantienes la 60 tal como está, el orden que procede es KID > EMT `07130` > proveedor ex ante. **Nunca el ex post.**
10. **Decisión tuya:** reformular la 60 (§3, opción A) o construirla como está, sobre la lectura corregida (opción C).

## 1. Lo medido

### Fuentes

| Qué | Dónde | Huella |
|---|---|---|
| EMT de iShares (V4, generado el 30-10-2026 09:05) | carpeta de notas `emt-eet-medicion-09-11-2026/blackrock-emt-v4.xlsx`, hoja `Data` | `95c91a2e…f8c` |
| EMT de Vanguard (V4.2, generado el 01-10-2026; las fechas vienen como número de serie de Excel: 46265 = 31-08-2026) | `…/vanguard-emt-v42.xlsx`, hoja `Sheet1` | `5d3981ac…4b4` |
| EMT de Invesco (CSV) | **No se conserva en la carpeta.** El `07130` y su fecha se toman de `medicion-por-isin.json` (campos `tc` y `fec`) de la sesión de medición, y el `08070` queda como no disponible | `5088e5ff…407` |
| Definiciones FinDatEx | `…/findatex-emt-v42-definiciones.xlsx` (la hoja se llama «EMT V4.1»: la versión del nombre del fichero no está comprobada) | — |
| Respuesta en bruto del proveedor | `1-extractor/cache/raw_morningstar_lt/{ISIN}/Mifid.json`, del 08-11 a las 23:07-23:12 | — |
| Ficha canónica | `1-extractor/export/fondos.ndjson`, 1.316 fichas, generado el 08-11 a las 22:15 UTC, copiado al empezar | `c088fa9b…94c5` (igual al del `manifest.json`) |
| Lectura | `fetchers/morningstar_lt.py::_mapea_mifid` (línea 813, último commit `87cd6b2`) | — |
| Escritura en la base | `2-plataforma-datos/src/ingestion/baseNueva/mapper.ts`, línea 1239 | — |

**El emulador de la base nueva (127.0.0.1:8092) no estaba arrancado, y no se ha arrancado.** Lo que «publica hoy la base» sale de aplicar al canónico la regla del
mapper: el KID si tiene `url`, `sha256` y cifra; si no, el proveedor si es ≥ 0; si no, nada. Coincide con lo que dice el contrato (`minimum: 0`).
**No se ha leído en ningún documento de la base.**

Los scripts y las salidas intermedias están en el scratchpad de esta sesión
(`C:\Users\oanti\AppData\Local\Temp\claude\dfba910fcae1a72b\cc690180-6bb1-4dd2-bd9a-8cfe0828f919\scratchpad\coste\`): `emt.py`, `canon.py`, `tabla.py`,
`alcance.py` y `kidcheck.py`. Leen los ficheros con la biblioteca estándar de Python, con `-I`.

### Cómo llega la cifra del proveedor a la ficha (código leído)

`_mapea_mifid` recorre cinco pares `(destino, Actual, Estimated)` y escribe `v = Actual`, y solo si falta, `Estimated`:

```python
("transaccion_pct", "TransactionFeeActual", "TransactionFeeEstimated"),
...
v = _num(m.get(k_actual))
if v is None:
    v = _num(m.get(k_estimado))
```

La fecha de `costes.mifid_emt_exante.fecha` se toma de `OngoingCostActualDate`. La procedencia de la ficha dice `morningstar_lt:Mifid` y nada más:
no queda escrito cuál de las dos se cogió.

### Tabla por ISIN: los 23 con EMT

Cifras en por ciento anual sobre el patrimonio. «pb» son puntos básicos. El oro físico (`IE00B4ND3602`) queda fuera, como en el informe EMT.

| ISIN | Emisor · tipo | Proveedor en la ficha (fecha) | EMT 07130 ex ante (fecha 07160) | EMT 08070 ex post (periodo) | KID (fecha) | Morningstar «Estimated» (fecha) | Publica hoy la base | Proveedor − 07130 (pb) |
|---|---|---|---|---|---|---|---|---:|
| `DE000A0F5UJ7` | ishares · etf | 0,04633 % (2026-06-30) | 0,03747 % (2026-06-30) | 0,04633 % (2025-07-01 a 2026-06-30) | sin KID | 0,03747 % (2026-06-30) | proveedor 0,04633 % | +0,9 |
| `IE000DR59CI3` | ishares · etf | 0,22607 % (2026-06-30) | 0,07829 % (2026-06-30) | 0,22607 % (2025-07-01 a 2026-06-30) | sin KID | 0,07829 % (2026-06-30) | proveedor 0,22607 % | +14,8 |
| `IE000X59ZHE2` | ishares · etf | −0,02848 % **negativa** (2026-06-30) | 0,08904 % (2026-06-30) | −0,02848 % (2025-07-01 a 2026-06-30) | sin KID | 0,08904 % (2026-06-30) | nada | −11,8 |
| `IE00B0M62Q58` | ishares · etf | 0,00898 % (2026-06-30) | 0,00159 % (2026-06-30) | 0,00898 % (2025-07-01 a 2026-06-30) | sin KID | 0,00159 % (2026-06-30) | proveedor 0,00898 % | +0,7 |
| `IE00B27YCK28` | ishares · etf | 0,01300 % (2026-06-30) | 0,02791 % (2026-06-30) | 0,01259 % (2025-07-01 a 2026-06-30) | sin KID | 0,02800 % (2026-06-30) | proveedor 0,01300 % | −1,5 |
| `IE00B3VWMM18` | ishares · etf | 0,00800 % (2026-06-30) | 0,02843 % (2026-06-30) | 0,00798 % (2025-07-01 a 2026-06-30) | sin KID | 0,02800 % (2026-06-30) | proveedor 0,00800 % | −2,0 |
| `IE00B4L5Y983` | ishares · etf | 0,00263 % (2026-06-30) | 0,00161 % (2026-06-30) | 0,00263 % (2025-07-01 a 2026-06-30) | sin KID | 0,00161 % (2026-06-30) | proveedor 0,00263 % | +0,1 |
| `IE00B53L3W79` | ishares · etf | 0,07566 % (2026-06-30) | 0,05385 % (2026-06-30) | 0,07566 % (2025-07-01 a 2026-06-30) | sin KID | 0,05385 % (2026-06-30) | proveedor 0,07566 % | +2,2 |
| `IE00B53QG562` | ishares · etf | 0,01800 % (2026-06-30) | 0,01404 % (2026-06-30) | 0,01845 % (2025-07-01 a 2026-06-30) | sin KID | 0,01400 % (2026-06-30) | proveedor 0,01800 % | +0,4 |
| `IE00B5BMR087` | ishares · etf | 0,00344 % (2026-06-30) | 0,00196 % (2026-06-30) | 0,00344 % (2025-07-01 a 2026-06-30) | sin KID | 0,00196 % (2026-06-30) | proveedor 0,00344 % | +0,1 |
| `IE00B5L8K969` | ishares · etf | 0,03500 % (2026-06-30) | 0,07058 % (2026-06-30) | 0,03549 % (2025-07-01 a 2026-06-30) | sin KID | 0,07100 % (2026-06-30) | proveedor 0,03500 % | −3,6 |
| `IE00B6R52259` | ishares · etf | −0,00328 % **negativa** (2026-06-30) | 0,00390 % (2026-06-30) | −0,00328 % (2025-07-01 a 2026-06-30) | sin KID | 0,00390 % (2026-06-30) | nada | −0,7 |
| `IE00BDBRDM35` | ishares · etf | 0,02374 % (2026-06-30) | 0,00473 % (2026-06-30) | 0,02374 % (2025-07-01 a 2026-06-30) | sin KID | 0,00473 % (2026-06-30) | proveedor 0,02374 % | +1,9 |
| `IE00BZCQB185` | ishares · etf | 0,05000 % (2026-06-30) | 0,03249 % (2026-06-30) | 0,04988 % (2025-07-01 a 2026-06-30) | sin KID | 0,03200 % (2026-06-30) | proveedor 0,05000 % | +1,8 |
| `IE00B3XXRP09` | vanguard · etf | 0,00100 % (2026-08-31) | 0,00108 % (2026-08-31) | 0,00101 % (2025-09-01 a 2026-08-31) | sin KID | 0,00110 % (2026-08-31) | proveedor 0,00100 % | −0,0 |
| `IE00B3Q19T94` | invesco · etf | 0,00000 % (2026-03-31) | 0,00000 % (2025-12-31)¹ | no disponible | 0,00 % (2026-09-30) | 0,00000 % (2026-03-31) | KID 0,00 % | 0,0 |
| `IE00B3YCGJ38` | invesco · etf | 0,00000 % (2026-03-31) | 0,00000 % (2026-08-12)¹ | no disponible | 0,00 % (2026-08-21) | 0,00000 % (2026-08-12) | KID 0,00 % | 0,0 |
| `IE0007987708` | vanguard · fondo | 0,08420 % (2026-08-31) | 0,05357 % (2026-08-31) | 0,08421 % (2025-09-01 a 2026-08-31) | 0,05 % (2026-09-29) | 0,05360 % (2026-08-31) | KID 0,05 % | +3,1 |
| `IE0031786696` | vanguard · fondo | 0,03640 % (2026-08-31) | 0,06200 % (2026-08-31) | 0,03640 % (2025-09-01 a 2026-08-31) | 0,06 % (2026-09-29) | 0,06200 % (2026-08-31) | KID 0,06 % | −2,6 |
| `IE0032126645` | vanguard · fondo | 0,01230 % (2026-08-31) | 0,00930 % (2026-08-31) | 0,01225 % (2025-09-01 a 2026-08-31) | 0,01 % (2026-09-29) | 0,00930 % (2026-08-31) | KID 0,01 % | +0,3 |
| `IE00B03HCZ61` | vanguard · fondo | 0,01160 % (2026-08-31) | 0,00842 % (2026-08-31) | 0,01162 % (2025-09-01 a 2026-08-31) | 0,01 % (2026-09-29) | 0,00840 % (2026-08-31) | KID 0,01 % | +0,3 |
| `IE00B03HD191` | vanguard · fondo | 0,01160 % (2026-08-31) | 0,00842 % (2026-08-31) | 0,01162 % (2025-09-01 a 2026-08-31) | 0,01 % (2026-09-29) | 0,00840 % (2026-08-31) | KID 0,01 % | +0,3 |
| `IE00B18GC888` | vanguard · fondo | 0,05530 % (2026-08-31) | 0,08777 % (2026-08-31) | 0,05534 % (2025-09-01 a 2026-08-31) | 0,09 % (2026-09-29) | 0,08780 % (2026-08-31) | KID 0,09 % | −3,2 |

¹ De `medicion-por-isin.json`. El CSV de Invesco no está en la carpeta y no se ha podido releer.

Procedencia en la ficha, igual en los 23: `costes.mifid_emt_exante.transaccion_pct` ← `morningstar_lt:Mifid`. En los 8 con KID:
`costes.kid.transaccion_pct` ← `kid_gestora:deutsche_bank_es` en los seis de Vanguard, y ← `kid_gestora:invesco` en los dos de Invesco.

### Las tres comprobaciones que deciden la causa

| Comprobación | Resultado |
|---|---|
| Proveedor (`TransactionFeeActual`) frente a EMT `08070` ex post | **Igual en 21 de 21**, como mucho a 0,05 pb: Morningstar redondea la cifra del emisor a entre tres y cinco decimales del por ciento |
| Morningstar `TransactionFeeEstimated` frente a EMT `07130` ex ante | **Igual en 23 de 23**, como mucho a 0,05 pb (el mismo redondeo) |
| KID frente a `07130` redondeado a dos decimales | **Igual en 8 de 8.** Frente al ex post no cuadra en ninguno de los 6 en que las dos cifras se distinguen a dos decimales (por ejemplo, `IE0007987708`: KID 0,05, ex ante 0,0536, ex post 0,0842) |

**Los «3 de 23 que coinciden»** del informe EMT son los dos Invesco, sintéticos (cero en las cuatro cifras), y `IE00B3XXRP09`, donde el ex post y el ex ante casi
coinciden (0,00101 % frente a 0,00108 %). Coinciden por casualidad: no es que ahí se lea bien.

## 2. La causa

### Qué mide cada cifra

| Cifra | Definición (FinDatEx, hoja de definiciones) | Lo que se sabe de cómo se calcula |
|---|---|---|
| EMT `07130` *Transaction Costs Ex Ante* | Porcentaje del patrimonio, en términos anuales; «costs within the products». La fecha es la `07160`, que la plantilla avisa que **no** es la de generación ni la general | Es la cifra de PRIIPs que va al KID. Que en un UCITS sea la media de unos tres años con el método del precio de llegada es **de memoria, sin contrastar con el reglamento** |
| EMT `08070` *Transaction Costs Ex Post* | La misma unidad, aplicada al periodo `08090`–`08100` (aquí, 12 meses) | Lo que costó de verdad ese año. Puede salir negativo: con el precio de llegada, un deslizamiento favorable resta |
| KID, fila «Costes de operación» | — | En la muestra, el `07130` redondeado a dos decimales (8 de 8) |
| Proveedor, en nuestra ficha | La *Actual* de Morningstar, que es el `08070` | La etiqueta `mifid_emt_exante` es falsa para esta cifra |

**La definición de FinDatEx no exige que el `07130` sea ≥ 0.** Sí lo exige para el `07100`. Su nota sobre el `09010` (el ex ante del Reino Unido) dice que este
puede diferir del `07130` porque «UK RTS does not require a minimum of explicit transaction costs». De ahí se deduce que la norma europea de PRIIPs sí pone ese
suelo, y que un ex ante europeo negativo no debería existir. **Es una deducción, no una lectura del reglamento.** Los datos la respaldan: los dos negativos
del proveedor son ex post y sus ex ante son positivos. Las cifras del Reino Unido que también trae Morningstar (`EMTTransactionCosts…UK`) sí salen negativas
en el ex ante en dos casos (`IE00B4L5Y983`, `IE00BZCQB185`), y no se usan en ninguna parte.

### Qué tipo de diferencia es

- **De definición:** probado en 21 de 21. Son dos magnitudes distintas que comparten unidad, frecuencia y fecha de cierre, y por la §3 del método no se comparan
  ni se sustituyen una por otra.
- **No es de redondeo:** el redondeo existe, pero no pasa de 0,05 pb. Las diferencias medidas llegan a 14,8 pb.
- **No es de fecha:** las dos llevan 30-06-2026 (iShares) o 31-08-2026 (Vanguard). Esa coincidencia es la que hizo pensar en un error del proveedor.
- **No es un error del proveedor:** Morningstar publica las dos cifras bien, cada una con su nombre.
- **No es el swap:** los 15 sin KID son de réplica física (completa o por muestreo, según el canónico). En los dos sintéticos de Invesco, todas las cifras de
  operación valen cero, y la comisión de swap va aparte (`emisor.comision_swap_pct`: 0,0718 % en `IE00B3YCGJ38` y 0 en `IE00B3Q19T94`). Ni el EMT ni el
  proveedor la meten en el coste de operación.

### Alcance en el catálogo (canónico; la base no se ha leído)

| Medida | Cifra |
|---|---|
| Fichas con `costes.mifid_emt_exante.transaccion_pct` | 780 de 1.316 |
| De ellas, con las dos cifras en la caché de Morningstar | 772, y difieren en 638 |
| Cifra de la ficha igual a la *Actual* | 770 (las otras 5 solo traen *Estimated*; 3 no tienen caché) |
| Fichas en las que la base toma el coste de operación del **KID** | 670: no les afecta |
| Fichas en las que lo toma del **proveedor** | 105 (83 fondos y 22 ETF) |
| … y la cifra publicada es ex post y distinta de la ex ante | **70** (54 fondos y 16 ETF). Mediana 3,2 pb, media 8,4 pb, máximo 83,2 pb (`LU0607225447`: 1,50 % publicado frente a 0,67 % ex ante). 20 pasan de 10 pb. En 40 el ex post es mayor y en 30, menor |
| Negativas que se quedan fuera | 2 (las dos de arriba), y las dos tienen el ex ante positivo |

**El mismo error está en el coste corriente:** `corrientes_pct` se toma de `OngoingCostActual`, que difiere de la *Estimated* en 315 de 772. **No llega
a la base nueva**, porque `declared/costs.ongoing_charge` sale del KID o del TER. Sí llega a lo que lee la base vieja (`ms.costs.mifid_ongoing`,
`regulatory.mifid_ex_ante_costs`) y al informe del propio extractor (`core/informe.py`). Entrada y salida: 0 diferencias. Queda fuera del encargo; lo señalo por
su impacto.

**De paso, frente al KID del catálogo:** en 507 fichas con KID, las dos cifras de Morningstar se distinguen a dos decimales. En esas, el KID cuadra con el
ex ante en 260 y con el ex post en 19; en 227 no cuadra con ninguna, porque tienen fechas distintas. La descripción del contrato, «difieren en las 6
posiciones de la muestra con los dos», casi seguro que tiene esta misma causa. **No se ha comprobado con esas 6.**

## 3. Lo que cambia en lo que se publica (los 15 sin KID)

Coste total = TER del proveedor (`ongoing_charge`, con fuente `PROVIDER` en los 15) + coste de operación. Es la suma que hace la app en
`corrienteMasOperacionPct`.

| ISIN | TER | Operación hoy | Operación con el 07130 | Cambio (pb) | Total hoy | Total con el 07130 | Cambio del total |
|---|---:|---:|---:|---:|---:|---:|---:|
| `DE000A0F5UJ7` | 0,46 % | 0,04633 % | 0,03747 % | −0,9 | 0,5063 % | 0,4975 % | −1,7 % rel. |
| `IE000DR59CI3` | 0,50 % | 0,22607 % | 0,07829 % | **−14,8** | 0,7261 % | 0,5783 % | **−20,4 % rel.** |
| `IE000X59ZHE2` | 0,35 % | no disponible | 0,08904 % | pasa a tener cifra | no disponible | 0,4390 % | pasa a tener total |
| `IE00B0M62Q58` | 0,50 % | 0,00898 % | 0,00159 % | −0,7 | 0,5090 % | 0,5016 % | −1,5 % rel. |
| `IE00B27YCK28` | 0,20 % | 0,01300 % | 0,02791 % | +1,5 | 0,2130 % | 0,2279 % | +7,0 % rel. |
| `IE00B3VWMM18` | 0,58 % | 0,00800 % | 0,02843 % | +2,0 | 0,5880 % | 0,6084 % | +3,5 % rel. |
| `IE00B4L5Y983` | 0,20 % | 0,00263 % | 0,00161 % | −0,1 | 0,2026 % | 0,2016 % | −0,5 % rel. |
| `IE00B53L3W79` | 0,10 % | 0,07566 % | 0,05385 % | −2,2 | 0,1757 % | 0,1538 % | −12,4 % rel. |
| `IE00B53QG562` | 0,12 % | 0,01800 % | 0,01404 % | −0,4 | 0,1380 % | 0,1340 % | −2,9 % rel. |
| `IE00B5BMR087` | 0,07 % | 0,00344 % | 0,00196 % | −0,1 | 0,0734 % | 0,0720 % | −2,0 % rel. |
| `IE00B5L8K969` | 0,20 % | 0,03500 % | 0,07058 % | +3,6 | 0,2350 % | 0,2706 % | +15,1 % rel. |
| `IE00B6R52259` | 0,20 % | no disponible | 0,00390 % | pasa a tener cifra | no disponible | 0,2039 % | pasa a tener total |
| `IE00BDBRDM35` | 0,10 % | 0,02374 % | 0,00473 % | −1,9 | 0,1237 % | 0,1047 % | −15,4 % rel. |
| `IE00BZCQB185` | 0,65 % | 0,05000 % | 0,03249 % | −1,8 | 0,7000 % | 0,6825 % | −2,5 % rel. |
| `IE00B3XXRP09` | 0,07 % | 0,00100 % | 0,00108 % | +0,0 | 0,0710 % | 0,0711 % | +0,1 % rel. |

**Lo que cambia la calidad del dato:** en los 15, la cifra pasa a ser la que dice su etiqueta (ex ante). Y en dos ETF que hoy no tienen coste de operación,
la cartera deja de dar un total parcial o vacío por su culpa.

**Lo que cambiaría una decisión:**
- Un solo instrumento cambia de forma material: `IE000DR59CI3`, que baja 15 pb y pasa de ser el más caro de los 15 en total al tercero. Las otras dos
  posiciones que se cruzan (`IE00B3VWMM18`, `IE00BZCQB185`) son exposiciones distintas, y comparar su coste no lleva a ninguna decisión.
- En una cartera, el efecto es el peso por la diferencia. `IE000DR59CI3` al 5 % mueve el total de la cartera 0,7 pb; el resto, menos de 0,2 pb cada uno.
- **El impacto en decisiones está fuera de los 15:** son las 70 fichas del catálogo, con fondos activos de hasta 83 pb. Esto se mide aparte si lo quieres.

## 4. La recomendación

**La medición cambia la premisa de la 60.** La 60 se aprobó porque el proveedor «difiere en 20 de 23» y trae dos negativas. Las dos cosas se explican por un
campo mal elegido en nuestra lectura. Con la lectura corregida, el proveedor da el `07130` a ±0,05 pb en los 23, y ninguna cifra es negativa.

### Opciones

| | **A. Corregir la lectura y dejar el EMT como comprobación** | **B. La 60 tal como está, sin tocar la lectura** | **C. Corregir la lectura y, además, la 60** |
|---|---|---|---|
| Qué es | `_mapea_mifid` toma primero la *Estimated*, y la fecha de `TransactionFeeEstimatedDate`. El `07130` se guarda con el EMT (58) y avisa si se separa del proveedor | El `07130` sustituye al proveedor en los 15 sin KID | Precedencia KID > EMT `07130` > proveedor ex ante |
| Lo que arregla | Las 70 del catálogo, más las 2 negativas | 15 (13 corregidas y 2 que ganan cifra); **quedan mal 57** | Lo mismo que A, con los decimales exactos del emisor en los 15 |
| Decisión 52 | Sin excepción: el emisor no sustituye nada | Excepción | Excepción, aunque ahora casi cosmética (≤ 0,05 pb) |
| Decisión 53 | Sin conflicto | **Choca:** `declared/costs.transaction_costs` va al PDF de costes (`src/reports/costsPdf.tsx`), que puede salir con nombre de destinatario. Si es un informe de cliente, una cifra del emisor llegaría al papel | El mismo choque que B |
| Trabajo | Pequeño: dos líneas en el extractor y su prueba; regenerar el canónico, la base local y subir el catálogo con tu aprobación | Lector EMT, enum, ficha y PDF | La suma de A y B |

**Recomiendo la A.** Es la corrección de la causa y no un parche sobre 15. No abre excepción a la 52 ni cruza la 53. Y el EMT de la 58 ya trae el
`07130`, así que la comprobación sale casi gratis: una alerta si `|proveedor ex ante − 07130| > 0,5 pb`, un margen que cubre el redondeo de Morningstar,
medido en 0,05 pb.

### Si eliges C (o mantienes la 60)

- **Orden:** KID (con `url` y `sha256`) > EMT `07130` del emisor > proveedor `TransactionFeeEstimated`. **Nunca `TransactionFeeActual`** ni el `08070`, se
  llamen como se llamen.
- **Fuente al lado:** ampliar el enum de `transaction_costs_source` en `instrument-declared-costs.v2.schema.json` con `ISSUER_EMT`, y corregir la descripción
  de `PROVIDER`: «ex ante de MiFID vía Morningstar, campo `TransactionFeeEstimated`». Hace falta además una fecha propia de la cifra
  (p. ej. `transaction_costs_as_of`, que sería la `07160`). Hoy la cifra hereda el `as_of` de la ficha o la `document_date` del KID, y ninguna de las dos es la
  suya. Hay que tocar el mapper (`mapper.ts`, línea 1239), la ficha (`componerFicha.ts::procedenciaDeLosCostes`, que solo distingue KID y proveedor) y
  `portfolioCosts.ts::resumenDeLaOperacion`, que agrupa por esas dos fuentes.
- **La 53:** antes de construir, decidir si el PDF de costes es de cliente. Si lo es, en papel va la cifra del proveedor ex ante, y la del emisor se queda en
  pantalla.

### Las negativas, en cualquier opción

- Un ex post no entra nunca en `transaction_costs`, así que el problema de hoy desaparece con la corrección.
- Si llega un ex ante negativo (en la muestra no hay ninguno, y por lo deducido arriba no debería haberlo), **no se recorta a cero**, porque sería inventar un
  coste. Queda ausente (`NOT_PROVIDED`), como ya dice el contrato, con un aviso que nombre el ISIN y la fuente.
- El ex post no se guarda ahora. Si algún día hace falta para el extracto anual al cliente, irá en un campo propio y con su periodo (`08090`–`08100`), nunca
  en este.

### Qué toca, sin construir nada

- **A:** `1-extractor/fetchers/morningstar_lt.py::_mapea_mifid`, con una prueba de las dos cifras a la vez. Lo coherente es corregir los cinco pares, también el
  corriente. Después, pasada del extractor, base local y subida del catálogo con tu aprobación. **El contrato no cambia.** La descripción de
  `transaction_costs_source` debería corregirse, pero no hace falta para que funcione.
- **C:** además de lo anterior, lo listado en el apartado de la C.

## 5. Limitaciones

**Comprobado:** la lectura del extractor en el código; la igualdad proveedor = `08070` en los 21 EMT disponibles; Morningstar *Estimated* = `07130` en los 23;
KID = `07130` redondeado en los 8; el alcance de 70 y 105 sobre el canónico y la caché, con fecha 08-11.

**Supuesto, sin comprobar:**
- Que el ex ante de PRIIPs se calcule como media de tres años, y que tenga un suelo en los costes explícitos. Lo primero es de memoria; lo segundo, deducido de
  la nota de FinDatEx sobre el `09010`.
- Que la *Actual* de Morningstar sea el `08070` en todo el catálogo. Comprobado en 21 instrumentos de dos emisores, y extrapolado a los 770.
- Que la discrepancia de la «muestra de 6» del contrato tenga la misma causa.

**Limitaciones:**
- La base no se ha leído: el emulador estaba parado. Lo que «publica hoy» sale de aplicar la regla del mapper al canónico.
- El CSV de Invesco no está en la carpeta: su `07130` sale de la medición anterior, y su `08070` queda como no disponible.
- Las 105 y las 70 son fichas del canónico (1.316), no instrumentos de la base (1.104). No se ha cruzado cuáles están en las carteras modelo.
- El canónico y la caché son del 08-11. Otro agente trabaja hoy en `main.py` y en las pruebas del extractor. No se han tocado, y estas cifras no dependen de ellos.
