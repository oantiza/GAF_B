# Gestor de carteras — Arquitectura y guía para ampliarlo

*13-11-2026. Cómo está organizado el gestor y, paso a paso, cómo añadirle un tipo de movimiento, un
importador, una métrica y una sección de informe sin tocar lo que ya existe. Las rutas son relativas a
`3-BDB-ACTIVOS_app/`.*

## 1. La idea en cuatro frases

1. **Una cartera es un libro de movimientos** guardado como un fichero en el disco del usuario. Todo lo
   demás (saldos, posiciones, valor, rentabilidad) se calcula a partir del libro y de los precios.
2. **El cálculo es puro y vive aparte.** `src/gestor/motor/` no conoce React, ni la red, ni el disco. Recibe
   una cartera y datos de mercado y devuelve un `Analisis`.
3. **La pantalla y los informes no calculan.** Leen el `Analisis` y lo pintan. Si falta una cifra, se añade
   al motor, con su prueba, y después se pinta.
4. **Lo que crece se registra.** Tipos de movimiento, importadores, métricas y secciones de informe se
   definen cada uno en su módulo y se dan de alta en un registro. Añadir uno es un módulo más y una línea.

## 2. Las capas

```
src/gestor/
  motor/         cálculo puro                                   ← no importa nada de fuera de motor/
  mercado/       datos de mercado de la plataforma              ← importa motor/ y los lectores de la app
  importacion/   de documentos a movimientos propuestos         ← importa motor/ (y tipos de mercado/)
  almacen/       ficheros en el disco del usuario               ← importa motor/modelo
  demo/          cartera de demostración                        ← importa motor/
  informes/      PDF del asesor, PDF del cliente y Excel        ← importa motor/ y src/reports (temas)
  ui/            pantallas React                                ← importa todo lo anterior
```

Una capa solo importa de las que tiene por debajo. `motor/` no importa de ninguna otra: por eso sus
pruebas corren en milisegundos y sin navegador.

### `motor/` — el cálculo

| Fichero | Qué hace |
|---|---|
| `decimal.ts` | Aritmética decimal (`big.js`). Importes, títulos, precios y cambios se guardan como texto decimal (`Dec`) y se operan exactos. Solo la pantalla redondea |
| `fechas.ts` | Días ISO «AAAA-MM-DD», en UTC |
| `modelo.ts` | Lo que se guarda: `Cartera`, `Activo`, `Movimiento`, `ExtractoDeclarado`… Solo tipos |
| `efectos.ts` | **El contrato entre un tipo de movimiento y el libro**: los efectos primitivos y la definición de un tipo |
| `movimientos/` | Un módulo por tipo, y `registro.ts` |
| `libro.ts` | Aplica los movimientos a las dos cuentas: saldo de efectivo por divisa y lotes de la cuenta de valores (FIFO), a cualquier fecha |
| `valoracion.ts` | El valor de la cartera cada día y de dónde viene el resultado de cada día (precio, ingresos, divisa, costes), posición a posición |
| `serieAjustada.ts` | Recupera el precio real de una acción o un ETF cuya serie viene ajustada por dividendos |
| `bonos.ts` | Cupón corrido y calendario de cupones |
| `rentabilidad.ts` | TWR, TIR, periodos, tabla por meses |
| `desglose.ts` | Desglose del resultado y contribución por posición |
| `riesgo.ts` | Volatilidad, máxima caída, Sharpe, Sortino y Calmar, con las mismas convenciones que Diseño y que la cartera real del servidor |
| `ultimosAnios.ts` | Rentabilidad del último año y de los últimos 3 y 5 años, sobre toda la historia |
| `composicion.ts` | Repartos por clase de activo, divisa, región y sector |
| `integridad.ts` | Duplicados, conciliación con el extracto, precios que faltan, efectivo en negativo |
| `desdePesos.ts` | Convierte una cartera de pesos (las de Diseño) en un libro, para compararla con el mismo motor |
| `metricas/` | Un módulo por métrica (nombre, ayuda en lenguaje llano, formato), y `registro.ts` |
| `analisis.ts` | **La única puerta de salida**: `preparar(cartera, mercado, fichas, hasta)` valora (lo caro, una vez) y `analizar(preparado, periodo, referencia)` da el `Analisis` de un periodo (barato) |

