# Liberación de nueve instrumentos

*5 de noviembre de 2026. Decisión 58 de Óscar, opción A, en [`rediseno-2026-11/DECISIONES_AUDITORIA_2026-11-04.md`](rediseno-2026-11/DECISIONES_AUDITORIA_2026-11-04.md). Este documento es la evidencia: de dónde viene la cuarentena, qué se midió y qué salvedad lleva cada uno. Las cifras son de la base nueva en el emulador local; la nube no se ha leído.*

## De dónde viene

BDB encontró en septiembre dos errores en sus series. Siete tenían la divisa mal resuelta: cinco ETF que cotizan en euros y se volvían a convertir, uno en dólares que no se convertía y HSBC, en peniques tratados como libras. Dos tenían ajustes históricos mezclados: Amphenol, tras su desdoblamiento del 03-09-2026, y Naturgy, con versiones distintas de su ajuste de dividendo. Se apartaron en dos listas fijas, `FX_QUARANTINE_ASSET_IDS` y `ADJUSTMENT_QUARANTINE_ASSETS`, y se repararon el 06-09-2026 ([`CORRECCION_AJUSTES_HISTORICOS_2026-09-06.md`](CORRECCION_AJUSTES_HISTORICOS_2026-09-06.md)).

Lo que los liberó allí fue una línea de entorno, `BDB_VERIFIED_PRICE_REPAIR_RELEASES`, en un fichero que no está en Git. Este proyecto se clonó sin ella, y las dos listas siguieron mandando sobre una base que ya no tenía esos errores: fuera de simulación, frontera y gráfica de la ficha, y Rendimiento sin ninguna métrica temporal en cuanto una cartera llevara uno. Nada se rompía, y por eso nadie se enteró.

## Qué impide que se vuelva a perder

La lista está en [`functions_python/verified_price_repair_releases.json`](../functions_python/verified_price_repair_releases.json). `scripts/desplegarFunciones.mjs` no despliega si `.env.bdb-gestor-de-activos` no la lleva entera, y dice cuáles faltan. `functions_python/tests/test_price_repair_releases.py` falla si la lista y las cuarentenas dejan de ser lo mismo. Sin la variable todo sigue en cuarentena, y una marca futura `REPAIR_REQUIRED` manda sobre la liberación.

## Qué se midió

El 05-11-2026, solo lectura. La serie en euros de la base nueva, leída por el lector de producción (`LectorOptimizacionBaseNueva.get_price_series`, con los cambios del BCE y hasta 7 días de tolerancia), frente a la copia de la maestra de BDB reparada, `assets/{isin}/price_series`, campo `value`, en las fechas comunes hasta el 28-10-2026. La razón es `n/v − 1` en cada fecha, y la diferencia diaria, la de las variaciones entre fechas comunes consecutivas.

| Instrumento | ISIN | Cuarentena | Puntos nueva / vieja / comunes | Desde | Mediana razón | Máx. razón | Máx. dif. diaria | Días > 0,5 p |
|---|---|---|---:|---|---:|---:|---:|---:|
| VanEck Rare Earth | IE0002PG6CA6 | Divisa | 1.300 / 1.296 / 1.296 | 29-09-2021 | 0,000 % | 0,000 % | 0,000 p | 0 |
| VanEck Uranium | IE000M7V94E1 | Divisa | 950 / 946 / 946 | 08-02-2023 | 0,000 % | 0,000 % | 0,000 p | 0 |
| iShares AI Infrastructure | IE000X59ZHE2 | Divisa | 481 / 477 / 477 | 09-12-2024 | 0,000 % | 0,000 % | 0,000 p | 0 |
| Invesco S&P 500 | IE00B3YCGJ38 | Divisa | 3.754 / 3.750 / 3.750 | 16-11-2011 | 0,000 % | 0,000 % | 0,000 p | 0 |
| iShares Core S&P 500 | IE00B5BMR087 | Divisa | 4.065 / 4.060 / 4.060 | 27-05-2010 | 0,000 % | 0,000 % | 0,000 p | 0 |
| Naturgy | ES0116870314 | Ajuste | 8.829 / 4.048 / 4.048 | 03-01-2011 | 2,042 % | 2,064 % | 0,022 p | 0 |
| Amphenol | US0320951017 | Ajuste | 7.002 / 6.161 / 6.161 | 06-05-2002 | 0,215 % | 16,057 % | 14,655 p | 1.951 |
| iShares Energy Storage | IE000DR59CI3 | Divisa | 444 / 439 / 439 | 10-02-2025 | 0,204 % | 2,509 % | 3,293 p | 126 |
| HSBC | GB0005405286 | Divisa | 7.092 / 8.666 / 7.028 | 04-01-1999 | 51,900 % | 73,828 % | 3,896 p | 1.506 |

