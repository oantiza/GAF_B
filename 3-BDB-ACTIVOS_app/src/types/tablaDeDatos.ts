import type { ReactNode } from "react";
import type { ClaseDeAusencia } from "./fichaInstrumento";

/**
 * La tabla: la pieza que no existía.
 *
 * El diagnóstico del 02-11-2026 sobre el frontend decía que no hay un componente de
 * tabla —la tabla era un acuerdo, unos nombres de clase que cada pantalla volvía a
 * escribir a mano—, y que en una herramienta cuya pantalla principal ES una tabla eso
 * no es un sistema de diseño sino una costumbre. Esto es esa pieza.
 *
 * Y resuelve algo que la costumbre no resolvía: **una columna puede no tener una sola
 * escala**. En el catálogo conviven 641 instrumentos con métricas calculadas sobre
 * meses, 297 sobre días y 130 copiadas del proveedor. Ordenar los 1.076 por volatilidad
 * pone una desviación mensual al lado de una diaria, y la regla de este proyecto lo
 * prohíbe: nunca se ordena una cifra contra otra de escala distinta.
 */

/** Una celda: lo que se lee, o por qué no hay nada que leer. */
export interface CeldaDeTabla {
  /** Lo que se pinta cuando la celda no es texto, sino botones. Gana sobre `texto`. */
  nodo?: ReactNode;
  /** El texto. Cuando hay ausencia, su etiqueta; nunca un guion, que se lee como cero. */
  texto: string;
  /** Si falta, por qué: se pinta distinto según la clase, igual que en la ficha. */
  ausencia?: ClaseDeAusencia;
  /** Lo que ordena, cuando no coincide con el texto (una fecha, un porcentaje). */
  valor?: number | string;
  /** Segunda línea en gris bajo el texto: el ISIN, el método con que se calculó. */
  apunte?: string;
  /**
   * Una línea más bajo el apunte, solo por debajo de 1.440 px: lo que allí no cabe en su columna
   * (`soloAncho`) baja aquí en vez de perderse.
   */
  apunteEstrecho?: string;
  /**
   * El instrumento de esta celda: el texto pasa a ser un enlace de verdad a su ficha, que se enfoca,
   * se abre con Intro y admite abrirse en otra pestaña. Nunca dentro de `nodo`.
   */
  enlaceAFicha?: string;
  /**
   * Lo que va delante del texto y su apunte, en la misma celda: el corazón del favorito junto al nombre del activo
   * (17-11-2026). Es un botón de la pantalla, no un dato, así que pulsarlo no abre la fila.
   */
  antes?: ReactNode;
}

export interface ColumnaDeTabla<F> {
  id: string;
  titulo: string;
  /**
   * El nombre entero, cuando el título a la vista es corto («Vol. 3A» por «Volatilidad 3 años», Óscar, 17-11-2026): sale al
   * pasar el ratón y lo oye quien usa un lector de pantalla, detrás del corto, que sigue siendo lo primero del nombre.
   */
  tituloCompleto?: string;
  /** Cifras a la derecha y con cifras tabulares; texto a la izquierda. */
  cifra?: boolean;
  /**
   * Cierto cuando los valores de esta columna pueden venir de métodos distintos. Al
   * ordenar por ella, la tabla agrupa en vez de mezclar.
   */
  escalaMixta?: boolean;
  /**
   * La escala de la cifra de ESTA columna en una fila, cuando puede no ser la de la fila: el Sharpe a 3 años del
   * Buscador es del proveedor en fondos cuya rentabilidad y volatilidad a 1 año son nuestras (decisión A-171). Al
   * ordenar por la columna se agrupa por esto; sin ello, por `fila.escala`.
   */
  escalaDe?: (fila: F) => string | undefined;
  celda: (fila: F) => CeldaDeTabla;
  /**
   * Una columna que no es un dato sino una acción: los botones de añadir a cartera o
   * marcar para comparar. No se ordena —no hay nada que comparar entre dos botones— y
   * lo que se pulsa dentro no abre la fila.
   *
   * Es un `ReactNode` y no un campo del modelo porque depende del estado de la
   * aplicación —la cartera activa, la selección de comparación— y la tabla no debe
   * saber qué es una cartera. El mismo criterio que los huecos de la ficha.
   */
  acciones?: boolean;
  /**
   * Un dato que está en su columna y por el que no se ordena: la retrocesión del catálogo del
   * Comparador (decisión 17 de Óscar), o una tabla de tres filas que se leen en su orden. Se
   * distingue de `acciones` porque su celda es un dato y se pinta como tal.
   */
  sinOrden?: boolean;
  /**
   * La celda de esta columna es el encabezado de su fila, un `<th scope="row">`: así un lector de
   * pantalla dice de qué fondo es cada cifra, y no solo de qué columna.
   */
  encabezaFila?: boolean;
  /**
   * La columna lleva el nombre de un activo, largo y con su apunte debajo: no baja de un ancho mínimo
   * (`--columna-nombre-corta`). Sin él, las columnas de cifras se quedan con el sitio y el nombre se parte en cinco
   * líneas. No es para un rótulo corto («Fecha», «Concepto»), que no lo necesita.
   */
  nombre?: boolean;
  /**
   * La columna lleva una frase larga (un motivo, una lista de avisos): no baja de un ancho de lectura
   * (`--columna-prosa-min`). Sin él, en una pantalla estrecha la frase se parte en diez líneas y cada fila mide un
   * palmo; con él, la tabla desplaza dentro de su marco y la fila se queda en tres o cuatro.
   */
  prosa?: boolean;
  /** Por debajo de 1.440 px la columna no se pinta. Lo que dice lo lleva `apunteEstrecho`. */
  soloAncho?: boolean;
  /**
   * El título no se ve y solo lo oye quien usa un lector de pantalla. Para una columna de botones,
   * donde un rótulo a la vista no añade nada y puede confundir: «Acciones» es también un tipo de
   * instrumento.
   */
  tituloOculto?: boolean;
}

/**
 * Por dónde va una tabla: el orden y la página. Lo guarda quien quiera que sobreviva a la pantalla;
 * sin eso, la tabla lo lleva sola y se pierde al desmontarse.
 */
export interface EstadoDeTabla {
  orden: string | null;
  sentido: 1 | -1;
  pagina: number;
}

/** Una fila que la tabla puede agrupar: dice de qué escala viene su cifra. */
export interface FilaAgrupable {
  /** Clave estable de la fila. */
  id: string;
  /** El método con el que se calcularon sus cifras, si lo hay. */
  escala?: string;
  /**
   * En una tabla `agrupada`, el grupo al que pertenece. Nada que ver con `escala`: esto lo decide
   * quien monta la tabla (los fondos de una misma estrategia), no el método de la cifra.
   */
  grupoDeFilas?: string;
  /** Esta fila es la cabecera de su grupo: su encabezado vale para todo el grupo. */
  cabeceraDeGrupo?: boolean;
}
