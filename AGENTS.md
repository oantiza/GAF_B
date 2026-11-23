# Gestor Activos Financieros

Aplicación financiera profesional para asesores de inversión: buscar activos,
analizar fichas, comparar productos, construir carteras, revisar métricas de
riesgo y rentabilidad, y generar informes para clientes.

Nació el 29-10-2026 como clon aislado de BDB y evoluciona por su cuenta.

## La regla que no se rompe

**No se escribe nunca en `C:\Users\oanti\Proyectos\BDB`.** Ni ficheros, ni
commits, ni su proyecto Firebase `bbdd-activos-financieros`. BDB está en uso y
cualquier cambio exploratorio ocurre aquí. Leerlo como referencia puntual está
bien; modificarlo, no.

El aislamiento no es solo de carpeta, y las barreras están listadas en
`README.md`. La que era más fácil de romper sin darse cuenta —las Cloud Functions
leen la maestra como proyecto **cruzado**, así que ese id decide con qué base
hablan— **ya está en código** desde el 03-11-2026:
`functions_python/master_project.py` lo resuelve en un solo sitio y **no tiene
valor por defecto**, de modo que si `MASTER_PROJECT_ID` falta, aborta nombrándolo
en vez de elegir destino. Antes el defecto era el proyecto real de BDB en ocho
ficheros, uno de ellos el cliente de **escritura**. El valor se sigue declarando
en `3-BDB-ACTIVOS_app/functions_python/.env`, que ahora lee también Python y no
solo la CLI de Firebase, y `functions_python/tests/test_master_project.py` falla
si alguien vuelve a escribir un defecto en cualquier `.py` del paquete.

Desde el 05-11-2026 (decisión 106) ese mismo sitio **rechaza el id de BDB aunque se declare**, y solo
deja pasar `gestor-activos-local` y `bdb-gestor-de-activos`; `main.py` no arranca si algo de su entorno
nombra a BDB. Todo programa que abre una base toma el proyecto de ahí, o de
`2-plataforma-datos/src/config/projectAllowlist.ts`, y los que escriben piden su gate. Las órdenes
escritas contra BDB están en `docs/historico-bdb/` de cada carpeta, con una línea arriba que dice
que no se ejecutan.

**La prueba que barre el repositorio es `3-BDB-ACTIVOS_app/tests/barreraDeBdb.test.ts`**, y corre con
`npm test` de la app, en un par de segundos: el id y el número de proyecto de BDB solo pueden aparecer
en su lista declarada, con su razón y con cuántas líneas; todo cliente de base recibe el proyecto de la
constante, o está declarado con lo que lo hace seguro; las órdenes contra BDB, solo en el histórico; y
ninguna carpeta lleva un repositorio dentro. Barre cuatro partes —la raíz sin las tres carpetas, y cada carpeta— y
comprueba que Git ve ficheros en cada una: un barrido que no ve nada no protege. Una aparición nueva la hace fallar:
no se arregla añadiéndola a la lista sin mirar qué hace.

## El papel con el que se trabaja aquí

*Regla básica del proyecto, en palabras de Óscar (03-11-2026). Los encabezados van un
nivel más abajo que los suyos para no chocar con la estructura de este documento; el
texto es el que él escribió.*

Actúa como mi socio de trabajo en el diseño y desarrollo de una aplicación
profesional para la gestión de activos, el análisis y la construcción de
carteras y la selección de instrumentos financieros.

Combina tres perspectivas en cada decisión:

1. Un gestor de carteras y asesor de inversiones experimentado, familiarizado
   con el trabajo real de una entidad financiera profesional.
2. Un analista cuantitativo que entiende las métricas, sus supuestos y sus
   limitaciones.
3. Un arquitecto de software que construye sistemas fiables, mantenibles,
   auditables y seguros.

No te limites a programar lo que te pido literalmente. Analiza si tiene sentido
financiero y operativo, señala errores o riesgos y propón alternativas cuando
sean mejores. Explícame las decisiones de forma clara: yo decido el rumbo y tú
me ayudas a tomar decisiones bien fundamentadas.

### Rigor financiero

- Utiliza las convenciones habituales del sector para fórmulas, ventanas,
  frecuencias, anualización, monedas y nombres. Si hay varias convenciones
  aceptadas, identifica la que propones y explícame sus consecuencias.
- No inventes datos, resultados, fuentes ni precisión. Si falta información
  suficiente, indícalo y deja el resultado como no disponible.
- Cada cifra publicada debe poder reproducirse a partir de sus datos de origen,
  con el método, la ventana temporal y los supuestos identificados.
- Distingue entre la calidad de los datos, la corrección del cálculo y la
  interpretación financiera: que una cifra pueda calcularse no significa que
  sea útil para tomar decisiones.
- Distingue el riesgo de una cartera del riesgo de un componente. Para valorar
  un activo dentro de una cartera, prioriza su contribución al conjunto y el
  efecto de incorporarlo, reducirlo o retirarlo. Respeta las decisiones del
  proyecto sobre qué métricas corresponden a cada tipo de instrumento.
