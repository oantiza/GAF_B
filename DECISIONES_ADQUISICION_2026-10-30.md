# Decisiones de adquisición de datos

*30 de octubre de 2026. Las decisiones son de Óscar; el análisis y las recomendaciones, de
Claude Opus 5. No se ha escrito código ni se ha tocado la maestra para producir este documento.*

Resuelve las decisiones pendientes que dejaron abiertas `FUENTES_PUBLICAS_FONDOS_2026-09-28.md`
(§7) y `PROGRAMA_DATOS_PUBLICOS_FONDOS_2026-09-28.md` (§10), y fija el rumbo del programa de
datos públicos de fondos. Sirve de encargo para quien lo ejecute.

Las cifras marcadas **medido** salen de contar; las marcadas **estimado** son cálculo sobre una
fórmula declarada; las marcadas **sin verificar** no se han podido comprobar y así se dicen.

---

## 1. El rumbo, fijado por Óscar

Esto manda sobre cualquier recomendación previa de los informes del 28-09.

1. **El objetivo es un sistema propio y gratuito**, con las menos licencias posibles, que más
   adelante se pueda comercializar. De momento se puede usar Morningstar si hace falta.
2. **Lo primero es el catálogo de datos**, no las olas de gestoras: determinar qué datos exactos
   necesita o puede necesitar el programa para fondos y ETF, y hasta qué punto se pueden
   conseguir de forma independiente. A partir de ahí, lo que no se pueda, se trae de otras
   fuentes, Morningstar incluido.
3. **Ámbito geográfico: solo activos comercializables en España.** Simplifica el universo y
   convierte los registros de la CNMV en la llave de todo, no solo de los fondos españoles.
4. **Prioridad de fuentes:** datos públicos de gestoras, organismos oficiales o fuentes
   gratuitas. Si no es posible, el resto.
5. **Mientras se desarrolla, lo importante son los datos, no su procedencia.** Esta versión es
   preliminar y no definitiva.
6. **Excepción explícita: las estrellas de Morningstar se van a usar.**
7. **Infraestructura: plan Blaze.** Pagar algo es aceptable mientras sea poco.
8. **Universo objetivo: 1.000 fondos, 300 ETF y 500 acciones.**

---

## 2. Decisiones cerradas

### D1 · Valor liquidativo de fondos extranjeros

**Decidido: se mantiene EODHD.** La licencia se pagará cuando sea necesario, en EODHD o en otro
proveedor, y deja de ser un condicionante del diseño.

- **Medido el 30-10:** el servidor MCP de datos financieros de la sesión es EODHD y es la cuenta
  de Óscar (plan mensual de pago, límite de 100.000 llamadas al día). Devuelve serie diaria de
  VL por ISIN en los cinco domicilios del universo, con último dato del 28 o 29 de octubre:
  `LU0104885248`, `IE00BYX5NX33`, `FR0010148981`, `DE0005318406`, `ES0110407006`.
- **Medido el 28-09:** solo 2 o 3 de cada 10 gestoras publican histórico de VL descargable. No
  hay alternativa pública a esta escala.
- **Hallazgo nuevo:** para el fondo español, EODHD llega fresco, mientras la CNMV publica con
  unos cuatro meses de retraso. La CNMV sigue siendo la fuente del histórico español, pero para
  el dato reciente no sustituye a EODHD ni en España.

**Consecuencia asumida:** la frontera eficiente, la volatilidad, el Sharpe y las correlaciones de
todo el universo dependen de un proveedor de pago. Es riesgo concentrado, pero contractual y con
soporte, no una API interna suplantando cabeceras.

**Para el ejecutor:** la fuente de VL debe ser sustituible sin tocar nada más. Es el único bloque
del sistema sin salida gratuita, y si algún día el sistema se comercializa, habrá que resolver la
licencia de redistribución. Diséñese con esa pieza aislada.

### D3 · Categoría y estrellas de Morningstar

**Decidido: se usan las estrellas y también la categoría Morningstar.** No se prescinde de
ninguna de las dos. Es coherente con cómo se construye el dato: la estrella se calcula dentro de
la categoría, así que una sin la otra no se puede leer.

`classification_v2` sigue existiendo y es la clasificación propia del sistema, y es la que manda
para el optimizador.

**El límite de la excepción, para que no se ensanche sola.** Entran la estrella y la categoría.
**No entran** el percentil o la rentabilidad frente a categoría, el medalist, los globos ESG ni
la huella de carbono. Si alguno hiciera falta, es una decisión nueva, no una extensión de esta.

- **Medido el 28-09:** categoría al 99,7 % de cobertura y estrellas al 92 %.
- **Medido el 03-09:** Morningstar ya cortó el acceso una vez (`NameResolutionError` sobre
  `tools.morningstar.es`). Nada crítico debe depender de que responda.

**Consecuencia asumida:** el sistema conserva una dependencia propietaria en un dato que el
cliente reconoce. Si Morningstar corta, la estrella desaparece de la ficha; no debe arrastrar
nada más consigo.

### D7 · Umbral de cobertura para dar de baja proveedores

**Decidido: deja de aplicar.** Morningstar no es algo que haya que apagar, sino el respaldo
cuando lo público no llega. El criterio pasa a ser por campo: fuente pública u oficial primero,
el resto si no hay.

