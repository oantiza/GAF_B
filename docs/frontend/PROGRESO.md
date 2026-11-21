# Auditoría y rediseño del frontend — Progreso

*Cerrado el 14-11-2026. El resumen para Óscar es `INFORME_DE_CIERRE.md`. Si empiezas de cero o tu contexto se ha
compactado: lee ese informe, este fichero, `AUDITORIA.md`, `SISTEMA_DISENO.md` y `git log auditoria-frontend`.*

## El encargo, en cuatro líneas

Encargo de Óscar del 13-11-2026. Dos resultados, en este orden: (1) **un frontend sin fallos**: auditar todo
el frontend, registrar cada hallazgo en `AUDITORIA.md` con su gravedad y arreglarlo con una prueba que falle
sin el arreglo; (2) **un frontend rediseñado y coherente**: proponer el sistema de diseño en
`SISTEMA_DISENO.md` con maquetas, **esperar la aprobación de Óscar** y aplicarlo a todas las pantallas y a
todos los informes (un solo diseño de informe con dos variantes de color: interno del asesor y para el cliente).

Decisiones que se respetan: las carteras del Gestor de carteras se guardan solo en ficheros del disco del
usuario, nunca en la base; la fiscalidad queda fuera del gestor; ancho mínimo 768 px, sin versión de móvil.

Necesita aprobación de Óscar antes de hacerse: aplicar el rediseño a toda la app; quitar una funcionalidad o
cambiar lo que hace; tocar el backend (Functions, reglas, colecciones, contrato de las llamadas); desplegar;
reescribir el historial de Git; usar servicios de pago.

## Dónde se trabaja

- **Rama `auditoria-frontend`**, en la copia de trabajo `.claude/worktrees/auditoria-frontend` (aislada: la
  carpeta principal sigue en `gestor-activos-financieros` y no cambia de rama). Sale del commit `8da9cb9d`.
- **La app de esta rama se arranca en el puerto 5194** (configuración `auditoria-frontend` de
  `.claude/launch.json` de la carpeta principal, que no va a Git). Los emuladores (Firestore 8082 y 8092,
  Auth 9097, Functions 5005) y los Vite del 5174 y del 5184 son de otras sesiones: se usan, no se paran.
- `.env.local` de la app y `functions_python/.env` se copiaron de la carpeta principal (no van a Git).
- Territorio: `3-BDB-ACTIVOS_app/` (pantalla, estilos, piezas comunes e informes) y `docs/frontend/`. Anotado en
  `COORDINACION_SESIONES.md` de la rama principal (commit `be1327c2`, sin subir).
- Commits **nombrando rutas** (`git commit … -- <rutas>`), nunca `git add -A`.

## Cómo comprobar el estado (las puertas)

Desde `3-BDB-ACTIVOS_app`, en este orden:

```bash
npm run typecheck
npm test
npm run lint
node scripts/deadCssD3.mjs
npm run build
```

Y el recorrido visual, con la app arrancada en el 5194 y las credenciales del usuario local del emulador
(las declara `scripts/seedEmulatorUser.mjs`) en `BDB_SHOTS_EMAIL` y `BDB_SHOTS_PASSWORD`:

```bash
AUDIT_AXE=todos AUDIT_BASE=http://localhost:5194 node scripts/auditoriaFrontend.mjs despues d,tp
```

Recorre 68 pantallas y vistas en los anchos que se le pidan (`xl,l,d,p,t,tp`: 2560, 1920, 1440, 1280, 1024 y
768 px), guarda la captura de página entera de cada una en `docs/frontend/capturas/<etiqueta>/` y escribe al lado
`informe.md`: desborde horizontal, errores y avisos de consola, peticiones fallidas, reglas de accesibilidad
incumplidas (axe-core, WCAG 2.2 AA; con `AUDIT_AXE=todos`, en todos los anchos pedidos), tablas apretadas (fila
mediana de 96 px o más), saltos de nivel entre encabezados y letra por debajo de 12 px. `capturas/antes/` es el
recorrido del 13-11 (28 pantallas, sobre `8da9cb9d`) y `capturas/despues/`, el del cierre a 1.440 y 768 px; las medidas
del cierre a 1.280 y 1.024 px están en `capturas/despues/informe-1280-1024.md`, sin sus capturas.

## Fases

