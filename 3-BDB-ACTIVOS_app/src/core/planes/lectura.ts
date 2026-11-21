/**
 * Planes de pensiones y EPSV: cómo se escribe cada cifra, en la lista, en la ficha y en la comparación.
 *
 * Una sola lectura para los tres sitios: la fila «Rentabilidad 3 años» de la ficha y la de la comparación salen de
 * la misma función, así que no pueden decir cosas distintas del mismo plan.
 *
 * Lo que este módulo decide es cómo se dice que una cifra NO está, que aquí son dos cosas distintas. Un plan que
 * empezó hace dos años no tiene rentabilidad a diez: **no aplica**, y no hay nada que buscar. Uno de veinte años
 * sin esa cifra tiene un hueco: **falta el dato**. La diferencia se saca de su fecha de inicio, no se supone.
 */
import { fecha, importe, importeGrande, numero, oFalta, porcentaje, ratio, rentabilidad } from "../formato";
import { textoDeAusencia } from "../textoDeAusencia";
import type { CeldaDeTabla } from "../../types/tablaDeDatos";
import {
  categoriasDistintas,
  diasDeRetrasoDeLaRentabilidad,
  diasEntre,
  diasSinValor,
  fechasDeRentabilidadDispares,
  nombreLargoDelTipo,
  type PlanDePensiones,
  type VentanaDeRentabilidad
} from "./modelo";

