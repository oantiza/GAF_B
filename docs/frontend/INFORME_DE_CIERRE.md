# Auditoría y rediseño del frontend — Informe de cierre

*14-11-2026. Rama `auditoria-frontend`, sobre `gestor-activos-financieros`: 55 commits de trabajo, del `5393c4ef` al
`ca60c589`. **Desde el 14-11-2026 a las 12:40 la rama está fusionada en la principal y las dos están subidas a
GitHub** (`2f37b213`), por orden de Óscar, y el sitio está compilado desde ahí. **Nada se ha desplegado todavía:** el
sitio y las Functions los lanza Óscar (apartado 8, «La subida»).*

> **Después del cierre (14-11-2026): más color y los informes de antes.** Al ver el rediseño aplicado pediste
> más color, los gráficos y datos que se habían quitado y el aspecto de los informes de antes. Está hecho, y cambia
> varias cosas que este informe cuenta más abajo:
>
> - **Las pantallas** llevan ahora un color por clase de activo y por zona, aros, semáforo, frontera, matrices como
>   rejilla, y verde y rojo para lo que mejora o empeora. El apartado 4 describe la versión de una sola tinta.
> - **Los informes** siguen saliendo de una sola plantilla, pero con el aspecto del papel de cliente de antes: portada,
>   Fraunces y Roboto Flex, granate y bronce (azul acero en los internos). El apartado 5 describe la versión del filete
>   degradado.
> - **Las cifras de arriba** pasan a 6.984 pruebas en 541 ficheros y a una carga inicial de 127,2 KiB de JavaScript y
>   24,8 KiB de CSS; el recorrido sigue con todo a cero en las 68 pantallas y los cuatro anchos.
> - **El corte del solapamiento se queda en el 40 %:** lo decidiste ese mismo día.
> - **Los ETF entran en la matriz del informe de cliente** («no los dejes fuera»): se miden con la cartera completa de
>   su emisor, y el cliente ve la cifra, no de quién es la cartera. En la nube no cambia hasta que se suban esas carteras.
> - **Sortino, Calmar y la rentabilidad de los últimos 1, 3 y 5 años** están en el análisis de Carteras de clientes, como
>   pediste: se habían ido con «Análisis rápido de extractos».
>
> Las reglas nuevas están en `SISTEMA_DISENO.md`, apartado 12; cada cambio con su prueba, en `AUDITORIA.md`
> (COL-01 a COL-15); y el relato, en `PROGRESO.md`.
>
> **Dos cosas quedan fuera de esta rama:** poner al día la decisión B-79 y la frase de `AGENTS.md` sobre los datos del
> emisor, que son de Dirección; y subir a la nube las carteras del emisor, sin las cuales en producción los ETF siguen
> fuera de la matriz.

## 1. En una página

**Qué se pidió.** Dos cosas sobre la aplicación (`3-BDB-ACTIVOS_app`): un frontend sin fallos, con cada error
corregido y probado; y un frontend rediseñado y coherente, con un solo diseño de informe en dos colores.

**Qué se entrega.**

| | Al empezar (13-11-2026) | Al cerrar |
|---|---|---|
| Hallazgos | — | 253: 4 críticos, 21 altos, 128 medios y 100 bajos |
| Críticos y altos corregidos, cada uno con su prueba | — | 25 de 25 |
| Medios y bajos | — | 212 corregidos, 4 corregidos en parte, 7 justificados, 2 que ya no aplican y 3 que esperan tu decisión |
| Pruebas automáticas | 5.407 en 413 ficheros | **6.855 en 526 ficheros**, todas en verde |
| Pantallas rediseñadas | — | Todas: las seis secciones del menú |
| Informes en PDF | 15, con cuatro aspectos y una marca impresa | 13, con un solo diseño y dos temas de color, sin marca |
| Formato de cifras y de fechas | 132 funciones repartidas | Un módulo, `src/core/formato.ts` |
| Piezas comunes | 15 | 24, con su prueba y un muestrario |
| Hojas de estilo | 13.429 líneas, 22 cortes de ancho | 13.260 líneas, 13 cortes declarados |
| Carga inicial, comprimida | 122,2 KiB de JavaScript y 26,8 KiB de CSS | 127,1 KiB y 24,6 KiB (presupuesto: 130 y 45) |
| Recorrido en el navegador | 28 pantallas: 0 desbordes, 0 errores de consola, 2 reglas de accesibilidad incumplidas | 68 pantallas en cuatro anchos (1.440, 1.280, 1.024 y 768 px): 0 desbordes, 0 errores de consola, 0 reglas de accesibilidad incumplidas y 0 saltos de nivel entre encabezados |

