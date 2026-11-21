# Gestor de carteras — Plan

*13-11-2026. Encargo de Óscar: convertir «Rendimiento» en un gestor de carteras profesional para asesores.
Este documento es el plan; el estado vive en `PROGRESO.md` y la guía para ampliar en `ARQUITECTURA.md`.
Rama de trabajo: `gestor-carteras`, en la copia `.claude/worktrees/gestor-carteras` para no pisar a las
sesiones que comparten la carpeta principal.*

## 1. Qué se encontró al leer el código

Hechos comprobados, que condicionan el plan:

1. **Rendimiento calcula en el servidor.** La pantalla envía el texto de los extractos a la Function
   `analyze_real_portfolio` (5.776 líneas de Python en `functions_python/portfolio_real/`). El gestor no puede
   hacer eso: las carteras no salen del equipo. **El lector de extractos y el motor se escriben en TypeScript y
   corren en el navegador.** El lector de Python (`parser.py`) es la referencia de lo que ya funciona.
2. **Rendimiento no tiene libro de movimientos ni FIFO.** Reconstruye títulos a partir del concepto del
   extracto y estima el resultado realizado. No guarda nada salvo un resumen en Firestore.
3. **Solo se reconoce una entidad (Andbank) y tres documentos:** movimientos de la cuenta de efectivo,
   posiciones y operaciones de valores. Son ficheros `.xls` que por dentro son HTML. No hay lector de PDF.
4. **Diseño trabaja con pesos, no con movimientos.** Su análisis (`backtest_portfolio`) recibe `asset_id` y
   peso y simula sin flujos. Sus convenciones: serie diaria dibujada, medida semanal (última observación de
   cada semana ISO), volatilidad muestral × √52, años = días / 365,2425, Sharpe = (rentabilidad anual − libre
   de riesgo) / volatilidad, libre de riesgo = media del €STR en la ventana.
5. **Los precios diarios en bruto están en la base nueva** (`instruments/{isin}/price_series/{año}`, en la
   divisa del activo) y las reglas dejan leerlos con sesión. **Los tipos de cambio (`fx_rates`, BCE, seis
   divisas desde 1999) y el €STR (`reference_rates`) existen en la base, pero las reglas no dejan leerlos
   desde el navegador.** En local se leen por el emulador.
6. **No hay bonos en el catálogo** (772 fondos, 529 acciones, 32 ETF). Un bono entra en el gestor como activo
   propio de la cartera, con sus condiciones y su precio a mano.
7. **No hay aritmética decimal en la app** (todo es `number`), ni logotipo del asesor en los informes.
8. **No hay extractos reales en el repositorio**, por privacidad. Las pruebas usan extractos sintéticos.

## 2. Arquitectura

Todo el gestor vive en `3-BDB-ACTIVOS_app/src/gestor/`, separado en capas que solo dependen hacia abajo:

```
src/gestor/
  motor/          Cálculo puro. Sin React, sin almacenamiento, sin red. Probado por su cuenta.
    decimal.ts        Aritmética decimal (big.js) y redondeo de presentación
    fechas.ts         Días ISO, diferencias, semanas, fines de mes
    modelo.ts         Cartera, cuentas, activo, movimiento
    efectos.ts        Los efectos primitivos que entiende el libro
    movimientos/      UN MÓDULO POR TIPO + registro.ts
    libro.ts          Aplica movimientos → estado de las dos cuentas a cualquier fecha
    lotes.ts          Coste FIFO y resultado realizado
    valoracion.ts     Valor diario de la cartera con precios y cambios
    bonos.ts          Cupón corrido y calendario de cupones
    rentabilidad.ts   TWR, TIR, periodos, tabla por meses
    desglose.ts       Precio, ingresos, divisa, costes; contribución por posición
    riesgo.ts         Volatilidad, máxima caída, Sharpe
    composicion.ts    Tipo de activo, divisa, región, sector, principales posiciones
    integridad.ts     Duplicados, conciliación con el extracto, precios que faltan
    metricas/         UN MÓDULO POR MÉTRICA + registro.ts (con su ayuda en lenguaje llano)
    analisis.ts       Orquesta: cartera + mercado + periodo → Analisis (lo único que leen pantalla e informes)
  mercado/        Datos de mercado de la plataforma: precios, cambios, €STR, catálogo. Devuelve datos planos.
  importacion/    Lectura de documentos → movimientos propuestos
    lectura.ts        Fichero → tablas de texto (HTML, Excel, CSV)
    registro.ts       Registro de importadores
    andbank/          UN MÓDULO POR ENTIDAD
    plantilla/        Plantilla genérica CSV/Excel
    propuesta.ts      Emparejar, detectar duplicados, conciliar
  almacen/        Ficheros en el disco del usuario
    formato.ts        Formato versionado + migraciones/ (una por versión)
    carpeta.ts        File System Access API (carpeta de carteras)
    descarga.ts       Alternativa: abrir y descargar ficheros
    copias.ts         Copias de seguridad con versiones
  demo/           Cartera de demostración (se genera, no se guarda)
  informes/       Informe del asesor y del cliente (PDF) y Excel
    secciones/        UN MÓDULO POR SECCIÓN + registro.ts
  ui/             Pantallas y componentes React. Solo consumen `Analisis` y el estado de la cartera.
```

**Las cuatro piezas que se registran** (tipos de movimiento, importadores, métricas y secciones de informe)
siguen el mismo patrón: cada una en su módulo, con su definición y sus pruebas, y un `registro.ts` que las
lista. Añadir una es añadir un módulo y una línea en el registro; el núcleo no se toca.

**El contrato entre un tipo de movimiento y el libro son los efectos primitivos.** Un tipo no escribe en las
cuentas: declara qué efectos produce (`efectivo`, `titulos`, `flujoExterno`, `ingreso`, `coste`,
`ajusteDeTitulos`, `canje`). El libro solo entiende esos efectos. Un tipo nuevo los combina.

## 3. Modelo de datos

**Cartera** (un fichero por cartera):

| Campo | Qué es |
|---|---|
| `id`, `nombre`, `divisaBase` | Identidad. La divisa base por defecto es EUR |
| `cliente?` `{id?, nombre?}` | Opcional. Deja preparado agrupar carteras por cliente o familia |
| `referencia?` | El índice de referencia que elige el usuario |
| `cuentas.efectivo`, `cuentas.valores` | Las dos cuentas, con nombre y entidad |
| `activos` | Los activos que usa la cartera: ISIN, nombre, tipo, divisa, enlace al catálogo o «manual», y condiciones del bono si lo es |
| `movimientos` | El libro |
| `preciosManuales` | Precios introducidos a mano, por activo y fecha |
| `extractos` | Lo que declara cada extracto importado (posiciones y efectivo a una fecha), para conciliar |
| `importaciones` | Registro de cada importación (documentos, fecha, número de movimientos), para deshacerla y detectar duplicados |
| `extensiones?` | Campo libre que se conserva al guardar. Aquí cabrá la asignación objetivo o un mandato sin cambiar de versión |

**Movimiento:**

| Campo | Qué es |
|---|---|
| `id`, `tipo` | Identificador y tipo (clave del registro) |
| `fechaOperacion`, `fechaValor?` | Las dos fechas. Las posiciones y la rentabilidad usan la de operación (contabilidad por fecha de contratación, que es el estándar); el saldo de efectivo se puede consultar por cualquiera de las dos |
| `activoId?`, `titulos?`, `precio?` | La pata de valores. El precio va en la divisa del activo |
| `divisa`, `importe` | La pata de efectivo: divisa de la cuenta e importe neto con signo |
| `bruto?`, `comision?`, `gastos?`, `retencion?`, `cuponCorrido?` | Desglose del importe |
| `cambio?` | Tipo de cambio explícito cuando la divisa del activo y la del efectivo no coinciden |
| `destino?` | Segundo activo en traspasos y canjes (`activoId`, `titulos`, `precio`) |
| `razon?` | Proporción de un split o un canje |
| `nota?`, `origen` | Texto libre y procedencia: manual o importado (importación, documento, fila) |

