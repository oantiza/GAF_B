# Decisiones de la base nueva

*1 de noviembre de 2026. Las decisiones son de Óscar; el análisis, la medida y las
recomendaciones, de Claude Opus 5.*

Lo que Óscar decidió el día que la base nueva pasó del diseño al dato. No repite el **por qué**
de cada campo —eso vive en la descripción de su contrato, que es donde hace falta al tocarlo—:
recoge **qué se decidió, cuándo y dónde se hace cumplir**, para que no se vuelva a discutir y
para que cada decisión sea rastreable hasta el código que la sostiene.

La **8** manda sobre las demás en todo lo que toque métricas, y es la única que salió de una
objeción suya a un razonamiento de Claude, no de una pregunta abierta. La **9** y la **10** son
su consecuencia: si nos fiamos de lo que calculamos, el método es nuestro y se especifica.

Las cifras marcadas **medido** salen de contar. Las marcadas **proyectado** son una regla de
tres sobre una muestra que se declara.

---

## 1. Ningún nombre comercial de banco, en ninguna parte

El producto es neutro e independiente. El nombre de un banco **no aparece como marca** ni en
informes, ni en la interfaz, ni en elementos de desarrollo, salvo que Óscar lo elija.

Lo que **sí** aparece con normalidad es el nombre de una entidad **como dato**: el nombre de un
fondo, su gestora, su depositario. «Fondos de tal banco» es un dato del producto, no una marca
del nuestro.

## 2. La política de distribución es obligatoria, y `UNKNOWN` es un valor válido

Obligatorio significa **declararla**, no conocerla. Y **nunca se adivina del nombre de la
clase**.

- Se hace cumplir en `instrument-declared-profile.v2`: `distribution_policy` es requerido, y una
  política distinta de `UNKNOWN` exige `distribution_policy_resolution`. Lo comprueba el
  esquema, no la disciplina.
- Por qué no el nombre: **medido** el 31-10, de 16 fondos que reparten y se conocen por otra
  vía, el nombre falló en 1. Y de 10 sondeados el 01-11, 4 repartían sin decirlo ni en el
  nombre ni en la jurisdicción.

## 3. Las entidades declaran tres papeles y hoy solo se puebla el emisor de acciones

`issuers` admite los tres, pero solo `EQUITY_ISSUER` tiene fuente. Los otros dos quedan
declarados y vacíos, que es distinto de no existir.

## 4. La pasada completa de los 558 fondos, aun costando siete horas

Se lanzó a las 12:25 del 01-11 para traer la respuesta del endpoint de reparto que faltaba.
**Medido** antes de gastarla: 32,8 peticiones y 44 s por fondo, unas 18.300 peticiones y 6 h 50
de reloj. Se aceptó el coste sabiendo que son horas seguidas contra una API interna de
Morningstar sin licenciar que ya se cortó sin aviso el 03-09.

## 5. Manda el desglose detallado de asignación de activos

Donde `sal_allocationMap` y el resumen del snapshot discrepan, gana el detallado.

- **Medido**: de 379 respuestas, 295 coinciden dentro de un punto, 38 difieren de 1 a 5 y 46 más
  de 5. De esos 46, mirados uno a uno: en 18 el valor guardado **era** el roto (media bolsa), en
  7 el canónico no sumaba 1 y el detallado sí, en 2 lo resolvió la identidad del fondo, en 12 el
  contrato rechaza las dos cifras por rango, y 7 quedaron en empate con la bolsa a 0 % en las dos
  versiones. **27 a 0** a favor del detallado.
- No hizo falta cambiar nada para que mande: al dejar de perder masa, la suma vuelve a la banda
  de 80-120 y la guarda deja de rechazarlo. La guarda estaba compensando un defecto nuestro.

## 6. Una cartera modelo no tiene cliente, y su ruta no lo exige

Las siete rutas del dominio empezaban por `clients/{client_id}` y **no existe ni un registro de
cliente**. Las 23 carteras guardadas cuelgan de `owner_uid`, el asesor.

Una propuesta pertenece al asesor y a ningún cliente, así que exigirle uno era el error. El dueño
pasa a ser un campo declarado y no un tramo de la ruta: `advisor_id` en las modelo, `client_id` en
las reales, y el esquema comprueba que el id corresponde al tipo y que no hay dos dueños.
`clients/{client_id}` sigue existiendo para el día que se decida qué es un cliente.

**Sigue abierto, y es decisión de producto:** qué es un cliente —perfil, horizonte, objetivos,
histórico—. Sin eso no hay cartera real, ni libro de operaciones, ni valoración medida con flujos.

**Decidido por ahora (C-25, 11-11-2026):** sin ficha de cliente, y se revisa con la respuesta de cumplimiento.

## 7. Se publican TODAS las métricas propias con evidencia, con su grado declarado

No solo las de evidencia fuerte.

- **Proyectado** sobre 752 fondos: unas 450 métricas propias publicables, y en torno al **95 %
  apoyadas en `PROVIDER_NO_RECORDS`**, que es el grado más débil de los cuatro: una ausencia
  afirmada por un tercero, no el folleto.
- Lo que sostiene esa decisión, **medido** el 01-11: de 14 fondos que reparten por vía
  independiente, los 12 con respuesta traída quedaron confirmados por el endpoint con pagos, y
  **ninguna lista vacía desmintió a nadie** en 525 casos. Doce de doce.
- La alternativa descartada era publicar solo las ~50 fuertes, que tiraba 400 cifras correctas
  para evitar un riesgo que la prueba no encontró.
- Se hace cumplir en dos sitios: `instrument-computed-metrics.v2` exige
  `inputs.distribution_policy_resolution`, así que una métrica sin evidencia **no se puede
  escribir**; y el grado viaja además en `instrument-read-card.v2`, que es el documento que lee
  la aplicación, para que un informe pueda decir en qué se apoya sin leer bloque a bloque.

## 8. Nos fiamos de la serie, no de la cifra, porque la serie se puede auditar

Es el principio que manda sobre las demás decisiones de métricas, y salió de una objeción de
Óscar: Morningstar puede estar retrasado o incompleto en lo que publica gratis, porque por algo
cobra. Antes de medirla, la frase era una preferencia con buena pinta. Medida, es una regla.

**Retrasado**, medido el 01-11: la fecha de dato de Morningstar es más vieja que el fin de
nuestra serie en **468 de 468 fondos**, con una mediana de **27 días** y un máximo de 57. Sus
cifras son a 30-09 en 456 fondos y a 31-08 en 12; nuestra serie llega al 26-29 de octubre. No es
un desfase ocasional: es su cadencia de publicación gratuita.

**Incompleto**, medido el mismo día: de las **69.069** posiciones que los fondos declaran tener,
el proveedor entrega **35.107, el 50,8 %**. Solo 91 de 203 fondos medibles traen la cartera
completa, y 562 de los registros no declaran siquiera su cobertura. El historial de reparto está
cortado en cinco pagos anuales, que es la misma política vista en otro campo.

**Por qué el principio, y no solo la preferencia.** Una serie de valores liquidativos es una
observación primaria: tiene fechas, se le ven los huecos, se cuentan sus puntos y se sabe cuándo
dejó de moverse. Una cifra de un proveedor es un número derivado cuya ventana, convención y
fecha no se pueden inspeccionar. Auditable no significa correcta: significa que cuando está mal
se puede ver.

### Lo que se sigue

1. **La tarjeta lleva nuestra cifra** en lo que calculamos. Una ficha con el valor liquidativo
   del 29-10 y una volatilidad del 30-09 se contradice consigo misma.
2. **La del proveedor se queda en `declared/provider_risk` como control**, no como alternativa
   en el titular. Enseñar dos cifras de la misma magnitud al lado contradice «un dato, un sitio»
   justo donde lo lee un cliente: si la nuestra está verificada, la segunda no es información,
   es duda presentada como dato.
3. **Una marca cuando el control discrepa**, para que esos pocos fondos los mire una persona
   antes de que lleguen a un cliente.
4. **Lo que no se puede cocinar va como suyo, con su nombre y su fecha**: beta, R² y alpha
   contra un índice, porque en la maestra hay cero activos de tipo índice. Ahí no hay elección y
   lo honesto es decirlo.

**Los cuatro se hacen cumplir en `componerTarjeta`** (`src/ingestion/baseNueva/calidadYTarjeta.ts`),
y el contrato de `instrument-read-card.v2` lleva los campos que los sostienen: `metrics.source`,
`metrics.as_of`, `metrics.provider`, `metrics.control` y `metrics.relative`. Medido el 01-11-2026
sobre las 772 tarjetas: el titular es nuestro en **642** y del proveedor en 130; el bloque relativo
es nuestro en 145 y del proveedor en 588; en `provider` solo sobra el Sharpe, y solo en los 25 fondos
cuya clase no está en euros —no se suprime, va dicho como suyo—; y el control marca **31 fondos**, con
37 marcas.

Por magnitud manda **una sola fuente**, ni media magnitud de cada uno: si la nuestra trae la
volatilidad, la del proveedor no entra en el titular ni en otra ventana. Y el cuarto paso cambió de
alcance el mismo día: desde la decisión 11 hay beta, R² y alpha **nuestros** en 145 fondos, medidos
contra un fondo índice aprobado, así que lo que va como del proveedor es lo que no tiene proxy.

Y el cuarto paso obligó a corregir algo que la decisión daba por hecho: **la cifra relativa del
proveedor no está medida contra el benchmark del folleto.** Medido el 01-11-2026, 24 fondos que
declaran «MSCI ACWI NR USD», con la misma fecha de dato y la misma divisa, traen diez volatilidades
distintas del «índice», del 9,61 % al 22,42 %. Descartadas fecha y divisa, la cifra agrupa por
categoría Morningstar —22,42 % en Sector Equity Technology, 9,61 % en Global Equity Income— y 78 de
105 categorías traen una sola; controlando las dos, 218 de 476 fondos comparables discrepan de la
mayoritaria de su propio benchmark. Así que `relative.reference` dice contra qué se midió
—`DECLARED_BENCHMARK_PROXY` o `PROVIDER_CATEGORY_INDEX`—, la del proveedor nombra su categoría y no
el folleto, y el contrato **no admite** un `benchmark` al lado de una cifra de categoría. Sin
categoría no hay con qué nombrar la referencia y el bloque no se escribe: 39 fondos.

Lo que el umbral del tercer paso enseñó, y que no estaba en la decisión: **tiene que ser por
ventana**. Un umbral único marcaba 159 de 642, una cuarta parte del libro, porque el desfase de 27
días desplaza una ventana de 12 meses un mes entero y a tres años solo un treintavo. Los umbrales
están en el percentil 98-99 medido de cada ventana, más un suelo de medio punto de volatilidad
absoluta, y lo que la marca dice es «este fondo discrepa más que el 99 % del libro», no «esta cifra
está mal». De las 37 marcas, 22 son del Sharpe y casi todas de monetarios y de deuda a corto: con
una volatilidad minúscula, el Sharpe se mueve enormemente por un mes de ventana. Eso es lo que la
lista dice que hay que mirar.

### La condición, que no es implícita

«Ingredientes asegurados» es una **comprobación**, no un supuesto. La serie viaja con sus
observaciones, su primera y última fecha y su estado, y el extractor ya detecta las paradas —17
fondos con la serie detenida entre 21 y 1.218 días el 29-10—. Donde la serie no pasa su propia
auditoría, la ficha lo dice y cae a la del proveedor etiquetada.

Y los dos fondos de MARCH más el de ventana corta, que hay que mirar uno a uno antes de dar su
serie por asegurada.

### El Sharpe es una medida comparativa, así que la regla es otra

Corrección de Óscar a una propuesta de Claude, el mismo día. Claude propuso **suprimir** el
Sharpe de los fondos de volatilidad diminuta, por considerar que la cifra «deja de significar
algo». Es un error de categoría: estaba tratando el Sharpe como una medida absoluta que debe ser
verdadera.

No lo es. El Sharpe solo sirve para **ordenar**. Da igual que los parámetros los haya elegido uno
mismo o un tercero mientras el resultado sea coherente con la definición matemática de la fórmula
y **se aplique la misma escala a todo lo que se compara**. La incoherencia que hay que perseguir
no es el valor del parámetro: es mezclar dos conjuntos medidos con parámetros distintos.

**La regla, sin excepción:** el Sharpe **no se suprime bajo ningún concepto**. Se publica
siempre, con una sola escala —la nuestra, `ESTR_EUR`, misma ventana— y **nunca se ordena una
cifra contra otra de escala distinta**.

No hay umbral de volatilidad por debajo del cual se oculte, ni aviso que lo acompañe, ni fondo
exento. Si alguien vuelve a proponerlo, esto es la respuesta: el ruido de una medida comparativa
se ve mirando la volatilidad que va a su lado, no escondiendo la medida.

La condición es la evidente: **mientras sea calculable y tengamos los datos**. Y los tenemos.

Los dos únicos casos en que no sale un Sharpe no son decisiones:

1. **Aritmética.** `fetchers/eodhd.py` calcula `(rentabilidad − rf) / volatilidad` con una guarda
   `if vol`, que solo excluye la volatilidad **exactamente cero**. Con 0,35 % sale, y debe salir.
   Comprobado el 01-11 que no hay ningún otro sitio en el extractor ni en la plataforma que lo
   filtre.