- **Medido el 30-10:** **no existe plan de fundamentales de EODHD que dar de baja.** La llamada
  de fundamentales responde `403 Forbidden` con el token de Óscar: ese módulo no está en la
  suscripción. El ahorro de unos 600 $/año que figuraba en
  `OPINION_DATOS_PUBLICOS_FABLE_2026-09-28.md` §2.5 **no existe**, porque no se está pagando.
  Coincide con el comentario que ya estaba en `ingest_asset.py` de la app.

**Para el ejecutor:** aunque no haya umbral de baja, hace falta **una sola definición de
cobertura**, medida por ISIN sobre el mismo universo y la misma fecha, antes y después de cada
avance. Hoy no la hay: el extractor y la maestra cuentan «fondos sin KID» de formas distintas
(221 frente a 6) y las dos cifras son verdad.

### D8 · Ranking propio en lugar de las estrellas

**Decidido: no se construye.** Si las estrellas se quedan (D3), sobra.

El criterio que lo sostiene, y que conviene conservar si algún día se retoma: una nota global
propia sin metodología publicada es una opinión con forma de medición, y un cliente la leerá como
medición. Si en el futuro hace falta algo, lo defendible es un percentil de rentabilidad y
volatilidad dentro de la clasificación propia, con su fecha y su universo a la vista, nunca una
nota de 0 a 10 ni estrellas propias.

### D2 · Alcance del piloto

**Superada por el rumbo del §1.** No se empieza por gestoras, ni por las diez mayores ni por el
piloto de renta fija: se empieza por el catálogo de datos y su obtenibilidad independiente.

Dos cosas del análisis que conviene no perder cuando llegue el momento de ejecutar:

- **Lo que ata a Morningstar son los campos que tiene al 99 %** (reparto por clase de activo
  99,6 %, top 10 y nº de posiciones 99 %, TER 99,3 %, MiFID ex ante 98 %, gestora comercial e
  índice 99,7 %), no los de renta fija, que Morningstar casi no da (duración 24,7 %, TIR 26,5 %,
  rating medio 45,4 %). Mejorar renta fija es valioso, pero no acerca a poder apagarlo.
- **La ficha mensual trae la composición y el perfil de renta fija en el mismo PDF.** No hay que
  elegir entre ambos bloques; se elige por qué gestoras se empieza, y la renta fija sale como
  subproducto.
- **El paso más barato es cerrar los 221 fondos sin KID**: son patrones de URL para siete
  gestoras (BlackRock, Fidelity, BNP, Allianz, PIMCO, Carmignac, Groupama) y bajan la cifra a
  menos de 60. El KID está estandarizado por PRIIPs, así que no tiene la fragilidad de
  maquetación de las fichas comerciales.

---

## 3. Decisiones de arquitectura, cerradas el 30-10

Se cerraron después del catálogo (`CATALOGO_DATOS_FONDOS_2026-10-30.md`), a propuesta de Claude
y con el visto bueno de Óscar. Cualquiera de las tres se puede revocar; queda escrito en qué se
apoyan para que revocarlas sea una decisión informada y no un olvido.

### D5 · ¿Migrar los adaptadores oficiales o duplicarlos?

**Decidido: ninguna de las dos. No se mueve nada y no se duplica nada. Se construye dentro del
extractor.**

Entre los dos informes del 28-09 había una discrepancia de fondo: el diseño proponía un programa
nuevo e independiente, y la segunda opinión sostenía que el extractor ya **es** ese programa. Con
el catálogo delante, gana la segunda, y por un argumento que en septiembre no se tenía.

- **Medido el 30-10:** `1-extractor/core/adquisicion/` ya contiene `adaptador.py`,
  `capacidades.py`, `nucleo.py`, `planificador.py`, `procedencia.py` y un `registro.py` con
  capacidades declaradas por adaptador y una función `registra()` como punto de extensión.
  Los adaptadores oficiales —CNMV, CNMV_FICHA, CSSF, GLEIF, AMF_GECO— ya están registrados ahí.
- **Medido el 30-10 (catálogo):** el 22,6 % del sistema que ya es independiente sale
  precisamente de esos adaptadores. No hay nada que migrar: ya están en la única casa que tiene
  fusión, procedencia y calidad.
- **El argumento que decide, corregido el 30-10 tras abrir el código.** La primera versión de
  este documento decía que el mejor cambio por esfuerzo era cambiar la prioridad por campo para
  preferir el KID frente a Morningstar. **Eso era falso** y está corregido en
  `CATALOGO_DATOS_FONDOS_2026-10-30.md` §4.b: el lector de KID escribe en su propio espacio, no
  en los campos de Morningstar, así que no había conflicto que resolver.
  Lo que sí sostiene la decisión, y mejor: **toda la maquinaria de prioridad y de mapeo ya vive
  en el extractor y en ningún otro sitio.** `core/adquisicion/registro.py` declara las
  capacidades por adaptador y la lista `RUTAS_OFICIAL_PRIMERO`; `core/adquisicion/nucleo.py` la
  aplica; y `core/canonico_regulatorio.py` contiene el mapa de ruta canónica a campo de la
  maestra, campo por campo. Una casa aparte tendría que reimplementar las tres cosas, y cualquier
  regla nueva de prioridad habría que escribirla dos veces y mantenerla sincronizada.
- Y seguiría en pie lo que ya señaló la segunda opinión: una casa nueva duplicaría fusión,
  validación y calidad, y añadiría una **cuarta vía de escritura** hacia Firestore cuando ya
  hay tres.

