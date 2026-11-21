---
name: diseno-pantalla
description: El sistema visual vigente de la aplicación —la dirección A, «Banca privada, puesta al día» (17 y 18-11-2026), sobre la estructura aprobada el 13-11-2026— y las piezas con las que se construye. Úsalo SIEMPRE antes de tocar algo que se vea en pantalla — un componente React, una hoja de estilo, un token, una cabecera, una tabla, un gráfico, un estado vacío o un texto de interfaz — y también antes de crear un componente nuevo, mover un bloque o cambiar un color, un tamaño o un espaciado. Lleva qué documento manda, lo que una sesión no decide por su cuenta, el aspecto de hoy, las piezas obligatorias, las trampas que ya han roto cosas y las puertas que todo cambio visible debe pasar. No gobierna los PDF de informes, que son otro medio. Si dudas de si aplica, aplica.
---

# Diseño de pantalla

Herramienta de banca privada que un asesor usa **delante del cliente**: densidad
profesional, jerarquía inequívoca, cero jerga interna en pantalla. Escritorio y tablet,
**ancho mínimo 768 px** (`--app-min-width`); no hay versión de móvil y no es un defecto.

## Lo que gobierna, y lo que no

| Documento | Papel |
|---|---|
| `docs/frontend/SISTEMA_DISENO.md` (raíz) | **Manda.** Está escrito por capas, y hay que saber cuál pisa a cuál: en todo lo que es aspecto, el apartado **14** (la dirección A, 17 y 18-11-2026) manda sobre el 12 y el 13; el 13 (15-11), sobre el 2 y el 4 y, en los valores de color, sobre el 12; el 12 (14-11), sobre el 0, el 4, el 7 y el 8. Los apartados 0, 2, 4 y 7 conservan valores que ya no se pintan (índigo, serifa en los títulos de bloque, radios de 3 px): antes de copiar un valor de ahí, compruébalo en `tokens.css` |
| `3-BDB-ACTIVOS_app/src/styles/tokens.css` | Los valores de hoy. Su espejo para los gráficos es `src/core/theme.ts`. El `README.md` de esa carpeta dice qué lleva cada hoja |
| Las láminas de la dirección A | Quince pantallas y una hoja de fundamentos, dibujadas. Viven fuera del repositorio, en un lienzo: <https://claude.ai/artifact/Aez3VBxrojcsLgG6r4aREt>. Valen por el aspecto; lo que dibujan de más son propuestas sin decidir |
| `DIRECCION_ELEGIDA_2026-11-02.md` y `LA_HOJA_DE_7902_2026-11-03.md` (en `3-BDB-ACTIVOS_app/docs/rediseno-2026-11/`); `docs/frontend/PROGRESO.md`, `INFORME_DE_CIERRE.md` y `AUDITORIA.md` | Registro de rediseños anteriores. No gobiernan el aspecto, y nombran colores de entonces («la cartera, siempre índigo») |
| `3-BDB-ACTIVOS_app/docs/SISTEMA_VISUAL_RETIRADO_2026-11-02.md`, `3-BDB-ACTIVOS_app/GUIA_DE_DISENO_OAA.md` y la habilidad `diseno-oaa` (`3-BDB-ACTIVOS_app/.agents/`, fuera del repositorio) | **No gobiernan nada.** Si algo los cita, está citando la guía descartada |

**Hay dos «A» y no son la misma.** La «A + B» del 02-11-2026 (`DIRECCION_ELEGIDA`) fue
otra elección, para la ficha de un fondo. Cuando el sistema, un commit o una conversación
dicen «la dirección A» a secas, es la del 17-11-2026.

**Los comentarios del código se pusieron al día el 19-11-2026.** Setenta y tres describían
aspectos anteriores —entre ellos las cabeceras de `Panel.tsx`, `PageHeader.tsx`,
`Ausencia.tsx` y `Distintivo.tsx`, y los que daban a la serifa solo dos usos—: 59 se
corrigieron y 14, que hablaban de piezas que ya no existen, se quitaron (apartado 14.6 del
sistema, con la cuenta). Se dejaron como estaban los que son registro con su fecha: cuentan
cómo era entonces. La regla no cambia: donde un comentario y la hoja de estilo discrepen,
manda la hoja.

## Lo que una sesión no decide por su cuenta

Si el encargo es de Óscar —dicho por él, o citado con su fecha por quien te lo da—, lo que
pide ya está decidido: constrúyelo, y avísale de lo que choque con otra regla suya. Lo que
esta lista prohíbe es resolver una de estas cosas por el camino de otro cambio, o copiarla
de una lámina: eso es tomar en silencio una decisión de producto.

- **Lo que las láminas dibujan y cambia la estructura, el contenido o la función:** la
  búsqueda rápida y el menú de cuenta de la barra superior, tablas reagrupadas, cifras
  nuevas, iconos en los botones. Esas propuestas están en las notas del lienzo (su página
  «Qué cambia y qué decides»; se lee con la herramienta Artifact) y en el apartado 14.1.
  Antes de construir una, mira si sigue pendiente; si lo está y te parece buena,
  propónsela a Óscar con la lámina al lado, y no la construyas.
- **Lo que la revisión vio y no tocó**, en el apartado 14.1, al final del 14.2 y en «Visto
  de paso y sin tocar» del 14.7 del sistema. Antes de «arreglar» algo de una pantalla, mira
  si está ahí. Lo principal: el
  color de la línea de referencia; el rótulo de un campo, que cambia todos los campos; en
  Comparador › Patrimonial, el importe de ocho cifras, o de
  siete con signo, que se parte; en el Comparador, el número y el color de cada activo, y
  si las rentabilidades de
  la tabla comparada van en verde y rojo; en Diseño › Simular, la palabra junto a la
  «Diferencia»; «YTD» frente a «En el año»; el ancho de lectura a 2.560 px; paginar o no
  las retrocesiones de Sistema; y lo que la migración dejó a propósito distinto de la vista
  previa. Es solo una parte de lo que la revisión dejó fuera por depender de una decisión:
  lo demás no consta en el repositorio.