| Fase | Estado | Commit | Notas |
|---|---|---|---|
| 0 · Orientación | Hecha | — | Leídos `AGENTS.md`, la coordinación, el traspaso, `docs/gestor-carteras/`, la dirección visual vigente, el historial y las ramas. Sin trabajo sin fusionar en ninguna rama |
| 1 · Auditoría | Hecha | ver `git log` | **244 hallazgos: 4 críticos, 21 altos, 123 medios y 96 bajos**, en `AUDITORIA.md`. Recorrido automático de 28 pantallas en tres anchos, diez revisiones de código y una verificación a mano de las cifras del gestor (86 pruebas nuevas). Capturas de antes en `capturas/antes/` |
| 2 · Arreglos críticos y altos | **Hecha** | `bb3a4255` | Los 4 críticos y los 21 altos, corregidos y con su prueba; con ellos, 13 medios y bajos del marco y varios del gestor. Tres quedan con una parte pendiente de decisión de Óscar (ACT-01, DIS-03, GES-09). Puertas en verde: 5.657 pruebas |
| 3 · Propuesta de diseño | **Hecha y aprobada por Óscar el 13-11-2026** | ver `git log` | `SISTEMA_DISENO.md` y las maquetas de `maquetas/`. Aprobada con un cambio: la cabecera de los informes va sin color sólido, con filete degradado (lo eligió entre cuatro alternativas, `maquetas/cabeceras.png`). Siguen abiertas tres decisiones de la auditoría (ACT-01, DIS-03 y GES-09), que no bloquean |
| 4 · Aplicación del diseño por secciones | **Hecha** | `92517caf`, `69d8d50b`, `7907f32e`, `92a4ea75`, `162aa1ce`, `17730244`, `a6e43df5`, `a20f45b5`, `59a12bcb`, `8304635b`, `c8f3b802`, `878d36a4` | Hechos: el módulo único de formato, los tokens, la identidad del asesor, el marco, las piezas comunes con su muestrario, los gráficos por papel y las seis secciones de pantallas (Planificación; Carteras de clientes; Activos; Diseño y Guardadas; Análisis e Informes; Mercado, Posiciones y Datos). Después, las pestañas «Propuestas» y «Patrimonial» del Comparador y el paso de **toda** cifra y toda fecha al formato único, con el módulo antiguo borrado |
| 5 · Informes unificados | **Hecha** | `f4037858`, `cb34c4a7`, `69dc595c` | La plantilla única (membrete del asesor, filete degradado, dos temas, sin rellenos) y los trece documentos pasados a ella, revisados hoja a hoja. Los otros dos (rendimiento de cartera real y seguimiento periódico) no se migran: se retiran con «Análisis rápido de extractos» |
| 6 · Arreglos medios y bajos | **Hecha** | `69d8d50b`, `fee50350`, `878d36a4`, `57ac89a9`, `990a069d`, `5dcf578c`, `97e38777`, `1e3d8230`, `d0dc99c7`, `e632bb82` | Los 228 medios y bajos tienen estado final en `AUDITORIA.md`: 212 corregidos, 4 corregidos en parte, 7 justificados, 2 que ya no aplican y 3 que esperan una decisión de Óscar. Con los 25 críticos y altos, 237 corregidos de 253. El último, DIS-29, después del cierre (`a62c92ad`) |
| 7 · Verificación final e informe de cierre | **Hecha** | `770ca800`, `c8f3b802`, `22a42464`, `1e3d8230`, `d0dc99c7`, `e632bb82` y el commit de los documentos | Puertas en verde: 6.855 pruebas en 526 ficheros. Recorrido de 68 pantallas en cuatro anchos (1.440, 1.280, 1.024 y 768 px): 0 desbordes, 0 errores de consola, 0 reglas de accesibilidad incumplidas y 0 saltos de encabezado. Capturas de después en `capturas/despues/` e informe en `INFORME_DE_CIERRE.md` |

### Decisiones de Óscar del 14-11-2026

- **ACT-01:** un activo con la serie bloqueada por calidad se puede añadir, con el aviso «Sin datos fiables para
  medirlo». Hecho (`fee50350`).
- **DIS-03:** sí al control en el servidor al guardar una propuesta. Hecho y probado (`e2b3d240`), también contra el
  emulador local de Firestore; **falta desplegarlo, y no se despliega desde aquí**. Hasta entonces, en producción
  protege solo la comprobación previa del frontend.
- **GES-09:** «Análisis rápido de extractos» se retira al acabar el rediseño, no antes.

Siguen abiertas cinco (`AUDITORIA.md`, «Lo que necesita una decisión de Óscar», e `INFORME_DE_CIERRE.md`, apartado
7): DIS-11, GES-13 y GES-14, que son funciones nuevas o cambian lo que hace una función; INF-15, el nombre repetido
de dos informes; y retirar del servidor las cuatro Functions de «Análisis rápido de extractos», que ya no llama nadie.
| 8 · Revisión del color y de los informes, a petición de Óscar | **Hecha** | `a12f5ad1`, `7d79c71d`, `68659859`, `f3472145`, `c64f28c4`, `5afc6067`, `e6275404`, `dd39b508`, `b82f01b2` y los commits de los documentos | Color por categoría en toda la aplicación, mapa por zonas, caja de estilo en casillas, aros, semáforo, frontera, matrices como rejilla, mejora y empeora en verde y rojo; y los trece informes con el aspecto del papel de cliente de antes. Después, por decisión de Óscar esa misma tarde: los ETF entran en la matriz de solapamiento del informe de cliente, y Carteras de clientes gana Sortino, Calmar y la rentabilidad de los últimos 1, 3 y 5 años. 6.984 pruebas en 541 ficheros; recorrido de 68 pantallas en cuatro anchos, todo a cero. Reglas en `SISTEMA_DISENO.md`, apartado 12; cada cambio, en `AUDITORIA.md`, COL-01 a COL-15 |
| 9 · Subida | **Hecha; el despliegue lo lanza Óscar** | `2f37b213` | Por orden de Óscar (14-11-2026): rama fusionada en la principal y las dos en GitHub; sitio compilado desde ahí. Puertas, pruebas del servidor y recorrido de las 68 pantallas repetidos antes; el guardado, probado en local contra el servidor nuevo |

## Punto de partida (medido el 13-11-2026 sobre `8da9cb9d`, en esta copia)

