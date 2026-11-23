/**
 * El contrato de la importación de documentos.
 *
 * Un IMPORTADOR conoce los documentos de una entidad. Dice si reconoce un documento y, de
 * los que reconoce, saca MOVIMIENTOS PROPUESTOS y lo que el extracto DECLARA (posiciones y
 * saldo de efectivo). No toca la cartera: quien decide qué entra es el asesor, en la
 * revisión. Un importador es cálculo puro sobre texto: ni red, ni disco, ni React.
 *
 * AÑADIR UNA ENTIDAD: una carpeta nueva en `importacion/` con un `Importador`, y una línea
 * en `registro.ts`. Nada más cambia.
 */
import type { Dia } from "../motor/fechas";
import type { Dec } from "../motor/decimal";
import type { Movimiento, TipoDeActivo } from "../motor/modelo";

/** Un documento ya leído: su texto y sus tablas, como celdas de texto sin interpretar. */
export interface DocumentoLeido {
  nombre: string;
  /** El texto completo del fichero (HTML, o texto delimitado si era una hoja de cálculo o un CSV). */
  texto: string;
  /** Las tablas del documento, en orden: cada tabla, sus filas; cada fila, sus celdas. */
  tablas: string[][][];
}

/** Un activo tal como lo cita un documento, antes de saber cuál es en la cartera o en el catálogo. */
export interface ActivoCitado {
  /** Clave estable para agrupar todas las citas del mismo activo: el ISIN o, si no lo hay, el nombre normalizado. */
  clave: string;
  isin?: string;
  nombre: string;
  divisa?: string;
  tipo?: TipoDeActivo;
  /**
   * `true` si `tipo` no lo dice el documento: es la «acción» que se supone de una compra o una venta sin más. Si el activo
   * es nuevo, la revisión pregunta qué es antes de darlo de alta: en un bono el precio va en % del nominal (22-11-2026).
   */
  tipoSupuesto?: true;
}

export interface MovimientoPropuesto {
  /**
   * El movimiento tal como entraría en el libro. Su `id` es provisional. `activoId` y
   * `destino.activoId` llevan la `clave` del activo citado: la revisión las sustituye por
   * el identificador del activo de la cartera cuando el asesor lo confirma.
   */
  movimiento: Movimiento;
  activo?: ActivoCitado;
  destino?: ActivoCitado;
  /** Lo que el asesor debe saber de esta línea: «Los títulos pueden estar cortados», «Falta el importe en euros». */
  avisos: string[];
  /** Si la línea necesita que el asesor la mire antes de darla por buena. */
  requiereRevision: boolean;
  documento: string;
  /** Fila del documento, empezando en 1. */
  fila: number;
  /** El texto original de la fila, para comprobarlo contra el extracto. */
  textoOriginal: string;
}

/** Lo que un extracto declara que hay a una fecha. Sirve para conciliar el libro. */
export interface ExtractoPropuesto {
  fecha: Dia;
  documento: string;
  /**
   * `fecha`: la de la cotización con que se valoró la posición, si el documento la dice (GES-10). `precio` y `divisa`: el
   * precio de mercado en la divisa del activo, si el documento lo dice (A-205); van los dos o ninguno. `precio` es por
   * título, como lo da Andbank (títulos × precio = valor de mercado en esa divisa). `cotizacion`, en lugar de `precio`, es
   * el precio tal como cotiza el activo —en un bono, en % del nominal—, como lo escribe la plantilla (A-210): al aplicar la
   * importación se lleva a precio por título con el multiplicador del activo, que el importador no conoce.
   */
  posiciones: Array<{ activo: ActivoCitado; titulos: Dec; valor?: Dec; fecha?: Dia; precio?: Dec; cotizacion?: Dec; divisa?: string }>;
  efectivo: Array<{ divisa: string; saldo: Dec }>;
}

export interface DocumentoImportado {
  nombre: string;
  tipo: string;
  etiqueta: string;
  /** Filas útiles leídas del documento. */
  filas: number;
}

export interface ResultadoDeImportacion {
  importadorId: string;
  entidad: string;
  documentos: DocumentoImportado[];
  movimientos: MovimientoPropuesto[];
  extractos: ExtractoPropuesto[];
  /** Avisos generales, en lenguaje llano: operaciones que no se han importado y por qué. */
  avisos: string[];
  /** Errores que impiden importar, en lenguaje llano y diciendo qué hacer. Si hay alguno, `movimientos` va vacío. */
  errores: string[];
}

export interface TipoDeDocumento {
  tipo: string;
  /** «Movimientos de la cuenta de efectivo». */
  etiqueta: string;
  /** Una frase: qué es y de dónde se descarga. */
  descripcion: string;
}

export interface Importador {
  id: string;
  /** «Andbank». */
  entidad: string;
  documentos: TipoDeDocumento[];
  /**
   * Si este importador reconoce el documento y qué tipo es. `confianza` va de 0 a 1: gana
   * el importador que más confía. `undefined`: no es suyo.
   */
  reconocer(documento: DocumentoLeido): { tipo: string; confianza: number } | undefined;
  /** Importa juntos todos los documentos de esta entidad que el usuario ha soltado. No lanza: los problemas van en `errores`. */
  importar(documentos: Array<{ documento: DocumentoLeido; tipo: string }>, opciones: { divisaBase: string }): ResultadoDeImportacion;
}

/** El resultado de intentar reconocer un documento, para decírselo al usuario. */
export interface Reconocimiento {
  documento: DocumentoLeido;
  /** `undefined` si ningún importador lo reconoce. */
  importador?: Importador;
  tipo?: string;
  etiqueta?: string;
  /** Si no se reconoce: qué se intentó, en lenguaje llano. */
  intentos: string[];
}
