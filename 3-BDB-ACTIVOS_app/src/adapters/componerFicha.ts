import { categoriaLegible, CLASE_DE_ACTIVO, etiquetaDeReparto, SECTOR_EN_INGLES } from "../core/etiquetasDeReparto";
import { COLUMNAS_DE_LA_CAJA, FILAS_DE_LA_CAJA, NOTA_DE_CORTOS, nueveCeldas } from "../core/cajaDeEstilo";
import { importeGrande, precio, precioConDivisa } from "../core/cifrasDeFicha";
import * as formato from "../core/formato";
import { diezMayoresQueCuadran, esDerivadoPorSuCodigo, rotuloDeLinea } from "../core/lineaDeCartera";
import { seEnsenaLaMetrica } from "../core/metricasPorInstrumento";
import { seEnsena } from "../core/modoCliente";
import { rotuloDePrecioCongelado, valoradoAPrecioCongelado } from "../core/precioCongelado";
import { lineaDeLoNegociado, type LoNegociado } from "../core/loNegociado";
import { fraseDeLaCifraApartada, fraseDeLaSerieValida, fraseDelHueco, partesDeLaRuta, type CifraApartada, type HuecoDeLaSerie } from "../core/ventanaSinMedir";
import { operacionEnUnaCasilla } from "../core/portfolioCosts";
import { NOTA_CANADA_Y_AFRICA, zonasDeUnReparto } from "../core/regionTaxonomy";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { Documento, InstrumentoDeLaBase } from "./baseNuevaLectura";
import { discrepanciaEnPalabras } from "./componerEstado";
import { clasificacionDeTarjeta, NOMBRE_DEL_METODO } from "./componerLista";
import { filaDeComisionDeSwap, filaDePoliticaDelEmisor, seccionAnchaDelEmisor, seccionDelEmisorJuntoAlPrecio } from "./fichaDelEmisor";
import { seccionDelMercadoObjetivo } from "./fichaDelMercadoObjetivo";
import type {
  AptitudDeFicha,
  CajaDeFicha,
  CeldaDeSeccion,
  ClaseDeAusencia,
  FichaInstrumento,
  FilaDeFicha,
  SeccionDeFicha,
  Trozo
} from "../types/fichaInstrumento";

/**
 * Compone la ficha a partir de lo que la base nueva dice de un instrumento.
 *
 * La regla que gobierna este fichero: **la clase de ausencia sale del dato, no de una
 * decisión de la interfaz.** Cuando un campo falta, su motivo se busca en la lista de
 * ausencias de `quality/latest`, que dice por cada ruta si no aplica, si no nos lo han
 * dado o si aún no lo hemos pedido. La pantalla no lo adivina.
 *
 * Lo que sí es de la interfaz, y conviene no confundirlo: las frases que explican una
 * ausencia campo a campo. La base guarda prosa por APTITUD (`fitness.*.missing`), no
 * por campo, así que las glosas de abajo están escritas aquí, a la vista y revisables.
 */

/**
 * Los seis tipos del contrato (`instrument.v2`). Un código que no esté aquí no se enseña.
 *
 * Hoy hay uno solo de `OTHER`, iShares Physical Gold, y su nombre dice lo que es: un ETC, títulos de deuda de un emisor con oro
 * físico detrás, que no es ni un fondo ni un ETF (decisión 76). El contrato no tiene ese tipo, y otro `OTHER` sigue diciendo «otro
 * producto»: esto es lo que se lee, y que se mida lo decide el servidor, con su lista (`ETC_REVISADOS`).
 */
const NOMBRE_DEL_TIPO: Record<string, string> = {
  FUND: "FONDO DE INVERSIÓN",
  ETF: "ETF",
  STOCK: "ACCIÓN",
  INDEX: "ÍNDICE",
  CURRENCY: "LIQUIDEZ",
  OTHER: "OTRO PRODUCTO"
};
const OTRO_TIPO = NOMBRE_DEL_TIPO.OTHER;
const esUnEtc = (raiz: Documento | undefined): boolean =>
  valorEn(raiz, "instrument_type") === "OTHER" && /\bETC\b/.test(String(valorEn(raiz, "identity.name") ?? ""));

const CLASE_POR_RAZON: Record<string, ClaseDeAusencia> = {
  NOT_APPLICABLE: "no-aplica",
  NOT_PROVIDED: "falta",
  NOT_YET_FETCHED: "sin-pedir"
};

/**
 * PROVISIONAL (decisión 74, 05-11-2026). El contrato `instrument-declared-costs.v2` declara estas tres con `x-absence: NOT_APPLICABLE`, para
 * todos los fondos y sin mirar ninguno, así que la ficha decía «Comisión de éxito: No aplica» de Eleva, cuyo KID dice un 20 % sobre la cota
 * máxima. Lo cierto es que no tenemos la cifra. Lo correcto es cambiar esa razón en el contrato con la tanda de KID (decisión 92), y entonces
 * esto se quita.
 */
const NO_APLICA_QUE_ES_FALTA: ReadonlySet<string> = new Set([
  "declared/costs.performance_fee",
  "declared/costs.entry_charge",
  "declared/costs.exit_charge"
]);

const ETIQUETA_POR_CLASE: Record<ClaseDeAusencia, string> = {
  "no-aplica": textoDeAusencia("no-aplica"),
  falta: textoDeAusencia("falta"),
  "sin-pedir": "Pendiente de incorporar"
};

/**
 * Lo que dice una ausencia que se resuelve trabajando. Por defecto «Pendiente de incorporar»;
 * algunas rutas tienen algo más exacto, porque lo que hay que hacer es dar de alta el índice.
 */
const VERBO_POR_RUTA: Record<string, string> = {
  "classification.official_benchmark.instrument_id": "Pendiente de alta",
  "computed/metrics.relative.benchmark.instrument_id": "Pendiente de alta"
};

/** Las frases de la interfaz, una por ruta. Lo que no esté aquí no lleva glosa. */
const GLOSA_POR_RUTA: Record<string, string> = {
  "declared/profile.sfdr_article": "Este fondo no se acoge a los artículos 8 ni 9 del reglamento.",
  "declared/dividends.currency": "Sin importe no hay divisa que declarar.",
  "classification.official_benchmark.instrument_id":
    "Alfa calculado por el proveedor. Cuando demos de alta el índice, se calculará con nuestro método.",
  "declared/equity.business_description":
    "El proveedor no entrega ninguno de los tres para este valor."
};




type Ausencia = { path: string; reason: string };

/** El índice de ausencias de un instrumento: ruta → clase. */
function indiceDeAusencias(calidad: Documento | undefined): Map<string, ClaseDeAusencia> {
  const lista = (calidad?.["absences"] as Ausencia[] | undefined) ?? [];
  return new Map(
    lista
      .filter((ausencia) => CLASE_POR_RAZON[ausencia.reason] !== undefined)
      .map((ausencia) => [
        ausencia.path,
        ausencia.reason === "NOT_APPLICABLE" && NO_APLICA_QUE_ES_FALTA.has(ausencia.path) ? "falta" : CLASE_POR_RAZON[ausencia.reason]
      ])
  );
}

function valorEn(documento: Documento | undefined, ruta: string): unknown {
  return ruta
    .split(".")
    .reduce<unknown>(
      (actual, tramo) =>
        actual && typeof actual === "object"
          ? (actual as Record<string, unknown>)[tramo]
          : undefined,
      documento
    );
}

/** Lo que hace falta para construir filas de un instrumento concreto. */
interface Contexto {
  instrumento: InstrumentoDeLaBase;
  ausencias: Map<string, ClaseDeAusencia>;
  /** Con Modo cliente, lo que queda por incorporar no se enseña como tarea: es un dato que falta. */
  modoCliente: boolean;
}

/**
 * Una fila. Si el valor está, se escribe; si no, la clase y la glosa salen de la ruta
 * del contrato, que es la que la base nombra en su lista de ausencias.
 *
 * Nunca escribe un guion: un guion se lee como cero, y un cero creíble es peor que un
 * error. Cuando no hay dato Y la base tampoco registra su ausencia —no debería pasar,
 * pero puede— la fila sale como «Falta el dato», que es lo prudente.
 */
function fila(
  contexto: Contexto,
  rotulo: string,
  ruta: string,
  escribir: (valor: unknown) => string,
  opciones: { destacada?: boolean; larga?: boolean; glosa?: string } = {}
): FilaDeFicha {
  const documento = documentoDeLaRuta(contexto.instrumento, ruta);
  const valor = valorEn(documento, rutaInterna(ruta));
  if (valor !== undefined && valor !== null) {
    return { rotulo, valor: escribir(valor), destacada: opciones.destacada, larga: opciones.larga, glosa: opciones.glosa };
  }
  const registrada = contexto.ausencias.get(ruta) ?? "falta";
  if (registrada === "sin-pedir" && !seEnsena("sinPedir", contexto.modoCliente)) {
    return { rotulo, valor: ETIQUETA_POR_CLASE.falta, ausencia: "falta" };
  }
  const etiqueta =
    registrada === "sin-pedir" ? (VERBO_POR_RUTA[ruta] ?? ETIQUETA_POR_CLASE[registrada]) : ETIQUETA_POR_CLASE[registrada];
  /* «No se acoge» solo es cierto si no aplica: junto a «Falta el dato» diría que sabemos lo que acabamos de decir que no sabemos. */
  const glosa = ruta === "declared/profile.sfdr_article" && registrada !== "no-aplica" ? undefined : GLOSA_POR_RUTA[ruta];
  return { rotulo, valor: etiqueta, ausencia: registrada, glosa };
}

/** `declared/costs.ongoing_charge` → el documento `declared/costs`. */
function documentoDeLaRuta(instrumento: InstrumentoDeLaBase, ruta: string): Documento | undefined {
  const bloque = Object.keys(instrumento.bloques).find((sufijo) => ruta.startsWith(`${sufijo}.`));
  return bloque ? instrumento.bloques[bloque] : instrumento.raiz;
}

/** `declared/costs.ongoing_charge` → `ongoing_charge`. */
function rutaInterna(ruta: string): string {
  const corte = ruta.indexOf(".");
  return ruta.startsWith("declared/") || ruta.startsWith("computed/") ? ruta.slice(corte + 1) : ruta;
}

/* FMT-14: la base guarda una ausencia como `null`, y `Number(null)` es 0: un coste ausente salía «0,00 %».
   Lo que no está se queda en NaN, que los formateadores escriben como ausente. */
const comoNumero = (valor: unknown): number =>
  valor === null || valor === undefined || valor === "" ? Number.NaN : Number(valor);

/*
 * Cada cifra con lo que es, por el módulo común (apartado 6 de SISTEMA_DISENO.md). Lo que falta se escribe «Falta el dato»,
 * nunca «N/D».
 */

/** Riesgo y coste: volatilidad, caída máxima, tracking error, R², costes y comisiones, rendimientos. Dos decimales, sin «+». */
const pct = (valor: unknown) => formato.oFalta(formato.porcentaje(comoNumero(valor)));

/**
 * Una rentabilidad o un alfa llevan signo: «+15,84 %» dice algo que «15,84 %» no dice,
 * y el lector no deberia tener que acordarse de que esta columna puede ser negativa.
 * El menos lo pone el módulo común, y es el tipografico, no el guion.
 */
const pctConSigno = (valor: unknown) => formato.oFalta(formato.rentabilidad(comoNumero(valor)));

/** Un peso o un reparto: un decimal, como en «Resumen». */
const pesoDe = (valor: unknown) => formato.oFalta(formato.peso(comoNumero(valor)));

/** Sharpe, Sortino, beta, ratio de información: dos decimales. */
const num = (valor: unknown) => formato.oFalta(formato.ratio(comoNumero(valor)));
/** Un recuento: con punto de millar. */
const recuento = (valor: number) => formato.oFalta(formato.numero(valor));
/** Una fecha de procedencia: «19/08/2026». */
const dia = (valor: unknown) => formato.oFalta(typeof valor === "string" ? formato.fecha(valor) : null);

/**
 * Nuestras métricas, en una tabla de magnitud por ventana.
 *
 * Eran cinco filas elegidas a mano —volatilidad a uno y a tres, Sharpe a uno, caída a
 * uno— y eso era un síntoma: del 02-11-2026 para atrás, de la caída máxima solo había
 * UNA ventana por instrumento, así que una tabla habría salido casi vacía. Ahora el
 * extractor publica las cuatro de la volatilidad, tres del Sharpe, cuatro de la caída y
 * tres del Sortino, y elegir cinco a mano escondería el resto.
 *
 * Las filas se construyen de lo que el documento TRAE, no de una lista fija: una ventana
 * que el instrumento no tiene no sale, y una magnitud que no tiene ninguna ventana
 * tampoco. Eso vale para lo que venga —Calmar, captura alcista— sin tocar esta función:
 * basta añadir su rótulo y su formato. Lo que NO se hace es rellenar un hueco: una celda
 * sin cifra dice por qué, y nunca un cero ni una raya, que se lee como un cero.
 */
const VENTANAS_DE_LA_TABLA = ["1y", "3y", "5y", "10y"] as const;
const ROTULO_DE_VENTANA: Record<string, string> = {
  "1y": "1 año",
  "3y": "3 años",
  "5y": "5 años",
  "10y": "10 años"
};
type MagnitudDeLaTabla = { campo: string; rotulo: string; escribir: (valor: unknown) => string };

const MAGNITUDES_DE_LA_TABLA: MagnitudDeLaTabla[] = [
  { campo: "annualized_return", rotulo: "Rentabilidad anualizada", escribir: pctConSigno },
  { campo: "volatility", rotulo: "Volatilidad", escribir: pct },
  { campo: "max_drawdown", rotulo: "Caída máxima", escribir: pct },
  { campo: "sharpe", rotulo: "Sharpe", escribir: num },
  { campo: "sortino", rotulo: "Sortino", escribir: num }
];

/** Lo nuestro contra su índice: ya estaba calculado y la ficha no lo enseñaba. */
const MAGNITUDES_CONTRA_EL_INDICE: MagnitudDeLaTabla[] = [
  { campo: "relative.jensen_alpha", rotulo: "Alfa de Jensen", escribir: pctConSigno },
  { campo: "relative.beta", rotulo: "Beta", escribir: num },
  { campo: "relative.r2", rotulo: "R²", escribir: pct },
  { campo: "relative.active_return", rotulo: "Rentabilidad activa", escribir: pctConSigno },
  { campo: "relative.tracking_error", rotulo: "Tracking error", escribir: pct },
  { campo: "relative.information_ratio", rotulo: "Ratio de información", escribir: num }
];