**Lo que necesita de ti**, por orden:

1. **Subir la rama y revisarla.** *Hecho el 14-11-2026:* la miraste en local, dijiste «vamos a subirla así de momento»
   y está fusionada en la principal y subida a GitHub.
2. **Desplegar las Functions y publicar el sitio.** Son las dos órdenes del apartado 8, «La subida». De las Functions
   solo cambia `save_portfolio`: aprobaste el control que impide que dos equipos se pisen al guardar una propuesta, y
   en producción no protege hasta que se despliegue. Desplegar no se hace desde aquí: lo lanzas tú.
3. **Cinco decisiones** (apartado 7): el perfil de un borrador, los nombres repetidos de dos informes, las carteras
   retiradas, las copias de una cartera duplicada y las cuatro Functions que ya no llama nadie.
4. **Leer el texto legal del pie y de la última hoja de los informes** (`src/reports/plantilla/avisoLegal.ts`): es
   redacción nueva, común a todos, y lo firma tu nombre.
5. **Poner al día el `AGENTS.md` de la raíz y la habilidad `diseno-pantalla`**, que son de la sesión de Dirección y
   describen el menú, los informes y la dirección visual de antes (apartado 7).

## 2. Qué encontré

La auditoría se hizo sobre el commit `8da9cb9d` con tres fuentes: diez revisiones del código (una por sección, más
informes, formato y marco), un recorrido automático de 28 pantallas en tres anchos y pruebas a mano de los flujos
principales. El motor de «Carteras de clientes» se comprobó con casos calculados a mano.

**La aplicación no estaba rota.** No había desbordes ni errores de consola, y sus puertas estaban en verde. Lo que
encontré estaba en lo que esas puertas no miden:

- **Tres formas de perder trabajo en «Carteras de clientes»**: salir sin aviso con cambios sin guardar; abrir la misma
  cartera en dos pestañas, donde la última escritura borraba la otra; y una carpeta que falla a media sesión sin forma
  de rescatar lo hecho.
- **Una cifra equivocada**: un *split* en un activo sin serie de precios doblaba su valor.
- **Cifras que no coincidían** entre pantallas o entre la pantalla y el informe: el importe de una posición, la
  volatilidad de otro periodo, el VaR sobre un capital que la serie no medía.
- **La misma cifra escrita de varias maneras**: 132 funciones de formato, siete formas de decir que falta un dato,
  fechas en tres formatos dentro de una misma sección.
- **El mismo concepto con varios nombres**: «cartera», «cartera activa» y «borrador»; «rendimiento», «retorno» y
  «rentabilidad».
- **Quince informes con cuatro aspectos**, una marca impresa en diez de ellos y la firma del asesor escrita en el
  código.
- **Pantallas que lo enseñaban todo a la vez**, de hasta 6.700 píxeles de alto.

El registro completo, con dónde está cada hallazgo, cómo se reproduce y su estado, está en `AUDITORIA.md`.

## 3. Qué arreglé

**Los 4 críticos y los 21 altos**, cada uno con una prueba que falla sin el arreglo (`bb3a4255`). Los más importantes:

- «Carteras de clientes» avisa antes de perder cambios, detecta que el fichero cambió fuera de esta pestaña y no lo
  pisa, y deja descargar una copia aunque la carpeta falle.
- El *split* sin serie de precios ya no dobla el valor.
- Editar un movimiento no borra los campos que el formulario no enseña.
- «Cuentas» calcula a la fecha que dice su campo.
- El Modo cliente se aplica también en «Carteras de clientes».
- La firma de un informe es la de quien ha entrado, no un nombre escrito en el código.

**Los medios y bajos de comportamiento** (93, en `69d8d50b` y `fee50350`), cada uno con su prueba.

**Lo que salió al mirar las pantallas ya rediseñadas**, que las pruebas no veían (`59a12bcb`, `8304635b`, `c66338da`):

