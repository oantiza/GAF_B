# Auditoría del frontend — registro de hallazgos

*13-11-2026. Encargo de Óscar: auditar a fondo el frontend (`3-BDB-ACTIVOS_app`), registrar cada hallazgo con su
gravedad, dónde está, cómo reproducirlo y su estado, y arreglarlo. Este documento es ese registro. El estado de las
fases está en `PROGRESO.md`; la propuesta de rediseño, en `SISTEMA_DISENO.md`. Las rutas de los hallazgos son
relativas a `3-BDB-ACTIVOS_app`.*

## Qué se ha auditado y cómo

La auditoría se hizo sobre el commit `8da9cb9d`, con tres fuentes que se complementan:

1. **Diez revisiones del código**, una por sección de la aplicación, más una de los informes, una del formato y el
   vocabulario en toda la app, y una del marco y las piezas comunes. Cada revisión leyó entero el código de su sección
   y apoya cada hallazgo en un fichero y una línea. Nueve fueron de solo lectura; la décima comprobó el motor del
   Gestor de carteras con **casos calculados a mano** y dejó sus pruebas en `tests/gestor/auditoria/`.
2. **Un recorrido automático en el navegador** (`scripts/auditoriaFrontend.mjs`): 28 pantallas en 1.920, 1.440 y
   768 px, con la cartera de muestra y la cartera de demostración del gestor. De cada una guarda la captura de página
   entera y mide el desborde horizontal, los errores y avisos de consola, las peticiones fallidas y los fallos de
   accesibilidad (axe-core, WCAG 2.2 AA). Su informe está en `capturas/antes/informe.md`.
3. **Pruebas a mano en el navegador** de los flujos principales: entrar, diseñar una cartera, y crear una cartera en
   el gestor, anotar movimientos, comprobar la valoración contra la base local de precios, cerrar y volver a abrir.

**Lo que dice el recorrido automático:** en las 84 capturas no hay ningún desborde horizontal, ningún error ni aviso
en la consola y ninguna petición fallida, y axe solo encuentra cuatro nodos que incumplen dos reglas. **Lo que dicen
las puertas del proyecto:** tipos sin errores, 5.407 pruebas en verde, lint limpio, censo de CSS limpio y compilación
dentro del presupuesto. La aplicación no está rota: los hallazgos están en lo que esas puertas no miden —pérdida de
trabajo en situaciones corrientes, cifras que cambian de una pantalla a otra o de la pantalla al informe, formatos y
palabras distintos para lo mismo, y pantallas que lo enseñan todo a la vez.

## Cómo se lee la gravedad

| Gravedad | Cuándo |
|---|---|
| **Crítica** | Una cifra equivocada que puede ver un cliente o decidir una inversión; pérdida de datos del usuario; una pantalla o un flujo principal que no funciona; un fallo de seguridad o de privacidad |
| **Alta** | Un flujo secundario roto; un error en consola en un flujo principal; cifras que no coinciden entre pantallas o entre pantalla e informe; una barrera de accesibilidad que impide usar una función; un informe con páginas cortadas o vacías |
| **Media** | Incoherencias de formato o de vocabulario; estados de carga, vacío o error que faltan; contraste insuficiente; problemas de adaptación entre 768 y 1.024 px; mensajes de error que no ayudan |
| **Baja** | Pulido; código muerto; duplicación; estilos sueltos; nombres confusos en el código |

Los anexos (`anexos/`) recogen lo que las revisiones midieron y no es un hallazgo: el mapa de cada pantalla, el
inventario de informes, el de formato y vocabulario, y el de piezas comunes, tokens y gráficos.

## Recuento

| Sección | Crítica | Alta | Media | Baja | Total |
|---|---|---|---|---|---|
| GES · Gestor de carteras: pantalla, almacén e importación | 3 | 7 | 13 | 6 | 29 |
| MOT · Gestor de carteras: motor y cifras, comprobados a mano | 1 | 0 | 2 | 8 | 11 |
| DIS · Diseño de cartera, Carteras guardadas y Posiciones | 0 | 3 | 14 | 12 | 29 |
| ANA · Análisis, Informes en pantalla y gráficos | 0 | 2 | 18 | 11 | 31 |
| ACT · Activos y Mercado: Buscador, ficha, Comparador, Mercado y Salud del catálogo | 0 | 2 | 17 | 9 | 28 |
| PLA · Planificación y Datos: Jubilación, Planes y EPSV, Sistema | 0 | 2 | 12 | 12 | 26 |
| MAR · Marco de la aplicación, piezas comunes y hojas de estilo | 0 | 2 | 12 | 19 | 33 |
| FMT · Formato de cifras y fechas, y vocabulario | 0 | 1 | 14 | 7 | 22 |
| INF · Informes y exportaciones | 0 | 2 | 21 | 10 | 33 |
| DIR · Recorrido en el navegador, pruebas a mano y medidas | 0 | 0 | 5 | 6 | 11 |
| **Total** | **4** | **21** | **128** | **100** | **253** |

**Estado a 14-11-2026, al cierre:** de los 253 hallazgos (los 244 de la auditoría y nueve que salieron en la fase de
cierre, el último visto por Óscar al probar la rama), **237 están corregidos**, cada uno con la prueba que lo vigila (uno, el alto de las pantallas, con la medida
del recorrido); 4 están corregidos en parte, con lo que queda
y por qué escrito en su fila; 7 están justificados; 2 ya no aplican, porque su pantalla se retiró; y 3 esperan una
decisión de Óscar. **No queda ninguno abierto sin motivo.** Los 4 críticos y los 21 altos están corregidos.

**Después del cierre, el mismo 14-11-2026 por la tarde:** Óscar vio el rediseño aplicado y pidió más color, los
gráficos y datos que se habían quitado y el aspecto de los informes de antes. Son quince cambios (COL-01 a COL-15), que
no cuentan como hallazgos: están en el registro, bajo «Revisión a petición de Óscar», todos hechos y con su prueba.
Abrieron tres decisiones, y Óscar tomó las tres ese mismo día: el corte del solapamiento se queda en el 40 %, los ETF
entran en la matriz del informe de cliente, y Sortino, Calmar y la rentabilidad de los últimos años se añaden a Carteras
de clientes. Están en «Decididas por Óscar el 14-11-2026».

## Lo que necesita una decisión de Óscar

Estos hallazgos no se pueden cerrar solo con código: su arreglo cambia lo que hace una función, toca el servidor,
añade una función nueva o decide algo de producto. Lo que no dependía de la decisión ya está arreglado, y el
estado de cada uno está en el registro de abajo.

### Abiertas

| Hallazgo | Qué hay que decidir | Recomendación |
|---|---|---|
| DIS-11 | El generador de borradores abre en el nivel 5 aunque nadie lo haya elegido y, al usar un borrador de nivel 3, la propuesta queda con «Perfil de riesgo: sin definir» | (a) Que el borrador fije el nivel de riesgo de la propuesta al usarlo, y que el generador abra con el nivel de la propuesta o sin nivel. Cambia lo que hace una función y por eso no se ha tocado |
| GES-13 | Una cartera de cliente retirada va a la subcarpeta `papelera/` de tu equipo, pero la aplicación no tiene dónde verla ni recuperarla | Añadir «Carteras retiradas», con «Recuperar». Es una función nueva |
| INF-15 | Hay dos documentos que se llaman «Informe de cartera» y dos «Informe de costes»: uno de la propuesta y otro de la cartera de cliente | Darles nombres distintos, por ejemplo «Informe de la propuesta» y «Informe de la cartera». Cambia el título de un documento que se entrega |
| GES-14 | Dos ficheros con el mismo identificador (una cartera copiada a mano en la carpeta) comparten sus copias de seguridad. Ya se avisa («Es una copia de…») y ya no se confunden en la lista ni al comparar | Añadir «Convertir en cartera nueva», que le da identificador propio y separa sus copias. Es una función nueva |


### Decididas por Óscar el 14-11-2026

| Hallazgo | Qué había que decidir | Qué decidió |
|---|---|---|
| ACT-01 | Si un activo con la serie de precios bloqueada por calidad (decisión 75: hoy Deoleo, Duro Felguera, Squirrel y Soltec) bloquea el botón de añadir, o se deja añadir con un aviso. La ficha y el Comparador lo bloqueaban con «No se puede proponer»; el Buscador, que no veía la marca, lo añadía sin decir nada | **Se puede añadir, y se avisa:** «Sin datos fiables para medirlo», junto al botón, igual en las tres pantallas. El programa sigue sin proponerlo por su cuenta y sin medirlo. Hecho (`fee50350`) |
| DIS-03 | Si se añade en el servidor el control que impide que dos equipos se pisen al guardar una propuesta (un cambio en una Function) | **Sí.** El servidor rechaza un guardado si la propuesta cambió desde que se abrió. Queda en el código y probado; **falta desplegarlo**, que no se hace desde aquí |
| COL (el corte del solapamiento) | Óscar dijo por la tarde «en fondos con un solapamiento mayor al 50 %»; el 12-11 lo había dejado en el 40 % para toda la aplicación (A-136). Se le preguntó cuál de los dos | **Se queda en el 40 %**, en la pantalla, en las frases y en la matriz de los dos informes (`SOLAPAMIENTO_ALTO`). No cambia nada en el código |
| COL (los ETF en la matriz del informe de cliente) | No entraban: su cartera completa viene del emisor, de uso interno (B-53, B-79), y con lo que publica el proveedor no llegan a la mitad. Se recomendó dejarlo así | **«No los dejes fuera».** La cartera completa del emisor mide el solapamiento en todas partes: Análisis, también en Modo cliente, y el informe de cliente. El cliente ve la cifra, no la cartera ni de quién es: en Modo cliente la pantalla dice «cartera completa, a tal fecha», y el papel no la nombra. Ningún papel lee esa cartera: el informe de cliente recibe el solapamiento ya medido de la pantalla. Revisa la B-79, que es de la serie de datos y la apunta Dirección. **En la nube no cambia nada todavía:** las carteras del emisor no están subidas (`nube:subir --con-cartera-del-emisor`, con su aprobación aparte) · prueba: tests/matrizDeSolapamientoConEtf.test.tsx, tests/informeDeClienteSeisHojas.test.ts, tests/barreraCarteraDelEmisor.test.ts |
| COL (Sortino, Calmar y los últimos años en Carteras de clientes) | Estaban en «Análisis rápido de extractos», retirada el mismo día (GES-09); Carteras de clientes no los tenía | **«Añádelos».** Con las definiciones que usaba el servidor: Sortino, el numerador del Sharpe entre la desviación a la baja semanal frente al tipo sin riesgo; Calmar, la rentabilidad anualizada entre la máxima caída; y la rentabilidad acumulada y anualizada de los últimos 1, 3 y 5 años |
| GES-09 | Cuándo se retira «Análisis rápido de extractos», que envía los extractos a la plataforma | **Al acabar el rediseño, no antes.** Con la pantalla se van sus dos informes (el de rendimiento de cartera real y el seguimiento periódico) y su historial de análisis |

### Decididas por Óscar el 13-11-2026, al aprobar el diseño

| Hallazgo | Qué había que decidir | Qué decidió |
|---|---|---|
| INF-05 | «Independent Private Bankers» sale impreso como sello, banda o autor en 10 de los 15 PDF | En los informes se imprime la identidad del asesor y desaparece el sello. Se aplica al unificar los informes |
| MAR-06 | El signo de las cifras solo tenía color en el Gestor de carteras | Verde y rojo para el signo de resultados y rentabilidades en toda la app y en todos los informes; ocre para los avisos |
| FMT-01 y el resto de FMT | Unificar el formato cambia cómo se imprimen algunas cifras en los PDF (decimales, signo, fechas) | Una sola regla por tipo de cifra, la misma en pantalla y en papel (`SISTEMA_DISENO.md`, apartado 6) |

### Decididas por la dirección del frontend, para que consten

No pedían una decisión de producto, pero cambian una cifra o un texto que se ve. Se aplican las reglas que el
proyecto ya tenía escritas.

| Hallazgo | Qué se ha hecho | Por qué |
|---|---|---|
| MOT-02 | Dos compras del mismo activo el mismo día son un solo lote a coste medio | No hay un orden dentro del día que justifique dos lotes distintos |
| MOT-07 | Un periodo de hasta 366 días no se anualiza | Un año natural bisiesto dura 366 días: es un año, no «más de un año» |
| INF-01 | La firma por defecto de un informe es el nombre de la cuenta con la que se ha entrado, no un nombre escrito en el código | Ningún documento sale firmado por quien no lo ha escrito |
| INF-19 | El VaR en euros del informe interno se aplica solo a la parte del capital que la serie mide, y lo dice | La serie mide la parte medida de la cartera; aplicarla a todo el capital afirmaba más de lo que se sabe |
| ANA-13 | El importe de cada posición en Análisis reparte el capital como el cuadro de costes (en proporción a los pesos con valor) | La misma posición valía distinto en dos pantallas |
| FMT (al aplicarlo) | Una diferencia entre dos porcentajes va en «pp» con dos decimales, también en una frase; el patrimonio, siempre en millones; el valor de la participación de un plan, con cinco decimales; lo que falta en un Excel, una celda vacía; la cifra de una crisis, en tinta. Están en `SISTEMA_DISENO.md`, apartado 6 | La misma cifra no puede escribirse de dos maneras en la misma hoja |
| MAR-12 | La tableta llega hasta 1.024 px inclusive, y cada corte de ancho se escribe de una sola manera | Un iPad apaisado mide 1.024 px y es una tableta: el menú ya lo trataba así y medio contenido no |
| PLA-25 | En el resumen de Análisis, la tabla de posiciones ocupa todo el ancho por debajo de 1.800 px y el reparto por clase va debajo; la maqueta los ponía lado a lado | Con las ocho columnas de la tabla real, en dos tercios de pantalla el nombre medía 185 px y la última columna no se veía |
| INF-25 | Los ficheros que se descargan se llaman «Documento - De quién - fecha», con tildes | Es la convención que ya usaba Carteras de clientes, y la que lee bien una persona en un correo o en una carpeta |
| INF-28 | En el informe interno, con más de 16 posiciones la matriz de correlaciones lleva solo el tono y al lado van las diez parejas más correlacionadas | A 3,4 pt las cifras no se leían impresas |
| PLA-21 | En Jubilación, las líneas de la respuesta al mes se redondean de forma que sumen la cifra que se enseña (cambia un euro el IRPF mensual en algunos casos) | La suma de las líneas no coincidía con el total impreso |

## Registro: todos los hallazgos y su estado

Ordenados por gravedad. La columna **Estado** es el único sitio donde se lleva el estado: «Abierto», «Corregido» (con su commit y su prueba), «Justificado» (con el motivo) o «Pendiente de Óscar». El detalle de cada hallazgo —dónde está, cómo reproducirlo, la evidencia y el arreglo propuesto— está más abajo, en su sección.

| Hallazgo | Gravedad | Categoría | Qué pasa | Estado |
|---|---|---|---|---|
| GES-01 | crítica | funcional | No hay aviso al salir: cambios perdidos al cerrar, recargar o cambiar de sección | Corregido · fase 2, `bb3a4255` · aviso al cerrar la pestaña, al volver a la lista y al cambiar de sección o enviar a Diseño; copia de rescate si no se pudo guardar · pruebas: tests/gestor/guardadoDeCartera.test.tsx, tests/gestor/salidaDesdeElMarco.test.tsx |
| GES-02 | crítica | funcional | Dos pestañas o dos equipos con la misma cartera: la última escritura borra la otra sin aviso | Corregido · fase 2, `bb3a4255` · el almacén detecta que el fichero cambió fuera de esta pestaña, no lo pisa, copia siempre lo del disco y ofrece recargar o guardar aparte · pruebas: tests/gestor/almacenCarpeta.test.ts, tests/gestor/guardadoDeCartera.test.tsx |
| GES-03 | crítica | funcional | Si la carpeta falla a mitad de sesión, no hay forma de rescatar los cambios | Corregido · fase 2, `bb3a4255` · en error: «Descargar una copia ahora» siempre activo y «Volver a dar permiso» sin salir de la cartera · prueba: tests/gestor/guardadoDeCartera.test.tsx |
| MOT-01 | crítica | cálculo | Un split en un activo sin serie de mercado dobla su valor | Corregido · fase 2, `bb3a4255` · un precio de operación, a mano o de extracto anterior a un split se divide por su razón, haya o no serie de mercado · prueba: tests/gestor/auditoria/defectos.test.ts |
| GES-04 | alta | cálculo | Editar un movimiento borra los campos que el formulario no enseña (cambia la valoración de un split) | Corregido · fase 2, `bb3a4255` · editar parte del movimiento original; casilla para el indicador del split · prueba: tests/gestor/formularioDeMovimiento.test.tsx |
| GES-05 | alta | cálculo | El precio que propone el formulario no sigue a la fecha y es el ajustado por dividendos | Corregido · fase 2, `bb3a4255` · el precio propuesto sigue a la fecha; con serie ajustada por dividendos se da solo como pista «aproximado» · prueba: tests/gestor/formularioDeMovimiento.test.tsx |
| GES-06 | alta | cálculo | «Cuentas» enseña posiciones de otra fecha que la que dice su campo | Corregido · fase 2, `bb3a4255` · Cuentas calcula a la fecha de su campo · prueba: tests/gestor/vistaCuentas.test.tsx |
| GES-07 | alta | cálculo | Un movimiento anterior de un activo que ya estaba no recarga sus precios | Corregido · fase 2, `bb3a4255` · la huella de los precios incluye el primer año de cada activo · prueba: tests/gestor/huellaDelMercado.test.ts |
| GES-08 | alta | incoherencia | El gestor no aplica Modo cliente: carteras de otros clientes e informe interno a la vista | Corregido · fase 2, `bb3a4255` · en Modo cliente no se listan otras carteras ni se ofrecen el informe del asesor ni el Excel · pruebas: tests/gestor/gestorModoCliente.test.tsx, tests/modoCliente.test.ts |
| GES-09 | alta | incoherencia | «Análisis rápido de extractos» manda los extractos al servidor; la página dice que nada sale del equipo | Corregido (`c8f3b802`) · «Análisis rápido de extractos» se retiró con sus dos informes y sus llamadas, como decidió Óscar el 14-11-2026 · prueba: tests/gestor/entradaDelGestor.test.tsx · sus cuatro Functions siguen en el servidor sin nadie que las llame: retirarlas es decisión suya |
| GES-10 | alta | funcional | Recuperar una versión o deshacer una importación no fuerza copia: la versión actual puede no quedar en disco | Corregido · fase 2, `bb3a4255` · copia obligada al recuperar una versión, deshacer una importación, borrar y retirar · pruebas: tests/gestor/almacenCarpeta.test.ts, tests/gestor/dialogoDeVersiones.test.tsx |
| DIS-01 | alta | cálculo | Optimizar deja el importe fijo antiguo y un cambio de capital deshace la optimización en esa posición | Corregido · fase 2, `bb3a4255` · al aplicar pesos, el importe fijo se sincroniza con el peso aplicado · prueba: tests/disenoImporteFijoTrasAplicarPesos.test.tsx |
| DIS-02 | alta | incoherencia | «Nivel de riesgo (n/10)» del optimizador no es el nivel de perfil de la cartera, y se llama igual | Corregido · fase 2, `bb3a4255` · el objetivo se llama «Posición en la frontera» y dice que no es el perfil de riesgo · prueba: tests/notaDeLaPropuesta.test.tsx |
| DIS-03 | alta | funcional | «Guardar» sobrescribe sin comprobar que la guardada no ha cambiado: dos pestañas o dos equipos se pisan | Corregido (`e2b3d240`) · el servidor rechaza un guardado si la propuesta cambió desde que se abrió, y el frontend le manda la fecha que esperaba · prueba: tests/guardadoCondicionadoBackend.test.ts · **falta desplegar la Function**, que no se hace desde aquí |
| ANA-01 | alta | informes | El informe de cliente descargado desde Análisis explica el solapamiento distinto que el de Informes | Corregido · fase 2, `bb3a4255` · las dos puertas del informe de cliente usan la misma función para montar su entrada · prueba: tests/informeDeClienteDosPuertas.test.tsx |
| ANA-02 | alta | cálculo | El tooltip del cono de proyección enseña el ancho de las bandas como si fuera un nivel | Corregido · fase 2, `bb3a4255` · el cono enseña mediana y los dos extremos de cada banda, e «Histórico» o «Proyección» · prueba: tests/conoDeProyeccionTooltip.test.tsx |
| ACT-01 | alta | funcional | Añadir a cartera: cuatro reglas distintas y el Comparador deja añadir lo que la ficha bloquea | Corregido · fase 2, `bb3a4255`, y `fee50350` · decisión de Óscar del 14-11-2026: lo bloqueado por calidad del dato se puede añadir, con el aviso «Sin datos fiables para medirlo»; lo que no está disponible sigue sin añadirse, y el Buscador decide con las marcas del servidor, como la ficha · pruebas: tests/buscadorMarcasDelServidor.test.tsx, tests/cadaUnoDiceLoSuyo.test.tsx, tests/comparadorDeActivos.test.tsx |
| ACT-02 | alta | cálculo | Buscador: el patrimonio sale siempre en «M€», aunque el fondo lo declare en otra divisa | Corregido · fase 2, `bb3a4255` · el patrimonio se escribe en su divisa y no se ordenan juntas divisas distintas · prueba: tests/buscadorNuevo.test.tsx |
| PLA-01 | alta | cálculo | «Sobran X €» va siempre en euros de hoy, sin decirlo, aunque la pantalla y el informe estén en euros de cada año | Corregido · fase 2, `bb3a4255` · lo que sobra se dice en las unidades elegidas, y el panel y el PDF dicen la unidad · prueba: tests/jubilacionLectura.test.ts |
| PLA-02 | alta | accesibilidad | Inspección: la ficha del activo no se abre con el teclado, y pulsar el nombre saca de Sistema | Corregido · fase 2, `bb3a4255` · botón «Inspeccionar» en cada fila, con teclado · prueba: tests/adminPantallasLocales.test.tsx |
| MAR-01 | alta | accesibilidad | La lista de carteras del Gestor no se puede abrir con el teclado | Corregido · fase 2, `bb3a4255` · una fila que se abre lleva un botón que recibe el foco · prueba: tests/tablaDeDatosTeclado.test.tsx |
| MAR-02 | alta | funcional | Un error en cualquier pantalla tumba la aplicación entera, menú incluido | Corregido · fase 2, `bb3a4255` · límite de error por pantalla: el menú sigue vivo; aviso de versión nueva si no llega un trozo · prueba: tests/limiteDePantalla.test.tsx |
| FMT-01 | alta | incoherencia | La comparativa de activos da la rentabilidad con dos decimales y signo en pantalla y con uno y sin signo en su PDF | Corregido · fase 2, `bb3a4255` · el PDF de la comparativa escribe rentabilidad, volatilidad y caída como la pantalla · prueba: tests/assetComparePdf.test.ts |
| INF-01 | alta | informes | Los documentos para el cliente salen firmados por defecto con el nombre de una persona real | Corregido · fase 2, `bb3a4255` · ningún nombre escrito en el código: firma por defecto el nombre de la cuenta de la sesión y, si no lo tiene, nadie · pruebas: tests/pdfReports.test.ts, tests/identidadDelInforme.test.tsx |
| INF-02 | alta | informes | Informe de cliente: hojas que no se parten y una tabla de 20 filas fijas pueden recortar filas y el total | Corregido · fase 2, `bb3a4255` · no se perdían filas, pero la hoja se apretaba y los datos se montaban: las filas se reparten por su alto medido · prueba: tests/informeDeClienteSeisHojas.test.ts |
| GES-11 | media | incoherencia | «Ingresos» y «costes» con el mismo nombre y cifras distintas entre Resumen, Análisis y el PDF del cliente | Corregido · medios y bajos, `69d8d50b` · cada cifra de ingresos y de costes lleva un rótulo que dice cuál es; ninguna cifra cambia · prueba: tests/gestor/arreglosMediosPantalla.test.tsx |
| GES-12 | media | estado | Un periodo imposible cae a «Desde el inicio» sin decirlo, con el rótulo del periodo elegido | Corregido · medios y bajos, `69d8d50b` · un periodo imposible lo dice junto al selector y el titular dice «desde el inicio» · prueba: tests/gestor/arreglosMediosPantalla.test.tsx |
| GES-13 | media | funcional | «Retirar la cartera» sin manejo de error, y sin vuelta atrás desde la app | Corregido (`bb3a4255`) · «Retirar la cartera» maneja su error: si mover el fichero a la papelera falla, lo dice y la cartera sigue en su sitio · prueba: tests/gestor/retirarQueFalla.test.tsx (escrita al cierre, `97e38777`), tests/gestor/guardadoDeCartera.test.tsx · Pendiente de Óscar: poder ver y recuperar una cartera retirada desde la aplicación, que es una función nueva |
| GES-14 | media | funcional | Dos ficheros con el mismo identificador comparten copias; retirar uno se lleva las del otro | Pendiente de Óscar · dos ficheros con el mismo identificador ya no se confunden y se avisa «Es una copia de…» (`69d8d50b`). «Convertir en cartera nueva», que separaría sus copias de seguridad, es una función nueva |
| GES-15 | media | estado | Diálogos largos se cierran con la X o Escape y pierden lo hecho; ajustes descarta el precio tecleado | Corregido · medios y bajos, `69d8d50b` · el formulario y el asistente preguntan antes de cerrar, y Ajustes no descarta un precio tecleado · prueba: tests/gestor/arreglosMediosFormularios.test.tsx |
| GES-16 | media | informes | El diálogo de informes solo avisa de errores, no de precios que faltan ni de datos de mercado no leídos | Corregido · medios y bajos, `69d8d50b` · el diálogo de informes repite los avisos del motor y los de mercado · prueba: tests/gestor/dialogoDeInformes.test.tsx |
| GES-17 | media | accesibilidad | Accesibilidad: botones repetidos sin nombre propio, errores no asociados, ayuda de 20 px | Corregido · nombres propios en los botones repetidos y errores enlazados a su campo (`69d8d50b`); el botón de ayuda es ya la nota emergente, de 24 px · prueba: tests/gestor/arreglosMediosFormularios.test.tsx, tests/piezas/notaEmergente.test.tsx |
| GES-18 | media | funcional | La tabla de movimientos vuelve a la página 1 tras cada edición o borrado | Corregido · medios y bajos, `69d8d50b` · la tabla de movimientos conserva su página tras editar o borrar · prueba: tests/gestor/arreglosMediosFormularios.test.tsx |
| GES-19 | media | incoherencia | El panel «cosas que revisar» cuenta mal | Corregido · medios y bajos, `69d8d50b` · «Cosas que revisar» cuenta bien y dice cuántas no caben · prueba: tests/gestor/arreglosMediosPantalla.test.tsx |
| GES-20 | media | incoherencia | Dos sistemas de formato y tres nombres para lo mismo | Corregido · formato único, `878d36a4` · src/gestor/ui/formato.ts ya delega en src/core/formato.ts (espacio duro, «sep», «Falta el dato»); core/format.ts borrado y «Análisis rápido» retirado · prueba: tests/gestor/formatoDelGestor.test.ts |
| GES-21 | media | estado | Los avisos de mercado enseñan el mensaje técnico del error tal cual | Corregido · medios y bajos, `69d8d50b` · los avisos de mercado dicen el motivo en lenguaje llano · prueba: tests/gestor/arreglosMediosMercado.test.ts |
| GES-22 | media | cálculo | Las cifras se leen con una regla ambigua y el formulario no enseña cómo las ha leído | Corregido · medios y bajos, `69d8d50b` · bajo cada cifra escrita sale «Leído como…» · prueba: tests/gestor/arreglosMediosFormularios.test.tsx |
| MOT-02 | media | cálculo | El orden en el fichero de dos movimientos del mismo tipo y día cambia las cifras | Corregido · fase 2, `bb3a4255` · las compras del mismo activo en el mismo día son un solo lote a coste medio, y varios cambios propios del mismo día se promedian por importe (convención nueva, escrita en libro.ts, valoracion.ts y ARQUITECTURA.md) · pruebas: tests/gestor/auditoria/defectos.test.ts, arreglosMot.test.ts |
| MOT-05 | media | cálculo | Observación: las comisiones de compra y venta van dentro de la «Variación de precio» | Justificado · es decisión de Óscar del 13-11-2026 para el informe del cliente: las comisiones de compra y venta se restan de la variación de precio, que el informe rotula «neta de comisiones y gastos». La pantalla lo dice ya en la propia fila (`5dcf578c`) · prueba: tests/gestor/arreglosMediosPantalla.test.tsx |
| DIS-04 | media | funcional | «Máx. por activo (%)» se reescribe en cada tecla: borrar deja un 1 y lo siguiente que se escribe se le añade | Corregido · medios y bajos, `69d8d50b` · los topes del optimizador se leen al salir del campo; una cifra fuera de rango se marca y desactiva Optimizar · prueba: tests/camposAcotadosDelOptimizador.test.tsx |
| DIS-05 | media | funcional | Un peso por encima de 100 se recorta en silencio, y «12.500» se lee como doce mil quinientos | Corregido · medios y bajos, `69d8d50b` · un peso por encima de 100 no se aplica y el campo dice cómo se ha leído · prueba: tests/tablaDePosicionesDeDiseno.test.tsx |
| DIS-06 | media | incoherencia | La misma frontera con tres ventanas: el optimizador no usa el periodo común de análisis | Corregido · Optimizar arranca en el periodo común (OptimizerPanel.tsx:149-152), avisa si se elige otro (:449-451) y rotula «3 años» (:33) · prueba: tests/disenoRedisenoPasos.test.tsx:316 |
| DIS-07 | media | incoherencia | El peso total se escribe con un decimal o con dos según la pantalla | Corregido · formato único, `878d36a4` · la suma de pesos sale con un decimal en todas partes (peso() en CarterasGuardadasPage:60, PortfolioBuilder, ImportPanel, OptimizationPreview, CambiosDePeso) · prueba: tests/carterasGuardadasPage.test.tsx:174 y tests/cambiosDePeso.test.tsx:64 |
| DIS-08 | media | incoherencia | Lo que falta se escribe «N/D» en pantalla, junto a «Falta el dato» y «No aplica» | Corregido · formato único, `878d36a4` · ya no hay «N/D» ni import de ND en src/components: usan Ausencia/oFalta («Falta el dato», «No aplica»); formato.ts devuelve null donde falta · prueba: tests/ausencia.test.tsx:35 y tests/formato.test.ts (invariantes) |
| DIS-09 | media | estado | Diseño no dice que está cargando, y la tabla enseña el ISIN aunque la posición traiga su nombre | Corregido · medios y bajos, `69d8d50b` · el nombre sale de la ficha, de la posición o del ISIN, y mientras carga dice «Leyendo…» · pruebas: tests/tablaDePosicionesDeDiseno.test.tsx, tests/disenoPaginaNotas.test.tsx |
| DIS-10 | media | accesibilidad | Las notas de la cartera no se anuncian | Corregido · medios y bajos, `69d8d50b` · la nota de la cartera se anuncia · prueba: tests/disenoAplicarYNotas.test.tsx |
| DIS-11 | media | incoherencia | Tres «perfiles» en la misma pantalla que no se hablan | Pendiente de Óscar · el generador de borradores abre en el nivel 5 y usar un borrador no fija el perfil de la propuesta. Cambia lo que hace una función: (a) que el borrador fije el nivel, recomendado, o (b) dejarlo y decirlo |
| DIS-12 | media | funcional | Carteras guardadas: no se puede duplicar, renombrar ni buscar, y «Eliminar» admite doble pulsación | Corregido · «Propuestas guardadas» busca por nombre, duplica, renombra y elimina, sin doble pulsación · prueba: tests/carterasGuardadasPage.test.tsx |
| DIS-13 | media | accesibilidad | Posiciones: «Ver» alternativas abre el bloque lejos, y los dos «Ver» de cada fila no se distinguen | Corregido · medios y bajos, `69d8d50b` · los botones de cada fila llevan el nombre del fondo y, al abrir las alternativas, el foco va a su título · prueba: tests/posicionesMediosYBajos.test.tsx |
| DIS-14 | media | incoherencia | Una diferencia de pesos se escribe «pp» y la de rentabilidad «puntos», en el mismo diálogo; y «Máx.»/«Máximo» | Corregido · formato único, `878d36a4` · CambiosDePeso usa puntos() «pp» en tabla y cifras («−1,51 pp»); objetivos «Máx. Sharpe» y «Mín. volatilidad» salen de constantes únicas (notaDeLaPropuesta.ts:19) · prueba: tests/cambiosDePeso.test.tsx:50,94 |
| DIS-15 | media | incoherencia | «Asignación táctica» no existe con ese nombre, y la herramienta que edita pesos por clase vive en Simular | Corregido · «Repartir por clase» está en la cabecera de Componer (PortfolioBuilder.tsx:855-875) y la ayuda de la aportación lo nombra igual (CapitalContributionPanel.tsx:159-163) · prueba: tests/disenoRedisenoPasos.test.tsx:220-230 |
| DIS-16 | media | incoherencia | Las dos exportaciones a CSV de la sección hablan formatos distintos | Corregido · el CSV de Diseño usa csvCell y downloadCsv: punto y coma, coma decimal y BOM, con cabeceras que relee el importador (PortfolioBuilder.tsx:795-808) · prueba: tests/disenoRedisenoPasos.test.tsx:289 y tests/portfolioBuilderTrabajoEnSesion.test.tsx:325 |
| DIS-17 | media | incoherencia | «Llevar a Diseño de cartera» bautiza la cartera «Extracto externo» y no dice qué ha entrado | Corregido · medios y bajos, `69d8d50b` · lo que se lleva a Diseño llega con nombre y fecha, y Diseño dice cuántas posiciones han entrado y cuáles no · pruebas: tests/posicionesMediosYBajos.test.tsx, tests/disenoPaginaNotas.test.tsx |
| ANA-03 | media | incoherencia | La cartera y la referencia cambian de color de un gráfico a otro | Corregido · el color sale del papel de la serie (chartTheme.ts:75-127): cartera índigo, referencia gris a trazos; caída sin rojo y mapa de una sola tinta (GeoDistributionMap.tsx:48) · prueba: tests/graficosPorPapel.test.tsx:81-142. Sin uso: ZONE_CHIP y zoneColor (regionTaxonomy.ts:184-198) · **Revisado el 14-11-2026 por decisión de Óscar (COL-01, COL-04):** el color sigue saliendo del papel de la serie, pero la referencia es tostada y a trazos, la caída de una sola serie va en rojo y el mapa lleva un color por zona |
| ANA-04 | media | accesibilidad | El mapa riesgo/rentabilidad no dice qué rombo es cada cartera de referencia ni qué miden los ejes | Corregido · ejes con título y cada cartera de referencia con su nombre junto al rombo (OaaRiskReturnChart.tsx:36, :138-141), y tabla alternativa sin la «z» · prueba: tests/graficosPorPapel.test.tsx:268 |
| ANA-05 | media | estado | Analítica avanzada convierte «faltan datos» y «tope del cálculo» en un fallo genérico, hasta tres veces | Corregido · medios y bajos, `69d8d50b` · «Reintentar» solo sale si reintentar puede arreglar algo; si faltan datos o hay un tope, se dice el motivo, una vez · prueba: tests/analiticaAvanzadaEstados.test.tsx |
| ANA-06 | media | estado | Con todos los pesos a cero, Analítica avanzada se queda en «Calculando series…» para siempre | Corregido · medios y bajos, `69d8d50b` · con todos los pesos a cero dice «Ninguna posición tiene peso» en vez de «Calculando…» · prueba: tests/analiticaAvanzadaEstados.test.tsx |
| ANA-07 | media | estado | Con una sola posición, Analítica avanzada desaparece entera | Corregido · medios y bajos, `69d8d50b` · con una sola posición la pestaña se pinta; solo las dos matrices piden dos · prueba: tests/analiticaAvanzadaEstados.test.tsx |
| ANA-08 | media | estado | Si falla la carga, Análisis e Informes enseñan el error y a la vez «Calculando…» para siempre | Corregido · medios y bajos, `69d8d50b` · si la carga falla no queda el texto de carga, e Informes conserva su cabecera · prueba: tests/analisisEInformesCargaFallida.test.tsx |
| ANA-09 | media | incoherencia | «Diferencial» con la referencia, sin unidad, al lado de porcentajes | Corregido · «Diferencia acumulada» en puntos porcentuales con Cifra tipo «puntos» (XrayAdvanced.tsx:422-426) · prueba: tests/analiticaAvanzadaParteMedida.test.tsx:85 |
| ANA-10 | media | incoherencia | La misma cifra con distintos decimales según el bloque | Corregido · formato único, `878d36a4` · tira y tabla de la comparativa usan la misma regla (rentabilidad 2 dec. con signo, volatilidad y caída 2, peso 1); la cabecera de caída ya solo da la fecha y el tooltip usa volatilidadDelGrafico · prueba: tests/tablaDeMetricasComparativas.test.tsx y tests/graficosPorPapel.test.tsx:206 |
| ANA-11 | media | incoherencia | Lo que falta se escribe «N/D» en unos bloques y «Falta el dato» en otros | Corregido · formato único, `878d36a4` · estrés, contribución al riesgo, matriz, tooltips y costes usan Ausencia/FALTA_EL_DATO; chartFormatters.ts ya no escribe «N/D» · prueba: tests/f5AnalyticsComponents.test.tsx:242 y tests/ausencia.test.tsx |
| ANA-12 | media | incoherencia | Las dos puertas del informe de cliente se comportan distinto | Corregido · Análisis e Informes abren el mismo diálogo del informe de cliente, que no se cierra mientras se genera · prueba: tests/informeDeClienteDosPuertas.test.tsx |
| ANA-13 | media | cálculo | El importe por posición de Análisis no coincide con el capital por posición de Costes si los pesos no suman 100 | Corregido · medios y bajos, `69d8d50b` · el importe de cada posición reparte el capital como el cuadro de costes, el pie es el capital y una nota avisa si los pesos no suman 100 · prueba: tests/tablaDeComposicion.test.tsx |
| ANA-14 | media | incoherencia | «Volatilidad sola 3A» sigue a 3 años cuando el análisis está a 5 | Corregido · la volatilidad de cada activo es la de la ventana elegida y el rótulo lo dice con palabras (tablaDeComposicion.tsx:47, :239) · prueba: tests/tablaDeComposicion.test.tsx:240 |
| ANA-15 | media | informes | Las crisis pasadas van en el PDF de Análisis, pero no se ven en Análisis | Corregido · «Frente a la referencia» pinta las crisis pasadas, y «Diversificación» no · prueba (`990a069d`): tests/frenteALaReferenciaCrisisPasadas.test.tsx |
| ANA-16 | media | incoherencia | Vocabulario: el mismo concepto con varios nombres | Corregido (`990a069d`) · un nombre por cosa: «Rentabilidad y riesgo» para el bloque de las cuatro cifras, «Mapa de riesgo y rentabilidad» para el mapa, «Por región» para el desglose y «Coste corriente medio» y «Retrocesión media» en pantalla y en papel, también en los rótulos que manda el servidor · prueba: tests/analiticaAvanzadaEstados.test.tsx, tests/cambiosDePeso.test.tsx, tests/portfolioImprovementPanel.test.tsx |
| ANA-17 | media | accesibilidad | El mapa geográfico tiene ocho paradas de teclado sin nombre dentro de una imagen | Corregido · el svg es role=group y cada zona, role=img con nombre y foco visible (GeoDistributionMap.tsx:127-150, charts.css:577) · prueba: tests/graficosPorPapel.test.tsx:407. Las filas y chips del desglose siguen solo con ratón (:84, :164) |
| ANA-18 | media | accesibilidad | Las dos matrices no se pueden leer sin ver ni sin ratón | Corregido · las dos matrices llevan tabla accesible con el nombre de cada activo y la cifra, y el solapamiento sus posiciones comunes (OaaCorrelationHeatmap.tsx:55, OaaOverlapHeatmap.tsx:181) · prueba: tests/graficosPorPapel.test.tsx:368 y :388 |
| ANA-19 | media | informes | Los nombres de los PDF no siguen una regla | Corregido (`990a069d`) · todos los ficheros se llaman igual: documento, de quién y fecha («Informe de costes - Familia García - 2026-11-14.pdf»), con tildes · prueba: tests/descargaDeFicheros.test.ts, tests/nombresDeLosInformes.test.ts |
| ANA-20 | media | rendimiento | La vista Informes sigue pidiendo los datos del Constructor | Corregido · medios y bajos, `69d8d50b` · la vista Informes ya no pide los datos del Constructor · prueba: tests/disenoPaginaNotas.test.tsx |
| ACT-03 | media | informes | Estrategia: al cambiar Diario/Semanal se ve y se descarga el informe anterior con el título nuevo | Corregido · medios y bajos, `69d8d50b` · al cambiar de tipo de informe no se ve el anterior, y PDF y compartir esperan · prueba: tests/estrategiaCambioDeTipo.test.tsx |
| ACT-04 | media | estado | Comparador: la primera carga monta, desmonta y vuelve a montar la pantalla | Corregido · medios y bajos, `69d8d50b` · el comparador espera la primera respuesta y se monta una sola vez · prueba: tests/comparadorPrimeraCarga.test.tsx |
| ACT-05 | media | funcional | Comparador: la selección del marco y la de la pantalla se pueden desincronizar | Corregido · el marco añade y quita de forma explícita, y el Comparador quita lo que el catálogo ya no devuelve y lo avisa · prueba: tests/comparadorPrimeraCarga.test.tsx |
| ACT-06 | media | cálculo | Calendario económico: los eventos sacados del informe de estrategia llevan una hora inventada, las 09:00 | Corregido · medios y bajos, `69d8d50b` · un evento sin hora dice «Sin hora» y va al final de su día · prueba: tests/calendarioEconomicoEnEspanol.test.tsx |
| ACT-07 | media | incoherencia | Ficha anterior (la de respaldo): «Último dato» ambiguo, dos «Coste corriente» y costes donde no aplican | Corregido · medios y bajos, `69d8d50b` · la ficha anterior rotula el último precio y la rentabilidad del año, da un solo coste corriente con su fuente y no enseña costes en una acción · prueba: tests/fichaAnteriorCoherente.test.tsx |
| ACT-08 | media | estado | Ficha nueva: si falla la otra lectura, los fundamentales desaparecen sin decir nada | Corregido · medios y bajos, `69d8d50b` · los fundamentales dicen que están cargando o que han fallado, con «Reintentar» · prueba: tests/fichaFundamentalesEIsin.test.tsx |
| ACT-09 | media | incoherencia | Comparador: la tabla de métricas no trae el coste corriente | Corregido · medios y bajos, `69d8d50b` · el comparador tiene la fila «Coste corriente» («No aplica» en una acción) · prueba: tests/comparadorCosteYEstrellas.test.ts. En el PDF entra al unificar los informes |
| ACT-10 | media | accesibilidad | Buscador: el filtro de producto se anuncia como pestañas y apunta a paneles que no existen | Corregido · medios y bajos, `69d8d50b` · el filtro de producto es un control segmentado, sin papel de pestaña · prueba: tests/buscadorFiltroYAnuncios.test.tsx |
| ACT-11 | media | accesibilidad | Buscador: el recuento de resultados no se anuncia al filtrar | Corregido · medios y bajos, `69d8d50b` · el recuento de resultados se anuncia tras el último cambio · prueba: tests/buscadorFiltroYAnuncios.test.tsx |
| ACT-12 | media | rendimiento | Rendimiento: ordenar por una cifra formatea miles de veces, y el selector pregunta al servidor en cada tecla | Corregido · el selector del Comparador espera entre teclas, la tabla calcula la clave de orden una vez por fila y el formato guarda sus formateadores · prueba: tests/selectorDelComparadorEspera.test.tsx, tests/piezas/tablaDeDatosPaso2.test.tsx |
| ACT-13 | media | incoherencia | Fechas con tres formatos distintos en la misma sección | Corregido · formato único, `878d36a4` · Estrategia usa fecha(); calendario y resultados comparten cabeceraDeDia con año (useAgendaDeMercado.ts:21); un día ISO no pasa por huso y un instante va en hora local · prueba: tests/formato.test.ts (fechas); sin prueba propia de cabeceraDeDia |
| ACT-14 | media | incoherencia | Vocabulario: el mismo concepto con varios nombres | Corregido (`990a069d`) · el listado del Comparador se llama «Elegir del catálogo» y rotula «Producto» y «Rentabilidad 1 año»; su botón dice «Aplicar la selección», porque también quita. «Región» del selector y «Región dominante» del Buscador conservan dos nombres porque son dos datos · prueba: tests/selectorYCatalogoDelComparador.test.tsx, tests/assetComparisonCatalog.test.tsx |
| ACT-15 | media | incoherencia | Colores con significado: el rojo, la terracota y el índigo dicen cosas distintas según el sitio | Justificado · en el sistema aprobado el ocre es «lo que pide la atención del asesor», y tanto «Dejó de cotizar» como «Falta el dato» lo son: no es una incoherencia, es la regla |
| ACT-16 | media | incoherencia | Rentabilidad: signo y decimales distintos según la pantalla | Corregido · formato único, `878d36a4` · Buscador, Comparador, listado modal, ficha e historial escriben la rentabilidad con formato.rentabilidad (+12,34 %, 2 decimales y signo) · prueba: tests/formato.test.ts (describe rentabilidad); sin prueba que cruce las pantallas |
| ACT-17 | media | funcional | Mercado: la pestaña no va en la dirección, y Tipos y curva del BCE se piden también en Dividendos y Resultados | Corregido · medios y bajos, `69d8d50b` · la pestaña de Mercado va en la dirección y el BCE solo se pide en su pestaña · prueba: tests/mercadoPestanaEnLaDireccion.test.tsx |
| PLA-03 | media | incoherencia | Un IRPF de cero se escribe «−0 €», en pantalla y en el informe de cliente | Corregido · medios y bajos, `69d8d50b` · Jubilación no escribe «−0 €» ni en pantalla ni en el informe · pruebas: tests/jubilacionLectura.test.ts, tests/jubilacionPantalla.test.tsx, tests/jubilacionPdf.test.ts |
| PLA-04 | media | funcional | Un importe ya escrito no puede volver a «sin escribir»: vaciar el campo conserva la cifra | Corregido · medios y bajos, `69d8d50b` · vaciar un importe lo deja sin dato, no en cero · prueba: tests/jubilacionPantalla.test.tsx |
| PLA-05 | media | funcional | «Tomar de la cartera activa» pisa los saldos y borra los costes escritos, sin preguntar | Corregido · medios y bajos, `69d8d50b` · «Cargar ejemplo» pregunta antes de sustituir lo escrito · prueba: tests/jubilacionPantalla.test.tsx |
| PLA-06 | media | funcional | Edades, años y rentabilidades en `input type="number"`: con coma decimal puede volver al valor anterior sin aviso | Corregido · medios y bajos, `69d8d50b` · los campos numéricos leen cifras en español y el error sale junto al campo · prueba: tests/jubilacionPantalla.test.tsx |
| PLA-07 | media | funcional | Evolución comparada: con tres o cuatro planes, si uno no coincide en el tiempo, desaparece el gráfico y el mensaje es falso | Corregido · medios y bajos, `69d8d50b` · la comparación dibuja el mayor grupo que coincide y nombra el que queda fuera · prueba: tests/planesEvolucionComparada.test.ts |
| PLA-08 | media | funcional | Retrocesiones: «Pasada en seco» y «Refrescar» tiran las ediciones de fila sin avisar, y guardar una fila vacía el formulario de alta | Corregido · medios y bajos, `69d8d50b` · «Refrescar» y «Pasada en seco» preguntan si hay filas sin guardar · prueba: tests/adminRetrocessions.test.tsx |
| PLA-09 | media | cálculo | Retrocesiones: la fecha «de hoy» se toma en UTC y entre las 00:00 y las 02:00 es la de ayer | Corregido · medios y bajos, `69d8d50b` · «hoy» es el día local en los dos sitios de la sección · prueba: tests/commercialRetroCsv.test.ts |
| PLA-10 | media | funcional | Operaciones: el desplegable de tipo de cada fila escribe en el universo a cada cambio, y «Retirar» una corrección no pide confirmación | Corregido · medios y bajos, `69d8d50b` · cambiar de tipo y retirar un activo se confirman, y no se lanzan dos reclasificaciones a la vez · prueba: tests/adminOperaciones.test.tsx |
| PLA-11 | media | funcional | Planes: el menú «Planes y EPSV» no devuelve a la lista desde una ficha o una comparación | Corregido · la página de Planes sigue a la dirección, también a lo que va detrás de la almohadilla, y el menú vuelve a la lista desde una ficha · prueba: tests/planesPantalla.test.tsx, tests/marcoRediseno.test.tsx |
| PLA-12 | media | incoherencia | Sistema: tres formatos de fecha y números sin punto de los millares | Corregido (`878d36a4`, `990a069d`) · Sistema y Datos escriben fechas, horas y millares con el módulo único, también los huecos de una serie en el inspector · prueba: tests/systemStatusPage.test.tsx, tests/adminPantallasLocales.test.tsx |
| PLA-13 | media | estado | Retrocesiones: tabla entera sin paginar, cuatro campos por fila, y los errores de una fila salen arriba del todo | Corregido · medios y bajos, `69d8d50b` · el error de una fila sale bajo su fila · prueba: tests/adminRetrocessions.test.tsx |
| MAR-03 | media | accesibilidad | El foco se escapa de los diálogos con Mayús+Tab, y el fondo no queda inerte | Corregido · fase 2, `bb3a4255` · la trampa de foco cubre el contenedor y el fondo queda inerte mientras hay un diálogo · prueba: tests/trampaDeFocoYFondoInerte.test.tsx |
| MAR-04 | media | estado | «Restablecer contraseña» con un correo mal escrito dice que es un problema de configuración | Corregido · fase 2, `bb3a4255` · «Restablecer contraseña» dice que el correo no tiene forma de dirección · pruebas: tests/authSecurity.test.ts, tests/authGateMensajesDelAcceso.test.tsx |
| MAR-05 | media | estado | El aviso de cifra no válida del campo de importe solo lo oye un lector de pantalla | Corregido · fase 2, `bb3a4255` · la nota de cifra no válida se ve junto al campo · prueba: tests/euroAmountInputInvalid.test.tsx |
| MAR-06 | media | incoherencia | El signo de una cifra tiene color en el Gestor y en ninguna otra pantalla, y su rojo es casi la terracota del aviso | Corregido (`990a069d`) · las clases `.pos` y `.neg` se han borrado: pintaban en tinta y sus tres usos no eran el signo de un resultado, que lo pinta la pieza Cifra · prueba: tests/hojasDelMarco.test.ts |
| MAR-07 | media | accesibilidad | Texto de tinta 3 sobre una fila seleccionada no llega a 4,5:1 | Corregido (`990a069d`) · sobre la fila elegida y bajo el ratón el apunte va en tinta 2 · prueba: tests/contrastePaleta.test.ts |
| MAR-08 | media | accesibilidad | En Firefox el deslizador de rango no enseña el foco | Corregido · fase 2, `bb3a4255` · el deslizador enseña el foco también en Firefox · prueba: tests/focoYPapelEnLasHojas.test.ts |
| MAR-09 | media | incoherencia | El menú lateral son botones, no enlaces: no se abre una pantalla en otra pestaña ni se copia su dirección | Corregido · cada entrada del menú es un enlace con su dirección, y los clics con modificador los resuelve el navegador (BdbActivosApp.tsx:130-132, :541) · prueba: tests/marcoRediseno.test.tsx |
| MAR-10 | media | accesibilidad | Pistas y errores de campo sin enlazar al campo; falta la pieza «Campo» | Corregido (`990a069d`) · los campos de un solo control usan la pieza Campo (Operaciones, Retrocesiones, Informes, la referencia y la revisión de una importación) y cada error de fila cita su campo. Los grupos de botones con nombre propio («Periodo», «Producto») y un área de texto de rótulo oculto no son campos de un control y se quedan · prueba: tests/adminOperaciones.test.tsx, tests/adminRetrocessions.test.tsx, tests/informesRediseno.test.tsx, tests/gestor/pasoRevisionCampos.test.tsx |
| MAR-11 | media | accesibilidad | Sin modo de contraste forzado: el foco es solo una sombra | Corregido (`990a069d`) · con colores forzados, la entrada activa del menú, la pestaña elegida y los distintivos llevan contorno con colores del sistema · prueba: tests/hojasDelMarco.test.ts · sin mirar en Windows con contraste alto |
| MAR-12 | media | adaptación | Veintiún puntos de corte distintos, con pares a 1 px y uno que contradice el ancho real del contenido | Corregido (`57ac89a9`) · un corte «por debajo de N» es `max-width: (N − 0,02)px` y uno «desde N», `min-width: Npx`; quedan 13 cortes de ancho, declarados con su motivo, y la tableta llega hasta 1.024 px inclusive · prueba: tests/cortesDeAncho.test.ts |
| MAR-13 | media | incoherencia | Tres sistemas de tabla con cabeceras distintas, y el Gestor estrena un cuarto | Corregido (`990a069d`) · la cabecera de las tablas escritas a mano tiene el peso, el tamaño y la tinta de la de la tabla común · prueba: tests/hojasDelMarco.test.ts · pasar cada tabla a la pieza queda fuera |
| FMT-02 | media | cálculo | `cifrasEnPantalla` convierte el punto de millar en coma decimal | Corregido · fase 2, `bb3a4255` · «1.500 €» ya no pasa a «1,500 €» · prueba: tests/glosarioDePantalla.test.ts |
| FMT-03 | media | incoherencia | Los avisos del motor del Gestor salen con fechas ISO, importes sin millares con guion y títulos con punto decimal | Corregido · medios y bajos, `69d8d50b` · los avisos del motor escriben fechas, importes y cifras en español · prueba: tests/gestor/auditoria/arreglosMedios.test.ts |
| FMT-04 | media | incoherencia | Pantalla e informe del asesor del Gestor escriben la misma cifra con otra unidad y otro símbolo de divisa | Corregido · formato único, `878d36a4` · pantalla e informes del asesor y cliente usan «pp» en celdas y código ISO («12.400,00 USD»); «p.p.» ya no existe en src · prueba: tests/informeInternoPlantilla.test.ts:97 y tests/gestor/formatoDelGestor.test.ts (la prosa del cliente aún dice «puntos porcentuales») |
| FMT-05 | media | incoherencia | El formateador común escribe «−0,00 %» y «−0,00» en lo que redondea a cero | Corregido · formato único, `878d36a4` · cifra() de core/formato.ts no escribe signo si el texto redondea a cero; los ocho parches locales ya no existen · prueba: tests/formato.test.ts:464 (nunca un cero con signo) y casos «redondea a cero» |
| FMT-06 | media | incoherencia | El valor de la participación de los planes y varios recuentos no llevan punto de millar en cuatro cifras | Corregido · formato único, `878d36a4` · numero/importe/precio agrupan siempre, también en cuatro cifras; el valor del plan sale con 5 decimales y millares; Admin, Versiones y Sistema usan el módulo único · prueba: tests/planesPantalla.test.tsx:424 y tests/ola4Formato.test.ts:8 |
| FMT-07 | media | incoherencia | El patrimonio de la ficha sale «500.000€» sin espacio, y «B€» para el billón | Corregido · formato único, `878d36a4` · patrimonio siempre en millones con espacio duro («1.007,8 M€», «3.500.000,0 M USD») sin «B»; ficha, lista y ficha anterior usan el mismo importeGrande (cifrasDeFicha.ts) · prueba: tests/cifrasDeFicha.test.ts |
| FMT-08 | media | incoherencia | Lo que falta se escribe de siete formas, y el «N/D» común sigue saliendo en pantalla | Corregido (`878d36a4`, `990a069d`) · el módulo único devuelve nulo y «N/D» no sale en ninguna pantalla ni informe; el anillo vacío, la nota de frecuencias, la procedencia de Operaciones y el Excel de Carteras de clientes lo dicen con las mismas palabras. «No disponible» se queda donde nombra un estado y lo explica (un activo que no se puede añadir, una media que no se puede dar) · prueba: tests/ausencia.test.tsx, tests/metricsFrequency.test.ts, tests/opsLocal.test.ts |
| FMT-09 | media | incoherencia | Septiembre es «sept» en la app y «sep» en el Gestor; algunos días llevan cero delante | Corregido · formato único, `878d36a4` · una sola lista de meses («sep»), fecha() con barras y cero delante, sin «sept» en el código ni day:2-digit sueltos; el Gestor importa el módulo único · prueba: tests/formato.test.ts:353 |
| FMT-10 | media | informes | La fecha de emisión de los PDF se escribe de cuatro maneras | Corregido · formato único, `878d36a4` · los PDF fechan con fechaLarga(): «13 de noviembre de 2026», sin día de la semana (comparePdf:391, costsPdf:66, assetComparePdf:399, weeklyReportPdf:69, jubilacionPdf:219…) · sin prueba propia: leído en los sitios |
| FMT-11 | media | incoherencia | El Gestor nombra sus métricas fuera del glosario, y su pantalla y su informe de cliente las llaman distinto | Corregido · pantalla (gestor/ui/textos.ts:54-65) y papel (secciones/comun.ts:54-61, cliente/notas.tsx:22, :27) dicen «Caída máxima» y «Rentabilidad anualizada»; y «Coste corriente» (BloqueIngresosYCostes.tsx:76) · prueba: tests/gestor/informesPdf.test.ts:130. El motor conserva sus nombres |
| FMT-12 | media | incoherencia | Dos nombres para cada informe y tres verbos para producirlo | Corregido (`990a069d`) · «Descargar» en todos los botones que bajan un fichero, y el informe interno se llama «Informe interno del asesor» en la pantalla, en su cabecera, en su título y en su fichero · prueba: tests/informesRediseno.test.tsx, tests/portfolioImprovementPanel.test.tsx, tests/informeInternoPlantilla.test.ts |
| FMT-13 | media | incoherencia | Siglas y sinónimos de rentabilidad sin explicar en pantalla y papel: YTD, TWR, TIR, «Retorno», «Rendimiento» | Corregido (`990a069d`) · «Rentabilidad por reparto, 12 meses» en la ficha y en Salud del catálogo: el sistema no dice «rendimiento» · prueba: tests/componerFichaFuentes.test.ts, tests/saludDelCatalogo.test.ts |
| FMT-14 | media | cálculo | La ficha convierte un coste ausente en «0,00 %» al justificar «Comparar su coste» | Corregido · medios y bajos, `69d8d50b` · un coste ausente ya no se convierte en 0,00 % · prueba: tests/fichaCosteAusente.test.ts |
| FMT-15 | media | incoherencia | El glosario se contradice: «Tipo de instrumento» pasa a «Producto» en su tabla y a «Tipo de activo» en su código | Corregido (`990a069d`) · «Producto» dice si algo es un fondo, un ETF o una acción, en el glosario, en las pantallas, en los informes y en el Excel; ya no «Tipo», «Tipo de activo» ni «Tipo de producto» · prueba: tests/glosarioDePantalla.test.ts, tests/adminOperaciones.test.tsx |
| INF-03 | media | informes | Rendimiento real: la numeración de página es fija y no cuadra si una hoja se desborda | Ya no aplica · realPortfolioPdf.tsx se retiró con Análisis rápido de extractos (decisión del 14-11-2026) |
| INF-04 | media | incoherencia | Documentos que se entregan salen en el papel interno, y los del Gestor sin la identidad del cliente que sí llevan los demás | Corregido · el tema se elige por destinatario en la comparativa de activos, la ficha y la estrategia (assetComparePdf.tsx:433, fichaDeActivoPdf.tsx:355, weeklyReportPdf.tsx:87), y el Gestor, el destinatario (gestor/informes/documento.tsx:57) · prueba: tests/comparativaDeActivosEnLaPlantilla.test.ts |
| INF-05 | media | informes | La marca «Independent Private Bankers» aparece en 10 de los 15 PDF, y en los del Gestor no | Corregido (`990a069d`) · el correo de «Compartir con cliente» de Estrategia lo firma el asesor con su nombre y su entidad, y sin ellos no firma nadie; ya no queda ninguna marca escrita en el código · prueba: tests/compartirEstrategia.test.tsx |
| INF-06 | media | informes | Textos de datos que llegan al papel sin pasar por el saneado de glifos | Corregido · todo el texto pasa por Texto, que sanea (plantilla/primitivas.tsx:18-35), y los nombres de la matriz interna por sanearTexto (internalPortfolioReportPdf.tsx:1724) · prueba: tests/pdfSafeText.test.ts y tests/propuestaDeCambioPdf.test.ts:191 |
| INF-07 | media | incoherencia | El dato que falta se escribe de ocho maneras, a veces en la misma página | Corregido · formato único, `878d36a4` · el papel usa textoDeAusencia («Falta el dato»/«No aplica»): sin «N/D» ni «—» en src/reports y src/gestor/informes, y realPortfolioPdf ya no existe · prueba: tests/informeInternoPlantilla.test.ts:97 (el Excel conserva «No disponible», NO_DISPONIBLE) |
| INF-08 | media | incoherencia | Tres maneras de numerar la página, y el informe principal del cliente no dice el total | Corregido · un solo pie «Página x de y» con render en la plantilla (plantilla/hoja.tsx:150), también en el informe de cliente · prueba: tests/plantilla/pie.test.tsx:29 |
| INF-09 | media | accesibilidad | Gráficos y matrices que solo se leen en color | Corregido (`990a069d`) · en la comparativa de propuestas B va a trazos largos, en el gráfico y en su leyenda: impresas en gris, A y B se distinguen · prueba: tests/comparativaSeisHojas.test.ts |
| INF-10 | media | incoherencia | Los formatos de número, puntos y fecha cambian de un informe a otro | Corregido (`878d36a4`, `990a069d`) · «pp», millares, espacio duro y fechas salen del módulo único en todos los informes; los puntos a revisar del interno también, y los meses son una sola lista en pantalla, en papel y en Excel · prueba: tests/internalPortfolioReport.test.ts, tests/gestor/informesExcel.test.ts |
| INF-11 | media | informes | El informe del cliente del Gestor dice que los precios son de mercado aunque alguno venga del extracto del banco | Corregido · medios y bajos, `69d8d50b` · la nota de los precios nombra las posiciones con precio del extracto, a mano, de operación y sin precio · prueba: tests/gestor/arreglosMediosInformes.test.ts |
| INF-12 | media | informes | Varios trozos de texto dentro de un mismo `Text`, el patrón que el propio proyecto prohíbe | Corregido · los textos de varias partes se escriben como una sola cadena (comparePdf.tsx:219, :294…); no queda <Texto> con literal y expresión sueltos (grep) · prueba: tests/assetComparePdf.test.ts:342 (solo esa comparativa); no se han generado las portadas |
| INF-13 | media | cálculo | Jubilación imprime «−0 €» al cliente | Corregido · medios y bajos, `69d8d50b` · el informe de jubilación no imprime «−0 €» · prueba: tests/jubilacionPdf.test.ts |
| INF-14 | media | incoherencia | Dos identidades del asesor que no se conocen entre sí | Corregido · una sola identidad persistida (core/identidadDelAsesor.ts) que leen el Gestor (DialogoDeInformes.tsx:18) y los demás informes (identidadDelInforme.ts:36-40) · prueba: tests/identidadDelAsesor.test.tsx |
| INF-15 | media | incoherencia | Dos informes de cliente y dos informes de costes con el mismo nombre y distinto diseño | Pendiente de Óscar · siguen dos documentos llamados «Informe de cartera» y dos «Informe de costes», uno de la propuesta y otro de la cartera de cliente. Cambiar el título de un documento lo decide él |
| INF-16 | media | incoherencia | Las exportaciones CSV y Excel no siguen un mismo formato | Corregido (`990a069d`) · el Excel de posiciones deja vacía la celda de lo que falta, como el de Carteras de clientes, y el CSV de Diseño sale del escritor común (punto y coma, coma decimal y BOM) · prueba: tests/globalPositionsXlsx.test.ts |
| INF-17 | media | incoherencia | Paleta del papel interno con dos aceros y dos cobres, y un tercer papel en la propuesta de mejora | Corregido · una sola paleta del papel con dos temas en plantilla/tema.ts; ningún hexadecimal fuera de la plantilla (grep en src/reports y src/gestor/informes) · prueba: tests/paletaDelPapel.test.ts (ninguna prueba falla aún con un hexadecimal suelto) |
| INF-18 | media | incoherencia | El mismo concepto se llama distinto en cada informe y en la pantalla | Corregido (`990a069d`) · «Caída máxima» en la comparativa de propuestas, en la tabla y en la frase · prueba: tests/comparativaSeisHojas.test.ts |
| INF-19 | media | cálculo | Informe interno: el VaR en euros se aplica a todo el capital, aunque la serie mida solo una parte | Corregido · medios y bajos, `69d8d50b` · el VaR en euros se aplica solo al capital medido y lo dice; sin cobertura conocida no da cifra en euros · prueba: tests/varEnEurosDelInterno.test.ts |
| INF-20 | media | cálculo | Lógica de dominio y cifras recalculadas dentro de los PDF | Corregido (`990a069d`) · la lógica que vivía dentro de los informes (exposición, geografía, la regla 1,25 / 0,80 y los umbrales de la correlación) está en `src/core`, pura y con su prueba; los informes la importan · prueba: tests/logicaDelPapelEnCore.test.ts |
| INF-21 | media | informes | Tablas largas que se parten sin repetir la cabecera | Corregido · una sola tabla de plantilla con cabecera fixed y filas sin partir (plantilla/tabla.tsx:96, :136), usada por los informes · prueba: tests/plantilla/piezas.test.tsx:79 |
| INF-22 | media | informes | Informe interno: saltos forzados y bloques indivisibles que pueden dejar hojas casi vacías | Corregido en parte (`990a069d`) · prueba de paginación del interno con 3 y con 40 posiciones: dentro de cada sección ninguna hoja queda por debajo de un tercio y ningún título se queda solo al pie · queda: la última hoja de tres secciones es corta, porque cada sección abre hoja · prueba: tests/informeInternoPlantilla.test.ts |
| INF-23 | media | incoherencia | La propuesta de mejora no lleva cabecera, portada ni autor, y su identidad no es ninguna de las dos | Corregido · la propuesta de mejora sale de la plantilla, tema interno, con documento, título, asunto e identidad (improvementProposalPdf.tsx:169-176) · prueba: tests/propuestaDeMejoraEnLaPlantilla.test.ts:64 |
| DIR-01 | media | funcional | Crear una cartera con la tecla Intro deja reabierto el diálogo «Nueva cartera» | Corregido · fase 2, `bb3a4255` · Intro en el nombre crea una sola cartera y el diálogo no se reabre · prueba: tests/gestor/entradaDelGestor.test.tsx |
| DIR-02 | media | incoherencia | «En qué está invertida» dice una liquidez distinta del efectivo que dice la línea de arriba, sin explicarlo | Corregido · medios y bajos, `69d8d50b` · «ingresos» y «costes» ya no nombran dos cifras distintas · prueba: tests/gestor/arreglosMediosPantalla.test.tsx |
| DIR-03 | media | cálculo | El formulario acepta un precio muy alejado del de mercado sin avisar | Corregido · fase 2, `bb3a4255`, y medios y bajos, `69d8d50b` · «Comprobaciones» avisa también del precio de una operación que se aleja más de un 20 % del de mercado de ese día · prueba: tests/gestor/auditoria/arreglosMedios.test.ts |
| DIR-04 | media | incoherencia | La barra superior enseña la «Cartera activa» de Diseño también dentro del Gestor de carteras | Corregido · el recuadro se llama «Propuesta en curso» y habla de la propuesta, no de la cartera del cliente (BdbActivosApp.tsx:134-173, navModel.tsx:30) · prueba: tests/appNavigation.test.tsx:142. Sigue visible dentro del Gestor, con ese nombre |
| DIR-05 | media | rendimiento | Pantallas que lo enseñan todo de una vez: hasta 6.700 px de alto | Corregido (`878d36a4`, `990a069d`) · medido a 1.440 px antes y después: Análisis 6.724 → 2.068 px; Buscador 6.000 → 2.396; ficha de ETF 4.187 → 1.334; ficha de fondo 3.780 → 1.339; análisis de una cartera de cliente 4.433 → 1.983; Planes 3.024 → 2.518 · medida: capturas/despues/informe.md, columna «Alto (px)» |
| GES-23 | baja | cálculo | Fechas de modificación e importación en UTC, mostradas como día local | Corregido · medios y bajos, `69d8d50b` · las fechas de modificación e importación son el día local · prueba: tests/gestor/arreglosMediosAlmacen.test.ts |
| GES-24 | baja | estado | El aviso de migración se pinta donde no se ve | Corregido · medios y bajos, `69d8d50b` · el aviso de migración se ve dentro de la cartera y el primer guardado deja copia · prueba: tests/gestor/entradaConCarpeta.test.tsx |
| GES-25 | baja | incoherencia | El color del signo no siempre coincide con el texto | Corregido · formato único, `878d36a4` · claseDelSigno y claseDelMes usan signoDe sobre los decimales escritos (ui/formato.ts, analisis/lectura.ts:21); los meses salen con signo vía escrito.rentabilidad · prueba: tests/gestor/auditoria/formatoDePantalla.test.ts:102 |
| GES-26 | baja | incoherencia | «Hoy» se fija al abrir la cartera; «pesos de hoy» con un periodo pasado | Corregido · medios y bajos, `69d8d50b` · «hoy» se recalcula al volver a la pestaña y los pesos dicen su fecha (sin prueba) |
| GES-27 | baja | funcional | La lista puede salir desfasada al volver de una cartera | Corregido · medios y bajos, `69d8d50b` · la lista no sale desfasada al volver de una cartera · prueba: tests/gestor/arreglosMediosAlmacen.test.ts |
| GES-28 | baja | código | Textos que no cuadran con el estado real (sin acceso a carpetas y comentarios) | Corregido · medios y bajos, `69d8d50b` · los textos dicen lo que pasa de verdad cuando no hay acceso a carpetas · prueba: tests/gestor/vistaComparar.test.tsx |
| MOT-03 | baja | cálculo | Una cifra que se escribe «0,00 €» se pinta en rojo | Corregido · fase 2, `bb3a4255` · el color del signo sale de la cifra ya redondeada: un cero pintado no lleva color · pruebas: tests/gestor/auditoria/defectos.test.ts, tests/gestor/vistaCuentas.test.tsx |
| MOT-04 | baja | cálculo | El formato de pantalla escribe «NaN €» con una cifra ausente | Corregido · fase 2, `bb3a4255` · una cifra ausente se escribe «Falta el dato», nunca «NaN» · prueba: tests/gestor/auditoria/defectos.test.ts |
| MOT-06 | baja | cálculo | Observación: el latente de un bono incluye el cupón corrido devengado | Corregido · medios y bajos, `69d8d50b` · la ayuda del latente, Cuentas y el informe del asesor dicen que el de un bono incluye el cupón corrido · prueba: tests/gestor/arreglosMediosPantalla.test.tsx |
| MOT-07 | baja | cálculo | Observación: un año natural bisiesto se anualiza | Corregido · medios y bajos, `69d8d50b` · hasta 366 días no se anualiza, y la convención está escrita en el motor y en ARQUITECTURA.md · prueba: tests/gestor/auditoria/arreglosMedios.test.ts |
| MOT-08 | baja | cálculo | Hallazgo (no es del motor): los tres formateadores no escriben igual la misma cifra | Corregido · formato único, `878d36a4` · pantalla, informe del asesor y core escriben igual: espacio duro, código ISO fuera del euro con millares, millares en 4 cifras, sin cero negativo, «pp» · prueba: tests/gestor/formatoDelGestor.test.ts y tests/formato.test.ts (invariantes) |
| MOT-09 | baja | cálculo | Observación: la pantalla fecha el inicio del periodo un día antes que el informe | Corregido · medios y bajos, `69d8d50b` · una sola regla para la fecha de inicio del periodo, en pantalla, informes, nombre de fichero y Excel · prueba: tests/gestor/arreglosMediosPantalla.test.tsx |
| MOT-10 | baja | cálculo | Observación: la tabla de contribución redondea cada celda por su cuenta | Corregido · medios y bajos, `69d8d50b` · el pie de la tabla de contribución cuadra con sus filas · prueba: tests/gestor/arreglosMediosPantalla.test.tsx |
| MOT-11 | baja | cálculo | Observación: el corte por fecha valor se aplica también a la cuenta de valores | Justificado · el corte por fecha valor de la cuenta de valores no lo usa ninguna pantalla ni informe; se deja como está y documentado en el motor |
| DIS-18 | baja | incoherencia | El diálogo «Importar cartera» trae también el Buscador y el generador; con la cartera vacía, «Ir al Buscador» sale dos veces | Corregido · el botón es «Importar» y el diálogo «Empezar o importar», solo con posiciones; con la propuesta vacía queda un único arranque (PortfolioBuilder.tsx:905-911, :1046-1055) · prueba: tests/disenoRedisenoPasos.test.tsx:243 y tests/disenoDeCarteraPantalla.test.tsx:151 |
| DIS-19 | baja | accesibilidad | El recuadro «Cartera activa» no dice si hay cambios sin guardar, y por debajo de 900 px pierde su nombre accesible | Corregido · el recuadro dice «sin guardar» y su nombre accesible es el texto entero, oculto solo a la vista bajo 900 px (BdbActivosApp.tsx:140-173, layout.css:918) · prueba: tests/appNavigation.test.tsx:134 y :142 |
| DIS-20 | baja | estado | El cálculo del optimizador no se anuncia ni se puede cancelar, y la revisión salta sola como modal | Corregido · medios y bajos, `69d8d50b` · el resultado del optimizador se anuncia en una región viva · prueba: tests/camposAcotadosDelOptimizador.test.tsx |
| DIS-21 | baja | incoherencia | El resumen de rechazos de la importación calla los que no son índices | Corregido · medios y bajos, `69d8d50b` · el resumen de la importación cuenta también las líneas rechazadas por otros motivos · prueba: tests/portfolioImportPanelSummary.test.tsx |
| DIS-22 | baja | incoherencia | Validación nombra por ISIN lo que queda fuera, y «1 activos invertibles» | Corregido · medios y bajos, `69d8d50b` · lo que queda fuera se nombra «Nombre (ISIN)» y el singular es correcto · prueba: tests/validacionDeLaCartera.test.tsx |
| DIS-23 | baja | cálculo | Aplicar una optimización redondea cada peso por su cuenta y la suma puede no cuadrar | Corregido · medios y bajos, `69d8d50b` · los pesos repartidos suman 100,00 (mayor resto) · prueba: tests/disenoAplicarYNotas.test.tsx |
| DIS-24 | baja | funcional | «Nueva carga» en Posiciones borra el extracto pegado sin preguntar ni deshacer | Corregido · medios y bajos, `69d8d50b` · «Nueva carga» pregunta antes de borrar lo analizado · prueba: tests/posicionesMediosYBajos.test.tsx |
| DIS-25 | baja | adaptación | La tabla de posiciones exige 560 px y su envoltorio no desplaza | Corregido · el envoltorio de la tabla de posiciones de Diseño desplaza en horizontal · prueba (`990a069d`): tests/hojasDelMarco.test.ts |
| DIS-26 | baja | funcional | Sustituir con «Mantener €» convierte la posición en «Importe fijo» sin decirlo, y «Cambiar» no se deshace | Corregido · medios y bajos, `69d8d50b` · con «Mantener €» el diálogo y la nota explican que la posición nueva queda con importe fijo · pruebas: tests/fundSwapModal.test.tsx, tests/disenoPaginaNotas.test.tsx |
| DIS-27 | baja | incoherencia | Fechas de guardado con mes abreviado | Corregido · formato único, `878d36a4` · textoDeGuardada y diaDeGuardada usan fechaYHora/fecha del módulo único: «Guardada el 28/10/2026 09:05» (core/textosDeCartera.ts:30) · prueba: tests/carteraActiva.test.ts:64 |
| DIS-28 | baja | código | Código: comentario huérfano y un filtro que no filtra | Corregido · medios y bajos, `69d8d50b` · comentario huérfano recolocado y un filtro que no filtraba, quitado (sin prueba: no cambia comportamiento) |
| ANA-21 | baja | rendimiento | `OaaLineChart`: la memorización no sirve y la tabla se construye con una búsqueda por fecha | Corregido · medios y bajos, `69d8d50b` · las filas del gráfico se montan con un índice por fecha y la memoria sirve · prueba: tests/oaaLineChartFilas.test.ts |
| ANA-22 | baja | incoherencia | El gráfico de caída no tiene leyenda y su eje no se alinea con el de evolución | Corregido · con más de una serie el gráfico de caída lleva leyenda con el trazo de cada una · prueba (`990a069d`): tests/caidaMaximaLeyenda.test.tsx |
| ANA-23 | baja | código | Paleta: comentarios que ya no describen los colores y un filtro que quita el color equivocado | Corregido (`990a069d`) · borrada `CATEGORICAL_SERIES_BESIDE_UNCLASSIFIED`, que no usaba nadie · prueba: tests/hojasDelMarco.test.ts |
| ANA-24 | baja | incoherencia | Las dos matrices tienen leyendas e índices distintos | Corregido · LeyendaDeLaRampa por clases con sus límites en las dos matrices, y los dos índices sin color (OaaCorrelationHeatmap.tsx:149, OaaOverlapHeatmap.tsx:243) · prueba: tests/graficosPorPapel.test.tsx:344 |
| ANA-25 | baja | accesibilidad | Sellos de calidad del dato con mayúsculas al azar y explicación solo en `title` | Corregido · el rótulo va siempre con mayúscula inicial (selloDeCalidad.ts:4) y la nota como texto para el lector, no en title (OaaChartFrame.tsx:25-39) · prueba: tests/selloDeCalidad.test.tsx |
| ANA-26 | baja | incoherencia | Fechas de crisis y tooltips con otro formato corto que el resto | Corregido · formato único, `878d36a4` · HistoricalStressCards y tooltipDate (chartFormatters.ts) usan fecha() del módulo único: «10/08/2020», sin Intl propio ni «sept.» · prueba: tests/f5AnalyticsComponents.test.tsx:160 |
| ANA-27 | baja | accesibilidad | `RiskContributionChart` anuncia una concentración estática como alerta | Corregido · medios y bajos, `69d8d50b` · la nota fija deja de anunciarse como alerta · prueba: tests/f5AnalyticsComponents.test.tsx |
| ANA-28 | baja | estado | Cuadro de costes: el error del PDF no se reintenta y el diálogo se cierra mientras se genera | Corregido · medios y bajos, `69d8d50b` · el fallo del informe de costes sale dentro del diálogo, con «Reintentar», y no se cierra mientras genera · prueba: tests/costsModalPdf.test.tsx |
| ANA-29 | baja | incoherencia | Comparador de carteras: la cartera B lleva el color del benchmark y las columnas van en otro orden | Corregido (`990a069d`) · la tabla del comparador de propuestas va A · B · Diferencia, en pantalla y en papel · prueba: tests/portfolioComparator.test.tsx, tests/comparativaSeisHojas.test.ts |
| ANA-30 | baja | código | «Estructura de la cartera» repite lo que ya está encima | Corregido (`990a069d`) · «Concentración por posición» enseña las cinco mayores y dice de cuántas («Las 5 mayores de 8») · prueba: tests/estructuraDeLaCartera.test.tsx |
| ANA-31 | baja | código | Duplicaciones menores de cálculo y formato | Corregido (`69d8d50b`, `5dcf578c`) · fuera la petición del resumen que no se usaba; la cobertura sale del módulo único; y el panel de la simulación usa la función común de caídas, una vez por serie · prueba: tests/analisisEInformesCargaFallida.test.tsx, tests/topeDeLaSimulacion.test.ts |
| ACT-18 | baja | accesibilidad | Ficha: del título principal se salta al nivel 3 | Corregido (`990a069d`) · las secciones de las dos fichas son `h2`, y la hoja las viste por su clase · prueba: tests/fichaNivelesDeEncabezado.test.tsx. El mismo salto en el resto de pantallas es el hallazgo MAR-32 |
| ACT-19 | baja | incoherencia | Selector del Comparador: clases escritas a mano, región sin traducir y filtros ocultos que siguen mandando | Corregido (`990a069d`) · las clases del selector salen del dato, con los nombres de toda la aplicación (también «Inmobiliario» y «Sin clasificar»), y la fila escribe la región con su nombre · prueba: tests/selectorYCatalogoDelComparador.test.tsx |
| ACT-20 | baja | código | Estrategia: claves de lista sacadas del texto, código muerto y un «N/D segmentos» | Corregido · medios y bajos, `69d8d50b` · claves estables, «Sin desglose» y confirmación antes de publicar · prueba: tests/estrategiaCambioDeTipo.test.tsx |
| ACT-21 | baja | funcional | Comparador: las estrellas de Morningstar no se redondean | Corregido · medios y bajos, `69d8d50b` · las estrellas se redondean y se acotan de 1 a 5 · prueba: tests/comparadorCosteYEstrellas.test.ts |
| ACT-22 | baja | estado | Buscador: el estado vacío de «Solo favoritos» y el primer sentido del orden | Corregido · medios y bajos, `69d8d50b` · texto propio cuando no hay favoritos, y el primer clic en una cifra ordena de mayor a menor · prueba: tests/buscadorFiltroYAnuncios.test.tsx |
| ACT-23 | baja | funcional | Ficha: un ISIN en minúsculas o con espacios no se encuentra | Corregido · medios y bajos, `69d8d50b` · el ISIN de la dirección se limpia y uno imposible no se busca · prueba: tests/fichaFundamentalesEIsin.test.tsx |
| ACT-24 | baja | código | Código: nombres que tapan globales, clases de otra pantalla y estilos en línea | Corregido · medios y bajos, `69d8d50b` · un estado ya no tapa el nombre global `window` · prueba: tests/nombresQueTapanGlobales.test.ts |
| ACT-25 | baja | adaptación | Salud del catálogo: tablas sin marco y un mensaje de error de desarrollo | Corregido · medios y bajos, `69d8d50b` · el error de Salud del catálogo se dice en lenguaje llano y el detalle técnico va al registro · prueba: tests/saludDelCatalogoError.test.tsx |
| PLA-14 | baja | incoherencia | Edad de jubilación con un cliente de más de 75 años: el aviso de rango no dice con qué calcula el motor | Corregido · medios y bajos, `69d8d50b` · los límites de los campos son los del motor · prueba: tests/jubilacionPantalla.test.tsx |
| PLA-15 | baja | funcional | Históricos: «Cargar» en una fila borra la tabla de la vista previa y no actualiza el recuento | Corregido · medios y bajos, `69d8d50b` · la carga de históricos fusiona por activo y descuenta los ya cargados · prueba: tests/adminLoopsUnmount.test.tsx |
| PLA-16 | baja | funcional | Operaciones: guardar una corrección añade el ISIN sin reiniciar los pasos, y el paso sugerido se salta la extracción | Corregido · medios y bajos, `69d8d50b` · volver a un paso reinicia los siguientes · prueba: tests/adminOperaciones.test.tsx |
| PLA-17 | baja | estado | Un administrador ve «Esta cuenta no tiene permisos» mientras se confirma su permiso | Corregido · la guarda espera al permiso y no dice que falta mientras se confirma (BdbActivosApp.tsx:244, :494) · prueba: tests/marcoRediseno.test.tsx:262 |
| PLA-18 | baja | incoherencia | Vocabulario: la misma cosa con dos nombres, y rótulos repetidos | Corregido · nombres enteros en la lista (tablaDePlanes.tsx:97-105), «Último refresco» una vez, «Copia de la maestra» igual, «Escribir» en peligro (AdminOperaciones.tsx:1473) · prueba: tests/mercadoYDatosRediseno.test.tsx:175. Sin uso: NOMBRE_DE_LA_VENTANA (planes/modelo.ts:172) |
| PLA-19 | baja | incoherencia | Ejes y cifras de los gráficos con formatos distintos | Corregido · formato único, `878d36a4` · los dos gráficos de Jubilación rotulan con importeTitular («2.000 €», «200.000 €») y el valor de participación sale «1.234,56789 €» (core/planes/lectura.ts) · prueba: tests/planesPantalla.test.tsx:424 y tests/planesLectura.test.ts:81 |
| PLA-20 | baja | accesibilidad | Accesibilidad menor: barra de progreso sin nombre, cifra principal no anunciada, orden sin `aria-sort` | Corregido · medios y bajos, `69d8d50b` · la cifra se anuncia, la barra de progreso tiene nombre y valor, y la tabla dice su orden · pruebas: tests/jubilacionPantalla.test.tsx, tests/adminLoopsUnmount.test.tsx, tests/adminPantallasLocales.test.tsx |
| PLA-21 | baja | cálculo | Las líneas que explican la cifra se redondean una a una y pueden no sumar | Corregido · medios y bajos, `69d8d50b` · las líneas de la respuesta al mes suman la cifra que se enseña (mayor resto); el IRPF es lo que va del bruto al neto · prueba: tests/jubilacionLectura.test.ts |
| PLA-22 | baja | código | Código que sobra | Justificado · la pestaña «Referencia técnica» solo la ve un administrador y no estorba al asesor |
| PLA-23 | baja | estado | Estado del sistema: la antigüedad se mide contra la hora de abrir la pestaña | Corregido · medios y bajos, `69d8d50b` · la hora se toma al llegar cada respuesta · prueba: tests/adminLoopsUnmount.test.tsx |
| PLA-24 | baja | estado | Planes: «Comparar» desactivado sin explicar por qué, y una dirección con un plan que no está se recorta en silencio | Corregido · medios y bajos, `69d8d50b` · los botones desactivados dicen por qué y se avisa del ISIN de la dirección que se descarta · pruebas: tests/jubilacionPantalla.test.tsx, tests/planesPantalla.test.tsx |
| MAR-14 | baja | accesibilidad | Pestañas usadas como filtro, con `aria-controls` a paneles que no existen | Corregido · medios y bajos, `69d8d50b` · Posiciones tiene pestañas de verdad con su panel, y los filtros de Planes y del Buscador son controles segmentados · pruebas: tests/posicionesMediosYBajos.test.tsx, tests/planesPantalla.test.tsx, tests/buscadorFiltroYAnuncios.test.tsx |
| MAR-15 | baja | accesibilidad | `SegmentedControl` mezcla dos patrones, y la opción elegida apenas se distingue | Corregido · fase 2, `bb3a4255` · un solo patrón (botones con estado pulsado) y la opción elegida lleva un filete · prueba: tests/controlSegmentado.test.tsx |
| MAR-16 | baja | accesibilidad | `MenuButton`: Tab no cierra, sin Inicio/Fin, la flecha no abre, y su Escape vive en el documento | Corregido · fase 2, `bb3a4255` · el menú de acciones se maneja entero con el teclado · prueba: tests/menuButtonTeclado.test.tsx |
| MAR-17 | baja | accesibilidad | Tamaños de letra por debajo de 12 px, y el token dice que no los hay | Corregido (`990a069d`) · el rótulo de eje del plano de riesgo sube a 12 px · prueba: tests/hojasDelMarco.test.ts |
| MAR-18 | baja | código | `--ficha-*` duplica diez tokens existentes; dos dialectos de hoja | Corregido (`990a069d`) · la hoja de la tabla no tiene espaciados fuera de la escala · prueba: tests/hojasDelMarco.test.ts |
| MAR-19 | baja | código | Valores sueltos: px, tamaños fuera de escala, `z-index` y `!important` | Corregido (`990a069d`) · ningún `z-index` con número; el color del navegador es el del marco; la animación sin uso, borrada. Queda el color del triángulo del desplegable, que va dentro de un SVG incrustado donde no cabe una variable · prueba: tests/hojasDelMarco.test.ts |
| MAR-20 | baja | código | La paleta de `theme.ts` tiene comentarios de otra paleta, y una secuencia quita el color equivocado | Corregido (`990a069d`) · borrados `ZONE_CHIP`, `zoneColor` y `ZONE_RAMPS`, que no usaba nadie · prueba: tests/hojasDelMarco.test.ts · **Revisado el 14-11-2026 (COL-01):** vuelven los tres, porque el mapa vuelve a llevar un color por zona |
| MAR-21 | baja | código | Avisos sin pieza: `.notice` escrito a mano 167 veces y 36 clases de aviso | Corregido en parte (`990a069d`) · no queda ningún aviso escrito a mano con la clase `notice` (eran 167): los pinta la pieza Aviso y la clase se ha borrado · queda: 15 alias de módulo (la nota con filete y sin fondo) en 25 sitios, que se ven distinto de la pieza; unificarlos cambia estados que el recorrido de capturas no cubre (una importación a medias, una frontera parcial) · prueba: tests/avisosEnSuPieza.test.ts, tests/piezasComunes.test.ts |
| MAR-22 | baja | estado | La guarda de las pantallas de datos no espera al permiso | Corregido · la guarda usa el estado de carga del permiso y no niega mientras se confirma (BdbActivosApp.tsx:244, :494) · prueba: tests/marcoRediseno.test.tsx:262 |
| MAR-23 | baja | accesibilidad | Semántica del marco: `aria-current` en la ficha, puntos de referencia y secciones del menú | Corregido · «location» en la ficha, nav con nombre, cada grupo es una lista con su nombre y la miga no es nav (BdbActivosApp.tsx:459, :730, :748, :792) · prueba: tests/marcoRediseno.test.tsx:186 y tests/buscadorIntercambio.test.tsx:256 |
| MAR-24 | baja | accesibilidad | Avisos de la barra que pueden no anunciarse | Corregido (`990a069d`) · en el acceso, la región de estado está montada siempre y solo cambia su texto, que es lo que un lector de pantalla anuncia · prueba: tests/authGateRegionesVivas.test.tsx · sin probar con un lector |
| MAR-25 | baja | accesibilidad | `TablaComparativa`: marco no enfocable, esquina vacía y aviso que se desplaza con la tabla | Corregido · fase 2, `bb3a4255` · el marco de la tabla comparativa recibe el foco y tiene nombre; las notas quedan fuera del desplazamiento · prueba: tests/tablaComparativa.test.tsx |
| MAR-26 | baja | incoherencia | `cifrasEnPantalla` y `textoEnPantalla` tratan cualquier punto como decimal y separan el % de forma distinta | Corregido · fase 2, `bb3a4255` · el punto de millar se respeta y delante de «%» va un solo tipo de espacio · prueba: tests/glosarioDePantalla.test.ts |
| MAR-27 | baja | informes | La impresión con Ctrl+P oculta `.ui-button`, pero no los botones nativos ni los diálogos abiertos | Corregido · fase 2, `bb3a4255` · al imprimir no salen los botones ni los diálogos · prueba: tests/focoYPapelEnLasHojas.test.ts |
| MAR-28 | baja | código | Documentación de estilos desfasada | Corregido (`990a069d`) · el LÉEME de estilos lista todas las hojas y dice las reglas de hoy: el color del signo y los cortes de ancho · prueba: tests/hojasDelMarco.test.ts |
| MAR-29 | baja | accesibilidad | El desplazamiento suave ignora «reducir movimiento» | Corregido · fase 2, `bb3a4255` · el desplazamiento suave pedido desde código mira «reducir movimiento» · prueba: tests/desplazamientoSuave.test.ts |
| MAR-30 | baja | incoherencia | La cartera de referencia no se sincroniza entre pestañas; el Modo cliente sí | Corregido · fase 2, `bb3a4255` · la cartera de referencia se sincroniza entre pestañas · prueba: tests/carteraDeReferenciaEntrePestanas.test.tsx |
| MAR-31 | baja | accesibilidad | Acceso: `aria-invalid` en los dos campos ante cualquier error y el código TOTP del diálogo no confirma con Intro | Corregido · fase 2, `bb3a4255` · el acceso marca solo el campo con error y el código de verificación confirma con Intro · pruebas: tests/authGateMensajesDelAcceso.test.tsx, tests/accountSecurityDialogTokenRefresh.test.tsx |
| FMT-16 | baja | incoherencia | Espacio normal antes de «%» y, en el Gestor, antes de «€»: la cifra y su unidad se pueden separar al partir la línea | Corregido en parte (`878d36a4`, `990a069d`) · toda cifra que escribe el módulo único lleva espacio duro antes de «%», «€» y «pp», también en la cartera de referencia, los puntos a revisar del interno y el generador de borradores · queda: unos 160 porcentajes escritos a mano dentro de frases fijas («vigilar desde 25 %»), con espacio normal; cambiarlos toca 40 ficheros y sus pruebas sin cambiar ninguna cifra · prueba: tests/formato.test.ts, tests/carteraDeReferencia.test.ts |
| FMT-17 | baja | incoherencia | Fecha y hora en tres formas | Corregido · formato único, `878d36a4` · fechaYHora() única («13/11/2026 14:30»); DialogoDeVersiones, SystemStatusPage y textoDeGuardada la usan; un día sin hora no inventa «00:00» · prueba: tests/formato.test.ts:338 |
| FMT-18 | baja | incoherencia | Ejes en euros: «250 mil €» en unos gráficos y «250 k€» en otro | Corregido · formato único, `878d36a4` · todos los ejes en euros usan importeTitular («200.000 €»); ya no hay «k€» ni «mil €» en src (GraficosDeJubilacion.tsx:32, jubilacionPdf.tsx:96) · sin prueba propia: grep sin resultados |
| FMT-19 | baja | cálculo | «Hoy» y el día de un instante calculados en UTC en tres sitios | Corregido · «hoy» es el día local en los tres sitios, también en el informe interno · prueba: tests/commercialRetroCsv.test.ts, tests/informeInternoPlantilla.test.ts |
| FMT-20 | baja | código | Dos lectores de cifras con reglas distintas, y los porcentajes en `type="number"` | Corregido en parte (`990a069d`) · un solo lector para la cifra tecleada (`core/cifraTecleada.ts`, el del motor del gestor) en el campo de cifra acotada, que ya es de texto y dice cómo ha leído, en el de importe y en Jubilación · queda: diez porcentajes en `type="number"` que confirman al teclear; pasarlos cambia cuándo se aplica el valor · prueba: tests/cifraTecleada.test.ts, tests/camposDeCifraTecleada.test.tsx |
| FMT-21 | baja | incoherencia | «Borrar» y «Eliminar» para lo mismo en la misma pantalla | Corregido (`990a069d`) · en retrocesiones, «Eliminar» y «Descargar en Excel» · prueba: tests/adminRetrocessions.test.tsx |
| FMT-22 | baja | incoherencia | Jerga de configuración sin tildes en un mensaje de error de la base nueva | Corregido (`990a069d`) · el mensaje de la base sin conexión va en español llano; lo técnico, a la consola · prueba: tests/baseNuevaCaminoDeProduccion.test.ts |
| INF-24 | baja | accesibilidad | Faltan metadatos de idioma, y el autor del PDF es una entidad | Corregido · el PDF dice su idioma y su autor es el asesor · prueba (`990a069d`): tests/propuestaDeCambioPdf.test.ts |
| INF-25 | baja | incoherencia | Seis convenciones de nombre de fichero, y varios no dicen de qué cliente son | Corregido (`990a069d`) · una sola convención de nombre, la de Carteras de clientes, en `core/descargaDeFicheros.ts` · prueba: tests/nombresDeLosInformes.test.ts |
| INF-26 | baja | funcional | La descarga se reimplementa 18 veces y 12 sueltan el enlace en el acto | Corregido (`990a069d`) · una sola función descarga, y suelta la dirección un minuto después; ningún fichero de la aplicación lo hace ya a mano · prueba: tests/descargaDeFicheros.test.ts |
| INF-27 | baja | código | Piezas reimplementadas en cada informe | Justificado · `Sheet` y `KpiGrid` son la disposición propia del informe interno, que es el único de dos columnas; la descarga y el nombre, que sí se repetían, son ya uno |
| INF-28 | baja | accesibilidad | Letra por debajo de 6 pt | Corregido (`990a069d`) · ninguna letra del informe interno baja de 6 pt: con más de 16 posiciones la matriz lleva solo el tono, con su escala, y al lado van las diez parejas más correlacionadas, a tamaño normal · prueba: tests/informeInternoPlantilla.test.ts |
| INF-29 | baja | informes | Excel del Gestor: el filtro de la hoja Resumen abarca la ficha y los puntos se guardan como porcentaje | Corregido · medios y bajos, `69d8d50b` · en el Excel, el filtro abarca solo las métricas y los puntos llevan su formato · prueba: tests/gestor/arreglosMediosInformes.test.ts |
| INF-30 | baja | rendimiento | Rendimiento: fuentes y registro | Justificado · las fuentes se registran por documento a propósito, para que el segundo PDF de una sesión no pierda letras |
| INF-31 | baja | incoherencia | Comparativa de carteras: «Valores en euros» bajo un gráfico en base 100 | Corregido · medios y bajos, `69d8d50b` · el eje dice «Base 100, calculado en euros» · prueba: tests/portfolioComparisonPdf.test.tsx |
| INF-32 | baja | cálculo | Informe de cliente: los importes por posición pueden no sumar el total | Corregido · medios y bajos, `69d8d50b` · los importes por posición suman el total impreso (mayor resto) · prueba: tests/importesDelInformeDeCliente.test.ts |
| INF-33 | baja | código | Rendimiento real: la fecha puede salir en ISO crudo y la tabla de clases está duplicada | Ya no aplica · realPortfolioPdf.tsx se retiró con Análisis rápido de extractos (decisión del 14-11-2026) |
| DIR-06 | baja | incoherencia | El importe que propone el formulario de movimiento sale sin formato español | Corregido · fase 2, `bb3a4255` · el importe propuesto se escribe con formato español · prueba: tests/gestor/formularioDeMovimiento.test.tsx |
| DIR-07 | baja | incoherencia | «Precio por título» en una suscripción de fondo | Corregido · fase 2, `bb3a4255` · «Valor liquidativo» en suscripción, reembolso y traspaso · prueba: tests/gestor/formularioDeMovimiento.test.tsx |
| DIR-08 | baja | incoherencia | «Año en curso» empieza el 31 de diciembre en una cartera y el 1 de enero en otra | Corregido · medios y bajos, `69d8d50b` · la pantalla y el informe fechan igual el inicio del periodo · prueba: tests/gestor/arreglosMediosPantalla.test.tsx |
| DIR-09 | baja | incoherencia | El calendario económico se enseña en inglés y con abreviaturas de la fuente | Corregido · medios y bajos, `69d8d50b` · el calendario dice «Previsión» y «Anterior», escribe las magnitudes en español y explica de quién son los nombres · pruebas: tests/calendarioEconomicoEnEspanol.test.tsx, tests/euroYieldCurveChart.test.tsx |
| DIR-10 | baja | accesibilidad | Accesibilidad medida con axe: dos reglas incumplidas en 28 pantallas | Corregido · las pestañas usadas como filtro son ya grupos de opciones y la lista de indicadores de Estrategia tiene una estructura válida · prueba: tests/buscadorFiltroYAnuncios.test.tsx, tests/controlSegmentado.test.tsx, tests/planesPantalla.test.tsx. Medido con axe el 14-11-2026 en las 68 pantallas a 1.440 px y, por primera vez, también a 1.280, 1.024 y 768: ninguna regla incumplida (capturas/despues/informe.md) |
| DIR-11 | baja | rendimiento | Peso de los paquetes: cuatro pantallas descargan entre 550 y 720 KiB la primera vez | Justificado · medido el 14-11: la entrada pesa 127 KiB (presupuesto 130) y los motores de PDF y de Excel solo se cargan al usarlos; la primera visita a Diseño añade 612 KiB, 186 de Firebase y 102 de gráficos, que quedan en caché para las demás. Dar nombre al trozo de gráficos lo metía en la entrada (+118 KiB, probado dos veces): se deja al empaquetador |

### Encontrados en la fase de cierre (14-11-2026)

Salieron al revisar en el navegador las pantallas ya rediseñadas, en anchos y con medidas que el recorrido de «antes» no tenía.

| Hallazgo | Gravedad | Categoría | Qué pasa | Estado |
|---|---|---|---|---|
| PLA-25 | media | adaptación | El nombre se queda sin sitio en la tabla: de cuatro a siete líneas por fila en Planes, en Análisis y en Cuentas | Corregido (`990a069d`) · los títulos de columna se parten en toda tabla, una columna puede declararse «nombre» (con ancho mínimo) y la tabla de posiciones del resumen de Análisis ocupa todo el ancho por debajo de 1.800 px · prueba: tests/tablasQueNoSeAprietan.test.tsx, y el recorrido mide las «tablas apretadas» |
| GES-29 | media | accesibilidad | Las tablas de Carteras de clientes que desplazan en horizontal no se alcanzan con el teclado | Corregido (`57ac89a9`) · los cinco envoltorios de tabla del gestor son, como el marco de la tabla común, un grupo con nombre en el orden del tabulador · prueba: tests/gestor/tablasQueDesplazan.test.tsx |
| PLA-26 | baja | adaptación | Sistema · Calidad de fondos: en tableta, cada fondo ocupa 231 px de alto | Corregido (`e632bb82`) · la tabla común admite una columna de prosa, que no baja de un ancho de lectura (45 caracteres); en «Calidad de fondos» el nombre y el motivo declaran lo que son y la tabla desplaza dentro de su marco · prueba: tests/tablasQueNoSeAprietan.test.tsx, tests/adminPantallasLocales.test.tsx, y el recorrido abre ya esa pestaña |
| ACT-26 | media | accesibilidad | Estrategia · Informe completo: los títulos de sección salen a 9 px, más pequeños que su texto | Corregido (`1e3d8230`) · el título más alto de un documento Markdown toma el nivel que se le pide y los demás bajan de uno en uno: las secciones del informe son `h3` a 16 px, como «Riesgos de cola» y las fuentes; un `h5` o un `h6` de prosa nunca es más pequeño que su texto; el resumen ya no se repite, y «Cierre y lectura de la sesión» lleva su tilde · prueba: tests/markdownView.test.tsx, tests/nivelesDeEncabezado.test.tsx, tests/estrategiaTildes.test.ts, y el recorrido abre ya esa vista. En el semanal, el bloque «Drivers semanales específicos» pasa a «Hechos de la semana» (`d0dc99c7`, tests/estrategiaTildesPantalla.test.tsx) |
| ACT-27 | media | adaptación | Ficha de un ETF · Documentos y datos: un valor largo no se parte y se sale 98 px de la página | Corregido (`d0dc99c7`) · el valor de una fila de la ficha se parte cuando no cabe, alineado a la derecha, y el rótulo conserva al menos un cuarto de la fila; una cifra sigue sin partirse porque lleva espacio duro · prueba: tests/fichaInstrumento.test.tsx, y el recorrido abre ya las pestañas de la ficha de un ETF y de una acción |
| ACT-28 | baja | accesibilidad | Estrategia · Informe completo: los enlaces de las fuentes miden 15 px de alto y van pegados | Corregido (`d0dc99c7`) · cada fuente es un enlace de 26 px de alto en su línea · prueba: tests/markdownView.test.tsx, y axe pasa ya por esa vista en el recorrido |
| MAR-33 | media | adaptación | La banda de cifras, por debajo de 1.440 px: una cifra larga no cabe en su casilla y toca la de al lado | Corregido (`e632bb82`) · un dato de la banda no se estrecha por debajo de lo que mide su cifra, y su relleno lateral baja con el ancho de la pantalla (24 px desde 1.440, 12 en una tableta); si aun así no caben, la banda dobla de fila. Medido después: ninguna cifra fuera de su casilla en los cuatro anchos · prueba: tests/piezas/respuesta.test.tsx, y el recorrido mide las «cifras que se salen de su casilla» |
| MAR-32 | baja | accesibilidad | Los bloques son `h3` bajo el `h1` de la página: se salta un nivel de encabezado | Corregido (`1e3d8230`) · el título de la página es `h1`, el de cada bloque `h2` y lo que va dentro de un bloque, `h3`: en la pieza Panel, en los vacíos, en los diálogos y en los encabezados escritos a mano. Medido a 1.440 px: 0 de 68 pantallas con salto de nivel (eran 35 de 48) · prueba: tests/nivelesDeEncabezado.test.tsx, tests/panel.test.tsx, tests/piezas/piezasCompletadas.test.tsx, y el recorrido cuenta los saltos |
| DIS-29 | baja | estado | El generador de borradores calla por qué no puede generar: enseña la frase común del código y no el motivo del servidor | Corregido (`a62c92ad`) · cuando el servidor dice que con estos datos no se puede, la pantalla enseña su motivo («El generador necesita la base nueva…»); en Modo cliente, la frase común · prueba: tests/generadorDeCarteras.test.tsx |

### Revisión a petición de Óscar: color, gráficos y datos que el rediseño había quitado (14-11-2026, tras el cierre)

No son hallazgos de la auditoría: son lo que Óscar pidió al ver el rediseño aplicado («le faltan colores en general, y en
el mapa de distribución geográfica, imprescindibles. ¿Están todos los datos que salían antes? Dale más vida, más impacto
visual, y los informes anteriores eran mucho más bonitos, recupéralos. El stylebox así es horroroso. ¿Y la matriz de
solapamiento?»). Se comparó pantalla a pantalla el estado de antes del rediseño (`8da9cb9d`) con el de después: no
faltaba casi ningún dato, y sí color y varios gráficos. Las reglas que cambian están en `SISTEMA_DISENO.md`, apartado 12.

| Id | Qué pasaba | Qué se ha hecho | Commit y prueba |
|---|---|---|---|
| COL-01 | El mapa geográfico iba en una sola tinta | Un color por zona (América índigo, Europa / O. Medio / África tostado, Asia verde) y la intensidad según el peso; la leyenda y la tabla llevan el color de la zona | `a12f5ad1` · tests/graficosPorPapel.test.tsx, tests/hojasDelMarco.test.ts |
| COL-02 | La caja de estilo de la ficha era una tabla de filetes con una celda realzada (decisión A-123) | Nueve casillas de color con su cifra, por los cuatro tramos con que el sector la sombrea (menos del 10 %, 10–25 %, 25–50 %, desde el 50 %). Son absolutos, y la radiografía usa ahora la misma regla: antes medía cada casilla contra la mayor | `a12f5ad1` · tests/fichaCajaDeEstilo.test.tsx, tests/cajaDeEstilo.test.tsx |
| COL-03 | Ninguna categoría tenía color: los repartos iban en una sola tinta | Cada clase de activo tiene su color, el mismo en toda la aplicación (`core/coloresDeClase.ts`): en el aro, en las barras, en el punto que la acompaña en una tabla. En la paleta de series entra el verde y sale el ocre, que se confundía con el tostado | `7d79c71d`, `68659859` · tests/coloresDeClase.test.ts, tests/piezas/claseConColor.test.tsx, tests/piezas/listaDePartes.test.tsx |
| COL-04 | Los gráficos iban en índigo y gris | La referencia, tostada y a trazos; la cartera, con un relleno suave bajo su línea; la caída de una sola serie, en rojo; la segunda curva del BCE, a trazos otra vez | `f3472145` · tests/colorDeLosGraficos.test.tsx, tests/graficosPorPapel.test.tsx |
| COL-05 | La matriz de solapamiento de pantalla eran casillas sueltas a todo el ancho: no se leía como una matriz | Una rejilla apretada, como la de correlación, con la nota de cada casilla al pasar el ratón y con el teclado | `f3472145` · tests/matrizDeSolapamiento.test.tsx |
| COL-06 | Diseño › Componer había perdido el aro del reparto, el semáforo del «Estado» (y la concentración cuando está bien) y la frontera | Vuelven los tres; la frontera, compacta, dentro de «Rentabilidad y riesgo» | `5afc6067` · tests/colorEnPropuestasYAnalisis.test.tsx |
| COL-07 | La frontera eficiente solo quedaba en Optimizar; las cifras de Análisis no decían su periodo ni si eran estimadas; la mayor posición no decía qué era | La frontera vuelve a Análisis › Diversificación y a Diseño › Simular; cada rótulo dice su periodo y, con el histórico ampliado, sale la marca «Estimado»; la mayor posición dice su producto y su clase | `5afc6067` · tests/colorDeLaRespuestaDelAnalisis.test.tsx, tests/colorEnPropuestasYAnalisis.test.tsx |
| COL-08 | Al comparar dos carteras, solo la rentabilidad llevaba color | La diferencia va en verde si mejora y en rojo si empeora, según el sentido de cada métrica (`core/sentidoDeLaDiferencia.ts`), con su nota; las comprobaciones, con «Cumple» o «No cumple» | `5afc6067` · tests/colorDeMejorarCartera.test.tsx, tests/colorDelComparadorDePropuestas.test.tsx |
| COL-09 | Estrategia enseñaba la asignación en listas y la visión sin color; el calendario, el impacto sin color; Resultados, sin el recuento por día | Vuelven los dos aros; «Positiva» en verde y «Negativa» en rojo; el impacto «Alto» en ocre y «Medio» en índigo; el recuento del día, como apunte de la fecha | `c64f28c4` · tests/colorDeMercadoYEstrategia.test.tsx |
| COL-10 | En Carteras de clientes, la tabla de rentabilidad por meses llevaba un solo fondo por signo, y las clases no tenían color | Cinco intensidades por signo, con la cifra siempre legible; «En qué está invertida», cada clase en su color | `c64f28c4` · tests/gestor/mesesConIntensidad.test.tsx |
| COL-11 | En la ficha, los repartos eran filas de texto y las aptitudes no llevaban color; en Planes, la EPSV tampoco | Regiones, sectores, estilo y tamaño llevan su barra (cada región, en el color de su zona); las aptitudes, «Se puede» en verde y «No se puede» en ocre; la EPSV, con su color | `c64f28c4` · tests/fichaColorYPartes.test.tsx |
| COL-12 | Al llevar relleno, la nota emergente de un gráfico contaba dos veces la cartera, con la misma clave (aviso en la consola) | La nota aparta las marcas que no quieren fila | `f3472145` · tests/colorDeLosGraficos.test.tsx |
| COL-13 | Los trece informes, en la plantilla única del día 14: una sola tinta, sin portada, con la letra de la pantalla. Óscar: «los informes anteriores eran mucho más bonitos, recupéralos» | La plantilla única se queda y toma el aspecto del papel de cliente de antes: portada, Fraunces y Roboto Flex, granate y bronce (azul acero en los internos), tarjetas de cifras, barras con un color por categoría, mapa en color y evolución con sombreado. Sin marca de entidad: va la identidad del asesor. Ninguna cifra ni texto cambia | `e6275404` · tests/plantilla/*.test.ts(x), tests/informeDeClientePlantilla.test.ts, tests/informesDeClienteEnLaPlantilla.test.ts, tests/gestor/informesPlantilla.test.ts |
| COL-14 | Los ETF quedaban fuera de la matriz de solapamiento del informe de cliente y de Análisis en Modo cliente: su cartera completa es dato del emisor (B-79), y con lo que publica el proveedor no llegan a la mitad. Óscar: «con respecto a los ETF, no los dejes fuera» | La cartera completa del emisor mide el solapamiento en todas partes. El cliente ve la cifra, no la cartera ni de quién es: el papel no nombra al emisor y, en Modo cliente, la pantalla dice «cartera completa, a tal fecha». Ningún papel lee esa cartera: el informe de cliente recibe el solapamiento ya medido de la pantalla. Con la cartera de muestra, iShares Core MSCI World y Vanguard S&P 500 salen con su 58,4 % | `dd39b508` · tests/matrizDeSolapamientoConEtf.test.tsx, tests/informeDeClienteSeisHojas.test.ts, tests/barreraCarteraDelEmisor.test.ts, tests/carteraDelEmisor.test.ts |
| COL-15 | Carteras de clientes no tenía Sortino, Calmar ni la rentabilidad de los últimos años, que se fueron con «Análisis rápido de extractos». Óscar: «añádelos» | Las tres, calculadas en el navegador con las definiciones del servidor, en el análisis, en el registro de métricas y en el informe del asesor. Cada cifra de sus pruebas sale de una cuenta a mano, y una prueba compara con el caso del servidor. De paso, la «Rentabilidad anualizada del Sharpe» del informe del asesor dice por qué no sale en un periodo de menos de un año | `b82f01b2` · tests/gestor/sortinoCalmarYUltimosAnios.test.ts, tests/gestor/sortinoCalmarYUltimosAniosPantalla.test.tsx, tests/gestor/informesPlantilla.test.ts |

## Detalle de cada hallazgo

### GES · Gestor de carteras: pantalla, almacén e importación

#### GES-01 · No hay aviso al salir: cambios perdidos al cerrar, recargar o cambiar de sección
- **Gravedad:** crítica
- **Categoría:** funcional
- **Dónde:** `src/gestor/ui/estado/useCarteraAbierta.ts:79-98`; `src/gestor/ui/VistaDeCartera.tsx:42-49`; ningún `beforeunload` en `src/gestor/**` (sí lo hay en `src/app/useCicloDeCartera.tsx:113` para Diseño).
- **Qué pasa:** Sin carpeta (Firefox, Safari: estado «sin-descargar») toda la cartera vive solo en memoria hasta que el asesor pulsa «Descargar»; cerrar la pestaña, recargar, ir a otra sección del menú, pulsar «Abrir estas posiciones en Diseño» o el cierre de sesión por inactividad la pierden entera, sin ninguna pregunta. Con carpeta, se pierde lo hecho en los 700 ms previos al guardado automático y **todo lo que quede en estado «error»** (no se reintenta solo). El resto de la app sí avisa (Diseño usa `beforeunload`).
- **Cómo reproducirlo:** En Firefox, «Nueva cartera» → añadir cinco movimientos → F5. No hay aviso y la cartera ha desaparecido. Con carpeta: provocar un fallo de escritura (ver GES-03) y cerrar la pestaña.
- **Evidencia:**
  ```ts
  // useCarteraAbierta.ts:82-85 — sin carpeta solo se marca, no se protege
  if (!almacen) { setGuardado("sin-descargar"); return; }
  // :96-98 — al desmontar solo se intenta con carpeta, y el error se traga
  useEffect(() => () => { if (almacen && !demo && ultima.current !== enDisco.current) void almacen.guardar(ultima.current).catch(() => undefined); }, [almacen, demo]);
  ```
- **Arreglo propuesto:** Un `beforeunload` mientras `guardado ∈ {"pendiente","guardando","error","sin-descargar"}`; en «sin-descargar», confirmación también al pulsar «← Todas las carteras», al navegar del menú y antes de `onSendToBuilder`; en «pendiente», vaciar el temporizador y guardar en `pagehide`. Prueba: `useCarteraAbierta` con almacén nulo → el registro de `beforeunload` existe; con guardado correcto → desaparece.
- **Confianza:** confirmado en el código.

#### GES-02 · Dos pestañas o dos equipos con la misma cartera: la última escritura borra la otra sin aviso
- **Gravedad:** crítica
- **Categoría:** funcional
- **Dónde:** `src/gestor/almacen/carpeta.ts:325-375` (`guardarSinCola`), `src/gestor/almacen/copias.ts:77-82` (`tocaCopia`).
- **Qué pasa:** Al guardar, el almacén lee el fichero del disco solo para compararlo con lo nuevo; nunca comprueba que lo que hay en el disco sea lo que esta pestaña abrió. Si la cartera está abierta en dos pestañas (o en dos equipos con la carpeta sincronizada por OneDrive/Dropbox), cada guardado automático sobrescribe el trabajo de la otra. La copia de seguridad del contenido anterior solo se hace si la última copia tiene más de 10 minutos: dentro de esa ventana lo pisado no queda en ningún sitio. `useOtraPestana` existe en la app pero el gestor no lo usa.
- **Cómo reproducirlo:** Abrir la cartera A en la pestaña 1 y en la pestaña 2. En la 1, importar 40 movimientos (se guarda; se hace la copia del original). En menos de 10 minutos, en la 2, cambiar una nota de un movimiento. El fichero queda sin los 40 movimientos y la única copia es la de antes de importar.
- **Evidencia:**
  ```ts
  // carpeta.ts:338-347 — «origen» es lo que hay ahora en disco, sea de quien sea
  const origen = await ubicar(cartera.id, nombreDeFicheroPara(cartera.nombre));
  const sinCambios = origen !== undefined && sinMarcaDeGuardado(origen.texto) === sinMarcaDeGuardado(texto);
  const copia = origen !== undefined && !sinCambios ? await quizaCopiar(cartera.id, origen.texto, momento) : undefined;
  ```
- **Arreglo propuesto:** Recordar al abrir (y tras cada guardado) la huella del texto escrito (`sinMarcaDeGuardado` o su hash); antes de escribir, si el disco no coincide, no escribir: copiar siempre lo del disco a `copias/` (sin la regla de los 10 minutos) y avisar «Esta cartera ha cambiado fuera de esta pestaña: recargar / guardar como copia». Añadir el aviso de `useOtraPestana` en la vista de cartera. Prueba en `almacenCarpeta.test.ts`: dos almacenes sobre la misma `carpetaFalsa`, guardar en uno y luego en el otro → el segundo falla con un código nuevo `CONFLICTO` y existe una copia.
- **Confianza:** confirmado en el código.

#### GES-03 · Si la carpeta falla a mitad de sesión, no hay forma de rescatar los cambios
- **Gravedad:** crítica
- **Categoría:** funcional
- **Dónde:** `src/gestor/ui/VistaDeCartera.tsx:116` y `:141`; `src/gestor/ui/estado/useCarteraAbierta.ts:136-145` y `:96-98`; mensajes en `src/gestor/almacen/carpeta.ts:75-92`.
- **Qué pasa:** Con permiso retirado, unidad de red o USB desconectados, carpeta movida o disco lleno, el guardado falla y la pantalla dice «No se ha podido guardar · Reintentar». «Reintentar» repite la misma escritura; el mensaje del error pide «Vuelve a elegirla», pero para elegir carpeta hay que salir a la lista, y al salir la vista se desmonta, el guardado de salida falla en silencio (`.catch(() => undefined)`) y los cambios desaparecen. «Descargar el fichero de la cartera» está desactivado siempre que haya carpeta, así que no hay salida de emergencia.
- **Cómo reproducirlo:** Carpeta en un pendrive → abrir cartera → retirar el pendrive → añadir un movimiento → aparece el error → «← Todas las carteras» → «Elegir la carpeta de nuevo». El movimiento se ha perdido.
- **Evidencia:**
  ```ts
  // VistaDeCartera.tsx:116
  { id: "descargar", label: "Descargar el fichero de la cartera", onSelect: () => void abierta.guardarAhora(), disabled: demo || almacen !== null },
  // useCarteraAbierta.ts:138-141 — con almacén, «guardar ahora» nunca descarga
  if (almacen) { await guardar(presente); return; }
  ```
- **Arreglo propuesto:** En estado «error», ofrecer junto a «Reintentar» un «Descargar una copia ahora» (que llame a `descargarCartera`) y, si el código es `PERMISO`, un «Volver a dar permiso» que llame a `requestPermission` sin salir de la cartera. Bloquear «← Todas las carteras» con confirmación mientras haya error. Prueba de pantalla con un almacén que lanza `ErrorDeAlmacen("PERMISO")`: el botón de descarga aparece y está activo.
- **Confianza:** confirmado en el código.

#### GES-04 · Editar un movimiento borra los campos que el formulario no enseña (cambia la valoración de un split)
- **Gravedad:** alta
- **Categoría:** cálculo
- **Dónde:** `src/gestor/ui/dialogos/FormularioDeMovimiento.tsx:116-162`; `src/gestor/motor/movimientos/split.ts:31`; `src/gestor/demo/carteraDemo.ts:228`.
- **Qué pasa:** El formulario reconstruye el movimiento desde cero (`{ id, tipo, fechaOperacion, origen }` más los campos que pinta su tipo). Todo lo demás se pierde al pulsar «Guardar los cambios»: `serieAjustada` (no hay control para él), cualquier campo desconocido que el formato promete conservar, y `fechaValor` o `cambio` si el tipo o la divisa no los piden. En un split con `serieAjustada: false`, cambiar solo la nota lo convierte en «serie ajustada» y cambia la valoración de la posición. La demostración trae justo ese caso.
- **Cómo reproducirlo:** Cartera de demostración → Movimientos → «Split de 2 por 1» → Editar → cambiar la nota → Guardar. El fichero (si no fuera demo) pierde `serieAjustada: false` y las cifras de la acción cambian.
- **Evidencia:**
  ```ts
  // FormularioDeMovimiento.tsx:132 — se parte de cero, no de `movimiento`
  const nuevo: Movimiento = { id: movimiento?.id ?? nuevoId(), tipo, fechaOperacion: fecha, origen: movimiento?.origen ?? { via: "manual" } };
  // split.ts:31
  serieAjustada: movimiento.serieAjustada ?? true
  ```
- **Arreglo propuesto:** Partir de `{ ...movimiento }` y sobrescribir solo los campos que el formulario gestiona (borrando los del tipo anterior si cambia el tipo); añadir la casilla «La serie de precios ya viene ajustada por este split» al tipo `split`. Prueba: editar el split de la demo sin tocar nada → el movimiento guardado es igual al original; un campo desconocido `{ x: 1 }` sobrevive a la edición.
- **Confianza:** confirmado en el código.

#### GES-05 · El precio que propone el formulario no sigue a la fecha y es el ajustado por dividendos
- **Gravedad:** alta
- **Categoría:** cálculo
- **Dónde:** `src/gestor/ui/dialogos/FormularioDeMovimiento.tsx:99`, `:176-197`, `:299`; `src/gestor/mercado/cargar.ts:141-142`.
- **Qué pasa:** La fecha empieza en hoy; al elegir el activo se rellena el precio de **esa** fecha. Si después el asesor pone la fecha real de la operación (lo normal), el precio no se vuelve a proponer, y el importe sugerido sale de títulos × precio de hoy. Si se teclea el importe pero no el precio, se guarda el precio de hoy como precio de la operación (sale en la tabla y el motor lo usa como «precio de su última operación» cuando no hay serie). Además, para acciones y ETF la serie de la plataforma está ajustada por dividendos: el precio de una fecha pasada que se propone no es el que pagó el cliente.
- **Cómo reproducirlo:** Añadir movimiento → Compra → elegir un ETF → cambiar la fecha a hace dos años → teclear títulos. El precio y el importe sugeridos son los de hoy.
- **Evidencia:**
  ```ts
  // :191-196 — el precio se propone solo al elegir el activo
  const conPrecio = usa("precio") && !precioTecleado ? { ...actual, precio: ultimoPrecio(elegido, fecha) } : actual;
  // :299 — cambiar la fecha no vuelve a proponer nada
  <input max={hoy} onChange={(evento) => setFecha(evento.target.value)} type="date" value={fecha} />
  ```
- **Arreglo propuesto:** Al cambiar la fecha, si el precio no se ha tecleado, volver a proponerlo y recalcular el importe. Para activos en `ajustadasPorDividendos`, no proponer precio en fechas pasadas (o proponerlo con «aproximado: la serie está ajustada por dividendos»). Prueba de pantalla: elegir activo, cambiar fecha → el campo precio cambia al de la nueva fecha.
- **Confianza:** confirmado en el código (el efecto en la valoración depende del motor).

#### GES-06 · «Cuentas» enseña posiciones de otra fecha que la que dice su campo
- **Gravedad:** alta
- **Categoría:** cálculo
- **Dónde:** `src/gestor/ui/vistas/VistaCuentas.tsx:75`, `:80-83`, `:94`, `:110`; `src/gestor/ui/VistaDeCartera.tsx:159`.
- **Qué pasa:** El campo «Cuentas a fecha» empieza en hoy, pero mientras vale hoy la vista usa `datos.analisis`, que es el del **periodo elegido en Resumen/Análisis**. Si allí se eligió «Entre dos fechas» acabando en junio de 2025, Cuentas pinta posiciones, total y saldo a junio de 2025 con el campo diciendo hoy (el selector de periodo ni siquiera se ve en esta pestaña). El extracto de efectivo y el saldo por fecha valor, en cambio, sí se cortan en hoy: dos fechas distintas en la misma pantalla.
- **Cómo reproducirlo:** Resumen → «Entre dos fechas», hasta 30/06/2025 → pestaña Cuentas. El subtítulo dice «a 30 jun 2025», el campo dice hoy, el extracto llega a hoy.
- **Evidencia:**
  ```ts
  const [aFecha, setAFecha] = useState(hoy);
  const aEsaFecha = useMemo(() => {
    if (aFecha === hoy) return datos.analisis;   // análisis del periodo elegido, no «a hoy»
  ```
- **Arreglo propuesto:** Usar `datos.analisis` solo si `datos.analisis.fecha === aFecha`; si no, `analizar(preparado, { desde: inicio, hasta: aFecha })`. Prueba: con `elegido = libre` que acaba antes de hoy, Cuentas a hoy da el patrimonio de hoy.
- **Confianza:** confirmado en el código.

#### GES-07 · Un movimiento anterior de un activo que ya estaba no recarga sus precios
- **Gravedad:** alta
- **Categoría:** cálculo
- **Dónde:** `src/gestor/ui/estado/useAnalisisDeCartera.ts:30-45`; `src/gestor/mercado/cargar.ts:98-111`, `:134`.
- **Qué pasa:** La carga pide los precios de cada activo desde el año anterior a **su** primer movimiento, pero la huella que decide si hay que volver a pedir solo mira el año del primer movimiento **de la cartera**. Si el asesor añade una compra de 2019 de un fondo cuyo primer movimiento era de 2022 (y la cartera ya empezaba en 2018), no se pide nada: el fondo se valora entre 2019 y 2021 con el precio de la operación, y la rentabilidad de esos años sale mal hasta que se cierra y se vuelve a abrir la cartera.
- **Cómo reproducirlo:** Cartera con aportación de 2018 y compra de un fondo en 2022 → añadir a mano otra compra del mismo fondo en 2019 → Análisis, tabla de meses de 2019-2021.
- **Evidencia:**
  ```ts
  // huella: solo el año del primer movimiento global
  return [cartera.id, cartera.divisaBase, primera?.slice(0, 4) ?? "", hasta, ...activos].join("|");
  // cargar.ts:134 — los precios van por el primer año de cada activo
  (porActivo.get(activo.id) ?? primerAnio) - 1
  ```
- **Arreglo propuesto:** Meter en la huella el primer año de cada activo (`${activo.id}:${anio}`). Prueba: cambiar el primer año de un activo cambia la huella.
- **Confianza:** confirmado en el código.

#### GES-08 · El gestor no aplica Modo cliente: carteras de otros clientes e informe interno a la vista
- **Gravedad:** alta
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/GestorDeCarterasPage.tsx:90-96`, `:142-150`; `src/gestor/ui/vistas/VistaComparar.tsx:105-133`; `src/gestor/ui/dialogos/DialogoDeInformes.tsx:34`; `src/core/modoCliente.ts:75`, `:77`. Ningún `useModoCliente` en `src/gestor/**`.
- **Qué pasa:** `SE_OCULTA.otrasCarteras` («son de otros clientes») y `documentosInternos` («Informe interno del asesor… en toda la aplicación») son reglas de producto. En el gestor, con Modo cliente puesto, la entrada lista todas las carteras con su cliente, Comparar ofrece «Del gestor» con nombres y clientes, y Informes ofrece el «Informe del asesor» con conciliación y avisos. La pantalla anterior (Rendimiento) sí lo aplica.
- **Cómo reproducirlo:** Activar Modo cliente → Gestor de carteras.
- **Evidencia:** `{ id: "asesor", nombre: "Informe del asesor", para: "Tu herramienta de trabajo: todo el detalle, la conciliación y los avisos." ... }` sin ninguna condición de modo.
- **Arreglo propuesto:** En Modo cliente: abrir solo la cartera en curso (la lista, con «Sal de Modo cliente para ver otras carteras», como Comparar carteras), ocultar «Del gestor» en Comparar y el informe del asesor y el Excel. Añadir el gestor a `tests/modoCliente.test.ts`.
- **Confianza:** confirmado en el código.

#### GES-09 · «Análisis rápido de extractos» manda los extractos al servidor; la página dice que nada sale del equipo
- **Gravedad:** alta
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/GestorDeCarterasPage.tsx:234`, `:303-306`; `src/gestor/ui/importar/PasoDocumentos.tsx:89`; `src/pages/RealPortfolioPage.tsx:553`, `:622`, `:681`; `src/adapters/realPortfolioBackend.ts:735-743`.
- **Qué pasa:** La entrada del gestor dice «Las carteras se guardan como ficheros en tu equipo y no salen de él», y el asistente «Los documentos se leen en este equipo y no se envían a ningún sitio». Un enlace en la misma página lleva al análisis rápido, que envía el HTML entero de los extractos del cliente a la Function `analyze_real_portfolio` y permite guardar un resumen en el historial del servidor. Nada lo dice en el enlace ni en la pantalla. Además se titula «Rendimiento» (eyebrow «Carteras»), no «Análisis rápido de extractos».
- **Cómo reproducirlo:** Gestor → «Análisis rápido de extractos» → cargar extractos → Analizar.
- **Evidencia:** `const analysis = await analyzeRealPortfolio({ ...payload, configuration: {...} });` y `title="Rendimiento"`.
- **Arreglo propuesto:** Rotular el enlace y la cabecera «Análisis rápido de extractos (se calcula en el servidor)» y una línea que diga que los extractos se envían a la plataforma; decidir con Óscar su retirada (ya pendiente en PROGRESO).
- **Confianza:** confirmado en el código.

#### GES-10 · Recuperar una versión o deshacer una importación no fuerza copia: la versión actual puede no quedar en disco
- **Gravedad:** alta
- **Categoría:** funcional
- **Dónde:** `src/gestor/ui/dialogos/DialogoDeVersiones.tsx:159`; `src/gestor/ui/vistas/VistaMovimientos.tsx:125-133`; `src/gestor/almacen/copias.ts:77-82`.
- **Qué pasa:** Los cambios destructivos grandes (recuperar una versión anterior, deshacer una importación entera, borrar movimientos) pasan por el mismo guardado automático, que solo copia lo anterior si la última copia tiene más de 10 minutos. Si hubo una hace 5, la versión que se sustituye vive solo en el «Deshacer» en memoria: al cerrar la pestaña, no queda en ningún sitio. El propio diálogo lo admite en letra pequeña.
- **Cómo reproducirlo:** Importar extractos (se hace copia) → añadir 20 movimientos a mano → antes de 10 minutos, «Versiones anteriores» → recuperar la de antes de importar → cerrar la pestaña. Los 20 movimientos no están en ninguna copia.
- **Evidencia:** `nota={recuperable ? \`La versión actual no se pierde: ... (salvo que ya se hiciera una hace menos de ${MINUTOS_ENTRE_COPIAS} minutos).\` : undefined}`
- **Arreglo propuesto:** `guardar(cartera, { copiaObligada: true })` para «Recuperar», «Deshacer la importación», «Borrar» y «Retirar»; el almacén salta `tocaCopia` en ese caso. Prueba en `almacenCarpeta.test.ts` con reloj inyectado.
- **Confianza:** confirmado en el código.

#### GES-11 · «Ingresos» y «costes» con el mismo nombre y cifras distintas entre Resumen, Análisis y el PDF del cliente
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/vistas/VistaResumen.tsx:119-123`; `src/gestor/ui/analisis/BloqueIngresosYCostes.tsx:66-97`; `src/gestor/motor/analisis.ts:414`; `src/gestor/informes/secciones/cliente/resultado.tsx:55`.
- **Qué pasa:** En Resumen, «Ingresos» son «Dividendos, cupones e intereses cobrados» y «Comisiones y gastos» lleva la nota «Custodia, asesoramiento **e impuestos** de la cuenta». En Análisis, la cifra en negrita es «Dividendos y cupones netos» (sin intereses) y los impuestos van «Aparte… No son un coste de la gestión», con «Costes pagados» sin ellos. El PDF del cliente no tiene línea de costes y da la «Variación de precio, neta de comisiones y gastos». El asesor ve tres cifras de «ingresos» o «precio» distintas para el mismo periodo.
- **Cómo reproducirlo:** Una cartera con intereses de cuenta y retenciones: comparar Resumen → «De dónde viene el resultado», Análisis → «Ingresos y costes» y el PDF del cliente.
- **Evidencia:** `const ingresosNetos = ingresos.dividendo.neto + ingresos.cupon.neto;` frente a `nota="Dividendos, cupones e intereses cobrados" rotulo="Ingresos"`.
- **Arreglo propuesto:** Un único vocabulario: «Ingresos (dividendos, cupones e intereses)» siempre igual, y en Análisis la misma cifra del desglose más su detalle; la nota de costes del Resumen debe decir si incluye impuestos o no, igual que Análisis. Prueba: el Resumen y Análisis muestran la misma cifra para el rótulo «Ingresos».
- **Confianza:** confirmado en los textos; que `desglose.costes` incluya impuestos sale de la nota y del PDF, no lo he medido en el motor.

#### GES-12 · Un periodo imposible cae a «Desde el inicio» sin decirlo, con el rótulo del periodo elegido
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/gestor/ui/estado/useAnalisisDeCartera.ts:113-117`; `src/gestor/ui/VistaDeCartera.tsx:171-175`; `src/gestor/ui/vistas/VistaResumen.tsx:97`.
- **Qué pasa:** Con «Entre dos fechas» y desde ≥ hasta (los `min`/`max` de un `input type=date` no impiden teclearlo), o un periodo que deja de estar disponible, el análisis pasa en silencio a «Desde el inicio». El control sigue marcando «Entre dos fechas» y el titular del Resumen dice «Cuánto ha ganado o perdido · entre las dos fechas» con la cifra de toda la historia. Solo la línea gris «Del … al …» delata el cambio.
- **Cómo reproducirlo:** Entre dos fechas → Desde = Hasta.
- **Evidencia:** `if (elegido.id === "libre" && elegido.libre && elegido.libre.desde < elegido.libre.hasta) return elegido.libre; ... return (habitual ?? periodos.find((c) => c.id === "inicio"))!.periodo;`
- **Arreglo propuesto:** Devolver también `caido: true` y pintar «Las fechas no forman un periodo: se enseña desde el inicio» junto al selector, con el rótulo del Resumen sacado de `periodo` y no de `elegido`. Prueba en `vistaAnalisis.test.tsx`.
- **Confianza:** confirmado en el código.

#### GES-13 · «Retirar la cartera» sin manejo de error, y sin vuelta atrás desde la app
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/gestor/ui/VistaDeCartera.tsx:98-109`, `:117`.
- **Qué pasa:** `await almacen.retirar(...)` no tiene `try/catch` y se llama con `void retirar()`: si falla (permiso, fichero bloqueado), es una promesa rechazada sin tratar, la pantalla no dice nada y el asesor cree que la ha retirado. La confirmación dice que se recupera «moviendo el fichero de vuelta»: no hay papelera en la app.
- **Cómo reproducirlo:** Abrir el fichero en otro programa que lo bloquee → Más → Retirar → Retirar.
- **Evidencia:** `if (!aceptado) return; await almacen.retirar(abierta.fichero); alVolver();`
- **Arreglo propuesto:** `try/catch` con mensaje en `role="alert"`; a medio plazo, «Papelera» en la entrada con «Recuperar». Prueba con un almacén que lanza.
- **Confianza:** confirmado en el código.

#### GES-14 · Dos ficheros con el mismo identificador comparten copias; retirar uno se lleva las del otro
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/gestor/almacen/carpeta.ts:216-219`, `:421-431`; `src/gestor/ui/GestorDeCarterasPage.tsx:113`; `src/gestor/ui/comparar/useComparacion.ts:40`.
- **Qué pasa:** Duplicar una cartera en el Explorador para empezar otra (algo que un asesor hará) da dos ficheros con el mismo `cartera.id`. Comparten `copias/<id>/` (las versiones de una aparecen en la otra), retirar una mueve a la papelera **todas** las copias de las dos, la tabla de la entrada recibe dos filas con la misma clave de React, y Comparar excluye a las dos.
- **Cómo reproducirlo:** Copiar «A.cartera.json» como «B.cartera.json» → abrir B → Versiones anteriores.
- **Evidencia:** `function carpetaDeLasCopias(carteraId: string): string { return sanearNombre(carteraId); }` y `id: resumen.id || resumen.fichero`.
- **Arreglo propuesto:** Detectar en `listar` ids repetidos y ofrecer «Convertir en una cartera nueva» (id nuevo); usar `fichero` como clave de fila. Prueba en `almacenCarpeta.test.ts`.
- **Confianza:** confirmado en el código.

#### GES-15 · Diálogos largos se cierran con la X o Escape y pierden lo hecho; ajustes descarta el precio tecleado
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/gestor/ui/dialogos/AsistenteDeImportacion.tsx:172-173`; `FormularioDeMovimiento.tsx:281-282`; `DialogoDeAjustes.tsx:39-53`.
- **Qué pasa:** El asistente (decisiones de activos, casillas, posiciones iniciales) y el formulario evitan cerrar con un clic fuera, pero la X y Escape (`useAccessibleDialog`) llaman a `alCerrar` sin preguntar. En Ajustes, un precio a mano tecleado pero no «Añadido» se descarta en silencio al pulsar «Guardar los ajustes».
- **Cómo reproducirlo:** Asistente → resolver diez activos → Escape.
- **Evidencia:** `<ModalDialog closeOnBackdrop={false} labelledBy={idDelTitulo} onClose={alCerrar} size="lg">`
- **Arreglo propuesto:** Confirmar el cierre cuando haya trabajo; en Ajustes, añadir el precio pendiente al guardar o avisar. Prueba de pantalla.
- **Confianza:** confirmado para la X; para Escape, por el uso de `useAccessibleDialog` (no he abierto ese hook).

#### GES-16 · El diálogo de informes solo avisa de errores, no de precios que faltan ni de datos de mercado no leídos
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:** `src/gestor/ui/dialogos/DialogoDeInformes.tsx:157-178`.
- **Qué pasa:** Antes de generar el PDF del cliente solo se avisa si `integridad.errores > 0`. Los avisos (posiciones sin precio o con precio de hace semanas, tipos de cambio no leídos, referencia no disponible, «puede faltar algún dividendo») no aparecen en el diálogo, aunque el Resumen los llama «Antes de fiarte de las cifras». Se puede entregar al cliente un informe valorado con el precio de operación sin que el asesor lo vea.
- **Cómo reproducirlo:** Cartera con un activo propio sin precios a mano → Informes.
- **Evidencia:** `const errores = analisis.integridad.errores; ... {errores > 0 ? (<LineaDeAviso gravedad="aviso">…)}`
- **Arreglo propuesto:** Repetir en el diálogo la lista de avisos (los del motor y los de mercado) con «Ver el detalle». Prueba en `dialogoDeInformes.test.tsx`.
- **Confianza:** confirmado en la pantalla; no he comprobado qué dice el PDF del cliente en ese caso.

#### GES-17 · Accesibilidad: botones repetidos sin nombre propio, errores no asociados, ayuda de 20 px
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/gestor/ui/vistas/VistaMovimientos.tsx:71-72`; `DialogoDeAjustes.tsx:120`; `FormularioDeMovimiento.tsx:274`, `:318-324`; `src/gestor/ui/piezas.tsx:25`; `src/styles/gestor.css:232-233`; `src/gestor/ui/VistaDeCartera.tsx:138-142`.
- **Qué pasa:** Cada fila del libro tiene «Editar» y «Borrar» sin decir de qué movimiento (un lector de pantalla oye 25 «Borrar»); igual «Quitar» en precios a mano. Los errores del formulario van en una lista `role="alert"` sin `aria-invalid` ni `aria-describedby` en el campo. El botón «?» de ayuda mide 1,25 rem (20 px), por debajo de los 24 px. El estado de guardado es `role="status"` con un botón dentro.
- **Cómo reproducirlo:** Lector de pantalla en Movimientos.
- **Evidencia:** `<Button onClick={() => alBorrar(movimiento)} size="sm" variant="quiet">Borrar</Button>`; `.gestor-ayuda__boton { width: 1.25rem; height: 1.25rem; }`
- **Arreglo propuesto:** `aria-label={\`Borrar: ${nombre} del ${fecha}\`}` (como ya hace PasoDocumentos con «Quitar»), errores por campo, 1,5 rem mínimo, sacar el botón del `role=status`.
- **Confianza:** confirmado en el código.

#### GES-18 · La tabla de movimientos vuelve a la página 1 tras cada edición o borrado
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/gestor/ui/vistas/VistaMovimientos.tsx:89-113`, `:200`; `src/components/tabla/TablaDeDatos.tsx:144-150`.
- **Qué pasa:** `filas` se recalcula con cada cambio de la cartera, y `TablaDeDatos` vuelve a la página 1 cuando cambian sus filas. Corregir uno a uno los movimientos marcados con error en la página 6 obliga a volver a buscarlos tras cada guardado. El orden, la página y los filtros también se pierden al cambiar de pestaña.
- **Cómo reproducirlo:** Libro de 200 movimientos → página 5 → editar uno → guardar.
- **Evidencia:** `if (filasAnteriores.current === filas) return; ... if (pagina !== 1) cambiar({ pagina: 1 });`
- **Arreglo propuesto:** Pasar `estado`/`alCambiarEstado` desde `VistaDeCartera` y solo reiniciar la página cuando cambia el filtro, no la cartera.
- **Confianza:** confirmado en el código.

#### GES-19 · El panel «cosas que revisar» cuenta mal
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/vistas/VistaResumen.tsx:69-83`.
- **Qué pasa:** El título usa `avisos.length === 1` para decir «Una cosa que revisar» aunque haya además avisos de mercado; con cero del motor y uno de mercado sale «1 cosas que revisar». Se cuentan todos pero se enseñan 4 + 2.
- **Cómo reproducirlo:** Un aviso del motor y uno de mercado → «Una cosa que revisar» con dos líneas.
- **Evidencia:** `titulo={avisos.length === 1 ? "Una cosa que revisar" : \`${avisos.length + datos.mercado.mercado.avisos.length} cosas que revisar\`}`
- **Arreglo propuesto:** `const total = avisos.length + mercado.avisos.length;` y plural sobre `total`; «y N más» si se recorta.
- **Confianza:** confirmado en el código.

#### GES-20 · Dos sistemas de formato y tres nombres para lo mismo
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/formato.ts:11-23`, `:72-75`; `src/core/format.ts:1`, `:77-89`, `:185-197`; `src/pages/RealPortfolioPage.tsx`; `src/components/RealAnalysisHistory.tsx:81`.
- **Qué pasa:** El gestor escribe `1.234,56 €` con espacio normal (el euro puede saltar de línea en una columna estrecha), dos decimales por defecto y «sep»; la pantalla anterior, dentro del mismo gestor, usa `core/format`: espacio duro, cero decimales por defecto, «N/D» para lo que falta (el gestor usa `Ausencia`) y «sept» de `Intl`. Vocabulario: «Rentabilidad del cliente» frente a «TIR»; «Gestor de carteras» / «Rendimiento» / «Análisis rápido de extractos» para pantallas que conviven; «referencia» frente a «índice de referencia»; «movimiento» en el gestor y «operación» en el análisis rápido.
- **Cómo reproducirlo:** Comparar una cifra en Resumen y en el análisis rápido.
- **Evidencia:** `return \`${numero(valor, decimales)} ${SIMBOLO[divisa] ?? divisa}\`;` frente a `Intl.NumberFormat(LOCALE, { style: "currency", currency: "EUR", ... })`.
- **Arreglo propuesto:** Que `ui/formato.ts` sea una capa fina sobre `core/format.ts` (o al revés) con una sola regla de espacio, menos y meses; glosario único.
- **Confianza:** confirmado en el código.

#### GES-21 · Los avisos de mercado enseñan el mensaje técnico del error tal cual
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/gestor/mercado/cargar.ts:147-148`, `:196`, `:291-295`.
- **Qué pasa:** «No se han podido leer los precios de X: ${error.message}» pega el texto del SDK de Firebase (en inglés y técnico, p. ej. de permisos o de red) en una pantalla para el asesor y en el panel del Resumen.
- **Cómo reproducirlo:** Sin red o sin sesión con la plataforma.
- **Evidencia:** `` avisos.push(`No se han podido leer los precios de ${activo.nombre}: ${error instanceof Error ? error.message : String(error)}`); ``
- **Arreglo propuesto:** Traducir por código (`permission-denied`, `unavailable`) a una frase llana; el detalle técnico, solo al registro.
- **Confianza:** sospecha (no he visto qué mensaje da el lector en producción).

#### GES-22 · Las cifras se leen con una regla ambigua y el formulario no enseña cómo las ha leído
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:** `src/gestor/motor/decimal.ts:109-139` (usado por `FormularioDeMovimiento.tsx:120`, `DialogoDeAjustes.tsx:30`).
- **Qué pasa:** «1.234» es mil doscientos treinta y cuatro (bien en España), pero un valor liquidativo copiado de una web anglosajona, «105.123», también se lee como 105.123 y no como 105,123. El campo no da eco («leído como 105.123,00»), así que el error solo se ve si el importe sugerido llama la atención; en un precio a mano no hay importe que lo delate.
- **Cómo reproducirlo:** Ajustes → Precio a mano → «105.123» → Añadir: sale 105.123,00.
- **Evidencia:** `normal = /^\d{1,3}\.\d{3}$/.test(texto) && !texto.startsWith("0") ? texto.replace(".", "") : texto;`
- **Arreglo propuesto:** Mostrar bajo cada campo numérico la cifra interpretada con el formato de pantalla, y pedir confirmación cuando el caso sea ambiguo.
- **Confianza:** confirmado en el código.

#### GES-23 · Fechas de modificación e importación en UTC, mostradas como día local
- **Gravedad:** baja
- **Categoría:** cálculo
- **Dónde:** `src/gestor/ui/GestorDeCarterasPage.tsx:95`; `src/gestor/ui/vistas/VistaMovimientos.tsx:209`.
- **Qué pasa:** `modificada` e `importacion.fecha` son `toISOString()`; cortar los diez primeros caracteres da el día UTC: lo guardado entre las 00:00 y las 01:00/02:00 en España aparece con el día anterior.
- **Evidencia:** `fecha(fila.modificada.slice(0, 10))`
- **Arreglo propuesto:** `hoy(new Date(fila.modificada))`, como hace ya `DialogoDeVersiones`.
- **Confianza:** confirmado en el código.

#### GES-24 · El aviso de migración se pinta donde no se ve
- **Gravedad:** baja
- **Categoría:** estado
- **Dónde:** `src/gestor/ui/GestorDeCarterasPage.tsx:171-173`, `:204-206`, `:239`.
- **Qué pasa:** Al abrir una cartera migrada se pone el aviso en el estado de la entrada, pero la entrada no se pinta mientras la cartera está abierta: se lee al volver, fuera de contexto. Promete que «la versión antigua queda en sus copias», cosa que solo es cierta si se guarda algo y toca copia. Hoy no hay migraciones (`VERSION_ACTUAL = 1`): es latente.
- **Evidencia:** `abrir(leida.cartera, fichero); if (leida.migrada) setAviso(...)` y `if (abierta) return <VistaDeCartera … />`.
- **Arreglo propuesto:** Pasar el aviso a `VistaDeCartera` y forzar una copia del fichero original al abrir una migrada.
- **Confianza:** confirmado en el código.

#### GES-25 · El color del signo no siempre coincide con el texto
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/formato.ts:104-108`; `src/gestor/ui/vistas/VistaResumen.tsx:100`; `src/gestor/ui/analisis/BloqueMeses.tsx:38`.
- **Qué pasa:** `claseDelSigno` redondea a 4 decimales para todo; el titular escribe el resultado sin céntimos, así que +0,30 € sale «0 €» en verde. La tabla de meses escribe las subidas sin «+» y el resto de la pantalla con «+».
- **Arreglo propuesto:** Pasar a `Cifra` los decimales con los que se escribe; usar `porcentajeConSigno` en los meses.
- **Confianza:** confirmado en el código.

#### GES-26 · «Hoy» se fija al abrir la cartera; «pesos de hoy» con un periodo pasado
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/VistaDeCartera.tsx:69`; `src/gestor/ui/comparar/LlevarADiseno.tsx:61`.
- **Qué pasa:** Una cartera abierta pasada la medianoche sigue valorando al día anterior. «Abrir en Diseño» dice «con sus pesos de hoy» y usa las posiciones al final del periodo elegido.
- **Arreglo propuesto:** Recalcular `hoy` al volver a la pestaña; texto «a {fecha}».
- **Confianza:** confirmado en el código.

#### GES-27 · La lista puede salir desfasada al volver de una cartera
- **Gravedad:** baja
- **Categoría:** funcional
- **Dónde:** `src/gestor/almacen/carpeta.ts:447-486` (`listar` fuera de la cola); `src/gestor/ui/estado/useCarteraAbierta.ts:96-98`.
- **Qué pasa:** Al volver, el guardado de salida va por la cola y `listar` no: la lista puede leerse antes de que termine y enseñar el número de movimientos y la fecha anteriores.
- **Arreglo propuesto:** Meter `listar` en `enCola`.
- **Confianza:** sospecha (depende de tiempos; confirmable en el navegador con una cartera grande).

#### GES-28 · Textos que no cuadran con el estado real (sin acceso a carpetas y comentarios)
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/gestor/ui/vistas/VistaComparar.tsx:108`; `src/gestor/ui/estado/useCarteraAbierta.ts:56`; `src/gestor/importacion/lectura.ts:338`.
- **Qué pasa:** En Firefox, Comparar dice «Elígela en la entrada del gestor», cosa imposible en ese navegador. Una cartera abierta desde un fichero en ese modo sale ya como «Cambios sin descargar» sin haber cambiado nada. El comentario de `leerFichero` dice que un `.xlsx` se lee «la primera hoja», cuando el lector recorre todas las hojas con marcas (`MARCA_DE_HOJA`).
- **Arreglo propuesto:** Texto según `hayAccesoACarpetas()`; `enDisco = inicial` al abrir un fichero; corregir el comentario.
- **Confianza:** confirmado en el código.

#### GES · Lo que está bien
- **El almacén**: escritura con `createWritable` y relectura comprobada, restitución si la verificación falla, cola de escrituras, copia antes de sustituir («antes no guardar que perder la versión anterior»), papelera en lugar de borrado, renombrado que quita el fichero viejo solo tras comprobar el nuevo, nombres saneados para Windows (reservados, longitud, puntos finales) y desempate por id.
- **La serialización** (`almacen/formato.ts`): orden de claves fijo, decimales como texto, campos desconocidos y `extensiones` conservados, BOM tolerado, versión futura rechazada con mensaje llano, cadena de migraciones preparada y probada. Guardar y reabrir no cambia cifras.
- **La separación pantalla/motor**: las vistas solo leen el `Analisis`; las métricas traen su ayuda en lenguaje llano y su motivo de ausencia («falta» frente a «no aplica»).
- **Estados**: casi todas las vistas tienen estado vacío con acción, carga del mercado sin parpadeo, «Reintentar», referencia «Leyendo…» que no enseña la comparación vieja, cálculos de Comparar independientes entre sí.
- **El asistente de importación**: tres pasos visibles, documentos que no salen del equipo, repetidos detectados, posiciones iniciales propuestas con su motivo cuando no se pueden, conciliación antes de tocar la cartera, deshacer por importación.
- `LineaDeAviso` escribe la gravedad (no depende del color); la tabla de meses lleva `caption`; el formulario se pinta desde la definición de cada tipo.

#### GES · Lo que no se ha podido mirar
- Nada en un navegador: ni el diálogo del sistema para elegir carpeta, ni el comportamiento real de `requestPermission` tras retirar el permiso, ni los seis anchos, ni el contraste de los fondos de la tabla de meses (`color-mix` al 10-42 %).
- El interior de los importadores (`importacion/andbank/propuesta.ts`, 883 líneas, y `plantilla/leer.ts`, 531) y `importacion/revision.ts` salvo `deshacerImportacion`: los he tomado como caja negra, con sus pruebas.
- Si `revisar`/`comprobar` y `preparar` bloquean la interfaz con extractos grandes: corren en el hilo principal dentro de `useMemo` en cada cambio (sospecha de rendimiento, a medir con un juego de 600 líneas).
- El contenido de los PDF y del Excel (sección de otro revisor); solo cómo los lanza el diálogo.
- `useAccessibleDialog` (foco atrapado y Escape) y `MenuButton`.

### MOT · Gestor de carteras: motor y cifras, comprobados a mano

#### MOT-01 · Un split en un activo sin serie de mercado dobla su valor
- **Gravedad:** crítica (cumple la definición: patrimonio y rentabilidad equivocados que vería un cliente). Exige un activo sin serie de la plataforma (manual o del catálogo sin precios) y un split; se corrige solo cuando se pone un precio posterior.
- **Dónde:** `src/gestor/motor/valoracion.ts:367` (los splits solo se cargan si `conSerieDeMercado`) y `:478` (el precio a mano o de operación se pasa a títulos de hoy dividiendo por esos splits, que aquí son ninguno).
- **Qué pasa:** el libro multiplica bien los títulos, pero la valoración sigue usando el precio de antes del split (el de la última operación o un precio a mano anterior) sin dividirlo por la razón.
- **Caso que lo demuestra:** 10 títulos a 100 el 02-01-2025, split 2×1 el 10-01. A mano: 10 × 100 = 1.000 antes, 20 × 50 = 1.000 después; TWR 0. Motor: 2.000 el 10-01 (TWR +100 %). Con un precio a mano de 105 el 05-01: debería ser 20 × 52,50 = 1.050; el motor da 2.100.
- **Arreglo propuesto:** cargar los splits también cuando no hay serie de mercado y aplicar `factorDeSplits` a los puntos de fuente `operacion` y `manual` anteriores al split (con serie de mercado ya se hace así). El campo `serieAjustada` solo debe afectar a los puntos de fuente `mercado`.
- **Confianza:** confirmado con prueba (`defectos.test.ts`, MOT-01, dos pruebas).

#### MOT-02 · El orden en el fichero de dos movimientos del mismo tipo y día cambia las cifras
- **Gravedad:** media.
- **Dónde:** `src/gestor/motor/libro.ts:120-129` (`ordenarMovimientos` desempata por la posición en el fichero) y `src/gestor/motor/valoracion.ts:175-190` (`cambiosEfectivos`: con dos cambios propios el mismo día gana el último del fichero).
- **Qué pasa:** está declarado en el código («a igualdad por su posición en el libro»), pero hace que la misma cartera dé cifras distintas según el orden de sus movimientos, que depende de cómo se tecleó o de cómo listaba el extracto importado (los bancos suelen listar del más reciente al más antiguo).
- **Caso que lo demuestra:** (1) dos compras del mismo activo el mismo día, 10 a 10 y 10 a 20, y una venta de 15 a 30: el realizado es 250 o 200 según cuál vaya antes (el total realizado + latente no cambia). (2) Sin serie de cambios, dos compras en USD el mismo día a 1,10 y 1,20: el patrimonio es 2.075,76 € o 1.924,25 € según el orden (2.000 $ / 1,10 o / 1,20).
- **Arreglo propuesto:** (1) tratar los lotes del mismo activo y día como un solo lote a coste medio (o desempatar por un criterio que no dependa del fichero, p. ej. el id); (2) con varios cambios propios el mismo día, usar su media ponderada por importe en lugar del último.
- **Confianza:** confirmado con prueba (`defectos.test.ts`, MOT-02, dos pruebas). Nota: barajar movimientos que no empatan (distinto día o distinto tipo) no cambia nada: comprobado en `guardarYReabrir.test.ts`.

#### MOT-05 · Observación: las comisiones de compra y venta van dentro de la «Variación de precio»
- **Gravedad:** media (transparencia de costes ante el cliente).
- **Dónde:** `src/gestor/motor/valoracion.ts:524-527` (lo invertido incluye la comisión) y `src/gestor/motor/desglose.ts:4`; en pantalla, `src/gestor/ui/vistas/VistaResumen.tsx:118` rotula esa línea «Lo que han subido o bajado los precios».
- **Qué pasa:** está implementado como declara la cabecera (los costes con `yaDescontado` no se restan aparte), pero en «De dónde viene el resultado» las comisiones de operación restan del efecto precio, y la línea de costes solo lleva custodia, asesoramiento e impuestos de la cuenta.
- **Caso que lo demuestra:** `desglose.test.ts`: precio 406,67 = 416,67 de subida − 10 de comisión de compra; costes 15 (solo custodia). Las comisiones sí salen aparte en Ingresos y costes (`costesDeOperacion` = 10).
- **Arreglo propuesto:** decisión de producto. Opción A: sacar las comisiones de operación del efecto precio y sumarlas a costes (el desglose sigue cuadrando). Opción B: dejarlo y cambiar el rótulo. Recomiendo A: el cliente ve todo lo que le cobran en una línea.
- **Confianza:** confirmado con prueba (comportamiento declarado).

#### MOT-03 · Una cifra que se escribe «0,00 €» se pinta en rojo
- **Gravedad:** baja.
- **Dónde:** `src/gestor/ui/formato.ts:104-108` (`claseDelSigno` redondea a `decimales + 2` = 4 decimales, pensado para fracciones de porcentaje) y `src/gestor/ui/piezas.tsx:13` (`Cifra` lo usa igual para importes).
- **Qué pasa:** para un importe, −0,004 € se escribe «0,00 €» pero lleva la clase `gestor-baja`.
- **Caso que lo demuestra:** `<Cifra valor={-0.004}>{importe(-0.004)}</Cifra>` → `<span class="gestor-cifra gestor-baja">0,00 €</span>`.
- **Arreglo propuesto:** que `Cifra` reciba los decimales con que se escribió la cifra (o su formato) y `claseDelSigno` redondee igual que el texto.
- **Confianza:** confirmado con prueba (`defectos.test.ts`, MOT-03).

#### MOT-04 · El formato de pantalla escribe «NaN €» con una cifra ausente
- **Gravedad:** baja. Hoy las pantallas filtran los `null` antes de llamar (lo he mirado en los usos de `importe`); no he encontrado un camino que lo pinte.
- **Dónde:** `src/gestor/ui/formato.ts:11-16`.
- **Qué pasa:** a diferencia de `informes/formato.ts` («No disponible»), `ui/formato.ts` no trata `NaN` ni `undefined`: `importe(NaN)` → «NaN €».
- **Caso que lo demuestra:** `importe(Number.NaN)` y `importe(undefined)` → «NaN €».
- **Arreglo propuesto:** devolver un texto de ausencia («—» o «No disponible») cuando la cifra no es finita, como el informe.
- **Confianza:** confirmado con prueba (`defectos.test.ts`, MOT-04).

#### MOT-06 · Observación: el latente de un bono incluye el cupón corrido devengado
- **Gravedad:** baja.
- **Dónde:** `src/gestor/motor/analisis.ts:289` con el valor de `valoracion.ts:583-585` (precio limpio × multiplicador + corrido).
- **Qué pasa:** el valor del bono es el sucio y el coste también (si se pagó corrido), así que la cuenta es coherente, pero la «plusvalía latente» mezcla precio con interés devengado; además, en Cuentas el precio que se enseña es el limpio y el valor, el sucio.
- **Caso que lo demuestra:** `valoracion.test.ts`: comprado a 98 con corrido 0, a 99 seis meses después: latente 300 = 100 de precio + 200 de cupón corrido.
- **Arreglo propuesto:** dar el cupón corrido como línea aparte del latente del bono (o enseñar el valor limpio y el corrido por separado).
- **Confianza:** confirmado con prueba.

#### MOT-07 · Observación: un año natural bisiesto se anualiza
- **Gravedad:** baja.
- **Dónde:** `src/gestor/motor/rentabilidad.ts:21` y `:143` (se anualiza desde 366 días).
- **Qué pasa:** es la regla declarada, pero el periodo «1 año» que acaba en un año bisiesto dura 366 días y sale anualizado (exponente 365,2425/366), mientras que el de un año normal (365) no.
- **Caso que lo demuestra:** `rentabilidad.test.ts` (e): del 31-12-2023 al 31-12-2024, `anualiza` = true.
- **Arreglo propuesto:** anualizar desde «más de un año por fechas» (`hasta > sumarAnios(desde, 1)`), no por días.
- **Confianza:** confirmado con prueba.

#### MOT-08 · Hallazgo (no es del motor): los tres formateadores no escriben igual la misma cifra
- **Gravedad:** baja.
- **Dónde:** `src/gestor/ui/formato.ts`, `src/gestor/informes/formato.ts:24`, `src/core/format.ts` (`fmtPct`, `fmtNum`, `fmtEur`).
- **Qué pasa:** coinciden en dígitos, signo y redondeo de los importes en euros y de los porcentajes habituales, pero: (1) el espacio antes del € es normal en pantalla y duro (U+00A0) en informe y `fmtEur`; (2) fuera del euro, la pantalla escribe «1.234,56 $» y el informe «1234,56 USD», sin punto de miles; (3) `fmtPct` y `fmtNum` no agrupan las cuatro cifras («1234,50 %», «1234,56»); (4) `fmtPct(−0,00004)` y `fmtNum(−0,001)` escriben «−0,00 %» y «−0,00», y `fmtEur(−0,005, 0)` «−0 €» (la pantalla y el informe lo limpian, el resto de la app que use `core/format.ts` no); (5) «pp» en pantalla, «p.p.» en el informe del asesor.
- **Caso que lo demuestra:** `formatoDePantalla.test.ts`, prueba «hallazgo…», con cada texto.
- **Arreglo propuesto:** que el informe agrupe también fuera del euro (`useGrouping: "always"` en `fmtNum` para ese uso) y que `core/format.ts` no escriba un cero negativo; el espacio y «pp/p.p.» son decisiones de estilo.
- **Confianza:** confirmado con prueba.

#### MOT-09 · Observación: la pantalla fecha el inicio del periodo un día antes que el informe
- **Gravedad:** baja.
- **Dónde:** `src/gestor/ui/analisis/BloqueRentabilidad.tsx:14`, `src/gestor/ui/analisis/BloqueContribucion.tsx:103`, `src/gestor/ui/vistas/VistaComparar.tsx:93` frente a `src/gestor/informes/formato.ts:90` (`primerDiaDelPeriodo`).
- **Qué pasa:** el motor mide desde el cierre de `desde`; el informe lo escribe como el día siguiente («del 1 de enero») y la pantalla escribe la fecha del cierre («Del 31 dic»). El mismo periodo lleva dos fechas de inicio.
- **Caso que lo demuestra:** leído en el código, sin prueba.
- **Arreglo propuesto:** usar `primerDiaDelPeriodo` también en pantalla.
- **Confianza:** sospecha (leído en el código).

#### MOT-10 · Observación: la tabla de contribución redondea cada celda por su cuenta
- **Gravedad:** baja.
- **Dónde:** `src/gestor/ui/analisis/BloqueContribucion.tsx:85-97` (el pie usa `desglose.precio`, `.divisa`… sin cuadrar; el Resumen sí usa `desglose.cuadrado`, `VistaResumen.tsx:32`).
- **Qué pasa:** en la fila «Toda la cartera», precio + ingresos + divisa − costes puede diferir un céntimo del resultado escrito. En el caso de `desglose.test.ts`: 406,67 + 40,00 + 166,67 − 15,00 = 598,34 frente a 598,33.
- **Arreglo propuesto:** usar `desglose.cuadrado` en el pie, como el Resumen y los informes.
- **Confianza:** sospecha (cuenta hecha sobre las cifras del motor; la tabla no se ha pintado en prueba).

#### MOT-11 · Observación: el corte por fecha valor se aplica también a la cuenta de valores
- **Gravedad:** baja.
- **Dónde:** `src/gestor/motor/libro.ts:371-372` (`cuentasA` con `criterio: "valor"`).
- **Qué pasa:** con fecha valor, una compra no liquidada no solo no ha cargado el efectivo: tampoco hay títulos. Hoy la pantalla solo usa el efectivo de ese corte (`VistaCuentas.tsx:152`), así que no se ve.
- **Caso que lo demuestra:** `saldos.test.ts`: el 05-01, por fecha valor, 0 títulos; por operación, 50.
- **Arreglo propuesto:** documentarlo en `cuentasA` o limitar el criterio de fecha valor a los efectos de efectivo.
- **Confianza:** confirmado con prueba.

### DIS · Diseño de cartera, Carteras guardadas y Posiciones

#### DIS-01 · Optimizar deja el importe fijo antiguo y un cambio de capital deshace la optimización en esa posición
- **Gravedad:** alta
- **Categoría:** cálculo
- **Dónde:** `src/components/PortfolioBuilder.tsx:322-344` (aplicar), `:641-672` (cambio de capital), `src/pages/PortfolioBuilderPage.tsx:275-282`
- **Qué pasa:** una posición con «Importe fijo» (`keepEuros`, p. ej. tras sustituir con «Mantener €») no lleva candado, así que el optimizador la mueve. Al aplicar, solo se cambia `weight_percent`; `targetEuros` se queda con el importe anterior. En cuanto el asesor toca el capital, `handleCapitalChange` recoloca esa posición en `targetEuros / capital`, es decir, en su peso de antes de optimizar, y las libres absorben la diferencia. La propuesta aplicada se deshace en parte sin decirlo, y lo que vería el cliente en el informe ya no es lo que se aprobó.
- **Cómo reproducirlo:** sustituir una posición con «Mantener €» (queda «Importe fijo» al 20 %) → Optimizar → Aplicar (queda, p. ej., al 5 %) → cambiar el capital de 100.000 € a 110.000 € → la posición pasa a ~18,2 % (20.000 € / 110.000 €).
- **Evidencia:**
  ```ts
  // PortfolioBuilder.tsx:339-342 — solo el peso
  positions.forEach((position) => {
    if (!locks[position.asset_id]) onWeightChange(position.asset_id, round2((weights[position.asset_id] ?? 0) * 100));
  });
  // PortfolioBuilder.tsx:653-662 — el ancla antiguo manda al cambiar el capital
  const anchored = positions.filter((p) => p.keepEuros && !locks[p.asset_id] && typeof p.targetEuros === "number");
  anchored.forEach((p) => { nextWeights[p.asset_id] = ((p.targetEuros ?? 0) / safeCapital) * 100; });
  ```
- **Arreglo propuesto:** decidir una de dos y aplicarla igual en Optimizar y en «Reparte por clase»: o el optimizador trata «Importe fijo» como fijo (pasarle `fixedWeights` en vez de `lockedWeights`), o al aplicar se llama a `syncKeptAmount` (o se suelta el ancla) en cada posición `keepEuros` cuyo peso cambia. Prueba: cartera con una posición `keepEuros`, aplicar pesos, cambiar capital, y comprobar que el peso aplicado se conserva.
- **Confianza:** confirmado en el código

#### DIS-02 · «Nivel de riesgo (n/10)» del optimizador no es el nivel de perfil de la cartera, y se llama igual
- **Gravedad:** alta
- **Categoría:** incoherencia
- **Dónde:** `src/components/OptimizerPanel.tsx:25`, `:139`, `:231`, `:393-405`; `src/components/PerfilYHorizonteDeLaCartera.tsx:274-289`; `src/components/GeneradorDeBorrador.tsx:239`, `:275-283`
- **Qué pasa:** en Componer, «Perfil de riesgo» es el nivel 1-10 de la cartera (decisión 59). En el generador, «Nivel de riesgo» es ese mismo nivel, con su % de renta variable. En Optimizar, el objetivo «Nivel de riesgo» con su deslizador «Nivel de riesgo (5/10)» es un **percentil de la frontera** (`riskTargetMode: "FRONTIER_PERCENTILE"`), arranca siempre en 5 y no lee el nivel de la cartera. Un asesor con una cartera de nivel 3 que elige «Nivel de riesgo 3/10» cree que optimiza para su perfil, y obtiene el tercer decil de la frontera de sus activos, que puede no tener nada que ver con el 20 % de renta variable del nivel 3. Ningún texto lo explica junto al deslizador.
- **Cómo reproducirlo:** Componer → Perfil de riesgo «3» → Optimizar → Objetivo «Nivel de riesgo» → el deslizador dice «5/10».
- **Evidencia:**
  ```tsx
  { value: "TARGET_RISK", label: "Nivel de riesgo" }                       // OptimizerPanel.tsx:25
  riskTargetMode: parameters.objective === "TARGET_RISK" ? "FRONTIER_PERCENTILE" : undefined, // :231
  <span>Nivel de riesgo ({riskSlider}/10)</span>                            // :395
  ```
- **Arreglo propuesto:** renombrar el objetivo y el deslizador a algo que no choque («Posición en la frontera», «Riesgo relativo, de menor a mayor») y añadir una pista de una línea; no usar la escala /10. Si se quiere un objetivo ligado al perfil, que sea otro objetivo, explícito. Prueba de texto: el rótulo del deslizador no contiene «Nivel de riesgo».
- **Confianza:** confirmado en el código

#### DIS-03 · «Guardar» sobrescribe sin comprobar que la guardada no ha cambiado: dos pestañas o dos equipos se pisan
- **Gravedad:** alta
- **Categoría:** funcional
- **Dónde:** `src/core/guardarCartera.ts:20-35`, `:77-94`; `src/app/useCicloDeCartera.tsx:71-73`, `:95-102`; `src/core/carterasGuardadasAvisos.ts:14-25`; `src/core/draftStorage.ts:10-16`; `src/app/BdbActivosApp.tsx:713-719`
- **Qué pasa:** la cartera abierta (`abierta`) se recuerda en `sessionStorage` con el borrador. Duplicar una pestaña copia `sessionStorage`, así que las dos pestañas creen tener abierta la misma cartera guardada, y la barra dice «Esta pestaña tiene su propia cartera activa». Cada «Guardar» manda el mismo `portfolio_id` y el servidor sobrescribe: gana el último, sin aviso. Lo mismo entre dos ordenadores con la misma cuenta. El aviso de «eliminada» es un `Set` en memoria de la pestaña, así que borrar la cartera en otra pestaña o equipo no la desvincula, y el siguiente «Guardar» la vuelve a escribir con el id borrado (sospecha sobre lo que hace el servidor con un id inexistente).
- **Cómo reproducirlo:** abrir una cartera guardada → duplicar la pestaña → cambiar un peso en cada una → «Guardar» en A y luego en B → al abrirla otra vez solo queda lo de B.
- **Evidencia:**
  ```ts
  // guardarCartera.ts:84-94 — mismo id, sin versión ni fecha que comprobar
  portfolioId: sobre?.portfolio_id, createdAt: sobre?.created_at
  ...
  const { cartera: guardada, avisos, enLaCuenta } = await persistirCartera(sourceKind, cartera);
  // carterasGuardadasAvisos.ts:14 — solo la pestaña que lo emite se entera
  const oyentes = new Set<(aviso: AvisoDeCarteras) => void>();
  ```
- **Arreglo propuesto:** mandar al guardar el `updated_at` con el que se abrió (`abierta.updated_at`) y que el servidor rechace si no coincide; ante el rechazo, ofrecer «Guardar como…» o «Sobrescribir igualmente». Llevar los avisos de guardada y eliminada por el `BroadcastChannel` que ya usa `useOtraPestana`. Prueba: dos ciclos con la misma `abierta`, el segundo guardado recibe conflicto.
- **Confianza:** confirmado en el código que no hay control de concurrencia; el escenario de la pestaña duplicada es el comportamiento estándar del navegador, sin comprobar aquí

#### DIS-04 · «Máx. por activo (%)» se reescribe en cada tecla: borrar deja un 1 y lo siguiente que se escribe se le añade
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/components/OptimizerPanel.tsx:353-364` (y la rotación, `:386-390`; «Máx. sustituciones» en `src/components/PortfolioImprovementPanel.tsx`)
- **Qué pasa:** el campo controlado recorta en cada `onChange`. Al borrar «100» con la tecla de retroceso, el campo vacío vale `Number("") = 0`, se recorta a 1 y aparece «1»; si el asesor escribe «5», queda «15». Optimiza con un tope que no ha pedido, y el valor solo se ve si se mira el campo.
- **Cómo reproducirlo:** Optimizar → en «Máx. por activo» borrar con retroceso hasta vaciar → escribir 5 → el campo dice 15.
- **Evidencia:**
  ```tsx
  onChange={(event) => setMaxWeight(Math.max(1, Math.min(100, Number(event.target.value))))}
  ```
- **Arreglo propuesto:** borrador de texto local y validación al confirmar (blur/Intro), como `EuroAmountInput`, con aviso si se sale de 1-100. Prueba: vaciar y teclear 5 da 5.
- **Confianza:** confirmado en el código

#### DIS-05 · Un peso por encima de 100 se recorta en silencio, y «12.500» se lee como doce mil quinientos
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/components/PortfolioBuilder.tsx:493-505`; `src/components/PortfolioPositionsTable.tsx:172-178`; `src/core/numberFormat.ts` (regla 5)
- **Qué pasa:** el campo de peso usa el lector de importes europeo, donde «12.500» son miles (12500). En modo Libre, `clampPercent` lo deja en 100 % sin aviso (el aviso solo existe en modo Proporcional). Lo mismo con «150». Quien teclea un decimal con punto, o se equivoca de cifra, ve la posición al 100 % y la cartera al 1xx %, sin saber por qué.
- **Cómo reproducirlo:** Componer, modo Libre → peso de una posición «12.500» o «150» → queda 100.
- **Evidencia:**
  ```ts
  const requestedWeight = clampPercent(value);
  setWeightNotice(null);
  if (editMode === "free") { commitWeights({ [assetId]: requestedWeight }); return; }
  ```
- **Arreglo propuesto:** en el campo de peso, rechazar (marcar no válido) lo que pase de 100 en vez de recortar, y tratar «12.500» como ambiguo en un campo de porcentaje. Prueba: teclear «150» deja el campo marcado y el peso sin cambiar.
- **Confianza:** confirmado en el código

#### DIS-06 · La misma frontera con tres ventanas: el optimizador no usa el periodo común de análisis
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/OptimizerPanel.tsx:27`, `:133`, `:343-352`; `src/components/PortfolioHorizonPanel.tsx:27-31`, `:157`; `src/components/PortfolioImprovementPanel.tsx` (`WINDOW_OPTIONS`)
- **Qué pasa:** Componer («Riesgo y rentabilidad») y Simular dibujan la frontera con el periodo común (3 o 5 años, `useAnalysisWindow`), y Simular dice «El periodo elegido se comparte con las métricas, la comparativa y el informe». Optimizar tiene su propia «Ventana» (1A, 3A, 5A, 10A, por defecto 3A) que no lee ni escribe ese periodo. Con el periodo común en 5 años, el asesor ve en Componer una frontera y en Optimizar otra, de la misma cartera, y los rótulos ni siquiera coinciden («3 años» frente a «3A»).
- **Cómo reproducirlo:** Simular → periodo «5 años» → Optimizar → la ventana sigue en «3A».
- **Evidencia:**
  ```tsx
  const WINDOWS: FrontierWindow[] = ["1Y", "3Y", "5Y", "10Y"];                 // OptimizerPanel.tsx:27
  const [windowSel, setWindowSel] = useState<FrontierWindow>(enSesion?.windowSel ?? "3Y"); // :133
  {w.replace("Y", "A")}                                                         // :348
  ```
- **Arreglo propuesto:** que Optimizar arranque en el periodo común y lo diga; si se quiere ofrecer 1 y 10 años, como excepción visible («distinta del periodo común»). Mismo rótulo en toda la sección («3 años»). Prueba: con el periodo común en 5Y, el optimizador abre en 5Y.
- **Confianza:** confirmado en el código

#### DIS-07 · El peso total se escribe con un decimal o con dos según la pantalla
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/app/BdbActivosApp.tsx:80-83` y `src/components/PortfolioBuilder.tsx:815`, `:958` (1 decimal); `src/pages/CarterasGuardadasPage.tsx:51-52`, `:77` (`fmtPct` por defecto, 2); `src/components/PortfolioImportPanel.tsx:232` (2); `src/components/OptimizationPreviewPanel.tsx:247`, `:271` (2); `src/components/GeneradorDeBorrador.tsx:217` (2); `src/components/CambiosDePeso.tsx:36` (2)
- **Qué pasa:** la misma cartera sale «100,0 %» en la barra superior y en Diseño, y «Suman 100,00 %» en Carteras guardadas; un peso sale «12,5 %» en Comprobar y «12,50 %» en la comprobación previa de Optimizar. Con la tolerancia de ±0,05 puntos, «99,96 %» en una pantalla es «100,0 %» en la otra.
- **Cómo reproducirlo:** guardar una cartera y comparar la suma en Diseño y en Carteras guardadas.
- **Evidencia:**
  ```ts
  ? { texto: fmtPct(suma / 100), valor: suma }   // CarterasGuardadasPage.tsx:51 — dos decimales
  {fmtPct(weightSum / 100, 1)}                    // PortfolioBuilder.tsx:958 — uno
  ```
- **Arreglo propuesto:** un solo formateador para «suma de pesos» y otro para «peso de una posición», con los decimales decididos una vez, en `core/format.ts`. Prueba: la suma de una cartera da la misma cadena en las tres pantallas.
- **Confianza:** confirmado en el código

#### DIS-08 · Lo que falta se escribe «N/D» en pantalla, junto a «Falta el dato» y «No aplica»
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/PortfolioPositionsTable.tsx:159-164`; `src/components/PortfolioSummary.tsx:73`, `:92`, `:113`; `src/components/PortfolioConstraintsPanel.tsx:14`; `src/components/PositionsWorkbench.tsx:774-792`, `:819`, `:827`, `:845`; `src/components/FundSwapModal.tsx:160-166`, `:219`; `src/components/PortfolioImprovementPanel.tsx` (`signed`, `MetricRow`); `src/components/PortfolioManagementFee.tsx:80`
- **Qué pasa:** `textoDeAusencia.ts` dice que «N/D» es del papel y que la pantalla usa «Falta el dato», «No aplica» o «Sin pedir». En esta sección conviven los dos: la tabla de alternativas dice «Falta», las KPI de Posiciones «N/D», la columna Producto · clase «N/D» (también mientras cargan las fichas, ver DIS-09), y el modal de costes «queda N/D». El asesor no puede distinguir «no existe» de «todavía no ha llegado».
- **Cómo reproducirlo:** Posiciones → analizar un extracto con un fondo sin coste → KPI «Coste medio conocido: N/D»; en Sustituir, el mismo hueco dice «Falta».
- **Evidencia:**
  ```tsx
  {asset?.instrument_type ? TYPE_LABELS[asset.instrument_type] ?? readableBackendLabel(asset.instrument_type) : ND}
  ```
- **Arreglo propuesto:** sustituir `ND` por `<Ausencia clase=…>` / `textoDeAusencia` en los componentes de pantalla, eligiendo la clase en cada caso; dejar `ND` solo en `src/reports/`. Una regla de lint o prueba que prohíba importar `ND` fuera de `reports`.
- **Confianza:** confirmado en el código

#### DIS-09 · Diseño no dice que está cargando, y la tabla enseña el ISIN aunque la posición traiga su nombre
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/pages/PortfolioBuilderPage.tsx:190-220`, `:517-519`; `src/components/PortfolioPositionsTable.tsx:117`
- **Qué pasa:** al abrir una cartera guardada o importar, las fichas tardan; `load.loading` no se usa en ninguna parte, así que no hay estado de carga. Mientras tanto, la tabla nombra cada posición por su `asset_id` (ignora `position.label`, que sí usa `nameOf` en el mismo componente) y Producto · clase dice «N/D». Con 30 posiciones el asesor ve una tabla de ISIN y «N/D» que parece un fallo del catálogo. Lo mismo, de forma permanente, para una posición que el catálogo no conoce.
- **Cómo reproducirlo:** Carteras guardadas → Abrir una de 30 posiciones con red lenta.
- **Evidencia:**
  ```tsx
  const nombre = asset?.display_name ?? position.asset_id;   // PortfolioPositionsTable.tsx:117
  ```
- **Arreglo propuesto:** `asset?.display_name ?? position.label ?? position.asset_id`; mientras `load.loading` y no haya ficha, la celda dice «Leyendo…» como en Carteras guardadas. Prueba: tabla con `assets=[]` y posiciones con `label` enseña el `label`.
- **Confianza:** confirmado en el código

#### DIS-10 · Las notas de la cartera no se anuncian
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/components/PortfolioBuilder.tsx:892-894`
- **Qué pasa:** «Importadas 12 posiciones…», «Posición sustituida por…», los avisos al guardar y «La cartera ha vuelto a los pesos de antes» van en un `div` sin `role="status"` ni `aria-live`. Quien usa lector de pantalla no se entera de que la importación se ha cargado o de que el guardado ha dejado posiciones fuera. El aviso de importación pendiente de al lado sí lleva `role="status"`.
- **Cómo reproducirlo:** importar con lector de pantalla y confirmar: no se anuncia nada.
- **Evidencia:**
  ```tsx
  ) : portfolioNotice && !importando ? (
    <div className="portfolio-notice">{portfolioNotice}</div>
  ```
- **Arreglo propuesto:** `role="status"` en ese bloque (y en el de `CarterasGuardadasPage` ya está). Prueba de accesibilidad: el texto de la nota está en una región viva.
- **Confianza:** confirmado en el código

#### DIS-11 · Tres «perfiles» en la misma pantalla que no se hablan
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/PerfilYHorizonteDeLaCartera.tsx:275` («Perfil de riesgo», Componer); `src/components/RiskProfilePreviewPanel.tsx:49-65` («Perfil elegido (informativo)», Comprobar); `src/components/GeneradorDeBorrador.tsx:239`, `:276` («Nivel de riesgo», arranque); `src/pages/PortfolioBuilderPage.tsx:480-494`; `src/components/PortfolioBuilder.tsx:781`
- **Qué pasa:** el nivel de la cartera arrastra el perfil elegido, pero no al revés (decisión 59, a propósito). El generador, en cambio, abre con el perfil elegido de Comprobar y no con el nivel de la cartera, y si no hay ninguno abre en **5**, contra la decisión 14 («nadie llega con un perfil puesto»). Y al usar un borrador de nivel 3, la cartera resultante queda con «Perfil de riesgo: Sin definir»: la nota dice «Borrador del nivel 3», el campo dice otra cosa, y Comprobar no avisa de nada contra el mercado objetivo porque la cartera no tiene nivel.
- **Cómo reproducirlo:** cartera nueva → Generar borrador (sale «Nivel 5») → elegir 3 → Usar → Componer: «Perfil de riesgo: Sin definir».
- **Evidencia:**
  ```tsx
  const [nivel, setNivel] = useState(nivelInicial ?? 5);                                    // GeneradorDeBorrador.tsx:239
  sustituirCartera({ positions: ..., capital: ..., nombre: ... })  // sin perfilYHorizonte   // PortfolioBuilderPage.tsx:484-488
  ```
- **Arreglo propuesto:** decisión de Óscar: (a) el borrador fija el nivel de la cartera al usarlo (`perfilYHorizonte: { risk_profile_level: borrador.nivel }`) y el generador abre con el nivel de la cartera o sin nivel elegido; (b) dejarlo como está y decirlo. Recomiendo (a). En la arquitectura, juntar «Perfil de riesgo» y «Perfil elegido» en un solo bloque que explique la diferencia.
- **Confianza:** confirmado en el código

#### DIS-12 · Carteras guardadas: no se puede duplicar, renombrar ni buscar, y «Eliminar» admite doble pulsación
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/pages/CarterasGuardadasPage.tsx:258-289`, `:172-186`; `src/core/useSavedPortfolios.ts:165-191`
- **Qué pasa:** las acciones por fila son Abrir, Comparar y Eliminar. Duplicar exige abrir y «Guardar como…» en Diseño (y si Diseño tiene cambios, pasar por el aviso); renombrar exige abrir, cambiar el nombre y guardar. Con 18 o más carteras no hay campo de búsqueda. Mientras se elimina no hay estado en la fila ni se desactiva el botón: un segundo clic lanza otra confirmación y otra llamada.
- **Cómo reproducirlo:** Carteras guardadas con red lenta → Eliminar → confirmar → volver a pulsar Eliminar en la misma fila antes de que desaparezca.
- **Evidencia:**
  ```tsx
  <Button aria-label={`Eliminar ${cartera.name}`} onClick={() => void eliminar(cartera)} size="sm" variant="quiet">
  ```
- **Arreglo propuesto:** añadir «Duplicar» y «Renombrar» por fila (las dos con `persistirCartera`), un filtro por nombre sobre la tabla, y un estado `eliminando` por id que desactive la fila. Pruebas en `tests/` de la página.
- **Confianza:** confirmado en el código

#### DIS-13 · Posiciones: «Ver» alternativas abre el bloque lejos, y los dos «Ver» de cada fila no se distinguen
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/components/PositionsWorkbench.tsx:809-829`, `:1135-1169`
- **Qué pasa:** cada fila lleva dos botones con el texto «Ver» (detalle y alternativas) y sin `aria-label`: un lector de pantalla oye «Ver, botón» dos veces por fila. Al pulsar el de alternativas, el panel aparece debajo de la tabla entera; con 40 posiciones, fuera de la vista, sin desplazar ni mover el foco, y parece que el botón no hace nada.
- **Cómo reproducirlo:** analizar un extracto de 30 posiciones → «Ver» en la columna Alternativas de la primera fila.
- **Evidencia:**
  ```tsx
  <Button onClick={() => showAlternatives(posicion.asset!)} size="sm" variant="secondary">Ver</Button>
  ```
- **Arreglo propuesto:** `aria-label={\`Ver alternativas a ${nombre}\`}` y `\`Ver el detalle de ${nombre}\``; al abrir, `scrollIntoView` y foco en el título del panel (como hace Carteras guardadas con la radiografía). Prueba: el nombre accesible de cada botón es único.
- **Confianza:** confirmado en el código (el desplazamiento, sospecha: comprobar en navegador)

#### DIS-14 · Una diferencia de pesos se escribe «pp» y la de rentabilidad «puntos», en el mismo diálogo; y «Máx.»/«Máximo»
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/CambiosDePeso.tsx:38-41` («pp») y `:107-111` («puntos»); `src/components/PortfolioImprovementPanel.tsx` (`signed`, «pp»); `src/components/OptimizerPanel.tsx:22-23`, `:75`; `src/components/FrontierHistoricalView.tsx:49-50`, `:305`
- **Qué pasa:** en «Revisar propuesta», la tabla de cambios dice «+2,50 pp» y, encima, las cifras dicen «−1,51 puntos». El objetivo se llama «Máximo Sharpe» y «Mínima volatilidad» en el selector, y «Máx. Sharpe» y «Mín. volatilidad» en el gráfico y las tarjetas. Son la misma cosa con dos nombres en la misma vista.
- **Cómo reproducirlo:** Optimizar → Optimizar → leer el diálogo de revisión.
- **Evidencia:**
  ```ts
  return `${redondeado > 0 ? "+" : ""}${fmtNum(redondeado)} pp`;             // CambiosDePeso.tsx:40
  return `${redondeado > 0 ? "+" : ""}${fmtNum(redondeado * 100)} puntos`;   // CambiosDePeso.tsx:110
  ```
- **Arreglo propuesto:** una sola unidad (recomiendo «pp», que es corta y ya usa el papel de Propuesta de mejora) y un solo nombre por objetivo en un módulo de rótulos. Prueba de texto sobre el diálogo.
- **Confianza:** confirmado en el código

#### DIS-15 · «Asignación táctica» no existe con ese nombre, y la herramienta que edita pesos por clase vive en Simular
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/CapitalContributionPanel.tsx:161-162`; `src/components/PortfolioBuilder.tsx:1165-1171`; `src/components/MacroAllocationPanel.tsx:112-113`
- **Qué pasa:** la ayuda de la aportación dice «Para mantener el capital y solo reordenar, usa la asignación táctica». No hay nada con ese rótulo: el panel se titula «Reparte por clase de activo» y está en el paso **Simular**, que por lo demás solo mide. Un asesor que busca dónde cambiar pesos por clase no lo encuentra en Componer, que es donde se editan pesos.
- **Cómo reproducirlo:** Componer → leer la nota bajo «Añade dinero y reparte» → buscar «asignación táctica».
- **Evidencia:**
  ```tsx
  sigue sumando el 100 % del nuevo capital. Para mantener el capital y solo reordenar, usa la asignación táctica.
  ...
  {step === "simulate" ? (<><MacroAllocationPanel ... onWeightChange={onWeightChange} />
  ```
- **Arreglo propuesto:** mover «Reparte por clase de activo» a Componer (junto a la aportación) y nombrarlo igual en la ayuda. Decisión de arquitectura de información para Óscar.
- **Confianza:** confirmado en el código

#### DIS-16 · Las dos exportaciones a CSV de la sección hablan formatos distintos
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/PortfolioBuilder.tsx:741-760`; `src/core/positionsShared.ts:35-39`, `:93-95`
- **Qué pasa:** «Exportar a CSV» de Diseño escribe separador coma, decimal con punto (`12.5`), cabeceras en inglés técnico (`asset_id,peso_percent,importe_eur`) y sin BOM: un Excel en español lo abre en una sola columna y con acentos rotos en los nombres. «Exportar CSV» de Posiciones usa punto y coma, coma decimal y BOM. Mismo botón, dos resultados.
- **Cómo reproducirlo:** exportar en Diseño y abrir con Excel en español.
- **Evidencia:**
  ```ts
  const lines = ["asset_id,nombre,peso_percent,importe_eur"];
  lines.push(`${position.asset_id},"${name}",${position.weight_percent},${euros}`);
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  ```
- **Arreglo propuesto:** usar `csvCell` y `downloadCsv` de `positionsShared` también en Diseño, con cabeceras en español. Si alguien depende del formato máquina (reimportar), comprobar que el lector acepta el nuevo. Prueba: el CSV de Diseño empieza por BOM y usa «;».
- **Confianza:** confirmado en el código

#### DIS-17 · «Llevar a Diseño de cartera» bautiza la cartera «Extracto externo» y no dice qué ha entrado
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/core/positionsToPortfolio.ts:48`; `src/app/BdbActivosApp.tsx:352-358`; `src/components/PortfolioBuilder.tsx:811-812`
- **Qué pasa:** el traspaso desde Posiciones pone como nombre de la cartera el del modo, «Extracto externo». Diseño titula la página con ese nombre, la barra superior dice «Cartera · Extracto externo» y, si el asesor pulsa «Guardar», la cartera de su cliente se guarda así. Y a diferencia de importar en Diseño, al llegar no hay nota de cuántas posiciones han entrado ni de las que se han quedado fuera (lo dice solo Posiciones, antes de pulsar).
- **Cómo reproducirlo:** Posiciones → Analizar → «Llevar a Diseño de cartera».
- **Evidencia:**
  ```ts
  return { positions, totalCapital, name: "Extracto externo", excludedIds, excludedCapital };
  ```
- **Arreglo propuesto:** nombre vacío (como una importación que sustituye a otra, decisión 38) y una nota en Diseño con lo que ha entrado y lo excluido. Prueba: tras el traspaso, `portfolioName === ""` y hay nota.
- **Confianza:** confirmado en el código

#### DIS-18 · El diálogo «Importar cartera» trae también el Buscador y el generador; con la cartera vacía, «Ir al Buscador» sale dos veces
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/PortfolioBuilder.tsx:763-791`, `:851-853`, `:1214-1222`; `src/components/PortfolioPositionsTable.tsx:86-95`
- **Qué pasa:** el botón y el diálogo se llaman «Importar cartera», pero dentro están las tres formas de empezar (Buscador, importar, generar borrador). Con la cartera vacía, el panel «Empieza tu cartera» y el estado vacío de la tabla repiten «Ir al Buscador» uno encima de otro.
- **Arreglo propuesto:** rotular «Empezar otra cartera» o dejar solo la importación en el diálogo; quitar el estado vacío de la tabla cuando ya está el panel de arranque.
- **Confianza:** confirmado en el código

#### DIS-19 · El recuadro «Cartera activa» no dice si hay cambios sin guardar, y por debajo de 900 px pierde su nombre accesible
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/app/BdbActivosApp.tsx:131-164`; `src/styles/layout.css:872-877`
- **Qué pasa:** el recuadro de la barra superior enseña nombre, posiciones y suma, pero no «sin guardar», que es lo que más le importa al asesor al cambiar de pantalla. Por debajo de 900 px el CSS oculta el rótulo y el nombre, y el botón (sin `aria-label`) queda como «3 posiciones · 100,0 %». Y con nombre, pero sin posiciones, no sale.
- **Arreglo propuesto:** `aria-label` fijo («Abrir la cartera activa…») y una marca de «sin guardar» (`ciclo.sinGuardar`).
- **Confianza:** confirmado en el código

#### DIS-20 · El cálculo del optimizador no se anuncia ni se puede cancelar, y la revisión salta sola como modal
- **Gravedad:** baja
- **Categoría:** estado
- **Dónde:** `src/components/FrontierHistoricalView.tsx:197-203`; `src/components/OptimizerPanel.tsx:241-246`
- **Qué pasa:** «Calculando la frontera con series históricas…» no lleva `role="status"`, no hay botón de cancelar (el servidor admite hasta cinco minutos en otros cálculos), y al terminar se abre el diálogo de revisión sin que el asesor lo pida; si ha cambiado de pestaña o está leyendo otra parte, el foco salta al diálogo.
- **Arreglo propuesto:** `role="status"`, «Cancelar» que invalide `requestSequence`, y abrir la revisión desde la tarjeta («Revisar propuesta») en vez de automáticamente, o avisar antes.
- **Confianza:** confirmado en el código

#### DIS-21 · El resumen de rechazos de la importación calla los que no son índices
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/PortfolioImportPanel.tsx:137-145`
- **Qué pasa:** si entre los rechazos hay un índice, la frase dice solo «1 índice rechazado…» aunque haya, además, cinco líneas rechazadas por formato. El detalle de abajo sí las lista.
- **Arreglo propuesto:** decir las dos cifras.
- **Confianza:** confirmado en el código

#### DIS-22 · Validación nombra por ISIN lo que queda fuera, y «1 activos invertibles»
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/PortfolioValidationPanel.tsx:281`, `:286`, `:292`
- **Qué pasa:** «Fuera del cálculo por ser índices…: LU1234…, IE00…» va por identificador, cuando el resto de la pantalla nombra por nombre; y el recuento no hace plural.
- **Arreglo propuesto:** nombres de `assets` con el ISIN como apunte; plural.
- **Confianza:** confirmado en el código

#### DIS-23 · Aplicar una optimización redondea cada peso por su cuenta y la suma puede no cuadrar
- **Gravedad:** baja
- **Categoría:** cálculo
- **Dónde:** `src/components/PortfolioBuilder.tsx:332-342`; comparar con `src/core/portfolioConstraints.ts:628-650` (`redondearQueSume`)
- **Qué pasa:** normalizar reparte el residuo del redondeo; aplicar una propuesta no: `round2` en cada posición. Con muchas posiciones con peso, la suma puede quedar en 99,98 % o 100,03 %; casi siempre dentro de la tolerancia de 0,05, pero no hay garantía, y si sale fuera la cartera aparece «Faltan 0,1 %» justo después de aplicar.
- **Arreglo propuesto:** usar el mismo reparto de residuo al aplicar. Prueba con 40 pesos de tres decimales.
- **Confianza:** sospecha (depende de los pesos que devuelva el servidor)

#### DIS-24 · «Nueva carga» en Posiciones borra el extracto pegado sin preguntar ni deshacer
- **Gravedad:** baja
- **Categoría:** funcional
- **Dónde:** `src/components/PositionsWorkbench.tsx:621-626`, `:1086`
- **Qué pasa:** el botón discreto al final de los filtros vacía cuadro, tabla, detalle y confirmación de una vez.
- **Arreglo propuesto:** confirmación o «Deshacer» unos segundos, como al quitar una posición en Diseño.
- **Confianza:** confirmado en el código

#### DIS-25 · La tabla de posiciones exige 560 px y su envoltorio no desplaza
- **Gravedad:** baja
- **Categoría:** adaptación
- **Dónde:** `src/styles/modules.css:1106-1114`, `:6244-6249`
- **Qué pasa:** `.portfolio-table { min-width: 560px }` dentro de `.portfolio-table-wrapper`, que no tiene `overflow-x`. Por encima de 1024 px la tabla va en 8 de 12 columnas junto a la lateral; con el menú desplegado, entre 1025 y ~1180 px la columna puede quedar por debajo de 560 px y la tabla se saldría.
- **Arreglo propuesto:** `overflow-x: auto` en el envoltorio, o bajar la lateral a partir de 1180 px.
- **Confianza:** sospecha (comprobar en navegador a 1024-1180 px con el menú abierto)

#### DIS-26 · Sustituir con «Mantener €» convierte la posición en «Importe fijo» sin decirlo, y «Cambiar» no se deshace
- **Gravedad:** baja
- **Categoría:** funcional
- **Dónde:** `src/components/FundSwapModal.tsx:45-48`, `:182-187`; `src/pages/PortfolioBuilderPage.tsx:298-320`
- **Qué pasa:** «Mantener %» y «Mantener €» dejan hoy el mismo peso; la diferencia es que la segunda fija el importe para el futuro (distintivo «Importe fijo», que no se reescala). El diálogo no lo explica. Y si la sustitución no cambia características, se aplica y el diálogo se cierra sin confirmación ni «Deshacer».
- **Arreglo propuesto:** una línea bajo el selector («Mantener €: la nueva posición conserva su importe si cambia el capital») y «Deshacer» en la nota.
- **Confianza:** confirmado en el código

#### DIS-27 · Fechas de guardado con mes abreviado
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/core/textosDeCartera.ts:23-44`; `src/pages/CarterasGuardadasPage.tsx:253`
- **Qué pasa:** «Guardada el 3 nov 2026, 12:30» y la columna «Guardada: 3 nov 2026», frente al estándar del protocolo (`13/11/2026`) y a las fechas cortas de otras tablas. Está bien resuelto el desfase de zona horaria.
- **Arreglo propuesto:** decidir un formato de fecha de pantalla y usarlo aquí.
- **Confianza:** confirmado en el código

#### DIS-28 · Código: comentario huérfano y un filtro que no filtra
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/core/textosDeCartera.ts:35`; `src/components/FundSwapModal.tsx:61`
- **Qué pasa:** el comentario «La pregunta antes de sustituir…» quedó pegado encima de `diaDeGuardada`, que no es eso. `investable = positions.filter((p) => (p.weight_percent ?? 0) >= 0)` deja pasar todas las posiciones: el nombre promete otra cosa.
- **Arreglo propuesto:** mover el comentario a `tituloDeCambiosSinGuardar`; renombrar o quitar el filtro.
- **Confianza:** confirmado en el código

#### DIS · Lo que está bien
- El ciclo de la cartera activa (`useCicloDeCartera` + `carteraActiva.ts`): huella de contenido, «Cambios sin guardar» junto al nombre, aviso al sustituir con tres salidas y nombre pedido si falta, `beforeunload` solo cuando hay algo que perder.
- `EuroAmountInput`: lector europeo, confirmación en blur/Intro, cifra no válida marcada sin descartarla, sin re-render por tecla.
- Capital «sin fijar» frente a 100.000 € de ejemplo, que no viajan al informe ni a los importes a mover.
- La importación no carga nada sin confirmación del asesor, y dice qué ha leído, de qué columna y qué ha dejado fuera.
- Candados, «Deshacer» al quitar, y «Volver a los pesos anteriores» que nombra lo que se perdería.
- Las propuestas caducan cuando la cartera cambia (optimizador y fondos equivalentes), y una propuesta parcial no se puede aplicar.
- Sin `toFixed` ni `toLocaleString` sin locale en todo el alcance; el formateo pasa por `core/format`.
- Carteras guardadas distingue cargando, vacío, error de lista y error del catálogo, y sigue sirviendo si el catálogo falla.

#### DIS · Lo que no se ha podido mirar
- Nada en navegador: adaptación real a 768/1024/1280, foco atrapado en los diálogos apilados (aviso de cambios sin guardar sobre el diálogo «Importar cartera»), contraste de `.estado-de-guardado.is-sin-guardar` y del importe «de ejemplo» en `--ink-tertiary`.
- El comportamiento del servidor al sobrescribir un `portfolio_id` borrado (DIS-03) y los textos de error reales de `fetchHistoricalFrontier`, `generate_portfolio_draft` y `improve_portfolio`.
- `MacroAllocationPanel`, `BacktestComparison`, `PortfolioAnalysisPanel`, `SuperSectorsDonut`, `CostsModal` y `RegionAllocation` se montan en Diseño pero no estaban en mi lista; solo los he leído de pasada.
- `PortfolioDataDiagnostic`, `AssetPicker`, `BenchmarkSelect` y `DialogoDePropuesta` no se usan en estas tres pantallas (Análisis, Comparador e Informe); los he dejado para esos revisores.
- No he ejecutado pruebas.

### ANA · Análisis, Informes en pantalla y gráficos

#### ANA-01 · El informe de cliente descargado desde Análisis explica el solapamiento distinto que el de Informes
- **Gravedad:** alta
- **Categoría:** informes
- **Dónde:** `src/pages/XrayPage.tsx:202-217`; `src/components/PortfolioReport.tsx:163-166` y `:281-282`; `src/reports/informeDeClientePdf.tsx:1786`
- **Qué pasa:** el mismo PDF de cliente tiene dos puertas. Informes le pasa las posiciones con la réplica de cada ficha
  (`conLaReplica`), y Análisis le pasa el informe tal cual, sin ella. El PDF calcula el solapamiento con
  `loadReportOverlap(input.report.positions, …)`, que necesita la réplica para decir que un ETF sintético «replica su índice con una
  permuta». Sin ella lo trata como un fondo que no publica su cartera. El cliente recibe dos textos distintos para la misma cartera,
  según la pantalla desde la que el asesor pulsó. Además, la matriz de la propia pantalla de Análisis sí lee la réplica
  (`XrayAdvanced.tsx:138`), así que la pantalla y el PDF que sale de ella tampoco coinciden.
- **Cómo reproducirlo:** cartera con un ETF sintético (`product_profile.replication` = SYNTHETIC) y dos fondos. Descargar el informe
  de cliente desde Análisis y desde Informes, y comparar la hoja de solapamiento.
- **Evidencia:**
  ```tsx
  // PortfolioReport.tsx:164
  () => ({ ...report, ...(nombreEscrito ? { portfolio_name: nombreEscrito } : {}), positions: conLaReplica(report.positions, assets) })
  // XrayPage.tsx:203-204
  await descargar({
    report,            // sin conLaReplica
  ```
- **Arreglo propuesto:** sacar a `core/reportPipeline` una sola función `entradaDelInformeDeCliente(...)` que usen las dos puertas
  (réplica, `clientMode`, `lockedWeights`, regiones, dividendos). Prueba: montar `XrayPage` y `PortfolioReport` con un ETF sintético,
  interceptar `downloadInformeDeClientePdf` y comprobar que las dos entradas llevan las mismas posiciones con `replica`.
- **Confianza:** confirmado en el código (no hay otra asignación de `replica` en `src/` que la de `conLaReplica`).

#### ANA-02 · El tooltip del cono de proyección enseña el ancho de las bandas como si fuera un nivel
- **Gravedad:** alta
- **Categoría:** cálculo
- **Dónde:** `src/charts/oaa/OaaMonteCarloChart.tsx:99-104` (las `Area` `p5`, `p95Gap`, `p25`, `p75Gap`), tooltip en `:98`
- **Qué pasa:** el cono se dibuja apilando una base transparente (`p5`, `p25`) y el hueco (`p95Gap = p95 − p5`, `p75Gap = p75 − p25`).
  El tooltip lista todas las series con el mismo formato de base 100: sale «p5 92,1», «p5-p95 34,6», «p25 …», «p25-p75 …». El asesor
  lee «p5-p95 34,6» como un nivel o como el extremo superior, y es una anchura. Las dos bases transparentes salen con su nombre
  técnico. El rótulo del tooltip dice siempre «Proyección», también en los puntos del histórico. Es la pantalla de Diseño
  («Simulación histórica y proyección»), pero el gráfico vive en `src/charts/oaa`.
- **Cómo reproducirlo:** Diseño de cartera, simulación con pesos, pasar el ratón por la parte proyectada del cono.
- **Evidencia:**
  ```tsx
  <Area dataKey="p95Gap" stackId="outer" name="p5-p95" … />
  <Tooltip content={<OaaTooltip labelFormatter={() => "Proyección"} valueFormatter={(value) => yFormatter(value)} />} />
  ```
- **Arreglo propuesto:** tooltip propio que escriba «Percentil 5–95: 92,1 a 126,7» y «Mediana: 108,3» con los valores del punto
  (`p5`, `p95 = p5 + p95Gap`, …), sin las series auxiliares, y «Histórico» o «Proyección» según el punto. Prueba: renderizar el
  contenido del tooltip con un punto proyectado y comprobar que no aparece ningún valor igual a `p95 − p5`.
- **Confianza:** confirmado en el código.

#### ANA-03 · La cartera y la referencia cambian de color de un gráfico a otro
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/XrayAdvanced.tsx:299` y `:307` (índigo `--series-1` y tostado `--series-2`); `src/charts/oaa/OaaRiskReturnChart.tsx:72` y `:76` (cartera en `--accent`, referencias en gris `--series-8`, línea en `--ochre-50`); `src/components/PortfolioHorizonPanel.tsx:102` («Cartera actual» en `OAA_COLORS.gold`) y `:166` (caída en `--negative`); `src/components/BacktestComparison.tsx:55-56` (`--accent` y `--ochre-50`); `src/core/regionTaxonomy.ts:191-195` (América y EMEA con los mismos hex que cartera y benchmark)
- **Qué pasa:** `theme.ts` declara que «el orden es contrato: 1 = cartera, 2 = benchmark». En Analítica avanzada la cartera es índigo
  en la evolución y en la caída, azul Prusia (`--accent`) en el mapa riesgo/rentabilidad y ocre en el punto «Cartera actual» de la
  frontera, que está en la misma pestaña. La referencia elegida es tostada en la evolución y un rombo gris en el mapa. En Diseño, la
  misma curva de caída de la cartera va en terracota (`--negative`). El mapa geográfico pinta América con el color de la cartera y EMEA
  con el del benchmark. El asesor no puede fiarse del color para seguir una serie.
- **Cómo reproducirlo:** Análisis → Analítica avanzada; comparar el color de la cartera en los cuatro gráficos.
- **Evidencia:** `color: portfolio.color ?? "var(--accent)"` (RR) frente a `color: COLORS[0]` (evolución) y `color: OAA_COLORS.gold` (frontera).
- **Arreglo propuesto:** dos constantes de rol en `theme.ts` (`COLOR_CARTERA = CHART_PALETTE[0]`, `COLOR_REFERENCIA = CHART_PALETTE[1]`),
  usadas como valor por defecto en `OaaRiskReturnChart`, `OaaFrontierChart` (marca actual), `UnderwaterChart` y `BacktestComparison`. Las
  zonas del mapa, en tonos fuera de esos dos. Prueba: una prueba de humo que monte los cuatro gráficos y compare el `fill`/`stroke` de la
  serie «cartera».
- **Confianza:** confirmado en el código.

#### ANA-04 · El mapa riesgo/rentabilidad no dice qué rombo es cada cartera de referencia ni qué miden los ejes
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/charts/oaa/OaaRiskReturnChart.tsx:80-85`, `:100-120`, `:147-160`, `:122-136`
- **Qué pasa:** las carteras de referencia salen como rombos grises iguales, sin rótulo junto al punto, y la leyenda las agrupa en «Carteras
  de referencia». La que el asesor ha elegido en el selector no se distingue de las demás. Solo el tooltip dice cuál es cuál, y solo con
  ratón. Los ejes no tienen título, aunque la frontera de al lado sí los tiene («Riesgo (volatilidad anual)»). Sospecha: el tooltip lista
  también la entrada del `ZAxis` («z 92») y repite volatilidad y rentabilidad dos veces (filas del payload más `payloadFormatter`).
- **Cómo reproducirlo:** Analítica avanzada → «Mapa riesgo / rentabilidad frente a carteras de referencia».
- **Evidencia:** `const benchData = benchmarks.filter(isValidPoint).map((point) => ({ ...point, color: point.color ?? "var(--series-8)", z: 46 }));` y `<XAxis type="number" dataKey="vol" name="Volatilidad" …/>` sin `label`.
- **Arreglo propuesto:** rótulo corto junto a cada rombo (como `LabelledDot` de la frontera), la referencia elegida resaltada con el color
  de referencia, títulos de eje iguales a los de `OaaFrontierChart`, y una tabla alternativa (nombre, volatilidad, rentabilidad) bajo el
  gráfico o en `<details>`. Tooltip propio sin la fila `z`.
- **Confianza:** confirmado en el código (rótulos y ejes); sospecha (fila `z` y duplicado del tooltip: mirarlo en el navegador).

#### ANA-05 · Analítica avanzada convierte «faltan datos» y «tope del cálculo» en un fallo genérico, hasta tres veces
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/core/usePortfolioHorizon.ts:19` (`error instanceof Error ? error.message : …`); `src/components/XrayAdvanced.tsx:266-267` y `:422-423`; `src/components/PortfolioHorizonPanel.tsx:148-150`
- **Qué pasa:** el gancho guarda solo el texto del error, así que se pierde el `AppError` con su código. Visión general distingue «faltan
  datos» (sin banner, «Falta el dato» y el motivo), «tope» (sin reintentar) y fallo real (`XrayPage.tsx:148-151`). Analítica avanzada usa
  el gancho y enseña siempre un banner de fallo con «Reintentar», y lo repite en el panel de evolución, en el de correlación y en
  «Riesgo y rentabilidad» (tres `role="alert"` con el mismo mensaje). Para la misma cartera, una pestaña dice que no hay datos y la otra
  que algo ha fallado y que se reintente, aunque reintentar no lo arregla.
- **Cómo reproducirlo:** cartera cuyas posiciones no tengan serie (el servidor responde «falta de datos»); abrir las dos pestañas.
- **Evidencia:** `if (active) setState({ fingerprint, error: error instanceof Error ? error.message : "No se pudo calcular el análisis." });`
- **Arreglo propuesto:** que `usePortfolioHorizon` guarde el error original (`unknown`) y que los tres paneles usen
  `esFaltaDeDatos`/`limiteDelCalculo` como Visión general; un único aviso arriba de la pestaña, y en cada panel solo «Sin simulación».
  Prueba: con un `fetchPortfolioHorizon` que rechace con un AppError de falta de datos, Analítica avanzada no tiene botón «Reintentar» y
  hay como mucho un `role="alert"`.
- **Confianza:** confirmado en el código.

#### ANA-06 · Con todos los pesos a cero, Analítica avanzada se queda en «Calculando series…» para siempre
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/core/usePortfolioHorizon.ts:12`; `src/components/XrayAdvanced.tsx:234-236`, `:268-269`, `:424-425`
- **Qué pasa:** el gancho no pide nada si ninguna posición pesa, y no marca ningún estado: `data` y `error` quedan indefinidos. El
  componente solo comprueba que haya dos activos, y lee «sin datos» como «calculando». La evolución y la correlación dicen «Calculando…»
  indefinidamente, mientras Visión general dice correctamente «Ninguna posición tiene peso».
- **Cómo reproducirlo:** cartera con dos posiciones a 0 % → Análisis → Analítica avanzada.
- **Evidencia:** `if (!positions.some((p) => p.weight_percent > 0)) return;` y `) : !settled ? (<p className="asset-detail-muted">Calculando series…</p>`
- **Arreglo propuesto:** en `XrayAdvanced`, antes del render, si no hay peso, el mismo mensaje que la tira de Visión general. Prueba:
  render con dos posiciones a 0 y comprobar que no aparece «Calculando».
- **Confianza:** confirmado en el código.

#### ANA-07 · Con una sola posición, Analítica avanzada desaparece entera
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/components/XrayAdvanced.tsx:234-236`
- **Qué pasa:** con menos de dos activos se sustituye toda la pestaña por «Añade al menos 2 activos…». La evolución frente a la referencia,
  la caída máxima y el mapa riesgo/rentabilidad tienen sentido con un solo fondo. Solo las dos matrices necesitan dos. El asesor que
  analiza la cartera de un cliente con un único fondo se queda sin la comparación con su referencia.
- **Cómo reproducirlo:** cartera con una posición → Analítica avanzada.
- **Evidencia:** `if (assetIds.length < 2) { return <p className="oaa-chart-empty">Añade al menos 2 activos a la cartera para la analítica avanzada.</p>; }`
- **Arreglo propuesto:** mover la condición a los dos paneles de matriz; el resto se pinta. Prueba: con una posición, sale «Evolución
  histórica de la cartera» y la matriz dice que necesita dos.
- **Confianza:** confirmado en el código.

#### ANA-08 · Si falla la carga, Análisis e Informes enseñan el error y a la vez «Calculando…» para siempre
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/pages/XrayPage.tsx:369` y `:396`, `:482-484`; `src/pages/PortfolioReportPage.tsx:95-101`
- **Qué pasa:** cuando `buildManualPortfolioReport` falla, sale el banner de error y debajo «Calculando el análisis…» (Análisis) o
  «Preparando los documentos de la cartera…» (Informes), que ya no van a terminar. En Informes desaparece además la cabecera de la página
  durante la carga y con el error, así que la pantalla salta y no dice dónde se está.
- **Cómo reproducirlo:** cortar la red y abrir Análisis o Informes.
- **Evidencia:** `{load.error ? <AsyncErrorBanner … /> : null}` y luego `report ? (…) : (<LoadingState>Calculando el análisis…</LoadingState>)`.
- **Arreglo propuesto:** `report ? … : load.error ? null : <LoadingState/>`, y `PageHeader` también en los estados de carga y error de
  Informes. Prueba: con `buildManualPortfolioReport` rechazado, no aparece el texto de carga.
- **Confianza:** confirmado en el código.

#### ANA-09 · «Diferencial» con la referencia, sin unidad, al lado de porcentajes
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/XrayAdvanced.tsx:340-351`; `src/core/medidaDeLaCartera.ts:429-431`
- **Qué pasa:** el cierre del gráfico dice «Cartera 112,4 (+12,4 %)», «Referencia 108,1 (+8,1 %)» y «Diferencial +4,3». El +4,3 son
  puntos de base 100, que equivalen a puntos porcentuales de rentabilidad acumulada, pero no lleva unidad, y al lado de dos porcentajes
  se lee como «4,3 %», que podría confundirse con una diferencia relativa o anualizada. `MetricasComparativas` ya escribe «pp» para esto.
- **Cómo reproducirlo:** Analítica avanzada con referencia disponible.
- **Evidencia:** `{diferencial >= 0 ? "+" : ""}{fmtNum(diferencial, 1)}`
- **Arreglo propuesto:** «Diferencia acumulada +4,3 pp» (o «+4,3 puntos»). Prueba de texto.
- **Confianza:** confirmado en el código.

#### ANA-10 · La misma cifra con distintos decimales según el bloque
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/MetricasComparativas.tsx:12` (`fmtPct(valor)`, 2 decimales) frente a `src/core/medidaDeLaCartera.ts:450-459` y `PortfolioHorizonPanel.tsx:47-52` (1 decimal); `src/charts/UnderwaterChart.tsx:47` (tooltip, 2) frente a `XrayAdvanced.tsx:361` (cabecera, 1); `src/components/XrayAdvanced.tsx:252` (`fmtPct(coveredWeightPercent / 100)`, 2); `src/components/PortfolioComparator.tsx:232-234` (2)
- **Qué pasa:** la rentabilidad, la volatilidad y la caída máxima salen con un decimal en las tiras («−12,3 %») y con dos en la tabla de
  la comparativa que está al lado («−12,35 %»). La caída máxima de la cabecera del gráfico de caída dice «−12,3 %» y su tooltip
  «−12,35 %». El peso cubierto por las matrices sale con dos decimales donde el resto de pesos lleva uno.
- **Cómo reproducirlo:** Diseño → «Comparativa» (tabla) junto a «Métricas · 3 años»; Análisis → tooltip del gráfico de caída.
- **Evidencia:** `const escribir = (isPct: boolean) => (valor: number) => (isPct ? fmtPct(valor) : fmtNum(valor));`
- **Arreglo propuesto:** constantes de precisión por tipo de cifra en `core/format` (p. ej. `DECIMALES.rentabilidad = 1`) y usarlas en
  tablas, tooltips y tiras. Prueba: un test que compare el texto de la caída máxima en la cabecera y en el tooltip.
- **Confianza:** confirmado en el código.

#### ANA-11 · Lo que falta se escribe «N/D» en unos bloques y «Falta el dato» en otros
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/HistoricalStressCards.tsx:20`, `:25`, `:66`, `:87`, `:137`, `:165`; `src/components/RiskContributionChart.tsx:66`; `src/components/CostsModal.tsx:175`, `:252-253`, `:293-295`; `src/charts/oaa/OaaCorrelationHeatmap.tsx:86`; `src/charts/UnderwaterChart.tsx:47`; `src/charts/oaa/chartFormatters.ts:4-13`; `src/core/format.ts:1`
- **Qué pasa:** la regla del producto es decir «Falta el dato» o «No aplica» con la pieza `Ausencia`. La tira de Análisis, la tabla de
  composición y los repartos lo hacen. Las tarjetas de crisis, la contribución al riesgo, las celdas de la matriz de correlación, los
  tooltips de los gráficos y el cuadro de costes escriben «N/D» a pelo, que además no dice si falta o si no aplica.
- **Cómo reproducirlo:** cualquier escenario de estrés sin recuperación conocida; una celda de correlación sin dato.
- **Evidencia:** `return typeof value === "number" ? fmtPct(value / 100, 1) : "N/D";`
- **Arreglo propuesto:** que `fmtPct`/`fmtNum` devuelvan `textoDeAusencia("falta")` (o que cada sitio use `CifraOAusencia`), y retirar `ND`
  de la interfaz (dejarlo solo para el papel, si hace falta). Prueba: buscar «N/D» en el render de esos componentes con datos ausentes.
- **Confianza:** confirmado en el código.

#### ANA-12 · Las dos puertas del informe de cliente se comportan distinto
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/pages/XrayPage.tsx:302`, `:307`, `:337-346`, `:363-364`; `src/components/PortfolioReport.tsx:436-446`, `:483-485`, `:559-565`, `:364-375`, `:380`
- **Qué pasa:**
  - En Análisis el diálogo se cierra con Escape o con la X mientras se genera el PDF; en Informes no se puede. Si se cierra y luego falla,
    el error queda guardado y aparece al volver a abrir el diálogo (solo se limpia al cambiar de periodo).
  - Informes pide un nombre para la cartera si no lo tiene; Análisis no.
  - «Responsable comercial» en Informes, «Elaborado por» en Análisis, para el mismo dato.
  - En Informes, el campo del responsable vacío enseña como *placeholder* el nombre y el correo por defecto (`DEFAULT_BANKER`), en gris:
    parece rellenado, pero la portada saldrá sin nombre. En Análisis el *placeholder* dice «Déjalo vacío para una portada sin nombre».
  - El botón de la lista de Informes dice «Descargar informe de cliente» y abre un diálogo con otro botón «Descargar informe de cliente».
    En Análisis el primero dice «Informe de cliente». Lo mismo con «Descargar informe de costes», que abre «Análisis de costes».
  - «Preparando...» con tres puntos en Análisis y «Preparando…» en los demás diálogos.
  - El error de «Propuesta de mejora» sale arriba de la página; los demás, dentro de su diálogo.
- **Cómo reproducirlo:** abrir los dos diálogos y compararlos; pulsar Escape durante la generación en Análisis.
- **Evidencia:** `<ModalDialog labelledBy="xray-report-title" onClose={cerrarElDialogo} size="sm">` frente a `onClose={() => { if (!pdfBusy) cerrarElDialogoDeCliente(); }}`; `placeholder={DEFAULT_BANKER.name}`.
- **Arreglo propuesto:** un solo componente `DialogoDelInformeDeCliente` para las dos puertas (con ANA-01), botones de la lista con verbo
  de abrir («Informe de cliente…») y *placeholder* que no simule un valor. Prueba: Escape no cierra durante `pdfBusy` en las dos páginas.
- **Confianza:** confirmado en el código.

#### ANA-13 · El importe por posición de Análisis no coincide con el capital por posición de Costes si los pesos no suman 100
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:** `src/adapters/tablaDeComposicion.tsx:123`; `src/components/ComposicionDeLaCartera.tsx:54-57`; `src/core/portfolioCosts.ts:63-64`
- **Qué pasa:** la tabla «Composición de la cartera» calcula `importe = peso bruto / 100 × capital`, sin normalizar; el pie suma, por
  ejemplo, 98,0 % y 98.000 € de un capital de 100.000 €. El cuadro de costes normaliza (`fraction = peso / suma`) y reparte el capital
  entero. Con pesos que suman 98 %, la misma posición vale 24.500 € en Análisis y 25.000 € en Costes. El cuadro de costes avisa de que
  normaliza, pero Análisis no dice nada y la diferencia se ve.
- **Cómo reproducirlo:** cartera de cuatro posiciones al 24,5 % y capital de 100.000 €; comparar Análisis y Costes.
- **Evidencia:** `const importeDe = (peso: number) => (capitalFijado(capital) ? (peso / 100) * capital : null);` frente a `const fraction = p.weight_percent / inputWeight;`
- **Arreglo propuesto:** decidir una convención (recomiendo la de Costes, normalizar y decirlo) y aplicarla en las dos; o, si no, que
  Análisis diga «el 2 % sin asignar no tiene importe». Prueba con pesos que suman 98.
- **Confianza:** confirmado en el código.

#### ANA-14 · «Volatilidad sola 3A» sigue a 3 años cuando el análisis está a 5
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/adapters/tablaDeComposicion.tsx:141` (`volatility_3y`) y `:256`
- **Qué pasa:** en la tabla de composición, «Aporta al riesgo» sale de la simulación del periodo elegido (3 o 5 años) y la columna de al
  lado, «Volatilidad sola 3A», es siempre la de 3 años de la ficha. Con 5 años elegidos, la tabla mezcla dos ventanas en dos columnas que se
  leen juntas, contra la regla del método de no comparar cifras de distinta ventana. Está rotulada, pero «3A» no es el formato del resto
  de la pantalla («3 años»).
- **Cómo reproducirlo:** Análisis con «5 años» → Composición.
- **Evidencia:** `volatilidad: asset?.metrics?.volatility_3y,` y `titulo: "Volatilidad sola 3A"`.
- **Arreglo propuesto:** tomar `volatility_5y` cuando el periodo es 5 años, o, si la ficha no la tiene, decirlo en la celda. Decisión de Óscar.
- **Confianza:** confirmado en el código.

#### ANA-15 · Las crisis pasadas van en el PDF de Análisis, pero no se ven en Análisis
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:** `src/components/FrontierPanel.tsx:252-257`; `src/components/PortfolioHorizonPanel.tsx:158` (variante `frontier`, sin estrés) frente a `:172-174`; `src/pages/XrayPage.tsx:312`
- **Qué pasa:** el diálogo del informe de cliente en Análisis anuncia «crisis pasadas y solapamiento entre fondos», y el PDF las lleva.
  Pero la pantalla de Análisis usa la variante `frontier` de `PortfolioHorizonPanel`, que no pinta `HistoricalStressCards`. Las crisis
  solo se ven en Diseño. El asesor descarga un documento con una sección que no ha podido revisar antes en la pantalla de análisis.
- **Cómo reproducirlo:** Análisis, buscar las crisis; descargar el informe de cliente.
- **Evidencia:** `{variant === "frontier" ? <div className="backtest-summary-layout"><HorizonFrontier …/><HorizonMetrics …/></div> : <> … <HistoricalStressCards …/>`
- **Arreglo propuesto:** añadir las tarjetas de estrés a Analítica avanzada (decisión de producto: el brief de la auditoría las cuenta como
  parte de Análisis).
- **Confianza:** confirmado en el código.

#### ANA-16 · Vocabulario: el mismo concepto con varios nombres
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** varios (abajo)
- **Qué pasa:**
  - «Rentabilidad y riesgo» (Visión general, `XrayPage.tsx:404`) y «Riesgo y rentabilidad» (Analítica avanzada, `PortfolioHorizonPanel.tsx:146`), con las mismas cuatro cifras.
  - «Cartera de referencia» (selector), «carteras de referencia» (las sintéticas del mapa), «Benchmarks» (nombre de la serie, `OaaRiskReturnChart.tsx:149`), «benchmark» en comentarios y en `KpiStrip` de otros sitios.
  - «Asignación geográfica» (`RegionAllocation.tsx:60`), «Exposición por región de la renta variable» y «Desglose por regiones» (`GeoDistributionMap.tsx:110`, `:204`), «Por región» (Carteras guardadas), «Renta variable por región» (Diseño), «Distribución geográfica» (PDF y `aria-label`).
  - «Caída máxima» en pantalla y «drawdown»/«underwater» en el código; «Caída máxima (desde máximos)» como título del bloque y «Caída máxima» dentro.
  - «Coste medio ponderado» (`CostsModal.tsx:236`) y «Coste corriente ponderado» (`CambiosDePeso`, `PortfolioImprovementPanel`).
  - «Peso vs riesgo por posición» (`RiskContributionChart.tsx:60`), «High yield» (`XrayMetricsStyle.tsx:148`), «+1A» en el eje del cono, «Volatilidad sola 3A».
  - «Periodo común de análisis y proyección» como nombre del selector de periodo también en Análisis, donde no hay proyección (`PortfolioHorizonPanel.tsx:29`).
  - El selector de pestañas de Análisis y el del cuadro de costes se llaman los dos «Secciones del análisis» (`XrayPage.tsx:291`, `CostsModal.tsx:220`).
- **Arreglo propuesto:** glosario de pantalla único (ya existe `glosarioDePantalla`) con: «Rentabilidad y riesgo», «Cartera de referencia»,
  «Distribución geográfica», «Caída máxima», «Coste corriente medio», «Alto rendimiento», «3 años».
- **Confianza:** confirmado en el código.

#### ANA-17 · El mapa geográfico tiene ocho paradas de teclado sin nombre dentro de una imagen
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/charts/GeoDistributionMap.tsx:111-137`, `:172-185`, `:63-70`
- **Qué pasa:** el `<svg role="img">` contiene ocho `<path tabIndex={0}>`. Dentro de un `role="img"` los hijos no se exponen, así que el
  `<title>` de cada zona no llega al lector de pantalla: el tabulador se para ocho veces en algo sin nombre y sin foco visible conocido.
  Los chips y las filas del desglose solo reaccionan al ratón (`onMouseEnter`).
- **Cómo reproducirlo:** Análisis → Asignación geográfica, recorrer con Tab.
- **Evidencia:** `<svg className="geo-map-svg" viewBox={GEO_VIEWBOX} role="img" aria-label="…">` con `<path key={a.id} tabIndex={0} …><title>…</title></path>`.
- **Arreglo propuesto:** quitar `tabIndex` de las zonas (la tabla de al lado ya da las cifras) o convertirlas en `role="button"` con
  `aria-label`, fuera de un `role="img"`. Prueba: ningún elemento focusable dentro de un `role="img"`.
- **Confianza:** confirmado en el código.

#### ANA-18 · Las dos matrices no se pueden leer sin ver ni sin ratón
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/charts/oaa/OaaCorrelationHeatmap.tsx:62-98`; `src/charts/oaa/OaaOverlapHeatmap.tsx:188-216`, `:105-135`
- **Qué pasa:** la matriz de correlación es una rejilla con `role="img"`: las cifras de cada celda quedan ocultas al lector de pantalla y
  el cruce se dice solo con `title`. La de solapamiento es un `ScatterChart` de Recharts: las cifras están dentro del SVG y «las mayores
  posiciones comunes» solo salen en el tooltip, al pasar el ratón. Ninguna de las dos tiene tabla alternativa. El cruce fila × columna se
  hace por número («1», «2») y una lista aparte.
- **Arreglo propuesto:** pintar las dos como `<table>` con `<th scope>` (el aspecto puede ser el mismo), con el nombre del activo en la
  cabecera accesible y la cifra como texto; las posiciones comunes, en un `<details>` por par.
- **Confianza:** confirmado en el código.

#### ANA-19 · Los nombres de los PDF no siguen una regla
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:** `src/reports/costsPdf.tsx:264`; `src/reports/comparePdf.tsx:568`; `src/reports/internalPortfolioReportPdf.tsx:2268`; `src/reports/improvementProposalPdf.tsx:243`; `src/reports/informeDeClientePdf.tsx:1792-1798`
- **Qué pasa:** el informe de costes se llama siempre `informe-de-costes.pdf`, para cualquier cliente y cartera, así que en la carpeta de
  descargas se acumulan `informe-de-costes (3).pdf`. El de cliente usa el nombre del cliente (y conserva tildes, `\p{L}`); la comparativa,
  el interno y la propuesta usan `\w` y convierten «España» en «espa-a». Ninguno lleva fecha. Además, el informe de cliente revoca la URL
  del blob justo después del `click()`, y el de costes espera 60 s: sospecha de que en algunos navegadores (Safari) la descarga inmediata
  falle.
- **Arreglo propuesto:** una función `nombreDelFichero(tipo, cartera|cliente, fecha)` en `src/reports/`, con `\p{L}\p{N}`, y la revocación
  diferida en todos. Prueba unitaria de la función.
- **Confianza:** confirmado en el código (nombres); sospecha (revocación inmediata: probar en Safari).

#### ANA-20 · La vista Informes sigue pidiendo los datos del Constructor
- **Gravedad:** media
- **Categoría:** rendimiento
- **Dónde:** `src/pages/PortfolioBuilderPage.tsx:190-216` y `:501-515`
- **Qué pasa:** `PortfolioBuilderPage` lanza su `load` (`getComparableAssets`, `buildManualPortfolioSummary`,
  `buildManualPortfolioOptimizationPreview` y la vista previa local de optimización) también cuando `view === "report"`, y luego
  `PortfolioReportPage` vuelve a pedir `getComparableAssets` y el informe. Cada cambio de cartera en Informes repite trabajo que no se usa.
  Sospecha relacionada: cambiar de pestaña en Análisis desmonta Analítica avanzada y vuelve a cargar los subyacentes al volver.
- **Arreglo propuesto:** `enabled: view === "builder"` en ese `useAsyncData`. Prueba: con `view="report"`, el mock de
  `buildManualPortfolioOptimizationPreview` no se llama.
- **Confianza:** confirmado en el código (Informes); sospecha (recarga de subyacentes: mirar la red al cambiar de pestaña).

#### ANA-21 · `OaaLineChart`: la memorización no sirve y la tabla se construye con una búsqueda por fecha
- **Gravedad:** baja
- **Categoría:** rendimiento
- **Dónde:** `src/charts/oaa/OaaLineChart.tsx:108-126`; llamadas con `series={[…]}` en línea en `XrayAdvanced.tsx:295-315`, `PortfolioHorizonPanel.tsx:161`, `BacktestComparison.tsx:55`
- **Qué pasa:** `cleanSeries` se crea con `filter` en cada render y es la dependencia del `useMemo`, así que el memo se recalcula siempre.
  El `memo` del componente tampoco sirve porque las series llegan como array nuevo. Dentro, por cada fecha se hace `serie.values.find(...)`:
  con 5 años diarios (unos 1.300 puntos) y dos series son ~3,4 millones de comparaciones por render.
- **Arreglo propuesto:** indexar cada serie en un `Map` fecha→valor y memorizar con las series de entrada; `useMemo` en los padres.
- **Confianza:** confirmado en el código (el coste real, sin medir).

#### ANA-22 · El gráfico de caída no tiene leyenda y su eje no se alinea con el de evolución
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/charts/UnderwaterChart.tsx:117-147`
- **Qué pasa:** con dos series (cartera y referencia) no pinta leyenda: hay que deducirlas del gráfico de arriba. Su eje X marca años
  («2023», también para un primer punto de noviembre), y el de evolución, justo encima, meses («nov 23»).
- **Arreglo propuesto:** `OaaLegend` cuando haya más de una serie y los mismos ticks mensuales que `OaaLineChart`.
- **Confianza:** confirmado en el código.

#### ANA-23 · Paleta: comentarios que ya no describen los colores y un filtro que quita el color equivocado
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/core/theme.ts:96-103` y `:114`; `src/components/FrontierPanel.tsx:138`; `src/styles/charts.css:539-541`
- **Qué pasa:** `CATEGORICAL_SERIES` dice «Prusia, acero, teal, gris, ciruela, terracota» y son índigo, rosa, ocre, carmesí, verde y
  cian. `CATEGORICAL_SERIES_BESIDE_UNCLASSIFIED` quita `CHART_PALETTE[4]` creyendo que es el gris, y es el carmesí: el motivo (contraste con
  «No declarado») ya no existe. El ocre de la serie 4 (`#8B5B00`) queda muy cerca del tostado del benchmark (`#894B21`). `FrontierPanel`
  llama «pino» a la serie 3, que es rosa. En `charts.css`, la sección «7. Sparkline» contiene el donut de una porción.
- **Arreglo propuesto:** actualizar comentarios, quitar el filtro o rehacerlo con el criterio de contraste real, y revisar el ocre.
- **Confianza:** confirmado en el código.

#### ANA-24 · Las dos matrices tienen leyendas e índices distintos
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/charts/oaa/OaaCorrelationHeatmap.tsx:103-118`; `src/charts/oaa/OaaOverlapHeatmap.tsx:169-173`, `:223-233`; `src/styles/charts.css:535-537`
- **Qué pasa:** la correlación lleva una rampa continua (`--seq-1 → --seq-4 → --seq-8`), aunque las celdas usan siete clases que saltan
  el paso 4; el solapamiento lleva tres muestras «Bajo / Medio / Alto». El índice de la correlación va sin puntos de color «porque
  sugerirían una identidad cromática que la matriz no usa»; el del solapamiento los lleva, con los colores de la paleta categórica.
- **Arreglo propuesto:** una misma leyenda por clases para las dos y el mismo índice sin color.
- **Confianza:** confirmado en el código.

#### ANA-25 · Sellos de calidad del dato con mayúsculas al azar y explicación solo en `title`
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/charts/oaa/OaaChartFrame.tsx:20-38`; usos en `CorrelationHeatmap.tsx:50`, `OverlapHeatmap.tsx:102`, `XrayAdvanced.tsx:407`, `oaaQuality.ts`
- **Qué pasa:** los sellos dicen «Real», «Estimado», «Sintético», pero también «histórico», «cartera», «subyacente», «sin dato», en
  minúscula. Lo que significan va en el atributo `title`, que no se ve con teclado ni en tableta. El sello «mixto» se pinta con el color
  de aviso.
- **Arreglo propuesto:** rótulos en mayúscula inicial y la nota como texto visible o en un `aria-describedby`.
- **Confianza:** confirmado en el código.

#### ANA-26 · Fechas de crisis y tooltips con otro formato corto que el resto
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/HistoricalStressCards.tsx:23-38`; `src/charts/oaa/chartFormatters.ts:43-47`; `src/core/format.ts:185-200`
- **Qué pasa:** `fmtDayShort` escribe «5 mar 2020» y quita los puntos de la abreviatura; las tarjetas de estrés y los tooltips usan su propio
  `Intl` con `day: "2-digit"` («05 mar 2020») y no quitan el punto («sept.» según el motor). En la misma pestaña conviven los dos formatos.
- **Arreglo propuesto:** usar `fmtDayShort` en los dos sitios.
- **Confianza:** confirmado en el código (el punto de «sept.» depende del navegador).

#### ANA-27 · `RiskContributionChart` anuncia una concentración estática como alerta
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/components/RiskContributionChart.tsx:121`, `:65`
- **Qué pasa:** el bloque «Concentración de riesgo superior al 40 %» lleva `role="alert"`, que el lector de pantalla interrumpe para leer
  cada vez que se monta, aunque sea contenido fijo; el vacío usa `role="status"` con «N/D». Se usa en el optimizador y en la frontera
  heredada, no en Análisis.
- **Arreglo propuesto:** `role="note"` o un `notice--warn` sin rol vivo.
- **Confianza:** confirmado en el código.

#### ANA-28 · Cuadro de costes: el error del PDF no se reintenta y el diálogo se cierra mientras se genera
- **Gravedad:** baja
- **Categoría:** estado
- **Dónde:** `src/components/CostsModal.tsx:99`, `:216-217`, `:431`, `:252`
- **Qué pasa:** el error sale como `<p role="alert">{mensaje técnico}</p>` en el pie, sin «Reintentar» ni la pieza `AvisoDelInforme` de
  los otros diálogos. El diálogo se puede cerrar durante la generación. «posición(es)» con paréntesis.
- **Arreglo propuesto:** `AvisoDelInforme` con reintento, bloqueo del cierre con `pdfBusy`, plural correcto.
- **Confianza:** confirmado en el código.

#### ANA-29 · Comparador de carteras: la cartera B lleva el color del benchmark y las columnas van en otro orden
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/PortfolioComparator.tsx:27-28`, `:232-234`
- **Qué pasa:** `B_COLOR = CHART_PALETTE[1]`, el color reservado a la referencia. Su tabla va «A · Diferencia · B», y
  `TablaDeMetricasComparativas` (Diseño) va «A · B · Diferencia».
- **Arreglo propuesto:** B en la serie 3, y un solo orden de columnas.
- **Confianza:** confirmado en el código.

#### ANA-30 · «Estructura de la cartera» repite lo que ya está encima
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/components/PortfolioXray.tsx:225-255`, `:285-295`
- **Qué pasa:** «Mayor posición» sale dos veces seguidas (en la tira y en el bloque destacado). «Concentración por posición» lista todas las
  posiciones con su peso, que ya están en la tabla de composición del mismo panel de arriba.
- **Arreglo propuesto:** dejar una sola mención de la mayor posición y quitar la lista de concentración (o dejar solo las cinco primeras con
  su peso acumulado, que sí añade algo).
- **Confianza:** confirmado en el código.

#### ANA-31 · Duplicaciones menores de cálculo y formato
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/components/PortfolioHorizonPanel.tsx:135-136`; `src/adapters/portfolioHorizon.ts:110`; `src/pages/XrayPage.tsx:113-117`, `:185`
- **Qué pasa:** `PortfolioHorizonPanel` recalcula la caída en línea (`p.value/peak-1`) en vez de usar `calculateUnderwaterSeries`, y en cada
  render. `resolveHorizonMetrics` escribe la cobertura con `toFixed(1).replace(".", ",")` en vez de `fmtPct`. `XrayPage` pide
  `buildManualPortfolioSummary` solo para comprobar que existe antes de generar el PDF, que no lo usa.
- **Arreglo propuesto:** reutilizar las funciones comunes y quitar la petición del resumen.
- **Confianza:** confirmado en el código.

#### ANA · Lo que está bien
- **El formato de cifras está centralizado** (`core/format.ts`, con `es-ES`, el menos tipográfico y los millares en cuatro cifras). En mi
  sección no hay un `toLocaleString` sin locale ni un `toFixed` que llegue a pantalla, salvo el de ANA-31.
- **La regla del 80 % de peso medido** (`leerLaTira`, `rotuloDeLaSerie`, `hayCifraDeCartera`) se aplica con cuidado y dice siempre qué
  parte se mide y qué queda fuera. Conviene conservarla tal cual en el rediseño.
- **Lo que no entra en un reparto se dice** (`LoQueNoEntra`, «No declarado», «sin situar») en vez de reescalar en silencio.
- **Comparación con la referencia en las mismas fechas**, rebasada a 100 en la primera común, y escrita en la nota.
- **Mapas de calor con tinta legible por paso de rampa** (`inkOnSequentialStep`) y clases explícitas probadas.
- **Animaciones desactivadas** en todos los gráficos de Recharts, y marcos con desplazamiento propio para que las matrices no empujen la página.
- **Los diálogos de PDF de Informes** distinguen bien «con estos datos no se puede» de «ha fallado, reinténtalo» (`AvisoDelInforme`).

#### ANA · Lo que no se ha podido mirar
- Nada en el navegador: contraste real, foco visible, comportamiento a 768/1024/2560 px, tooltips de Recharts (ANA-04, sospecha) y
  descarga en Safari (ANA-19).
- El contenido de los PDF (`src/reports/**`) más allá de su entrada y del nombre de fichero: no he comparado hoja a hoja el informe de
  cliente con la pantalla, salvo el solapamiento (ANA-01) y las crisis (ANA-15).
- `SaludYControl`, `PortfolioDataDiagnostic`, `FrontierHistoricalView`, `ApproximateFrontierChart`, `DialogoDePropuesta` y la tabla
  genérica `TablaDeDatos`: aparecen en estas pantallas pero no estaban en mi lista; solo los he leído de pasada.
- `WealthComparator` y `PortfolioComparator` viven en el Comparador, no en Análisis: los he mirado por encima (ANA-29).
- `OaaGroupedBarChart`, `OaaRiskMatrixChart` y `EuroYieldCurveChart` se usan en Estrategia y Macro: solo inventario.

### ACT · Activos y Mercado: Buscador, ficha, Comparador, Mercado y Salud del catálogo

#### ACT-01 · Añadir a cartera: cuatro reglas distintas y el Comparador deja añadir lo que la ficha bloquea
- **Gravedad:** alta
- **Categoría:** funcional
- **Dónde:** `src/components/AssetComparison.tsx:790-819`; `src/pages/BuscadorNuevoPage.tsx:209-225` y `:246`; `src/core/accionDeCartera.ts:52-68` y `:110-120`; `src/components/ficha/FichaDeActivo.tsx:258-265`
- **Qué pasa:** `accionDeCartera.ts` dice que existe para que la regla no esté escrita varias veces, pero el Comparador tiene su propia copia. Esa copia solo desactiva el botón si el activo ya está en la cartera o no es invertible. Un activo bloqueado por calidad del dato o sin precio ni métricas muestra «No se puede proponer» o «No disponible»… y el botón se puede pulsar y lo añade. Tampoco mira `historicalSelectionRestriction` (activo dado de baja, suspendido o cerrado a suscripciones), así que puede ofrecer «A cartera» en algo que la ficha marca «No disponible». El Buscador usa una tercera regla, `motivoDeNoInvertible`: tiene en cuenta la baja, lo nunca resuelto y los fondos base de las referencias, pero ni las marcas de suspensión o cierre ni `QUALITY_BLOCKED`. En la ficha, `accionDeCarteraBloqueada` tampoco bloquea `QUALITY_BLOCKED`, aunque la etiqueta diga «No se puede proponer». Resultado: el mismo activo dice tres cosas distintas según la pantalla, y puede acabar en la cartera de un cliente.
- **Cómo reproducirlo:** comparar un activo con la marca `QUALITY_BLOCKED` o `NON_INVESTABLE_SUSPENDED`/cerrado (con `is_investable` a true) → en su chip pone «No se puede proponer» o «A cartera», el botón está activo, y al pulsarlo el activo pasa a la cartera.
- **Evidencia:**
  ```tsx
  const addLabel = sinMedir ? "No disponible" : bloqueadoPorCalidadDelDato(a) ? "No se puede proponer" : notInvestable ? "No invertible" : inPortfolio ? "En cartera" : "A cartera";
  ...
  <Button disabled={inPortfolio || notInvestable} onClick={() => onAddToPortfolio(a)}
  ```
  ```ts
  export function accionDeCarteraBloqueada(activo, enCartera) {
    return enCartera || !activo.is_investable || activo.role === "BENCHMARK" || noDisponible(activo);
  } // QUALITY_BLOCKED no bloquea, aunque etiquetaDeAccionDeCartera diga «No se puede proponer»
  ```
- **Arreglo propuesto:** el Comparador usa `etiquetaDeAccionDeCartera` y `accionDeCarteraBloqueada`, como la ficha. Óscar decide si «No se puede proponer» bloquea el botón (decisión 75): si lo bloquea, va dentro de `accionDeCarteraBloqueada`; si no, la etiqueta no puede decir «No se puede…» encima de un botón que funciona. El Buscador, al consultar la raíz, pasa también por `activoParaLaAccion` + `accionDeCarteraBloqueada`. Una prueba de tabla: un activo por marca, y las tres pantallas dan la misma etiqueta y el mismo estado del botón.
- **Confianza:** confirmado en el código. Falta comprobar en datos cuántos activos tienen esas marcas con `is_investable` a true.

#### ACT-02 · Buscador: el patrimonio sale siempre en «M€», aunque el fondo lo declare en otra divisa
- **Gravedad:** alta
- **Categoría:** cálculo
- **Dónde:** `src/adapters/componerLista.ts:166` y `:291-296`; la ficha en `src/adapters/componerFicha.ts:1650-1652`; el origen en `2-plataforma-datos/src/ingestion/baseNueva/calidadYTarjeta.ts:1047-1054`
- **Qué pasa:** la tarjeta guarda `size.aum` junto con `size.currency`, pero la fila del Buscador solo lee el importe y le pega «M€». Un fondo que declara 2.500 millones de dólares sale en la lista como «2.500,0 M€», y en su ficha (que sí usa la divisa) como dólares: dos cifras distintas para el mismo dato. Al ordenar por Patrimonio se mezclan divisas como si fueran una sola.
- **Cómo reproducirlo:** en el Buscador, buscar un fondo o ETF en USD con patrimonio declarado y comparar la columna Patrimonio con la fila «Patrimonio» de su ficha.
- **Evidencia:**
  ```ts
  patrimonio: numero(valorEn(tarjeta, "size.aum")),
  ...
  celda: (f) => celdaDeCifra(f, "patrimonio", f.patrimonio, (v) => `${fmtMiles(v / 1e6, 1)} M€`)
  ```
  ```ts
  aum: patrimonio['aum'], currency: patrimonio['currency'], as_of: patrimonio['as_of']   // la tarjeta sí lleva la divisa
  ```
- **Arreglo propuesto:** leer `size.currency` y escribir el importe con su divisa (por ejemplo «2.500,0 M US$», o en el formato compacto de `importeGrande`). Si se quiere ordenar, agrupar por divisa con el mismo mecanismo de `escalaMixta`, o convertir con el tipo de cambio de su fecha y decirlo. Prueba en `buscadorNuevo.test.tsx`: una tarjeta con `size.currency: "USD"` no escribe «€».
- **Confianza:** confirmado en el código. No he medido cuántas tarjetas traen una divisa distinta del euro.

#### ACT-03 · Estrategia: al cambiar Diario/Semanal se ve y se descarga el informe anterior con el título nuevo
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:** `src/pages/StrategyPage.tsx:381-404`, `:407-408`, `:510`, `:563-567`
- **Qué pasa:** al cambiar de tipo, el título y los rótulos cambian enseguida (`meta`), pero el `report` anterior no se vacía. Mientras llega el nuevo, solo la cabecera muestra «Cargando…»: las pestañas de debajo siguen enseñando el informe anterior, y «Descargar PDF» y «Compartir con cliente» siguen activos (`hasPdf = Boolean(report)`). Durante unos segundos se puede generar un PDF del semanal con `reportType` diario, es decir, con título y textos del otro informe. Es papel que se entrega a un cliente.
- **Cómo reproducirlo:** Mercado → Estrategia, con el Diario cargado pulsar «Semanal» y, antes de que llegue, «Descargar PDF».
- **Evidencia:**
  ```tsx
  setError(null); setLoading(true); fetchWeeklyReportResult(reportType)   // report no se limpia
  ...
  <Button busy={pdfBusy} disabled={!hasPdf} onClick={downloadPdf} …>
  {report && visibleTab === "resumen" ? <SummaryTab report={report} … meta={meta} /> : null}
  ```
- **Arreglo propuesto:** `setReport(null)` al empezar cada carga, o guardar el tipo junto al informe (`{tipo, report}`) y no pintar ni exportar si no coincide con `reportType`. Prueba: con la carga pendiente, el botón PDF está desactivado y no hay pestañas con contenido.
- **Confianza:** confirmado en el código.

#### ACT-04 · Comparador: la primera carga monta, desmonta y vuelve a montar la pantalla
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/pages/AssetComparisonPage.tsx:38-47`; `src/core/useAsyncData.ts:17-27`
- **Qué pasa:** `useAsyncData` empieza con `loading = false` y no lo pone a true hasta el efecto. En el primer pintado la página no cumple la condición de «cargando», así que monta `AssetComparison` con `assets = []`: abre el selector, pinta «Selecciona dos activos para empezar» y lanza dos búsquedas de 200 activos (el listado y el `AssetPicker`). Justo después `loading` pasa a true, la página enseña «Cargando…» y desmonta el comparador. Cuando llegan los datos, lo monta otra vez y repite las dos búsquedas. Puede verse un parpadeo del estado vacío, y se pagan dos llamadas de más cada vez que se entra.
- **Cómo reproducirlo:** con dos o más activos marcados, ir a Comparador y mirar en la red las llamadas de búsqueda (salen duplicadas).
- **Evidencia:**
  ```tsx
  const load = useAsyncData(() => dataSource.getComparableAssets(assetIds), [assetIds, dataSource], { initialData: [] });
  if (load.loading && assetIds.length > 0 && assets.length === 0) return <LoadingState>…
  ```
  ```ts
  const [loading, setLoading] = useState(false);   // useAsyncData
  ```
- **Arreglo propuesto:** que `useAsyncData` arranque con `loading = enabled && initialData == null`, o que la página compruebe «hay ids y aún no ha contestado» (`load.data === initialData`). Prueba: montar la página con dos ids y contar una sola llamada a `searchAssetsPage`.
- **Confianza:** el desmontaje está confirmado en el código; que el parpadeo se llegue a ver es una sospecha (hay que mirarlo en el navegador).

#### ACT-05 · Comparador: la selección del marco y la de la pantalla se pueden desincronizar
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/app/BdbActivosApp.tsx:549-550` (`onRemove` y `onAdd` son los dos `handleToggleComparison`); `src/components/AssetComparison.tsx:278-304`, `:370-392`; `src/core/comparisonSelection.ts:38-46`
- **Qué pasa:** el comparador lleva su propio `selected` y avisa al marco con un conmutador. Si en la selección guardada hay un id que `getComparableAssets` no devuelve (un activo dado de baja del catálogo, o una lectura que falló), ese id no aparece en pantalla y no hay forma de quitarlo, pero ocupa sitio en el marco. Con cuatro visibles y cinco guardados, añadir uno en pantalla funciona (4 < 5), pero el conmutador del marco no lo añade (5 ≥ 5). La pantalla enseña cinco y lo guardado es otra cosa: el Buscador dice «Comparar» de un activo que se está comparando, la mesa de trabajo dice 5/5, y al recargar se pierde el último.
- **Cómo reproducirlo:** guardar en `bdb-activos.comparison-selection.v1` un ISIN que no exista y cuatro reales, abrir el Comparador y añadir uno más.
- **Evidencia:**
  ```ts
  if (current.length >= MAX_COMPARISON_ASSETS) return current;   // toggleComparisonId
  ```
  ```tsx
  if (selected.some(...) || selected.length >= MAX) return; setSelected((c) => [...c, asset]); onAdd?.(asset.asset_id);
  ```
- **Arreglo propuesto:** que la pantalla no tenga selección propia: la de verdad es la del marco, y lo que no se resuelve se enseña como «No encontrado» con su «×». O, al menos, `onAdd` y `onRemove` explícitos (añadir/quitar, no conmutar) y depurar del marco los ids que no se resuelven. Prueba con un id inexistente en la selección.
- **Confianza:** el camino está confirmado en el código; no sé con qué frecuencia pasa (sospecha).

#### ACT-06 · Calendario económico: los eventos sacados del informe de estrategia llevan una hora inventada, las 09:00
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:** `functions_python/economic_calendar.py:258-267`; se pinta en `src/components/EconomicCalendarPanel.tsx:106-111` y `:205`
- **Qué pasa:** cuando el calendario se completa con los hechos del informe de estrategia, la Function les pone las 09:00 de Madrid, porque el informe solo trae el día. La pantalla enseña esa hora como si fuera la de publicación del dato. Es precisión inventada: el asesor puede decirle a un cliente que el IPC sale a las nueve.
- **Cómo reproducirlo:** Mercado → Tipos y calendario, con una respuesta cuyo `source` sea `STRATEGY_REPORT`: todas las filas de ese origen marcan «09:00».
- **Evidencia:**
  ```py
  "date": datetime.combine(event_day, time(hour=9), tzinfo=MADRID).isoformat(),
  ```
  ```tsx
  time: d ? d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—"
  ```
- **Arreglo propuesto:** devolver solo la fecha (`"2026-11-13"`) o una marca `sin_hora: true`, y que la pantalla escriba «Sin hora» o deje la celda vacía en vez de la hora. Prueba en `agendaDeMercado.test.tsx` con un evento sin hora.
- **Confianza:** confirmado en el código (la Function la escribe y el panel la pinta tal cual).

#### ACT-07 · Ficha anterior (la de respaldo): «Último dato» ambiguo, dos «Coste corriente» y costes donde no aplican
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/AssetDetail.tsx:211-221`, `:128-134` y `:418`, `:471-485`; `src/components/AssetDetailMetrics.tsx:39-40`
- **Qué pasa:** la ficha que sale cuando la base nueva no conoce el activo tiene cuatro problemas.
  (a) El recuadro «Último dato» enseña el último precio con dos decimales y sin divisa y, si no hay precio, la rentabilidad del año en %. El mismo hueco muestra dos magnitudes distintas sin decir cuál es.
  (b) «Coste corriente» aparece dos veces con fuentes distintas: Resumen y Costes usan `asset.costs.ongoing_charge`, y Fundamentales usa `fund_metrics.ongoing_charge_pct` o `net_expense_ratio_pct`. Pueden no coincidir dentro de la misma ficha.
  (c) La pestaña Costes y la fila «Comisión de gestión» salen también para una acción, con «N/D». La decisión 17 dice que un campo presente donde no aplica es un error; el Sharpe sí se filtra.
  (d) Lo ausente se escribe «N/D», mientras la ficha nueva escribe «Falta el dato» o «No aplica».
- **Cómo reproducirlo:** abrir `/activo/<un ISIN que solo tenga la base anterior>` (los 8 que no están en la base nueva).
- **Evidencia:**
  ```tsx
  {typeof latestValue === "number" ? fmtNum(latestValue, 2) : asset.metrics.ytd_return !== undefined ? fmtPct(asset.metrics.ytd_return, 1) : ND}
  { label: "Comisión de gestión", value: asset.costs?.management_fee, kind: "pct" }   // sin `metrica`
  ```
- **Arreglo propuesto:** el rótulo del recuadro dice qué es («Último valor liquidativo · USD» o «Rentabilidad en el año»); un solo «Coste corriente» con su fuente; costes filtrados con `seEnsenaLaMetrica`; usar `Ausencia` en vez de `ND`. O decidir si esta ficha sobrevive para 8 activos: siete lo son por decisión de alcance.
- **Confianza:** confirmado en el código.

#### ACT-08 · Ficha nueva: si falla la otra lectura, los fundamentales desaparecen sin decir nada
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/components/ficha/FichaDeActivo.tsx:120-152`; `src/adapters/decidirFicha.ts:47-53`
- **Qué pasa:** la ficha se pinta en cuanto contesta la base nueva, sin esperar a `getAssetDetail`, que es lo correcto. Pero si esa lectura falla, la decisión pasa `activo: null`, `componerFicha` se compone sin fundamentales y no aparece ningún aviso ni ningún «Reintentar». En una acción, «Valoración» y «Rentabilidad y crecimiento» simplemente no están, y el asesor no puede saber si faltan o fallaron. Cuando sí llegan, lo hacen segundos después y empujan la página hacia abajo.
- **Cómo reproducirlo:** abrir la ficha de una acción con la Function de detalle caída o en frío.
- **Evidencia:**
  ```ts
  return { pantalla: "ficha", instrumento: baseNueva.instrumento, activo: activo.estado === "lo-conoce" ? activo.activo : null };
  ```
- **Arreglo propuesto:** pasar a la ficha el estado de la otra lectura («cargando», «falló»). Mientras carga, un hueco reservado con «Cargando fundamentales…»; si falla, «No se han podido leer los fundamentales» con Reintentar. Prueba en `fichaDeActivo.test.tsx` con `getAssetDetail` rechazado.
- **Confianza:** confirmado en el código. Cuánto se mueve la página hay que verlo en el navegador.

#### ACT-09 · Comparador: la tabla de métricas no trae el coste corriente
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/adapters/comparativaDeActivos.ts:574-657` (filas de la tabla); en cambio `src/components/AssetComparisonCatalogModal.tsx:122-127` sí lo tiene
- **Qué pasa:** la tabla principal de «Comparar activos» tiene rentabilidades, volatilidades, Sharpe, Sortino, caída y retrocesión, pero no el coste corriente. Para comparar fondos es una de las tres cifras que más pesan, y está en el Buscador y en el listado modal del mismo comparador. El asesor tiene que salir a otra pantalla para comparar costes.
- **Cómo reproducirlo:** comparar dos fondos y buscar el TER en la tabla.
- **Evidencia:** `filasDeActivos` termina en `caida-3y` y `retro`, sin ninguna fila de `costs.ongoing_charge`.
- **Arreglo propuesto:** una fila «Coste corriente» que lea `costs.ongoing_charge` de la tarjeta, con «No aplica» para acciones (`seEnsenaLaMetrica("costeCorriente")`), y que la lleve también el PDF. Es una decisión de producto: lo señalo para que la tome Óscar.
- **Confianza:** confirmado en el código.

#### ACT-10 · Buscador: el filtro de producto se anuncia como pestañas y apunta a paneles que no existen
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/pages/BuscadorNuevoPage.tsx:324-330`; `src/components/ui/SegmentedTabs.tsx:52-66`; en el Comparador, `src/components/AssetSearchFilters.tsx:202-207`
- **Qué pasa:** «Todos/Fondos/Acciones/ETF» es un filtro, pero se pinta con `SegmentedTabs`: `role="tablist"`, `role="tab"` y `aria-controls="buscador-tipo-panel-FUND"`, y no hay ningún elemento con ese id. Un lector de pantalla anuncia pestañas que no controlan ningún panel. El mismo filtro en el selector del Comparador usa `SegmentedControl` (botones con `aria-pressed`) y otro orden de opciones (Fondos, ETF, Acciones frente a Fondos, Acciones, ETF): dos controles para lo mismo.
- **Evidencia:**
  ```tsx
  <SegmentedTabs idPrefix="buscador-tipo" label="Producto" onChange={(siguiente) => cambiar({ tipo: siguiente })} tabs={TIPOS} value={tipo} />
  ```
- **Arreglo propuesto:** `SegmentedControl` en el Buscador y un mismo orden de opciones en los dos sitios. Prueba: en el Buscador no hay ningún `role="tab"`.
- **Confianza:** confirmado en el código.

#### ACT-11 · Buscador: el recuento de resultados no se anuncia al filtrar
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/pages/BuscadorNuevoPage.tsx:399-402`
- **Qué pasa:** «312 de 1.091 activos» cambia en cada tecla, pero no es una región viva. Quien usa un lector de pantalla no sabe si su búsqueda ha encontrado algo hasta que recorre la tabla (WCAG 4.1.3, mensajes de estado). La única región `role="status"` de la pantalla es la de los avisos de «Añadir».
- **Evidencia:** `<p className="buscador-nuevo__cuantos">{fmtMiles(filas.length)} de {fmtMiles(data?.length ?? 0)} activos…</p>`
- **Arreglo propuesto:** `role="status"` (o `aria-live="polite"`) en el recuento, a ser posible con un retardo de ~500 ms para no anunciar cada tecla. Prueba de marcado.
- **Confianza:** confirmado en el código.

#### ACT-12 · Rendimiento: ordenar por una cifra formatea miles de veces, y el selector pregunta al servidor en cada tecla
- **Gravedad:** media
- **Categoría:** rendimiento
- **Dónde:** `src/components/tabla/TablaDeDatos.tsx:154-157`; `src/core/format.ts:19-28` (un `Intl.NumberFormat` nuevo en cada llamada); `src/adapters/componerLista.ts:221-233`; `src/components/AssetPicker.tsx:85-125`
- **Qué pasa:**
  (a) El comparador del orden llama a `columna.celda(fila)` dos veces por comparación, y cada celda numérica crea un `Intl.NumberFormat` para escribir un texto que el orden no usa. Con ~1.100 filas son unas 20.000 construcciones cada vez que cambia la lista. Si el asesor ordena por rentabilidad y luego teclea, se reordena en cada tecla.
  (b) En el selector del Comparador la búsqueda va al servidor, sin espera entre teclas: «santander» son nueve llamadas a la Function.
  (c) Cada tecla del Buscador actualiza el estado del marco (`estadoDelBuscador` vive en `BdbActivosApp`), que se vuelve a pintar entero. Como `enCartera` llega como un `.map()` nuevo en cada pintado, las columnas se rehacen siempre (`BuscadorNuevoPage.tsx:298`).
- **Evidencia:**
  ```ts
  return [...filas].sort((a, b) => comparar(columna.celda(a), columna.celda(b), sentido));
  ```
- **Arreglo propuesto:** precalcular la clave de orden una vez por fila (`filas.map(f => [f, columna.celda(f)])`) y ordenar sobre eso; cachear los `Intl.NumberFormat` por número de decimales en `format.ts`; 250 ms de espera en el `AssetPicker`; `useMemo` para `enCartera` en el marco. Prueba de tiempos con 1.100 filas.
- **Confianza:** confirmado en el código; el coste real es una sospecha (hay que medirlo en el navegador).

#### ACT-13 · Fechas con tres formatos distintos en la misma sección
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/pages/StrategyPage.tsx:92-94`; `src/components/EconomicCalendarPanel.tsx:99`; `src/components/EarningsPanel.tsx:282`; `src/core/format.ts:186-201`
- **Qué pasa:**
  (a) Estrategia formatea con `day: "2-digit"` y sin quitar el punto del mes: «03 nov 2026», o «03 nov. 2026» según la versión del motor. El resto de la aplicación usa `fmtDayShort`: «3 nov 2026».
  (b) En Mercado, el calendario titula los días «jueves, 13 de noviembre», sin año y con `toLocaleDateString`, y Resultados los titula «jueves, 13 de noviembre de 2026» con `fmtDateLong`.
  (c) `fmtDayShort` aplica UTC también a marcas de tiempo completas («base actualizada el…», en el Buscador): una pasada a las 00:30 del 14 en Madrid sale como el 13.
- **Evidencia:**
  ```ts
  function formatDate(value: string) { return fmtDateWith(value, { day: "2-digit", month: "short", year: "numeric" }) ?? value; }
  label: d ? d.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" }) : "Sin fecha",
  ```
- **Arreglo propuesto:** `fmtDayShort` en Estrategia; un solo formato para la cabecera de día en las dos agendas (con año, que el periodo puede cruzar de año); en `fmtDayShort`, UTC solo para fechas de 10 caracteres, como hace `displayDate`. Pruebas en `format`.
- **Confianza:** confirmado en el código.

#### ACT-14 · Vocabulario: el mismo concepto con varios nombres
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** varios; cada caso, con su sitio:
  - **El botón de añadir:** «Añadir» (Buscador, `BuscadorNuevoPage.tsx:277`), «Añadir a cartera» (ficha, `accionDeCartera.ts:57`) y «A cartera» (Comparador, `AssetComparison.tsx:801`). Lo que no se puede añadir aparece como «Benchmark» (ficha), «No invertible» (Comparador) o «Índice o no invertible» (ficha anterior, `AssetDetail.tsx:52`).
  - **La rentabilidad a un año:** «Rentabilidad 1 año» (Buscador), «Rentabilidad 1A» (listado modal), «Rentabilidad anualizada 1 año» (tabla del Comparador) y, en la evolución, «Variación del periodo».
  - **«Comparar» con dos significados en la misma pantalla:** en la fila del Buscador marca el activo; en la mesa de trabajo abre el Comparador (`MesaDeTrabajo.tsx:44`).
  - **«Cartera»:** en la ficha anterior, la pestaña «Cartera» son las posiciones del fondo (`AssetDetail.tsx:33`), y en el resto de la aplicación es la del cliente.
  - **La región:** «Región dominante» (Buscador) frente a «Región» (selector del Comparador, `AssetPicker.tsx:207`), que filtran por campos distintos.
  - **El tipo de producto:** «Producto» frente a «Tipo» (listado modal, `AssetComparisonCatalogModal.tsx:121`).
  - **La referencia:** «Cartera de referencia» en la pantalla y «benchmark» en avisos y etiquetas.
  - **El tipo de informe:** el listado modal se titula «Listado por filtro», con el antetítulo «Comparador multi-activo», y su botón dice «Añadir a la comparación» aunque también quita.
- **Qué pasa:** el asesor que aprende un nombre en una pantalla no lo reconoce en la siguiente.
- **Arreglo propuesto:** un glosario corto con un nombre por concepto: «Añadir a cartera», «Rentabilidad 1 año», «Posiciones del fondo», «Cartera de referencia», «Aplicar selección». Los rótulos de botón, sacados de un solo módulo.
- **Confianza:** confirmado en el código.

#### ACT-15 · Colores con significado: el rojo, la terracota y el índigo dicen cosas distintas según el sitio
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/styles/modules.css:2533-2539` (impacto), `:2835-2841` (visión), `:2689-2694` (vigencia); `src/styles/base.css:247-251`; `src/styles/ficha.css:90-91`, `:133-134`, `:327-347`; `src/pages/SaludDelCatalogoPage.tsx:74-80`
- **Qué pasa:** la regla general (`base.css`) es que una cifra positiva o negativa no se colorea: el signo ya lo dice. Pero en esta sección hay color con significado:
  - **Rojo (`--negative`):** el impacto «Alto» del calendario y la visión «Negativa» de la Estrategia. Un mismo rojo significa «importante» en una pestaña y «malo» en la siguiente.
  - **Verde/rojo:** la visión táctica (Positiva/Negativa) se colorea, mientras las flechas de tendencia de esa misma página no, a propósito (hallazgo 130).
  - **Terracota (`--ficha-baja`):** en la ficha marca a la vez «Dejó de cotizar» y «Falta el dato» (fila y aptitud).
  - **Índigo (`--ficha-marca`):** es a la vez el «Sí» de una aptitud, el «sin pedir / pendiente de alta» de una fila y el «afirma» de Salud del catálogo.
  - **Vigencia del informe:** `is-${freshness.toLowerCase()}` produce `is-current`, que no tiene regla, mientras `is-ok` existe y nunca se usa. «Informe vigente» sale gris y no verde, como se pretendía.
- **Arreglo propuesto:** una tabla de significados por color en la habilidad de diseño. El impacto del calendario, con un distintivo no semántico (peso o punto) en vez del rojo de «negativo»; separar «baja» de «falta»; arreglar `is-current` o quitar `is-ok`.
- **Confianza:** confirmado en el código; el contraste y la percepción no los he medido.

#### ACT-16 · Rentabilidad: signo y decimales distintos según la pantalla
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/adapters/componerLista.ts:235` (Buscador, con signo y 2 decimales); `src/adapters/comparativaDeActivos.ts:491` (Comparador, con signo y 2); `src/components/AssetComparisonCatalogModal.tsx:146` (listado modal, sin signo y 1 decimal); `src/components/AssetDetailMetrics.tsx:18-20` (ficha anterior, sin signo y 2); `src/components/AssetHistoryChart.tsx:36` (evolución, con signo y 1)
- **Qué pasa:** la misma rentabilidad a un año del mismo fondo se lee «+12,34 %» en el Buscador y «12,3 %» en el listado del Comparador, a dos clics de distancia. Quien compara de un vistazo cree que son cifras distintas.
- **Arreglo propuesto:** una función `fmtRentabilidad` (con signo y 2 decimales en tabla) usada en todas; la evolución puede quedarse con 1 decimal si se decide así para el gráfico.
- **Confianza:** confirmado en el código.

#### ACT-17 · Mercado: la pestaña no va en la dirección, y Tipos y curva del BCE se piden también en Dividendos y Resultados
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/pages/MercadoPage.tsx:27-31` y `:42-48`; `src/pages/MacroPage.tsx:104-142`
- **Qué pasa:** cambiar de pestaña no cambia la URL: no se puede compartir ni recargar «Mercado → Dividendos», y «Atrás» no vuelve a la pestaña anterior (solo las direcciones antiguas `/agenda` y `/estrategia` traen pestaña). Además, `MacroPage` pide los tipos y la curva al montarse sea cual sea la pestaña: abrir Dividendos lanza dos llamadas al BCE cuyo resultado no se enseña, y volver de Estrategia las repite.
- **Arreglo propuesto:** `/mercado/<pestaña>` con `replaceState`, o `?pestana=`; mover las dos lecturas del BCE dentro de la rama `calendario`, o a un componente propio con `crearRanuraDeAgenda` como los otros paneles. Prueba: al montar con `tab="dividendos"` no se llama a `fetchEcbRates`.
- **Confianza:** confirmado en el código.

#### ACT-18 · Ficha: del título principal se salta al nivel 3
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/components/ficha/FichaInstrumento.tsx:136` (h1) y `src/components/ficha/CabeceraDeSeccion.tsx:25` (h3); `src/components/AssetDetail.tsx:169` y `:262`
- **Qué pasa:** las dos fichas pasan de `h1` a `h3` sin ningún `h2`. Quien navega por encabezados encuentra la estructura rota.
- **Arreglo propuesto:** las secciones, en `h2`. Prueba de marcado: no hay saltos de nivel.
- **Confianza:** confirmado en el código.

#### ACT-19 · Selector del Comparador: clases escritas a mano, región sin traducir y filtros ocultos que siguen mandando
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/AssetPicker.tsx:219-230`, `:292`; `src/components/AssetComparison.tsx:394-402`, `:766-771`
- **Qué pasa:**
  (a) Las opciones de «Clase de activo» están escritas a mano (MIXED, MONEY_MARKET, COMMODITIES…). Faltan `REAL_ASSET` («Inmobiliario», que sí está en `CLASS_LABELS`) y `UNKNOWN`, y no salen del dato como en el Buscador.
  (b) La fila enseña `a.region` sin traducir, mientras el desplegable la traduce con `regionLegible`.
  (c) Al ocultar el selector («Ocultar buscador»), sus filtros siguen aplicándose al botón del listado modal («120 de 200»), sin que se vea ningún filtro puesto.
- **Arreglo propuesto:** opciones calculadas sobre los resultados, `regionLegible` en la fila, y que el listado diga qué filtros lo limitan o los limpie al ocultarse.
- **Confianza:** confirmado en el código.

#### ACT-20 · Estrategia: claves de lista sacadas del texto, código muerto y un «N/D segmentos»
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/pages/StrategyPage.tsx:124`, `:180`, `:194`, `:331`, `:347` (claves); `:564-565` (`isSample={false}` fijo); `:268`; `:503`
- **Qué pasa:**
  - Las claves de las listas son el propio texto (`key={event}`, `key={kpi.label}`, `key={risk.risk}`, `key={source.url}`). El informe lo redacta un modelo, y dos hechos iguales dan claves duplicadas, con aviso en la consola y filas que se pueden mezclar.
  - Todo lo de «Muestra» depende de `isSample`, que siempre vale `false`: es código muerto.
  - El estado `${fixedIncome.length || "N/D"} segmentos` escribe «N/D segmentos».
  - «Publicar el de hoy» lanza la redacción (minutos, y con coste) sin pedir confirmación.
- **Arreglo propuesto:** claves con índice, o texto + índice; quitar `isSample`; «Sin desglose» en el estado; una confirmación antes de publicar.
- **Confianza:** confirmado en el código.

#### ACT-21 · Comparador: las estrellas de Morningstar no se redondean
- **Gravedad:** baja
- **Categoría:** funcional
- **Dónde:** `src/adapters/comparativaDeActivos.ts:609-612` (la ficha anterior sí redondea y topa, `AssetDetail.tsx:170-172`)
- **Qué pasa:** con `"★".repeat(estrellas)` y `"☆".repeat(5 - estrellas)`, una puntuación de 3,5 pinta 3 + 1 = 4 estrellas, y una mayor que 5 lanza `RangeError` y rompe la tabla. La ficha anterior hace `Math.round` y `Math.min(5, …)`.
- **Arreglo propuesto:** redondear y acotar a [0, 5] en un solo sitio que usen las dos.
- **Confianza:** confirmado en el código; no sé si llegan valores no enteros (sospecha).

#### ACT-22 · Buscador: el estado vacío de «Solo favoritos» y el primer sentido del orden
- **Gravedad:** baja
- **Categoría:** estado
- **Dónde:** `src/pages/BuscadorNuevoPage.tsx:464-469`; `src/components/tabla/TablaDeDatos.tsx:245-247`
- **Qué pasa:** con «Solo favoritos» marcado y ningún favorito, la pantalla dice «Prueba con otro nombre, ticker o ISIN, o quita algún filtro», en vez de explicar que no hay favoritos ni cómo marcarlos. Y el primer clic en Rentabilidad o Sharpe ordena de menor a mayor: lo peor arriba, al revés de lo que suele buscar el asesor.
- **Arreglo propuesto:** un texto propio para «sin favoritos»; que las columnas `cifra` empiecen en descendente (salvo volatilidad y coste, si se decide así).
- **Confianza:** confirmado en el código.

#### ACT-23 · Ficha: un ISIN en minúsculas o con espacios no se encuentra
- **Gravedad:** baja
- **Categoría:** funcional
- **Dónde:** `src/app/appRoutes.ts:128-139`; `src/components/ficha/FichaDeActivo.tsx:81` y `:108-119`; `src/adapters/baseNuevaLectura.ts:107-110`
- **Qué pasa:** `/activo/lu0011889846` o un ISIN pegado con un espacio se pasan tal cual a la base: «No encontramos este activo», aunque el activo exista. Solo se protege la `/`: un identificador con `?` o `#` construye una petición REST con consulta (en desarrollo) o una ruta inválida del SDK (en producción), y sale «No se pudo leer» en vez de «No existe».
- **Arreglo propuesto:** `trim().toUpperCase()` si tiene forma de ISIN, y validar el patrón (`^[A-Z0-9.\-]{1,20}$`) antes de preguntar. Prueba con minúsculas.
- **Confianza:** sospecha (no he comprobado si la base guarda alguna clave en minúsculas, ni cómo responde el SDK).

#### ACT-24 · Código: nombres que tapan globales, clases de otra pantalla y estilos en línea
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:**
  - `src/components/AssetHistoryChart.tsx:46`: el estado se llama `window`, que tapa el global.
  - `src/pages/MacroPage.tsx:160`: `<article className="portfolio-builder-panel macro-page">` dentro de otro `<article>` (`MercadoPage.tsx:34`), con la clase del Constructor.
  - `src/components/AssetComparison.tsx:185`, `:187` y `:804`, y `src/charts/EuroYieldCurveChart.tsx:157`, `:204-205`: colores puestos con `style={{…}}`.
  - `src/components/AssetDetail.tsx:181`: se limpia a mano un texto del adaptador («datos en vivo de BBDD-ACTIVOS»).
- **Arreglo propuesto:** renombrar a `ventana`; una clase propia para Mercado y un solo `article`; los colores de serie, como variables CSS por índice; limpiar la descripción en el adaptador.
- **Confianza:** confirmado en el código.

#### ACT-25 · Salud del catálogo: tablas sin marco y un mensaje de error de desarrollo
- **Gravedad:** baja
- **Categoría:** adaptación
- **Dónde:** `src/pages/SaludDelCatalogoPage.tsx:101-129` y `:136-164`; `src/adapters/baseNuevaLectura.ts:274-278`; `src/components/EstadoDelCatalogoPanel.tsx:202`
- **Qué pasa:**
  - Las dos tablas son `<table>` sueltas, sin `tabla__marco`, y la primera lleva rutas largas en `<code>`: a 768 px pueden empujar el ancho.
  - El error de lectura dice «¿Está levantado su emulador en…?», que es un mensaje de desarrollo; en la web publicada se usa el SDK y no aparece, pero en local lo ve cualquier usuario.
  - `EstadoDelCatalogoPanel` (pestaña de Sistema) vuelve a leer las 1.091 tarjetas con `listarTarjetas` en vez de usar `catalogoEnSesion`: un coste facturado por visita que el Buscador ya evita.
- **Arreglo propuesto:** envolver las tablas en `tabla__marco`; un mensaje de error para el usuario y el detalle técnico al registro; `leerCatalogoEnSesion` en el panel.
- **Confianza:** el desborde es una sospecha (hay que medirlo a 768 px); lo demás está confirmado en el código.

#### ACT · Lo que está bien
- **`decidirFicha`** separa «no existe», «no se pudo leer» y «cargando», y se prueba sin pantalla: un ISIN inexistente o una caída de red ya no te devuelven al Buscador sin decir nada.
- **`TablaDeDatos`** agrupa por método al ordenar una columna con escalas mezcladas, deja lo ausente siempre al final, repite la cabecera del grupo en la página siguiente y es una `<table>` de verdad con `aria-sort`. Es la pieza que mejor encarna el rigor del proyecto.
- **Las ausencias** («Falta el dato», «No aplica», «Sin pedir») distinguen tres cosas con texto, color y forma de filete, y la ficha nueva no tiene ramas por tipo: pinta lo que el instrumento declara.
- **El Buscador vuelve donde estaba** (búsqueda, filtros, orden, página y desplazamiento) y lee el catálogo una sola vez por sesión.
- **El Comparador saca de las mismas filas** la tabla, el plano, el pie metodológico y el PDF, y el plano dibuja un panel por método. Mide la correlación en semanal aunque el gráfico vaya en diario, y lo explica.
- **La Estrategia obliga a confirmar** «He leído este informe» antes de compartirlo. El Markdown pasa por `react-markdown` sin HTML crudo, y los enlaces externos llevan `rel="noreferrer"`.
- **La agenda** guarda lo cargado en memoria durante la sesión y distingue un fallo de «no hay nada previsto».

#### ACT · Lo que no se ha podido mirar
- Nada en el navegador: parpadeos (ACT-04), saltos de la ficha (ACT-08), desbordes a 768 y 1024 px, contraste de color, foco visible, tamaño real de los objetivos («×» de los chips, estrella de favorito) y el coste real del orden (ACT-12).
- No he ejecutado ninguna prueba.
- No he leído enteros `componerFicha.ts` (1.819 líneas), `TablaComparativa.tsx`, `PlanoRiesgoRetorno.tsx`, `CorrelationHeatmap.tsx`, los PDF de ficha, comparativa y estrategia, ni `modules.css` entero (6.524 líneas; solo las reglas que cito).
- `MacroAllocationPanel`, `MetricasComparativas` y `TablaDeAlternativas` están en mi lista, pero se usan en Diseño, Simular y Sustituir, no en estas pantallas. No las he revisado a fondo.
- Los datos reales: cuántas tarjetas traen patrimonio en otra divisa (ACT-02), cuántos activos tienen marcas de bloqueo con `is_investable` a true (ACT-01) y si alguna puntuación de Morningstar no es entera (ACT-21).

### PLA · Planificación y Datos: Jubilación, Planes y EPSV, Sistema

#### PLA-01 · «Sobran X €» va siempre en euros de hoy, sin decirlo, aunque la pantalla y el informe estén en euros de cada año
- **Gravedad:** alta
- **Categoría:** cálculo
- **Dónde:** `src/core/jubilacion/lectura.ts:373-381` (`lecturaDeEscenarios`); se pinta en `src/components/jubilacion/ResultadoDeJubilacion.tsx:177-190` y en `src/reports/jubilacionPdf.tsx:363-371`
- **Qué pasa:** el selector «Euros de hoy / Euros de cada año» cambia la cifra grande, los gráficos y las tablas. La frase de cada escenario («Llegan a los 95 años y sobran 120.000 €») sale siempre de `patrimonioFinalDeHoy`, es decir, en euros de hoy, y ni el panel ni el PDF dicen la unidad. Con «euros de cada año», el gráfico «Cuánto dura el patrimonio» acaba en otra cifra (la nominal, bastante mayor a 30 años), y la primera hoja del informe de cliente mezcla las dos unidades sin rótulo.
- **Cómo reproducirlo:** cargar el ejemplo, elegir «Gastarlos…» no, «Vivir de lo que rinden» o subir la rentabilidad para que sobre patrimonio, y pasar a «Euros de cada año». Comparar «sobran …» con el último punto del gráfico de saldos o con «Ahorros al cierre» de la tabla. Generar el informe en esas unidades.
- **Evidencia:**
  ```ts
  const finalDeHoy = patrimonioFinalDeHoy(e, o.inflacion);
  ...
  : finalDeHoy > 1000
    ? `Llegan a los ${o.edadFin} años y sobran ${fmtEur(finalDeHoy)}`
  ```
  y el subtítulo del panel: `"Rentabilidades elegidas para simular, no previstas ni prometidas · las mismas retiradas en todos los casos"` (sin unidad).
- **Arreglo propuesto:** pasar `unidades` a `frasesDeEscenarios` / `lecturaDeEscenarios` y usar `saldoAlCierre(ultima, inflacion, unidades)`. Si se prefiere dejarla fija en euros de hoy, escribirlo en la frase («sobran 120.000 € de hoy») y en el subtítulo del panel y del PDF. La prueba: en `jubilacionLectura.test.ts`, el mismo resultado en las dos unidades da cifras distintas y cada una coincide con la última fila de `serieDeSaldos` en sus unidades.
- **Confianza:** confirmado en el código

#### PLA-02 · Inspección: la ficha del activo no se abre con el teclado, y pulsar el nombre saca de Sistema
- **Gravedad:** alta (pantalla interna; impide usar con teclado una función que escribe)
- **Categoría:** accesibilidad
- **Dónde:** `src/components/AdminInspector.tsx:248-251`; `src/components/ui/EnlaceAFicha.tsx:30-36`
- **Qué pasa:** el detalle (huecos, caídas y los botones «Previsualizar recálculo de caída» y «Refresco de precios») solo se abre con un `onClick` en el `<tr>`. La fila no es enfocable. Lo único enfocable de la fila es `EnlaceAFicha`, que detiene la propagación y lleva a la ficha pública del activo. Con el teclado, el detalle no se abre nunca. Con el ratón, el sitio más natural para pulsar, el nombre, te saca de Sistema y la pestaña pierde su estado. Además, el detalle aparece debajo de la paginación, fuera de la vista.
- **Cómo reproducirlo:** Sistema → Inspección, recorrer la tabla con Tab e Intro: se abre la ficha pública, no la de inspección. Pulsar en el nombre con el ratón: lo mismo.
- **Evidencia:**
  ```tsx
  <tr key={r.asset_id} onClick={() => openDetail(r.asset_id)} className="inspector-row">
    <td>
      <EnlaceAFicha isin={r.asset_id}>{r.name || r.asset_id}</EnlaceAFicha>
  ```
- **Arreglo propuesto:** pasar la tabla a `TablaDeDatos` con `alAbrir` y `detalleDe`, como ya hace `AdminFundQuality`. O poner en cada fila un botón «Inspeccionar» y dejar el enlace a la ficha como acción aparte. La prueba: en `adminPantallasLocales.test.tsx`, «la ficha de inspección se abre con Intro bajo su fila».
- **Confianza:** confirmado en el código

#### PLA-03 · Un IRPF de cero se escribe «−0 €», en pantalla y en el informe de cliente
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/components/jubilacion/ResultadoDeJubilacion.tsx:52-55` (`conSigno`), `:168` (nota del cobro de una vez), `:318`, `:339`; `src/core/jubilacion/lectura.ts:86` y `:189`; `src/reports/jubilacionPdf.tsx:247`, `:284`, `:440-442`
- **Qué pasa:** `conSigno(valor, -1)` llama a `fmtEur(-valor)`. Con `valor = 0`, o con algo por debajo de medio euro, Intl da «-0 €», y `typographicMinus` lo convierte en «−0 €». Lo comprobé con Node: `format(-0)` → `-0 €` y `format(-0.3)` → `-0 €`. Sale en la fila «IRPF» cuando las rentas no tributan (`anual: 0, signo: -1`), en la columna IRPF de «Año a año» en los años sin impuesto, en la reducción cuando no aplica, en la línea «IRPF · 0,0 % del bruto» de la respuesta y en la tabla del PDF.
- **Cómo reproducirlo:** un cliente con pensión baja y sin ahorros: «Del bruto al neto» enseña «IRPF −0 €».
- **Evidencia:** `texto: signo === -1 ? fmtEur(-valor) : ...` y `lineas.push({ clave: "sin-irpf", concepto: "IRPF", ..., anual: 0, signo: -1 })`.
- **Arreglo propuesto:** en `conSigno`, en el PDF y en `respuestaDelPrimerAnio`, escribir `fmtEur(0)` cuando `Math.round(valor) === 0`, o `signDisplay: "negative"` en el formateador (no pinta el signo del cero negativo). La prueba: `fmtEur(-0)` y `conSigno(0.3, -1)` dan «0 €».
- **Confianza:** confirmado en el código y en Node

#### PLA-04 · Un importe ya escrito no puede volver a «sin escribir»: vaciar el campo conserva la cifra
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/components/ui/EuroAmountInput.tsx` (`commit`: «Entrada vacía: se conserva el valor anterior»); se usa en `src/components/jubilacion/FormularioDeJubilacion.tsx:118`, `:329`, `:333`, `:449`, `:453`
- **Qué pasa:** en Jubilación, `null` («sin escribir») y `0` no significan lo mismo. Sin coste de adquisición, el cálculo supone coste igual al valor y avisa. Con coste 0, toda la venta es plusvalía. El campo de importe no deja volver a `null`: borrar el texto y salir deja la cifra de antes, sin decirlo. Si el asesor escribió un coste por error y quiere dejarlo «sin saber», no puede: o lo deja mal o escribe 0, que es lo contrario. Lo mismo con la pensión o la previsión. Solo «Vaciar» lo arregla, y borra todo lo demás.
- **Cómo reproducirlo:** escribir 50.000 en «Lo aportado a los fondos», borrar el texto y salir del campo: vuelve 50.000 y el aviso de «falta el coste» no sale.
- **Evidencia:** `if (draft.trim() === "") { // Entrada vacía: se conserva el valor anterior. setDraft(null); ... return; }`; y `Importe` tipa `alCambiar: (valor: number) => void`.
- **Arreglo propuesto:** una opción `permiteVacio` en `EuroAmountInput` que confirme `null` al vaciar, usada en Jubilación (los tipos de `DatosDeJubilacion` ya admiten `null`). La prueba: en `jubilacionPantalla.test.tsx`, vaciar el coste vuelve a sacar el aviso del supuesto.
- **Confianza:** confirmado en el código

#### PLA-05 · «Tomar de la cartera activa» pisa los saldos y borra los costes escritos, sin preguntar
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/pages/JubilacionPage.tsx:101-111`
- **Qué pasa:** el botón pone `fondosCoste: null` y `accionesCoste: null` y sobrescribe `fondos` y `acciones` aunque el asesor ya los hubiera escrito. «Vaciar» sí pide confirmación, pero esto no. Lo escrito se pierde, y como solo vive en memoria, no se recupera.
- **Cómo reproducirlo:** escribir saldos y costes de fondos, y pulsar «Tomar de la cartera activa».
- **Evidencia:** `setDatos((actual) => ({ ...actual, fondos: fondos > 0 ? fondos : null, fondosCoste: null, acciones: ..., accionesCoste: null }));`
- **Arreglo propuesto:** si `fondos`, `acciones` o sus costes no son `null`, usar `confirm` («Se sustituyen los saldos y se borra el coste escrito»). O conservar el coste cuando el saldo traído coincide. Una prueba en `jubilacionPantalla.test.tsx`.
- **Confianza:** confirmado en el código

#### PLA-06 · Edades, años y rentabilidades en `input type="number"`: con coma decimal puede volver al valor anterior sin aviso
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/components/jubilacion/FormularioDeJubilacion.tsx:85-110`
- **Qué pasa:** «Rentabilidad anual, en %» (paso 0,5) e «Inflación» (paso 0,1) usan `type="number"`. Cuando el navegador no reconoce la coma, `event.target.value` llega vacío. En un campo no obligatorio, `onChange` no avisa al motor (`if (!obligatorio) return`), y `onBlur` devuelve el valor anterior. El asesor teclea «2,5», sale del campo y ve otra vez «3» sin ningún mensaje. Pasa en Chrome con la interfaz en inglés y en otros navegadores según su idioma, no según el `lang="es"`. Es el mismo vicio que llevó a `EuroAmountInput` en los importes. Además, la rueda del ratón sobre el campo enfocado cambia el valor.
- **Cómo reproducirlo:** en un navegador con la interfaz en inglés, escribir «2,5» en la rentabilidad y pulsar Tab.
- **Evidencia:** `if (crudo.trim() === "") { if (!obligatorio) return; ...}` y `onBlur={() => { if (texto.trim() === "" && !obligatorio) setTexto(escrito(valor)); }}` con `type="number"`.
- **Arreglo propuesto:** `type="text" inputMode="decimal"` con `parseEuropeanNumber`, y un mensaje de cifra no válida como el de `EuroAmountInput`. La prueba: teclear «2,5» deja 2,5 en el motor.
- **Confianza:** sospecha: hay que mirarlo en Chrome y Firefox con la interfaz en inglés y en español

#### PLA-07 · Evolución comparada: con tres o cuatro planes, si uno no coincide en el tiempo, desaparece el gráfico y el mensaje es falso
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/core/planes/evolucionComparada.ts:105-110`; `src/components/planes/EvolucionComparada.tsx:101-103`
- **Qué pasa:** el mes base es el primero que tienen **todos** los planes que se dibujan. Si se comparan A, B y C, A y B se solapan y C dejó de publicar antes de que empezase B, no hay mes común: `lineas: []`. La pantalla dice entonces «No hay ningún mes en que al menos dos de estos planes tengan valor», que es falso, y no dibuja ni A ni B. C tampoco aparece en `fuera`. El caso es realista: un plan que dejó de publicar, que la propia ficha avisa, comparado con uno reciente.
- **Cómo reproducirlo:** comparar un plan con «sin valor publicado desde…» antiguo y dos planes recientes.
- **Evidencia:**
  ```ts
  const comunes = [...conValores[0].porMes.keys()].filter((mes) => conValores.every((plan) => plan.porMes.has(mes))).sort();
  const mesBase = comunes[0];
  if (mesBase === undefined) return { lineas: [], fuera };
  ```
- **Arreglo propuesto:** si no hay mes común a todos, sacar los planes que no se solapan con el mayor grupo que sí lo hace, añadirlos a `fuera` con el motivo «no coincide en el tiempo con los demás» y dibujar el resto. Cambiar también el texto del mensaje. La prueba va en `planesEvolucionComparada.test.ts`.
- **Confianza:** confirmado en el código

#### PLA-08 · Retrocesiones: «Pasada en seco» y «Refrescar» tiran las ediciones de fila sin avisar, y guardar una fila vacía el formulario de alta
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/components/AdminRetrocessions.tsx:262` (`load`), `:385` (`checkAgainstMaster`), `:296` (`saveDraft`)
- **Qué pasa:** cada fila es editable (retro, fecha, nota) y no se marca qué ha cambiado. `load()` y `checkAgainstMaster()` rehacen `drafts` desde la base y pisan lo tecleado y no guardado en cualquier fila. `applyImport` y `undoLastImport` también llaman a `load`. Por otro lado, `saveDraft` hace `setNewDraft({ isin: "", ... })` aunque se guarde una fila de la tabla, y borra lo que se estaba escribiendo en «Añadir».
- **Cómo reproducirlo:** cambiar la retro de dos filas, guardar solo una: el formulario «Añadir» se vacía. Cambiar una fila y lanzar una pasada en seco de un fichero: la edición desaparece.
- **Evidencia:** `setDrafts(Object.fromEntries(list.map((record) => [record.isin, toDraft(record)])));` (dos sitios) y `setNewDraft({ isin: "", retro_pct: "", as_of_date: "", note: "" });` sin condición.
- **Arreglo propuesto:** fusionar los borradores sucios (distintos de `toDraft(record)`) en vez de pisarlos, marcar las filas modificadas y vaciar `newDraft` solo cuando `isin` sea el del alta. Una prueba en `adminRetrocessions.test.tsx`.
- **Confianza:** confirmado en el código

#### PLA-09 · Retrocesiones: la fecha «de hoy» se toma en UTC y entre las 00:00 y las 02:00 es la de ayer
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:** `src/components/AdminRetrocessions.tsx:81-88`
- **Qué pasa:** `todayIso()` y `fileDateIso()` usan `toISOString().slice(0, 10)`. En España (UTC+1 o +2), en las dos primeras horas del día dan la fecha anterior. Es el «Vigente desde» por defecto de una importación, y se guarda en `as_of_date`.
- **Cómo reproducirlo:** importar un fichero a las 00:30 hora peninsular: «Vigente desde» propone el día anterior.
- **Evidencia:** `return new Date().toISOString().slice(0, 10);`
- **Arreglo propuesto:** construir la fecha local (`getFullYear/getMonth/getDate`) o con `Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" })`. La prueba: con la hora del sistema simulada a las 23:30 UTC del 13-11, sale 2026-11-14.
- **Confianza:** confirmado en el código

#### PLA-10 · Operaciones: el desplegable de tipo de cada fila escribe en el universo a cada cambio, y «Retirar» una corrección no pide confirmación
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/components/AdminOperaciones.tsx:613-618` y `:411-426`; `:1374`
- **Qué pasa:** cambiar el `<select>` «Tipo de …» llama en el acto a `reclasificaOpsActivo`, que cambia el tipo en el universo del extractor, deja pendiente la reclasificación en la maestra y reinicia los pasos. En Windows, las flechas sobre un `<select>` cerrado disparan `change` en cada pulsación, así que recorrerlo con el teclado son varias escrituras. `reclasificar` no pone `busy`, así que se pueden lanzar dos a la vez. El botón «Retirar» (variante danger) borra una corrección manual, con su motivo, sin confirmar.
- **Cómo reproducirlo:** tras «Dar de alta», enfocar el tipo de una fila y pulsar dos veces la flecha abajo.
- **Evidencia:** `onChange={(event) => void reclasificar(fila.isin, event.target.value as OpsTipoActivo)}` y `<Button size="sm" variant="danger" ... onClick={() => void retirarCorreccion(campo.ruta)}>Retirar</Button>`.
- **Arreglo propuesto:** el tipo elegido se queda como borrador de la fila y se aplica con un botón «Aplicar tipo», o se confirma. Que `reclasificar` marque ocupado. Usar `useConfirm` en «Retirar», con la ruta y el motivo. Una prueba en `adminOperaciones.test.tsx`.
- **Confianza:** confirmado en el código; lo de las flechas en Windows es comportamiento conocido de los navegadores

#### PLA-11 · Planes: el menú «Planes y EPSV» no devuelve a la lista desde una ficha o una comparación
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/app/BdbActivosApp.tsx:281-297` (`navigateTo`); `src/pages/PlanesPage.tsx:70-88` (`useVista`)
- **Qué pasa:** la ficha vive en `/jubilacion/planes#plan=…`. Al pulsar «Planes y EPSV» en el menú, `navigateTo("planes")` ve que el `pathname` es el mismo y no hay `search`, así que no hace `pushState`, no cambia la dirección y la ruta queda igual. La pantalla no se monta de nuevo, `useVista` no recibe ningún evento y el asesor se queda en la ficha. Pulsar el destino actual del menú no hace nada.
- **Cómo reproducirlo:** abrir la ficha de un plan y pulsar «Planes y EPSV» en el menú lateral.
- **Evidencia:** `if (window.location.pathname !== nextPath || window.location.search) { ... pushState ... }`, sin tener en cuenta `location.hash`.
- **Arreglo propuesto:** en `navigateTo`, contar también `window.location.hash`, y que `PlanesPage` lea la vista cuando cambie la ruta. O que la pantalla escuche un evento de «volver al inicio de la sección». Una prueba en `planesPantalla.test.tsx`.
- **Confianza:** confirmado en el código; queda por ver en el navegador si algún otro mecanismo monta la pantalla de nuevo

#### PLA-12 · Sistema: tres formatos de fecha y números sin punto de los millares
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/pages/SystemStatusPage.tsx:100-108` (`dateStyle: "medium"`: «13 nov 2026, 10:30»); `src/pages/AdminPage.tsx:199-213` y `:294-297` (`fmtDayShort`: «24 jul 2026»), `:310` (`fecha {result.ran_date}`, ISO crudo); `src/components/AdminOperaciones.tsx:692` (`ficha.kid.fecha` en ISO), `:404` (huecos `g.from → g.to` en ISO en `AdminInspector.tsx:404`); números: `AdminPage.tsx:200` (`String(value)`), `AdminInspector.tsx:226`, `:259`, `AdminBackfill.tsx:184`, `AdminProgress.tsx:46`, `AdminFundQuality.tsx:46,64` (`toLocaleString("es-ES")` sin `useGrouping: "always"`)
- **Qué pasa:** la misma pantalla de Sistema escribe fechas con tres formatos distintos, y ninguno es el estándar `13/11/2026`. Las cifras de cuatro dígitos salen sin el punto de los millares («1097 activos», «7654 observaciones»), al lado de otras que sí lo llevan (`numberFormat` de SystemStatus agrupa desde cinco cifras). La propia guía (`fmtMiles`) dice que esto pasa con es-ES.
- **Cómo reproducirlo:** Sistema → BBDD maestra («Activos 1097»); Estado del sistema («13 nov 2026, 10:30»); refresco manual («fecha 2026-11-13»).
- **Evidencia:** `const displayValue = raw == null ? value : isDateValue ? fmtDayShort(raw) : raw;`, donde `raw = String(value)` para los números.
- **Arreglo propuesto:** `fmtMiles` para todo recuento, `fmtDate` / `fmtDateTime` de `core/format` para toda fecha, y quitar el `fmtDate` local de `AdminPage`. Una prueba de formato en `systemStatusPage.test.tsx`.
- **Confianza:** confirmado en el código

#### PLA-13 · Retrocesiones: tabla entera sin paginar, cuatro campos por fila, y los errores de una fila salen arriba del todo
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/components/AdminRetrocessions.tsx:643-703`, `:534-538`
- **Qué pasa:** se pintan todas las retrocesiones de golpe, con tres `input` y dos botones por fila, y cada tecla en una fila (`setDrafts`) vuelve a pintar la tabla entera. Un error de validación o de guardado de la fila 300 («Retrocesión fuera de rango 0-100.») sale en el aviso del panel superior, fuera de la vista, sin decir de qué ISIN es.
- **Cómo reproducirlo:** con cientos de retrocesiones cargadas, escribir «abc» en una fila de abajo y pulsar «Guardar».
- **Evidencia:** `filteredRecords.map((record) => { ... <input ... onChange={(event) => setDrafts(...)} />` y `if (validation) { setError(validation); return; }`.
- **Arreglo propuesto:** `TablaDeDatos` con `porPagina`, como Calidad de fondos e Inspección. El error de la fila, debajo de su campo con `aria-invalid`, y en el aviso general el ISIN delante.
- **Confianza:** confirmado en el código; el coste de rendimiento depende del número de filas, que no he medido

#### PLA-14 · Edad de jubilación con un cliente de más de 75 años: el aviso de rango no dice con qué calcula el motor
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/jubilacion/FormularioDeJubilacion.tsx:255-262`; `src/core/jubilacion/motor.ts:195`
- **Qué pasa:** el campo acota entre `Math.min(75, edad)` y 75. El motor acota entre `edad` y `max(edad, 75)`. Con un cliente de 80 años «Aún no» jubilado y una edad de jubilación de 75, el campo no avisa de nada y el motor calcula con 80. Si se escriben 80, el campo dice «Entre 75 y 75: se calcula con 75», y el motor usa 80. Además, una edad con decimales se redondea en silencio (`Math.round` en `motor.ts:191`).
- **Arreglo propuesto:** usar en el campo los mismos límites que el motor (`min = edad`, `max = Math.max(edad, 75)`), con `paso` entero y sin decimales.
- **Confianza:** confirmado en el código

#### PLA-15 · Históricos: «Cargar» en una fila borra la tabla de la vista previa y no actualiza el recuento
- **Gravedad:** baja
- **Categoría:** funcional
- **Dónde:** `src/components/AdminBackfill.tsx:112`, `:146-148`, `:160`
- **Qué pasa:** `loadOne` llama a `runBatch(true, [id])`, que hace `setResults([])` y al acabar deja solo esa fila. Se pierde el detalle de la vista previa del resto. `loadableIds` no se actualiza al escribir, y «Cargar históricos (N)» sigue contando el activo ya cargado.
- **Arreglo propuesto:** en escritura, fusionar los resultados por `asset_id` y quitar de `loadableIds` lo cargado.
- **Confianza:** confirmado en el código

#### PLA-16 · Operaciones: guardar una corrección añade el ISIN sin reiniciar los pasos, y el paso sugerido se salta la extracción
- **Gravedad:** baja
- **Categoría:** funcional
- **Dónde:** `src/components/AdminOperaciones.tsx:476-478`, `:271-272`
- **Qué pasa:** `setIsinText(...)` añade el ISIN corregido sin `resetDesde("alta")`, mientras que el `onChange` del área de texto sí lo hace. `altaFilas`, `fichas` y `canonico` siguen siendo los de los ISIN anteriores, así que `pasoSugerido` marca como primario el paso 3 o el 4 aunque el ISIN nuevo no se haya extraído. El mensaje dice lo contrario: «extraer, canónico, pasada en seco».
- **Arreglo propuesto:** llamar a `resetDesde("extraer")` al añadir el ISIN.
- **Confianza:** confirmado en el código

#### PLA-17 · Un administrador ve «Esta cuenta no tiene permisos» mientras se confirma su permiso
- **Gravedad:** baja
- **Categoría:** estado
- **Dónde:** `src/app/BdbActivosApp.tsx:429-441`
- **Qué pasa:** `useIsAdmin` empieza en `false` y no da un estado de carga, así que quien entra en `/sistema` por enlace directo lee un instante que su cuenta no tiene permisos. El comentario lo da por sabido. El texto es falso para un administrador.
- **Arreglo propuesto:** que `useIsAdmin` dé tres estados y, mientras se comprueba, enseñe `LoadingState` («Comprobando permisos…»).
- **Confianza:** confirmado en el código

#### PLA-18 · Vocabulario: la misma cosa con dos nombres, y rótulos repetidos
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/adapters/tablaDePlanes.tsx:81`, `:84`, `:86-87`; `src/core/planes/lectura.ts:123`; `src/pages/AdminPage.tsx:760` y `:774`; `src/pages/SystemStatusPage.tsx:337`; `src/components/AdminOperaciones.tsx:187`
- **Qué pasa:** en Planes, la lista dice «En el año», la ficha «En lo que va de año» y `NOMBRE_DE_LA_VENTANA` «En el año». La lista abrevia «3 años anual.». La categoría que falta se escribe a mano (`{ texto: "Falta", ausencia: "falta" }`) en vez de usar `textoDeAusencia`. En Sistema, «Último refresco» sale dos veces en la misma pestaña, y la misma copia se llama «Backup» en Estado y «Copia de la maestra» en Operaciones. «Escribir» va en botón `primary` mientras que «Archivar» y «Reclasificar», del mismo tipo de confirmación, van en `danger`.
- **Arreglo propuesto:** un solo nombre por concepto: «En lo que va de año», «3 años, anualizada», «Copia de la maestra». Quitar la segunda tarjeta «Último refresco».
- **Confianza:** confirmado en el código

#### PLA-19 · Ejes y cifras de los gráficos con formatos distintos
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/jubilacion/GraficosDeJubilacion.tsx:76` y `:127`; `src/core/planes/lectura.ts:85`; `src/components/planes/FichaDelPlan.tsx:35`
- **Qué pasa:** en Jubilación, los dos gráficos van uno al lado del otro: el de ingresos rotula «2.000 €» y el de saldos «200 mil €». El valor de la participación sale con `fmtNum`, que no agrupa las cuatro cifras («1234,56789 €»), al revés de lo que pide `fmtMiles`.
- **Arreglo propuesto:** el mismo formateador de eje para los dos gráficos y `fmtMiles(…, 5)` para el valor de la participación.
- **Confianza:** confirmado en el código

#### PLA-20 · Accesibilidad menor: barra de progreso sin nombre, cifra principal no anunciada, orden sin `aria-sort`
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/components/AdminProgress.tsx:49-55`; `src/components/jubilacion/ResultadoDeJubilacion.tsx:135`, `:147-151`, y `src/pages/JubilacionPage.tsx:196-199`; `src/components/AdminInspector.tsx:236-241`
- **Qué pasa:** `role="progressbar"` no lleva `aria-label` ni `aria-valuetext`. En Jubilación, la línea «Simulación · …» y cada aviso son `role="status"` y se anuncian al cambiar, pero la cifra «Ingreso neto … al mes», que es la respuesta, no. El botón «Hasta ↕» de Inspección ordena sin `aria-sort` en el `th`, y las flechas no tienen texto.
- **Arreglo propuesto:** `aria-label={titles[phase]}`. Anunciar con `aria-live="polite"` la cifra y su apunte, y no cada aviso. `aria-sort` en la cabecera.
- **Confianza:** confirmado en el código

#### PLA-21 · Las líneas que explican la cifra se redondean una a una y pueden no sumar
- **Gravedad:** baja
- **Categoría:** cálculo
- **Dónde:** `src/components/jubilacion/ResultadoDeJubilacion.tsx:102`, `:157-162`
- **Qué pasa:** pensión, ahorros y previsión se redondean al euro por separado (`alMes`), y también el bruto y el neto. Con «2.333,4 + 1.000,4 = 3.333,8», la pantalla enseña 2.333 + 1.000 = 3.334. Es una diferencia de 1 € al mes, delante de un cliente, en el bloque que se llama «las líneas que la explican».
- **Arreglo propuesto:** redondear las partidas y sacar el total de la suma de lo redondeado (o el neto como resto), o avisar de que pueden diferir por redondeo.
- **Confianza:** confirmado en el código

#### PLA-22 · Código que sobra
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/pages/SystemStatusPage.tsx:373-402`; `src/pages/AdminPage.tsx:75-197`; `src/components/SaludYControl.tsx`
- **Qué pasa:** `SystemStatusPage` (la página entera) ya no se monta en ninguna ruta: solo se usa `SystemStatusContent`. Lo usan las pruebas. «Referencia técnica» son cinco fichas de texto fijo (parser, cola de revisión…) que describen cosas que la pantalla no hace. `SaludYControl` es de Análisis, no de Sistema.
- **Arreglo propuesto:** retirar la página o probar `SystemStatusContent` directamente. Pasar «Referencia técnica» a la documentación.
- **Confianza:** confirmado en el código

#### PLA-23 · Estado del sistema: la antigüedad se mide contra la hora de abrir la pestaña
- **Gravedad:** baja
- **Categoría:** estado
- **Dónde:** `src/pages/AdminPage.tsx:850-852`
- **Qué pasa:** `referenceNow` se fija una vez con `useMemo(() => new Date(), [])`. «Actualizar» recarga el semáforo, pero «Antigüedad: N días» se sigue calculando contra el momento en que se abrió la pestaña.
- **Arreglo propuesto:** tomar `now` al recibir cada respuesta.
- **Confianza:** confirmado en el código

#### PLA-24 · Planes: «Comparar» desactivado sin explicar por qué, y una dirección con un plan que no está se recorta en silencio
- **Gravedad:** baja
- **Categoría:** estado
- **Dónde:** `src/adapters/tablaDePlanes.tsx:104`; `src/components/planes/FichaDelPlan.tsx:136`; `src/pages/PlanesPage.tsx:163-167`
- **Qué pasa:** con cuatro planes marcados, el botón «Comparar» de las demás filas (y «Añadir a la comparación» de la ficha) queda desactivado sin `title` ni texto. Con `#comparar=A,B,C`, si A no está en el catálogo se compara B con C sin decir que falta uno. «Informe para el cliente» de Jubilación también se desactiva sin explicar qué falta.
- **Arreglo propuesto:** un `title` o una nota («Ya hay 4: quita uno»), y un aviso cuando se descarta algún identificador de la dirección.
- **Confianza:** confirmado en el código

#### PLA · Lo que está bien
- **Jubilación:** pantalla y PDF sacan sus cuentas de una sola lectura (`lectura.ts`). El ejemplo se rotula mientras queda algo de él. Lo que falta se dice («Falta la edad del cliente»), no se pinta un cero. Cada supuesto se avisa, como el coste igual al valor. Hay aviso de normativa vencida. Lo escrito sobrevive a navegar, y está probado. El diálogo del informe se carga a petición y no se cierra mientras genera. El color no opina en los gráficos.
- **Planes:** la diferencia entre «No aplica» y «Falta el dato» sale de la fecha de inicio. Hay avisos de valor parado y de rentabilidades de otra fecha. La pantalla no calcula salvo la base 100, y lo dice. La dirección se puede compartir, y atrás vuelve a la lista. Las lecturas se guardan en caché de sesión y se reintentan.
- **Sistema:** las escrituras siguen siempre el patrón «pasada en seco → teclear el recuento → el servicio repite la comprobación». Los bucles por lotes se cortan al desmontar, y está probado. Las respuestas viejas se descartan por identificador de petición. «Deshacer última importación» existe.

#### PLA · Lo que no se ha podido mirar
- Nada en el navegador: el comportamiento de `type="number"` con coma (PLA-06), la adaptación a 768-1024 px de las nueve pestañas de Sistema y de la tabla «Año a año» de nueve columnas, el contraste del color de aviso de `jubilacion-frase--agota` y el foco atrapado de los diálogos.
- La corrección de las reglas fiscales y de pensiones (fuera de alcance), y `charts/oaa` (`OaaLineChart`, `TablaComparativa`), que es común a otras secciones.
- `EstadoDelCatalogoPanel` y `SaludDelCatalogoPage`, que se montan bajo Datos pero no venían en la lista.
- El PDF de jubilación solo lo he leído donde comparte código con la pantalla (PLA-01 y PLA-03).

### MAR · Marco de la aplicación, piezas comunes y hojas de estilo

#### MAR-01 · La lista de carteras del Gestor no se puede abrir con el teclado
- **Gravedad:** alta
- **Categoría:** accesibilidad
- **Dónde:** `src/components/tabla/TablaDeDatos.tsx:292-305` (la pieza); `src/gestor/ui/GestorDeCarterasPage.tsx:90-96` y `:148` (el caso roto)
- **Qué pasa:** `TablaDeDatos` hace «abrible» una fila poniendo `onClick` en el `<tr>`, que no es enfocable ni responde a Intro. Solo funciona con teclado si alguna celda trae su propio enlace o botón. En «Carteras guardadas en tu equipo» del Gestor ninguna columna lo trae, así que quien va con teclado (o con lector de pantalla) ve la lista y no puede abrir ninguna cartera: el flujo principal de esa pantalla.
- **Cómo reproducirlo:** Carteras → Gestor de carteras, con al menos una cartera en la carpeta. Tabular por la tabla: el foco entra en el marco desplazable y sale sin pasar por ninguna fila; Intro no abre nada.
- **Evidencia:**
  ```tsx
  // TablaDeDatos.tsx:292
  <tr className={…"tabla__fila--abrible"…} onClick={alAbrir ? () => alAbrir(f) : undefined}>
  // GestorDeCarterasPage.tsx:91 — la celda de nombre es texto, sin enlace ni nodo
  { id: "nombre", titulo: "Cartera", encabezaFila: true, celda: (fila) => ({ texto: fila.nombre, … }) },
  ```
  Las otras cuatro tablas con `alAbrir` sí tienen salida por teclado (Buscador y Planes con enlace en el nombre, Carteras guardadas con botón, Movimientos con botón de editar).
- **Arreglo propuesto:** que la pieza lo garantice: si hay `alAbrir` y la celda que `encabezaFila` no trae `enlaceAFicha` ni `nodo`, pintarla como `<button className="enlace-a-ficha">` que llama a `alAbrir(fila)`. Prueba en `tests/`: montar `TablaDeDatos` con `alAbrir` y columnas solo de texto, comprobar que cada fila tiene un elemento enfocable y que Intro sobre él llama a `alAbrir`.
- **Confianza:** confirmado en el código

#### MAR-02 · Un error en cualquier pantalla tumba la aplicación entera, menú incluido
- **Gravedad:** alta
- **Categoría:** funcional
- **Dónde:** `src/main.tsx:18-56` (único `ErrorBoundary`); `src/app/BdbActivosApp.tsx:43-73` (13 `lazy`) y `:754-757` (`Suspense` sin límite de error)
- **Qué pasa:** el único límite de error envuelve `AuthGate` y `App`. Si una pantalla lanza al pintar, o si un trozo diferido no se descarga (lo típico tras publicar una versión nueva con la pestaña abierta: los nombres con hash cambian), React desmonta todo y queda una tarjeta «Algo no se pudo cargar · Recargar», sin menú, sin barra y sin decir qué pantalla falló. El límite tampoco se reinicia al navegar: no hay forma de ir a otra pantalla sin recargar. No hay ningún otro `ErrorBoundary` en `src/` ni tratamiento de `vite:preloadError`.
- **Cómo reproducirlo:** con la app abierta, publicar una versión nueva y pulsar en el menú una pantalla aún no visitada (p. ej. Jubilación); o forzar un `throw` en el render de cualquier página.
- **Evidencia:**
  ```tsx
  // main.tsx:50
  <StrictMode><ErrorBoundary><AuthGate><App /></AuthGate></ErrorBoundary></StrictMode>
  // BdbActivosApp.tsx:756
  <Suspense fallback={esFicha ? FICHA_FALLBACK : PAGE_FALLBACK}>{renderRoute()}</Suspense>
  ```
- **Arreglo propuesto:** un límite de error por pantalla dentro de `<main>`, con `key={route.id + assetParam}` para que se reinicie al navegar, que pinte un `PageHeader` con el nombre de la pantalla, «Esta pantalla no se ha podido abrir», «Reintentar» y «Volver al Buscador»; y, para el fallo de descarga de un trozo, escuchar `vite:preloadError` y ofrecer recargar con aviso de que la cartera activa se conserva. Prueba: montar `BdbActivosApp` con una página simulada que lanza y comprobar que el menú sigue en el documento y que navegar a otra entrada la pinta.
- **Confianza:** confirmado en el código

#### MAR-03 · El foco se escapa de los diálogos con Mayús+Tab, y el fondo no queda inerte
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/core/useAccessibleDialog.ts:95-111`; `src/components/ui/ModalDialog.tsx:33-40`
- **Qué pasa:** el contenedor del diálogo tiene `tabIndex={-1}`, así que un clic en una zona sin controles (un párrafo) le da el foco al propio `<section>`. Desde ahí, Mayús+Tab no lo atrapa: la trampa solo actúa si el foco está en el primer o el último control. Como el diálogo va en un portal al final de `<body>`, el foco salta al último control de la aplicación, detrás del velo. Además el resto de la página no se marca `inert`: un lector en modo lectura puede recorrer el fondo.
- **Cómo reproducirlo:** abrir «Seguridad de la cuenta», pulsar sobre el texto «Cambio mediante enlace seguro», pulsar Mayús+Tab: el foco queda en un control de la página de debajo.
- **Evidencia:**
  ```ts
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { … }
  else if (!event.shiftKey && document.activeElement === last) { … }
  // con activeElement === dialog no se cumple ninguna de las dos
  ```
- **Arreglo propuesto:** tratar `activeElement === dialog` (o fuera del diálogo) como «antes del primero»: con Mayús ir al último, sin Mayús al primero; y poner `inert` en `#root` mientras la pila de diálogos no esté vacía. Prueba en `tests/` con Testing Library: enfocar el `<section>` y simular Mayús+Tab.
- **Confianza:** confirmado en el código

#### MAR-04 · «Restablecer contraseña» con un correo mal escrito dice que es un problema de configuración
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/auth/AuthGate.tsx:543-564` y `src/auth/authSecurity.ts:31-37`
- **Qué pasa:** el botón de restablecer es `type="button"`, así que no pasa por la validación del formulario. Con «oscar@empresa» o «oscar empresa.com», Firebase responde `auth/invalid-email`, que `authErrorMessage` no conoce, y el asesor lee «No se pudo iniciar sesión: auth/invalid-email. No es la contraseña, es la configuración del acceso.» Tres errores en una frase: no estaba iniciando sesión, sí es lo que ha escrito, y no es la configuración.
- **Cómo reproducirlo:** pantalla de acceso, escribir «abc» en el correo, pulsar «Restablecer contraseña».
- **Evidencia:**
  ```ts
  return code ? `No se pudo iniciar sesión: ${code}. No es la contraseña, es la configuración del acceso.` : …
  ```
- **Arreglo propuesto:** mapear `invalid-email` y `missing-email` («Revisa el correo: no tiene forma de dirección») y dar a `requestPasswordReset` su propio traductor de errores, sin «iniciar sesión». Prueba unitaria de `authErrorMessage` con esos dos códigos.
- **Confianza:** confirmado en el código

#### MAR-05 · El aviso de cifra no válida del campo de importe solo lo oye un lector de pantalla
- **Gravedad:** media
- **Categoría:** estado
- **Dónde:** `src/components/ui/EuroAmountInput.tsx:137-172`; `src/styles/modules.css:4548`
- **Qué pasa:** cuando el asesor escribe «25k» o «-500», el campo se queda con el texto, marca el borde y no confirma, pero la frase que explica por qué («Cifra no válida: escríbela con números, por ejemplo 25.000») va en un `span` `ui-visually-hidden` y en un `title`, que en tableta no existe. El importe anterior sigue vigente sin que nada en pantalla lo diga. Se usa en 6 ficheros (capital de Diseño, importes de posiciones, Jubilación, comparador patrimonial, comisión).
- **Cómo reproducirlo:** Diseño de cartera → capital → escribir «25k» y salir del campo.
- **Evidencia:**
  ```tsx
  {invalid ? (<span id={noteId} className="ui-visually-hidden">{notaDeError}</span>) : null}
  ```
- **Arreglo propuesto:** pintar la nota visible bajo el campo (`field__error`, con `role="alert"` la primera vez) o dejar que quien monta el campo la coloque, recibiendo `invalid` por una prop de vuelta. Prueba: montar el campo, teclear «25k», salir, y comprobar que el texto es visible (no `sr-only`).
- **Confianza:** confirmado en el código

#### MAR-06 · El signo de una cifra tiene color en el Gestor y en ninguna otra pantalla, y su rojo es casi la terracota del aviso
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/styles/tokens.css:118-123` (`--cifra-sube`, `--cifra-baja`), `src/styles/gestor.css:10-32`, `src/styles/gestor-analisis.css:43-53` frente a `src/styles/base.css:237-251` (`.pos/.neg` en tinta) y `src/components/ui/KpiStrip.tsx:3-13`
- **Qué pasa:** el 13-11 el Gestor empezó a pintar las cifras positivas en verde y las negativas en rojo (decisión de Óscar, documentada). El resto de la aplicación sigue la regla contraria: «una cifra financiera no es buena ni mala» y `.pos/.neg` van en tinta. Un asesor ve la misma rentabilidad en rojo en el Gestor y en tinta en Análisis o en la ficha. Y además el rojo de pérdida (`#b3261e`) y la terracota que significa «falta el dato / aviso» (`#8c3a2b`) quedan a **1,17:1** de luminancia entre sí: en el Gestor, «Falta el dato» y «−3,2 %» se distinguen solo por el matiz.
- **Cómo reproducirlo:** comparar una rentabilidad negativa en Gestor → Análisis con la misma cifra en Carteras → Análisis o en la ficha.
- **Evidencia:**
  ```css
  /* base.css:246 */ .u-pos, .pos, .u-neg, .neg { color: var(--ink); }
  /* tokens.css:122 */ --cifra-sube: #1b6b4a;  --cifra-baja: #b3261e;
  ```
- **Arreglo propuesto:** decisión de producto para Óscar: o el signo con color es la regla de toda la pantalla (y entonces `.pos/.neg` pasan a esos tokens), o es solo del Gestor y se dice en la dirección. En los dos casos, alejar el rojo de pérdida de la terracota (otro tono, o el signo con flecha) para que «pérdida» y «falta el dato» no se confundan. Prueba: añadir el par a `tests/contrastePaleta.test.ts` con un mínimo de separación entre `--cifra-baja` y `--negative`.
- **Confianza:** confirmado en el código

#### MAR-07 · Texto de tinta 3 sobre una fila seleccionada no llega a 4,5:1
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/styles/components.css:958-961` (`tbody tr.is-selected` en `--surface-selected` = `--brand-10`), `src/styles/tabla.css:121-127` (`.tabla__apunte` en `--ficha-tinta-3`), `src/pages/PlanesPage.tsx:284`, `src/components/AssetComparisonCatalogModal.tsx:196`
- **Qué pasa:** `#6f6f68` sobre `#e6e8f0` da **4,14:1**. En las dos tablas que marcan filas elegidas (Planes y el catálogo del Comparador) el apunte bajo el nombre —la gestora, el ISIN— y los títulos fijos quedan por debajo del mínimo justo en las filas que el asesor acaba de elegir. `tests/contrastePaleta.test.ts` mide la tinta 3 sobre papel, realce y banda, no sobre la selección.
- **Cómo reproducirlo:** Planes y EPSV, marcar dos planes para comparar: la gestora de esas filas.
- **Evidencia:** `--ink-tertiary: #6f6f68` (tokens.css:148); `--brand-10: #e6e8f0` (tokens.css:56). Otros pares medidos: tinta 3 sobre papel 4,93; sobre `--steel-10` 4,67; sobre `--steel-15` 4,55; sobre `--negative-soft` 4,37.
- **Arreglo propuesto:** en filas seleccionadas subir el apunte a `--ink-secondary` (6,04:1 sobre `--brand-10`), y añadir el par a la prueba de contraste.
- **Confianza:** confirmado en el código (la combinación); el aspecto, sin mirar en navegador

#### MAR-08 · En Firefox el deslizador de rango no enseña el foco
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/styles/components.css:1805-1811`
- **Qué pasa:** se quita el anillo del `input[type=range]` y se pone en el pulgar, pero solo con el seudoelemento de WebKit. En Firefox el control se queda sin ningún indicador de foco.
- **Cómo reproducirlo:** en Firefox, tabular hasta un deslizador (optimizador, simulaciones).
- **Evidencia:**
  ```css
  input[type="range"]:focus-visible { box-shadow: none; }
  input[type="range"]:focus-visible::-webkit-slider-thumb { box-shadow: var(--focus-ring); }
  /* falta ::-moz-range-thumb */
  ```
- **Arreglo propuesto:** añadir `input[type="range"]:focus-visible::-moz-range-thumb { box-shadow: var(--focus-ring); }`.
- **Confianza:** confirmado en el código

#### MAR-09 · El menú lateral son botones, no enlaces: no se abre una pantalla en otra pestaña ni se copia su dirección
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/app/BdbActivosApp.tsx:640-658`; `src/app/BdbActivosApp.tsx:144-162` (chip de la cartera)
- **Qué pasa:** cada entrada del menú es `<button onClick={navigateTo}>`. Ctrl+clic, clic central y «Copiar dirección del enlace» no existen, y el lector anuncia «botón», no «enlace». La aplicación ya tiene direcciones propias para todo (`appRoutes.ts`) y la ficha sí usa enlaces de verdad (`EnlaceAFicha`), y el asesor trabaja con varias pestañas (decisión 29 avisa de ello): abrir el Comparador en otra pestaña obliga a escribir la dirección.
- **Cómo reproducirlo:** Ctrl+clic en «Comparador».
- **Evidencia:**
  ```tsx
  <button … className={`rail-link…`} aria-current={…} onClick={item.ready ? () => navigateTo(item.id) : undefined}>
  ```
- **Arreglo propuesto:** `<a href={pathForRoute(item.id)}>` con el mismo patrón que `EnlaceAFicha` (clic normal → `navigateTo`, modificadores → navegador). Prueba: el rail tiene `role="link"` con `href` por entrada.
- **Confianza:** confirmado en el código

#### MAR-10 · Pistas y errores de campo sin enlazar al campo; falta la pieza «Campo»
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** recuento en `src/**/*.tsx`: `className="field"` 87 veces en 23 ficheros, `field__hint` 31, `field__error` 14, `aria-describedby` 10 en toda la aplicación. Ejemplos: `src/components/jubilacion/FormularioDeJubilacion.tsx:27`, `src/pages/AdminPage.tsx:646` y `:673`, `src/gestor/ui/dialogos/FormularioDeMovimiento.tsx:302`
- **Qué pasa:** cada pantalla compone a mano `label.field > span.field__label + input + p.field__hint/field__error`. Las pistas y los errores no se asocian al control (no hay `aria-describedby` en la mayoría) y varios errores no llevan `role="alert"`: quien usa lector entra en el campo y no oye ni la pista ni por qué está mal.
- **Cómo reproducirlo:** Sistema → alta de activo con un ISIN mal formado: el lector no anuncia «Formato esperado…».
- **Evidencia:**
  ```tsx
  // FormularioDeJubilacion.tsx:27
  {error ? <span className="field__error">{error}</span> : null}
  ```
- **Arreglo propuesto:** pieza `Campo` (`label`, `pista`, `error`, `children`) que genere los id con `useId`, ponga `aria-describedby`/`aria-invalid` al control hijo y `role="alert"` al error. Migrar al rehacer cada pantalla. Prueba: la pieza asocia pista y error.
- **Confianza:** confirmado en el código (recuento); casos concretos revisados: los cuatro citados

#### MAR-11 · Sin modo de contraste forzado: el foco es solo una sombra
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `src/styles/base.css:160-168`; `src/styles/tokens.css:302-305`; ningún `@media (forced-colors)` en `src/`
- **Qué pasa:** todo el sistema de foco quita el `outline` y dibuja el anillo con `box-shadow`. En Windows con «Contraste alto» (colores forzados), el navegador elimina las sombras: no queda ningún indicador de foco en ningún control. Los asesores usan Windows.
- **Cómo reproducirlo:** Windows → Configuración → Accesibilidad → Temas de contraste; tabular por la app.
- **Evidencia:**
  ```css
  :focus { outline: none; }
  :focus-visible { outline: none; box-shadow: var(--focus-ring); … }
  ```
- **Arreglo propuesto:** dejar `outline: 2px solid transparent` (invisible normalmente, visible en colores forzados) en vez de `outline: none`, y un bloque `@media (forced-colors: active)` mínimo para el rail activo y los distintivos.
- **Confianza:** sospecha (comportamiento del navegador conocido; falta mirarlo en un Windows con contraste alto)

#### MAR-12 · Veintiún puntos de corte distintos, con pares a 1 px y uno que contradice el ancho real del contenido
- **Gravedad:** media
- **Categoría:** adaptación
- **Dónde:** `src/styles/*.css` (lista abajo); el cruce en `layout.css:779` frente a `modules.css:2574`
- **Qué pasa:** hay 21 anchos de `@media` distintos: 767, 860, 899.98, 900, 999.98, 1023, 1024, 1099.98, 1179, 1180, 1181, 1240, 1241, 1279, 1279.98, 1280, 1380, 1439.98, 1440, 1800, 2200. A 1.024 px (uno de los seis anchos de trabajo) el marco pasa a tableta (`max-width: 1024px`) pero el calendario económico no (`max-width: 1023px`). Y como el menú mide 88 px en tableta y 208 px entre 1.025 y 1.240, **el contenido es más ancho a 1.024 (≈936 px) que a 1.100 (≈892 px)**: cualquier regla de pantalla que mida la ventana y no el contenido se dispara al revés de lo que pretende.
- **Cómo reproducirlo:** comparar Mercado → Calendario a 1.024 y a 1.023 px; comparar cualquier rejilla a 1.024 y a 1.100.
- **Evidencia:**
  ```css
  /* layout.css:779 */ @media (max-width: 1024px) { .app-shell { grid-template-columns: var(--rail-w-tablet) … } }
  /* modules.css:2574 */ @media (max-width: 1023px) { .economic-event-row { … } }
  /* tokens.css:447 */ @media (max-width: 1240px) { :root { --rail-w: var(--rail-w-compact); } }
  ```
- **Arreglo propuesto:** cuatro cortes con nombre (tableta ≤1024, portátil ≤1279.98, escritorio ≥1440, grande ≥1800/2200), escritos siempre igual; y para las pantallas, `@container` sobre `.app-content` en lugar de `@media` de ventana. Una prueba que lea las hojas y falle con un corte fuera de la lista (como el censo de CSS).
- **Confianza:** confirmado en el código (los cortes); el efecto visual a 1.024, sospecha

#### MAR-13 · Tres sistemas de tabla con cabeceras distintas, y el Gestor estrena un cuarto
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/styles/components.css:907-1064` (tabla global: cabecera 12 px, peso 500, tinta 2, pegajosa); `src/styles/tabla.css:24-58` (`.tabla`: cabecera 11 px, peso 600, tinta 3); 45 `<table>` a mano en 28 ficheros con clases propias (`.costs-table` 14 reglas, `.portfolio-table` 12, `.gestor-tabla` 12, `.retro-table` 10, `.report-table` 7…)
- **Qué pasa:** el mismo papel —una tabla de cifras— se pinta con tres cabeceras, tres rellenos y dos tamaños de cifra según la pantalla. Una tabla a mano no hereda lo que la pieza resuelve (orden, ausencias, `aria-sort`, marco enfocable, totales). El Gestor, hecho el 13-11, ya escribe `.gestor-tabla` en lugar de usar `TablaDeDatos` en 9 ficheros (`BloqueMeses`, `TablaComparada`, `VistaCuentas`…).
- **Cómo reproducirlo:** comparar la cabecera de la tabla de Posiciones, la de costes y la del Buscador.
- **Evidencia:** `.tabla th { font-size: var(--fs-micro); font-weight: 600; color: var(--ficha-tinta-3) }` frente a `thead th { font-size: var(--fs-xs); font-weight: 500; color: var(--ink-secondary) }`.
- **Arreglo propuesto:** una sola tabla: `TablaDeDatos` con un modo «simple» (sin orden ni marco) para las cortas, y retirar la tabla global de `components.css` cuando quede sin usuarios.
- **Confianza:** confirmado en el código

#### MAR-14 · Pestañas usadas como filtro, con `aria-controls` a paneles que no existen
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/components/ui/SegmentedTabs.tsx:62`; usos `src/pages/BuscadorNuevoPage.tsx:325` (`buscador-tipo`), `src/pages/PlanesPage.tsx:198` (`planes-tipo`), `src/components/PositionsWorkbench.tsx:881` (`posiciones-modo`)
- **Qué pasa:** la pieza siempre escribe `aria-controls="<prefijo>-panel-<id>"`. En esos tres usos no hay ningún elemento con ese id (sí lo hay en los otros ocho), y el control no cambia de panel sino que filtra una lista: el lector anuncia «pestaña» y un control huérfano.
- **Evidencia:** `aria-controls={`${idPrefix}-panel-${tab.id}`}`; búsqueda de `buscador-tipo-panel`, `planes-tipo-panel`, `posiciones-modo-panel`: sin resultados.
- **Arreglo propuesto:** para filtrar, `SegmentedControl` (o un `radiogroup`); en `SegmentedTabs`, hacer `aria-controls` opcional.
- **Confianza:** confirmado en el código

#### MAR-15 · `SegmentedControl` mezcla dos patrones, y la opción elegida apenas se distingue
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/components/ui/SegmentedControl.tsx:54-71`; `src/styles/components.css:615-620`
- **Qué pasa:** es un `role="group"` de botones `aria-pressed` (cada uno es una parada del tabulador), pero las flechas cambian el valor como en un `radiogroup`. El lector oye «conmutador pulsado» y no «1 de 3». La opción activa se marca con negrita y un fondo de papel sobre `--steel-10`: **1,06:1**.
- **Arreglo propuesto:** `role="radiogroup"` + `role="radio"` + `aria-checked` + `tabIndex` móvil; marcar la activa también con borde o filete de 2 px en `--accent`.
- **Confianza:** confirmado en el código

#### MAR-16 · `MenuButton`: Tab no cierra, sin Inicio/Fin, la flecha no abre, y su Escape vive en el documento
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/components/ui/MenuButton.tsx:53-89`
- **Qué pasa:** con el menú abierto, Tab saca el foco y deja la lista abierta; Inicio/Fin no hacen nada; Flecha abajo sobre el disparador no abre. El Escape se escucha en `document`: dentro de un diálogo, el diálogo (registrado antes) se cerraría a la vez. Hoy se usa en 2 sitios y ninguno está en un diálogo; en `VistaDeCartera.tsx:133` se llama solo «Más».
- **Arreglo propuesto:** cerrar en `focusout` fuera del menú, añadir Inicio/Fin y apertura con flechas, manejar Escape en el `onKeyDown` del propio menú.
- **Confianza:** confirmado en el código

#### MAR-17 · Tamaños de letra por debajo de 12 px, y el token dice que no los hay
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/styles/tokens.css:200-203`; `src/styles/tabla.css:653`; usos: `--fs-micro` (11 px) 54 veces, `--fs-apunte` (11,5) 9, `--fs-plano-eje` (10) 1, `10.5px` 1
- **Qué pasa:** el comentario dice «Nada por debajo de 11px» y la línea siguiente define 10 px. Van a 11 px: encabezados de `.tabla`, distintivos (`.badge`), notas de KPI, el nombre bajo el icono del menú en tableta, el ISIN de `.cell-entity__code` y todo lo impreso con Ctrl+P (`impresion.css:121`). La dirección fija 11,5 para el encabezado de tabla, y la tabla usa 11.
- **Arreglo propuesto:** suelo de 11,5 px en pantalla y 12 px en tableta; corregir el comentario.
- **Confianza:** confirmado en el código

#### MAR-18 · `--ficha-*` duplica diez tokens existentes; dos dialectos de hoja
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/styles/tokens.css:392-429` frente a `:26-66` y `:106`
- **Qué pasa:** los diez `--ficha-*` son copias literales: `--ficha-papel` = `--steel-00`, `--ficha-tinta` = `--steel-90`, `-2` = `--steel-60`, `-3` = `--ink-tertiary`, `--ficha-filete` = `--steel-20`, `-fuerte` = `--steel-30`, `--ficha-marca` = `--brand-60`, `--ficha-baja` = `--negative`, `--ficha-realce` = `--steel-10`, `--ficha-banda` = `--steel-15`. Se usan 159 veces. Su comentario («de momento SOLO los usa la ficha: el resto sigue en Prusia sobre blanco») es falso desde el 03-11. `ficha.css` y `tabla.css` escriben además espacios en px (`gap: 16px`, `padding: 8px 12px 6px 0`) donde existen `--s-6`/`--s-4`: un cambio de un rol no llega a la mitad de la aplicación.
- **Arreglo propuesto:** declarar los `--ficha-*` como `var(--…)` del rol y sustituirlos por el rol al rehacer cada hoja.
- **Confianza:** confirmado en el código

#### MAR-19 · Valores sueltos: px, tamaños fuera de escala, `z-index` y `!important`
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** todas las hojas salvo `tokens.css`
- **Qué pasa (cifras):**
  - **Colores en crudo en las hojas: 0** salvo el chevron del `select`, que lleva `%2364727c` (el gris azulado retirado) dentro del SVG (`components.css:693`). En TSX: el QR de `AccountSecurityDialog.tsx:130` (`#20272E`) y `index.html:8` (`theme-color #0F2D4A`, el Prusia retirado; el menú es `#222c4a`).
  - **Valores en px fuera de los tokens: 653**, de ellos **421** que no son filetes de 1-2 px: `modules.css` 289 en total, `components.css` 122, `tabla.css` 61, `ficha.css` 60, `layout.css` 40, `charts.css` 31. Más repetidos: 8 px (20), 7 px (17), 16 px (15), 10 px (15), 18 px (13), 12 px (13).
  - **Tamaños de letra en crudo: 3** fuera de escala: `ficha.css:267` 15,5 px, `ficha.css:274` **25 px** (la cifra destacada de la dirección es 26, `--fs-5xl`), `tabla.css:653` 10,5 px; y `charts.css:402` 12 px.
  - **`z-index` numéricos: 5** (`charts.css:24`, `modules.css:2409`, `:5500`, `tabla.css:413`, `:450`), además de la escala `--z-*`.
  - **`!important`: 13**: 5 de `prefers-reduced-motion` y 1 de `.sr-only` (legítimos), 6 en `impresion.css` contra los estilos en línea de Recharts (justificados), 2 en `charts.css:403-404` (leyenda de Recharts).
  - **`outline: none`: 6**, todos con sustituto (anillo por sombra o `:focus-within` del contenedor), salvo lo dicho en MAR-11.
  - Animaciones sin uso: `@keyframes oaa-shimmer` y `oaa-pulse` (`base.css:268-296`) no las usa ninguna regla.
- **Arreglo propuesto:** el censo `scripts/deadCssD3.mjs` ya es una puerta: ampliarlo a px sueltos en propiedades de espaciado y a `font-size` fuera de `--fs-*`, con una lista de excepciones declaradas.
- **Confianza:** confirmado en el código

#### MAR-20 · La paleta de `theme.ts` tiene comentarios de otra paleta, y una secuencia quita el color equivocado
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/core/theme.ts:91-114`
- **Qué pasa:** `CATEGORICAL_SERIES` describe sus colores como «Prusia, acero, teal, gris, ciruela, terracota» y la paleta real es índigo, rosa, ocre, carmesí, verde, cian. `CATEGORICAL_SERIES_BESIDE_UNCLASSIFIED` quita `CHART_PALETTE[4]` «porque es gris y junto al gris de sin clasificar se confunde»: hoy esa posición es el **carmesí**. Un gráfico con «Sin clasificar» pierde un color distinguible por una razón que ya no existe.
- **Arreglo propuesto:** rehacer los comentarios y decidir si la secuencia sigue haciendo falta (con la paleta nueva el gris solo es la 8).
- **Confianza:** confirmado en el código

#### MAR-21 · Avisos sin pieza: `.notice` escrito a mano 167 veces y 36 clases de aviso
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/styles/components.css:1161-1214`; 167 usos de `className="notice…"` en 36 ficheros; clases de aviso en las hojas: `.notice`, `.benchmark-notice`, `.frontier-soft-notice`, `.portfolio-notice`, `.portfolio-import-notice`, `.optimization-review-notice`, `.cmp-catalog-warning`, `.positions-warning`, `.portfolio-analysis-warning`, `.gestor-aviso`, `.gestor-nota--aviso`, `.f5-risk-alert`, `.auth-error`, `.async-error-banner`… (36)
- **Qué pasa:** el aviso es solo una clase. Cada pantalla decide si lleva rol (`role="alert"`/`status` aparece 137 veces, repartido sin regla), título, acciones o icono; y `AsyncErrorBanner` es otro aviso con otra forma y un `<button>` nativo propio (`AsyncErrorBanner.tsx:31`).
- **Arreglo propuesto:** pieza `Aviso` (`tono`, `titulo`, `acciones`, `vivo`) que fije el rol según si es dinámico; `AsyncErrorBanner` pasa a ser un `Aviso tono="fallo"` con `Button`.
- **Confianza:** confirmado en el código

#### MAR-22 · La guarda de las pantallas de datos no espera al permiso
- **Gravedad:** baja
- **Categoría:** estado
- **Dónde:** `src/app/BdbActivosApp.tsx:429-449`; `src/auth/useIsAdmin.ts:31-75`
- **Qué pasa:** el comentario dice que `useIsAdmin` no expone estado de carga, pero `useAdminClaim()` ya lo hace (`resolved`). Un administrador que abre `/sistema` por enlace ve «Sección reservada al administrador · Esta cuenta no tiene permisos» hasta que llega el permiso, y la sección «Datos» del menú aparece tarde.
- **Arreglo propuesto:** usar `useAdminClaim()` y pintar `LoadingState` mientras `!resolved`.
- **Confianza:** confirmado en el código

#### MAR-23 · Semántica del marco: `aria-current` en la ficha, puntos de referencia y secciones del menú
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/app/BdbActivosApp.tsx:400`, `:618-639`, `:694-706`
- **Qué pasa:** con una ficha abierta, «Buscador» lleva `aria-current="page"` (la página es la ficha; `"location"` o nada sería lo cierto). El nombre «Navegación principal» está en el `<aside>` (punto «complementario»), y el `<nav>` de dentro no tiene nombre. Los rótulos de sección («Activos», «Carteras») son `div` sueltos: el lector no agrupa las entradas. La miga está en un `<nav aria-label="Ubicación">` sin un solo enlace.
- **Arreglo propuesto:** nombre en el `<nav>`; cada sección como `<ul aria-labelledby>`; la miga como `<p>`; `aria-current` solo en la pantalla exacta.
- **Confianza:** confirmado en el código

#### MAR-24 · Avisos de la barra que pueden no anunciarse
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/app/BdbActivosApp.tsx:713-719`; `src/auth/AuthGate.tsx:206`, `:336`
- **Qué pasa:** «Esta pestaña tiene su propia cartera activa» y «Añadido a la cartera de esta pestaña…» van en un `role="status"` que se monta a la vez que su texto; muchos lectores no anuncian una región viva que nace llena. El cambio de texto (sí anunciado) solo ocurre si la región ya estaba.
- **Arreglo propuesto:** dejar la región montada y vacía, y cambiar solo su texto.
- **Confianza:** sospecha (depende del lector; mirar con NVDA)

#### MAR-25 · `TablaComparativa`: marco no enfocable, esquina vacía y aviso que se desplaza con la tabla
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/components/tabla/TablaComparativa.tsx:92-158`
- **Qué pasa:** a diferencia de `TablaDeDatos`, su marco desplazable no lleva `tabIndex` ni nombre; a 768 px, con cinco columnas de 140 px mínimo, desborda, y solo los enlaces de la cabecera dan algo que enfocar. La celda de esquina es `<th>&nbsp;</th>` sin texto. Las notas van dentro del marco y se van de lado con las columnas; su `key` es el propio texto (dos notas iguales chocarían).
- **Arreglo propuesto:** el mismo marco que `TablaDeDatos` (`role="group"`, `tabIndex={0}`, nombre), esquina con `<span className="sr-only">Dato</span>`, notas fuera del marco.
- **Confianza:** confirmado en el código

#### MAR-26 · `cifrasEnPantalla` y `textoEnPantalla` tratan cualquier punto como decimal y separan el % de forma distinta
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/core/glosarioDePantalla.ts:120` y `:138-143`
- **Qué pasa:** `cifrasEnPantalla` cambia todo `dígito.dígito` por coma: «1.234 activos» pasaría a «1,234», una versión «2.3.1» a «2,3,1» y una fecha «13.11.2026» a «13,11,2026». Y `textoEnPantalla` pone un espacio normal antes de «%» (puede partirse la línea entre cifra y signo) mientras `cifrasEnPantalla` pone uno duro.
- **Arreglo propuesto:** convertir solo números con un único punto y como mucho dos o cuatro decimales; usar ` ` en los dos sitios. Prueba unitaria con «1.234», «2.3.1» y «12.5%».
- **Confianza:** confirmado en el código (la transformación); sospecha sobre si el servidor manda hoy textos así

#### MAR-27 · La impresión con Ctrl+P oculta `.ui-button`, pero no los botones nativos ni los diálogos abiertos
- **Gravedad:** baja
- **Categoría:** informes
- **Dónde:** `src/styles/impresion.css:67-71`
- **Qué pasa:** se ocultan `.ui-button`, la columna de acciones y `.portfolio-row-actions`; se imprimen los 38 `<button>` nativos de 23 ficheros (p. ej. «Reintentar» de `AsyncErrorBanner`, los de `PortfolioPositionsTable`) y cualquier diálogo abierto, que vive en un portal fuera de `.app-shell` y por tanto fuera de todas las reglas de la hoja.
- **Arreglo propuesto:** ocultar `button` y `[role="dialog"]`/`.ui-dialog-backdrop` dentro de `@media print`.
- **Confianza:** sospecha (mirar una vista previa de impresión con un diálogo abierto)

#### MAR-28 · Documentación de estilos desfasada
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/styles/README.md:15-27`; `src/styles/tokens.css:312`, `:392-406`; `src/styles/components.css:1072-1077`
- **Qué pasa:** el README no lista `gestor.css`, `gestor-analisis.css` ni `gestor-dialogos.css`. `--rail-w-tablet` se justifica con «Rendimiento», que ya no existe en el menú. El bloque 13b dice que solo la ficha usa la dirección. El de distintivos dice que «el rojo y el verde siguen reservados a fallo/pérdida y correcto/ganancia», cuando no hay verde. Quien diseñe el sistema nuevo leyendo los comentarios aprende reglas que no rigen.
- **Arreglo propuesto:** corregirlos al tocar cada bloque; una línea en el README por hoja.
- **Confianza:** confirmado en el código

#### MAR-29 · El desplazamiento suave ignora «reducir movimiento»
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/pages/CarterasGuardadasPage.tsx:297`
- **Qué pasa:** la regla global de `base.css:298-307` anula transiciones, animaciones y `scroll-behavior` de CSS, pero no un `scrollIntoView({ behavior: "smooth" })` de JS. Es el único caso.
- **Arreglo propuesto:** `behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"`.
- **Confianza:** confirmado en el código

#### MAR-30 · La cartera de referencia no se sincroniza entre pestañas; el Modo cliente sí
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/app/BenchmarkContext.tsx:51-68` frente a `src/app/ClientModeContext.tsx:43-52`
- **Qué pasa:** los dos viven en `localStorage`, pero solo el Modo cliente escucha `storage`. Con dos pestañas, cambiar la cartera de referencia en una deja la otra comparando contra la anterior hasta recargar, y el PDF que salga de esa pestaña dirá otra referencia.
- **Arreglo propuesto:** el mismo `storage` listener que en `ClientModeContext`.
- **Confianza:** confirmado en el código

#### MAR-31 · Acceso: `aria-invalid` en los dos campos ante cualquier error y el código TOTP del diálogo no confirma con Intro
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/auth/AuthGate.tsx:615-623`; `src/auth/AccountSecurityDialog.tsx:324-335`, `:347-354`
- **Qué pasa:** un fallo de red o «demasiados intentos» marca correo y contraseña como inválidos, y el mensaje no se asocia a ninguno (`aria-describedby`). En «Activar verificación en dos pasos» el campo no está en un `<form>`: Intro no hace nada y hay que ir al botón (en el acceso sí funciona). El formulario de acceso usa botones nativos (`auth-submit`, `auth-google`, `auth-reset-link`) y no `Button`.
- **Arreglo propuesto:** `aria-invalid` solo con errores de credenciales y `aria-describedby` al mensaje; envolver el paso TOTP en un `<form onSubmit>`.
- **Confianza:** confirmado en el código

#### MAR · Lo que está bien
- **El marco de navegación**: «Saltar al contenido» como primera parada y sin romper el enrutador (`BdbActivosApp.tsx:462-468`); foco al `h1` de la pantalla al navegar, que cede si el usuario ya se ha movido (`useFocoAlTitulo.ts`); `document.title` por pantalla y con el nombre del activo en la ficha; direcciones antiguas que redirigen con su intención; dirección desconocida que se queda en la barra y lo dice; «Atrás» que vuelve al origen de la ficha guardado en el historial; `decodeURIComponent` protegido.
- **El ciclo de la cartera** (`useCicloDeCartera.tsx`): aviso de cambios sin guardar en «Salir» y al cerrar la pestaña, y el diálogo precargado cuando hay algo que perder.
- **La pila de diálogos** (`useAccessibleDialog.ts`): Escape solo al de arriba, `overflow` restaurado al cerrar el último, foco devuelto al que abrió, trampa de Tab. `ConfirmDialog` empieza en «Cancelar» en acciones peligrosas.
- **El cierre por inactividad**: lógica pura y probada con reloj falso, medida con la hora del sistema y compartida entre pestañas sin datos de cliente.
- **Las ausencias** (`Ausencia`, `CifraOAusencia`, `textoDeAusencia`): una sola fuente para «No aplica / Falta el dato / Sin pedir».
- **`TablaDeDatos`**: `<table>` real con `caption`, `scope`, `aria-sort`, marco enfocable, grupos por escala, huecos al final, totales al pie. **`EuroAmountInput`**: confirma una vez, acepta «20.000» y «20000,50», rechaza letras, ISIN y fechas, y no convierte «-500» en 0.
- **Color**: ni un hex en las hojas fuera de `tokens.css`, espejo probado con `theme.ts`, toda la tinta de texto ≥ 4,5:1 sobre papel (tinta 16,98; tinta 2 7,20; tinta 3 4,93; enlace 11,65; terracota 7,42), y la barra oscura bien medida (menú 9,18; rótulos 4,70; blanco 13,75; aviso claro 8,25).
- **Toques en tableta** con `@media (pointer: coarse)`: 44 px en el menú, 40 en la barra y en casillas, y `prefers-reduced-motion` global.
- **Estilos en línea casi solo donde dependen del dato**, y la hoja de impresión que pone la pantalla en una columna.

#### MAR · Lo que no se ha podido mirar
- Nada en navegador (regla de la fase): ni foco visible real, ni lectores de pantalla, ni contraste forzado de Windows, ni los seis anchos. Lo marcado como «sospecha» es eso.
- `modules.css` (6.524 líneas), `charts.css`, `ficha.css`, `jubilacion.css`, `gestor*.css` y `planes.css` solo con barrido dirigido (cortes, px, colores, `!important`, foco, familias de clases), no regla a regla.
- El diálogo `CambiosSinGuardarDialog` y las páginas montadas por el marco (son de otras secciones).
- No he ejecutado `scripts/deadCssD3.mjs` ni pruebas.

### FMT · Formato de cifras y fechas, y vocabulario

#### FMT-01 · La comparativa de activos da la rentabilidad con dos decimales y signo en pantalla y con uno y sin signo en su PDF
- **Gravedad:** alta
- **Categoría:** incoherencia
- **Dónde:** `src/adapters/comparativaDeActivos.ts:490-491,597-600`; `src/reports/assetComparePdf.tsx:153,436-439,459-463`
- **Qué pasa:** la misma rentabilidad anualizada sale «+7,46 %» en la tabla del Comparador y «7,5 %» en el PDF que se
  genera desde ella; la volatilidad y la caída, igual (2 decimales frente a 1). El asesor que entrega el PDF y enseña la
  pantalla tiene dos cifras distintas para el mismo dato, y el signo desaparece en el papel.
- **Cómo reproducirlo:** Activos → Comparador, dos fondos; leer «Rentabilidad anualizada 3 años»; descargar el PDF y comparar.
- **Evidencia:**
  ```ts
  // comparativaDeActivos.ts:490-491
  const pct = (v: number) => fmtPct(v);
  const conSigno = (v: number) => (v > 0 ? `+${fmtPct(v)}` : fmtPct(v));
  // assetComparePdf.tsx:153
  const pct = (x?: number) => fmtPct(x, 1);
  ```
- **Arreglo propuesto:** decidir una precisión por tipo de cifra (propuesta: rentabilidad y volatilidad con 2 decimales en
  tablas de activos, como la ficha y Planes) y escribirla en el módulo único (`rentabilidad(v)`, `volatilidad(v)`), que
  usen pantalla y PDF. Prueba: una prueba que renderice la fila del Comparador y la del PDF con el mismo activo y compare
  el texto.
- **Confianza:** confirmado en el código

#### FMT-02 · `cifrasEnPantalla` convierte el punto de millar en coma decimal
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:** `src/core/glosarioDePantalla.ts:138-143`; usos en `src/components/EconomicCalendarPanel.tsx:52-54`, `src/components/PortfolioImprovementPanel.tsx:492`, `src/reports/improvementProposalPdf.tsx:112`, `src/reports/internalPortfolioReportPdf.tsx:1905,1942,1951`
- **Qué pasa:** la función sustituye todo `.` entre dos dígitos por `,`. Pensada para «12.3%» del servidor, también
  convierte un «1.500 €» o «1.234» ya escrito en español en «1,500 €» y «1,234», que se leen como uno y medio. Y un valor
  del calendario económico escrito a la inglesa con millares («1,234.5K») queda «1,234,5K».
- **Cómo reproducirlo:** `cifrasEnPantalla("Ahorro de 1.500 €")` → «Ahorro de 1,500 €».
- **Evidencia:** `.replace(/(\d)\.(\d)/g, "$1,$2")`
- **Arreglo propuesto:** que el servidor devuelva cifras como números y la pantalla las formatee; mientras tanto, limitar
  la sustitución a un punto seguido de 1 ó 2 dígitos y fin de número (`/(\d)\.(\d{1,2})(?!\d)/`) y no tocar textos que
  ya llevan coma. Prueba unitaria con «1.500 €», «12.3%», «1,234.5».
- **Confianza:** la transformación está confirmada en el código; que hoy llegue un texto con millares por esos caminos
  es sospecha (habría que mirar los textos de `functions_python` para la propuesta de mejora y los valores del calendario).

#### FMT-03 · Los avisos del motor del Gestor salen con fechas ISO, importes sin millares con guion y títulos con punto decimal
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/motor/integridad.ts:171,206,217,242,256`; `src/gestor/motor/libro.ts:160,190,256`; `src/gestor/motor/valoracion.ts:420,458,595`; se pintan en `src/gestor/ui/analisis/BloqueComprobaciones.tsx:71`, `src/gestor/ui/vistas/VistaResumen.tsx:77` y en el PDF del asesor `src/gestor/informes/secciones/asesor/avisos.tsx:25`
- **Qué pasa:** el resto del Gestor escribe «13/11/2026» y «1.234,56 €», pero sus avisos dicen «desde el 2026-03-14
  (llega a -1250,40 EUR)» o «El 2026-03-14 salen 12.5 títulos». En el PDF que firma el asesor aparece igual.
  `textoEnPantalla` ya traduce las fechas ISO de los módulos compartidos (`glosarioDePantalla.ts:123,131`); estos no pasan por ahí.
- **Cómo reproducirlo:** cartera de demostración del Gestor; anotar una venta de más títulos de los que hay → aviso en Resumen y en el informe del asesor.
- **Evidencia:**
  ```ts
  const euros = (valor: Decimal, divisa: string): string => `${valor.toFixed(2).replace(".", ",")} ${divisa}`;
  mensaje: `El ${apunte.fecha} salen ${pedidos.toFixed()} títulos de ${nombre} y solo había ${pedidos.minus(sinCubrir).toFixed()}: …`
  ```
- **Arreglo propuesto:** que el motor dé el aviso con datos (fecha, importe, divisa, títulos) y que la pantalla y el
  papel lo escriban con su `fechaCorta`/`importe`/`titulos`; o, mínimo, que el motor use `gestor/ui/formato.ts`. Prueba:
  `integridad.test.ts` con un mensaje esperado «el 14/03/2026 … −1.250,40 €».
- **Confianza:** confirmado en el código

#### FMT-04 · Pantalla e informe del asesor del Gestor escriben la misma cifra con otra unidad y otro símbolo de divisa
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/formato.ts:18,22,47-49`; `src/gestor/informes/formato.ts:22-25,46-49`
- **Qué pasa:** «Frente a la referencia» sale «+0,85 pp» en pantalla y «+0,85 p.p.» en el informe del asesor
  («+0,85 puntos» en el del cliente). Un importe en dólares sale «12.400,00 $» en pantalla y «12.400,00 USD» en el
  PDF; en la ficha anterior, «12.400 US$» (`AssetDetail.tsx:89`). El resto de la app usa «pp» (6 ficheros) salvo el informe completo («p.p.»).
- **Cómo reproducirlo:** cartera del Gestor con una referencia y una posición en USD; mirar Análisis y generar el informe del asesor.
- **Evidencia:**
  ```ts
  // ui/formato.ts
  const SIMBOLO: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
  const texto = `${numero(fraccion * 100, decimales)} pp`;
  // informes/formato.ts
  const texto = divisa === "EUR" ? fmtEur(valor, decimales) : `${fmtNum(valor, decimales)}${ESPACIO_DURO}${divisa}`;
  export function puntos(valor, unidad: "p.p." | "puntos" = "p.p.", …)
  ```
- **Arreglo propuesto:** una sola regla: «€» para el euro y el código ISO para las demás (es lo que no confunde dólares
  de EE. UU., Canadá o Australia), y «p.p.» (o «pp», pero uno) para las diferencias, con «puntos» solo en textos de
  cliente. Prueba: la misma métrica por `valorDeMetrica` de los dos módulos da el mismo texto.
- **Confianza:** confirmado en el código

#### FMT-05 · El formateador común escribe «−0,00 %» y «−0,00» en lo que redondea a cero
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/core/format.ts:18-28,40-50`; parches locales en `src/gestor/ui/formato.ts:13-15`, `src/gestor/informes/formato.ts:19`, `src/reports/internalPortfolioReportPdf.tsx:201,270`, `src/core/crisisPasadas.ts:90`, `src/core/seguimientoPeriodico.ts:125`, `src/core/propuestaDeCambio.ts:61`, `src/reports/comparePdf.tsx:94`
- **Qué pasa:** `Intl` conserva el signo de un negativo que redondea a cero (comprobado: `format(-0.001)` con 2 decimales
  → «-0,00»), y `fmtPct` lo convierte en «−0,00 %». Ocho sitios lo corrigen cada uno a su manera; las otras ~390
  llamadas a `fmtPct` no, y una rentabilidad de −0,003 % se lee «−0,00 %» (y en las pantallas que colorean por signo, en rojo).
- **Cómo reproducirlo:** `fmtPct(-0.00003)` → «−0,00 %».
- **Evidencia:** `new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(valueDecimal * 100)` sin `signDisplay`.
- **Arreglo propuesto:** `signDisplay: "negative"` (o redondear antes y normalizar `-0`) en el módulo único, con opción
  `conSigno` que use `signDisplay: "exceptZero"`; borrar los ocho parches. Prueba en `format.test.ts`.
- **Confianza:** confirmado en el código y en Node

#### FMT-06 · El valor de la participación de los planes y varios recuentos no llevan punto de millar en cuatro cifras
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/core/planes/lectura.ts:85`; `src/components/planes/FichaDelPlan.tsx:35`; `src/core/format.ts:40-50` (`fmtNum`); `src/components/AdminFundQuality.tsx:46,48,64`; `src/gestor/ui/dialogos/DialogoDeVersiones.tsx:31,35`; `src/pages/SystemStatusPage.tsx:99`; `src/core/agendaDeMercado.ts:137`
- **Qué pasa:** `es-ES` no agrupa por debajo de diez mil salvo `useGrouping:"always"`. El valor de un plan sale
  «1234,56789 €» y el de otro «12.345,67890 €» en la misma columna; el eje del gráfico del plan, igual. `fmtNum` (100
  llamadas) se dejó así a propósito porque lo usan PDF (comentario en `format.ts:53-56`), y por eso cada pantalla que lo
  usa para algo que pasa de mil arrastra el defecto.
- **Cómo reproducirlo:** Planificación → Planes y EPSV → un plan con participación de más de 1.000 €.
- **Evidencia:** ``return { texto: `${fmtNum(plan.valor.importe, 5)} €`, … }``
- **Arreglo propuesto:** agrupación siempre en el módulo único (también en el papel: hoy los PDF ya mezclan «1.234 €» de
  `fmtEur` con «1234,56» de `fmtNum`); en Planes, `fmtMiles(v, 5)`. Prueba: `celdaDelValor` con 1234,5.
- **Confianza:** confirmado en el código

#### FMT-07 · El patrimonio de la ficha sale «500.000€» sin espacio, y «B€» para el billón
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/core/cifrasDeFicha.ts:14-24`; usos en `src/adapters/componerFicha.ts:911,1651`, `src/adapters/fichaDelEmisor.ts:295-304`; frente a `src/components/AssetDetail.tsx:85-101` y `src/adapters/componerLista.ts:295`
- **Qué pasa:** por debajo del millón el símbolo se pega a la cifra («500.000€»); en otra divisa lleva espacio («500.000
  USD»). Por encima del billón escribe «B€», que un lector acostumbrado a fuentes en inglés lee como mil millones. La
  ficha anterior (`AssetDetail`) escribe la capitalización con la notación compacta de `Intl`: «2500 M €», «1500 M US$»,
  y su comentario promete «2,5 mil M€». Tres maneras del mismo dato entre Buscador, ficha nueva y ficha anterior.
- **Cómo reproducirlo:** `importeGrande(500000, "EUR")` → «500.000€»; `importeGrande(3.2e12, "USD")` → «3,20 B USD».
- **Evidencia:**
  ```ts
  const simbolo = divisa === "EUR" ? "€" : ` ${String(divisa ?? "")}`.trimEnd();
  if (Math.abs(numero) >= 1e12) return `${fmtMiles(numero / 1e12, 2)} B${simbolo}`;
  return `${fmtMiles(numero)}${simbolo}`;
  ```
- **Arreglo propuesto:** una función `importeGrande` en el módulo único: «M €» hasta 1e12 y «bill. €» por encima (o
  millones siempre), espacio duro siempre; que `AssetDetail` la use. Prueba con 5e5, 1,0078e9, 3,2e12.
- **Confianza:** confirmado en el código; la salida compacta de `AssetDetail` está medida en Node (el navegador puede variar)

#### FMT-08 · Lo que falta se escribe de siete formas, y el «N/D» común sigue saliendo en pantalla
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/core/format.ts:1` (`ND = "N/D"`, devuelto por toda la familia); `src/core/textoDeAusencia.ts:12-16`; `src/gestor/informes/formato.ts:12,62,68`; `src/components/AdminInspector.tsx:42` («—»); `src/pages/AdminPage.tsx:295` («—»); `src/components/HistoricalStressCards.tsx:20,25`; `src/components/planes/FichaDelPlan.tsx:35` (vacío)
- **Qué pasa:** la decisión es «Falta el dato» / «No aplica» en pantalla (`textoDeAusencia`, 39 ficheros). Pero toda
  llamada a `fmtPct`/`fmtEur`/`fmtDate` con un `null` devuelve «N/D», y esas llamadas están en 148 ficheros; el Gestor
  escribe «No disponible» en el papel y cadena vacía para títulos y precio; el panel de administración, «—». El
  asesor ve tres palabras para lo mismo según la pantalla.
- **Cómo reproducirlo:** buscar `ND` en pantallas: `HistoricalStressCards`, `PortfolioConstraintsPanel.tsx:14`, `AssetDetailMetrics.tsx:16`, `WealthComparator`, `RealPortfolioPage`.
- **Evidencia:** `if (!isFiniteNumber(valueDecimal)) { return ND; }`
- **Arreglo propuesto:** que el formateador único no decida la ausencia: devolver `null` y que la pieza `Ausencia`/`CifraOAusencia`
  pinte «Falta el dato» o «No aplica»; para el papel, una constante por papel. Prueba: ninguna pantalla renderiza «N/D»
  (prueba de texto sobre las pantallas principales con datos vacíos).
- **Confianza:** confirmado en el código

#### FMT-09 · Septiembre es «sept» en la app y «sep» en el Gestor; algunos días llevan cero delante
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/core/format.ts:185-201`; `src/gestor/ui/formato.ts:69,73-75`; `src/gestor/informes/formato.ts:156`; `src/components/HistoricalStressCards.tsx:31-35`; `src/pages/StrategyPage.tsx:93`; `src/core/textosDeCartera.ts:31,47`
- **Qué pasa:** `fmtDayShort` usa `Intl` y en septiembre da «13 sept 2026» (comprobado en Node); el Gestor tiene su
  propia lista de meses y escribe «13 sep 2026», y sus informes «Sep». `HistoricalStressCards` y la página de estrategia
  piden `day:"2-digit"` y salen «08 mar 2020» al lado de «8 mar 2020».
- **Cómo reproducirlo:** cualquier fecha de septiembre en la ficha (`fmtDayShort`) y en el Gestor (`fecha`).
- **Evidencia:** `const MESES = ["ene", …, "sep", "oct", "nov", "dic"];` frente a `new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", … })`.
- **Arreglo propuesto:** una sola función de fecha corta con la lista de meses fija («sept.» o «sep», pero una) y
  `day:"numeric"`; el Gestor la importa. Prueba con 2026-09-08 en las dos.
- **Confianza:** confirmado en el código; «sept» medido en Node, el navegador puede dar lo mismo o «sep» según su ICU

#### FMT-10 · La fecha de emisión de los PDF se escribe de cuatro maneras
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:** `src/reports/comparePdf.tsx:464` («13/11/2026»); `src/reports/informeDeClientePdf.tsx:1560` («13/11/2026»); `src/reports/assetComparePdf.tsx:376` y `src/reports/weeklyReportPdf.tsx:100` («viernes, 13 de noviembre de 2026»); `src/reports/costsPdf.tsx:137`, `src/reports/improvementProposalPdf.tsx:109`, `src/reports/jubilacionPdf.tsx:242`, `src/reports/internalPortfolioReportPdf.tsx:300`, `src/gestor/informes/formato.ts:75` («13 de noviembre de 2026»)
- **Qué pasa:** dos informes que el asesor entrega juntos (informe de cliente y comparador de carteras, ambos papel de
  cliente) fechan distinto que el de costes, que comparte identidad con ellos.
- **Cómo reproducirlo:** generar informe de cliente, comparador y costes de la misma cartera.
- **Evidencia:** `fmtDate(new Date().toISOString())` frente a `new Intl.DateTimeFormat("es-ES", { dateStyle: "long" }).format(new Date())` frente a `fmtDateLong(new Date().toISOString())`.
- **Arreglo propuesto:** una `fechaDeEmision()` en el módulo único («13 de noviembre de 2026»), pasada por `diaLocal`.
  Cambia lo que firma el asesor: necesita la decisión de Óscar (los PDF no se tocan de rebote).
- **Confianza:** confirmado en el código

#### FMT-11 · El Gestor nombra sus métricas fuera del glosario, y su pantalla y su informe de cliente las llaman distinto
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/motor/metricas/maximaCaida.ts:5` («Máxima caída»), `rentabilidadAnualizada.ts:5` («Rentabilidad anual»), `sharpe.ts:5` («Ratio de Sharpe»); `src/gestor/informes/secciones/cliente/notas.tsx:21,26` («Rentabilidad por año», «Mayor caída»); `src/gestor/ui/analisis/BloqueIngresosYCostes.tsx:79` («Gastos corrientes de los fondos»); glosario `src/core/glosarioDePantalla.ts:9-11`
- **Qué pasa:** el glosario dice «Caída máxima», «Rentabilidad anualizada» y «Coste corriente»; el resto de la app los
  usa (41, 55 y 96 textos). El Gestor, que es la pantalla más nueva, dice «Máxima caída», «Rentabilidad anual» y
  «Gastos corrientes», y en el informe del cliente «Mayor caída» y «Rentabilidad por año». Un asesor que pasa del
  Análisis de una cartera diseñada al Gestor ve otro nombre para el mismo indicador.
- **Cómo reproducirlo:** Carteras → Análisis («Caída máxima») y Carteras → Gestor de carteras → Análisis («Máxima caída»).
- **Evidencia:** `nombre: "Máxima caída",` / `{ id: "maximaCaida", nombre: "Mayor caída" },`
- **Arreglo propuesto:** el registro de métricas del Gestor toma el nombre del glosario; si el papel de cliente quiere un
  nombre más llano, que el glosario lo declare como variante de cliente. Prueba: una prueba que recorra el registro y
  compruebe cada nombre contra el glosario.
- **Confianza:** confirmado en el código

#### FMT-12 · Dos nombres para cada informe y tres verbos para producirlo
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/dialogos/DialogoDeInformes.tsx:32-35`; `src/components/PortfolioReport.tsx:484,547,579,606`; `src/components/OptimizerPanel.tsx:474`; `src/components/jubilacion/DialogoDelInformeDeJubilacion.tsx:89`; `src/components/PositionsWorkbench.tsx:1071`
- **Qué pasa:** «Informe del cliente» y «Informe del asesor» en el Gestor; «informe de cliente» e «informe interno» en
  Carteras → Informes. El botón dice «Generar el PDF» (Gestor), «Descargar informe de cliente» (Informes), «Generar
  informe de cliente» (Optimizador), «Descargar informe» (Jubilación), «Exportar Excel» (Posiciones) frente a «Datos en
  Excel» (Gestor).
- **Cómo reproducirlo:** abrir los cuatro diálogos.
- **Evidencia:** `{ id: "asesor", nombre: "Informe del asesor", …, boton: "Generar el PDF" }` / `Descargar informe interno`.
- **Arreglo propuesto:** fijar en el glosario «Informe de cliente», «Informe del asesor» (o «interno», uno) y el verbo
  «Descargar» para lo que baja un fichero.
- **Confianza:** confirmado en el código

#### FMT-13 · Siglas y sinónimos de rentabilidad sin explicar en pantalla y papel: YTD, TWR, TIR, «Retorno», «Rendimiento»
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/pages/RealPortfolioPage.tsx:187` («YTD»); `src/reports/realPortfolioPdf.tsx:665,828-830` («· YTD», «Retorno último 1 año»); `src/core/labels.ts:269` («Rentabilidad YTD»); `src/adapters/tablaDeRendimiento.tsx:249` («TWR anual»); `src/components/RealAnalysisHistory.tsx:81` («TIR»); `src/adapters/componerFicha.ts:1603-1610` («Rendimiento 12 meses»)
- **Qué pasa:** el glosario sustituye «CAGR» pero no estas: «YTD» donde el resto dice «en lo que va de año»
  (`glosarioDePantalla.ts:41`), «Retorno» (3 textos, solo en ese PDF) donde la app dice «Rentabilidad» (360),
  «Rendimiento 12 meses» en la ficha (el rendimiento por dividendo de un ETF, que se confunde con rentabilidad).
- **Cómo reproducirlo:** Carteras → Gestor → Análisis rápido de extractos; PDF de rendimiento; ficha de un ETF de distribución.
- **Evidencia:** `{row.is_ytd ? <small>YTD</small> : null}` / `titulo: "TWR anual"`.
- **Arreglo propuesto:** añadir al glosario «En lo que va de año» (YTD), «Rentabilidad ponderada por tiempo» con nota
  (TWR), «Rentabilidad del dinero invertido» o «TIR» con su ayuda; «Rendimiento por dividendo 12 meses» en la ficha.
- **Confianza:** confirmado en el código

#### FMT-14 · La ficha convierte un coste ausente en «0,00 %» al justificar «Comparar su coste»
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:** `src/adapters/componerFicha.ts:186,199,539,573-575`
- **Qué pasa:** la prueba de la aptitud hace `fmtPct(Number(valorEn(tarjeta, "costs.ongoing_charge")))`. Si el campo es
  `undefined`, `Number` da `NaN` → «N/D» → se escribe «Sí». Pero si es `null` (como la base guarda las ausencias),
  `Number(null)` es 0 y la fila dice «0,00 %»: un coste inventado, contra la regla de no pintar un cero. `pct` y `num`
  locales tienen el mismo patrón.
- **Cómo reproducirlo:** una tarjeta con `fitness.COMPARAR_COSTE.apt = true` y `costs.ongoing_charge: null`.
- **Evidencia:** `COMPARAR_COSTE: () => fmtPct(Number(valorEn(tarjeta, "costs.ongoing_charge"))),`
- **Arreglo propuesto:** `typeof v === "number" ? fmtPct(v) : null` y que la ausencia la decida el llamador. Prueba en
  `componerFicha.test.ts` con `null`.
- **Confianza:** sospecha (falta comprobar si la base puede traer `ongoing_charge: null` con la aptitud en verdadero)

#### FMT-15 · El glosario se contradice: «Tipo de instrumento» pasa a «Producto» en su tabla y a «Tipo de activo» en su código
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/core/glosarioDePantalla.ts:16,105`; también `:54` («Tipo de activo no admitido»)
- **Qué pasa:** la tabla de la decisión 28 dice que lo que era «Tipo de instrumento» se llama «Producto»; la sustitución
  que se ejecuta escribe «Tipo de activo», que el mismo glosario reserva a otra cosa («Activo» = lo que se mide o se
  elige; «Clase de activo» = renta variable…). El documento del que debería salir el término único no es único.
- **Cómo reproducirlo:** `textoEnPantalla("Tipo de instrumento")` → «Tipo de activo».
- **Evidencia:** `| Fondo, ETF, Acción | Producto | Vehículo, Tipo de instrumento |` / `[/\bTipo de instrumento\b/g, "Tipo de activo"],`
- **Arreglo propuesto:** decidir (recomiendo «Tipo de producto» para Fondo/ETF/Acción) y alinear tabla y sustitución.
- **Confianza:** confirmado en el código

#### FMT-16 · Espacio normal antes de «%» y, en el Gestor, antes de «€»: la cifra y su unidad se pueden separar al partir la línea
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/core/format.ts:27`; `src/gestor/ui/formato.ts:22,38`; parches en `src/core/medidaDeLaCartera.ts:137`, `src/core/planes/lectura.ts:85`, `src/core/glosarioDePantalla.ts:142`
- **Qué pasa:** `fmtEur` lleva espacio duro (lo pone `Intl`), `fmtPct` y todo el Gestor, espacio normal. En celdas
  estrechas (768 px) puede quedar «12,3» en una línea y «%» en la siguiente; tres sitios lo arreglan a mano.
- **Cómo reproducirlo:** tabla estrecha con porcentajes largos a 768 px.
- **Evidencia:** `` return `${typographicMinus(…)} %`; ``
- **Arreglo propuesto:** U+00A0 (o U+202F) siempre entre cifra y unidad, en el módulo único.
- **Confianza:** confirmado en el código; el corte de línea es sospecha (mirar en el navegador)

#### FMT-17 · Fecha y hora en tres formas
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/core/format.ts:159` («13/11/2026 · 13:45»); `src/gestor/ui/dialogos/DialogoDeVersiones.tsx:22` y `src/pages/SystemStatusPage.tsx:100` («13 nov 2026, 15:04»); `src/core/textosDeCartera.ts:23` («Guardada el 3 nov 2026, 12:30»)
- **Qué pasa:** tres separadores y dos formatos de día para el mismo concepto.
- **Cómo reproducirlo:** versiones de una cartera del Gestor frente a Sistema.
- **Evidencia:** `` return `${fecha(hoy(momento))}, ${String(momento.getHours()).padStart(2, "0")}:…`; ``
- **Arreglo propuesto:** una `fechaYHora()` en el módulo único.
- **Confianza:** confirmado en el código

#### FMT-18 · Ejes en euros: «250 mil €» en unos gráficos y «250 k€» en otro
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/jubilacion/GraficosDeJubilacion.tsx:34-36`, `src/gestor/informes/papel/graficos.tsx:129-131`, `src/reports/jubilacionPdf.tsx:137,200`; frente a `src/reports/internalPortfolioReportPdf.tsx:772`
- **Qué pasa:** el informe completo escribe «k€»; los demás, la notación compacta española. El comentario de
  `graficos.tsx:129` promete «1,2 M€» y la función devuelve «1,2 M €».
- **Evidencia:** `` {capital ? `${Math.round(g / 1000)} k€` : g.toFixed(0)} ``
- **Arreglo propuesto:** `ejeEnEuros` común.
- **Confianza:** confirmado en el código

#### FMT-19 · «Hoy» y el día de un instante calculados en UTC en tres sitios
- **Gravedad:** baja
- **Categoría:** cálculo
- **Dónde:** `src/components/AdminRetrocessions.tsx:81-88`; `src/core/commercialRetroCsv.ts:37`; `src/reports/internalPortfolioReportPdf.tsx:1877`
- **Qué pasa:** entre las 00:00 y las 01:00/02:00 de Madrid, la vigencia por defecto de una retrocesión y el «calculada
  el» de la propuesta de mejora en el informe completo dicen el día anterior. El resto de la app ya lo resolvió con
  `diaLocal` y `hoy()` del Gestor.
- **Evidencia:** `return new Date().toISOString().slice(0, 10);` / `` `calculada el ${fmtDate(stored.savedAt.slice(0, 10))}` ``
- **Arreglo propuesto:** `diaLocal(...)`. Prueba con reloj fijo a las 00:30 en `Europe/Madrid`.
- **Confianza:** confirmado en el código

#### FMT-20 · Dos lectores de cifras con reglas distintas, y los porcentajes en `type="number"`
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `src/core/numberFormat.ts:32`; `src/gestor/motor/decimal.ts:113`; campos `type="number"` en `FormularioDeJubilacion.tsx:108`, `PortfolioManagementFee.tsx:52`, `CostsModal.tsx:352,389`, `WealthComparator.tsx:378`, `OptimizerPanel.tsx`, `PortfolioImprovementPanel.tsx:338-346`
- **Qué pasa:** `parseEuropeanNumber` acepta «1,234,567» y «1.500 EUR»; `leerCifra` los rechaza. Los porcentajes en
  `type="number"` dependen del navegador para la coma. El mensaje de rango de Jubilación escribe el número con
  `String` («se calcula con 2.5» si el tope fuera decimal; hoy los topes son enteros).
- **Evidencia:** `if (comas > 1) return undefined;` (leerCifra) frente a `/^-?\d{1,3}(,\d{3})+$/` (parseEuropeanNumber).
- **Arreglo propuesto:** un lector único (el de `numberFormat.ts`, con la vuelta de `Decimal` para el Gestor) y un
  `CampoDePorcentaje` de texto con ese lector. Prueba de tabla con las entradas de D.
- **Confianza:** confirmado en el código (comportamiento de `type="number"`: sospecha)

#### FMT-21 · «Borrar» y «Eliminar» para lo mismo en la misma pantalla
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/AdminRetrocessions.tsx:697,981,994`; `src/components/RealAnalysisHistory.tsx:59`; `src/gestor/ui/vistas/VistaMovimientos.tsx:72`
- **Qué pasa:** el botón dice «Borrar» y el diálogo que confirma, «Eliminar retrocesión comercial».
- **Arreglo propuesto:** «Eliminar» para borrar de verdad, «Quitar» para sacar de una lista (como ya hace el Comparador).
- **Confianza:** confirmado en el código

#### FMT-22 · Jerga de configuración sin tildes en un mensaje de error de la base nueva
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/adapters/baseNuevaLecturaSdk.ts:44-47`
- **Qué pasa:** «La base nueva no tiene conexion: la aplicacion no esta configurada contra bdb-gestor-de-activos. Revisa
  VITE_FIREBASE_PROJECT_ID.» Si llega a un estado de error de pantalla, enseña un identificador de proyecto y una
  variable de compilación, y sin tildes.
- **Arreglo propuesto:** mensaje para el usuario («No se puede leer el catálogo: la aplicación no está configurada») y el
  detalle técnico en `detail` del `AppError`.
- **Confianza:** sospecha (no he comprobado qué pantalla lo muestra tal cual)

#### FMT · Lo que está bien
- `core/format.ts` resuelve bien el huso de las fechas «solo día» (`displayDate`), y `diaLocal` el día de un instante:
  conviene conservar ese criterio tal cual.
- El menos tipográfico «−» está en casi todos los caminos.
- `gestor/ui/formato.ts` es un buen diseño de API (fracción de entrada, `conSigno`, decimales mínimos y máximos, sin
  signo en cero): es la base natural del módulo único.
- Los importes y pesos tecleados ya pasan por un lector europeo (`EuroAmountInput` + `parseEuropeanNumber`) y por
  `leerCifra` en el Gestor; no he encontrado `parseFloat` directo sobre un campo de texto de importe.
- El tuteo es coherente en toda la app, y no hay *Title Case* en títulos ni botones.
- El glosario existe, está fechado y explica por qué la pantalla y el papel difieren: es el sitio donde fijar la tabla de G.2.

#### FMT · Lo que no se ha podido mirar
- Ninguna salida en el navegador: las formas de `Intl` (compacta, «sept», cortes de línea) se han medido en Node y
  pueden variar con la ICU de Chrome/Edge/Firefox.
- El comportamiento real de los `type="number"` con coma y punto en cada navegador.
- Qué textos del servidor (`functions_python`) llegan a `cifrasEnPantalla`, y si traen millares (FMT-02).
- Qué mensajes de error técnicos (`Contrato de backend inválido…`, `VITE_…`) llegan sin traducir a una pantalla.
- La unidad (fracción o puntos) de cada campo de contrato que se pasa a `fmtPct(x / 100)`: con 144 sitios, no he
  verificado uno a uno que ninguno multiplique dos veces; solo he revisado los de la ficha, la comparativa y el Gestor.
- El contenido de cada PDF página a página (solo las funciones de formato que usan).

### INF · Informes y exportaciones

#### INF-01 · Los documentos para el cliente salen firmados por defecto con el nombre de una persona real
- **Gravedad:** alta
- **Categoría:** informes
- **Dónde:**
  - `src/core/identidadDelInforme.ts:19`
  - `src/core/reportBanker.ts:10-13`
  - Lo usan `PortfolioReport.tsx:442`, `CostsModal.tsx:96`, `DialogoDeComparativa.tsx`, `DialogoDePropuesta.tsx` y `DialogoDeSeguimiento.tsx`.
  - Lo fija la prueba `tests/pdfReports.test.ts:231`.
- **Qué pasa:** el responsable de la sesión empieza siendo «Oscar Antiza Algar». Un asesor que no toca el campo entrega al cliente un informe de cliente, una comparativa, una propuesta de cambio, un seguimiento o un informe de costes con «Elaborado por Oscar Antiza Algar» en la portada. Hoy hay 4 o 5 usuarios, y el producto está pensado para más.
- **Cómo reproducirlo:** abrir la app en una sesión nueva, ir a Informes y descargar el informe de cliente sin escribir responsable.
- **Evidencia:**
  ```ts
  const responsableEnSesion = createSessionSlot(() => ({ nombre: DEFAULT_BANKER.name, correo: DEFAULT_BANKER.email }));
  export const DEFAULT_BANKER: ReportBanker = { name: "Oscar Antiza Algar", email: "" };
  ```
- **Arreglo propuesto:**
  - Que el responsable empiece vacío; sin nombre, no hay línea de «Elaborado por», como ya hacen costes y comparativa.
  - O mejor: una sola identidad del asesor, la del Gestor, guardada en ajustes con nombre, entidad, contacto y logotipo (ver INF-14).
  - Cambiar `pdfReports.test.ts:231` para que espere que, sin responsable, no haya firma.
- **Confianza:** confirmado en el código.

#### INF-02 · Informe de cliente: hojas que no se parten y una tabla de 20 filas fijas pueden recortar filas y el total
- **Gravedad:** alta
- **Categoría:** informes
- **Dónde:**
  - `src/reports/informeDeClientePdf.tsx:52`: 20 filas por hoja.
  - El comentario de la l.1309, que reconoce el recorte.
  - `altoDeLaGuia`, l.1500.
- **Qué pasa:** cada hoja va en `wrap={false}`, con el contenido en posición absoluta sobre un `PageSizer` del tamaño del A4, así que lo que no cabe se corta sin aviso. La tabla de posiciones reparte 20 filas por hoja sin medirlas. Con más de 16 posiciones, cada fila mide 16,1 pt más 8,4 pt por línea: veinte nombres de dos líneas suman unos 793 pt, frente a 751,9 útiles. Se perderían las últimas filas y la fila «Total cartera».
- **Cómo reproducirlo:** una cartera de 20 posiciones con nombres de más de 80 caracteres y capital fijado; descargar el informe de cliente y mirar el pie de la hoja 02.
- **Evidencia:**
  - El reparto por número de filas de la l.52.
  - Ninguna prueba cubre nombres largos; la de la l.548 solo cubre la guía.
- **Arreglo propuesto:**
  - Repartir por alto medido, como ya hacen `comparePdf.porAlto` o `costsPdf.repartirEnHojas`, o dejar que la tabla se parta con su cabecera fija.
  - Prueba: 20 nombres largos y comprobar que el texto del PDF contiene «Total cartera».
- **Confianza:** sospecha. El cálculo sale del código; falta generar el PDF.

#### INF-03 · Rendimiento real: la numeración de página es fija y no cuadra si una hoja se desborda
- **Gravedad:** media. Sería alta si se confirma que la hoja 1 se parte.
- **Categoría:** informes
- **Dónde:**
  - `src/reports/realPortfolioPdf.tsx:901, 932, 971, 989, 1050`: `<Footer page={1} total={total} />`.
  - La estimación por caracteres de las l.335 y 372.
- **Qué pasa:** el plan de hojas decide de antemano qué va en cada una y escribe el número a mano. La hoja 1 no tiene tope de altura: cajas, dos avisos y textos del servidor de longitud libre. Si se parte, dos hojas físicas dicen «1 / N» y el total queda corto. El anexo se reparte contando 92 caracteres por línea.
- **Cómo reproducirlo:** un extracto con traspasos pendientes, motivos de caída largos y métricas temporales pendientes.
- **Evidencia:** `<Footer page={1} total={total} />`.
- **Arreglo propuesto:** el pie con `render={({pageNumber,totalPages})}`, como todos los demás.
- **Confianza:** sospecha.

#### INF-04 · Documentos que se entregan salen en el papel interno, y los del Gestor sin la identidad del cliente que sí llevan los demás
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:**
  - `assetComparePdf.tsx:18, 395-398`: salida «cliente».
  - `fichaDeActivoPdf.tsx:40, 452-455`: Modo cliente.
  - `weeklyReportPdf.tsx:10, 121-124`.
  - Frente a `gestor/informes/papel/cliente.tsx:2-7`.
- **Qué pasa:** la regla vigente es Fraunces y Roboto para lo que se entrega, pero la comparativa de activos «para el cliente», la ficha en Modo cliente y la estrategia salen con banda oscura, Newsreader e Instrument, la identidad interna. Un cliente que recibe una comparativa de carteras y una de activos del mismo asesor recibe dos documentos que no parecen del mismo programa.
- **Cómo reproducirlo:** descargar la comparativa de activos en salida «cliente» y la comparativa de carteras, y ponerlas una al lado de la otra.
- **Evidencia:** `const SELLO_EN_LA_BANDA = SELLO.toUpperCase();` y `backgroundColor: C.navy` en la banda de la comparativa de activos.
- **Arreglo propuesto:** decidirlo en la plantilla única (apartado E). La variante se elige por destinatario y no por informe; la salida «cliente» de activos y ficha pasa a la variante cliente.
- **Confianza:** confirmado en el código.

#### INF-05 · La marca «Independent Private Bankers» aparece en 10 de los 15 PDF, y en los del Gestor no
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:**

  | Fichero | Líneas | Papel de la marca |
  |---|---|---|
  | `papelDeCliente.tsx` | 10 | `SELLO`, en portada, cabecera, pie y `author` de costes, propuesta, seguimiento y jubilación |
  | `comparePdf.tsx` | 227, 458, 460 | Cabecera, autor y portada |
  | `informeDeClientePdf.tsx` | 289 | Portada, cabecera y autor |
  | `internalPortfolioReportPdf.tsx` | 374, 915, 2223 | Cabecera, portada y autor |
  | `realPortfolioPdf.tsx` | 206, 800 | Cabecera y autor |
  | `assetComparePdf.tsx` | 43, 51, 559, 564 | Banda, aviso «Generado por…», pie y autor |
  | `fichaDeActivoPdf.tsx` | 45, 447, 453, 513 | Banda, aviso y autor |
  | `weeklyReportPdf.tsx` | 20, 119, 122, 219, 224 | Banda, aviso y pie |

  Además, «OAA» está en los nombres internos de las familias de fuente (`clientReportTheme.ts:53-54`, «OAA Fraunces») y en los comentarios de `pdfTheme.ts`. Andbank no aparece en ningún informe.
- **Qué pasa:** el producto se define como independiente y sin marca de entidad. Los tres informes del Gestor ya no la llevan a propósito (`papel/cliente.tsx:5`), los demás sí, y la frase «Generado por Independent Private Bankers» presenta el documento como emitido por una entidad.
- **Cómo reproducirlo:** cualquier PDF de los enumerados.
- **Evidencia:** `export const SELLO = "Independent Private Bankers";`, definida 6 veces y escrita en literal en otros 3 sitios.
- **Arreglo propuesto:**
  - Quitar el sello de la plantilla y firmar con la identidad del asesor (nombre, entidad libre y logotipo), como el Gestor.
  - Una prueba que barra `src/reports` y `src/gestor/informes` y falle si aparece el literal.
  - Es decisión de Óscar: el sello se aprobó el 03-11.
- **Confianza:** confirmado en el código.

#### INF-06 · Textos de datos que llegan al papel sin pasar por el saneado de glifos
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:**
  - **`informeDeClientePdf.tsx`:** no importa `safeText` ni `textoAjeno`. Pasan sin sanear el nombre de cada posición (l.936, 1608, 1760), el cliente en Fraunces (l.1553, 324), el asesor (l.1576-1577), los nombres de las crisis y el anexo.
  - **`comparePdf.tsx`:** no importa ningún saneado (l.4-22). Pasan sin sanear los nombres de las carteras (l.463, 237), el cliente y el responsable (l.467-468), las notas de metodología (l.438, 441) y los nombres de posiciones (l.535).
  - **`internalPortfolioReportPdf.tsx`:** `Reading` (l.444), notas de `KpiGrid` (l.458-460), subtextos de la tabla (l.487, 495), rótulos de `BarList` (l.548), nombres de la matriz (l.1681) y el nombre de la cartera en el pie (l.381).
  - **`realPortfolioPdf.tsx`:** l.618, 682, 836 y 896.
  - **`improvementProposalPdf.tsx:119`:** el nombre de la cartera.
  - **`assetComparePdf.tsx:402`:** el nombre del benchmark.
- **Qué pasa:** Fraunces no tiene griego ni cirílico (`papelDeCliente.tsx:25`), y las TTF del papel interno van recortadas al latino. Un nombre con «→», «≥», «Δ» o letras de otro alfabeto sale con huecos. La mitad de los informes sanea y la otra mitad no.
- **Cómo reproducirlo:** una cartera llamada «Cartera Δ → 2027» en la comparativa de carteras.
- **Evidencia:** en `comparePdf.tsx:463`, `<Text …>{short(p.name, 120)}</Text>`, sin `textoAjeno`.
- **Arreglo propuesto:**
  - Que la pieza de texto de la plantilla sanee siempre, como hacen `T` de `papelDeCliente` y `T`/`joinText` del interno.
  - Prohibir `<Text>` suelto en los informes con una regla de lint o una prueba.
  - Prueba: generar cada informe con nombres en griego y cirílico y comprobar que no hay U+FFFD ni huecos.
- **Confianza:** confirmado en el código; el efecto visual, sin generar.

#### INF-07 · El dato que falta se escribe de ocho maneras, a veces en la misma página
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:**
  - `core/format.ts:1` («N/D»).
  - `core/textoDeAusencia.ts` («Falta el dato», «No aplica»).
  - `gestor/informes/formato.ts:12` («No disponible»).
  - `gestor/informes/secciones/asesor/rentabilidad.tsx:30` y `secciones/cliente/movimientos.tsx:35` («—»).
  - `secciones/cliente/resultado.tsx:17` (vacío).
  - `secciones/asesor/composicion.tsx:25` («Sin datos.»).
  - `realPortfolioPdf.tsx:746-748`: «N/D» y `FALTA` en la misma tabla.
  - `internalPortfolioReportPdf.tsx`: la portada promete «"N/D" indica un dato ausente» y luego usa cinco formas.
  - `informeDeClientePdf.tsx:1390`: «N/D» en el periodo de la portada, y «Falta el dato» en la tira.
- **Qué pasa:** la pantalla tiene un estándar («Falta el dato» / «No aplica») y el papel no.
- **Cómo reproducirlo:** el informe interno de una cartera con un fondo sin cartera publicada.
- **Evidencia:** `export const NO_DISPONIBLE = "No disponible";` frente a `export const ND = "N/D";`.
- **Arreglo propuesto:** una sola función de ausencia en la plantilla, la de `textoDeAusencia` con su forma estrecha, y quitar `ND` de los PDF.
- **Confianza:** confirmado en el código.

#### INF-08 · Tres maneras de numerar la página, y el informe principal del cliente no dice el total
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:**
  - `informeDeClientePdf.tsx:321-330`: «P. n», contada a mano con `siguiente()`.
  - `realPortfolioPdf.tsx:526`: «x / y».
  - Los otros 13: «Página x de y».
- **Qué pasa:** el cliente no puede comprobar que tiene el documento entero, justo en el documento más importante que recibe.
- **Cómo reproducirlo:** descargar el informe de cliente.
- **Evidencia:** el pie con `P. ${n}`.
- **Arreglo propuesto:** un único pie de plantilla con `render`.
- **Confianza:** confirmado en el código.

#### INF-09 · Gráficos y matrices que solo se leen en color
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:**
  - **Gestor, «Frente a su referencia»:** dos líneas continuas y la leyenda sin `discontinua` (`gestor/informes/secciones/cliente/referencia.tsx:45-46, 51`).
  - **Gestor asesor:** «Acero: cartera. Cobre: referencia» (`secciones/asesor/rentabilidad.tsx:130`).
  - **Comparativa de carteras:** A y B con el mismo trazo (`comparePdf.tsx:265`) y una muestra de color en la leyenda (l.237).
  - **Informe de cliente:** la leyenda continua cuando la referencia va discontinua (l.600, 608-609), y el texto «punto azul con borde dorado» (l.710, 728).
  - **Informe interno:** la matriz de correlación a partir de 25 posiciones no imprime la cifra (l.1695), y +0,8 y −0,8 tienen la misma intensidad (l.1665).
  - **Rendimiento real:** todas las referencias con la misma raya «4 3».
  - **Jubilación:** acero, oliva y ciruela con luminancia casi igual.
- **Qué pasa:** un informe impreso en blanco y negro, que es lo habitual en una oficina, no permite distinguir la cartera de su referencia.
- **Cómo reproducirlo:** imprimir en escala de grises el informe del cliente del Gestor.
- **Evidencia:** `{ valores: referencia.serie…, color: COLOR_DE_LA_COMPARACION, grosor: 1 }`, sin `discontinua`, mientras `vistazo.tsx:55` sí la pone.
- **Arreglo propuesto:**
  - En la plantilla, la serie de comparación siempre discontinua y su leyenda con el mismo trazo, como ya hace jubilación.
  - Etiqueta directa al final de cada línea.
  - En las matrices, la cifra siempre, o un signo.
- **Confianza:** confirmado en el código.

#### INF-10 · Los formatos de número, puntos y fecha cambian de un informe a otro
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:**
  - `core/format.ts:27`: espacio normal antes de «%».
  - `core/format.ts:40-49`: `fmtNum` sin miles por debajo de 10.000; su comentario en la l.53 dice que no se cambia porque lo importan siete PDF.
  - `core/format.ts:146-152`: `fmtDateLong` con el día de la semana.
  - `comparePdf.tsx:96` (« pp»), `internalPortfolioReportPdf.tsx:267` (« p.p.»), `gestor/informes/formato.ts:46` («p.p.» o «puntos»).
  - `gestor/informes/formato.ts:156`: «Ene», frente a «ene» y «sept» de `Intl` en los demás ejes.
- **Qué pasa:** un mismo asesor entrega «1234,50» en un documento y «1.234,50» en otro, y «+1,2 pp» junto a «+1,2 p.p.». La comparativa de activos fecha «viernes, 13 de noviembre de 2026» y la de carteras «13/11/2026». Con espacio normal, un «%» puede quedarse solo al principio de la línea siguiente en una columna estrecha: `costsPdf.tsx:204` lo parchea a mano.
- **Cómo reproducirlo:** comparar el pie de la comparativa de activos con la portada de la de carteras.
- **Evidencia:** `return \`${typographicMinus(…format(valueDecimal * 100))} %\`;`.
- **Arreglo propuesto:**
  - Un módulo de formato del papel con importe, porcentaje, puntos, número con miles, fecha corta, fecha larga y mes de eje, todos con espacio duro.
  - Que lo importen todos.
  - Pruebas de salida exacta para cada uno.
- **Confianza:** confirmado en el código.

#### INF-11 · El informe del cliente del Gestor dice que los precios son de mercado aunque alguno venga del extracto del banco
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:** `src/gestor/informes/secciones/cliente/notas.tsx:54-58`. Frente a `gestor/informes/formato.ts:136`, que distingue «Extracto del banco», y `secciones/cliente/composicion.tsx:33`, que distingue «Sin precio».
- **Qué pasa:** el aviso enumera a mano solo los precios introducidos a mano y los de la última operación. Las posiciones valoradas con el precio del extracto, que el motor usa cuando es más reciente, o sin precio, quedan cubiertas por «Los precios proceden de fuentes de mercado». El cliente lee algo que no es exacto sobre de dónde sale su patrimonio.
- **Cómo reproducirlo:** importar un extracto de posiciones con precio más reciente que el de la plataforma y generar el informe del cliente.
- **Evidencia:**
  ```ts
  "Los precios proceden de fuentes de mercado.",
  aMano.length > 0 ? `Con precio introducido a mano: …` : "",
  deOperacion.length > 0 ? `Valoradas al precio de su última operación…` : ""
  ```
- **Arreglo propuesto:** construir la frase recorriendo todas las fuentes de `FUENTE`, con `fuenteDelPrecio`, y una prueba con una posición de cada fuente.
- **Confianza:** confirmado en el código.

#### INF-12 · Varios trozos de texto dentro de un mismo `Text`, el patrón que el propio proyecto prohíbe
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:**
  - `weeklyReportPdf.tsx:137` (`Termómetro: {…}`) y l.162 (`- {t(event)}`).
  - `comparePdf.tsx:464, 476-477, 481, 489, 536`.
  - `improvementProposalPdf.tsx:120, 144-145, 169, 192, 194`.
  - `internalPortfolioReportPdf.tsx:381, 942`, en el pie.
- **Qué pasa:** tres comentarios del código documentan dos efectos de este patrón:
  - los trozos se pisan entre sí («Generado pdIndependent», `assetComparePdf.tsx:315-318`; `papelDeCliente.tsx:63`);
  - @react-pdf recorta los espacios del borde de cada trozo («Capital200.000 €», `internalPortfolioReportPdf.tsx:334-335`).

  Estos sitios siguen escribiendo `{a} · Fecha de emisión: {b}`. El primer efecto se atribuyó a las fuentes y la decisión A-127 lo corrigió, pero el recorte de espacios no depende de ellas.
- **Cómo reproducirlo:** portada de la comparativa de carteras; buscar «·Fecha» sin espacio en el texto extraído.
- **Evidencia:** en `comparePdf.tsx:464`, `<Text style={styles.body}>{history ? history.rangeLabel : period} · Fecha de emisión: {fmtDate(…)}</Text>`.
- **Arreglo propuesto:** que la pieza de texto de la plantilla acepte solo una cadena, como `T` de `papelDeCliente`, y una prueba de extracción de texto en las portadas.
- **Confianza:** sospecha (falta generar el PDF y extraer el texto).

#### INF-13 · Jubilación imprime «−0 €» al cliente
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:**
  - `src/reports/jubilacionPdf.tsx:284`: columna IRPF.
  - l.265, 268 y 274: `conSigno(…, -1)`.
  - l.440-442: regímenes.
- **Qué pasa:** `fmtEur(-0)` devuelve «−0 €», comprobado con Node por el subagente. Sale cada año con impuesto 0 y en las deducciones nulas. El Gestor lo evita con `sinSignoEnCero` (`gestor/informes/formato.ts:19`), pero esa función no está en `core/format`.
- **Cómo reproducirlo:** una simulación con años sin IRPF.
- **Evidencia:** `conSigno(valor, -1)` sobre un valor igual a 0.
- **Arreglo propuesto:** llevar `sinSignoEnCero` al módulo común de formato, con una prueba de que `fmtEur(-0)` devuelve «0 €».
- **Confianza:** confirmado.

#### INF-14 · Dos identidades del asesor que no se conocen entre sí
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:**
  - `core/identidadDelInforme.ts`: nombre y correo en memoria de la sesión.
  - Frente a `gestor/ui/dialogos/DialogoDeInformes.tsx:114-139`: nombre, entidad, contacto y logotipo, guardados en ajustes.
  - Frente a `gestor/informes/tipos.ts:17`.
- **Qué pasa:**
  - El asesor escribe su firma dos veces en dos sitios.
  - Solo el Gestor admite logotipo y entidad.
  - Los informes del Gestor la recuerdan entre sesiones y los demás no.
  - Los demás arrancan con el nombre de Óscar (INF-01).
- **Cómo reproducirlo:** rellenar la firma en el Gestor y descargar después un informe de cliente desde Informes.
- **Evidencia:** los dos tipos son distintos: `ReportBanker { name, email }` y `asesor?: { nombre, entidad, contacto, logotipo }`.
- **Arreglo propuesto:** una sola identidad persistida, la del Gestor, que reciban todos los informes.
- **Confianza:** confirmado en el código.

#### INF-15 · Dos informes de cliente y dos informes de costes con el mismo nombre y distinto diseño
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:**
  - Informe de cliente: `informeDeClientePdf.tsx` frente a `gestor/informes` con `"cliente"`.
  - Informe de costes: `costsPdf.tsx` (`informe-de-costes.pdf`) frente a `gestor/informes` con `"costes"` (`Informe de costes - <cartera> - ….pdf`).
- **Qué pasa:** los nombres son casi iguales («Informe de Cartera» e «Informe de su cartera»; «Informe de costes» en los dos), pero los documentos son distintos:
  - el de costes del Diseño es una estimación anual y el del Gestor un a posteriori;
  - cambian la portada, el tamaño del título (45 frente a 30), el sello, el pie, el formato de euros (0 frente a 2 decimales) y el vocabulario (coste corriente frente a gastos corrientes).

  Un cliente puede recibir los dos.
- **Cómo reproducirlo:** generar los dos informes de costes de la misma cartera.
- **Evidencia:** `const DOCUMENTO = "Informe de costes · estimación anual";` frente a `export const DOCUMENTO_DE_COSTES = "Informe de costes";`.
- **Arreglo propuesto:** en la plantilla única, nombres distintos y explícitos («Costes previstos» y «Costes del periodo») y la misma estructura de portada.
- **Confianza:** confirmado en el código.

#### INF-16 · Las exportaciones CSV y Excel no siguen un mismo formato
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:**
  - `components/PortfolioBuilder.tsx:741-760`: separador `,`, decimal `.`, sin BOM, `revokeObjectURL` inmediato y enlace sin añadir al documento.
  - `core/positionsShared.ts:35-38, 93-106`: separador `;`, decimal `,` y BOM.
  - `core/globalPositionsXlsx.ts:20, 37`: «N/D» como texto en columnas numéricas y formato con «€».
  - `gestor/informes/excel/celdas.ts:38-46`: celdas vacías y formatos sin unidad.
- **Qué pasa:** `cartera.csv` abierto con Excel en español sale en una sola columna, con los decimales mal leídos. El Excel de posiciones globales mezcla texto y número en la misma columna, y la suma o el filtro lo trata mal.
- **Cómo reproducirlo:** Diseño › «Exportar a CSV» y abrirlo con Excel en un equipo en español.
- **Evidencia:** `lines.push(\`${position.asset_id},"${name}",${position.weight_percent},${euros}\`);`.
- **Arreglo propuesto:**
  - Un solo escritor de CSV, el de `positionsShared` (BOM, `;`, decimal `,`), y un solo escritor de Excel, el del Gestor (celda vacía para lo que falta).
  - Prueba de ida y vuelta con `importFileReader`.
- **Confianza:** confirmado en el código.

#### INF-17 · Paleta del papel interno con dos aceros y dos cobres, y un tercer papel en la propuesta de mejora
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:**
  - `pdfTheme.ts:32-33`: `#3F6B82` y `#B66A3C`.
  - Frente a `internalPortfolioReportPdf.tsx:96-113` y `paletaDelPapel.ts:40-54`: `#143D66` y `#B9862F`.
  - `improvementProposalPdf.tsx:46-64`: 12 colores escritos a mano.
  - `informeDeClientePdf.tsx:1287-1292`: `#D13B31`, `#5368E8` y `#31455A`, fuera de la paleta.
  - `clientReportTheme.ts:6`: «papel crema» que es `#FFFFFF`.
- **Qué pasa:**
  - El informe completo y el Gestor del asesor, los dos «papel interno», tienen azules distintos.
  - El informe de cliente pinta la volatilidad en rojo, como si fuera mala.
  - La propuesta de mejora mezcla el caqui del cliente con la letra del papel interno.
- **Cómo reproducirlo:** abrir juntos el informe interno y el informe del asesor del Gestor.
- **Evidencia:** `steel: "#3F6B82"` frente a `spruce: "#143D66"`.
- **Arreglo propuesto:** dos juegos de fichas de color, uno por variante, en un solo fichero, y una prueba que falle si un informe escribe un hexadecimal.
- **Confianza:** confirmado en el código.

#### INF-18 · El mismo concepto se llama distinto en cada informe y en la pantalla
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** ver C.2. Entre otros:
  - `comparePdf.tsx:404` («Máxima caída del periodo») frente a `PortfolioComparator.tsx:163` («Caída máxima»);
  - `gestor/informes/secciones/cliente/riesgo.tsx:31` («Mayor caída»);
  - `assetComparePdf.tsx:402` («Benchmark»);
  - `weeklyReportPdf.tsx:187` («Renta Variable», con mayúscula).
- **Qué pasa:** un cliente que compara dos documentos del mismo asesor no sabe si «mayor caída» y «máxima caída» son lo mismo.
- **Cómo reproducirlo:** —
- **Evidencia:** las tablas de C.2.
- **Arreglo propuesto:** un glosario del papel (`core/glosarioDelPapel.ts`) con un nombre por métrica y una prueba como `unaPalabraEnElPapel.test.ts`, que ya existe para algún término, extendida a todos.
- **Confianza:** confirmado en el código.

#### INF-19 · Informe interno: el VaR en euros se aplica a todo el capital, aunque la serie mida solo una parte
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:** `internalPortfolioReportPdf.tsx:855`. Frente al aviso que sí lleva el cono (l.1625).
- **Qué pasa:** `Math.abs(var95.valueAtRisk) * m.totalCapital` usa la serie con los pesos medidos llevados al 100 % y la multiplica por todo el capital, sin decirlo en la cifra. El cono sí lo dice; el VaR no. Es una cifra que el asesor usa para hablar de riesgo.
- **Cómo reproducirlo:** una cartera con un 15 % sin serie medible; comparar la nota del cono con la del VaR.
- **Evidencia:** la línea 855.
- **Arreglo propuesto:** que la cifra salga del modelo, y no del papel, con la misma nota de cobertura que el cono.
- **Confianza:** confirmado en el código.

#### INF-20 · Lógica de dominio y cifras recalculadas dentro de los PDF
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:**
  - `internalPortfolioReportPdf.tsx`:
    - el cono (l.731-735);
    - la serie de caídas (l.678);
    - la tabla de regiones (l.626, 1089);
    - el ingreso por retrocesiones sumando filas (l.1963) frente a `m.retro.annualIncomeEur` (l.996, 1008);
    - los umbrales 0,7 / 0,4 / 0,15 de la palabra que califica la correlación (l.1722).
  - `informeDeClientePdf.tsx`:
    - `deriveExposure` (l.268-286);
    - `buildReportGeography` y `cifrasDelMapa` (l.409-447), que también importa `comparePdf.tsx:19`;
    - la regla 1,25 / 0,80 (l.517-531).
- **Qué pasa:** la plantilla única solo debería dibujar. Hoy, si la pantalla cambia un umbral, el papel no se entera, y dos fuentes para la misma cifra pueden separarse.
- **Cómo reproducirlo:** —
- **Evidencia:** `comparePdf.tsx:19`, `import { buildReportGeography } from "./informeDeClientePdf";`: un informe importa lógica de otro.
- **Arreglo propuesto:** mover esas funciones a `core/` con su prueba y que los PDF reciban la cifra hecha.
- **Confianza:** sospecha de que difieran de la pantalla (no se han comparado las cifras); confirmado que están en el papel.

#### INF-21 · Tablas largas que se parten sin repetir la cabecera
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:**
  - `papelDeCliente.tsx:151`: la cabecera de `Tabla` es `wrap={false}`, sin `fixed`.
  - `fichaDeActivoPdf.tsx:285`, cuando `cabeEnUnaHoja` da falso (más de 30 filas, l.526-530).
  - `assetComparePdf.tsx:407-555`.
  - `weeklyReportPdf.tsx:143, 172`.
  - `improvementProposalPdf.tsx:126, 147`.
- **Qué pasa:** la cartera de un fondo con más de 30 líneas, o una tabla de jubilación larga, sigue en la hoja siguiente sin saber qué columna es cuál. El Gestor e interno sí repiten la cabecera con `fixed`.
- **Cómo reproducirlo:** la ficha de un fondo con más de 30 posiciones publicadas.
- **Evidencia:** `<View style={estilos.tableHead} wrap={false}>` en `papelDeCliente`, frente a `<View style={s.cabezaDeTabla} fixed wrap={false}>` en el Gestor.
- **Arreglo propuesto:** una sola tabla de plantilla con la cabecera `fixed`, la cola pegada al total y filas `wrap={false}`. La mejor base es `TablaDelAsesor`.
- **Confianza:** confirmado en el código.

#### INF-22 · Informe interno: saltos forzados y bloques indivisibles que pueden dejar hojas casi vacías
- **Gravedad:** media
- **Categoría:** informes
- **Dónde:** `internalPortfolioReportPdf.tsx:1118` (`<View break>`), l.1436 (`wrap={false} break`), l.1221 y 1237. El comentario de la l.1839 cuenta un aplastamiento con 37 posiciones.
- **Qué pasa:** con pocas posiciones, la hoja anterior a un salto forzado queda casi vacía. Con muchas, un bloque `wrap={false}` más alto que una hoja se monta sobre lo anterior.
- **Cómo reproducirlo:** generar el informe interno con 3 posiciones y con 40.
- **Evidencia:** las líneas citadas. El propio código dice en las l.1026 y 1385 que otros saltos se quitaron por esto.
- **Arreglo propuesto:** `minPresenceAhead` en lugar de `break`, y una prueba de páginas con 3 y con 40 posiciones.
- **Confianza:** sospecha.

#### INF-23 · La propuesta de mejora no lleva cabecera, portada ni autor, y su identidad no es ninguna de las dos
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `improvementProposalPdf.tsx:45-74` y 116.
- **Qué pasa:** es el único PDF sin cabecera y sin `author`, con títulos de 30 y 18 pt y fondo `#FFFEFC`. Se incrusta en el informe interno como sección 8.2, que tiene otro estilo, así que la misma propuesta se ve de dos maneras.
- **Cómo reproducirlo:** Mejorar cartera › «Exportar propuesta (PDF)», y el informe interno con la propuesta guardada.
- **Evidencia:** `page: { … color: "#243747", backgroundColor: "#FFFEFC" }`.
- **Arreglo propuesto:** pasarla a la variante interna de la plantilla.
- **Confianza:** confirmado en el código.

#### INF-24 · Faltan metadatos de idioma, y el autor del PDF es una entidad
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:**
  - Sin `language`: `informeDeClientePdf.tsx:1542`, `internalPortfolioReportPdf.tsx:2223`, `comparePdf.tsx:458`, `assetComparePdf.tsx:389`, `fichaDeActivoPdf.tsx:446`, `realPortfolioPdf.tsx:800` y `weeklyReportPdf.tsx:119`.
  - Lo llevan: costes, jubilación, propuesta de cambio, seguimiento, propuesta de mejora y Gestor.
- **Qué pasa:** un lector de pantalla lee el PDF con la voz por defecto, normalmente en inglés. `author` dice la entidad y no el asesor. Ningún PDF va etiquetado: `@react-pdf` 4 no genera PDF/UA.
- **Cómo reproducirlo:** propiedades del documento en Acrobat.
- **Evidencia:** `<Document title={…} author="Independent Private Bankers">`.
- **Arreglo propuesto:** el componente de documento de la plantilla, con `language="es"`, autor igual al asesor y `creator` igual al nombre del programa.
- **Confianza:** confirmado.

#### INF-25 · Seis convenciones de nombre de fichero, y varios no dicen de qué cliente son
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:**

  | Patrón | Documento | Fichero y línea |
  |---|---|---|
  | `informe-<cliente>.pdf` | Informe de cliente | `informeDeClientePdf.tsx:1792` |
  | `informe-completo-interno-<cartera>.pdf` | Interno | — |
  | `comparativa-<a>-vs-<b>.pdf` | Comparativa de carteras | `comparePdf.tsx:568` |
  | `uso-interno-comparativa-activos-….pdf` | Comparativa de activos | `assetComparePdf.tsx:587` |
  | **`informe-de-costes.pdf`**, fijo | Costes | `costsPdf.tsx:264` |
  | **`Ficha_<ISIN>_<fecha>.pdf`** | Ficha | `fichaDeActivoPdf.tsx:104` |
  | **`informe-de-jubilacion.pdf`**, fijo | Jubilación | `jubilacionPdf.tsx:502` |
  | `rendimiento-cartera-real-<fecha>.pdf` | Rendimiento real | — |
  | `estrategia-semanal-<fecha>.pdf` | Estrategia | — |
  | **`Informe del cliente - <cartera> - <desde> a <hasta>.pdf`**, con espacios y mayúsculas | Gestor | `gestor/informes/nombres.ts:31` |
  | `cartera.csv` y `resumen_fondos_cesion.csv`, con guion bajo | CSV | — |

  Además, `[^\w.-]` convierte las tildes en guiones («Áurea» → `-urea`) en comparativa, activos, interno y propuesta de mejora. Propuesta de cambio y seguimiento usan `\p{L}` y las conservan.
- **Qué pasa:** en la carpeta de descargas, dos informes de costes o de jubilación de clientes distintos se pisan o salen como `(1)`.
- **Cómo reproducirlo:** descargar dos informes de jubilación seguidos.
- **Evidencia:** `anchor.download = "informe-de-costes.pdf";`.
- **Arreglo propuesto:** una sola función de nombre, la de `gestor/informes/nombres.ts`, con saneado para Windows, y siempre con tipo, cliente o cartera, y fecha.
- **Confianza:** confirmado.

#### INF-26 · La descarga se reimplementa 18 veces y 12 sueltan el enlace en el acto
- **Gravedad:** baja
- **Categoría:** funcional
- **Dónde:**
  - `revokeObjectURL` inmediato: `informeDeClientePdf.tsx:1798`, `internalPortfolioReportPdf.tsx:2272`, `comparePdf.tsx:569`, `assetComparePdf.tsx:599`, `fichaDeActivoPdf.tsx:548`, `propuestaDeCambioPdf.tsx:316`, `seguimientoPeriodicoPdf.tsx:103`, `realPortfolioPdf.tsx:1073`, `weeklyReportPdf.tsx:249`, `PortfolioBuilder.tsx:759`, `positionsShared.ts:105` y `AdminRetrocessions.tsx:136`.
  - A los 60 s: costes, jubilación, propuesta de mejora, Gestor, plantilla y almacén.
- **Qué pasa:** el propio `gestor/almacen/descarga.ts:35` advierte de que «algunos navegadores leen la URL tras devolver `click()`». En `PortfolioBuilder` y `positionsShared` el enlace ni siquiera se añade al documento. Puede fallar una descarga en silencio.
- **Cómo reproducirlo:** depende del navegador; probar en Safari y Firefox.
- **Evidencia:** `anchor.click(); anchor.remove(); URL.revokeObjectURL(url);`.
- **Arreglo propuesto:** una sola `descargar(blob, nombre)` en `core/`, la de `gestor/informes/index.ts`.
- **Confianza:** sospecha (depende del navegador).

#### INF-27 · Piezas reimplementadas en cada informe
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:**

  | Pieza | Veces | Implementaciones |
  |---|---|---|
  | Página con cabecera | 11 | — |
  | Pie | 11 | `PieDeHoja`, `Chrome`, `Footer` ×2, `Sheet`, los pies en línea de activos, ficha y estrategia, informe de cliente y Gestor ×2 |
  | Tabla | 12 | — |
  | Cifra destacada | 8 | `Kpi`, `Cifra`, `KpiGrid`, `MetricBox`, la tira del informe de cliente, `Cifras`, `Rejilla` y la respuesta de jubilación |
  | Gráfico de líneas | 7 | — |
  | `sinPartir` | 10 | Con 2 comportamientos distintos |
  | `SELLO` | 6 + 3 | 6 definiciones y 3 literales |
  | `localFontSource` | 2 | — |
  | Algoritmo de marcas del eje | 2 | — |
  | Estimador de alto de texto | 7 | `porAlto`, `lineasDe`, `lineasDelNombre`, `altoDeMasEnLaPortada`, `wrappedLines`, `altoDelGrafico`, `altoDeLaGuia` |
  | Descarga | 18 | — |

  Además, `comparePdf.tsx:187-217` es una copia literal de los estilos de `papelDeCliente.tsx:39-58`, y `gestor/papel/cliente.tsx` reescribe `Hoja`, `Pie` y `Tabla` solo para quitar el sello.
- **Qué pasa:** cada arreglo, ya sea un glifo, el pie o la cabecera repetida, hay que hacerlo diez veces, y por eso unos informes lo tienen y otros no (INF-06, INF-21).
- **Cómo reproducirlo:** —
- **Evidencia:** `grep -rn "const sinPartir" src/reports src/gestor/informes` devuelve 10 resultados.
- **Arreglo propuesto:** el apartado E.
- **Confianza:** confirmado.

#### INF-28 · Letra por debajo de 6 pt
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `internalPortfolioReportPdf.tsx`, ejes a 5,8 y matriz entre 4,4 y 6,2; ejes del informe de cliente a 5,7.
- **Qué pasa:** se lee mal impreso, sobre todo la matriz con 25 o más posiciones.
- **Cómo reproducirlo:** imprimir la hoja 7 del informe interno.
- **Evidencia:** los tamaños citados, según la lectura del subagente.
- **Arreglo propuesto:** mínimo de 6,3 pt en la escala de la plantilla.
- **Confianza:** confirmado.

#### INF-29 · Excel del Gestor: el filtro de la hoja Resumen abarca la ficha y los puntos se guardan como porcentaje
- **Gravedad:** baja
- **Categoría:** informes
- **Dónde:** `gestor/informes/excel/libro.ts:39`; `excel/resumen.ts:19-20, 34-41`.
- **Qué pasa:** el autofiltro va de A1 a la última fila, así que filtrar las métricas esconde las filas «Cartera», «Cliente» y «Periodo» que van debajo. La diferencia con la referencia, en puntos, se formatea como «1,23 %».
- **Cómo reproducirlo:** abrir el Excel y filtrar la columna «Valor».
- **Evidencia:** `hojaDeCalculo["!autofilter"] = { ref: \`A1:${…r: filas.length - 1…}\` }`.
- **Arreglo propuesto:** limitar el filtro a la tabla de métricas y dar a los puntos un formato `0.00" p.p."`.
- **Confianza:** confirmado.

#### INF-30 · Rendimiento: fuentes y registro
- **Gravedad:** baja
- **Categoría:** rendimiento
- **Dónde:**
  - `src/assets/fonts/`: Fraunces ×3 (219 KB), Roboto Flex ×3 (290 KB), Instrument ×3 (113 KB) y Newsreader ×2 (100 KB); unos 722 KB en total.
  - `clientReportTheme.ts:76`: registra las fuentes al importarse.
  - `pdfTheme.ts:292, 301`: el peso 700 es el mismo fichero que el SemiBold.
- **Qué pasa:**
  - La carga es diferida en todos los informes, con `import()` desde la pantalla, y eso está bien.
  - Pero importar `papelDeCliente` registra fuentes como efecto lateral.
  - Cada informe vuelve a registrar sus familias (`refresh…Fonts`).
  - `realPortfolioPdf` pide 700, que sale igual que 600.
  - Mantener dos papeles con cuatro familias duplica el peso para nada.
- **Cómo reproducirlo:** —
- **Evidencia:** `registerClientReportFonts();` a nivel de módulo.
- **Arreglo propuesto:** una sola pareja de familias para las dos variantes; registro explícito y no al importar.
- **Confianza:** confirmado.

#### INF-31 · Comparativa de carteras: «Valores en euros» bajo un gráfico en base 100
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `comparePdf.tsx:489`.
- **Qué pasa:** el eje dice 100, 110…, y la nota dice «Valores en euros». Se refiere a la divisa de cálculo, pero se lee como si el eje fuera en euros.
- **Cómo reproducirlo:** hoja 01 de la comparativa.
- **Evidencia:** `{history.rangeLabel} · {history.a.length} observaciones comunes · Valores en euros`.
- **Arreglo propuesto:** «Base 100, calculado en euros».
- **Confianza:** confirmado.

#### INF-32 · Informe de cliente: los importes por posición pueden no sumar el total
- **Gravedad:** baja
- **Categoría:** cálculo
- **Dónde:** `informeDeClientePdf.tsx:1612` y 1621.
- **Qué pasa:** cada importe es `capital*peso/100` redondeado al euro, y el total es el capital. La columna puede no sumar por uno o dos euros, sin la nota que sí lleva costes (`costsPdf.tsx:233`).
- **Cómo reproducirlo:** capital 100.000 € con 7 posiciones de pesos no redondos.
- **Evidencia:** los dos `fmtEuro` de las líneas citadas.
- **Arreglo propuesto:** la nota de redondeo en la plantilla de fila de total.
- **Confianza:** confirmado.

#### INF-33 · Rendimiento real: la fecha puede salir en ISO crudo y la tabla de clases está duplicada
- **Gravedad:** baja
- **Categoría:** código
- **Dónde:** `realPortfolioPdf.tsx:218-221` (`formatDate`) y l.227-238 (`classLabel`, frente a `core/labels`).
- **Qué pasa:** una fecha que no se puede leer se imprime tal cual en vez de decir que falta. Los rótulos de clase no coinciden con los de la pantalla.
- **Cómo reproducirlo:** —
- **Evidencia:** según la lectura del subagente.
- **Arreglo propuesto:** usar el formato y las etiquetas comunes.
- **Confianza:** confirmado.

#### INF · Lo que está bien
Conviene conservar en el rediseño:

- **Carga diferida.** Todos los generadores y `xlsx` se cargan con `import()` al pulsar el botón, y no hay `@react-pdf` en la carga inicial.
- **Arquitectura del Gestor.** Registro de secciones con `procede` y `comienzo`, la regla «una sección no calcula», el Excel con celdas numéricas de verdad y vacío donde falta, y los nombres de fichero saneados para Windows. Es la mejor base para la plantilla.
- **Saneado de glifos medido.** `pdfTheme.safeText` y `papelDeCliente.textoAjeno` están medidos con fontkit y tienen pruebas (`pdfSafeText.test.ts`).
- **Mismo modelo que la pantalla.** La ficha, jubilación, la propuesta de cambio, el seguimiento y el Gestor imprimen el mismo modelo que la pantalla y no recalculan.
- **Modo cliente respetado.** La ficha recibe el modelo ya filtrado, la comparativa de activos tiene salida cliente sin retrocesión y la estrategia oculta el proveedor.
- **Tablas que no se cortan mal.** Cabecera repetida, cola pegada al total y `minPresenceAhead` en los títulos (interno y Gestor).
- **Defensa contra el «segundo PDF sin letras».** Se olvidan y se vuelven a registrar las familias en cada documento.

#### INF · Lo que no se ha podido mirar
- **Ningún PDF generado.** Los hallazgos de paginación (INF-02, 03, 12, 21 y 22) son lecturas del código; habría que generarlos con carteras de 3, 20 y 40 posiciones y nombres largos.
- **Lectura parcial delegada.** `internalPortfolioReportPdf.tsx`, `realPortfolioPdf.tsx`, `informeDeClientePdf.tsx` y `jubilacionPdf.tsx` los leyeron enteros dos subagentes, y sus citas de línea se recogen tal cual; el resto lo he leído yo. No he releído esas cuatro líneas a línea.
- **Pruebas.** No he ejecutado ninguna prueba de `tests/` (`pdfReports`, `pdfPagination`, `informesPdf`…); solo he leído las afirmaciones relacionadas con la firma por defecto.
- **Accesibilidad real del PDF.** Etiquetado, orden de lectura y texto alternativo de los gráficos no se pueden ver sin abrir el fichero en un lector.
- **Contraste medido.** Hay pruebas de contraste de la paleta (`contrastePaleta.test.ts`), pero no se ha medido el contraste de los colores escritos a mano (INF-17).
- **Cifras pantalla frente a papel.** INF-20 queda en sospecha: no se han comparado los números de las dos salidas.

### DIR · Recorrido en el navegador, pruebas a mano y medidas

#### DIR-01 · Crear una cartera con la tecla Intro deja reabierto el diálogo «Nueva cartera»
- **Gravedad:** media
- **Categoría:** funcional
- **Dónde:** `src/gestor/ui/GestorDeCarterasPage.tsx:62`; `src/core/useAccessibleDialog.ts` (devolución del foco al cerrar)
- **Qué pasa:** el campo «Nombre de la cartera» crea la cartera en `onKeyDown` de Intro sin anular la tecla. El diálogo se cierra, el foco vuelve al botón que lo abrió y la misma pulsación de Intro activa ese botón: el diálogo se abre otra vez, tapado por la cartera recién creada. Al volver a «Todas las carteras» aparece abierto sin que nadie lo haya pedido; otro Intro con un nombre escrito crearía una segunda cartera.
- **Cómo reproducirlo:** Gestor de carteras → «Crear una cartera» → escribir un nombre → Intro → «← Todas las carteras». Visto en el navegador el 13-11-2026.
- **Evidencia:** `<input autoFocus … onKeyDown={(evento) => evento.key === "Enter" && crear()} … />`
- **Arreglo propuesto:** convertir el diálogo en un `<form onSubmit>` (o anular la tecla con `preventDefault`) y revisar los demás `onKeyDown` de Intro dentro de diálogos. Prueba: tras crear con Intro, el estado del diálogo queda cerrado y la tecla queda anulada.
- **Confianza:** confirmado en el navegador y en el código

#### DIR-02 · «En qué está invertida» dice una liquidez distinta del efectivo que dice la línea de arriba, sin explicarlo
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/vistas/VistaResumen.tsx` (bloque «En qué está invertida» y línea «… invertidos y … en efectivo»)
- **Qué pasa:** la cabecera del Resumen dice «6.688 € invertidos y 7.995 € en efectivo» y, debajo, el reparto dice «Liquidez 8.036 €» y «Renta variable 6.647 €». Las dos cosas son ciertas (el reparto mira dentro de cada fondo, que guarda algo de liquidez), pero la pantalla no lo dice y un asesor ve dos cifras de efectivo que no coinciden. En la cartera de demostración: 30.620 € de efectivo frente a 34.081 € de liquidez.
- **Cómo reproducirlo:** cualquier cartera con un fondo: comparar la línea bajo «Cuánto vale» con la fila «Liquidez».
- **Evidencia:** captura `docs/frontend/capturas/antes/1440-17-gestor-resumen.jpg`.
- **Arreglo propuesto:** rotular el bloque «En qué está invertida, mirando dentro de cada fondo» y añadir bajo «Liquidez» el apunte «incluye la liquidez que mantienen los fondos». Prueba de texto sobre la vista.
- **Confianza:** confirmado en el navegador

#### DIR-03 · El formulario acepta un precio muy alejado del de mercado sin avisar
- **Gravedad:** media
- **Categoría:** cálculo
- **Dónde:** `src/gestor/ui/dialogos/FormularioDeMovimiento.tsx`; `src/gestor/motor/integridad.ts`
- **Qué pasa:** se puede anotar una suscripción a 160,40 € de un fondo cuyo valor liquidativo ese día ronda los 500 €. La cartera pasa a enseñar una rentabilidad del +46,83 % que nace de un error de tecleo, y nada en la pantalla lo señala. La cuenta es correcta con el dato escrito; lo que falta es el aviso.
- **Cómo reproducirlo:** cartera nueva → aportación de 10.000 € el 02/01/2026 → suscripción de 12,5 participaciones de `LU1883318740` a 160,40 € el 05/01/2026. Resultado: +4.682,75 €, +46,83 %. (La valoración, 12,5 × 535,02 € = 6.687,75 €, coincide con la cuenta a mano.)
- **Evidencia:** probado en el navegador el 13-11-2026 contra la base local.
- **Arreglo propuesto:** cuando el activo tiene serie de precios, comparar el precio escrito con el de la fecha de operación y avisar, sin bloquear, si difiere más de un umbral (por ejemplo un 20 %); y añadir la misma comprobación a «Comprobaciones» del análisis. Prueba del motor con una operación a un precio un 70 % por debajo.
- **Confianza:** confirmado en el navegador

#### DIR-04 · La barra superior enseña la «Cartera activa» de Diseño también dentro del Gestor de carteras
- **Gravedad:** media
- **Categoría:** incoherencia
- **Dónde:** `src/app/BdbActivosApp.tsx` (recuadro «Cartera activa» de la barra superior)
- **Qué pasa:** con una cartera del gestor abierta («Cartera de demostración»), la barra superior dice «Cartera activa · 8 posiciones · 100,0 %», que es la cartera de Diseño y no tiene nada que ver con la que el asesor tiene delante. En la app conviven dos objetos que se llaman «cartera» —la que se diseña y la real de un cliente— y la barra solo conoce uno.
- **Cómo reproducirlo:** Diseño de cartera con posiciones → Gestor de carteras → abrir una cartera.
- **Evidencia:** captura `docs/frontend/capturas/antes/1440-17-gestor-resumen.jpg`.
- **Arreglo propuesto:** se resuelve en la arquitectura de información del rediseño: el recuadro dice de qué cartera habla («Propuesta en curso») o solo se enseña en las pantallas de la propuesta.
- **Confianza:** confirmado en el navegador

#### DIR-05 · Pantallas que lo enseñan todo de una vez: hasta 6.700 px de alto
- **Gravedad:** media
- **Categoría:** rendimiento
- **Dónde:** `src/pages/XrayPage.tsx` (Análisis, 6.724 px a 1.440 de ancho), `src/pages/BuscadorNuevoPage.tsx` (6.000 px: 100 filas por página), `src/gestor/ui/vistas/VistaAnalisis.tsx` (4.433 px), ficha de un ETF (4.187 px) y de un fondo (3.780 px), Planes (3.024 px), Diseño · Simular (2.988 px)
- **Qué pasa:** la regla del sistema visual vigente («todo a la vista, nada se despliega») produce pantallas de cuatro a siete alturas de monitor. La respuesta que busca el asesor queda mezclada con el detalle, hay que desplazarse mucho para comparar dos bloques y todo se calcula y se pinta aunque no se mire. En la ficha, la evolución histórica —lo primero que se pregunta de un fondo— es el último bloque.
- **Cómo reproducirlo:** `docs/frontend/capturas/antes/informe.md`, columna «Alto (px)».
- **Evidencia:** medido por el recorrido automático.
- **Arreglo propuesto:** es el eje del rediseño: cada pantalla abre con la respuesta y deja el detalle a un clic (pestañas, secciones plegadas, 25 filas por página).
- **Confianza:** medido en el navegador

#### DIR-06 · El importe que propone el formulario de movimiento sale sin formato español
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/dialogos/FormularioDeMovimiento.tsx` (importe sugerido)
- **Qué pasa:** con 12,5 participaciones a 160,40 el campo «Importe pagado» propone «2005», sin punto de millar ni decimales, al lado de dos campos escritos con coma decimal.
- **Cómo reproducirlo:** Añadir movimiento → Suscripción de fondo → títulos y precio.
- **Evidencia:** valor del campo leído en el navegador: `2005`.
- **Arreglo propuesto:** escribir el importe sugerido con el mismo formato con el que el formulario lee («2.005,00»). Prueba de formato.
- **Confianza:** confirmado en el navegador

#### DIR-07 · «Precio por título» en una suscripción de fondo
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/dialogos/FormularioDeMovimiento.tsx`; definiciones de `suscripcion` y `reembolso` en `src/gestor/motor/movimientos/`
- **Qué pasa:** el formulario de una suscripción pide «Participaciones» y, al lado, «Precio por título». En un fondo el precio es el valor liquidativo y la unidad es la participación.
- **Cómo reproducirlo:** Añadir movimiento → Suscripción de fondo.
- **Evidencia:** captura del formulario, 13-11-2026.
- **Arreglo propuesto:** «Valor liquidativo» en suscripción, reembolso y traspaso; «Precio por título» en acciones y ETF.
- **Confianza:** confirmado en el navegador

#### DIR-08 · «Año en curso» empieza el 31 de diciembre en una cartera y el 1 de enero en otra
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/gestor/ui/vistas/VistaResumen.tsx` y el cálculo del periodo en `src/gestor/ui/estado/`
- **Qué pasa:** con el mismo periodo elegido, la cartera de demostración rotula «Del 31 dic 2025 al 13 nov 2026» y una cartera cuyo primer movimiento es de enero rotula «Del 1 ene 2026 al 13 nov 2026», aunque su primer movimiento es del día 2.
- **Cómo reproducirlo:** abrir la demostración y una cartera nueva con una aportación el 02/01/2026.
- **Evidencia:** textos leídos en el navegador.
- **Arreglo propuesto:** una sola regla para el rótulo: la fecha desde la que se mide (el cierre del año anterior) o, si la cartera empieza después, la de su primer movimiento.
- **Confianza:** confirmado en el navegador

#### DIR-09 · El calendario económico se enseña en inglés y con abreviaturas de la fuente
- **Gravedad:** baja
- **Categoría:** incoherencia
- **Dónde:** `src/components/EconomicCalendarPanel.tsx`
- **Qué pasa:** los eventos salen como los da la fuente («FOMC Member Williams Speaks», «Est 80B», «Prev 1080B»): en inglés, con «B» de *billions* y «Est/Prev», dentro de una aplicación en español. La nota de la curva de tipos escribe una fecha ISO («omitida por fecha antigua 2026-11-11») y empieza una frase en minúscula.
- **Cómo reproducirlo:** Mercado → Tipos y calendario.
- **Evidencia:** captura `docs/frontend/capturas/antes/1440-01-mercado.jpg`.
- **Arreglo propuesto:** rotular «Previsión» y «Anterior», escribir las magnitudes en español («80.000 M») y decir en la procedencia que los nombres de los eventos son los de la fuente; fecha de la nota con el formato común.
- **Confianza:** confirmado en el navegador

#### DIR-10 · Accesibilidad medida con axe: dos reglas incumplidas en 28 pantallas
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `#buscador-tipo-tab-TODOS`, `#posiciones-modo-tab-extracto`, `#planes-tipo-tab-__todos__` (`aria-controls` a un panel que no existe); la lista de definiciones de Mercado → Estrategia (`definition-list`)
- **Qué pasa:** el recorrido con axe-core (WCAG 2.2 AA) sobre las 28 pantallas en reposo solo encuentra cuatro nodos: tres pestañas usadas como filtro que apuntan a un panel inexistente y una lista de definiciones mal anidada. No hay fallos de contraste ni controles sin nombre en reposo. Los diálogos y los estados que piden interacción no entran en esta medida.
- **Cómo reproducirlo:** `docs/frontend/capturas/antes/informe.md`, apartado de accesibilidad.
- **Evidencia:** `aria-valid-attr-value` (crítico, 3 nodos) y `definition-list` (grave, 1 nodo).
- **Arreglo propuesto:** el filtro de producto como grupo de botones de opción y no como pestañas (ver MAR-14 y ACT-10); corregir la lista.
- **Confianza:** medido en el navegador

#### DIR-11 · Peso de los paquetes: cuatro pantallas descargan entre 550 y 720 KiB la primera vez
- **Gravedad:** baja
- **Categoría:** rendimiento
- **Dónde:** `vite.config.ts` (reparto en trozos), `src/firebase.ts`
- **Qué pasa:** la entrada pesa 122 KiB comprimidos y está dentro del presupuesto; el motor de PDF (465 KiB) y el de Excel (154 KiB) se cargan solo al usarlos. Pero la primera visita a Diseño descarga 719 KiB comprimidos, el Gestor 591, Análisis 583 y el Comparador 551, sobre todo por el SDK completo de Firebase (186 KiB) y la biblioteca de gráficos (100 KiB, en un trozo que se llama `SegmentedControl` por accidente).
- **Cómo reproducirlo:** `npm run build` y sumar el cierre estático de cada trozo de pantalla.
- **Evidencia:** medido el 13-11-2026 sobre `dist/assets`.
- **Arreglo propuesto:** dar nombre propio al trozo de gráficos (`recharts`) en `manualChunks`; valorar más adelante el SDK modular mínimo de Firebase. No bloquea.
- **Confianza:** medido

#### DIR · Lo que está bien
- **La aplicación está sana en lo básico.** En 84 capturas (28 pantallas en 1.920, 1.440 y 768 px) no hay ningún desborde horizontal, ningún error ni aviso en la consola y ninguna petición fallida.
- **El punto de partida está en verde:** tipos, 5.407 pruebas, lint, censo de CSS y compilación.
- **Guardar y volver a abrir una cartera del gestor no cambia ninguna cifra** (probado a mano: 14.683 €, +4.682,75 €, +46,83 % antes y después).
- **La valoración del gestor coincide con la cuenta a mano** contra la base local de precios.

#### DIR · Lo que no se ha podido mirar
- Los informes en PDF página a página (se hace al unificar los informes, con cada documento generado y abierto).
- El diálogo del sistema para elegir carpeta y la importación de extractos con ficheros reales desde el navegador automatizado.
- Lectores de pantalla y el modo de contraste forzado de Windows.

### Encontrados en la fase de cierre (14-11-2026)

#### PLA-25 · El nombre se queda sin sitio en la tabla: de cuatro a siete líneas por fila en Planes, en Análisis y en Cuentas
- **Gravedad:** media
- **Categoría:** adaptación (regresión del rediseño)
- **Dónde:** `src/styles/tabla.css` (`.tabla th`, `white-space: nowrap`); `src/pages/PlanesPage.tsx`; `src/adapters/tablaDeComposicion.tsx` (Análisis · Resumen · Posiciones); `src/gestor/ui/vistas/VistaCuentas.tsx`
- **Qué pasa:** al pasar las pantallas a la tabla común, sus títulos de columna no se parten. Cada columna de cifras mide lo que su título («En lo que va de año», «3 años, anualizada») y la del nombre se queda con lo que sobra. En «Planes y EPSV», a 1.440 px, son ochenta píxeles: cada plan ocupa de cuatro a siete líneas, caben 25 planes en 3.445 px de alto (antes del rediseño, 40 en 3.024) y la columna «Comparar» queda fuera de la vista. En el resumen de Análisis, la tabla de posiciones (ocho columnas) vive en dos tercios de la pantalla, 750 px: el nombre mide 185 px y la última columna no se ve. En «Cuentas» de una cartera de cliente, a 768 px, el nombre mide 102 px.
- **Cómo reproducirlo:** abrir Planificación › Planes y EPSV a 1.440 px, o `docs/frontend/capturas/antes/1440-24-planes.jpg` frente a la misma pantalla antes de este arreglo.
- **Evidencia:** medido en el navegador: la fila mediana mide 118 px en Planes (1.440), 114 px en Análisis (1.440 y 768) y 132 px en Cuentas (768). Nada se desborda y ninguna prueba lo ve: no hay maquetación en las pruebas.
- **Arreglo:** en la pieza, el título de una columna se parte en dos líneas y una columna puede declararse `nombre` (ancho mínimo `--columna-nombre-corta`); en Planes, el nombre no baja de `--columna-nombre-min` y las columnas «solo en ancho» se pliegan hasta 1.800 px; en Análisis, la tabla de posiciones ocupa todo el ancho por debajo de 1.800 px. El recorrido de capturas (`scripts/auditoriaFrontend.mjs`) mide desde ahora las «tablas apretadas» (fila mediana de 96 px o más).
- **Confianza:** medido en el navegador

#### GES-29 · Las tablas de Carteras de clientes que desplazan en horizontal no se alcanzan con el teclado
- **Gravedad:** media
- **Categoría:** accesibilidad
- **Dónde:** `.gestor-tabla-envoltorio` en `src/gestor/ui/analisis/BloqueMeses.tsx`, `comparar/TablaComparada.tsx`, `dialogos/DialogoDeVersiones.tsx`, `importar/PasoComprobacion.tsx` e `importar/PasoRevision.tsx`
- **Qué pasa:** a 1.024 px la tabla de rentabilidad por meses (catorce columnas) no cabe y su envoltorio desplaza. No se podía enfocar: quien no usa ratón no llegaba a las columnas de la derecha (WCAG 2.1.1).
- **Cómo reproducirlo:** Clientes › una cartera › Análisis, a 1.024 px, con el teclado.
- **Evidencia:** axe-core, regla `scrollable-region-focusable` (grave, 1 nodo), en el recorrido a 1.024 px. El recorrido de «antes» pasaba axe solo a 1.440 px, donde la tabla cabe.
- **Arreglo:** `role="group"`, `aria-label` y `tabIndex={0}` en los cinco envoltorios, como `TablaDeDatos`.
- **Confianza:** medido en el navegador

#### PLA-26 · Sistema · Calidad de fondos: en tableta, cada fondo ocupa 231 px de alto
- **Gravedad:** baja (pantalla de administración, en el ancho mínimo)
- **Categoría:** adaptación
- **Dónde:** `src/components/AdminFundQuality.tsx`; la pieza `src/components/tabla/TablaDeDatos.tsx` y `src/styles/tabla.css`
- **Qué pasa:** a 768 px la tabla reparte el ancho entre seis columnas: el nombre del fondo se queda con 137 px y «Revisión pendiente», que es una lista de motivos, con 150. Cada fondo ocupa diez líneas, 231 px de alto, y la página de 50 fondos mide 11.873 px. Es lo mismo que PLA-25 en la lista de planes, en una pestaña que el recorrido no abría.
- **Cómo reproducirlo:** Datos › Sistema › «Calidad de fondos», a 768 px.
- **Evidencia:** medido por el recorrido el 14-11-2026, la primera vez que abrió esa pestaña: «50 filas, 231 px de alto mediano, primera columna de 137 px».
- **Arreglo:** una columna puede declararse `prosa` y no baja de `--columna-prosa-min` (45 caracteres); el nombre del fondo se declara `nombre`. Con las dos, la tabla desplaza dentro de su marco en vez de apretar.
- **Confianza:** medido en el navegador

#### ACT-26 · Estrategia · Informe completo: los títulos de sección salen a 9 px, más pequeños que su texto
- **Gravedad:** media
- **Categoría:** accesibilidad (legibilidad y esquema del documento)
- **Dónde:** `src/components/MarkdownView.tsx`; `src/pages/StrategyPage.tsx` (`ReportTab`); `.prose` en `src/styles/components.css` y `.strategy-document` en `src/styles/modules.css`; `src/core/textoDeEstrategia.ts`
- **Qué pasa:** el informe de estrategia lo escribe un modelo en Markdown, con todas sus secciones en `###`. El visor bajaba cada nivel del documento tres escalones fijos, así que las secciones salían como `h6`, y la hoja de la prosa no tiene regla para `h6`: el navegador lo pinta al 67 %. En pantalla, «Cierre y lectura de la sesion», «Datos y bancos centrales» y «Agenda y riesgos» medían 9,4 px sobre párrafos de 14. Además: «Riesgos de cola» quedaba pegado al último párrafo; el resumen del informe se leía dos veces en la misma pantalla, arriba y como cita al empezar el texto; y el primer título del informe diario salía sin tilde («sesion»), porque la corrección solo conocía los cuatro del semanal.
- **Cómo reproducirlo:** Mercado › Estrategia › «Informe completo», en el diario y en el semanal.
- **Evidencia:** medido en el navegador el 14-11-2026: `h6`, 9,38 px, peso 600; párrafos de 14 px; esquema `h2 → h6`. El recorrido de capturas no abría esta vista (se llega pulsando, no por la dirección) y ninguna revisión la había mirado.
- **Arreglo:** `MarkdownView` sube el título más alto del documento al nivel pedido (`nivel`, 3 dentro de un bloque) y baja los demás de uno en uno, sin pasar de `h6`; `.prose h5` y `.prose h6` llevan el tamaño del texto base; el documento es una pila con aire entre el texto, los riesgos y las fuentes, y sus tres clases de título miden lo mismo; la cita repetida se quita; «Cierre y lectura de la sesion» entra en la tabla de títulos con tilde, en pantalla y en papel. El recorrido (`scripts/auditoriaFrontend.mjs`) abre desde ahora las cuatro vistas de Estrategia que no fotografiaba, y mide la letra por debajo de 12 px.
- **Confianza:** medido en el navegador

#### ACT-27 · Ficha de un ETF · Documentos y datos: un valor largo no se parte y se sale 98 px de la página
- **Gravedad:** media
- **Categoría:** adaptación (desborde horizontal)
- **Dónde:** `.ficha__fila` y `.ficha__valor` en `src/styles/ficha.css`
- **Qué pasa:** en «Qué se puede hacer con él», la fila «Se puede medir su alfa» lleva como valor una frase: «+0,15 % a 1 año · del proveedor, contra el índice de su categoría». El valor de una fila no se partía (`white-space: nowrap`, pensado para cifras), así que la frase se salía del bloque y de la página, y dejaba el rótulo en una palabra por línea.
- **Cómo reproducirlo:** Buscador › un ETF con alfa del proveedor (IE00B4L5Y983) › «Documentos y datos», a 1.440 px.
- **Evidencia:** medido en el navegador el 14-11-2026: la página mide 1.538 px de ancho en una ventana de 1.440. El recorrido solo abría el Resumen de la ficha de un ETF.
- **Arreglo:** la fila reparte `minmax(25%, 1fr) minmax(0, auto)` y el valor ya no lleva `nowrap`: una cifra no se parte porque el módulo de formato pone un espacio duro delante de su unidad, y una frase sí. Las demás filas de las trece pantallas de ficha del recorrido no cambian.
- **Confianza:** medido en el navegador

#### ACT-28 · Estrategia · Informe completo: los enlaces de las fuentes miden 15 px de alto y van pegados
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `.strategy-sources` en `src/styles/modules.css`
- **Qué pasa:** «Fuentes consultadas» es una lista de hasta doce enlaces sueltos, uno por línea, de 15 px de alto y sin separación: con el dedo, en una tableta, se da al de al lado (WCAG 2.2, 2.5.8: 24 px).
- **Cómo reproducirlo:** Mercado › Estrategia › «Informe completo», al final.
- **Evidencia:** axe-core, regla `target-size` (grave, 12 nodos), el 14-11-2026, la primera vez que el recorrido abrió esa vista.
- **Arreglo:** el enlace es un bloque en línea de alto `--control-xs` (26 px).
- **Confianza:** medido en el navegador

#### MAR-33 · La banda de cifras, por debajo de 1.440 px: una cifra larga no cabe en su casilla y toca la de al lado
- **Gravedad:** media
- **Categoría:** adaptación
- **Dónde:** la pieza Respuesta: `.respuesta__dato` en `src/styles/components.css`
- **Qué pasa:** cada dato de la banda tenía un ancho mínimo fijo (128 px, con 24 de relleno a cada lado: 80 de contenido), igual para una cifra corta que para una larga, y la cifra no se parte. En cuanto la casilla medía menos que su cifra, la cifra se metía en el relleno y, si era larga, cruzaba el filete. En la ficha de una acción a 768 px, «350,69 USD» se salía 40 px y se leía «350,69 USD+35,40 %».
- **Cómo reproducirlo:** Buscador › Apple Inc. (US0378331005), a 768 px. O la ficha de un fondo a 1.024 px.
- **Evidencia:** medido en el navegador el 14-11-2026, antes del arreglo. A 768 px: la ficha de la acción («350,69 USD», +40 px), las de fondo y ETF (+13 px) y Análisis (+13 px). A 1.024 px: las fichas de fondo y ETF, hasta +23 px con seis datos en una fila. A 1.280 px: las mismas, +7 px. La banda recorta lo que sale de ella, así que no contaba como desborde, y las capturas hay que mirarlas de cerca para verlo.
- **Arreglo:** `min-width: min-content` en el dato (su contenido incluye la cifra entera, que no se parte), con el ancho mínimo de siempre en el rótulo; y el relleno lateral pasa a un token, `--respuesta-relleno`, que baja de 24 a 12 px entre 1.440 y 1.200 px de ancho. A 1.440 px o más no cambia nada.
- **Confianza:** medido en el navegador

#### MAR-32 · Los bloques son `h3` bajo el `h1` de la página: se salta un nivel de encabezado
- **Gravedad:** baja
- **Categoría:** accesibilidad
- **Dónde:** `src/components/ui/Panel.tsx` (el título de un bloque es `h3` salvo que se pida `h4`); `src/components/ui/SegmentedTabs.tsx` (`PanelDePestana` no lleva encabezado)
- **Qué pasa:** el título de la página es el `h1` y cada bloque es un `h3`; el `h2` queda reservado a «una subvista», pero las pestañas no ponen ninguno. Quien recorre la página por encabezados pasa del nivel 1 al 3. Es lo mismo que ACT-18 encontró en la ficha, que sí se ha corregido (sus secciones son `h2`), en el resto de pantallas.
- **Cómo reproducirlo:** recorrer cualquier pantalla por encabezados con un lector de pantalla; o el recorrido automático antes de este arreglo, que contaba 35 de 48 pantallas con salto a 1.440 px.
- **Evidencia:** medido por el recorrido automático, que desde el 14-11-2026 cuenta los saltos de más de un nivel entre encabezados visibles. axe lo llama `heading-order` y lo clasifica como buena práctica, fuera de las reglas A y AA.
- **Arreglo:** el título de un bloque es `h2` y el de un bloque anidado, `h3` (la pieza Panel lo decide con `nivel`); los vacíos, el título de un diálogo y los encabezados escritos a mano siguen la misma escalera. La hoja viste cada título por su clase y no por su etiqueta, así que no cambia nada de lo que se ve. Después: 0 de 68 pantallas con salto (`docs/frontend/capturas/despues/informe.md`, apartado «Saltos de nivel entre encabezados»).
- **Confianza:** medido en el navegador

#### DIS-29 · El generador de borradores calla por qué no puede generar: enseña la frase común del código y no el motivo del servidor
- **Gravedad:** baja
- **Categoría:** estado
- **Dónde:** `src/components/GeneradorDeBorrador.tsx` (`generar`)
- **Qué pasa:** cuando el servidor rechaza la petición con un motivo (su `failed-precondition`), el adaptador guarda las palabras del servidor en el detalle del error y pone como mensaje la frase común de ese código. El generador enseñaba el mensaje: «La operación no se puede ejecutar en el estado actual de los datos», sin decir qué datos ni por qué. Las demás pantallas que reciben ese rechazo (Análisis, la comparativa, los informes) sí enseñan el motivo.
- **Cómo reproducirlo:** en local, Propuestas › Diseño con la propuesta vacía › «Generar borrador». El entorno local trabaja con la base de siempre y el generador necesita la nueva.
- **Evidencia:** lo vio Óscar el 14-11-2026 al probar la rama en local. Medido en el navegador: el servidor contesta 400 con «El generador necesita la base nueva: la base de siempre no guarda el patrimonio de los fondos», y la pantalla enseñaba la frase común. La prueba que había («el error del servidor se dice tal cual») lanzaba un error suelto, no el que fabrica `toAppError` con la respuesta de la Function, y por eso pasaba.
- **Arreglo:** con ese rechazo, el generador enseña el motivo del servidor (`motivoDelServidor`), como las demás pantallas; en Modo cliente se queda la frase común, porque el motivo es cocina del asesor. Que el generador no trabaje en local no es un defecto: es así por diseño.
- **Confianza:** medido en el navegador