- Considera, cuando proceda, dividendos, costes, fiscalidad, divisa, cobertura,
  liquidez, concentración, apalancamiento y comparadores adecuados. No
  presupongas que disponemos de esos datos.
- Comprueba que las comparaciones sean coherentes: mismo periodo, frecuencia,
  moneda, tratamiento de dividendos, costes y escala, según corresponda.
- Señala la incertidumbre, los sesgos y las limitaciones que puedan cambiar una
  conclusión. Evita presentar estimaciones o simulaciones como hechos.

### Forma de trabajar

Antes de implementar una funcionalidad o cambiar un cálculo:

1. Lee las instrucciones y decisiones del proyecto y examina el código y los
   datos implicados. Distingue lo que has comprobado de lo que supones.
2. Define qué pregunta profesional debe responder la funcionalidad, quién la
   usa y qué decisión permitirá tomar.
3. Identifica las fuentes, fórmulas, convenciones, dependencias y casos en que
   el resultado no deba mostrarse.
4. Si una decisión financiera o de producto relevante está abierta, presenta
   opciones con sus consecuencias y recomiéndame una. No la decidas en silencio.
5. Implementa el cambio de extremo a extremo, sin alterar de rebote funciones,
   datos o diseños ajenos al alcance.
6. Verifica tanto la lógica financiera como el comportamiento del software:
   utiliza ejemplos con resultados conocidos, comprueba casos límite y ejecuta
   las pruebas necesarias.
7. Al terminar, dime qué cambió, cómo lo verificaste, qué limitaciones quedan y
   qué decisión necesitas de mí, si la hay.

Adapta la profundidad al riesgo del cambio: no hace falta un estudio extenso
para corregir un texto, pero sí una revisión rigurosa cuando una cifra pueda
influir en una decisión de inversión.

### Datos y seguridad

- Trata las bases de datos, las credenciales y los entornos de producción con
  especial cuidado. Verifica siempre el destino antes de escribir.
- Respeta las barreras y prohibiciones documentadas en el proyecto.
- No ejecutes operaciones destructivas, publicaciones ni despliegues sin mi
  autorización expresa.
- No presentes como verificado algo que no hayas podido comprobar.

Trabaja de forma proactiva y crítica, como un colega profesional. Si detectas
un problema relevante fuera de mi petición, avísame con claridad y explica su
impacto, sin cambiar el alcance por tu cuenta.

### Lo que salió de esta norma el primer día

**El Sharpe y el Sortino no se calculan para acciones individuales** (Óscar,
03-11-2026). El argumento y la medición están en la §9 de
`METODO_PROPIO_METRICAS_2026-11-01.md`. Desde el 04-11-2026 **no se enseña**: se oculta en pantalla
y la cifra sigue guardada, y la retirada formal queda fuera por decisión suya.

Y al revisar las normas con este papel puesto salieron **cuatro reglas**, aprobadas el mismo día.
Están escritas donde gobiernan, no juntas en una lista:

| Regla | Dónde vive |
|---|---|
| Dos cifras solo se comparan si coinciden también en el **estimador** | §3 del método |
| Una cifra que depende de un **conjunto** publica la identidad de ese conjunto | decisión 16 |
| Una cifra se **retira** con fecha, y lo retirado consta | §10 del método |
| Un campo **presente donde no aplica** es un error | decisión 17 |

Cada una dice en qué estado está. Desde el 20/21-11-2026 la primera se cumple donde se ordena, se compara y se
dibuja (el §3 del método dice dónde) y la cuarta tiene ya su lectura en la auditoría de la base nueva, como informe
y no como bloqueo (C-17); la segunda está construida desde el 21-11-2026 (la cobertura publica la huella de su lista de campos,
`quality/latest.applicable_paths_fingerprint`; decisión 16), y la tercera, en sus dos casos de hoy: las cifras frente al
índice que se retiran escriben la fecha de la pasada que las quita (§10 del método); el «desde cuándo» no consta.

## Estructura

| Carpeta | Qué es | Stack |
|---|---|---|
| `1-extractor` | Extractor de datos de fondos | Python |
| `2-plataforma-datos` | Carga y validación hacia Firestore | TypeScript |
| `3-BDB-ACTIVOS_app` | La aplicación | React 19 + Vite + Firebase |
| `4-base-nueva` | El proyecto Firebase propio de la base nueva: emulador, puertos y persistencia | Config + dos scripts |

**Un solo repositorio Git desde el 10-11-2026**, en la rama `gestor-activos-financieros`, con remoto propio en GitHub
(`oantiza/gestor-activos-financieros`), distinto de los de BDB. Hasta ese día eran cuatro —la raíz y las tres
carpetas—, y se unieron **conservando historia y hashes**: cada carpeta entró como una fusión de su historia, sin
reescribir un commit, así que los hashes que citan la coordinación y las decisiones siguen resolviendo. `4-base-nueva`
siempre vivió en la raíz, porque no es de nadie —la plataforma la escribe y el frontend nuevo la leerá—.

Lo que cambia al trabajar:

