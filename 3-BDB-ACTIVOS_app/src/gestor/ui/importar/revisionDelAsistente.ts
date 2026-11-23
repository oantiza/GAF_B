/**
 * El segundo paso del asistente, sin React: qué líneas van marcadas, cómo se dice el estado
 * de cada una, cómo se agrupan los activos y qué hay que mirar. La revisión en sí la hace
 * `importacion/revision.ts`; aquí solo se decide cómo se enseña y qué se elige.
 */
import { MOTIVO_FALTA_EL_TIPO, sinClasificar, type ActivoPorResolver, type DecisionSobreUnActivo, type LineaDeRevision, type Revision } from "../../importacion/revision";
import type { ResultadoDeImportacion } from "../../importacion/tipos";
import type { TipoDeActivo } from "../../motor/modelo";

/**
 * Lo que el usuario ha cambiado a mano en las casillas, por identificador provisional de la
 * línea. Lo que no está aquí sigue a `porDefecto`, así que una decisión sobre un activo que
 * vuelve una línea lista la marca sola.
 */
export type MarcasDeLaRevision = ReadonlyMap<string, boolean>;

/** Una línea se puede importar si tiene su movimiento y el motor no le pone ningún error. */
export function seleccionable(linea: LineaDeRevision): boolean {
  return linea.movimiento !== undefined && linea.errores.length === 0;
}

export function estaMarcada(linea: LineaDeRevision, marcas: MarcasDeLaRevision): boolean {
  if (!seleccionable(linea)) return false;
  return marcas.get(linea.propuesto.movimiento.id) ?? linea.porDefecto;
}

/** Los identificadores provisionales de las líneas marcadas: lo que espera `aplicarImportacion`. */
export function elegidas(revision: Revision, marcas: MarcasDeLaRevision): Set<string> {
  return new Set(revision.lineas.filter((linea) => estaMarcada(linea, marcas)).map((linea) => linea.propuesto.movimiento.id));
}

/** Si una línea pide que el asesor la mire: no entra por defecto, o el importador o la revisión avisan de algo. */
export function hayQueMirar(linea: LineaDeRevision): boolean {
  return (!linea.porDefecto && !linea.duplicado) || linea.propuesto.requiereRevision || avisosDeLaLinea(linea).length > 0;
}

/** Los avisos de una línea: los del importador y, detrás, los de la revisión (un importe que no cuadra). */
export function avisosDeLaLinea(linea: LineaDeRevision): string[] {
  return [...linea.propuesto.avisos, ...linea.avisos];
}

export type GravedadDelEstado = "listo" | "revisar" | "duplicado" | "pendiente" | "fuera" | "error";

/** El estado de una línea: una etiqueta corta (con su palabra, no solo su color), su gravedad y, si hace falta, una frase. */
export function estadoDeLaLinea(linea: LineaDeRevision): { etiqueta: string; gravedad: GravedadDelEstado; detalle?: string } {
  if (linea.duplicado) return { etiqueta: "Ya está en el libro", gravedad: "duplicado" };
  if (linea.errores.length > 0) return { etiqueta: "Error", gravedad: "error", detalle: linea.errores[0] };
  if (!linea.movimiento) {
    return linea.motivo === "Se ha dejado fuera su activo."
      ? { etiqueta: "Fuera", gravedad: "fuera", detalle: "Se ha dejado fuera su activo." }
      : linea.motivo === MOTIVO_FALTA_EL_TIPO
        ? { etiqueta: "Falta el tipo", gravedad: "pendiente", detalle: MOTIVO_FALTA_EL_TIPO }
        : { etiqueta: "Falta el activo", gravedad: "pendiente", detalle: "Falta decir qué activo es." };
  }
  /* A-156: lo que no se ha sabido clasificar no entra solo. Marcada, entra como «Otro cargo o abono» y cuenta como resultado. */
  if (sinClasificar(linea.propuesto)) {
    return { etiqueta: "Sin clasificar", gravedad: "revisar", detalle: "No entra hasta que la marques. Si es dinero que el cliente pone o retira, cámbiale después el tipo: marcada cuenta como ganancia o pérdida." };
  }
  /* Decisión 1 de la auditoría consolidada del 22-11: un importe que no cuadra con los títulos y el precio tampoco entra solo. */
  if (linea.conDescuadre) return { etiqueta: "Revisar", gravedad: "revisar", detalle: "No entra hasta que la marques: el importe no cuadra con los títulos y el precio." };
  if (linea.propuesto.requiereRevision || linea.avisos.length > 0) return { etiqueta: "Revisar", gravedad: "revisar" };
  return { etiqueta: "Listo", gravedad: "listo" };
}

/** La clase de la etiqueta de cada gravedad. */
/** El tono del distintivo de cada estado: lo que pide la atención del asesor, en ocre; lo listo, en azul de enlace. La palabra va siempre escrita. */
export const CLASE_DE_LA_GRAVEDAD: Record<GravedadDelEstado, "marca" | "aviso" | "neutro"> = {
  listo: "marca",
  revisar: "aviso",
  duplicado: "neutro",
  pendiente: "aviso",
  fuera: "neutro",
  error: "aviso"
};

function plural(n: number, singular: string, varios: string): string {
  return `${n} ${n === 1 ? singular : varios}`;
}

