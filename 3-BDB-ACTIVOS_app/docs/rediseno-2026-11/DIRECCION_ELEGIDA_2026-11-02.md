# La dirección elegida: A + B

*2 de noviembre de 2026. Decide Óscar. Este documento existe porque del rediseño de
septiembre no quedó ni una línea que dijera por qué ganó la dirección B, y un año después
nadie puede defender esa elección ni discutirla.*

---

## 1. Qué se eligió, y entre qué

Se mostraron cuatro direcciones sobre **el mismo dato real** —el fondo
`LU0011889846`, leído de la base nueva el 2 de noviembre de 2026— y después tres vestidos
de la ficha completa. Óscar eligió en dos pasos:

| Paso | Lo que dijo | Qué significó |
|---|---|---|
| Direcciones cortas | «La estructura me gusta quizás más la de A, pero el formato me gusta el C» | Nace la D, mezcla de las dos |
| Ficha entera | «La disposición de la B me gusta también, pero con un toque un pelín más elegante» | Nace la B′ |
| | «Las líneas de barras de cada métrica, valor, etc. no me gustan en la ficha» | Nace la A + B, sin una sola barra |
| | **«A + B»** | **La elegida** |

Las descartadas y su motivo, para que no haya que volver a recorrerlas:

- **B · El panel.** Quince cajas con borde sobre fondo gris. Un panel con borde dice «soy
  un objeto aparte»; quince paneles iguales no dicen nada, y el blanco sobre gris es el
  aire por defecto de cualquier cuadro de mando.
- **C.** Pintaba igual «no aplica» y «falta el dato», que es justamente lo que este
  proyecto no se permite confundir.
- **B′ · la cuidada.** Sobrevivió hasta el final y perdió por poco. Conservaba la
  comparación contra la categoría en una columna de cifras, que es más informativo; la
  A + B la manda a una nota al pie y gana en limpieza y en altura. Queda registrada por si
  la columna de categoría hace falta más adelante: no es una idea descartada, es una
  pieza aplazada.

---

## 2. Qué es la A + B

**De la B, la disposición. De la A, el carácter.** Dos frases, y lo demás se deduce.

### Los cinco principios

1. **Nada se afirma sin decir quién lo dice y desde cuándo.** Cada sección lleva su
   procedencia pegada bajo el título, no escondida en un pie: «Cifras *del proveedor* ·
   31 oct 2026», «Del *KID* · 13 feb 2026», «Taxonomía del proveedor · 30 sep 2026».
   Esto es lo que hace a la A ser la A, y es la razón de que ganara su carácter.
2. **Ni una barra.** Una barra bajo una cifra solo sirve si hay contra qué compararla, y
   en la ficha de un instrumento casi nunca lo hay. Donde sí había comparación —el fondo
   contra su categoría— la comparación se escribe, no se dibuja. Un 4 % y un 3,9 % se
   distinguen leyéndolos; dibujados, no.
3. **Lo que separa las filas es un filete.** No una caja, no un fondo gris alterno: una
   línea de 1 px, que es lo que hace un libro de cuentas.
4. **Las secciones fluyen en columnas, no en filas.** Con filas, una sección corta al
   lado de una larga deja un vacío del alto de la larga, y sin cajas ese vacío no parece
   aire: parece sin terminar. El flujo en columnas lo empaqueta.
5. **Todo a la vista.** Nada se despliega. En un monitor de 2.560 px lógicos la ficha
   completa de un fondo —catorce secciones— mide **1.375 px de alto**: cabe casi entera
   sin bajar.

### Lo que la hace barata

Usa **IBM Plex Sans**, que la aplicación ya autoaloja vía `@fontsource` en `src/main.tsx`
(cuatro pesos latinos, 95 KB en total). No añade ni un byte de grotesca. La serifa de los
títulos es la única excepción, y está en el apartado 6.

---

## 3. El sistema, medido

Valores tomados del prototipo verificado, no estimados.

### Color — ocho, y ni uno más

