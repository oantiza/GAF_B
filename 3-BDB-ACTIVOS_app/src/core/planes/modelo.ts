/**
 * Planes de pensiones y EPSV: el modelo de la pantalla y lo que se decide con él, sin pintar nada.
 *
 * **Qué es esto.** Un catálogo aparte del de activos (decisión D-11 de Óscar, 13-11-2026). Un plan de pensiones o
 * una EPSV son patrimonio del cliente pero no son cartera: no se gestionan con ella, por fiscalidad. Por eso no
 * salen en el Buscador, no se añaden a una cartera y no entran en ningún cálculo de esta aplicación. Viven en
 * Jubilación y sirven para una cosa: ver la ficha de un plan y ponerla junto a la de otro.
 *
 * **Aquí no se calcula nada.** Cada cifra es la que da el proveedor, con su fecha cuando la trae. Lo que hace este
 * módulo es leer el documento, filtrar la lista y decir tres cosas que cambian cómo se lee una cifra y que nadie
 * debería tener que deducir: que el valor de un plan lleva tiempo sin publicarse, que sus rentabilidades son de
 * otra fecha, y que dos planes de categorías distintas no miden su alfa contra lo mismo.
 *
 * El único cálculo de la pantalla vive aparte, en `evolucionComparada.ts`: poner en base 100 las series de los planes
 * que se comparan, para poder dibujarlas juntas. Lo pidió Óscar sabiendo que lo es, y la pantalla lo dice.
 */
import type { Documento } from "../../adapters/baseNuevaLectura";

export type TipoDePlan = "PENSION_PLAN" | "EPSV";

export const VENTANAS_DE_RENTABILIDAD = ["1m", "6m", "ytd", "1y", "3y", "5y", "10y"] as const;
export type VentanaDeRentabilidad = (typeof VENTANAS_DE_RENTABILIDAD)[number];

export interface PlanDePensiones {
  /** El identificador del proveedor. No es un ISIN: un plan no lo tiene. */
  id: string;
  nombre: string;
  nombreLegal?: string;
  tipo: TipoDePlan;
  /** Plan de pensiones de empleo simplificado: sigue siendo un plan de pensiones. */
  empleoSimplificado: boolean;
  /** El código del registro de la DGSFP. Lo tienen los planes; una EPSV, no. */
  codigoDgsfp?: string;
  gestora?: string;
  divisa?: string;
  /** La categoría en la que lo clasifica el proveedor. */
  categoria?: string;
  estrellas?: number;
  estrellasFecha?: string;
  fechaInicio?: string;
  patrimonio?: number;
  aportacionMinima?: number;
  valor?: { importe: number; fecha: string };
  /** En fracción: 0,0303 es un 3,03 %. A 3, 5 y 10 años, anualizada. */
  rentabilidad: Partial<Record<VentanaDeRentabilidad, number>>;
  /** De cuándo son las rentabilidades. No es la fecha del valor y no se supone que lo sea. */
  rentabilidadFecha?: string;
  volatilidad: Partial<Record<"1y" | "3y", number>>;
  sharpe?: number;
  alfa?: number;
  beta?: number;
  r2?: number;
  ratioDeInformacion?: number;
  /** La que publica el banco en su buscador. Falta donde el banco no la pone. */
  comisionDeGestion?: number;
  serie?: { desde: string; hasta: string; puntosDiarios: number; puntosMensuales: number };
  /** El día en que se preguntó al proveedor. */
  consultado: string;
}

export interface PuntoDeLaSerie {
  fecha: string;
  valor: number;
}

export interface SerieDelPlan {
  desde: string;
  hasta: string;
  puntos: PuntoDeLaSerie[];
}

const esFecha = (valor: unknown): valor is string => typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor);
const esNumero = (valor: unknown): valor is number => typeof valor === "number" && Number.isFinite(valor);
const esTexto = (valor: unknown): valor is string => typeof valor === "string" && valor.trim() !== "";
const mapa = (valor: unknown): Record<string, unknown> => (valor !== null && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {});
const numero = (valor: unknown): number | undefined => (esNumero(valor) ? valor : undefined);
const texto = (valor: unknown): string | undefined => (esTexto(valor) ? valor.trim() : undefined);
const fecha = (valor: unknown): string | undefined => (esFecha(valor) ? valor : undefined);