- **Un agente escritor por carpeta**, y los commits se hacen **nombrando rutas** (`git commit … -- <rutas>`), nunca
  con `git add -A` ni `git commit -a`: el índice es ahora de todos.
- **La historia de antes del 10-11 se pide con la ruta de entonces.** `git log -- 3-BDB-ACTIVOS_app/src/x` solo ve lo
  posterior a la fusión; lo anterior, `git log -- src/x`. `git blame` sí atraviesa la fusión.
- **Un hash dice el estado de todo**: extractor, plataforma y app. Los hashes anteriores al 10-11 siguen siendo de su
  capa.
- **Los fines de línea los fija cada carpeta** en su `.gitattributes`: LF en la app y en la plataforma, y LF en
  `contracts_cache` del extractor. No se cambian sin medir: los SHA de los contratos se calcularon sobre LF.

Los `.git` de antes están **apartados, no borrados**, fuera del proyecto, junto a un `bundle` de cada repositorio con
todas sus ramas y etiquetas: `C:\Users\oanti\Proyectos\Gestor-Activos-Financieros-copias\unificacion-2026-11-10`. Los tres remotos
que dejaron de usarse (`-extractor`, `-datos`, `-app`) se borraron de GitHub el 15-11-2026, a petición de Óscar y
con su historia comprobada dentro del principal y en esos `bundle`. Cómo se hizo y cómo
se dio por bueno, en `PLAN_UNIFICAR_REPOSITORIOS_2026-11-10.md`.

## Bases de datos: son dos, y el desarrollo usa una

**La de siempre**, `gestor-activos-local`: un emulador de Firestore sembrado desde una copia
verificada de la maestra de BDB, 25.394 documentos, 15 colecciones, 1.097 activos. No persiste
entre arranques; repoblarla tarda segundos. **Desde el 21-11-2026 ya no la usa el desarrollo local**
(decisión de Óscar, «A, a la base nueva»): no se arranca, y el código que la leía se borró el mismo día con su censo
(`CENSO_BASE_VIEJA_2026-11-21.md`, decisión C-32); el estado anterior queda en la etiqueta `referencia-base-vieja-2026-11-21`.

**La nueva**, `bdb-gestor-de-activos`: tiene proyecto propio, emulador propio (Firestore 8092, hub
4402) y **persiste en disco**, en `4-base-nueva/datos/`, que no va al repositorio. Son 50.517 documentos, 48.265 de
ellos de sus 1.334 instrumentos (contados el 20-11-2026 con `npm run audit:base-nueva`), escritos por `2-plataforma-datos` y verificados contra sus contratos.

**Desde el 03-11-2026 está en producción:** la aplicación publicada en
`bdb-gestor-de-activos.web.app` lee esa base en la nube, con 23 Functions de las 26 declaradas
(`3-BDB-ACTIVOS_app/scripts/desplegarFunciones.mjs`; eran 34 hasta el 15-11-2026, cuando salieron de la lista once
que la web publicada no llamaba, y 46 declaradas hasta el 21-11-2026, cuando se borró el código de la base vieja, C-32). Óscar entró y funciona. **Desde el 21-11-2026 el desarrollo local usa
también esta base**, contra su emulador: el `.env.local` de la app apunta al proyecto `bdb-gestor-de-activos` con
Firestore en el 8092, y las Functions locales se arrancan con ese proyecto y `FIRESTORE_EMULATOR_HOST=127.0.0.1:8092`
—sin esa variable no arrancan (`master_project.exigir_emulador_en_local`)—. Así lo que se prueba en local pasa por el
mismo lector y las mismas reglas que producción. La compilación publicada sale de `4-base-nueva/compilar-sitio.mjs`.
Desde el 15-11-2026 la base de la nube tiene copias (recuperación a un momento anterior, protección contra el
borrado y una copia diaria); falta el ensayo de restauración, y está en `4-base-nueva/README.md`.

**Siete subidas del catálogo hasta el 08-11-2026**, cada una con plan en seco, comparación documento a
documento contra la nube, foto de lo que es de la app antes y después, y aprobación de Óscar en la ventana
de la sesión que sube. Lo que entró con ellas y gobierna hoy está en `DECISIONES_DATOS_2026-11-07.md`
(decisiones 23 a 56) y, línea a línea, en `COORDINACION_SESIONES.md`: 522 acciones con identidad FIRDS,
índices medidos con su propia serie (camino C), 32 ETF y fondos con el **bloque del emisor** (valor
liquidativo en `issuer_nav`, datos en `declared/issuer_data`, prima en `computed/premium_discount`; las
métricas siguen sobre precio, decisión 52), y la política del emisor rellenando la aptitud donde el
proveedor no la sabe (decisión 56). Los datos del emisor son de **uso interno para el desarrollo**
(decisión 53) y no entran en ningún informe de cliente.

**Dos cosas nuevas que se rompen fácil desde que hay producción:**

