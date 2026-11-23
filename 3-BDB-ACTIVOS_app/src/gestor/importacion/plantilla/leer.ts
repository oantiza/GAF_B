/**
 * La lectura de la plantilla genérica: de las tablas de un documento a movimientos
 * propuestos y extractos.
 *
 * Nada se inventa: una cifra que no se entiende se deja en blanco con un aviso, un tipo que
 * no se reconoce entra como «Otro cargo o abono» para que el asesor lo reclasifique, y toda
 * fila que el motor no daría por buena sale marcada para revisión con los errores del motor.
 */
import { aTexto, cifraEnTexto, leerCifraCon, pistaDelSeparador, type Decimal, type SeparadorDecimal } from "../../motor/decimal";
import type { CampoDeMovimiento, ContextoDeMovimiento, DefinicionDeMovimiento } from "../../motor/efectos";
import { esDia, type Dia } from "../../motor/fechas";
import type { Activo, DestinoDelMovimiento, Movimiento, TipoDeActivo } from "../../motor/modelo";
import { TIPOS, definicionDe } from "../../motor/movimientos/registro";
import { divisaComoLlega, leerDivisa } from "../andbank/comun";
import type { ActivoCitado, DocumentoLeido, ExtractoPropuesto, MovimientoPropuesto } from "../tipos";
import {
  COLUMNAS_DE_MOVIMIENTOS,
  COLUMNAS_DE_POSICIONES,
  columnaDeMovimientos,
  columnaDePosiciones,
  definicionDeColumna,
  normalizarRotulo,
  reconocerTipo,
  tipoDeActivoDelRotulo,
  type ClaveDeColumna,
  type ClaveDeColumnaDePosiciones,
  type ColumnaDeLaPlantilla
} from "./columnas";

/** En cuántas filas del principio de cada tabla se busca la cabecera: puede haber un título encima. */
export const FILAS_PARA_BUSCAR_LA_CABECERA = 15;

/** Los rótulos de tipo que solo dicen «transferencia», ya normalizados: aportación o retirada según el signo del importe. */
const TRANSFERENCIA = new Set(["transferencia", "transfer", "transferenciabancaria"]);

const FORMA_ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** Una fila de cabecera reconocida: en qué fila está y en qué celda va cada columna. */
export interface Cabecera<Clave extends string> {
  /** Índice de la fila de cabecera dentro de su tabla, desde 0. */
  indice: number;
  columnas: Map<Clave, number>;
}

function reconocerFila<Clave extends string>(fila: readonly string[], reconocer: (texto: string) => Clave | undefined): Map<Clave, number> {
  const columnas = new Map<Clave, number>();
  fila.forEach((celda, posicion) => {
    const clave = reconocer(celda ?? "");
    /* Si una columna se repite, manda la primera. */
    if (clave !== undefined && !columnas.has(clave)) columnas.set(clave, posicion);
  });
  return columnas;
}

function esCabeceraDeMovimientos(columnas: Map<ClaveDeColumna, number>): boolean {
  return columnas.has("fecha") && columnas.has("tipo") && (columnas.has("importe") || columnas.has("titulos"));
}

function esCabeceraDePosiciones(columnas: Map<ClaveDeColumnaDePosiciones, number>): boolean {
  return columnas.has("fecha") && columnas.has("titulos") && (columnas.has("isin") || columnas.has("nombre"));
}

export interface TablaReconocida<Clave extends string> {
  tabla: string[][];
  /** Posición de la tabla dentro del documento, desde 0. */
  numero: number;
  cabecera: Cabecera<Clave>;
}

export interface TablasDeLaPlantilla {
  movimientos: TablaReconocida<ClaveDeColumna>[];
  posiciones: TablaReconocida<ClaveDeColumnaDePosiciones>[];
  /** La fila que más se parece a una cabecera de movimientos sin llegar a serlo: para explicar qué falta. */
  candidata?: { numero: number; cabecera: Cabecera<ClaveDeColumna> };
}

/** Busca en cada tabla la cabecera de movimientos o, si no la tiene, la de posiciones. */
export function buscarTablas(documento: DocumentoLeido): TablasDeLaPlantilla {
  const resultado: TablasDeLaPlantilla = { movimientos: [], posiciones: [] };
  documento.tablas.forEach((tabla, numero) => {
    const limite = Math.min(tabla.length, FILAS_PARA_BUSCAR_LA_CABECERA);
    for (let indice = 0; indice < limite; indice += 1) {
      const fila = tabla[indice] ?? [];
      const columnas = reconocerFila(fila, columnaDeMovimientos);
      if (esCabeceraDeMovimientos(columnas)) {
        resultado.movimientos.push({ tabla, numero, cabecera: { indice, columnas } });
        return;
      }
      if (columnas.size >= 2 && (!resultado.candidata || columnas.size > resultado.candidata.cabecera.columnas.size)) {
        resultado.candidata = { numero, cabecera: { indice, columnas } };
      }
      if (!columnas.has("tipo")) {
        const dePosiciones = reconocerFila(fila, columnaDePosiciones);
        if (esCabeceraDePosiciones(dePosiciones)) {
          resultado.posiciones.push({ tabla, numero, cabecera: { indice, columnas: dePosiciones } });
          return;
        }
      }
    }
  });
  return resultado;
}

