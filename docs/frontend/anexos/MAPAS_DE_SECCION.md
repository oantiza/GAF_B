# Mapas de sección: qué responde cada pantalla y qué confunde

*Anexo de la auditoría del 13-11-2026. Para cada pantalla: la pregunta que responde, sus bloques en orden, sus acciones y lo que resulta confuso, escondido, sobrante o mal colocado para quien la ve por primera vez. Es la base de la arquitectura de información de `SISTEMA_DISENO.md`. Rutas relativas a `3-BDB-ACTIVOS_app`.*

## Activos y Mercado

**Buscador** (`/buscador`)
- **Pregunta:** ¿qué hay en el catálogo que encaje con lo que busco, y cómo se comparan sus cifras básicas?
- **Bloques, en orden:** cabecera; mandos (buscar, Producto, Clase de activo, Región dominante, Categoría, Solo favoritos, Limpiar, recuento con fecha de la base); Mesa de trabajo (contadores y «Comparar» / «Abrir cartera»); una nota sobre la divisa de las cifras; la tabla paginada de 80 (Activo, Categoría o sector, Divisa, Rentabilidad, Volatilidad, Sharpe 1 año, Coste, Patrimonio, Datos disponibles, y estrella / Añadir / Comparar).
- **Acciones:** abrir la ficha, marcar favorito, añadir a cartera, marcar para comparar, ordenar y pasar de página.
- **Confuso:** el aviso de que las cifras se agrupan por método sale en la descripción de la página, antes de que el asesor haya ordenado nada; dos «Comparar» con efectos distintos; la Mesa de trabajo, entre los filtros y la tabla, separa a ambos.
- **Escondido:** que Rentabilidad y Volatilidad son de 1 año solo se ve en la cabecera, y no hay forma de ver 3 o 5 años.
- **Sobrante para un primer uso:** la nota de divisas, que sobraría si la cabecera lo dijera.

**Ficha de activo** (`/activo/<ISIN>`)
- **Pregunta:** ¿qué es este activo, qué puedo hacer con él y de dónde sale cada cifra?
- **Bloques, en orden:** vuelta; cabecera (tipo, nombre, identificación, disponibilidad y botones Añadir / Comparar / PDF); tira «Qué puedes hacer con él»; avisos; secciones estrechas en columnas (unas 12 en un fondo, 4 en una acción); banda ancha con las secciones largas y, al final, la evolución.
- **Confuso:** la evolución, que es lo primero que mira un asesor delante de un cliente, va al final de todo; la tira de aptitudes («Comparar su coste», «Entrar en una radiografía»…) habla el idioma de la base, no el del asesor.
- **Escondido:** los fundamentales llegan tarde y sin aviso (ACT-08).
- **La ficha anterior** (8 activos) es otra pantalla con pestañas y otro vocabulario: conviene decidir si sobrevive.

**Comparador** (`/comparador`)
- **Pregunta:** ¿cuál de estos 2 a 5 activos encaja mejor, y en qué se parecen?
- **Bloques, en orden:** cabecera con PDF; tres pestañas (Comparar activos, Comparar carteras, Patrimonial); Selección (chips con «A cartera» y «×», el botón del listado modal y «Añadir activos», que abre el selector dentro del panel); tabla de métricas; evolución en base 100 con periodo, frecuencia y cartera de referencia; mapa de riesgo y rentabilidad; correlación.
- **Mal colocado:** «Patrimonial» (TIR frente a Letras o un depósito) no compara activos ni carteras, y pide sus propias entradas: no pertenece aquí. Dos formas de añadir activos (el selector y el listado modal) con filtros compartidos e invisibles.
- **Escondido:** el periodo elegido solo cambia el gráfico y la correlación, no la tabla.
- **Falta:** el coste corriente en la tabla (ACT-09).

