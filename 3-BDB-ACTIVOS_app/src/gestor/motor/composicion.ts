/**
 * Composición de una cartera a una fecha: en qué está invertida.
 *
 * Cuatro repartos —clase de activo, divisa, región y sector— más el tipo de producto y las
 * principales posiciones. Donde la plataforma conoce la cartera interna de un fondo, se
 * mira dentro de él (un fondo global reparte su peso entre regiones y sectores); donde no,
 * lo que falta se dice en una línea «Sin clasificar», nunca se reparte a ojo.
 */
import { NOMBRE_DEL_TIPO_DE_ACTIVO, type Activo } from "./modelo";

/** Lo que se sabe de cómo se reparte un activo. Todos los repartos van en fracciones que suman (como mucho) 1. */
export interface FichaDeActivo {
  /** Renta variable, renta fija, liquidez… ya con su nombre en pantalla. */
  clases?: Record<string, number>;
  /** Regiones de su parte de renta variable, con su nombre en pantalla. Suman 1 sobre esa parte. */
  regiones?: Record<string, number>;
  /** Sectores de su parte de renta variable. Suman 1 sobre esa parte. */
  sectores?: Record<string, number>;
  /** Gastos corrientes anuales (TER) en fracción. */
  gastosCorrientes?: number;
  /** Qué parte del activo es renta variable (0 a 1). Las regiones y los sectores se refieren a ella. */
  rentaVariable?: number;
}

export interface LineaDeReparto {
  nombre: string;
  /** Valor en la divisa base. */
  valor: number;
  /** Peso sobre el total del reparto, de 0 a 1. */
  peso: number;
}

export interface Reparto {
  lineas: LineaDeReparto[];
  /** El valor sobre el que se calculan los pesos. */
  total: number;
}

export interface PosicionValorada {
  activo: Activo;
  valor: number;
}

export interface Composicion {
  /** Fondos, ETF, acciones, bonos y efectivo. */
  porTipoDeProducto: Reparto;
  /** Renta variable, renta fija, liquidez… mirando dentro de los fondos. */
  porClaseDeActivo: Reparto;
  /** Divisa en la que cotiza cada posición, más el efectivo en su divisa. */
  porDivisa: Reparto;
  /** Regiones y sectores de la renta variable de la cartera. */
  porRegion: Reparto;
  porSector: Reparto;
  /** Qué parte de la cartera es renta variable: la base de los repartos por región y sector. */
  rentaVariable: number;
  /** Las posiciones ordenadas por peso. */
  principales: Array<{ activoId: string; nombre: string; valor: number; peso: number }>;
  /** Peso de la mayor posición y de las cinco mayores, para avisar de una concentración. */
  mayorPosicion: number;
  cincoMayores: number;
}

export const SIN_CLASIFICAR = "Sin clasificar";
export const LIQUIDEZ = "Liquidez";

const CLASE_POR_TIPO: Record<Activo["tipo"], string | undefined> = {
  ACCION: "Renta variable",
  BONO: "Renta fija",
  FONDO: undefined,
  ETF: undefined,
  OTRO: undefined
};

function reparto(partes: Map<string, number>, total: number): Reparto {
  const lineas = [...partes.entries()]
    .filter(([, valor]) => Math.abs(valor) > 0.005)
    .map(([nombre, valor]) => ({ nombre, valor, peso: total !== 0 ? valor / total : 0 }))
    /* «Sin clasificar» va siempre al final: es lo que falta, no una categoría más. */
    .sort((a, b) => (a.nombre === SIN_CLASIFICAR ? 1 : b.nombre === SIN_CLASIFICAR ? -1 : b.valor - a.valor));
  return { lineas, total };
}

function sumar(mapa: Map<string, number>, clave: string, valor: number): void {
  mapa.set(clave, (mapa.get(clave) ?? 0) + valor);
}

