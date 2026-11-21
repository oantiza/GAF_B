# La revisión de los nueve fondos que reparten

*5 de noviembre de 2026. La preparó el lote N3 de la auditoría (Claude), de solo lectura y sin salir a internet, y la validó Óscar ese mismo día
eligiendo la A en las decisiones 53, 54, 55 y 57 de [`DECISIONES_AUDITORIA_2026-11-04.md`](DECISIONES_AUDITORIA_2026-11-04.md). Es la evidencia a la que apunta
`functions_python/fund_history_policies.json`. Las cifras son de las bases locales de ese día: la nube no se ha leído, y que sus series sean las mismas es un supuesto.*

## Qué se preguntaba

Nueve fondos estaban bloqueados en la política de históricos con la frase «NAV returns differ from provider total returns; distributions/FX/identity require reconciliation» y no se
dibujaban. La pregunta de la decisión 48: la serie que tenemos, ¿es de esta clase y solo le faltan los dividendos, o puede ser otra clase, otra divisa o tener errores? Si solo le faltan
los dividendos, se puede dibujar rotulada «Valor liquidativo, sin dividendos», sin meterla en ningún cálculo.

## El método, con los criterios fijados antes de medir

**Fuentes, ninguna de red.** Los dos emuladores locales, base vieja y base nueva, por lectura REST; `1-extractor` (`export_series`, `data/history_vl`, `data/history`); y lo que el
proveedor trae en crudo en `cache/raw_morningstar_lt`: cada pago con su fecha ex, importe y valor liquidativo (`ETFsnapshot.DistributionHistory`), la curva mensual de rentabilidad total en
euros a 10 años (`MFsnapshot.GrowthOf10K`), los trimestres desde 2008 y la cifra a 3 años (`sal_trailingReturn`).

**Los cinco criterios:**

1. **Identidad.** ISIN, símbolo y divisa iguales en todos los documentos, y KID o CSSF que nombren la clase.
2. **Nivel.** Valor liquidativo de la serie frente al del proveedor en cada fecha de pago, a menos del 0,5 % en el 95 % de ellas.
3. **Rentabilidad.** La serie con los pagos reinvertidos en la fecha ex debe quedar a menos de 0,25 puntos al año del proveedor, sin deriva de más del 1 % en 12 meses.
4. **Saltos.** Toda caída grande es un pago o la tienen sus pares de categoría. Entre paréntesis va el peor dato de la mediana de sus pares en ±1 día, por el desfase de hora del valor liquidativo.
5. **Huecos.** Ninguno de más de 15 días en los 10 años, que es lo máximo que dibujan ficha y comparador.

**Convenciones.** Anualizado con 365,2425 días, de fin de mes a fin de mes, con la última fecha de la serie igual o anterior. A 3 años justos, como mide el proveedor, lo que queda es 0,000 en 7 de 9.
Rentabilidad con pagos: participaciones que crecen en cada fecha ex, con el valor liquidativo y el importe que da el proveedor, que es la convención de reinversión en la fecha ex.
Aquí cada cifra se redondea una sola vez: el informe de la revisión decía 11,75, 6,38 y 17,53 donde el valor es 11,7449, 6,3749 y 17,5249, por redondear dos veces.

**Contrapruebas.** La clase hermana que acumula, en 4 de los 9; un control negativo con esas hermanas (0 fechas exactas, razón de 1,004 a 1,716), para saber que la prueba distingue; y la misma
prueba en los otros 7 fondos con la misma regla o el mismo bloqueo, que es de donde salen las decisiones 55 y 57.

Los scripts y las medidas estaban en el espacio de trabajo de la auditoría, que no dura. Lo que queda es este documento.

## El resultado

**Los nueve pasan.** 435 de 435 fechas de pago con razón 1,0000. La diferencia a 3 años con el proveedor va de 1,39 a 7,78 puntos, y es lo que reparten: con los pagos reinvertidos quedan de −0,019 a +0,024.
Ninguno es de otra divisa.

| ISIN | Fondo | Serie, 3 años | Proveedor, 3 años | Diferencia | Con pagos, queda | Rendimiento 12 m | Pagos conocidos | Nivel | A 10 años, línea | A 10 años, con pagos |
|---|---|---|---|---|---|---|---|---|---|---|
| DE0005318406 | DWS ESG Stiftungsfonds LD | 4,38 % | 6,61 % | 2,24 | −0,005 | 2,52 % | 12 | 12/12 | +3,3 % | +24,1 % |
| FR0013460961 | EdR SICAV - Short Duration Credit B EUR | 1,20 % | 4,21 % | 3,01 | −0,019 | 3,91 % | 5 | 5/5 | No llega | No llega |
| IE00BYYPF581 | Aegon Global Diversified Income Fund A Inc EUR | 5,29 % | 11,01 % | 5,72 | −0,008 | 5,20 % | 122 | 122/122 | −6,1 % | +59,6 % |
| IE00BZ18VT34 | BNY Mellon Global Infrastructure Income Fund EUR A Inc | 11,74 % | 17,52 % | 5,78 | +0,022 | 4,39 % | 33 | 33/33 | No llega | No llega |
| LU0102219945 | Goldman Sachs Europe CORE Equity Portfolio Base Inc EUR | 18,98 % | 20,36 % | 1,39 | −0,015 | 0,99 % | 10 | 10/10 | +123,3 % | +156,5 % |
| LU0162660350 | BlackRock Global Funds - Euro Corporate Bond Fund A1 | 0,84 % | 3,53 % | 2,69 | +0,004 | 2,95 % | 124 | 124/124 | −7,2 % | +4,4 % |
| LU0321373184 | Schroder International Selection Fund European Dividend Maximiser B Distribution QF | 6,37 % | 14,16 % | 7,78 | −0,010 | 6,77 % | 43 | 43/43 | −36,5 % | +28,7 % |
| LU0404220724 | JPMorgan Investment Funds - Global Income Fund D (div) EUR | 3,76 % | 9,11 % | 5,35 | −0,006 | 5,12 % | 43 | 43/43 | −18,4 % | +28,9 % |
| LU1095739733 | First Eagle Amundi Income Builder Fund Class AE-QD Shares | 6,71 % | 12,24 % | 5,53 | +0,024 | 4,89 % | 43 | 43/43 | +6,2 % | +75,9 % |