## La salvedad de cada uno

- **Los cinco idénticos.** Sin diferencia en ninguna fecha. En iShares Core S&P 500 hay un −24,6 % el 01-11-2010, en las dos bases: es un hueco al principio de la serie, fuera de cualquier ventana de 3, 5 o 10 años.
- **VanEck Uranium.** Entra a 3 años con precios observados. **A 5 años entra con un 25,5 % de los días estimado** (333 de 1.306, del 29-10-2021 al 07-02-2023) desde NLR convertido a euros; la decisión no lo decía.
- **iShares AI Infrastructure.** No entra ni a 3 ni a 5 años (`INSUFFICIENT_HISTORY`): tiene 481 cotizaciones y ninguna referencia. Sí se dibuja en su ficha, y entra en Rendimiento.
- **Naturgy.** Razón constante, 0,9794 a 0,9796: un ajuste de dividendo posterior a la copia. Rentabilidad anual igual, con 0,1 puntos como mucho. Antes de 2011 la base nueva no tiene con qué contrastarse.
- **Amphenol.** En dólares las dos series son iguales. La diferencia es el cambio: la vieja lleva puntos malos, como 1,4918 el 08-12-2008, entre 1,2717 y 1,2926. Rentabilidad anual a 1,9 puntos como mucho (2009). Antes de mayo de 2002, sin contraste.
- **iShares Energy Storage.** En dólares, la serie de la copia y la cotización de STOR.AS son iguales (439 de 439, comprobado por otro lote contra EODHD); lo que difiere es la fuente del cambio. **A 3 años, el 42,7 % de los días es estimado** (336 de 786, del 27-10-2023 al 07-02-2025), **y a 5 años, el 65,5 %** (856 de 1.306, desde el 29-10-2021), desde el índice STOXX Global Energy Storage and Hydrogen, cuya propia historia antes de su lanzamiento es retrospectiva. Medido por semanas, el tramo estimado oscila menos que el observado: 19,2 % frente a 30,4 % a 3 años, y 21,8 % a 5. Puede ser del periodo o del método, y no se distingue con estos datos: la volatilidad a 3 años, 26,2 %, no debe leerse como la del ETF. Cotiza poco: 65 de 444 sesiones sin volumen y unas 9.090 participaciones al día en las últimas 60, medido por otro lote contra EODHD y no repetido aquí; la base no guarda volumen. Ninguna sesión repite precio, así que esos días no arrastran el del anterior.
- **HSBC.** La única que se separa de verdad, y la buena es la nueva: la vieja apenas descuenta dividendos. El 07-03-2024, cierre 590,7, ajustado de la vieja 589,9 y ajustado de la nueva 509,8 peniques. De 1999 a 2026, 8,30 % al año en la nueva y 3,25 % en la vieja: 5,05 puntos, y la razón crece un 4,89 % al año. Sin contraste externo. Es un defecto de la copia de BDB, que no se toca: en local, con la base vieja, HSBC da 31,65 % a 3 años donde la nueva da 39,31 %, cada base con su ventana.

## Lo que da cada uno, solo

Simulación con la línea puesta. Rentabilidad anualizada, volatilidad y caída máxima, sin reequilibrar, hasta el 30-10-2026. No se escribe el Sharpe de una acción (§9 del método).