/** Las rutas de `computed/metrics.out_of_range` que llevan su valor y su límite: la forma es la del documento (decisión B-73). */
function rutasDeLoApartado(nodo: unknown, prefijo = ""): Array<[string, { value: number; limit: number }]> {
  if (!nodo || typeof nodo !== "object") return [];
  const { value, limit } = nodo as Record<string, unknown>;
  if (typeof value === "number" && typeof limit === "number") return [[prefijo, { value, limit }]];
  return Object.entries(nodo as Record<string, unknown>).flatMap(([clave, hijo]) => rutasDeLoApartado(hijo, prefijo ? `${prefijo}.${clave}` : clave));
}

/**
 * Las cifras nuestras que se calcularon y se apartaron por salirse del rango de su contrato (decisión B-73): las que lista la tarjeta en
 * `metrics.windows_out_of_range` y las que anota `computed/metrics.out_of_range`. Con el documento, cada una lleva lo calculado y el límite, escritos
 * con el formato de su magnitud; en Modo cliente, no: la cifra apartada no se le enseña, y el motivo sí, como el de un hueco de la serie.
 */
function cifrasApartadas(tarjeta: Documento | undefined, metricas: Documento | undefined, modoCliente: boolean): CifraApartada[] {
  const anotadas = new Map(rutasDeLoApartado(valorEn(metricas, "out_of_range")));
  const rutas = [...new Set([...((valorEn(tarjeta, "metrics.windows_out_of_range") ?? []) as string[]), ...anotadas.keys()])];
  return rutas.map((ruta) => {
    const anotada = anotadas.get(ruta);
    if (!anotada || !seEnsena("calidadInterna", modoCliente)) return { ruta };
    const { campo } = partesDeLaRuta(ruta);
    const escribir = [...MAGNITUDES_DE_LA_TABLA, ...MAGNITUDES_CONTRA_EL_INDICE].find((magnitud) => magnitud.campo === campo)?.escribir ?? pctConSigno;
    return { ruta, valor: escribir(anotada.value), limite: escribir(anotada.limit), porEncima: anotada.value > anotada.limit };
  });
}

/** Por qué no hay métricas nuestras, según el motivo que la base deja en la raíz. */
const SIN_METRICAS: Record<string, { titular: string; nota: string }> = {
  DISTRIBUTES: {
    titular: "No las calculamos para esta clase",
    nota:
      "Esta clase reparte, y su valor liquidativo baja cada vez que paga. Calcular sobre esa serie " +
      "recortaría la rentabilidad y contaría como caídas lo que no son caídas de mercado, y no " +
      "tenemos todos los pagos del periodo para corregirla. Las cifras del proveedor, si las hay, " +
      "se muestran aparte y con su nombre."
  },
  POLICY_UNKNOWN: {
    titular: "No sabemos si esta clase reparte",
    nota:
      "Ninguna fuente lo confirma, y sin saberlo la serie podría recortar su rentabilidad. " +
      "Por eso no calculamos sobre ella."
  },
  POLICY_PENDING: {
    titular: "Falta confirmar si esta clase reparte",
    nota:
      "Su nombre sugiere que reparte, y aún no hemos podido leerlo en su KID. Hasta entonces no " +
      "calculamos sobre su serie."
  },
  NEEDS_FX: {
    titular: "Falta llevar su serie a euros",
    nota: "Todas nuestras cifras van en euros, y no tenemos el cambio del BCE para esta divisa."
  },
  SERIES_STOPPED: {
    titular: "Su serie está parada",
    nota: "La fuente dejó de actualizar sus precios, y una cifra nuestra sería una cifra vieja."
  },
  NO_PRICES: {
    titular: "No tenemos su serie de precios",
    nota: "La fuente que consultamos no la entrega."
  },
  SHORT_HISTORY: {
    titular: "Su historia es demasiado corta",
    nota: "No llega a la ventana más corta que publicamos, de un año."
  },
  NO_METHOD: {
    titular: "No tenemos método para este producto",
    nota: "Hay serie de precios, pero no hemos decidido cómo medir este tipo de activo."
  },
  UNIDENTIFIED_SERIES: {
    titular: "No podemos publicar sus cifras",
    nota: "No se puede identificar con qué serie se calcularon, y una cifra así no se puede reproducir."
  }
};

const SIN_HISTORIA: CeldaDeSeccion = { texto: "Sin historia", ausencia: "no-aplica" };
/* La serie llega, y esa ventana no se enseña: por un hueco o por la fecha desde la que vale (decisiones 111 y 112). La nota dice por qué. */
const FALTA_LA_VENTANA: CeldaDeSeccion = { texto: textoDeAusencia("falta"), ausencia: "falta" };
const NO_CALCULADO: CeldaDeSeccion = { texto: "No calculado", ausencia: "no-aplica" };
/**
 * FMT-13: lo que reparte una clase en doce meses sobre su precio. El sistema no dice «rendimiento» (apartado 6 de
 * `SISTEMA_DISENO.md`): «Rendimiento 12 meses» se confundía con la rentabilidad del fondo, y es otra cifra.
 */
export const ROTULO_DEL_REPARTO_12M = "Rentabilidad por reparto, 12 meses";

const NOTA_SIN_HISTORIA = "Sin historia: la serie de este activo no llega a esa ventana.";
const NOTA_NO_CALCULADO = "No calculado: la serie llega a esa ventana, pero esa cifra no está calculada.";
const NOTA_DEL_SORTINO =
  "El Sortino mide el exceso sobre el mismo tipo libre de riesgo que el Sharpe, pero contando solo las caídas.";
const NOTA_DEL_ESTR = "El Sharpe y el Sortino no llegan a 10 años porque el €STR empieza en octubre de 2019.";

/**
 * Una celda vacía tiene dos explicaciones, y solo una es que la serie sea corta. Si tampoco hay
 * rentabilidad en esa ventana, la serie no llega. Si la hay, llega: lo que falta es otra cosa, como el
 * €STR en el Sharpe a 10 años, y decir «sin historia» junto a una rentabilidad a 10 años sería falso.
 */
function celdaVacia(metricas: Documento, ventana: string, apartadas: ReadonlySet<string> = new Set()): CeldaDeSeccion {
  /* Una rentabilidad apartada por su rango (decisión B-73) se calculó: la serie llega. */
  return valorEn(metricas, `annualized_return.${ventana}`) === undefined && !apartadas.has(`annualized_return.${ventana}`) ? SIN_HISTORIA : NO_CALCULADO;
}

function tablaDeVentanas(
  metricas: Documento | undefined,
  magnitudes: MagnitudDeLaTabla[] = MAGNITUDES_DE_LA_TABLA,
  /** Las ventanas que no se enseñan aunque el documento las traiga, y por eso salen con su columna. */
  sinMedir: ReadonlySet<string> = new Set(),
  /** Las cifras apartadas por salirse de su rango, por su ruta (decisión B-73): su celda dice que falta, y la nota, por qué. */
  apartadas: ReadonlySet<string> = new Set()
): { columnas: string[]; filas: CeldaDeSeccion[][]; cifras: number[] } | undefined {
  if (metricas === undefined) return undefined;
  const presentes = VENTANAS_DE_LA_TABLA.filter((ventana) =>
    sinMedir.has(ventana) ||
    magnitudes.some(
      (magnitud) => valorEn(metricas, `${magnitud.campo}.${ventana}`) !== undefined || apartadas.has(`${magnitud.campo}.${ventana}`)
    )
  );
  if (presentes.length === 0) return undefined;
  const filas = magnitudes.flatMap((magnitud) => {
    const celdas = presentes.map((ventana): CeldaDeSeccion => {
      if (sinMedir.has(ventana) || apartadas.has(`${magnitud.campo}.${ventana}`)) return FALTA_LA_VENTANA;
      const valor = valorEn(metricas, `${magnitud.campo}.${ventana}`);
      return valor === undefined || valor === null ? celdaVacia(metricas, ventana, apartadas) : magnitud.escribir(valor);
    });
    return celdas.every((celda) => typeof celda !== "string") ? [] : [[magnitud.rotulo, ...celdas]];
  });
  return {
    columnas: ["", ...presentes.map((v) => ROTULO_DE_VENTANA[v])],
    filas,
    /* Todas menos el rótulo: son cifras y comparten eje derecho, que es lo que permite
       leer una fila de izquierda a derecha sin recolocar la vista en cada columna. */
    cifras: presentes.map((_, indice) => indice + 1)
  };
}
const texto = (valor: unknown) => String(valor);

/** Lo que el proveedor da en inglés y no se traduce: traducirlo sin que Óscar lo revise sería ponerle palabras nuestras (decisión 82). */
const TEXTO_EN_INGLES = "Texto del proveedor, en inglés.";

/** `ARTICLE_8` → «Artículo 8». El contrato tiene tres (6, 8 y 9); otra cosa no se enseña en crudo: es que falta el dato. */
const articuloSfdr = (valor: unknown) => {
  const numero = /^ARTICLE_(\d+)$/.exec(String(valor))?.[1];
  return numero ? `Artículo ${numero}` : textoDeAusencia("falta");
};

/**
 * El codigo de la bolsa a su nombre. Hasta el 04-11-2026 se dejaba crudo para no inventar
 * nada, y delante de un cliente «Mercado: F» no dice nada. Decision 30 de Oscar: se nombran
 * las once de la nomenclatura del proveedor, que son todas las que hay en la base (medido ese
 * dia sobre las 300 acciones con bolsa). Lo que siga sin inventarse: un codigo que no este
 * aqui se ensena tal cual, sin adivinarle el nombre.
 */
const NOMBRE_DE_LA_BOLSA: Record<string, string> = {
  MC: "Madrid",
  MCE: "Madrid",
  US: "Estados Unidos",
  PA: "París",
  XETRA: "Xetra",
  LSE: "Londres",
  AS: "Ámsterdam",
  SW: "Suiza",
  F: "Fráncfort",
  TO: "Toronto",
  HE: "Helsinki",
  /* Las cuatro que entraron con las decisiones 38 y 40, el 08-11-2026. */
  BR: "Bruselas",
  ST: "Estocolmo",
  CO: "Copenhague",
  VI: "Viena"
};
const bolsaDe = (valor: unknown) => NOMBRE_DE_LA_BOLSA[String(valor)] ?? String(valor);

/** `declared/equity.listing.non_primary_reason` (decisión 46 del 08-11-2026) → por qué esta cotización no es la principal. */
const COTIZACION_NO_PRINCIPAL: Record<string, string> = {
  HOME_MARKET_NOT_AVAILABLE: "el mercado de origen no está disponible en la fuente",
  HOME_CURRENCY_NOT_AVAILABLE: "la línea en la divisa de origen no está disponible"
};

/**
 * La frase junto a la fuente del precio, en los dos modos. Nombra la cotización que se usa y no la de origen: el dato
 * no la trae. Tampoco habla de las métricas: la divisa no las mueve, porque toda serie se convierte a euros con el BCE.
 */
function fraseDeCotizacionNoPrincipal(equity: Documento | undefined, divisa: string): string | undefined {
  const motivo = COTIZACION_NO_PRINCIPAL[String(valorEn(equity, "listing.non_primary_reason"))];
  const bolsa = valorEn(equity, "listing.exchange");
  if (motivo === undefined || typeof bolsa !== "string") return undefined;
  return `Cotización de ${bolsaDe(bolsa)}${divisa ? ` en ${divisa}` : ""}: ${motivo}.`;
}

/** La línea de lo que se negocia, en ETF y acciones: la plaza, lo que se negocia al día y las sesiones sin volumen (decisión 108). */
function filaDeLoNegociado(dato: unknown): FilaDeFicha {
  const { texto: valor, falta, glosa } = lineaDeLoNegociado(dato as LoNegociado | undefined, bolsaDe);
  return { rotulo: "Negociación", valor, larga: true, ...(falta ? { ausencia: "falta" as const } : {}), ...(glosa ? { glosa } : {}) };
}

/** Las fuentes de los fundamentales de la base anterior, como se llaman. Otra se enseña tal cual. */
const NOMBRE_DE_LA_FUENTE: Record<string, string> = {
  yahoo: "Yahoo Finance",
  eodhd: "EODHD",
  finnhub: "Finnhub",
  andbank: "Andbank",
  robeco: "Robeco"
};

/**
 * El codigo de pais a su nombre. Lo traduce `Intl`, que es la lista del navegador: no
 * hay aqui un diccionario que se quede viejo.
 */
const paisDe = (valor: unknown) => {
  const codigo = String(valor);
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
};

/** La categoría de la raíz, con el nombre que se enseña (decisión 101). */
function categoriaDeLaRaiz(raiz: Documento | undefined): string | undefined {
  const categoria = valorEn(raiz, "classification.category");
  return typeof categoria === "string" ? categoriaLegible(categoria) : undefined;
}

/**
 * Las cinco aptitudes, cada una con LA CIFRA que la demuestra.
 *
 * Un «Sí» no vale: la tira contesta «qué puedes hacer con él» antes de que nadie lea
 * una cifra, y para eso tiene que traer la cifra. «Comparar su coste · 1,87 %» dice en
 * cuatro caracteres lo que un «Sí» obliga a ir a buscar tres secciones más abajo.
 */
/** Fuente/referencia del alfa de la tarjeta → contra qué se midió, en la tira. Los valores los escribe
    `2-plataforma-datos` (calidadYTarjeta.ts y mapper.ts). */
const CONTRA_QUE_SE_MIDE_EL_ALFA: Record<string, string> = {
  "COMPUTED/DECLARED_BENCHMARK_PROXY": "contra su índice",
  "COMPUTED/ASSIGNED_AREA_INDEX": "contra el índice de su área",
  "COMPUTED/ASSIGNED_MARKET_INDEX": "contra el índice de su plaza",
  "PROVIDER/PROVIDER_CATEGORY_INDEX": "del proveedor, contra el índice de su categoría"
};

/** `relative_absence` cuando no medir es una decisión sobre el fondo → la nota de «Frente a su índice». Por el KID
    (decisión 20 del 07-11-2026), con su frase entre comillas; o por la clase con cobertura de divisa (decisión 30),
    sin frase: sale del nombre de la clase. Los valores los escribe `2-plataforma-datos` (mapper.ts). */
