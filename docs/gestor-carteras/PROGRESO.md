# Gestor de carteras — Progreso

*Se actualiza al cerrar cada fase. Si empiezas de cero: lee `PLAN.md`, `ARQUITECTURA.md`, este fichero y
`git log gestor-carteras`.*

**Dónde se trabaja:** en la rama principal, `gestor-activos-financieros`. La rama `gestor-carteras`, donde se
construyó (13-11-2026) con su copia aislada y su Vite en el 5184, está fusionada desde hace tiempo
(`git branch -r --merged gestor-activos-financieros` la lista, 20-11-2026) y ya no se usa; el nombre de la pantalla en
el menú es **«Carteras de clientes»** desde el 14-11-2026 (decisión 2 del apartado 11 de `docs/frontend/SISTEMA_DISENO.md`),
y «Gestor de carteras» sigue siendo el nombre de la carpeta, del código y de estos documentos. Hoy la app se arranca
con la habilidad `arrancar-entorno` (Vite en el 5174, emuladores en 8082, 8092, 9097 y 5005).

**Cómo probar la pantalla sin elegir carpeta a mano:** `http://localhost:5174/cartera-real?carpeta=prueba`
usa una carpeta privada del navegador (solo en desarrollo). El usuario local del emulador está en
`scripts/seedEmulatorUser.mjs`.

| Fase | Estado | Commits | Notas |
|---|---|---|---|
| 0 · Orientación y plan | Hecha | `14a2ddd3` | |
| 1 · Núcleo | Hecha | `2922275f` | Modelo, veinte tipos de movimiento, libro con FIFO, valoración |
| 2 · Ficheros | Hecha | `d465223e` | Formato versionado, carpeta, copias, papelera, alternativa |
| 3 · Mercado | Hecha | `d465223e` | Precios, cambios, €STR y fichas desde la base nueva |
| 4 · Análisis | Hecha | `aad38944`, `74bc52d2` | TWR, TIR, desglose, riesgo, composición, integridad, métricas |
| 5 · Pantalla base | Hecha | `16b6aa8d` | Entrada, resumen, cuentas, movimientos, formulario, ajustes |
| 6 · Importación | Hecha | `eadc1703`, `5c2bb9e0`, `62e314e9` | Andbank, plantilla genérica, revisión, comprobación contra el extracto, duplicados y deshacer |
| 7 · Análisis en pantalla | Hecha | `4b51fbc6` | Diez bloques de análisis entre fechas y comparación con carteras del gestor y de Diseño |
| 8 · Informes | Hecha | `bcd585a4` | PDF del cliente, PDF del asesor y Excel, revisados página a página |
| 9 · Cierre | Hecha | | `lint`, `build`, censo de CSS y la batería entera (5.344 pruebas) en verde; pantallas revisadas en seis anchos |

## Pendiente de Óscar

- ~~Desplegar las reglas que abren la lectura de `fx_rates` y `reference_rates`~~ (PLAN §11). Aprobadas el
  13-11-2026 y escritas en `4-base-nueva/firestore.rules`, con sus casos en `probar-reglas.mjs`; **desplegadas
  por Óscar el 13-11-2026**: con `scripts/verReglasDesplegadas.ts`, la release activa era de las 20:20 UTC e
  igual al fichero del repositorio, y en su cartera real de la web sale el ratio de Sharpe y no hay aviso de
  cambios (`COORDINACION_SESIONES.md`, entradas del 13-11 22:25 y del 14-11 00:25).
- **Validar el importador de Andbank con extractos reales.** Está probado con extractos sintéticos que
  reproducen la forma de los reales; ningún extracto real ha pasado por él.
- ~~Decidir cuándo se retira la pantalla anterior de Rendimiento~~, que estaba dentro del gestor como
  «Análisis rápido de extractos». Decidido por Óscar el 14-11-2026 («al acabar el rediseño») y retirada ese
  mismo día (`c8f3b802`); su motor en Python se borró el 17-11-2026 (`0f80ae01`, decisión A-188) y queda en la
  etiqueta de Git `referencia-portfolio-real-2026-11-17`.

## Hallazgos durante la construcción

- **Las series de acciones y ETF de la plataforma vienen ajustadas por dividendos y por splits** (medido con
  Nvidia, Apple y Telefónica). Valorar títulos × ese precio daba una pérdida falsa el día de la compra y
  contaba dos veces los dividendos. El motor reconstruye el precio real con los dividendos del libro
  (`motor/serieAjustada.ts`), anclado al precio de hoy, y avisa si parece faltar un dividendo.
- **El cupón corrido de un primer cupón corto** dividía por los días desde la emisión y no por el periodo de
  cupón: lo cazó la prueba a mano y se corrigió el motor.