**Mercado** (`/mercado`)
- **Pregunta:** ¿qué pasa en los mercados esta semana que deba contar a mis clientes?
- **Pestañas:** «Tipos y calendario» (tipos del BCE, curva del euro, calendario económico con filtro de impacto), «Dividendos» (fechas ex del IBEX), «Resultados» (BPA del IBEX) y «Estrategia» (un informe con su propio selector Diario/Semanal y otro nivel de vistas: Resumen, Asignación, Informe completo).
- **Confuso:** «Estrategia» es un producto editorial, con PDF, compartir y publicar, metido como cuarta pestaña de un panel de datos; su cabecera repite título y acciones dentro de Mercado. Tipos, curva y calendario comparten pestaña con nombres que no se ven desde el menú.
- **Escondido:** la pestaña no va en la dirección (ACT-17); Dividendos y Resultados son solo del IBEX 35, y eso solo se lee en el título del panel.

**Salud del catálogo** (`/salud-catalogo`, solo administrador)
- **Pregunta:** ¿dónde compensa invertir esfuerzo de datos?
- **Bloques, en orden:** cifras; lo que falta en todos; lo que falta en muchos; para qué sirve el catálogo; avisos de la base.
- **Para un asesor:** no es una pantalla suya, sino del equipo de datos, y está bien fuera del menú. Usa rutas de campo crudas (`declared/size.aum`), sin explicar qué dato es.
- **Duplicado:** «Estado del catálogo», en Sistema, cuenta cosas parecidas con otra lectura; convendría que las dos fueran una sola pantalla de datos.

## Diseño de cartera, Carteras guardadas y Posiciones

### Diseño de cartera (`/cartera`)
- **Pregunta:** ¿qué cartera le propongo a este cliente y está bien construida?
- **Bloques, en orden:** cabecera (nombre o «Diseño de cartera», recuento, estado de guardado; Guardar, Guardar como…, Importar cartera, Más acciones: costes, alternativas, CSV) → nota → «Empieza tu cartera» si está vacía (Buscador · importar · generar borrador) → pestañas Componer · Comprobar · Optimizar · Simular → **Componer:** barra (nombre, capital, perfil de riesgo, horizonte, suma, modo Libre/Proporcional, Normalizar, Nueva cartera) → «Riesgo y rentabilidad» (frontera + métricas) → tabla de posiciones → «Añade dinero y reparte» → lateral (reparto por clase, renta variable por región, estado). **Comprobar:** validación, perfil elegido, mercado objetivo, restricciones, sectores, análisis. **Optimizar:** optimizador, cambios aplicados, fondos equivalentes, comprobación previa. **Simular:** reparto por clase, simulación histórica y proyección, comparativa.
- **Confuso o mal colocado:** la frontera sale tres veces (Componer, Optimizar, Simular) con ventanas distintas; la barra de Componer mezcla datos de la cartera (nombre, capital, perfil, horizonte) con herramientas de edición (modo, Normalizar) y una acción destructiva (Nueva cartera); «Perfil de riesgo» (cartera) y «Perfil elegido» (sesión) están en pasos distintos y parecen lo mismo; la edición por clase está en Simular; «Fondos equivalentes» y «Buscar alternativas» (menú) son dos puertas a la sustitución; Comprobar tiene seis paneles sin jerarquía; el informe está en «Siguiente» solo desde Simular y en el aviso tras optimizar.
- **Escondido:** Sustituir y costes en «Más acciones»; la aportación debajo de la tabla; la comprobación previa al final de Optimizar.
- **Sobrante:** «Comprobación previa» repite lo que dice el resultado del optimizador; «Estado» del lateral repite parte de Comprobar.

### Carteras guardadas (`/carteras-guardadas`)
- **Pregunta:** ¿qué carteras tengo y cuál abro o comparo?
- **Bloques:** cabecera (dónde se guardan y qué guardan) → avisos (aviso, ilegibles, error de lista, error de catálogo, marcada para comparar) → tabla (Cartera, Posiciones, Capital, Perfil, Horizonte, Guardada; en ancho: Suman, Fuera del catálogo, Sectores declarados; Abrir · Comparar · Eliminar) → pie (recuento) → radiografía de la elegida, debajo.
- **Acciones:** abrir (con aviso si Diseño tiene cambios), comparar dos (marca una, pulsa otra), eliminar con confirmación, ver radiografía pulsando el nombre.
- **Confuso:** «Comparar» funciona en dos pasos sin que el botón lo diga hasta la primera pulsación; la radiografía aparece debajo de la tabla y desplaza la página; no se ve cuál es la cartera abierta en Diseño.
- **Falta:** duplicar, renombrar, buscar; marcar la cartera abierta.

