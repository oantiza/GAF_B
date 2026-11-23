import type { BacktestStressScenario } from "../adapters/backtestPortfolioBackend";
import { fecha, numero, oFalta, peso, rentabilidad } from "./formato";
import { textoDeAusencia } from "./textoDeAusencia";

/**
 * «Cómo se habría comportado esta composición en crisis pasadas»: lo que imprime el informe de cliente (decisión 3).
 *
 * Qué mide cada cifra, leído en `functions_python/optimization/stress_analytics.py`, y por eso el papel lo dice así:
 *
 * - **Es la variación entre dos fechas, no una caída de pico a valle.** El valor es 1 el primer día con precio de todas
 *   las posiciones que entran (`start_date`), y la cifra es el punto más bajo del tramo (`trough_date`) menos 1. Si la
 *   composición sube antes de caer, su caída desde el máximo sería mayor que esta cifra.
 * - **Con los pesos de hoy y sin reequilibrar:** cada posición pesa lo de hoy el primer día y luego se mueve sola.
 * - **Con precios observados en euros:** la serie de cada activo a 10 años, antes de la ampliación con referencias.
 * - **Una posición sin precio válido entra o no entra:** sin precio en los cinco primeros días hábiles del tramo, con un
 *   hueco de más de catorce días entre dos precios dentro del tramo (N03), o bloqueada por calidad, se queda fuera. El
 *   resto se lleva al 100 %, y `coverage.weight_pct` dice qué parte de la cartera original es ese resto.
 * - **Por debajo del 60 % no hay cifra** (decisión 103): llevar al 100 % lo que entra puede quedarse muy corto justo donde
 *   se mira cuánto puede caer. Con Vanguard 60 y JPMorgan 40 en la base vieja, la COVID daba −6,4 %, que es solo JPMorgan.
 *   En su lugar se dice cuánto mide y quién queda fuera.
 *
 * Nada de lo que sigue es una cifra escrita a mano: todo sale del escenario que manda el servidor.
 */

type IdDeCrisis = "COVID" | "RATES_2022";

/** Las dos crisis del papel. `COMMON_HISTORY` es la historia común de la cartera, no una crisis, y no se imprime. */
const CRISIS: ReadonlyArray<{ id: IdDeCrisis; nombre: string; contexto: string }> = [
  { id: "COVID", nombre: "COVID-19", contexto: "Inicio de la pandemia" },
  { id: "RATES_2022", nombre: "Tipos 2022", contexto: "Subida de los tipos de interés" }
];

/**
 * El corte de una crisis: por debajo de este peso medido no hay cifra (decisión 103). Es el del servidor, `REPRESENTATIVE_WEIGHT_THRESHOLD` en
 * `functions_python/optimization/stress_analytics.py`, que es quien manda `representative`: el adaptador rechaza una respuesta en la que los dos no
 * cuadren, y una prueba compara este número con el del servidor. Aquí solo se escribe en la frase.
 */
export const PESO_MINIMO_DE_UNA_CRISIS_PCT = 60;

export const SIN_DATOS_DE_LA_CRISIS = "Sin datos";

/** Qué mide la cifra de una crisis. Las mismas palabras en el informe de cliente y en la Propuesta de cambio. */
export const queMideLaCifraDeUnaCrisis = (deQuien: string) =>
  `Variación de valor de ${deQuien} entre el primer día de cada crisis y su punto más bajo, calculada con los pesos de hoy y los precios de entonces. Mira al pasado: no es una previsión.`;

/* A-206 (Óscar, 21-11-2026): desde P1-06 tampoco entra una posición cuya serie se detuvo antes que las demás (`SERIES_ENDS_EARLY`, en
   `functions_python/optimization/stress_analytics.py`), y la frase lo dice: «sin precios recientes». N03 (Óscar, 22-11-2026): ni una que dentro
   de la crisis tiene un hueco de más de catorce días entre dos precios (`GAP_IN_WINDOW`): «sin cotizaciones durante parte de ella». */
export const LO_QUE_NO_ES_LA_CIFRA_DE_UNA_CRISIS =
  "No se mide desde un máximo ni es la peor pérdida posible. Las posiciones sin precios válidos al inicio de cada crisis, sin cotizaciones durante parte de ella o sin precios recientes no entran: la cifra mide el resto, con sus pesos llevados al 100 % y sin reequilibrar. No es lo que obtuvo ninguna cartera real.";

