/**
 * El modelo de vista de la ficha de un instrumento (dirección A + B, 02-11-2026).
 *
 * NO es la tarjeta de lectura de la base nueva, y la distinción importa. La tarjeta
 * (`instruments/<ISIN>/read/card`) está pensada para la fila de una LISTA: proyecta
 * costes, exposición, cartera, precio, patrimonio y sostenibilidad, y de perfil y
 * regulación solo la política de reparto y el indicador de 1 a 7. Las otras cuatro
 * secciones que un fondo declara —reparto, procedencia, y rentabilidad y riesgo del
 * proveedor— se anuncian en `available_sections` y se leen en su propio documento,
 * «porque solo se miran con la ficha delante». Lo dice su contrato.
 *
 * Así que la ficha necesita más de una lectura, y lo que pinta es esto: un modelo ya
 * compuesto. El componente es entonces una función pura de estos datos, sin una sola
 * rama que pregunte si el instrumento es un fondo o una acción —eso lo decide quien
 * compone, a partir de lo que el instrumento declara—, y se puede probar sin base.
 */

/**
 * Por qué no está un dato. Son las tres clases que distingue la base nueva, y la
 * ficha las pinta DISTINTO a propósito: confundirlas es la mentira más barata que
 * puede contar esta pantalla.
 *
 * - `no-aplica`: la casilla está cerrada. Una acción no tiene coste corriente; este
 *   fondo no se acoge a los artículos 8 ni 9 del SFDR. No es culpa de nadie y no hay
 *   nada que buscar, así que no debe parecer un hueco.
 * - `falta`: hueco real, y es del proveedor. No nos lo ha dado.
 * - `sin-pedir`: la única que se resuelve trabajando. El índice de referencia de un fondo
 *   que no está dado de alta en la base es el caso canónico: mientras no lo esté, su alfa
 *   es la del proveedor en vez de la nuestra.
 */
export type ClaseDeAusencia = "no-aplica" | "falta" | "sin-pedir";

/** Una celda de la tabla de una sección: una cifra, o por qué no está. Nunca una raya. */
export type CeldaDeSeccion = string | { texto: string; ausencia: ClaseDeAusencia };

/**
 * Un trozo de texto con o sin énfasis. La procedencia y los avisos se componen así y
 * no con HTML: el texto sale de la base, y la base no es sitio del que fiarse para
 * inyectar etiquetas en la pantalla de un asesor.
 */
export interface Trozo {
  texto: string;
  /** La fuente del dato, lo que se destaca: «del proveedor», «del KID». */
  fuerte?: boolean;
}

/** Una fila de una sección: rótulo a la izquierda, cifra a la derecha. */
export interface FilaDeFicha {
  /** El rótulo. */
  rotulo: string;
  /**
   * Lo que se lee a la derecha. Cuando hay ausencia es su etiqueta («No aplica»,
   * «Falta el dato», «Pendiente de alta»), nunca un guion: un guion se lee como cero, y
   * un cero creíble es peor que un error.
   */
  valor: string;
  /** Si falta, por qué. Ausente = el dato está. */
  ausencia?: ClaseDeAusencia;
  /**
   * El motivo, cuando la base lo guarda escrito. No se redacta en la interfaz: viene
   * de `quality/latest`, campo a campo, y por eso se puede enseñar en vez de inventar.
   */
  glosa?: string;
  /** La cifra protagonista de su sección, como el precio. Una por sección, o ninguna. */
  destacada?: boolean;
  /** Un texto corrido, como la actividad de una empresa: va debajo del rótulo y parte en líneas. */
  larga?: boolean;
  /**
   * La misma cifra que `valor`, en número y en fracción, cuando la fila es una parte de un reparto (sectores, regiones, estilo,
   * tamaño). El papel dibuja con ella la barra de la fila (decisión A-124), y desde el 14-11-2026 también la pantalla, en la
   * pestaña «Cartera» y en «En qué invierte» (`partesDeLaSeccion`, `partesDelResumen`): así ninguno de los dos tiene que volver
   * a leer un número de un texto ya escrito.
   */
  peso?: number;
}

/**
 * La caja de estilo y tamaño de un fondo (decisión A-123): las nueve celdas de su renta variable, tres filas de tamaño por tres
 * columnas de estilo, como las publica el proveedor. No cabe en `filas`, que son rótulo y cifra: aquí cada cifra tiene dos
 * rótulos, el de su fila y el de su columna, y la lectura es la retícula entera.
 */
export interface CajaDeFicha {
  /** El estilo, de izquierda a derecha: «Valor», «Mixto», «Crecimiento». */
  columnas: string[];
  /** El tamaño, de arriba abajo: «Grande», «Mediana», «Pequeña». Tres celdas por fila, en el orden de `columnas`. */
  filas: Array<{
    rotulo: string;
    celdas: Array<{
      /** La cifra escrita, con la misma precisión que los repartos de al lado. */
      valor: string;
      /** La misma, en fracción de la renta variable. Puede ser negativa (neta de cortos) o pasar de 1 (el proveedor reescala lo neto). */
      peso: number;
      /** La celda con más peso. Si hay empate a la precisión escrita, lo son todas las empatadas. */
      destacada?: boolean;
    }>;
  }>;
}

