import { estrellasDeMorningstar, textoDeEstrellas } from "../core/estrellasDeMorningstar";
import { categoriaLegible, SECTOR_EN_INGLES } from "../core/etiquetasDeReparto";
import * as formato from "../core/formato";
import { seEnsenaLaMetrica, type MetricaDeInstrumento } from "../core/metricasPorInstrumento";
import { textoDePrecioCongelado, valoradoAPrecioCongelado } from "../core/precioCongelado";
import { subzonaDeUnaAccion, zonaMayor, zonasDeUnReparto, type ZonaDelBuscador } from "../core/regionTaxonomy";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { Documento } from "./baseNuevaLectura";
import type { ColumnaDeTabla, FilaAgrupable } from "../types/tablaDeDatos";

/**
 * De las tarjetas de lectura a las filas del buscador.
 *
 * Aquí está la decisión que gobierna esta pantalla: **la columna de una cifra sabe de
 * qué método viene.** En el catálogo conviven tres —641 instrumentos con métricas
 * calculadas sobre meses, 297 sobre días y 130 copiadas del proveedor—, y la tabla usa
 * ese dato para agrupar al ordenar en vez de mezclar escalas.
 */

export interface FilaDeInstrumento extends FilaAgrupable {
  /** Un ETF: mismo cálculo que un fondo, pero sobre el cierre de mercado y no el valor liquidativo. */
  sobrePrecioDeMercado?: boolean;
  /** Desde cuándo no cotiza, si dejó de hacerlo. Se marca y sigue en la lista (decisión 14), con su fecha. */
  dejoDeCotizar?: string;
  /**
   * La baja que se sigue valorando a su último precio por decisión (hoy, NH Hotel Group, decisión de Óscar del 12-11-2026): no lleva
   * `dejoDeCotizar`, se añade, y la fila dice esto en su lugar.
   */
  valoradoAPrecioCongelado?: string;
  /** Nunca se resolvió su símbolo: no tiene precio ni métricas. Se ve y se marca, y no se añade (decisión 44). */
  sinPrecioNiMetricas?: boolean;
  /**
   * El estado de cotización que dice su tarjeta (`availability.state`), tal cual. Lo lee la regla común de añadir a cartera
   * (`core/accionDeCartera`), la misma que usan la ficha y el Comparador (ACT-01).
   */
  estadoDeCotizacion?: string;
  /** Cuándo se compuso su tarjeta: la última pasada que la tocó. */
  calculadaEl?: string;
  id: string;
  isin: string;
  nombre: string;
  /** El símbolo con el que cotiza, cuando se conoce: el asesor busca por él igual que por el nombre. */
  ticker: string | undefined;
  tipo: string;
  divisa: string;
  clasificacion: string | undefined;
  /** El método con que se calcularon sus métricas: es la escala de sus cifras. */
  escala: string | undefined;
  rentabilidad1a: number | undefined;
  volatilidad1a: number | undefined;
  /**
   * La volatilidad a 3 años, junto a la de 1 y no en su lugar (decisión A-172, Óscar, 16-11-2026): es la ventana del
   * Sharpe de la fila, y con ella se lee.
   */
  volatilidad3a: number | undefined;
  /** La escala de la volatilidad a 3 años cuando la hay, por lo mismo que la del Sharpe. */
  escalaDeLaVolatilidad3a?: string;
  /**
   * A 3 años y no a 1 (decisión A-171, Óscar, 16-11-2026): con doce meses el Sharpe es casi todo ruido, y esta es la
   * pantalla donde se ordena para elegir. La rentabilidad de la fila sigue a 1 año.
   */
  sharpe3a: number | undefined;
  /**
   * La escala del Sharpe cuando lo hay: puede ser del proveedor en un fondo cuya serie nuestra pasa de 1 año y no llega
   * a 3, y entonces no es la de la fila, que la dan la rentabilidad y la volatilidad a 1 año.
   */
  escalaDelSharpe?: string;
  /**
   * Las estrellas de Morningstar, de 1 a 5, como las trae la tarjeta (`classification.morningstar_rating`). El coste corriente, el
   * patrimonio y «Datos disponibles» salieron de la lista con la misma decisión (A-172): siguen en la ficha.
   */
  estrellas: number | undefined;
  /** La clase de activo que DECLARA el proveedor, no una derivada de la mezcla. */
  claseDeActivo: string | undefined;
  /**
   * La región con más peso de su renta variable, cuando la declara. No es «la región
   * del fondo»: es cuál pesa más de las que dice, y por eso el filtro la nombra así.
   * Medido el 02-11-2026: solo 547 de las 1.091 tarjetas declaran `equity_regions`.
   */
  region: string | undefined;
  /**
   * La zona grande con más peso (Europa, Norteamérica…), sumando sus subzonas: un fondo de toda Europa es de Europa aunque su
   * subzona mayor sea la zona euro. Una acción, que no trae reparto, la toma del país de su ISIN.
   */
  zona: ZonaDelBuscador | undefined;
  /** La categoría de un fondo o ETF con el nombre que se enseña. Una acción no tiene categoría: tiene sector. */
  categoria: string | undefined;
}