| Puerta | Resultado |
|---|---|
| `npm run typecheck` (`tsc -b`) | Sin errores |
| `npm test` | 413 ficheros de prueba pasan y 2 se omiten; **5.407 pruebas pasan** y 8 se omiten; ninguna falla. 105 s |
| `npm run lint` | Sin errores ni avisos |
| `node scripts/deadCssD3.mjs` | 0 clases muertas, 0 clases sin regla (54 en la lista de excepciones) |
| `vite build` y presupuesto inicial | Correcto: 122,2 KiB de JavaScript inicial y 26,8 KiB de CSS, comprimidos |

Tamaño del frontend: 625 ficheros de TypeScript (118.391 líneas), 14 hojas de estilo (13.429 líneas),
432 ficheros de prueba, 13 destinos en el menú y 16 generadores de informes.

## Bitácora

- **13-11-2026 · Fase 0.** Orientación. La rama principal estaba limpia; `gestor-carteras`,
  `auditoria-1016-raiz` y `master` no tienen ningún commit que no esté en la principal. Creada la copia de
  trabajo y la rama; dependencias instaladas; anotado el territorio en la coordinación.
- **13-11-2026 · Fase 1, arranque.** Medido el punto de partida (tabla de arriba). Añadidos `axe-core`
  (comprobación de accesibilidad, dependencia de desarrollo) y `scripts/auditoriaFrontend.mjs` (el recorrido).
- **13-11-2026 · Fase 1, cierre.** Diez revisiones delegadas (Opus 5.5; la del motor, con esfuerzo alto) y leídas
  por la dirección: gestor (pantalla), gestor (motor, con casos a mano), diseño de cartera, análisis e informes en
  pantalla, activos y mercado, planificación y datos, marco y piezas comunes, formato y vocabulario, e informes; más
  el recorrido en el navegador y las pruebas a mano. Resultado en `AUDITORIA.md` (registro con estado) y en
  `anexos/` (mapas de sección, inventario de informes, de formato y vocabulario, y de piezas, tokens y gráficos).
  **Lo más grave:** tres formas de perder trabajo en el Gestor de carteras (salir sin aviso, dos pestañas, carpeta
  que falla) y un *split* que duplica el valor de un activo sin serie de precios. **Lo que está sano:** ningún
  desborde, ningún error de consola ni petición fallida en 84 capturas; guardar y reabrir no cambia ninguna cifra;
  el motor cumple sus convenciones en los ocho bloques comprobados a mano. Las 86 pruebas nuevas del motor quedan en
  `tests/gestor/auditoria/`; las 6 que demuestran los defectos entran con su arreglo, en la fase 2. Puertas después:
  tipos y lint sin errores, 5.493 pruebas en verde (8 omitidas).

- **13-11-2026 · Fase 3, propuesta.** Dirección «Informe vivo»: se conserva el lenguaje visual del 02-11 (papel cálido, índigo, serifa en títulos) y se rehace la estructura: primero la respuesta y el detalle a un clic, el menú separa Propuestas de Clientes, verde y rojo para el signo en toda la app, ocre para avisos e interno, un módulo de formato, un vocabulario y una plantilla de informe con dos temas (índigo para el cliente, ocre para lo interno). Paleta medida (contraste AA en todos los pares) y paleta de gráficos pasada por el validador. Maquetas en HTML con los tokens propuestos (`maquetas/sistema.css`), fotografiadas con `scripts/capturaMaquetas.mjs`. **Seis decisiones pedidas a Óscar** (apartado 11 del documento) y tres de la auditoría.

- **13-11-2026 · Aprobación.** Óscar: «Tengo cambios» → «La cabecera de los informes» → «No me gusta un color sólido». Se le enseñaron cuatro cabeceras sin relleno (filete doble, título en color, rayado fino, filete degradado), cada una en sus dos temas y en blanco y negro; eligió **D · filete degradado** y contestó **«Lo demás, aprobado»**. El documento y la maqueta de informes recogen el cambio: membrete del asesor sobre blanco, filete degradado (índigo hacia la derecha para el cliente, ocre hacia la izquierda para lo interno), sello de contorno en cabecera y pie, y ninguna pieza con relleno de color.

- **13-11-2026 · Fase 2, cierre (`bb3a4255`).** Doce grupos de arreglos delegados (Opus 5.5; el del motor, con esfuerzo alto), cada uno con sus ficheros y su prueba, y revisados por la dirección: el cambio del motor y el del guardado, leídos línea a línea. Una regresión cazada en la revisión: el límite de error por pantalla volvía a montar la pantalla al navegar y perdía los candados entre Diseño e Informes; ahora olvida el error sin volver a montar. Comprobado en el navegador: crear una cartera con Intro ya no reabre el diálogo y la lista de carteras se abre con el teclado. **Dos cambios que Óscar debe conocer:** la firma por defecto de los informes es el nombre de la cuenta de la sesión (ya no un nombre escrito en el código), y las compras del mismo activo en el mismo día forman un solo lote a coste medio. Puertas: tipos, lint, censo y compilación en verde; 5.657 pruebas pasan y 8 se omiten.