2. **Falta el ingrediente, no la voluntad.** Medido el 01-11: de 467 fondos con volatilidad
   propia, **452 tienen Sharpe propio y los 452 están en euros**; los 15 que no lo tienen son
   **14 clases en dólares** y una sin divisa de cálculo. No está suprimido: tenemos el ESTR del
   BCE y no un tipo libre de riesgo del dólar, y aplicar el euro a una clase en dólares daría una
   cifra incoherente con la fórmula. Con un tipo del dólar esos 14 tendrían Sharpe — en su propia
   escala, y por la misma regla, sin ordenarse contra los de la escala del euro.

Comprobado el 01-11 que ya se cumple: los **456** fondos con Sharpe propio usan `ESTR_EUR`,
ninguno sin declararlo, y el tipo tiene un único valor por ventana salvo **un** fondo medido a
31-10 en vez de 30-09, que queda fuera de escala y hay que alinear. El tercer valor que aparece
al medir (2,88 % a tres años) **no es de fondos**: son las 73 acciones, fuera de alcance, y con
la serie sin refrescar desde el **17 de julio**, que importará cuando entren.

Lo que sí sostiene la matemática, como matiz y no como objeción: con una volatilidad de 0,35 % el
Sharpe no es falso, es **ruidoso** —el mismo fondo puede salir −2,0 un mes y +1,5 el siguiente
sin haber cambiado—. Eso no invalida la ordenación, la hace inestable, y el lector ya tiene con
qué verlo porque la tarjeta lleva la volatilidad al lado del Sharpe. No hace falta suprimir nada
ni añadir un aviso.

### Lo que la coincidencia con Morningstar sí demuestra, y lo que no

Sí: que el **método** es correcto. Dos proveedores independientes —la serie de EODHD y la cifra
de Morningstar— y dos implementaciones distintas dan el mismo número en más del 98 % de 3.577
comparaciones de rentabilidad y 1.370 de volatilidad, con diferencia mediana 0,000. Y las dos
usan el mismo tipo libre de riesgo: 2,764 % despejado del Sharpe de Morningstar a tres años
contra 2,778 % de nuestro ESTR.

No: nada sobre su frescura ni su integridad. Usar esa coincidencia como corroboración general
fue un error de Claude, y lo corrigió la objeción de Óscar.

## 9. El método es nuestro, y sus parámetros los cambiamos nosotros

No es el de Morningstar ni el de ningún tercero. Los parámetros —ventanas, frecuencia, tipo libre
de riesgo, divisa, convenciones— los elegimos nosotros y los cambiamos nosotros cuando haya
razón, mientras sean lógicos y coherentes con la definición matemática de cada fórmula.

Queda especificado en `METODO_PROPIO_METRICAS_2026-11-01.md`, para que `EXTRACTOR_MONTHLY_V1`
apunte a algo preciso y no a una frase. Lo que ese documento añade y aquí no se repite: cada
parámetro con su valor medido sobre el código, y la consecuencia que importa —**cambiar un
parámetro cambia la versión del método**, porque una cifra calculada con otros parámetros no es
comparable con las anteriores y por tanto no puede compartir identificador. La conversión a euros
de la decisión 10 produce `EXTRACTOR_MONTHLY_V2`.

Que las convenciones coincidan hoy con las de la industria no hace que el método sea de un
tercero: el estándar es el estándar y las elecciones son nuestras. La coincidencia con Morningstar
es **una comprobación, no una dependencia**.

## 10. Las métricas se calculan en euros

*Construida el 03-11-2026 en la base local: métodos V2, ver la §5 del método.*

Se calculaban en la divisa de la clase. Pasan a calcularse en euros, convirtiendo la serie
antes de calcular, con los tipos de referencia del BCE.

No es preferencia: `base_currency` de una cartera es `const EUR`, invariante del sistema decidida
el 31-10. Si una cartera se mide en euros, sus componentes también, porque **no se puede combinar
una volatilidad en dólares con una en euros** para obtener la de la cartera. La alternativa
—aplicar un tipo del dólar a las clases en dólares— es correcta por separado pero crea dos
escalas que nunca podrían mezclarse, que es justo lo que prohíbe la regla del Sharpe.

Está medio hecho: `core/metricas.py::a_eur` existe y está probado, y documenta el flujo del BCE
que espera (`EXR D.X.EUR.SP00.A`, tolerancia de 7 días por los festivos de TARGET). Hoy no lo
llama nadie. Falta traer esa serie, que es la misma API del BCE del €STR.

Desbloquea las **14 clases en dólares** sin Sharpe y los **2.971 cubos** convertidos sin el BCE.
Y obliga a declarar `inputs.currency` EUR, `inputs.source_currency` la original y `fx_source`
`ECB_REFERENCE`, porque la volatilidad de una clase en dólares medida en euros incluye la del
EUR/USD —del orden del 7-9 % anualizado—, que para este producto es el riesgo real del cliente
que la tiene sin cubrir.

## 11. Los índices se replican con fondos índice, no con ETF

Para calcular beta, R², alpha y tracking error hace falta la serie del índice, y en la maestra
había cero activos de tipo índice. No es un problema de licencia: **un fondo índice de
acumulación es un ISIN**, y un ISIN se trae igual que los 752 que ya se traen.

**Un fondo índice mide mejor que un ETF, y se midió.** Los dos sobre el mismo MSCI World, los
dos de acumulación y en euros:

| | vol 1a | vol 3a | vol 5a |
|---|---:|---:|---:|
| ETF cotizado (`EUNL.XETRA`) | 11,48 | 12,25 | 13,20 |
| Fondo índice (valor liquidativo) | 10,27 | 11,43 | 13,22 |

El ETF añade **1,2 puntos de volatilidad a un año** y un tracking error entre ambos de 1,85 a
3,00 puntos que es **artefacto de medición**: su cierre en XETRA es a las 17:30 y el valor
liquidativo se calcula tras el cierre de Estados Unidos. Miden el mismo índice en momentos
distintos del día. La prueba de que el fondo índice es el bueno: dos gestoras distintas, dos
fondos de MSCI World, volatilidad a tres años **11,433 y 11,434**.

### Los proxies aprobados el 01-11

| Benchmark | Fondos | ISIN | Serie comprobada |
|---|---:|---|---|
| MSCI Europe NR | 49 | `IE0007987708` | Vanguard European Stock Index EUR Acc, 4.292 pts desde 2010 |
| MSCI World NR | 38 | `IE00B03HD191` | Vanguard Global Stock Index EUR Acc, **ya estaba en el universo**, 6.557 obs |
| MSCI EM NR | 18 | `IE0031786696` | Vanguard Emerging Markets Stock Index EUR Acc, 3.256 pts desde 2014 |
| MSCI World NR (control) | — | `IE00BYX5NX33` | Fidelity MSCI World Index EUR P Acc, 2.218 obs |

**105 fondos cubiertos.** Entran en `config/fondos.csv` como `tipo: fondo`, que es lo que son y
además lo que hace que `vl_eodhd` les traiga la serie: con `tipo: indice` no se la traería.

Las cinco condiciones de un proxy —acumulación, sin cubrir, variante correcta, réplica física,
tamaño— no las afirma nadie de palabra en dos de ellas: la **acumulación la verifica la cadena
de evidencia** construida hoy, y los dos de MSCI World salen con
`politica = sin_repartos_del_proveedor`. El control existe por algo: tener dos fondos del mismo
índice no es redundancia, es cómo se detecta que uno se ha torcido.

**Sigue abierto el más grande: MSCI ACWI NR, 69 fondos.** No hay fondo índice con valor
liquidativo que lo replique. Las dos salidas son el ETF `IE00B6R52259`, que paga el peaje de 1,2
puntos, o componerlo con mundo desarrollado más emergentes, que mediría limpio pero sería una
construcción nuestra con pesos que mantener y habría que declararla como compuesta.

Y **55 fondos no necesitan nada**: su benchmark es una tasa —€STR, Euribor, SOFR— y el €STR ya
se trae del BCE todos los días.

---

## 12. Una acción se mide contra el índice ancho de su mercado, y consta que lo elegimos nosotros

*Actualizada por la decisión 24 el 04-11-2026: Estados Unidos ya tiene índice, y una acción publica beta y R², no alfa.*

Decidido el **02-11-2026**, al entrar las acciones en la base nueva.

Ninguna acción declara índice de referencia: no existe el folleto que lo diga. Así que hoy no
hay beta, ni R², ni alpha para ninguna, y la ficha dice que no aplica —que es correcto, pero
deja sin medir lo que un asesor usa para situar una acción—.

Se le asigna el **índice ancho del mercado donde cotiza**, y se registra como **elección
nuestra**: ni declarado en un folleto, ni la categoría de un proveedor. La maquinaria existe
desde el 01-11 y esto es su tercer caso, junto a `DECLARED_BENCHMARK_PROXY` y
`PROVIDER_CATEGORY_INDEX`.

**El porqué de la etiqueta y no solo del índice.** Las cifras del proveedor no eran del
benchmark que nombrábamos, y lo que las arregló no fue cambiarlas: fue que el dato dijera contra
qué se midió. Una beta de acción contra un índice que elegimos nosotros es legítima mientras lo
diga; lo que no se puede es que parezca declarada por alguien.

Hereda sin cambios la decisión 11: el índice se replica con un fondo índice, no con un ETF, y
los proxies aprobados ya están en el universo.

**Medido el 02-11, y obliga a matizarla el mismo día.** Medir una acción contra el índice ancho
de su mercado necesita **la serie de ese índice, para cada mercado**, y no tenemos la de
ninguno. `config/indices.csv` tiene cuatro índices y **los cuatro son de área**: MSCI Europe,
World, EM y ACWI. Ni IBEX, ni DAX, ni CAC, ni S&P 500.

**Corregido el 02-11, el mismo día: la primera versión de estas cifras estaba mal.** Se contaron
sobre `config/fondos.csv` mientras el alta lo estaba escribiendo, así que daban lo registrado en
ese instante y no el alcance: decían **US 44** cuando el alcance tiene **US 80**. Las buenas
salen del prefijo del ISIN sobre la lista fija de 312, que no se mueve.

El alcance, contado así: **ES 115, US 80, DE 38, FR 35**, NL 13, GB 6, IT 4, IE 4, CH 4, CA 3 —
**302**. Fuera, LU 3, JP 3, AU 3 y FI 1.

**Las dos opciones, con las cifras buenas:**

| | cubre | sin referencia |
|---|---:|---:|
| Índice de área (MSCI Europe) | **215** | **87** |
| Cuatro proxies de plaza (ES, US, DE, FR) | **268** | 34 |

Los 87 de la primera son las **83 de Norteamérica** —US 80 y CA 3, el 27 % del alcance— más las
cuatro irlandesas, por el motivo del párrafo siguiente. La diferencia entre las dos opciones es
de **53 acciones**, no de 36 como decía la cuenta mala.

**Y un criterio que no es de cobertura y que afecta a las dos.** Las cuatro irlandesas son
Linde, Eaton, Seagate y Medtronic: empresas americanas con domicilio en Dublín que cotizan en
Estados Unidos. Asignar el índice **por prefijo del ISIN** les da MSCI Europe, que no es su
mercado — el mismo defecto que esta decisión existe para evitar, reapareciendo en la
asignación. Con índice de plaza no ocurre, **siempre que la plaza se tome de la cotización y no
del ISIN**.

De ahí las dos cosas que la ficha tiene que poder decir, y que no son la misma:

- **Que el índice es de área y no de la plaza.** Una beta de una acción española contra MSCI
  Europe mide sobre todo cuánto se parece España a Europa. Es una cifra legítima y es la que
  tenemos; lo que no puede es parecer una beta contra el mercado de la acción.
- **«No se midió contra nada»**, para las **83** de Norteamérica. Es la mitad que se olvida: una
  etiqueta que solo sabe nombrar al índice elegido deja a las demás con el campo vacío, y un
  campo vacío no afirma nada, que es justo lo que esta base existe para evitar.

**Reconfirmado el 02-11 con las cifras buenas: área de momento, y la plaza queda aplazada, no
descartada.** Óscar lo dijo con el caso que lo define: «mi Medtronic me gustaría compararla
contra un índice americano, pero si es algo que se puede hacer más adelante, de momento lo
dejamos en área».

**Y las cuatro irlandesas no se asignan.** Medtronic, Linde, Eaton y Seagate cotizan en Estados
Unidos, así que ya sabemos hoy que MSCI Europe no es su referencia. Asignárselo porque el
prefijo del ISIN dice `IE` sería escribir a sabiendas una etiqueta que no es cierta, y eso es
peor que dejarla vacía: van al mismo grupo que las 83 de Norteamérica, sin índice y diciéndolo.
Quedan **215 con índice de área y 87 sin referencia**.

**Y la etiqueta tiene que ser un campo, no una ausencia, porque los estados son tres y no dos:**

1. **Medida contra un índice de área** — 215.
2. **Sin referencia porque sabemos que no tenemos la suya** — las 83 de Norteamérica y las
   cuatro irlandesas. Es una decisión tomada.
3. **Sin referencia porque nadie lo ha mirado** — un hueco.

El 2 y el 3 se parecen en la base y son lo contrario el uno del otro. Si no se distinguen, en
marzo nadie sabrá si las 87 están vacías porque se decidió o porque se olvidó, que es el mismo
defecto que ya tiene la auditoría: contar lo que hay y no lo que falta.

El caso de Medtronic lo enseña desde el otro lado. Si su ficha dice hoy «sin referencia, porque
su mercado es Estados Unidos y no tenemos índice de esa plaza», el día que exista el proxy
americano la pasada la rellena sola y se ve qué cambió. Si dice solo «sin dato», hay que volver
a razonar por qué estaba vacía antes de poder llenarla.