/** «42 movimientos listos · 3 por revisar · 5 ya estaban en el libro». Solo las partes que no son cero, salvo la primera. */
export function resumenDeLaRevision(revision: Revision): string {
  const partes = [plural(revision.listas, "movimiento listo", "movimientos listos")];
  if (revision.porRevisar > 0) partes.push(`${revision.porRevisar} por revisar`);
  if (revision.duplicadas > 0) partes.push(`${revision.duplicadas} ${revision.duplicadas === 1 ? "ya estaba" : "ya estaban"} en el libro`);
  return partes.join(" · ");
}

/** «3 operaciones no se han importado». */
export function tituloDeLosAvisos(cuantos: number): string {
  return cuantos === 1 ? "1 operación no se ha importado" : `${cuantos} operaciones no se han importado`;
}

/** Los avisos generales de todos los resultados, con su entidad si hay más de una. */
export function avisosGenerales(resultados: readonly ResultadoDeImportacion[]): string[] {
  const variasEntidades = new Set(resultados.map((resultado) => resultado.entidad)).size > 1;
  return resultados.flatMap((resultado) => resultado.avisos.map((aviso) => (variasEntidades ? `${resultado.entidad}: ${aviso}` : aviso)));
}

/** Los errores que impiden importar un resultado, cada uno con su entidad. */
export function erroresDeLosResultados(resultados: readonly ResultadoDeImportacion[]): Array<{ entidad: string; error: string }> {
  return resultados.flatMap((resultado) => resultado.errores.map((error) => ({ entidad: resultado.entidad, error })));
}

/** Los documentos de los que vienen las líneas, para el filtro (solo si hay más de uno). */
export function documentosDeLasLineas(revision: Revision): string[] {
  return [...new Set(revision.lineas.map((linea) => linea.propuesto.documento))];
}

/** Los tipos de activo que el asesor puede elegir para uno nuevo cuyo tipo no dice el documento, en el orden en que se ofrecen. */
export const TIPOS_PARA_ELEGIR: ReadonlyArray<{ tipo: TipoDeActivo; nombre: string }> = [
  { tipo: "ACCION", nombre: "Acción" },
  { tipo: "BONO", nombre: "Bono" },
  { tipo: "ETF", nombre: "ETF" },
  { tipo: "FONDO", nombre: "Fondo" },
  { tipo: "OTRO", nombre: "Otro" }
];

/** El tipo elegido para un activo nuevo, como se dice al lado de su nombre. */
const TIPO_ELEGIDO: Record<TipoDeActivo, string> = {
  ACCION: "acción",
  BONO: "bono, con el precio en % del nominal",
  ETF: "ETF",
  FONDO: "fondo",
  OTRO: "otro"
};

/** Qué se hará con un activo que no pide decisión. */
export function queSeHara(activo: ActivoPorResolver, decision: DecisionSobreUnActivo | undefined, idsDeLaCartera: ReadonlySet<string>): string {
  if (decision === "omitir") return "Se dejan fuera sus movimientos";
  if (decision) {
    if (idsDeLaCartera.has(decision.id)) return `Ya en la cartera: ${decision.nombre}`;
    if (decision.origen === "catalogo") return `Del catálogo: ${decision.nombre}`;
    /* Si el tipo lo ha elegido el asesor, se dice cuál: de él depende cómo se lee el precio. */
    if (activo.citado.tipoSupuesto) return `Activo propio con precio a mano (${TIPO_ELEGIDO[decision.tipo]}): ${decision.nombre}`;
    return `Activo propio con precio a mano: ${decision.nombre}`;
  }
  switch (activo.estado) {
    case "en-cartera":
      return "Ya en la cartera";
    case "en-catalogo":
      return "Del catálogo";
    case "nuevo":
      return "Activo nuevo con precio a mano";
    case "falta-el-tipo":
      return MOTIVO_FALTA_EL_TIPO.replace(/\.$/, "");
    case "por-decidir":
      return "Falta decir qué activo es";
  }
}

export interface GruposDeActivos {
  /** Solo traen un nombre, o son nuevos y el documento no dice qué tipo de activo son: piden decisión. Van primero. */
  porDecidir: ActivoPorResolver[];
  /** Traen ISIN pero el catálogo no lo tiene, y hay parecidos en el catálogo: se ofrecen. */
  nuevosConSugerencias: ActivoPorResolver[];
  /** Lo demás: solo se listan. */
  resueltos: ActivoPorResolver[];
}

function pideDecision(activo: ActivoPorResolver): boolean {
  return activo.estado === "por-decidir" || activo.estado === "falta-el-tipo";
}

export function agruparActivos(activos: readonly ActivoPorResolver[]): GruposDeActivos {
  const porNombre = (a: ActivoPorResolver, b: ActivoPorResolver) => a.citado.nombre.localeCompare(b.citado.nombre, "es");
  return {
    porDecidir: activos.filter(pideDecision).sort(porNombre),
    nuevosConSugerencias: activos.filter((activo) => activo.estado === "nuevo" && activo.sugerencias.length > 0).sort(porNombre),
    resueltos: activos.filter((activo) => !pideDecision(activo) && !(activo.estado === "nuevo" && activo.sugerencias.length > 0)).sort(porNombre)
  };
}

/** Un mapa de decisiones con una cambiada (o quitada, con `undefined`). */
export function conDecision(decisiones: ReadonlyMap<string, DecisionSobreUnActivo>, clave: string, decision: DecisionSobreUnActivo | undefined): Map<string, DecisionSobreUnActivo> {
  const nuevas = new Map(decisiones);
  if (decision === undefined) nuevas.delete(clave);
  else nuevas.set(clave, decision);
  return nuevas;
}