Importes, títulos, precios y cambios se guardan como **texto decimal** (`"1234.56"`) y se calculan con
aritmética decimal. Solo se redondea al mostrar.

**Las dos cuentas.** La cuenta de efectivo lleva un saldo por divisa (lo normal es una sola, la base). La
cuenta de valores lleva, por activo, sus lotes de compra (fecha, títulos, coste). Las ventas consumen lotes
por orden de antigüedad (FIFO).

**Tipos de movimiento** (cada uno en su módulo):

| Grupo | Tipos |
|---|---|
| Efectivo | Aportación, retirada, intereses de la cuenta, comisión o gasto, retención o impuesto, cambio de divisa, otro cargo o abono |
| Compraventa | Compra, venta, suscripción de fondo, reembolso de fondo, traspaso entre fondos |
| Ingresos | Dividendo, cupón |
| Valores sin efectivo | Entrada de títulos, salida de títulos, dividendo en acciones |
| Operaciones corporativas | Split y contrasplit, canje o fusión, amortización o vencimiento de bono |

Los cinco últimos de la lista (cambio de divisa, otro cargo o abono, dividendo en acciones, canje,
amortización) son los que añado porque un profesional los echaría en falta: sin ellos no se puede seguir
una cuenta con divisas, un scrip dividend, un cambio de ISIN ni el vencimiento de un bono.

**Preparado para lo siguiente.** Sin implementar nada de «fuera de este encargo»: `cliente` admite la vista
por familia; `extensiones` admite asignación objetivo y bandas; el desglose diario por posición es la base
de una atribución; el formato versionado admite un sobre cifrado alrededor del mismo contenido.

## 4. Cálculo

| Qué | Cómo |
|---|---|
| Valoración | Diaria. Títulos × último precio conocido × cambio a la divisa base, más el efectivo. Un bono se valora con precio limpio más cupón corrido. La serie de una acción o un ETF viene ajustada por dividendos: su precio real se reconstruye con los dividendos del libro |
| Rentabilidad ponderada por tiempo (TWR) | Rentabilidad de cada día encadenada. Las entradas cuentan desde el inicio del día y las salidas al final, para que una aportación o retirada no altere la cifra. Neta de comisiones porque las comisiones salen del efectivo |
| Rentabilidad del cliente (TIR) | Tasa interna de los flujos externos con su fecha, más el valor inicial y final del periodo. Se resuelve la tasa del periodo (no la anual), porque en periodos de días una tasa anualizada se sale de lo que acota `core/xirr.ts`; una prueba comprueba que las dos coinciden donde las dos valen |
| Anualización | Solo en periodos de más de un año. Años = días / 365,2425, como Diseño |
| Flujos externos | Aportaciones, retiradas y entradas o salidas de títulos (a su valor de mercado). Dividendos, cupones, intereses, comisiones y retenciones son resultado, no flujo |
| Resultado realizado y latente | FIFO. En un traspaso entre fondos el resultado del fondo de origen se da por realizado a efectos de seguimiento (no es un cálculo fiscal) |
| Desglose del resultado | Precio + ingresos + divisa − comisiones y gastos = resultado. La suma cuadra al céntimo por construcción: el efecto divisa de cada posición es su resultado en divisa base menos su resultado en divisa local convertido al cambio del día |
| Contribución | La parte de la rentabilidad que aporta cada posición, enlazada día a día para que la suma sea la TWR |
| Riesgo | Las mismas convenciones que Diseño, para que las cifras se puedan comparar: medida semanal, volatilidad muestral × √52, máxima caída sobre la serie diaria, Sharpe con la media del €STR. Si faltan observaciones, la cifra no se da |
| Comparación con Diseño | Una cartera de Diseño (pesos) se convierte en un libro de un solo día: una aportación y sus compras. Así pasa por el mismo motor y se compara con las mismas cifras. Y las posiciones de una cartera del gestor se pueden abrir en Diseño |