- **14-11-2026 · Fases 4, 5 y 6 en paralelo.** Trabajo delegado por bloques con ficheros disjuntos (Opus 5.5), revisado
  y confirmado por la dirección:
  - **Formato (`92517caf`).** `src/core/formato.ts`: una función por tipo de cifra y de fecha, 221 pruebas. Nadie lo usa
    todavía: cada pantalla y cada informe pasa a él en su rediseño.
  - **Tokens y medios y bajos (`69d8d50b`).** Los tokens aprobados en todas las hojas (la terracota se retira; aviso en
    ocre, error en rojo; nueve tamaños de letra; dos radios). Y 93 hallazgos de comportamiento en cinco bloques (gestor,
    diseño, análisis e informes, activos y mercado, planificación y datos). *El mensaje de ese commit dice 110: el
    recuento exacto es 93, 83 cerrados y 10 en parte.* Dos pruebas antiguas exigían el defecto corregido y se
    actualizaron (`retryBanners`, `notaDeLaPropuesta`). Puertas: 6.081 pruebas, tipos, censo y compilación en verde.
  - **Identidad del asesor (`7907f32e`).** Nombre, entidad, contacto y logotipo, escritos una vez y guardados en el
    navegador por cuenta. «Elaborado por» de los diálogos ya la lee y la escribe.
  - **Plantilla de informes (`f4037858`).** `src/reports/plantilla/`, con Source Serif 4 e IBM Plex Sans en WOFF.
    Revisada hoja a hoja contra la maqueta, en los dos temas.
  - **ACT-01 (`fee50350`).** Al comprobarlo en el servidor se vio que el caso real era otro del descrito: la ficha y el
    Comparador sí bloqueaban los cuatro valores con la serie bloqueada (Deoleo, Duro Felguera, Squirrel y Soltec), y era
    el Buscador el que los añadía sin avisar, porque la base que lee no lleva las marcas del equipo. Ahora las tres
    pantallas hacen lo mismo, y el Buscador pregunta al servidor al añadir (con lo que tampoco añade ya lo suspendido o
    cerrado a suscripciones).
  - **Marco (`92a4ea75`), piezas (`162aa1ce`) y gráficos (`17730244`).** El menú separa Propuestas de Clientes y sus
    entradas son enlaces; la barra dice «Propuesta en curso». Diez piezas nuevas (Campo, Aviso, Distintivo, Respuesta,
    Cifra, Lista de partes, Nota emergente, Esqueleto, mensaje efímero y la pestaña en la dirección) y seis completadas,
    con un muestrario de desarrollo (`muestrario.html`). En los gráficos, el color sale del papel de la serie (la
    cartera, índigo; la referencia, gris y a trazos) y cada uno lleva su tabla alternativa. El recorrido en el navegador
    cazó dos defectos que las pruebas no veían y se corrigieron: la tabla alternativa desbordaba la página a 768 px, y
    el recuadro de la barra tenía un nombre accesible que no contenía su texto visible.
  - **DIS-03 (`e2b3d240`).** Guardado condicionado: la Function rechaza un guardado si la propuesta cambió desde que se
    abrió, de forma atómica (precondición de Firestore). Compatible con los clientes y con el servidor de hoy.
  - **Lo que Óscar debe conocer de este bloque:** la firma de los informes persiste entre sesiones (antes se reiniciaba
    en cada una); en Jubilación, el IRPF mensual de la respuesta puede cambiar un euro para que las líneas sumen; el VaR
    en euros del informe interno se aplica solo a la parte medida; y la lista completa está en `AUDITORIA.md`,
    «Decididas por la dirección del frontend».

- **14-11-2026 · Informes en la plantilla (`cb34c4a7`, `69dc595c`).** Los trece documentos que quedan salen de
  `src/reports/plantilla/`: un solo diseño, dos temas (cliente, índigo; interno, ocre), el membrete del asesor, ninguna
  marca de entidad, ninguna portada y ningún relleno de color. Revisados hoja a hoja en imagen (ficha, comparativa de
  activos, propuesta de mejora, los tres del gestor, el interno, Jubilación y el informe de cliente). En la revisión
  salió un defecto de la propia plantilla: con una entidad de nombre largo, la advertencia del pie se montaba sobre
  «Página x de y»; corregido, con su prueba.

- **14-11-2026 · Pantallas (`a6e43df5`, `a20f45b5`, `8304635b`).** Las seis secciones adoptan el sistema: cabecera,
  banda de respuesta, pestañas en la dirección, bloques y notas, con las piezas comunes y sin cambiar ningún cálculo.
  Cada una se revisó en el navegador a 1440 y 768 px antes de confirmarla. Lo que la revisión cazó y las pruebas no
  veían, corregido cada uno con su prueba (`59a12bcb`, `8304635b`):
  - el eje vertical de los gráficos marcaba pasos que no se podían escribir con sus decimales (la curva de tipos se
    leía «2,5 · 2,8 · 3,2 · 3,5 · 3,9») y el cono iba de 65 en 65: ahora las marcas son redondas;
  - en el Comparador, con un activo sin serie, el siguiente tomaba su número y su color en el gráfico y en la matriz;
  - en el mapa de riesgo y rentabilidad, el nombre de la cartera y el de la cartera de referencia más parecida caían
    uno sobre otro;
  - la etiqueta del final de una línea se cortaba a mitad de paréntesis;
  - un gráfico dentro de una pestaña oculta dejaba un aviso en la consola en cada medida;
  - el botón «Añadir a la propuesta» del Buscador tenía un nombre accesible que no contenía su texto (25 filas);
  - la línea de método de Análisis decía dos veces qué simulación es y cuánto mide; varios textos seguían hablando de
    la portada de unos informes que ya no la llevan.
  Con las cuatro últimas secciones se borraron 152 reglas de CSS sin uso (más de mil líneas). Puertas: tipos y lint sin
  errores, **6.620 pruebas**, censo de CSS en cero, presupuesto inicial 127,1 KiB de JavaScript y 25,4 KiB de CSS.

