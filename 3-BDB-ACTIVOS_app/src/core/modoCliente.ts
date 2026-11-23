/**
 * Qué significa Modo cliente. Decisión 19 de Óscar (04-11-2026).
 *
 * Hasta hoy cada pantalla decidía por su cuenta qué esconder, y salían las dos equivocaciones
 * a la vez: la ficha seguía diciendo al cliente «No nos los han dado 80», y el modo le quitaba
 * salvedades que necesita, como que una caída se mide sobre el 79 % de la cartera. Modo cliente
 * no es «enseñar menos»: es quitar lo comercial y la cocina, y dejar siempre lo que hace falta
 * para leer bien una cifra.
 *
 * **Esto NO es una frontera de seguridad.** Es una vista: se quita con un clic, los datos siguen
 * en el navegador y cualquiera con las herramientas del navegador los ve. Sirve para lo que se
 * enseña en una pantalla delante de un cliente, no para proteger nada. Lo que de verdad no debe
 * llegar a quien no corresponde se protege en las reglas de la base y en el servidor.
 *
 * ## Cómo lo aplica una pantalla
 *
 * ```tsx
 * const { seEnsena } = useModoCliente();   // de `src/app/ClientModeContext`
 * {seEnsena("retrocesiones") ? <ColumnaDeRetrocesion /> : null}
 * ```
 *
 * Lo de `SE_QUEDA_SIEMPRE` no se condiciona: una pantalla no pregunta por ello. Si una pantalla
 * necesita ocultar algo que no está en la lista, primero se añade a la lista, con su motivo.
 *
 * `tests/modoCliente.test.ts` recorre las pantallas y falla si una enseña algo de la primera
 * lista sin leer el modo. Las que aún no lo aplican están allí escritas, con el lote que las
 * hace, y esa lista solo puede bajar: al aplicarlo en una pantalla, se borra su línea.
 *
 * ## Lo que está hecho y lo que falta, pantalla a pantalla
 *
 * Hecho, en el marco: la sección «Datos» del menú y sus dos direcciones, que dicen «No disponible
 * en modo cliente»; el botón de la cuenta entero, que abre el correo y el estado de seguridad, y el
 * nombre que sale del correo; y «Publicar el de hoy». Lo demás lo aplica cada pantalla:
 *
 * - **Diseño de cartera.** Fuera «Estado», los avisos del mercado objetivo del fabricante en «Comprobar», y el motivo de lo que se queda fuera de la simulación; se queda
 *   qué se queda fuera y la cobertura bajo el título. En los escenarios de estrés, cada excluido dice por qué en palabras
 *   de cliente (`motivoDeFueraParaElCliente`). **Carteras guardadas** no se ofrece ni se abre.
 * - **Ficha.** Fuera «Procedencia y calidad», «Para quién está pensado (según el fabricante)», todo lo del bloque del emisor
 *   («Valor liquidativo del emisor» con la prima o descuento, «Lo que dice el emisor» y la comisión de swap), la nota «Para
 *   revisar», la fila «El índice, en nuestra base» y las líneas sobre lo que nos falta. Se queda «Falta el dato», la procedencia
 *   bajo cada título y la aptitud de reparto de la cabecera, aunque la fuente sea el emisor (decisión 56): es una aptitud del
 *   instrumento, no un dato suyo a la vista. Por lo mismo, la fila «Política de reparto» del Perfil enseña la que rellena el
 *   emisor, sin nombrarlo (decisión B-65).
 * - **Comparador.** Se quedan las fechas reales y el número de datos de la evolución. En Comparar
 *   carteras, A y B se eligen antes de entrar y el desplegable solo enseña esas dos, con «Sal de
 *   Modo cliente para ver otras carteras». El PDF de Comparar activos sale sin retrocesiones y no
 *   pregunta: fuera del modo se elige entre las dos salidas (decisión 20).
 * - **Informes.** En la Propuesta de cambio, Actual y Propuesta se eligen antes de entrar, igual que en Comparar carteras: se ofrecen
 *   la cartera activa y las dos ya elegidas, con «Sal de Modo cliente para ver otras carteras».
 * - **Análisis.** Fuera «Métricas locales aproximadas…» y «Composición subyacente» (decisión 9). Se
 *   quedan la cobertura y el «calculado sobre el X %» en estrés, y «Mayores acciones de la cartera»
 *   cuando las líneas de los fondos dicen qué son: si no, no sale. La matriz de solapamiento mide igual que fuera del modo —un ETF,
 *   con la cartera completa de su emisor (`adapters/carteraDelEmisor`, decisión del 14-11-2026)—, pero no dice de quién es la cartera.
 * - **Posiciones.** Sin Posiciones globales y sin Historial.
 * - **Estrategia.** Sin el proveedor del texto, tampoco en el PDF (decisión 67). La «Redacción automática (IA)» se queda.
 * - **Mercado.** Fuera el proveedor de la agenda (Yahoo, Forex Factory); se queda el periodo. El BCE se
 *   queda: es quien publica el dato, no un proveedor.
 * - **Carteras de clientes.** Fuera las demás carteras de la carpeta, el informe del asesor y el Excel, y la nota que el asesor
 *   escribe en un movimiento (en el resumen, en el libro de movimientos y en el extracto de la cuenta de efectivo). En papel la
 *   nota no llega nunca al cliente, con el modo o sin él (P1-11, 21-11-2026).
 * - **Planes y EPSV.** Fuera el nombre del proveedor de las cifras y «según el banco» de la comisión (decisión D-11). Se quedan
 *   la fecha de cada cifra, el día de la consulta, los avisos de un plan con el valor parado y las notas de la comparación.
 */