- Las marcas del eje de los gráficos se escribían sin sus decimales (la curva de tipos se leía «2,5 · 2,8 · 3,2 ·
  3,5 · 3,9»).
- En el Comparador, un activo sin serie hacía que el siguiente tomara su número y su color.
- En el mapa de riesgo y rentabilidad, el nombre de la cartera y el de su referencia más parecida caían uno sobre otro.
- Un gráfico dentro de una pestaña oculta dejaba un aviso en la consola.
- En «Propuestas guardadas», las acciones de cada fila se apilaban en vertical.

**Lo que salió en la fase de cierre**, al repasar el registro contra el código y medir más cosas en el navegador
(`878d36a4`, `57ac89a9`, `990a069d`, `5dcf578c`, `97e38777`, `1e3d8230`, `d0dc99c7`, `e632bb82`):

- **Una regresión del propio rediseño.** En «Planes y EPSV», la columna del nombre se quedaba con ochenta píxeles y
  cada plan ocupaba de cuatro a siete líneas: 25 planes en 3.445 px de alto, donde antes cabían 40 en 3.024. Lo
  mismo, en menor medida, en las posiciones de Análisis y en las cuentas de una cartera de cliente. Nada se
  desbordaba y ninguna prueba lo veía. Está corregido en la pieza de tabla, y el recorrido de capturas mide desde
  ahora las «tablas apretadas».
- **Un precio en peniques habría salido en libras.** El módulo único de formato pasaba a mayúsculas el código de
  divisa, y «GBp» se habría leído «GBP»: el mismo precio, cien veces más. Se vio al migrar la ficha, antes de que
  llegara a pantalla.
- **Tablas que no se alcanzaban con el teclado.** A 1.024 px, la tabla de rentabilidad por meses de una cartera de
  cliente desplaza en horizontal y no se podía enfocar.
- **A 1.024 px exactos, media pantalla era de tableta y media de escritorio**: unas hojas cortaban en 1.023 y otras
  en 1.024. Ahora cada corte de ancho se escribe de una sola manera.
- **Los títulos de los bloques saltaban un nivel** en 35 de 48 pantallas: del título de la página, de primer nivel, a
  un bloque de tercero. Es lo que encuentra quien recorre la pantalla con un lector. Ahora cada bloque es de segundo
  nivel y lo que va dentro, de tercero. No cambia nada de lo que se ve: las capturas de antes y de después del cambio
  son iguales píxel a píxel.
- **El «Informe completo» de Estrategia no se leía bien.** Sus títulos de sección salían a 9 px, más pequeños que
  el texto que encabezaban; «Riesgos de cola» iba pegado al último párrafo, y el resumen se repetía dos veces en la
  misma pantalla. Nadie había abierto esa vista: se llega pulsando, y el recorrido no la fotografiaba. Corregido.
- **Y al abrir las demás vistas que el recorrido no abría** (veinte en total: las de Estrategia, las pestañas de la
  ficha de un ETF y de una acción, la comparación de planes y las ocho pestañas de Sistema) salieron cuatro cosas
  más, todas corregidas: en «Documentos y datos» de un ETF, un valor que es una frase no se partía y se salía de la
  página; las fuentes del informe de estrategia eran enlaces demasiado pequeños para el dedo; en tableta, cada fondo
  de «Calidad de fondos» ocupaba 231 px de alto; y, por debajo de 1.440 px, una cifra larga de la banda de cifras no
  cabía en su casilla (en la ficha de una acción, «350,69 USD» tocaba la cifra de al lado). El recorrido mide desde
  ahora la letra por debajo de 12 px y las cifras que se salen de su casilla.
- **Faltaba una prueba**: «Retirar la cartera» manejaba ya su error, pero ninguna prueba lo vigilaba. Escrita al
  cierre, y comprobado que falla si se quita el arreglo.
- **Y una que viste tú al probar la rama en local** (`a62c92ad`): «Generar borrador» decía «La operación no se puede
  ejecutar en el estado actual de los datos» y nada más. En local el generador no puede trabajar, porque necesita la
  base nueva; lo que estaba mal era que la pantalla callaba el motivo que el servidor sí daba. Ahora lo dice.