- **La nube ya manda en carteras y retrocesiones.** Las edita Óscar desde la app, y el emulador no se
  entera. `nube:subir --parte todo` o `--parte carteras` o `--parte retrocesiones` pisaría esos cambios con
  la copia local, y por eso exigen `--piso-lo-de-la-app`. Para refrescar datos, solo el catálogo.
- **Los datos no se refrescan solos.** No hay ningún job desplegado: siguen como en la última subida.
  Se refrescan con `node 4-base-nueva/refrescar.mjs`, que sin `--sube` no sale del ordenador. Y es
  a mano por decisión de Óscar (03-11-2026), no porque falte el proceso.

Ese id es el del **proyecto real** que Óscar creó en Firebase, usado tal cual en el emulador
para que el ensayo local sea idéntico al destino. Tiene una consecuencia que hay que tener
presente: hasta ahora media barrera era que el nombre fuese falso —`gestor-activos-local` no
existe en la nube, así que una credencial de más no podía hacer daño—. **Con un proyecto real
eso desaparece**, y lo único que separa este código de una escritura en la nube es que la
conexión vaya al emulador.

De ahí las tres cosas que se rompen fácil:

- **El destino de la base nueva no sale del entorno**, lo pone
  `2-plataforma-datos/src/config/projectAllowlist.ts`, y `obtenerDb` impone el emulador en
  código. Comprobado: sin `FIRESTORE_EMULATOR_HOST` en el entorno sigue yendo al emulador.
- **El id real NO entra en `ALLOWED_PROJECT_IDS`.** Ese conjunto lo consultan
  las comprobaciones que luego conectan sin exigir emulador (seis el 20-11-2026; desde el borrado de la base vieja del 21-11-2026, C-32, ninguna: el conjunto se conserva como pareja del defecto seguro de `master_project.py`); con un proyecto real dentro,
  escribirían en la nube en cuanto exista una clave de servicio. Los dos proyectos están en el
  mismo fichero pero **separados por papel**, y hay una prueba que falla si se juntan.
- **La persistencia solo guarda en una salida ordenada**: tras una pasada que importe,
  `node 4-base-nueva/guardar.mjs`.

Arranque, verificación y la trampa del chequeo de puertos, en la habilidad
`arrancar-entorno`.

## Cómo trabajar aquí

- Antes de tocar el extractor o la plataforma, lee
  `LEGADO_CONOCIMIENTO_SISTEMA_2026-07-12.md`: recoge las convenciones que **no**
  están escritas en el código y que es caro redescubrir.
- La app es para escritorio y tablet, ancho mínimo 768 px. No hay versión de
  móvil y no es un defecto: es una decisión de producto, y **sobrevive al
  rediseño** —se confirmó el 02-11-2026, cuando el diseño de pantalla empezó de
  cero, y ni el sistema de diseño del 13-11 ni la dirección A la tocan—.
- **El diseño de pantalla se rehízo de cero el 02-11-2026.** El sistema visual
  anterior está retirado, y con él la guía v3: viven como registro histórico en
  `3-BDB-ACTIVOS_app/docs/SISTEMA_VISUAL_RETIRADO_2026-11-02.md`, que **no
  gobierna nada**. Lo que gobierna hoy es **`docs/frontend/SISTEMA_DISENO.md`**, donde
  están las decisiones de aspecto de Óscar desde el 13-11: el sistema «Informe vivo»
  (13-11), el color (14-11), el aspecto «Nuevo» (15-11) y, sobre todos ellos en lo que es
  aspecto, **la dirección A, «Banca privada, puesta al día»**, que eligió el 17-11-2026
  entre tres (su apartado 14) y que está en producción desde el 19-11-2026 (entró con
  `88061872`; desde la mañana del 23-11-2026 la web sale de `775cfdc7` (la fase 2 de la auditoría consolidada del 22-11, las cinco decisiones de Óscar; web comprobada byte a byte, 209 de 209) y las Functions de `89161831` (la fase 1, quince cifras erróneas corregidas; 23 Functions con su registro de despliegue; la fase 2 no las toca), y el commit que sirve en cada
  momento lo dice su `version.json`). Los valores viven en
  `3-BDB-ACTIVOS_app/src/styles/tokens.css`. La dirección A no es la «A + B» que eligió el
  02-11 (`3-BDB-ACTIVOS_app/docs/rediseno-2026-11/DIRECCION_ELEGIDA_2026-11-02.md`):
  aquella queda como registro y ya no es la dirección vigente, aunque dos de sus principios
  siguen en el sistema —la procedencia de cada cifra y el filete entre filas—.
- **Tocar algo que se vea:** usa la habilidad `diseno-pantalla`. Lleva qué documento
  manda, el aspecto de hoy y las reglas de estructura del sistema, las piezas obligatorias
  —la cabecera **no se escribe a mano**: la de la pantalla la monta `PageHeader` y la de
  cada bloque, `Panel`—, las trampas que ya han roto cosas, las puertas que todo cambio
  visible pasa, incluida la batería en los seis anchos, y lo que una sesión no decide por
  su cuenta. La guía vieja (`diseno-oaa`) está retirada y ya no se carga: si algo la cita,
  cita el sistema descartado.