| Instrumento | 3 años | 5 años |
|---|---|---|
| Naturgy | 11,09 % · 21,01 % · −30,51 % | 11,87 % · 22,72 % · −30,51 % |
| Amphenol | 56,69 % · 34,90 % · −29,03 % | 35,10 % · 30,76 % · −29,03 % |
| HSBC | 39,31 % · 23,08 % · −25,56 % | 31,64 % · 24,35 % · −25,56 % |
| VanEck Rare Earth | −5,79 % · 40,89 % · −51,56 % | −13,36 % · 37,79 % · −73,26 % |
| iShares Energy Storage | 24,80 % · 26,19 % · −29,07 %, estimado | 5,22 % · 25,18 % · −47,05 %, estimado |
| VanEck Uranium | 21,80 % · 35,71 % · −37,52 % | 16,95 % · 30,30 % · −37,52 %, estimado |
| iShares AI Infrastructure | No entra | No entra |
| Invesco S&P 500 | 21,64 % · 13,75 % · −23,34 % | 12,83 % · 14,33 % · −23,34 % |
| iShares Core S&P 500 | 21,46 % · 13,71 % · −23,32 % | 12,64 % · 14,32 % · −23,32 % |

## Cuánto se mueve una cartera

Ninguna de las carteras guardadas en local lleva uno de los nueve (23 en la base vieja y 18 en la nueva), así que se añade uno a la cartera de muestra y a la mayor de las guardadas, reduciendo las demás en proporción. Antes el añadido queda fuera, y las cifras son las de las demás. Base nueva. La nube no se ha leído.

| Cartera | Ventana | Peso medido | Rentabilidad | Volatilidad | Sharpe | Caída máxima |
|---|---|---:|---:|---:|---:|---:|
| Muestra + iShares Energy Storage 5 %, estimado | 3 años | 95,0 → 100,0 % | 13,48 → 14,10 % | 8,44 → 9,03 % | 1,27 → 1,26 | −13,05 → −13,58 % |
| | 5 años | 95,0 → 100,0 % | 6,38 → 6,32 % | 8,83 → 9,23 % | 0,48 → 0,45 | −14,49 → −15,18 % |
| Muestra + iShares Core S&P 500 10 % | 3 años | 90,0 → 100,0 % | 13,48 → 14,33 % | 8,44 → 8,93 % | 1,27 → 1,30 | −13,05 → −14,23 % |
| | 5 años | 90,0 → 100,0 % | 6,38 → 7,07 % | 8,83 → 9,36 % | 0,48 → 0,53 | −14,49 → −14,81 % |
| Guardada de 27 + iShares Energy Storage 5 %, estimado | 3 años | 93,9 → 98,9 % | 12,68 → 13,35 % | 6,38 → 6,95 % | 1,56 → 1,53 | −8,18 → −8,78 % |
| | 5 años | 89,2 → 94,2 % | 7,20 → 7,10 % | 7,34 → 7,74 % | 0,69 → 0,64 | −12,09 → −12,59 % |
| Guardada de 27 + iShares Core S&P 500 10 % | 3 años | 88,9 → 98,9 % | 12,68 → 13,63 % | 6,38 → 6,82 % | 1,56 → 1,60 | −8,18 → −9,68 % |
| | 5 años | 84,5 → 94,5 % | 7,20 → 7,83 % | 7,34 → 7,74 % | 0,69 → 0,74 | −12,09 → −12,02 % |

## Fuera de la simulación

- **Rendimiento.** Una cartera real con uno de los nueve no tenía TIR, TWR, volatilidad ni caída: el importe del extracto se conservaba y lo demás quedaba pendiente con «precios en cuarentena». Ahora se calcula, solo con precios observados: aquí no entra ningún tramo estimado. **Solo se ha visto con extractos de prueba**, inventados con el formato del banco y precios de la base. Con uno que lleva iShares Core S&P 500 y HSBC: TWR de N/D a 30,58 %, TIR a 14,65 %, volatilidad a 9,82 %, caída a −14,10 %. Con uno que lleva iShares Energy Storage y Naturgy: 35,12 %, 20,14 %, 14,38 % y −14,96 %. Valor, caja y flujos, iguales antes y después; un extracto sin ninguno de los nueve, igual en todo.
- **Posiciones.** No cambia: lo que lee, `resolve_portfolio`, no mira la cuarentena. Con los nueve, la respuesta es idéntica byte a byte con y sin la variable.
- **Fondos equivalentes.** No usa tramos estimados. Con iShares Energy Storage o iShares AI en la cartera no corre a 3 ni a 5 años, y con VanEck Uranium no corre a 5: `La cartera no tiene 144 semanas comunes`. Con los otros seis, corre.