- **Las pruebas salían a la red** (`770ca800`): la suite hacía 26 llamadas reales a los emuladores locales.

## 4. Qué cambié y por qué: el rediseño

Aprobaste la dirección «Informe vivo» el 13-11-2026 (`SISTEMA_DISENO.md`). Conserva el lenguaje visual que ya habías
elegido (papel cálido, índigo, serifa en los títulos) y rehace la estructura.

- **Primero la respuesta; el detalle, a un clic.** Cada pantalla abre con su cabecera y una banda con las tres a seis
  cifras que contestan la pregunta de esa pantalla. Lo demás va en pestañas, que quedan en la dirección: se pueden
  recargar, compartir y volver con «Atrás». Análisis pasa de 6.724 a 2.068 px de alto; la ficha de un fondo,
  de 3.780 a 1.339.
- **El menú separa lo que propones de lo que tiene el cliente**: Mercado · Activos · Propuestas · Clientes ·
  Planificación · Datos.
- **El color dice una sola cosa.** Verde y rojo, solo el signo de una rentabilidad o de un resultado, siempre con su
  «+» o su «−» escrito. Ocre, lo que pide tu atención o es de uso interno. Índigo, la acción y la selección.
- **Una palabra por concepto**: «Propuesta» es lo que se diseña y se guarda; «Cartera de cliente», la real;
  «Producto» dice si algo es un fondo, un ETF o una acción.
- **Un solo formato**: `+10,39 %` para una rentabilidad, `7,80 %` para un riesgo o un coste, `24,0 %` para un peso,
  `+1,25 pp` para una diferencia, `1.234,56 €`, `13/11/2026`. Lo que falta dice «Falta el dato» o «No aplica»,
  nunca «N/D» ni un cero.
- **Gráficos con papeles fijos**: la cartera, siempre índigo; la referencia, siempre gris y a trazos; cada gráfico
  lleva su tabla alternativa para quien no lo ve.
- **Piezas comunes**: campo, aviso, distintivo, respuesta, cifra, lista de partes, nota emergente, esqueleto de carga,
  pestañas y tabla, con su prueba y un muestrario (`muestrario.html`).

**Lo que cambia en lo que verás:**

- Algunas cifras se escriben distinto que antes: las rentabilidades ganan su signo y pasan a dos decimales; los pesos,
  a uno; las diferencias, a «pp» con dos decimales; las fechas, a `dd/mm/aaaa`. **Ninguna cifra cambia de valor por
  el rediseño.**
- La firma de los informes se escribe una vez («Tus datos en los informes») y se recuerda en este navegador.
- Un activo con el dato en mal estado se puede añadir a una propuesta, con el aviso «Sin datos fiables para
  medirlo» (tu decisión del 14-11). Al comprobarlo vi que el caso real era otro del que te describí: la ficha y el
  Comparador los bloqueaban y era el Buscador el que los añadía sin avisar. Ahora las tres pantallas hacen lo mismo.
- «Análisis rápido de extractos» ya no existe (tu decisión del 14-11), ni sus dos informes.
- A 1.024 px (un iPad apaisado) todo es tableta, también el contenido. Antes solo lo era el menú.
- En el resumen de Análisis, la tabla de posiciones ocupa todo el ancho y el reparto por clase va debajo. La maqueta
  los ponía lado a lado, pero con las ocho columnas de la tabla real el nombre no cabía.

## 5. Los informes

Trece documentos, todos sobre una plantilla (`src/reports/plantilla/`):

- **Un solo diseño, dos temas**: índigo para lo que se entrega al cliente («Confidencial»); ocre para lo interno («Uso
  interno»).
- **Sin marca de entidad y sin portada.** Cada hoja lleva tu nombre, tu entidad y tu logotipo, si los has escrito.
  El correo de «Compartir con cliente» de Estrategia también lo firmas tú.
- **Ningún relleno de color** (tu indicación del 13-11): la cabecera es el filete degradado que elegiste; el color va
  en filetes, en los gráficos y en el signo de las cifras.
- **«Página x de y»** en todos; las tablas largas repiten su cabecera; lo que falta se escribe en gris; ninguna letra
  baja de 6 pt.