export const SIN_RELATIVAS_POR_DECISION: Record<string, (frase: string) => string> = {
  KID_DECLARES_COMPOSITE: (frase) =>
    `Su KID declara un índice compuesto${frase ? ` (${frase})` : ""}; no medimos contra una sola de sus piezas.`,
  KID_DECLARES_NO_BENCHMARK: (frase) => `Su KID declara que no tiene índice de referencia${frase ? ` (${frase})` : ""}.`,
  HEDGED_SHARE_CLASS: () =>
    "Es una clase con cobertura de divisa y su índice no la lleva: no la medimos contra él, porque la diferencia sería la cobertura y no la gestión."
};

/** Quién dice el motivo: el KID del fondo, o el nombre de su clase. */
const QUIEN_DICE_EL_MOTIVO: Record<string, string> = {
  KID_DECLARES_COMPOSITE: "Según su KID",
  KID_DECLARES_NO_BENCHMARK: "Según su KID",
  HEDGED_SHARE_CLASS: "Según su clase"
};

/** `relative.benchmark.kid_confirmation` (decisión 21) → la reserva, solo en modo interno. */
export const KID_NO_CONFIRMA_EL_INDICE: Record<string, string> = {
  NOT_CONFIRMED: "El KID no confirma el índice que le atribuye el proveedor.",
  BRAND_ONLY: "El KID no confirma el índice que le atribuye el proveedor: solo nombra su familia."
};

/**
 * La frase del KID entre comillas. La base la guarda como la extrajo el contraste, hasta 200 caracteres y
 * cortada por los dos lados («encia temático que…»), así que se quita la palabra partida de cada extremo y se
 * dice con «…» que no es la frase entera. Sin frase, cadena vacía: el motivo se dice igual.
 */
export function fraseDelKid(texto: unknown): string {
  if (typeof texto !== "string") return "";
  let frase = texto.replace(/\s+/g, " ").trim();
  if (!frase) return "";
  const antes = /^[a-záéíóúñü]/.test(frase) && frase.includes(" ");
  if (antes) frase = frase.slice(frase.indexOf(" ") + 1);
  const despues = !/[.;:!?)»"]$/.test(frase) && frase.includes(" ");
  if (despues) frase = frase.slice(0, frase.lastIndexOf(" ")).replace(/[,;:]$/, "");
  return `«${antes ? "…" : ""}${frase}${despues ? "…" : ""}»`;
}

function aptitudesDe(
  tarjeta: Documento,
  raiz: Documento | undefined,
  politica: unknown
): AptitudDeFicha[] {
  const fitness = (valorEn(tarjeta, "quality.fitness") ?? {}) as Record<
    string,
    { apt?: boolean; missing?: string[] }
  >;
  const ROTULOS: Array<[string, string]> = [
    ["COMPARAR_COSTE", "Comparar su coste"],
    ["RADIOGRAFIA_DE_CARTERA", "Entrar en una radiografía"],
    ["COMPARAR_RENTABILIDAD", "Comparar su rentabilidad"],
    ["MOSTRAR_ALPHA", "Medir su alfa"],
    ["METRICAS_PROPIAS", "Métricas nuestras"],
    /* La sexta. La ficha pintaba cinco y la base calcula seis desde el principio: se vio
       el 02-11-2026 al contar las aptitudes del catálogo entero. 1.063 de 1.077 la
       tienen, así que no se echaba de menos; faltaba igual. */
    ["COMPARAR_CON_SU_GRUPO", "Compararlo con sus pares"]
  ];
  const mezcla = (valorEn(tarjeta, "exposure.asset_mix") ?? {}) as Record<string, number>;
  const mayor = Object.entries(mezcla).sort(([, a], [, b]) => b - a)[0];
  /* La rentabilidad de la tira es la de la tarjeta: la nuestra, en euros, o si no la hay, la del proveedor. */
  const divisaDeLaRentabilidad = valorEn(tarjeta, "metrics.source") === "PROVIDER" ? enLaDivisaDeLaClase(raiz) : "";
  const PRUEBA: Record<string, () => string> = {
    /* FMT-14: es apto, pero si el coste no está se dice, con el texto común; nunca «0,00 %». */
    COMPARAR_COSTE: () => {
      const coste = comoNumero(valorEn(tarjeta, "costs.ongoing_charge"));
      return Number.isFinite(coste) ? pct(coste) : `Sí · ${textoDeAusencia("falta").toLocaleLowerCase("es")}`;
    },
    RADIOGRAFIA_DE_CARTERA: () =>
      mayor ? `${pesoDe(mayor[1])} ${etiquetaDeReparto(mayor[0]).toLowerCase()}` : "Sí",
    COMPARAR_RENTABILIDAD: () =>
      `${pctConSigno(valorEn(tarjeta, "metrics.annualized_return.1y"))} a 1 año${divisaDeLaRentabilidad}`,
    /* Un alfa sin decir contra qué no se puede defender: el nuestro mide contra el índice que declara el fondo (o el
       que elegimos para una acción) y el del proveedor contra el de su categoría. Son comparadores distintos. Si la
       pareja fuente-referencia no es una de las conocidas, va la cifra sola: no se inventa contra qué. */
    MOSTRAR_ALPHA: () => {
      const cifra = `${pctConSigno(valorEn(tarjeta, "metrics.relative.jensen_alpha.1y"))} a 1 año`;
      const pareja = `${String(valorEn(tarjeta, "metrics.relative.source"))}/${String(valorEn(tarjeta, "metrics.relative.reference"))}`;
      /* Medido contra un índice equivalente al que declara, «su índice» sería afirmar lo que no es. */
      const contra =
        pareja === "COMPUTED/DECLARED_BENCHMARK_PROXY" && typeof valorEn(tarjeta, "metrics.relative.benchmark.equivalent_of") === "string"
          ? "contra un índice equivalente al suyo"
          : CONTRA_QUE_SE_MIDE_EL_ALFA[pareja];
      return contra ? `${cifra} · ${contra}` : cifra;
    },
    METRICAS_PROPIAS: () => {
      const metodo = String(valorEn(tarjeta, "metrics.method") ?? "");
      return metodo.includes("DAILY") ? "Sí, método diario" : "Sí, método mensual";
    },
    COMPARAR_CON_SU_GRUPO: () => clasificacionDeTarjeta(tarjeta) ?? "Sí"
  };

  return ROTULOS.map(([clave, rotulo]) => {
    const dato = fitness[clave];
    /* Decisión 44: lo que nunca se resolvió no entra en una cartera, así que tampoco en su radiografía, por más que su tipo
       diga cuál sería su reparto. */
    if (clave === "RADIOGRAFIA_DE_CARTERA" && valorEn(raiz, "availability.state") === "NEVER_RESOLVED") {
      return { rotulo, valor: "No aplica", estado: "no-aplica" as const };
    }
    if (dato?.apt) {
      /* Si la cifra que lo demuestra no está, la aptitud sigue siendo cierta: se dice
         «Sí» y no se inventa el número. */
      const prueba = PRUEBA[clave]?.() ?? "Sí";
      return { rotulo, valor: prueba.includes(textoDeAusencia("falta")) ? "Sí" : prueba, estado: "si" as const };
    }
    /* La base escribe «no aplica: …» delante cuando el uso no tiene sentido para este
       tipo de instrumento. Es la misma distinción que las filas, y viene del dato. */
    const motivo = dato?.missing?.[0] ?? "";
    /* Lo que le falta a esta aptitud no es la rentabilidad, que está en la página, sino saber si la
       clase reparte. «Falta el dato» junto a dos juegos de cifras se lee como que falta lo que tiene. */
    const rentabilidadPropia = valorEn(tarjeta, "metrics.annualized_return.1y");
    if (clave === "COMPARAR_RENTABILIDAD" && politica === "UNKNOWN" && typeof rentabilidadPropia === "number") {
      return {
        rotulo,
        valor: `${pctConSigno(rentabilidadPropia)} a 1 año${divisaDeLaRentabilidad} · reparto sin confirmar`,
        estado: "reserva" as const
      };
    }
    /* Una clase que reparte no tiene métricas nuestras por decisión, no porque falte nada. */
    const noAplicaPorMetodo =
      clave === "METRICAS_PROPIAS" &&
      (valorEn(tarjeta, "metrics.distribution_policy") === "DISTRIBUTING" ||
        valorEn(raiz, "metrics_absence.reason") === "NOT_APPLICABLE");
    const noAplica = motivo.startsWith("no aplica") || noAplicaPorMetodo;
    return {
      rotulo,
      valor: noAplica ? "No aplica" : "Falta el dato",
      estado: noAplica ? ("no-aplica" as const) : ("falta" as const)
    };
  });
}

/** Un motivo de la base, con su punto final y sin espacios de sobra; `null` si no hay. */
function motivoEscrito(motivo: unknown): string | null {
  if (typeof motivo !== "string" || !motivo.trim()) return null;
  const limpio = motivo.trim();
  return /[.!?]$/.test(limpio) ? limpio : `${limpio}.`;
}

/**
 * De dónde sale una baja (decisión 13 de DECISIONES_DATOS_2026-11-07). «Dejó de cotizar» puede ser un juicio
 * nuestro —la CAM, NH, Ercros: ninguna fuente de precio lo prueba, o dice otra cosa— o lo que contesta la fuente
 * del precio —Aena, por ISIN sustituido—, y un asesor tiene que poder decir cuál de las dos delante del cliente.
 * Sin `basis` es un documento anterior al campo, y el contrato manda leerlo como SOURCE_EVIDENCE, que era lo único
 * que existía. El motivo es el de la base, entero; si no hay, no se escribe ninguno.
 *
 * En Modo cliente, la baja decidida dice que la decidió la entidad y por qué, sin el autor ni la fecha de la decisión
 * (`autorDeUnaDecision`); la de la fuente no lleva su motivo, que es la cadena de proveedores que lo prueba
 * (`fuenteDeDatos`).
 */
function origenDeLaBaja(raiz: Documento, modoCliente: boolean): Trozo[] {
  if (valorEn(raiz, "availability.basis") === "DECISION") {
    const motivo = motivoEscrito(valorEn(raiz, "availability.decision.reason"));
    if (!seEnsena("autorDeUnaDecision", modoCliente)) {
      return [{ texto: "Baja decidida por la entidad", fuerte: true }, { texto: motivo ? `: ${motivo}` : "." }];
    }
    const autor = valorEn(raiz, "availability.decision.decided_by");
    const fecha = valorEn(raiz, "availability.decision.decided_at");
    const quienYCuando = [typeof autor === "string" && autor.trim() ? autor.trim() : null, fecha ? dia(String(fecha)) : null]
      .filter(Boolean)
      .join(", ");
    return [
      { texto: "Baja decidida por nosotros", fuerte: true },
      { texto: `${quienYCuando ? ` (${quienYCuando})` : ""}${motivo ? `: ${motivo}` : "."}` }
    ];
  }
  const motivo = seEnsena("fuenteDeDatos", modoCliente) ? motivoEscrito(valorEn(raiz, "availability.reason")) : null;
  return [
    { texto: "Lo dice la fuente del precio", fuerte: true },
    { texto: motivo ? `, no una decisión nuestra: ${motivo}` : ", no una decisión nuestra: ya no lo da como cotizando." }
  ];
}

/** El estado de cotización, que se marca con la fecha y no con un adjetivo. */
export function disponibilidadDe(raiz: Documento, modoCliente = false): FichaInstrumento["disponibilidad"] {
  const estado = valorEn(raiz, "availability.state");
  const desde = valorEn(raiz, "availability.since");
  /* NH Hotel Group, por decisión de Óscar del 12-11-2026: no se negocia y se sigue valorando a su último precio. La fecha es la de la
     base y el precio, el de la política del histórico. De dónde sale la baja se sigue diciendo. */
  const isin = valorEn(raiz, "instrument_id");
  if (estado === "DELISTED" && typeof isin === "string" && valoradoAPrecioCongelado(isin)) {
    return { ...rotuloDePrecioCongelado(isin, desde), estado: "baja", nota: origenDeLaBaja(raiz, modoCliente) };
  }
  if (estado === "DELISTED") {
    return { rotulo: "Dejó de cotizar", valor: dia(String(desde)), estado: "baja", nota: origenDeLaBaja(raiz, modoCliente) };
  }
  /* Decisión 44: se marca como lo que dejó de cotizar, y con el motivo por el que no entra en una cartera. Los dos trozos
     juntos son `NO_SE_ANADE_SIN_MEDIR`. No lleva fecha: la que hay es la de cuando se anotó, no dice nada del instrumento. */
  if (estado === "NEVER_RESOLVED") {
    return { rotulo: "No se añade: ", valor: "sin precio ni métricas.", estado: "baja" };
  }
  if (estado === "TRADING") {
    const comprobado = valorEn(raiz, "availability.last_checked");
    return {
      rotulo: "Cotizando",
      valor: comprobado ? `Comprobado ${dia(String(comprobado))}` : "Sin fecha",
      estado: "cotiza"
    };
  }
  /* Ausente no es «no cotiza»: es que no se ha comprobado. Les pasa a los fondos, que
     no pasan por el buscador de símbolos del proveedor. */
  return { rotulo: "Disponibilidad", valor: "Sin medir", estado: "sin-medir" };
}

/**
 * Las regiones de la ficha, sin contar nada dos veces (decisión 7). En la forma antigua, el total de Asia lleva debajo
 * su parte emergente, y «Otras» no sale: es Canadá y África más una clave que repite los emergentes, y un fondo de la
 * India no está un 100 % en «Otras». Son las cifras del proveedor tal cual, sin normalizar, y por eso sin Canadá y África
 * pueden no llegar a 100: la nota lo explica.
 */
export function seccionDeRegiones(reparto: Record<string, number>): Pick<SeccionDeFicha, "filas" | "nota"> {
  const { zonas, sinZona, asiaEmergenteDentroDeAsia, canadaYAfricaSinSeparar } = zonasDeUnReparto(reparto);
  const filas: FilaDeFicha[] = Object.entries(zonas)
    .sort(([, a], [, b]) => b - a)
    .flatMap(([clave, peso]) => [
      { rotulo: etiquetaDeReparto(clave), valor: pesoDe(peso), peso },
      ...(clave === "asia" && asiaEmergenteDentroDeAsia !== null
        ? [{ rotulo: "de la cual emergente", valor: pesoDe(asiaEmergenteDentroDeAsia), peso: asiaEmergenteDentroDeAsia }]
        : [])
    ]);
  if (sinZona > 0) filas.push({ rotulo: etiquetaDeReparto("sin_zona"), valor: pesoDe(sinZona), peso: sinZona });
  return { filas, nota: canadaYAfricaSinSeparar ? `${NOTA_CANADA_Y_AFRICA}.` : undefined };
}