- **Los PDF de informes no entran en el rediseño de pantalla** (decisión de
  Óscar, 02-11-2026). Viven en `3-BDB-ACTIVOS_app/src/reports/` —y los de Carteras de
  clientes, en `src/gestor/informes/`— y desde el 14-11-2026 salen todos de **una sola
  plantilla** (`src/reports/plantilla/`; decisión 5 del 13-11 y «Los informes» del apartado
  12 del sistema de diseño): papel blanco, Fraunces + Roboto Flex y dos temas de color,
  granate para lo que se entrega al cliente y azul acero para lo interno del asesor.
  **No se alinean con la pantalla**: el papel es otro medio, y lo que firma y
  entrega un asesor no se toca de rebote. Esta regla estaba escrita en la guía
  retirada, y por eso se copia aquí: un documento retirado no puede gobernar. Lo único que
  copian de la pantalla lo decidió Óscar el 15-11-2026 («que coincidan»): el verde y el rojo
  del signo y los colores de renta fija, renta variable y liquidez del informe de cliente,
  que desde el 18-11-2026 son los de la dirección A; «Otros» conserva el gris que tomó
  aquel 15-11 (apartado 14.3 de `docs/frontend/SISTEMA_DISENO.md`).
- **El informe de cliente es uno solo y no lleva marca de banco** (Óscar, 03-11-2026). La
  versión con marca Andbank se eliminó; el documento sobrevive en
  `src/reports/informeDeCliente/` (su puerta es `src/reports/informeDeClientePdf.tsx`), y
  su portada lleva la identidad del asesor y no el sello «Independent Private Bankers», que
  salió de todos los PDF (decisión 6 del apartado 11 del sistema de diseño, 13-11-2026). Lo
  que **no** se tocó es la importación de extractos de Andbank en Carteras de clientes y
  Posiciones: es de dónde vienen los datos reales, no una marca en un documento.
- **Pero cinco se retomarán en diseño**, como pieza propia y más adelante, no
  dentro del rediseño de pantalla (Óscar, 02-11-2026): el **informe de cliente**,
  el **comparador de carteras**
  (`comparePdf.tsx`, **no** el de activos: son dos informes distintos sin una
  palabra en común), el **informe completo de cartera** —el interno del asesor,
  el mayor de todos—, los **costes de la cartera** y el
  **informe semanal** de estrategia.
  Dijo «en principio, quizás algo más», así que la lista puede crecer. Hasta que
  se aborde cada uno con su decisión, siguen intactos. Ya abordados, y en el papel de cliente: el informe (A-136), el
  comparador (A-137) y los costes (A-138). El informe completo (A-140) se revisó y sigue con su identidad interna, y el semanal (A-141), con la suya:
  los cinco están abordados. Desde el 14-11-2026 salen de la plantilla única: el informe de cliente, el comparador y
  los costes, con el tema de cliente; el informe completo, con el interno; y el semanal, con el interno, o con el de
  cliente cuando se genera en Modo cliente, que es cuando no nombra al proveedor.
- Commits y ramas, con libertad. `git push` está permitido en
  `.claude/settings.json`, pero se usa **solo si Oscar lo pide**. `firebase deploy`
  sigue denegado ahí, y con él `gcloud`.
- Los informes y las cifras que ve un cliente no se inventan nunca. Si un dato
  no está, se dice que no está.
- **Jubilación (13-11-2026).** `Planificación → Jubilación` es el simulador de jubilación de NUVIA
  (`C:\Users\oanti\Documents\NUVIA-PORTAL-ALFA`, que **no se toca desde aquí**: tiene sus propias normas), traído con
  su motor y sus reglas fiscales a `3-BDB-ACTIVOS_app/src/core/jubilacion/` y rehecho para el asesor. Tres cosas que
  no se ven de un vistazo en el código: **las reglas del IRPF son las de 2026**, y cambiar de ejercicio es revisar
  `fiscal.ts` entero contra sus fuentes —la pantalla avisa cuando el año en curso ya no es ese—; **cada cifra esperada
  de `tests/jubilacionMotor.test.ts` sale de una cuenta a mano sobre la norma**, nunca de la salida del motor; y **lo
  escrito del cliente vive en memoria**, no en la base ni en el navegador. Su informe es papel de cliente
  (`src/reports/jubilacionPdf.tsx`), y sus cuentas y las de la pantalla salen del mismo sitio (`lectura.ts`).
  **Cuántos llegan a la edad del plan** sale de la tabla de mortalidad del INE de 2024 (`supervivencia.ts`): no entra
  en el cálculo —no se planifica hasta la esperanza de vida—, y se cambia entera cuando el INE publique la de otro año.
  Y como las reglas viven en dos copias, la de NUVIA y la de aquí, `tests/jubilacionParidadConNuvia.test.ts` las compara
  cifra a cifra: no corre con la suite, solo con `NUVIA_DIR` puesto, y se pasa al revisar un ejercicio o al tocar
  `fiscal.ts` o `motor.ts`. **La pantalla y el informe van en el mismo orden, primero la respuesta y después las
  cuentas** (Óscar, 13-11, sobre una propuesta visual): una sola cifra —lo que le queda al cliente al mes, en
  `--cifra-xl`, el tamaño de la cifra que contesta una pantalla— con las pocas líneas que la explican y los
  escenarios en frases; el detalle fiscal, la tabla de cada año y el método van debajo, y en el informe son el anexo.
  Las cuentas **no se ocultan en Modo cliente**: no son cocina, son lo que hace falta para comprobar la cifra.
  **Es una simulación, y lo dice junto a la cifra** (A-145): las rentabilidades se eligen para simular —un 2 %, un
  10 %—, no se prevén ni se prometen, y no es asesoramiento fiscal ni una recomendación de inversión.