- **Un nombre de fichero para todos**: «Informe de costes - Familia García - 2026-11-14.pdf».
- **La misma cifra, escrita igual en la frase y en la tabla.** En la comparativa de propuestas la portada decía
  «1,7 puntos más» y la tabla de al lado «+1,74 pp».

Los trece se han generado con datos de muestra y se han mirado hoja a hoja con el código final.

## 6. Decisiones que he tomado yo, para que consten

No pedían una decisión de producto, pero cambian algo que se ve. Están escritas en `SISTEMA_DISENO.md`.

| Qué | Por qué |
|---|---|
| Una diferencia entre dos porcentajes va en «pp» con dos decimales, también en una frase; la primera vez, escrita entera: «1,74 puntos porcentuales (pp)» | La misma cifra no puede escribirse de dos maneras en la misma hoja |
| El patrimonio de un fondo va siempre en millones, sin «B» | La «B» se confunde con el *billion* inglés, que son mil millones |
| El valor de la participación de un plan lleva cinco decimales, arriba y en la tabla | Salía con cuatro en un sitio y con cinco en otro |
| La cifra de una crisis pasada va en tinta, sin color, en pantalla y en papel | Es una medida de riesgo, como la caída máxima |
| En una hoja de Excel, lo que falta es una celda vacía | Con el texto «N/D», la columna dejaba de ser de números |
| La tableta llega hasta 1.024 px inclusive | Un iPad apaisado mide 1.024 y es una tableta |
| Los ficheros se llaman «Documento - De quién - fecha», con tildes | Es lo que lee bien una persona en un correo o en una carpeta |
| En el informe interno, con más de 16 posiciones la matriz de correlaciones lleva solo el tono, y al lado van las diez parejas más correlacionadas | A 3,4 pt las cifras no se leían impresas |
| El eje vertical de un gráfico lleva hasta siete marcas redondas; una línea sola lleva al final solo su valor | Se leía «2,5 · 2,8 · 3,2» y el nombre se cortaba por la mitad |
| Las notas de «aquí no hay nada» dentro de un bloque van a la izquierda | Centradas entre dos filetes parecían un error |
| Las pruebas no salen a la red | Una prueba que llama a un emulador falla según qué haya arrancado |

## 7. Qué queda pendiente

**Decisiones tuyas** (no se pueden cerrar solo con código):

| | Qué hay que decidir | Qué recomiendo |
|---|---|---|
| DIS-11 | El generador de borradores abre en el nivel 5 y, al usar un borrador, la propuesta sigue con «Perfil de riesgo: sin definir» | Que el borrador fije el nivel de la propuesta al usarlo |
| INF-15 | Hay dos documentos que se llaman «Informe de cartera» y dos «Informe de costes»: uno de la propuesta y otro de la cartera de cliente | Darles nombres distintos: «Informe de la propuesta» e «Informe de la cartera» |
| GES-13 | Una cartera de cliente retirada va a la carpeta `papelera/` y la aplicación no la enseña | Añadir «Carteras retiradas», con «Recuperar» |
| GES-14 | Dos ficheros con el mismo identificador comparten copias de seguridad (ya se avisa) | Añadir «Convertir en cartera nueva» |
| Servidor | Las Functions `analyze_real_portfolio`, `save_real_analysis`, `list_real_analyses` y `delete_real_analysis` no las llama nadie | Retirarlas del servidor y de la lista de despliegue |

**Acciones que no puedo hacer desde aquí:** desplegar las Functions (`save_portfolio`) y publicar el sitio. La rama sí
está subida y fusionada en la principal desde el 14-11-2026 (apartado 8, «La subida»).

**Lo que queda a medias, con su motivo** (el detalle, en la fila de cada uno en `AUDITORIA.md`):

- **FMT-16, el espacio antes de «%».** Toda cifra que escribe el módulo de formato lleva un espacio que no se parte
  antes de «%», «€» y «pp». Quedan unos 160 porcentajes escritos a mano dentro de frases fijas («vigilar desde 25 %»).
  No cambia ninguna cifra: solo evita que el número y su signo se separen al final de una línea. Son 40 ficheros y
  sus pruebas.
- **FMT-20, las cifras tecleadas.** Un solo lector para lo que se teclea, que dice cómo lo ha leído, en importes, en
  cifras acotadas y en Jubilación. Diez porcentajes siguen en el campo numérico del navegador, porque aplican el valor
  al teclear: pasarlos cambia cuándo se aplica, y eso es una decisión de uso.