- **Un color nuevo** de clase, de serie o de zona, y **llevar `abierta` a otra pantalla**
  (ver «Las piezas»).
- **Cualquier cambio en un informe en PDF.**

## El aspecto de hoy: la dirección A

No hay selector de aspecto ni un segundo diseño. El aspecto se decide en los tokens:
cambiarlo es cambiar `tokens.css` y su espejo, no cada pantalla.

- **Fondo y tarjeta.** Lienzo marfil (`--lienzo`) y, sobre él, cada bloque en una tarjeta
  blanca (`--papel`) con borde `--filete`, esquina `--radio-bloque` y una sombra mínima
  (`--sombra-tarjeta`). Un panel dentro de otro, o dentro de un diálogo, no se pinta como
  tarjeta: va sin borde ni sombra propios.
- **Marca y marco.** Marino (`--marca`) en el botón principal y en lo elegido; el enlace y
  el anillo de foco, en el azul `--marca-fuerte`. El menú es marino (`--marco`), con la
  entrada activa a sangre y un filete de latón; la barra superior va sobre el marfil. El
  latón (`--laton`) es trazo o relleno, nunca texto; el latón claro (`--laton-claro`) sí se
  lee, y solo sobre el marino del menú: el icono de la entrada activa y el rótulo de su
  grupo.
- **Letra.** IBM Plex Sans en todo (`--fuente`, `--fuente-titulos`) e IBM Plex Mono en el
  ISIN y los tickers (`--fuente-codigo`); el código de una divisa va en la letra del texto.
  La serifa (`--fuente-serifa`, Source Serif 4 seminegrita) es solo de lo que titula o
  contesta una pantalla, y estos son todos sus usos: el título de pantalla (`--titulo-lg`);
  la cifra de un indicador (`--cifra-indicador`), que es también la fecha de cada proceso
  en Sistema; la cifra principal de la respuesta y la de Jubilación (`--cifra-xl`); el
  título de la tarjeta de acceso; y, en el menú, el nombre de la casa y su monograma.
  **Nunca** el título de un bloque (`.panel__title` va en Plex, a `--texto-ml`), una tabla
  ni un gráfico.
- **Tamaños.** Once en la escala, todos en tokens: 12 (`--texto-xxs`, el menor), 13
  (`--texto-xs`), 14 (`--texto-sm` y `--texto-md`: el texto y la celda de tabla), 15
  (`--texto-ml`), 17, 18, 22, 30, 32, 40 y 44 px. Ojo con el nombre: `--texto-xs` son
  13 px, no el menor.
- **Geometría.** Control 5 px, tarjeta 6, pieza de dentro de una tarjeta 5, lo que flota
  8, distintivo 3 (una etiqueta, no una pastilla). La pastilla queda solo para los
  interruptores; filas, barras y filetes, rectos.
- **Color con significado, el mismo en toda la aplicación.** Verde `--sube` y rojo `--baja`
  para el signo de un resultado y para «a favor» o «en contra», siempre con su signo o su
  palabra; ocre `--aviso` para lo que pide la atención del asesor; cada clase de activo, su
  color (`--clase-*`, espejo `CLASS_COLORS`; se reparte con `colorDeLaClase`, de
  `src/core/coloresDeClase.ts`); cada zona del mapa, el suyo, con cuatro intensidades según
  el peso (`ZONE_RAMPS`, en `src/core/regionTaxonomy.ts`). El resto de un reparto va en
  `--clase-resto`, que es solo relleno y lleva su nombre al lado.
- **Gráficos.** La cartera es siempre `--serie-1` (marino); la referencia,
  `--serie-referencia`, a trazos y fuera de la paleta; las demás series, `--serie-2` a
  `--serie-6`, en orden fijo. El color sigue al papel de la serie, no a su posición. Las
  matrices van en la rampa `--rampa-0` a `--rampa-7`.

**Cambiar un color es cambiarlo en más de un sitio.** `tokens.css` y `src/core/theme.ts`
a la vez: Recharts no resuelve `var()` en todos los atributos, y
`tests/themeTokensMirror.test.ts` falla si discrepan. Los colores de clase y las series 2 a 6
(renta variable, renta fija, alternativos, mixto y activos reales) llevan hoy los mismos
valores, pero son tokens distintos y ninguna prueba los ata: cambiar una clase no mueve su
serie. Mantenerlos iguales o separarlos lo decide Óscar. `ZONE_RAMPS` y la sombra de
`src/charts/oaa/chartTheme.ts` no son tokens: no se mueven solos. Y `--sube`, `--baja` y
los colores de renta fija, renta variable y liquidez están copiados en el papel de los
informes (`src/reports/plantilla/tema.ts`): al cambiarlos, `tests/plantilla/tema.test.ts`
falla a propósito, y qué hacer entonces está en el apartado 14.3 del sistema.

### Un color nuevo se mide antes de enseñarlo

De clase, de serie o de zona. Se mide con el validador de la habilidad `dataviz`
(`scripts/validate_palette.js`; es una habilidad de fuera de este repositorio) y contra
tres cosas: los demás de su paleta, todos contra todos; los colores con significado de la
pantalla (`--aviso`, `--aviso-enfasis`, `--baja`, `--sube`, el azul de enlace
`--marca-fuerte`, el marino de la cartera y la tinta); y, si va a un informe, lo que tiene
al lado en la hoja y el 3:1 que el papel se exige. La paleta de la dirección A es apagada y
no llega a todos los listones del validador: se aceptó a sabiendas, con cada color
acompañado siempre de su nombre (apartado 14). **Ninguna prueba mide la distancia entre dos
colores**, ni en visión normal ni con daltonismo: la suite fija los valores, el contraste
del texto y un suelo de luminancia entre el gris del resto y el de la liquidez.

## Las reglas de estructura

