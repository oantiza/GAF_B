/**
 * Ayudas puras de Sistema › Operaciones: ISIN pegados, etiquetas legibles de
 * lo que devuelve el servicio local y la interpretación del valor tecleado en
 * una corrección (el servicio acomoda el tipo al del dato existente; aquí se
 * evita mandar «4» como texto cuando el usuario quiso decir el número 4).
 */
import type { OpsAltaSituacion, OpsModoPlataforma, OpsTipoActivo } from "../types/opsLocal";
import { numero, oFalta, titulos } from "./formato";
import { textoDeAusencia } from "./textoDeAusencia";

const ISIN_SUELTO = /\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b/g;

/** ISIN únicos, en mayúsculas y en el orden en que aparecen. */
export function extractIsins(text: string): string[] {
  const out: string[] = [];
  for (const match of (text || "").toUpperCase().matchAll(ISIN_SUELTO)) {
    if (!out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

export type OpsCorrectionValue = string | number | boolean | null;

/** «null» borra, «true»/«false» son booleanos, «3,5» es un número; lo demás, texto. */
export function interpretCorrectionValue(text: string): OpsCorrectionValue {
  const t = (text ?? "").trim();
  const low = t.toLowerCase();
  if (t === "" || low === "null" || low === "nulo") return null;
  if (low === "true" || low === "verdadero" || low === "sí" || low === "si") return true;
  if (low === "false" || low === "falso" || low === "no") return false;
  if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
  if (/^-?\d+([.,]\d+)?$/.test(t)) return Number.parseFloat(t.replace(",", "."));
  return t;
}

export function formatCorrectionValue(value: unknown): string {
  if (value === null || value === undefined) return textoDeAusencia("falta");
  if (typeof value === "boolean") return value ? "Sí" : "No";
  /* Un valor de la base, con los decimales que tenga, hasta seis y sin ceros de relleno: los de `titulos`. */
  if (typeof value === "number") return oFalta(titulos(value));
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export const OPS_TIPO_LABELS: Record<OpsTipoActivo | "indice", string> = {
  fondo: "Fondo",
  etf: "ETF",
  accion: "Acción",
  indice: "Índice"
};

export function tipoLabel(tipo: string | null | undefined): string {
  if (!tipo) return "Sin tipo";
  return (OPS_TIPO_LABELS as Record<string, string>)[tipo] ?? tipo;
}

export const OPS_SITUACION_LABELS: Record<OpsAltaSituacion, string> = {
  nuevo: "Nuevo en el universo",
  ya_estaba: "Ya estaba",
  invalido: "ISIN no válido"
};

export const OPS_MODO_LABELS: Record<OpsModoPlataforma, string> = {
  alta: "Alta (activos que aún no están en la maestra)",
  republish: "Republicar (activos que ya están en la maestra)"
};

/** Acciones del plan de la plataforma, en el idioma de la pantalla. */
const PLAN_ACTION_LABELS: Record<string, string> = {
  CREATE: "Crear",
  SKIP_EXISTS: "Ya existe",
  REVIEW_HOLD: "Retenido para revisión",
  BLOCKED_REJECTED: "Rechazado",
  REEXPORT_REQUIRED: "Hay que reexportar",
  INVALID_CONTRACT: "Contrato no válido",
  SIN_PLAN: "Sin plan",
  REPUBLICAR: "Republicar",
  RETENIDA: "Retenida, no se escribe",
  REVISION: "En revisión, no se escribe",
  SIN_CAMBIOS: "Sin cambios",
  ARCHIVE: "Archivar",
  MISSING: "No está en la maestra",
  RECLASSIFY: "Reclasificar",
  REPAIR: "Reparar",
  SKIP: "Se omite",
  ERROR: "Error"
};

export function planActionLabel(action: string): string {
  return PLAN_ACTION_LABELS[action] ?? action.replace(/_/g, " ").toLowerCase();
}

/** Las acciones del plan que suponen escribir en la maestra. */
export function planActionWrites(action: string): boolean {
  return action === "CREATE" || action === "REPUBLICAR" || action === "ARCHIVE" || action === "RECLASSIFY" || action === "REPAIR";
}

/** Errores de la plataforma, en el idioma de la pantalla; el texto original se pliega como detalle técnico. */
const OPS_ERRORES: Array<[RegExp, string]> = [
  [/CONCURRENT_MODIFICATION/, "El documento cambió mientras se escribía: no se escribió nada. Repite la pasada en seco."],
  [/PRECONDITION_MISSING|FAILED_PRECONDITION/, "La maestra no permitió escribir con seguridad: no se escribió nada. Repite la pasada en seco."],
  [/UNSAFE_FIELD/, "La ficha tiene un campo que no se puede reescribir con seguridad."],
  [/no valida master\.asset-stock|asset-stock/, "La ficha de acción no cumple el contrato de la maestra."],
  [/metrics\/latest.*no valida|no valida metrics|masterMetrics/, "El documento de métricas no cumple el contrato de la maestra."],
  [/search_index|search-index/, "No se pudo actualizar el buscador de la maestra."],
  [/^contract:|contrato|no valida/, "Un documento no cumple el contrato de la maestra: no se escribió ese activo."],
  [/postverify/i, "La comprobación posterior no encontró lo escrito como se esperaba."],
  [/ALREADY_EXISTS/, "El documento ya existía: no se sobrescribió."],
  [/PERMISSION_DENIED|permission/i, "La plataforma no tiene permiso para escribir en la maestra."]
];

export interface OpsErrorLegible {
  /** ISIN o ruta a la que se refiere, si la plataforma la da. */
  donde: string | null;
  mensaje: string;
  /** Texto original de la plataforma, para el detalle técnico plegado. */
  detalle: string;
}

/** Un error de la plataforma ({asset_id|path, error} o texto) en español, con el original aparte. */
export function describeOpsError(error: unknown): OpsErrorLegible {
  let donde: string | null = null;
  let detalle = "";
  if (typeof error === "string") {
    detalle = error;
  } else if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    donde = typeof e.asset_id === "string" ? e.asset_id : typeof e.path === "string" ? e.path : null;
    detalle = typeof e.error === "string" ? e.error : typeof e.message === "string" ? e.message : JSON.stringify(error);
  } else if (error !== null && error !== undefined) {
    detalle = String(error);
  }
  const conocido = OPS_ERRORES.find(([patron]) => patron.test(detalle));
  return { donde, mensaje: conocido ? conocido[1] : "La plataforma devolvió un error.", detalle };
}

/**
 * Documentos de una alta en el idioma de la pantalla: «Ficha · Cartera · Métricas iniciales». Una cartera
 * troceada cuenta una vez, con sus partes.
 */
export function documentosLabel(paths: string[] | undefined): string {
  if (!paths || paths.length === 0) return "";
  const out: string[] = [];
  const trozos = paths.filter((p) => /\/holdings\/chunks\//.test(p)).length;
  if (paths.some((p) => /^assets\/[^/]+$/.test(p))) out.push("Ficha");
  if (paths.some((p) => /\/holdings\/(latest|manifest)$/.test(p))) out.push(trozos > 0 ? `Cartera (${trozos} partes)` : "Cartera");
  if (paths.some((p) => p.endsWith("/metrics/latest"))) out.push("Métricas iniciales");
  return out.join(" · ");
}

const METRICAS_RECLASIFICACION: Record<string, string> = {
  MARK: "Se invalidan hasta que la app las recalcule como acción",
  CREATE_MARKER: "No había: se crean para que la app las calcule"
};

const INDICE_RECLASIFICACION: Record<string, string> = {
  ADD: "Se añade como acción",
  UPDATE: "Pasa a acción",
  SAME: "Sin cambios"
};

/** Bloques de la ficha de un fondo que una acción no lleva, en el idioma de la pantalla. */
const BLOQUES_FICHA: Record<string, string> = {
  costs: "costes",
  fixed_income_profile: "perfil de renta fija",
  holdings_summary: "resumen de cartera",
  sustainability: "sostenibilidad",
  regulatory: "datos regulatorios",
  retrocession: "datos comerciales",
  portfolio_exposure: "exposición de la cartera",
  classification: "clasificación",
  product: "producto",
  fundamentals: "fundamentales",
  performance: "rentabilidad",
  risk: "riesgo",
  provenance: "procedencia"
};

/** Qué cambia una reclasificación en la maestra, en una línea. */
export function reclasificacionCambios(fila: { quita: string[]; metricas: string | null; indice: string | null }): string {
  const partes: string[] = [];
  if (fila.quita.length > 0) partes.push(`Se quitan ${fila.quita.map((k) => BLOQUES_FICHA[k] ?? k.replace(/_/g, " ")).join(", ")}`);
  if (fila.metricas) partes.push(`Métricas: ${(METRICAS_RECLASIFICACION[fila.metricas] ?? fila.metricas).toLowerCase()}`);
  if (fila.indice) partes.push(`Buscador: ${(INDICE_RECLASIFICACION[fila.indice] ?? fila.indice).toLowerCase()}`);
  return partes.join(" · ");
}

/** Etiqueta de procedencia (`kid_gestora:dws`, `manual:oscar`) legible. */
export function fuenteLabel(fuente: string | null | undefined): string {
  /* Lo que falta se dice con su palabra, no con una raya (FMT-08). */
  if (!fuente) return textoDeAusencia("falta");
  const [source, detail] = fuente.split(":", 2);
  const names: Record<string, string> = {
    manual: "Corrección manual",
    kid_gestora: "KID de la gestora",
    cnmv: "CNMV",
    cnmv_ficha: "CNMV (ficha)",
    cssf: "CSSF",
    esma: "ESMA",
    amf_geco: "AMF",
    gleif: "GLEIF",
    morningstar_lt: "Morningstar",
    morningstar: "Morningstar",
    eodhd: "EODHD",
    justetf: "justETF",
    gestoras: "Web de la gestora",
    config_csv: "Universo (fondos.csv)",
    derivado: "Calculado"
  };
  const name = names[source] ?? source;
  return detail ? `${name} · ${detail}` : name;
}

export function horasLabel(horas: number | null | undefined): string {
  if (typeof horas !== "number" || !Number.isFinite(horas)) return textoDeAusencia("falta");
  if (horas < 1) return `${Math.round(horas * 60)}\u00a0min`;
  /* Con un decimal solo si lo tiene al redondear a décimas: «27,9 h», «3 h». */
  const decimales = Math.round(horas * 10) % 10 === 0 ? 0 : 1;
  return `${oFalta(numero(horas, { decimales }))}\u00a0h`;
}

/** Modo sugerido para la plataforma: alta si algo es nuevo en el universo; si no, republicar. */
export function suggestModo(situaciones: OpsAltaSituacion[]): OpsModoPlataforma {
  return situaciones.some((s) => s === "nuevo") ? "alta" : "republish";
}