Cada serie mide hasta su último fin de mes con cifra del proveedor: 30-10-2026, o 30-09-2026 en BNY Mellon Infrastructure y BlackRock, las dos en caché a esa fecha. A 10 años, la línea es la variación del
valor liquidativo y «con pagos» la rentabilidad total del proveedor, las dos del mismo tramo: el rótulo es lo único que separa esa línea de una pérdida delante del cliente.

## Los nueve, uno a uno

### DE0005318406

**DWS ESG Stiftungsfonds LD.** Se puede dibujar. Es la clase LD y solo le faltan los pagos: con ellos queda a 0,005 puntos del proveedor y coincide con su curva en 118 de 119 fines de mes. La excepción es dic-2023 (45,69 frente a 45,81 implícito, 0,26 %), corregida en enero; y en 6 días de ago-2026 las dos bases discrepan hasta un 0,31 %, sin que con lo que hay se pueda decir cuál acierta.

- **Identidad.** Mismo ISIN en el proveedor (F0GBR04HZ5) y mismo nombre en las dos bases. Símbolo EODHD:DE0005318406.EUFUND en todos los documentos. KID de DWS: «Clase de acciones: LD, ISIN: DE0005318406 … Divisa: EUR», reparte anual. Nivel: 12 de 12 fechas de pago con razón 1,0000. Para comprobar a mano: 49,59 el 03-11-2026.
- **Divisa.** De la clase, EUR; de la serie, EUR.
- **A 3 años.** Serie: 4,38 % al año (+13,7 %): 43,71 a 49,70, del 31-10-2023 al 30-10-2026. Proveedor: 6,61 % al año (+21,2 %) a 31-10-2026. La serie con sus pagos da 6,62 %. Diferencia: 2,24 puntos; con los pagos quedan −0,005. A 30-09-2026, la fecha que guardan las bases: 2,23 y +0,007.
- **Rendimiento a 12 meses.** 2,52 % a 31-10-2026 (2,53 % en la vieja). Pagos de la ventana: 2,21 % al año sobre el VL medio.
- **Pagos conocidos.** 12 pagos, anuales, del 04-03-2016 al 06-03-2026; 3 en la ventana, 3,09 € por participación.
- **Saltos.** Las mayores caen en fecha de pago y por su importe: 06-03-2026 −3,07 % (pago −2,45 %), 06-03-2020 −2,69 % (pago −1,63 %, resto −1,06 %; pares −2,21 %), 07-03-2025 −2,25 % (pago −2,02 %), 10-03-2023 −1,94 % (pago −1,76 %). Sin pago: 17-03-2020 −1,94 % (pares −3,05 %). Cae ese día en 11 de 11 pagos. Sin pago ni pares: 12-06-2020 −1,33 % (pares −0,41 %). Antes de lo que se dibuja hay caídas de 3,7 a 4,3 % en feb-mar de 2006 a 2011 sin pago conocido, porque el registro empieza en 2016.
- **Desde.** 15-04-2002, el lanzamiento de la clase. Mensual en 2002, diaria desde 2003.
- **Hasta.** 03-11-2026 en la nueva, 28-10-2026 en la vieja. En los 10 años que se dibujan, el mayor hueco es de 6 días (23 a 29-12-2025) y hay una parada: 6 datos a 45,77 del 04 al 11-01-2024, con sus pares a +0,08 %.

### FR0013460961

**EdR SICAV - Short Duration Credit B EUR.** Se puede dibujar. Es la clase B y solo le faltan los pagos: su línea cae justo lo que paga cada enero y, con pagos, iguala a su hermana que acumula con 0,005 puntos de diferencia. Es el caso más limpio de los nueve.

- **Identidad.** Mismo ISIN en el proveedor (F000015Z5Y) y mismo nombre. Símbolo EODHD:FR0013460961.EUFUND en todos los documentos. KID: «B EUR ISIN: FR0013460961», ingresos en distribución. Nivel: 5 de 5 con razón 1,0000. A mano: 87,31 el 02-11-2026. Hermana A EUR que acumula (FR0013460920): 4,234 % a 3 años frente a 4,229 % de esta clase con pagos; correlación diaria 0,998.
- **Divisa.** De la clase, EUR; de la serie, EUR.
- **A 3 años.** Serie: 1,20 % al año (+3,6 %): 84,16 a 87,22, del 31-10-2023 al 30-10-2026. Proveedor: 4,21 % al año (+13,2 %) a 31-10-2026. La serie con sus pagos da 4,23 %. Diferencia: 3,01 puntos; con los pagos quedan −0,019, por un día: el proveedor cierra octubre con el VL del 29 (87,18) y la serie con el del 30 (87,22). A 30-09-2026: 3,04 y +0,005.
- **Rendimiento a 12 meses.** 3,91 % a 31-10-2026 (3,89 % en la vieja). Pagos de la ventana: 3,04 % al año.
- **Pagos conocidos.** 5 pagos, anuales, del 07-01-2022 al 08-01-2026; 3 en la ventana, 7,80 €.
- **Saltos.** Las 5 mayores caídas son los 5 pagos, y por su importe: 08-01-2026 −3,73 % (pago −3,75 %), 08-01-2025 −3,13 % (−3,09 %), 08-01-2024 −1,81 % (−1,88 %), 07-01-2022 −1,58 % (−1,60 %), 06-01-2023 −1,47 % (−1,68 %). La siguiente, 13-06-2022 −0,79 %, la tienen sus pares (−0,70 %). Ninguna sin explicar.
- **Desde.** 30-10-2020, el lanzamiento de la clase; diaria.
- **Hasta.** 02-11-2026 en la nueva, 27-10-2026 en la vieja. Mayor hueco: 5 días (02 a 07-04-2026). Sin paradas.