No las cambia ningún aspecto. Son, en lo esencial, las del sistema aprobado el 13-11-2026;
la revisión del 18-11 (apartado 14.2) concretó la 8 y la 10.

1. **La respuesta primero; el detalle, a un clic.** Toda pantalla se monta en el mismo
   orden: cabecera (`PageHeader`), la banda de tres a seis cifras que contesta su pregunta
   (`Respuesta`; como mucho una en grande, y puede no haber ninguna), pestañas cuando hay
   más de tres bloques (`SegmentedTabs`, con la pestaña en la dirección:
   `usePestanaEnLaDireccion`), bloques (`Panel`) y notas al pie.
2. **Nada se afirma sin decir quién lo dice y desde cuándo.** La procedencia va pegada bajo
   el título (`subtitulo` de `Panel`), no en un pie ni mezclada con el estado. Un gráfico
   dice de dónde sale y de cuándo es.
3. **El color solo dice cosas**, y siempre con su signo o su palabra al lado: un estado no
   se dice nunca solo con color. Un peso, una volatilidad, una caída o un coste sueltos no
   llevan color.
4. **Una sola manera de escribir cada cifra** (`src/core/formato.ts` y la tabla del
   apartado 6: `+10,39 %`, `24,0 %`, `1.234,56 €`, `13/11/2026`, «pp», el signo menos
   tipográfico) y **una palabra por concepto** (el glosario de
   `src/core/glosarioDePantalla.ts`, decisión A-28).
5. **Lo que no está, se dice.** Ver «La regla del dato que falta».
6. **Los títulos bajan de uno en uno:** `h1` la pantalla, `h2` el bloque, `h3` lo de dentro
   de un bloque; el título de un diálogo es `h2`. Lo decide la pieza, no la pantalla.
7. **Ninguna letra a la vista baja de 12 px** (`--texto-xxs`), tampoco en el menú: la
   lámina dibuja a 11 su rótulo de grupo y Óscar lo subió a 12 el 19-11-2026 (apartado
   14.4). `tests/hojasDelMarco.test.ts` lo vigila en los tokens, y exige que todo tamaño de
   letra de las hojas sea una variable de 12 px o más o una de las ocho excepciones que
   declara. Seis de ellas son relativas al texto en que van y pueden pintar por debajo de
   12: lo ya pintado lo mide el recorrido de la auditoría.
8. **Una cifra no se parte, no se recorta y cabe en su casilla.** Entre un número y su
   unidad va un espacio duro. Si no cabe, se ensancha la columna o mengua la cifra; nunca
   puntos suspensivos. Una frase sí se parte.
9. **Un gráfico, solo si explica algo; y un reparto se dibuja:** aros y barras de parte
   (`ListaDePartes`), con el color de su categoría cuando la parte es una clase o una zona;
   una matriz es una rejilla de casillas de color. Sigue prohibida la barra que repite la
   cifra que tiene al lado. Un solo eje por gráfico.
10. **Dentro de una tarjeta, lo que separa las filas es un filete** (`--filete-fila`), sin
    fondo alterno. La fila elegida va en `--banda-fuerte`.
11. **Una tabla que no cabe se desplaza dentro de su marco**, no parte cada celda en diez
    líneas; una lista larga enseña 25 filas y pagina. Lo que hace falta para leer una fila
    no se esconde en un desplegable.
12. **El nombre accesible de un control empieza por lo que se lee en él** («Añadir a la
    propuesta: Amundi Funds…»): quien usa la voz dicta lo que ve.

Si algo cita un «principio» del 02-11: el 1 es hoy la regla 2; el 2 («Ni una barra»), la
9; el 3, la 10; el 4 (las secciones en columnas) no lo recoge el sistema; y del 5 («Todo a
la vista») queda la regla 11.

## La regla que no se rompe: la cabecera no se escribe a mano

**Existen las piezas. Úsalas.** La cabecera de una pantalla la monta `PageHeader`
(antetítulo en versalitas, título en serifa y doble filete de tinta y latón). La de cada
bloque, `Panel` (`src/components/ui/Panel.tsx`): antetítulo, título con su nivel y su
`id`, procedencia, estado, acciones y cuerpo.

```tsx
<Panel
  claseDelCuerpo="stack stack--tight"   // casi siempre
  rotulo="Riesgo y rentabilidad"        // antetítulo, opcional
  subtitulo={`Histórico observado · 3 años · ${cobertura} del peso`}  // LA PROCEDENCIA
  estado={<Distintivo tono="aviso">Datos parciales</Distintivo>}      // un recuento, un aviso
  acciones={<Button size="sm">Refrescar</Button>}
  titulo="Métricas de la cartera"
  tituloId="report-metrics-title"       // se genera solo si no se da
>
```

El título es `h2`; dentro de otro bloque o de un diálogo lleva `nivel={3}`. Un detalle
largo puede ir `plegable` (con `abiertoAlEmpezar` si debe empezar abierto). Ninguna
pantalla escribe ya `.panel__head` ni `.panel__title` a mano, y los dialectos antiguos
(`.report-section-heading`, `.admin-panel__title`, `.system-section-heading`) están
borrados: que siga así.

## Las piezas

En `src/components/ui/` y `src/components/tabla/`. Lo que hace una pieza no se escribe a
mano. Casi todas tienen su prueba (`tests/piezas/` y `tests/`), y hay un muestrario de las
de `ui/` (`muestrario.html`, solo con el servidor de desarrollo).