**Por qué esto se puede aplazar sin pagarlo luego.** Añadir plazas después cuesta lo mismo que
costó el 01-11 con los tres proxies de fondos: un ISIN por mercado en el universo, una fila en
`config/indices.csv` y volver a mapear, que es una re-ejecución y no código nuevo. Lo único que
lo haría caro es **no dejar escrito hoy contra qué se midió cada acción**. Si la cifra guardada
dice su índice y dice que es de área, cambiar a plaza es volver a pasar; si no lo dice, en marzo
habrá que averiguar una por una qué se midió contra qué. La etiqueta no es documentación: es lo
que mantiene barata esta decisión.

## 13. El domicilio de una empresa es un campo propio, y hoy no lo afirma nada

Decidido el **02-11-2026**.

El país que trae el extractor es el **del mercado**, no el de la empresa. Está medido sobre las
73 primeras: los 73 países se corresponden uno a uno con los 73 mercados, así que la
coincidencia no prueba nada y el contrato lo llama «país del listado».

**Esa cifra hay que rehacerla con las 312**, y se espera que se rompa precisamente porque habrá
empresas cotizando fuera de su país —que son los casos que motivan la decisión—. Se recuenta
después de la pasada de las acciones. Que se rompa no la invalida: la refuerza.

Se añade el domicilio como campo propio y se trae de una fuente que lo afirme. Hace falta para
fiscalidad, y hay casos donde las dos cosas difieren: Ferrovial cotiza en Madrid y está
constituida en Países Bajos.

Mientras no exista, **la ficha sigue diciendo «país del listado»** y no lo llama domicilio. Es
la regla de siempre: un dato que no está se dice que no está, y no se deja que otro se haga
pasar por él.

## El Sharpe de las acciones fuera del euro NO es una decisión nueva

Lo parecía, y conviene dejarlo escrito para que no se vuelva a abrir. Dos acciones cotizan en
dólares y se quedan sin Sharpe porque el cálculo restaría un tipo en euros a una rentabilidad en
dólares. Con 239 acciones más, tocará a bastantes.

**Lo resuelve la decisión 10**, tomada el 01-11: las métricas se calculan en euros, convirtiendo
la serie antes con los tipos del BCE. La salida alternativa —traer el tipo libre de riesgo de
cada divisa— es justo la que esa decisión descarta, porque crea dos escalas que nunca podrían
mezclarse.

Así que aquí no falta decidir: **falta ejecutar**. `core/metricas.py::a_eur` existe y está
probado, no lo llama nadie, y lo que queda es traer la serie de tipos del BCE, que es la misma
API del €STR. Es el mismo trabajo que desbloquea las 14 clases en dólares y los 2.971 cubos.

---

## Lo que estas decisiones no resolvían

*Revisado el 04-11-2026.* Ya resuelto: la tarjeta pinta la cifra propia (decisión 8); la serie de tipos
del BCE existe, y las clases en dólares tienen Sharpe (decisión 10); la fecha de cierre (§3 del método);
y los repartos a más de cinco años, porque esas clases no llevan cifra propia (decisión 21). Los 2.971
cubos convertidos sin el tipo del BCE solo quedan en la base vieja.

Sigue abierta **la banda del detector de calidad**: `asignacion_activos_sospechosa` avisa fuera de 88-112,
más laxa que el ±1 % que exige la plataforma. Apretarla cambia a quién selecciona `--ids quality-ok`.

---

## 14. Un instrumento que deja de cotizar se marca, no desaparece

Decidido el **02-11-2026**, al buscar por qué cinco acciones españolas no las resolvía ningún
proveedor. No era un fallo de fuente: **las cinco han dejado de cotizar**.

| ISIN | Nombre | Última cotización que tenemos |
|---|---|---|
| `ES0114400007` | CAM, cuotas participativas | nunca tuvo serie |
| `ES0158300410` | CLEOP | 15-05-2017 |
| `ES0143416115` | Siemens Gamesa | 08-02-2023 |
| `ES0161560018` | NH Hoteles | 04-09-2026 |
| `ES0125140A14` | Ercros | 21-09-2026 |

Comprobado en las dos direcciones: nuestra propia serie se corta en esas fechas, y EODHD
**no devuelve nada hoy ni por ISIN ni por nombre** para las dos más recientes, que se
preguntaron por separado para no generalizar desde una.

### El defecto no es que falten: es que se van sin avisar

Medido en la base nueva: de las **299** acciones con bloque de precio, **297 están al día**
—menos de diez días— y las dos rezagadas son `LU1598757687` y `FI4000297767`, las dos de fuera
de alcance, paradas el 17-07 justamente porque nadie les pide datos. **Ninguna acción viva está
rancia.**

Y las cinco que dejaron de cotizar **no están en la base en absoluto**. Nunca llegaron a tener
ficha, así que nunca entraron. Es decir: hoy, cuando un instrumento muere, **no se marca:
desaparece**. NH Hoteles estaba en la base vieja en septiembre con 8.673 observaciones y en la
nueva no está, y no hay ningún sitio donde ponga por qué. Un asesor que tuviera NH en la cartera
de un cliente no encontraría nada, sin explicación.

Por eso la marca es **preventiva y no correctiva**: hoy no hay ninguna de las 299 a la que
aplicarla, y ese es exactamente el momento de construirla.

### Dónde vive la marca, que no es donde parece

**No se deduce de la frescura del precio.** Una serie parada y un instrumento muerto se parecen
en la base y son cosas distintas: las dos rezagadas de hoy están paradas por alcance, no por
defunción. Deducirlo de la fecha confundiría una cosa con la otra, que es el defecto que esta
base existe para evitar.

La única etapa que puede distinguirlo es la **adquisición**, porque es la que sabe diferenciar
tres cosas que desde la base se ven igual:

1. **Cotiza** — el proveedor lo resuelve y devuelve serie.
2. **Dejó de cotizar** — el proveedor **ya no lo resuelve** un símbolo que antes sí resolvía.
   Es una afirmación comprobable, no una inferencia.
3. **No se sabe** — el intento falló, o nunca se resolvió. No es lo mismo que el 2.

### Lo que no cambia

Un instrumento marcado **no se borra**: si un cliente llegó a tenerlo, su historia hace falta
para los informes de ese cliente. Lo que cambia es que deja de estar en el escaparate como si se
pudiera comprar, y que la ficha dice desde cuándo y con qué evidencia.

### El alcance y la defunción son la misma pieza

Añadido el **02-11-2026**, al ir a implementar el cierre del alcance y chocar con dos cosas
medidas.

**Primera: el alcance es de acciones y solo de acciones.** Aplicar sus países al canónico entero
se llevaría **555 de 760 fondos**, de los cuales **546 son de Luxemburgo** — que está fuera
porque se excluyó como **plaza de acciones**, y resulta ser donde se domicilia casi todo el
fondo europeo. El mismo código de país significando dos cosas. El propio
`config/alcance_mercados.json` ya lo dice en su primera línea: «qué **acciones** del universo
reciben datos». El riesgo no estaba en el fichero, estaba en el enunciado de la tarea.

**Segunda: filtrar el canónico no quita de la base lo que ya está.** El escritor no borra —«los
nombra y decide alguien»— y los sobrantes se calculan sobre instrumentos que **se vuelven a
escribir**. Uno que desaparece del canónico por completo no es un sobrante: no lo nombra nadie.
`LU1598757687` y `FI4000297767` se quedarían para siempre, fuera de todo recuento y sin
refrescarse. Pasarían de «fuera de alcance» a **congeladas y mudas**, que es peor que ahora.

**De ahí la unificación, que es de la sesión que iba a implementarlo.** Dejar de producir un
canónico **por alcance** es el mismo acto que dejar de producirlo **por defunción**: en los dos
casos el instrumento desaparece y la base se queda con una copia muda. Así que el alcance
**marca** en vez de dejar caer, con su propio motivo, y son otra vez tres estados:

1. **Cotiza y se produce.**
2. **No se produce porque se decidió que no** — `fuera_de_alcance`.
3. **No se produce porque dejó de cotizar** — `dejo_de_cotizar`.

El 2 y el 3 se parecen en la base y son opuestos, igual que en la etiqueta del índice. Con esto
se resuelven el alcance y la defunción con **una** pieza en la adquisición en vez de dos, y el
día que alguien recorte un mercado no se crean fantasmas.

**Lo que sigue necesitando decisión:** las dos que ya están dentro. O se quedan marcadas como
fuera de alcance, o alguien las retira; ninguna sesión borra documentos de la base por su
cuenta.

## 15. La cobertura cuenta lo que no aplica, y se queda así

Decidido el **02-11-2026**, al corregir los motivos de ausencia. Ese día se separaron dos cosas
que parecían una:

- **Qué significa que un dato falte** era un **defecto**: el contrato lo declaraba en el bloque
  y el hijo no lo heredaba, así que una ausencia explicada llegaba a la ficha como «falta».
  Corregido en `6aeb1c6` de `2-plataforma-datos`. Medido sobre la base, **20.973 ausencias
  —el 22,7 % de las 92.351—** decían «falta» sin faltar.
- **Si lo que no aplica debe contar en el denominador de la cobertura** no es un defecto, es una
  **definición**. Y la decisión es **no tocarla**.

### Lo que costaría tocarla, medido

| | Como está | Si lo que no aplica sale del denominador |
|---|---:|---:|
| Cobertura media | 0,5632 | 0,5821 |
| Mayor subida de un instrumento | — | 3,4 puntos (`IE00B3RW6Z61`) |
| Instrumentos que se mueven más de 5 puntos | — | 0 |

Es decir: **1,9 puntos de media y nadie cambia de cajón.** No paga cambiar el significado de una
cifra publicada mientras el frontend se está diseñando contra ella.

Y si algún día se cambia, no se cambia en silencio: `coverage` tendrá que decir **con qué
definición está calculada**, igual que las métricas dicen su método. Una cifra que cambia de regla
sin cambiar de nombre es la trampa que este proyecto ya se ha encontrado dos veces —el centinela
en el campo del índice y las escalas distintas ordenadas juntas—.

### Por qué no hace falta para que la ficha diga la verdad

Son dos preguntas, y solo una estaba mal contestada. La **cobertura** responde «cuánto del
contrato está relleno»; el **motivo** responde «por qué lo demás no está». Con los motivos ya
heredados, la ficha distingue «no aplica» de «falta» sin que la cobertura se mueva: el índice de
un fondo sin índice se pinta en gris y aparte, no como una laguna.

**Dónde se hace cumplir:** `calcularCalidad`, en
`2-plataforma-datos/src/ingestion/baseNueva/calidadYTarjeta.ts`. `aplicables` suma toda ruta cuyo
predicado se cumple, y el motivo de la ausencia no entra en ese conteo. Las tres pruebas nuevas de
`tests/baseNuevaCalidadYTarjeta.test.ts` fijan el motivo; **ninguna fija el denominador**, y es a
propósito: lo que no está decidido no se clava con una prueba.

## 16. Una cifra que depende de un conjunto publica la identidad de ese conjunto

Decidido el **03-11-2026**, al revisar las normas. Extiende la §15 sin contradecirla: allí se
decidió **no** cambiar la definición de la cobertura, y se dejó escrito que si algún día se
cambiaba, `coverage` tendría que decir con qué definición está calculada. Esto es eso, y un paso
más allá.

**El caso que lo obliga no era un cambio de definición, era una corrección.** El 03-11 se iba a
declarar en el contrato que el Sharpe y el Sortino no aplican a una acción —decisión de Óscar de
ese día, §9 del método—. Eso saca ocho rutas del denominador de la cobertura de cada acción, y
medido sobre las 305: **+7,95 puntos de media, hasta +11,59, y 297 de 305 se mueven más de cinco
puntos**. La §15 había declinado un cambio de 1,9 puntos en el que nadie cambiaba de cajón.

Y lo incómodo del caso: el número nuevo es el **cierto**. La cobertura anterior contaba ocho rutas
que una acción no puede rellenar nunca, así que 0,7368 era un artefacto y 0,8163 es la cifra. O
sea que la §15 protege de los cambios de definición y **no protegía de las correcciones**, que
mueven igual la cifra y además son inevitables: un contrato al que le falta un predicado se
corrige, no se congela.

### Qué obliga

La cobertura es rutas presentes entre rutas **aplicables**, así que su valor no depende solo de una
fórmula: depende de **qué entró en el denominador**. Por tanto `quality/latest` publica, además del
recuento `applicable_paths` que ya lleva, una **huella** de la lista ordenada de rutas contables
que se usó para ese instrumento.

Dos coberturas solo se comparan si su huella coincide. Una huella distinta **no** dice que la
cobertura se haya redefinido: dice que el conjunto contable cambió, y eso basta para explicar una
cifra que se movió sin que nadie tocara ninguna definición.

La regla es general y no solo de la cobertura: **toda cifra cuyo valor dependa de un conjunto y no
solo de una fórmula publica la identidad de ese conjunto.** Hoy la única es `coverage`.

### Huella derivada, no versión declarada

Se eligió calcular la huella de la propia lista de rutas, no escribir a mano una versión en el
contrato. El motivo es que una versión a mano depende de que alguien se acuerde de subirla, y lo
que esta decisión persigue es exactamente una cifra que se movió **porque nadie se acordó de
nada**. La huella no puede quedarse obsoleta; a cambio es opaca de leer, y por eso el recuento se
queda a su lado, que es lo legible.

### Qué NO dice