### IE00BYYPF581

**Aegon Global Diversified Income Fund A Inc EUR.** Se puede dibujar. Es la clase A Inc y solo le faltan los pagos: con ellos, exacta contra el proveedor en 119 de 119 fines de mes y a 0,001 puntos de su hermana que acumula. A 10 años la línea baja un 6,1 % donde con pagos se gana un 59,6 %.

- **Identidad.** Mismo ISIN en el proveedor (F00000XJY1). Nombre con el orden cambiado: «EUR A Inc» en la vieja, «A Inc EUR» en la nueva y el proveedor. Símbolo EODHD:IE00BYYPF581.EUFUND en todos los documentos. KID: «Euro Class A, Dist», ISIN IE00BYYPF581. Nivel: 122 de 122 con razón 1,0000. A mano: 9,4419 el 03-11-2026. Hermana A Acc EUR (IE00BYYPF474): 11,015 % a 3 años frente a 11,016 %; correlación diaria 0,99993.
- **Divisa.** De la clase, EUR; de la serie, EUR.
- **A 3 años.** Serie: 5,29 % al año (+16,7 %): 8,1293 a 9,4887, del 31-10-2023 al 30-10-2026. Proveedor: 11,01 % al año (+36,8 %) a 31-10-2026. La serie con sus pagos da 11,02 %. Diferencia: 5,72 puntos; con los pagos quedan −0,008. A 30-09-2026: 5,77 y +0,013.
- **Rendimiento a 12 meses.** 5,20 % a 31-10-2026 (5,17 % en la vieja). Pagos de la ventana: 5,44 % al año.
- **Pagos conocidos.** 122 pagos, mensuales, del 01-09-2016 al 01-10-2026; 36 en la ventana, 1,4362 €.
- **Saltos.** Las mayores son de la COVID, sin pago: 18-03-2020 −5,54 % (pares −2,82 %), 12-03-2020 −3,96 % (−3,96 %), 19-03-2020 −3,71 % (−1,94 %), 13-03-2020 −3,47 % (−3,96 %), 16-03-2020 −3,29 % (−2,82 %). Los pagos son de un 0,4 % al mes y no llegan a esa lista; ese día cae más que sus pares en 109 de 120. Sin pago ni pares, pequeñas: 20-03-2023 −1,67 %, con +1,15 % al día siguiente (supuesto: el fin de semana de los AT1 de Credit Suisse), 09-04-2025 −1,30 % y 11-11-2016 −1,23 %.
- **Desde.** 29-07-2016, el lanzamiento de la clase; diaria.
- **Hasta.** 03-11-2026 en la nueva, 28-10-2026 en la vieja. Mayor hueco: 6 días (01 a 07-06-2022 y 24 a 30-12-2025). Sin paradas.

### IE00BZ18VT34

**BNY Mellon Global Infrastructure Income Fund EUR A Inc.** Se puede dibujar. Es la clase EUR A Inc y solo le faltan los pagos: con ellos, exacta contra el proveedor en 98 de 98 fines de mes. La salvedad es la aguja de un día del 04-02-2025: se supone un VL erróneo, sin haberlo podido confirmar.

- **Identidad.** Mismo ISIN en el proveedor (F000010YD6) y mismo nombre. Símbolo EODHD:IE00BZ18VT34.EUFUND en todos los documentos. KID: «EUR A (Inc.) (IE00BZ18VT34)», reparto trimestral. Nivel: 33 de 33 con razón 1,0000. A mano: 1,1745 el 02-11-2026; y, para la aguja, el VL de la gestora del 04-02-2025. Sin clase hermana en el catálogo.
- **Divisa.** De la clase, EUR; de la serie, EUR.
- **A 3 años.** Serie: 11,74 % al año (+39,6 %): 0,8270 a 1,1544, del 29-09-2023 al 30-09-2026. Proveedor: 17,52 % al año (+62,3 %) a 30-09-2026, la última cifra en caché. La serie con sus pagos da 17,50 %. Diferencia: 5,78 puntos; con los pagos quedan +0,022, que es la convención de días: a 3 años justos, 0,000. La vieja tiene la misma fecha y la misma cifra.
- **Rendimiento a 12 meses.** 4,39 % a 30-09-2026 (4,40 % en el screener). Pagos de la ventana: 5,09 % al año.
- **Pagos conocidos.** 33 pagos, trimestrales, del 01-10-2018 al 01-10-2026; 12 en la ventana, 0,1515 €.
- **Saltos.** Las mayores son de la COVID: 12-03-2020 −15,42 % (pares −7,50 %), 09-03-2020 −12,16 % (−5,86 %), 16-03-2020 −11,49 % (−5,62 %), 23-03-2020 −6,09 % (−7,07 %), 01-04-2020 −5,82 % (en fecha de pago: pago −0,98 %, resto −4,84 %). Sin pago ni mercado, y es lo que hay que mirar: 04-02-2025 +5,24 % (1,0411) y 05-02-2025 −4,08 % (0,9986), con sus pares a ±0,5 %, sin pago cerca y sin dato del 03-02. Otras en crisis, con solo 4 pares: 27-03-2020 −4,09 %, 15-04-2020 −3,81 %, 09-06-2020 −3,28 %.
- **Desde.** 13-08-2018, el lanzamiento de la clase; diaria.
- **Hasta.** 02-11-2026 en la nueva, 27-10-2026 en la vieja. Mayor hueco: 6 días (24 a 30-12-2025). Sin paradas.