/** Lo que a la precisión escrita es cero no lleva signo: «−0,0 %» no dice ninguna cifra (decisión 113). El módulo común ya lo escribe así. */
const pesoEscrito = (peso: number) => pesoDe(peso);

/**
 * La caja de estilo y tamaño del fondo (decisión A-123): las nueve celdas de `declared/exposure.equity_style_box`, en % de su renta
 * variable y con la precisión de las barras de Estilo y Tamaño, que son sus sumas por columna y por fila. La mayor va destacada y
 * se dice como «la celda con más peso», no como el estilo de Morningstar: Morningstar no nos da su casilla, solo las celdas.
 *
 * Solo con las nueve y sumando 1 con la tolerancia de la plataforma (`nueveCeldas`, la misma que la radiografía): si no, no hay
 * sección ni hueco (decisión B-17: un campo presente donde no aplica es un error). Una celda puede ser negativa, que es lo neto de
 * cortos, o pasar del 100 %, porque el proveedor reescala lo neto a 100: las dos cosas se dicen en la nota.
 */
export function seccionDeLaCaja(exposicion: Documento | undefined): SeccionDeFicha | undefined {
  const celdas = nueveCeldas(valorEn(exposicion, "equity_style_box") as Record<string, unknown> | undefined);
  if (!celdas) return undefined;
  const pesos = FILAS_DE_LA_CAJA.flatMap((fila) => COLUMNAS_DE_LA_CAJA.map((columna) => celdas[`${fila}_${columna}`]));
  /* La mayor, a la precisión escrita: dos celdas que se leen iguales no se distinguen por un decimal que no se ve. */
  const mayor = Math.max(...pesos);
  const esLaMayor = (peso: number) => mayor > 0 && pesoEscrito(peso) === pesoEscrito(mayor);
  const caja: CajaDeFicha = {
    columnas: COLUMNAS_DE_LA_CAJA.map((columna) => etiquetaDeReparto(columna)),
    filas: FILAS_DE_LA_CAJA.map((fila) => ({
      rotulo: etiquetaDeReparto(fila),
      celdas: COLUMNAS_DE_LA_CAJA.map((columna) => {
        const peso = celdas[`${fila}_${columna}`];
        return { valor: pesoEscrito(peso), peso, ...(esLaMayor(peso) ? { destacada: true } : {}) };
      })
    }))
  };
  const mayores = caja.filas.flatMap((fila) =>
    fila.celdas.flatMap((celda, indice) => (celda.destacada ? [`${fila.rotulo.toLowerCase()} · ${caja.columnas[indice].toLowerCase()}`] : []))
  );
  const enLista = (lista: string[]) => (lista.length > 1 ? `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}` : lista[0]);
  const queMayor =
    mayores.length === 0
      ? ""
      : mayores.length === 1
        ? ` La celda con más peso, destacada: ${mayores[0]}, ${pesoEscrito(mayor)}.`
        : ` Las celdas con más peso, empatadas y destacadas: ${enLista(mayores)}, ${pesoEscrito(mayor)} cada una.`;
  const negativa = pesos.some((peso) => pesoEscrito(peso).startsWith("−"));
  const masDeCien = pesos.some((peso) => peso > 1 && pesoEscrito(peso) !== pesoEscrito(1));
  const deLosCortos = negativa
    ? ` ${NOTA_DE_CORTOS}${masDeCien ? ", y el proveedor reescala lo neto al 100 %, así que otra pasa del 100 %" : ""}.`
    : masDeCien
      ? " El proveedor reescala lo neto de cortos al 100 %: por eso una celda pasa del 100 %."
      : "";
  return {
    id: "caja-de-estilo",
    titulo: "Caja de estilo y tamaño",
    procedencia: fuente("Taxonomía del proveedor", valorEn(exposicion, "as_of")),
    filas: [],
    caja,
    nota: `En % de la renta variable.${queMayor}${deLosCortos}`
  };
}

/**
 * «, en USD» si la clase no va en euros. Las cifras del proveedor van en la divisa de la clase y las nuestras y la gráfica, en euros (§5 del método): el
 * oro hace 24,97 % a 3 años en dólares y 22,72 % en euros a la misma fecha, y sin decirlo se leen como la misma cosa. No se convierte nada: se dice (decisión 113).
 */
function enLaDivisaDeLaClase(raiz: Documento | undefined): string {
  const divisa = valorEn(raiz, "identity.currency");
  return typeof divisa === "string" && divisa !== "" && divisa !== "EUR" ? `, en ${divisa}` : "";
}

function fuente(etiqueta: string, fecha: unknown): Trozo[] {
  const trozos: Trozo[] = [{ texto: etiqueta, fuerte: true }];
  if (fecha) trozos.push({ texto: ` · ${dia(String(fecha))}` });
  return trozos;
}

/** Las ventanas del proveedor cuya fecha está medida: la de su bloque (decisión 114). */
const VENTANAS_CON_SU_FECHA = ["3y", "5y", "10y"];

/**
 * De dónde y de cuándo son las rentabilidades del proveedor (decisión 114). Su fecha vale para 3, 5 y 10 años; su 1 año y «En el año» llegan de otra
 * respuesta suya, con su propia fecha, que el extractor no guarda, y en muchos fondos son del cierre del mes siguiente: JPMorgan Taiwan D (acc) da
 * a 1 año exactamente su serie a 30 oct, y a 3 años, a 30 sept, que es la fecha del bloque. Así que esas dos salen sin fecha. Sin ellas, como siempre.
 */
function procedenciaDeLaRentabilidad(etiqueta: string, fecha: unknown, ventanas: readonly string[], porVentana?: unknown): Trozo[] {
  if (porVentana && typeof porVentana === "object") return procedenciaPorVentana(etiqueta, fecha, ventanas, porVentana as Record<string, unknown>);
  if (!fecha || ventanas.every((ventana) => VENTANAS_CON_SU_FECHA.includes(ventana))) return fuente(etiqueta, fecha);
  const anos = ventanas.filter((ventana) => VENTANAS_CON_SU_FECHA.includes(ventana)).map((ventana) => ventana.replace("y", ""));
  if (anos.length === 0) return fuente(`${etiqueta}, sin fecha`, undefined);
  const enLista = anos.length > 1 ? `${anos.slice(0, -1).join(", ")} y ${anos[anos.length - 1]}` : anos[0];
  return [{ texto: etiqueta, fuerte: true }, { texto: ` · ${enLista} años a ${dia(String(fecha))}` }];
}

/** «1 año», «3, 5 y 10 años», «1 año y en el año». */
function ventanasDeLaRentabilidad(ventanas: readonly string[]): string {
  const anos = ventanas.filter((ventana) => ventana !== "ytd").map((ventana) => ventana.replace("y", ""));
  const partes: string[] = [];
  if (anos.length > 0) {
    const lista = anos.length > 1 ? `${anos.slice(0, -1).join(", ")} y ${anos[anos.length - 1]}` : anos[0];
    partes.push(`${lista} ${anos.length === 1 && anos[0] === "1" ? "año" : "años"}`);
  }
  if (ventanas.includes("ytd")) partes.push("en el año");
  return partes.join(" y ");
}

/**
 * Con `as_of_by_window` (decisión B-74, Óscar, 09-11-2026) cada cifra del proveedor lleva la fecha de su ventana: Morningstar da el 1 año y el año en
 * curso a fin de mes y el 3, 5 y 10 años a fin de trimestre. Se agrupan por fecha, en el orden de las filas. Si las que se enseñan comparten una, es
 * esa; una ventana que el mapa no fecha, que el contrato no prevé, sale «sin fecha», y no con la del bloque, que es solo la más reciente.
 */
function procedenciaPorVentana(etiqueta: string, fecha: unknown, ventanas: readonly string[], porVentana: Record<string, unknown>): Trozo[] {
  if (ventanas.length === 0) return fuente(etiqueta, fecha);
  const grupos = new Map<string, string[]>();
  for (const ventana of ventanas) {
    const suya = porVentana[ventana];
    const clave = typeof suya === "string" ? suya : "";
    grupos.set(clave, [...(grupos.get(clave) ?? []), ventana]);
  }
  if (grupos.size === 1) {
    const [unica] = grupos.keys();
    return unica ? fuente(etiqueta, unica) : fuente(`${etiqueta}, sin fecha`, undefined);
  }
  return [
    { texto: etiqueta, fuerte: true },
    ...[...grupos].map(([suFecha, suyas]) => ({
      texto: ` · ${ventanasDeLaRentabilidad(suyas)}${suFecha ? ` a ${dia(suFecha)}` : ", sin fecha"}`
    }))
  ];
}

/**
 * De dónde salen coste corriente, operación y entrada (decisión 43): se escribe «KID» solo si la cifra sale de ese documento, con
 * la fecha del documento. Hasta el 05-11-2026 la sección decía «Del KID» con la fecha de la ficha, también con las tres del proveedor.
 */
function procedenciaDeLosCostes(costes: Documento | undefined): Trozo[] {
  const cifras: Array<[string, string]> = [["el coste corriente", "ongoing_charge"], ["la operación", "transaction_costs"], ["la entrada", "entry_charge"]];
  const conCifra = cifras.filter(([, campo]) => valorEn(costes, campo) !== undefined);
  const delKid = conCifra.filter(([, campo]) => valorEn(costes, `${campo}_source`) === "KID");
  if (delKid.length === 0) return fuente("Del proveedor", valorEn(costes, "as_of"));
  const fecha = valorEn(costes, "document_date");
  const trozos = fuente(fecha ? "Del KID" : "Del KID, sin fecha", fecha);
  const otras = conCifra.filter((cifra) => !delKid.includes(cifra)).map(([nombre]) => nombre);
  if (otras.length > 0) trozos.push({ texto: ` · ${otras.join(" y ")}, del proveedor` });
  return trozos;
}

/**
 * De dónde sale el indicador regulatorio, con la regla del coste (decisiones 43 y 92): «KID» solo si la cifra sale de ese documento, con su
 * fecha. El SRI solo se escribe con su KID detrás (`kid_evidence`, que lleva la fecha del propio documento); el SRRI es el que recoge el
 * proveedor, sin documento ni fecha propios. Hasta el 06-11-2026 la cabecera decía «KID de PRIIPs y UCITS» con la fecha de la ficha: el SRI
 * de un KID de febrero de 2024 salía con la de octubre de 2026, y un ETF sin KID nombraba uno.
 */
function procedenciaDelIndicador(regulatorio: Documento | undefined): Trozo[] {
  if (valorEn(regulatorio, "sri") === undefined) return fuente("Del proveedor", valorEn(regulatorio, "as_of"));
  const fecha = valorEn(regulatorio, "kid_evidence.document_date");
  const trozos = fuente(fecha ? "Del KID" : "Del KID, sin fecha", fecha);
  if (valorEn(regulatorio, "srri") !== undefined) trozos.push({ texto: " · el SRRI, del proveedor" });
  return trozos;
}

/** La rentabilidad en lo que va de año, como primera columna de cifras de la tabla de ventanas. */
function conColumnaDelAnio(
  tabla: NonNullable<SeccionDeFicha["tabla"]>,
  valor: string
): NonNullable<SeccionDeFicha["tabla"]> | null {
  const filaDeRentabilidad = tabla.filas.findIndex((filaDeTabla) => /^Rentabilidad/.test(String(filaDeTabla[0])));
  if (filaDeRentabilidad < 0) return null;
  return {
    ...tabla,
    /* «YTD», como en la captura que eligió Óscar el 17-11-2026: antes «En el año». */
    columnas: [tabla.columnas[0], "YTD", ...tabla.columnas.slice(1)],
    cifras: tabla.cifras ? [1, ...tabla.cifras.map((indice) => (indice >= 1 ? indice + 1 : indice))] : undefined,
    filas: tabla.filas.map((filaDeTabla, indice) => [filaDeTabla[0], indice === filaDeRentabilidad ? valor : "", ...filaDeTabla.slice(1)])
  };
}

/** Compone la ficha. Las secciones que no tienen bloque no se pintan. */
/**
 * Los fundamentales del emisor, que la base nueva NO tiene y la ficha no puede perder.
 *
 * Medido el 02-11-2026 sobre la base de siempre: **306 de las 312 acciones** traen
 * capitalización, 302 el beneficio por acción, 292 la beta, 207 el PER y 178 la
 * rentabilidad por dividendo. La ficha anterior las enseñaba todas en su pestaña
 * «Fundamentales», así que sustituirla sin ellas le quitaría al asesor cinco cifras de
 * cada acción del catálogo. El rediseño cambia cómo se ve, no lo que la aplicación hace.
 *
 * Por qué no están en la base nueva, y no es un olvido: son de la EMPRESA y no de la
 * acción, y su sitio es `issuers/{id}/fundamentals/latest`, un contrato que existe y que
 * F1 no puebla porque emparejar cada nombre con su entidad es una decisión humana por
 * instrumento. Lo dice el mapper de la plataforma donde las cuenta como pérdida.
 *
 * Así que vienen de la base de siempre, y la sección lo dice en su procedencia. El día
 * que la base nueva pueble los emisores, esta sección cambia de origen y nada más.
 */
export interface FundamentalesDelEmisor {
  source?: string;
  /** A qué fecha son: el principio 1 de la dirección. Sin ella, se dice «sin fecha». */
  as_of_date?: string;
  currency?: string;
  valuation?: Record<string, number>;
  profitability?: Record<string, number>;
  growth?: Record<string, number>;
  fund_metrics?: Record<string, number>;
}

/** Una fila de una sección cuyo dato NO viene de la base nueva: sin clase de ausencia,
    porque la base nueva no puede decir por qué falta algo que no guarda. */
function filaAjena(rotulo: string, valor: number | undefined, escribir: (v: number) => string): FilaDeFicha {
  return valor === undefined || !Number.isFinite(valor)
    ? { rotulo, valor: ETIQUETA_POR_CLASE.falta, ausencia: "falta" }
    : { rotulo, valor: escribir(valor) };
}

