/**
 * Con qué se compara una cartera: la lista de referencias que se pueden elegir, qué es cada una
 * dicho en llano, y la serie de cada una para un periodo. Cálculo puro: no lee nada.
 *
 * **La codificación.** El fichero de cartera guarda la referencia como `{ activoId, nombre }`
 * (`almacen/formato.ts`) y ese formato no cambia. La elección va en `activoId`:
 *
 *   - `perfil:<id>`  una de las cinco carteras de referencia de la aplicación (`core/benchmarkProfiles.ts`),
 *                    p. ej. `perfil:equilibrado`;
 *   - `tipo:ESTR`    la liquidez: el €STR del BCE capitalizado;
 *   - un ISIN        un activo del catálogo, tal cual (los tres índices de la lista lo son).
 *
 * Ningún ISIN lleva dos puntos, así que los prefijos no se confunden con un activo.
 *
 * **La regla de las carteras de referencia** (decisión 39 de Óscar, 05-11-2026): los pesos se fijan
 * el primer día de la ventana que se compara y se dejan derivar. Por eso su serie no se calcula una
 * vez y se corta: se construye para cada periodo, desde su primer día (`serieDeLaReferencia`).
 */
import {
  BASE_RENTA_FIJA_ISIN,
  BASE_RENTA_VARIABLE_ISIN,
  BENCHMARK_PROFILES,
  benchmarkById,
  composicionDeLaReferencia,
  mezclaDeReferencia,
  type BenchmarkProfile,
  type PesosDeLaMezcla
} from "../../core/benchmarkProfiles";
import { diasEntre, type Dia } from "./fechas";
import type { ReferenciaDeCartera } from "./modelo";
import type { Punto } from "./valoracion";

const PREFIJO_DE_PERFIL = "perfil:";
const PREFIJO_DE_TIPO = "tipo:";
export const CODIGO_DE_LA_LIQUIDEZ = "tipo:ESTR";

export type ClaseDeReferencia =
  | { clase: "perfil"; perfil: BenchmarkProfile }
  | { clase: "liquidez" }
  | { clase: "activo"; isin: string }
  /** Un código con prefijo reservado que esta versión no conoce: no se compara y se dice. */
  | { clase: "desconocida"; codigo: string };

export function claseDeLaReferencia(referencia: Pick<ReferenciaDeCartera, "activoId">): ClaseDeReferencia {
  const codigo = referencia.activoId;
  if (codigo.startsWith(PREFIJO_DE_PERFIL)) {
    const perfil = benchmarkById(codigo.slice(PREFIJO_DE_PERFIL.length));
    return perfil ? { clase: "perfil", perfil } : { clase: "desconocida", codigo };
  }
  if (codigo === CODIGO_DE_LA_LIQUIDEZ) return { clase: "liquidez" };
  if (codigo.startsWith(PREFIJO_DE_TIPO)) return { clase: "desconocida", codigo };
  return { clase: "activo", isin: codigo };
}

// --- La lista ---

export type GrupoDeReferencia = "perfiles" | "indices" | "liquidez";

export interface OpcionDeReferencia {
  /** Lo que se guarda en `activoId`. */
  codigo: string;
  /** El rótulo corto de la lista. */
  rotulo: string;
  /** El nombre que se guarda y que lleva la leyenda del gráfico. */
  nombre: string;
}

/** Los índices con los que comparaba el «Análisis rápido de extractos», retirado el 14-11-2026 (su `BENCHMARK_IDS`). */
export const INDICES_DE_REFERENCIA: ReadonlyArray<OpcionDeReferencia & { queMide: string }> = [
  { codigo: "IE00B6R52259", rotulo: "MSCI ACWI", nombre: "MSCI ACWI", queMide: "Bolsa mundial, países desarrollados y emergentes" },
  { codigo: "ES0105336038", rotulo: "IBEX 35 con dividendos", nombre: "IBEX 35 con dividendos", queMide: "Bolsa española, con los dividendos reinvertidos" },
  { codigo: "IE00BDBRDM35", rotulo: "Renta fija global", nombre: "Renta fija global", queMide: "Bonos de todo el mundo, de gobiernos y de empresas, con la divisa cubierta a euros" }
];

const LIQUIDEZ: OpcionDeReferencia = { codigo: CODIGO_DE_LA_LIQUIDEZ, rotulo: "Liquidez (€STR capitalizado)", nombre: "Liquidez (€STR)" };

function nombreDelPerfil(perfil: BenchmarkProfile): string {
  return `Cartera de referencia ${perfil.name}`;
}

