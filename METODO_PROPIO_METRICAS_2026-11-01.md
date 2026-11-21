# El método propio de métricas

*1 de noviembre de 2026. Decisión de Óscar; especificación medida sobre el código por Claude
Opus 5.*

**El método es nuestro.** No es el de Morningstar ni el de ningún tercero. Los parámetros los
elegimos nosotros y los cambiamos nosotros cuando haya razón, mientras sean lógicos y coherentes
con la definición matemática de cada fórmula.

Este documento es la definición de ese método, para que `EXTRACTOR_MONTHLY_V1` —el valor que
viaja en `instrument-computed-metrics.v2.inputs.method`— apunte a algo preciso y no a una frase.
Describe lo que el código **hace hoy**, leído de `1-extractor/core/metricas.py`, y marca aparte
lo decidido y no construido. Ese fichero contiene **dos** métodos desde el 02-11-2026, y este
documento define el de los fondos: ver §4 para el de las acciones y para en qué se diferencian.

**La versión vigente en el código es la 4** (`EXTRACTOR_MONTHLY_V4` y `EXTRACTOR_DAILY_V4`, MET-6 y
MET-7 de la auditoría integral; Óscar eligió hacerla el 17-11-2026): qué cambia y cuánto, en «La versión
4» de la §4. **La base y la nube están en la 4 desde el 17-11-2026**, recalculadas y subidas con su
aprobación (A-179, A-189 y A-190; lo recoge `AUDITORIA_INTEGRAL_2026-11-16.md`). Leído otra vez en la base local el
20-11-2026: las 1.281 métricas llevan `EXTRACTOR_MONTHLY_V4` (761) o `EXTRACTOR_DAILY_V4` (520); el catálogo de la nube no se ha vuelto a leer desde esa subida. Antes estuvieron en
la 3 (`EXTRACTOR_MONTHLY_V3` y `EXTRACTOR_DAILY_V3`, decisiones A-158 y A-166), recalculadas y subidas el 16-11-2026. Las fórmulas de la §2 son las de la versión 4; donde la 3 o la 2 eran distintas, se dice.

Lo que dice el contrato y conviene repetir: el método, la frecuencia, la divisa y la fecha son
**la mitad del valor de la cifra**. Un número sin ellos no se puede comparar ni defender.

---

## 1. De dónde sale: la serie, no una cifra

Entrada única: la **serie diaria de valores liquidativos** de la clase, de EODHD. Ninguna cifra
de este método viene de un tercero ya calculada. **Desde el 11-11-2026 (D-9)**, cuando la serie de EODHD se para y el fondo
está en la lista declarada, sigue con la de Morningstar, que también es la serie diaria de valores liquidativos y no una cifra
calculada; cada tramo dice su fuente y la versión del método no cambia.

La serie viaja con lo que permite auditarla, y por eso se puede confiar en ella:
`observations_count`, `first_date`, `last_date`, `source_history` y `source_listing_id`. El
extractor además detecta y marca las series **paradas** (`aviso_vl`, con los días de parada) y
las **rupturas** —un valor liquidativo que se multiplica o divide por más de **2,0** de un día
a otro, que delata un desdoblamiento o un cambio de clase— y recorta la serie al tramo posterior
a la ruptura.

**Un dato suelto que salta y vuelve no es una ruptura: se descarta y se dice** (decisión A-166 de
Óscar, 16-11-2026; versión 3). La regla solo corta en el cambio de nivel que **persiste**. Un pico es
un único dato B entre A y C tal que de A a B hay ruptura, de B a C hay otra y de A a C no la hay: la
serie ha vuelto a su nivel. Ese dato se quita antes de calcular nada y la ficha lo lleva en
`riesgo.historial_precios.picos_descartados`, con su fecha, su valor y los dos que lo rodean
(`core/metricas.py::sin_picos`).

- **Medido el 16-11-2026:** de los 11 fondos con ruptura, 10 son cambios de nivel de verdad (la
  redenominación a euros de 1999, un cambio de unidad en 2021, una reestructuración en 2022) y uno es
  un pico: Carmignac Portfolio Investissement A EUR Acc (`LU1299311164`), el 10-01-2013, de 79,2 a
  905,2 y vuelta a 78,5. Hoy no cambia ninguna cifra publicada, porque todas sus ventanas empiezan
  después. Protege del día en que la fuente dé un dato malo reciente: con la regla de antes, un fondo
  sano se quedaba sin toda su historia anterior.
- **«Vuelve» se mide con el mismo factor 2,0** (`PICO_VUELTA_FACTOR`): quitado el dato, la serie no
  tiene ruptura ahí. La decisión no fija esa tolerancia, y el único caso medido vuelve a un 0,9 % de
  donde estaba; tiene nombre propio para poder estrecharla. **Confirmada por Óscar el 17-11-2026 (A-182):** se queda el factor 2, el mismo de la ruptura.
- **El salto en el último dato de la serie sigue cortando.** Todavía no ha vuelto, y no se puede
  distinguir de un cambio de unidad hasta que llegue el dato siguiente. Si vuelve, se quita y la
  historia reaparece en la pasada siguiente.
- **La serie que se exporta para la aplicación no se toca**: lleva el dato, como lleva la historia
  anterior a una ruptura. Lo que se limpia es la serie con que se calcula.

## 2. Las fórmulas, con sus parámetros

Todo en porcentaje (2.5 = 2,5 %), redondeado a **4 decimales**.

| Magnitud | Cómo | Parámetros nuestros |
|---|---|---|
| Rentabilidad a plazo | Acumulada a 1, 3 y 6 meses, en lo que va de año y 1 año | Valor inicial: el último publicado en o antes de la fecha objetivo |
| Rentabilidad anualizada | `(VL final / VL inicial)^(1/N) − 1` a 3, 5 y 10 años | Si la serie no llega al inicio, el plazo **no se publica** |
| Tolerancia de inicio | — | **10 días**: si el valor inicial es más viejo, no se publica |
| Hueco en la ventana | Días seguidos sin un solo punto, contados desde el último punto anterior al inicio | **33 días** en el método mensual desde la versión 4 (antes 31) y **31** en el diario: con más, la ventana **no se publica**, sea la cifra que sea. Desde la versión 4, también el año natural. Ver abajo |
| Cierre de mes | El último valor liquidativo del mes, **si es del final del mes** | **Versión 4.** Si tras él quedan en el mes más de **5 días de lunes a viernes**, el mes no tiene cierre y la ventana que lo necesita no se publica. Hasta la 3, el último valor del mes era su cierre fuera del día que fuera. Ver «La versión 4» en la §4 |
| Año natural | Del cierre de diciembre al cierre de diciembre | Solo años completos, los **10** más recientes. **Versión 4:** el diciembre es un cierre de mes como los demás (antes, 10 días naturales de tolerancia) y el año con un hueco de más de 33 días no se publica |
| Volatilidad | Desviación típica **muestral** de las rentabilidades mensuales × √12 | Ventanas de **12, 36, 60 y 120** meses |
| Rentabilidades mensuales | De cierre de mes a cierre de mes | Ventana acabada en el **último mes completo**, con todos sus cierres |
| Sharpe | media(exceso mensual sobre €STR) × 12 / (desv. típica(exceso) × √12) | Sin €STR para **todos** los meses de la ventana, no hay Sharpe |
| Tipo sin riesgo de un mes | Lo que rinde el €STR, **capitalizado en base act/360**, entre las dos fechas de los valores liquidativos con que se mide ese mes | **Versión 3.** Cada noche usa el último €STR publicado en o antes de ella, como mucho **7 días** viejo. En la 2 era el €STR medio del mes entre 12. Ver «El tipo libre de riesgo» |
| Sortino | media(exceso mensual sobre €STR) × 12 / (desviación a la BAJA × √12) | Mismo exceso y mismo €STR que el Sharpe; la desviación a la baja divide entre **todas** las observaciones, no solo las negativas. Sin un mes por debajo del €STR no hay Sortino: el denominador es cero y no se publica |
| Caída máxima | Peor caída desde un máximo, con valores **diarios** | Una por ventana: **12, 36, 60 y 120** meses. La ventana que la serie no cubre no se publica |
| Fecha de la métrica | Cierre de mes (`cierre_mensual`), publicado en `as_of` | El valor liquidativo, en cambio, es el último publicado. Un fondo que aún no ha publicado su último valor del mes cierra en el mes anterior; ver el final de la §3 |
| Divisa | **Euros.** La serie se convierte antes de calcular, con el cambio de referencia del BCE de cada día | Vale el último cambio de hasta **7 días** antes; un punto sin cambio se descarta, y una serie sin cambio no da ninguna cifra. Una clase ya en euros no se convierte. Ver §5 |

### Una ventana con hueco no se publica

*Decisión 111 de Óscar, 05-11-2026; en el método mensual son 33 días desde la versión 4, abajo.* Una ventana con más de **31 días** seguidos sin un solo punto no
mide lo que dice su plazo: AB American Growth no tiene puntos del 18-07-2018 al 07-09-2022, y su
caída «a 5 años» medía solo desde el final del hueco. De esa ventana no se publica nada —rentabilidad,
volatilidad, Sharpe, Sortino, caída ni las cifras frente al índice—, y el hueco queda escrito con sus
ventanas en `computed/metrics.inputs.series_gaps`. Una serie que empieza tarde no tiene hueco: eso lo
decide la tolerancia de inicio, que sigue en 10 días. El hueco se cuenta desde el último punto anterior
al inicio porque ese es el valor del que la ventana parte.