function seccionesDeFundamentales(
  fundamentales: FundamentalesDelEmisor | undefined,
  modoCliente: boolean,
  /** La ficha ya enseña el patrimonio declarado por el proveedor: dos «Patrimonio» sin poder distinguirlos no. */
  yaTienePatrimonio: boolean
): SeccionDeFicha[] {
  if (fundamentales === undefined) return [];
  const divisa = fundamentales.currency;
  const dinero = (v: number) => importeGrande(v, divisa);
  /* Un múltiplo de valoración: un ratio, con su «×». */
  const multiplo = (v: number) => `${num(v)}×`;
  const fuenteDelEmisor = fundamentales.source
    ? (NOMBRE_DE_LA_FUENTE[fundamentales.source.toLowerCase()] ?? fundamentales.source)
    : "sin fuente declarada";
  /* De qué proveedor viene no se le cuenta al cliente: es cocina, y la cifra no cambia por saberlo. */
  /* La fecha se queda siempre: junto a un precio de ayer, un PER de marzo sin fecha se lee como de ayer. */
  const fecha = ` · ${fundamentales.as_of_date ? `a ${dia(fundamentales.as_of_date)}` : "sin fecha"}`;
  const procedencia: Trozo[] = seEnsena("fuenteDeDatos", modoCliente)
    ? [{ texto: "Datos del emisor · " }, { texto: fuenteDelEmisor, fuerte: true }, { texto: fecha }]
    : [{ texto: "Datos del emisor", fuerte: true }, { texto: fecha }];
  const nota = "Cifras del emisor, de un proveedor de datos; no las calculamos nosotros.";

  const secciones: SeccionDeFicha[] = [];
  const v = fundamentales.valuation;
  if (v !== undefined) {
    secciones.push({
      id: "valoracion",
      titulo: "Valoración",
      procedencia,
      nota,
      filas: [
        filaAjena("Capitalización", v["market_cap"], dinero),
        filaAjena("Valor de empresa", v["enterprise_value"], dinero),
        filaAjena("PER", v["pe_trailing"], multiplo),
        filaAjena("PER adelantado", v["pe_forward"], multiplo),
        filaAjena("PEG", v["peg"], multiplo),
        filaAjena("Precio / ventas", v["price_sales_ttm"], multiplo),
        filaAjena("Precio / valor contable", v["price_book_mrq"], multiplo),
        filaAjena("EV / EBITDA", v["ev_ebitda"], multiplo)
      ]
    });
  }
  const r = fundamentales.profitability;
  const c = fundamentales.growth;
  if (r !== undefined || c !== undefined) {
    secciones.push({
      id: "rentabilidad-emisor",
      titulo: "Rentabilidad y crecimiento",
      procedencia,
      nota,
      filas: [
        /* Márgenes y rendimientos contables: dos decimales, sin «+». El crecimiento es la variación de un periodo, con su signo. */
        filaAjena("Margen neto", r?.["profit_margin"], (x) => pct(x)),
        filaAjena("Margen operativo", r?.["operating_margin_ttm"], (x) => pct(x)),
        filaAjena("ROA", r?.["return_on_assets_ttm"], (x) => pct(x)),
        filaAjena("ROE", r?.["return_on_equity_ttm"], (x) => pct(x)),
        filaAjena("Crecimiento de ingresos", c?.["quarterly_revenue_yoy"], (x) => pctConSigno(x)),
        filaAjena("Crecimiento de beneficios", c?.["quarterly_earnings_yoy"], (x) => pctConSigno(x))
      ]
    });
  }
  const f = fundamentales.fund_metrics;
  if (f !== undefined) {
    secciones.push({
      id: "etf",
      titulo: "Datos del ETF",
      procedencia,
      nota,
      filas: [
        ...(yaTienePatrimonio ? [] : [filaAjena("Patrimonio", f["total_assets"], dinero)]),
        /* El proveedor los da en por ciento, no en tanto por uno. */
        filaAjena("Rentabilidad por dividendo", f["yield_pct"], (x) => pct(x / 100)),
        filaAjena("Rotación", f["turnover_pct"], (x) => pct(x / 100))
      ]
    });
  }
  return secciones;
}

/** Lo que el Modo cliente deja de contar cuando no hay métricas nuestras: el motivo es cocina. */
const SIN_METRICAS_QUE_SE_EXPLICAN = new Set(["DISTRIBUTES", "SERIES_STOPPED", "SHORT_HISTORY"]);