No congela los contratos. No obliga a subir la versión de nada cuando un contrato se corrige. No
sustituye al recuento. Y **no** convierte la cobertura en comparable entre instrumentos distintos:
un fondo y una acción tienen conjuntos contables distintos con todo derecho, y la huella sirve para
comparar *el mismo* instrumento a lo largo del tiempo y para saber si una cifra es anterior a un
cambio.

**Estado: construida el 21-11-2026**, con el sí de Óscar de ese día. El campo es
`applicable_paths_fingerprint`, junto a `applicable_paths` en `instrument-quality.v2.schema.json`, que sigue en `v2`:
es un campo opcional añadido, como `product.replication` (B-81) y `source_segments` (D-9), y ningún SHA cubre los
contratos de la base nueva —los de `contracts_cache` son los de la maestra vieja—. Se calcula en `calcularCalidad`
(`2-plataforma-datos/src/ingestion/baseNueva/calidadYTarjeta.ts`, con `huellaDeLasRutas`): SHA-256 en hexadecimal, entero,
de las rutas aplicables escritas como `absences.path`, ordenadas por código de carácter y unidas por un salto de línea.
Sale de la misma lista que el recuento —`applicable_paths` es su longitud—, así que no pueden separarse; las rutas
indecidibles no entran, como no entran en el denominador. `read/card` no la copia: la app lee la cobertura de
`quality/latest`, no de la tarjeta. Llega a la base con la siguiente pasada de `baseNueva:batch`; hasta entonces ningún
documento la lleva, y uno sin huella no se compara con uno que la lleva.

**Medido** el 21-11-2026 sobre el canónico del 17-11, con el mapper y el lote en seco y sin bases: los 1.334
instrumentos dan **9 huellas**. Las 529 acciones comparten una (68 rutas); los 772 fondos se reparten en siete —280, 178,
173, 136, 3, 1 y 1—; los 32 ETF, en tres —29, 2 y 1—, las tres compartidas con fondos, porque un ETF usa los mismos
contratos; y el único OTHER tiene la suya. Lo que separa las de los fondos es solo la exposición: si le aplican los cinco
mapas de renta variable, los siete campos de `declared/fixed_income` y los tres mapas de renta fija. Ninguna huella
lleva dos recuentos distintos.

La declaración del contrato de métricas que la hizo falta —Sharpe y Sortino solo en `FONDO_O_ETF`— ya no espera a nada
de aquí: sigue sin escribirse porque la retirada formal quedó fuera por decisión de Óscar (§9 y §10 del método).

## 17. Un campo presente donde el contrato dice que no aplica es un error

Decidido el **03-11-2026**, al descubrir que no lo era.

`x-applies-when` se leía en un solo sentido: decide si una **ausencia** cuenta para la cobertura.
En el otro sentido no decía nada, y se comprobó el 03-11: con el contrato diciendo que el Sharpe no
aplica a una acción y la base conservando 198, `audit:base-nueva` contestó **«La base nueva valida
entera contra su contrato»**. Un contrato y un dato que se contradicen, y la auditoría tranquila.

Eso es el mismo defecto que este proyecto persigue en todas partes: una respuesta válida afirmando
otra cosa. Así que el predicado pasa a leerse en los dos sentidos: **si el predicado es falso para
un instrumento y el campo está, el documento es incorrecto.**

### Dónde se hace cumplir, y dónde no

En la **auditoría**, como una comprobación de contenido más y con el mismo formato que las otras
dos: una cifra que **tiene que ser 0**, al lado de los centinelas en el campo del índice y de los
repartos que no suman uno. Se evalúa contra el contrato de **hoy** y no contra la historia: que una
cifra fuera legítima cuando se escribió no la hace legítima ahora, igual que con los centinelas.

**No** se bloquea en el escritor, y es una decisión y no un olvido. Bloquear impide que el estado
llegue a existir, que es más fuerte, pero el escritor valida documento a documento y no tiene
delante los rasgos del instrumento, así que habría que llevárselos. Se entra por el sitio barato
para empezar a proteger hoy, y el bloqueo queda como decisión aparte con su coste medido.

Un campo cuyo predicado **no se puede evaluar** no entra aquí: eso ya se cuenta aparte como
indecidible, y lo seguirá haciendo.

### Nace con deuda conocida

El primer día que esta comprobación exista informará de los **198 Sharpe de acciones** que la base
conserva y que la nube ya tiene desde la subida del 03-11. Eso es el estado real, y no un motivo
para suavizar la regla: la condición 3 de la §10 del método —la base no conserva lo retirado— es
justo lo que esta comprobación mide.

**Estado: construida como informe el 20-11-2026; el bloqueo en el escritor sigue sin decidir.** `npm run audit:base-nueva`
imprime el apartado «campos presentes donde el contrato dice que no aplica» (`camposPresentesDondeNoAplica`, en
`calidadYTarjeta.ts`; prueba `baseNuevaCamposDondeNoAplica.test.ts`), que no cambia el veredicto final de la auditoría.
Primera pasada sobre la base nueva local, medida ese día: **386 campos en 254 instrumentos** que el contrato de hoy
declara no aplicables (225 `declared/exposure.bond_types` y 41 `declared/fixed_income.avg_credit_quality` en fondos
sin renta fija según su reparto; 32 `computed/metrics.inputs.series_adjustment` en instrumentos que no son acciones;
unos pocos sectores, estilos y regiones en fondos sin renta variable; y un ETC, `IE00B4ND3602`, de tipo `OTHER`, que
conserva campos con forma de fondo: categoría, índice, domicilio, coste corriente...). **Los Sharpe de las acciones no salen de esa lectura**: el contrato de hoy
no los declara no aplicables con un `x-applies-when` (se publican en euros y se ocultan en pantalla, la retirada
formal quedó fuera, 04-11-2026), así que la auditoría los cuenta aparte: **261 de 529 acciones** con Sharpe guardado
(eran 198 el 03-11; la base creció con las 522 acciones del FIRDS y el recálculo de la versión 4) y 0 con Sortino.

## 18. Las retrocesiones viven en la base nueva, y las escribe el administrador

*Óscar, 03-11-2026, tras el ensayo de la app contra la base nueva. Hecha en local; en la nube, no.*

Las 376 retrocesiones y sus 4 recibos de importación se traen enteros, también los 4 cuyo ISIN ya
no está en el catálogo: son margen comercial, no se pueden reproducir y por eso ya estaba decidido
conservarlos. Comparados con la base de siempre campo a campo: 380 iguales, sin más cambio que quitar
los `null` de los campos opcionales.

Tres cosas que se apartan del resto de la base, a propósito:

- **La aplicación escribe directamente**, porque así funcionan la pantalla de administración y las
  importaciones. La regla es la de la base de siempre, y solo la usa quien tiene el claim `admin`.
- **`retro_pct` va en por ciento**, y es la única cifra que no va en fracción. Unidad `percent`,
  declarada en su contrato. Pasarla a fracción obligaría a traducir también los recibos.
- **Las fechas son marcas de tiempo de Firestore, no texto.** El deshacer de una importación compara
  sus nanosegundos.

**Lo que falta para que funcione en la nube**, por este orden: subirlas con
`npm run nube:subir -- --parte retrocesiones --escribe`, desplegar la regla y poner el claim `admin` en la
cuenta de Óscar, que hoy no lo tiene. Sin el claim, no da error: las retrocesiones salen como sin dato y
Sistema queda fuera. Los recibos admiten hasta 500 ISIN: una importación mayor se escribiría, pero
la auditoría la marcaría y la subida a la nube la pararía.

## 19. Las estrellas de Morningstar viven en la raíz, junto a la categoría

*03-11-2026, en local. Cumple la D3 de `DECISIONES_ADQUISICION_2026-10-30.md`, que ya las decidió.*

El contrato de la tarjeta tenía sitio para la estrella, pero la raíz no y el mapper no la leía, así que
en la base nueva no había ninguna. Ahora `classification.morningstar_rating` lleva la estrella del
canónico, entera de 1 a 5, en 720 de los 785 fondos y ETF: el 91,7 %. Los otros 65 declaran su
ausencia. No se retiene una estrella retirada.

**Contra la base de siempre:** 709 tenían estrella allí, y las 709 la tienen aquí. Coinciden 705. Las 4
restantes (`LU0125951151`, `LU0413543058`, `LU1340702932`, `LU1902444584`) difieren en una estrella
porque el canónico es más reciente que aquella copia; no las he contrastado con Morningstar.

**Consecuencia en la cobertura:** es un campo aplicable más en cada fondo y ETF, así que su
denominador sube en uno. Una cifra de cobertura anterior y una de ahora no son del todo comparables.

## 20. El riesgo de una cartera se mide con sus series, y el tipo libre sale de la base

*Óscar, 03-11-2026, tras el ensayo. Hecha en local; en la nube, no.*

**Análisis ya no da el aprobado sin riesgo medido.** Volatilidad, Sharpe y Monitor de riesgo salen de la
simulación con series, igual que en Diseño de cartera, si cubre al menos el 80 % del peso. Lo estimado
solo queda cuando no hay simulación. Había dos razones: con métodos distintos las volatilidades no
se pueden sumar, y la estimación se quedaba muy lejos de la medida (2,5 % frente a 5,86 % en una cartera con
datos para el 19 % de su peso). Sin riesgo medido la salud dice «a revisar» y por qué.

**La ESTR vive en `reference_rates`**, por años y en fracción, desde 2019. Manda sobre preguntar al BCE:
una ESTR publicada no cambia, la cifra se puede reproducir y el cálculo no espera a un servicio que en
el ensayo falló 38 veces. Comprobado contra el BCE en dos ventanas: la misma media a ocho decimales. El
orden es: serie guardada si llega a menos de 7 días del final de la ventana; si no, el BCE; si no contesta,
lo guardado con su cobertura real, que saca el aviso de Sharpe aproximado; y solo sin serie, el tipo fijo
del 1,93 % con su aviso, que ahora sí llega a la pantalla. Hay que refrescarla con `python main.py
cambios` y `npm run baseNueva:series -- --write`.

**Los PDF:** su diseño no cambia. Su Sharpe de cartera sí, porque comparte cálculo y ahora usa la ESTR real.
El Monitor y la Salud del informe interno también miden con series, por decisión de Óscar del mismo día. La
tira de Análisis enseña las cuatro cifras a 3 años de la serie; la suma ponderada solo aparece sin simulación,
y diciendo su cobertura. Una estimación con menos del 80 % del peso detrás no se trata como riesgo medido.

**Sigue estimado, y lo dice:** el PDF de la Radiografía titula sus cifras «estimadas por composición» con su
cobertura. La cartera real sigue con su propio respaldo, XEON.

## 21. La política de una clase sale de su KID, y un ETF se mide sobre su precio de mercado

*Decisiones de Óscar, 03 y 04-11-2026.*

**El KID manda sobre el nombre.** 26 clases que capitalizan se quedaban sin métricas porque el fondo
se llama «Income». La lectura está en `1-extractor/config/politica_kid.json`, clase a clase, con la
frase literal y la huella del documento; si la huella cambia, la evidencia se apaga sola y la clase
vuelve a quedarse sin métricas propias hasta que alguien lea el nuevo. Es lo que escribe el grado
`OFFICIAL_KID`.

**Lo que el proveedor registra como pagos no es la política de la clase** (05-11-2026, decisión 78 de la
auditoría). De 34 clases que constaban como reparto solo por ese registro, sin rendimiento o con el de BNY H
Acc, el KID de 32 dice que acumulan, y se anotaron igual, con su frase y su huella. BNY H Acc era el caso «el
nombre falla» de la decisión 2, y era al revés: lo que fallaba era el registro. Sigue constando como reparto
la clase que no tiene KID citable: una anotación sin huella no se apagaría si el documento cambia.

**La evidencia viaja con la cifra.** Doce fondos con métricas se rechazaban porque una ficha parcial
perdía la respuesta de que no hay repartos.

**Un ETF se mide como un fondo, sobre su precio de mercado.** Está en la §11 del método. Se hace
cumplir con `inputs.series_class` y `inputs.series_adjustment`.

**Una clase que reparte se queda sin cifra propia, y la ficha dice por qué** (04-11-2026). Tenemos de
uno a cinco pagos por clase, y eso no acredita los de una década: publicar rentabilidad con pagos que
faltan sería inventarla. Lo hace cumplir la barrera de la política en el mapper; lo explica
`componerFicha`.

**La ficha enseña lo que ya se calculaba** (04-11-2026). Las métricas contra el índice, en la sección
«Frente a su índice», donde existen: 157 fondos, los que tienen proxy aprobado. El Sortino, también en
Comparar. La sección del proveedor sale solo donde no hay la nuestra, porque una ficha no enseña dos
alfas contra dos índices. Y si no hay métricas propias, el motivo: `metrics_absence` en la raíz, porque el documento
que falta no puede decirlo y el mapper lo calculaba y lo tiraba.

**Lo que deja abierto.** Si el ETC entra, con qué método; si un ETF debería medirse sobre su valor
liquidativo el día que tengamos esa serie; y si una clase que reparte puede publicar solo la
volatilidad, que el pago afecta mucho menos, pero que no está medido.

## 22. Estrategia se publica a mano, y Sistema enseña solo lo que puede leer

*Decisiones de Óscar, 04-11-2026.*

**Estrategia.** El informe se publica con un botón, solo para el administrador, y nada está programado.
Las 40 notas antiguas no se traen. El informe lo redacta Gemini con búsqueda en internet, y sus fuentes
no siempre son de primer nivel: **hay que leerlo antes de compartirlo con un cliente**.