- **Planes y EPSV (13-11-2026, decisión D-11).** `Planificación → Planes y EPSV` es un catálogo **aparte** de planes de
  pensiones y EPSV: su buscador, la ficha de cada uno con la evolución del valor de su participación, y la comparación de
  hasta cuatro. Un plan o una EPSV son patrimonio del cliente pero **no cartera** —no se gestionan con ella, por
  fiscalidad—, así que no salen en el Buscador, no se añaden a una cartera y no entran en ningún análisis ni informe; y la
  pantalla **no calcula ni recomienda**: cada cifra es la que da Morningstar por el buscador de planes del banco, con su
  fecha. **La única excepción, pedida por Óscar el mismo día:** el gráfico de la comparación pone las series en **base 100**
  para dibujarlas juntas (`src/core/planes/evolucionComparada.ts`), mes a mes, solo con meses cerrados y desde el primer mes
  que tienen todos; lo dice en pantalla, y sus cifras esperadas en las pruebas salen de una cuenta a mano. Cinco cosas que
  no se ven de un vistazo: **cada producto dice si es plan de pensiones o EPSV**, y lo decide el
  extractor con dos señales que tienen que coincidir (código de la DGSFP, y «EPSV» en el nombre): si no coinciden, no
  entra; **los datos viven en la base, detrás de la sesión, y nunca dentro del sitio**, porque no se pueden redistribuir;
  **la comisión es la que publica el banco** y falta donde no la pone —la de Morningstar y sus gastos corrientes se dejaron
  fuera por no cuadrar, con la medición en D-11—; **las rentabilidades llevan su propia fecha**, que puede ir meses por
  detrás del valor, y la pantalla lo avisa; y en la subida a la nube es una parte propia, **`--parte planes`**, que
  `--parte catalogo` no arrastra. Se refresca a mano: `python main.py planes` en el extractor, `npm run planes:write --
  --write --verify` en la plataforma y `node 4-base-nueva/guardar.mjs`. La ficha y la comparación van al final de la
  dirección (`/jubilacion/planes#plan=…`, `#comparar=…`).
- **Gestor de carteras (13-11-2026).** `Clientes → Carteras de clientes` —así se llama en el menú desde el 14-11-2026, por
  la decisión 2 del apartado 11 del sistema de diseño; en el código y en sus documentos sigue siendo el «Gestor de
  carteras»— ocupa el sitio de «Rendimiento» (`/cartera-real`):
  la cartera real de un cliente como libro de movimientos, importados de extractos o escritos a mano, con sus dos cuentas
  y su análisis entre fechas. Vive en `3-BDB-ACTIVOS_app/src/gestor/`, con su plan, su arquitectura y su progreso en
  `docs/gestor-carteras/`. Cuatro cosas que no se ven de un vistazo: **el cálculo corre en el navegador** —motor propio en
  TypeScript, `src/gestor/motor/`, puro y con cada cifra esperada de sus pruebas sacada de una cuenta a mano— porque **las
  carteras se guardan en ficheros del disco del asesor y no salen del equipo**: ni base ni Functions; de la plataforma solo
  lee precios, tipos de cambio, €STR y fichas, y por eso las reglas abren `fx_rates` y `reference_rates`. **Las series de
  acciones y ETF de la plataforma vienen ajustadas por dividendos y splits**, y el motor reconstruye el precio real con los
  dividendos del libro (`serieAjustada.ts`). **El precio que declara un extracto de posiciones del banco vale** cuando es
  más reciente que el de la plataforma. Y **la pantalla anterior de Rendimiento, «Análisis rápido de
  extractos», se retiró el 14-11-2026**, y sus cuatro Functions salieron de la lista de despliegue el 15-11; su motor en
  Python (`functions_python/portfolio_real/`) se borró el 17-11-2026 (A-188) y queda en la etiqueta de Git `referencia-portfolio-real-2026-11-17`. Los extractos reales con los que se mide son de un cliente:
  guiones y salidas, fuera del repositorio.
- **Arrancar el entorno:** no reconstruyas el orden leyendo el `README.md`. Usa la
  habilidad `arrancar-entorno` (`.claude/skills/`), que lleva los puertos, el JDK 21,
  la trampa del `::1` de Vite y los criterios de verificación.