| Pieza | Para qué | Lo que hay que saber |
|---|---|---|
| `PageHeader` | La cabecera de la pantalla | `eyebrow`, `title`, `estado`, `description`, `actions`: una acción principal, hasta dos secundarias y el resto en «Más». Con `level="section"`, la de una subvista: `h2`, sin antetítulo, sin serifa y sin doble filete |
| `Respuesta` | La banda de cifras que contesta la pantalla | `etiqueta` y `datos` (`rotulo`, `cifra`, `apunte`, `principal`). En Análisis, la Ficha y la Salud del catálogo, bajo la cabecera, va con `abierta`: sin caja y pegada al doble filete (apartado 14.2); lo que cada una lleva además —el rótulo, el reparto a 768 px— está en su hoja, así que «como la de Análisis» es `abierta` más esas reglas. Las demás conservan la suya; llevar `abierta` a otra pantalla lo decide Óscar. `KpiStrip` es la pieza anterior y sigue donde ya está; una tira de importes en euros lleva `importes`, para que un importe de siete cifras no se parta |
| `Panel` | Un bloque | Ver arriba |
| `Cifra` | Escribir una cifra | `tipo` (`importe`, `rentabilidad`, `porcentaje`, `peso`, `ratio`, `precio`…), `valor` y `ausencia`: formato, color de signo y dato que falta salen del mismo sitio |
| `Ausencia` | Decir que un dato no está | `clase`: `falta`, `no-aplica` o `sin-pedir` |
| `Aviso` | Lo que el asesor debe saber | `tono`: `aviso`, `nota` o `error`. Ponle su palabra en `titulo`: sin ella solo la oyen los lectores de pantalla. La clase `notice` escrita a mano ya no existe; quedan notas «de módulo», que son deuda conocida y no se multiplican |
| `Distintivo` | Una etiqueta corta de estado | `tono`: `neutro`, `marca`, `interno`, `aviso`, `favorable` o `desfavorable`. «Interno» es neutro, en versalitas, y marca lo que solo ve el asesor y se oculta en Modo cliente; el ocre es solo de `aviso`. Antes de escribir una palabra de estado nueva, busca en el código la que ya dice lo mismo |
| `Button` y `MenuButton` | Una acción y las secundarias | `variant` (`primary`, `secondary`, `quiet`, `danger`), `size`, `busy` |
| `Campo` | El rótulo, la pista y el error de un control | Envuelve un solo control (un `input`, un `select`, un `EuroAmountInput`). Un rótulo escrito a mano no nombra a su control. `FileUploadField` trae su propio rótulo |
| `SegmentedControl` · `SegmentedTabs` con `PanelDePestana` | Elegir un modo · repartir una pantalla en pestañas | Las pestañas y su panel llevan el mismo `idPrefix` |
| `ModalDialog` con `DialogHeader`, `DialogBody` y `DialogFooter` · `useConfirm` | Pedir datos · confirmar | El título de un diálogo es `h2` y su antetítulo va en versalitas |
| `useMensaje` | Confirmar que algo se ha hecho («Guardado») | La región `<Mensajes />` ya está montada, una vez, en `src/App.tsx` |
| `NotaEmergente` | Explicar un término | En vez de `title=`, que no funciona con el teclado ni en una tablet |
| `LoadingState`, `Esqueleto` · `EmptyState` · `AsyncErrorBanner` | La carga · el vacío · el fallo de una carga | `EmptyState` es el vacío de una página o de una pestaña entera, centrado y con su acción; el vacío de dentro de un bloque no es pieza: es la nota `.empty-inline`, a la izquierda. `AsyncErrorBanner` (en `src/components/`) dice la causa y ofrece «Reintentar» |
| `ClaseConColor`, `ListaDePartes`, `EnlaceAFicha` | El punto de color de una clase · las partes de un todo, con su barra · el enlace a la ficha de un activo | |
| `TablaDeDatos` | Toda tabla de cifras | Ordena de verdad, con lo ausente siempre al final y nunca contado como el valor más bajo. Una columna se declara `nombre` o `prosa` para que no se quede sin sitio, y lleva `tituloCompleto` si su título va abreviado. `porPagina` pagina, de 25 en 25. Si sus filas son activos o carteras, `deActivos`: el ISIN en Plex Mono y la fila centrada en vertical. Las cifras van en el peso de su fila: la negrita queda para el pie de totales y la cabecera. Para una tabla ancha trae `soloAncho` (la columna no se pinta por debajo de 1.440 px, y lo que dice baja a `apunteEstrecho`) y `cabeceraFija`. Fijar la columna del nombre o la de la acción no lo hace la pieza: lo hacen las hojas del Buscador y de Planes; lo que sí hace ella sola es dejar a la vista lo que el teclado enfoca bajo una columna fija (`focoBajoColumnaFija.ts`) |
| `TablaComparativa`, `PlanoRiesgoRetorno` | Comparar activos | Dicen lo que no es comparable entre métodos, en vez de mezclarlo |

## Las trampas que ya han roto cosas

1. **Una expresión JSX dentro de una cadena no falla: se imprime.** `titulo="… {periodo}
   …"` compila, pasa el typecheck, pasa el lint y pinta las llaves en pantalla. Pasa al
   mover texto de un `<p>`, donde `{x}` **es** una expresión, a una propiedad, donde no lo
   es. Lo vigila
   `tests/textoConExpresion.test.ts`, pero solo en una lista de atributos (`titulo`,
   `subtitulo`, `rotulo`, `estado`, `label`, `title`, `placeholder`, `description` y pocos
   más) escritos con comillas dobles.
2. **Un título que es un `<p>` no es un título.** Su sección no sale en el esquema del
   documento. La pieza lo impide. Que una pantalla no salte de nivel lo prueban
   `tests/nivelesDeEncabezado.test.tsx` y las pruebas de algunas pantallas más (la Ficha,
   Análisis, Diseño, Informes, Carteras de clientes), no las de todas: donde no hay prueba,
   solo lo mide el recorrido de la auditoría.
3. **Un `aria-label` no es el título de un bloque.** Un `Panel` cuyo nombre existe solo
   para los lectores de pantalla tiene un título que alguien decidió no enseñar: sácalo. No
   va por un grupo que no lleva título a la vista, como la banda `Respuesta`, que se nombra
   con `etiqueta`. No lo vigila nada.
