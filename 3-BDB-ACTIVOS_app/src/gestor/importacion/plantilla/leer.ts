/**
 * La lectura de la plantilla genérica: de las tablas de un documento a movimientos
 * propuestos y extractos.
 *
 * Nada se inventa: una cifra que no se entiende se deja en blanco con un aviso, un tipo que
 * no se reconoce entra como «Otro cargo o abono» para que el asesor lo reclasifique, y toda
 * fila que el motor no daría por buena sale marcada para revisión con los errores del motor.
 */
import { aTexto, leerCifra, type Decimal } from "../../motor/decimal";
import type { CampoDeMovimiento, ContextoDeMovimiento, DefinicionDeMovimiento } from "../../motor/efectos";
import { esDia, type Dia } from "../../motor/fechas";
import type { Activo, DestinoDelMovimiento, Movimiento, TipoDeActivo } from "../../motor/modelo";
import { TIPOS, definicionDe } from "../../motor/movimientos/registro";
import type { ActivoCitado, DocumentoLeido, ExtractoPropuesto, MovimientoPropuesto } from "../tipos";
import {
  COLUMNAS_DE_MOVIMIENTOS,
  COLUMNAS_DE_POSICIONES,
  columnaDeMovimientos,
  columnaDePosiciones,
  definicionDeColumna,
  normalizarRotulo,
  reconocerTipo,
  type ClaveDeColumna,
  type ClaveDeColumnaDePosiciones,
  type ColumnaDeLaPlantilla
} from "./columnas";

/** En cuántas filas del principio de cada tabla se busca la cabecera: puede haber un título encima. */
export const FILAS_PARA_BUSCAR_LA_CABECERA = 15;

/** Los rótulos de tipo que solo dicen «transferencia», ya normalizados: aportación o retirada según el signo del importe. */
const TRANSFERENCIA = new Set(["transferencia", "transfer", "transferenciabancaria"]);

const FORMA_ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const FORMA_DIVISA = /^[A-Z]{3}$/;

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

/** El tipo de activo que se deduce del tipo de movimiento: un fondo se suscribe, un bono paga cupón. */
function tipoDeActivoDelMovimiento(tipo: string): TipoDeActivo | undefined {
  if (tipo === "suscripcion" || tipo === "reembolso" || tipo === "traspaso") return "FONDO";
  if (tipo === "cupon" || tipo === "amortizacion") return "BONO";
  if (tipo === "compra" || tipo === "venta") return "ACCION";
  return undefined;
}

/** Lo que se sabe de un activo citado juntando todas las filas del documento que lo citan. */
interface ActivoReunido {
  clave: string;
  isin?: string;
  nombre: string;
  divisa?: string;
  tipo?: TipoDeActivo;
}

/** Lo que una fila deja leído antes de validarla con el motor. */
interface Borrador {
  movimiento: Movimiento;
  definicion?: DefinicionDeMovimiento;
  activo?: { clave: string; tipo?: TipoDeActivo };
  destino?: { clave: string; tipo?: TipoDeActivo };
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
      const valor = leerCifra(crudo);
      if (valor === undefined) {
        avisos.push(`La columna «${definicionDeColumna(clave).nombre}» dice «${crudo}», que no es una cifra: se ha dejado en blanco.`);
        requiereRevision = true;
      }
      return valor;
    };
    const divisa = (clave: ClaveDeColumna): string | undefined => {
      const crudo = celda(clave).toUpperCase();
      if (crudo === "") return undefined;
      if (!FORMA_DIVISA.test(crudo)) {
        avisos.push(`La columna «${definicionDeColumna(clave).nombre}» dice «${celda(clave)}», que no es un código de divisa de tres letras: se ha dejado en blanco.`);
        requiereRevision = true;
        return undefined;
      }
      return crudo;
    };

    const textoDeFecha = celda("fecha");
    const fecha = leerFecha(textoDeFecha, this.ordenDeLaFecha);
    /* Sin fecha y sin importe legibles no hay movimiento que proponer: la fila se descarta. */
    if (!fecha && leerCifra(celda("importe")) === undefined) return undefined;

    /* El tipo. */
    const textoDeTipo = celda("tipo");
    let definicion = textoDeTipo === "" ? undefined : reconocerTipo(textoDeTipo);
    /* «Transferencia» a secas no dice si entra o sale: lo dice el signo de su importe (auditoría 16-11-2026, GES-3). Antes caía en
       «Otro cargo o abono», que cuenta como resultado: una transferencia del cliente de 1.000 € era una ganancia de 1.000 €. */
    if (!definicion && TRANSFERENCIA.has(normalizarRotulo(textoDeTipo))) {
      const importeDeLaFila = leerCifra(celda("importe"));
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
    const tipoDeActivo = reconocido ? tipoDeActivoDelMovimiento(definicion.tipo) : undefined;
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
      const tipoDelDestino = definicion.tipo === "traspaso" ? "FONDO" : undefined;
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
  private citar(textoDeIsin: string, nombre: string, divisa: string | undefined, tipo: TipoDeActivo | undefined, avisos: string[]): { clave?: string; revision: boolean } {
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
    if (reunido.tipo === undefined && tipo) reunido.tipo = tipo;
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
        return leerCifra(crudo) ?? "ilegible";
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
      const divisa = celda("divisa").toUpperCase();
      if (celda("isin") === "" && normalizarNombre(nombre).startsWith("EFECTIVO")) {
        const saldo = valor ?? titulos;
        if (saldo === undefined) {
          this.avisos.push(`${donde}: la fila de efectivo no tiene saldo en «${nombreDe("valor")}»; se ha ignorado.`);
          continue;
        }
        extracto.efectivo.push({ divisa: divisa || this.divisaBase, saldo: aTexto(saldo) });
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
      if (FORMA_DIVISA.test(divisa)) activo.divisa = divisa;
      extracto.posiciones.push({ activo, titulos: aTexto(titulos), ...(valor !== undefined ? { valor: aTexto(valor) } : {}) });
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

  /** La cita de un activo, con lo reunido de todo el documento y el tipo que deduce este movimiento. */
  private citado(clave: string, tipo: TipoDeActivo | undefined): ActivoCitado {
    const reunido = this.activos.get(clave)!;
    const citado: ActivoCitado = { clave, nombre: reunido.nombre || reunido.isin || clave };
    if (reunido.isin) citado.isin = reunido.isin;
    if (reunido.divisa) citado.divisa = reunido.divisa;
    if (tipo) citado.tipo = tipo;
    return citado;
  }

  /** Un contexto del motor en el que existen todos los activos citados, con `id` = su clave. */
  private contexto(): ContextoDeMovimiento {
    const porId = new Map<string, Activo>();
    for (const reunido of this.activos.values()) {
      const activo: Activo = {
        id: reunido.clave,
        nombre: reunido.nombre || reunido.clave,
        tipo: reunido.tipo ?? "OTRO",
        divisa: reunido.divisa ?? this.divisaBase,
        origen: "manual"
      };
      if (reunido.isin) activo.isin = reunido.isin;
      porId.set(reunido.clave, activo);
    }
    return { divisaBase: this.divisaBase, activo: (activoId) => (activoId === undefined ? undefined : porId.get(activoId)) };
  }
}