**Pruebas hechas a mano.** TWR, TIR, FIFO, saldos, valoración, desglose, cupón corrido y contribución llevan
carteras pequeñas cuyo resultado se calcula a mano en un comentario junto a cada cifra esperada. Ninguna
cifra esperada sale del propio motor.

## 5. Almacenamiento

- **Carpeta de carteras** que el usuario elige una vez (File System Access API, Chrome y Edge). El navegador
  recuerda el permiso de la carpeta, no su contenido. Cada cartera es un fichero `Nombre.cartera.json`.
- **Alternativa** para navegadores sin esa API: abrir un fichero y descargarlo al guardar. La pantalla lo
  explica.
- **Guardado automático** tras cada cambio. **Copias de seguridad** en la subcarpeta `copias/` con fecha y
  hora, recuperables desde la pantalla; se conservan las últimas y una por día.
- **Formato versionado** (`formato`, `version`) con una migración por versión y sus pruebas.
- **Deshacer** dentro de la sesión, además de las copias.
- Nada del gestor va a Firestore ni al almacenamiento del navegador. El único tráfico de red es pedir datos
  de mercado por ISIN.

## 6. Importación

Un importador declara qué reconoce y devuelve movimientos propuestos. El flujo es siempre el mismo: soltar
varios documentos → reconocer entidad y tipo → emparejar y proponer → **revisar** → confirmar.

- **Andbank** (los tres documentos que ya funcionan), trasladado de `parser.py` con sus comprobaciones: saldo
  fila a fila, extractos encadenados por saldo, subtotales de posiciones, canjes 1 a 1, cargos de mercado.
  Las operaciones de valores dan ISIN, títulos, precio y divisa; los movimientos de efectivo dan los importes
  reales; las posiciones sirven para conciliar.
- **Plantilla genérica** CSV/Excel para cualquier otra entidad, descargable con ejemplos.
- **Activo que no está en el catálogo:** se proponen coincidencias por ISIN o nombre, o se crea con precio a
  mano.
- **Integridad:** conciliación con el extracto (títulos por activo y saldo de efectivo), aviso de duplicados
  (contra el libro y dentro de la propia importación) y deshacer una importación entera.
- **PDF:** la arquitectura admite un lector de PDF, pero no se construye en este encargo: no hay ningún
  extracto en PDF contra el que probarlo, y un lector sin probar contra documentos reales sería una promesa
  falsa. Queda como mejora.

## 7. Pantalla

El gestor ocupa el lugar de «Rendimiento» en el menú, con el nombre **Gestor de carteras**. Usa las piezas
de la app (`Panel`, `TablaDeDatos`, `PageHeader`, `KpiStrip`, `ModalDialog`, gráficos `Oaa*`) y sus tokens:
papel `#fcfcfb`, tinta, filetes y el índigo `#33406b` como acento azul.

| Pantalla | Qué responde |
|---|---|
| Carteras | Qué carteras tengo. Primer uso: elegir carpeta, crear, importar o abrir la demostración |
| Resumen de una cartera | Cuánto vale, cuánto ha ganado o perdido (€ y %), en qué está invertida y qué ha pasado |
| Cuentas | Posiciones de la cuenta de valores y saldo de la cuenta de efectivo, a cualquier fecha; posiciones cerradas |
| Movimientos | El libro: alta, edición, borrado, filtros |
| Análisis | Rentabilidad, desglose, tabla por meses, referencia, riesgo, composición, contribución, ingresos y costes, bonos |
| Importar | Documentos → revisión → confirmación |
| Comparar | Carteras del gestor y de Diseño, con las mismas cifras |
| Informes | Informe del asesor y del cliente, en PDF y Excel |

## 8. Informes

Los dos salen del mismo `Analisis` que la pantalla, para un periodo libre.

- **Informe del asesor:** identidad interna (`pdfTheme.ts`). Posiciones y movimientos completos, conciliación,
  avisos, costes e ingresos, rentabilidad por posición.