4. **El relleno de caja sobrevive a la caja.** Dentro de una tarjeta, lo de dentro no es
   otra caja: `padding: var(--s-6)` sobre algo sin borde ni fondo es herencia de un sistema
   retirado. El aire entre hermanos lo pone el `gap` del `stack`, no el relleno de cada
   hijo.
5. **Un envoltorio de tabla que no acota no es un envoltorio.** Toda tabla ancha necesita
   `overflow-x: auto` y `min-width: 0` **en su propia pieza** (`.tabla__marco`), no en la
   pantalla que la usa. A 768 px, dos clases que se llamaban envoltorio empujaban la página
   53 y 425 px. Y un envoltorio que se desplaza de lado tiene que poder alcanzarse con el
   teclado: o se enfoca él, como ese marco —`role="group"`, un nombre que diga que se
   desplaza («(tabla desplazable)»; una matriz, «(matriz desplazable)») y `tabIndex={0}`—, o
   lleva siempre dentro algo que se enfoca y llega a su borde derecho, como la tabla de
   posiciones de Diseño. El 19-11-2026 diecisiete escritos a mano no se enfocaban ni llevaban
   nombre; varios llevan controles dentro, y no se midió si el teclado llegaba a ellos
   (apartado 14.7 del sistema). `tests/cajasDesplazablesConTeclado.test.ts` saca de las hojas
   toda clase con desplazamiento propio y exige declararla en una de cuatro listas, con su
   razón: una caja nueva con `overflow: auto` obliga a decidir. Seis `.table-wrap` de antes
   son regiones (`role="region"`) con el nombre de su tabla, y se quedan así.
6. **Tres maneras de pintar un dato falso que compilan y pasan las pruebas** (las tres, del
   18-11-2026): una cifra recortada con puntos suspensivos («Previsión 160.700…»: regla 8);
   una celda en blanco, que se lee como un cero (las tablas de Carteras de clientes; hoy
   tienen prueba, las demás dependen de quien las escriba); y una magnitud pintada como
   llega («−0,90T»: un *trillion* inglés es un millón de millones, y se escribe
   «−900.000 M»). Solo se ven en el navegador: quien toque el ancho de una columna de
   cifras lo mira en los seis anchos.
7. **«Ya pasaba» se dice después de medirlo en la rama principal, no antes.** El 18-11-2026
   se dio por anterior al rediseño un importe partido en dos líneas que el rediseño había
   traído, por 0,2 px. Y una sonda que cambia un texto en la página tiene que conservar los
   caracteres de la aplicación: los importes llevan un espacio duro, y con uno normal la
   línea se parte donde en la aplicación no se parte.
8. **Un color medido solo contra su paleta.** El 18-11-2026 se propuso para una clase una
   teja oscura que quedaba a un paso del ocre de los avisos: un punto de esa clase se
   habría leído como un aviso. Ver «Un color nuevo se mide antes de enseñarlo».
9. **Los seis anchos no enseñan el menú compacto.** Entre 1.025 y 1.239 px el menú mide 224
   px y no 248, y ninguno de los seis anchos de trabajo cae en ese tramo, en el que están
   también los cortes de 1.100 y 1.180. El 19-11-2026, al subir un rótulo de 11 a 12 px,
   «PRIVATE BANKERS» se cortaba con puntos suspensivos solo en ese menú, y la foto de 1.440
   no lo enseñaba. Lo que toque el marco se mira también a 1.100 px. Y ahí el contenido es
   más estrecho que en tableta: a 1.025 px le quedan 127 px menos que a 1.024, porque el
   menú pasa de 96 a 224 px. Lo que cambia de disposición «hasta 1.024» puede quedarse sin
   sitio justo encima: le pasaba al calendario de Mercado, que desde el 19-11-2026 decide
   por el ancho de su lista y no por el de la ventana (apartado 14.5). Desde ese día las
   dos herramientas tienen una pasada para ese tramo (`estrecha`, en «La batería visual»).

## La regla del dato que falta

Manda sobre cualquier consideración estética: **si una cifra no está, se dice que no
está.** Un cero creíble es peor que un error; un cero que sí está en el dato se escribe.
Un dato que *no aplica* y un dato que *falta* no se pintan igual, y por eso hay pieza:
`<Ausencia clase="no-aplica" />`, «No aplica», gris en cursiva, para la casilla cerrada;
`clase="falta"`, «Falta el dato», en el ocre de aviso, para el hueco real;
`clase="sin-pedir"`, solo si se ha leído la calidad del instrumento, que hoy es la ficha.

Una cifra que puede faltar se escribe con `<Cifra tipo=… valor=… />`, que ya decide el
formato, el color del signo y la ausencia. En una tabla, la celda lleva `ausencia`. Quien
compone sin pintar —una celda, una fila de ficha, un informe— tiene los mismos textos en
`textoDeAusencia` (`src/core/textoDeAusencia.ts`) y en `oFalta` (`src/core/formato.ts`).
**«N/D» no lo escribe ninguna cifra ni ninguna celda**: no hay más módulo de formato que
`src/core/formato.ts`. Queda un resto: `src/core/portfolio.ts` llama «N/D» al tramo de un
reparto por divisa o por región cuando la posición no la trae (`CLAVE_SIN_DATO_DEL_REPARTO`).
Es una clave, no un texto: en pantalla la dice la pieza —`FilasDeReparto` con
`claveDeLoQueFalta`, apartado 14.9 del sistema—, y solo el informe interno, que es papel, la
imprime tal cual; eso último es un defecto, no una convención, y cambiarlo es decisión de
Óscar. En una hoja de Excel, lo que falta es una celda vacía.