Se midió antes de fijarlo, sobre las ventanas publicadas el 05-11-2026:

| Hueco de más de | Instrumentos que pierden alguna ventana | Lo que hay entre este umbral y el siguiente |
|---|---|---|
| 10 días | 43 | 26 caen solo entre 11 y 14 días; unos 15 son fondos de Asia con huecos en las fechas del Año Nuevo lunar o la Semana Dorada, coincidencia no contrastada con un calendario |
| 14 días | 17 | Ferrovial (31 días), DWS Gold (25) y TREA (15) |
| 31 días | 14 | De 32 días, Cementos Molins, a casi 7 años, Gestión Boutique V |

**Son 31 porque el método mide por meses:** es lo que separa dos cierres de mes en el mes más largo, y
un fondo que publica una vez al mes no tiene ningún hueco. La lista de quién pierde qué está en lo
constatado de la decisión 111.

**Eso no era exacto, y se vio al construir la versión 4.** Dos cierres de mes seguidos, cada uno en su último
laborable, pueden separarse 33 días: del viernes 28-11-2025, con el 29 y el 30 en fin de semana, al miércoles
31-12-2025. Con 31, un fondo que publica una vez al mes tenía «huecos»: medido el 17-11-2026 sobre la
exportación, a Brightgate Focus (`ES0114904008`) le habrían costado los años naturales 2016 y 2017, con 32 días
entre dos de sus cierres. **Óscar lo cambió el 17-11-2026: en el método mensual el hueco es de más de 33 días**
(`HUECO_MAXIMO_DIAS`). No devuelve ninguna cifra publicada ni quita ninguna: la única que cambia es esa, que
con 31 se habría perdido con la versión 4.

**El diario sigue en 31** (`HUECO_MAXIMO_DIAS_DIARIO`). El argumento de los 33 es de cierres de mes, y en una
acción un tramo de 32 días es un mes sin cotizar: con 33, Cementos Molins, que estuvo 32 días sin cotizar,
recuperaría su volatilidad a cinco años, y la decisión 111 la dejó fuera sabiéndolo (está en su tabla). Las
relativas de una acción son mensuales y van con los 33; medido, no cambia ninguna. Y el relleno de los huecos
de una serie con Morningstar (`serie_de_respaldo`, D-10) sigue en 31: rellenar un hueco de 32 días con datos
que cuadran no quita ninguna cifra.

**Desde la versión 4 el año natural también la aplica** (MET-7): un año con un hueco de más de 33 días no
mide el año, y no se publica. Hasta la 3, el año natural no miraba huecos.

**No es una retirada (§10):** la cifra falta porque esa ventana no se puede medir, como cuando la
serie no llega al inicio, y el porqué queda escrito. **Y no cambia la versión del método,** por lo mismo
que en la §7: solo quita ventanas, y lo que queda sale igual. En los demás instrumentos ninguna ventana
tiene un hueco de más de 31 días, así que la regla no les cambia nada. Lo vigila
`1-extractor/tests/test_ventana_con_hueco.py`.

### El tipo libre de riesgo

El **€STR del BCE**, serie `EST/B.EU000A2X2A25.WT` de `data-api.ecb.europa.eu`. Se promedia
sobre la ventana, así que **varía por ventana**, como debe: medido el 01-11, 2,014 % a un año,
2,778 % a tres y 2,082 % a cinco. Esa forma —el trienio de las subidas por encima del
quinquenio, que incluye los años de tipos negativos— es la comprobación de que el promedio es
real y no un valor fijo.

**El promedio tiene que cubrir la ventana entera, y la ficha dice hasta dónde llega** (09-11-2026). El
09-11 las acciones y el export pedían el mismo €STR a la caché con caducidades distintas (7 y 1 días), y la
pasada con red promedió una serie que acababa un día antes del fin de la ventana: `rf_pct` 2,0696 % a un año
en vez de 2,0711 %, con el mismo cierre. Desde `251c0ba` la petición es una sola (`fetchers/estr_bce.pide`,
caducidad de un día) para acciones, fondos y export; la ficha lleva `riesgo.historial_precios.rf_hasta`, la
última fecha de €STR que entra en la media, para que la cifra sea reproducible; y si al €STR le faltan más de
**3 días hábiles** hasta el fin de la ventana (`RF_TOLERANCIA_DIAS_HABILES`: un día por la publicación en T+1
del BCE, otro por la edad admitida de la caché y otro por un cierre de TARGET con bolsa abierta) se añade
`rf_incompleto` con la fecha y los días que faltan. El Sharpe no se suprime por eso —la §3 solo lo quita si
falta el tipo—: se marca. Un día de €STR mueve el `rf_pct` a un año 0,0015 puntos y el Sharpe como mucho
0,0009. El Sharpe mensual de fondos y ETF no lleva `rf_hasta` todavía: un último mes con pocos días de €STR
promedia en silencio, y queda anotado. No cambia ningún parámetro, así que la versión del método no cambia.

**En el método mensual el tipo de cada mes capitaliza con su base de días** (decisión A-158 de Óscar,
16-11-2026; versión 3). Hasta la versión 2 el tipo de un mes era la media del €STR de ese mes entre 12:
no capitalizaba, usaba de hecho una base 30/360 y no miraba cuántos días separaban los dos valores
liquidativos. Un fondo que devengara exactamente el €STR salía con un Sharpe de 0,80 a 1,07, con un
exceso que no existía. Ahora (`core/metricas.py::rf_entre`):

- El €STR es un tipo a un día en **act/360**. El de la fecha T se devenga desde T hasta el siguiente
  día con dato —el del viernes, tres noches—, y cada tramo capitaliza sobre el anterior:
  `Π (1 + tipo_T / 100 × días_T / 360) − 1`. Es la convención del índice compuesto del BCE.
- Se mide **entre las dos fechas** de los valores liquidativos del mes, no sobre el mes natural: al
  fondo se le resta lo que el €STR rindió en sus mismos días. El fondo que devenga justo el €STR da
  un exceso de cero cada mes, y por eso no tiene Sharpe (abajo).
- **Cada noche necesita su tipo.** Vale el último €STR publicado en o antes de ella, hasta **7 días**
  viejo (`RF_ARRASTRE_MAX_DIAS`; el hueco más largo del calendario de TARGET son cuatro noches). Si a
  una noche le falta, ese mes no tiene tipo y esa ventana no tiene Sharpe: no se rellena hacia atrás
  ni se arrastra un tipo de hace un mes. Antes bastaba un dato en el mes natural.
- **El tipo que se publica de la ventana (`rf`) deja de ser el €STR medio.** Es lo que el €STR rindió
  de media al mes, por 12: un 2,00 % medio se lee 2,03 %, por la base 360 y la capitalización.
- **La desviación «exactamente cero» de la §3 es, en un cálculo, menor que 10⁻¹²** mensual
  (`DESVIACION_NULA`). El fondo que devenga justo el €STR da excesos de 10⁻¹⁷, que es ruido de coma
  flotante y no un riesgo; un valor liquidativo con seis decimales ya mueve la rentabilidad en 10⁻⁸,
  así que ningún fondo real se acerca. No es un umbral que oculte nada.
- El **alfa de Jensen** usa el mismo tipo, entre las fechas del fondo.

El método diario de las acciones **no cambia en esto**: su Sharpe sigue restando el €STR medio de la
ventana a una rentabilidad anualizada. Mezcla una rentabilidad compuesta en días naturales con un
tipo simple en base 360 —unas 3 centésimas de punto con el €STR al 2 %—, y queda anotado: la decisión
A-158 habla del tipo mensual.

## 3. Las dos reglas que gobiernan el método

**El Sharpe no se suprime bajo ningún concepto.** Es una medida comparativa: solo sirve para
ordenar, y lo que tiene que cumplir es la fórmula y la misma escala para todo lo que se compara.
No hay umbral de volatilidad por debajo del cual se oculte. Los dos únicos casos en que no sale
no son decisiones: la volatilidad **exactamente cero**, que no se puede dividir, y la falta del
tipo libre de riesgo, que es un ingrediente que falta y no una elección. Como todo se calcula en euros
(§5), ese tipo es siempre el €STR: falta cuando el BCE no lo da para algún tramo de la ventana, y ya no
porque la clase esté en otra divisa. Lo que una clase en otra divisa puede no tener es el cambio del
BCE, y entonces no tiene ninguna cifra, no solo el Sharpe.

**Una sola escala, y nunca se ordena una cifra contra otra de escala distinta.** Misma divisa,
mismo tipo libre de riesgo, misma ventana, misma fecha de cierre y **mismo estimador** para todo
lo que entre en una comparación.

*El estimador entró en la condición el 03-11-2026, al revisar las normas con el papel de gestor
puesto.* Y no es un matiz: el estimador es la **fórmula y la frecuencia** de los rendimientos con
que se aplica. Cambiar la frecuencia cambia el estimador aunque la fórmula se parezca, porque
anualizar por √12 y por √252 (desde la versión 3, por la raíz de las observaciones que hay al año)
estima cantidades distintas sobre muestras distintas. Aquí además no
se parecen ni en la fórmula: el Sharpe mensual es media(exceso)×12 entre desviación×√12, y el
diario es (rentabilidad anualizada − €STR medio) entre volatilidad. Son dos estimadores, no uno a
dos frecuencias.