**Consecuencia asumida:** el extractor crece y se vuelve claramente el núcleo de adquisición,
no «el extractor». El nombre de la carpeta queda engañoso, y renombrar cinco repositorios no
compensa. Su suite de pruebas tiene que cubrir más superficie.

**Coste:** cero de infraestructura. El precio es disciplina: cada adaptador nuevo declara sus
capacidades y se contrasta en `tests/test_capacidades.py`, que ya exige que una ruta escrita y
no declarada falle.

### D4 · Nombre y ubicación del programa

**Decidido: no hay programa nuevo. Se descarta `0-datos-publicos`.**

Lo nuevo vive donde ya vive lo viejo:

- Adaptadores nuevos en `1-extractor/fetchers/`, registrados en `core/adquisicion/registro.py`:
  `ficha_gestora`, `estructurados`, `findatex`, `informe_periodico`.
- Lectores por plantilla en un paquete `lectores_ficha/`.
- Tablas de normalización en `config/taxonomia/`.
- Todo sale por el canónico de siempre y entra por el cargador con puerta.

Si algún día se quiere separar —por ejemplo para comercializarlo—, que sea **un paquete que el
extractor importa**, nunca una segunda tubería que escriba por su cuenta.

**Consecuencia asumida:** no hay frontera limpia entre «lo público» y «lo demás» a nivel de
carpeta. La frontera es la procedencia por campo, que ya existe y es más fina que una carpeta.

### D6 · Motor del respaldo con IA

**Decidido: Gemini como motor inicial, detrás de una interfaz, y la decisión deja de ser
importante.**

- **Medido el 30-10 (catálogo):** el grueso de lo sustituible sale de registros oficiales y de
  KID, no de leer PDF comerciales. El lector con IA es para la cola larga de fichas mensuales
  (ola 4), no para el camino crítico. En septiembre parecía una decisión de arquitectura; con el
  catálogo medido es una decisión de proveedor, y reversible.
- **Por qué Gemini y no Claude:** Óscar ya lo usa en los informes de mercado, así que no añade
  proveedor, ni factura, ni operación nueva. **Conflicto de interés declarado:** esta
  recomendación la escribe Claude, y recomendar al competidor es lo que el argumento operativo
  pide; si alguna vez la comparación técnica dijera lo contrario, mandaría la comparación.
- **Volumen estimado:** del orden de 2.800 documentos al año (unos 700 fondos × cuatro
  campañas) solo en la cola larga. A ese tamaño el coste es marginal en cualquiera de los dos,
  así que la elección se hace por operación, no por precio.
- **Condición dura, que no es negociable:** el motor va detrás de una interfaz, y el resultado
  con marca `ia` en la procedencia **nunca entra en la maestra sin pasar la validación**. Cada
  dato extraído debe traer página, etiqueta, unidad y a qué se refiere (fondo, clase o índice),
  porque un 3,7 puede ser la duración del fondo o la del índice. Esto es lo único del sistema
  donde una cifra se puede inventar, y la regla de la casa aplica entera: si no valida, va a la
  cola de revisión.

**Consecuencia asumida:** se depende de un proveedor de IA para la cola larga. Al estar detrás de
una interfaz, cambiarlo es sustituir una implementación; y si el lector por plantilla cubre más
de lo previsto, puede no llegar a hacer falta.

**Coste:** la interfaz y el esquema cerrado, más las pruebas de validación. Mantenimiento
permanente bajo mientras el esquema no cambie.

---

### D9 · Morningstar, cuando la serie de EODHD se para

*Decisión de Óscar, 11-11-2026 («Sí, Morningstar»). Matiza D1 sin cambiarla: EODHD sigue siendo la fuente del valor
liquidativo.*

**El hecho.** Once fondos vivos tienen la serie diaria de EODHD (`<ISIN>.EUFUND`) cortada entre 2022 y junio de 2026,
mientras otras 744 están al día. EODHD no los tiene con ningún otro código: buscados por ISIN, por nombre y por el
identificador de Morningstar, solo uno tiene una cotización de Fráncfort, que es precio de mercado. **Morningstar sirve la
serie diaria de valor liquidativo de los once** con `timeseries_price`, en el mismo servidor y con la misma clave pública que
ya usa `fetchers/morningstar_lt.py`. Cuadra día a día con EODHD donde las dos existen: en nueve fondos, cero diferencias o
solo de redondeo; en LU1683285321, dos días en los que el error es de EODHD.

**Lo decidido.** Morningstar entra como fuente de la serie **solo cuando EODHD está parado**, y con tres reglas:

- **Empalme**, en nueve: EODHD hasta su corte y Morningstar después, sin salto de nivel.
- **Sustitución entera** en FR0010312660: la serie de EODHD discrepa 21 días de 2021 a 2025 sin desfase que lo explique, y antes
  de 1999 está en francos.
- **Corte en el evento** en las dos Schroder ISF Emerging Europe (LU0133716950 y LU0106819104): solo desde el 18-07-2022. Ese día
  reabrieron tras la suspensión por Rusia, reorganizadas con *side pockets*, y el valor liquidativo cayó de 25,50 a 10,29: no es
  rentabilidad, y medirlo como tal deformaría todo lo que se calcule sobre la serie.