- **`core/xirr.ts` no se reutiliza para la TIR**: acota la tasa anual entre −95 % y 500 %, y en periodos de
  días una tasa anualizada se sale de ahí. El motor resuelve la tasa del periodo (`tirDeFlujos`) y una prueba
  comprueba que coincide con `xirr` donde los dos valen.
- **El menú**: la entrada «Rendimiento» pasó a llamarse «Gestor de carteras» (13-11-2026) y desde el 14-11-2026 se llama
  «Carteras de clientes» en el menú. Tres pruebas existentes que
  nombraban la entrada antigua se han actualizado (`tests/appNavigation.test.tsx`, `tests/marco.test.tsx`):
  no estaban mal; cambia el nombre que comprueban.

## Bitácora

- **13-11-2026 · Fase 0.** Leídos el traspaso, la coordinación, `AGENTS.md`, el historial, Rendimiento
  (pantalla y Function), Diseño y su motor, los lectores de documentos y la capa de datos. Hallazgos en
  PLAN §1. Rama y copia de trabajo creadas; dependencias instaladas.
- **13-11-2026 · Fases 1 a 5.** Motor completo con sus pruebas a mano; almacén, plantilla genérica e
  importador de Andbank delegados en subagentes y revisados; pantalla base montada en el sitio de
  Rendimiento y probada en un navegador de extremo a extremo (crear a mano con activos reales, guardar,
  recargar, reabrir, borrar y deshacer), a 1440 y a 768 px, sin errores de consola ni desborde.
- **13-11-2026 · Fases 6 a 9.** Asistente de importación, pestañas de análisis y comparación, y diálogos de
  informes y versiones, delegados en subagentes y revisados. Probado en un navegador: importar los tres
  extractos sintéticos (cuadra con el extracto), cartera mixta, descarga de los dos PDF y del Excel (cifras
  iguales a la pantalla), versiones anteriores y comparación entre dos carteras. Sin desborde en 2560, 1920,
  1440, 1280, 1024 y 768 px y sin errores de consola. Batería entera: 409 ficheros, 5.344 pruebas, ninguna
  fallida. Pruebas de Python: 2.277 pasan; la única que falla en esta copia
  (`test_writers_share_one_client_per_process`) pasa en la carpeta principal: aquí falta el `.env` de las
  Functions, que no va a Git. Python no se ha tocado.
- **13-11-2026 · Último ajuste.** Una métrica que no aplica al periodo (anualizar unos meses, el Sharpe sin
  un año de historia) se escribía en el color de «falta el dato». Las métricas dicen ahora cuál de las dos
  cosas es (`noAplica`) y la pantalla lo pinta en gris. Batería entera repetida después: 5.347 pruebas,
  ninguna fallida.

- **13-11-2026 · Medición con extractos reales.** Un juego real (cuenta de efectivo, operaciones y posiciones;
  el mismo con el que se validó Rendimiento) pasado por el lector y el motor, en local, con la salida fuera del
  repositorio, y comparado con el motor de Rendimiento sobre los mismos ficheros. **Resultado final:** las 594
  líneas entran sin decisión manual; las 38 posiciones cuadran en títulos y en valor; el efectivo cuadra al
  céntimo; patrimonio igual (7 céntimos de diferencia sobre un millón); TIR anual 5,70 % en los dos; volatilidad
  9,63 % en los dos; caída máxima −18,9 % frente a −19,0 %; TWR 59,07 % frente a 59,95 %. Lo que salió de la
  medición y se corrigió: (motor) el precio del extracto del banco cuando es más reciente que el de la
  plataforma, las series en otra divisa que la del activo y el tipo nuevo «Títulos ejercidos o caducados», con el
  que el registro pasa a 21 tipos; (lector) desempate por importe exacto, títulos cortados por un espacio doble,
  identidad por nombre arrastrada a todas las líneas del mismo nombre, dividendos del mismo día en otra divisa,
  devolución de prima de emisión y gastos de correspondencia y de ADR, derechos de suscripción, y traspasos de
  varios fondos a varios. Batería entera después: 5.368 pruebas, ninguna fallida.

- **13-11-2026 · Costes aparte y referencia a elegir (encargo de Óscar).** (1) El informe del cliente ya no lleva
  costes: sale la sección «Costes» y, en el desglose del resultado, la línea de comisiones y gastos se resta de la
  variación de precio, que se rotula «neta de comisiones y gastos»; las partes siguen sumando. La lista de
  movimientos no cambia. (2) Tercer documento, **«Informe de costes»**, en el papel de cliente: resumen, cargos
  del servicio, operaciones con comisión, coste estimado de cada fondo, impuestos retenidos aparte y cómo se ha
  calculado; el motor da ahora el detalle (`cargosDelServicio`, `costesPorOperacion`, `porProducto`), y cada
  detalle suma el total del resumen. (3) **La referencia se elige de una lista**, a la vista, en el bloque del
  análisis, en los ajustes y en el diálogo de informes: las cinco carteras de referencia de la aplicación (pesos
  fijados el primer día del periodo, sin reequilibrar, con `mezclaDeReferencia`), los tres índices con los que
  compara Rendimiento, la liquidez (€STR capitalizado), otro activo del catálogo o ninguna. Se guarda en
  `referencia.activoId` con un prefijo (`perfil:equilibrado`, `tipo:ESTR`), sin cambiar el formato del fichero
  (`motor/referencia.ts`). Revisados los PDF página a página y la pantalla a 1440 y 768 px. Batería entera:
  5.403 pruebas, ninguna fallida.

