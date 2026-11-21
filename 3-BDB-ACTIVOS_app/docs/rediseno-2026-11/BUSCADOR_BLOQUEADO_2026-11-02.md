# El buscador: por qué estaba bloqueado y qué quedó

> **Estado a 04-11-2026:** la aplicación está en producción sobre la base nueva. Este documento es registro de cómo se planificó y varias cifras y pendientes están superados. Lo que queda está en [el informe de cierre](https://claude.ai/artifact/VHoLhhQE7SNhzMPe4S4kwv).

*02-11-2026. Medido antes de tocar nada, al ir a hacer el segundo intercambio pantalla a
pantalla. **Resuelto el mismo día**: la última sección cuenta cómo quedó.*

El primer intercambio —la ficha— salió limpio porque una ficha es **un** instrumento: se
lee de la base nueva, y si la base nueva no lo tiene, se pinta la anterior. Instrumento a
instrumento, sin que el asesor note nada.

Una lista no admite ese trato. Si el buscador se alimenta de la base nueva, lo que esa
base no tiene **no existe para el asesor**: no es que salga con huecos, es que no aparece
al buscarlo. Y eso lleva a lo que bloquea el cambio.

## La base nueva no tiene 22 de los 1.097 activos del catálogo

| | |
|---|---|
| Base de siempre (`assets`) | 1.097 |
| Base nueva (`instruments`) | 1.077 |
| En las dos | 1.075 |
| Solo en la de siempre | **22** |
| Solo en la nueva | 2 |

No son restos. Entre los 22 están:

| ISIN | Tipo | Nombre |
|---|---|---|
| US78462F1030 | ETF | SPDR S&P 500 ETF Trust |
| US46090E1038 | ETF | Invesco QQQ Trust |
| DE0005933956 | ETF | iShares Core EURO STOXX 50 UCITS ETF (DE) |
| DE000A0F5UJ7 | ETF | iShares STOXX Europe 600 Banks UCITS ETF (DE) |
| IE00BDBRDM35 | ETF | iShares Core Global Aggregate Bond UCITS ETF |
| LU0290358497 | ETF | Xtrackers II EUR Overnight Rate Swap UCITS ETF |
| ES0105336038 | ETF | Acción IBEX 35 Cotizado Armonizado FI |
| JP3633400001 | STOCK | Toyota Motor |
| JP3902900004 | STOCK | Mitsubishi UFJ Financial Group |
| JP3122400009 | STOCK | Advantest |
| AU000000BHP4 | STOCK | BHP Group Ltd |
| AU000000CBA7 | STOCK | Commonwealth Bank of Australia |
| AU000000BKY0 | STOCK | Berkeley Energia Limited |
| ES0132955008 | STOCK | CEVASA |
| LU0591059224 | FUND | Robeco Asian Stars Equities D EUR |
| LU1493953001 | FUND | T. Rowe Price Glb Val Eq A (EUR) |
| LU1882457739 | FUND | Amundi Funds – Emerging Markets Corporate High Yield |
| LU1883319474 | FUND | Amundi Funds – Global Equity Responsible C EUR |
| LU1883342880 | FUND | Amundi Funds – Global Equity C EUR (C) |
| ES0132526031 | FUND | Oportunidad Bursátil, S.A., SICAV |
| ES0162296000 | FUND | Cartera Renta Fija Horizonte 2028, FI |
| ES0173985005 | FUND | River Patrimonio, FI |

Siete ETF, siete acciones y ocho fondos. **Un buscador que no encuentra el S&P 500 no es
un buscador**, así que cambiarlo hoy no es una mejora con una pega: es una pérdida.

## Tres causas, y ninguna es de la pantalla

Comprobado fichero a fichero contra `1-extractor/data/funds/` y `1-extractor/export_bdb/`:

| Cuántos | Qué les pasa | Dónde se arregla |
|---|---|---|
| **14** | **No están en el universo del extractor** (`config/fondos.csv`). Nunca se pidieron. Están en la base de siempre porque esa base es un clon de la maestra de BDB, que acumuló 1.097 activos. | `1-extractor`: darlos de alta con `add` y extraerlos |
| **6** | **Sí están en el universo y no tienen ficha.** Tres australianas (BHP, Commonwealth Bank, Berkeley Energia) y tres japonesas (Toyota, Mitsubishi UFJ, Advantest). No están en cuarentena: simplemente nunca se extrajeron con éxito. | `1-extractor`: una pasada de `update` sobre ellas |
| **1** | `ES0132955008` (CEVASA) tiene ficha pero el adaptador lo declara **fuera de alcance**, y lo dice en voz alta al generar el canónico. | Decisión: entra en el alcance o se acepta que no esté |
| **1** | `ES0132526031` tiene ficha y canónico, y el mapeo de la plataforma lo rechaza: **«sin divisa utilizable»**. Es el único error de los 1.078 del dry-run. | `2-plataforma-datos`, o el dato de origen |

**Corrección a la primera versión de este documento**, que decía que los veinte estaban
fuera del universo. No es así: el universo tiene 1.085 filas y **ocho de los 22 ya
estaban dentro**, seis de ellos sin ficha ninguna. La diferencia entre 1.097 y 1.079 no
es solo lo que nadie pidió; también es lo que se pidió y no llegó. Importa porque son
dos arreglos distintos: a unos les falta el alta y a otros la extracción.

## Lo que sí faltaba en la pantalla, y ya está

Abrir la ficha desde una fila. Una lista existe para llevarte a una ficha, y hasta hoy
esta tabla no llevaba a ninguna parte: se podía ordenar y filtrar y no se podía abrir
nada. Ahora una fila abre `/activo/<ISIN>`, por el mismo camino que usa el Buscador de
siempre, así que «Atrás» vuelve a la lista.

## Lo que seguiría faltando el día que los 22 entren

Para que el buscador nuevo pueda sustituir al de siempre, además de los 22:

| De hoy | Estado en el nuevo |
|---|---|
| Añadir a cartera desde la fila | no está |
| Marcar para comparar desde la fila | no está |
| Mesa de trabajo (n/5 para comparar, abrir cartera) | no está |
| Filtro por región | no está |
| Filtro por clase de activo | no está |
| Solo favoritos | no está |
| Mostrar sin histórico | no está |
| Búsqueda contra el backend, con cursor y total honesto | en memoria sobre las 1.076 tarjetas |
| Filtro por tipo | está, con cuatro opciones; hoy son cinco (falta Índices) |
| Abrir la ficha | **está, desde hoy** |

Son todas de la pantalla y se pueden hacer. Lo que no tiene sentido es construirlas antes
de saber si el buscador va a poder alimentarse de esa base, que es la decisión de arriba.


---

## Cómo quedó, la misma noche

Óscar dijo que se dieran de alta. Hecho, y el resultado cambia la conclusión de este
documento: **no faltaban 22, faltaba 1.**

| | Antes | Después |
|---|---|---|
| Base de siempre | 1.097 | 1.097 |
| Base nueva | 1.077 | **1.091** |
| En las dos | 1.075 | **1.089** |
| Solo en la de siempre | 22 | **8** |
| Solo en la nueva | 2 | 2 |

**Los 14 que faltaban por alta están dentro**, incluidos el SPDR S&P 500, el Invesco QQQ
y el iShares Core EURO STOXX 50. Costó 314 peticiones a red.

**De los 8 que quedan fuera, siete no son un hueco: son decisiones tuyas.**

- **Seis acciones** —BHP, Commonwealth Bank, Berkeley Energia, Toyota, Mitsubishi UFJ y
  Advantest— ya tienen ficha, y aun así no entran: `alcance_mercados.json` las deja
  fuera por «solo Europa y EEUU», decisión del 02-11-2026. Dos de ellas cotizan en
  Stuttgart, así que es el país del **emisor** el que las excluye, no la plaza.
- **CEVASA**, fuera por tu instrucción del mismo día.

La base nueva, en esos siete, no va por detrás del catálogo: va por delante. El que se
quede fuera es lo correcto, y el buscador debe reflejarlo.

**El único hueco real es `ES0132526031`** (Oportunidad Bursátil, SICAV): el mapeo lo
rechaza con «sin divisa utilizable». Y la divisa sí existe —su ficha trae
`valoracion.vl_divisa` = EUR—; lo que falta es `identificacion.divisa_base`, que es de
donde el canónico la toma. Es un arreglo de una línea en el adaptador o en el mapper, y
ninguno de los dos ficheros es de esta sesión.

Y hay **2 instrumentos que solo están en la base nueva** (`IE0007987708`,
`IE0031786696`): el buscador nuevo los **gana**, porque el extractor los cubre y la
maestra de BDB de la que sale la base de siempre no.

### Lo que esto deja

El buscador ya no está bloqueado por los datos. Lo que falta para sustituirlo es la
tabla de arriba: acciones de fila, mesa de trabajo, favoritos y los filtros de región y
clase de activo. Todo de pantalla.