**La identidad que todo cumple**, día a día y en la divisa base:

```
valor de hoy − valor de ayer − flujos externos = efecto precio + ingresos + efecto divisa − costes
```

De ella salen la rentabilidad ponderada por tiempo (cada día, `(valor − salidas) / (valor de ayer + entradas) − 1`,
encadenada), el desglose (que por eso suma el resultado al céntimo) y la contribución (que por eso suma
la rentabilidad).

**Convenciones**, todas escritas en la cabecera del fichero que las aplica:

- Posiciones y rentabilidad por **fecha de operación**; el saldo de efectivo se puede consultar también por
  fecha valor.
- **Flujos externos:** aportaciones, retiradas y entradas o salidas de títulos (a su valor de mercado).
  Dividendos, cupones, intereses, comisiones y retenciones son resultado.
- **La rentabilidad se encadena desde que hay dinero** (decisión de Óscar del 17-11-2026, GES-9). La cadena se
  enciende el primer día en que entra dinero del cliente con capital positivo y se apaga el día en que el capital es
  cero o negativo; hasta el siguiente dinero, lo que gane la cartera no se mide (`SIN_CAPITAL`). Tampoco se encadena un
  día de capital residual (`CAPITAL_RESIDUAL`, GES-2). Esos días no pesan en la TWR ni en la contribución; el resultado en
  euros y la TIR sí los cuentan (`valoracion.ts`, `Valoracion.encadena`).
- **Anualización** desde un año, **365 días**, en la rentabilidad y en el Sharpe, el Sortino y el Calmar: una
  sola constante, `DIAS_PARA_ANUALIZAR` en `fechas.ts` (decisión de Óscar del 17-11-2026, GES-12; antes 367 en
  pantalla y 330 en el Sharpe). Con menos no se anualiza, y la rentabilidad es la del periodo. Años = días / 365,2425,
  así que el «1 año» se anualiza siempre, dure 365 días o 366. Diseño y el Comparador siguen en 330: sus ventanas van de
  cotización a cotización y el año se queda en 364 días; la serie del gestor es de días naturales.
- **Riesgo como en Diseño** (`functions_python/weekly_sampling.py`): medida semanal, desviación muestral
  × √52, mínimo 20 semanas; máxima caída sobre la serie diaria; Sharpe con la media del €STR, desde 365 días.
- **Sortino** (`ex_post_sortino` de `weekly_sampling.py`): (rentabilidad anualizada − €STR medio) /
  raíz(media(min(0, r − rf_s)²)) × √52, con rf_s = (1 + €STR)^(1/52) − 1 y la media sobre todas las semanas; solo
  cuando hay Sharpe (el mismo numerador, nunca con signo contrario) y con al menos 26 semanas.
- **Calmar** (cartera real de `engine.py`): rentabilidad anualizada del Sharpe / |caída máxima| del mismo periodo,
  desde 365 días y si hubo caída; no usa el €STR.
- **Últimos 1, 3 y 5 años** (`_rolling_return` de `engine.py`): sobre la serie TWR de toda la historia, nivel final /
  nivel del último día en o antes del final menos N años naturales − 1 (un 29 de febrero pasa al 28); en 3 y 5 años,
  también anualizada por fechas. No dependen del periodo elegido; sin esa historia, no aplica.
- **Coste FIFO.** Un traspaso entre fondos realiza el resultado del fondo de origen (no es un cálculo fiscal).
  Las entradas del mismo activo el mismo día son **un solo lote a su coste medio**: el libro no tiene hora de
  ejecución, y el resultado no depende del orden del fichero (`libro.ts`).