De ahí que la **identidad comparable** de una cifra sea el par `(method, window)`, y que todo lo
que ordene, reste, promedie o ponga en un percentil dos cifras tenga que comprobar ese par. Lo que
no prohíbe es enseñarlas juntas en una ficha: prohíbe **ordenarlas** juntas y hacer aritmética
entre ellas.

Lo que esto arregla de la §4: allí la prohibición de mezclar los dos métodos se deducía de que son
métodos distintos, o sea de acordarse. Ahora se deduce de la regla, así que un tercer camino de
cálculo quedaría cubierto el día que exista sin que nadie lo recuerde.

**La fecha de cierre depende de cuándo se refresca.** Medido el 04-11-2026: en la pasada del 2 de
noviembre por la noche, 188 de 703 fondos cerraban en septiembre, porque su último valor era del 27 al
29 de octubre. No es que no publiquen a fin de mes: 183 de los 188 traen valor el último día hábil en
al menos cinco de los seis meses anteriores. Es el retraso de la fuente. Por eso no se cambia la regla,
que obligaría a dar por cerrado un mes con un valor que no es el último, sino el momento:
`refrescar.mjs` avisa si menos del 95 % de los fondos comparte cierre y no sube sin
`--admite-cierres-mezclados`. Y cada cifra publica su cierre en `as_of`. Comparar lo enseña en la
cabecera cuando dos columnas difieren.

**Dentro de un mismo instrumento no hay dos cierres** (versión 4, MET-6). Las relativas se miden al cierre
del riesgo del fondo (`relativas` con `fin`), y si su índice no llega a ese cierre, no se dan y la ficha lo
dice (`sin_relativas_indice_sin_cierre(<último cierre en común>)`). Hasta la 3 se llamaban sin cierre: un
fondo que publicaba su valor el último laborable del mes cerraba su riesgo en ese mes y su beta en el
anterior, y un índice atrasado hacía lo mismo en silencio. En las acciones, cuyo riesgo es diario, la beta
cierra en su último cierre de mes, con la misma regla.

**El comparador entró en la identidad el 07-11-2026** (decisión 23 de `DECISIONES_DATOS_2026-11-07.md`),
al abrir el camino C: las cifras **relativas** —beta, R², alfa de Jensen, rentabilidad activa, tracking
error, ratio de información— se miden contra una serie, y esa serie puede ser el valor liquidativo de un
fondo índice, el precio de un ETF o el **nivel del propio índice**. No son lo mismo: el ETF lleva dentro su
coste corriente y su tracking (0,1-0,6 puntos de alfa según la fila, medido el 07-11) y el índice no lleva
nada, así que el mismo fondo da dos alfas distintos según contra qué se mida. Por eso la identidad
comparable de una métrica relativa es la terna `(method, window, benchmark.series_class)`, y una lista
que ordene por alfa agrupa por las tres. Las métricas propias del fondo siguen con el par.

**Estado:** escrito y **no hecho cumplir en código**. Ninguna pantalla ordena hoy por una de estas
cifras —medido el 02-11-2026: ninguna de las cuatro consultas de la aplicación ordena ni filtra—,
así que la regla llega antes que su primer infractor, que es cuando conviene que llegue.

## 4. Cambiar un parámetro cambia la VERSIÓN del método

Es la consecuencia directa de la regla de la escala única. Si se cambia la divisa, el tipo libre
de riesgo, una ventana o una convención, las cifras nuevas **no son comparables** con las viejas,
así que no pueden compartir identificador.

El valor de `inputs.method` existe para eso. Este documento define hoy la **versión 4**
(`EXTRACTOR_MONTHLY_V4`), la de MET-6 y MET-7. `EXTRACTOR_MONTHLY_V1` calculaba en la divisa de la clase;
la conversión a euros de §5 produjo `EXTRACTOR_MONTHLY_V2`, y las decisiones A-158 y A-166, la
`EXTRACTOR_MONTHLY_V3`. Mientras convivan cifras de versiones distintas, una no se ordena contra otra.

### La versión 4 (17-11-2026)

*MET-6 y MET-7 de la auditoría integral. Óscar eligió el 17-11-2026 «hacer ya la versión 4, con recálculo y
subida, como la versión 3». Construida, medida y probada, y **recalculada y subida ese mismo día**: la base y la nube
están en la 4 (`AUDITORIA_INTEGRAL_2026-11-16.md`).*

| Qué cambia | Versión 3 | Versión 4 | A qué cifras afecta |
|---|---|---|---|
| Cierre de mes (los dos métodos) | El último valor del mes, del día que fuera | Solo si tras él quedan en el mes **5 laborables o menos**; si no, el mes no tiene cierre (`es_cierre_de_mes`) | Volatilidad, Sharpe, Sortino, tipo publicado y relativas mensuales; los años naturales |
| Año natural | Diciembres con 10 días naturales de tolerancia; no miraba huecos | Los diciembres, cierres de mes como los demás; un hueco de más de 33 días lo tumba | Años naturales |
| Relativas | Se calculaban sin cierre: podían cerrar un mes antes que el riesgo | Al cierre del riesgo, o no se dan | Beta, R², alfa, rentabilidad activa, tracking error, ratio de información |
| Hueco (mensual) | Más de 31 días | Más de 33 días, lo que pueden separarse dos cierres de mes (§2; Óscar, 17-11-2026). El diario sigue en 31 | Hoy, ninguna publicada |

**La tolerancia: una semana laborable, confirmada por Óscar el 17-11-2026.** La tabla de abajo es con el hueco
de 33 días, también confirmado ese día. La auditoría pedía que un cierre
fuese «de verdad del final del mes»; la pregunta es cuánto antes del final puede caer. Medido sobre los
cierres de los últimos diez años de las series exportadas (88.082 de fondos y ETF):

| Laborables que quedan en el mes tras el último valor | Cierres | Qué son |
|---:|---:|---|
| 0 | 84.930 (96,4 %) | El último laborable |
| 1 | 2.944 (3,3 %) | Un festivo: Viernes Santo, el 31 de diciembre, el último lunes de agosto en Londres |
| 2 | 142 | Dos: Jueves y Viernes Santo en los fondos españoles, Acción de Gracias con su viernes, la Ascensión con su puente |
| 3 a 5 | 43 | Sobre todo el Año Nuevo lunar de enero de 2025 en los fondos de Asia, y fondos que valoran una vez por semana |
| 6 o más | 23 | Huecos de datos, salvo el fondo de Taiwán (abajo) |

Un fondo cuya bolsa está cerrada no tiene otro valor del mes, ni mercado que lo hubiera movido: su último
valor **es** su cierre. Por eso la más corta que se defiende no es la de 2 días, que es la que bastaría
con los festivos de aquí, sino la que deja pasar esos cierres. Lo que cuesta cada una, en fondos que
pierden la volatilidad:

| Tolerancia (laborables) | Instrumentos con alguna cifra menos | Volatilidad 3 años | 5 años | 10 años | Relativas publicadas (3 y 5 años) |
|---:|---:|---:|---:|---:|---:|
| 2 | 40 fondos y 2 acciones | 25 | 28 | 35 | 15 fondos y 2 acciones |
| 3 | 22 fondos y 2 acciones | 11 | 13 | 17 | 6 fondos y 2 acciones |
| 4 | 14 fondos y 1 acción | 5 | 7 | 11 | 4 fondos y 1 acción |
| **5** | **9 fondos** | **1** | **3** | **6** | **ninguna** |
| 7 | 3 fondos | 0 | 1 | 1 | ninguna |

Con 2, los que pierden sus ventanas de tres y cinco años son casi todos fondos de Asia y emergentes por
enero de 2025, cuando las bolsas de China y Hong Kong cerraron del 28 o el 29 al 31. Un «cierre» del día 5,
el caso de la auditoría, deja unos 18 laborables y cae con cualquiera de ellas. **El que la de 5 trata
mal** es JPMorgan Taiwan Fund (`LU0117843721`): la bolsa de Taiwán cerró del 23 al 31 de enero de 2025 y su
último valor, del 22, deja 7. Pierde sus cifras a tres, cinco y diez años hasta que enero de 2025 salga de
cada ventana. Con 7 no las perdería, y dejaría pasar cierres de más de una semana antes del final.

**Medido el 17-11-2026, antes de recalcular**, aplicando la regla de la 3 y la de la 4 a las mismas series
(la exportación del extractor del 16-11, `export_series`, con los cambios del BCE y el €STR exportados; sin
red y sin bases). El arnés reproduce la versión 3 publicada: **31.040 cifras iguales y ninguna distinta**.

- **Ninguna cifra cambia de valor.** Las que cambian dejan de salir: son ventanas que, por la regla nueva,
  no tienen todos sus cierres. Las rentabilidades a plazo y las caídas máximas no cambian en ninguno.
- **9 de los 763 fondos y ETF de método mensual pierden alguna cifra, y ninguna acción** (con el hueco de 33
  días; con el de 31 eran 10):