const AUSENCIA = {
  falta: (estrecha: boolean): CeldaDeTabla => ({ texto: textoDeAusencia("falta", { estrecha }), ausencia: "falta" }),
  noAplica: (): CeldaDeTabla => ({ texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" })
};

/**
 * Años que lleva el plan hasta `hasta`; por defecto, el día en que se consultó. Sin fecha de inicio no se sabe.
 *
 * JUB-9 (auditoría del 16-11-2026): la historia se mide hasta la fecha de LA CIFRA, no hasta la de la consulta, cuando
 * la cifra dice de cuándo es. Las rentabilidades pueden ir meses por detrás: un plan que cumplió tres años hace un mes
 * no tiene rentabilidad a tres años a una fecha de hace cuatro, y eso es «no aplica», no un dato que falte.
 */
export function aniosDeHistoria(plan: Pick<PlanDePensiones, "fechaInicio" | "consultado">, hasta: string = plan.consultado): number | undefined {
  return plan.fechaInicio ? diasEntre(plan.fechaInicio, hasta) / 365.25 : undefined;
}

/** Los años de historia que pide cada ventana para existir. */
const ANIOS_DE_LA_VENTANA: Partial<Record<VentanaDeRentabilidad, number>> = { "1y": 1, "3y": 3, "5y": 5, "10y": 10 };

/**
 * La ausencia de una cifra que necesita `anios` de historia: no aplica si el plan no los tiene; si los tiene, falta.
 * `fechaDeLaCifra` es de cuándo son las cifras de esa familia, si el proveedor lo dice; sin ella vale el día de la consulta.
 */
function ausenciaPorHistoria(plan: PlanDePensiones, anios: number | undefined, estrecha: boolean, fechaDeLaCifra?: string): CeldaDeTabla {
  const historia = aniosDeHistoria(plan, fechaDeLaCifra ?? plan.consultado);
  return anios !== undefined && historia !== undefined && historia < anios ? AUSENCIA.noAplica() : AUSENCIA.falta(estrecha);
}

export function celdaDeRentabilidad(plan: PlanDePensiones, ventana: VentanaDeRentabilidad, estrecha = false): CeldaDeTabla {
  const valor = plan.rentabilidad[ventana];
  if (valor === undefined) return ausenciaPorHistoria(plan, ANIOS_DE_LA_VENTANA[ventana], estrecha, plan.rentabilidadFecha);
  return { texto: oFalta(rentabilidad(valor)), valor };
}

export function celdaDeVolatilidad(plan: PlanDePensiones, ventana: "1y" | "3y", estrecha = false): CeldaDeTabla {
  const valor = plan.volatilidad[ventana];
  if (valor === undefined) return ausenciaPorHistoria(plan, ventana === "1y" ? 1 : 3, estrecha);
  return { texto: oFalta(porcentaje(valor)), valor };
}

/** Un ratio a tres años: Sharpe, beta, ratio de información. */
function celdaDeRatio(plan: PlanDePensiones, valor: number | undefined, estrecha = false): CeldaDeTabla {
  if (valor === undefined) return ausenciaPorHistoria(plan, 3, estrecha);
  return { texto: oFalta(ratio(valor)), valor };
}

/**
 * Una cifra a tres años que va en tanto por ciento: el alfa, que es una rentabilidad (con su signo), y el R², que no
 * lo es (sin él).
 */
function celdaDePorcentajeATresAnios(
  plan: PlanDePensiones,
  valor: number | undefined,
  escribir: (fraccion: number) => string | null,
  estrecha = false
): CeldaDeTabla {
  if (valor === undefined) return ausenciaPorHistoria(plan, 3, estrecha);
  return { texto: oFalta(escribir(valor)), valor };
}

export const celdaDeSharpe = (plan: PlanDePensiones, estrecha = false) => celdaDeRatio(plan, plan.sharpe, estrecha);

/** La comisión de gestión. Donde el banco no la publica, falta: no se rellena con otra. */
export function celdaDeComision(plan: PlanDePensiones, estrecha = false): CeldaDeTabla {
  return plan.comisionDeGestion === undefined ? AUSENCIA.falta(estrecha) : { texto: oFalta(porcentaje(plan.comisionDeGestion)), valor: plan.comisionDeGestion };
}

/** «★★★☆☆». Las da el proveedor a partir de tres años de historia. */
export function celdaDeEstrellas(plan: PlanDePensiones, estrecha = false): CeldaDeTabla {
  if (plan.estrellas === undefined) return ausenciaPorHistoria(plan, 3, estrecha, plan.estrellasFecha);
  return { texto: `${"★".repeat(plan.estrellas)}${"☆".repeat(5 - plan.estrellas)}`, valor: plan.estrellas };
}

/**
 * El valor de la participación, con los cinco decimales que da el proveedor y punto de millar (FMT-06), como en la
 * ficha y en la comparación: «1.234,56789 €». No es `precio`, que corta en cuatro y quitaría una cifra de la fuente.
 * Y su fecha debajo.
 */
export function celdaDelValor(plan: PlanDePensiones, estrecha = false): CeldaDeTabla {
  if (!plan.valor) return AUSENCIA.falta(estrecha);
  return { texto: oFalta(importe(plan.valor.importe, { decimales: 5 })), valor: plan.valor.importe, apunte: oFalta(fecha(plan.valor.fecha)) };
}

/** El patrimonio del plan, que es un importe grande: en millones. */
function celdaDePatrimonio(valor: number | undefined): CeldaDeTabla {
  return valor === undefined ? AUSENCIA.falta(false) : { texto: oFalta(importeGrande(valor)), valor };
}

function celdaDeImporte(valor: number | undefined): CeldaDeTabla {
  return valor === undefined ? AUSENCIA.falta(false) : { texto: oFalta(importe(valor)), valor };
}

function celdaDeTexto(valor: string | undefined): CeldaDeTabla {
  return valor === undefined ? AUSENCIA.falta(false) : { texto: valor };
}

function celdaDeFecha(valor: string | undefined): CeldaDeTabla {
  return valor === undefined ? AUSENCIA.falta(false) : { texto: oFalta(fecha(valor)), valor };
}

// ----------------------------------------------------------------------------------------------------------------
// Las líneas de la ficha, que son también las filas de la comparación
// ----------------------------------------------------------------------------------------------------------------

export interface LineaDelPlan {
  clave: string;
  rotulo: string;
  /** Como se llama dentro de un bloque que ya dice de qué va: «1 año» bajo «Rentabilidad». */
  rotuloEnSuBloque?: string;
  celda: CeldaDeTabla;
  /** Es un texto y no una cifra: en la comparación puede partir en dos líneas. */
  textoLargo?: boolean;
}

export interface OpcionesDeLectura {
  /** Fuera de Modo cliente se nombra de quién es cada dato; dentro, no: es cocina. */
  conProveedor: boolean;
}

export function lineasDeRentabilidad(plan: PlanDePensiones): LineaDelPlan[] {
  const ventanas: ReadonlyArray<readonly [VentanaDeRentabilidad, string, string]> = [
    ["1m", "Rentabilidad 1 mes", "1 mes"],
    ["6m", "Rentabilidad 6 meses", "6 meses"],
    /* «YTD» en su bloque, como en la captura que eligió Óscar el 17-11-2026; el rótulo entero sigue diciendo qué es. */
    ["ytd", "Rentabilidad en lo que va de año (YTD)", "YTD"],
    ["1y", "Rentabilidad 1 año", "1 año"],
    ["3y", "Rentabilidad anualizada 3 años", "3 años, anualizada"],
    ["5y", "Rentabilidad anualizada 5 años", "5 años, anualizada"],
    ["10y", "Rentabilidad anualizada 10 años", "10 años, anualizada"]
  ];
  return [
    ...ventanas.map(([ventana, rotulo, rotuloEnSuBloque]) => ({ clave: `rentabilidad-${ventana}`, rotulo, rotuloEnSuBloque, celda: celdaDeRentabilidad(plan, ventana) })),
    /* La fecha es una fila más, y no un pie: dos rentabilidades de fechas distintas no se comparan sin verlo. */
    { clave: "rentabilidad-fecha", rotulo: "Rentabilidades a fecha de", celda: celdaDeFecha(plan.rentabilidadFecha) }
  ];
}

export function lineasDeRiesgo(plan: PlanDePensiones): LineaDelPlan[] {
  return [
    { clave: "volatilidad-1y", rotulo: "Volatilidad 1 año", celda: celdaDeVolatilidad(plan, "1y") },
    { clave: "volatilidad-3y", rotulo: "Volatilidad 3 años", celda: celdaDeVolatilidad(plan, "3y") },
    { clave: "sharpe-3y", rotulo: "Sharpe 3 años", celda: celdaDeSharpe(plan) },
    { clave: "alfa-3y", rotulo: "Alfa 3 años", celda: celdaDePorcentajeATresAnios(plan, plan.alfa, rentabilidad) },
    { clave: "beta-3y", rotulo: "Beta 3 años", celda: celdaDeRatio(plan, plan.beta) },
    { clave: "r2-3y", rotulo: "R² 3 años", celda: celdaDePorcentajeATresAnios(plan, plan.r2, porcentaje) },
    { clave: "informacion-3y", rotulo: "Ratio de información 3 años", celda: celdaDeRatio(plan, plan.ratioDeInformacion) }
  ];
}

export function lineasDeDatos(plan: PlanDePensiones, { conProveedor }: OpcionesDeLectura): LineaDelPlan[] {
  const estrellas = celdaDeEstrellas(plan);
  return [
    { clave: "tipo", rotulo: "Producto", celda: { texto: nombreLargoDelTipo(plan) }, textoLargo: true },
    {
      clave: "dgsfp",
      rotulo: "Código en la DGSFP",
      /* Una EPSV no se registra en la DGSFP: la casilla está cerrada, no vacía. */
      celda: plan.tipo === "EPSV" ? AUSENCIA.noAplica() : celdaDeTexto(plan.codigoDgsfp)
    },
    { clave: "gestora", rotulo: "Gestora", celda: celdaDeTexto(plan.gestora), textoLargo: true },
    { clave: "categoria", rotulo: "Categoría", celda: celdaDeTexto(plan.categoria), textoLargo: true },
    { clave: "inicio", rotulo: "Fecha de inicio", celda: celdaDeFecha(plan.fechaInicio) },
    { clave: "patrimonio", rotulo: "Patrimonio", celda: celdaDePatrimonio(plan.patrimonio) },
    { clave: "valor", rotulo: "Valor de la participación", celda: celdaDelValor(plan) },
    { clave: "comision", rotulo: conProveedor ? "Comisión de gestión, según el banco" : "Comisión de gestión", celda: celdaDeComision(plan) },
    { clave: "minima", rotulo: "Aportación mínima", celda: celdaDeImporte(plan.aportacionMinima) },
    {
      clave: "estrellas",
      rotulo: conProveedor ? "Estrellas Morningstar" : "Estrellas",
      celda: plan.estrellas !== undefined && plan.estrellasFecha ? { ...estrellas, apunte: oFalta(fecha(plan.estrellasFecha)) } : estrellas
    }
  ];
}

/** Todas las líneas de un plan, en el orden de la comparación: primero qué es, después cómo ha ido. */
export function lineasDelPlan(plan: PlanDePensiones, opciones: OpcionesDeLectura): LineaDelPlan[] {
  return [...lineasDeDatos(plan, opciones), ...lineasDeRentabilidad(plan), ...lineasDeRiesgo(plan)];
}

// ----------------------------------------------------------------------------------------------------------------
// Lo que hay que decir junto a las cifras
// ----------------------------------------------------------------------------------------------------------------

const dias = (cuantos: number) => `${oFalta(numero(cuantos))} días`;

/** Los avisos de un plan: lo que cambia cómo se leen sus cifras. Ninguno opina sobre el plan. */
export function avisosDelPlan(plan: PlanDePensiones): string[] {
  const avisos: string[] = [];
  const sinValor = diasSinValor(plan);
  if (sinValor !== undefined && plan.valor) {
    avisos.push(
      `El último valor de la participación es del ${oFalta(fecha(plan.valor.fecha))}: lleva ${dias(sinValor)} sin publicarse. Puede haberse fusionado, liquidado o dejado de informar, y sus cifras no describen el presente.`
    );
  }
  const retraso = diasDeRetrasoDeLaRentabilidad(plan);
  if (retraso !== undefined && plan.rentabilidadFecha && !(sinValor !== undefined && plan.valor?.fecha === plan.rentabilidadFecha)) {
    avisos.push(
      `Las rentabilidades son del ${oFalta(fecha(plan.rentabilidadFecha))}, ${dias(retraso)} antes de la consulta${plan.valor ? `, y el valor de la participación es del ${oFalta(fecha(plan.valor.fecha))}` : ""}: no cubren el mismo periodo que las de otro plan con fecha reciente.`
    );
  }
  return avisos;
}

/** El aviso de un plan en una línea, para la lista: lo mismo que dice su ficha, sin el detalle. */
export function avisoCortoDelPlan(plan: PlanDePensiones): string | undefined {
  if (diasSinValor(plan) !== undefined && plan.valor) {
    return `Sin valor publicado desde el ${oFalta(fecha(plan.valor.fecha))}: sus cifras no describen el presente.`;
  }
  if (diasDeRetrasoDeLaRentabilidad(plan) !== undefined && plan.rentabilidadFecha) {
    return `Sus rentabilidades son del ${oFalta(fecha(plan.rentabilidadFecha))}: no cubren el mismo periodo que las de los demás.`;
  }
  return undefined;
}

/** Lo que hay que saber para leer la ficha o la comparación, siempre a la vista. */
export function notasDeLectura({ conProveedor }: OpcionesDeLectura): string[] {
  const quien = conProveedor ? "Morningstar" : "el proveedor de los datos";
  return [
    `La rentabilidad, la volatilidad y los ratios los calcula ${quien}; aquí no se recalcula nada. Rentabilidades pasadas no garantizan rentabilidades futuras.`,
    `Alfa, beta, R² y ratio de información se miden contra el índice que ${quien} asigna a la categoría de cada plan.`,
    `La comisión de gestión es la que publica ${conProveedor ? "el banco en su buscador de planes" : "la entidad comercializadora"}; la vigente es la del documento de datos fundamentales del plan.`
  ];
}

/** Las notas de una comparación concreta: solo lo que de verdad pasa entre esos planes. */
export function notasDeComparacion(planes: readonly PlanDePensiones[], opciones: OpcionesDeLectura): string[] {
  const notas: string[] = [];
  const tipos = new Set(planes.map((plan) => plan.tipo));
  if (tipos.size > 1) {
    notas.push("Se comparan planes de pensiones con EPSV: no tributan igual ni se rescatan con las mismas reglas, y eso no sale en ninguna de estas cifras.");
  }
  if (fechasDeRentabilidadDispares(planes)) {
    notas.push("Las rentabilidades no son todas de la misma fecha (fila «Rentabilidades a fecha de»): cada una cubre un periodo distinto y no se comparan sin tenerlo en cuenta.");
  }
  if (categoriasDistintas(planes)) {
    notas.push("Los planes no son de la misma categoría: el alfa, la beta, el R² y el ratio de información de cada uno se miden contra un índice distinto y no se comparan entre sí.");
  }
  for (const plan of planes) notas.push(...avisosDelPlan(plan).map((aviso) => `${plan.nombre}. ${aviso}`));
  return [...notas, ...notasDeLectura(opciones)];
}