**La aguja del 04-02-2025 (decisión 54).** El punto se ha quitado con `excluded_dates`, anotando el motivo: «supuesto VL erróneo; sin contraste con la gestora». Con él, 0,9893 el 31-01, 1,0411 el 04-02
(+5,24 %) y 0,9986 el 05-02 (−4,08 %), con sus pares a ±0,5 %, sin pago cerca y sin dato del 03-02. Sin él, de 0,9893 a 0,9986, un +0,94 %. La línea no lo enseña en ninguna de las dos bases, en diario de 1 a 10 años ni en
semanal. La cifra a 3 años de la ficha no cambia, porque no sale de esta serie: es la del proveedor, 17,52 %, y este fondo no tiene métricas propias. Y la de la serie, de fin de mes a fin de mes, no toca esa fecha. Sigue sin
contraste: para cerrarlo basta el valor liquidativo de la gestora de ese día.

### LU0102219945

**Goldman Sachs Europe CORE Equity Portfolio Base Inc EUR.** Se puede dibujar. Es la clase Base y solo le faltan los pagos: con ellos, exacta en 119 de 119 fines de mes. Reparte poco y el efecto es de 1,39 puntos, mayor que su 0,99 % de rendimiento porque compone sobre un 19 % al año.

- **Identidad.** Mismo ISIN en el proveedor (F0GBR04AXL) y mismo nombre. Símbolo EODHD:LU0102219945.EUFUND en todos los documentos. CSSF: clase «BASE (SNAP)» de GOLDMAN SACHS EUROPE CORE EQUITY PORTFOLIO, compartimento en EUR. KID: «Base Shares», moneda de la clase EUR, ingresos distribuidos cada año. Nivel: 10 de 10 con razón 1,0000. A mano: 31,42 el 03-11-2026. Hermana E Acc (LU0133265339): 19,78 % a 3 años frente a 20,38 %; esos 0,60 puntos cuadran con su coste 0,50 mayor (1,91 % frente a 1,41 %); correlación diaria 0,9996.
- **Divisa.** De la clase, EUR; de la serie, EUR.
- **A 3 años.** Serie: 18,98 % al año (+68,4 %): 18,65 a 31,40, del 31-10-2023 al 30-10-2026. Proveedor: 20,36 % al año (+74,4 %) a 31-10-2026. La serie con sus pagos da 20,38 %. Diferencia: 1,39 puntos; con los pagos quedan −0,015. A 30-09-2026: 1,40 y +0,024. Es el noveno que B1 dejó fuera: su −0,26 comparaba el proveedor a 30-09 con la serie a 30-10.
- **Rendimiento a 12 meses.** 0,99 % a 31-10-2026 (0,99 % en la vieja). Pagos de la ventana: 1,10 % al año.
- **Pagos conocidos.** 10 pagos, anuales, del 12-12-2016 al 08-12-2025; 3 en la ventana, 0,8254 €.
- **Saltos.** Las mayores son de mercado, sin pago: 12-03-2020 −9,94 % (pares −10,15 %), 16-03-2020 −7,35 % (−7,14 %), 09-03-2020 −6,53 % (−6,86 %), 23-03-2020 −5,39 % (−4,42 %), 04-04-2025 −4,63 % (−5,00 %). Los pagos son de un 1 % y no llegan a esa lista; ese día cae más que sus pares en 10 de 10. Ninguna sin explicar.
- **Desde.** 30-12-1999 (lanzamiento, 01-10-1999). Mensual hasta 2009 y diaria desde 2010: no se ve, porque se dibuja desde 2016.
- **Hasta.** 03-11-2026 en la nueva, 28-10-2026 en la vieja. Mayor hueco: 7 días (18 a 25-06-2019). Sin paradas. Dos días de ago-2026 con valor distinto entre bases: 20-08 (32,16 y 32,01) y 25-08 (32,24 y 32,18), hasta un 0,47 %.

### LU0162660350

**BlackRock Global Funds - Euro Corporate Bond Fund A1.** Se puede dibujar. Es la clase A1 y solo le faltan los pagos: con ellos, exacta en 118 de 118 fines de mes y a 0,01 puntos de su hermana que acumula. A 10 años la línea baja un 7,2 % donde con pagos se gana un 4,4 %.

- **Identidad.** Mismo ISIN en el proveedor (F0GBR04EM2) y mismo nombre. Símbolo EODHD:LU0162660350.EUFUND en todos los documentos. CSSF: clase «A1» de EURO CORPORATE BOND FUND, compartimento en EUR. No hay KID en la caché: es el único de los nueve sin él. Nivel: 124 de 124 con razón 1,0000. A mano: 12,51 el 03-11-2026. Hermana A2 que acumula (LU0162658883): 3,53 % a 3 años frente a 3,52 %; correlación diaria 0,978, baja por el redondeo a 2 decimales.
- **Divisa.** De la clase, EUR; de la serie, EUR.
- **A 3 años.** Serie: 0,84 % al año (+2,5 %): 12,17 a 12,48, del 29-09-2023 al 30-09-2026. Proveedor: 3,53 % al año (+11,0 %) a 30-09-2026, la última cifra en caché. La serie con sus pagos da 3,52 %. Diferencia: 2,69 puntos; con los pagos quedan +0,004. La vieja tiene la misma fecha y la misma cifra.
- **Rendimiento a 12 meses.** 2,95 % a 30-09-2026 (2,69 % en el screener del 03-11). Pagos de la ventana: 2,75 % al año.
- **Pagos conocidos.** 124 pagos, mensuales, del 29-01-2016 al 30-09-2026; 36 en la ventana, 1,0162 €.
- **Saltos.** Las mayores son de mercado, sin pago: 18-03-2020 −2,14 % (pares −2,00 %), 17-03-2020 −2,10 % (−2,00 %), 13-03-2020 −1,54 % (−1,28 %), 13-06-2022 −1,43 % (−1,37 %), 14-03-2023 −1,23 % (−0,80 %). Los pagos son de un 0,2 % y un céntimo de VL ya es un 0,08 %, así que aquí el salto del pago no se distingue del redondeo (65 de 115): lo que lo prueba es la curva. Ninguna sin explicar.
- **Desde.** 23-05-2003, el lanzamiento, en la nueva; 01-02-2011 en la vieja. Mensual hasta 2009 y diaria desde 2010: no se ve, porque se dibuja desde 2016.
- **Hasta.** 03-11-2026 en la nueva, 28-10-2026 en la vieja. Mayor hueco: 6 días (23 a 29-12-2025). 11 tramos de 5 a 7 datos iguales en 10 años, los más largos del 14 al 24-11-2025 (13,04) y del 12 al 20-02-2026 (13,09), con sus pares a +0,04 % y +0,13 %: es un VL a 2 decimales en un fondo que se mueve poco, no una serie parada.