| Instrumento | Mes sin cierre (laborables que deja) | Pierde |
|---|---|---|
| JPMorgan Taiwan Fund D (acc) USD | enero de 2025 (7) | Volatilidad a 3, 5 y 10 años; Sharpe y Sortino a 3 y 5 |
| DWS Invest Gold and Precious Metals Equities LC | junio de 2022 (9) | Volatilidad a 5 y 10 años; Sharpe y Sortino a 5 |
| Groupama Global Inflation Short Duration NC | diciembre de 2021 (6) | Volatilidad, Sharpe y Sortino a 5 años; años 2021 y 2022 |
| Robeco Asia-Pacific Equities, Emerging Stars Equities, QI Emerging Markets Active Equities y Asian Stars Equities | enero de 2017 (6) | Volatilidad a 10 años |
| Échiquier World Equity Growth A · MFS Meridian Prudent Capital A1 EUR | — (hueco del 3-5-2021 al 19 o 20-8-2021) | Año 2021 |

- **Las relativas (MET-6) no cambian hoy en ninguno.** Las de los 242 fondos con relativas cierran el
  31-10-2026, el mismo mes que su riesgo, porque la pasada fue a mitad de mes; las de las 500 acciones con
  beta, también. El defecto era latente: aparecía al refrescar el último laborable de un mes o con un índice
  atrasado. Quedan sin medir los 4 fondos cuyo índice es el nivel del propio índice (`INDX`), que no está en
  la exportación.
- **15 fondos tienen meses sin cierre en sus ventanas, y a 8 no les cuesta nada**: esas ventanas ya las
  tumbaba un hueco (BlackRock World Financials, World Gold y World Mining, cuatro de AB y Gestión Boutique V).
  A los otros 7 sí, y son los siete primeros de la tabla; los dos últimos pierden solo el año 2021.
- **La ficha dice por qué falta una ventana**: `riesgo.historial_precios.meses_sin_cierre`, con el mes, el
  último valor, los laborables que deja y las ventanas que pierde. No llega todavía a la base ni a la
  pantalla: pide un campo de contrato, como los picos de la versión 3.

**Lo que no cambia:** las fórmulas, las ventanas, el tipo sin riesgo, la anualización, la puerta de entrada
del método diario, las rentabilidades a plazo, las caídas máximas y la fecha de cierre (`cierre_mensual`).

**Quién dice la versión**, como en la 3: el extractor sella «core.metricas v4: …» (`VERSION_METODO = 4`), la
plataforma publica `EXTRACTOR_MONTHLY_V4` o `EXTRACTOR_DAILY_V4` solo con ese sello (`versionDelMetodo`), los
tres contratos la admiten y la aplicación la rotula igual que la 3 («calculada por nosotros en euros»). Lo
vigila `1-extractor/tests/test_metodo_v4.py`, con cada cifra sacada de una cuenta a mano.

**Qué quedaba para recalcular, y se hizo el 17-11-2026.** Como la versión 3: publicar antes la aplicación con las etiquetas de la 4, y
después recalcular la base entera y subirla, con su aprobación. Una V3 y una V4 no se ordenan juntas, y una
ficha sin recalcular sigue llamándose V3. La medida de arriba es una estimación sobre la exportación; lo que
vale es lo medido en la base al recalcular, como en la 3: los 761 fondos y ETF mensuales cierran el 31-10-2026, ninguna cifra
cambia de valor y siete pierden alguna ventana (MET-7 en `AUDITORIA_INTEGRAL_2026-11-16.md`); la estimación de arriba daba
nueve de 763, y la diferencia no está conciliada aquí.

### La versión 3 (16-11-2026)

*Decisiones A-158 y A-166 de Óscar, ante MET-1, MET-3 y MET-2 de la auditoría integral. Las tres a la
vez, para recalcular y subir una sola vez.*

| Qué cambia | Versión 2 | Versión 3 | A qué cifras afecta |
|---|---|---|---|
| Tipo sin riesgo de un mes (mensual) | €STR medio del mes ÷ 12 | Lo que rinde el €STR capitalizado en act/360 entre las dos fechas del mes (§2) | Sharpe, Sortino, alfa de Jensen y el tipo publicado de la ventana |
| Anualización de la volatilidad (diario) | × √252 | × √(observaciones al año de la ventana) | Volatilidad y Sharpe de las acciones |
| Dato suelto que salta y vuelve (los dos) | Corta la serie | Se descarta con aviso (§1) | Hoy, ninguna |

**La volatilidad diaria**: la desviación típica es la de la rentabilidad entre una cotización y la
siguiente. Si el valor cotiza 180 sesiones al año, al año hay 180 de esas y no 252, y con 252 fijos la
volatilidad salía un 18 % por encima. Las observaciones al año son `(observaciones − 1) × 365,25 /
días entre la primera y la última de la ventana`, que se reproduce con lo que la ficha ya publica.

**Lo que no cambia:** rentabilidades, años naturales, caídas máximas, la volatilidad mensual, la beta,
el R², el tracking error, las ventanas, las puertas de entrada y la fecha de cierre.

**Medido el 16-11-2026 en el recálculo de verdad**, comparando la base antes y después de recalcularla. Los 761
fondos y ETF de método mensual tienen el mismo cierre antes y después (31-10-2026), así que su diferencia es **solo
del método**. La rentabilidad, la volatilidad y la caída máxima no cambian en ninguno. El Sharpe y el Sortino sí, y
cuánto depende de la volatilidad del fondo: el tipo sin riesgo capitalizado en act/360 sale un 1,4 % más alto, y esa
diferencia pesa más cuanto menos se mueve el fondo.

| Sharpe mensual | Volatilidad del fondo | Cifras | Diferencia mediana | Máxima | Cambian más de 0,05 |
|---|---|---:|---:|---:|---:|
| a 1 año | 3 % o más | 666 | 0,002 | 0,011 | 0 |
| | del 1 % al 3 % | 51 | 0,008 | 0,017 | 0 |
| | menos del 1 % | 42 | 0,046 | 6,512 | 19 |
| a 3 años | 3 % o más | 647 | 0,004 | 0,019 | 0 |
| | del 1 % al 3 % | 55 | 0,024 | 0,049 | 0 |
| | menos del 1 % | 38 | 0,144 | 5,260 | 37 |
| a 5 años | 3 % o más | 658 | 0,003 | 0,011 | 0 |
| | del 1 % al 3 % | 30 | 0,015 | 0,032 | 0 |
| | menos del 1 % | 30 | 0,072 | 2,899 | 24 |

En casi todos baja: con volatilidad del 3 % o más, los 647 de la ventana de tres años bajan y ninguno sube. Los que
cambian de verdad son los **monetarios y de muy corto plazo**, donde el Sharpe ya era un número extremo: Amundi Cash EUR
A2 pasa de −6,84 a −12,10 a tres años, JPMorgan EUR Money Market de −11,72 a −15,44, y Groupama Trésorerie **sube** de
2,90 a 4,70, porque medir el tipo en los mismos días que el fondo le quita ruido al exceso. Un fondo, Amundi Cash EUR G2,
deja de publicar el Sharpe a un año: sale −21,2. El Sortino se mueve en la misma línea: con volatilidad del 3 % o más,
0,009 de mediana a tres años.

En las acciones (método diario) el cierre de antes y el de después son de días distintos, así que en la base no se
puede separar el método de los precios nuevos. Lo que sigue es la **estimación** hecha antes de recalcular, aplicando a
la misma serie la regla de la 2 y la de la 3 (264 acciones con serie en euros):

| | Cifras | Diferencia mediana | Máxima | Cuántas cambian de forma visible |
|---|---:|---:|---:|---|
| Volatilidad diaria a 1 año | 262 | +0,6 % relativo | −1,8 % | ninguna más de un 2 % |
| Volatilidad diaria a 3 años | 256 | +0,5 % relativo | −5,4 % | 4 más de un 2 %; 1 más de un 5 % |
| Volatilidad diaria a 5 años | 251 | +0,7 % relativo | −9,8 % | 6 más de un 2 %; 3 más de un 5 % |

Una acción que cotiza a diario tiene unas 255 sesiones al año y **sube** un 0,6 %; las que bajan son las poco líquidas:
Libertas 7 (205 sesiones al año a cinco años, un 9,8 % menos), Montebalito, Bodegas Riojanas, Inmobiliaria del Sur y
Arteche. El caso del hallazgo —el fondo que devenga justo el €STR con Sharpe de 0,80 a 1,07— es de laboratorio: está en
las pruebas, no en la base.

**Una estimación que se retira.** Antes de recalcular se estimó sobre las series exportadas que el Sharpe mensual casi
no se movía (5 cifras de 754 a un año, ninguna a tres). Esa estimación no reproducía las cifras publicadas de la versión
2 —daba a Groupama Trésorerie un Sharpe de 47,8 donde la base publicaba 3,67— y queda retirada: lo que vale es lo medido
en la base.

**Quién dice la versión.** El extractor la sella en la ficha, en `riesgo.historial_precios.metodo`
(«core.metricas v3: …», de `VERSION_METODO`), y la plataforma publica `EXTRACTOR_MONTHLY_V3` o
`EXTRACTOR_DAILY_V3` **solo si la ficha lleva ese sello** (`versionDelMetodo` en el mapper). Hasta la 2
el identificador era una constante de la plataforma, y una ficha sin recalcular se habría publicado
con la etiqueta nueva. Una ficha sin sello de la 3 se publica como V2, y por la §3 no se ordena con
las V3. Lo vigilan `1-extractor/tests/test_metodo_v3.py`, con cada cifra sacada de una cuenta a mano, y
las pruebas del mapper.