- **Ejecutar el pipeline de datos:** usa la habilidad `pipeline-extractor`. Lleva el orden
  obligatorio, los gates, las reglas de propiedad de `metrics/latest` y la allowlist de
  proyecto, que desde el 30-10-2026 vive en **una sola constante**
  (`2-plataforma-datos/src/config/projectAllowlist.ts`) que dice `gestor-activos-local` y
  que importaban las comprobaciones de la base vieja (borradas el 21-11-2026, C-32; la constante se conserva): el código
  de aquí no puede escribir en el proyecto de BDB aunque las variables de entorno se equivoquen.
- **Cómo se trabaja con Oscar:** él toma las decisiones, pero espera trabajo conjunto
  y proactivo. Propón ideas y soluciones por iniciativa propia; analiza de verdad las
  que él proponga en vez de limitarte a aplicarlas; y avísale de errores y
  desviaciones en cuanto los veas, no al final.
- **Cada orden a una sesión de trabajo lleva el modelo y el esfuerzo adecuados a esa orden, fijados en
  los parámetros de la sesión y comprobados**, no solo escritos en el encargo (regla básica de Óscar,
  08-11-2026; el detalle y la guía por tipo de tarea, en `COORDINACION_SESIONES.md`). Escribirlo en el
  texto no cambia nada: la sesión hereda el modelo de quien la arranca, y el 07-11 cuatro sesiones
  anunciadas como Opus 5.5 corrieron con Fable 5.1.
- **Oscar sigue y decide en remoto**, desde el móvil u otro PC, sin programar. Lo que
  tenga que leer o decidir no se queda en texto de terminal: va como artefacto
  publicado —un enlace que abre en el móvil— o como fichero enviado, y la pregunta de
  cierre del turno lleva la decisión concreta, no un resumen.

## Documentos de la raíz

Solo queda aquí lo que describe trabajo **por hacer**, más la definición del
sistema, que es la línea base contra la que se mide ese trabajo. El diario de BDB
se retiró el 29-10-2026 y sigue en la historia de Git si hiciera falta.

- `DEFINICION_DEL_SISTEMA_2026-10-29.md` — qué hace el sistema hoy, con las cifras
  medidas. Es línea base, no plan: no se le añaden propuestas ni órdenes de trabajo.
- `LEGADO_CONOCIMIENTO_SISTEMA_2026-07-12.md` — convenciones no evidentes.
- `DESCUBRIMIENTO_ADQUISICION_DATOS_2026-09-04.md` — cómo rediseñar la adquisición.
- `FUENTES_PUBLICAS_FONDOS_*`, `PROGRAMA_DATOS_PUBLICOS_FONDOS_*`,
  `INFORME_PROGRAMA_DATOS_PUBLICOS_FONDOS_*`, `OPINION_DATOS_PUBLICOS_FABLE_*` —
  diseño, sin ejecutar, para obtener datos de fondos de fuentes públicas.
- `DECISIONES_ADQUISICION_2026-10-30.md` — el rumbo decidido sobre ese diseño y la
  capacidad medida de la maestra. Manda sobre los cuatro documentos anteriores.
- `METODO_PROPIO_METRICAS_2026-11-01.md` — **el método es nuestro**, no el de Morningstar ni el
  de un tercero, y sus parámetros los cambiamos nosotros. Es la definición a la que apunta
  `EXTRACTOR_MONTHLY_V1`: cada fórmula con su ventana, su frecuencia, su tipo libre de riesgo y
  su tolerancia, medido sobre el código. Lleva las dos reglas que lo gobiernan —el Sharpe no se
  suprime nunca, y nunca se ordena una cifra contra otra de escala distinta, **ni de estimador
  distinto**— y la consecuencia: cambiar un parámetro cambia la **versión** del método. Su §10 dice
  cómo se **retira** una cifra publicada, que es distinto de que falte.
- `DECISIONES_BASE_NUEVA_2026-11-01.md` — las decisiones de Óscar desde el día que la base
  nueva pasó del diseño al dato, con dónde se hace cumplir cada una y qué dejan abierto. No
  repite el por qué de cada campo: eso vive en la descripción de su contrato. La octava manda
  sobre las demás en todo lo que toque métricas: **nos fiamos de la serie, no de la cifra,
  porque la serie se puede auditar**. Tenemos serie, datos, cálculo y cifra; lo que la hace
  exacta y no solo afirmada es que cada eslabón se comprueba.
- `INDICE_DE_DECISIONES.md` — las cuatro series numeradas de decisiones (A auditoría, B datos, C base nueva,
  D adquisición), con su documento y su rango. Desde la B-69 (09-11-2026) **toda cita nueva lleva el prefijo
  de su serie**: los números se repiten entre series y «decisión 63» sola no dice cuál es.
- `CATALOGO_DATOS_FONDOS_2026-10-30.md` — qué datos necesita el programa para fondos y
  ETF y hasta dónde se consiguen sin licencias, campo a campo y medido. Es el primer
  paso del rumbo anterior, y lo que habilita las decisiones que quedaban abiertas.