**En Carteras de clientes, una posición sin precio es esta regla entera** (decisión A-193,
apartado 14.10 del sistema). Sus cifras dicen «Falta el dato». Un total que la deja fuera lo
dice: «No incluye X, que no tiene precio.». Y una cifra de la cartera que la cuenta como cero
—las que salen de la serie diaria del valor: el resultado, las rentabilidades, el riesgo—
también: «Cuenta X como cero, porque no tiene precio.». Las frases y sus formas viven en
`src/gestor/motor/sinPrecio.ts`, y cada métrica cuya cifra depende de eso lleva la suya
(`Metrica.salvedad`, opcional):
`FilaDeMetrica` la pinta sola, `FilaDeDato` la admite, y un bloque sin filas de métrica —un
gráfico, una tabla— lleva `NotaDeLoContadoComoCero`. Un bloque nuevo de esa pantalla que
enseñe una cifra de la cartera tiene que decir una de las dos; y un total que no se puede dar
dice «Falta el dato», no se deja en blanco.

Un dato **incompleto** no es un dato que falta, y ya tiene tres formas: no inventes una
cuarta. La cobertura, en la procedencia del bloque («… · 82 % del peso»); lo que falta, en
el apunte de la cifra («falta el coste de 3 de las 12 posiciones»); y, si condiciona la
lectura, un `<Distintivo tono="aviso">` («Datos parciales», «Estimado»).

## Las puertas

Ninguna es opcional en un cambio visible. Desde `3-BDB-ACTIVOS_app`, de la más rápida a la
más lenta:

```bash
node scripts/deadCssD3.mjs                    # el censo de CSS, con el detalle de lo que sobra o falta
node scripts/dupSelectors.mjs --max-intra 0   # ninguna propiedad repetida dentro de un bloque
npm run typecheck     # `tsc -b`. El `tsc --noEmit` pelado pasa en silencio: no comprueba nada
npm run lint
npm test              # la suite entera; ya incluye las dos primeras, la puerta del texto y la barrera de BDB
npm run build         # typecheck, compilación y presupuesto de peso (JS y CSS iniciales)
```

- **Vitest se lanza siempre desde `3-BDB-ACTIVOS_app`.** Desde la raíz del repositorio
  deja un `node_modules/` con su caché y hace fallar la barrera de BDB. Si `git status` de
  la raíz enseña `?? node_modules/`, es ese resto: se borra; no se añade a la lista de la
  barrera.
- **Las pruebas son el registro de lo decidido.** `contrastePaleta`, `themeTokensMirror`,
  `coloresDeClase`, `piezasComunes`, `hojasDelMarco`, `cortesDeAncho` y
  `plantilla/tema` llevan escritos colores, contrastes con dos decimales y medidas. Si una
  falla, lee qué comprueba antes de tocarla. Si fija un valor decidido, lo que hay que
  mirar es el cambio: el valor esperado no se «arregla» sin una decisión de Óscar. Si lo
  que falla es la forma —una regla que la prueba ya no encuentra, un selector reescrito—,
  se adapta la prueba sin quitarle nada de lo que comprueba, y se dice en el commit.
- **Borrar es parte del trabajo, no un extra.** Una pantalla que pasa por una pieza deja
  CSS muerto; el censo lo nombra y se borra en el mismo commit. Si no, el siguiente no se
  atreve.
- **El censo mira también al revés.** Toda clase que una pantalla escribe ha de tener regla
  en alguna hoja: el 03-11-2026 una limpieza borró un bloque que seguía en uso y dejó 90
  notas sin estilo. Las que no la necesitan están en `scripts/clasesSinReglaPermitidas.mjs`,
  cada una con su motivo, y una entrada que ya no hace falta también lo hace fallar. Esa
  lista solo debería bajar: al quitar entradas, baja con ella el tope
  `EXCEPCIONES_COMO_MUCHO` de `tests/deadCssCensus.test.ts`: si queda por encima del número
  de entradas, deja pasar entradas nuevas.
- **Una hoja nueva se da de alta a mano** en la lista `CSS_FILES` de
  `scripts/deadCssD3.mjs` —el censo no descubre hojas, y la que no esté en la lista no la
  mira nadie— y en el `README.md` de `src/styles/`. `dupSelectors.mjs` solo lee
  las hojas de su propia lista `CSS_FILES`, que no es la del censo: mira cuáles antes de
  dar una hoja por vigilada.
- **Los cortes de ancho son una lista cerrada**, en `tests/cortesDeAncho.test.ts`: una hoja
  no escribe otro. Lo que depende del sitio disponible y no de la ventana usa una consulta
  de contenedor (`@container`).
- **El presupuesto de peso** es de 130 KiB de JS y 45 KiB de CSS iniciales, comprimidos, y
  al JS le queda poco margen: mira la cifra que imprime `npm run build`.
- **Un fallo por tiempo en `tests/nivelesDeEncabezado.test.tsx`** con la máquina cargada
  (otras sesiones, capturas, emuladores) no es del cambio: no tiene más límite que los
  cinco segundos por defecto. Se repite sola antes de darlo por malo.
- Se saltan a propósito, y un verde no las incluye: lo que va contra los emuladores
  (`BDB_TEST_EMULATORS`) y la paridad de Jubilación con NUVIA (`NUVIA_DIR`).
- **Las dos pruebas de humo vuelven a servir desde el 19-11-2026** (apartado 14.6 del
  sistema). `npm run smoke:pdf` genera en el navegador la comparativa de carteras y el
  informe semanal y exige que solo dibujen las dos letras del papel. `npm run
  smoke:informe` recorre Diseño → Informes → Análisis y descarga de verdad el informe para
  el cliente por sus dos puertas. La primera solo pide el servidor de desarrollo; la
  segunda, el entorno en pie y las credenciales de la batería. Las dos toman la dirección
  de `AUDIT_BASE` (por defecto, `http://localhost:5174`). No son puerta de cada cambio visible:
  se pasan cuando el cambio toca los informes, el capital de Diseño o esas pantallas.
  `npm run audit:ui` se retiró: lo que solo ella miraba —el Modo cliente con la página
  entera, y más de un título de pantalla— lo mira el recorrido, que no es una puerta: ella
  medía en los seis anchos y salía con código 1 ante cualquier hallazgo. Su medida propia
  del contraste de la tinta sobre el fondo pintado (4,5:1) no pasa a ninguna herramienta:
  quedan `tests/contrastePaleta.test.ts`, sobre los colores de la paleta, y axe-core en el
  recorrido.