- **Cambio de un movimiento:** unidades de la divisa extranjera por 1 de la base (convención del BCE). Sin
  serie de cambios, con varios cambios propios el mismo día se valora con su **media ponderada por importe**
  (`valoracion.ts`).
- **Split:** un precio a mano, de una operación o de un extracto anterior al split se divide por su razón,
  haya o no serie de mercado; `serieAjustada` solo dice si la serie de la plataforma ya viene ajustada.
- **Una posición sin precio no tiene valor que dar** (decisión de Óscar del 20-11-2026, A-193). Si a la fecha no tiene
  ningún precio —ni serie, ni operación, ni precio a mano, ni extracto—, el análisis no da su precio, su valor, su peso,
  su resultado latente, su resultado del periodo ni su contribución (`null` en `PosicionAnalizada`), y `Analisis.sinPrecio`
  dice cuáles son. En la serie diaria del valor sigue contando como cero, entera —también el cupón corrido de un bono—:
  por eso el patrimonio no la incluye, y el resultado, las rentabilidades y el riesgo la cuentan como cero. El latente
  del conjunto y los repartos la dejan fuera de forma expresa, porque no tiene valor que sumar. Cada cifra lo dice con
  su frase (`sinPrecio.ts`; `Metrica.salvedad`). Solo se mira la fecha del análisis: un tramo pasado sin precio lo dice
  la comprobación de la cartera (`integridad.ts`, `SIN_PRECIO`).
- **Una referencia con huecos no se compara** (decisión de Óscar del 20-11-2026, A-194). Dos datos seguidos de la
  referencia a más de 7 días naturales, contando el que hace de punto de partida del periodo, y no hay comparación; el
  motivo dice entre qué fechas no hay datos (`HUECO_MAXIMO_DE_LA_REFERENCIA`, en `analisis.ts`). Es la regla del €STR de
  la liquidez (`referencia.ts`), y junto a ella sigue la del atraso: el último dato, a más de 7 días del final. Quien
  enseña la comparación da el motivo, salvo la banda de la cartera, que deja de decir «su referencia», y el informe del
  cliente, cuya sección «Frente a su referencia» solo sale con una referencia que se puede comparar.
- **La referencia, en la divisa de su serie** (decisión de Óscar del 20-11-2026, A-195). `serieEnLaBase`
  (`mercado/cargar.ts`) convierte cada precio de la referencia con la divisa que declara su documento de precios, como
  las posiciones; la de la ficha solo si la serie no la declara. El cambio frente a la base sale de `frenteALaBase`, la
  misma función que el de las divisas de la cartera, y cruza a través del euro si la base es otra.

### `mercado/` — los datos de la plataforma

`cargar.ts` pide, por ISIN y por año, los precios diarios (`instruments/{isin}/price_series/{año}`), los
tipos de cambio (`fx_rates`), el €STR (`reference_rates`) y la ficha de cada activo, y los entrega como
datos planos (`DatosDeMercado`). **De aquí solo salen ISIN y divisas; nunca importes, títulos ni
movimientos.** `plataforma.ts` es la fuente real (el lector de la base nueva que ya usa la app); las pruebas
ponen una fuente en memoria. `fichas.ts` traduce la tarjeta de un instrumento a su reparto.

Dos cosas que no se ven de un vistazo:

- **Las series de acciones y ETF vienen ajustadas por dividendos y splits** (`price_class: MARKET_PRICE`).
  `cargar.ts` las marca en `ajustadasPorDividendos` y el motor reconstruye el precio real con los
  dividendos del libro (`serieAjustada.ts`). El valor liquidativo de un fondo no se ajusta.
- **`fx_rates` y `reference_rates` necesitan una regla de lectura en la base nueva** para funcionar en
  producción (PLAN §11). En local los sirve el emulador. Si no se pueden leer, la cartera se valora con el
  cambio de sus propios movimientos y se avisa.