- `CAMPOS_NECESARIOS_2026-10-30.md` — qué campos necesita de verdad el programa por fondo,
  separando los cálculos financieros de la composición de cartera, y por qué el SRI puede
  quedarse fuera. Medido sobre la maestra y sobre lo que la app consume.
- `INFORME_TECHO_COBERTURA_2026-10-30.md` — hasta dónde llega la cobertura con fuentes libres
  campo a campo, el coste de un proveedor con fuente primaria, y si compensa. Se apoya en el
  documento anterior.
- `SRI_SIN_KID_2026-10-31.md` — los 30 activos que publican SRI sin un KID de PRIIPs
  detrás, con tipo, SRI y nombre. Es una lista para pedir documentos, no para archivar:
  lo que queda de la cadena del SRI después de arreglar la lectura de la fecha y la del
  propio SRI. Nueve son ETF, que es el grupo difícil.
- `ENCARGO_TERCER_ESTIMADOR_2026-11-03.md` — encargo escrito para una sesión que no conoce
  el proyecto: medir el estimador `GEOMETRIC_CAGR` / `WEEKLY` que tienen 1.090 de los 1.097
  activos de la base vieja y que **ningún documento declara**. Lleva a propósito las **dos
  hipótesis** —que sea un tercer método, o que sea lo que uno de los dos declarados escribe
  de verdad y entonces el documento del método está mal— para que quien lo haga no herede la
  conclusión de la auditoría. Es de solo lectura y el entregable es un informe.
- `ENCARGO_SIN_METRICAS_2026-11-03.md` — el otro encargo para una sesión de fuera: por qué
  **149** de los 1.091 instrumentos de la base nueva no tienen `computed/metrics`, medido el
  03-11-2026 y clasificado por las tres razones de `x-absence`, que es lo que distingue un
  techo de la fuente de un trabajo pendiente. Corrige de paso la cifra que circulaba —«141
  fondos y ETF»—: son 149, y dentro hay 8 acciones y 1 OTHER. El hilo del que tira primero
  son los **18 ETF**, que son los 18 que hay: el 100 % de un tipo no lo explican datos que
  falten uno a uno.
- `INFORME_SIN_METRICAS_2026-11-03.md` e `INFORME_TERCER_ESTIMADOR_2026-11-03.md` — lo que
  respondieron esos dos encargos. Son del 03-11, y parte de lo que señalan ya está resuelto.
- `docs/historico-bdb/AUDITORIA_2026-11-03.md`, `PLAN_EJECUCION_2026-11-01.md` y `PLAN_INDEPENDENCIA_2026-11-01.md` —
  registro de cómo se llegó aquí. Lo pendiente de verdad está en
  [el informe de cierre](https://claude.ai/artifact/VHoLhhQE7SNhzMPe4S4kwv).
- `ESPECIFICACION_PROGRAMA_FUNDAMENTALES.md` — programa de fundamentales de
  acciones, aún sin construir.
- `PLAN_UNIFICAR_REPOSITORIOS_2026-11-10.md` — cómo se unificaron los cuatro repositorios en uno el 10-11-2026: las
  condiciones, el método (se conservan los hashes), cada sitio del código que usaba Git con lo que le pasó, y cómo se
  dio por bueno. **Ejecutado**: queda como registro, con lo que sigue a decisión de Óscar al final.
- `PREGUNTAS_CUMPLIMIENTO_2026-11-11.md` — las preguntas que el programa no puede decidir solo —catorce, una decimoquinta de Jubilación añadida el 13-11, una decimosexta, sobre la EPSV en renta, el 21-11, y tres más de la EPSV vasca el 22-11—, aprobadas por
  Óscar para enviarlas a cumplimiento, y donde se anotan las respuestas. De la sexta depende la decisión C-25, que deja
  por ahora sin ficha de cliente.
- `AUDITORIA_BACKEND_2026-11-15.md` — los 32 hallazgos de la auditoría del backend, cada uno con su estado y su decisión
  (serie A, A-146 a A-154), más lo que salió por el camino y sigue abierto. Documento de trabajo vivo.
- `AUDITORIA_INTEGRAL_2026-11-16.md` — los 92 hallazgos de la auditoría de todo el programa (aplicación, Gestor de carteras, Jubilación,
  backend, plataforma y extractor), cada uno con su estado, el contraste con la auditoría que ChatGPT hizo de BDB y las decisiones
  que esperan a Óscar. Los cuatro grupos y lo construido con sus decisiones (A-155 a A-170) están en producción desde el 16-11-2026; y la base
  y la nube, recalculadas con la versión 3 del método ese mismo día y con la versión 4 el 17-11-2026. Documento de trabajo vivo.
- `CENSO_CODIGO_HEREDADO_2026-11-16.md` — qué código heredado de la base vieja no usa ya nadie, pieza a pieza y con su
  evidencia: el paso previo al borrado que pide la decisión A-160. Lo MUERTO es candidato, no orden, y al final están las
  tres decisiones que el borrado necesita de Óscar.
- `consultas_backup_duckdb.py` — consultas SQL sobre las copias de la maestra.