- **Informe del cliente:** papel de cliente (`clientReportTheme.ts`, la identidad crema que la app reserva a
  lo que se entrega). Breve y explicado, sin jerga ni marca de entidad, con el nombre y el logotipo del
  asesor.
- **Excel** con los mismos datos (SheetJS, que ya está en la app).
- Cada PDF se revisa página a página contra la pantalla antes de darlo por bueno.

## 9. Qué se reutiliza y qué cambia

| Se reutiliza | Para qué |
|---|---|
| `core/xirr.ts` | Contraste de la TIR en las pruebas |
| `core/importFileReader.ts` | Leer `.xls`-HTML, `.xlsx` y CSV a texto |
| `adapters/baseNuevaLectura.ts` | Leer precios, cambios, €STR y catálogo |
| `adapters/catalogoEnSesion.ts`, `core/busquedaDeActivos.ts` | Buscar activos por nombre o ISIN |
| `core/format.ts`, `core/numberFormat.ts` | Formato y lectura de cifras en español |
| Piezas de `components/ui`, `components/tabla`, `charts/oaa` | Toda la pantalla |
| `reports/papelDeCliente.tsx`, los dos temas | Los dos informes |
| `core/positionsToPortfolio.ts` y el envío a Diseño | Abrir en Diseño las posiciones de una cartera |
| Las convenciones de `weekly_sampling.py` | Riesgo comparable con Diseño |

| Cambia | Cómo |
|---|---|
| Entrada «Rendimiento» del menú | Pasa a ser «Gestor de carteras» |
| La pantalla anterior de Rendimiento | **Se conserva**, accesible desde el gestor como «Análisis rápido de extractos», hasta que Óscar confirme con extractos reales que el gestor la sustituye. **Hecho el 14-11-2026: se retiró** (`c8f3b802`, decisión de Óscar «al acabar el rediseño»); su motor en Python se borró el 17-11-2026 (`0f80ae01`, A-188) y queda en la etiqueta `referencia-portfolio-real-2026-11-17` |
| `vite.config.ts` | El patrón que ignora `.claude` deja de apagar la recarga cuando la app vive en una copia de trabajo |
| Tokens de color | Se añaden dos, verde y rojo, **solo para el signo de las cifras** del gestor |

## 10. Decisiones tomadas por el director

Las tomo yo para no parar; Óscar puede cambiarlas.

1. **El motor corre en el navegador y se escribe en TypeScript.** Es la única forma de que las carteras no
   salgan del equipo.
2. **Verde y rojo solo en el signo de las cifras del gestor.** La dirección visual de la app no los usa
   («una cifra no es buena ni mala»), pero el encargo los pide expresamente para positivo y negativo.
3. **Se conserva la pantalla anterior de Rendimiento** hasta validar el gestor con extractos reales. Se
   comprobó en producción hoy mismo, y borrarla sin esa validación sería imprudente. **Hecho el 14-11-2026: se
   retiró** (`c8f3b802`), por decisión de Óscar de retirarla al acabar el rediseño; su motor en Python se borró
   el 17-11-2026 (`0f80ae01`, A-188).
4. **Un traspaso entre fondos realiza el resultado del fondo de origen** a efectos de seguimiento. La
   fiscalidad está fuera de alcance.
5. **Los bonos son activos propios de la cartera**, porque el catálogo no los tiene.
6. **El riesgo se mide como en Diseño**, para que las dos cifras se puedan poner una al lado de la otra.
7. **El nombre y el logotipo del asesor** se guardan en un fichero de ajustes dentro de la carpeta de
   carteras, no en la base.
8. **Sin lector de PDF en esta fase** (apartado 6).

## 11. Decisión que necesita a Óscar

**Abrir a lectura `fx_rates` y `reference_rates` en las reglas de la base nueva.** Son los tipos de cambio y
el €STR del BCE: datos públicos, sin nada de clientes. Hoy las reglas no dejan leerlos desde el navegador, y
el gestor los necesita para valorar activos en divisa y para el Sharpe. Es un cambio de dos reglas y un
despliegue, y por tanto necesita su aprobación. **En local no bloquea**: el emulador los sirve. Mientras no
se apruebe, en producción los activos en divisa se valorarían con el cambio de sus propios movimientos y el
gestor avisaría de que falta el cambio diario. Recomiendo aprobarlo.