- **14-11-2026 · Sortino, Calmar y últimos 1, 3 y 5 años (encargo de Óscar).** Las tres cifras que daba el «Análisis
  rápido de extractos» y le faltaban al gestor, con las definiciones del servidor: **Sortino** = (rentabilidad
  anualizada − €STR medio) / desviación bajista semanal frente al €STR semanal × √52, solo con Sharpe y desde 26
  semanas; **Calmar** = rentabilidad anualizada / |caída máxima|, sin €STR; **últimos 1, 3 y 5 años** = TWR de toda
  la historia desde el último día en o antes de hace N años naturales, con la anualizada en 3 y 5. En «Riesgo»,
  debajo del Sharpe; en «Rentabilidad», el apartado «Últimos años»; en el informe del asesor, en su resumen y en
  «Rentabilidad y riesgo» (el del cliente no cambia). La anualizada de 3 y 5 años no es métrica del registro: dos
  casillas más en el resumen empujaban la conciliación de la demostración a una hoja casi vacía. Pruebas con cada
  cifra de una cuenta a mano y paridad con `ex_post_sortino` (`tests/gestor/sortinoCalmarYUltimosAnios*.test.ts*`).

- **16-11-2026 · El informe de cartera del cliente, reordenado y con el mapa (encargo de Óscar).** La portada lleva solo
  el nombre, para quién es, el periodo y quién lo elabora: las tres cifras pasan a abrir «Cómo ha ido su cartera». Primero
  la cartera —«Su cartera», con todas las posiciones hasta cuarenta y el reparto por clase y divisa, y «Dónde está
  invertida»— y después las cifras: cómo ha ido, riesgo, de dónde viene el resultado y frente a su referencia; detrás,
  movimientos y notas. La región va en el mapa del mundo del papel de cliente (`MapaDelMundo`) en lugar de barras: las
  cinco zonas del gestor pintan sus áreas del mapa sin repartir —«Asia y Pacífico» son Asia, Japón y Oceanía, y lo dice
  el informe— y lo que no tiene zona va en gris en la tira de cifras (`informes/mapaDeRegiones.ts`). Las hojas ya no se
  fuerzan sección a sección: las cifras empiezan donde caben, y las notas van enteras con el texto legal, que se quedaba
  solo en la última hoja. Revisado página a página con la demostración (8 hojas), el año en curso, la cartera sencilla
  (5) y la de cuarenta posiciones (7). Batería entera: 7.274 pruebas, ninguna fallida.

- **17-11-2026 · GES-9: los días sin capital del cliente no cuentan (decisión de Óscar).** La rentabilidad se encadena
  desde que hay dinero: la cadena se enciende con la primera entrada de dinero del cliente y se apaga cuando el capital
  llega a cero o a negativo. Una compra anotada dos días antes que su aportación ya no mide el día siguiente sobre lo
  ganado la víspera (+101 % en un día; +103 % el periodo donde el mercado dio un 1 % diario): sale el 1 % del día en que
  llega el dinero, y el aviso `SIN_CAPITAL` dice los dos días y los euros que quedan fuera. El resultado en euros no
  cambia. La contribución de cada posición deja fuera los mismos días, también los de capital residual (GES-2), así que
  sigue sumando la TWR (`Valoracion.encadena`; `tests/gestor/compraAntesDeSuAportacion.test.ts`).
- **17-11-2026 · GES-12: un año, 365 días, en los dos (decisión de Óscar, opción A).** La rentabilidad se anualiza desde
  365 días (antes 367) y el Sharpe, el Sortino y el Calmar se dan desde 365 (antes 330), con una sola constante
  (`DIAS_PARA_ANUALIZAR`). Consecuencias, vistas y aceptadas: el «1 año» se anualiza siempre (con un 10 % en el periodo,
  10,01 % al año si dura 365 días y 9,98 % si dura 366), y en el informe de cliente «Lo que ha rendido» lleva entonces
  tres filas; un periodo de 330 a 364 días deja de dar Sharpe, Sortino y Calmar; y el gestor se aparta del Comparador y de
  Diseño, que siguen en 330 porque sus ventanas van de cotización a cotización. Las pruebas de riesgo pasan a series de
  365 días, con las cifras rehechas a mano; la de 2024 bisiesto corrige de paso una cuenta del comentario (el 31-12-2023 el
  fondo aún valía 100: un 11 %, no un 0 %).
