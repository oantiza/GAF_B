import { CLASS_LABELS, readableBackendLabel } from "./labels";
import type { BdbAssetDetail } from "../types/bdbAssets";
import type { PortfolioRiskContribution } from "../types/portfolioFrontier";

/**
 * Lo que aporta al riesgo cada clase de activo (AN1, aprobada por Óscar el 21-11-2026): la suma de lo que aportan sus posiciones.
 *
 * **Por qué se puede sumar.** La cifra de cada posición la calcula el servidor (`risk_contributions`, en
 * `functions_python/optimization/risk_analytics.py`) y es la contribución de Euler a la volatilidad:
 *
 *     RC_i = w_i · (Σ w)_i / σ_p,   con σ_p = √(wᵀ Σ w)
 *
 * donde w son los pesos de la parte medida (renormalizados a 1 entre los activos con serie) y Σ la covarianza de sus
 * rentabilidades semanales en el periodo, con el estimador del motor (Ledoit-Wolf u OAS). Como σ_p es homogénea de grado 1
 * en w, Σ_i RC_i = wᵀ Σ w / σ_p = σ_p: las aportaciones reparten la volatilidad entera, sin resto. El servidor las manda en
 * tanto por ciento, `risk_pct = 100 · RC_i / Σ RC`, que suman 100. Así que la de una clase es la suma de las de sus
 * posiciones, y las de todas las clases vuelven a sumar 100. No es la volatilidad de cada activo por su peso: esa no suma la
 * de la cartera, porque ignora las correlaciones.
 *
 * **Con qué peso se compara.** Con el de la misma parte medida (`weight_pct`, que también suma 100), no con el de toda la
 * cartera: si una parte del peso queda fuera de la serie, comparar el peso de todo con el riesgo de una parte exageraría
 * la diferencia. Con toda la cartera medida, los dos pesos coinciden.
 *
 * **La clase es la del reparto de la pantalla:** `economic_asset_class` de cada posición, entera. Un fondo mixto cuenta
 * como «Mixto» y no se reparte por su composición, porque su aportación sale de la serie del fondo y no de la de sus
 * partes. La posición sin clase (`UNKNOWN`, o sin ficha) va a «Sin clasificar», y la pantalla lo dice.
 *
 * Solo tanto por ciento: la volatilidad que la pantalla enseña es la de la serie simulada, y la de esta cuenta es la de la
 * covarianza estimada. Multiplicar una por el reparto de la otra mezclaría dos estimadores (§3 del método).
 */

export const CLAVE_SIN_CLASIFICAR = "SIN_CLASIFICAR";

export interface RiesgoDeUnaClase {
  /** La clave de la clase (`EQUITY`, `FIXED_INCOME`…), o `CLAVE_SIN_CLASIFICAR`. */
  clave: string;
  rotulo: string;
  /** El peso de la clase en la parte medida, de 0 a 100. */
  pesoPct: number;
  /** Lo que aporta a la volatilidad de la cartera, de la parte medida, en tanto por ciento. Negativo: la reduce. */
  riesgoPct: number;
  posiciones: number;
}

/**
 * Una clase que no se sabe: sin clave, `UNKNOWN` o la de «Sin clasificar». «Otros» (`OTHER`) sí es una clase —el oro, las materias
 * primas— y no entra aquí (A-202, Óscar, 21-11-2026). La misma regla en «Riesgo por clase de activo» y en «En qué está invertida».
 */
export function esSinClasificar(clave: string | null | undefined): boolean {
  const limpia = typeof clave === "string" ? clave.trim().toUpperCase() : "";
  return !limpia || limpia === "UNKNOWN" || limpia === CLAVE_SIN_CLASIFICAR;
}

function claveDeLaClase(activo: BdbAssetDetail | undefined): string {
  const clave = typeof activo?.economic_asset_class === "string" ? activo.economic_asset_class.trim().toUpperCase() : "";
  return esSinClasificar(clave) ? CLAVE_SIN_CLASIFICAR : clave;
}

/**
 * Las aportaciones de cada posición, sumadas por clase. Ordenadas por lo que aportan, de más a menos, con «Sin clasificar»
 * al final. Sin aportaciones (aún midiendo, volatilidad nula o sin serie), `null`: no hay reparto que enseñar.
 */
export function riesgoPorClase(
  aportaciones: readonly PortfolioRiskContribution[] | null | undefined,
  activos: readonly BdbAssetDetail[]
): RiesgoDeUnaClase[] | null {
  const validas = (aportaciones ?? []).filter((fila) => Number.isFinite(fila.risk_pct) && Number.isFinite(fila.weight_pct));
  if (validas.length === 0) return null;
  const porId = new Map(activos.map((activo) => [activo.asset_id, activo]));
  const clases = new Map<string, RiesgoDeUnaClase>();
  for (const fila of validas) {
    const clave = claveDeLaClase(porId.get(fila.asset_id));
    const clase =
      clases.get(clave) ??
      {
        clave,
        rotulo: clave === CLAVE_SIN_CLASIFICAR ? "Sin clasificar" : CLASS_LABELS[clave] ?? readableBackendLabel(clave),
        pesoPct: 0,
        riesgoPct: 0,
        posiciones: 0
      };
    clase.pesoPct += fila.weight_pct;
    clase.riesgoPct += fila.risk_pct;
    clase.posiciones += 1;
    clases.set(clave, clase);
  }
  const sinClasificar = (clase: RiesgoDeUnaClase) => clase.clave === CLAVE_SIN_CLASIFICAR;
  return [...clases.values()].sort(
    (a, b) => Number(sinClasificar(a)) - Number(sinClasificar(b)) || b.riesgoPct - a.riesgoPct || a.rotulo.localeCompare(b.rotulo, "es")
  );
}