/**
 * Un documento `pension_plans/{id}` como plan, o `undefined` si no dice su nombre o si es plan o EPSV: sin eso no
 * se enseña, porque es lo único que esta pantalla no puede callar.
 */
export function planDeDocumento(id: string, documento: Documento): PlanDePensiones | undefined {
  const identidad = mapa(documento.identity);
  const nombre = texto(identidad.name);
  const tipo = documento.product_type === "PENSION_PLAN" || documento.product_type === "EPSV" ? documento.product_type : undefined;
  const consultado = fecha(documento.checked_at);
  if (!id || !nombre || !tipo || !consultado) return undefined;

  const ventanas = mapa(documento.trailing_return);
  const rentabilidad: PlanDePensiones["rentabilidad"] = {};
  for (const ventana of VENTANAS_DE_RENTABILIDAD) {
    const cifra = ventana === "ytd" ? numero(documento.ytd_return) : numero(ventanas[ventana]);
    if (cifra !== undefined) rentabilidad[ventana] = cifra;
  }
  const volatilidades = mapa(documento.volatility);
  const volatilidad: PlanDePensiones["volatilidad"] = {};
  for (const ventana of ["1y", "3y"] as const) {
    const cifra = numero(volatilidades[ventana]);
    if (cifra !== undefined) volatilidad[ventana] = cifra;
  }
  const a3 = (bloque: unknown) => numero(mapa(bloque)["3y"]);
  const valor = mapa(documento.nav);
  const serie = mapa(documento.series);
  const estrellas = numero(documento.star_rating);

  return {
    id,
    nombre,
    nombreLegal: texto(identidad.legal_name),
    tipo,
    empleoSimplificado: documento.modality === "SIMPLIFIED_EMPLOYMENT",
    codigoDgsfp: texto(documento.dgsfp_code),
    gestora: texto(identidad.manager_name),
    divisa: texto(identidad.currency),
    categoria: texto(documento.provider_category),
    estrellas: estrellas !== undefined && estrellas >= 1 && estrellas <= 5 ? Math.round(estrellas) : undefined,
    estrellasFecha: fecha(documento.star_rating_as_of),
    fechaInicio: fecha(documento.inception_date),
    patrimonio: numero(documento.aum),
    aportacionMinima: numero(documento.minimum_investment),
    valor: esNumero(valor.value) && esFecha(valor.date) ? { importe: valor.value, fecha: valor.date } : undefined,
    rentabilidad,
    rentabilidadFecha: fecha(documento.returns_as_of),
    volatilidad,
    sharpe: a3(documento.sharpe),
    alfa: a3(documento.provider_alpha),
    beta: a3(documento.beta),
    r2: a3(documento.r2),
    ratioDeInformacion: a3(documento.information_ratio),
    comisionDeGestion: numero(documento.management_fee),
    serie:
      esFecha(serie.first_date) && esFecha(serie.last_date) && esNumero(serie.daily_observations) && esNumero(serie.monthly_points)
        ? { desde: serie.first_date, hasta: serie.last_date, puntosDiarios: serie.daily_observations, puntosMensuales: serie.monthly_points }
        : undefined,
    consultado
  };
}

/** Un documento `pension_plans/{id}/series/monthly` como serie, o `undefined` si no trae puntos. */
export function serieDeDocumento(documento: Documento): SerieDelPlan | undefined {
  const crudos = Array.isArray(documento.points) ? documento.points : [];
  const puntos: PuntoDeLaSerie[] = [];
  for (const crudo of crudos) {
    const punto = mapa(crudo);
    if (esFecha(punto.date) && esNumero(punto.value) && punto.value > 0) puntos.push({ fecha: punto.date, valor: punto.value });
  }
  if (puntos.length === 0) return undefined;
  puntos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { desde: puntos[0].fecha, hasta: puntos[puntos.length - 1].fecha, puntos };
}

// ----------------------------------------------------------------------------------------------------------------
// Cómo se llama cada cosa
// ----------------------------------------------------------------------------------------------------------------

/** «Plan de pensiones» o «EPSV», como va en una columna. */
export function nombreDelTipo(tipo: TipoDePlan): string {
  return tipo === "EPSV" ? "EPSV" : "Plan de pensiones";
}