- **MAR-21, los avisos.** Los 167 avisos escritos a mano son ya la pieza `Aviso`. Quedan 25 notas «de módulo», con
  filete y sin fondo, que se ven distinto. Están en estados que el recorrido de capturas no cubre (una importación a
  medias) y no las cambio sin verlas.
- **INF-22, la paginación del informe interno.** Dentro de cada sección ninguna hoja queda por debajo de un tercio y
  ningún título se queda solo al pie, probado con 3 y con 40 posiciones. La última hoja de tres secciones es corta,
  porque cada sección abre hoja.

**Tres tablas siguen con filas de cuatro líneas o más en los anchos estrechos.** Las tres llevan el nombre a 200 px o
más y desplazan dentro de su marco: el Buscador en tableta (98 px por fila, por sus dos botones apilados), las
posiciones de Análisis a 768 px (114 px) y «Calidad de fondos» de Sistema por debajo de 1.440 px (de 100 a 120 px,
donde eran 231).

**Lo que no he podido comprobar:** el modo de contraste forzado de Windows y un lector de pantalla de verdad (las
reglas están escritas y probadas en la hoja, pero no las he visto funcionar); el diálogo del sistema para elegir
carpeta; y la aplicación publicada con sesión real.

**El `AGENTS.md` de la raíz y la habilidad `diseno-pantalla`**, que no son mi territorio, siguen diciendo cosas que
ya no son verdad:

- Que los PDF «conservan sus dos identidades de papel» (Fraunces y Roboto Flex; Newsreader e Instrument Sans): hoy hay
  una plantilla con dos temas y las dos familias de la pantalla, y los informes sí siguen al sistema.
- Que «la pantalla anterior de Rendimiento sigue dentro, como “Análisis rápido de extractos”»: se retiró.
- La habilidad `diseno-pantalla` describe la dirección del 02-11 y sus cinco principios («todo a la vista, nada se
  despliega»); la que gobierna es `docs/frontend/SISTEMA_DISENO.md`, que dice lo contrario en ese punto.

## 8. Cómo comprobarlo

Desde `3-BDB-ACTIVOS_app`:

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run lint
```

```bash
node scripts/deadCssD3.mjs
```

```bash
npm run build
```

- **Las pantallas:** `docs/frontend/capturas/antes/` y `docs/frontend/capturas/despues/` (a 1.440 y 768 px), con el
  informe de cada recorrido (`informe.md`: desbordes, consola, peticiones, accesibilidad, tablas apretadas, saltos de
  encabezado, letra por debajo de 12 px y cifras que no caben en su casilla). Las medidas a 1.280 y 1.024 px están en
  `capturas/despues/informe-1280-1024.md`, sin sus capturas.
- **La aplicación de esta rama:** `http://localhost:5194` en este equipo, con el usuario local del emulador, que no es
  el de la aplicación publicada. `npm run seed:emulator-user`, desde `3-BDB-ACTIVOS_app`, lo crea si falta y enseña
  su correo y su contraseña.
- **Las piezas:** con la aplicación en marcha, `muestrario.html`.
- **Cada hallazgo:** su fila en `AUDITORIA.md` dice el commit y la prueba que lo vigila.
- **Los informes:** `INFORMES_PDF=<carpeta> npx vitest run tests/informesDeClienteEnLaPlantilla.test.ts
  tests/gestor/informesPlantilla.test.ts` deja los PDF en esa carpeta.

### La subida (14-11-2026)

Óscar miró la rama en local y dijo «vamos a subirla así de momento»; a la pregunta de si también a producción,
«Sí, prepáralo tú». Lo hecho, por este orden:

1. **Puertas sobre `ca60c589`**, el último commit de trabajo: tipos y lint sin errores, 6.984 pruebas en 541 ficheros,
   censo de CSS en cero, compilación y presupuesto inicial (127,2 KiB de JavaScript y 24,8 KiB de CSS). En el servidor,
   las 2.304 pruebas de Python y las dos de DIS-03 contra el emulador de Firestore.