**Lo que no cambia.** Si Morningstar no responde, el fondo queda como estaba, con su serie parada y su aviso (B-78): nada pasa a
depender de que responda (D3). Cada tramo dice de qué fuente sale.

**Consecuencia asumida.** D1 descartaba apoyar lo crítico en una API interna con clave pública, y este servicio lo es: sin
contrato, sin documentación y sin licencia de uso leída, y puede cambiar sin aviso. Se acepta para once fondos y como respaldo,
no como fuente general. Morningstar ya cortó el acceso una vez, el 03-09, a otro de sus servidores.

**Estado:** decidida; se construye en el extractor y la plataforma, se prueba en local, y la subida a la nube pide su
aprobación aparte.

**Ampliada el mismo día** («Sí, añádelo», Óscar, en otra sesión): **LU0171283459** (BlackRock Global Allocation A2, EUR,
acumulación) entra con la regla de empalme. Está vivo: EODHD llega hasta el 27-10-2026, 15 días de retraso, y como el
extractor da por parada una serie con más de 10 días (`MAX_DIAS_SERIE`), perdía sus métricas propias. Morningstar cuadra
exacto con EODHD en 6.084 días comunes. Quedan fuera LU1066281574, porque Morningstar también se para el 29-09, y
LU2240056445, porque Morningstar no tiene su serie. **Abierto:** con el umbral de 10 días, un fondo grande y vivo pierde sus
métricas por un retraso corriente del proveedor; si se repite, habrá que decidir si D-9 se activa solo con la lista o con
cualquier fondo que tenga identificador de Morningstar y pase la prueba de nivel.

**Constatado al aplicarla (11-11-2026).** La construyó un subagente (`model: opus`, `effort: high`) en `cf2ae597`, `581b9fb4`,
`8a5efcb4`, `ef0a3241` y `fd2121b8`, en el extractor y la plataforma, y la pasó en la base nueva local. Una lista declarada
(`1-extractor/config/serie_de_respaldo.json`) con los doce, cada uno con su regla; los otros seis fondos parados no entran. Antes
de aplicar una regla, una **prueba de nivel**: la mediana de |Morningstar/EODHD − 1| en los 60 últimos días comunes, a 0,1 % como
mucho; si no cuadra, el fondo queda como estaba. **Cada tramo dice su fuente**: `source_segments` en el año de `price_series` en
que la serie cambia de fuente, y `series_id` del tipo `EODHD:<ISIN>.EUFUND+MORNINGSTAR:<SecId>`. **Nada se borra**: el corte de las
dos Schroder lo hace la regla de ruptura que el método ya tenía, que cae justo el 18-07-2022, y para la simulación de carteras y
la tarjeta, `usable_from` en `fund_history_policies.json` (`efc862c8`). El FR0010312660 no deja años sobrantes, porque la serie de
Morningstar empieza en 1989 ya en euros. La divisa de la clase, que EODHD ya no da para estos fondos, sale de Morningstar.
**Resultado en la base local:** los doce dejan de estar parados y llegan al 09 o al 10-11-2026; nueve recuperan métricas propias;
IE00B3NLSS43 y LU2050929277 no, por su política de reparto, y LU1683285321 tampoco, por un hueco de 111 días en el tramo de EODHD
que Morningstar sí cubre. Cambian 294 documentos y se crean 18, todos de los doce; **fuera de ellos, ninguno**, comprobado con una
foto sha256 de toda la base. En LU0171283459, nuestra rentabilidad coincide con la de Morningstar al cuarto decimal. La versión del
método no cambia: la fórmula, las ventanas y la divisa son las mismas, y la fuente queda dicha en `inputs.series_id`.

**Segunda regla, aceptada por Óscar el mismo día** («aceptadas tus recomendaciones»): el tramo de EODHD **se cierra en el último
día en que coincide con Morningstar**, y sus huecos de más de 31 días (los de la decisión 111) **se rellenan con Morningstar** si las
dos cuadran a los dos lados. Hecha en `a6b84dcd`. De los doce solo cambia LU1683285321: EODHD dio tras el 23-12-2025 solo dos
puntos, los dos erróneos, así que su tramo acaba ese día y sigue Morningstar; recupera sus métricas propias, que coinciden con las
de Morningstar a 31-10 (rentabilidad a 1 año 5,96 % frente a 5,93 %; volatilidad a 3 y 5 años, idéntica), y deja de llevar un
`SHORT_HISTORY` que era falso. **Duodécima subida del catálogo** el 11-11-2026 con lo anterior: la nube quedó idéntica a la base
local (49.150 documentos) y lo de la app intacto.

### D10 · Morningstar también para cualquier fondo que cuadre

*Decidido por Dirección el 11-11-2026, por encargo de Óscar («termina las 3», sobre la pregunta de si Morningstar debe
entrar solo para los fondos de la lista o para cualquiera que cuadre). Amplía D9.*

**Por qué.** Con D9 solo, un fondo grande y vivo, BlackRock Global Allocation (LU0171283459), perdió sus métricas propias
por un retraso de 15 días de EODHD, que basta para que el extractor dé la serie por parada (`MAX_DIAS_SERIE = 10`), y hubo
que añadirlo a la lista a mano. Un retraso corriente del proveedor no debería pedir una decisión por fondo.