/** El tipo con todas sus letras, como va en la ficha. */
export function nombreLargoDelTipo(plan: Pick<PlanDePensiones, "tipo" | "empleoSimplificado">): string {
  if (plan.tipo === "EPSV") return "Entidad de previsión social voluntaria (EPSV)";
  return plan.empleoSimplificado ? "Plan de pensiones de empleo simplificado" : "Plan de pensiones";
}

export const NOMBRE_DE_LA_VENTANA: Record<VentanaDeRentabilidad, string> = {
  "1m": "1 mes",
  "6m": "6 meses",
  ytd: "En el año",
  "1y": "1 año",
  "3y": "3 años, anualizada",
  "5y": "5 años, anualizada",
  "10y": "10 años, anualizada"
};

// ----------------------------------------------------------------------------------------------------------------
// La lista y sus filtros
// ----------------------------------------------------------------------------------------------------------------

export const TODOS = "__todos__";

export interface FiltroDePlanes {
  busqueda: string;
  tipo: typeof TODOS | TipoDePlan;
  categoria: string;
  gestora: string;
}

export const FILTRO_INICIAL: FiltroDePlanes = { busqueda: "", tipo: TODOS, categoria: TODOS, gestora: TODOS };

export function hayFiltro(filtro: FiltroDePlanes): boolean {
  return filtro.busqueda.trim() !== "" || filtro.tipo !== TODOS || filtro.categoria !== TODOS || filtro.gestora !== TODOS;
}

/** Sin mayúsculas ni tildes, para buscar: «prevision» encuentra «Previsión». */
export function plegar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Todas las palabras de la búsqueda tienen que estar, en el nombre, la gestora, la categoría o el código. */
export function filtrarPlanes(planes: readonly PlanDePensiones[], filtro: FiltroDePlanes): PlanDePensiones[] {
  const palabras = plegar(filtro.busqueda).split(/\s+/).filter(Boolean);
  return planes.filter((plan) => {
    if (filtro.tipo !== TODOS && plan.tipo !== filtro.tipo) return false;
    if (filtro.categoria !== TODOS && plan.categoria !== filtro.categoria) return false;
    if (filtro.gestora !== TODOS && plan.gestora !== filtro.gestora) return false;
    if (palabras.length === 0) return true;
    const donde = plegar([plan.nombre, plan.nombreLegal, plan.gestora, plan.categoria, plan.codigoDgsfp, plan.id].filter(Boolean).join(" "));
    return palabras.every((palabra) => donde.includes(palabra));
  });
}

/** Los valores distintos de un campo, en orden alfabético, para un desplegable. */
export function valoresDe(planes: readonly PlanDePensiones[], campo: "categoria" | "gestora"): string[] {
  return [...new Set(planes.flatMap((plan) => (plan[campo] ? [plan[campo]] : [])))].sort((a, b) => a.localeCompare(b, "es"));
}

// ----------------------------------------------------------------------------------------------------------------
// Lo que cambia cómo se lee una cifra
// ----------------------------------------------------------------------------------------------------------------

/**
 * A partir de cuántos días se avisa de que una fecha va por detrás. Es un criterio de pantalla, no una medida: casi
 * todos los planes publican su valor a diario y alguna EPSV lo hace una vez al mes, así que mes y medio sin dato ya
 * no es el ritmo normal de nadie.
 */
export const DIAS_PARA_AVISAR = 45;

/** Días naturales entre dos fechas `AAAA-MM-DD`; positivo si `hasta` es posterior. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** Cuántos días lleva sin publicarse el valor, si son más de los que se toleran. */
export function diasSinValor(plan: PlanDePensiones): number | undefined {
  if (!plan.valor) return undefined;
  const dias = diasEntre(plan.valor.fecha, plan.consultado);
  return dias > DIAS_PARA_AVISAR ? dias : undefined;
}

/** Cuántos días van por detrás las rentabilidades, si son más de los que se toleran. */
export function diasDeRetrasoDeLaRentabilidad(plan: PlanDePensiones): number | undefined {
  if (!plan.rentabilidadFecha) return undefined;
  const dias = diasEntre(plan.rentabilidadFecha, plan.consultado);
  return dias > DIAS_PARA_AVISAR ? dias : undefined;
}

/** Una semana: lo que separa a dos planes que publican en días distintos. Más que eso ya no es el calendario. */
export const DIAS_ENTRE_FECHAS_COMPARABLES = 7;

