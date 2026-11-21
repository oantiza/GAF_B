import type { BdbAssetDetail, BdbQualityFlag } from "../types/bdbAssets";
import { bloqueadoPorCalidadDelDato, historicalSelectionRestriction, seConservaEnLaCartera } from "./assetMapping";
import { isExcludedBenchmarkIsin } from "./benchmarkProfiles";
import { fecha } from "./formato";
import { valoradoAPrecioCongelado } from "./precioCongelado";

/**
 * Qué dice el botón de añadir a cartera, y cuándo no se puede pulsar.
 *
 * Existe porque la regla estaba escrita DOS veces y las dos copias no decían lo mismo:
 * la fila de la lista antigua contemplaba `NON_INVESTABLE_CORPORATE_ACTION` —un activo
 * dado de baja por una fusión— y la de la ficha no, así que la lista decía «No disponible»
 * y la ficha del mismo activo ofrecía «Añadir a cartera». La ficha ganaba, porque es la que
 * se mira delante del cliente.
 *
 * Al montar la ficha nueva hacían falta los mismos botones en un tercer sitio, y tres
 * copias de una regla que ya discrepaba en dos no es una opción.
 */

interface ActivoParaLaAccion {
  is_investable: boolean;
  role?: string;
  /* Opcional a propósito: el tipo lo declara obligatorio y hay activos reales que
     llegan sin él. Una regla que decide si un botón se puede pulsar no puede romper la
     pantalla porque falte una lista. */
  quality_flags?: BdbQualityFlag[];
}

/**
 * Decisión 44 de Óscar (05-11-2026): no entra en una cartera algo que no se puede medir. Es lo que le pasa a un instrumento
 * cuyo símbolo nunca se resolvió —hoy, las cuotas participativas de la CAM—: no tiene precio ni métricas, y a diferencia de
 * lo que dejó de cotizar, tampoco tiene una historia que comparar. Se decide por su estado, nunca por su ISIN: el servidor lo
 * lee de la base nueva y lo manda como marca, y lo que lee la base directamente mira `availability.state`.
 */
export const NO_SE_ANADE_SIN_MEDIR = "No se añade: sin precio ni métricas.";

/** Si el activo que sirve la función es de los que nunca se resolvieron. */
export const sinPrecioNiMetricas = (activo: { quality_flags?: BdbQualityFlag[] }): boolean =>
  (activo.quality_flags ?? []).includes("NON_INVESTABLE_NEVER_RESOLVED");

/**
 * Lo que entra al importar un fichero en Diseño y al llevar a Diseño lo de Rendimiento o Posiciones: lo mismo que se conserva al guardar
 * (`seConservaEnLaCartera`, decisión 113), salvo lo que no tiene precio ni métricas, que no entra en una cartera (decisión 44). Deoleo o una clase
 * cerrada de Amundi llegan con su peso, como cuando se guardan, y no se caen como si fueran un índice.
 */
export const entraAlCargarUnaCartera = (activo: BdbAssetDetail): boolean => seConservaEnLaCartera(activo) && !sinPrecioNiMetricas(activo);

/* Dada de baja, suspendida, cerrada a nuevas suscripciones o sin resolver: se decide por su marca. Una clase cerrada de Amundi no es un benchmark (decisión 113). */
const noDisponible = (activo: ActivoParaLaAccion): boolean =>
  Boolean(historicalSelectionRestriction({ quality_flags: activo.quality_flags ?? [] }));

/**
 * Lo que se dice junto al botón de un activo con la serie de precios bloqueada por calidad (decisión 75: cotiza y se puede
 * comprar, pero el equipo no se fía de su serie). Decisión de Óscar del 14-11-2026 (ACT-01 de la auditoría del frontend):
 * **se puede añadir, y se avisa**. Antes la ficha y el Comparador decían «No se puede proponer» y no dejaban, y el Buscador,
 * que no veía la marca, lo añadía sin decir nada: tres pantallas, tres respuestas.
 *
 * El programa sigue sin proponerlo por su cuenta (optimizador, alternativas, generador) y sin medirlo: una vez en la
 * cartera queda fuera de las métricas, como ya pasaba con lo que entraba al importar un extracto.
 */
export const SIN_DATOS_FIABLES = "Sin datos fiables para medirlo";

/** El aviso que acompaña al botón de añadir, o `null` si no hay nada que avisar. Lo que no está disponible no avisa: no se añade. */
export function avisoDeAccionDeCartera(activo: ActivoParaLaAccion): string | null {
  return !noDisponible(activo) && bloqueadoPorCalidadDelDato(activo) ? SIN_DATOS_FIABLES : null;
}

/* El servidor manda «no invertible» lo que el equipo ha bloqueado por calidad del dato: eso no lo convierte en un benchmark. */
const noEsUnaPosicion = (activo: ActivoParaLaAccion): boolean =>
  activo.role === "BENCHMARK" || (!activo.is_investable && !bloqueadoPorCalidadDelDato(activo));

