/**
 * El extracto de posiciones de la cuenta de valores de Andbank.
 *
 * Traslado de `parse_positions_html` y `_validate_position_totals` de `parser.py`. Las
 * posiciones van en bloques que cierra un subtotal («TOTAL FONDOS INTERNACIONALES»): el
 * subtotal da la clase a las posiciones de su bloque, y los subtotales declarados se
 * comprueban contra la suma de sus posiciones.
 */
import { CERO, redondear, type Decimal } from "../../motor/decimal";
import type { Dia } from "../../motor/fechas";
import type { TipoDeActivo } from "../../motor/modelo";
import { ErrorDeFormato, ISIN, columnaObligatoria, importeEnTexto, leerFecha, leerNumero, limpiar, marcoDeTabla, plegar } from "./comun";

export type ClaseDePosicion =
  | "ACCION_NAC_NUEVA"
  | "ACCION_NAC"
  | "ACCION_INTL"
  | "ETF_NAC"
  | "ETF_INTL"
  | "FONDO_INTL"
  | "FONDO_NAC";

const BLOQUES: ReadonlyArray<readonly [prefijo: string, clase: ClaseDePosicion, clave: string]> = [
  ["TOTAL ACCIONES NACIONALES NUEVAS", "ACCION_NAC_NUEVA", "acciones_nacionales_nuevas"],
  ["TOTAL ACCIONES NACIONALES", "ACCION_NAC", "acciones_nacionales"],
  ["TOTAL ACCIONES INTERNACIONALES", "ACCION_INTL", "acciones_internacionales"],
  ["TOTAL ETFS FONDOS COTIZADOS NACIONALES", "ETF_NAC", "etfs_fondos_cotizados_nacionales"],
  ["TOTAL ETFS FONDOS COTIZADOS INTERNACIONALES", "ETF_INTL", "etfs_fondos_cotizados_internacionales"],
  ["TOTAL FONDOS INTERNACIONALES", "FONDO_INTL", "fondos_internacionales"],
  ["TOTAL FONDOS NACIONALES", "FONDO_NAC", "fondos_nacionales"]
];

/** Lo que se lee en un mensaje para cada subtotal. */
const NOMBRE_DEL_SUBTOTAL: Record<string, string> = {
  acciones_nacionales_nuevas: "acciones nacionales nuevas",
  acciones_nacionales: "acciones nacionales",
  acciones_internacionales: "acciones internacionales",
  etfs_fondos_cotizados_nacionales: "ETF nacionales",
  etfs_fondos_cotizados_internacionales: "ETF internacionales",
  fondos_internacionales: "fondos internacionales",
  fondos_nacionales: "fondos nacionales",
  fondos_inversion: "fondos de inversión",
  renta_variable_etfs: "renta variable y ETF",
  cartera: "el total de la cartera"
};

/** El tipo de activo de una clase de posiciones. */
export function tipoDeLaClase(clase: ClaseDePosicion): TipoDeActivo {
  if (clase.startsWith("FONDO_")) return "FONDO";
  if (clase.startsWith("ETF_")) return "ETF";
  return "ACCION";
}

export interface PosicionLeida {
  fila: number;
  textoOriginal: string;
  isin: string;
  nombre: string;
  clase: ClaseDePosicion;
  divisa?: string;
  /** `undefined` si títulos × precio no cuadra con el valor de mercado. */
  titulos?: Decimal;
  precioDeMercado?: Decimal;
  fechaDeCotizacion?: Dia;
  /** Valor de mercado en euros: el contravalor si la posición es en otra divisa. */
  valor: Decimal;
}

export interface ExtractoDePosiciones {
  documento: string;
  posiciones: PosicionLeida[];
  /** La mayor fecha de cotización válida de sus filas. */
  fecha?: Dia;
  avisos: string[];
}

