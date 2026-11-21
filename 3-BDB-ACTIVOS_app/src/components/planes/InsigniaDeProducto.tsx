import { nombreDelTipo, type PlanDePensiones } from "../../core/planes/modelo";
import { Distintivo } from "../ui/Distintivo";

/**
 * «Plan de pensiones» o «EPSV», junto al nombre de un plan. Es lo que esta pantalla no puede callar: no tributan
 * igual. Lo dice la palabra; el tono de la EPSV (el azul de enlace de la marca) solo ayuda a verla en una lista larga, como antes
 * del rediseño. Ninguno de los dos es «el bueno»: por eso no hay verde ni rojo, y el plan de pensiones va en gris.
 * Recuperado el 14-11-2026 (Óscar: «le faltan colores en general»; G15 del inventario).
 */
export function InsigniaDeProducto({ plan }: { plan: Pick<PlanDePensiones, "tipo"> }) {
  return <Distintivo tono={plan.tipo === "EPSV" ? "marca" : "neutro"}>{nombreDelTipo(plan.tipo)}</Distintivo>;
}