- **17-11-2026 · GES-13: la carpeta de carteras se recuerda por usuario (decisión de Óscar).** Sigue sobreviviendo al
  cierre de sesión, pero se guarda con el `uid` de quien la eligió (clave `usuario:<uid>`) y solo se le ofrece a esa
  persona: otro asesor en el mismo navegador tiene que elegir la suya, y olvidar la de uno no toca la del otro. La de
  antes del cambio, sin dueño, no se ofrece a nadie y se borra la primera vez que alguien entra; sin sesión no se
  recuerda. El contexto de la sesión lleva ahora el `uid` (`almacen/acceso.ts`; `tests/gestor/carpetaPorUsuario.test.tsx`).

## Lo que la medición dejó abierto

- **La rentabilidad de 2020 y 2021 sale medio punto por debajo de la de Rendimiento** (12,63 % frente a
  13,16 %; 10,91 % frente a 11,51 %); de 2022 en adelante coinciden dentro de 0,3 puntos. La causa más probable
  son los dividendos: el banco los da netos de retención y la serie de la plataforma los descuenta brutos, así
  que el precio reconstruido de una acción queda algo bajo al principio de la tenencia. El total no cambia; el
  reparto por años, un poco. Se arreglaría calibrando los dividendos con el precio de las propias operaciones.
- **«Puede faltar algún dividendo» ya no salta por la retención** (14-11-2026). El aviso se mide suponiendo que a
  cada dividendo anotado sin retención le falta la mayor posible (20 % en un valor español; 46 % en uno extranjero,
  con la del país de origen): solo avisa de lo que ni así cuadra. No cambia ninguna cifra. Con el juego real pasa de
  12 avisos a 4, que son valores con ampliaciones o dividendos en acciones por derechos. La calibración de la
  valoración con el precio de las propias operaciones queda aplazada, por decisión de Óscar: poco beneficio en
  carteras de fondos. La solución de fondo sería que la plataforma publicase también el cierre sin ajustar.
- **Un traspaso en dólares queda como salida y entrada de títulos**, marcado para revisar: sus dos patas no
  cierran con la tolerancia de un traspaso.
- **Una posición sin precio sigue valiendo cero en el cálculo** (20-11-2026), pero ya casi no se da. Desde la decisión
  A-193 sus cifras dicen «Falta el dato» y cada total o cada cifra de la cartera dice si no la incluye o si la cuenta como
  cero. El caso que se reprodujo, una compra pagada en otra divisa sin escribir el precio, ya tiene precio desde la A-196:
  el de su operación, con el cambio de ese día. Queda sin precio una operación sin cambio ese día (apartados 14.10 y 14.13
  de `docs/frontend/SISTEMA_DISENO.md`).
- **Un activo del catálogo se anota con la divisa de su ficha, aunque su serie esté en otra** (visto el 20-11-2026, al
  arreglar la divisa de la referencia, A-195). Son dieciséis instrumentos con la ficha en dólares y la serie en euros
  (`mercado/fichas.ts`), y pasa igual al importar un extracto: para un ISIN del catálogo manda la divisa de la ficha y no
  la del banco (`importacion/revision.ts`). El valor sale casi igual —la serie va a dólares y vuelve—, pero el Resumen
  avisa de que el activo «se anotó en USD», el formulario dice que cotiza en dólares, la columna Precio del informe del
  asesor y del Excel enseña un precio derivado, y los días con cambio nuevo y sin precio nuevo la posición se desviaría de
  su serie (hasta un 0,53 % el 31-12-2024 con el ACWI, por cuenta hecha sobre las series). Cambiarlo toca las carteras
  guardadas: espera a Óscar (apartado 14.11 de `docs/frontend/SISTEMA_DISENO.md`).

## Sin verificar

- El importador de Andbank **con extractos reales en pantalla**: se ha medido con el lector y el motor, no
  pulsando el asistente.
- La comparación con **carteras guardadas de Diseño** en un navegador (su cálculo está probado con una fuente
  en memoria; no había ninguna cartera de Diseño a mano en la sesión de prueba).
- El diálogo del sistema para **elegir carpeta** y la vuelta del permiso entre visitas: no se pueden manejar
  desde una prueba automática; se ha probado con la carpeta de pruebas del navegador, que usa la misma API.
- ~~Los tipos de cambio y el €STR en producción~~: reglas desplegadas el 13-11-2026 y visto por Óscar en su cartera real de la web (sale el ratio de Sharpe y no hay aviso de cambios).
- El Excel abierto en Excel (se ha releído con la librería).
