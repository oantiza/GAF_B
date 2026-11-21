import { sanitizeDraftName } from "./localPortfolioStorage";
import type { BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { PerfilYHorizonte } from "./perfilYHorizonte";

/**
 * El ciclo de vida de la cartera activa (hallazgo 47): qué cartera guardada está abierta y si lo que
 * hay en pantalla coincide con ella. Solo cuentas, sin React ni red: la parte que se puede probar con
 * un resultado conocido. Lo que la usa está en `src/app/useCicloDeCartera.tsx`.
 */

/** Lo que hay en Diseño de cartera en este momento. `capital` es `undefined` si está sin fijar. */
export interface ContenidoDeCartera {
  positions: BdbManualPortfolioPosition[];
  capital: number | undefined;
  nombre: string;
  /** Decisión 59: nivel de perfil y horizonte de la cartera. Sin él, ninguno de los dos está definido. */
  perfilYHorizonte?: PerfilYHorizonte;
}

/**
 * La cartera guardada de la que parte lo que hay en pantalla. Sin ella, lo que hay no se ha guardado
 * nunca, y «Guardar» crea una nueva en vez de sobrescribir.
 */
export interface CarteraAbierta {
  portfolio_id: string;
  created_at: string;
  updated_at: string;
  /** La huella del contenido en el momento de guardarla o abrirla. */
  huella: string;
}

const redondea = (valor: number, decimales: number) => Number(valor.toFixed(decimales));

/**
 * Lo que decide si dos carteras son la misma para quien las usa: activos, pesos, importes fijos,
 * capital, nombre, y nivel de perfil y horizonte. El orden de las filas y la etiqueta no cuentan, y los
 * pesos se comparan a cuatro decimales, que es lo que sobrevive a ir y volver del servidor.
 *
 * El perfil y el horizonte solo entran si alguno está definido: así la huella de una cartera sin ellos es
 * la de antes de la decisión 59, y una cartera abierta antes no aparece de golpe con cambios sin guardar.
 */
export function huellaDeCartera(contenido: ContenidoDeCartera): string {
  const posiciones = contenido.positions
    .map((posicion) => [
      posicion.asset_id,
      redondea(posicion.weight_percent || 0, 4),
      posicion.keepEuros ? 1 : 0,
      posicion.keepEuros && typeof posicion.targetEuros === "number" ? redondea(posicion.targetEuros, 2) : null
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const capital = typeof contenido.capital === "number" ? redondea(contenido.capital, 2) : null;
  const nivel = contenido.perfilYHorizonte?.risk_profile_level;
  const horizonte = contenido.perfilYHorizonte?.horizon_years;
  const base = [posiciones, capital, sanitizeDraftName(contenido.nombre) ?? ""];
  return JSON.stringify(
    nivel === undefined && horizonte === undefined ? base : [...base, nivel ?? null, horizonte === undefined ? null : redondea(horizonte, 4)]
  );
}

/** Hay algo que se perdería: la cartera abierta ha cambiado, o hay posiciones que nunca se guardaron. */
export function hayCambiosSinGuardar(contenido: ContenidoDeCartera, abierta: CarteraAbierta | null): boolean {
  return abierta ? huellaDeCartera(contenido) !== abierta.huella : contenido.positions.length > 0;
}