/*
 * Lo que se lee en el botón, en corto (Óscar, 17-11-2026): «Añadir» y «Añadido» en el Buscador, la ficha y el Comparador.
 * «Añadir a la propuesta» como botón con caja ocupaba en una fila del Buscador más que dos columnas de cifras. La frase
 * entera, la que dice adónde va, es `nombreDeAccionDeCartera`: va en el nombre accesible y en el aviso del ratón, y empieza
 * por lo que se lee (WCAG 2.5.3), así que quien lo dicta por voz lo encuentra.
 */
export function etiquetaDeAccionDeCartera(activo: ActivoParaLaAccion, enCartera: boolean): string {
  if (noDisponible(activo)) return "No disponible";
  if (noEsUnaPosicion(activo)) return "Benchmark";
  /* Lo bloqueado por calidad del dato se añade como lo demás; lo que cambia es el aviso de al lado (`avisoDeAccionDeCartera`). */
  return enCartera ? "Añadido" : "Añadir";
}

/** La frase entera de la acción: el nombre accesible del botón y su aviso del ratón. */
export function nombreDeAccionDeCartera(activo: ActivoParaLaAccion, enCartera: boolean): string {
  const etiqueta = etiquetaDeAccionDeCartera(activo, enCartera);
  /* «Propuesta» es el objeto que se diseña y se entrega (apartado 6 de SISTEMA_DISENO.md). */
  return etiqueta === "Añadir" || etiqueta === "Añadido" ? `${etiqueta} a la propuesta` : etiqueta;
}

/** `true` cuando el botón no debe poder pulsarse: ya está, no es una posición o no está disponible. */
export function accionDeCarteraBloqueada(activo: ActivoParaLaAccion, enCartera: boolean): boolean {
  return enCartera || noEsUnaPosicion(activo) || noDisponible(activo);
}

/** Lo que la base nueva dice de la cotización de un instrumento, en su documento raíz. */
export interface RaizParaLaAccion {
  availability?: { state?: unknown; since?: unknown };
}

const estadoDe = (raiz: unknown): unknown => (raiz as RaizParaLaAccion | undefined)?.availability?.state;

/** Lo mismo que `sinPrecioNiMetricas`, para un documento leído de la base nueva. */
export const nuncaResuelto = (raiz: unknown): boolean => estadoDe(raiz) === "NEVER_RESOLVED";

/**
 * La misma regla, para un instrumento leído de la base nueva. El activo que sirve la función, si ha
 * llegado, también cuenta; pero la ficha dice «Dejó de cotizar» por lo que diga esta base, y el botón
 * no puede ofrecer «Añadir» debajo de eso.
 */
export function activoParaLaAccion(
  isin: string,
  raiz: unknown,
  activo?: ActivoParaLaAccion | null
): ActivoParaLaAccion {
  /* La baja con precio congelado (hoy, NH Hotel Group) se queda dada de alta: lo decide la marca de la política, no su estado. */
  const congelado = valoradoAPrecioCongelado(isin, activo?.quality_flags ?? []);
  const deBaja = estadoDe(raiz) === "DELISTED" && !congelado;
  const sinMedir = nuncaResuelto(raiz);
  const marcas = activo?.quality_flags ?? [];
  return {
    is_investable: (activo?.is_investable ?? true) && !deBaja && !sinMedir,
    role: isExcludedBenchmarkIsin(isin) ? "BENCHMARK" : activo?.role,
    quality_flags: [
      ...marcas,
      ...(congelado && !marcas.includes("PRICE_FROZEN_DELISTED") ? (["PRICE_FROZEN_DELISTED"] as const) : []),
      ...(deBaja ? (["NON_INVESTABLE_CORPORATE_ACTION"] as const) : []),
      ...(sinMedir ? (["NON_INVESTABLE_NEVER_RESOLVED"] as const) : [])
    ]
  };
}

/**
 * Por qué no se añade un instrumento a la cartera, en palabras, o `null` si se puede.
 */
export function motivoDeNoInvertible(isin: string, nombre: string, raiz: unknown): string | null {
  if (estadoDe(raiz) === "DELISTED" && !valoradoAPrecioCongelado(isin)) {
    const since = (raiz as RaizParaLaAccion).availability?.since;
    const desde = since ? fecha(String(since)) : null;
    return `${nombre} dejó de cotizar${desde ? ` el ${desde}` : ""}: no se añade a la cartera.`;
  }
  if (nuncaResuelto(raiz)) return NO_SE_ANADE_SIN_MEDIR;
  if (isExcludedBenchmarkIsin(isin)) {
    return `${nombre} es uno de los dos fondos base de las carteras de referencia: no se añade como posición.`;
  }
  return null;
}
