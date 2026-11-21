import { FIREBASE_CONFIGURED } from "../firebaseEnv";
import { useAdminClaim } from "./useIsAdmin";

/**
 * B4 / R-07 (auditoría 29-09): `commercial_retro` solo es legible por admin
 * (firestore.rules). Con una cuenta sin claim, cada consulta terminaba en
 * «Missing or insufficient permissions» en Constructor, Cambio de fondo,
 * Comparador y Posiciones (y bloqueaba las exportaciones). Este gate decide
 * si se puede consultar la base comercial:
 *  - "granted": admin confirmado, o sin Firebase (no hay reglas; el store
 *    devuelve vacío sin tocar la red).
 *  - "pending": el claim aún no se ha leído; no se consulta todavía.
 *  - "denied": cuenta sin claim; no se consulta y se muestra «sin dato».
 * Solo decide qué se consulta desde la UI: las reglas siguen mandando.
 */
export type CommercialRetroAccess = "granted" | "pending" | "denied";

export function useCommercialRetroAccess(): CommercialRetroAccess {
  const { isAdmin, resolved } = useAdminClaim();
  if (!FIREBASE_CONFIGURED) return "granted";
  if (!resolved) return "pending";
  return isAdmin ? "granted" : "denied";
}