### Posiciones (`/posiciones`)
- **Pregunta:** ¿qué hay en este extracto, cuánto cuesta y cuánto retrocede? (Extracto externo); ¿cuánto suma cada fondo en el conjunto de mis clientes? (Posiciones globales).
- **Bloques:** cabecera → pestañas de modo → «Cargar posiciones» (cuadro, fichero, Analizar) → avisos → resumen de la importación con confirmación → KPI → «Filtrar y exportar» (buscar, estado, coeficiente de cesión, Llevar a Diseño, Excel, CSV, Nueva carga) → nota de traspaso, no reconocidas, cobertura → tabla con detalle y alternativas → alternativas homogéneas, debajo → nota al pie.
- **Confuso o mal colocado:** es la tercera puerta para un extracto (Diseño → Importar cartera; Gestor de carteras; Posiciones) con reglas y textos distintos; «Posiciones» es también el título de la tabla de Diseño; «Llevar a Diseño de cartera» está entre los filtros, no junto al resultado; el coeficiente de cesión (comercial) está en «Filtrar»; dos modos con decimales distintos en los importes (0 y 2).
- **Escondido:** las alternativas, que salen al final de la página; «Nueva carga» al lado de las exportaciones.

## Análisis e Informes

### Análisis · Visión general
- **Pregunta:** ¿cómo está esta cartera hoy? Rentabilidad y riesgo medidos, si está sana y bien construida, y qué lleva dentro.
- **Bloques, en orden:** cabecera con «Informe de cliente» → pestañas + periodo + cartera de referencia → Rentabilidad y riesgo (4 cifras)
  → Salud y control → Composición de la cartera (tabla) → Clase de activo | Divisa de la clase → Asignación geográfica (mapa) → Estilo,
  sectores y renta fija → Estructura de la cartera (producto, categoría, exposición, concentración, señales) → Mayores acciones → (solo
  asesor) Composición subyacente, diagnóstico de datos, avisos.
- **Acciones:** informe de cliente, periodo, referencia.
- **Confuso:** hay cuatro repartos que se parecen (clase de activo, producto, categoría, exposición agregada) en dos sitios separados por el
  mapa y el estilo. El selector de referencia está a la vista pero ninguna cifra de esta pestaña lo usa. La concentración por posición
  repite la tabla de composición. Faltan las crisis, que sí van al PDF.

### Análisis · Analítica avanzada
- **Pregunta:** ¿cómo se habría comportado frente a su referencia, cómo de diversificada está de verdad y qué fondos se pisan?
- **Bloques:** aviso de matrices limitadas (más de 40) → Evolución histórica + cierre (cartera, referencia, diferencial) + caída máxima →
  «Riesgo y rentabilidad» (frontera + las mismas cuatro cifras de Visión general) → Mapa riesgo/rentabilidad | Matriz de correlación →
  Matriz de solapamiento.
- **Acciones:** ninguna propia (periodo y referencia están en la fila de pestañas).
- **Confuso:** las cuatro cifras salen dos veces con títulos invertidos; la cartera cambia de color en cada gráfico; el mapa no dice qué
  rombo es cada referencia; los fallos salen hasta tres veces; desaparece entera con una sola posición. «Analítica avanzada» no dice qué
  hay dentro: «Frente a la referencia y diversificación» lo diría.

### Informes
- **Pregunta:** ¿qué documentos puedo entregar de esta cartera y qué les falta?
- **Bloques:** cabecera → fila de datos del documento (cartera, capital, cliente, responsable, correo, referencia con propuesta por nivel,
  periodo) → lista «Documentos»: informe de cliente, costes, comparativa, propuesta de cambio, y (asesor) propuesta de mejora e informe
  interno, cada uno con lo que contiene y lo que le falta.