/** Cierto si las rentabilidades de los planes que se comparan no son de la misma fecha, semana arriba o abajo. */
export function fechasDeRentabilidadDispares(planes: readonly PlanDePensiones[]): boolean {
  const fechas = planes.flatMap((plan) => (plan.rentabilidadFecha ? [plan.rentabilidadFecha] : [])).sort();
  return fechas.length > 1 && diasEntre(fechas[0], fechas[fechas.length - 1]) > DIAS_ENTRE_FECHAS_COMPARABLES;
}

/** Cierto si los planes no son todos de la misma categoría: su alfa, su beta y su R² no se miden contra lo mismo. */
export function categoriasDistintas(planes: readonly PlanDePensiones[]): boolean {
  return new Set(planes.map((plan) => plan.categoria ?? "")).size > 1;
}

// ----------------------------------------------------------------------------------------------------------------
// El gráfico de la ficha
// ----------------------------------------------------------------------------------------------------------------

export const PERIODOS_DEL_GRAFICO = [
  { id: "1y", nombre: "1 año", anios: 1 },
  { id: "3y", nombre: "3 años", anios: 3 },
  { id: "5y", nombre: "5 años", anios: 5 },
  { id: "10y", nombre: "10 años", anios: 10 },
  { id: "todo", nombre: "Todo", anios: null }
] as const;
export type PeriodoDelGrafico = (typeof PERIODOS_DEL_GRAFICO)[number]["id"];

/** El primer día de un periodo que acaba en `hasta`. */
function inicioDelPeriodo(hasta: string, anios: number): string {
  return `${String(Number(hasta.slice(0, 4)) - anios).padStart(4, "0")}${hasta.slice(4)}`;
}

/** Cierto si la serie tiene historia para ese periodo: empieza antes de donde el periodo empezaría. */
export function hayHistoriaPara(serie: SerieDelPlan, periodo: PeriodoDelGrafico): boolean {
  const anios = PERIODOS_DEL_GRAFICO.find((p) => p.id === periodo)?.anios ?? null;
  return anios === null || serie.desde <= inicioDelPeriodo(serie.hasta, anios);
}

/** Los puntos de un periodo. No calcula nada: elige cuáles se dibujan. */
export function puntosDelPeriodo(serie: SerieDelPlan, periodo: PeriodoDelGrafico): PuntoDeLaSerie[] {
  const anios = PERIODOS_DEL_GRAFICO.find((p) => p.id === periodo)?.anios ?? null;
  if (anios === null) return serie.puntos;
  const inicio = inicioDelPeriodo(serie.hasta, anios);
  return serie.puntos.filter((punto) => punto.fecha >= inicio);
}

// ----------------------------------------------------------------------------------------------------------------
// Por dónde va la pantalla: la lista, una ficha o una comparación
// ----------------------------------------------------------------------------------------------------------------

/** Cuántos planes caben uno junto a otro sin que la tabla deje de leerse. */
export const MAXIMO_A_COMPARAR = 4;

export type VistaDePlanes = { tipo: "lista" } | { tipo: "ficha"; id: string } | { tipo: "comparar"; ids: string[] };

const ID_DE_PLAN = /^[A-Z0-9]{10}$/;

/**
 * La vista que pide el final de una dirección: `#plan=F00000Q2PL` es una ficha y `#comparar=A,B` una comparación.
 * Va en la dirección para que el botón de atrás vuelva a la lista y para que una ficha se pueda mandar por correo.
 * Lo que no se entiende es la lista.
 */
export function vistaDeLaDireccion(hash: string): VistaDePlanes {
  const [clave, valor = ""] = hash.replace(/^#/, "").split("=", 2);
  if (clave === "plan" && ID_DE_PLAN.test(valor)) return { tipo: "ficha", id: valor };
  if (clave === "comparar") {
    const ids = [...new Set(valor.split(",").filter((id) => ID_DE_PLAN.test(id)))].slice(0, MAXIMO_A_COMPARAR);
    if (ids.length >= 2) return { tipo: "comparar", ids };
  }
  return { tipo: "lista" };
}

export function direccionDeLaVista(vista: VistaDePlanes): string {
  if (vista.tipo === "ficha") return `#plan=${vista.id}`;
  if (vista.tipo === "comparar") return `#comparar=${vista.ids.join(",")}`;
  return "";
}
