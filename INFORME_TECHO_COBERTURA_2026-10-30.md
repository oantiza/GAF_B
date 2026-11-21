# Hasta dónde se puede llegar sin licencias, y qué costaría no intentarlo

Informe del 30-10-2026. Contesta dos preguntas: **cuál es la cobertura máxima alcanzable con
fuentes independientes, oficiales o gratuitas y fiables** para los campos que el programa necesita
de verdad, y **cuánto cuesta un proveedor** que los dé hechos, con el veredicto de si compensa.

Los campos necesarios son los definidos en `CAMPOS_NECESARIOS_2026-10-30.md`: tres entradas para
los cálculos financieros y siete bloques de composición de cartera. Todo lo demás que muestra la
app son resultados que se calculan, no datos que haya que conseguir.

**Método y honestidad de las cifras.** Todo lo que aparece como porcentaje está medido sobre la
copia verificada de la maestra del 29-10 (1.097 activos, de ellos 765 fondos). Lo que es estimación
va dicho como estimación. Lo que no he podido verificar —condiciones de licencia, precios no
públicos— va en el apartado final, sin rellenar con suposiciones.

---

## 1. Las entradas de los cálculos: el techo está alto, salvo en una

| Entrada | Hoy | Techo independiente | Por qué |
|---|---:|---:|---|
| **Serie de VL en EUR** | 99 % (EODHD) | **~20-30 %** | Solo 2 o 3 de cada 10 gestoras publican histórico descargable. **No hay sustituto público** |
| **Divisa** | 100 % | **100 %** | CSSF, ESMA y CNMV. Ya es oficial |
| **Coste corriente (TER)** | **98 %** | **98 %** | Ya está. Solo 1 fondo de 770 carece de TER teniendo gastos del KID: rellenarlo desde el KID no hace falta |
| **Tipo libre de riesgo** | ok | **100 %** | ESTR del BCE, público y gratuito |
| **Índice de referencia** | **0 %** | alto, sin medir | Está en el KID y en el folleto. Hoy simplemente no se captura |

**La serie es la única dependencia real del programa, y es total.** Con el 20-30 % que se puede
conseguir gratis no se sostiene ningún cálculo: sin serie no hay rentabilidad, ni volatilidad, ni
Sharpe, ni caída máxima, ni correlaciones para optimizar una cartera. Es el bloque que se paga, y
está bien pagado (§4).

**El TER no necesita nada, y la primera versión de este informe decía lo contrario.** Lo daba al
70 % y proponía subirlo al 91 % desde el KID; está al **98 %** y la idea no hace falta. El 70 %
salía de dividir por los 1.097 activos de la maestra, que incluyen 312 acciones sin TER. Ver §6.

### El hallazgo del índice

La maestra guarda **las cifras del índice** —su volatilidad (65 %), su Sharpe (61 %), el alpha
contra él (52 %)— pero **no guarda qué índice es**: ningún fondo tiene identificado su índice de
referencia. Cero de 765.

Eso tiene dos consecuencias y la segunda es la seria:

1. **Alpha, beta, R², tracking error e information ratio no se pueden calcular aquí**, por mucha
   serie que haya, porque no se sabe contra qué comparar. Vienen dados por Morningstar.
2. **Son cifras que pueden acabar en un informe de cliente sin que podamos nombrar su referencia.**
   Un alpha de 1,2 % no significa nada si no se puede decir «contra qué». No es un problema de
   independencia: es de trazabilidad.

Capturar el índice de cada fondo —del KID, del folleto o del registro— es trabajo pequeño y
desbloquea calcular esas cinco métricas aquí, con la serie que ya se paga. **Es la mejor relación
entre esfuerzo y resultado de todo lo que queda.**

---

## 2. La composición de cartera: completa hoy, pero prestada

Aquí hay que separar dos cosas que la primera versión de este informe mezcló, y mezclarlas cambia
la conclusión entera.

### Lo que hay hoy: entre el 96 % y el 99 %

Medido sobre la población a la que cada campo aplica —no sobre los 1.097 activos, que incluyen 312
acciones—:

| Bloque | Cobertura | Sobre qué |
|---|---:|---|
| Mezcla de activos | **99 %** | los 784 fondos y ETF |
| Tipos de bono | **97 %** | los 784 |
| Sectores · Regiones · Estilos · Tamaños | **99 %** | los 561 con renta variable |
| Tramos de duración | **96 %** | los 314 con renta fija |
| Calidad crediticia media | 80 % | los 314 con RF |
| TIR · Tramos de calidad | **61 %** | los 314 con RF |
| Duración efectiva | **57 %** | los 314 con RF |
| Top 10 · nº de posiciones | 88 % / 97 % | los 784 |

**La composición no es el hueco del programa.** Lo único flojo es el detalle duro de renta fija, y
solo para los fondos que tienen renta fija.

### Pero esa cobertura la pone Morningstar

Y ahí está el problema de verdad. **El techo independiente es otro**, y de los 765 fondos:

| | Fondos | % |
|---|---:|---:|
| Españoles: cartera y detalle trimestral en la CNMV, gratis y por ISIN | 97 | **13 %** |
| Extranjeros: sin fuente oficial estructurada en ninguna parte | 668 | **87 %** |

Para los 668 la única vía independiente es la ficha mensual en PDF de cada gestora, leída por un
lector automático, y **de esa vía no tengo medida la disponibilidad**: no sé en qué porcentaje de
las ~90 gestoras hay ficha pública, descargable y con estos campos.

**La frase que resume el apartado:** hoy la composición está casi completa, pero **retirar
Morningstar sin el lector de fichas la dejaría en el 13 %.** No es un hueco que haya que rellenar:
es una cobertura prestada que habría que reconstruir.

## 3. Por qué EODHD se queda, y qué no cubre

Para la serie no hay mejor opción, y el precio lo explica. Tarifas públicas de EODHD:

| Plan | Precio anual | Qué da que nos importe |
|---|---:|---|
| EOD Historical (All-World) | **199 $** | Precios de cierre, 30+ años, acciones, ETF e **índices globales** |
| EOD + Intraday | 299,90 $ | Lo anterior más intradía |
| Fundamentals | 599,90 $ | Fundamentales; **fondos solo de EE. UU.** |
| ALL-IN-ONE | 999,90 $ | Todo lo anterior |

Dos cosas que conviene tener claras:

- **Los índices globales entran en el plan básico.** Es decir, la serie del índice que hace falta
  para calcular alpha y beta aquí **ya está pagada**. Lo único que falta es saber qué índice le
  toca a cada fondo, que es el hallazgo del apartado 1.
- **EODHD no da composición de cartera de fondos europeos.** Su bloque de fondos es de EE. UU. Así
  que ningún aumento de gasto en EODHD cierra el hueco de composición. Esa decisión es
  independiente de la de la serie.

---

## 4. La comparativa con un proveedor: Morningstar

### El coste, con fuente primaria

No uso estimaciones de terceros. Estas cifras están en el **10-K de Morningstar presentado ante la
SEC** (ejercicio 2016), que es la propia empresa declarando sus precios:

| Producto | Precio anual declarado |
|---|---|
| **Morningstar Direct** | **17.500 $ el primer usuario**, 11.000 $ el segundo, 9.500 $ cada adicional |
| Morningstar Office | 6.000 $ por usuario, más cuentas y registro aparte |
| Morningstar Advisor Workstation | ~3.500 $ por usuario en configuración base |

Dos advertencias que no me invento y que hay que decir: son precios **de 2016** y **para clientes
de Estados Unidos**. No hay precio público más reciente, y Morningstar declara en su propia sección
para inversores que **no publica ingresos por usuario de los datos licenciados**, es decir, el
precio de un *feed* de datos no es público y se negocia.

### Qué compra y qué no

| | Morningstar | Fuentes libres + lo construido |
|---|---|---|
| Serie de VL | Sí | No (20-30 %) — lo cubre EODHD por 199 $ |
| Métricas de riesgo y rentabilidad | Dadas | **Se calculan de la serie**: no aportan nada |
| Composición de cartera (7 bloques) | **Sí: es quien pone el 96-99 % que hoy se ve** | **13 % oficial; el resto exige lector de fichas, sin medir** |
| Estilo y capitalización homogéneos | Sí | **No de forma homogénea** |
| Alpha, beta, R², TE, IR | Dados, sin decir contra qué | Calculables con la serie **si se captura el índice** |
| Categoría y estrellas | Sí | **No, y se conservan por decisión tuya** |
| TER | Sí | **98 %, ya resuelto** |
| Identidad legal, regulatorio, costes del KID | Parcial | **Mejor que Morningstar**: oficial y con documento verificable |