2. **Recorrido de las 68 pantallas en los cuatro anchos:** 0 desbordes, 0 reglas de accesibilidad incumplidas, 0 saltos
   de encabezado, 0 letra pequeña y 0 cifras fuera de su casilla. Trece pantallas apuntaron una petición con error 429:
   es el limitador de llamadas del servidor local, que saltó porque se lanzaron dos recorridos a la vez con el mismo
   usuario; repasadas a solas, las trece dan 0.
3. **La rama trajo lo que la principal tenía de más** (`be1327c2`, un apunte de coordinación) en `2f37b213`, y **la
   principal avanzó en directo** hasta ahí, sin conflictos. Las dos, subidas a GitHub.
4. **El sitio, compilado** desde `2f37b213` con `node 4-base-nueva/compilar-sitio.mjs` (12:42; `index-BpOlQFBT.js` e
   `index-BtjuxEbn.css`). Abierto en un navegador sin ventana desde la carpeta compilada, enseña el acceso con 0 errores
   de consola y sin ficheros que falten. `probar-puerta.mjs` pasa.
5. **El guardado de propuestas, probado en local contra el servidor nuevo.** El emulador de Functions lee la carpeta
   principal, así que hasta el avance servía el código de antes. Después: guardar dos veces seguidas desde la pantalla;
   el rechazo del servidor cuando la guardada cambió o se eliminó (`PORTFOLIO_CONFLICT`, sin escribir nada); una
   pantalla anterior al control, que guarda como siempre; y el aviso en pantalla cuando «otro equipo» cambia la
   propuesta abierta. La propuesta de prueba se borró.

**Lo que queda, y lo lanza Óscar.** El orden da igual: el servidor solo aplica el control nuevo cuando la aplicación le
manda la fecha que esperaba, así que cada mitad funciona con la otra sin desplegar.

```bash
cd C:\Users\oanti\Proyectos\Gestor-Activos-Financieros\3-BDB-ACTIVOS_app; node scripts/desplegarFunciones.mjs --despliega
```

```bash
cd C:\Users\oanti\Proyectos\Gestor-Activos-Financieros\4-base-nueva; firebase deploy --only hosting
```

La primera despliega la lista de siempre, 34 funciones, de las que solo cambia `save_portfolio`; su ensayo en seco, sin
`--despliega`, da «comprobaciones: todas bien». La segunda publica la carpeta compilada. Las reglas de Firestore no
cambian con esta rama, así que no hace falta desplegarlas. Hasta entonces la web sirve la compilación del 13-11
(`index-C9m7N-2e.js`).

**Si hay que volver a compilar**, por un commit nuevo en la principal: `node 4-base-nueva/compilar-sitio.mjs` desde la
carpeta principal. Compila su último commit, no lo que esté a medias.

**En la carpeta principal** la rama añade una dependencia de desarrollo, `axe-core`, que solo usa
`scripts/auditoriaFrontend.mjs`: para lanzar ese guion allí hace falta `npm install` en `3-BDB-ACTIVOS_app`. Las pruebas
y la compilación no la necesitan.

## 9. Mejoras que sugiero y no he hecho

Por orden de lo que creo que más te sirve:

1. **Un solo diálogo para pedir un informe.** Hoy cada documento tiene el suyo, con campos casi iguales.
2. **Una prueba visual automática.** Las regresiones de aspecto que he encontrado las vi mirando capturas. Un
   recorrido que compare cada pantalla con su captura aprobada las habría visto solo.
3. **Pasar a la tabla común las cuarenta tablas escritas a mano** (MAR-13): ya se ven igual en la cabecera, pero no
   ordenan ni paginan.
4. **La carga de la primera visita** (DIR-11): Diseño descarga 612 KiB la primera vez, de los que 186 son la
   biblioteca de Firebase entera. Usar solo sus partes necesarias la reduciría.
5. **Los diez porcentajes que aún se teclean en un campo numérico del navegador** (FMT-20): pasarlos al campo que dice
   cómo ha leído la cifra pide decidir cuándo se aplica el valor, al teclear o al salir.
6. **Las 25 notas «de módulo»** (MAR-21), con filete y sin fondo, que conviven con la pieza de aviso.
7. **La paginación del informe interno** (INF-22): cada sección abre hoja, y tres de ellas dejan una última hoja
   corta.