| Papel | `#fcfcfb` | El lienzo. Blanco cálido, no blanco puro: el blanco puro con filetes grises es el gris de administración |
| Tinta | `#1a1a18` | Texto principal y cifras |
| Tinta 2 | `#56564f` | Rótulos, notas, texto secundario |
| Tinta 3 | `#8e8e85` | Procedencia, encabezados de tabla, cejas |
| Filete | `#e4e4dd` | La línea entre filas |
| Filete 2 | `#c8c8be` | La línea bajo un título de sección o un encabezado de tabla |
| Marca | `#33406b` | Índigo. Lo afirmativo: una aptitud que sí se puede usar |
| Baja | `#8c3a2b` | Terracota oscura. Lo que falta, lo que no cuadra, lo que dejó de cotizar |

**Los neutros no son grises puros.** Tiran levemente a verde-oliva, que es lo que hace que
el papel y los filetes parezcan elegidos y no heredados del navegador.

**Dos colores, no una paleta.** El índigo afirma y la terracota avisa. No hay verde de
«bien» ni rojo de «mal»: una cifra financiera no es buena ni mala por sí misma, y pintarla
de verde sería opinar.

### Tipografía — dos voces

- **IBM Plex Sans** para todo lo que se compara: cifras, rótulos, tablas, notas.
  Cifras tabulares (`font-variant-numeric: tabular-nums`) **siempre** que haya una columna
  de números.
- **Una serifa** solo en los títulos, y en **dos pesos que hacen cosas distintas**: el
  título grande —el nombre del instrumento, el de la pantalla— en **400**, y los títulos
  de sección y de panel en **600**. Es deliberado: un título de una sola palabra, como
  «Análisis», concentra en siete letras el peso que en el nombre de un fondo se reparte
  por tres cuartos de ancho, y en 600 se convierte en un bloque negro. Los títulos
  pequeños, en cambio, necesitan el 600 para destacar sobre el texto que los rodea.

Escala medida, en píxeles:

| Uso | Tamaño | Peso |
|---|---|---|
| Nombre del instrumento / título de página | 33–34 | **400**, serifa, interlineado ~1,05, tracking −0,006em |
| Cifra destacada | 26 | 600, tracking −0,015em |
| Cifra de respuesta | 60 | 600, tracking −0,035em. **Una por pantalla, y hoy solo en Jubilación:** lo que le queda al cliente al mes. Está fuera de la escala medida a propósito; Óscar la aprobó con la propuesta de Jubilación el 13-11-2026 (`--fs-respuesta`). No sustituye a la cifra destacada |
| Título de sección | 17 | 600, serifa |
| Cifra de fila | 16 | 600, tabular |
| Base, texto de aptitud, objetivo | 14 | 400 |
| Tabla | 13,5 | 400 (cifra 600) |
| Rótulo de fila, meta, botón | 13 | 400 |
| Nota, procedencia campo a campo | 12 / 12,5 | 400 |
| Ceja, procedencia de sección, encabezado de tabla | 11,5 | 400 (encabezado 600) |

Interlineado 1,5 en general; 1,45 en bloques de texto pequeño; 1,6 en el objetivo del
fondo, que es prosa.

### Retícula

- **Carriles de 300 px**, con 46 px entre ellos, por flujo de columnas
  (`column-width: 300px`). No es una rejilla de doce columnas: a 2.560 px una rejilla de
  doce da paneles de 600–900 px, y dentro de ellos las listas se parten en dos columnas y
  se vuelven ilegibles. Ese era el defecto medido de la aplicación de hoy.
- **Banda ancha aparte** para lo que no cabe en 300 px: cartera, objetivo y procedencia.
  `repeat(auto-fill, minmax(620px, 1fr))`.
- **Padding de página** 40 px arriba, 48 px a los lados, 60 px abajo.
- **Separación entre secciones** 30 px.
- Ancho máximo de un bloque de prosa: **38 em** (46 em para el objetivo del fondo).

### Las piezas que la ficha usa

1. **Cabecera** — ceja, nombre, meta (ISIN · divisa · categoría · índice), sello de
   disponibilidad y acciones, con filete de 2 px bajo todo.
2. **Tira de aptitudes** — la fila horizontal bajo la cabecera que contesta «qué puedes
   hacer con él» antes de que nadie lea una cifra: comparar su coste, entrar en una
   radiografía, comparar su rentabilidad, medir su alfa, y si tiene métricas nuestras.
   Cada una en índigo si sí, en gris si no, en terracota si falta el dato.