- **Acciones:** un botón por documento, que abre su diálogo (salvo la propuesta de mejora, que descarga directamente).
- **Confuso:** «Descargar…» abre un diálogo con otro «Descargar…». El cuadro de costes se titula «Análisis de costes» y lleva retrocesiones:
  es una pantalla de trabajo, no solo un documento. El *placeholder* del responsable parece un valor. La misma fila de datos se pide otra
  vez, con otros nombres, en el diálogo de Análisis. No hay vista previa de ningún documento: el asesor descarga a ciegas, y la única
  manera de revisar lo que verá el cliente es Análisis, que no enseña lo mismo (ANA-01, ANA-15).

### Diálogo «Análisis de costes»
- **Pregunta:** ¿cuánto le cuesta la cartera al cliente al año, y cuánto le quita con el tiempo?
- **Bloques:** pestañas Costes | Retrocesiones (asesor) → cifras → avisos → tabla por activo → costes de operación → método → comisión de
  gestión → efecto de los costes a 5 y 10 años.
- **Confuso:** es la pantalla más rica en cifras de coste y vive escondida en un diálogo de Informes; la comisión de gestión y el supuesto de
  rentabilidad no se recuerdan al cerrar.

## Gestor de carteras

**Entrada (Gestor de carteras).** Responde «¿dónde están mis carteras y cuál abro?». Bloques: cabecera con «Nueva cartera», «Importar de documentos», «Demostración»; según el estado, primer uso (elegir carpeta, con tres pasos), «Vuelve a abrir tu carpeta», «Trabaja con ficheros» (sin acceso a carpetas) o la tabla «Tus carteras» (cartera, cliente, movimientos, divisa, última modificación); al pie, el enlace «Análisis rápido de extractos». Confuso: «Importar de documentos» pide antes crear una cartera nueva (no importa en una existente, aunque lo parezca); «Cambiar de carpeta» está en el panel y no en la cabecera; no hay papelera ni búsqueda por cliente; el enlace al análisis rápido, en letra pequeña al final, parece una función menor del gestor cuando es otra pantalla con otro motor y otra privacidad.

**Cabecera de una cartera.** Responde «¿qué cartera es y está guardada?». «← Todas las carteras», título, cliente · entidad · divisa, estado de guardado; acciones: «Añadir movimiento», «Importar documentos», «Informes», «Más» (deshacer, rehacer, ajustes, versiones, descargar, retirar). Debajo, pestañas y, solo en Resumen/Análisis/Comparar, el selector de periodo. Confuso: el periodo desaparece en Cuentas y Movimientos sin decir qué fecha usan (y Cuentas hereda el periodo, GES-06); deshacer y rehacer están escondidos en «Más» aunque la confirmación de borrar los remite allí; «Descargar» aparece desactivado en Chrome sin explicación.

**Resumen.** Responde «¿cuánto vale, cuánto ha ganado y en qué está?». Orden: cosas que revisar (si hay), titular (valor y resultado del periodo con su TWR), «De dónde viene el resultado» (precio, ingresos, divisa, costes) con la rentabilidad del cliente, «En qué está invertida» (clases y cinco principales), evolución frente al dinero aportado, últimos ocho movimientos. Bien ordenado. Confuso: dos rentabilidades (la de la cartera en el titular y la del cliente en letra pequeña) sin decir cuál enseñar al cliente; «Cuánto vale» va a fecha de fin del periodo, no necesariamente hoy.

**Cuentas.** Responde «¿qué títulos y qué saldo hay a una fecha, y cuadran con el banco?». Mandos (fecha, criterio operación/valor), cuenta de valores (tabla con coste, latente y total), cuenta de efectivo (saldo por divisa) y extracto de efectivo (15 últimos). Confuso: la conciliación con el extracto del banco, que es lo que aquí se viene a mirar, está en Análisis → Comprobaciones; el criterio «fecha valor» solo afecta al saldo y no a las posiciones, y no se ve; no hay posiciones cerradas (están en Análisis).