### LU0321373184

**Schroder International Selection Fund European Dividend Maximiser B Distribution QF.** Se puede dibujar. Es la clase B Distribución y solo le faltan los pagos, que es lo que hace grande la diferencia: 7,78 puntos frente a 7,08 de pagos sobre el VL, con 119 de 119 fines de mes exactos. Es donde más se nota: a 10 años la línea baja un 36,5 % y con pagos se gana un 28,7 %.

- **Identidad.** Mismo ISIN en el proveedor (F000000JYX) y mismo nombre. Símbolo EODHD:LU0321373184.EUFUND en todos los documentos. CSSF: clase «B DIS QF» de EUROPEAN DIVIDEND MAXIMISER, compartimento en EUR. KID: «Clase B Distribución EUR (LU0321373184)», distribución trimestral a un tipo fijo del 7 % anual. Nivel: 43 de 43 con razón 1,0000. A mano: 30,1375 el 03-11-2026. Sin clase hermana en el catálogo.
- **Divisa.** De la clase, EUR; de la serie, EUR.
- **A 3 años.** Serie: 6,37 % al año (+20,4 %): 24,9798 a 30,0643, del 31-10-2023 al 30-10-2026. Proveedor: 14,16 % al año (+48,8 %) a 31-10-2026. La serie con sus pagos da 14,17 %. Diferencia: 7,78 puntos; con los pagos quedan −0,010. A 30-09-2026, la fecha de la vieja: 7,63 y +0,014.
- **Rendimiento a 12 meses.** 6,77 % a 31-10-2026 (6,82 % en la vieja). Pagos de la ventana: 7,08 % al año.
- **Pagos conocidos.** 43 pagos, trimestrales, del 31-03-2016 al 24-09-2026; 12 en la ventana, 5,8451 €.
- **Saltos.** Las mayores son de mercado, sin pago: 16-03-2020 −10,31 % (pares −4,68 %), 12-03-2020 −10,01 % (−11,32 %), 09-03-2020 −9,35 % (−7,98 %), 15-04-2020 −5,02 % (−3,02 %), 24-02-2022 −5,01 % (−3,12 %). La mayor con pago: 30-06-2022 −4,23 % (pago −1,75 %, resto −2,48 %). Ese día cae más que sus pares en 40 de 40 pagos. Ninguna sin explicar.
- **Desde.** 05-10-2007, el lanzamiento, en la nueva; 03-01-2011 en la vieja; diaria.
- **Hasta.** 03-11-2026 en la nueva, 28-10-2026 en la vieja. Mayor hueco: 6 días (23 a 29-12-2025). Sin paradas.

### LU0404220724

**JPMorgan Investment Funds - Global Income Fund D (div) EUR.** Se puede dibujar. Es la clase D (div) y solo le faltan los pagos: con ellos, exacta en 119 de 119 fines de mes. A 10 años la línea baja un 18,4 % y con pagos se gana un 28,9 %.

- **Identidad.** Mismo ISIN en el proveedor (F000003WKM) y mismo nombre. Símbolo EODHD:LU0404220724.EUFUND en todos los documentos. CSSF: clase «JPM D DIV-EUR» de GLOBAL INCOME FUND, compartimento en EUR. KID: «JPM Global Income D (div) - EUR», LU0404220724. Nivel: 43 de 43 con razón 1,0000. A mano: 101,34 el 03-11-2026. Sin clase hermana en el catálogo.
- **Divisa.** De la clase, EUR; de la serie, EUR.
- **A 3 años.** Serie: 3,76 % al año (+11,7 %): 91,07 a 101,72, del 31-10-2023 al 30-10-2026. Proveedor: 9,11 % al año (+29,9 %) a 31-10-2026. La serie con sus pagos da 9,12 %. Diferencia: 5,35 puntos; con los pagos quedan −0,006. A 30-09-2026: 5,32 y +0,010.
- **Rendimiento a 12 meses.** 5,12 % a 31-10-2026 (5,09 % en la vieja). Pagos de la ventana: 5,22 % al año.
- **Pagos conocidos.** 43 pagos, trimestrales, del 12-02-2016 al 12-08-2026; 12 en la ventana, 15,08 €.
- **Saltos.** Las mayores, sin pago: 12-03-2020 −3,64 % (pares −3,96 %), 07-04-2025 −2,69 % (−2,31 %), 23-03-2020 −2,60 % (−1,63 %), 09-04-2025 −2,56 % (−0,25 %), 09-03-2020 −2,45 % (−2,82 %). Ese día cae más que sus pares en 40 de 40 pagos. Sin pago ni pares: el 09-04-2025, que recupera +2,77 % al día siguiente, en la semana de los aranceles; se supone que es mercado y hora de valoración.
- **Desde.** 08-07-2009, el lanzamiento, en la nueva; 03-01-2011 en la vieja; diaria.
- **Hasta.** 03-11-2026 en la nueva, 28-10-2026 en la vieja. Mayor hueco: 6 días (23 a 29-12-2025). Sin paradas.

### LU1095739733