### El mismo fichero tiene ahora dos métodos, y este documento define uno

*Añadido el 02-11-2026.* Hasta ese día la mitad del método de las **acciones** —volatilidad,
Sharpe y caída máxima— vivía dentro de `1-extractor/fetchers/eodhd.py`, el lector de un
proveedor. Eso no era una cuestión de orden: un umbral del método metido en el lector de un
proveedor significa que **cambiar de proveedor cambiaría la cifra publicada** sin que nadie
hubiera decidido nada. Se movió a `core/metricas.py` con el nombre `metricas_diarias`, sin
tocar un solo umbral y comprobando que ninguna cifra cambiaba.

Así que `core/metricas.py` contiene hoy **dos** métodos, y este documento sigue definiendo solo
el primero:

| | `EXTRACTOR_MONTHLY_V1` — este documento | `EXTRACTOR_DAILY_V1` — acciones |
|---|---|---|
| Función | `riesgo`, `rentabilidades` | `metricas_diarias` |
| Frecuencia | Rentabilidades mensuales, × √12 | Rentabilidades diarias, × √252; desde la versión 3, × √(observaciones al año) |
| Ventanas | 12, 36 y 60 meses **cerrados** | 1, 3 y 5 años desde el último día de la serie |
| **Puerta de entrada** | 13, 37 o 61 cierres de mes **consecutivos** | `max(60, años × 180)` observaciones, **sin mirar cómo están repartidas** |
| Sharpe | media(exceso mensual) × 12 / (desv. típica × √12) | (rentabilidad anualizada − €STR medio) / volatilidad |
| Caída máxima | Ventana de 3 años, con tolerancia de inicio | La ventana entera que pasó la puerta |
| Fecha de la métrica | Cierre de mes | Último día de la serie |

Los cuatro parámetros que los separan están escritos campo a campo en el contrato
`instrument-computed-metrics.v2`, que es quien define `EXTRACTOR_DAILY_V1`. Por la regla de §4,
son métodos distintos con identificador distinto, y por la de §3 **una tabla nunca ordena una
cifra de uno contra una del otro**.

**Lo que esto deja abierto, y es una decisión pendiente.** Las dos puertas no son equivalentes, y
no solo dan cifras de escala distinta: una puede no dar **ninguna** donde la otra da una. Medido
el 02-11-2026 con CEVASA (`ES0132955008`), que cotiza en el 46-63 % de los días hábiles: por el
camino diario no publica nada —159 observaciones frente a las 180 que exige a un año— mientras
que el camino mensual da 17,71 / 28,24 / 25,36 sobre **esa misma serie**. Cinco años de historia
y sale igual que un valor recién salido a bolsa, porque el umbral diario mezcla en un solo número
dos cosas distintas: una serie **corta** y una serie **poco líquida**.

La consecuencia práctica para quien lea la base: un `computed/metrics` ausente en una acción no
significa que la serie sea corta.

### Medido: cambian 7 de 301, y las 7 a favor de la cobertura

*02-11-2026, por decisión de Óscar de medirlo antes de decidir. `1-extractor/tools/mide_dos_puertas.py`
sobre las **306** acciones del alcance, 301 con serie. No reimplementa las puertas: se las pregunta
al código que corre, `metricas_diarias` y `riesgo`.*

| | 1 año | 3 años | 5 años |
|---|---|---|---|
| Publican con las dos puertas | 297 | 290 | 286 |
| Solo con la de hoy (perderían) | 0 | 3 | 4 |
| Solo con cobertura (ganarían) | 1 | 1 | 1 |
| Con ninguna | 3 | 7 | 10 |

**Gana una:** CEVASA, cinco años seguidos de cotización y hoy sin publicar nada.

**Pierden seis, y ninguna de esas seis cifras debería estar publicada.** Cuatro llevan la etiqueta
de una ventana que su serie **no cubre**, porque un umbral que cuenta observaciones lo satisface
una serie corta y densa: **Puig** cubre 2,49 años bajo «3 años», **GE Vernova** 2,59, **MFE** 4,87
bajo «5 años» y **Daimler Truck** 4,88. Las otras dos se calculan **a través de un parón de
cotización**: **Ezentis** estuvo doce meses sin cotizar en 2023 e **Innovative Solutions** dos.
Esto último choca de frente con la segunda regla del §3: una volatilidad de «tres años» medida
sobre 2,49 años de datos, o a través de un año sin mercado, no está en la misma escala que las
otras 290 y se ordena junto a ellas.

**Y las tres que de verdad son jóvenes** —TSK, DIGI y SpaceX, de 77 a 123 cotizaciones— las
rechazan las dos puertas. Ahí el umbral de hoy acierta, y conviene decirlo.

Lo que la cobertura **no** trae y habría que añadirle es un **suelo de observaciones**: hoy no
hace falta —la cifra más floja que admitiría son las 159 de CEVASA y la siguiente son 251— pero
la regla, tal cual, no lo impide. La decisión sigue siendo de Óscar; lo que ha cambiado es que ya
no se toma a ciegas.

## 5. Todo en euros: construido el 03-11-2026

**Estado.** El 03-11-2026, en la base local, las 942 métricas propias eran `EXTRACTOR_MONTHLY_V2` o
`EXTRACTOR_DAILY_V2` y estaban en euros (el 20-11-2026 son 1.281, en la versión 4). En 819 no hay nada que convertir y sus cifras son las
mismas; en 123 la serie se convierte con `fetchers/cambios_bce.py`, y su documento declara
`inputs.source_currency` y `inputs.fx_source`. Sin cambio del BCE no se publica ninguna cifra en
otra divisa. La nube estuvo en V2 desde el 03-11-2026, leído allí, en la versión 3 desde el
16-11-2026 y está en la 4 desde el 17-11-2026 (`AUDITORIA_INTEGRAL_2026-11-16.md`); en las tres se calcula en euros. Lo que queda de esta sección es el razonamiento de cuando
se decidió, con lo que entonces faltaba dicho ya como lo que el código hace.

Hasta la versión 1 las métricas se calculaban en la divisa de la clase. **Decidido el 01-11: se
calculan en euros**, convirtiendo la serie antes de calcular, con los tipos de referencia del BCE.

Por qué, y no es preferencia: `base_currency` de una cartera es `const EUR`, una **invariante del
sistema** decidida el 31-10. Si una cartera se mide en euros, sus componentes también, porque no
se puede combinar una volatilidad en dólares con una en euros para obtener la de la cartera.

Cómo lo hace el código (`fetchers/cambios_bce.py`):

- `cambios_bce.serie_en_euros` convierte la serie con `core/metricas.py::a_eur`: flujo
  `EXR D.X.EUR.SP00.A` del BCE, unidades de X por 1 EUR, con tolerancia de **7 días** porque el BCE no
  publica en los festivos de TARGET. La llaman el cálculo de los fondos y ETF (`fetchers/vl_fondos.py`)
  y el de las acciones (`fetchers/eodhd.py`), **antes** de calcular nada. Una cotización en peniques
  (GBX) pasa primero a libras.
- La serie de cambios viene de **la misma API del BCE** que el €STR, con el mismo cliente y la misma
  caché.
- Sin cambio del BCE la serie convertida queda vacía y **no se calcula ninguna métrica**: la ficha lo
  dice con `sin_metricas_sin_cambio`. No se publica una cifra en otra divisa.

Lo que desbloqueó, medido el 01-11, antes de construirlo:

- **14 clases en dólares** que entonces no tenían Sharpe. No estaba suprimido: el código se negaba,
  con razón, a aplicar un tipo del euro a una clase que no lo era. Con la serie ya en euros, el €STR es
  el tipo que le corresponde.
- **2.971 cubos de serie** que se habían convertido a euros sin los tipos del BCE, en 34 instrumentos,
  todos reconvertibles con la misma serie de cambios.

Y lo que cada cifra declara, porque el contrato tiene los tres campos:
`inputs.currency` EUR, `inputs.source_currency` la original, `fx_source` `ECB_REFERENCE`. La
volatilidad de una clase en dólares medida en euros **incluye la del EUR/USD** —del orden del
7-9 % anualizado— y eso es correcto para este producto, porque si el cliente tiene la clase sin
cubrir ese es su riesgo. Consecuencia visible: la clase cubierta y la clase en dólares del mismo
fondo mostrarán volatilidades distintas, que es lo cierto.

## 6. Coincidir con Morningstar es una comprobación, no una dependencia

Las convenciones de §2 son las de la industria, y por eso el contraste sale homogéneo. Eso no
hace que el método sea de Morningstar: el estándar es el estándar, y las elecciones son nuestras.

Lo que la coincidencia demuestra, medido el 01-11: diferencia **mediana 0,000** y p90 0,000 en
**3.577** comparaciones de rentabilidad y **1.370** de volatilidad, y el mismo tipo libre de
riesgo —2,764 % despejado del Sharpe de Morningstar a tres años contra 2,778 % de nuestro €STR—.
Dos proveedores de datos independientes y dos implementaciones distintas dando el mismo número
corrobora **el método**.

Lo que no demuestra: nada sobre la frescura ni la integridad de lo que ese tercero publica. Su
fecha de dato es más vieja que el fin de nuestra serie en **468 de 468 fondos**, mediana 27 días,
y de las 69.069 posiciones que los fondos declaran entrega el **50,8 %**. Por eso la cifra es
nuestra y la suya es el control.