/** Por qué un documento no tiene la cabecera de la plantilla, en lenguaje llano. */
export function explicarCabeceraQueFalta(documento: DocumentoLeido, tablas: TablasDeLaPlantilla): string {
  const pedidas = "«Fecha», «Tipo» e «Importe» o «Títulos»";
  const candidata = tablas.candidata;
  if (!candidata) {
    return `«${documento.nombre}»: no encuentro la fila de cabecera de la plantilla en las primeras ${FILAS_PARA_BUSCAR_LA_CABECERA} filas. Hacen falta, al menos, las columnas ${pedidas}. Descarga la plantilla para ver los nombres de columna que se admiten.`;
  }
  const columnas = candidata.cabecera.columnas;
  const faltan: string[] = [];
  if (!columnas.has("fecha")) faltan.push("«Fecha»");
  if (!columnas.has("tipo")) faltan.push("«Tipo»");
  if (!columnas.has("importe") && !columnas.has("titulos")) faltan.push("«Importe» o «Títulos»");
  const encontradas = COLUMNAS_DE_MOVIMIENTOS.filter((columna) => columnas.has(columna.clave)).map((columna) => columna.nombre);
  const enTabla = documento.tablas.length > 1 ? ` de la tabla ${candidata.numero + 1}` : "";
  return `«${documento.nombre}»: a la cabecera de la fila ${candidata.cabecera.indice + 1}${enTabla} le falta ${faltan.length > 1 ? "las columnas" : "la columna"} ${faltan.join(" y ")}. Columnas reconocidas: ${encontradas.join(", ")}. Añade la que falta con uno de los nombres de la plantilla.`;
}

/* ---------------------------------------------------------------------------------------
 * Lectura de celdas
 * ------------------------------------------------------------------------------------- */

/** Día desde el que cuenta Excel su número de serie (sistema de 1900, ya corregido su 29 de febrero de 1900). */
const ORIGEN_DE_EXCEL_MS = Date.UTC(1899, 11, 30);

/** En qué orden trae un fichero el día y el mes de una fecha escrita con barras, guiones o puntos. */
export type OrdenDeLaFecha = "dia-mes" | "mes-dia";

const FECHA_CON_SEPARADORES = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/;

/**
 * El orden de día y mes de las fechas de un fichero, por lo que ellas mismas dicen (GES-12, auditoría del 16-11-2026).
 *
 * Una fecha con un número mayor que 12 solo se puede leer de una manera: «25/04/2026» es día/mes y «04/25/2026», mes/día.
 * Si el fichero trae alguna que solo puede ser mes/día y ninguna que solo pueda ser día/mes, viene en mes/día, y entonces
 * también lo están las ambiguas: «03/04/2026» es el 4 de marzo. Antes se leían todas como día/mes: las de día mayor que 12
 * se rechazaban y las demás entraban con el día y el mes cambiados, sin aviso.
 *
 * Sin ninguna fecha que decida, día/mes, que es como se escribe aquí. Con fechas de las dos clases el fichero se contradice:
 * `contradictorio`, y se lee como día/mes, que deja sin fecha las que no encajan en vez de adivinar.
 */
export function ordenDeLasFechas(textos: readonly string[]): { orden: OrdenDeLaFecha; soloMesDia: number; soloDiaMes: number; contradictorio: boolean } {
  let soloMesDia = 0;
  let soloDiaMes = 0;
  for (const crudo of textos) {
    const partes = FECHA_CON_SEPARADORES.exec(crudo.trim());
    if (!partes) continue;
    const [primero, segundo] = [Number(partes[1]), Number(partes[2])];
    if (primero > 12 && segundo >= 1 && segundo <= 12) soloDiaMes += 1;
    else if (segundo > 12 && primero >= 1 && primero <= 12) soloMesDia += 1;
  }
  const contradictorio = soloMesDia > 0 && soloDiaMes > 0;
  return { orden: soloMesDia > 0 && soloDiaMes === 0 ? "mes-dia" : "dia-mes", soloMesDia, soloDiaMes, contradictorio };
}

/**
 * Lee una fecha: dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa, aaaa-mm-dd (con hora detrás o sin ella) o número de serie de Excel.
 * Con `orden` «mes-dia», las de barras, guiones o puntos se leen mm/dd/aaaa (`ordenDeLasFechas` dice cuándo).
 */