**Lo decidido.** Además de la lista de D9, Morningstar entra para **cualquier fondo** cuya serie de EODHD esté parada, si
se cumplen **todas** estas condiciones: es un fondo con valor liquidativo (ni acciones ni ETF a precio de mercado); su
SecId de Morningstar es conocido; la serie de Morningstar llega más lejos que la de EODHD; el nivel cuadra (la misma prueba
de D9: mediana de |MS/EODHD−1| de un 0,1 % como mucho en los últimos 60 días comunes, con al menos 20); y la serie compuesta
no tiene ninguna ruptura. La regla es siempre de **empalme**. Sustituir la serie entera o cortarla en un evento siguen
siendo decisiones por fondo, en la lista.

**Lo que protege.** Si salta la ruptura, el fondo no se toca y queda para decidir, como las Schroder de D9. Si Morningstar
no responde, no llega más lejos o no cuadra, el fondo queda como estaba, con su aviso (B-78). Cada aplicación automática
queda en la traza del fondo y en el resumen de la pasada, así que se ve antes de cada subida a la nube.

**Consecuencia asumida.** Crece lo que depende del servicio sin contrato de Morningstar que D9 aceptó para doce fondos.
Sigue siendo un respaldo: si deja de funcionar, esos fondos vuelven a quedarse con la serie parada y su aviso, no con
cifras falsas.

**Estado:** construida el 11-11-2026 en `4f2bb298` (subagente `opus`, `high`), con una prueba por salvaguarda; pytest
del extractor 1.413 y ruff limpios, repetidos por Dirección. Se aplica en el siguiente refresco: no se ha hecho pasada ni
subida. Comprobado con las cachés: hoy no entraría ningún fondo por el automático (19 parados; 12 por la lista y 7 fuera,
4 porque Morningstar no llega más lejos y 3 porque no tiene su serie). Una ruptura en cualquier punto de la serie compuesta,
también en el tramo de EODHD, deja el fondo para decidir. Hay una lista de excluidos del automático, vacía. Dos fondos
quedarán sin métricas propias en el próximo refresco si EODHD sigue con retraso y Morningstar sin su serie: LU2002383896
(14 días) y LU0251661590 (25 días).

### D11 · Planes de pensiones y EPSV: un catálogo aparte, entero de Morningstar

*Decisión de Óscar, 13-11-2026. A la pregunta de con qué fuente («¿hasta qué punto se puede conseguir de forma gratuita, o
del proveedor que tenemos?»), «Sí, como los fondos»; sobre el alcance, «pon los 220»; y dos encargos: «marcar lo que es
plan y EPSV, eso es muy importante» y «un gráfico de evolución en la ficha». Aplica el punto 1 del rumbo —«de momento se
puede usar Morningstar si hace falta»— a un producto que no estaba en ningún catálogo.*

**Qué es.** Un catálogo pequeño de planes de pensiones y EPSV para **Planificación → Planes y EPSV**, junto a Jubilación:
su buscador, la ficha de cada uno y la comparación entre ellos. **Aparte de todo lo demás**, y no por comodidad: un plan o
una EPSV son patrimonio del cliente pero no cartera —no se gestionan con ella, por fiscalidad—, así que no tienen ISIN, no
salen en el Buscador de activos, no se añaden a una cartera y no entran en ningún análisis ni informe. Y **sin cálculos ni
asesoramiento**: «este plan tiene estos ratios, lo comparo con este otro».

**De dónde sale, medido el 13-11-2026.** Del buscador de planes de Inversis para Andbank, que es una herramienta de
Morningstar en `lt.morningstar.com` con su propio cliente y su propio universo: **220 productos**, los que el banco
comercializa. Responde sin sesión, como el buscador de fondos que ya usa el extractor, y da también la serie diaria del
valor de la participación. Lo que se miró antes de elegirlo: EODHD no tiene planes ni EPSV; las fuentes públicas (los
boletines de Inverco, los documentos de datos fundamentales y los informes trimestrales de cada gestora) son parciales, van
en PDF, no declaran que se puedan reutilizar, y de las EPSV no hay nada por plan. Con el cliente que usa el extractor para
los fondos el universo de planes existe (834), pero le faltan 3 de los 220 y no trae la comisión.

**Plan o EPSV.** Se decide con dos señales independientes que tienen que coincidir: un plan de pensiones está registrado
en la DGSFP y trae su código; una EPSV es de ley vasca, no lo tiene, y lleva «EPSV» en el nombre. Coincidían en los 220:
**202 planes de pensiones** —9 de ellos de empleo simplificados (PPES), que se marcan— y **18 EPSV**. Si un día se
contradicen, el producto no entra y la pasada lo nombra: no se adivina.

**Lo que se guarda**, tal como lo da la fuente y con su fecha cuando la trae: nombre, gestora, categoría y estrellas
(D3), fecha de inicio, patrimonio, valor de la participación, rentabilidades a 1 y 6 meses, año en curso, 1, 3, 5 y 10
años, volatilidad a 1 y 3 años, Sharpe, alfa, beta, R² y ratio de información a 3 años, aportación mínima, y la serie
reducida al último valor de cada mes, para el gráfico. Lo único que cambia al escribirlo en la base es la escala (3,03 % se
escribe 0,0303, como todo lo demás).

**Lo que no, y por qué** (medido el mismo día sobre los 220):

