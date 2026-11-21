import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { assetPmsShares } from "./portfolio";

/**
 * Una cifra de la renta fija de la cartera: la media ponderada de lo que declaran las posiciones.
 *
 * `valor` es sobre la parte que la declara, no sobre toda la renta fija: lo que no se declara no se rellena ni cuenta
 * como cero. Por eso va siempre con su cobertura, y sin ninguna posición que la declare no hay cifra.
 */
export interface CifraDeRentaFija {
  valor: number | null;
  /** Qué parte de la renta fija de la cartera la declara, de 0 a 100. */
  cobertura: number;
}

export interface PerfilDeRentaFija {
  /** Qué parte de la cartera es renta fija, de 0 a 100. */
  pesoEnLaCartera: number;
  /** En tanto por uno de la cartera de bonos. No tiene por qué sumar 1 con el alto rendimiento: el resto no consta. */
  gradoDeInversion: CifraDeRentaFija;
  altoRendimiento: CifraDeRentaFija;
  /** En años. Dos estimadores distintos: la efectiva tiene en cuenta las opciones de los bonos y la modificada no. */
  duracionModificada: CifraDeRentaFija;
  duracionEfectiva: CifraDeRentaFija;
}

type CampoDelPerfil = "investment_grade_pct" | "high_yield_pct" | "modified_duration" | "effective_duration";

/**
 * Lo que la base publica de la renta fija, agregado a la cartera (decisión 11). Sustituye al «tipo» que se deducía de
 * palabras del nombre: JPMorgan Euro Aggregate salía «Flexible» por decir «aggregate».
 *
 * El peso de cada posición es su peso en renta fija (`assetPmsShares`), así que un mixto cuenta por su parte de bonos y
 * un monetario, que es liquidez, no cuenta. **La duración modificada y la efectiva no se mezclan:** miden cosas distintas,
 * y dos cifras solo se comparan si coinciden en el estimador (§3 del método).
 *
 * Devuelve `null` si la cartera no tiene renta fija: ahí no falta nada, no aplica.
 */
export function perfilDeRentaFija(
  positions: readonly BdbManualPortfolioPosition[],
  assets: readonly BdbAssetDetail[]
): PerfilDeRentaFija | null {
  const porId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  let pesoDeLaCartera = 0;
  let pesoEnRentaFija = 0;
  const acumulado: Record<CampoDelPerfil, { suma: number; peso: number }> = {
    investment_grade_pct: { suma: 0, peso: 0 },
    high_yield_pct: { suma: 0, peso: 0 },
    modified_duration: { suma: 0, peso: 0 },
    effective_duration: { suma: 0, peso: 0 }
  };

  for (const posicion of positions) {
    const peso = posicion.weight_percent || 0;
    if (peso <= 0) continue;
    pesoDeLaCartera += peso;
    const asset = porId.get(posicion.asset_id);
    if (!asset) continue;
    const enRentaFija = peso * assetPmsShares(asset).shares.fixed_income;
    if (enRentaFija <= 0) continue;
    pesoEnRentaFija += enRentaFija;
    for (const campo of Object.keys(acumulado) as CampoDelPerfil[]) {
      const declarado = asset.fixed_income_profile?.[campo];
      if (typeof declarado !== "number" || !Number.isFinite(declarado)) continue;
      acumulado[campo].suma += enRentaFija * declarado;
      acumulado[campo].peso += enRentaFija;
    }
  }

  if (pesoEnRentaFija <= 0) return null;
  const cifra = (campo: CampoDelPerfil): CifraDeRentaFija => {
    const { suma, peso } = acumulado[campo];
    return { valor: peso > 0 ? suma / peso : null, cobertura: (peso / pesoEnRentaFija) * 100 };
  };
  return {
    pesoEnLaCartera: (pesoEnRentaFija / pesoDeLaCartera) * 100,
    gradoDeInversion: cifra("investment_grade_pct"),
    altoRendimiento: cifra("high_yield_pct"),
    duracionModificada: cifra("modified_duration"),
    duracionEfectiva: cifra("effective_duration")
  };
}