### La batería visual

Es parte de las puertas. Necesita el entorno en pie (habilidad `arrancar-entorno`).

```bash
npm run shots:ui         # las rutas de ROUTES (scripts/capturaInterfaz.mjs) en los seis anchos
npm run shots:estrecha   # las mismas, en los cuatro anchos estrechos: 1025, 1100, 1180 y 1240
```

Los seis anchos de trabajo son **2560, 1920, 1440, 1280, 1024 y 768** (`xl,l,d,p,t,tp`): el
monitor de 32" de Óscar reporta 2.560 px lógicos. Para una pasada corta, `node
scripts/capturaInterfaz.mjs d,tp`, que son el portátil y el mínimo. Un ancho se puede pedir
también por sus píxeles (`1100`), y con una «d» detrás va con dedo (`1180d`); los nombres y
las reglas están en `scripts/anchosDeCaptura.mjs`, que comparten la batería y el recorrido.

Trece cosas que hay que saber o la pasada miente:

- **La batería a 1024 y 768 tiene que ser con dedo: `fullPage` apaga `pointer: coarse`.**
  Por eso existe `scripts/fotoDePaginaEntera.mjs`, y `tests/fotoConDedo.test.ts` falla si
  un guion con dedo escribe `fullPage`. Una foto a mano con `fullPage` deja midiendo una
  tablet con ratón.
- **`AUDIT_BASE=http://localhost:5174`, nunca `127.0.0.1`:** Vite escucha solo en `::1`. Sin
  la variable, el guion apunta a esa dirección, que es el Vite de la carpeta principal
  (`scripts/entrarEnLaApp.mjs`). En una carpeta de trabajo
  aparte se pasa el puerto de su Vite, **en la misma línea de la orden**: la batería no
  dice qué dirección ha fotografiado, y con la variable de otra sesión fotografía la rama
  principal, sale limpia y no avisa. Mira en la primera foto que es el aspecto que esperas.
- **Hacen falta credenciales** en `BDB_SHOTS_EMAIL` y `BDB_SHOTS_PASSWORD`: sin ellas, o si
  el formulario de acceso no se va, la pasada se para y lo dice (hasta el 19-11-2026 la
  batería seguía y fotografiaba el acceso en todas las rutas). Son las del usuario local del emulador, que
  `scripts/seedEmulatorUser.mjs` declara como constantes: léelas de ahí y pásalas por
  entorno. **No las escribas en una respuesta.** El emulador de Auth no persiste: tras cada
  arranque hay que volver a sembrar el usuario (`npm run seed:emulator-user`).
- **Una pasada con incidencias sale con código 0.** Desborde, error de consola, posición
  sin resolver («Activo no encontrado»), estado dicho solo con color y foto de tablet sin
  dedo se cuentan bajo `=== ISSUES ===` y en `report.json`, pero no cambian el código de
  salida. Solo lo cambian dos cosas: no poder entrar —la pasada se para al principio— y que
  todas las rutas de un ancho pinten el mismo título, que es como la batería avisa de que
  no ha recorrido nada. Hay que leer la lista. Entre las incidencias cuenta también una
  pantalla que desplaza y se midió sin barra: el navegador no la está pintando.
- **Lo que la batería no mide:** textos cortados, cajas que se desplazan de lado, letra
  por debajo del mínimo, saltos de nivel de encabezado, más de un título de pantalla,
  tablas apretadas, cifras que se salen de su casilla, accesibilidad y el Modo cliente. Eso lo
  hace `node scripts/auditoriaFrontend.mjs <etiqueta> d,tp`, que no tiene `npm run` y
  recorre muchas más pantallas (la ficha, las pestañas, el interior de Carteras de
  clientes). No es puerta de cada cambio, pero es lo único que mide esas cosas: pásalo
  cuando el cambio toque la letra, los encabezados, una tabla, la banda de cifras o el
  ancho de un bloque. Es un informe que hay que leer: solo sale con código 1 cuando la
  pasada no ha medido lo que dice —no entró, no pudo medir alguna pantalla, midió sin barra
  una que desplaza, o falta alguna de las pedidas en Modo cliente— o cuando en Modo cliente
  la página lleva algo reservado al asesor (`scripts/informeDelRecorrido.mjs`). El Modo cliente lo mira
  en Informes, Optimizar y dos pestañas de Análisis, con los paneles plegados abiertos, y
  axe-core pasa en un solo ancho salvo con `AUDIT_AXE=todos`. Deja
  fotos e informe en `docs/frontend/capturas/<etiqueta>/`, que va al repositorio: usa
  `AUDIT_OUT` para llevarlos a otra carpeta, y no reutilices una etiqueta sin querer.
- **Un texto cortado con puntos suspensivos no desborda ni da error:** solo lo ve el
  recorrido, que desde el 19-11-2026 dice, pantalla a pantalla y por cada clase de
  elemento, cuántos textos manda recortar su hoja —en una línea, o a un número de líneas— sin que les quepa el contenido,
  y cuál pierde más, con sus píxeles; no los nombra todos. No es un fallo automático: se
  mira cada uno y se decide. Los cortes ya
  decididos están en `scripts/textoCortado.mjs` (`CORTES_ADMITIDOS`), cada uno con el
  apartado del sistema que lo decide, y esa lista solo crece con una decisión escrita.