/** Reparte `valor` según `pesos`; lo que los pesos no cubren va a «Sin clasificar». */
function repartir(mapa: Map<string, number>, valor: number, pesos: Record<string, number> | undefined): void {
  let cubierto = 0;
  for (const [nombre, peso] of Object.entries(pesos ?? {})) {
    if (!(peso > 0)) continue;
    sumar(mapa, nombre, valor * peso);
    cubierto += peso;
  }
  const resto = valor * (1 - Math.min(1, cubierto));
  if (Math.abs(resto) > 0.005) sumar(mapa, SIN_CLASIFICAR, resto);
}

export function componer(
  posiciones: PosicionValorada[],
  efectivoPorDivisa: Array<{ divisa: string; valor: number }>,
  fichas: ReadonlyMap<string, FichaDeActivo>
): Composicion {
  const efectivo = efectivoPorDivisa.reduce((suma, linea) => suma + linea.valor, 0);
  const invertido = posiciones.reduce((suma, posicion) => suma + posicion.valor, 0);
  const total = invertido + efectivo;

  const porTipo = new Map<string, number>();
  const porClase = new Map<string, number>();
  const porDivisa = new Map<string, number>();
  const porRegion = new Map<string, number>();
  const porSector = new Map<string, number>();
  let rentaVariable = 0;

  for (const { activo, valor } of posiciones) {
    const ficha = fichas.get(activo.id);
    sumar(porTipo, NOMBRE_DEL_TIPO_DE_ACTIVO[activo.tipo], valor);
    sumar(porDivisa, activo.divisa, valor);

    const clases = ficha?.clases
      ?? (activo.clasificacion?.claseDeActivo ? { [activo.clasificacion.claseDeActivo]: 1 } : undefined)
      ?? (CLASE_POR_TIPO[activo.tipo] ? { [CLASE_POR_TIPO[activo.tipo]!]: 1 } : undefined);
    repartir(porClase, valor, clases);

    /* Región y sector hablan de la renta variable: una acción lo es entera; de un fondo, su parte. */
    const parteDeRentaVariable = ficha?.rentaVariable ?? (activo.tipo === "ACCION" ? 1 : clases?.["Renta variable"] ?? 0);
    const enRentaVariable = valor * parteDeRentaVariable;
    if (enRentaVariable > 0.005) {
      rentaVariable += enRentaVariable;
      repartir(porRegion, enRentaVariable, ficha?.regiones ?? (activo.clasificacion?.region ? { [activo.clasificacion.region]: 1 } : undefined));
      repartir(porSector, enRentaVariable, ficha?.sectores ?? (activo.clasificacion?.sector ? { [activo.clasificacion.sector]: 1 } : undefined));
    }
  }
  for (const linea of efectivoPorDivisa) {
    if (Math.abs(linea.valor) <= 0.005) continue;
    sumar(porTipo, "Efectivo", linea.valor);
    sumar(porClase, LIQUIDEZ, linea.valor);
    sumar(porDivisa, linea.divisa, linea.valor);
  }

  const principales = posiciones
    .filter((posicion) => posicion.valor > 0.005)
    .map((posicion) => ({ activoId: posicion.activo.id, nombre: posicion.activo.nombre, valor: posicion.valor, peso: total !== 0 ? posicion.valor / total : 0 }))
    .sort((a, b) => b.valor - a.valor);

  return {
    porTipoDeProducto: reparto(porTipo, total),
    porClaseDeActivo: reparto(porClase, total),
    porDivisa: reparto(porDivisa, total),
    porRegion: reparto(porRegion, rentaVariable),
    porSector: reparto(porSector, rentaVariable),
    rentaVariable: total !== 0 ? rentaVariable / total : 0,
    principales,
    mayorPosicion: principales[0]?.peso ?? 0,
    cincoMayores: principales.slice(0, 5).reduce((suma, posicion) => suma + posicion.peso, 0)
  };
}