**Movimientos.** Responde «¿qué ha pasado y cómo lo corrijo?». Libro con búsqueda, filtros (tipo, activo, origen), aviso de movimientos que no se pueden aplicar, tabla paginada con Editar/Borrar; debajo, importaciones con «Deshacer». Confuso: los errores se ven solo como apunte gris bajo el tipo y no hay filtro «solo con error»; la búsqueda por importe espera «-1234.56», no «1.234,56»; no hay totales por filtro (p. ej. suma de dividendos de un activo).

**Análisis.** Responde «¿cómo ha rendido, frente a qué, con qué riesgo y por qué?». Diez bloques: rentabilidad, referencia (con selector), riesgo, meses (toda la historia), contribución, composición, ingresos y costes, cerradas, bonos, comprobaciones. Orden razonable de lo general a lo particular. Confuso: la tabla de meses ignora el periodo elegido (lo dice, pero es el único bloque que lo hace); «Comprobaciones» al final, cuando en Resumen se presentan como lo primero que hay que mirar; el selector de referencia vive dentro de un bloque y además en Ajustes y en Informes (tres sitios para lo mismo).

**Comparar.** Responde «¿lo ha hecho mejor o peor que otras carteras?». Elegir hasta tres (del gestor, de Diseño), tabla de cinco cifras, notas, evolución en base 100, «Trabajar la cartera en Diseño». Confuso: las elegidas se olvidan al cambiar de pestaña; «Trabajar la cartera en Diseño» no es comparar y está al final de esta pestaña; las de Diseño no comparan euros y la tabla no dice por qué falta esa fila.

**Formulario de movimiento.** Responde «¿cómo apunto esta operación?». Tipo (agrupado) y fecha, descripción del tipo, campos principales, «Detalles opcionales», nota, errores. Confuso: veintiún tipos en un desplegable sin búsqueda; la divisa del efectivo y el tipo de cambio aparecen y desaparecen según el activo; el precio propuesto no sigue a la fecha (GES-05); no hay vista previa de cómo queda la posición o el saldo.

**Selector de activo.** Busca en la cartera y en el catálogo, o crea un activo propio (con condiciones si es bono). Bien resuelto. Confuso: sin flechas de teclado en los resultados; el aviso «No se ha podido leer el catálogo» solo sale tras teclear dos letras.

**Selector de referencia.** Lista de referencias con su descripción llana, «Otro activo del catálogo…», «Sin referencia». Claro. Está repetido en tres sitios (Análisis, Ajustes, Informes).

**Ajustes de la cartera.** Nombre, cliente, entidad (una sola para las dos cuentas), referencia, precios a mano. Confuso: los precios a mano, que son datos de valoración, están mezclados con datos de identidad; no se pueden editar el nombre ni el número de cada cuenta; un precio tecleado sin «Añadir» se pierde (GES-15).

**Informes.** Periodo en curso, aviso de errores, referencia, cuatro documentos con su botón, y «Tus datos en los informes» (nombre, despacho, contacto, logotipo). Confuso: los datos del asesor son globales y están dentro de una cartera; no se puede elegir otro periodo sin cerrar el diálogo; solo avisa de errores, no de avisos (GES-16); en Modo cliente ofrece el informe interno (GES-08).

**Versiones anteriores.** Lista de copias con fecha, movimientos y tamaño; «Ver» enseña tres diferencias (movimientos, activos, último movimiento); «Recuperar esta versión». Confuso: la comparación no dice qué movimientos cambian ni el valor; la regla de los 10 minutos solo aparece en la nota del pie.

**Asistente de importación.** Paso 1, documentos (soltar, reconocer, plantillas); paso 2, revisión (errores, resumen, avisos plegados, activos por decidir, tabla de movimientos con casillas y filtro «solo lo que hay que mirar»); paso 3, comprobación contra el extracto y posiciones iniciales; «Importar N movimientos». Buen flujo. Confuso: la tabla del paso 2 no se pagina (cientos de filas); si los documentos solo traen posiciones se puede llegar al paso 3 pero no importar nada (botón desactivado con 0); cerrar con la X lo pierde todo (GES-15).