**Sistema.** En la web publicada quedan Estado y Retrocesiones. Lo demás lee colecciones que allí no existen
o llama a funciones sin desplegar. Estado cuenta el catálogo desde las tarjetas y lista los fondos que el
control señala, que es como se cumple el «que los mire una persona» de la decisión 8.

**El control solo compara lo que mide lo mismo.** No señala las clases convertidas desde otra divisa ni los
cierres de meses distintos, porque esas diferencias ya tienen explicación. El precio: esos fondos quedan sin
control hasta que el proveedor actualice o, en las clases en otra divisa, sin él.

**La cartera `cp`**, con pesos que suman el 181,25 %, no se trae tal cual.


## 23. Doce referencias más para el alfa propio, y una clase cubierta no se mide contra un índice sin cubrir

*Decisión de Óscar, 04-11-2026. Amplía la decisión 11.*

**El alfa propio pasa de 157 a 221 clases.** 2 de ellas son los propios fondos índice, medidos contra sí
mismos. Cada referencia se probó contra las clases que declaran ese índice; su fila está en
`1-extractor/config/indices.csv`.

| Índice | Referencia | Clases | R² | Réplica |
|---|---|---:|---:|---|
| MSCI AC Asia ex Japan | `LU1900068161` Amundi | 12 | 91 % | Sintética |
| MSCI Europe Small Cap | `IE00BKWQ0M75` SPDR | 7 | 85 % | Física |
| MSCI EM Latin America 10/40 | `IE00B27YCK28` iShares | 6 | 95 % | Física, reparte |
| MSCI EM Asia | `IE00B5L8K969` iShares | 6 | 92 % | Física |
| TOPIX | `LU1681037609` Amundi | 5 | 74 % | Sintética |
| MSCI EMU | `IE00B53QG562` iShares | 5 | 90 % | Física |
| MSCI AC Asia Pacific ex Japan | `LU1900068328` Amundi | 5 | 82 % | Sintética |
| MSCI World Health Care | `IE00BM67HK77` Xtrackers | 4 | 95 % | Física |
| Bloomberg Euro Corporate | `IE00B3T9LM79` SPDR | 4 | 94 % | Física, reparte |
| STOXX Europe 600 | `LU0908500753` Amundi | 3 | 81 % | Física |
| Bloomberg Euro Aggregate | `LU0836513423` iShares | 3 | 97 % | Fondo índice |
| S&P 500 | `IE0032126645` Vanguard | 2 | 67 % | Fondo índice |

R² mediano a 3 años, y sin contar el fondo índice consigo mismo.

**Dos excepciones a las condiciones de la decisión 11, y las dos decididas.** Tres referencias son
sintéticas: esto es una medida y no una inversión, así que importa que sigan al índice, y el riesgo de
contraparte del swap no entra en la cifra. Dos reparten: su serie es el cierre ajustado, que lleva los
dividendos.

**La variante manda.** Vanguard declara S&P 500 NR, así que esa fila mide a las clases que declaran NR y no
a las de «S&P 500 (TR)», igual que TOPIX deja fuera a la que declara NR.

**Lo que se hace cumplir en código, en `1-extractor`:**

- Una clase cubierta no se mide contra una referencia sin cubrir: la diferencia sería la cobertura.
  `IE00BYX5P602`, que replica MSCI World, salía con beta 0,86 y R² del 79 %.
- La serie de la referencia sale en euros, como la del fondo.
- Un ETF con varias cotizaciones usa la de euros: la de Suiza bajaba el R² mediano del 85 % al 80 %.
- Las cifras contra el índice viajan con las métricas en una ficha parcial. Tres fondos las perdían.

**Limitaciones.** La referencia es un instrumento con costes, hasta el 0,60 % en `LU1900068328`, así que el
alfa sale un poco mejor que contra el índice. Una cifra de mercado lleva además el ruido de hora de cierre de
la decisión 11. Y las clases no son fondos: las 6 de MSCI EM Asia dan casi el mismo R², y podrían ser un solo
fondo, cosa que no se ha contado.

**Lo que deja abierto.** Unas 320 clases con métricas propias siguen sin alfa propio, repartidas en índices de
muy pocos fondos, y conservan el del proveedor. Y no se calcula alfa contra un tipo de interés: la beta y el R²
contra efectivo no significan nada, y el exceso sobre el €STR entre su volatilidad ya es el Sharpe.


## 24. Una acción publica beta y R² contra su referencia, y no alfa

*Decisión de Óscar, 04-11-2026. Construye la decisión 12 y la cambia en dos puntos.*

**Contra qué.** MSCI Europe para las 198 acciones europeas y S&P 500 para las 86 americanas, las dos
replicadas con fondos índice de Vanguard. Sale de `1-extractor/config/indices_de_accion.csv`, por la bolsa donde
cotiza y no por el ISIN, así que Medtronic, Linde, Eaton y Seagate van con el S&P 500. Es el primer cambio: la
decisión 12 las dejaba sin referencia porque no había proxy americano, y desde la decisión 23 lo hay.

**Por qué no el índice de cada plaza.** Explica algo más: R² mediano del 26 % frente al 18 % en Francia, del 20 %
frente al 14 % en Alemania y del 10 % frente al 9 % en España. Pero rompe la escala común de las betas europeas, y
un valor grande forma parte de su propio índice. Se puede añadir sin rehacer nada, porque cada cifra dice contra
qué se midió, con `relative.reference`.

**Qué se publica.** Beta y R², a 3 y 5 años. Es el segundo cambio: la decisión 12 incluía el alfa. Medido ese día
con 36 meses, solo 4 de 86 acciones americanas tienen un alfa distinguible de cero, más o menos lo que saldría
por azar. El tracking error y el ratio de información tienen en una acción el problema del Sharpe (§9 del
método). A 1 año son 12 observaciones. El contrato prohíbe el alfa en esta referencia.

**Los tres estados de la decisión 12, en un campo.** Medida: `relative`. Sin referencia sabiendo por qué:
`relative_absence`, en las 3 canadienses. Sin nada: un hueco, que hoy son 18 acciones sin 3 años de serie vigente.

**Comprobación.** En 86 acciones americanas, nuestra beta a 5 años contra el S&P 500 tiene una mediana de 0,97 y la
de Yahoo de 1,03, con una diferencia típica de 0,08. El error típico de una beta a 3 años ronda 0,35, y la ficha
lo dice.

**La cobertura no se mueve, y es a propósito.** `x-counts-when` separa aplicar de contar: estas rutas se pueden
rellenar en una acción y no entran en su cobertura, por las decisiones 15 y 16. Comprobado: de 1.104 instrumentos,
ninguno cambió.

**Limitaciones.** Es mensual, aunque el resto de la acción sea diario, porque una beta con cierres de distinta hora
sale por debajo de la real. Las betas están en euros, así que en una acción americana llevan el dólar dentro. Y si
una acción cotiza fuera de su mercado, se mide por donde cotiza: una japonesa en Londres iría contra MSCI Europe, y
hoy no entra ninguna en el catálogo.

## 25. Por ahora no hay ficha de cliente: el nivel, el horizonte y el nombre siguen con la cartera

*Decisión de Óscar, 11-11-2026 («Sí, las cuatro», sobre la página de sus decisiones abiertas). Cierra, por ahora, lo
que la decisión 6 dejó abierto.*

**La pregunta profesional** es de quién es una cartera y si le encaja. Hoy se contesta a medias: cada cartera modelo
guarda su nivel de perfil y su horizonte (B-59), la portada del informe de cliente los imprime, la aplicación cruza la
cartera con el mercado objetivo y el horizonte que declara cada fondo, y el nombre del cliente se escribe en Informes.

- **Elegida. A: sin ficha de cliente.** Todo sigue en la cartera. No se guarda ningún dato personal y no hay nada que
  construir.
- B: ficha ligera, con nombre o alias, nivel, horizonte, restricciones, quién lo fijó y cuándo, y cada cartera apuntando
  a su cliente. Pide una pantalla, cambiar el contrato y las reglas de acceso, y pone datos personales en la nube.
- C: cliente completo, con posiciones reales, aportaciones, retiradas y rentabilidad medida con flujos. Es la pieza mayor
  que queda en el programa, y los extractos del banco llegan anónimos.

**Por qué.** Es un prototipo, la mayoría de las carteras son autogestionadas, y lo que una ficha ligera añadiría —avisar
si una cartera no encaja con la persona— no justifica guardar datos personales sin saber aún si hacen falta.

**Cuándo se revisa.** Con la respuesta a la pregunta 6 de `PREGUNTAS_CUMPLIMIENTO_2026-11-11.md`: si el perfil del cliente
debe constar, se pasa a la B, con alias en vez de nombre si se puede. Un perfil escrito a mano no sustituye a un test de
idoneidad, y la B tampoco lo haría.

**Lo que no cambia.** `clients/{client_id}` sigue declarado y vacío, con su contrato `client.v2`. No hay nada que retirar.

**Limitaciones.** Dos carteras de la misma persona no se relacionan. El perfil que consta es el de la cartera, y lo
escribe el asesor; los avisos del mercado objetivo son informativos y no dictaminan idoneidad. Sigue sin haber cartera
real, libro de operaciones ni valoración con flujos. Las obligaciones de protección de datos de la opción B no se han
valorado.

## 26. Una sola escala de perfil, la de diez niveles, y la referencia se propone por cercanía en renta variable

*Decisión de Óscar, 11-11-2026 («Sí, las cuatro»). **Construida el mismo día en `920406dc`:** solo en Informes y fuera
del modo cliente, es una línea con su botón, y no cambia la referencia hasta que el asesor pulsa, porque la referencia es
una preferencia de toda la aplicación y una cartera no debe alterar en silencio lo que imprime un documento.*

Convivían tres cosas sin traducción: los diez niveles de las carteras y del generador, los cinco textos del contrato de
clientes (colección vacía) y las cinco carteras de referencia. El informe de cliente dejó pendiente (A-136) proponer por
defecto la referencia más cercana «cuando se decida qué es un cliente». No hacía falta esperar: el nivel ya viaja con la
cartera.

| Nivel | Nombre | Renta variable | Referencia propuesta | Distancia |
|---:|---|---:|---|---:|
| 1 | Preservación | 0 % | Conservador (0 %) | 0 |
| 2 | Prudente | 10 % | Conservador (0 %) | 10 |
| 3 | Moderado bajo | 20 % | Moderado (25 %) | 5 |
| 4 | Moderado | 30 % | Moderado (25 %) | 5 |
| 5 | Equilibrado | 40 % | Equilibrado (50 %) | 10 |
| 6 | Equilibrado dinámico | 50 % | Equilibrado (50 %) | 0 |
| 7 | Dinámico | 60 % | Equilibrado (50 %) | 10 |
| 8 | Crecimiento | 70 % | Dinámico (75 %) | 5 |
| 9 | Agresivo | 85 % | Dinámico (75 %) | 10 |
| 10 | Muy agresivo | 100 % | Agresivo (100 %) | 0 |

La renta variable de cada nivel es `RENTA_VARIABLE_POR_NIVEL` de `functions_python/generador_de_carteras.py`, y la de cada
referencia, la de `src/core/benchmarkProfiles.ts`, en los pesos del primer día.

- **Elegida. A: diez niveles como única escala, y se propone la referencia más cercana en renta variable.** Nunca a más de
  10 puntos.
- B: diez niveles y referencia por parejas de nombre (1-2, 3-4, 5-6, 7-8, 9-10). Los nombres casan mejor y la distancia
  llega a 15 puntos.
- C: dejarlo, con el asesor eligiendo cada vez y las escalas sin traducir.

**Por qué.** Lo que se compara es riesgo, no el nombre.

**Lo que obliga.** Es solo una propuesta: el asesor la puede cambiar, y una cartera sin nivel no recibe ninguna, porque
el nivel no se deduce de nada (B-59). Los cinco textos de `client.v2` se ajustan el día que haya ficha: la colección está
vacía y no hay nada que migrar.

**Consecuencia que se acepta.** En dos niveles el nombre no coincide: «Dinámico» se compara de entrada con «Equilibrado»,
y «Agresivo» con «Dinámico».

**Limitaciones.** El nivel es una etiqueta que escribe el asesor, y una cartera hecha a mano puede tener más o menos renta
variable de la que dice la tabla. Las referencias no se reequilibran: sus porcentajes son los del primer día y con los
años se separan de su nombre.


## 27. Los mapas de renta fija, solo desde un 0,5 % de renta fija con los convertibles; y los repartos a cero son un reparto que falta

*Óscar, 21-11-2026.*

**La pregunta.** El canónico del 17-11 traía tipos de bono, tramos de duración y calidad crediticia en fondos con un 0,01 %
de renta fija: posiciones de liquidez o de paso en fondos de renta variable, que no dicen nada de cómo invierte el fondo.

**Elegido.**
- Los tres mapas (`declared/exposure.bond_types`, `duration_buckets` y `credit_buckets`) se escriben solo si la renta fija
  **más los convertibles** pesa al menos un **0,5 %** del reparto. Los convertibles cuentan como renta fija. Por debajo, no
  aplican: no faltan. `declared/fixed_income` sigue con la condición de antes (`CON_RENTA_FIJA`).
- Un reparto con las cuatro clases a cero es un reparto **que falta**, no ceros: dice «Falta el dato».
- El ETC de oro (y una materia prima o un alternativo sin reparto) va al **100 % en «otros»**, que es donde el programa
  pone hoy materias primas y alternativos.
- **El peso propio de los convertibles no se guarda en la base** (Óscar, 21-11-2026, «déjalo como está»). Quien lee la base
  decide la regla con la categoría del fondo; el mapper, con el peso que trae la fuente.