- *El percentil y la rentabilidad frente a la categoría.* El límite de D3 vale también aquí.
- *Los gastos corrientes.* Los da en 132, con fecha propia que llega a ser de 2021, y en 22 de esos 132 son menores que
  la comisión de gestión del mismo proveedor, que es imposible por definición.
- *La comisión de gestión de Morningstar.* La da en los 220, pero en 41 de los 155 en que también está la del banco no
  coinciden, y nada dice cuál vale. **Se guarda una sola, la del banco**, que es la de la ficha que el banco entrega;
  donde el banco no la pone (65 de 220), falta. Y aun esa no es firme: la ficha en PDF de una EPSV decía 1,55 % donde el
  buscador del banco dice 1,51 %. La pantalla lo dice siempre: la vigente es la del documento de datos fundamentales.
- *El indicador de riesgo (SRRI).* No consta que salga del documento del plan (el criterio de B-43).

**Las fechas mandan.** Las rentabilidades traen su fecha, que no es la del valor de la participación: en 4 de los 220 iba
meses por detrás, y un plan —BSG Prometeo— lleva sin publicar valor desde junio de 2024 y sigue en la lista del banco. La
pantalla lo avisa bajo la fila y arriba en la ficha, y la comparación dice cuándo las rentabilidades no son de la misma
fecha, cuándo los planes no son de la misma categoría (su alfa, su beta y su R² se miden contra el índice de cada una) y
cuándo se compara un plan de pensiones con una EPSV. La volatilidad y los ratios no traen fecha: solo se dice el día de
la consulta.

**Una excepción al «sin cálculos», pedida por Óscar el mismo día** («Sí, añádelo», después de saber que lo es): la
comparación dibuja la evolución de los planes en un mismo gráfico, y para eso pone cada serie en **base 100**. No se
puede hacer de otro modo —un plan vale 12 € y otro 230 €—, y no crea ninguna métrica: es la serie publicada, dividida
por su propio valor en un mes común. Tres convenciones, las tres a la vista: va **mes a mes**, alineando por mes y no por
día, porque cada plan publica su último valor el día que lo publica; **solo con meses cerrados**, así que el mes de la
consulta no entra; y **la base es el primer mes que tienen todos**, de modo que un periodo que la historia común no cubre
no se ofrece. Un plan sin valores en el periodo no se dibuja y se nombra, y una línea que acaba antes dice en qué mes.
Vive en la aplicación (`src/core/planes/evolucionComparada.ts`), no en la base: no se guarda ninguna cifra calculada.
Contrastado a mano contra las series guardadas en tres planes (127,3, 335,0 y 117,2 en agosto de 2026 sobre junio de
2013). La ficha de un plan sigue dibujando su valor en euros, sin base 100.

**Dónde vive.** Colección propia en la base nueva, `pension_plans/{id}` con la serie en `series/monthly`, con sus dos
contratos; se lee con sesión y no la escribe ningún cliente. **No va dentro del sitio**: sus ficheros se descargan sin
entrar, y estos datos no se pueden redistribuir. En la subida a la nube es una parte propia, `--parte planes`, que el
catálogo de instrumentos no arrastra.

**Consecuencia asumida.** Es el primer catálogo que depende **entero** del servicio sin contrato de Morningstar, y además
de la herramienta de un tercero: si el banco cambia de proveedor o Morningstar corta el acceso, el catálogo se queda como
esté, con su fecha de consulta a la vista, y no se inventa nada. Los datos son de uso interno, para el prototipo. No hay
refresco automático: se refresca a mano (`python main.py planes`, `npm run planes:write`), como el resto.

**Estado:** construido el 13-11-2026 y escrito en la base local (220 fichas y 220 series, verificadas; la auditoría de
la base, entera en verde). Contrastado con las tres fichas en PDF que adjuntó Óscar: alfa, beta, R², ratio de
información y comisión coinciden en 13 de 14 cifras; la que no, es la comisión del párrafo de arriba. **No está en la
nube**: faltan el despliegue de las reglas y la subida de `--parte planes`, que son de Óscar.

## 4. Capacidad: el universo objetivo cabe

Análisis completo, con tablas, en el panel publicado el 30-10. Resumen:

- **Medido** sobre la copia verificada `2-plataforma-datos/data/backups/2026-10-29T09-08-21-424Z`,
  aplicando la fórmula oficial de tamaño de documento de Firestore: 24.152 documentos y
  **424,1 MiB** de datos para 1.099 activos. La serie de precios es el **84 %** del peso.
- Peso medio por activo: fondo **369,1 KiB** (20,5 docs), acción **461,1 KiB** (26,1 docs),
  ETF **399,8 KiB** (19,7 docs). En una acción, la serie es el 99 % de su peso.
- **Proyección a 1.000 + 300 + 500:** unos **39.460 documentos** y **702,7 MiB** de datos
  (0,69 GiB). Es un suelo, no un techo: la serie crece cada día aunque no entre ningún activo.
- **Coste en Blaze:** ~3.600 escrituras y entre 15.000 y 40.000 lecturas al día, dentro de las
  cuotas gratuitas (20.000 y 50.000). El único concepto facturable sería el almacenamiento por
  encima de 1 GiB, y a este tamaño son céntimos al mes.
- **Blaze era necesario de todas formas:** las Cloud Functions no existen en el plan gratuito, así
  que la app no podría funcionar en Spark.