**First Eagle Amundi Income Builder Fund Class AE-QD Shares.** Se puede dibujar. Es la clase AE-QD en euros y la diferencia no es divisa: serie y cifra están en EUR, y con los pagos queda exacta en 118 de 119 fines de mes; el que falla, octubre de 2026, es un día de desfase (0,09 %). A 10 años la línea sube un 6,2 % y con pagos un 75,9 %.

- **Identidad.** Mismo ISIN en el proveedor (F00000UEOH) y mismo nombre. Símbolo EODHD:LU1095739733.EUFUND en todos los documentos. CSSF: clase «AE QD» de INCOME BUILDER FUND. KID: «AE-QD», «LU1095739733 - Divisa: EUR», clase de distribución. Nivel: 43 de 43 con razón 1,0000. A mano: 114,74 el 02-11-2026. Sin clase hermana en el catálogo.
- **Divisa.** De la clase, EUR (el compartimento es en USD; el VL de la clase ya viene en euros); de la serie, EUR, sin conversión.
- **A 3 años.** Serie: 6,71 % al año (+21,5 %): 94,35 a 114,63, del 31-10-2023 al 30-10-2026. Proveedor: 12,24 % al año (+41,4 %) a 31-10-2026. La serie con sus pagos da 12,22 %. Diferencia: 5,53 puntos; con los pagos quedan +0,024, por un día: el proveedor cierra octubre con el VL del 29 (114,73) y la serie con el del 30 (114,63). A 30-09-2026: 5,39 y +0,012.
- **Rendimiento a 12 meses.** 4,89 % a 31-10-2026 (5,09 % en la vieja). Pagos de la ventana: 5,04 % al año.
- **Pagos conocidos.** 43 pagos, trimestrales, del 29-02-2016 al 31-08-2026; 12 en la ventana, 15,7892 €.
- **Saltos.** Las mayores: 16-03-2020 −4,68 % (pares −2,17 %), 09-03-2020 −4,54 % (−3,54 %), 12-03-2020 −4,38 % (−1,57 %), 23-03-2020 −2,98 % (−2,91 %), 28-02-2020 −2,97 % (en fecha de pago: pago −1,23 %, resto −1,74 %; pares −2,40 %). Ese día cae más que sus pares en 40 de 40 pagos. Sin pago y con pares muy por debajo: 12-03-2020, en plena COVID y con solo 4 pares, y 05-12-2022 −1,49 % (−0,49 %).
- **Desde.** 03-09-2014, el lanzamiento de la clase; diaria.
- **Hasta.** 02-11-2026 en la nueva, 27-10-2026 en la vieja. Mayor hueco: 6 días (23 a 29-12-2025). Sin paradas.

## Los otros fondos a los que se pasó la misma prueba

### IE00BD5CTX77

**BNY Mellon Global Short-Dated High Yield Bond Fund EUR H Acc Hedged (decisión 55).** Es una clase que acumula: el proveedor la declara `Acc`, 40 de 40 fechas de su registro de pagos coinciden con la serie, y la serie
sola iguala su curva de rentabilidad total (0,00 % en 118 meses). Con los 40 «pagos» de ese registro se pasaría un 52 %. A 3 años, 5,33 % la serie y 5,34 % el proveedor; a 3 y 5 años justos, 5,339 % y 3,164 % los dos, sin
diferencia. Su rendimiento del 4,97 % activaba la regla de la decisión 8 y por eso salía de simulación y frontera sin que le faltara nada, con un rótulo que no era cierto.

### LU0857700040

**Fidelity Funds - European Dividend Fund A-MINCOME(G)-EUR (decisión 55).** Su serie no es el valor liquidativo hasta 2026. La razón con el proveedor es 0,691 en 2016, sube en cada pago hasta 0,995 en febrero de 2026 y es 1 desde
el 02-03-2026; solo 8 de 130 fechas de pago coinciden. Lleva dentro los pagos hasta entonces, así que «sin dividendos» es falso en casi toda la línea, y tampoco es la rentabilidad total: a 3 años queda a 0,58 puntos del proveedor y
a 5, a 0,34. Deja de dibujarse hasta aclararla, y sigue fuera del cálculo.

Al aplicarla se midió de dónde sale. En la base vieja cada punto trae `close` y `adjusted_close`, y la serie es el segundo: `value` coincide con `adjusted_close` en 3.509 de 3.509 puntos, y `close` iguala el valor liquidativo del
proveedor en 126 de 126 fechas de pago con ese dato, por 4 de 126 la serie. Es el cierre ajustado del proveedor de precios, no el valor liquidativo. Que por eso baste con leer `close` para arreglarla era un supuesto, y se comprobó el mismo día.

**Aclarada con la decisión 72.** La serie se rehízo con `close`, que trae la respuesta del proveedor ya guardada en la caché: 3.601 de 3.601 puntos hasta el 03-11-2026, e iguala su valor liquidativo en 130 de 130 fechas de pago, donde la anterior acertaba en 8. De los 758 fondos de esa caché es el único con alguna diferencia entre los dos cierres. Por eso ya no está en `reviews` de la política: se dibuja con «Valor liquidativo, sin dividendos», como los demás que reparten, y sigue fuera del cálculo. Se aparta del proveedor 3,55, 3,56 y 3,80 puntos a 3, 5 y 10 años, que son sus pagos. En la base vieja, que no se reescribe, la serie sigue siendo la de antes.

### LU2133220793

**Robeco Sustainable Asian Stars Equities DL EUR (decisión 57).** No reparte y tenía el mismo bloqueo y la misma frase. A 3 años, 19,56 % la serie y 19,63 % el proveedor, y a 3 años justos 19,625 % los dos. Hay una sola diferencia, de
0,56 % en julio de 2024, corregida en agosto. Mayor hueco, 8 días, del 23 al 31-01-2025. El bloqueo se levanta: la frase ya no se sostiene.

### IE00BF0GL212