function claveDelSubtotal(producto: string): { clase?: ClaseDePosicion; clave?: string } {
  const mayusculas = producto.toUpperCase();
  for (const [prefijo, clase, clave] of BLOQUES) if (mayusculas.startsWith(prefijo)) return { clase, clave };
  if (mayusculas.startsWith("TOTAL FONDOS DE INVERSION") || mayusculas.startsWith("TOTAL FONDOS DE INVERSIÓN")) return { clave: "fondos_inversion" };
  if (mayusculas.startsWith("TOTAL RENTA VARIABLE Y ETFS")) return { clave: "renta_variable_etfs" };
  if (mayusculas.startsWith("TOTAL CARTERA")) return { clave: "cartera" };
  return {};
}

/** Si una tabla es un extracto de posiciones: su cabecera tiene Producto, ISIN y Valor de mercado. */
export function esTablaDePosiciones(tabla: string[][]): boolean {
  const marco = marcoDeTabla(tabla);
  if (!marco) return false;
  const plegadas = marco.columnas.map(plegar);
  return plegadas.includes("producto") && plegadas.includes("isin") && plegadas.some((columna) => columna.includes("valor de mercado"));
}

const TOLERANCIA_DE_SUBTOTAL = "0.03";

function comprobarSubtotales(posiciones: PosicionLeida[], declarados: Map<string, Decimal>): void {
  const fondos: ClaseDePosicion[] = ["FONDO_INTL", "FONDO_NAC"];
  const rentaVariable: ClaseDePosicion[] = ["ACCION_NAC", "ACCION_NAC_NUEVA", "ACCION_INTL", "ETF_NAC", "ETF_INTL"];
  const comprobaciones: Array<[string, ClaseDePosicion[]]> = [
    ["fondos_internacionales", ["FONDO_INTL"]],
    ["fondos_nacionales", ["FONDO_NAC"]],
    ["acciones_nacionales", ["ACCION_NAC"]],
    ["acciones_nacionales_nuevas", ["ACCION_NAC_NUEVA"]],
    ["acciones_internacionales", ["ACCION_INTL"]],
    ["etfs_fondos_cotizados_nacionales", ["ETF_NAC"]],
    ["etfs_fondos_cotizados_internacionales", ["ETF_INTL"]],
    ["fondos_inversion", fondos],
    ["renta_variable_etfs", rentaVariable],
    ["cartera", [...fondos, ...rentaVariable]]
  ];
  for (const [clave, clases] of comprobaciones) {
    const declarado = declarados.get(clave);
    if (declarado === undefined) continue;
    const calculado = redondear(posiciones.filter((posicion) => clases.includes(posicion.clase)).reduce((suma, posicion) => suma.plus(posicion.valor), CERO));
    if (calculado.minus(redondear(declarado)).abs().gt(TOLERANCIA_DE_SUBTOTAL)) {
      throw new ErrorDeFormato(
        `El subtotal de posiciones no cuadra para ${NOMBRE_DEL_SUBTOTAL[clave] ?? clave}: sumando las posiciones sale ${importeEnTexto(calculado)} €, y el extracto dice ${importeEnTexto(redondear(declarado))} €. ` +
          "Carga el export original del banco, sin filas añadidas ni borradas."
      );
    }
  }
}