export function leerFecha(crudo: string, orden: OrdenDeLaFecha = "dia-mes"): Dia | undefined {
  const texto = crudo.trim();
  if (texto === "") return undefined;
  let anio: number;
  let mes: number;
  let dia: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(texto);
  const europea = FECHA_CON_SEPARADORES.exec(texto);
  if (iso) {
    [anio, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (europea) {
    [dia, mes, anio] = orden === "mes-dia" ? [Number(europea[2]), Number(europea[1]), Number(europea[3])] : [Number(europea[1]), Number(europea[2]), Number(europea[3])];
  } else if (/^\d{2,6}([.,]\d+)?$/.test(texto)) {
    /* Número de serie de Excel. Desde el 61 (1 de marzo de 1900): antes, Excel cuenta un 29 de febrero que no existió. */
    const serie = Math.floor(Number(texto.replace(",", ".")));
    if (serie < 61 || serie > 2_958_465) return undefined;
    return new Date(ORIGEN_DE_EXCEL_MS + serie * 86_400_000).toISOString().slice(0, 10);
  } else {
    return undefined;
  }
  const resultado = `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  return esDia(resultado) ? resultado : undefined;
}

/** Las columnas de cifras de la hoja de movimientos y de la de posiciones: en ellas se mira el separador decimal (H1-07). */
const CIFRAS_DE_MOVIMIENTOS: readonly ClaveDeColumna[] = ["titulos", "precio", "importe", "comision", "gastos", "retencion", "cuponCorrido", "cambio", "valor", "proporcion", "titulosDestino", "precioDestino", "importeDestino"];
const CIFRAS_DE_POSICIONES: readonly ClaveDeColumnaDePosiciones[] = ["titulos", "valor", "precio"];

/** El separador decimal de un documento, y lo que lo decide. */
export interface SeparadorDelDocumento {
  separador: SeparadorDecimal;
  /** Cuántas cifras solo se pueden leer con la coma decimal, y cuántas solo con el punto. */
  deComa: number;
  dePunto: number;
  /** Ninguna cifra lo decide y alguna admite las dos lecturas: se leen con la coma, como siempre, y piden revisión. */
  sinIndicios: boolean;
  /** Hay cifras de las dos clases: se lee con la coma, como siempre, y se avisa. */
  contradictorio: boolean;
}

/**
 * El separador decimal de las cifras de un documento de la plantilla, por lo que ellas mismas dicen (H1-07, decisión 4 de
 * la auditoría consolidada del 22-11-2026, aprobada por Óscar el 23-11-2026). Como el orden de las fechas (GES-12), se
 * decide una vez por documento y no cifra a cifra.
 *
 * `leerCifra` lee «1.085» como mil ochenta y cinco, que es la convención española declarada (FMT-20, GES-22). Pero las
 * instrucciones de la plantilla admiten «1234.56», y en un CSV escrito en inglés un precio de «1.085» entraba como 1.085
 * y un dividendo de «5.425» USD como 5.425, en «Listo». Ahora:
 * - si alguna cifra solo se lee con la coma decimal («12,5», «1.234,56»), el documento va en español: lo de siempre;
 * - si alguna solo se lee con el punto decimal («12.5», «1234.56») y ninguna con la coma, va en inglés: «1.085» es 1,085;
 * - si ninguna lo decide (solo «1.085» o enteros), se lee como siempre, y la línea con una cifra ambigua pide revisión.
 * Con cifras de las dos clases, el documento se contradice: se lee con la coma, como siempre (`contradictorio`).
 *
 * Un Excel con celdas numéricas no cambia: `xlsxCellToText` las escribe con coma decimal («1,0850»), así que nunca
 * parecen inglesas. Lo que se mira es el texto de las celdas, del CSV o del Excel.
 */
export function separadorDeLasCifras(textos: readonly string[]): SeparadorDelDocumento {
  let deComa = 0;
  let dePunto = 0;
  let ambiguas = 0;
  for (const texto of textos) {
    const pista = pistaDelSeparador(texto);
    if (pista === "coma") deComa += 1;
    else if (pista === "punto") dePunto += 1;
    else if (pista === "ambigua") ambiguas += 1;
  }
  return {
    separador: deComa === 0 && dePunto > 0 ? "punto" : "coma",
    deComa,
    dePunto,
    sinIndicios: deComa === 0 && dePunto === 0 && ambiguas > 0,
    contradictorio: deComa > 0 && dePunto > 0
  };
}

/** Sin tildes, en mayúsculas y con los espacios reducidos a uno: la clave de un activo citado por su nombre. */
export function normalizarNombre(nombre: string): string {
  return nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

function esFilaVacia(fila: readonly string[]): boolean {
  return fila.every((celda) => (celda ?? "").trim() === "");
}

/** Una fila de comentario («# …») o de totales («Total», «Totales», «Suma»). */
function esFilaDeComentarioOTotal(fila: readonly string[]): boolean {
  const primera = fila.map((celda) => (celda ?? "").trim()).find((celda) => celda !== "") ?? "";
  if (primera.startsWith("#")) return true;
  const rotulo = normalizarRotulo(primera);
  return rotulo.startsWith("total") || rotulo === "suma" || rotulo === "sumas";
}

function textoOriginal(fila: readonly string[]): string {
  return fila.map((celda) => (celda ?? "").trim()).join("; ");
}

/** El tipo de activo que deduce una fila, y si lo dice ella o solo se supone. */
interface TipoDeducido {
  tipo: TipoDeActivo;
  /** `false` solo en la «acción» que se supone de una compra o una venta sin más. */
  firme: boolean;
}

/**
 * El tipo de activo que se deduce del tipo de movimiento: un fondo se suscribe, un bono paga cupón.
 * Una compra o una venta con cupón corrido es de un bono, y una rotulada «Compra de bonos», «Venta de
 * acciones» o «Compra de ETF» es de lo que dice su rótulo. Una compra o una venta sin más dice
 * «acción» solo a falta de algo mejor: es la única deducción débil, y la corrige cualquier otra
 * fila del documento que diga el tipo (P2-05, auditoría del 20-11-2026: un bono comprado
 * antes de su primer cupón quedaba como acción, y su precio en % se valoraba por título). Si nada
 * la corrige, la revisión pide al asesor que diga qué es (22-11-2026).
 */
function tipoDeActivoDelMovimiento(tipo: string, rotulo: string, conCuponCorrido: boolean): TipoDeducido | undefined {
  if (tipo === "suscripcion" || tipo === "reembolso" || tipo === "traspaso") return { tipo: "FONDO", firme: true };
  if (tipo === "cupon" || tipo === "amortizacion") return { tipo: "BONO", firme: true };
  if (tipo === "compra" || tipo === "venta") {
    if (conCuponCorrido) return { tipo: "BONO", firme: true };
    const delRotulo = tipoDeActivoDelRotulo(rotulo);
    return delRotulo ? { tipo: delRotulo, firme: true } : { tipo: "ACCION", firme: false };
  }
  /*
   * Una entrada o una salida de títulos («Posición inicial», «Traspaso de entrada»…) no dice qué activo es. Antes no
   * deducía nada y un activo nuevo sin catálogo se daba de alta como «Otro», sin multiplicador: 10.000 de nominal de un
   * bono al 98,5 entraban por 985.000 € en vez de 9.850 €, en «Listo» y sin aviso (H1-08, auditoría del 22-11-2026). Es la
   * forma documentada de empezar una cartera, y el arreglo de las compras no la cubría. Ahora supone «Otro» débil, como
   * la compra a secas supone «acción»: lo corrige cualquier fila del documento que diga el tipo, y si nada lo dice, la
   * revisión pregunta qué es.
   */
  if (tipo === "entradaDeTitulos" || tipo === "salidaDeTitulos") return { tipo: "OTRO", firme: false };
  return undefined;
}

/** Si un tipo deducido sustituye al reunido hasta ahora: el primero que llegue, o uno firme sobre la «acción» débil. */
function mejoraElTipo(reunido: TipoDeducido | undefined, nuevo: TipoDeducido | undefined): boolean {
  return nuevo !== undefined && (reunido === undefined || (!reunido.firme && nuevo.firme));
}

/** Lo que se sabe de un activo citado juntando todas las filas del documento que lo citan. */
interface ActivoReunido {
  clave: string;
  isin?: string;
  nombre: string;
  divisa?: string;
  tipo?: TipoDeducido;
}

/** Lo que una fila deja leído antes de validarla con el motor. */
interface Borrador {
  movimiento: Movimiento;
  definicion?: DefinicionDeMovimiento;
  activo?: { clave: string; tipo?: TipoDeducido };
  destino?: { clave: string; tipo?: TipoDeducido };
  avisos: string[];
  requiereRevision: boolean;
  documento: string;
  fila: number;
  textoOriginal: string;
  /** Orden de lectura, para desempatar al ordenar por fecha. */
  orden: number;
}

/** El estado compartido mientras se leen todos los documentos de una importación. */
export class LecturaDePlantilla {
  readonly divisaBase: string;
  private readonly borradores: Borrador[] = [];
  private readonly activos = new Map<string, ActivoReunido>();
  readonly extractos: ExtractoPropuesto[] = [];
  readonly avisos: string[] = [];
  /** El orden de día y mes de la tabla que se está leyendo (GES-12). */
  private ordenDeLaFecha: OrdenDeLaFecha = "dia-mes";
  /** El separador decimal del documento que se está leyendo, y si ninguna cifra lo decide (H1-07). */
  private separador: SeparadorDecimal = "coma";
  private separadorSinIndicios = false;

  constructor(divisaBase: string) {
    this.divisaBase = divisaBase;
  }

  /**
   * Decide el orden de día y mes de una tabla con todas sus columnas de fecha, y lo dice si no es el de siempre (GES-12).
   * Las filas de comentario o de total no cuentan: no son datos.
   */
  private fijarElOrdenDeLasFechas<Clave extends string>(documento: DocumentoLeido, tabla: TablaReconocida<Clave>, clavesDeFecha: readonly Clave[]): void {
    const posiciones = clavesDeFecha.map((clave) => tabla.cabecera.columnas.get(clave)).filter((posicion): posicion is number => posicion !== undefined);
    const textos: string[] = [];
    for (let i = tabla.cabecera.indice + 1; i < tabla.tabla.length; i += 1) {
      const fila = tabla.tabla[i] ?? [];
      if (esFilaVacia(fila) || esFilaDeComentarioOTotal(fila)) continue;
      for (const posicion of posiciones) textos.push(fila[posicion] ?? "");
    }
    const { orden, soloMesDia, contradictorio } = ordenDeLasFechas(textos);
    this.ordenDeLaFecha = orden;
    if (orden === "mes-dia") {
      this.avisos.push(
        `«${documento.nombre}»: las fechas vienen como mes/día/año (${soloMesDia === 1 ? "hay una que solo se puede leer así" : `hay ${soloMesDia} que solo se pueden leer así`}) y se han leído todas en ese orden. Compruébalo: «03/04/2026» se ha tomado como el 4 de marzo.`
      );
    } else if (contradictorio) {
      this.avisos.push(
        `«${documento.nombre}»: hay fechas que solo pueden ser día/mes y otras que solo pueden ser mes/día. Se han leído como día/mes, y las que no encajan se han quedado sin fecha: revisa el fichero.`
      );
    }
  }

  /**
   * Decide el separador decimal de un documento con las cifras de todas sus tablas, y lo dice si no es el de siempre (H1-07).
   * Se llama una vez por documento, antes de leer sus tablas.
   */
  fijarElSeparadorDecimal(documento: DocumentoLeido, tablas: TablasDeLaPlantilla): void {
    const textos: string[] = [];
    const recoger = <Clave extends string>(tabla: TablaReconocida<Clave>, claves: readonly Clave[]): void => {
      const posiciones = claves.map((clave) => tabla.cabecera.columnas.get(clave)).filter((posicion): posicion is number => posicion !== undefined);
      for (let i = tabla.cabecera.indice + 1; i < tabla.tabla.length; i += 1) {
        const fila = tabla.tabla[i] ?? [];
        if (esFilaVacia(fila) || esFilaDeComentarioOTotal(fila)) continue;
        for (const posicion of posiciones) textos.push((fila[posicion] ?? "").trim());
      }
    };
    for (const tabla of tablas.movimientos) recoger(tabla, CIFRAS_DE_MOVIMIENTOS);
    for (const tabla of tablas.posiciones) recoger(tabla, CIFRAS_DE_POSICIONES);
    const { separador, dePunto, deComa, sinIndicios, contradictorio } = separadorDeLasCifras(textos);
    this.separador = separador;
    this.separadorSinIndicios = sinIndicios;
    if (separador === "punto") {
      this.avisos.push(
        `«${documento.nombre}»: las cifras vienen con punto decimal (${dePunto === 1 ? "hay una que solo se puede leer así" : `hay ${dePunto} que solo se pueden leer así`}) y se han leído todas así. Compruébalo: «1.085» se ha tomado como 1,085, y «1,085», como 1.085.`
      );
    } else if (contradictorio) {
      this.avisos.push(
        `«${documento.nombre}»: hay cifras que solo pueden llevar coma decimal (${deComa}) y otras que solo pueden llevar punto decimal (${dePunto}). Se han leído con la coma decimal, como se escribe en español, y «1.085» se ha tomado como 1.085,00: revisa el fichero.`
      );
    }
  }

  /** Una cifra del documento, con su separador decimal. */
  private leerCifra(crudo: string): Decimal | undefined {
    return leerCifraCon(crudo, this.separador);
  }

  /**
   * Si una cifra admite las dos lecturas y nada en el documento decide cuál (H1-07): cómo se ha leído y cuál sería la otra,
   * para el aviso de su línea. Si el documento lo decide, o la cifra no es ambigua, nada.
   */
  private lecturaAmbigua(columna: string, crudo: string, leida: Decimal): string | undefined {
    if (!this.separadorSinIndicios || pistaDelSeparador(crudo) !== "ambigua") return undefined;
    const otra = leerCifraCon(crudo, "punto");
    const escrita = (valor: Decimal): string => {
      const texto = cifraEnTexto(valor);
      return texto.includes(",") ? texto : `${texto},00`;
    };
    const conQue = crudo.includes(".") ? "con el punto de millares" : "con la coma decimal";
    return `Leído como ${escrita(leida)}: la columna «${columna}» dice «${crudo}», y el fichero no deja ver si usa la coma o el punto decimal. Se ha tomado ${conQue}, como se escribe en español; si es ${otra ? escrita(otra) : "otra cifra"}, corrígelo.`;
  }

  /** Lee una tabla de movimientos. Devuelve cuántas filas útiles tenía. */
  leerMovimientos(documento: DocumentoLeido, tabla: TablaReconocida<ClaveDeColumna>): number {
    const { columnas, indice } = tabla.cabecera;
    this.fijarElOrdenDeLasFechas(documento, tabla, ["fecha", "fechaValor", "fechaDestino"]);
    const descartadas: number[] = [];
    let utiles = 0;
    for (let i = indice + 1; i < tabla.tabla.length; i += 1) {
      const fila = tabla.tabla[i] ?? [];
      if (esFilaVacia(fila) || esFilaDeComentarioOTotal(fila)) continue;
      const celda = (clave: ClaveDeColumna): string => {
        const posicion = columnas.get(clave);
        return posicion === undefined ? "" : (fila[posicion] ?? "").trim();
      };
      const borrador = this.leerFila(celda, documento.nombre, i + 1, textoOriginal(fila));
      if (!borrador) {
        descartadas.push(i + 1);
        continue;
      }
      utiles += 1;
      this.borradores.push(borrador);
    }
    if (descartadas.length > 0) {
      this.avisos.push(
        `«${documento.nombre}»: ${descartadas.length === 1 ? "se ha descartado la fila" : `se han descartado ${descartadas.length} filas`} ${descartadas.join(", ")}, sin fecha ni importe.`
      );
    }
    return utiles;
  }

  private leerFila(celda: (clave: ClaveDeColumna) => string, documento: string, numeroDeFila: number, texto: string): Borrador | undefined {
    const avisos: string[] = [];
    let requiereRevision = false;

    /* Una cifra: si la celda tiene texto que no es una cifra, aviso y en blanco. */
    const cifra = (clave: ClaveDeColumna): Decimal | undefined => {
      const crudo = celda(clave);
      if (crudo === "") return undefined;
      const valor = this.leerCifra(crudo);
      if (valor === undefined) {
        avisos.push(`La columna «${definicionDeColumna(clave).nombre}» dice «${crudo}», que no es una cifra: se ha dejado en blanco.`);
        requiereRevision = true;
        return undefined;
      }
      /* H1-07: «1.085» en un fichero que no dice su separador decimal se lee como siempre, pero la línea pide revisión. */
      const ambigua = this.lecturaAmbigua(definicionDeColumna(clave).nombre, crudo, valor);
      if (ambigua) {
        avisos.push(ambigua);
        requiereRevision = true;
      }
      return valor;
    };
    /* «GBp» son peniques y se queda así: en mayúsculas sería la libra, y el precio, cien veces mayor. «GBX» también son peniques. */
    const divisa = (clave: ClaveDeColumna): string | undefined => {
      if (celda(clave) === "") return undefined;
      const leida = leerDivisa(celda(clave));
      if (!leida) {
        avisos.push(`La columna «${definicionDeColumna(clave).nombre}» dice «${celda(clave)}», que no es un código de divisa de tres letras: se ha dejado en blanco.`);
        requiereRevision = true;
        return undefined;
      }
      return leida;
    };

    const textoDeFecha = celda("fecha");
    const fecha = leerFecha(textoDeFecha, this.ordenDeLaFecha);
    /* Sin fecha y sin importe legibles no hay movimiento que proponer: la fila se descarta. */
    if (!fecha && this.leerCifra(celda("importe")) === undefined) return undefined;

    /* El tipo. */
    const textoDeTipo = celda("tipo");
    let definicion = textoDeTipo === "" ? undefined : reconocerTipo(textoDeTipo);
    /* «Transferencia» a secas no dice si entra o sale: lo dice el signo de su importe (auditoría 16-11-2026, GES-3). Antes caía en
       «Otro cargo o abono», que cuenta como resultado: una transferencia del cliente de 1.000 € era una ganancia de 1.000 €. */
    if (!definicion && TRANSFERENCIA.has(normalizarRotulo(textoDeTipo))) {
      const importeDeLaFila = this.leerCifra(celda("importe"));
      if (importeDeLaFila !== undefined && !importeDeLaFila.eq(0)) {
        definicion = definicionDe(importeDeLaFila.gt(0) ? "aportacion" : "retirada")!;
        avisos.push(`«${textoDeTipo}» con importe ${importeDeLaFila.gt(0) ? "positivo" : "negativo"}: se lee como ${definicion.nombre.toLowerCase()}. Si no es dinero que entra o sale de la cartera, cámbiale el tipo.`);
      }
    }
    const reconocido = definicion !== undefined;
    if (!definicion) {
      definicion = definicionDe("otroEfectivo")!;
      const admitidos = TIPOS.map((tipo) => tipo.nombre).join(", ");
      avisos.push(
        textoDeTipo === ""
          ? `Falta el tipo de movimiento. Se ha importado como «${definicion.nombre}» para que lo reclasifiques. Tipos admitidos: ${admitidos}.`
          : `No reconozco el tipo «${textoDeTipo}». Se ha importado como «${definicion.nombre}» para que lo reclasifiques. Tipos admitidos: ${admitidos}.`
      );
      requiereRevision = true;
    }

    if (!fecha) {
      avisos.push(
        textoDeFecha === ""
          ? "Falta la fecha de operación."
          : `No entiendo la fecha «${textoDeFecha}». Formatos admitidos: dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd o el número de fecha de Excel.`
      );
      requiereRevision = true;
    }

    /* Las columnas que este tipo no usa se ignoran (salvo si el tipo es desconocido: el asesor lo reclasificará). */
    const usa = (campo: CampoDeMovimiento | undefined): boolean =>
      !reconocido || campo === undefined || definicion.campos.some((candidato) => candidato.campo === campo);
    const ignoradas = COLUMNAS_DE_MOVIMIENTOS.filter((columna) => celda(columna.clave) !== "" && !usa(columna.campo)).map((columna) => columna.nombre);
    if (ignoradas.length > 0) {
      avisos.push(`El tipo «${definicion.nombre}» no usa ${ignoradas.length === 1 ? "la columna" : "las columnas"} ${ignoradas.map((nombre) => `«${nombre}»`).join(", ")}: se ${ignoradas.length === 1 ? "ha" : "han"} ignorado.`);
    }
    const leer = <T>(columna: ColumnaDeLaPlantilla<ClaveDeColumna>, lector: (clave: ClaveDeColumna) => T | undefined): T | undefined =>
      usa(columna.campo) ? lector(columna.clave) : undefined;
    const numero = (clave: ClaveDeColumna): Decimal | undefined => leer(definicionDeColumna(clave), cifra);
    const positivo = (clave: ClaveDeColumna): string | undefined => {
      const valor = numero(clave);
      return valor === undefined ? undefined : aTexto(valor.abs());
    };
    const conSigno = (clave: ClaveDeColumna): string | undefined => {
      const valor = numero(clave);
      return valor === undefined ? undefined : aTexto(valor);
    };

    const movimiento: Movimiento = { id: "", tipo: definicion.tipo, fechaOperacion: fecha ?? "" };

    const fechaValor = leer(definicionDeColumna("fechaValor"), (clave) => {
      const crudo = celda(clave);
      if (crudo === "") return undefined;
      const leida = leerFecha(crudo, this.ordenDeLaFecha);
      if (!leida) {
        avisos.push(`No entiendo la fecha valor «${crudo}»: se ha dejado en blanco.`);
        requiereRevision = true;
      }
      return leida;
    });
    if (fechaValor) movimiento.fechaValor = fechaValor;

    /* El activo. */
    /* Sin aviso: si la cifra no se lee, lo dice abajo la lectura de las cifras. */
    const corrido = usa(definicionDeColumna("cuponCorrido").campo) ? this.leerCifra(celda("cuponCorrido")) : undefined;
    const tipoDeActivo = reconocido ? tipoDeActivoDelMovimiento(definicion.tipo, textoDeTipo, corrido !== undefined && !corrido.eq(0)) : undefined;
    let activo: Borrador["activo"];
    if (usa("activo")) {
      const citado = this.citar(celda("isin"), celda("nombre"), divisa("divisaActivo"), tipoDeActivo, avisos);
      if (citado.revision) requiereRevision = true;
      if (citado.clave) {
        activo = { clave: citado.clave, tipo: tipoDeActivo };
        movimiento.activoId = citado.clave;
      }
    }

    /* Las cifras. */
    const titulos = positivo("titulos");
    if (titulos !== undefined) movimiento.titulos = titulos;
    const precio = conSigno("precio");
    if (precio !== undefined) movimiento.precio = precio;
    const importeLeido = numero("importe");
    if (importeLeido !== undefined) {
      const signo = definicion.signoDelEfectivo;
      if (signo === -1) movimiento.importe = aTexto(importeLeido.abs().times(-1));
      else if (signo === 1) movimiento.importe = aTexto(importeLeido.abs());
      else if (signo === "libre") movimiento.importe = aTexto(importeLeido);
    }
    const divisaDelEfectivo = leer(definicionDeColumna("divisa"), divisa);
    if (divisaDelEfectivo) movimiento.divisa = divisaDelEfectivo;
    for (const clave of ["comision", "gastos", "retencion", "cuponCorrido"] as const) {
      const valor = positivo(clave);
      if (valor !== undefined) movimiento[clave] = valor;
    }
    const cambio = conSigno("cambio");
    if (cambio !== undefined) movimiento.cambio = cambio;
    const valor = conSigno("valor");
    if (valor !== undefined) movimiento.valor = valor;
    const razon = conSigno("proporcion");
    if (razon !== undefined) movimiento.razon = razon;
    const nota = celda("nota");
    if (nota !== "") movimiento.nota = nota;

    /* El destino. */
    const destino: DestinoDelMovimiento = {};
    let destinoCitado: Borrador["destino"];
    if (usa("destinoActivo")) {
      const tipoDelDestino: TipoDeducido | undefined = definicion.tipo === "traspaso" ? { tipo: "FONDO", firme: true } : undefined;
      const citado = this.citar(celda("isinDestino"), celda("nombreDestino"), undefined, tipoDelDestino, avisos);
      if (citado.revision) requiereRevision = true;
      if (citado.clave) {
        destinoCitado = { clave: citado.clave, tipo: tipoDelDestino };
        destino.activoId = citado.clave;
      }
      const crudo = celda("fechaDestino");
      if (crudo !== "") {
        const llegada = leerFecha(crudo, this.ordenDeLaFecha);
        if (llegada) destino.fecha = llegada;
        else {
          avisos.push(`No entiendo la fecha de destino «${crudo}»: se ha dejado en blanco.`);
          requiereRevision = true;
        }
      }
    }
    const titulosDestino = positivo("titulosDestino");
    if (titulosDestino !== undefined) destino.titulos = titulosDestino;
    const precioDestino = conSigno("precioDestino");
    if (precioDestino !== undefined) destino.precio = precioDestino;
    const divisaDestino = leer(definicionDeColumna("divisaDestino"), divisa);
    if (divisaDestino) destino.divisa = divisaDestino;
    const importeDestino = positivo("importeDestino");
    if (importeDestino !== undefined) destino.importe = importeDestino;
    if (Object.keys(destino).length > 0) movimiento.destino = destino;

    movimiento.origen = { via: "importado", documento, fila: numeroDeFila, textoOriginal: texto };
    return {
      movimiento,
      definicion: reconocido ? definicion : undefined,
      activo,
      destino: destinoCitado,
      avisos,
      requiereRevision,
      documento,
      fila: numeroDeFila,
      textoOriginal: texto,
      orden: this.borradores.length
    };
  }

  /** Cita un activo por ISIN o por nombre y lo reúne con las demás citas del mismo activo. */
  private citar(textoDeIsin: string, nombre: string, divisa: string | undefined, tipo: TipoDeducido | undefined, avisos: string[]): { clave?: string; revision: boolean } {
    const isin = textoDeIsin.toUpperCase().replace(/\s+/g, "");
    let revision = false;
    let clave: string | undefined;
    let isinValido: string | undefined;
    if (isin !== "" && FORMA_ISIN.test(isin)) {
      clave = isin;
      isinValido = isin;
    } else {
      if (isin !== "") {
        avisos.push(`«${textoDeIsin}» no tiene la forma de un ISIN (dos letras, nueve letras o cifras y una cifra de control): el activo se cita por su nombre.`);
        revision = true;
      }
      const porNombre = normalizarNombre(nombre !== "" ? nombre : textoDeIsin);
      if (porNombre !== "") clave = porNombre;
    }
    if (clave === undefined) return { revision };
    const reunido = this.activos.get(clave) ?? { clave, nombre: "" };
    if (isinValido) reunido.isin = isinValido;
    if (reunido.nombre === "" && nombre !== "") reunido.nombre = nombre.replace(/\s+/g, " ").trim();
    if (reunido.divisa === undefined && divisa) reunido.divisa = divisa;
    if (mejoraElTipo(reunido.tipo, tipo)) reunido.tipo = tipo;
    this.activos.set(clave, reunido);
    return { clave, revision };
  }

  /** Lee una tabla de la hoja «Posiciones». Devuelve cuántas filas útiles tenía. */
  leerPosiciones(documento: DocumentoLeido, tabla: TablaReconocida<ClaveDeColumnaDePosiciones>): number {
    const { columnas, indice } = tabla.cabecera;
    const nombreDe = (clave: ClaveDeColumnaDePosiciones): string => COLUMNAS_DE_POSICIONES.find((columna) => columna.clave === clave)!.nombre;
    const porFecha = new Map<Dia, ExtractoPropuesto>();
    this.fijarElOrdenDeLasFechas(documento, tabla, ["fecha"]);
    let utiles = 0;
    for (let i = indice + 1; i < tabla.tabla.length; i += 1) {
      const fila = tabla.tabla[i] ?? [];
      if (esFilaVacia(fila) || esFilaDeComentarioOTotal(fila)) continue;
      const celda = (clave: ClaveDeColumnaDePosiciones): string => {
        const posicion = columnas.get(clave);
        return posicion === undefined ? "" : (fila[posicion] ?? "").trim();
      };
      const donde = `«${documento.nombre}», posiciones, fila ${i + 1}`;
      const fecha = leerFecha(celda("fecha"), this.ordenDeLaFecha);
      if (!fecha) {
        this.avisos.push(`${donde}: no entiendo la fecha «${celda("fecha")}»; se ha ignorado la fila.`);
        continue;
      }
      const cifra = (clave: ClaveDeColumnaDePosiciones): Decimal | undefined | "ilegible" => {
        const crudo = celda(clave);
        if (crudo === "") return undefined;
        const leida = this.leerCifra(crudo);
        if (leida === undefined) return "ilegible";
        /* H1-07: la hoja de posiciones no tiene líneas que revisar; la cifra ambigua se dice en los avisos del documento. */
        const ambigua = this.lecturaAmbigua(nombreDe(clave), crudo, leida);
        if (ambigua) this.avisos.push(`${donde}: ${ambigua}`);
        return leida;
      };
      const titulos = cifra("titulos");
      const valor = cifra("valor");
      for (const [clave, leida] of [["titulos", titulos], ["valor", valor]] as const) {
        if (leida === "ilegible") this.avisos.push(`${donde}: la columna «${nombreDe(clave)}» dice «${celda(clave)}», que no es una cifra; se ha ignorado la fila.`);
      }
      if (titulos === "ilegible" || valor === "ilegible") continue;
      const extracto = porFecha.get(fecha) ?? { fecha, documento: documento.nombre, posiciones: [], efectivo: [] };
      porFecha.set(fecha, extracto);
      const nombre = celda("nombre");
      /* Como en la hoja de movimientos: «GBp» se queda en peniques. `divisa` es la de un activo, si es una divisa. */
      const comoLlega = divisaComoLlega(celda("divisa"));
      const divisa = leerDivisa(celda("divisa"));
      if (celda("isin") === "" && normalizarNombre(nombre).startsWith("EFECTIVO")) {
        const saldo = valor ?? titulos;
        if (saldo === undefined) {
          this.avisos.push(`${donde}: la fila de efectivo no tiene saldo en «${nombreDe("valor")}»; se ha ignorado.`);
          continue;
        }
        extracto.efectivo.push({ divisa: comoLlega ?? this.divisaBase, saldo: aTexto(saldo) });
        utiles += 1;
        continue;
      }
      if (titulos === undefined) {
        this.avisos.push(`${donde}: falta el número de títulos; se ha ignorado la fila.`);
        continue;
      }
      const avisosDeLaCita: string[] = [];
      const isin = celda("isin").toUpperCase().replace(/\s+/g, "");
      const isinValido = FORMA_ISIN.test(isin) ? isin : undefined;
      const clave = isinValido ?? normalizarNombre(nombre !== "" ? nombre : celda("isin"));
      if (isin !== "" && !isinValido) avisosDeLaCita.push(`«${celda("isin")}» no tiene la forma de un ISIN: el activo se cita por su nombre.`);
      if (clave === "") {
        this.avisos.push(`${donde}: falta el ISIN o el nombre del activo; se ha ignorado la fila.`);
        continue;
      }
      for (const aviso of avisosDeLaCita) this.avisos.push(`${donde}: ${aviso}`);
      const activo: ActivoCitado = { clave, nombre: nombre !== "" ? nombre.replace(/\s+/g, " ") : (isinValido ?? clave) };
      if (isinValido) activo.isin = isinValido;
      if (divisa) activo.divisa = divisa;
      /* A-210: el precio en la divisa del activo, si la fila lo da, con esa divisa al lado. Es opcional: uno que no se entiende
         no tira la fila, que sin él se lee como sin la columna. */
      const precio = cifra("precio");
      let cotizacion: Decimal | undefined;
      if (precio === "ilegible") {
        this.avisos.push(`${donde}: la columna «${nombreDe("precio")}» dice «${celda("precio")}», que no es una cifra; la posición se lee sin precio.`);
      } else if (precio !== undefined && !precio.gt(0)) {
        this.avisos.push(`${donde}: el precio ha de ser mayor que cero; la posición se lee sin precio.`);
      } else if (precio !== undefined && !divisa) {
        this.avisos.push(`${donde}: hay precio pero falta su divisa en «${nombreDe("divisa")}»; la posición se lee sin precio.`);
      } else {
        cotizacion = precio;
      }
      extracto.posiciones.push({
        activo,
        titulos: aTexto(titulos),
        ...(valor !== undefined ? { valor: aTexto(valor) } : {}),
        ...(cotizacion !== undefined && divisa ? { cotizacion: aTexto(cotizacion), divisa } : {})
      });
      utiles += 1;
    }
    this.extractos.push(...[...porFecha.values()].filter((extracto) => extracto.posiciones.length + extracto.efectivo.length > 0));
    return utiles;
  }

  /** Valida cada fila con el motor, la ordena por fecha y le pone su identificador provisional. */
  terminar(): { movimientos: MovimientoPropuesto[]; extractos: ExtractoPropuesto[] } {
    const contexto = this.contexto();
    const ordenados = [...this.borradores].sort((a, b) => {
      const fa = a.movimiento.fechaOperacion || "\uffff";
      const fb = b.movimiento.fechaOperacion || "\uffff";
      return fa < fb ? -1 : fa > fb ? 1 : a.orden - b.orden;
    });
    const movimientos = ordenados.map((borrador, posicion): MovimientoPropuesto => {
      const movimiento = { ...borrador.movimiento, id: `plantilla-${posicion + 1}` };
      const definicion = definicionDe(movimiento.tipo)!;
      const avisos = [...borrador.avisos];
      let requiereRevision = borrador.requiereRevision;
      /* Una fecha que falta ya tiene su aviso: no se repite el del motor. */
      const errores = definicion.validar(movimiento, contexto).filter((error) => movimiento.fechaOperacion !== "" || error !== "La fecha de operación no es válida.");
      if (errores.length > 0) {
        for (const error of errores) if (!avisos.includes(error)) avisos.push(error);
        requiereRevision = true;
      }
      const propuesto: MovimientoPropuesto = {
        movimiento,
        avisos,
        requiereRevision,
        documento: borrador.documento,
        fila: borrador.fila,
        textoOriginal: borrador.textoOriginal
      };
      if (borrador.activo) propuesto.activo = this.citado(borrador.activo.clave, borrador.activo.tipo);
      if (borrador.destino) propuesto.destino = this.citado(borrador.destino.clave, borrador.destino.tipo);
      return propuesto;
    });
    const extractos = [...this.extractos].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
    return { movimientos, extractos };
  }

  /**
   * La cita de un activo, con lo reunido de todo el documento y el tipo que deduce este movimiento. Si este movimiento
   * solo deduce la «acción» débil y otra fila del documento dice algo firme, va lo firme. Si nada lo dice, la cita lleva
   * `tipoSupuesto`, para que la revisión pregunte.
   */
  private citado(clave: string, tipo: TipoDeducido | undefined): ActivoCitado {
    const reunido = this.activos.get(clave)!;
    const citado: ActivoCitado = { clave, nombre: reunido.nombre || reunido.isin || clave };
    if (reunido.isin) citado.isin = reunido.isin;
    if (reunido.divisa) citado.divisa = reunido.divisa;
    const elTipo = tipo !== undefined && mejoraElTipo(tipo, reunido.tipo) ? reunido.tipo : tipo;
    if (elTipo) {
      citado.tipo = elTipo.tipo;
      if (!elTipo.firme) citado.tipoSupuesto = true;
    }
    return citado;
  }

  /** Un contexto del motor en el que existen todos los activos citados, con `id` = su clave. */
  private contexto(): ContextoDeMovimiento {
    const porId = new Map<string, Activo>();
    for (const reunido of this.activos.values()) {
      const activo: Activo = {
        id: reunido.clave,
        nombre: reunido.nombre || reunido.clave,
        tipo: reunido.tipo?.tipo ?? "OTRO",
        divisa: reunido.divisa ?? this.divisaBase,
        origen: "manual"
      };
      if (reunido.isin) activo.isin = reunido.isin;
      porId.set(reunido.clave, activo);
    }
    return { divisaBase: this.divisaBase, activo: (activoId) => (activoId === undefined ? undefined : porId.get(activoId)) };
  }
}