**Aprobado por Óscar el 13-11-2026, y preparado sin desplegar.** Las dos reglas están en
`4-base-nueva/firestore.rules` de esta rama, con sus casos en `probar-reglas.mjs`. Probadas en un emulador
aparte con las reglas de la rama: 17 comprobaciones, todas bien (con sesión se leen, sin sesión no, nadie
escribe ni borra, y lo demás sigue cerrado). Con las reglas de hoy, la misma lectura con sesión da 403. El
despliegue lo hace Óscar, desde `4-base-nueva`, y conviene hacerlo **junto con la fusión de la rama**: antes
no sirve de nada, porque la web publicada todavía no lleva el gestor, y una regla desplegada desde una rama
sin fusionar se perdería en el siguiente despliegue hecho desde la principal.

**Hecho el 13-11-2026: desplegadas por Óscar.** Con `verReglasDesplegadas.ts`, la release activa era de las 20:20 UTC e
igual al fichero `4-base-nueva/firestore.rules` del repositorio, que ya lleva la lectura de `fx_rates` y
`reference_rates`; y en su cartera real de la web el análisis da el ratio de Sharpe y no avisa de tipos de cambio
(`COORDINACION_SESIONES.md`, entradas del 13-11 22:25 y del 14-11 00:25).

## 12. Fases y criterios de aceptación

| Fase | Qué deja funcionando | Se acepta cuando |
|---|---|---|
| 1 · Núcleo | Modelo, tipos de movimiento, las dos cuentas, FIFO y valoración | Pruebas a mano en verde: saldos de efectivo y valores a varias fechas con todos los tipos; FIFO con ventas parciales; valoración con divisa |
| 2 · Ficheros | Formato versionado, carpeta, alternativa, copias, deshacer | Una cartera se guarda, se vuelve a abrir idéntica y se recupera una versión anterior; una migración de prueba pasa |
| 3 · Mercado | Precios, cambios, €STR y catálogo desde la plataforma; precios a mano | Una cartera con activos del catálogo se valora en local con datos reales; lo que falta se marca |
| 4 · Análisis | TWR, TIR, desglose, periodos, tabla por meses, riesgo, referencia, composición, contribución, ingresos y costes, posiciones cerradas, bonos, integridad | Pruebas a mano en verde para cada cálculo; el desglose suma el resultado al céntimo; la contribución suma la TWR |
| 5 · Pantalla base | Carteras, crear, resumen, cuentas a fecha, movimientos a mano, demostración | Se crea una cartera a mano en el navegador, se ven sus dos cuentas a cualquier fecha y se vuelve a abrir desde el disco |
| 6 · Importación | Andbank, plantilla genérica, revisión, conciliación, duplicados, deshacer | Un juego de extractos sintéticos se importa, se revisa y cuadra con su extracto; un segundo intento avisa de duplicados |
| 7 · Análisis en pantalla | Pestaña de análisis entre fechas y comparación con Diseño | Las cifras de pantalla coinciden con las del motor; una cartera de Diseño y una del gestor se comparan |
| 8 · Informes | Informe del asesor y del cliente en PDF, y Excel | Cifras iguales a la pantalla; ninguna página cortada ni vacía, revisadas una a una |
| 9 · Cierre | Pulido, `ARQUITECTURA.md`, batería completa | `typecheck`, `test`, `build`, censo de CSS y `lint` en verde; todas las pantallas revisadas en el navegador |

## 13. Fuera de este encargo

Anotado, sin implementar: atribución por asignación y selección, VaR y escenarios de estrés, analítica
avanzada de renta fija, mandatos con bandas y rebalanceo, vista consolidada por familia, transparencia de
fondos, cifrado de ficheros, y el lector de extractos en PDF.