export function componerFicha(
  instrumento: InstrumentoDeLaBase,
  fundamentales?: FundamentalesDelEmisor,
  { modoCliente = false, hoy = new Date() }: { modoCliente?: boolean; hoy?: Date } = {}
): FichaInstrumento {
  const { raiz, tarjeta, calidad, bloques } = instrumento;
  const contexto: Contexto = { instrumento, ausencias: indiceDeAusencias(calidad), modoCliente };
  const esAccion = valorEn(raiz, "instrument_type") === "STOCK";
  const politicaDeReparto = valorEn(bloques["declared/profile"], "distribution_policy");
  /* El simbolo cuando lo conocemos, y el codigo cuando no: «3,556 USD» es feo pero
     cierto, y «3,556 $» para un dolar australiano seria falso. */
  const SIMBOLO: Record<string, string> = { EUR: "€", USD: "USD", GBP: "£", CHF: "CHF" };
  /* La divisa de la clase no es la de su precio: iShares Core MSCI World es una clase en USD y su precio
     está en euros. El bloque del precio la dice desde el 05-11-2026. Si no la trae, que es lo que hay en la
     nube hasta que se suba el catálogo, en un ETF no se escribe ninguna: un precio con la divisa cambiada
     es un error del 12 %. En un fondo el valor liquidativo va en la divisa de su clase, y en una acción la
     divisa es la de su bolsa. No se nombra el mercado: en iShares, el precio es el que da justETF, y el
     cierre de Xetra de ese día es otro, el de su serie. */
  const divisaDeLaCotizacion = valorEn(bloques["declared/quote"], "currency");
  const divisaDelPrecioDesconocida = typeof divisaDeLaCotizacion !== "string" && valorEn(raiz, "instrument_type") === "ETF";
  const codigo = String(typeof divisaDeLaCotizacion === "string" ? divisaDeLaCotizacion : (valorEn(raiz, "identity.currency") ?? ""));
  const divisa = SIMBOLO[codigo] ?? codigo;
  const enSuDivisa = enLaDivisaDeLaClase(raiz);
  const hay = (sufijo: string) => bloques[sufijo] !== undefined;
  const secciones: SeccionDeFicha[] = [];

  if (hay("declared/quote")) {
    const clase = valorEn(bloques["declared/quote"], "price_class");
    const esFondoDeVl = clase === "NAV";
    const fraseDeCotizacion = fraseDeCotizacionNoPrincipal(bloques["declared/equity"], codigo);
    secciones.push({
      id: "precio",
      titulo: "Precio",
      procedencia: fuente(
        esFondoDeVl ? "Valor liquidativo" : "Precio de mercado",
        valorEn(bloques["declared/quote"], "as_of")
      ),
      nota: esFondoDeVl
        ? undefined
        : "De mercado, no valor liquidativo. Un fondo se suscribe al VL del día; una acción se compra al precio al que alguien la vende." +
          (divisaDelPrecioDesconocida ? " La fuente de este precio no dice en qué divisa está." : "") +
          (fraseDeCotizacion ? ` ${fraseDeCotizacion}` : ""),
      filas: [
        fila(
          contexto,
          esFondoDeVl ? "Valor liquidativo" : "Último",
          "declared/quote.price",
          /* De dos a cuatro decimales, con su divisa detrás y espacio duro. */
          (v) => (divisaDelPrecioDesconocida || !divisa ? precio(comoNumero(v)) : `${precio(comoNumero(v))}\u00a0${divisa}`),
          { destacada: true }
        ),
        ...(esFondoDeVl ? [] : [filaDeLoNegociado(valorEn(bloques["declared/quote"], "trading"))])
      ]
    });
  }

  /* Lo que sale del bloque del emisor (decisiones 51, 52 y 55) no se compone en Modo cliente: sus datos son de uso interno para el
     desarrollo y no entran en lo que ve un cliente (decisión 53). La aptitud de reparto de la cabecera se queda: viene de la tarjeta.
     Y la política de reparto que rellena el emisor tampoco depende de esto: sale en el Perfil sin su fuente (decisión B-65). */
  const conElEmisor = seEnsena("datosDelEmisor", modoCliente);

  /* El VL del emisor es un dato aparte del precio y no toca ninguna cifra (decisión 52). */
  const seccionDelVl = conElEmisor ? seccionDelEmisorJuntoAlPrecio(instrumento) : undefined;
  if (seccionDelVl) secciones.push(seccionDelVl);

  /* Por magnitud manda una sola fuente (decisiones 8, 21 y 12): donde hay cifra nuestra no sale la del
     proveedor, y donde no la hay, sale con su fecha. Se decide ventana a ventana (decisión 110). Lo que toca la fecha desde la que vale
     la serie no sale de nadie (decisión 112): la del proveedor es la misma cifra sobre la misma historia sin revisar. */
  const hayNuestra = hay("computed/metrics");
  const antesDeLaSerie = (valorEn(tarjeta, "metrics.windows_before_series_valid_from") ?? []) as string[];
  const saleLaDelProveedor = (ventana: string, rutaDeLaNuestra: string, rutaDelProveedor: string) =>
    !antesDeLaSerie.includes(ventana) &&
    (!hayNuestra ||
      (valorEn(bloques["computed/metrics"], rutaDeLaNuestra) === undefined &&
        documentoDeLaRuta(instrumento, rutaDelProveedor) !== undefined &&
        valorEn(documentoDeLaRuta(instrumento, rutaDelProveedor), rutaInterna(rutaDelProveedor)) !== undefined));

  if (hay("computed/metrics")) {
    const metricas = bloques["computed/metrics"];
    /* Las ventanas a las que la serie llega y no se enseñan, y por qué. La fila con las cifras sigue en el documento: es la fuente. */
    const huecos = (valorEn(metricas, "inputs.series_gaps") ?? []) as HuecoDeLaSerie[];
    const sinMedir = new Set([...antesDeLaSerie, ...huecos.flatMap((hueco) => hueco.windows)]);
    /* Las que se salen de su rango: bloquean solo su cifra, con el motivo a la vista (decisión B-73). */
    const apartadas = cifrasApartadas(tarjeta, metricas, modoCliente);
    const rutasApartadas = new Set(apartadas.map(({ ruta }) => ruta));
    const esDelIndice = ({ ruta }: CifraApartada) => ruta.startsWith("relative.");
    /* El Sharpe y el Sortino de una acción no se enseñan (Óscar, 04-11-2026; §9 del método). */
    const tablaPropia = tablaDeVentanas(
      metricas,
      MAGNITUDES_DE_LA_TABLA.filter(
        (magnitud) =>
          (magnitud.campo !== "sharpe" && magnitud.campo !== "sortino") ||
          seEnsenaLaMetrica(magnitud.campo, valorEn(raiz, "instrument_type") as string | undefined)
      ),
      sinMedir,
      rutasApartadas
    );
    const enLaTabla = (celda: CeldaDeSeccion) => tablaPropia?.filas.some((f) => f.includes(celda)) ?? false;
    const conEstr = !esAccion && !sinMedir.has("10y") && valorEn(metricas, "annualized_return.10y") !== undefined && valorEn(metricas, "sharpe.10y") === undefined;
    const columnaDeDiez = tablaPropia?.columnas.indexOf(ROTULO_DE_VENTANA["10y"]) ?? -1;
    /* Los del €STR ya tienen su motivo escrito; los demás se explican con la nota general. */
    const noCalculadoSinMotivo = tablaPropia?.filas.some((f) =>
      f.some((celda, indice) => celda === NO_CALCULADO && !(conEstr && indice === columnaDeDiez && (f[0] === "Sharpe" || f[0] === "Sortino")))
    );
    /* «En el año» no es una ventana, y la cifra es nuestra: no cabe en la tabla ni debe perderse al
       quitar la del proveedor. */
    const enElAnio = antesDeLaSerie.includes("ytd") ? undefined : valorEn(metricas, "ytd_return");
    /* En su propia columna, delante de las ventanas: como fila suelta sobre la tabla no alineaba con ninguna cifra, y
       su filete se cortaba a media sección. */
    const tablaConElAnio = typeof enElAnio === "number" && tablaPropia ? conColumnaDelAnio(tablaPropia, pctConSigno(enElAnio)) : null;
    secciones.push({
      id: "metricas",
      titulo: "Nuestras métricas",
      procedencia: [
        { texto: "Calculadas por nosotros", fuerte: true },
        { texto: ` · ${NOMBRE_DEL_METODO[String(valorEn(metricas, "method"))] ?? String(valorEn(metricas, "method") ?? "")}${valorEn(metricas, "inputs.series_class") === "MARKET_PRICE" ? " sobre precio de mercado" : ""} · ${valorEn(metricas, "as_of") ? `a ${dia(String(valorEn(metricas, "as_of")))}` : dia(String(valorEn(metricas, "computed_at")))}` }
      ],
      filas: typeof enElAnio === "number" && !tablaConElAnio ? [{ rotulo: "En el año", valor: pctConSigno(enElAnio) }] : [],
      tabla: tablaConElAnio ?? tablaPropia,
      ancha: true,
      nota: [
        tablaConElAnio ? "«En el año» no está anualizada." : undefined,
        fraseDeLaSerieValida(valorEn(tarjeta, "metrics.series_valid_from") as string | undefined, antesDeLaSerie),
        ...huecos.map(fraseDelHueco),
        ...apartadas.filter((apartada) => !esDelIndice(apartada) && !antesDeLaSerie.includes(partesDeLaRuta(apartada.ruta).ventana)).map(fraseDeLaCifraApartada),
        enLaTabla(SIN_HISTORIA) ? NOTA_SIN_HISTORIA : undefined,
        noCalculadoSinMotivo ? NOTA_NO_CALCULADO : undefined,
        tablaPropia?.filas.some((f) => f[0] === "Sortino") ? NOTA_DEL_SORTINO : undefined,
        /* La razón real, que no es que la serie sea corta. */
        conEstr ? NOTA_DEL_ESTR : undefined,
        /* Aquí iba «Su categoría hizo X % a un año y Y % a diez», y se quitó (decisión 114): en 730 de 739 fichas esa cifra es la del índice de
           la categoría y no la de su media, porque el extractor llama categoría a las dos y el índice pisa a la media, y la tarjeta no dice cuál
           es. Vuelve con su nombre cuando el dato los separe. */
        /* Es una marca para quien cuida el catálogo: delante del cliente suena a «esta cifra a lo mejor
           está mal», y se quita con el modo (decisión 19). */
        seEnsena("calidadInterna", modoCliente) && Array.isArray(valorEn(tarjeta, "metrics.control.mismatch"))
          ? `Para revisar: ${(valorEn(tarjeta, "metrics.control.mismatch") as string[]).map(discrepanciaEnPalabras).join(", ")} se separa de la cifra del proveedor más que en el 99 % del catálogo. No quiere decir que esté mal: quiere decir que hay que mirarla.`
          : undefined
      ]
        .filter(Boolean)
        .join(" ")
    });
    /* Aquí solo las ventanas que trae: un fondo sin cifras contra su índice a 10 años no tiene nada que decir de ellas. */
    const contraElIndice = tablaDeVentanas(metricas, MAGNITUDES_CONTRA_EL_INDICE, new Set(), rutasApartadas);
    const apartadasDelIndice = apartadas.filter(esDelIndice).map(fraseDeLaCifraApartada).join(" ");
    if (contraElIndice) {
      const proxy = valorEn(metricas, "relative.benchmark.instrument_id");
      const referencia = valorEn(metricas, "relative.reference");
      const serieDelIndice = valorEn(metricas, "relative.benchmark.source_series_id");
      /* Qué hizo de serie del índice (decisión 23 del 07-11-2026). Un instrumento de la base: un fondo índice o
         un ETF, que lleva su coste dentro, y se dice solo en modo interno. El nivel del propio índice: sin
         coste de réplica, y se dice en los dos modos, porque cambia cómo se lee el alfa; la fuente, solo en
         interno. Las dos cifras no se ordenan entre sí (§3 del método), y por eso la ficha lo nombra. */
      /* Decisión 24: contra un índice de precio no hay alfa ni rentabilidad activa, y sin decirlo la tabla con
         tres filas se lee como un hueco. Va en los dos modos: explica el producto, no la calidad del dato. */
      const indiceDePrecio =
        valorEn(metricas, "relative.benchmark.return_basis") === "PRICE_RETURN"
          ? "Su índice es de precio: excluye los dividendos, así que no publicamos alfa ni rentabilidad activa contra él, que saldrían infladas por el dividendo del mercado. La beta, el R² y el tracking error sí se sostienen. "
          : "";
      const replica =
        valorEn(metricas, "relative.benchmark.series_class") === "INDEX_LEVEL"
          ? "Medido contra la serie del propio índice, sin coste de réplica. " +
            (seEnsena("calidadInterna", modoCliente)
              ? `${typeof serieDelIndice === "string" ? `Fuente ${serieDelIndice}. ` : ""}` +
                /* Sin alfa (índice de precio) no hay alfa que comparar, y la frase sobraría. */
                (indiceDePrecio ? "" : "Su alfa no se compara con el de un fondo medido contra un ETF, que lleva el coste del ETF descontado. ")
              : "")
          : proxy && seEnsena("calidadInterna", modoCliente)
            ? typeof valorEn(metricas, "relative.benchmark.equivalent_of") === "string"
              ? `Tampoco tenemos la serie de ${String(valorEn(metricas, "relative.benchmark.name"))}: lo replica el activo ${String(proxy)}. `
              : `No tenemos la serie del índice: lo replica el activo ${String(proxy)}. `
            : "";
      /* Decisión 21 del 07-11-2026: se mide igual y se marca. Es una reserva para quien cuida el catálogo, no
         para el cliente, como la marca de revisar de la tabla de arriba. */
      const sinConfirmarPorElKid = valorEn(metricas, "relative.benchmark.kid_confirmation");
      const marcaDelKid =
        seEnsena("calidadInterna", modoCliente) && typeof sinConfirmarPorElKid === "string"
          ? ` ${KID_NO_CONFIRMA_EL_INDICE[sinConfirmarPorElKid] ?? KID_NO_CONFIRMA_EL_INDICE.NOT_CONFIRMED}`
          : "";
      /* Del índice que declara no hay serie y se mide contra otro equivalente. Va en los dos modos: cambia lo que
         significa el alfa, y un asesor no puede defender la cifra sin saberlo. */
      const declarado = valorEn(metricas, "relative.benchmark.equivalent_of");
      const medido = String(valorEn(metricas, "relative.benchmark.name") ?? "otro índice");
      const equivalencia =
        typeof declarado === "string"
          ? `Declara ${declarado}, del que no tenemos serie. Lo medimos contra ${medido}, un índice equivalente pero no el mismo, así que el alfa puede recoger también la diferencia entre los dos. `
          : "";
      secciones.push({
        id: "contra-indice-propio",
        titulo: "Frente a su índice",
        procedencia: [
          { texto: "Calculado por nosotros", fuerte: true },
          {
            texto:
              ` · contra ${String(valorEn(metricas, "relative.benchmark.name") ?? "su índice")}` +
              (typeof declarado === "string" ? ", equivalente al que declara" : "")
          }
        ],
        filas: [],
        tabla: contraElIndice,
        ancha: true,
        nota: (referencia
          ? `${replica}Una acción no declara índice, y este lo elegimos nosotros` +
            (referencia === "ASSIGNED_AREA_INDEX" ? ": es de su área, no de su plaza. " : ". ") +
            "Medido con rentabilidades mensuales. El margen de error de una beta a 3 años ronda ±0,35, " +
            "así que 0,9 y 1,1 no se distinguen."
          : equivalencia +
            replica +
            indiceDePrecio +
            (indiceDePrecio
              ? "Medido con rentabilidades mensuales."
              : "El alfa y la rentabilidad activa son medias mensuales anualizadas, así que no coinciden " +
                "con restar dos rentabilidades anualizadas.") +
            marcaDelKid) +
          /* Lo que se apartó por su rango, con su motivo (decisión B-73). */
          (apartadasDelIndice ? ` ${apartadasDelIndice}` : "")
      });
    } else if (typeof valorEn(metricas, "relative_absence") === "string" && String(valorEn(metricas, "relative_absence")) in SIN_RELATIVAS_POR_DECISION) {
      /* Decisión 20 del 07-11-2026: su KID declara un índice compuesto o ninguno. Explica el producto, así que va
         también delante del cliente; y ocupa el sitio de la sección, para que no salga en su lugar la del
         proveedor, que mide contra el índice de su categoría lo mismo que se retiró. Decisión 30: lo mismo con
         una clase cubierta, cuyo índice de categoría tampoco está cubierto. */
      const motivo = String(valorEn(metricas, "relative_absence"));
      const frase = fraseDelKid(valorEn(metricas, "relative_absence_evidence.kid_excerpt"));
      const comprobado = valorEn(metricas, "relative_absence_evidence.checked_on");
      const retirada = valorEn(metricas, "relative_withdrawal.withdrawn_on");
      const contraQue = valorEn(metricas, "relative_withdrawal.benchmark_name");
      const ultimoDato = valorEn(metricas, "relative_withdrawal.last_as_of");
      /* §10 del método: lo retirado consta, con la fecha. Quien entregó un informe antes tiene que poder reconocerlo. */
      const cuandoSeRetiro =
        seEnsena("calidadInterna", modoCliente) && typeof retirada === "string"
          ? ` Hasta el ${dia(retirada)} publicábamos sus cifras${contraQue ? ` contra ${String(contraQue)}` : ""}` +
            `${typeof ultimoDato === "string" ? `, con dato a ${dia(ultimoDato)}` : ""}: un informe anterior puede llevarlas.`
          : "";
      secciones.push({
        id: "contra-indice-propio",
        titulo: "Frente a su índice",
        procedencia: [
          { texto: QUIEN_DICE_EL_MOTIVO[motivo] ?? "Según su KID", fuerte: true },
          ...(typeof comprobado === "string" ? [{ texto: ` · comprobado el ${dia(comprobado)}` }] : [])
        ],
        filas: [],
        nota: SIN_RELATIVAS_POR_DECISION[motivo](frase) + cuandoSeRetiro
      });
    } else if (seEnsena("calidadInterna", modoCliente) && valorEn(metricas, "relative_absence") === "NO_REFERENCE_FOR_MARKET") {
      secciones.push({
        id: "contra-indice-propio",
        titulo: "Frente a su índice",
        procedencia: [{ texto: "Sin referencia", fuerte: true }],
        filas: [],
        nota: "Cotiza en un mercado del que no tenemos índice, y no la medimos contra el de otra plaza."
      });
    } else if (seEnsena("calidadInterna", modoCliente) && valorEn(metricas, "relative_absence") === "NO_REFERENCE_DECIDED_FOR_MARKET") {
      /* Decisión 46 del 08-11-2026: una bolsa sin fila en `indices_de_accion.csv`. Es una decisión por bolsa, no un dato que le falte. */
      secciones.push({
        id: "contra-indice-propio",
        titulo: "Frente a su índice",
        procedencia: [{ texto: "Sin referencia", fuerte: true }],
        filas: [],
        nota: "No hemos decidido todavía el índice de referencia de esta bolsa, y no la medimos contra el de otra plaza."
      });
    }
  } else {
    /* Decisión de Óscar, 04-11-2026: si no hay cifra propia, la ficha dice por qué. Sin esto,
       el hueco se lee como un dato que falta. La política cubre lo escrito antes de ese día. */
    const codigo =
      valorEn(raiz, "metrics_absence.code") ??
      (valorEn(bloques["declared/profile"], "distribution_policy") === "DISTRIBUTING" ? "DISTRIBUTES" : undefined);
    const motivo = SIN_METRICAS[String(codigo)];
    if (motivo) {
      /* Delante del cliente se queda lo que explica el producto; lo que cuenta lo que nos falta a
         nosotros se reduce a lo que es: falta el dato (decisión 19). */
      const seExplica = seEnsena("calidadInterna", modoCliente) || SIN_METRICAS_QUE_SE_EXPLICAN.has(String(codigo));
      secciones.push({
        id: "metricas",
        titulo: "Nuestras métricas",
        procedencia: [{ texto: seExplica ? motivo.titular : ETIQUETA_POR_CLASE.falta, fuerte: true }],
        filas: [],
        nota: seExplica ? motivo.nota : undefined
      });
    } else {
      /* Sin el documento de métricas a mano, la tarjeta aún dice qué cifras nuestras se apartaron por su rango (decisión B-73), sin la cifra: el motivo
         se dice igual, y el valor y el límite solo los tiene `computed/metrics`. */
      const apartadas = cifrasApartadas(tarjeta, undefined, modoCliente);
      if (apartadas.length > 0) {
        secciones.push({
          id: "metricas",
          titulo: "Nuestras métricas",
          procedencia: [{ texto: "Calculadas por nosotros", fuerte: true }],
          filas: [],
          nota: apartadas.map(fraseDeLaCifraApartada).join(" ")
        });
      }
    }
  }

  if (hay("declared/provider_returns")) {
    const porVentana: Array<[string, FilaDeFicha]> = [
      ...["1y", "3y", "5y", "10y"]
        .filter((ventana) => saleLaDelProveedor(ventana, `annualized_return.${ventana}`, `declared/provider_returns.trailing_return.${ventana}.fund`))
        .map((ventana): [string, FilaDeFicha] => [
          ventana,
          fila(
            contexto,
            `${ventana.replace("y", "")} año${ventana === "1y" ? "" : "s"}`,
            `declared/provider_returns.trailing_return.${ventana}.fund`,
            pctConSigno
          )
        ]),
      ...(saleLaDelProveedor("ytd", "ytd_return", "declared/provider_returns.ytd_return.fund")
        ? [["ytd", fila(contexto, "En el año", "declared/provider_returns.ytd_return.fund", pctConSigno)] as [string, FilaDeFicha]]
        : [])
    ];
    const filas = porVentana.map(([, f]) => f);
    /* Las que llevan cifra: una fila que dice que falta no tiene fecha que afirmar. */
    const ventanasDelProveedor = porVentana.filter(([, f]) => f.ausencia === undefined).map(([ventana]) => ventana);
    if (filas.length > 0) {
      secciones.push({
        id: "rentabilidad",
        titulo: "Rentabilidad anualizada",
        procedencia: procedenciaDeLaRentabilidad(
          `Cifras del proveedor${enSuDivisa}`,
          valorEn(bloques["declared/provider_returns"], "as_of"),
          ventanasDelProveedor,
          /* Una fecha por ventana cuando no coinciden (decisión B-74); sin el mapa, como hasta ahora (decisión 114). */
          valorEn(bloques["declared/provider_returns"], "as_of_by_window")
        ),
        filas
      });
    }
  }

  if (hay("declared/provider_risk")) {
    /* Sin caída máxima: el proveedor no la da en ninguno de los instrumentos, y la fila solo decía
       «falta» con la nuestra a la vista. A 5 y 10 años, solo si la hay: es donde más veces no llega nuestra serie, y a 10 años donde
       nuestro Sharpe no se puede calcular (decisión 110). */
    const ventanasDe = (campo: string) =>
      VENTANAS_DE_LA_TABLA.filter(
        (ventana) =>
          saleLaDelProveedor(ventana, `${campo}.${ventana}`, `declared/provider_risk.${campo}.${ventana}.fund`) &&
          (ventana === "1y" || ventana === "3y" || valorEn(bloques["declared/provider_risk"], `${campo}.${ventana}.fund`) !== undefined)
      );
    const filas = [
      ...ventanasDe("volatility").map((ventana) =>
        fila(contexto, `Volatilidad ${ROTULO_DE_VENTANA[ventana]}`, `declared/provider_risk.volatility.${ventana}.fund`, pct)
      ),
      ...ventanasDe("sharpe").map((ventana) =>
        fila(contexto, `Sharpe ${ROTULO_DE_VENTANA[ventana]}`, `declared/provider_risk.sharpe.${ventana}.fund`, num)
      )
    ];
    if (filas.length > 0) {
      secciones.push({
        id: "riesgo",
        titulo: "Riesgo",
        procedencia: fuente(`Cifras del proveedor${enSuDivisa}`, valorEn(bloques["declared/provider_risk"], "as_of")),
        filas
      });
    }
  }

  if (hay("declared/costs")) {
    const comisionDeSwap = conElEmisor ? filaDeComisionDeSwap(instrumento) : undefined;
    secciones.push({
      id: "coste",
      titulo: "Coste",
      procedencia: procedenciaDeLosCostes(bloques["declared/costs"]),
      filas: [
        fila(contexto, "Coste corriente", "declared/costs.ongoing_charge", pct),
        ...(comisionDeSwap ? [comisionDeSwap] : []),
        /* El proveedor le da 0,00 % aplicada, 0,12 % de máximo y 0,12 % de coste corriente. Un cero aquí se leería como que no cobra. */
        esUnEtc(raiz)
          ? { rotulo: "Comisión de gestión", valor: ETIQUETA_POR_CLASE["no-aplica"], ausencia: "no-aplica", glosa: "Un ETC no es un fondo: lo que cobra es su coste corriente." }
          : fila(contexto, "Comisión de gestión", "declared/costs.management_fee", pct),
        fila(contexto, "Comisión de entrada (suscripción)", "declared/costs.entry_charge", pct),
        fila(contexto, "Costes de operación", "declared/costs.transaction_costs", (valor) => operacionEnUnaCasilla(Number(valor))),
        fila(contexto, "Comisión de salida (reembolso)", "declared/costs.exit_charge", pct),
        fila(contexto, "Comisión de éxito", "declared/costs.performance_fee", pct)
      ],
      nota:
        "La comisión de entrada es un máximo, no lo que se paga siempre. La de gestión y la de salida son del proveedor." +
        /* Un ETF de Estados Unidos no publica KID de PRIIPs (de memoria, sin contrastar): con él, la frase afirmaría un documento que no hay. */
        (valorEn(bloques["declared/costs"], "performance_fee") === undefined && !instrumento.isin.startsWith("US")
          ? " La de éxito, si la cobra, consta en su KID."
          : "")
    });
  }

  if (hay("declared/regulatory")) {
    secciones.push({
      id: "regulatorio",
      titulo: "Indicador regulatorio",
      procedencia: procedenciaDelIndicador(bloques["declared/regulatory"]),
      filas: [
        fila(contexto, "SRI, del KID de PRIIPs", "declared/regulatory.sri", texto),
        fila(contexto, "SRRI, de UCITS", "declared/regulatory.srri", texto)
      ],
      nota:
        "Dos normativas con escalas distintas. Manda el SRI, porque hay KID detrás; el SRRI se enseña para que nadie lo busque fuera."
    });
  }

  /* Para quién lo piensa el fabricante (decisión 58), junto al indicador: los dos son lo que se mira antes de proponerlo. Solo con
     documento, y fuera del Modo cliente: es un dato del emisor para el asesor (decisión 53). */
  const mercadoObjetivo = seEnsena("mercadoObjetivo", modoCliente) ? seccionDelMercadoObjetivo(instrumento, hoy) : undefined;
  if (mercadoObjetivo) secciones.push(mercadoObjetivo);

  /* La composición la trae la TARJETA, no el bloque: una acción no tiene
     `declared/exposure` y su 100 % se deriva del tipo. Leerla del bloque habría dejado
     a las 73 acciones sin sección de composición. */
  if (valorEn(tarjeta, "exposure.asset_mix") !== undefined) {
    const mezcla = (valorEn(tarjeta, "exposure.asset_mix") ?? {}) as Record<string, number>;
    const ROTULOS = CLASE_DE_ACTIVO;
    const derivado = valorEn(tarjeta, "exposure.derivation") === "BY_INSTRUMENT_TYPE";
    /* Lo que a la precisión escrita (un decimal, la de un peso) es cero no se pinta, sea del signo que sea: «−0,0 %» no dice ninguna cifra
       (decisión 113). Lo que se ve, tal cual, como −0,4 % (decisión A-63). */
    const seEscribe = Object.entries(mezcla).filter(([, peso]) => typeof peso === "number" && pesoDe(Math.abs(peso)) !== pesoDe(0));
    /* El reparto es neto de cortos, y el contrato deja que una clase se salga de 0-100 hasta un punto (decisión A-63). Se enseña tal cual, con el porqué: lo
       negativo es corto mayor que largo. La nota habla de lo que se lee: un −0,03 % que no se pinta, o un 100,0 %, no salen de 0-100 en esta tabla. */
    const fueraDeCeroACien = seEscribe.some(([, peso]) => peso < 0 || (peso > 1 && pesoDe(peso) !== pesoDe(1)));
    secciones.push({
      id: "composicion",
      titulo: "Composición",
      procedencia: derivado
        ? [{ texto: "Derivada del tipo", fuerte: true }, { texto: ", no declarada" }]
        : fuente("Declarada por el proveedor", valorEn(bloques["declared/exposure"], "as_of")),
      filas: seEscribe.map(([clave, peso]) => ({ rotulo: ROTULOS[clave] ?? clave, valor: pesoDe(peso) })),
      nota: derivado
        ? "Una acción es renta variable por definición, así que este 100 % no lo ha medido nadie: se deduce de lo que es."
        : fueraDeCeroACien
          ? "Reparto neto de cortos: por eso una clase puede salir en negativo y otra pasar del 100 %."
          : undefined
    });
  } else if (!esAccion) {
    /* Un hueco no se esconde: sin esto, un fondo sin reparto se quedaba sin sección y solo lo decía «Entrar en una
       radiografía». La clase de la ausencia sale de la calidad, como las demás filas. La nota vale para los 97 que hay, medidos
       el 05-11-2026 con la tolerancia de la decisión A-63: 3 no publican nada y 94 traen alguna clase fuera de 0-100 por más de
       un punto, hasta 243. */
    secciones.push({
      id: "composicion",
      titulo: "Composición",
      procedencia: fuente("Sin reparto que cuadre", undefined),
      filas: [fila(contexto, "Reparto por clase de activo", "declared/exposure.asset_mix", texto)],
      nota: seEnsena("calidadInterna", modoCliente)
        ? "El proveedor no lo publica, o trae alguna clase fuera de 0-100 % por más de un punto. No se completa con ceros ni se enseña uno anterior."
        : undefined
    });
  }

  /* Por magnitud manda una sola fuente (decisión 8). Con las dos, la misma ficha enseñaba dos alfas
     contra dos índices y decía que el nuestro aún no estaba calculado. La del proveedor sigue en la
     base como control. */
  const contraElIndiceEsNuestro = secciones.some((s) => s.id === "contra-indice-propio");
  if (
    !contraElIndiceEsNuestro &&
    hay("declared/provider_risk") &&
    valorEn(bloques["declared/provider_risk"], "beta") !== undefined
  ) {
    const indice = valorEn(raiz, "classification.official_benchmark.name");
    secciones.push({
      id: "contra-indice",
      titulo: "Contra su índice",
      procedencia: fuente(
        `Contra el índice de categoría del proveedor${enSuDivisa}`,
        valorEn(bloques["declared/provider_risk"], "as_of")
      ),
      filas: [
        fila(contexto, "Beta 1 año", "declared/provider_risk.beta.1y.vs_benchmark", num),
        fila(contexto, "Beta 3 años", "declared/provider_risk.beta.3y.vs_benchmark", num),
        /* El R² llega en fracción (`x-unit: fraction`), y se escribe como el nuestro: un porcentaje con dos decimales. */
        fila(contexto, "R² 1 año", "declared/provider_risk.r2.1y.vs_benchmark", pct),
        fila(
          contexto,
          "Alfa de Jensen 1 año",
          "declared/provider_risk.provider_alpha.1y.vs_benchmark",
          pctConSigno
        ),
        /* Es nuestra lista de tareas, no un dato del producto: fuera con el modo (decisión 19). */
        ...(seEnsena("sinPedir", modoCliente)
          ? [fila(contexto, "El índice, en nuestra base", "classification.official_benchmark.instrument_id", texto)]
          : [])
      ],
      nota: indice ? `No es el índice del folleto (${String(indice)}), y por eso se dice.` : undefined
    });
  }

  /*
   * Sectores, regiones, estilo y tamaño salen de la TARJETA, no del bloque. Lo medí al
   * revés el 02-11 y llegué a decir que la base nueva no tenía regiones: las tiene, en
   * `exposure.equity_regions` de la tarjeta. El bloque `declared/exposure` solo lleva
   * el reparto por activo y los sectores.
   */
  const repartos: Array<[string, string, string]> = [
    ["sectores", "Sectores", "exposure.sectors"],
    ["regiones", "Regiones", "exposure.equity_regions"],
    ["estilos", "Estilo", "exposure.equity_styles"],
    ["tamanos", "Tamaño", "exposure.market_caps"]
  ];
  for (const [id, titulo, ruta] of repartos) {
    const reparto = valorEn(tarjeta, ruta) as Record<string, number> | undefined;
    if (reparto === undefined) continue;
    secciones.push({
      id,
      titulo,
      procedencia: fuente("Taxonomía del proveedor", valorEn(bloques["declared/exposure"], "as_of")),
      ...(id === "regiones"
        ? seccionDeRegiones(reparto)
        : {
            filas: Object.entries(reparto)
              .sort(([, a1], [, b1]) => b1 - a1)
              .map(([clave, peso]) => ({ rotulo: etiquetaDeReparto(clave), valor: pesoDe(peso), peso }))
          })
    });
  }
  /* La caja va junto a Estilo y Tamaño, que son sus sumas por columna y por fila, y en Modo cliente también, como el resto de la
     exposición (decisión A-123). Sale del bloque, no de la tarjeta: la tarjeta no la proyecta. */
  const caja = seccionDeLaCaja(bloques["declared/exposure"]);
  if (caja) secciones.push(caja);

  /* La política de reparto, que sale en dos secciones. Sin confirmar es un dato que falta, y no se
     deduce del «(Acc)» del nombre (decisión 2). Si el emisor la declara, se enseña la suya con su fuente (decisión 55): rellena el
     hueco de la pantalla y nada más; `politicaDeReparto`, y con ella las aptitudes, sigue siendo la del proveedor. En Modo cliente
     la fila se enseña igual, pero sin la glosa que nombra al emisor (decisión B-65): la política de reparto es un hecho del
     instrumento, no una cifra del emisor, y la cabecera ya da su aptitud por buena; la fuente se oculta por `fuenteDeDatos`. */
  const filaDePoliticaRellenada = (rotulo: string): FilaDeFicha | undefined => {
    const delEmisor = filaDePoliticaDelEmisor(instrumento, rotulo);
    if (!delEmisor || seEnsena("fuenteDeDatos", modoCliente)) return delEmisor;
    return { rotulo: delEmisor.rotulo, valor: delEmisor.valor };
  };
  /* Si es el emisor quien rellena la política, las dos secciones que la enseñan mezclan fuentes, y su procedencia lo dice. */
  const politicaDelEmisor = politicaDeReparto === "UNKNOWN" && filaDePoliticaDelEmisor(instrumento, "Política de reparto") !== undefined;
  const filaDePolitica = (rotulo: string): FilaDeFicha =>
    politicaDeReparto === "UNKNOWN"
      ? (filaDePoliticaRellenada(rotulo) ?? { rotulo, valor: ETIQUETA_POR_CLASE.falta, ausencia: "falta" })
      : fila(contexto, rotulo, "declared/profile.distribution_policy", (v) =>
          v === "DISTRIBUTING" ? "Reparto" : v === "ACCUMULATING" ? "Acumulación" : String(v)
        );

  /* La procedencia del Perfil dice de dónde salen sus filas. Si la política la rellena el emisor, la sección mezcla fuentes y no puede
     decir solo «Del folleto»: fuera de Modo cliente dice «Del folleto y del emisor», con la fecha del folleto (la fila lleva la del
     emisor en su glosa); en Modo cliente, donde la glosa se oculta (decisión B-65), «Documentación del instrumento», sin nombrar al emisor
     ni al fabricante. Sin `declared/profile` la sección no sale, aunque el emisor traiga la política. */
  if (hay("declared/profile")) {
    const politicaDelPerfil = filaDePolitica("Política de reparto");
    const fechaDelFolleto = valorEn(bloques["declared/profile"], "as_of");
    secciones.push({
      id: "perfil",
      titulo: "Perfil",
      procedencia: !politicaDelEmisor
        ? fuente("Del folleto", fechaDelFolleto)
        : seEnsena("fuenteDeDatos", modoCliente)
          ? fuente("Del folleto y del emisor", fechaDelFolleto)
          : fuente("Documentación del instrumento", fechaDelFolleto),
      filas: [
        politicaDelPerfil,
        fila(contexto, "Clase cubierta", "declared/profile.hedged_class", (v) => (v ? "Sí" : "No")),
        fila(contexto, "Artículo SFDR", "declared/profile.sfdr_article", articuloSfdr)
      ]
    });
  }

  if (hay("declared/equity")) {
    secciones.push({
      id: "equity",
      titulo: "La acción",
      procedencia: fuente("Del proveedor", valorEn(bloques["declared/equity"], "as_of")),
      filas: [
        fila(contexto, "Bolsa", "declared/equity.listing.exchange", bolsaDe),
        /* El de la bolsa leída, no el de la empresa: lo decidió la 13. */
        fila(contexto, "País del listado", "declared/equity.listing.country", paisDe),
        /* La misma tabla que el Buscador (decisión 82). Un sector que no esté en ella sale tal cual: inventarlo es inventar. */
        fila(contexto, "Sector", "declared/equity.sector", (v) => SECTOR_EN_INGLES[String(v)] ?? String(v)),
        fila(contexto, "Industria", "declared/equity.industry", texto, { glosa: TEXTO_EN_INGLES }),
        /* Medido el 05-11-2026: de las 300 acciones con este bloque la traen 296, y las 296 en inglés. Se enseña como viene, igual
           que el objetivo de un fondo: traducirla sería ponerle palabras nuestras. */
        fila(contexto, "Actividad", "declared/equity.business_description", texto, { larga: true, glosa: TEXTO_EN_INGLES })
      ]
    });
  }

  if (hay("declared/dividends")) {
    secciones.push({
      id: "dividendos",
      titulo: "Dividendos",
      procedencia: fuente("Del proveedor", valorEn(bloques["declared/dividends"], "as_of")),
      filas: [
        /* Es lo previsto, no lo pagado: medido el 12-11-2026, `yield_12m` es el dividendo previsto entre el precio, y se aparta más de
           medio punto de lo pagado en 89 de 361 acciones (A-143). El informe de cliente la llama igual. */
        fila(contexto, "Rentabilidad por dividendo prevista", "declared/dividends.yield_12m", pct),
        /* Lo pagado por acción en los últimos doce meses, no el último dividendo: esa cifra es otra. Y con su divisa. */
        fila(contexto, "Pagado en 12 meses", "declared/dividends.trailing_amount_per_share", (v) => {
          const divisaDelDividendo = valorEn(bloques["declared/dividends"], "currency");
          /* Un importe por acción: de dos a cuatro decimales, como un precio, y su divisa tal como llega. */
          return precioConDivisa(comoNumero(v), divisaDelDividendo);
        }),
        fila(contexto, "Fecha ex-dividendo", "declared/dividends.ex_dividend_date", dia),
        fila(contexto, "Divisa del dividendo", "declared/dividends.currency", texto)
      ]
    });
  }

  if (hay("declared/distributions")) {
    const distribuciones = bloques["declared/distributions"];
    /* La política de reparto NO vive con los pagos: está en el perfil. Los pagos son
       hechos y la política es una declaración, y por eso están en documentos distintos. */
    const politica = politicaDeReparto;
    /* Decisión 78: manda el KID. A una clase que por su KID acumula, el proveedor le puede listar pagos y un rendimiento (BNY H
       Acc, 4,97 %), y enseñarlos junto a «Acumulación» diría que cobra lo que no cobra. Es la misma fila que en cualquier clase que
       acumula, y al asesor se le dice que el proveedor dice otra cosa, porque lo va a ver en otro sitio. */
    const acumulaPorSuKid =
      politica === "ACCUMULATING" && valorEn(bloques["declared/profile"], "distribution_policy_resolution") === "OFFICIAL_KID";
    const pagos = (valorEn(distribuciones, "payments") ?? []) as Array<Record<string, unknown>>;
    const ultimo = pagos.length > 0 ? pagos[pagos.length - 1]["date"] : undefined;
    const rendimiento = valorEn(distribuciones, "yield_12m");
    /* La contradicción se detecta en el dato, no se escribe a mano: declara reparto y
       el rendimiento de doce meses es cero. Las dos cosas son ciertas. */
    const contradice = politica === "DISTRIBUTING" && rendimiento === 0;
    /* Un cero creíble es peor que un error. Si nadie ha mirado los pagos, o no se sabe si la clase
       reparte y no hay ninguno, 0,00 % afirma algo que no sabemos. El cero de una clase que acumula sí
       es un cero. */
    const sinPagosNiPolitica = politica === "UNKNOWN" && pagos.length === 0;
    const rendimientoSinComprobar = rendimiento === 0 && valorEn(distribuciones, "records_checked") === false;
    const filaDeRendimiento: FilaDeFicha =
      acumulaPorSuKid && rendimiento !== 0
        ? { rotulo: ROTULO_DEL_REPARTO_12M, valor: ETIQUETA_POR_CLASE["no-aplica"], ausencia: "no-aplica" }
        : rendimiento === 0 && (rendimientoSinComprobar || sinPagosNiPolitica)
        ? {
            rotulo: ROTULO_DEL_REPARTO_12M,
            valor: rendimientoSinComprobar ? "Sin comprobar" : "Sin pagos registrados",
            ausencia: "falta"
          }
        : fila(contexto, ROTULO_DEL_REPARTO_12M, "declared/distributions.yield_12m", pct);
    secciones.push({
      id: "rentas",
      titulo: "Rentas",
      /* Igual que en el Perfil: si la política la rellena el emisor, fuera de Modo cliente se nombra la mezcla, con la fecha de los
         registros (la fila lleva la del emisor en su glosa); en Modo cliente, sin nombrar al emisor ni al fabricante (decisión B-65). */
      procedencia: fuente(
        !politicaDelEmisor
          ? "Registros de reparto del proveedor"
          : seEnsena("fuenteDeDatos", modoCliente)
            ? "Registros de reparto del proveedor y política del emisor"
            : "Registros de reparto y documentación del instrumento",
        valorEn(distribuciones, "as_of")
      ),
      filas: [
        filaDePolitica("Política declarada"),
        filaDeRendimiento,
        {
          rotulo: "Último pago",
          ...(ultimo && !acumulaPorSuKid
            ? { valor: dia(String(ultimo)) }
            : politica === "ACCUMULATING"
              ? { valor: ETIQUETA_POR_CLASE["no-aplica"], ausencia: "no-aplica" as const }
              : { valor: sinPagosNiPolitica ? "Sin pagos registrados" : ETIQUETA_POR_CLASE.falta, ausencia: "falta" as const })
        }
      ],
      contradiccion: contradice
        ? `Declara reparto y su rentabilidad por reparto a doce meses es cero${
            ultimo ? `; el último pago registrado es de ${dia(String(ultimo))}` : ""
          }. Las dos cosas son ciertas: enseñar solo la política sería engañar.`
        : acumulaPorSuKid && ultimo && seEnsena("fuenteDeDatos", modoCliente)
          ? `Su KID dice que esta clase reinvierte, y manda el KID. El proveedor le registra pagos, el último de ${dia(String(ultimo))}.`
          : undefined
    });
  }

  if (hay("declared/size") || hay("declared/sustainability")) {
    const filas: FilaDeFicha[] = [];
    if (hay("declared/size")) {
      filas.push(
        fila(contexto, "Patrimonio", "declared/size.aum", (v) =>
          importeGrande(v, valorEn(bloques["declared/size"], "currency"))
        )
      );
    }
    if (hay("declared/sustainability")) {
      filas.push(
        fila(contexto, "Sostenibilidad", "declared/sustainability.esg_globes", (v) => `${v} de 5`)
      );
    }
    secciones.push({
      id: "patrimonio",
      titulo: "Patrimonio y sostenibilidad",
      procedencia: fuente(
        "Declarados por el proveedor",
        valorEn(bloques["declared/size"] ?? bloques["declared/sustainability"], "as_of")
      ),
      filas
    });
  }

  if (hay("declared/holdings")) {
    const posiciones = (valorEn(bloques["declared/holdings"], "top") ?? []) as Array<
      Record<string, unknown>
    >;
    /* La cuenta de posiciones no se escribe, en ninguna ficha, hasta que el dato guarde el total del fondo (decisión 121 de Óscar, 06-11-2026).
       En la base nueva `declared/holdings.positions_count` es el número de bonos del fondo o, si no tiene, el de acciones
       (`holdings_count_bond ?? holdings_count_equity`, en `2-plataforma-datos/src/ingestion/baseNueva/mapper.ts`), no el total. La ficha
       solo recibe las 25 primeras líneas y no puede comprobarla: con la regla de `cuentaQueCuadra` dejaba de escribir las 74 que esas líneas
       desmienten, pero 243 seguían escribiendo una cuenta corta, como R-co Valor Balanced, «191 posiciones», que son sus bonos, con 243
       títulos en su cartera. Hasta cuándo: hasta que el extractor exporte el total, que ya lee (`numberOfHolding`), y la plataforma lo guarde
       en `positions_count`, con refresco y subida del catálogo, después de publicar. Para devolverla, la misma comprobación de antes: los
       títulos de estas líneas con `carteraPublicada(...).titulos`, `cuentaQueCuadra(positions_count, titulos)` y `rotuloDePosiciones`
       (`core/cuentaDePosiciones`), delante del peso de las diez mayores. Posiciones y el informe interno siguen con la suya: la comprueban
       con la cartera completa. */
    const diez = posiciones.slice(0, 10);
    /* Se dice solo si cuadra con las filas que hay debajo: el proveedor la calcula sin efectivo ni derivados, y las filas los llevan. */
    const peso10 = diezMayoresQueCuadran(valorEn(bloques["declared/holdings"], "top10_weight"), diez.map((posicion) => posicion["weight"]));
    const loDeclarado = [typeof peso10 === "number" ? `diez mayores ${pesoDe(peso10)}` : null].filter(Boolean);
    /* Una columna entera vacía no dice nada, y le pasa a uno de cada tres: mejor decirlo una vez. */
    const conSector = diez.some((posicion) => posicion["sector"]);
    const conDerivados = diez.some((posicion) => esDerivadoPorSuCodigo(posicion["holding_type_code"]));
    secciones.push({
      id: "cartera",
      titulo: "Cartera",
      ancha: true,
      procedencia: [
        ...fuente("Declarada por el proveedor", valorEn(bloques["declared/holdings"], "as_of")),
        /* Sin la cuenta, el peso de las diez mayores va detrás de la fecha como lo demás: «· diez mayores 53,2 %». */
        { texto: loDeclarado.length > 0 ? ` · ${loDeclarado.join(", ")}` : "" }
      ],
      filas: [],
      tabla: {
        columnas: conSector ? ["Posición", "Sector", "Peso"] : ["Posición", "Peso"],
        filas: diez.map((posicion) => {
          /* Decisión 93: lo que el código dice que es una línea de divisa o de efectivo se llama por lo que es. Solo cambia el rótulo:
             pesos y orden son los del proveedor, y Análisis y el interno siguen con su nombre (decisión 9). */
          const rotulo = rotuloDeLinea(String(posicion["name"] ?? ""), posicion["holding_type_code"]);
          return [
            rotulo ?? String(posicion["name"] ?? ""),
            ...(conSector
              ? [
                  posicion["sector"]
                    ? etiquetaDeReparto(String(posicion["sector"]))
                    : rotulo
                      ? { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" as const }
                      : { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" as const }
                ]
              : []),
            pesoDe(posicion["weight"])
          ];
        })
      },
      nota:
        [
          conDerivados ? "Pesos brutos, incluye derivados: son importes nominales, no inversión directa." : null,
          conSector ? null : "El proveedor no declara el sector de sus posiciones."
        ]
          .filter(Boolean)
          .join(" ") || undefined
    });
  }

  const objetivo = valorEn(bloques["declared/profile"], "objective");
  if (typeof objetivo === "string" && objetivo.length > 0) {
    secciones.push({
      id: "objetivo",
      titulo: "Objetivo",
      ancha: true,
      procedencia: [{ texto: "Palabras del proveedor", fuerte: true }, { texto: ", del folleto" }],
      filas: [],
      prosa: objetivo,
      nota:
        "En su idioma, porque así está en el folleto. Un objetivo es texto legal: traducirlo en pantalla sería ponerle palabras nuestras a un compromiso suyo."
    });
  }

  secciones.push(...seccionesDeFundamentales(fundamentales, modoCliente, valorEn(bloques["declared/size"], "aum") !== undefined));

  const seccionDelEmisor = conElEmisor ? seccionAnchaDelEmisor(instrumento) : undefined;
  if (seccionDelEmisor) secciones.push(seccionDelEmisor);

  /* La calidad siempre, al final y ancha: es lo que hace defendible todo lo de arriba. Para el asesor:
     delante del cliente son nuestras tareas pendientes (decisión 19). */
  const cobertura = valorEn(calidad, "coverage");
  const presentes = valorEn(calidad, "present_paths");
  const aplicables = valorEn(calidad, "applicable_paths");
  const porClase = [...contexto.ausencias.values()].reduce<Record<string, number>>((cuenta, clase) => {
    cuenta[clase] = (cuenta[clase] ?? 0) + 1;
    return cuenta;
  }, {});
  if (seEnsena("procedenciaYCalidad", modoCliente)) secciones.push({
    id: "calidad",
    titulo: "Procedencia y calidad",
    ancha: true,
    procedencia: hay("declared/provenance")
      ? [
          { texto: "Datos del " },
          {
            texto: dia(String(valorEn(bloques["declared/provenance"], "package_id") ?? "")),
            fuerte: true
          }
        ]
      : [{ texto: "Sin documento de procedencia" }],
    filas: [
      {
        rotulo: "Datos disponibles",
        ...(typeof cobertura === "number"
          ? { valor: pesoDe(cobertura) }
          : { valor: ETIQUETA_POR_CLASE.falta, ausencia: "falta" as const })
      },
      /* Sin documento de calidad no hay cuenta: se dice que falta el dato, no «? de ?». */
      typeof presentes === "number" && typeof aplicables === "number"
        ? { rotulo: "Campos presentes", valor: `${recuento(presentes)} de ${recuento(aplicables)}` }
        : { rotulo: "Campos presentes", valor: ETIQUETA_POR_CLASE.falta, ausencia: "falta" as const },
      { rotulo: "No facilitados por el proveedor", valor: recuento(porClase["falta"] ?? 0) },
      { rotulo: "No aplican", valor: recuento(porClase["no-aplica"] ?? 0) },
      { rotulo: "Pendiente de incorporar", valor: recuento(porClase["sin-pedir"] ?? 0) }
    ],
    nota:
      (porClase["sin-pedir"] ?? 0) > 0
        ? "Pendientes de incorporar: el dato existe y aún no lo hemos traído."
        : "No hay nada pendiente de incorporar: lo que falta, o no aplica, o el proveedor no lo facilita."
  });

  const avisos = (valorEn(calidad, "warnings") ?? []) as Array<{ code?: string; message?: string }>;
  const avisoDeEscalas = avisos.find((aviso) => aviso.code === "METRICAS_DE_MUESTREO_DIARIO");

  return {
    tipo: esUnEtc(raiz) ? "ETC" : (NOMBRE_DEL_TIPO[String(valorEn(raiz, "instrument_type"))] ?? OTRO_TIPO),
    nombre: String(valorEn(raiz, "identity.name") ?? instrumento.isin),
    identificacion: [
      instrumento.isin,
      valorEn(raiz, "identifiers.ticker"),
      /* La de la clase, no la de las cifras ni la de su cotización: sin decirlo, «USD» se lee como
         que todo lo de abajo está en dólares. En una acción es la de su bolsa, y no hay más que aclarar. */
      codigo && !esAccion ? `Clase en ${String(valorEn(raiz, "identity.currency") ?? codigo)}` : codigo,
      categoriaDeLaRaiz(raiz),
      valorEn(raiz, "classification.official_benchmark.name")
    ]
      .filter(Boolean)
      .join(" · "),
    disponibilidad: disponibilidadDe(raiz, modoCliente),
    aptitudes: aptitudesDe(tarjeta, raiz, politicaDeReparto ?? valorEn(tarjeta, "metrics.distribution_policy")),
    aviso: avisoDeEscalas?.message
      ? [
          { texto: "Sus métricas no se pueden ordenar junto a las de un fondo.", fuerte: true },
          { texto: ` ${avisoDeEscalas.message}` }
        ]
      : undefined,
    secciones
  };
}