/** Una sección de la ficha: lo que el instrumento declara, no una plantilla. */
export interface SeccionDeFicha {
  /** Clave estable, para pruebas y para anclas. */
  id: string;
  titulo: string;
  /**
   * De quién es el dato y desde cuándo, pegado bajo el título. Es lo que hace que
   * esta ficha sea defendible delante de un cliente: nada se afirma sin decir quién
   * lo dice.
   */
  procedencia: Trozo[];
  filas: FilaDeFicha[];
  /**
   * Para lo que no es rótulo y cifra: las diez mayores posiciones de una cartera, con
   * su sector y su peso. Solo en secciones anchas.
   */
  tabla?: {
    columnas: string[];
    filas: CeldaDeSeccion[][];
    /**
     * Qué columnas llevan cifra, por índice, y por tanto van alineadas a la derecha.
     * Sin esto solo se alinea la última, que es lo que quiere la tabla de posiciones
     * —posición, sector, peso— y lo que descuadra la de métricas, donde son cifras
     * todas menos la primera: dos columnas de números que no comparten eje derecho no
     * se pueden comparar de un vistazo, que es justo para lo que está la tabla.
     */
    cifras?: number[];
  };
  /**
   * Texto citado del proveedor, como el objetivo de un fondo. Va en cursiva y se deja
   * en su idioma: un objetivo es texto legal, y traducirlo en pantalla sería ponerle
   * palabras nuestras a un compromiso suyo.
   */
  prosa?: string;
  /**
   * Un aviso de la sección, bajo su procedencia y antes de las filas, con el filete de los avisos de la ficha. Para lo que el
   * asesor no puede pasar por alto: que el fabricante no piense el producto para minoristas.
   */
  aviso?: Trozo[];
  /** Una aclaración al pie, en gris. */
  nota?: string;
  /**
   * Una contradicción del propio dato, en terracota y con filete a la izquierda: el
   * fondo que declara reparto y no reparte desde 2021. Las dos cosas son ciertas, y
   * enseñar solo una sería engañar.
   */
  contradiccion?: string;
  /** La caja de estilo y tamaño (decisión A-123). Solo en su sección, y solo con las nueve celdas. */
  caja?: CajaDeFicha;
  /** Va en la banda ancha de abajo, no en el flujo de columnas. */
  ancha?: boolean;
}

/**
 * La evolución histórica tal como la está enseñando la pantalla en ese momento (decisión A-124): la serie que la ficha ha cargado,
 * en la ventana elegida, con la misma procedencia y la misma variación escritas. No es parte de lo que la base dice del instrumento
 * —sale de otra lectura, la de la serie de precios—, y por eso no va dentro de `FichaInstrumento`: la página se la pasa al papel. Si
 * la ficha no la tiene cargada, no hay nada que imprimir y el papel no dibuja la sección.
 */
export interface EvolucionDeLaFicha {
  /** «Base 100 · diaria · EUR · 883 observaciones · oct 2023 – oct 2026», la línea de la pantalla. */
  procedencia: string;
  fechas: string[];
  /** Base 100, alineados con `fechas`; un hueco es `null`. */
  valores: Array<number | null>;
  /**
   * La variación del periodo como la escribe la pantalla («+57,9 %»), su ausencia («Falta el dato») o nada: una clase que reparte
   * no lleva variación (decisión 8), y la pantalla no pinta la fila.
   */
  variacion?: string;
}

/** Para qué sirve el instrumento, uso por uso. Sale de `quality.fitness`. */
export interface AptitudDeFicha {
  rotulo: string;
  /** La cifra que lo demuestra, o la etiqueta de por qué no. */
  valor: string;
  /** `reserva`: la cifra está, pero falta algo para poder usarla sin más, y el valor dice qué. */
  estado: "si" | "reserva" | "no-aplica" | "falta";
}

/** Lo que la ficha pinta. */
export interface FichaInstrumento {
  /** `FUND`, `STOCK`… en palabras: «FONDO DE INVERSIÓN», «ACCIÓN». */
  tipo: string;
  nombre: string;
  /** ISIN · divisa · categoría…, la línea de identificación. */
  identificacion: string;
  /**
   * El estado de cotización. Un instrumento que dejó de cotizar se marca, no
   * desaparece, y se marca con la FECHA y no con un adjetivo: «Dejó de cotizar ·
   * 21 sep 2026» no suena a pérdida de dinero, y un icono rojo sí.
   */
  disponibilidad: {
    rotulo: string;
    valor: string;
    estado: "cotiza" | "baja" | "sin-medir";
    /**
     * De dónde sale una baja (decisión 13 de DECISIONES_DATOS_2026-11-07): si la decidimos nosotros
     * o la dice la fuente del precio, con su motivo. Va bajo la tira, como aviso del instrumento.
     */
    nota?: Trozo[];
  };
  aptitudes: AptitudDeFicha[];
  /**
   * Un aviso del instrumento entero, no de una sección: va bajo la tira. El de las
   * acciones dice que sus métricas no se pueden ordenar junto a las de un fondo,
   * porque unas salen de rentabilidades diarias y otras de mensuales.
   */
  aviso?: Trozo[];
  secciones: SeccionDeFicha[];
}