**Dónde se cumple.** La regla vive una sola vez, en `2-plataforma-datos/src/ingestion/baseNueva/aplicabilidad.ts`
(`UMBRAL_DE_RENTA_FIJA_DE_SUS_MAPAS`, `pesoDeRentaFijaConConvertibles`); el contrato la declara con el predicado
`CON_RENTA_FIJA_NO_RESIDUAL`, y `tests/baseNuevaTiposDeBonoSoloConRentaFija.test.ts` falla si el contrato y el mapper se
separan.

**Consecuencia que se acepta.** Sin el peso de los convertibles en la base, la base no puede reproducir la regla por sí
sola en un fondo cuyo veredicto dependa de ese peso. Si pasa, el mapper lo avisa con un mensaje que empieza por «mapas de
renta fija:». Medido el 21-11 sobre el canónico del 17-11: no pasa en ninguno de los 1.334; 46 fondos traen ese peso, 7
distinto de cero y todos por debajo del 0,4 %.

**Lo que mueve.** 133 fondos con renta fija entre 0 y 0,5 % dejan de tener esos tres campos como aplicables; `quality/latest`
y `read/card` cambian en 134 instrumentos, solo en la cobertura (entre +0,24 y +0,82 puntos). Llega a la base con el
próximo refresco y la subida del catálogo, que son a mano.

## 28. El ratio de información sin redondear corrige la versión 4; el €STR diario parado más de 7 días deja sin Sharpe; y la referencia no puede ser otra clase del mismo fondo

*Óscar, 21-11-2026 («por la recomendada», sobre los hallazgos de la auditoría independiente del 20-11 en el extractor).
Construida el mismo día en la rama `claude/decisiones-extractor-21-11`.*

**La pregunta.** La tanda del 21-11 sobre el extractor (`claude/auditoria-extractor-21-11`) dejó tres cosas que no
podía decidir sola: si el ratio de información sin redondear (`f0125f0b`, que cambia cifras publicadas) pide una versión
5 del método; si un €STR que se para al final de la ventana del camino diario se sigue publicando marcado sin límite; y
si una referencia de las relativas puede ser otra clase del mismo fondo, como le pasaba a Vanguard Global Stock Index
Investor (beta 1, R² 100).

**Elegido.**
1. **El ratio de información sin redondear entra en la versión 4 como corrección de un fallo; no hay versión 5.** La
   fórmula declarada no cambia —rentabilidad activa entre tracking error—; lo que estaba mal era la cuenta, que dividía la
   activa ya redondeada a cuatro decimales. El sello sigue siendo `v4`.
2. **En el camino diario, un €STR que se para al final suprime el Sharpe pasados 7 días naturales**, como el método
   mensual: la última noche de la ventana —la víspera de su último día— necesita un €STR de como mucho
   `RF_ARRASTRE_MAX_DIAS` (7) días, la misma regla de cada noche de `rf_entre`. Un retraso de 7 días o menos se sigue
   publicando y marcando (`rf_incompleto`, decisión del 09-11-2026). El mensual no marca nada, arrastra el último tipo; la
   marca del diario se queda porque no cambia ninguna cifra, y desde hoy dice si suprimió el Sharpe (`sharpe_suprimido`).
3. **Una referencia que sea otra clase del mismo fondo se excluye**, como ya se excluía el mismo ISIN. No hay un
   identificador del fondo paraguas en los datos —el LEI es el de la sociedad (Vanguard Investment Series plc tiene muchos
   fondos), el nombre de la clase no tiene forma fija y la fecha de lanzamiento «del fondo» de Morningstar es, en
   Vanguard, la de la clase—, así que se reconoce por lo que es del fondo y no de la clase: **la misma gestora y, o el
   mismo patrimonio del fondo en la misma fecha, o la misma cartera** (fecha, número de posiciones y peso de las diez
   primeras). La ficha dice `sin_relativas_referencia_del_mismo_fondo(<proxy>)` y con qué firma (`mismo_fondo_por`).

Y la §2 del método lleva desde hoy una línea por cada regla nueva: las dos de la tanda anterior (el hueco de más de 33
días del índice dentro de la ventana de las relativas, y la cobertura del €STR del camino diario desde el primer día y sin
tramos de más de 7 noches) y las reglas 2 y 3 de esta.

**Dónde se cumple.**
- Regla 1: `1-extractor/core/metricas.py::relativas` (`f0125f0b`); la prueba es
  `test_el_ratio_de_informacion_divide_la_activa_sin_redondear` de `tests/test_metricas_ceros_y_huecos.py`, y la versión
  4 del método, en la §4 de `METODO_PROPIO_METRICAS_2026-11-01.md`.
- Regla 2: `core/metricas.py::estr_sin_tramos_vacios` y `cobertura_rf`, y la ficha en `fetchers/eodhd.py`; la prueban
  `tests/test_estr_cobertura.py` y `tests/test_metricas_ceros_y_huecos.py`.
- Regla 3: `fetchers/vl_fondos.py::_referencia_del_mismo_fondo`, detrás de la regla de la clase cubierta; la prueban seis
  casos de `tests/test_vl_fondos.py`, uno por firma y los que no deben excluir.

**Medido** el 21-11-2026 sobre la exportación del extractor del 17-11 (`export/fondos.ndjson`, `export_series`, y el €STR
y los cambios de la caché), sin red y sin bases:
- **Regla 1.** Cambian **48 de los 712** ratios de información publicados (a 1, 3 y 5 años): **45 en una diezmilésima**,
  y los otros 3 son los de Vanguard Global Stock Index Investor, que con la regla 3 dejan de publicarse.
- **Regla 2.** **Ninguna cifra cambia**, aparece ni desaparece (el `metricas.py` de `d0f6fb97` contra el de la C-28,
  con el mismo camino que la pasada). De las 520 acciones con `rf_hasta`, la última noche usaba un €STR de 2 días como
  mucho, y ninguna llevaba `rf_incompleto`.
- **Regla 3.** La precisión de la señal, sobre las 1.334 fichas: de los 84 grupos con el mismo patrimonio del fondo en la
  misma fecha, 83 son clases de un mismo fondo y el otro son dos fondos de 2,15 M€ de gestoras distintas (Andbank y
  Metagestión), que la gestora separa; los 29 grupos con la misma cartera y distinto patrimonio son todos clases de un
  mismo fondo, en otra divisa (el patrimonio se da en la de la clase) o fondos españoles que dan el de la clase. Con la
  gestora, ningún falso positivo. Lo que mueve, con el código de la pasada sobre las 308 fichas con proxy que no son su
  propio proxy: **un fondo**, Vanguard Global Stock Index Investor (`IE00B03HCZ61`), medido contra la clase EUR Acc del
  mismo fondo (`IE00B03HD191`), que es el proxy de MSCI World NR. Lo reconocen las dos firmas. **Después no tiene otra
  referencia**: MSCI World NR tiene una sola fila en `config/indices.csv`, así que se queda sin relativas y pierde sus 18
  cifras (beta, R², alfa, rentabilidad activa, tracking error y ratio de información a 1, 3 y 5 años).

**Por qué no cambia la versión.** La regla 1 corrige la cuenta y no un parámetro (§4 del método). Las reglas 2 y 3 solo
quitan cifras, en un caso que hoy no se da y en un fondo, como el hueco de la decisión 111: lo que queda sale igual.

**Consecuencia que se acepta.** Hasta el próximo refresco y la subida del catálogo, que son a mano, la base tiene ratios
de información de la versión 4 con la activa redondeada; después, sin redondear, con el mismo sello y como mucho una
diezmilésima de diferencia. Ninguna pantalla ordena ni compara ratios de información entre instrumentos (§3 del método),
así que no rompe ninguna comparación.

**Lo que deja abierto.**
- **El motivo de la regla 3 no llega a la base.** La plataforma traduce a `computed/metrics.relative_absence` solo los
  avisos que conoce (`AUSENCIA_RELATIVA_DECIDIDA` en `2-plataforma-datos/src/ingestion/baseNueva/traducciones.ts`), y este
  no está: sin tocar la plataforma, el fondo sale sin `relative` y sin decir por qué, y sin la retirada con fecha de la
  §10. Pide un valor nuevo del contrato (p. ej. `SAME_FUND_REFERENCE`), que es trabajo de la sesión de la plataforma.
  **Hecho el 21-11-2026 (rama `claude/decisiones-plataforma-21-11`): el motivo llega a la base como
  `computed/metrics.relative_absence = SAME_FUND_REFERENCE`**, copiado en `read/card`, en el contrato `v2` sin subir de
  versión (añadir un motivo cerrado a un enum que solo escribe el lote, como `HEDGED_SHARE_CLASS` con la decisión 30). A
  diferencia del KID y de la clase cubierta, la tarjeta sí cae a la cifra del proveedor contra su categoría: lo que falla es
  nuestra serie del índice, no lo que mide él. **Óscar lo confirmó el 21-11-2026** («Sí, las tres», punto 25): el fondo
  enseña la cifra del proveedor, como cualquiera que no tiene serie de su índice. Sigue abierto el proxy y la firma
  (`mismo_fondo_por`), que no llegan a la base.
  **La retirada con fecha, hecha el 21-11-2026 a petición de Óscar** (rama `claude/decision-27-retirada-21-11`): el
  extractor la escribe con el mismo mecanismo que la del KID (`fetchers/vl_fondos.py::_escribe_retirada`, y la §10 del
  método dice desde ese día que toda retirada nueva va así), y la plataforma ya la llevaba a
  `computed/metrics.relative_withdrawal`. Medido con la ficha del 17-11 de Vanguard Global Stock Index Investor, sin red
  ni bases: la pasada escribe la retirada con su día (el de la pasada, que no se mueve en las siguientes), esta decisión,
  MSCI World, su proxy `IE00B03HD191` sobre valor liquidativo y el último dato publicado, del 31-10-2026. **Desde cuándo se
  publicaban no se escribe**, como en el KID: el extractor no guarda la primera pasada que las publicó. La cota que sí
  consta: no antes del 01-11-2026, el día que entró en `config/indices.csv` la fila de su proxy (`708f8df5`). Entra con
  el próximo refresco, y solo si esa pasada lleva este código: si corriera antes una con la regla 3 y sin la retirada,
  la ficha anterior ya no tendría cifras y la retirada no se escribiría nunca.
- **La señal depende de que la ficha de la referencia esté en el universo.** Un proxy que no es ficha (hoy, los niveles
  de índice `.INDX`, que no son fondos) no se puede comparar, y se mide como antes.
- **Los 13 KID en uso sin fecha legible** (punto 7 de la misma tanda) se investigaron sin cambiar código: el lector no la
  saca por cuatro formas de escribirla, y con el arreglo propuesto se leerían las 13 sin cambiar ninguna de las 617 que ya
  se leen; una es de 30-12-2022 y caducaría (Groupama G Fund Avenir Europe NC). Óscar aprobó el arreglo el 21-11-2026:
  decisión 30.


## 29. Se acepta el reparto neto del proveedor, con cortos y apalancamiento, si suma el 100 %

*Óscar, 21-11-2026 («Sí, las tres»). Construida el mismo día en la rama `claude/decision-23-reparto-neto-21-11`.*

**La pregunta.** `repartoDeActivos` rechazaba el reparto entero si una clase se salía de 0-1 más del punto de la A-63
(`asset_mix con una clase fuera de rango`), aunque el reparto sumase 1. Así 95 fondos del canónico del 17-11 se quedaban
sin reparto, y desde la A-203 decían «Falta el dato» en Análisis, con un reparto que sí cuadra: renta fija 101,16 % y
liquidez −1,39 %, o renta variable 319,8 % y liquidez −242,6 % (ES0137396000). El proveedor da el reparto **neto**, como
Morningstar: una clase negativa es una posición corta o liquidez prestada, y una por encima del 100 %, apalancamiento.

**Elegido.**
- Se acepta el **reparto neto tal como lo da el proveedor** si suma el 100 % con la tolerancia que ya usaba el mapper
  (`TOLERANCIA_DEL_REPARTO`, un punto). La clase negativa se escribe **con su signo**; la que pasa de 100, **tal cual**.
- Sigue sin reparto lo que no suma el 100 %, lo que no trae números y las cuatro clases a cero (C-27).
- **Topes del contrato: una clase entre −5 y 6** (de −500 % a +600 %). Lo medido el 21-11 sobre el canónico del 17-11 va de
  −2,43 a 3,20; los topes dan dos veces ese margen y siguen siendo finitos, para que un porcentaje leído como fracción en
  una sola clase (60 y −59, que suman 1) no pase por apalancamiento. Una clase fuera de los topes deja al fondo sin reparto,
  sume lo que sume, y lo dice («error de unidades»).
- **En pantalla, la clase negativa no lleva barra ni porción de aro**, que no pueden ser negativas: se escribe «−1,4 %».
  Junto al reparto con una clase fuera de 0-100 va una nota: «Reparto neto: incluye posiciones cortas o apalancamiento, así
  que una clase puede salir en negativo y otra pasar del 100 %». El aro dibuja solo las partes positivas, pone la negativa en
  la leyenda con su signo y muestra hueca, y lo dice.

**Dónde se cumple.**
- Contrato: `$defs.peso_de_clase` de `instrument-declared-exposure.v2` y de `instrument-read-card.v2`, de −5 a 6, con la
  regla y su fecha en la descripción de `asset_mix`. **No sube de versión**: ensancha un rango que solo escribe la
  plataforma, como los enums ampliados sin subir (C-28, `SAME_FUND_REFERENCE`). Ningún SHA cubre los contratos de la base
  nueva; sí el de lectura `asset-for-bdb.v1`, en la caché de las Functions, que no tiene topes y cuya descripción se puso
  al día (`npm run sync:contracts`: cambia su SHA en `functions_python/contracts_cache/manifest.json`).