export const NOMBRE_DEL_METODO: Record<string, string> = {
  EXTRACTOR_MONTHLY_V1: "Nuestro método mensual",
  EXTRACTOR_DAILY_V1: "Nuestro método diario",
  EXTRACTOR_MONTHLY_V2: "Nuestro método mensual, en euros",
  EXTRACTOR_DAILY_V2: "Nuestro método diario, en euros",
  /* La versión 3 (decisiones A-158 y A-166, 16-11-2026) afina el tipo sin riesgo de cada mes, la anualización diaria y el
     trato de un pico que revierte. Para quien lee es el mismo método: el nombre no cambia, cambia el código. */
  EXTRACTOR_MONTHLY_V3: "Nuestro método mensual, en euros",
  EXTRACTOR_DAILY_V3: "Nuestro método diario, en euros",
  /* La versión 4 (MET-6 y MET-7, 17-11-2026) exige que un cierre de mes sea del final del mes y que las relativas cierren con el
     riesgo. Para quien lee es el mismo método, como la 3: el nombre no cambia, cambia el código. */
  EXTRACTOR_MONTHLY_V4: "Nuestro método mensual, en euros",
  EXTRACTOR_DAILY_V4: "Nuestro método diario, en euros",
  TRAILING_PROVIDER: "Cifras del proveedor"
};

const METODO_CORTO: Record<string, string> = {
  EXTRACTOR_MONTHLY_V1: "mensual",
  EXTRACTOR_DAILY_V1: "diario",
  EXTRACTOR_MONTHLY_V2: "mensual",
  EXTRACTOR_DAILY_V2: "diario",
  EXTRACTOR_MONTHLY_V3: "mensual",
  EXTRACTOR_DAILY_V3: "diario",
  EXTRACTOR_MONTHLY_V4: "mensual",
  EXTRACTOR_DAILY_V4: "diario",
  TRAILING_PROVIDER: "proveedor"
};


function valorEn(documento: Documento | undefined, ruta: string): unknown {
  return ruta
    .split(".")
    .reduce<unknown>(
      (actual, tramo) =>
        actual && typeof actual === "object" ? (actual as Record<string, unknown>)[tramo] : undefined,
      documento
    );
}

const numero = (valor: unknown): number | undefined =>
  typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;

/**
 * La cifra de una ventana en la tarjeta: la nuestra y, donde no la hay, la del proveedor, que viaja aparte y con su nombre (decisión 110).
 * Lo que toca la fecha desde la que vale la serie no viene de ninguna de las dos (decisión 112).
 */
export function cifraDeLaTarjeta(
  tarjeta: Documento | undefined,
  campo: string,
  ventana: string
): { valor: number | undefined; delProveedor: boolean } {
  const nuestra = numero(valorEn(tarjeta, `metrics.${campo}.${ventana}`));
  if (nuestra !== undefined) return { valor: nuestra, delProveedor: false };
  const suya = numero(valorEn(tarjeta, `metrics.provider.${campo}.${ventana}`));
  return { valor: suya, delProveedor: suya !== undefined };
}

/** La categoría de un fondo, o el sector de una acción, que no tiene categoría. */
export function clasificacionDeTarjeta(tarjeta: Documento | undefined): string | undefined {
  const categoria = valorEn(tarjeta, "classification.category");
  /* Con el nombre que se enseña (decisión 101): de aquí leen el Buscador, la ficha y el Comparador. */
  if (typeof categoria === "string") return categoriaLegible(categoria) ?? categoria;
  const sector = valorEn(tarjeta, "classification.sector");
  return typeof sector === "string" ? (SECTOR_EN_INGLES[sector] ?? sector) : undefined;
}