### `importacion/` — de documentos a movimientos

`lectura.ts` convierte un fichero en tablas de texto (HTML, Excel, CSV) sin interpretar nada. Un
**importador** (`tipos.ts`) reconoce los documentos de una entidad y devuelve movimientos **propuestos**
y lo que el extracto **declara**. `registro.ts` elige el importador que más confía en cada documento.
`revision.ts` es lo que hay entre proponer y aplicar: decide qué activo es cada activo citado (cartera,
catálogo, nuevo o por decidir), marca duplicados, aplica y deshace una importación entera.

### `almacen/` — los ficheros

`formato.ts` define el fichero (`formato`, `version`, `guardado`, `cartera`), lo escribe de forma
determinista y lo lee validando su estructura. `carpeta.ts` es el almacén sobre una carpeta del usuario
(File System Access API): un fichero por cartera, escritura comprobada, copias de seguridad en
`copias/<id>/` y papelera. `acceso.ts` elige y recuerda la carpeta (en el navegador se guarda solo el
manejador de la carpeta, que es como el navegador conserva un permiso; nunca el contenido de una
cartera). `descarga.ts` es la alternativa para navegadores sin acceso a carpetas.

En desarrollo, y solo con `?carpeta=prueba` en la dirección, la pantalla usa una carpeta privada del
navegador para poder probarse de forma automática. Esa rama no existe en la aplicación publicada.

### `ui/` — la pantalla

`GestorDeCarterasPage.tsx` es la entrada (lista de carteras y primer uso). `VistaDeCartera.tsx` es una
cartera abierta: carga el mercado y hace el análisis **una vez** (`estado/useAnalisisDeCartera.ts`) y
reparte un `DatosDeVista` a las pestañas de `vistas/`. `estado/useCarteraAbierta.ts` lleva los cambios,
deshacer y el guardado automático. `piezas.tsx` y `formato.ts` son lo único que pinta cifras. Los estilos
propios están en `src/styles/gestor*.css`; el resto son las piezas comunes de la app (`Panel`,
`TablaDeDatos`, `PageHeader`…).

## 3. Cómo añadir un tipo de movimiento

Ejemplo: una «devolución de capital» (el emisor devuelve parte de lo invertido; entra efectivo y baja el
coste de la posición, sin vender títulos).

1. **Crea `src/gestor/motor/movimientos/devolucionDeCapital.ts`** que exporte una
   `DefinicionDeMovimiento` (`efectos.ts`):
   - `tipo` (la clave que se guarda en el fichero: no se cambia nunca), `nombre`, `grupo`, `descripcion`
     en lenguaje llano y `orden` dentro del día.
   - `campos`: qué campos pide el formulario y cuáles son obligatorios. El formulario se pinta solo.
   - `signoDelEfectivo`: −1 carga, +1 abona, 0 no toca el efectivo, «libre».
   - `validar(movimiento, contexto)`: errores en lenguaje llano.
   - `efectos(movimiento, contexto)`: **los efectos primitivos que produce**. El libro solo entiende estos:
     `efectivo`, `flujoExterno`, `alta`, `baja`, `ajusteDeTitulos`, `canje`, `ingreso` y `coste`. Un tipo
     nuevo los combina; si de verdad hace falta un efecto que no existe, se añade a `efectos.ts`, a
     `libro.ts` y a `valoracion.ts`, con sus pruebas (es el único caso en que se toca el núcleo).
   - `importeSugerido` (opcional): el importe que se deduce de los demás campos.
   - Mira `comun.ts`: hay moldes para lo habitual (`definirAdquisicion`, `definirEnajenacion`, `definirIngreso`).