**Análisis rápido de extractos (pantalla anterior).** Carga tres exportaciones de Andbank, las analiza en el servidor y enseña rentabilidad, comparación con índices, riesgo, atribución, reconciliación, traspasos y un historial guardado en la base; PDF interno y «seguimiento para el cliente». Lo que hace y el gestor no: el PDF «Seguimiento» y el historial de análisis entre reuniones, y la comparación con varios índices a la vez. Confuso o sobrante: se titula «Rendimiento», usa otro motor (con cifras que difieren medio punto en 2020-2021, según PROGRESO), otro formato de cifras y otro vocabulario (TIR, Sharpe), y no dice que los extractos salen del equipo (GES-09). Para un asesor nuevo son dos respuestas distintas a la misma pregunta en el mismo sitio.

## Planificación y Datos

**Jubilación** (`/jubilacion`). Pregunta: «¿cuánto le queda al cliente al mes y hasta cuándo le llega?».
- Orden: cabecera (Cargar ejemplo / Vaciar, Informe) → avisos → mesa de dos columnas. A la izquierda, cinco paneles de datos: residencia, el cliente, ahorros, EPSV o plan, hipótesis. A la derecha, la respuesta (cifra y líneas), «Hasta cuándo llegan» con las formas de cobro, y dos gráficos. Debajo, «Las cuentas»: bruto a neto, qué tributa, capital, año a año y método.
- Acciones: cargar ejemplo, vaciar, tomar de la cartera activa, caso de la Hacienda Foral, unidades, informe.
- Confuso: el selector de unidades está junto a la cifra pero no gobierna ni las frases (PLA-01) ni la tabla de formas de cobro. «Residencia fiscal» va primero y ocupa un panel entero para un dato que casi nunca cambia. «Tomar de la cartera activa» está escondido en la cabecera del panel de ahorros. Las hipótesis, que es lo que más se prueba, van al final de la columna, lejos de la cifra en pantallas de 1280. El método y las fuentes, siete secciones en carriles, merecerían plegarse.

**Planes y EPSV** (`/jubilacion/planes`). Pregunta: «¿qué es este plan, cómo ha ido y cómo es junto a otros?».
- Lista: buscar, tipo, categoría, gestora → bandeja «Para comparar» → nota de procedencia → tabla paginada (40) con «Comparar» por fila.
- Ficha: evolución del valor → rentabilidad → riesgo → datos del plan → notas.
- Comparación: evolución en base 100 → tabla plan a plan con notas.
- Confuso: la bandeja de comparar va antes que la tabla y empuja la lista hacia abajo. Desde la ficha no se puede ir a comparar, solo volver. En la ficha, «El plan» (qué es) va después de las cifras: un asesor que la ve por primera vez quiere saber primero qué es. El menú no devuelve a la lista (PLA-11). Hay una nota de lectura larga y repetida en cada vista.

**Sistema** (`/sistema`, solo administradores). Pregunta: «¿están bien los datos y qué tengo que arreglar?».
- Nueve pestañas: Estado del sistema, BBDD maestra, Calidad, Históricos, Inspección, Retrocesiones, Ingesta, Operaciones, Referencia técnica. En la web solo quedan dos.
- Acciones de escritura: refresco manual, carga de históricos, alta por ISIN, recálculos de Inspección, retrocesiones e importación, y Operaciones en ocho pasos más correcciones.
- Confuso: nueve pestañas planas mezclan diagnóstico (Estado, Calidad, Inspección), escritura (Históricos, Ingesta, Operaciones) y un dato comercial (Retrocesiones), que no es «sistema» y que un asesor sí podría usar. «Referencia técnica» sobra. «BBDD maestra» e «Ingesta» repiten el aviso de escrituras bloqueadas. Operaciones es una pantalla de 1.476 líneas con ocho pasos, seguimiento y correcciones en una sola columna: pediría un asistente por pasos. Cada pestaña formatea fechas y números a su manera (PLA-12), y el cambio de pestaña pierde lo hecho en ella.