- **14-11-2026 · Las pruebas no salen a la red (`770ca800`).** La suite hacía 26 llamadas de verdad a los emuladores
  locales desde pruebas de pantalla a las que les faltaba un doble. Ahora `fetch` falla en el acto y dice a quién se
  llamaba; las pruebas contra los emuladores siguen pidiéndolo con `BDB_TEST_EMULATORS=1`.

- **14-11-2026 · Lo que la revisión deja para el paso de formato.** En las pantallas ya rediseñadas la misma cifra
  sale aún con decimales distintos según el bloque («11,9 %» en una casilla y «11,92 %» en la tabla de al lado), los
  pesos de la ficha con dos decimales en «Cartera» y con uno en «Resumen», y las fechas de las procedencias como
  «30 sept 2026». Es el formato antiguo, que siguen usando unas 740 llamadas en 109 ficheros: se pasa al módulo único
  en un paso propio, después de la retirada de «Análisis rápido de extractos».

- **14-11-2026 · Guardadas con propuestas (`c66338da`).** El recorrido de capturas dobla en la red la lista de
  propuestas guardadas, sin escribir en la base, y así se vio la pantalla con datos por primera vez: las tres acciones
  de cada fila se apilaban en vertical a 1440 px. Ahora cada fila ocupa una línea, y el menú «Más» dice de qué
  propuesta es («Más acciones de Familia García»).

- **14-11-2026 · Retirada de «Análisis rápido de extractos» y Comparador completo (`c8f3b802`).**
  - Se retira la pantalla, con su historial, su diálogo de seguimiento, sus dos informes y sus pruebas; y con ella, el
    papel antiguo de los PDF (cuatro módulos de tema y once fuentes TTF). 9.588 líneas menos; la compilación baja
    825 KiB. Quedan trece informes, todos en la plantilla única, y sus cuatro fuentes.
  - **El servidor no se ha tocado:** las Functions `analyze_real_portfolio`, `save_real_analysis`, `list_real_analyses`
    y `delete_real_analysis` siguen en `functions_python` y en la lista de despliegue, sin nadie que las llame desde el
    frontend. Retirarlas es un cambio de backend y queda a decisión de Óscar.
  - Las pestañas «Propuestas» y «Patrimonial» del Comparador, que se habían quedado con el vocabulario de antes,
    siguen ya el sistema: «Propuesta A/B», respuesta arriba, `Panel`, `Campo` y `Cifra`. En la tabla de métricas
    comparadas, que también usa Diseño, solo la diferencia de rentabilidad lleva color.
  - Puertas: tipos y lint sin errores, **6.461 pruebas** (son menos que antes porque se han ido las de la pantalla
    retirada), censo de CSS en cero, presupuesto inicial 127,0 KiB de JavaScript y 24,5 KiB de CSS.

- **14-11-2026 · Repaso de los hallazgos abiertos (`22a42464`).** El registro daba por abiertos 104 hallazgos que el
  rediseño podía haber resuelto sin que nadie lo anotase. Se repasaron 77 contra el código: 33 estaban corregidos y 2
  ya no aplican (su pantalla se retiró); 29 estaban a medias y 13 seguían abiertos. Los otros 27, de formato, se
  repasaron después de la migración: 22 corregidos y 5 a medias.

- **14-11-2026 · Formato único (`878d36a4`).** Toda cifra y toda fecha de la aplicación y de los informes sale de
  `src/core/formato.ts`, y el módulo antiguo se borra. Eran unas 560 líneas en 101 ficheros, migradas mirando qué es
  cada cifra: rentabilidad con signo y dos decimales, peso con uno, diferencia en «pp», importes, fechas
  `13/11/2026`, y «Falta el dato» o «No aplica» en vez de «N/D». Por el camino:
  - el módulo único pasaba a mayúsculas el código de divisa, y un precio en peniques («GBp») habría salido en libras:
    ahora el código se escribe como llega;
  - el patrimonio va siempre en millones, sin la «B» que se confunde con el *billion* inglés;
  - en la ficha de un plan, el valor de la participación lleva los mismos cinco decimales arriba y en la tabla;
  - con volatilidad nula, la contribución al riesgo dice «No aplica»; sin cifra de cobertura, el estado de datos de la
    propuesta dice «riesgo sin medir» en vez de un cero.
  Revisado en el navegador (48 pantallas y pestañas a 1.440 px) y en tres informes. Puertas: tipos y lint sin errores,
  **6.547 pruebas**, censo de CSS en cero, presupuesto inicial 127,0 KiB de JavaScript y 24,5 KiB de CSS.

- **14-11-2026 · Un solo corte de ancho por frontera (`57ac89a9`, MAR-12).** Había 22 anchos distintos en las hojas y
  parejas a un píxel: a 1.024 px exactos, un iPad apaisado, el menú era el de tableta y medio contenido, el de
  escritorio. Ahora un corte «por debajo de N» se escribe siempre igual, quedan trece, y una prueba los declara con su
  motivo. A 1.024 px todo es tableta. El recorrido a ese ancho encontró además que la tabla de rentabilidad por meses
  de una cartera de cliente desplazaba sin poder enfocarse con el teclado: los cinco envoltorios de tabla del gestor
  son ya, como la tabla común, un grupo con nombre en el orden del tabulador.