## 7. Lo que el método empezó a calcular el 02-11-2026, y por qué no cambia de versión

Hasta ese día el método publicaba volatilidad y Sharpe a 1, 3 y 5 años, y **una** caída máxima,
la de 3. El contrato de `computed/metrics` declaraba, además, el **Sortino** a cuatro ventanas,
la caída máxima a las otras tres y la ventana de **10 años** de las tres magnitudes. Nadie las
calculaba: en todo el extractor la palabra «sortino» aparecía una sola vez, y era para
clasificar un campo **del proveedor**.

Así que no eran lagunas de la fuente, eran cifras que nunca se habían escrito, y figuraban como
ausentes en los **1.077** instrumentos. La pantalla de salud del catálogo las destapó contándolas
el 02-11-2026, y Óscar decidió calcularlas.

**Lo que se añade:**

- **El Sortino**, en las cuatro ventanas, con el mismo exceso sobre el €STR que el Sharpe. Las
  dos decisiones que lleva van escritas en la tabla de §2 porque cambian la cifra: el objetivo
  es el €STR y no cero, y la media de los cuadrados se divide entre **todas** las observaciones.
  La definición alternativa —dividir solo entre los meses malos— premia a un fondo por tener
  pocos, aunque sean pésimos.
- **La caída máxima por ventana**, llamando a la misma función una vez por ventana. La de 3
  años **no cambia**: es la misma función con la misma tolerancia.
- **La ventana de 10 años** para las tres, que exige sus 121 cierres de mes consecutivos y por
  eso quedará ausente en la mayoría. **El Sharpe y el Sortino a 10 años, en cambio, no salen en
  ninguno**, y no por la serie: el €STR empieza en octubre de 2019, y sin tipo para todos los meses
  no hay cifra. No se empalma con EONIA, que es otro tipo con otra base (Óscar, 04-11-2026). La
  ficha lo dice.

### Por qué sigue siendo `EXTRACTOR_MONTHLY_V1`

La regla de §4 dice que cambiar un parámetro cambia la versión, y el motivo que da es que **las
cifras nuevas no serían comparables con las viejas**. Aquí no cambia ninguna cifra ya publicada:
la volatilidad de 3 años, el Sharpe de 5 y la caída de 3 salen idénticos. El método **gana
salidas**, no cambia las que tenía.

Subir a V2 habría dicho de 939 bloques de métricas que no son comparables consigo mismos, y
habría obligado a reetiquetar la base para no afirmar nada nuevo. Así que la versión se queda, y
lo que cambia es este documento, que es donde está escrito qué produce V1.

Con una consecuencia que conviene tener presente: **dos instrumentos etiquetados V1 pueden
tener un juego distinto de magnitudes**, según cuándo se calcularon. Eso ya pasaba por la
longitud de la serie —un fondo de dos años nunca tuvo la ventana de 5— y se lee igual: la
presencia de la cifra, no la etiqueta del método.

## 8. Calcular no es publicar, y el 02-11-2026 lo demostró dos veces

§7 cuenta lo que el método empezó a **calcular**. Esta sección cuenta lo que llega a la base, que
no es lo mismo y por eso va aparte: **una cifra calculada y no publicada es indistinguible de una
que no existe**, y el sistema ya se equivocó con ella dos veces el mismo día.

El primer caso es el que destapó todo. La caída máxima se calculaba en tres ventanas **desde el
principio**, y el extractor publicaba **una**, la mejor disponible, en un escalar
`riesgo.max_drawdown.pct` con su `periodo` suelto al lado. Medido sobre la base antes del arreglo:
625 instrumentos la tenían a tres años, 290 a cinco y **ninguno a uno**. La pantalla de salud lo
contó como un hueco de datos y no lo era: era un eslabón que tiraba dos de cada tres cifras.

El segundo caso es el mismo defecto un eslabón más abajo, y apareció al arreglar el primero.
Cuando el extractor empezó a publicar el Sortino, **la plataforma no lo mapeaba**: el contrato de
`computed/metrics` lo declaraba a cuatro ventanas y `mapper.ts` no lo leía, así que las 616 cifras
nuevas se habrían calculado y tirado igual, una capa después. Son dos sitios distintos con el
mismo síntoma, y de ahí la regla:

> Una métrica nueva no está hecha cuando el cálculo la produce. Está hecha cuando se lee en la
> base, en todas sus ventanas, por los dos caminos.

### Los cinco sitios que hay que tocar para añadir una métrica

Medido haciendo el recorrido entero con la caída máxima y el Sortino. Saltarse cualquiera de los
cinco **no da ningún error**: la cifra simplemente no aparece.

| # | Dónde | Qué se toca |
|---|---|---|
| 1 | `1-extractor/core/metricas.py` | el cálculo, una función por magnitud y ventana |
| 2 | `1-extractor/fetchers/vl_fondos.py` (mensual) y `fetchers/eodhd.py` (diario) | la publicación en el canónico. En `eodhd.py` es **una fila** de la tabla `METRICAS_POR_VENTANA`; en el camino mensual siguen siendo llamadas sueltas |
| 3 | `1-extractor/core/adquisicion/registro.py` | la ruta en las capacidades del adaptador. Sin esto, `capacidades` falla, y hace bien |
| 4 | `2-plataforma-datos/contracts/base-nueva/instrument-computed-metrics.v2.schema.json` | el campo y su forma de ventanas, si no está |
| 5 | `2-plataforma-datos/src/ingestion/baseNueva/mapper.ts` | **los dos bloques**: el de fondos (`nuestrasPorVentana`) y el de acciones (`porVentanaDelFondo`). Son dos funciones distintas porque son dos métodos distintos |

Y uno más, que no es del método pero sí de que se vea: la ficha
(`3-BDB-ACTIVOS_app/src/adapters/componerFicha.ts`), que desde el 02-11-2026 pinta la sección como
una tabla de magnitud por ventana construida con lo que el documento **trae**. Añadir una métrica
ahí es añadir su rótulo y su formato; las ventanas salen del dato.

### El techo del contrato, y qué se hace con una cifra que no cabe

El contrato topa los ratios en **20**, y un instrumento salió con Sortino a un año de **84,15**:
una serie casi monótona deja una desviación a la baja minúscula y el cociente se dispara. La cifra
es real y no cabe. Lo que se hace es dejar **esa ventana** fuera y anotarlo como aviso.

No se recorta a 20, porque recortar es publicar una cifra que no calculamos. Y no se deja pasar,
porque el documento entero se caería en la puerta de forma y ese instrumento perdería también su
volatilidad y su Sharpe, que están bien. Por eso el rango se comprueba **ventana a ventana** y no
al final: es la diferencia entre perder una celda y perder un bloque.

### Lo que hay en la base, medido el 02-11-2026 a las 20:30

Leído de la base, no del canónico. 939 documentos `computed/metrics`.

**Fondos, `EXTRACTOR_MONTHLY_V1` — 642 documentos**

| Magnitud | 1 año | 3 años | 5 años | 10 años |
|---|---|---|---|---|
| Volatilidad | 641 | 624 | 605 | 493 |
| Caída máxima | 641 | 625 | 610 | 502 |
| Sharpe | 617 | 600 | 581 | — |
| Sortino | 616 | 600 | 581 | — |

**Acciones, `EXTRACTOR_DAILY_V1` — 297 documentos**

| Magnitud | 1 año | 3 años | 5 años |
|---|---|---|---|
| Volatilidad | 297 | 293 | 290 |
| Caída máxima | 294 | 290 | 290 |
| Sharpe | 198 | 194 | 193 |
| Sortino | — | — | — |

Dos lecturas que conviene no perder. El Sharpe de las acciones está en 198 de 297 y no es un
hueco: §4 nombra la falta del tipo libre de riesgo de esa divisa como uno de los dos casos en que
el Sharpe no sale, y una serie en dólares no se mide contra el €STR. Y **el Sortino no existe por
el camino diario**: `METRICAS_POR_VENTANA` no lo lleva, así que la plataforma lo mapea y recibe
vacío. Está mapeado a propósito, para que el día que esa tabla crezca la cifra llegue sin tocar la
plataforma —que es exactamente la asimetría que esta vuelta ha costado pagar—.

## 9. El Sharpe y el Sortino NO se calculan para acciones individuales

*Decisión de Óscar, 03-11-2026, y norma de proyecto desde ese día: el criterio con el que se
decide aquí es el de un gestor de carteras, y está escrito en `AGENTS.md`.*

**El argumento es de gestión, no de datos.** El denominador del Sharpe es *toda* la volatilidad
del valor, y en una cartera decente la parte idiosincrática se diversifica y desaparece. O sea
que la cifra cobra a la acción un riesgo que el cliente nunca llega a soportar, y premia a la
acción aburrida por serlo. En un fondo o un ETF el mismo número sí significa algo, porque **ya
son una cartera diversificada**: su volatilidad total es el riesgo que se soporta. La diferencia
no es de preferencia, es de qué mide el denominador.

De un **componente** la pregunta de gestión es siempre su **aportación** —contribución al riesgo
del conjunto, contribución marginal, qué le pasa al Sharpe de la cartera al entrar o salir—, no
su nota. Y el Sharpe y el Sortino de la cartera, que es lo que el cliente tiene, **no existen
todavía**: hay seis contratos de cartera y ninguno calcula una métrica.