/** El reparto por subzonas de su renta variable; el de una acción, entera en la subzona del país de su ISIN. */
function repartoGeografico(tarjeta: Documento): unknown {
  const reparto = valorEn(tarjeta, "exposure.equity_regions");
  if (reparto && typeof reparto === "object") return reparto;
  if (valorEn(tarjeta, "instrument_type") !== "STOCK") return undefined;
  const subzona = subzonaDeUnaAccion(String(valorEn(tarjeta, "instrument_id") ?? ""));
  return subzona ? { [subzona]: 1 } : undefined;
}

function categoriaDelFiltro(tarjeta: Documento): string | undefined {
  const categoria = valorEn(tarjeta, "classification.category");
  return typeof categoria === "string" && categoria.trim() ? (categoriaLegible(categoria) ?? categoria) : undefined;
}

export function componerFila(tarjeta: Documento): FilaDeInstrumento {
  const isin = String(valorEn(tarjeta, "instrument_id") ?? "");
  const ticker = valorEn(tarjeta, "identity.ticker");
  const desde = valorEn(tarjeta, "availability.since");
  const metodo = valorEn(tarjeta, "metrics.method") as string | undefined;
  /* El Sharpe de una acción no se enseña (§9 del método): ni se lee, ni cuenta para la escala. */
  const sharpe = seEnsenaLaMetrica("sharpe", valorEn(tarjeta, "instrument_type") as string | undefined)
    ? cifraDeLaTarjeta(tarjeta, "sharpe", "3y")
    : { valor: undefined, delProveedor: false };
  const volatilidad3a = cifraDeLaTarjeta(tarjeta, "volatility", "3y");
  /* La escala de una cifra a 3 años, si la hay: la del proveedor cuando es suya, y si no la del método de la tarjeta. */
  const escalaDe = (cifra: { valor: number | undefined; delProveedor: boolean }) =>
    cifra.valor === undefined ? undefined : cifra.delProveedor ? "TRAILING_PROVIDER" : metodo;
  return {
    id: isin,
    isin,
    ...(valorEn(tarjeta, "availability.state") === "DELISTED"
      ? valoradoAPrecioCongelado(isin)
        ? { valoradoAPrecioCongelado: textoDePrecioCongelado(isin, desde) }
        : typeof desde === "string"
          ? { dejoDeCotizar: desde }
          : {}
      : {}),
    ...(valorEn(tarjeta, "availability.state") === "NEVER_RESOLVED" ? { sinPrecioNiMetricas: true } : {}),
    ...(typeof valorEn(tarjeta, "availability.state") === "string"
      ? { estadoDeCotizacion: valorEn(tarjeta, "availability.state") as string }
      : {}),
    calculadaEl: valorEn(tarjeta, "computed_at") as string | undefined,
    nombre: String(valorEn(tarjeta, "identity.name") ?? isin),
    ticker: typeof ticker === "string" ? ticker : undefined,
    tipo: String(valorEn(tarjeta, "instrument_type") ?? ""),
    divisa: String(valorEn(tarjeta, "identity.currency") ?? ""),
    clasificacion: clasificacionDeTarjeta(tarjeta),
    /* La escala de la fila la dan sus dos cifras a 1 año: si alguna es del proveedor, porque nuestra serie no llega a 1 año, es la
       suya. Las cifras a 3 años llevan cada una su escala (A-171, A-172): contarlas aquí marcaría «proveedor» cifras a 1 año que son nuestras. */
    escala: ["annualized_return", "volatility"].some((campo) => cifraDeLaTarjeta(tarjeta, campo, "1y").delProveedor)
      ? "TRAILING_PROVIDER"
      : metodo,
    sobrePrecioDeMercado: valorEn(tarjeta, "metrics.series_class") === "MARKET_PRICE",
    rentabilidad1a: cifraDeLaTarjeta(tarjeta, "annualized_return", "1y").valor,
    volatilidad1a: cifraDeLaTarjeta(tarjeta, "volatility", "1y").valor,
    volatilidad3a: volatilidad3a.valor,
    ...(volatilidad3a.valor !== undefined ? { escalaDeLaVolatilidad3a: escalaDe(volatilidad3a) } : {}),
    sharpe3a: sharpe.valor,
    ...(sharpe.valor !== undefined ? { escalaDelSharpe: escalaDe(sharpe) } : {}),
    /* Las de una acción no se enseñan (decisión 83): ni se leen. */
    estrellas: seEnsenaLaMetrica("morningstar", valorEn(tarjeta, "instrument_type") as string | undefined)
      ? estrellasDeMorningstar(valorEn(tarjeta, "classification.morningstar_rating"))
      : undefined,
    claseDeActivo: claseDelFiltro(valorEn(tarjeta, "classification.asset_class") as string | undefined),
    region: regionMayor(repartoGeografico(tarjeta)),
    zona: zonaMayor(repartoGeografico(tarjeta) as Record<string, number> | undefined),
    categoria: categoriaDelFiltro(tarjeta)
  };
}