3. **Sección estrecha** — título, línea de procedencia, filas, y nota al pie si hace falta.
4. **Fila** — rótulo a la izquierda, cifra a la derecha en columna constante, filete debajo.
5. **Tabla** — para la cartera. Encabezado en 11,5 px sobre filete 2; cifras a la derecha,
   tabulares.
6. **Hueco declarado** — el bloque de terracota con filete a la izquierda para cuando el
   dato existe pero se contradice con otro (el fondo que declara reparto y no reparte
   desde julio de 2021).

---

## 4. Las reglas que mandan sobre la estética

Estas no son de diseño; son del proyecto, y ganan siempre.

- **Si un dato no está, se dice que no está.** Nunca un cero creíble, nunca un guion que
  pueda leerse como «cero».
- **Las tres ausencias son tres cosas distintas y se pintan distinto:** *no aplica* (una
  acción no tiene TER), *no nos lo han dado* y *aún no lo hemos pedido*. La tercera es la
  interesante, porque significa que se puede ir a buscar.
- **Un instrumento que dejó de cotizar se marca, no desaparece**, y se marca sin que
  parezca una pérdida de dinero.
- **Nunca se ordena una cifra contra otra de escala distinta.**
- **El Sharpe no se suprime nunca.**

---

## 5. Lo que esta dirección todavía no resuelve

Dicho ahora y no al final:

- **Las tres ausencias no tienen forma dibujada en la A + B.** El prototipo es un fondo
  casi completo, y donde el dato falta solo hay una línea en cursiva gris. La distinción
  entre las tres clases se dibujó en la dirección C y allí salió mal. Es lo primero del
  paso 6.
- **La acción de tres secciones no está pintada en esta dirección.** El fondo de catorce
  sí. Hasta que las dos se vean completas al lado, la dirección no está probada.
- **Falta la serie histórica.** La base nueva no tiene contrato de serie; la pestaña de
  evolución no se puede diseñar contra ella todavía.
- **Falta todo lo que no es la ficha:** buscador, comparador, cartera, navegación.

---

## 6. La serifa: decidida y hecha

**Óscar: «sí, autoalójala»** (2 de noviembre de 2026), y después, viendo cinco muestras
sobre el encabezado real, **«la 3, serifa normal»**. Las dos cosas hechas el mismo día.

- `@fontsource/source-serif-4`, **dos pesos**: 400 normal (20.088 bytes el fichero latino)
  y 600 normal (21.532 bytes). Se importan en `src/main.tsx` como `400.css` y `600.css`,
  no las variantes `latin-`: el CSS completo trae todos los subconjuntos con su
  `unicode-range`, el navegador descarga solo los que la página usa, y así un nombre con
  caracteres de Europa central no se parte entre dos tipografías.
- `--font-serif` declarado en `tokens.css`. **Deroga la decisión B″ del 03-09-2026**
  («una sola voz en pantalla: IBM Plex. Sin serif»), que formaba parte del sistema
  descartado. Queda escrito en el propio token para que nadie la restaure por inercia.
- Aplicada en cuatro sitios: `h1`–`h4` en `base.css`, `.panel__title`,
  `.ui-page-header h1/h2` y `.asset-detail-title-block h1/h2`. **No en `h5` ni `h6`**:
  son rótulos, y un rótulo de 11 px en serifa se lee peor, no mejor.
- **El primer intento se pasó de peso, y es una corrección que conviene registrar.** Los
  títulos grandes se pusieron en serifa 600 y Óscar dijo que no le convencía. El motivo
  medido no era la tipografía: era la **longitud**. El mismo 33/600 que él había aprobado
  en la ficha —«Janus Henderson Horizon Euroland Fund A2 EUR»— se vuelve un bloque negro
  en «Análisis». De ahí los dos pesos del apartado 3.

No hay serifa en cursiva. Si alguna vez hace falta, es una decisión nueva y con su coste,
no un `npm install` de paso.

**Queda una decisión pequeña abierta,** que se vio al aplicar esto y que es independiente
del peso: la serifa entró también en el **título de panel, a 15 px**, y en una pantalla
con quince paneles eso se repite quince veces. Se puede dejar la cabecera en serifa y
devolver los paneles a la grotesca sin tocar nada más.