export const OPCIONES_DE_REFERENCIA: ReadonlyArray<{ grupo: GrupoDeReferencia; titulo: string; opciones: readonly OpcionDeReferencia[] }> = [
  {
    grupo: "perfiles",
    titulo: "Carteras de referencia",
    opciones: BENCHMARK_PROFILES.map((perfil) => ({ codigo: `${PREFIJO_DE_PERFIL}${perfil.id}`, rotulo: perfil.name, nombre: nombreDelPerfil(perfil) }))
  },
  { grupo: "indices", titulo: "Índices", opciones: INDICES_DE_REFERENCIA.map(({ codigo, rotulo, nombre }) => ({ codigo, rotulo, nombre })) },
  { grupo: "liquidez", titulo: "Liquidez", opciones: [LIQUIDEZ] }
];

/** La opción de la lista con ese código, si lo es. Un activo que no es uno de los tres índices no está en la lista. */
export function opcionDeLaLista(codigo: string): OpcionDeReferencia | undefined {
  for (const grupo of OPCIONES_DE_REFERENCIA) {
    const opcion = grupo.opciones.find((candidata) => candidata.codigo === codigo);
    if (opcion) return opcion;
  }
  return undefined;
}

/** La referencia que se guarda al elegir una opción de la lista. */
export function referenciaDeLaOpcion(opcion: OpcionDeReferencia): ReferenciaDeCartera {
  return { activoId: opcion.codigo, nombre: opcion.nombre };
}

/** El nombre de la referencia: el de la lista si es de la lista (no el guardado, que pudo quedarse viejo); si no, el guardado. */
export function nombreDeLaReferencia(referencia: ReferenciaDeCartera): string {
  return opcionDeLaLista(referencia.activoId)?.nombre ?? referencia.nombre;
}

/**
 * Qué es la referencia, en una frase llana. `nombreDelFondo` es el de la tarjeta del activo, cuando
 * se tiene a mano (en pantalla, del catálogo): sin él se dice el ISIN.
 */
export function descripcionDeLaReferencia(referencia: ReferenciaDeCartera, nombreDelFondo?: string): string {
  const clase = claseDeLaReferencia(referencia);
  switch (clase.clase) {
    case "perfil":
      return `${composicionDeLaReferencia(clase.perfil)}.`;
    case "liquidez":
      return "El €STR del BCE, el tipo de interés a un día entre bancos de la zona euro, capitalizado cada día: lo que habría rendido el dinero en liquidez a ese tipo.";
    case "desconocida":
      return `Esta versión de la aplicación no reconoce la referencia guardada (${clase.codigo}).`;
    case "activo": {
      const indice = INDICES_DE_REFERENCIA.find((candidato) => candidato.codigo === clase.isin);
      const fondo = nombreDelFondo ? `${nombreDelFondo} (${clase.isin})` : clase.isin;
      if (indice) return `${indice.queMide}. Se sigue con un fondo cotizado que lo replica, ${fondo}, en la divisa de la cartera.`;
      return `Un activo del catálogo, ${fondo}, en la divisa de la cartera.`;
    }
  }
}

/** Lo que el informe añade de una cartera de referencia: cómo se fijan sus pesos. Nada para las demás. */
export function notaDeLosPesos(referencia: ReferenciaDeCartera): string | null {
  const clase = claseDeLaReferencia(referencia);
  if (clase.clase !== "perfil") return null;
  const { rf, rv } = clase.perfil.weights;
  if (rf === 0 || rv === 0) return null;
  return "Sus pesos se fijan el primer día del periodo y se dejan derivar: no se reequilibran.";
}

// --- La serie para un periodo ---

/** Lo que trae la carga de mercado para comparar, antes de saber el periodo. */
export type EntradaDeReferencia =
  /** Un activo (y la referencia sintética de la demostración): su serie, ya en la divisa base. */
  | { nombre: string; serie: Punto[] }
  /** La liquidez: las tasas del €STR (anuales, en fracción, una por día hábil publicado). */
  | { nombre: string; estr: Punto[] }
  /** Una cartera de referencia: las series de sus dos fondos, ya en la divisa base, y sus pesos. */
  | { nombre: string; base: { rf: Punto[]; rv: Punto[] }; pesos: PesosDeLaMezcla }
  /** No se puede comparar, y por qué. */
  | { nombre: string; motivo: string };

export type SerieDeLaReferencia = { nombre: string; serie: Punto[] } | { nombre: string; motivo: string };

/** Días naturales que pueden separar dos publicaciones del €STR: el cierre TARGET más largo (Semana Santa) es de 5. */
export const HUECO_MAXIMO_DEL_ESTR = 7;
/** Lo atrasado que puede llegar el último €STR frente al final del periodo. */
export const RETRASO_MAXIMO_DEL_ESTR = 7;
const BASE_DEL_ESTR = 360;

function fechaEnLlano(dia: Dia): string {
  return `${dia.slice(8, 10)}-${dia.slice(5, 7)}-${dia.slice(0, 4)}`;
}