**Polar Capital Funds PLC - Artificial Intelligence Fund RAcc (decisión 57).** Sigue bloqueado. Su serie se para el 18-06-2026 en las dos bases mientras el proveedor sigue (36,12 el 29-10-2026), con diferencias de hasta un 2,65 % en ene-mar de 2021.

**Los otros tres que ya se dibujaban pasan:** Barings IE0004868828 (11 de 11 fechas, quedan +0,013), DWS Strategic LU1740985814 (7 de 8, quedan −0,011) y JPMorgan Taiwan LU0117843481 en USD, su divisa (11 de 11).

## La correlación

La línea de una clase que reparte cae cada vez que paga, así que medir con ella falsea la correlación. Con la mediana de sus pares de categoría, semanal a 3 años, sin pagos y con pagos:

| ISIN | Fondo | Sin pagos | Con pagos | Pares |
|---|---|---|---|---|
| DE0005318406 | DWS ESG Stiftungsfonds LD | 0,69 | 0,76 | 9 |
| FR0013460961 | EdR SICAV - Short Duration Credit B EUR | 0,45 | 0,90 | 15 |
| IE00BYYPF581 | Aegon Global Diversified Income Fund A Inc EUR | 0,79 | 0,80 | 21 |
| IE00BZ18VT34 | BNY Mellon Global Infrastructure Income Fund EUR A Inc | 0,81 | 0,82 | 4 |
| LU0102219945 | Goldman Sachs Europe CORE Equity Portfolio Base Inc EUR | 0,97 | 0,97 | 25 |
| LU0162660350 | BlackRock Global Funds - Euro Corporate Bond Fund A1 | 0,97 | 0,95 | 16 |
| LU0321373184 | Schroder International Selection Fund European Dividend Maximiser B Distribution QF | 0,75 | 0,81 | 3 |
| LU0404220724 | JPMorgan Investment Funds - Global Income Fund D (div) EUR | 0,83 | 0,90 | 21 |
| LU1095739733 | First Eagle Amundi Income Builder Fund Class AE-QD Shares | 0,71 | 0,76 | 4 |

Por eso el Comparador no mide con esas líneas, ni en pantalla ni en papel (decisión 53). Los pares son los fondos de su categoría con serie en el catálogo, y en BNY Mellon Infrastructure, First Eagle y Schroder son solo 3 o 4.

## La excepción: la clase cuya serie ya iguala al proveedor

**Se puede decidir con lo guardado, sin marca ni lista de ISIN.** `fund_distributions.serie_iguala_al_proveedor` compara la serie guardada con las cifras a varios años que la base guarda del proveedor, al corte del proveedor y con su
convención, de fin de mes a fin de mes y por años justos. Cada ventana publicada de 3, 5 y 10 años tiene que quedar a 0,10 puntos al año o menos, que es la tolerancia de `fund_return_basis`. Hacen falta al menos dos ventanas y la misma divisa: no saber si iguala
no es saber que iguala.

**Cuántos caen en ella: uno de los 14 con rendimiento positivo, BNY H Acc, en las dos bases.** Con lo guardado el 05-11-2026:

| ISIN | Fondo | Corte | 3 años | 5 años | 10 años | ¿Iguala? |
|---|---|---|---|---|---|---|
| DE0005318406 | DWS ESG Stiftungsfonds LD | 30-09-2026 | 2,228 | 1,919 | 1,852 | No |
| FR0013460961 | EdR SICAV - Short Duration Credit B EUR | 30-09-2026 | 3,035 | 2,449 | Sin cifra | No |
| IE0004868828 | Barings International Umbrella Fund - Barings ASEAN Frontiers Fund Class A EUR Inc | 30-09-2026 | 1,892 | 1,386 | 1,051 | No |
| IE00BD5CTX77 | BNY Mellon Global Short-Dated High Yield Bond Fund EUR H Acc Hedged | 30-09-2026 | 0,000 | 0,000 | Sin cifra | **Sí** |
| IE00BYYPF581 | Aegon Global Diversified Income Fund A Inc EUR | 30-09-2026 | 5,765 | 5,772 | 5,425 | No |
| IE00BZ18VT34 | BNY Mellon Global Infrastructure Income Fund EUR A Inc | 30-09-2026 | 5,766 | 5,683 | Sin cifra | No |
| LU0102219945 | Goldman Sachs Europe CORE Equity Portfolio Base Inc EUR | 30-09-2026 | 1,381 | 1,548 | 1,510 | No |
| LU0117843481 | JPMorgan Funds - Taiwan Fund A (dist) USD | 30-09-2026 | 0,829 | 1,165 | 1,181 | No: la clase es en USD |
| LU0162660350 | BlackRock Global Funds - Euro Corporate Bond Fund A1 | 30-09-2026 | 2,686 | 1,939 | 1,175 | No |
| LU0321373184 | Schroder International Selection Fund European Dividend Maximiser B Distribution QF | 31-10-2026 | 7,788 | 7,183 | 6,999 | No |
| LU0404220724 | JPMorgan Investment Funds - Global Income Fund D (div) EUR | 30-09-2026 | 5,313 | 4,769 | 4,587 | No |
| LU0857700040 | Fidelity Funds - European Dividend Fund A-MINCOME(G)-EUR | 30-09-2026 | 0,577 | 0,337 | 0,163 | No |
| LU1095739733 | First Eagle Amundi Income Builder Fund Class AE-QD Shares | 30-09-2026 | 5,385 | 5,262 | 5,178 | No |
| LU1740985814 | DWS Strategic Dynamic LD | 30-09-2026 | 0,037 | 0,407 | Sin cifra | No |

Son puntos al año entre la serie y el proveedor en la base nueva; en la vieja, BNY H Acc da lo mismo. Mirado mes a mes contra la curva del proveedor, BNY H Acc cumple en 82 de 82 meses a 3 años y en 58 de 58 a 5, con diferencia 0,00.