- Plataforma: `repartoDeActivos` y `pesoDeClase` leen los topes del contrato (`2-plataforma-datos/src/ingestion/baseNueva/mapper.ts`).
  Un reparto neto (`esRepartoNeto`: una clase fuera de 0-1 más de la tolerancia) **no deduce la clase de la raíz** —un fondo
  con la bolsa a −188 % y la liquidez a 246 % no es un monetario: manda lo que diga el proveedor— y sus regiones y sectores
  siguen la regla de cuando no había reparto (decisión 109), para que recuperar el reparto no cambie sus mapas. Lo prueban
  `tests/baseNuevaEscritor.test.ts` y `tests/baseNuevaLaPasadaDel108Al112.test.ts`.
- Extractor: `info_clase_fuera_de_rango` (`1-extractor/core/calidad.py`) deja de marcar el reparto neto que suma 100; avisa
  la clase fuera de los topes, sume lo que sume, y la que se sale de 0-100 en un reparto que no suma
  (`tests/test_calidad_reparto.py`). Los topes los sigue leyendo del contrato de la plataforma.
- Servidor: `map_pms_exposure` (`functions_python/readmodel/mappers.py`) ya pasaba el reparto sin recortar; se dice en su
  docstring y lo prueba `tests/test_read_contract.py` con ES0137396000. Ninguna otra Function suma o reparte la exposición
  por clase: la radiografía, Optimizar y los informes la calculan en la aplicación.
- Aplicación: la regla vive en `3-BDB-ACTIVOS_app/src/core/repartoNeto.ts`. `assetPmsShares` (`src/core/portfolio.ts`) lee
  tal cual el reparto que suma 1 dentro de los topes —antes, solo dentro del punto: ES0137396000 habría contado su bolsa
  como el 93 % de lo positivo—; `ListaDePartes` no dibuja barra a lo negativo; `OaaDonutChart`, la porción; y la nota va en
  la ficha (Composición), en Análisis › Estructura de la cartera (Exposición agregada), en Carteras guardadas y en
  Carteras de clientes (Resumen y Composición), donde `fichas.ts` y `componer` reparten la clase con su signo. Lo prueban
  `tests/repartoNeto.test.ts`, `tests/repartoNetoEnPantalla.test.tsx`, `tests/piezas/listaDePartes.test.tsx` y
  `tests/fichaSinReparto.test.ts`.
- PDF: nada que cambiar. Las cifras del papel salen de `peso()`, que escribe el signo menos tipográfico, y la
  `ListaDePartes` de la plantilla ya no dibujaba barra a una parte negativa.

**Medido** el 21-11-2026 sobre el canónico del 17-11 (`export_bdb` y `export/fondos.ndjson`), con el mapper en seco y sin
bases: **95 fondos recuperan su reparto** (707 con reparto, 802 después); los 95 sumaban 1 con la tolerancia, y de ellos
36 ganan el bloque `declared/exposure` entero, que no tenían. Se quedan sin reparto **3**, los de las cuatro clases a cero.
Por cuánto se salían de 0-1: 36 hasta 5 puntos, 30 hasta 20, 14 hasta 50 y 15 más de 50. Ninguna clase de la raíz cambia:
ninguno de los 95 llega como OTHER. Con el reparto aparecen los mapas de renta fija donde la renta fija, con los
convertibles, pasa del 0,5 % (C-27): `duration_buckets` en 77, `bond_types` en 71 y `credit_buckets` en 53; y la caja de
estilo de uno, BLK Systematic. Ningún mapa de la renta variable cambia, y los 802 documentos validan contra el contrato.
En el extractor, la marca pasa de 95 fondos a ninguno.

**Consecuencia que se acepta.** Una lectura por dentro (regiones, sectores, estilo, perfil de renta fija) pondera cada fondo
por su clase **neta**: un fondo apalancado pesa en las regiones de la cartera por su 319,8 % de bolsa, y uno corto de bolsa
no entra en ellas. Es la exposición económica, y es la convención de un reparto neto; normalizar lo positivo, que era la
alternativa, habría escrito un 93 % de bolsa que no es el fondo. Llega a la base con el próximo refresco y la subida del
catálogo, que son a mano; hasta entonces los 95 siguen diciendo «Falta el dato».

**Lo que deja abierto.**
- **Los mapas de un fondo neto saltan lo que no es un peso** (`mapaDePesos`): un `bond_types` con la liquidez negativa la
  pierde, y suma de más (1,049 en UBS Duración 0-2). Ya pasaba fuera de ellos: en el canónico del 17-11, 117 fondos sin
  reparto neto traen un `bond_types` con algún valor fuera de 0-1; ahora entran también estos.
  Aceptar el neto en esos mapas es otra decisión. **Hecho el 21-11-2026: decisión C-31**, con la misma regla: neto si
  suma 1 y cabe en los topes.
- **La equivalencia de fondos** (`src/core/fundEquivalence.ts`, `assetMixMap`) compara las mezclas sin las clases
  negativas, como hasta hoy (decisión 117, B). No se ha tocado.
- **El aro de la aplicación no recibe hoy ningún reparto neto**: los aros pintan la clase de cada posición, entera. La
  regla está en la pieza para cuando lo reciba.

## 30. El extractor lee la fecha de 13 KID que se aceptaban sin ella, y uno resulta caducado

*Óscar, 21-11-2026.*

**La pregunta.** Trece KID en uso no daban fecha de elaboración al lector (`core/kid.py`, `RE_FECHA_DOC`), y sin fecha el
extractor no puede aplicar la caducidad de `KID_MAX_DIAS` (456 días): se aceptaban sin mirar de cuándo eran. El punto 7 de
la tanda de la C-28 los investigó sin tocar código y dejó el arreglo para que Óscar decidiera.

**Elegido.** Cuatro arreglos del lector, cada uno con su prueba en `tests/test_kid_fecha_parseo.py` sobre un texto con la
forma real del PDF:
- **Amundi (3).** El PDF pierde los espacios de todo el texto («Fechadeelaboracióndeldocumentodedatosfundamentales:17/10/2025»).
  El primer patrón admite `\s*` entre las palabras de la etiqueta.
- **DWS (3).** Salto de línea entre «son» y «exactos a 16.04.2026»: el patrón pasa de un espacio a `\s+`.
- **Columbia Threadneedle (6).** La fecha va sola en la última línea del bloque «Producto», justo antes de «¿Qué es este
  producto?»: un patrón nuevo, anclado a esa posición (la fecha ocupa su línea entera), para que otra fecha suelta del
  documento no la sustituya.
- **Groupama G Fund Avenir Europe NC (`LU0675297237`).** Maquetado a dos columnas: la etiqueta cae en dos líneas («Fecha de
  elaboración del» / «documento») y la fecha, en la línea del medio, a la derecha del ISIN. Por las coordenadas del PDF,
  «30 de diciembre de 2022» **es** la fecha de elaboración. El comentario de `core/kid.py` y el caso de
  `test_kid_fecha_parseo.py` que la daban por fecha de lanzamiento estaban equivocados y se corrigen; el patrón de los dos
  puntos pegados a «datos fundamentales» sigue sin cogerla en una sola línea, que es lo que debe.

**Dónde se cumple.** Una sola lista, `RE_FECHA_DOC['es']`, que usan `parsea` y, por él, `fetchers/kid_gestora.py::_lee`. Las
cifras esperadas de las pruebas son las que se leen a ojo en el PDF, no la salida del lector.

**Medido el 21-11-2026 sobre los 633 PDF de la caché** (`cache/kid/gestoras`, el lector de antes contra el de ahora, mismo
texto): **13 fechas nuevas**, 3 PDF siguen sin fecha (no estaban entre los 13 en uso) y **0 de las 617
que ya se leían cambian**. De las 13, 12 están vigentes (de 131 a 400 días) y **una está caducada: Groupama, de 1.422 días**
(el límite es 456). `_lee` la devuelve vacía con el aviso «documento de 2022-12-30, caducado; no lo uso», el mismo motivo
que ya usa el extractor para cualquier KID caducado.

**Consecuencia que se acepta.** Groupama G Fund Avenir Europe NC pierde su KID en el próximo refresco del extractor: sus
costes, su SRI y su procedencia de KID dejan de salir de ese documento, y el fondo queda con lo que le den las demás
fuentes hasta que la gestora publique uno vigente. Es el comportamiento correcto: hoy se enseña un KID de hace casi cuatro
años como si valiera. Hasta ese refresco y la subida del catálogo, que son a mano, la base sigue con el KID de antes.

**Lo que deja abierto.**
- **Los otros 12 pasan a tener fecha y empezarán a caducar** como cualquier KID: el más antiguo (un fondo de Amundi,
  `FR0010829697`) tiene 400 días y caducará dentro de 56.
- **Hay patrones que dependen de la maquetación de cada gestora.** Si una gestora cambia el PDF, el lector volverá a dejar el
  KID sin fecha sin avisar. Una auditoría de «KID en uso sin fecha» es el control que lo cazaría; no está construida.
  **Hecho el 21-11-2026 (la auditoría de «KID en uso sin fecha»):** `calidad.kid_en_uso_sin_fecha` (`core/calidad.py`) nombra la ficha que lleva su KID (`kid_url` o `kid_sha256`) sin `kid_fecha`, y `python main.py calidad` lo cuenta y lo nombra, con su fuente, en la salida y en `reports/fondos_problematicos.md`. Es un aviso: no entra en las flags ni en el score, y no bloquea. Prueba en `tests/test_kid_en_uso_sin_fecha.py`. **Medido ese día** sobre las 1.341 fichas de `data/funds` (aún con el lector de antes de la C-30, sin refrescar): **17 KID en uso sin fecha**, los 13 de esta decisión (Deutsche Bank 6, DWS 3, Amundi 3, Renta4/Allfunds 1) y **4 de la CNMV** (`ES0112602000`, `ES0140643034`, `ES0141113037`, `ES0146309002`), que no son de esta decisión y el lector no lee: de dos de ellos hay PDF en la caché y no trae fecha legible. Sobre la caché de PDF con el lector de hoy: de los 633 de las gestoras **3 siguen sin fecha y ninguno está en uso** (`LU1333148903` en dos gestoras y `LU1814994353`); de los 744 PDF de las tres cachés (gestoras, CNMV y AMF), los AMF sin fecha legible tienen la de la API de la AMF, y los **dos de la CNMV en uso sin fecha** son los que quedan. Tras el próximo refresco el control debe dar los 4 de la CNMV y ninguno de los 13.

## 31. Los mapas de la renta fija se guardan netos, como el reparto por clase

*Óscar, 21-11-2026. Construida el mismo día en la rama `claude/decision-28-mapas-netos-21-11`.*

**La pregunta.** Lo que dejó abierto la C-29: los tres mapas de la renta fija de `declared/exposure` (`bond_types`,
`duration_buckets` y `credit_buckets`) pasaban por `mapaDePesos`, que salta lo que no está entre 0 y 1. Un `bond_types`
con la liquidez negativa la perdía y sumaba de más: UBS Duración 0-2 (`ES0126547035`) escribía gobierno, corporativa y
titulizada, que suman 1,049, sin su liquidez de −4,87 %.

**Elegido.**
- Los tres mapas se guardan **netos, tal como los da el proveedor**, con la regla de la C-29: un mapa con una parte fuera
  de 0-1 se escribe tal cual —la negativa con su signo, la que pasa de 1 sin recortar— si todas sus partes caben en los
  topes y entre todas suman 1 con `TOLERANCIA_DEL_REPARTO`, el punto del reparto por clase.
- **Topes: de −5 a 6 por parte**, los de `peso_de_clase`. Cubren con holgura lo que cuadra (de −3,44 a 4,44) y dejan
  fuera dos mapas reescalados sobre una base neta casi nula, que ya no describen el fondo.
- **Lo que no cuadra sigue con la regla de antes**: si no suma 1, o una parte se sale de los topes, se saltan las partes
  fuera de 0-1 y se escribe el resto, sin comprobar la suma, que es lo que hacía el mapper con todos estos mapas. El
  mapper lo avisa («`<campo>` neto que no se escribe tal cual»).
- Un mapa sin partes fuera de 0-1 no cambia, sume lo que sume. Cuándo se escriben los tres sigue siendo la C-27.

**Dónde se cumple.**
- Contrato: `$defs.mapa_neto_de_renta_fija` de `instrument-declared-exposure.v2`, con las partes de −5 a 6 y la regla, su
  fecha y lo medido en la descripción; lo usan los tres mapas, y los de la renta variable siguen en `mapa_de_pesos`, de 0
  a 1. **No sube de versión**, como la C-29: ensancha un rango que solo escribe la plataforma. `read/card` no copia estos
  mapas. Ningún SHA cubre los contratos de la base nueva; el de lectura `asset-for-bdb.v1` dice desde hoy cómo sirve el
  mapa (`npm run sync:contracts`: cambia su SHA en `functions_python/contracts_cache/manifest.json`).
- Plataforma: `mapaDeRentaFija` (`2-plataforma-datos/src/ingestion/baseNueva/mapper.ts`), que lee los topes del contrato.
  Lo prueba `tests/baseNuevaMapasNetosDeRentaFija.test.ts`, con mapas del canónico y lo esperado escrito a mano.