- **14-11-2026 · Cierre de los hallazgos abiertos (`990a069d`).** Los 42 hallazgos que el repaso dejó abiertos o a
  medias y los 5 restos de formato, en seis bloques con ficheros separados, cada arreglo con su prueba. Lo que salió
  al mirar las pantallas mientras tanto:
  - **una regresión del rediseño** (PLA-25): al pasar las pantallas a la tabla común, los títulos de columna no se
    partían y el nombre se quedaba sin sitio; en «Planes y EPSV» cada plan ocupaba de cuatro a siete líneas. Se
    arregla en la pieza, y el recorrido mide desde ahora las «tablas apretadas»;
  - los ficheros que se descargan se llaman todos igual y los descarga una sola función
    (`src/core/descargaDeFicheros.ts`); lo que se teclea lo lee un solo lector (`src/core/cifraTecleada.ts`);
  - la clase `notice` desaparece: los 167 avisos son la pieza `Aviso`; las clases `.pos` y `.neg` también;
  - en la comparativa de propuestas, la frase y la tabla escriben la misma cifra («1,74 puntos porcentuales (pp)») y
    B va a trazos; en el informe interno ninguna letra baja de 6 pt.
  Puertas: tipos y lint sin errores, **6.804 pruebas**, censo de CSS en cero, presupuesto inicial 127,1 KiB de
  JavaScript y 24,5 KiB de CSS.

- **14-11-2026 · Dos restos de antes del rediseño (`5dcf578c`).** ANA-31: el panel de la simulación usa la función
  común de caídas, una vez por serie. MOT-05: la fila «Variación de precio» del resumen de una cartera de cliente dice
  que ya lleva descontadas las comisiones de compras y ventas, que es decisión de Óscar del 13-11 para el informe.

- **14-11-2026 · Niveles de encabezado (`1e3d8230`, MAR-32) y el informe completo de Estrategia (ACT-26).** La medida
  nueva del recorrido contó 35 de 48 pantallas
  donde el título de un bloque era `h3` bajo el `h1` de la página. Ahora el título de un bloque es `h2` y lo que va
  dentro, `h3`: en la pieza `Panel`, en los vacíos, en los diálogos y en los encabezados escritos a mano. La hoja viste
  cada título por su clase, así que no cambia nada de lo que se ve: comprobado comparando las capturas de antes y de
  después del cambio, píxel a píxel.
  Al comprobarlo salió una vista que el recorrido no abría, porque se llega pulsando y no por la dirección: el «Informe
  completo» de Estrategia. Sus títulos de sección salían a 9 px, más pequeños que el texto: el documento lo escribe un
  modelo con todo en `###` y el visor de Markdown los dejaba en `h6`. Ahora el título más alto del documento toma el
  nivel que se le pide; además, «Riesgos de cola» ya no va pegado al último párrafo, el resumen no se repite y el primer
  título del informe diario lleva su tilde. El recorrido abre desde ahora las cuatro vistas de Estrategia que le
  faltaban.

- **14-11-2026 · El cono de la simulación y la prueba de GES-13 (`97e38777`).** En Diseño › Simular, la última marca
  del eje del cono, «a 3 años», se cortaba. Y «Retirar la cartera» manejaba ya su error (`bb3a4255`) sin que ninguna
  prueba lo vigilase: la nueva falla si se quita el arreglo.

- **14-11-2026 · El recorrido, ampliado (`d0dc99c7`, ACT-27 y ACT-28).** Si una vista sin abrir escondía un defecto,
  podía haber más. El recorrido abre otras dieciséis vistas (las pestañas de la ficha de un ETF y de una acción, la
  comparación de planes y las ocho pestañas de Sistema): son 68 pantallas. Además mide el texto por debajo de
  12 px, que es lo que habría visto el fallo de Estrategia; pasa axe-core en todos los anchos que se le pidan
  (`AUDIT_AXE=todos`), y deja que una pantalla declare lo que es esperado (Operaciones, sin su servicio local). En esas
  vistas encontró dos cosas más, ya corregidas: en «Documentos y datos» de un ETF, un valor que es una frase no se
  partía y se salía 98 px de la página; y las fuentes del informe de estrategia eran enlaces de 15 px de alto, pegados.
  De paso, «Drivers semanales específicos» pasa a «Hechos de la semana».

- **14-11-2026 · La tableta, con las vistas nuevas (`e632bb82`, PLA-26 y MAR-33).** Al pasar el recorrido ampliado por
  los anchos de tableta salieron dos cosas más, las dos en piezas comunes:
  - en «Calidad de fondos» de Sistema, a 768 px cada fondo ocupaba 231 px de alto: el nombre y el motivo se quedaban
    sin sitio. La tabla común admite ahora una columna de prosa, que no baja de un ancho de lectura;
  - en la banda de cifras, por debajo de 1.440 px una cifra larga no cabía en su casilla: en la ficha de una acción a
    768 px, «350,69 USD» cruzaba el filete y tocaba la cifra de al lado. Un dato de la banda no se estrecha ya por
    debajo de su cifra, y su relleno baja con el ancho de la pantalla. El recorrido mide desde ahora las cifras que se
    salen de su casilla.