**Dos que se quedan cerca, y por qué no entran.** DWS Strategic Dynamic LD reparte muy poco: 0,037 a 3 años y 0,407 a 5. Si solo se mirara a 3 años, entraría. Y Fidelity, por eso mismo, no se decide con esta regla sino con su revisión:
mes a mes habría pasado en 77 de 82 meses a 3 años y en 53 de 58 a 5, porque su serie lleva dentro casi todos los pagos. Hoy no pasa (0,577 y 0,337), y la regla sola no lo habría detectado hasta mayo de 2026, dos meses después de que su serie dejara de llevar pagos dentro. Son cifras de antes de rehacerla con la decisión 72: con su valor liquidativo queda a 3,546, 3,563 y 3,796, lejos de la regla.

## Los límites

- Sin contraste con el VL oficial de cada gestora, porque la revisión no salió a internet. La serie (EODHD) y el proveedor (Morningstar) coinciden a todos los decimales en 435 de 435 fechas de pago y en 1.000 de 1.003 fines de mes (fallan DWS, EdR y First Eagle, dichos en su fondo), lo que puede querer decir que beben del mismo sitio; fund_return_basis.py ya avisa de que la curva no es una fuente independiente. Lo que no sale de esa comparación son la clase hermana (4 de 9) y el KID o la CSSF, que confirman la clase y no el VL. Para cerrarlo a mano basta una fecha por fondo en la web de la gestora: en cada identidad va una.
- Entre un fin de mes y una fecha de pago, los valores diarios no tienen con qué cotejarse. Por eso la aguja de BNY del 04-02-2025 queda sin resolver.
- La nube no se ha leído: todo es local. Que las series de producción sean las mismas es un supuesto.
- El registro de pagos del proveedor empieza en 2016 o en el lanzamiento, y antes los saltos no se pueden casar con pagos. No se dibujan: ficha y comparador llegan como mucho a 10A. Antes de 2010 Goldman y BlackRock solo tienen dato mensual.
- Ninguno de los nueve es de otra divisa. JPMorgan Taiwan (LU0117843481) no está entre ellos: es de los 5 que ya se dibujan. En USD, su divisa, la serie da 42,57 %, el proveedor 43,34 % y con pagos 43,37 %: es reparto. Si se compara con la cifra en EUR (40,75 %) sale −1,81, y eso sí sería divisa.
- Lo que cuesta el rótulo. A 10 años la línea enseña: Schroder −36,5 % (con pagos +28,7 %), JPMorgan −18,4 % (+28,9 %), BlackRock −7,2 % (+4,4 %), Aegon −6,1 % (+59,6 %), First Eagle +6,2 % (+75,9 %). El rótulo es lo único que separa esa línea de una pérdida delante del cliente.
- La cifra de B1 se corrige. Decía 8 de 9 y de 1,67 a 7,78 puntos; con fechas alineadas son los 9 y de 1,39 a 7,78 (a 30-09: de 1,40 a 7,63). La novena era Goldman (−0,26, de verdad 1,39) y el 1,67 era DWS (de verdad 2,24). Comparó el proveedor a 30-09 con la serie a 30-10 en 6 de los 9 porque read/card.metrics.as_of dice 31-10 y la rentabilidad es de 30-09: calidadYTarjeta.ts:597 toma la fecha del riesgo. Pasa en 44 de las 85 tarjetas con cifras del proveedor en la base nueva, y esa fecha llega al lector como la de las cifras (lector_base_nueva.py:146); no se ha mirado en pantalla.
- De paso: lo que tenemos como pagos no son pagos. distribuciones.historial y declared/distributions.payments son la suma del año con la fecha del último pago, comprobado en las 5 filas de los 9: Aegon, 01-12-2025, 0,4437 € son 12 pagos. Cualquiera que case esas filas con una caída diaria concluirá que no cuadran. El registro completo está en la caché (ETFsnapshot.DistributionHistory, de 5 a 124 pagos por clase) y el extractor no lo guarda. Cambia la premisa de la opción B de la decisión 8 («hoy tenemos de 1 a 5 pagos»): con él, los 9 dan la cifra del proveedor. Es la decisión 56.
- De paso: BlackRock A2 (LU0162658883) trae ter_pct 1,81 % del screener, frente a 1,01 % del KID y de sal_quote y 1,0135 % de MiFID. A1 y A2 rinden lo mismo a 0,01 puntos al año, así que el 1,81 no es cierto.

## Quién lo validó, y qué

Óscar, el 05-11-2026, sobre esta revisión resumida en la página de la auditoría:

| Decisión | Qué eligió | Dónde queda |
|---|---|---|
| 53 | Los nueve se dibujan con «Valor liquidativo, sin dividendos», sin entrar en el cálculo, y salen de la correlación del Comparador | `draw_after_review` en su política, con `blocked` en pie |
| 54 | Quitar el punto del 04-02-2025 de BNY Mellon Global Infrastructure | `excluded_dates` y `excluded_dates_notes` en su política |
| 55 | BNY H Acc vuelve al cálculo y sin rótulo. Fidelity deja de dibujarse hasta aclarar su serie, y la ficha dice por qué | `serie_iguala_al_proveedor`, sin marca. Lo de Fidelity duró hasta la 72 |
| 57 | Levantar el bloqueo de Robeco. Polar sigue bloqueado | Robeco sale de `assets` y queda anotado en `reviews`; Polar sigue en `assets`, con el motivo que de verdad tiene |
| 72 | Rehacer la serie de Fidelity con el valor liquidativo y tratarlo como a los demás que reparten | Sale de `reviews`; `close` en `vl_fondos.serie_de_simbolo` |
| 96 | Rendimiento valora a los nueve con su valor liquidativo y los dividendos del extracto. Polar sigue parando, con su motivo | `_load_price_points` en `portfolio_real/service.py`; `blocked` sigue en pie para lo demás |

La 56, reconstruir la rentabilidad total con el registro completo de pagos, se hace después de publicar y no está aquí.