export interface CrisisDelInforme {
  id: IdDeCrisis;
  nombre: string;
  contexto: string;
  /** «−20,62 %». Null si no hay cifra: no se escribe un cero. */
  cifra: string | null;
  /** «Del 19/02/2020 al 23/03/2020»: las dos fechas que la cifra compara. */
  tramo: string | null;
  /** «Mide el 79,0 % de la cartera (6 de 8 posiciones)». */
  parteMedida: string | null;
  /** «Fuera: Vanguard S&P 500 UCITS ETF (12,0 %) y R-co Valor Balanced C EUR (9,0 %)». Null si no queda nada fuera. */
  fuera: string | null;
  /** Sin cifra, lo que va en su sitio: «Sin datos» si no hay con qué medir, «Falta el dato» si mide menos del 60 % (decisión 103). */
  ausencia: string | null;
  /** Por qué no hay cifra. */
  sinDato: string | null;
}

export interface CrisisPasadas {
  /** Las que se imprimen. Vacía si no hay ninguna cifra: entonces la sección lo dice y no enseña fichas. */
  crisis: CrisisDelInforme[];
  /** La frase de cuando ninguna crisis tiene cifra. */
  sinNinguna: string | null;
}

/** Lo que el papel sabe de una posición para nombrarla. */
export interface PosicionDeLaCartera {
  nombre: string;
  /** De 0 a 100, sobre la cartera original. */
  pesoPct: number;
}

/** El de `formato`: la cifra y su «%» no se separan al saltar de línea. */
const ESPACIO_DURO = String.fromCharCode(0xa0);

const posiciones = (n: number) => `${n} ${n === 1 ? "posición" : "posiciones"}`;

/** Un peso con una décima. Lo que no es representativo no se redondea hacia arriba: un 59,96 % no sale «60,0 %». */
function pesoDeLaCrisis(pesoPct: number, representativa: boolean): string {
  return oFalta(peso((representativa ? pesoPct : Math.floor(pesoPct * 10 + 1e-6) / 10) / 100));
}

/** Una variación de un periodo: con signo y dos decimales. Un cero redondeado se escribe sin signo: «−0,00 %» no dice nada. */
function cifraDeLaCrisis(puntos: number): string {
  return oFalta(rentabilidad(puntos / 100));
}

function tramoDeLaCrisis(escenario: BacktestStressScenario): string | null {
  const { start_date: desde, trough_date: valle, end_date: fin, drawdown_pct: variacion } = escenario;
  if (!desde) return null;
  /* Si nunca baja del primer día, el «punto más bajo» es ese mismo día: lo que se ha mirado es todo el tramo. */
  if (variacion === 0 && fin) return `Del ${oFalta(fecha(desde))} al ${oFalta(fecha(fin))}: no bajó de su valor del primer día`;
  return valle ? `Del ${oFalta(fecha(desde))} al ${oFalta(fecha(valle))}` : null;
}

const MAXIMO_DE_NOMBRES = 3;