/** `parse_positions_html`: las posiciones de un documento, con sus subtotales comprobados. */
export function leerPosiciones(documento: { nombre: string; tablas: string[][][] }): ExtractoDePosiciones {
  const donde = `el extracto de posiciones «${documento.nombre}»`;
  const tabla = documento.tablas.find(esTablaDePosiciones) ?? documento.tablas[0];
  const marco = tabla ? marcoDeTabla(tabla) : undefined;
  if (!marco) throw new ErrorDeFormato(`No se ha encontrado ninguna tabla en ${donde}.`);
  const { columnas } = marco;
  const colProducto = columnaObligatoria(columnas, ["Producto"], donde);
  const colIsin = columnaObligatoria(columnas, ["ISIN"], donde);
  const colDivisa = columnaObligatoria(columnas, ["Div"], donde);
  const colTitulos = columnaObligatoria(columnas, ["Títulos", "Titulos", "Ttulos"], donde);
  columnaObligatoria(columnas, ["Coste medio"], donde);
  const colPrecio = columnaObligatoria(columnas, ["Precio de mercado"], donde);
  const colFecha = columnaObligatoria(columnas, ["Fecha cotización mercado", "Fecha cotizacion mercado", "Fecha cotizacin mercado"], donde);
  columnaObligatoria(columnas, ["Coste Adquisición", "Coste Adquisicion"], donde);
  const colValor = columnaObligatoria(columnas, ["Valor de mercado"], donde);
  columnaObligatoria(columnas, ["Plus Minus"], donde);
  const colContravalor = columnaObligatoria(columnas, ["Contravalor en EUR"], donde);

  const posiciones: PosicionLeida[] = [];
  let pendientes: Array<Omit<PosicionLeida, "clase">> = [];
  const declarados = new Map<string, Decimal>();
  const avisos: string[] = [];

  for (const { celdas, fila, textoOriginal } of marco.filas) {
    const producto = limpiar(celdas[colProducto]);
    const isin = limpiar(celdas[colIsin]).toUpperCase();
    if (producto.toUpperCase().startsWith("TOTAL")) {
      const { clase, clave } = claveDelSubtotal(producto);
      if (!clave) continue;
      if (producto.toUpperCase().includes("PLUSV")) {
        const valor = leerNumero(celdas[colValor]);
        if (valor !== undefined && !declarados.has(clave)) declarados.set(clave, valor);
      } else {
        const valor = leerNumero(celdas[colContravalor]);
        if (valor !== undefined) declarados.set(clave, valor);
        if (clase) {
          for (const pendiente of pendientes) posiciones.push({ ...pendiente, clase });
          pendientes = [];
        }
      }
      continue;
    }
    if (!ISIN.test(isin)) continue;

    const divisa = limpiar(celdas[colDivisa]).toUpperCase() || undefined;
    let titulos = leerNumero(celdas[colTitulos]);
    const precio = leerNumero(celdas[colPrecio]);
    const valorEnDivisa = leerNumero(celdas[colValor]);
    const contravalor = leerNumero(celdas[colContravalor]);
    const valorDeMercado = divisa && divisa !== "EUR" ? contravalor : valorEnDivisa;
    if (titulos !== undefined && precio !== undefined && valorEnDivisa !== undefined) {
      const implicito = titulos.times(precio);
      const tolerancia = valorEnDivisa.abs().times("0.001");
      const maxima = tolerancia.gt("0.05") ? tolerancia : "0.05";
      if (implicito.minus(valorEnDivisa).abs().gt(maxima)) {
        avisos.push(`Posición ${isin} (${producto}): títulos por precio no cuadra con el valor de mercado; se omiten los títulos.`);
        titulos = undefined;
      }
    }
    const valor = valorDeMercado !== undefined && !valorDeMercado.eq(0) ? valorDeMercado : (contravalor ?? CERO);
    pendientes.push({
      fila,
      textoOriginal,
      isin,
      nombre: producto,
      divisa,
      titulos,
      precioDeMercado: precio,
      fechaDeCotizacion: leerFecha(celdas[colFecha]),
      valor
    });
  }

  if (pendientes.length > 0) {
    throw new ErrorDeFormato(`${donde[0].toUpperCase()}${donde.slice(1)} termina con posiciones sin el subtotal de su bloque. Carga el export completo del banco.`);
  }
  if (posiciones.length === 0) throw new ErrorDeFormato(`No se han encontrado posiciones válidas en ${donde}.`);
  comprobarSubtotales(posiciones, declarados);

  const fechas = posiciones.map((posicion) => posicion.fechaDeCotizacion).filter((fecha): fecha is Dia => fecha !== undefined);
  const fecha = fechas.length > 0 ? fechas.reduce((a, b) => (a >= b ? a : b)) : undefined;
  return { documento: documento.nombre, posiciones, fecha, avisos };
}
