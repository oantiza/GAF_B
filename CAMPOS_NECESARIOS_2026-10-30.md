# Qué campos necesita de verdad el programa, por fondo

Medido el 30-10-2026 sobre la copia verificada de la maestra del 29-10 (1.097 activos, 765 de
ellos fondos) y sobre los tipos que la app consume de verdad —`bdbLiveApiContracts.ts` y
`types/bdbAssets.ts`—, no sobre lo que el contrato de la plataforma promete.

La pregunta que contesta: **cuántos campos hacen falta para los cálculos financieros, y cuántos
para la composición de cartera**, que son cosas distintas y conviene no mezclarlas.

## 1. La distinción que lo ordena todo: entradas y salidas

La app lee 89 campos por fondo y la maestra guarda 928 hojas por activo, pero esas cifras no
responden a nada por sí solas, porque **la mayor parte de lo que la app lee es resultado de un
cálculo, no un dato que haya que conseguir.**

Los 20 campos de riesgo y rentabilidad que muestra una ficha —rentabilidad anualizada a 1, 3, 5 y
10 años, volatilidad a esos mismos plazos, Sharpe, máxima caída, lo que va del año— **se calculan
todos de la serie de valor liquidativo**. Lo hace el extractor con la serie en EUR y el ESTR como
tipo libre de riesgo (procedencias `vl_eodhd:eod` y `vl_eodhd:estr`), y la plataforma los vuelca en
`metrics/latest`. Ninguno es un campo que haya que buscar en ninguna fuente.

## 2. Para los cálculos financieros: tres campos por fondo y dos series comunes

| Qué | Por qué es irreducible | Cobertura |
|---|---|---:|
| **Serie de VL en EUR** | De ella salen todas las métricas de riesgo y rentabilidad, y las correlaciones que necesita optimizar una cartera | **99 %** (1.091 de 1.097) |
| **Divisa** | Para convertir y para agregar sin mezclar | 100 % |
| **Coste corriente (TER)** | Entra en todo cálculo neto y en cualquier comparación honesta | 98 % |

Y dos series que no son por fondo, sino comunes a todo el sistema:

| Serie común | Para qué |
|---|---|
| **Tipo libre de riesgo (ESTR)** | Sharpe y cualquier medida ajustada por riesgo |
| **Serie del índice** | Alpha, beta, R², tracking error e information ratio. Hoy esas cinco vienen calculadas de Morningstar; con la serie del índice se calcularían aquí |

**La calidad de la serie es buena:** mediana de 3.940 puntos por activo, y solo 3 activos por
debajo de tres años en semanal, que es la ventana mínima que pide el optimizador. Dos activos no
tienen serie.

Eso es todo. **Para la parte matemática el sistema está prácticamente completo**, y lo que le falta
no es cobertura: es independencia. La serie viene de EODHD y es el único bloque del catálogo sin
sustituto público (§5 del catálogo de datos).

## 3. Para la composición de cartera: siete bloques, y están casi completos

Estos no se derivan de nada. O se consiguen, o no están. Medido **sobre la población a la que cada
campo aplica**, que es lo que corrige la primera versión de este documento (ver §6).

| Bloque | Qué es | Cobertura | Sobre qué |
|---|---|---:|---|
| `asset_mix` | Reparto RV / RF / liquidez / alternativos | **99 %** | los 784 fondos y ETF |
| `bond_types` | Tipos de bono | **97 %** | los 784 |
| `sectors` | Sectores de renta variable | **99 %** | los 561 con renta variable |
| `equity_regions` | Regiones de renta variable | **99 %** | los 561 con RV |
| `equity_styles` | Estilo: valor o crecimiento | **99 %** | los 561 con RV |
| `market_caps` | Tamaños de capitalización | **99 %** | los 561 con RV |
| `portfolio_exposure.duration` | Tramos de duración | **96 %** | los 314 con renta fija |
| `avg_credit_quality` | Calidad crediticia media | 80 % | los 314 con RF |
| `yield_to_maturity` | TIR | **61 %** | los 314 con RF |
| `portfolio_exposure.credit` | Tramos de calidad | **61 %** | los 314 con RF |
| `effective_duration` | Duración efectiva | **57 %** | los 314 con RF |
| `holdings_summary` | Peso del top 10 / nº de posiciones | 88 % / 97 % | los 784 |