- **14-11-2026 · Verificación final.** Puertas en verde: tipos y lint sin errores, **6.853 pruebas en 526
  ficheros** (8 más se omiten, las mismas que al empezar: piden los emuladores o la carpeta de NUVIA), censo de CSS en
  cero, presupuesto inicial 127,1 KiB de JavaScript y 24,6 KiB de CSS.
  Recorrido de las 68 pantallas a 1.440, 1.280, 1.024 y 768 px: ningún desborde, ningún error de consola ni petición
  fallida, ninguna regla de accesibilidad incumplida, ningún salto de encabezado, ninguna letra por debajo de 12 px y
  ninguna cifra fuera de su casilla. La accesibilidad se mide con la página arriba del todo (`44e4a2f5`): desplazada,
  la barra fija tapa a medias los botones de la cabecera y axe lo contaba como un control demasiado pequeño.
  Quedan tres tablas con filas de cuatro líneas o más en los anchos estrechos, las tres con el nombre a 200 px o más y
  con desplazamiento dentro de su marco: el Buscador en tableta (98 px por fila, por sus dos botones apilados), las
  posiciones de Análisis a 768 px (114 px) y «Calidad de fondos» de Sistema por debajo de 1.440 px (de 100 a 120 px,
  donde eran 231).
  Los trece informes, generados con datos de muestra y mirados hoja a hoja.
  `AUDITORIA.md` queda con el estado final de los hallazgos (252 en ese momento), e `INFORME_DE_CIERRE.md` es el resumen para Óscar.
  **La rama no está subida y nada se ha desplegado.**

- **14-11-2026 · Después del cierre: lo que vio Óscar al probar la rama (`a62c92ad`, DIS-29).** En local, «Generar
  borrador» contestaba «La operación no se puede ejecutar en el estado actual de los datos» y nada más. El generador
  no puede trabajar en local, y es así por diseño: necesita la base nueva. Lo que estaba mal era el mensaje: el
  servidor explicaba el motivo y la pantalla lo callaba. Ahora lo enseña, como las demás pantallas, salvo en Modo
  cliente. La prueba que había lanzaba un error suelto y no el que llega de verdad; la nueva usa el de verdad y falla
  sin el arreglo. Puertas en verde otra vez: **6.855 pruebas en 526 ficheros**. Son 253 hallazgos, 237
  corregidos.

- **14-11-2026, tras el cierre · Revisión del color y de los informes, a petición de Óscar.** Con la rama en local, Óscar miró el
  rediseño y dijo: «le faltan colores en general, y en el mapa de distribución geográfica, imprescindibles. ¿Están todos
  los datos que salían antes? Dale más vida, más impacto visual, y los informes anteriores eran mucho más bonitos,
  recupéralos. El stylebox así es horroroso. ¿Y la matriz de solapamiento?».
  **Los datos.** Se comparó el código de antes del rediseño (`8da9cb9d`) con el de después, pantalla a pantalla: no
  faltaba ninguna cifra, columna ni lista salvo la frontera eficiente fuera de Optimizar, el periodo y la marca de
  estimado de las cifras de Análisis, el producto y la clase de la mayor posición, la concentración cuando está bien y
  el recuento por día de Resultados. Han vuelto. Lo que se fue con «Análisis rápido de extractos» (Sortino, Calmar,
  rentabilidades a 1, 3 y 5 años, historial y dos PDF) no vuelve sin una decisión: es una función nueva.
  **El color.** Las reglas nuevas están en `SISTEMA_DISENO.md`, apartado 12: cada clase de activo y cada zona tienen
  su color en toda la aplicación; verde y rojo dicen también si una diferencia mejora o empeora; la referencia de un
  gráfico es tostada y a trazos; en la paleta entra el verde y sale el ocre, que se confundía con el tostado (medido con
  el validador de gráficos); un reparto se dibuja; una matriz es una rejilla de casillas de color.
  **Los informes.** La plantilla única se queda y toma el aspecto del papel de cliente de antes: portada, Fraunces y
  Roboto Flex, granate y bronce para el cliente y azul acero para lo interno, tarjetas, barras con un color por
  categoría, mapa en color. Sin marca de entidad: va la identidad del asesor.
  **La matriz de solapamiento.** Comprobada con datos reales desde la aplicación: con dos fondos indexados al MSCI
  World (94,4 %) sale en el informe de cliente. Con la cartera de muestra no sale porque los dos que se pisan son ETF,
  y su cartera completa es dato del emisor, de uso interno (B-53, B-79). El corte sigue en el 40 % (A-136); Óscar dijo
  «mayor al 50 %»; preguntado ese mismo día, con el informe delante, **lo deja en el 40 %**.
  **Cómo se hizo.** Las piezas comunes y las reglas, en la sesión principal; cuatro agentes con ficheros disjuntos
  (gráficos; Diseño, Análisis y Comparador; Mercado, gestor, planes y ficha; informes), revisados en imagen uno a uno.
  **Puertas en verde:** tipos y lint sin errores, **6.951 pruebas en 538 ficheros** (8 omitidas, las de siempre), censo
  de CSS en cero, presupuesto inicial 127,2 KiB de JavaScript y 24,8 KiB de CSS. Recorrido de las 68 pantallas a 1.440,
  1.280, 1.024 y 768 px: ningún desborde, ningún error de consola, ninguna regla de accesibilidad incumplida, ningún
  salto de encabezado, ninguna letra pequeña, ninguna cifra fuera de su casilla; las tres tablas de filas altas de
  antes siguen igual. Las capturas de `capturas/despues/` son ya las de este estado.
  **La rama sigue sin subir y nada se ha desplegado.**