### Esto NO es suprimir el Sharpe, y hay que decirlo así

La §3 dice que el Sharpe no se suprime bajo ningún concepto, y sigue intacta: habla de no
ocultarlo donde significa algo —no hay umbral de volatilidad por debajo del cual se esconda—.
Aquí no se oculta: se declara que **no aplica** a una población. Son dos afirmaciones distintas,
y quien lea el hueco de las acciones sin esta sección lo leerá como un fallo.

Donde **quedará** escrito es en el contrato: `sharpe` y `sortino` llevarán
`x-applies-when: FONDO_O_ETF`, y **no** `x-absence`. Lo segundo es a propósito y se probó: cuando
el predicado es falso la ruta se salta entera, así que un `x-absence` solo afectaría a la
población donde sí aplica, y un fondo sin Sharpe por falta del tipo libre de riesgo de su divisa
leería «no aplica» donde la verdad es «falta un ingrediente». Una prueba de
`baseNuevaCalidadYTarjeta` caza exactamente eso, y cazó el primer intento.

**Por qué el contrato todavía no lo dice.** Declararlo saca ocho rutas del denominador de la
cobertura de cada acción, y eso mueve una cifra publicada: medido el 03-11-2026 sobre las 305
acciones, **+7,95 puntos de media, hasta +11,59, y 297 de 305 se mueven más de cinco**. La §15 de
las decisiones declinó un cambio de 1,9 puntos por no mover una cifra contra la que se está
diseñando. El número nuevo es el cierto —el viejo contaba ocho rutas que una acción no puede
rellenar nunca—, pero por la **decisión 16** una cobertura que se mueve tiene que poder explicarse
desde el propio dato. Así que la declaración entra junto con la huella del conjunto contable, no
antes.

### Lo que SÍ se queda de una acción, y por qué

La **volatilidad**, la **caída máxima** y la **rentabilidad** —anualizada y del año—. La primera
porque es *insumo*: con ella y la covarianza se calcula el riesgo del conjunto. La segunda porque
es un hecho sobre la serie y no una puntuación: no juzga si el riesgo mereció la pena, dice
cuánto se perdió en el peor tramo. La tercera porque es lo primero que pregunta un cliente.

**Medido el 03-11-2026, y es lo que cierra el asunto de la divisa.** Todas las acciones que no
cotizan en euros ya tienen las tres: 3 de 3 en CAD, 4 de 4 en CHF, 5 de 5 en GBX y 87 de 88 en
USD. Lo único que la divisa bloqueaba era el Sharpe. Así que la §5 —todo en euros— **deja de ser
un asunto de acciones**: queda solo para fondos y ETF.

| | acciones | con volatilidad | con caída máxima | con rent. anualizada | con Sharpe |
|---|---|---|---|---|---|
| EUR | 205 | 198 | 198 | 198 | 198 |
| USD | 88 | 87 | 87 | 87 | 0 |
| GBX | 5 | 5 | 5 | 5 | 0 |
| CHF | 4 | 4 | 4 | 4 | 0 |
| CAD | 3 | 3 | 3 | 3 | 0 |

### La versión del método no cambia

Por la regla de §4, lo que mueve la versión es un parámetro que haga las cifras incomparables.
**Retirar una salida no recalcula ninguna otra**: la volatilidad, la caída máxima y la
rentabilidad de una acción siguen saliendo del mismo código con los mismos umbrales, así que
siguen comparables con lo publicado antes. Sigue siendo `EXTRACTOR_DAILY_V1`, por la misma razón
por la que añadir el Sortino al mensual no lo movió.

### Lo que queda por hacer, y no se hizo el 03-11-2026

**Cerrado el 04-11-2026 por decisión de Óscar: se oculta y no se retira.** Lo de abajo queda como camino si algún día se quiere la retirada formal. El contrato no dice que no aplique, y la base conserva los 198
Sharpe de acciones y la validación **no se queja**: `x-applies-when` decide si una ruta cuenta
para la cobertura, y no comprueba que un campo no esté donde no debería. Un contrato que dice
«no aplica» y un documento que lo trae conviven en silencio, y eso es un hueco del sistema, no de
este cambio.

Quitarlo del extractor no es una línea. El Sharpe diario sale por `fetchers/eodhd.py` hacia
`riesgo.sharpe.*.fondo`, y de ahí lo leen el canónico, `core/exporta.py`, `core/informe.py`, el
registro de adquisición y **dos puertas de calidad** que condicionan con `sharpe.3a`
—`core/adaptador_bdb.py:986` y `core/update.py:50`—. Retirarlo a medias cambiaría en silencio qué
activos pasan una puerta, que es la clase de defecto que este proyecto persigue. Son seis sitios
y una pasada entera del pipeline, con su verificación y su resubida a la nube.

### La decisión de las dos puertas sobrevive, con otro dueño

§4 dejó abierta la elección entre las dos puertas de entrada, medida con CEVASA. Sigue viva, solo
que ya no decide quién tiene Sharpe: decide quién tiene **volatilidad y caída máxima**, que son
las que se quedan. El caso vale igual.

**04-11-2026: no se enseña.** Decisión de Óscar: el Sharpe de las acciones no debe verse. Lo quitan la
ficha, el Buscador y Comparar, y la tarjeta en la siguiente pasada. La cifra sigue en `computed/metrics`:
esto no es la retirada de la §10, que sigue en su estado, y por eso no cambia la cobertura.

## 10. Una cifra se retira con fecha, y lo retirado consta

*Regla aprobada por Óscar el 03-11-2026, al revisar las normas. La §9 es su primer caso, y se
escribió antes que la regla.*

**Retirar no es faltar, y hasta hoy solo una de las dos tenía reglas.** Una cifra *falta* cuando no
se pudo calcular, y para eso está el vocabulario de ausencias con sus tres motivos. Una cifra se
**retira** cuando se decide que no debía existir. Eso es otra cosa y obliga a cinco:

1. **Una decisión con fecha**, escrita donde se define el método, con el argumento. No una nota en
   un mensaje de commit: un commit explica un cambio, no gobierna lo que se publica.
2. **El contrato declara que no aplica** a esa población, para que la ausencia sea una afirmación y
   no un hueco. Sin esto, retirar una cifra y no tenerla nunca se leen igual.
3. **La base no la conserva.** La siguiente pasada la quita, y la **decisión 17** es lo que hace
   comprobable que se quitó: mientras el dato siga ahí, el contrato y la base se contradicen.
4. **La versión del método no cambia.** Retirar una salida no recalcula ninguna otra, así que lo
   que quedó sigue comparable con lo publicado antes. Es el mismo criterio por el que añadir el
   Sortino al mensual tampoco la cambió (§7).
5. **Consta entre qué fechas estuvo publicada.** Desde cuándo salió y desde cuándo ya no.

### Lo que la regla NO obliga, y es deliberado

**No se rehace ni se retira un informe ya entregado.** Un informe es un documento fechado y
firmado con lo que se sabía ese día; reescribirlo a posteriori es un defecto peor que la cifra que
se quiere arreglar. La obligación es poder **identificarlo**, no corregirlo.

### La quinta condición es la rebajada, y se dice por qué

La versión fuerte de la quinta sería «consta qué informes entregados la llevan». **No se puede
cumplir hoy:** el sistema no guarda qué informes se han emitido ni cuándo, así que esa pregunta no
tiene respuesta y una regla con una condición incumplible se incumple el primer día.

Así que la condición es la que sí se puede cumplir: **la retirada publica el intervalo de fechas**
en que la cifra estuvo viva. Cruzarlo con los informes queda del lado de quien los tenga, que hoy
es Óscar y su archivo. El día que exista un registro de informes emitidos, la condición puede
subir sin cambiar el resto de la regla.

**Estado:** la regla está escrita y la §9 cumple hoy las condiciones 1, 2 —pendiente de la huella
de la decisión 16— y 4. La 3 no se cumple todavía: la base y la nube conservan los 198 Sharpe de
acciones. Y de la 5 falta el intervalo, porque no hemos medido desde cuándo se publicaron.


## 11. Los ETF se miden con el cálculo de los fondos, sobre su precio de mercado

*Decisión de Óscar, 04-11-2026.* Un asesor compara ETF con fondos a diario, así que un ETF usa la
misma fórmula, frecuencia, ventanas y fecha de cierre que un fondo: `EXTRACTOR_MONTHLY_V2`. Por la
§3, su identidad comparable es la misma, y por eso comparten fila y orden.

**Lo que cambia es la serie, y se declara.** `inputs.series_class: MARKET_PRICE` en
`computed/metrics` y `metrics.series_class` en la tarjeta. No es un método nuevo porque el
calculador es el mismo, y no se puede callar porque el precio no es el valor liquidativo:

| Mismo MSCI World, volatilidad a cierre de octubre de 2026 | 12 meses | 36 meses | 60 meses |
|---:|---:|---:|---:|
| `EUNL.XETRA`, precio de mercado | 11,13 | 11,92 | 13,07 |
| Vanguard Global Stock, valor liquidativo | 9,97 | 11,16 | 13,06 |
| Fidelity MSCI World, valor liquidativo | 9,96 | 11,16 | 13,05 |

El precio añade **1,2 puntos a un año y 0,8 a tres**, y a cinco desaparece. Es el desfase de la
decisión 11: XETRA cierra a las 17:30 y el valor liquidativo sale tras el cierre de Estados Unidos.
Es un sesgo conocido y en contra del ETF, y la cifra se publica con él. En la rentabilidad a tres
años la diferencia es de 0,25 puntos.