- **Sin verificar:** la tarifa oficial de almacenamiento no se pudo leer sin ambigüedad en la
  página de Google, así que el coste se da como orden de magnitud. Las tarifas de operaciones sí:
  0,03 $ por 100.000 lecturas y 0,09 $ por 100.000 escrituras en región sencilla.

### El encargo técnico que sale de aquí

**Declarar una exención de índice de campo único sobre `points`** en las series de precios.

- **Medido:** `3-BDB-ACTIVOS_app/firestore.indexes.json` tiene `fieldOverrides` **vacío**. No hay
  ninguna exención, así que Firestore indexa por defecto cada elemento de la lista `points`.
- **Medido:** nadie consulta ese campo. No hay un solo `array_contains`, `where` ni `order_by`
  sobre `points` en la app, en las functions ni en la plataforma.
- **Verificado en la documentación de Google.** Para un campo de tipo lista, Firestore crea un
  índice ascendente y otro descendente sobre la lista entera, más un índice `array-contains`
  **con una entrada por elemento**. Los dos primeros son baratos, porque todo valor indexado se
  trunca a 1.500 bytes; el caro es el tercero, que escala con el número de puntos. Esa
  truncación es, además, otra razón para no indexarlo: una consulta sobre `points` daría
  resultados inconsistentes de todos modos.
- **Estimado:** hoy son unos 4,4 millones de puntos y en el universo objetivo serán 7,2 millones.
  Por la fórmula oficial de entrada de índice, del orden de **1,8 GiB solo de índice** frente a
  0,69 GiB de datos. Con la exención, el total queda en unos 0,8 GiB, dentro del gigabyte
  gratuito, y además se acelera cada escritura de serie.
- **Las listas de `holdings` y de sus `chunks` tienen el mismo patrón** (son el 95 % y el 100 %
  de su documento), pero suman unos 41.000 elementos frente a 4,4 millones de puntos: su índice
  son decenas de MiB, no GiB. Se exentan por limpieza, no por peso.
- **No puede medirse desde aquí:** el tamaño real del índice solo lo sabe el proyecto en la nube.
  La cifra exacta está en la consola de Firebase, en Firestore → Uso. Si la consola contradice la
  estimación, manda la consola.
- **Estado: declaradas, y no se pueden aplicar desde aquí.** Las tres exenciones están escritas
  en `3-BDB-ACTIVOS_app/firestore.indexes.json`. Hay tres razones por las que el despliegue no
  sale de este proyecto, y la tercera es la que manda:
  1. `Bash(firebase deploy:*)` está denegado en `.claude/settings.json`, y `firebase.json` añade
     una puerta de aprobación propia (`scripts/requireFirebaseDeployApproval.mjs`).
  2. **No serviría de nada:** el `.firebaserc` de este clon apunta a `gestor-activos-local`, que
     es el proyecto del emulador. Una exención de índice solo cambia algo en un Firestore real;
     el emulador no factura almacenamiento ni mantiene esos índices igual.
  3. El índice que de verdad sobra está en el proyecto que sirve la app en producción,
     `bbdd-activos-financieros`, **que es el de BDB**: justamente lo que la regla absoluta de
     este proyecto prohíbe tocar. Aplicarlo es una decisión que se toma en BDB, a propósito, no
     un despliegue desde este taller.
- **Corrección de lo dicho antes:** se indicó `firebase deploy --only firestore:indexes` sin
  más. Lanzado desde esta carpeta ese comando apuntaría al proyecto del emulador y no haría
  nada útil. Hace falta `--project` con el proyecto real, y eso ya es operar sobre BDB.
- Cuando se aplique donde corresponda, Firestore borra esas entradas en segundo plano: no se
  pierde ningún dato y ninguna consulta actual depende de ellas.

### El segundo encargo: recortar los puntos de serie

**Decidido por Óscar el 30-10: todo lo que no sea necesario va fuera desde ya.**

**Medido** recorriendo los 4.395.773 puntos de los 19.278 documentos de serie. Los puntos pesan
344,8 MiB, el 81 % de la base. De eso, **160 MiB sobran**: el 46 % del peso de las series y el
38 % de la base entera.

| Qué | Peso | Por qué sobra |
|---|---:|---|
| `fx_pair`, `source_currency` | 30,4 MiB | Idénticos al campo del propio documento en el **100 %** de los 4,4 millones de puntos |
| `adjusted_close` | 33,1 MiB | Idéntico a `value` en el 100 % de las veces que aparece |
| `open`, `high`, `low`, `close`, `volume` | 96,5 MiB | **Ningún lector** en la app, en las functions ni en la plataforma |

Lo que **se queda**: `date` y `value`, que son los dos únicos campos que exige el contrato
(`price-series.v1.2`, `required: ["date","value"]`), más el valor de origen y el `fx_rate`. Ese
rastro es lo que permite demostrar de dónde sale una cifra delante de un cliente, y no se toca.

**Verificación que sostiene lo de «nadie lo lee»:** las apariciones de `adjusted_close` y `close`
que sí existen en el código (`price_history_sync.py`, `price_refresh.py`,
`coverage/seriesBuilder.ts`) leen la **fila del proveedor**, de tipo `EodhdEodPrice`, no el punto
guardado. `open`, `high`, `low` y `volume` no aparecen en ningún lector.

**A arreglar de paso:** el valor de origen viaja con tres nombres distintos según la época del
documento (`source_value` en 857.433 puntos, `source_adjusted_close` y `source_close` en 549.441
cada uno). Unificarlo en un solo nombre es parte del mismo recorte.