Más `exposure_confidence`, que no es un dato del fondo sino la marca de cuánto fiarse del reparto:
sin ella, un asset mix incompleto parece completo.

**La composición no es el hueco del programa: está casi completa.** Lo que falta es el detalle duro
de renta fija —duración efectiva, TIR y tramos de calidad, entre el 57 % y el 61 % de los fondos
que tienen renta fija— y eso es, además, lo que el catálogo ya señalaba como mejorable por vía
oficial: la CNMV publica ese detalle para los fondos españoles y las fichas mensuales lo traen para
el resto.

## 4. El hueco de verdad: el índice de referencia

| | |
|---|---|
| En la ficha del extractor | **99,7 %** (768 de 770), de `morningstar_lt:ETFsnapshot` |
| En la maestra | **0 %** (0 de 784) |

El dato existe y se pierde en el camino: el canónico no lo lleva. Y su ausencia tiene una
consecuencia que no es de independencia sino de trazabilidad: la maestra guarda la volatilidad del
índice (66 %), su Sharpe (66 %) y el alpha contra él (65 %), **cifras que pueden acabar en un
informe de cliente sin que se pueda nombrar la referencia contra la que están medidas.**

Es el único campo necesario con cobertura cero, y el arreglo es fontanería, no adquisición.

## 5. El SRI, y por qué puede quedarse fuera

El SRI del KID es un entero del 1 al 7 y **no entra en ningún cálculo**. Su único uso en la app es
rellenar el `risk_score`, y ese hueco tiene tres orígenes posibles declarados en el propio código
(`metricsLatest.ts`): `SRI_KID`, `SRRI` o `VOL_BUCKET`. Es decir, **el sistema ya sabe funcionar
sin él**, cayendo al indicador antiguo o a un tramo de volatilidad calculado de la serie.

Para que la app lo acepte como `SRI_KID` hace falta además un bloque de evidencia completo —fecha,
URL, sha256, ISIN verificado y marca de descarga—, y hoy lo tienen **685 de los 765 fondos
(89,5 %)**; otros 78 guardan el número sin evidencia y la app lo ignora.

Así que la conclusión sobre el trabajo del KID, dicha sin adornos: **mejora un campo regulatorio
que no alimenta ningún cálculo.** Lo que sí alimenta un cálculo es el otro contenido del mismo
documento: las cinco cifras de coste, y entre ellas los gastos corrientes, que son el TER que hoy
se toma de Morningstar en 765 fondos. Esa es la parte del KID que vale para las matemáticas.

## 6. Lo que esto deja decidido y lo que no

**Decidido por los números:** el esfuerzo de datos no debe ir a más campos de métricas —no existen
como campos—, ni al SRI, ni a la composición general, que ya está entre el 96 % y el 99 %. Debe ir
a **llevar el índice de referencia a la maestra**, que es el único campo necesario a cero, y al
**detalle de renta fija**, que es lo único por debajo del 61 %.

Y sigue en pie la dependencia única: **la serie**, al 99 % pero con una sola fuente.

## 7. Corrección: la primera versión de este documento tenía las cifras mal

La primera versión decía que la composición estaba entre el 20 % y el 77 % y que ahí estaba el
hueco del programa. **Era falso, por dos errores de medición a la vez:**

1. **Dividía por los 1.097 activos de la maestra**, que incluyen 312 acciones. Un campo que solo
   aplica a fondos parece faltar en el 28 % de los casos cuando en realidad no aplica.
2. **Contaba claves en vez de documentos** en los bloques de mapa (sectores, regiones), lo que
   daba porcentajes por encima del 100 % y me hizo ver el error.

Corregido midiendo cada campo sobre la población a la que aplica: todos los fondos y ETF para el
asset mix y los costes, los que tienen renta variable para sectores y estilos, los que tienen renta
fija para duración y calidad. **La regla, que es la lección del día: el denominador tiene que ser
la población a la que el campo aplica, no el total de la base.**

Lo mismo afectaba al TER, que daba 70 % y está al **98 %**: la idea de rellenarlo desde el KID no
hace falta, porque solo **un** fondo de 770 carece de TER teniendo gastos corrientes del KID.
