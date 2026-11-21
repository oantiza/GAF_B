import type { BdbRiskProfileId } from "../types/bdbAssets";

/**
 * Nivel de perfil y horizonte de la cartera modelo (decisión 59, 09-11-2026). Lo escribe el asesor al
 * definir la cartera y viaja con ella: dos campos en la raíz del documento, `risk_profile_level` y
 * `horizon_years`, con el mismo nombre aquí, en las Functions y en la base.
 *
 * **Ausente es ausente.** No hay valor por defecto, el horizonte no se deduce del nivel ni del texto del
 * perfil («Medio plazo orientativo») y el nivel no se deduce del horizonte: la escala de años por nivel es
 * decisión abierta de Óscar. Tampoco es el perfil elegido de «Comprobar» (`perfilEnSesion`), que es
 * informativo y vive en la sesión.
 *
 * El nombre de cada nivel está en `textoDelNivelDePerfil.ts`, aparte: este fichero lo lee el marco al arrancar
 * y la escala arrastra el motor de métricas.
 *
 * Lo mismo valida las Functions en `functions_python/portfolios/repository.py`: si cambia un límite, cambia
 * en los dos sitios.
 */
export interface PerfilYHorizonte {
  /** Entero de 1 a 10, la escala de `RISK_PROFILE_CONTRACTS`. */
  risk_profile_level?: number;
  /** Años, mayor que cero. */
  horizon_years?: number;
}

export const NIVEL_DE_PERFIL_MINIMO = 1;
export const NIVEL_DE_PERFIL_MAXIMO = 10;
/** Tope de cordura, no de política: más de un siglo es un error de tecleo. */
export const HORIZONTE_MAXIMO_EN_ANOS = 100;

export const SIN_DEFINIR = "Sin definir";

/** Por qué no vale un nivel; `null` si vale o si no hay (ausente es válido). */
export function errorDelNivelDePerfil(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "number" || !Number.isInteger(valor)) {
    return "El nivel de perfil de riesgo debe ser un número entero del 1 al 10.";
  }
  if (valor < NIVEL_DE_PERFIL_MINIMO || valor > NIVEL_DE_PERFIL_MAXIMO) {
    return `El nivel de perfil de riesgo ${valor} está fuera de la escala del 1 al 10.`;
  }
  return null;
}

/** Por qué no vale un horizonte; `null` si vale o si no hay. */
export function errorDelHorizonte(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "number" || !Number.isFinite(valor)) return "El horizonte debe ser un número de años.";
  if (valor <= 0) return "El horizonte debe ser mayor que cero años.";
  if (valor > HORIZONTE_MAXIMO_EN_ANOS) return `El horizonte no puede pasar de ${HORIZONTE_MAXIMO_EN_ANOS} años.`;
  return null;
}

/**
 * Lo que se lee de un almacén que no es de fiar (el navegador): lo que no valida se queda fuera, sin
 * sustituirlo por nada.
 */
export function perfilYHorizonteDe(valor: unknown): PerfilYHorizonte {
  if (!valor || typeof valor !== "object") return {};
  const { risk_profile_level: nivel, horizon_years: horizonte } = valor as Record<string, unknown>;
  return {
    ...(typeof nivel === "number" && errorDelNivelDePerfil(nivel) === null ? { risk_profile_level: nivel } : {}),
    ...(typeof horizonte === "number" && errorDelHorizonte(horizonte) === null ? { horizon_years: horizonte } : {})
  };
}

/**
 * El perfil elegido de «Comprobar» que corresponde a un nivel guardado: el nivel 4 es `RISK_4`, la misma
 * escala de diez de `RISK_PROFILE_CONTRACTS`. `null` si no hay nivel o no vale: entonces no hay nada que
 * arrastrar, y el perfil elegido se queda como esté.
 */
export function perfilElegidoDelNivel(nivel: number | undefined): BdbRiskProfileId | null {
  if (nivel === undefined || errorDelNivelDePerfil(nivel) !== null) return null;
  return `RISK_${nivel}` as BdbRiskProfileId;
}

/**
 * El texto del campo de horizonte, en años. Vacío es «sin definir». Admite la coma decimal («2,5»).
 * Devuelve el valor o el motivo por el que no vale.
 */
export function leerHorizonte(texto: string): { valor: number | undefined } | { error: string } {
  const limpio = texto.trim().replace(",", ".");
  if (limpio === "") return { valor: undefined };
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) return { error: "El horizonte debe ser un número de años." };
  const valor = Number(limpio);
  const error = errorDelHorizonte(valor);
  return error ? { error } : { valor };
}

/* Se queda: devuelve al campo la cifra que escribió el asesor («2,5»), con los decimales que tecleó, y el módulo único
   no tiene un número de decimales variables. Es el eco de lo escrito, no una cifra calculada. */
const formatoDeAnos = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

/** «5 años», «1 año», «2,5 años»; «Sin definir» si no hay. */
export function textoDelHorizonte(horizonte: number | undefined): string {
  if (horizonte === undefined) return SIN_DEFINIR;
  return `${formatoDeAnos.format(horizonte)} ${horizonte === 1 ? "año" : "años"}`;
}

/** El número del campo, sin unidad: «2,5». */
export function cifraDelHorizonte(horizonte: number | undefined): string {
  return horizonte === undefined ? "" : formatoDeAnos.format(horizonte);
}