**Y una que el prototipo deja descuadrada:** la maqueta de la ficha tiene el nombre del
instrumento en serifa **600**. La app ya va en 400. Cuando la ficha se construya de
verdad, va en 400, y conviene volver a mirarla entonces.

## 7. Lo que ya está en el código

*Actualizado el 2 de noviembre de 2026, al cerrar la primera vuelta.*

| Qué | Dónde |
|---|---|
| Los ocho colores | `src/styles/tokens.css`, bloque 13b. De momento solo los usa la ficha |
| La serifa, dos pesos | `@fontsource/source-serif-4` 400 y 600, importados en `src/main.tsx` |
| El modelo de la ficha | `src/types/fichaInstrumento.ts` |
| El pintor | `src/components/ficha/FichaInstrumento.tsx` |
| La hoja | `src/styles/ficha.css` |
| La vista previa | `/ficha-nueva`, fuera del rail |
| Las pruebas | `tests/fichaInstrumento.test.tsx`, `tests/tablaDeDatos.test.tsx`, `tests/tablaComparativa.test.tsx` |
| La lectura de la base nueva | `src/adapters/baseNuevaLectura.ts`, por REST contra su emulador |
| La tabla y la comparativa | `src/components/tabla/`, `src/styles/tabla.css` |
| El buscador y el comparador | `/buscador-nuevo` y `/comparador-nuevo`, fuera del rail |

**La regla de las escalas, en tres pantallas.** «Nunca se ordena una cifra contra otra
de escala distinta» dejó de ser una frase del método y es ahora código en tres sitios: el
buscador **agrupa** al ordenar por una columna de escala mixta, el comparador **marca** la
fila que pone juntas cifras de métodos distintos, y la ficha de una acción **avisa** de que
sus métricas son diarias. La lógica que lo decide ya existía —`describeMetricsMethodology`,
escrita el 03-09-2026 para el Sharpe del comparador—; lo que faltaba era usarla en todas
partes en vez de en una.

**Un solo pintor y ninguna rama por tipo.** Hay una prueba que lee el fichero del
componente y falla si aparece `instrument_type`, `=== "FUND"` o un `esFondo`: en cuanto
el pintor decide algo por el tipo, la ficha vuelve a ser una plantilla de fondo con los
huecos tachados, que es exactamente de lo que veníamos.

**Lo que la vista previa NO hace, y conviene no confundirlo.** No lee la base. La
aplicación sigue conectada a la base de siempre y la ficha se compone de la nueva, que
desde aquí todavía no lee nadie. Los tres instrumentos están escritos a mano en
`datosDeMuestra.ts` con cifras reales; cuando el lector exista, se borran y el componente
no cambia.

**Y una cosa que el contrato dejó clara al implementarlo:** la tarjeta de lectura no
basta para la ficha. Está pensada para la fila de una lista y proyecta costes,
exposición, cartera, precio, patrimonio y sostenibilidad; las otras cuatro secciones de
un fondo —reparto, procedencia, y rentabilidad y riesgo del proveedor— se anuncian en
`available_sections` y se leen en su propio documento. La ficha hará varias lecturas, y
por eso el componente recibe un modelo ya compuesto y no la tarjeta en crudo.

---

## 8. Cómo se lleva el resto a la aplicación

El orden del paso 6 del plan, con el primer punto ya hecho a medias:

1. Se reescribe `src/styles/tokens.css` con los valores del apartado 3. Como las cinco
   hojas de estilo restantes no tienen ni un color escrito a mano, esa reescritura cambia
   la aplicación entera. Hay copia de los tokens para los gráficos y una prueba que falla
   si las dos se desincronizan: hay que tocar las dos.
2. Se construyen las piezas que hoy no existen —tabla, panel, tarjeta, distintivo, campo
   de formulario, bocadillo— y las pantallas dejan de escribir sus estilos a mano contra
   ellas. Las 7.975 líneas de `modules.css` se vacían ahí.
3. La ficha de activo, con el fondo de catorce secciones y la acción de tres, las dos
   completas.

El prototipo verificado vive en el artefacto publicado y su fuente está en el
*scratchpad* de la sesión; lo que gobierna de aquí en adelante es **este documento**, no
el prototipo.
