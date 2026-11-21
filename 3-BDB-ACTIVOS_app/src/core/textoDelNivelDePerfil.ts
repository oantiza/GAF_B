import { SIN_DEFINIR } from "./perfilYHorizonte";
import { RISK_PROFILE_CONTRACTS } from "./riskProfilePreview";

/** El nombre corto del nivel en la escala de diez de la app: «Equilibrado» para el 5. */
export function nombreDelNivel(nivel: number): string | undefined {
  const etiqueta = RISK_PROFILE_CONTRACTS.find((perfil) => perfil.level === nivel)?.risk_profile_label;
  return etiqueta?.replace(/^Nivel \d+ - /, "");
}

/** «5 · Equilibrado»; «Sin definir» si no hay (decisión 59). */
export function textoDelNivel(nivel: number | undefined): string {
  if (nivel === undefined) return SIN_DEFINIR;
  const nombre = nombreDelNivel(nivel);
  return nombre ? `${nivel} · ${nombre}` : String(nivel);
}