export const SE_OCULTA = {
  retrocesiones: "Lo que cobra la casa por cada producto. Es el motivo de que exista este modo.",
  ingresos: "Ingresos estimados y cesión: son la cuenta de la casa, no la del cliente.",
  fuenteDeDatos: "De qué proveedor o base viene un dato: es cocina, y la cifra no cambia por saberlo.",
  autorDeUnaDecision:
    "Quién tomó una decisión nuestra sobre un instrumento y cuándo, como una baja decidida: el cliente ve que la decidió la entidad y por qué; el nombre y la fecha son el registro del asesor.",
  calidadInterna: "Calidad interna del dato: distintivos y recuentos para el trabajo del asesor.",
  sinPedir: "«Sin pedir» y «Pendiente de incorporar»: nuestra lista de tareas, no un dato del cliente.",
  procedenciaYCalidad: "La sección «Procedencia y calidad» de la ficha.",
  otrasCarteras: "Otras carteras guardadas: son de otros clientes.",
  estadoDeLaCartera: "«Estado» en Diseño de cartera: el semáforo de trabajo del asesor. El peso medido se queda, bajo el título de la simulación.",
  documentosInternos: "Los documentos de uso interno del asesor, en toda la aplicación: Propuesta de mejora, también «Descargar la propuesta» en Optimizar, Informe interno del asesor.",
  historial: "El historial de análisis: lo que se hizo para otras reuniones.",
  posicionesGlobales: "Posiciones globales: el negocio entero de la casa, sumado.",
  correoYSeguridad: "En el marco: el botón de la cuenta, que enseña el correo del asesor y el estado de su seguridad, con «Revisar seguridad» y el nombre que sale del correo.",
  seccionDatos: "La sección «Datos» del menú: Salud del catálogo y Sistema, que no hablan de un cliente.",
  publicarEstrategia: "«Publicar el de hoy»: una tarea de administración, y no se debe pulsar en una reunión.",
  proveedorDeEstrategia: "Qué proveedor ha redactado el texto de Estrategia, en la pantalla y en su PDF.",
  mercadoObjetivo:
    "«Para quién está pensado (según el fabricante)» en la ficha: el mercado objetivo es un documento del fabricante para el distribuidor (Vanguard marca el suyo como solo para profesionales), y sus datos son de uso interno (decisión 53).",
  datosDelEmisor:
    "Todo lo que sale del bloque del emisor en la ficha: «Valor liquidativo del emisor» con la prima o descuento, «Lo que dice el emisor» y la comisión de swap en Coste. Sus datos son de uso interno para el desarrollo y no entran en lo que ve un cliente, ni en papel ni en pantalla (decisión B-53). La política de reparto que rellena cuando el proveedor no la sabe sí sale en el Perfil, sin nombrar al emisor (decisión B-65): es un hecho del instrumento, no una cifra del emisor, y su fuente ya se oculta por `fuenteDeDatos`.",
  carteraDelEmisor:
    "De quién es la cartera con la que se mide un ETF en la matriz de solapamiento («cartera del emisor»). La matriz usa la cartera completa del emisor también en Modo cliente y en el informe de cliente (decisión de Óscar del 14-11-2026, que revisa la B-79: «no los dejes fuera»); lo que no se enseña es quién la publica ni la cartera misma: sus datos son de uso interno (decisión 53). Se queda su fecha.",
  notasDelAsesor:
    "La nota que el asesor escribe en un movimiento de Carteras de clientes: es texto libre suyo —un acuerdo, una incidencia, algo del cliente— y no un dato de la cartera. En los informes para el cliente no sale nunca, ni en el de cartera ni en el de costes (P1-11 de la auditoría del 20-11-2026, aprobado por Óscar el 21-11-2026); en pantalla, se oculta en Modo cliente.",
  avisosDelMercadoObjetivo:
    "«La cartera frente al mercado objetivo y el horizonte declarados» en Comprobar: los avisos que cruzan el nivel y el horizonte de la cartera con el mercado objetivo que declara el fabricante de cada fondo y con el horizonte de su KID (decisiones 59 y B-66). Son datos del emisor, de uso interno (decisión 53), y la lectura del asesor sobre ellos no es lo que ve un cliente."
} as const;

export const SE_QUEDA_SIEMPRE = {
  cobertura: "«Calculado sobre el X % de la cartera»: sin esto la cifra dice más de lo que mide.",
  fechasYDatos: "Las fechas y el número de datos de cada gráfico.",
  simulacion: "«Simulación: no es una recomendación»: nunca se presenta una simulación como un hecho.",
  faltaElDato: "«Falta el dato» de cada cifra: un hueco no se esconde, se dice.",
  sinComisionesNiImpuestos: "La línea fija de lo que no incluye una propuesta antes de aplicarla (decisión 45): esos costes los paga el cliente."
} as const;

export type LoQueSeOculta = keyof typeof SE_OCULTA;

/** La lectura pura, para lo que no es un componente. Las pantallas usan `useModoCliente`. */
export function seEnsena(_que: LoQueSeOculta, modoCliente: boolean): boolean {
  /* Hoy todo lo de la lista se oculta igual, y aun así se pregunta por su nombre: así la lista
     dice qué pantalla oculta qué, y un día se puede afinar sin recorrer la aplicación. */
  return !modoCliente;
}