2. **Dalo de alta en `movimientos/registro.ts`**, en `TIPOS`.
3. **Añade su ejemplo** a `EJEMPLOS` en `tests/gestor/tiposDeMovimiento.test.ts`. Esa prueba comprueba, para
   todo tipo registrado, que su ejemplo es válido y que **su efectivo cuadra con sus demás efectos** (por
   divisa: efectivo = flujos + cobrado − pagado + ingresos netos − costes no descontados).
4. **Añade su fila de ejemplo** a la plantilla genérica (`importacion/plantilla/plantillaDescargable.ts`):
   `tests/gestor/importacionPlantilla.test.ts` falla si un tipo registrado no tiene ejemplo.
5. **Escribe su prueba a mano** en `tests/gestor/`: una cartera pequeña con el tipo nuevo y las cifras
   esperadas calculadas en un comentario.

No hay que tocar el formulario, la tabla de movimientos, la valoración ni los informes.

## 4. Cómo añadir un importador (una entidad nueva)

1. **Crea la carpeta `src/gestor/importacion/<entidad>/`** con un `index.ts` que exporte un `Importador`
   (`importacion/tipos.ts`):
   - `id`, `entidad` y `documentos` (los tipos de documento que conoce, con su etiqueta y de dónde se descargan).
   - `reconocer(documento)`: mira las cabeceras de `documento.tablas` y devuelve el tipo y una confianza
     (0,9 si las cabeceras son inequívocas). `undefined` si no es suyo.
   - `importar(documentos, { divisaBase })`: devuelve `movimientos` propuestos (cada uno con su activo
     citado, sus avisos y si requiere revisión), `extractos` (posiciones y saldo que el documento declara,
     para conciliar), `avisos` y `errores`. **No lanza**: un documento que no cuadra es un error en la lista.
   - Los importes, con `leerCifra` y decimales exactos, nunca `parseFloat`. El `importe` de un movimiento
     lleva el signo que exige su tipo.
2. **Dalo de alta en `importacion/registro.ts`**, en `IMPORTADORES`, antes de la plantilla genérica.
3. **Pruebas con extractos sintéticos** (ningún dato de un cliente entra en el repositorio): copia la forma
   de `tests/gestor/andbankDeMuestra.ts`. Comprueba como mínimo que todo movimiento propuesto sin revisión
   es válido para el motor y que, aplicados, el libro cuadra con lo que el extracto declara
   (`tests/gestor/importacionRevision.test.ts` es el modelo del recorrido completo).

El asistente de importación, la revisión, los duplicados, la conciliación y deshacer funcionan solos con
el importador nuevo. `importacion/andbank/` es el ejemplo completo.

**Un PDF.** `lectura.ts` hoy lee HTML, Excel y texto. Para una entidad que solo da PDF hay que añadir a
`lectura.ts` un lector que convierta el PDF en `DocumentoLeido` (texto y tablas); el importador no cambia.

## 5. Cómo añadir una métrica

1. Si la cifra no está en `Analisis`, **añádela primero a `motor/analisis.ts`** (o al módulo que la calcule)
   con su prueba a mano.
2. **Crea `src/gestor/motor/metricas/<nombre>.ts`** que exporte una `Metrica` (`metricas/tipos.ts`): `id`,
   `nombre`, `ayuda` (una o dos frases para alguien que no es gestor de fondos), `formato`
   (`importe`, `porcentaje`, `puntos` o `ratio`), `conSigno`, `valor(analisis)` y, si puede faltar,
   `motivoSinValor(analisis)`. Si la cifra sale de la serie diaria del valor (un resultado, una rentabilidad, una
   medida de riesgo), dale también su `salvedad` con `salvedadDeLoContadoComoCero` (`metricas/cuentaComoCero.ts`): es lo
   que dice junto a ella cuando alguna posición no tiene precio.
3. **Dala de alta en `metricas/registro.ts`**, en `METRICAS`.
4. Para enseñarla: `<FilaDeMetrica metrica={metrica("<id>")} analisis={…} />` en la pantalla. El informe
   del asesor y el Excel recorren `METRICAS`, así que aparece en ellos sin tocar nada.