function fueraDeLaCrisis(escenario: BacktestStressScenario, posicionDe: (id: string) => PosicionDeLaCartera | null): string | null {
  const fuera = (escenario.excluded_assets ?? [])
    .map((item) => ({ id: item.asset_id, posicion: posicionDe(item.asset_id) }))
    .sort((a, b) => (b.posicion?.pesoPct ?? 0) - (a.posicion?.pesoPct ?? 0));
  if (fuera.length === 0) return null;
  const nombres = fuera.slice(0, MAXIMO_DE_NOMBRES).map(({ id, posicion }) =>
    posicion ? `${posicion.nombre} (${oFalta(peso(posicion.pesoPct / 100))})` : id
  );
  const resto = fuera.length - nombres.length;
  if (resto > 0) return `Fuera: ${nombres.join(", ")} y ${resto} más`;
  if (nombres.length === 1) return `Fuera: ${nombres[0]}`;
  return `Fuera: ${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/** Lo que mide una crisis que no llega al corte, con una décima y sin redondear hacia arriba: un 59,96 % no sale «60,0 %». */
function pesoQueNoLlega(escenario: BacktestStressScenario): string {
  return `Mide el ${pesoDeLaCrisis(escenario.coverage.weight_pct, false)} de la cartera, y hace falta al menos el ${numero(PESO_MINIMO_DE_UNA_CRISIS_PCT)}${ESPACIO_DURO}%.`;
}

const tieneCifraCalculada = (escenario: BacktestStressScenario) => typeof escenario.drawdown_pct === "number" && Number.isFinite(escenario.drawdown_pct);

/**
 * Decisión 103. Si una crisis tiene cifra calculada pero mide menos del 60 % de la cartera, no se da: esto es lo que se dice en su lugar, con las
 * cifras y los nombres del dato, «Mide el 40,0 % de la cartera, y hace falta al menos el 60 %. Fuera: Vanguard S&P 500 UCITS ETF (60,0 %).».
 * Null si la crisis da su cifra, o si no hay ninguna que dar, que es «Sin datos» con su motivo. La leen el papel y Simular, también en Modo
 * cliente: una sola regla, la de `representative`. Si el dato no dice quién queda fuera, se dice solo lo que mide.
 */
export function motivoDeUnaCrisisSinCifra(escenario: BacktestStressScenario, posicionDe: (assetId: string) => PosicionDeLaCartera | null): string | null {
  if (!tieneCifraCalculada(escenario) || escenario.representative) return null;
  const fuera = fueraDeLaCrisis(escenario, posicionDe);
  return fuera ? `${pesoQueNoLlega(escenario)} ${fuera}.` : pesoQueNoLlega(escenario);
}

/**
 * La frase que va en la tarjeta «Historia común» cuando su caída máxima cae en las mismas fechas que una crisis (Óscar, 20-11-2026): la COVID y la
 * historia común de una misma cartera pueden ir del mismo máximo al mismo mínimo y dar dos cifras distintas, y en pantalla parecía un error.
 *
 * Por qué difieren, leído en `stress_analytics.py`: cada escenario pone los pesos de hoy en su primer día y los deja moverse sin reequilibrar.
 * La crisis mide desde su primer día (`start_date`), que es aquí el máximo de la historia común (`peak_date`); la historia común, desde el suyo
 * (`start_date`), así que el día del máximo la cartera ya no pesa lo de hoy. La fecha sale de ese dato, no se escribe a mano.
 *
 * Solo sale si las dos explican lo mismo: las dos con cifra (miden el 60 % o más), con el mismo máximo y el mismo mínimo, con las mismas
 * posiciones dentro —si no, la diferencia sería también de lo que entra— y con cifras que se escriben distintas, `cifraDe`, la de la tarjeta.
 */
export function mismasFechasQueUnaCrisis(
  escenarios: readonly BacktestStressScenario[] | null | undefined,
  cifraDe: (escenario: BacktestStressScenario) => string | null
): string | null {
  const comun = escenarios?.find((escenario) => escenario.id === "COMMON_HISTORY");
  if (!comun || !comun.peak_date || !comun.trough_date || !comun.start_date || !tieneCifraCalculada(comun) || !comun.representative) return null;
  const mismas = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
  const crisis = escenarios?.find((escenario) =>
    escenario.id !== "COMMON_HISTORY" &&
    tieneCifraCalculada(escenario) &&
    escenario.representative &&
    escenario.start_date === comun.peak_date &&
    escenario.trough_date === comun.trough_date &&
    mismas(escenario.included_assets, comun.included_assets)
  );
  if (!crisis) return null;
  const deLaCrisis = cifraDe(crisis);
  const deLaComun = cifraDe(comun);
  if (!deLaCrisis || !deLaComun || deLaCrisis === deLaComun) return null;
  const desde = fecha(comun.start_date.slice(0, 10));
  if (!desde) return null;
  return `Las mismas fechas que ${crisis.label}, con otra cifra: allí la cartera parte ese día con los pesos de hoy; aquí los lleva puestos desde el ${desde}, sin reequilibrar.`;
}

/** Cómo se nombra cada posición en una crisis: su nombre y su peso sobre todo lo que pesa la cartera, como en el papel. Sin ella, su código. */
export function posicionesParaLasCrisis(
  posiciones: readonly { asset_id: string; weight_percent: number }[],
  nombreDe: (assetId: string) => string | undefined
): (assetId: string) => PosicionDeLaCartera | null {
  const total = posiciones.reduce((suma, posicion) => suma + Math.max(0, posicion.weight_percent || 0), 0);
  return (assetId) => {
    const posicion = posiciones.find((item) => item.asset_id === assetId);
    return posicion && total > 0 ? { nombre: nombreDe(assetId) || assetId, pesoPct: posicion.weight_percent / total * 100 } : null;
  };
}

/** «del 19/02/2020 al 23/03/2020», el tramo que se pide a la crisis. Sin una de las dos fechas, nada. */
function tramoConfigurado(escenario: BacktestStressScenario): string | null {
  const { configured_start_date: desde, configured_end_date: hasta } = escenario;
  return desde && hasta ? `del ${oFalta(fecha(desde))} al ${oFalta(fecha(hasta))}` : null;
}

function motivoSinDato(escenario: BacktestStressScenario): string {
  if (escenario.reason === "NO_ELIGIBLE_ASSETS") {
    /* N03: una posición con un hueco dentro de la crisis sí tenía precio al inicio. Lo que le falta es la crisis entera, y se dice eso. */
    const motivos = (escenario.excluded_assets ?? []).map((item) => item.reason);
    if (motivos.includes("GAP_IN_WINDOW")) {
      const tramo = tramoConfigurado(escenario);
      const cuando = tramo ? ` (${tramo})` : "";
      if (!motivos.every((motivo) => motivo === "GAP_IN_WINDOW")) return `Ninguna posición tenía precios válidos durante toda esta crisis${cuando}.`;
      return motivos.length === 1
        ? `La posición no tiene cotizaciones durante parte de esta crisis${cuando}, y sin ellas no se puede medir su caída.`
        : `Las posiciones no tienen cotizaciones durante parte de esta crisis${cuando}, y sin ellas no se puede medir su caída.`;
    }
    return escenario.configured_start_date
      ? `Ninguna posición tenía precios al inicio de esta crisis (${oFalta(fecha(escenario.configured_start_date))}).`
      : "Ninguna posición tenía precios al inicio de esta crisis.";
  }
  if (escenario.reason === "INSUFFICIENT_COMMON_DATA") return "Las posiciones con precios no coinciden en fechas suficientes dentro de esta crisis.";
  if (escenario.reason === "NO_POSITIVE_WEIGHTS") return "La cartera no tiene pesos positivos.";
  return "No hay datos para esta crisis.";
}

/**
 * De los escenarios del servidor a lo que se imprime. Si ninguna crisis tiene cifra, no hay fichas: hay una frase. Si
 * solo la tiene una, la otra sale con «Sin datos» y su motivo, para que se vea que se ha mirado. Y una que mide menos del
 * 60 % sale con «Falta el dato», lo que mide y quién queda fuera (decisión 103): cada crisis dice lo suyo.
 */
export function crisisPasadas(
  escenarios: readonly BacktestStressScenario[] | null | undefined,
  posicionDe: (assetId: string) => PosicionDeLaCartera | null
): CrisisPasadas {
  const encontradas = CRISIS.flatMap((crisis) => {
    const escenario = (escenarios ?? []).find((item) => item.id === crisis.id);
    return escenario ? [{ ...crisis, escenario }] : [];
  });
  const conCifra = encontradas.filter(({ escenario }) => tieneCifraCalculada(escenario));
  if (conCifra.length === 0) {
    const fechas = encontradas
      .filter(({ escenario }) => escenario.configured_start_date)
      .map(({ nombre, escenario }) => `${nombre} (desde ${oFalta(fecha(escenario.configured_start_date))})`);
    return {
      crisis: [],
      sinNinguna: fechas.length
        ? `Esta cartera no tiene datos para medir estas crisis: ${fechas.join(" y ")}. Sus posiciones no tienen precios válidos y comunes en esas fechas, así que no se puede decir cómo se habría comportado.`
        : "Esta cartera no tiene datos de crisis pasadas: no se puede decir cómo se habría comportado."
    };
  }
  return {
    crisis: encontradas.map(({ id, nombre, contexto, escenario }) => {
      if (!conCifra.some((item) => item.id === id)) {
        return { id, nombre, contexto, cifra: null, tramo: null, parteMedida: null, fuera: null, ausencia: SIN_DATOS_DE_LA_CRISIS, sinDato: motivoSinDato(escenario) };
      }
      if (!escenario.representative) {
        return { id, nombre, contexto, cifra: null, tramo: null, parteMedida: null, fuera: fueraDeLaCrisis(escenario, posicionDe), ausencia: textoDeAusencia("falta"), sinDato: pesoQueNoLlega(escenario) };
      }
      const { included_assets: dentro, total_assets: total, weight_pct: peso } = escenario.coverage;
      return {
        id,
        nombre,
        contexto,
        cifra: cifraDeLaCrisis(escenario.drawdown_pct as number),
        tramo: tramoDeLaCrisis(escenario),
        parteMedida: `Mide el ${pesoDeLaCrisis(peso, true)} de la cartera (${dentro} de ${posiciones(total)})`,
        fuera: fueraDeLaCrisis(escenario, posicionDe),
        ausencia: null,
        sinDato: null
      };
    }),
    sinNinguna: null
  };
}