### ¿Compensa?

Mi lectura, con las cifras delante:

**Para los cálculos, no compensa en absoluto.** Lo que Morningstar aporta ahí son resultados que ya
se calculan de una serie que cuesta 199 $ al año. Pagar entre 18 y 88 veces más por números
derivados que además no se pueden auditar —no dicen contra qué índice— sería un mal cambio.

**Para la composición, la decisión es más seria de lo que parece**, porque no se trata de rellenar
un hueco: Morningstar **ya pone** el 96-99 % que hoy se ve. Retirarlo sin el lector de fichas
dejaría la composición en el 13 %. Construirla por fuentes libres significa medir la disponibilidad
de fichas mensuales, montar el lector, normalizar los criterios de cada gestora y mantenerlo de por
vida, con un techo que no es el 100 % y que hoy nadie ha medido.

**La asimetría que decide:** una licencia de Morningstar resuelve la composición *y* cierra para
siempre la puerta a comercializar sin licencias, que es el objetivo del proyecto. Las fuentes
libres dejan la composición incompleta *pero* dejan el sistema vendible. **No es una decisión de
coste: es una decisión de qué quieres que sea esto.** Si el sistema es para tu uso, la licencia es
defendible. Si es para comercializarlo, no lo es a ningún precio.

**Lo que haría yo, en este orden:**

1. **Llevar el índice de referencia a la maestra.** Está en la ficha del extractor en el 99,7 % de
   los fondos y en la maestra en el 0 %: se pierde en el canónico. Es el único campo necesario a
   cero, el arreglo es fontanería y hace auditable el alpha que hoy no lo es.
2. **Medir la disponibilidad real de fichas mensuales** en las gestoras del universo. Es la cifra
   que falta para saber si la composición se puede reconstruir sin Morningstar, y sin ella la
   decisión del apartado 4 no se puede tomar.
3. **El detalle de renta fija** —duración efectiva 57 %, TIR 61 %— por la vía de la CNMV para los
   españoles y de las fichas para el resto.
4. **Y solo entonces** decidir lo de Morningstar, con el número en la mano en vez de con una
   intuición.

El TER ya no está en esta lista: está al 98 % y no necesita nada.

Los tres primeros no cuestan ninguna licencia y no comprometen nada.

---

## 5. Lo que no he podido verificar, y no supongo

- **Las condiciones de licencia de EODHD** para uso profesional, para mostrar los datos a clientes
  y para redistribuirlos en un producto comercial. Tú lo tienes contratado y sabrás tu plan, pero
  esto conviene preguntarlo por escrito antes de construir un producto encima.
- **El precio actual de Morningstar**, y el de un *feed* de datos en vez de Direct: no son públicos.
  Las cifras de arriba son de 2016 y de EE. UU.
- **Tu situación actual con Morningstar.** El sistema toma hoy de Morningstar el 76 % de los pares
  campo-activo; no sé bajo qué licencia, y de eso depende si contratar sería un gasto nuevo o
  regularizar algo ya en uso.
- **La disponibilidad de fichas mensuales** por gestora, que es el dato que falta para cerrar el
  apartado 2.

---

## 6. Corrección: la primera versión de este informe tenía las cifras mal

Publiqué este informe con la cobertura de composición entre el 20 % y el 77 % y la conclusión de
que ahí estaba el hueco del programa. **Las cifras estaban mal por dos errores de medición
simultáneos:**

1. **Denominador equivocado.** Dividía por los 1.097 activos de la maestra, que incluyen 312
   acciones. Un campo que solo aplica a fondos aparece faltando en el 28 % de los casos cuando en
   realidad no aplica. Eso bajaba el TER del 98 % al 70 % y la mezcla de activos del 99 % al 77 %.
2. **Contaba claves en vez de documentos** en los bloques de mapa como sectores o regiones, lo que
   producía porcentajes por encima del 100 % y es lo que me hizo ver el error.

Corregido midiendo cada campo sobre la población a la que aplica. **La regla: el denominador tiene
que ser la población a la que el campo aplica, no el total de la base.**

Y la conclusión cambió de forma, no solo de número: no es que falte composición, es que la que hay
la pone Morningstar y el techo independiente sigue sin medir. Eso refuerza la recomendación —medir
la disponibilidad de fichas antes de decidir— y hace la decisión sobre Morningstar **más** delicada
que como la presenté, no menos.