/** La zona con más peso de un reparto, o `undefined` si no hay ninguna. «Otras» no es una zona (decisión 7). */
function regionMayor(reparto: unknown): string | undefined {
  if (reparto === null || typeof reparto !== "object") return undefined;
  const { zonas } = zonasDeUnReparto(reparto as Record<string, number>);
  return Object.entries(zonas).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Las clases de activo del catálogo, con su cuenta medida el 02-11-2026 sobre las
 * 1.091 tarjetas: EQUITY 763, FIXED_INCOME 196, ALLOCATION 107, ALTERNATIVE 9,
 * CAPITAL_PRESERVATION 7, HYBRID 6, REAL_ASSETS 3.
 *
 * Las declara el proveedor en 1.090 de las 1.091 —la otra se deriva de la mezcla y la
 * tarjeta lo dice en `asset_class_resolution`—, así que filtrar por aquí no inventa
 * nada. Se llaman como en el resto de la aplicación (decisión 13): los monetarios son
 * Monetario, y lo que la base llama activos reales es oro y materias primas.
 */
export const CLASE_DE_ACTIVO_DEL_BUSCADOR: Record<string, string> = {
  EQUITY: "Renta variable",
  FIXED_INCOME: "Renta fija",
  ALLOCATION: "Mixto",
  ALTERNATIVE: "Alternativo",
  CAPITAL_PRESERVATION: "Monetario",
  REAL_ASSETS: "Materias primas",
  OTHER: "Otros"
};

/** Los convertibles (HYBRID) son Mixto (decisión 13): con su propia entrada, «Mixto» saldría dos veces en el filtro. */
function claseDelFiltro(clase: string | undefined): string | undefined {
  return clase === "HYBRID" ? "ALLOCATION" : clase;
}

/**
 * Lo que una acción no tiene no se pinta igual que lo que falta.
 *
 * El Sharpe y las estrellas de una acción no son huecos, son casillas cerradas. Las acciones
 * del catálogo dejarían cada una dos huecos en terracota si esto no estuviera, y el asesor
 * leería «faltan datos» donde la verdad es «no aplica». Qué se enseña para cada tipo lo dice
 * una sola lista, `core/metricasPorInstrumento`.
 */
const METRICA_DE_LA_COLUMNA: Partial<Record<string, MetricaDeInstrumento>> = {
  sharpe3a: "sharpe",
  estrellas: "morningstar"
};

function celdaDeCifra(
  fila: FilaDeInstrumento,
  id: string,
  valor: number | undefined,
  escribir: (v: number) => string | null
) {
  const metrica = METRICA_DE_LA_COLUMNA[id];
  if (metrica && !seEnsenaLaMetrica(metrica, fila.tipo)) {
    return { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" as const };
  }
  const texto = valor !== undefined ? escribir(valor) : null;
  if (valor !== undefined && texto !== null) return { texto, valor };
  return { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" as const };
}

/**
 * La celda de una cifra a 3 años, que lleva su propia escala (A-171). Si no es la que el nombre dice de la fila, la celda lo dice:
 * es una cifra de la fila que no es de ese método.
 */
function celdaConSuEscala(
  fila: FilaDeInstrumento,
  id: string,
  valor: number | undefined,
  suEscala: string | undefined,
  escribir: (v: number) => string | null
) {
  const celda = celdaDeCifra(fila, id, valor, escribir);
  return celda.valor !== undefined && suEscala !== undefined && suEscala !== fila.escala
    ? { ...celda, apunte: METODO_CORTO[suEscala] ?? suEscala }
    : celda;
}

/** El nombre de un grupo de la tabla del Buscador: el del método de sus cifras. */
export function nombreDeEscalaDelBuscador(escala: string | undefined): string {
  if (!escala) return "Sin métricas";
  return NOMBRE_DEL_METODO[escala] ?? escala;
}


/**
 * Con qué tipo de la pieza `Cifra` se escribe cada columna de cifras del Buscador (rediseño, paso 4): la pantalla la pinta con el
 * formato común y, en la rentabilidad, con el color de su signo. Solo cuando la celda trae su valor: lo que no aplica a un tipo de
 * activo ya lo ha decidido la celda con `metricasPorInstrumento`.
 */
export const TIPO_DE_CIFRA_DEL_BUSCADOR: Partial<Record<string, "rentabilidad" | "porcentaje" | "ratio">> = {
  rentabilidad1a: "rentabilidad",
  volatilidad1a: "porcentaje",
  volatilidad3a: "porcentaje",
  sharpe3a: "ratio"
};

export const COLUMNAS_DEL_BUSCADOR: ColumnaDeTabla<FilaDeInstrumento>[] = [
  {
    id: "nombre",
    titulo: "Activo",
    celda: (f) => ({
      texto: f.nombre,
      valor: f.nombre,
      enlaceAFicha: f.isin,
      apunte: f.escala
        ? `${f.isin} · ${METODO_CORTO[f.escala] ?? f.escala}${f.sobrePrecioDeMercado ? ", precio de mercado" : ""}`
        : f.isin,
      apunteEstrecho: f.clasificacion ?? "Sin categoría"
    })
  },
  {
    id: "clasificacion",
    titulo: "Categoría",
    tituloCompleto: "Categoría o sector",
    soloAncho: true,
    celda: (f) =>
      f.clasificacion !== undefined
        ? { texto: f.clasificacion, valor: f.clasificacion }
        : { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" as const }
  },
  {
    /* Como en la comparativa de activos: las cinco casillas, y el número para ordenar. No lleva `escalaMixta`: la escala es una
       sola, la de Morningstar, y puntúa cada fondo frente a su categoría, que es lo que hay que tener presente al ordenar.
       Por eso va junto a la categoría (Óscar, 17-11-2026), y no al final de la fila, donde iba entonces el favorito. */
    id: "estrellas",
    titulo: "Morningstar",
    cifra: true,
    celda: (f) => celdaDeCifra(f, "estrellas", f.estrellas, textoDeEstrellas)
  },
  /* De la clase, no de las cifras: la rentabilidad y la volatilidad van en euros aunque aquí diga
     USD, y un ETF puede cotizar en otra. Sin decirlo, «USD» junto a una rentabilidad se lee como que
     está en dólares. */
  { id: "divisa", titulo: "Divisa", tituloCompleto: "Divisa de la clase; las cifras van en euros", celda: (f) => ({ texto: f.divisa, valor: f.divisa }) },
  {
    id: "rentabilidad1a",
    titulo: "Rent.\u00a01A",
    tituloCompleto: "Rentabilidad 1 año",
    cifra: true,
    escalaMixta: true,
    celda: (f) => celdaDeCifra(f, "rentabilidad1a", f.rentabilidad1a, formato.rentabilidad)
  },
  {
    id: "volatilidad1a",
    titulo: "Vol.\u00a01A",
    tituloCompleto: "Volatilidad 1 año",
    cifra: true,
    escalaMixta: true,
    celda: (f) => celdaDeCifra(f, "volatilidad1a", f.volatilidad1a, (v) => formato.porcentaje(v))
  },
  {
    id: "volatilidad3a",
    titulo: "Vol.\u00a03A",
    tituloCompleto: "Volatilidad 3 años",
    cifra: true,
    escalaMixta: true,
    /* Sin la cifra no hay escala propia: la fila se queda en el grupo de su método, al final. */
    escalaDe: (f) => f.escalaDeLaVolatilidad3a ?? f.escala,
    celda: (f) => celdaConSuEscala(f, "volatilidad3a", f.volatilidad3a, f.escalaDeLaVolatilidad3a, (v) => formato.porcentaje(v))
  },
  {
    id: "sharpe3a",
    titulo: "Sharpe\u00a03A",
    tituloCompleto: "Sharpe 3 años",
    cifra: true,
    escalaMixta: true,
    /* Sin Sharpe no hay escala propia: la fila se queda en el grupo de su método, al final. */
    escalaDe: (f) => f.escalaDelSharpe ?? f.escala,
    celda: (f) => celdaConSuEscala(f, "sharpe3a", f.sharpe3a, f.escalaDelSharpe, formato.ratio)
  }
];