**La serie es el cierre ajustado por splits y dividendos**, así que no hay política de reparto que
resolver: el derecho a calcular es `inputs.series_adjustment`, como en una acción. Medido el
04-11-2026 sobre los siete ETF que reparten: lo que el ajuste suma en doce meses da 2,60 / 3,85 /
2,71 / 1,05 / 0,94 / 0,47 / 1,07 % frente a un rendimiento declarado de 2,60 / 4,05 / 2,80 / 0,87 /
0,88 / 0,45 / 1,00 %. Es reinversión a precio de cierre y sin impuestos: no descuenta la retención a
un inversor europeo en `SPY` o `QQQ`.

**La divisa es la de la cotización, y no la de la ficha.** `valoracion.vl_divisa` e
`identificacion.divisa_base` dicen USD en clases que en XETRA cotizan en euros. Con el dato de la
ficha, un precio ya en euros se convertiría otra vez.

**Lo que no entra.** El ETC `IE00B4ND3602`, que no tiene método decidido, y las métricas relativas a
un índice, porque compararían un cierre de mercado con un proxy de valor liquidativo.


## 12. El estimador semanal es de la base vieja, y no se traslada

*Decisión de Óscar, 04-11-2026.* `GEOMETRIC_CAGR` con frecuencia `WEEKLY` es un **tercer método**, y
hasta hoy ningún documento lo declaraba. Lo calculan las Cloud Functions sobre la base vieja: 3.924
ventanas en 1.047 de sus 1.097 activos. El informe `INFORME_TERCER_ESTIMADOR_2026-11-03.md` lo
reprodujo desde precios y €STR hasta el octavo decimal en tres activos.

| | Semanal, base vieja |
|---|---|
| Rentabilidades | Último precio de cada semana ISO, entre semanas a 7 o 14 días |
| Volatilidad | Desviación típica muestral × √52, con 20 rentabilidades como mínimo |
| Rentabilidad anualizada | `(P final / P inicial)^(365,2425 / días reales) − 1` |
| Sharpe | (rentabilidad anualizada − €STR medio) / volatilidad |
| €STR | Media ponderada por días naturales; admite cobertura parcial, y a diez años la serie no llega |

Por la §3 es otro estimador, y las cifras cambian mucho. Sharpe a tres años:

| | Mensual | Diario | Semanal |
|---|---:|---:|---:|
| BHP | 0,5821 | 0,4988 | 0,4984 |
| DPAM Bonds EUR Government | −0,1148 | −0,1067 | −0,1266 |
| CEVASA | 0,6204 | no sale | 0,2086 |

**Lo que se decide.** No se publica en producción ni se lleva a la base nueva. Sigue existiendo donde
está, y la aplicación local que aún lee la base vieja lo enseña: ninguna cifra suya se compara con
una de la base nueva.

**Lo que no queda resuelto.** Comprobado por el código y no pantalla a pantalla: en producción, las
cifras de activo salen de las tarjetas. `GEOMETRIC_CAGR` sigue en el contrato reservado a un
calculador analítico futuro, que no es este: si algún día existe, tendrá que llevar otro nombre o
declarar que es otra cosa. Y esto es de **activos**: el análisis de una cartera también muestrea por
semanas, y es otra cifra de otro sujeto.

## 13. El modelo encoge lo que espera de cada activo, y se queda así

*Decisión 95 de Óscar, 05-11-2026.* Esto no es de las cifras de un instrumento, sino del motor que propone carteras en Optimizar y Simular, `optimization/robust_engine.py`. Vive aquí porque es una elección de método, y hasta hoy solo la nombraba una nota de versión.

**Qué hace.** `estimate_returns` acerca la media de cada activo a la media de los activos de la **propia cartera**, renta fija y bolsa juntas, y no a la de su clase: `μ = (1 − δ) × media + δ × media de todas`. Es James-Stein: `δ = (N − 3) × varianza media del estimador / dispersión de las medias`, con un **tope del 50 %** (`MAX_RETURN_SHRINKAGE`). Con tres activos o menos no encoge. Casi siempre llega a ese tope: en 35 de 40 ventanas medidas. Con la muestra a 3 años `δ` es 0,43, y PIMCO pasa de 2,78 a 6,81 % y Vanguard de 20,37 a 16,85 %.

**Qué mueve.** La curva no: la transformación es afín y, con los pesos sumando el 100 %, ordena igual todas las carteras. Mínima volatilidad, tampoco, porque no mira las medias: idéntica en 16 de 16 casos. Nivel de riesgo, casi nunca: los mismos pesos en 67 de 80, y los otros 13 cambian de punto por lo poco que se muestrea la curva. Lo que se mueve es **Máximo Sharpe**, porque el Sharpe sí mira la distancia al tipo sin riesgo: cambia en 15 de 16, con una mediana de 25 puntos de peso, hacia la renta fija. De 144 casos con renta fija y bolsa, medidos con carteras reales y al azar, lleva más renta fija en 135, lo mismo en 7, menos en 1, y en el otro no consta el reparto.

**Lo medido dentro de muestra.** Siempre pierde, porque está hecho para no perseguir lo que ya pasó, así que estas cifras no prueban nada. La muestra, con su Máximo Sharpe medido con la serie:

| | Renta variable | Rentabilidad anualizada | Sharpe |
|---|---:|---:|---:|
| 3 años, hoy | 23 % | 8,24 % | 1,01 |
| 3 años, encogiendo por clase | 100 % | 19,81 % | 1,39 |
| 3 años, sin encoger | 100 % | 21,56 % | 1,44 |
| 3 años, la cartera actual | 57 % | 13,48 % | 1,27 |
| 5 años, las tres | 100 % | 12,13 % | 0,77 |
| 5 años, la cartera actual | 57 % | 6,38 % | 0,48 |

**Lo medido fuera de muestra.** Una decisión cada octubre y el año siguiente medido, encadenado. Máximo Sharpe:

| | Rentabilidad | Volatilidad | Sharpe | Caída | Renta variable |
|---|---:|---:|---:|---:|---:|
| 5 carteras locales, 3 años, hoy | 3,09 % | 6,16 % | 0,40 | −16,2 % | 29 % |
| ídem, por clase | 4,38 % | 7,75 % | 0,48 | −19,0 % | 45 % |
| ídem, sin encoger | 4,60 % | 7,83 % | 0,51 | −19,8 % | 45 % |
| ídem, la cartera actual | 6,23 % | 9,94 % | 0,57 | −23,6 % | 61 % |
| 30 al azar, 2003-2026, 3 años, hoy | 2,71 % | 4,16 % | 0,36 | −17,7 % | 14 % |
| ídem, por clase | 3,17 % | 7,07 % | 0,27 | −33,5 % | 32 % |
| ídem, sin encoger | 3,33 % | 7,10 % | 0,29 | −32,8 % | 32 % |
| ídem, reparto igual | 6,13 % | 9,53 % | 0,51 | −31,4 % | 55 % |

A 5 años, el Sharpe es 0,41 hoy frente a 0,58 por clase con las locales, y 0,45 frente a 0,41 con las de 2003 a 2026. En 2007-08 la de hoy pierde un 15 % y la de por clase un 32 %; en 2020-21 gana un 3 % y la otra un 10 %. Lo que predice del año siguiente, como error en la diferencia entre activos, a 3 años: 13,97 puntos la serie, 13,15 hoy y 13,51 por clase. A cambio recorta la prima de la bolsa sobre la renta fija: sesgo de −4,3 puntos frente a −1,6 de la serie.

**Sus límites, que son muchos.** Son fondos supervivientes, y los locales además elegidos hoy, lo que favorece a quien lleva más bolsa. 3 o 5 años es poco: con un 15 % de volatilidad, la media anual se conoce con ±8,7 y ±6,7 puntos. Una decisión al año y un año medido son mucho ruido, y el tipo sin riesgo fuera de muestra es XEON y un monetario, porque el €STR guardado empieza en 2019. A 3 años, ningún Máximo Sharpe supera fuera de muestra a la cartera actual ni al reparto igual: es una referencia. No hay ganador, y esta medida no da para más.

**Lo que se decide.** El cálculo se queda como está. Se escribe aquí, y la nota de Máximo Sharpe lo dice en pantalla donde es cierto: con renta fija y bolsa, por su clase, y más de tres activos. Desde julio estaba pendiente un encogimiento jerárquico por clase (`docs/RELEASE_NOTE_frontier_v2.md`): **queda decidido no hacerlo**, por esta medida. Máximo Sharpe llevaría más bolsa y caería el doble en una crisis, con un Sharpe igual o peor en 23 años, y mejor solo desde 2014. Y una clase de un solo fondo no encoge.

**No cambia la versión del método, porque no cambia ningún parámetro.** Es el cálculo que ya había, y ahora consta.

*Decisión 94, el mismo día.* «Rentabilidad objetivo» se pide sobre la media **sin encoger**, sobre la misma curva. Por eso en esa cartera se leen tres cifras: lo que se pide, la media de la serie; lo que da el modelo, encogida, en la tarjeta; y lo que mide la serie, anualizado y con los pesos derivando. Con un 8 % y la muestra a 3 años, 8,00, 9,79 y 8,82 %.