- **Una caja que se desplaza de lado no desborda ni corta un texto.** axe-core solo la
  señala si dentro no hay nada que se pueda enfocar, y pasa en un solo ancho. Desde el
  19-11-2026 el recorrido lista, pantalla a pantalla y en cada ancho, las cajas con
  desplazamiento propio a las que su contenido no les cabe de ancho: cuánto pide cada una y
  cuánto le cabe, cuántos controles —botones, enlaces o campos— quedan fuera de la vista tal
  como se abre la pantalla, y si lleva con qué enfocarla (`scripts/cajasQueSeDesplazan.mjs`).
  No es un fallo automático —una tabla ancha se desplaza dentro de su marco a propósito—:
  hay que leer sus dos listas, las que esconden un control y las que no llevan nada que se
  enfoque. Ese día,
  en Diseño, la tabla de posiciones pedía 590 px en una tarjeta de 543 a 583 (ventanas de
  1.180 a 1.280 px) y «Quitar» quedaba fuera de la vista, del todo o en parte, sin que
  ninguna herramienta lo dijera (apartados 14.6 y 14.7 del sistema). No ve lo que queda
  fuera en vertical, ni si la columna que queda fuera hace falta para leer la fila.
- **Carteras de clientes y Posiciones salen en su estado de entrada**: la carpeta sin
  elegir y el extracto vacío. Su interior no lo fotografía la batería.
- **Las fotos se quedan.** Van a `output/shots/` (o a `BDB_SHOTS_DIR`) y una pasada no borra
  las de la anterior: mezclar dos en la misma carpeta deja fotos viejas que parecen nuevas.
- **Varias sesiones fotografiando a la vez dan errores que no son de la aplicación.** Todas
  entran con el mismo usuario, y las Functions limitan las llamadas por usuario, operación
  y minuto: salen «429 Too Many Requests». La pasada que vale se lanza sin nadie más
  fotografiando.
- **Las fotos y las medidas llevan la barra de desplazamiento, como una ventana.** Hasta el
  19-11-2026 no la llevaban: Playwright lanza el navegador sin cabeza con las barras
  ocultas, y `fullPage` además vuelve a disponer la página sin ella aunque se pongan. En un
  Chromium con ventana la barra de la página ocupa 10 px, así que todo se medía con 10 px
  más de contenido que la pantalla real, y lo que en la foto cabía por menos de eso, en la
  pantalla no cabía (apartado 14.5). Ahora, con ratón, el navegador se lanza con las barras
  puestas y se reserva el hueco de la barra donde la página desplaza; con dedo no hay barra
  que ocupe sitio, como en una tableta (`scripts/barraDeDesplazamiento.mjs`). Dos
  consecuencias: una medida de antes de esa fecha no se compara sin más con una de después
  —`AUDIT_BARRAS=ocultas` repite una pasada como las de antes—, y una foto hecha a mano con
  `fullPage`, sin esas piezas, sigue saliendo sin barra.
- **Los seis anchos no ven el tramo del menú compacto: para eso está la pasada estrecha.**
  `estrecha` son 1.025, 1.100, 1.180 y 1.240 px, cuatro de los cortes donde cambia la
  disposición y el contenido más aprieta (trampa 9), en las dos herramientas. No sustituye
  a los seis anchos de trabajo ni entra en la batería de cada cambio: se pasa cuando el
  cambio toca el marco, el menú o el ancho de un bloque.
- **La cartera de muestra** (`scripts/carteraDeMuestra.mjs`) la siembra la batería, ella
  sola. Si cambias un activo, no basta con medirlo contra la base: lo que la aplicación
  consume pasa por `src/adapters/assetDataSource.ts`, que quita los dos índices base de los
  benchmarks sintéticos. Un activo que está en Firestore puede no llegar nunca a la
  pantalla.

**Lo que se enseña a Óscar va en imagen o en página publicada**, no en texto (`AGENTS.md`:
artefacto publicado o fichero enviado), con el antes medido en la rama principal y el
después (trampa 7).

## Cuando una pantalla pide algo que la pieza no hace

Primero mira si ya existe el estilo: **un nombre nuevo para un estilo que ya estaba
escrito es el defecto, no la solución.**

Si de verdad falta, se añade **a la pieza**, no a la pantalla: una propiedad en `Panel`
sirve a todas sus llamadas; una clase en la hoja de una pantalla sirve a una. Así entraron
`abierta` en `Respuesta` e `importes` en `KpiStrip`. Lo que es de una sola pantalla va en
su hoja (`analisis.css`, `ficha.css`, `diseno.css`…) o, si no la tiene, en
`src/styles/modules.css`.

Y ningún color en crudo en las hojas fuera de `src/styles/tokens.css`: ni un `#hex` ni un
`rgb()`; las sombras, las de los tokens. Hoy no hay ninguno, y ninguna prueba general lo
vigila: que siga así depende de quien escribe. Quedan medidas en píxeles escritas a mano en
las hojas, que son deuda conocida; no añadas más.

## Los PDF de informes no entran

Son otro medio, y lo que firma y entrega un asesor no se toca de rebote: solo por decisión
expresa de Óscar. **Y se toca de rebote con facilidad:** el 03-11-2026 un cambio de paleta
se coló en tres informes que importaban `src/core/theme.ts`.

Todos los informes —los de `src/reports/` y los tres de Carteras de clientes, en
`src/gestor/informes/`— salen de **una sola plantilla**, `src/reports/plantilla/`. Un
informe no importa la paleta de pantalla (`core/theme`, `core/coloresDeClase`): lee los
colores de `plantilla/tema.ts`, y `tests/paletaDelPapel.test.ts` lo vigila.

Lo único que el papel copia de la pantalla, escrito y no importado, lo decidió Óscar el
15-11-2026 («que coincidan»): el verde y el rojo del signo y los colores de renta fija,
renta variable y liquidez del informe de cliente. Desde el 18-11-2026 esos tres son los de
la dirección A, y «Otros» conserva el gris que el papel copió de la pantalla el 15-11. Si
la pantalla cambia uno de ellos, `tests/plantilla/tema.test.ts` falla a propósito, y qué
hacer está en el apartado 14.3 del sistema. Lo vigente sobre el aspecto del papel está en
«Los informes» del apartado 12 y, para lo que copia de la pantalla, en el 13 y el 14.3.