- **14-11-2026, tras el cierre · Las tres decisiones de Óscar sobre lo que quedaba abierto.** Se le enseñó lo hecho en una página
  con capturas y contestó a las tres preguntas el mismo día.
  **El corte del solapamiento: «Dejar el 40 %».** No cambia nada en el código; queda anotado en la decisión A-136 para que
  no se vuelva a preguntar.
  **Los ETF: «No los dejes fuera» (`dd39b508`, COL-14).** Revisa la B-79. La cartera completa del emisor mide el
  solapamiento también en el informe de cliente y en Análisis en Modo cliente; el cliente ve la cifra y no de quién es la
  cartera. Ningún papel la lee: el informe de cliente recibe su solapamiento ya medido de la pantalla que lo pide, y la
  prueba de la barrera sigue en pie. Comprobado en la aplicación con la cartera de muestra: iShares Core MSCI World y
  Vanguard S&P 500, 58,4 %, dentro y fuera del Modo cliente, y ni una mención al emisor en el papel.
  **Dos cosas que no son de aquí:** la B-79 está en `DECISIONES_DATOS_2026-11-07.md` y la frase «los datos del emisor no
  entran en ningún informe de cliente» en `AGENTS.md`: las dos son de Dirección y hay que ponerlas al día. Y **en la
  nube no cambia nada todavía**: las carteras del emisor no están subidas (`nube:subir --con-cartera-del-emisor`, con su
  aprobación aparte).
  **Sortino, Calmar y los últimos años: «Añádelos» (`b82f01b2`, COL-15).** En el motor del gestor, con las definiciones
  que usaba el servidor (`ex_post_sortino`, el Calmar y `_rolling_return` de la cartera real): cada cifra esperada de
  las pruebas sale de una cuenta a mano escrita a su lado, y una prueba compara con el caso de paridad del servidor.
  En la cartera de demostración, desde el inicio: Sharpe 0,47, Sortino 0,68 y Calmar 0,87; último año +8,35 %, últimos 3
  años +17,75 % (+5,60 % al año), y a 5 años dice que aún no tiene esa historia.
  **Puertas en verde:** tipos y lint sin errores, **6.984 pruebas en 541 ficheros** (8 omitidas, las de siempre), censo de
  CSS en cero, presupuesto inicial 127,2 KiB de JavaScript y 24,8 KiB de CSS. **La rama sigue sin subir y nada se ha
  desplegado.**

- **14-11-2026, 12:50 · La subida.** Óscar miró la rama en local, en Chrome, y dijo «vamos a subirla así de momento»;
  preguntado si también a producción: «Sí, prepáralo tú». Antes de tocar la principal se pasaron otra vez todas las
  puertas sobre `ca60c589` (6.984 pruebas, tipos, lint, censo de CSS, compilación y peso), las 2.304 pruebas de Python
  del servidor con las dos de DIS-03 contra el emulador, y el recorrido de las 68 pantallas en los cuatro anchos, que
  estaba sin repetir desde los dos últimos cambios: 0 desbordes, 0 reglas de accesibilidad, 0 saltos, 0 letra pequeña y
  0 cifras fuera. Trece pantallas apuntaron un 429 del limitador de llamadas del servidor local, por lanzar dos
  recorridos a la vez con el mismo usuario; repasadas a solas, 0. **La rama trajo el apunte que la principal tenía de
  más y la principal avanzó en directo hasta `2f37b213`; las dos están en GitHub.** El sitio se compiló desde ahí
  (`index-BpOlQFBT.js`) y arranca con 0 errores de consola. Con la principal fusionada, el emulador de Functions sirve
  ya el código nuevo, y por primera vez se pudo probar el guardado de extremo a extremo: dos guardados seguidos, el
  rechazo del servidor (cambiada y eliminada) y el aviso en pantalla. **Sin desplegar:** las Functions y el sitio los
  lanza Óscar; las órdenes, en `INFORME_DE_CIERRE.md`, apartado 8. De paso se corrige en estos documentos un «tarde»
  que no lo era: la revisión del color y las tres decisiones fueron la misma mañana del 14-11, después del cierre.

- **14-11-2026, 13:05 · Publicado.** Óscar lanzó los dos despliegues. Comprobado leyendo la web: el índice publicado
  es idéntico al compilado desde `2f37b213` y los 288 ficheros de `assets/` son iguales a los locales. En su terminal,
  las 34 Functions actualizadas, `save_portfolio` entre ellas. **Sin comprobar:** la aplicación publicada con sesión y
  el guardado contra el servidor de la nube; la cuenta es de Óscar.

## Cómo se mantiene `AUDITORIA.md`

El estado de cada hallazgo se lleva **solo en la columna «Estado» de la tabla «Registro»**: «Abierto», «Corregido»
(con su commit y su prueba), «Justificado» (con el motivo) o «Pendiente de Óscar». Se edita a mano al cerrar cada
arreglo. El detalle de cada hallazgo no se toca: es lo que se encontró.
