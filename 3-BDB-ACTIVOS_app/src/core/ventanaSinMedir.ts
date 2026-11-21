import { fecha, oFalta } from "./formato";

/**
 * Por qué una ventana no enseña cifra aunque la serie llegue a ella. Son dos motivos, y los dos dicen lo mismo de la misma forma en todas
 * las pantallas: una ventana sin cifra dice «Falta el dato», y esta frase dice por qué.
 *
 *  - Su periodo empieza antes de la fecha desde la que vale la serie (decisiones 73 y 112): `metrics.series_valid_from`, en la tarjeta.
 *  - Su serie tiene un hueco de más de un mes dentro de la ventana (decisión 111): `inputs.series_gaps`, en `computed/metrics`.
 *
 * La regla no se decide aquí, y por eso no se repite: la deciden el extractor y el lote, y esto solo lo cuenta.
 */
export interface HuecoDeLaSerie {
  from: string;
  to: string;
  days?: number;
  windows: string[];
}

const ANIOS: Readonly<Record<string, string>> = { "1y": "1", "3y": "3", "5y": "5", "10y": "10" };

/** «a 10 años», «a 5 y 10 años», «en lo que va de año». */
function ventanasEnPalabras(ventanas: readonly string[]): string {
  const conAnios = ventanas.filter((ventana) => ANIOS[ventana] !== undefined).map((ventana) => ANIOS[ventana] as string);
  const partes: string[] = [];
  if (ventanas.includes("ytd")) partes.push("en lo que va de año");
  if (conAnios.length > 0) {
    const lista = conAnios.length > 1 ? `${conAnios.slice(0, -1).join(", ")} y ${conAnios[conAnios.length - 1]}` : conAnios[0];
    partes.push(`a ${lista} ${conAnios.length === 1 && conAnios[0] === "1" ? "año" : "años"}`);
  }
  return partes.join(" y ");
}

/** La frase de la fecha, la misma en la ficha, el Comparador y donde se enseñe. Sin ventanas fuera, no hay nada que decir. */
export function fraseDeLaSerieValida(desde: string | undefined, ventanas: readonly string[]): string | undefined {
  if (!desde || ventanas.length === 0) return undefined;
  return `Falta el dato ${ventanasEnPalabras(ventanas)}: su serie solo vale desde el ${oFalta(fecha(desde))}, y ese periodo empieza antes.`;
}

/** La frase del hueco. */
export function fraseDelHueco(hueco: HuecoDeLaSerie): string {
  return `Falta el dato ${ventanasEnPalabras(hueco.windows)}: su serie no tiene puntos del ${oFalta(fecha(hueco.from))} al ${oFalta(fecha(hueco.to))}.`;
}

/**
 * Una cifra nuestra que se calculó y se apartó por salirse del rango de su contrato (decisión B-73, Óscar, 09-11-2026). Bloquea solo su ventana,
 * «con el motivo a la vista»: la celda dice «Falta el dato», como un hueco de la serie, y esta frase dice por qué, para que no parezca que la serie no
 * llega. La ruta es la de `computed/metrics`, la misma que lista `metrics.windows_out_of_range` en la tarjeta: `annualized_return.1y`, `ytd_return`,
 * `relative.r2.3y`.
 *
 * El valor y el límite salen de `computed/metrics.out_of_range`, y solo se escriben si quien llama los pasa: la tarjeta no los lleva («una cifra
 * apartada no se enseña») y el Modo cliente no los enseña. El límite es el techo si el valor es mayor y el suelo si es menor.
 */
export interface CifraApartada {
  ruta: string;
  /** Lo calculado y el límite que rebasa, ya escritos con el formato de su magnitud. */
  valor?: string;
  limite?: string;
  /** Por arriba (el límite es el techo) o por abajo (el suelo). */
  porEncima?: boolean;
}

const DE_LA_MAGNITUD: Readonly<Record<string, string>> = {
  annualized_return: "de la rentabilidad anualizada",
  volatility: "de la volatilidad",
  max_drawdown: "de la caída máxima",
  sharpe: "del Sharpe",
  sortino: "del Sortino",
  ytd_return: "de la rentabilidad",
  "relative.beta": "de la beta",
  "relative.r2": "del R²",
  "relative.jensen_alpha": "del alfa de Jensen",
  "relative.active_return": "de la rentabilidad activa",
  "relative.tracking_error": "del tracking error",
  "relative.information_ratio": "del ratio de información"
};

/** `annualized_return.1y` → magnitud y ventana; `ytd_return` → su magnitud y `ytd`. */
export function partesDeLaRuta(ruta: string): { campo: string; ventana: string } {
  if (ruta === "ytd_return") return { campo: "ytd_return", ventana: "ytd" };
  const corte = ruta.lastIndexOf(".");
  return { campo: ruta.slice(0, corte), ventana: ruta.slice(corte + 1) };
}

/** La frase de la cifra apartada, la misma en la ficha y en el Comparador. */
export function fraseDeLaCifraApartada({ ruta, valor, limite, porEncima }: CifraApartada): string {
  const { campo, ventana } = partesDeLaRuta(ruta);
  const cual = `${DE_LA_MAGNITUD[campo] ?? `de ${campo}`} ${ventanasEnPalabras([ventana])}`;
  const cuanto =
    valor !== undefined && limite !== undefined
      ? `calculamos ${valor}, ${porEncima ? "por encima del máximo" : "por debajo del mínimo"} que admitimos, ${limite}, y la apartamos`
      : "la cifra calculada se sale del rango que admitimos, y la apartamos";
  return `Falta el dato ${cual}: ${cuanto}.`;
}
