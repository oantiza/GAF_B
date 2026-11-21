import type { Documento } from "./baseNuevaLectura";

/**
 * El estado del catálogo, sacado de las tarjetas: lo único que hay en la base nueva y no depende
 * de un trabajo programado. Y los fondos que el control señala, que la decisión 8 pide que mire
 * una persona, y que hasta el 04-11-2026 ninguna pantalla leía.
 */
export interface FondoParaRevisar {
  isin: string;
  nombre: string;
  discrepa: string;
  fecha?: string;
}

export interface EstadoDelCatalogo {
  ultimaPasada?: string;
  instrumentos: number;
  propias: number;
  delProveedor: number;
  sinCifras: number;
  /** Cierres de las métricas mensuales, el más reciente primero. */
  cierres: Array<{ fecha: string; fondos: number }>;
  paraRevisar: FondoParaRevisar[];
}

const MAGNITUD: Record<string, string> = {
  sharpe: "Sharpe",
  volatility: "Volatilidad",
  annualized_return: "Rentabilidad",
  max_drawdown: "Caída máxima"
};
const VENTANA: Record<string, string> = { "1y": "1 año", "3y": "3 años", "5y": "5 años", "10y": "10 años" };

/** `sharpe.3y` en palabras. Lo que no se conoce se deja tal cual: es mejor que callarlo. */
export function discrepanciaEnPalabras(ruta: string): string {
  const [magnitud = "", ventana = ""] = ruta.split(".");
  return MAGNITUD[magnitud] && VENTANA[ventana] ? `${MAGNITUD[magnitud]} a ${VENTANA[ventana]}` : ruta;
}

const de = (tarjeta: Documento, campo: string): Record<string, unknown> =>
  (tarjeta[campo] ?? {}) as Record<string, unknown>;

export function componerEstado(tarjetas: Documento[]): EstadoDelCatalogo {
  const cierres = new Map<string, number>();
  const paraRevisar: FondoParaRevisar[] = [];
  let ultimaPasada: string | undefined;
  let propias = 0;
  let delProveedor = 0;

  for (const tarjeta of tarjetas) {
    const calculada = tarjeta["computed_at"];
    if (typeof calculada === "string" && (!ultimaPasada || calculada > ultimaPasada)) ultimaPasada = calculada;

    const metricas = de(tarjeta, "metrics");
    if (metricas["source"] === "COMPUTED") propias += 1;
    if (metricas["source"] === "PROVIDER") delProveedor += 1;
    if (metricas["frequency"] === "MONTHLY" && typeof metricas["as_of"] === "string") {
      cierres.set(metricas["as_of"], (cierres.get(metricas["as_of"]) ?? 0) + 1);
    }

    const control = (metricas["control"] ?? undefined) as { mismatch?: string[]; as_of?: string } | undefined;
    if (control?.mismatch?.length) {
      paraRevisar.push({
        isin: String(tarjeta["instrument_id"] ?? ""),
        nombre: String(de(tarjeta, "identity")["name"] ?? tarjeta["instrument_id"] ?? ""),
        discrepa: control.mismatch.map(discrepanciaEnPalabras).join(", "),
        fecha: control.as_of
      });
    }
  }

  return {
    ultimaPasada,
    instrumentos: tarjetas.length,
    propias,
    delProveedor,
    sinCifras: tarjetas.length - propias - delProveedor,
    cierres: [...cierres]
      .map(([fecha, fondos]) => ({ fecha, fondos }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    paraRevisar: paraRevisar.sort((a, b) => a.nombre.localeCompare(b.nombre))
  };
}