Regla del nivel: antes de añadir una métrica, pregúntate si ayuda a un asesor a explicar la cartera a su
cliente. Si no, no entra.

## 6. Cómo añadir una sección a un informe

1. **Crea su módulo** en `src/gestor/informes/secciones/asesor/` o `…/cliente/` que exporte una
   `SeccionDeInforme` (`informes/tipos.ts`): `id`, `titulo`, `procede(datos)` (si con estos datos tiene algo
   que decir: una sección que no procede no deja ni su título) y `Contenido({ datos })` con elementos de
   `@react-pdf/renderer`.
2. **Dala de alta en `informes/registro.ts`**, en `SECCIONES_DEL_ASESOR`, `SECCIONES_DEL_CLIENTE` o `SECCIONES_DE_COSTES`, en el
   orden en que debe salir.
3. **La sección no calcula**: lee `datos.analisis`. Los textos que vienen de datos pasan por `textoAjeno`
   (papel de cliente) o `safeText` (identidad interna), porque un carácter sin glifo rompe la línea.
4. Una hoja nueva del Excel es lo mismo en `informes/excel/` y `HOJAS_DEL_EXCEL`.
5. **Prueba y mira**: `tests/gestor/informes*.test.tsx` genera los PDF con la cartera de demostración.
   Ábrelos y revísalos página a página: ninguna página vacía ni cortada, y las cifras iguales a la pantalla.

Las dos identidades de papel no se mezclan: el informe del cliente usa `src/reports/clientReportTheme.ts`
y el del asesor `src/reports/pdfTheme.ts`. Un informe no importa la paleta de pantalla.

## 7. Cómo cambiar el formato del fichero

1. Cambia `motor/modelo.ts` y sube `VERSION_ACTUAL` en `almacen/formato.ts`.
2. Crea `almacen/migraciones/v<N>aV<N+1>.ts` (recibe y devuelve el objeto del fichero entero) y regístrala
   en `almacen/migraciones/registro.ts` con la versión de origen como clave.
3. Añade su prueba con un fichero de la versión anterior pegado como texto.

Un campo **opcional nuevo** no necesita versión: el lector conserva lo que no conoce. Y lo que aún no tiene
sitio (una asignación objetivo, un mandato) cabe en `cartera.extensiones` sin tocar el formato.

## 8. Lo que el modelo ya admite sin romper ficheros

| Idea futura | Dónde encaja |
|---|---|
| Vista consolidada por cliente o familia | `cartera.cliente` (`id`, `nombre`): agrupar varias carteras y sumar sus valoraciones |
| Asignación objetivo, mandatos con bandas, rebalanceo | `cartera.extensiones`; la composición ya da los pesos reales |
| Atribución por asignación y selección | El desglose diario por posición de `valoracion.ts` y los pesos de la referencia |
| VaR y escenarios de estrés | La serie diaria de rentabilidades de `valoracion.ts` |
| Analítica avanzada de renta fija | `Activo.bono` (condiciones) y `bonos.ts` |
| Transparencia de fondos | `FichaDeActivo` y `composicion.ts` |
| Cifrado de ficheros | Un sobre alrededor del texto de `almacen/formato.ts`; el contenido no cambia |
| Lector de extractos en PDF | `importacion/lectura.ts` |

## 9. Las puertas antes de dar algo por bueno

Desde `3-BDB-ACTIVOS_app`:

```bash
npm run typecheck
npm test
npm run build
node scripts/deadCssD3.mjs
npm run lint
```

Las pruebas del gestor están en `tests/gestor/` y corren solas en unos segundos con
`npx vitest run tests/gestor`. Toda cifra esperada de una prueba de cálculo sale de una cuenta a mano
escrita en un comentario junto a ella, nunca de la salida del motor: si una prueba falla, lo que se revisa
es el motor.