- Servidor: `map_fixed_income_profile` (`functions_python/readmodel/mappers.py`) sirve de `bond_types` solo las partes
  mayores que cero (`_frac_map`), como antes, y no rompe con un mapa neto: lo dice su docstring y lo prueba
  `tests/test_mappers.py` con UBS Duración 0-2 y FON Fineco Inversión. Los otros dos mapas no los lee ninguna Function.
- Aplicación: **ninguna pantalla ni ningún PDF pinta estos mapas**, así que no hay barra ni nota que poner. Su único lector
  es la equivalencia de fondos (`src/core/fundEquivalence.ts`, «Tipo de emisor»), que recibe el mapa del servidor y además
  filtra lo que no es mayor que cero (`src/adapters/bdbLiveApiAdapter.ts`): compara el tipo de emisor sin las partes
  negativas, como compara la mezcla de clases (C-29). No se ha tocado.
- Extractor: nada que cambiar; ningún control suyo mira estos mapas.

**Medido** el 21-11-2026 sobre el canónico del 17-11 (`export_bdb` y `export/fondos.ndjson`), con el mapper en seco y sin
bases. En los mapas que aplican, **91 `bond_types` y 13 `credit_buckets` traen una parte negativa, y ningún
`duration_buckets`**. Las negativas del tipo de emisor son la liquidez en 71, gobierno en 21, corporativa en 6 y titulizada
en 4; las de crédito, tramos de calificación. Suman 1 netos los 13 de crédito y 42 de tipo de emisor, y de esos 55 caben en
los topes 53. Lo que mueve: **53 mapas de 51 fondos pasan a escribirse netos**, 40 de tipo de emisor y 13 de crédito; 5 de
los de tipo de emisor no tenían mapa, porque ninguna de sus partes era un peso (FON Fineco Inversión, `ES0137396000`, trae
la liquidez a 105 % y el gobierno a −5 %). Siguen con la regla de antes 49 `bond_types` con una negativa que no suman 1, 2
que suman 1 fuera de los topes (Allianz Strategy 75 CT EUR, gobierno −4,14 y liquidez 8,50; y Morgan Stanley Euro
Corporate Bond, en más y menos 1.600), y 6 `duration_buckets` con una parte por encima de 1 que no suman 1. Ningún otro
mapa cambia, y los 802 `declared/exposure` validan contra el contrato.

**Consecuencia que se acepta.** Un mapa neto no se puede leer como un reparto de lo positivo: una parte puede salir en
negativo y otra pasar del 100 %, y quien lo dibuje tiene que escribir el signo y no ponerle barra. Hoy no lo dibuja nadie.
Llega a la base con el próximo refresco y la subida del catálogo, que son a mano; hasta entonces sigue el mapa de antes. Los
5 fondos que ganan `bond_types` deberían subir su cobertura en `quality/latest` y `read/card`; no se ha medido.

**Lo que deja abierto.**
- **Los 49 `bond_types` que no suman 1 no cuadran por el extractor.** El adaptador (`1-extractor/core/adaptador_bdb.py`,
  `bond_sectors`) pasa al canónico gobierno, corporativa, titulizada y liquidez, y deja fuera los **derivados** y el
  **municipal** del proveedor. En `data/funds` del extractor, medido el mismo día, los 111 repartos por tipo de emisor con
  una parte negativa suman 100 con todas sus claves y solo 52 sin esas dos (de los 673 sin negativas, 673 y 503). Llevar esas
  dos partes al canónico y al mapa es otra decisión, y toca el extractor.
- **`duration_buckets` casi nunca suma 1**: 12 de los 332 que se escriben. Son tramos de vencimiento que no cubren toda la
  renta fija, así que la suma no lo valida; ninguno trae negativos.
- **La equivalencia de fondos** compara el tipo de emisor sin las partes negativas, como la mezcla de clases (C-29). Pasarle
  el mapa neto es otra decisión.

## 32. Se borra el código de la base vieja

*Óscar, 21-11-2026* («A, a la base nueva» para el desarrollo local, y «Sí, todas» a las decisiones 30 a 39 del censo
`CENSO_BASE_VIEJA_2026-11-21.md`).

**La pregunta.** Desde el 21-11-2026 ni producción ni el desarrollo local leen la base vieja (`gestor-activos-local`,
Firestore 8082). El censo encontró 92 piezas muertas, unas 44.100 líneas, y 30 dudosas.

**Elegido.**
- **Se retira entera, en tres tandas** (Functions, aplicación, plataforma con extractor), con la etiqueta de Git
  `referencia-base-vieja-2026-11-21` en el último estado que la tenía.
- **Functions:** salen las 20 declaradas que solo servían a la base vieja; quedan 26 declaradas y las mismas 23
  desplegadas. Se conservan las 3 programadas de informes. Las que antes elegían base por `master_project_id()` piden
  ahora la nueva (`master_project.exigir_base_nueva`) y con la vieja paran con un mensaje claro.
- **Se conservan a propósito:** `functions_python/.env` con `gestor-activos-local` y ese id en `master_project.py` y en
  `ALLOWED_PROJECT_IDS` (el defecto seguro de un guion lanzado a mano: no existe en la nube); el guion que restaura una
  copia de la maestra en un emulador (`backup:restore-drill`), única vía para leer las copias; el programa de línea de
  órdenes del extractor y el resto de su servicio web; la cuarentena de series (`adjustment_problem`,
  `price_repair_release`), activa con la base nueva; y la lectura REST de la app, que es la barrera «sin emuladores,
  nada de SDK».
- **Sale:** Sistema › Operaciones y las otras pestañas de Sistema que solo existían con la base vieja (quedan Estado del
  sistema y Retrocesiones); los contratos de la maestra (`contracts/master`) y sus copias en la caché de las Functions;
  el estimador semanal `GEOMETRIC_CAGR/WEEKLY` (§12 del método); las reglas de Firestore de la app, cuyas pruebas pasan
  a probar las de producción (`4-base-nueva/firestore.rules`).

**Lo que mueve.** 303 ficheros tocados, 220 de ellos borrados enteros, y 58.459 líneas menos (822 nuevas), medido con
`git diff --shortstat` sobre los tres borrados. Ninguna Function
desplegada cambia de comportamiento con la base nueva; la web pierde pantallas que ya no se veían.

**Lo que queda abierto.** El servicio web del extractor (otra tanda); un consejo de `/api/ops/reclasificar` que cita una
orden borrada; la tarea de copia diaria de la maestra, si sigue en el Programador de tareas de Windows, se quita a mano.

## 33. El tipo de emisor lleva también los derivados y el municipal

*Óscar, 21-11-2026 (punto 40). Construida el mismo día en la rama `claude/decision-40-derivados-21-11`.*

**La pregunta.** Lo que dejó abierto la C-31: 49 `bond_types` con una parte negativa no sumaban 1, y no se podían guardar
netos, porque el adaptador del extractor pasaba al canónico cuatro de las seis partes que da el proveedor —gobierno,
corporativa, titulizada y liquidez— y dejaba fuera el **municipal** y los **derivados**. En un fondo con futuros o permutas
la liquidez sale en negativo y los derivados la compensan: sin ellos, el reparto no cuadra.

**Elegido.**
- El canónico lleva las **seis partes** del reparto por tipo de emisor del proveedor (`GlobalBondSectorBreakdownLevel1` de
  Morningstar), con el nombre de su supersector en minúsculas, como las cuatro de antes: `government`, `municipal`,
  `corporate`, `securitized`, `cash` y **`derivative`**. En singular, como lo nombra el proveedor y como `government` o
  `corporate`.
- Van **netas, con su signo**, en `ms.fixed_income.bond_sectors` (en porcentaje, la que falta como nula, igual que las
  otras) y en `portfolio_exposure_v2.bond_types` (en fracción, y la que falta no se escribe: no es un cero).
- La plataforma no cambia de regla: el mapa pasa por la de la C-31, y ahora suma 1 donde antes le faltaban dos partes.

**Dónde se cumple.**
- Extractor: `convierte` en `1-extractor/core/adaptador_bdb.py` (`bond_sectors`), con `tests/test_tipos_de_bono.py` y los
  repartos de Gestión Talento y Abante Selección sumados a mano. **El contrato canónico no cambia**: `fondosdb-fund.v1`
  declara `bond_sectors` y `bond_types` como mapas abiertos (`additionalProperties: true`), así que no sube de versión ni
  cambia el SHA de `contracts_cache`.
- Plataforma: el contrato `instrument-declared-exposure.v2` **no tiene lista de claves** en `bond_types` (es
  `mapa_neto_de_renta_fija`, un mapa clave-peso con tope de 60), así que ya las aceptaba; desde hoy su descripción nombra las
  seis y lo medido, sin subir de versión. `mapaDeRentaFija` (`src/ingestion/baseNueva/mapper.ts`) pasa las claves tal cual;
  lo dice su comentario y lo prueba `tests/baseNuevaMapasNetosDeRentaFija.test.ts` con tres mapas del canónico nuevo.
- Servidor: `map_fixed_income_profile` (`functions_python/readmodel/mappers.py`) sirve las partes mayores que cero sin
  lista de claves, y el contrato de lectura `asset-for-bdb.v1` las admite (`number_map`). No se ha tocado su lógica; lo prueba
  `tests/test_mappers.py`.
- Aplicación: la equivalencia de fondos (`src/core/fundEquivalence.ts`, «Tipo de emisor») compara sobre la unión de las
  claves de los dos fondos y no tiene lista: no rompe. Solo cambia el comentario del tipo en `src/types/bdbAssets.ts`.

**Medido** el 21-11-2026 en seco, sin bases: el adaptador nuevo sobre las 1.334 fichas de `data/funds` del 17-11 (las
mismas del canónico de ese día), y el mapper sobre ese canónico y sobre el del 17-11. El canónico nuevo **solo difiere** del
del 17-11 en las dos claves (805 fondos las llevan en `bond_sectors`; 487 traen derivados y 17 municipal en `bond_types`), y
las 1.334 fichas cumplen su contrato. En la ficha, los 318 repartos por tipo de emisor con alguna parte negativa (111 en las
cuatro de antes y el resto solo en los derivados) suman 100 con las seis partes, y solo 147 con cuatro. En el mapper, los 802
`declared/exposure` validan y **no cambia ningún otro campo**:
- De los **49 `bond_types` que no sumaban 1, 45 lo suman y se escriben netos**; los otros **4 suman 1 pero se salen de los
  topes** de −5 a 6 —Nordea 1 Stable Return E (`LU0227385266`, liquidez −558 %), Nordea 1 Alpha 15 MA BP (`LU0607983896`) y
  dos clases de Allianz Dynamic (`LU1304666057`, `LU1594335520`)—, reescalados sobre una base neta casi nula como los dos de
  la C-31, que siguen igual. Esos 6 siguen con la regla de antes y su aviso.
- Uno de los 45 **gana el mapa**, que antes no tenía porque ninguna de sus partes era un peso: MERCHFONDO (`ES0162332037`),
  con un 0,58 % de renta fija. Los `bond_types` escritos pasan de 348 a 349.
- **Los mapas netos pasan de 40 a 185**: los 45, y **100 que no traían ninguna parte negativa en las cuatro de antes y ahora
  traen los derivados en negativo** —51 por menos de un punto, el resto hasta −37,6 %—. Esos 100 se escribían sumando de más,
  hasta 1,376. Los mapas que suman 1 pasan de 233 a 348 de 349; el que no, Nordea 1 Stable Return, es de los que se salen de
  los topes.
- **Cambian 253 de los 348 mapas que ya se escribían, y ninguno pierde ni cambia una cifra**: todos ganan claves. Los
  derivados en 252 (de los 253 mapas que los llevan, MERCHFONDO incluido, 134 en negativo, 104 en positivo y 15 a cero), el
  municipal en 17, y los 45 que pasan a netos, además, la
  parte negativa que antes se saltaba (la liquidez en 42, el gobierno en 7 y la corporativa en 2). 32 de los 40 que ya eran
  netos ganan los derivados. 96 no cambian.
- **Lo que sirve el servidor**, que son las partes mayores que cero, cambia en **115 fondos** (68 de renta fija, 36 mixtos, 8
  de renta variable y 3 otros): ganan los derivados en positivo o el municipal, y MERCHFONDO, su mapa.

**Consecuencia que se acepta.** Llega a la base con el próximo refresco y la subida del catálogo, que son a mano; hasta
entonces sigue el mapa de antes. La equivalencia de fondos verá una clave más en esos 115: un fondo con los derivados en
positivo y la liquidez en negativo se compara con su parte de derivados y sin la liquidez, porque el servidor solo sirve lo
positivo. En Gestión Talento, los derivados pasan a ser el 82 % de lo que se compara.

**Lo que deja abierto.**
- **Si la equivalencia debe comparar los derivados.** Son exposición sintética, no un tipo de emisor que se tenga en
  cartera, y con la liquidez negativa fuera pesan más de lo que el fondo tiene neto. Las salidas: dejarlo así (compara lo que
  declara el proveedor), sacar `derivative` de la comparación como se saca lo negativo, o pasarle el mapa neto (la última
  salida abierta de la C-31). Decisión de Óscar; no se ha tocado.
- **Los 6 que se salen de los topes** siguen sin mapa neto; ensanchar los topes para ellos sería escribir repartos reescalados
  sobre una renta fija neta casi nula, y la C-31 ya dijo que no.
- **El municipal** casi no existe en este catálogo (17 fondos, ninguno por encima del 0,7 %): entra por completar el
  reparto, no por su peso.