/**
 * El índice del €STR capitalizado desde `desde`, con la convención del €STR y la misma que
 * `functions_python/portfolio_real/estr_index.py` (en la etiqueta de Git `referencia-portfolio-real-2026-11-17`):
 *
 *   I(d0) = 100 el último día publicado en o antes de `desde`;
 *   I(d)  = I(d_prev) × (1 + r(d_prev) × n / 360), con n los días naturales entre d_prev y d.
 *
 * Del viernes al lunes, n = 3 con el tipo del viernes. Nada se inventa: sin dato en o antes de
 * `desde`, con un hueco de más de 7 días o con la serie atrasada más de 7 días frente a `hasta`,
 * no hay índice y se dice por qué.
 */
export function indiceDelEstr(tasas: readonly Punto[], desde: Dia, hasta: Dia): { serie: Punto[] } | { motivo: string } {
  const limpias = [...new Map(tasas.filter((punto) => Number.isFinite(punto.valor)).map((punto) => [punto.fecha, punto.valor])).entries()]
    .map(([fecha, valor]) => ({ fecha, valor }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  if (limpias.length === 0) return { motivo: "La plataforma no tiene el €STR: no se puede construir la liquidez." };
  let primero = -1;
  for (let i = 0; i < limpias.length && limpias[i].fecha <= desde; i += 1) primero = i;
  if (primero < 0) return { motivo: `El €STR de la plataforma empieza el ${fechaEnLlano(limpias[0].fecha)}, después del inicio del periodo: antes de su primer dato la liquidez no se inventa.` };
  let nivel = 100;
  let previo = limpias[primero];
  const serie: Punto[] = [{ fecha: previo.fecha, valor: nivel }];
  for (const punto of limpias.slice(primero + 1)) {
    if (punto.fecha > hasta) break;
    const dias = diasEntre(previo.fecha, punto.fecha);
    if (dias > HUECO_MAXIMO_DEL_ESTR) {
      return { motivo: `Al €STR de la plataforma le faltan los datos entre el ${fechaEnLlano(previo.fecha)} y el ${fechaEnLlano(punto.fecha)}: la liquidez no se puede construir en este periodo.` };
    }
    nivel *= 1 + (previo.valor * dias) / BASE_DEL_ESTR;
    serie.push({ fecha: punto.fecha, valor: nivel });
    previo = punto;
  }
  if (diasEntre(previo.fecha, hasta) > RETRASO_MAXIMO_DEL_ESTR) {
    return { motivo: `El €STR de la plataforma llega hasta el ${fechaEnLlano(previo.fecha)}: está atrasado para este periodo.` };
  }
  if (serie.length < 2) return { motivo: "El €STR de la plataforma no tiene datos dentro del periodo." };
  return { serie };
}

/**
 * La mezcla de una cartera de referencia desde `desde`, con base 100 ese día y sus pesos fijados ahí
 * (`mezclaDeReferencia`, la misma que usan las demás pantallas). Si sus fondos no tienen dato ese día
 * (o en los 14 anteriores), no se arranca más tarde: no hay comparación y se dice.
 */
function serieDelPerfil(base: { rf: Punto[]; rv: Punto[] }, pesos: PesosDeLaMezcla, desde: Dia): { serie: Punto[] } | { motivo: string } {
  const aFechas = (puntos: Punto[]) => puntos.map((punto) => ({ date: punto.fecha, value: punto.valor }));
  const mezcla = mezclaDeReferencia(aFechas(base.rf), aFechas(base.rv), pesos, desde);
  if (mezcla.length === 0 || mezcla[0].date !== desde) {
    return { motivo: `Los dos fondos de la cartera de referencia no tienen datos desde el inicio del periodo (${fechaEnLlano(desde)}).` };
  }
  return { serie: mezcla.map((punto) => ({ fecha: punto.date, valor: punto.value })) };
}

/**
 * La referencia lista para `analizar` en un periodo que empieza en `desde` (el primer día de la
 * comparación, con base 100) y acaba en `hasta`. Un activo vale tal cual; la liquidez y las
 * carteras de referencia se construyen desde ese día.
 */
export function serieDeLaReferencia(entrada: EntradaDeReferencia, desde: Dia, hasta: Dia): SerieDeLaReferencia {
  const { nombre } = entrada;
  if ("motivo" in entrada) return { nombre, motivo: entrada.motivo };
  if ("serie" in entrada) return { nombre, serie: entrada.serie };
  const resultado = "estr" in entrada ? indiceDelEstr(entrada.estr, desde, hasta) : serieDelPerfil(entrada.base, entrada.pesos, desde);
  return "serie" in resultado ? { nombre, serie: resultado.serie } : { nombre, motivo: resultado.motivo };
}

/** Los dos fondos de una cartera de referencia, para pedir sus series. */
export const FONDOS_DE_LOS_PERFILES = { rf: BASE_RENTA_FIJA_ISIN, rv: BASE_RENTA_VARIABLE_ISIN } as const;