**Coste, y por qué esto no es un interruptor.** A diferencia de la exención de índice, esto es una
migración de esquema:

- Hay que dejar de escribirlos en `price_refresh.py`, `history_backfill.py`, `fund_ingest.py` y
  `price_history_sync.py`, y publicar un contrato nuevo que los retire.
- Hay que reescribir los 19.278 documentos existentes. Son ~19.300 escrituras, dentro de la cuota
  diaria gratuita de 20.000, pero en una sola pasada la agotan: conviene partirla en dos días o
  aceptar unos céntimos.
- **El cargador es create-only**, así que la reescritura va por `republish:fondosdb`, con la
  puerta `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` abierta, y `audit:consistency` después con la
  puerta cerrada, que es lo que exige `LEGADO_CONOCIMIENTO_SISTEMA_2026-07-12.md` §3.
- Debe fundirse con la migración ya pendiente `price_series` v1 → v1.2
  (`2-plataforma-datos/docs/historico-bdb/RUNBOOK_MIGRACION_PRICE_SERIES.md`), no hacerse aparte. Ese runbook exige
  pasada en seco real con `invalid=0` antes de producción.

**Estado: obsoleta (04-11-2026).** Apuntaba a la base vieja, y la base nueva nació con solo `date` y `value`. Preparada y sin ejecutar el 30-10.

- `2-plataforma-datos/src/migrations/trimPriceSeriesPoints.ts` — la transformación, con
  las comprobaciones que hacen que un documento dudoso quede intacto.
- `2-plataforma-datos/scripts/trimPriceSeriesPoints.ts` — el ejecutor, con las mismas
  puertas que `migratePriceSeriesV12.ts`: pasada en seco por defecto, gate explícito para
  `--write`, lotes de 400, postverify y `runs/price_series_trim_*/`.
  Comando: `npm run contracts:trim-price-series`.
- `2-plataforma-datos/tests/trimPriceSeriesPoints.test.ts` — 10 pruebas, incluidas las
  cuatro que exigen que el documento **no** se toque cuando el recorte no es demostrable.
- Escritores corregidos para no emitirlos: `seriesBuilder.ts` en la plataforma;
  `price_refresh.py`, `price_history_sync.py` y `reviewed_nav_sources.py` en la app.
- `2-plataforma-datos/docs/historico-bdb/RUNBOOK_MIGRACION_PRICE_SERIES.md` — segunda etapa del runbook
  existente, con el ensayo sobre la copia restaurada en el emulador y el aviso de
  irreversibilidad.
- Verificado: 761 pruebas y typecheck en la plataforma, 1.151 en la app. Tres pruebas de
  la app y una de la plataforma exigían la forma antigua y ahora exigen la nueva.

**Lo que falta antes de ejecutarla:** el ensayo en el emulador sobre la copia verificada,
que es lo único que convierte los 160 MiB estimados en una cifra medida y demuestra
`invalid=0` sobre documentos reales.

**Efecto combinado con la exención de índice:** el peso por activo baja de ~386 KiB a ~240 KiB de
datos. El universo objetivo pasa de 0,69 GiB a ~0,43 GiB de datos, y el techo del gigabyte
gratuito se mueve de unos 2.650 activos a unos **4.270**.

### Techo de activos

| Lo que limita | Techo | ¿Aprieta a 1.800? |
|---|---|---|
| 1 GiB de datos, hoy | ~2.650 activos | No |
| 1 GiB de datos, con el recorte de los puntos | ~4.270 activos | No |
| 1 GiB total, sin la exención de índice | ~700 activos | Ya se pasó |
| Coste de almacenamiento en Blaze | decenas de miles | No |
| 50.000 lecturas al día | varios miles | No |
| 1 MiB por documento | máximo medido 488 KiB | No |
| Tiempo de los schedulers | 540-880 s por pasada | **A vigilar** |

El único que aprieta de verdad es el último, y no cuesta dinero: cuesta frescura. **Medido:** el
refresco de precios ya trae presupuesto de lecturas (`PRICE_REFRESH_MAX_READS`, 3.600) con cursor
reanudable, y las métricas corren en cinco pasadas al día porque un ciclo completo no cabe en
una. Con 1.800 activos ese ciclo tarda proporcionalmente más, y un dato puede tardar más de un
día en refrescarse. Es diseño de planificador, no capacidad.

---

## 5. Lo que no se ha podido verificar

- **Condiciones de licencia de EODHD** para uso ante clientes y para redistribución comercial. Su
  web etiqueta los planes personales como «personal use». Decidido que se pagará lo que haga
  falta, pero el importe no se conoce: hay que preguntárselo por escrito.
- **El registro de la CNMV de IIC extranjeras comercializadas en España** como llave del universo:
  es la vía que encaja con el ámbito geográfico fijado, pero no se ha comprobado su contenido ni
  su formato. Hay que verificarlo antes de construir el catálogo sobre él.
- **El tamaño real del índice de Firestore**, por lo dicho en el §4.

---

## 6. Lo siguiente

El catálogo de datos del §1.2: qué necesita el programa para fondos y ETF, campo a campo, y de
qué fuente independiente sale cada uno, sobre el universo de activos comercializables en España.
Es el trabajo que habilita D4, D5 y D6.
