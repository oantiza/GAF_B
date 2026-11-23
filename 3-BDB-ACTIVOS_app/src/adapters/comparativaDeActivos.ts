import { cifraDeLaTarjeta, clasificacionDeTarjeta } from "./componerLista";
import { backtestWindowCoverage } from "../core/backtestCoverage";
import { estrellasDeMorningstar, rotuloDeEstrellas, textoDeEstrellas } from "../core/estrellasDeMorningstar";
import { categoriaLegible } from "../core/etiquetasDeReparto";
import * as formato from "../core/formato";
import type { Documento } from "./baseNuevaLectura";
import type { ColumnaComparada, FilaComparada } from "../components/tabla/TablaComparativa";
import type { BdbAssetSearchResult } from "../types/bdbAssets";
import { seEnsenaLaMetrica, type MetricaDeInstrumento } from "../core/metricasPorInstrumento";
import { calculoEnPalabras, describeMetricsMethodology, type MethodologyInput } from "../core/metricsMethodology";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { fraseDeLaCifraApartada, fraseDeLaSerieValida } from "../core/ventanaSinMedir";

/**
 * Del catálogo a la tabla comparativa, con las cifras de la base nueva cuando las hay.
 *
 * Tercer intercambio del rediseño, en dos pasos y el 03-11-2026 los dos. El primero
 * cambió DOS piezas de «Comparar activos» —la tabla de métricas y el mapa de riesgo— y
 * dejó el resto de la pantalla intacto. El segundo es este: de dónde salen sus cifras.
 *
 * **Por qué hizo falta el segundo paso.** La tabla nueva avisa cuando dos columnas no
 * salen del mismo cálculo, y el plano dibuja un panel por método. Con los datos de la
 * base de siempre eso no separaba nada, y lo comprobé en la aplicación antes de
 * afirmarlo: **ninguno de los 2.178 documentos de métricas de esa base declara
 * `metrics_method`**. Un fondo y una acción caían en el mismo panel y ninguna fila se
 * marcaba. La protección existía y no podía morder, porque el dato que la activa no
 * estaba en la fuente.
 *
 * En la base nueva sí está: `read/card` trae `metrics.method`, y conviven tres —641
 * instrumentos con métricas mensuales, 297 con diarias y 130 copiadas del proveedor—.
 * Así que las cifras y su método viajan juntos, que es la única forma de que el aviso
 * sea cierto y no decorativo.
 *
 * **Lo que NO viene de la base nueva**, porque no lo tiene: las estrellas de Morningstar
 * y la retrocesión. Siguen saliendo de la base de siempre y la tabla las pone igual.
 *
 * **Y lo que pasa con un instrumento que la base nueva no conoce.** Son 8 de 1.097, y
 * siete de ellos por decisión de Óscar —seis acciones fuera del alcance «solo Europa y
 * EEUU» y CEVASA—. Su columna se pinta con las cifras de la base de siempre y se marca
 * en la cabecera, y como no trae método, el plano la pone en «metodología no declarada»
 * y la tabla marca las filas que la mezclan con las demás. Que es exactamente lo que
 * tiene que pasar: no se sabe si son comparables, y eso se dice.
 */

const FALTA = { texto: textoDeAusencia("falta"), ausencia: "falta" as const };
const NO_APLICA = { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" as const };

/**
 * El coste corriente de una columna, como lo espera el informe en PDF (ACT-09): la fracción si la hay, «no-aplica» donde la celda dice
 * que no aplica (una acción) y `null` si falta el dato. Sin la fila (ninguno de los comparados tiene coste corriente), nada: el papel no
 * pinta la fila, como la pantalla. Sale de la misma fila que la pantalla, sin recalcular.
 */
export function costeCorrienteParaElInforme(
  filas: readonly FilaComparada[],
  columna: ColumnaComparada | undefined
): number | null | "no-aplica" | undefined {
  const fila = filas.find((candidata) => candidata.id === "coste-corriente");
  if (!fila || columna === undefined) return undefined;
  if (fila.celda(columna).ausencia === "no-aplica") return "no-aplica";
  return fila.valor?.(columna) ?? null;
}

export interface FuenteDeColumna {
  /** El activo de la base de siempre. Siempre está: es el que el asesor eligió. */
  activo: BdbAssetSearchResult;
  /** Su tarjeta de la base nueva, cuando esa base lo tiene. */
  tarjeta?: Documento;
}

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

/* Quien las importaba de aquí las sigue encontrando; la regla vive en `core`, donde también la lee el Buscador. */
export { estrellasDeMorningstar };

/** Una cifra, o la etiqueta de que no está. Nunca un guion, que se lee como cero. */
function celda(valor: number | undefined, escribir: (v: number) => string | null) {
  const texto = valor !== undefined ? escribir(valor) : null;
  return valor !== undefined && texto !== null ? { texto, valor } : FALTA;
}

/** Un día de la tarjeta, como se escribe en una procedencia: «31/10/2026». */
const dia = (valor: string) => formato.oFalta(formato.fecha(valor));

/** El tipo del instrumento, tenga o no tarjeta: el activo de siempre lo trae en las dos bases. */
function tipoDe(fuente: FuenteDeColumna | undefined): string | undefined {
  return (valorEn(fuente?.tarjeta, "instrument_type") as string | undefined) ?? fuente?.activo.instrument_type;
}

const cierreDe = (tarjeta: FuenteDeColumna["tarjeta"]) =>
  tarjeta ? (valorEn(tarjeta, "metrics.as_of") as string | undefined) : undefined;

/** Dos columnas a cierres distintos no miden el mismo periodo. Solo entonces cada una dice el suyo, en su cabecera. */
const seDiceElCierre = (fuentes: readonly FuenteDeColumna[]) =>
  new Set(fuentes.map(({ tarjeta }) => cierreDe(tarjeta)).filter(Boolean)).size > 1;

/**
 * La rentabilidad del proveedor a 1 año no lleva fecha (decisión 114): llega de otra respuesta suya, con su propia fecha, que el extractor no guarda, y en
 * muchos fondos es del cierre del mes siguiente al de su bloque. Sus 3, 5 y 10 años y su riesgo sí son de la fecha de su bloque.
 */
const esSinFecha = (campo: string, ventana: string) => campo === "annualized_return" && ventana === "1y";

/**
 * La fecha de una cifra del proveedor en una tarjeta mezclada (decisión 110): la de sus rentabilidades si la trae aparte, y si no la de su bloque. La que dice
 * su celda en pantalla, «Del proveedor · a 30/09/2026», y la que dice el papel. La de 1 año, ninguna (decisión 114).
 */
function fechaDelProveedor(tarjeta: Documento | undefined, campo: string, ventana: string, { porVentana = false }: { porVentana?: boolean } = {}): string | undefined {
  const provider = valorEn(tarjeta, "metrics.provider") as Documento | undefined;
  /* Decisión B-74: con `returns_as_of_by_window`, cada rentabilidad suya lleva la fecha de su ventana, también la de 1 año. Solo en pantalla: el papel no
     se toca y sigue como antes. */
  const deSuVentana = porVentana && esRentabilidad(campo) ? valorEn(provider, `returns_as_of_by_window.${ventana}`) : undefined;
  if (typeof deSuVentana === "string") return deSuVentana;
  if (esSinFecha(campo, ventana)) return undefined;
  const fecha = valorEn(provider, campo === "annualized_return" ? "returns_as_of" : "as_of") ?? valorEn(provider, "as_of");
  return typeof fecha === "string" ? fecha : undefined;
}

/** Las cifras que imprimen las tablas del papel (las de `COLUMNAS_DEL_INFORME`), con el rótulo de su columna. */
const CIFRAS_DEL_PAPEL: ReadonlyArray<{ campo: string; ventana: string; columna: string }> = [
  { campo: "annualized_return", ventana: "1y", columna: "1A" },
  { campo: "annualized_return", ventana: "3y", columna: "3A" },
  { campo: "annualized_return", ventana: "5y", columna: "5A" },
  { campo: "annualized_return", ventana: "10y", columna: "10A" },
  { campo: "volatility", ventana: "1y", columna: "Vol 1A" },
  { campo: "volatility", ventana: "3y", columna: "Vol 3A" },
  { campo: "sharpe", ventana: "3y", columna: "Sharpe 3A" },
  { campo: "max_drawdown", ventana: "3y", columna: "Máx. caída 3A" }
];

/**
 * Las rentabilidades de una tarjeta con todas sus cifras del proveedor no tienen fecha que afirmar (decisión 119). La tarjeta lleva una sola, la de su bloque
 * de riesgo, y sus rentabilidades salen de otro bloque, cuya fecha no guarda: en 20 de las 54 de la base nueva (06-11-2026), el riesgo es del 31 oct y las
 * rentabilidades del 30 sept. Desde la tarjeta no se sabe en cuáles coinciden, así que donde la cabecera o el papel ponen esa fecha, ninguna rentabilidad
 * suya queda bajo ella. Su volatilidad y su Sharpe sí son de esa fecha.
 */
const esRentabilidad = (campo: string) => campo === "annualized_return";

export interface CifrasDelProveedorEnElPapel {
  /** Las columnas, como las rotula el papel: «3A», «Vol 3A». */
  columnas: string[];
  /** Su fecha, si no es la de las demás cifras del documento. */
  fecha?: string;
  /**
   * No tienen fecha que afirmar, y el papel pone fechas: la rentabilidad del proveedor a 1 año (decisión 114), y todas las rentabilidades de un activo con todas
   * sus cifras del proveedor (decisión 119).
   */
  sinFecha?: true;
  /** Su divisa, si no van en euros. */
  sinConvertir?: string;
}

export interface FechaYDivisaDeLasCifras {
  /** A qué fecha están sus cifras, si no es la misma en todas: lo que escribe la cabecera de su columna en pantalla. */
  cierre?: string;
  /** La divisa de sus cifras, si son las del proveedor y no van en euros. */
  sinConvertir?: string;
  /**
   * En una tarjeta con cifras nuestras y del proveedor (decisión 110), las suyas que van a otra fecha o en otra divisa: se dicen aparte. En una con todas del
   * proveedor, sus rentabilidades, «sin fecha» (decisión 119).
   */
  delProveedor?: CifrasDelProveedorEnElPapel[];
}

/**
 * Lo que el papel dice de cada activo, activo por activo (decisión 80, hallazgo 35): a qué fecha y en qué divisa están sus cifras, solo si hay algo que
 * decir. Las series y las métricas propias van en euros (§5 del método): lo único que puede quedar sin convertir es lo que se copia del proveedor.
 *
 * Una tarjeta mezclada lleva las cifras del proveedor a su fecha, que no es la de las nuestras: Allianz AT2 tiene su 1 año a 31 oct y sus 3, 5 y 10 años del
 * proveedor a 30 sept. Mirando solo `metrics.as_of` el papel no lo decía, y la pantalla sí (revisión final, V3-5).
 *
 * La rentabilidad del proveedor a 1 año no tiene fecha que afirmar (decisión 114). Donde el papel pone fechas, la suya no queda bajo ninguna: se dice «sin
 * fecha». Y un activo cuyas cifras son todas del proveedor lleva la fecha de su bloque de riesgo, que no tiene por qué ser la de sus rentabilidades: todas ellas,
 * 1A, 3A, 5A y 10A, van aparte y «sin fecha» (decisión 119).
 */
export function fechaYDivisaDeLasCifras(fuentes: readonly FuenteDeColumna[]): Map<string, FechaYDivisaDeLasCifras> {
  const porActivo = fuentes.map((fuente) => ({
    ...fuente,
    delProveedor: fuente.tarjeta
      ? CIFRAS_DEL_PAPEL.filter(({ campo, ventana }) => cifraDeLaTarjeta(fuente.tarjeta, campo, ventana).delProveedor)
        /* Con la fecha de su ventana si la tarjeta la trae (decisión B-74), la misma que dice su celda en pantalla: desde la A-125 el papel la sigue. */
        .map(({ campo, ventana, columna }) => {
          const fecha = fechaDelProveedor(fuente.tarjeta, campo, ventana, { porVentana: true });
          return { columna, fecha, sinFecha: esSinFecha(campo, ventana) && fecha === undefined };
        })
      : []
  }));
  const fechas = new Set(porActivo.flatMap(({ tarjeta, delProveedor }) => [cierreDe(tarjeta), ...delProveedor.map(({ fecha }) => fecha)]).filter(Boolean));
  const SIN_FECHA = "sin fecha";
  return new Map(porActivo.map(({ activo, tarjeta, delProveedor }) => {
    const suCierre = cierreDe(tarjeta);
    const cierre = fechas.size > 1 ? suCierre : undefined;
    const metodo = tarjeta ? (valorEn(tarjeta, "metrics.method") as string | undefined) : activo.metrics?.metrics_method;
    const divisa = (valorEn(tarjeta, "identity.currency") as string | undefined) ?? activo.currency;
    const enOtraDivisa = divisa && divisa !== "EUR" ? divisa : undefined;
    const sinConvertir = metodo === "TRAILING_PROVIDER" ? enOtraDivisa : undefined;
    /* Las suyas, por fecha: se dicen si van a otra fecha que las demás, o en otra divisa. La de 1 año, sin fecha si el papel pone alguna. */
    const grupos = new Map<string, string[]>();
    for (const { columna, fecha, sinFecha } of delProveedor) {
      const aOtraFecha = sinFecha ? (fechas.size > 1 ? SIN_FECHA : "") : fechas.size > 1 && fecha && fecha !== suCierre ? fecha : "";
      if (!aOtraFecha && !enOtraDivisa) continue;
      grupos.set(aOtraFecha, [...(grupos.get(aOtraFecha) ?? []), columna]);
    }
    /* Todas del proveedor: su fecha es la de su bloque de riesgo, y sus rentabilidades pueden no ser de ella (decisión 119). Si la tarjeta
       fecha sus rentabilidades (decisión B-74), cada una va con la suya cuando no es la de su riesgo, como su celda en pantalla (decisión A-125). */
    const rentabilidadesSinFecha: string[] = [];
    if (metodo === "TRAILING_PROVIDER") {
      for (const { campo, ventana, columna } of CIFRAS_DEL_PAPEL) {
        if (!esRentabilidad(campo) || cifraDeLaTarjeta(tarjeta, campo, ventana).valor === undefined) continue;
        const suFecha = fechaDeLaRentabilidadDelTitular(tarjeta, ventana);
        if (suFecha) {
          if (suFecha !== suCierre) grupos.set(suFecha, [...(grupos.get(suFecha) ?? []), columna]);
        } else if (cierre) rentabilidadesSinFecha.push(columna);
      }
    }
    if (rentabilidadesSinFecha.length > 0) grupos.set(SIN_FECHA, rentabilidadesSinFecha);
    /* Lo que no tiene fecha, al final: es la excepción a lo que va delante. */
    const aparte = [...grupos].sort(([a], [b]) => Number(a === SIN_FECHA) - Number(b === SIN_FECHA)).map(([fecha, columnas]) => ({
      columnas,
      ...(fecha === SIN_FECHA ? { sinFecha: true as const } : fecha ? { fecha } : {}),
      ...(enOtraDivisa && metodo !== "TRAILING_PROVIDER" ? { sinConvertir: enOtraDivisa } : {})
    }));
    return [activo.asset_id, { ...(cierre ? { cierre } : {}), ...(sinConvertir ? { sinConvertir } : {}), ...(aparte.length > 0 ? { delProveedor: aparte } : {}) }];
  }));
}

export function columnasDeActivos(
  fuentes: FuenteDeColumna[],
  opciones: { modoCliente?: boolean } = {}
): ColumnaComparada[] {
  const dicenSuCierre = seDiceElCierre(fuentes);
  const conCierre = (texto: string, tarjeta: FuenteDeColumna["tarjeta"]) => {
    const cierre = cierreDe(tarjeta);
    return dicenSuCierre && cierre ? `${texto} · a ${dia(cierre)}` : texto;
  };
  return fuentes.map(({ activo, tarjeta }) => {
    const identificador = activo.isin ?? activo.ticker ?? activo.asset_id;
    return {
      id: activo.asset_id,
      nombre: activo.display_name,
      enlaceAFicha: activo.asset_id,
      /* La cabecera dice de dónde salen las cifras de SU columna. Es información que
         el lector necesita para interpretar la fila, y por eso va arriba y no en cada
         celda. */
      apunte: tarjeta
        ? conCierre(
            valorEn(tarjeta, "metrics.series_class") === "MARKET_PRICE"
              ? `${identificador} · precio de mercado`
              : valorEn(tarjeta, "metrics.method") === "TRAILING_PROVIDER"
                ? `${identificador} · proveedor`
                : identificador,
            tarjeta
          )
        : /* De qué base viene una cifra es cocina: con Modo cliente no se dice. */
          opciones.modoCliente
          ? identificador
          : `${identificador} · base anterior`,
      /*
       * El método de la columna sale de la MISMA fuente que sus cifras: la tarjeta cuando la
       * hay, y el activo de siempre cuando se cae a él.
       *
       * Hasta el 03-11-2026 una columna de respaldo se quedaba sin método aunque el activo lo
       * trajera, así que el aviso de «no comparable» no podía morder en ella y el pie del PDF
       * la describía con una metodología que no era la suya. La cabecera decía la base y tiraba
       * el método, que es la mitad que importa.
       */
      metodo: tarjeta
        ? (valorEn(tarjeta, "metrics.method") as string | undefined)
        : activo.metrics?.metrics_method ?? undefined,
      frecuencia: tarjeta
        ? (valorEn(tarjeta, "metrics.frequency") as string | undefined)
        : activo.metrics?.metrics_frequency ?? undefined
    };
  });
}

/** Las filas de la pantalla que el informe imprime como columna y que pueden no ser comparables. El Sortino no sale en el papel. */
export const COLUMNAS_DEL_INFORME = [
  "annualized_return-1y",
  "annualized_return-3y",
  "annualized_return-5y",
  "annualized_return-10y",
  "volatility-1y",
  "volatility-3y",
  "sharpe-3y",
  "caida-3y"
] as const;
export type ColumnaDelInforme = (typeof COLUMNAS_DEL_INFORME)[number];

export interface NoComparableDelInforme {
  /** Las columnas del papel que ponen juntas cifras de métodos distintos. */
  columnas: readonly ColumnaDelInforme[];
  /** Alguna de esas cifras no dice de qué sale: no se puede afirmar que sean distintas, solo que no consta que sean iguales. */
  sinDeclarar: boolean;
  /**
   * De qué sale cada activo con alguna cifra en esas columnas, por su id. Va activo por activo porque no hay una frase que
   * valga para todos: un fondo va en meses cerrados, una acción a diario, y las hay del proveedor.
   */
  calculoDe: Readonly<Record<string, string>>;
}

export interface MetodologiaDelInforme {
  /** El pie de las tablas. */
  footnote: string;
  /** Lo que la pantalla marca «No comparable entre sí». Sin nada que marcar, no está. */
  noComparable?: NoComparableDelInforme;
}

/**
 * Lo que el informe dice de **las cifras que imprime**, leído de las columnas y filas que las imprimen.
 *
 * Vive aquí y no dentro del componente para que se pueda probar: hasta el 03-11-2026 el pie
 * del informe se calculaba de `selected[].metrics` —la base anterior— mientras las filas venían
 * de las tarjetas nuevas, así que el pie podía describir un cálculo que no era el de los
 * números impresos encima. Lo que lo hacía invisible es que nadie podía comprobar la pareja sin
 * renderizar la pantalla entera.
 *
 * Decide «no comparable» la misma función que en la pantalla, fila a fila (`TablaComparativa`). En el papel la marca va en
 * la cabecera de la columna, porque allí las filas son los activos (decisión 42, hallazgo 35). Con algo marcado el pie no
 * dice más: el método se nombra activo por activo, y un «Observaciones: semanales y mensuales» no añadiría nada.
 */
export function metodologiaDeLaComparativa(
    columnas: readonly ColumnaComparada[],
    filas: readonly FilaComparada[]
): MetodologiaDelInforme {
    const metodoDe = (fila: FilaComparada | undefined, columna: ColumnaComparada) => fila?.metodoDe?.(columna) ?? { metodo: columna.metodo, frecuencia: columna.frecuencia };
    const cifrasDe = (fila: FilaComparada | undefined): MethodologyInput[] =>
        columnas.map((columna) => {
            const { metodo, frecuencia } = metodoDe(fila, columna);
            return { value: fila?.valor?.(columna), method: metodo, frequency: frecuencia };
        });
    const impresas = filas.filter((fila) => (COLUMNAS_DEL_INFORME as readonly string[]).includes(fila.id));
    const marcadas = impresas
        .filter((fila) => fila.comparable)
        .map((fila) => ({ fila, aviso: describeMetricsMethodology(cifrasDe(fila), fila.titulo) }))
        .filter(({ aviso }) => aviso.mixed);

    if (marcadas.length === 0) {
        const sharpe = filas.find((fila) => fila.id === "sharpe-3y");
        return { footnote: describeMetricsMethodology(cifrasDe(sharpe), "Sharpe 3A", impresas.flatMap(cifrasDe)).footnote };
    }

    const calculoDe: Record<string, string> = {};
    for (const columna of columnas) {
        /* Una columna puede tener de las dos: las nuestras y, donde no llegan, las del proveedor (decisión 110). Se dicen las dos. */
        const deEsta = marcadas.filter(({ fila }) => fila.valor?.(columna) !== undefined).map(({ fila }) => {
            const { metodo, frecuencia } = metodoDe(fila, columna);
            return calculoEnPalabras({ method: metodo, frequency: frecuencia });
        });
        if (deEsta.length > 0) calculoDe[columna.id] = [...new Set(deEsta)].join(" y ");
    }
    return {
        footnote: describeMetricsMethodology([]).footnote,
        noComparable: {
            columnas: marcadas.map(({ fila }) => fila.id as ColumnaDelInforme),
            sinDeclarar: marcadas.some(({ aviso }) => aviso.sinDeclarar),
            calculoDe
        }
    };
}

/**
 * La ventana comparada, como la escribe el papel: fechas de día, y años con «A», como las columnas de sus tablas. Si el histórico común no da para esos años,
 * con la misma regla que el resto del programa (`backtestWindowCoverage`), no se le llama «3A» a menos de dos años (decisión 80).
 */
export function ventanaDelInforme(
  primera: string | null | undefined,
  ultima: string | null | undefined,
  ventana: string,
  observaciones: number,
  semanal: boolean
): string {
  const cobertura = backtestWindowCoverage({ window: ventana, coverage: { common_observations: observaciones, first_date: primera ?? null, last_date: ultima ?? null } });
  const noLlega = cobertura?.coveredYears != null && !cobertura.coversWindow;
  return `${formato.oFalta(formato.fecha(primera))} a ${formato.oFalta(formato.fecha(ultima))} · ${noLlega ? "no llega a " : ""}${ventana.replace(/Y$/, "A")} · ${formato.oFalta(formato.numero(observaciones))} obs. ${semanal ? "semanales" : "diarias"}`;
}

/**
 * El punto de una columna en el mapa de riesgo/retorno, con sus cifras y su método **de la
 * misma fuente**.
 *
 * El mapa dibuja un panel por método, y hasta el 03-11-2026 tomaba el método de la columna
 * —la tarjeta nueva— y las dos coordenadas de `activo.metrics` —la base anterior—. Así que
 * agrupaba por una etiqueta que no describía los números que pintaba: un punto con cifras
 * semanales podía quedar bajo «calculada por nosotros, mensual». La protección existía y
 * agrupaba por el rótulo, pero nunca contrastaba la procedencia de las coordenadas.
 *
 * Importa más que un rótulo: el mapa existe para que dos cifras de métodos distintos **no
 * compartan ejes**, y con la etiqueta de uno y los números de otro compartían ejes igual.
 */
export function puntoDeLaComparativa(columna: ColumnaComparada, filas: readonly FilaComparada[]) {
    const cifra = (id: string) => filas.find((fila) => fila.id === id)?.valor?.(columna);
    const metodoDeLaCifra = (id: string) => filas.find((fila) => fila.id === id)?.metodoDe?.(columna)?.metodo;
    return {
        id: columna.id,
        nombre: columna.nombre,
        /* El panel de sus coordenadas: si alguna es del proveedor, el punto va con las suyas (decisión 110), y no comparte ejes con las nuestras. */
        metodo: metodoDeLaCifra("volatility-3y") ?? metodoDeLaCifra("annualized_return-3y") ?? columna.metodo,
        volatilidad: cifra("volatility-3y"),
        rentabilidad: cifra("annualized_return-3y")
    };
}

/**
 * La fecha de una rentabilidad del titular cuando es del proveedor (decisión B-74): la de su ventana si la tarjeta la trae en
 * `metrics.returns_as_of_by_window`, y si no `metrics.returns_as_of`. Sin ninguna de las dos, `undefined`: es lo que había antes de la decisión, y se
 * lee como entonces (decisión 119).
 */
function fechaDeLaRentabilidadDelTitular(tarjeta: Documento | undefined, ventana: string): string | undefined {
  const fecha = valorEn(tarjeta, `metrics.returns_as_of_by_window.${ventana}`) ?? valorEn(tarjeta, "metrics.returns_as_of");
  return typeof fecha === "string" ? fecha : undefined;
}

/**
 * Por qué una columna dice «Falta el dato» en una ventana porque nuestra cifra se apartó por salirse de su rango (decisión B-73): la misma frase que la
 * ficha, sin la cifra, que la tarjeta no lleva. Una por cifra, con el nombre del activo. Solo la pantalla: el papel no se toca.
 */
export function notasDeLasCifrasApartadas(fuentes: readonly FuenteDeColumna[]): string[] {
  return cifrasApartadasDeLaComparativa(fuentes).map(({ nota }) => nota);
}

/**
 * Las mismas notas, con la fila de la tabla a la que van (decisión A-125): el papel pone las de rentabilidad bajo su tabla de rentabilidad y las
 * demás bajo la de riesgo. Sin la cifra, como en pantalla: la tarjeta no la lleva, y es papel que puede ir a un cliente.
 */
export function cifrasApartadasDeLaComparativa(fuentes: readonly FuenteDeColumna[]): Array<{ fila: string; nota: string }> {
  return fuentes.flatMap((fuente) =>
    ((valorEn(fuente.tarjeta, "metrics.windows_out_of_range") ?? []) as string[])
      .filter((ruta) => {
        /* Solo las que tienen fila en la tabla y la dejan sin cifra: donde la del proveedor ocupa la celda, con su nombre (decisión 110), no falta nada. */
        const [campo, ventana] = ruta.split(".") as [string, string | undefined];
        if (!ventana || !RUTAS_DE_LA_TABLA.has(ruta)) return false;
        if ((campo === "sharpe" || campo === "sortino") && !seEnsenaLaMetrica(campo, tipoDe(fuente))) return false;
        return !cifraDeLaTarjeta(fuente.tarjeta, campo, ventana).delProveedor;
      })
      .map((ruta) => {
        const [campo, ventana] = ruta.split(".");
        return { fila: campo === "max_drawdown" ? `caida-${ventana}` : `${campo}-${ventana}`, nota: `${fuente.activo.display_name}. ${fraseDeLaCifraApartada({ ruta })}` };
      })
  );
}

/**
 * Lo que cada celda del papel dice debajo de su cifra (decisión A-125): el mismo apunte que la celda de la pantalla —«Del proveedor · a 31/10/2026»,
 * «A 30/09/2026», «Sin fecha»—, sacado de las mismas filas, así que la regla es una sola. Solo las columnas que el papel imprime, y solo las que
 * dicen algo.
 */
export function apuntesDelPapel(
  columnas: readonly ColumnaComparada[],
  filas: readonly FilaComparada[]
): Map<string, Partial<Record<ColumnaDelInforme, string>>> {
  return new Map(
    columnas.map((columna) => {
      const apuntes: Partial<Record<ColumnaDelInforme, string>> = {};
      for (const id of COLUMNAS_DEL_INFORME) {
        const apunte = filas.find((fila) => fila.id === id)?.celda(columna).apunte;
        if (apunte) apuntes[id] = apunte;
      }
      return [columna.id, apuntes];
    })
  );
}

/** Las cifras que la tabla de la pantalla enseña, por su ruta en la tarjeta. */
const RUTAS_DE_LA_TABLA: ReadonlySet<string> = new Set([
  "annualized_return.1y",
  "annualized_return.3y",
  "annualized_return.5y",
  "annualized_return.10y",
  "volatility.1y",
  "volatility.3y",
  "sharpe.3y",
  "sortino.3y",
  "max_drawdown.3y"
]);

/**
 * Por qué una columna dice «Falta el dato» en una ventana a la que su serie llega (decisión 112): la misma frase que la ficha. Una por activo,
 * con su nombre, porque la tabla pone juntos a varios.
 */
export function notasDeLaComparativa(fuentes: readonly FuenteDeColumna[]): string[] {
  return fuentes.flatMap(({ activo, tarjeta }) => {
    const frase = fraseDeLaSerieValida(
      valorEn(tarjeta, "metrics.series_valid_from") as string | undefined,
      (valorEn(tarjeta, "metrics.windows_before_series_valid_from") ?? []) as string[]
    );
    return frase ? [`${activo.display_name}. ${frase}`] : [];
  });
}

/**
 * Días que pueden separar dos fechas de corte antes de que la tabla avise (hallazgo 16, 15-11-2026). Las series no se actualizan todas el
 * mismo día: medido ese día en la base nueva, las acciones van del 06-11 al 12-11 y los fondos cierran a fin de mes. Una semana absorbe
 * ese desfase de refresco —es la misma tolerancia que el último valor frente a su serie (`STALE_LATEST_VALUE_DAYS`) y que los cambios del
 * BCE— y deja ver lo que sí cambia la lectura: un fondo con cifras del proveedor a 30-09 junto a otro a 31-10, o una acción a 09-11 junto
 * a un fondo a 31-10, cuyas cifras miden periodos que no acaban el mismo día.
 */
export const MARGEN_DE_FECHA_DE_CORTE_DIAS = 7;

/**
 * Días que pueden separar la fecha de corte de una columna de método mensual de la de una de método diario antes de que la tabla avise
 * (Óscar, 21-11-2026). No es un desfase de refresco sino de calendario: un fondo cierra sus cifras a fin de mes y las publica a mitad del
 * siguiente, y una acción las cierra cada día; con el refresco a mano, entre las dos caben de 0 a 31 días, y 35 dejan holgura. Medido el
 * 16-11-2026 (`mediciones-21-11/mediciones.md`, apartado 4), con 7 días avisaba el 99,8 % de las parejas fondo-acción y con 35 avisa el 3 %:
 * las de los fondos con un cierre de verdad atrasado (30-09 o antes). Va en un solo sentido: una cifra diaria anterior al cierre mensual
 * no la explica ningún calendario, y ahí vale el margen de siempre.
 *
 * Las cifras del proveedor (frecuencia `PROVIDER`) cuentan como de fin de mes cuando su fecha lo es: lo son todas las de la base nueva
 * (44 tarjetas el 21-11-2026: 18 a 31-10, 21 a 30-09 y 3 a 30-11-2025, más una sin fecha), porque el proveedor publica sus
 * rentabilidades a cierre de mes. Con otra fecha, su calendario no consta y vale el margen de siempre.
 */
export const MARGEN_ENTRE_CALENDARIOS_DIAS = 35;

/** El calendario con el que se cierran las cifras de una columna, por su frecuencia y su fecha; si no consta, ninguno. */
type Calendario = "mensual" | "diario";
function calendarioDe(frecuencia: unknown, corte: unknown): Calendario | undefined {
  if (frecuencia === "MONTHLY") return "mensual";
  if (frecuencia === "DAILY") return "diario";
  if (frecuencia === "PROVIDER" && typeof corte === "string" && esFinDeMes(corte)) return "mensual";
  return undefined;
}
/** Si «aaaa-mm-dd» es el último día de su mes. */
function esFinDeMes(fecha: string): boolean {
  const dia = Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(dia) && new Date(dia + 86_400_000).getUTCDate() === 1;
}

const BASE_EN_PALABRAS: Record<string, string> = {
  TOTAL_RETURN: "rentabilidad total, con dividendos",
  PRICE_RETURN: "rentabilidad de precio, sin dividendos"
};

/** La fecha de corte y la base de una columna, de la misma fuente que sus cifras: la tarjeta si la hay, y si no el activo de siempre. */
function corteYBaseDe({ activo, tarjeta }: FuenteDeColumna): { corte?: string; base?: string; calendario?: Calendario; conCifras: boolean } {
  if (tarjeta) {
    const metricas = valorEn(tarjeta, "metrics") as Documento | undefined;
    const corte = valorEn(tarjeta, "metrics.as_of") as string | undefined;
    return {
      corte,
      base: valorEn(tarjeta, "metrics.return_basis") as string | undefined,
      calendario: calendarioDe(valorEn(tarjeta, "metrics.frequency"), corte),
      conCifras: metricas !== undefined
    };
  }
  const metricas = activo.metrics ?? {};
  return {
    corte: metricas.as_of,
    base: metricas.return_basis,
    calendario: calendarioDe(metricas.metrics_frequency, metricas.as_of),
    conCifras: Object.entries(metricas).some(([clave, valor]) => typeof valor === "number" && clave !== "risk_score")
  };
}

/** «Fondo B, a 30/09/2026; Fondo A y Acción C, a 31/10/2026»: las columnas agrupadas por su fecha, de la más antigua a la más reciente. */
function porFechaDeCorte(columnas: ReadonlyArray<{ corte: string; nombre: string }>): string {
  const porFecha = new Map<string, string[]>();
  for (const { corte, nombre } of [...columnas].sort((a, b) => a.corte.localeCompare(b.corte))) porFecha.set(corte, [...(porFecha.get(corte) ?? []), nombre]);
  return [...porFecha].map(([corte, nombres]) => `${enumeracion(nombres)}, a ${dia(corte)}`).join("; ");
}

const diaJuliano = (fecha: string) => Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`) / 86_400_000;

/** «A, B y C». */
function enumeracion(nombres: readonly string[]): string {
  return nombres.length <= 1 ? (nombres[0] ?? "") : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/**
 * Lo que la tabla dice cuando sus columnas no comparten fecha de corte o base de rentabilidad (hallazgo 16). Avisa y nombra a cada uno;
 * no esconde ni recalcula nada. Sigue la forma del aviso de métodos distintos: una frase bajo la tabla, en `notas`.
 *
 * - Fecha, entre columnas del mismo calendario (o de uno que no consta): si dos se separan más de `MARGEN_DE_FECHA_DE_CORTE_DIAS`, se
 *   dicen las que lo hacen, agrupadas por fecha.
 * - Fecha, entre una de cierre a fin de mes y una de cierre diario (Óscar, 21-11-2026): una frase propia, que explica que se cierran con
 *   calendarios distintos y que solo sale si la diaria va más de `MARGEN_ENTRE_CALENDARIOS_DIAS` por delante de la mensual, o más de
 *   `MARGEN_DE_FECHA_DE_CORTE_DIAS` por detrás: lo que ese calendario no explica.
 * - Base: si hay más de una, cada columna con la suya.
 * - Una columna con cifras que no declara fecha o base, cuando otras sí, se nombra aparte: no se puede afirmar que coincida.
 */
export function notasDeCorteYBase(fuentes: readonly FuenteDeColumna[]): string[] {
  const columnas = fuentes
    .map((fuente) => ({ nombre: fuente.activo.display_name, ...corteYBaseDe(fuente) }))
    .filter((columna) => columna.conCifras);
  const notas: string[] = [];

  const conCorte = columnas.filter((columna): columna is typeof columna & { corte: string } => typeof columna.corte === "string" && Number.isFinite(diaJuliano(columna.corte)));
  /* Pareja a pareja: cada una con el margen que le toca. */
  const mismoCalendario = new Set<(typeof conCorte)[number]>();
  const entreCalendarios = new Set<(typeof conCorte)[number]>();
  conCorte.forEach((a, i) => {
    for (const b of conCorte.slice(i + 1)) {
      const mensual = a.calendario === "mensual" && b.calendario === "diario" ? a : b.calendario === "mensual" && a.calendario === "diario" ? b : undefined;
      if (mensual) {
        const diaria = mensual === a ? b : a;
        const delante = diaJuliano(diaria.corte) - diaJuliano(mensual.corte);
        if (delante > MARGEN_ENTRE_CALENDARIOS_DIAS || delante < -MARGEN_DE_FECHA_DE_CORTE_DIAS) entreCalendarios.add(a).add(b);
      } else if (Math.abs(diaJuliano(a.corte) - diaJuliano(b.corte)) > MARGEN_DE_FECHA_DE_CORTE_DIAS) mismoCalendario.add(a).add(b);
    }
  });
  if (mismoCalendario.size > 0) {
    notas.push(`Las cifras no tienen la misma fecha de corte: ${porFechaDeCorte([...mismoCalendario])}. Una rentabilidad o una volatilidad a otra fecha mide otro periodo, y aquí no se ajusta.`);
  }
  if (entreCalendarios.size > 0) {
    const de = (calendario: Calendario) => enumeracion([...entreCalendarios].filter((columna) => columna.calendario === calendario).map(({ nombre }) => nombre));
    notas.push(
      `Las cifras se cierran con calendarios distintos: las de ${de("mensual")}, a fin de mes, y las de ${de("diario")}, cada día. ` +
        `Eso explica hasta ${MARGEN_ENTRE_CALENDARIOS_DIAS} días entre sus fechas de corte, y aquí la distancia es otra: ${porFechaDeCorte([...entreCalendarios])}. ` +
        "Una rentabilidad o una volatilidad a otra fecha mide otro periodo, y aquí no se ajusta."
    );
  }
  const sinCorte = columnas.filter((columna) => !conCorte.includes(columna as (typeof conCorte)[number]));
  if (conCorte.length > 0 && sinCorte.length > 0) {
    notas.push(`No consta a qué fecha están las cifras de ${enumeracion(sinCorte.map(({ nombre }) => nombre))}: no se puede afirmar que sea la de las demás.`);
  }

  const conBase = columnas.filter((columna): columna is typeof columna & { base: string } => typeof columna.base === "string");
  if (new Set(conBase.map(({ base }) => base)).size > 1) {
    const porBase = new Map<string, string[]>();
    for (const { base, nombre } of conBase) porBase.set(base, [...(porBase.get(base) ?? []), nombre]);
    const grupos = [...porBase].map(([base, nombres]) => `${enumeracion(nombres)}, ${BASE_EN_PALABRAS[base] ?? base}`);
    notas.push(`Las rentabilidades no miden lo mismo: ${grupos.join("; ")}. Ponerlas en la misma fila no las vuelve comparables.`);
  }
  const sinBase = columnas.filter((columna) => typeof columna.base !== "string");
  if (conBase.length > 0 && sinBase.length > 0) {
    notas.push(`No consta si las rentabilidades de ${enumeracion(sinBase.map(({ nombre }) => nombre))} incluyen los dividendos: no se puede afirmar que midan lo mismo que las demás.`);
  }
  return notas;
}

export interface OpcionesDeComparativa {
  /** En modo cliente la retrocesión no se enseña: es información comercial nuestra. */
  modoCliente: boolean;
  /** La retrocesión por activo, cuando el asesor puede verla. */
  retroPorActivo?: Map<string, number | undefined>;
}

export function filasDeActivos(
  fuentes: FuenteDeColumna[],
  { modoCliente, retroPorActivo }: OpcionesDeComparativa
): FilaComparada[] {
  const porId = new Map(fuentes.map((fuente) => [fuente.activo.asset_id, fuente]));
  const de = (columna: ColumnaComparada) => porId.get(columna.id);
  /* Cada cifra con lo que es (apartado 6 de SISTEMA_DISENO.md): la volatilidad, la caída y los costes, dos decimales sin «+»; la
     rentabilidad, con su signo; el Sharpe y el Sortino, un ratio. */
  const pct = (v: number) => formato.porcentaje(v);
  const conSigno = (v: number) => formato.rentabilidad(v);

  /* Donde no hay cifra nuestra, la del proveedor, y la celda dice de quién es (decisión 110). */
  const delProveedor = (columna: ColumnaComparada, campo: string, ventana: string): boolean =>
    cifraDeLaTarjeta(de(columna)?.tarjeta, campo, ventana).delProveedor;
  const metodoSiEsSuya = (campo: string, ventana: string) => (columna: ColumnaComparada) =>
    delProveedor(columna, campo, ventana) ? { metodo: "TRAILING_PROVIDER", frecuencia: "PROVIDER" } : undefined;
  /* La columna de un activo con todas sus cifras del proveedor lleva en la cabecera la fecha de su bloque de riesgo, si las fechas no coinciden. */
  const dicenSuCierre = seDiceElCierre(fuentes);
  const dichoDelProveedor = (columna: ColumnaComparada, campo: string, ventana: string) => {
    if (!delProveedor(columna, campo, ventana)) {
      const tarjeta = de(columna)?.tarjeta;
      const todasSuyas = valorEn(tarjeta, "metrics.method") === "TRAILING_PROVIDER";
      if (!todasSuyas || !esRentabilidad(campo) || cifraDeLaTarjeta(tarjeta, campo, ventana).valor === undefined) return {};
      /* Decisión B-74: la tarjeta fecha ya la rentabilidad del titular, ventana a ventana. Si no es la de su columna, la celda la dice. */
      const suFecha = fechaDeLaRentabilidadDelTitular(tarjeta, ventana);
      if (suFecha) return suFecha !== cierreDe(tarjeta) ? { apunte: `A ${dia(suFecha)}` } : {};
      /* Sin ella, sus rentabilidades pueden no ser de esa fecha (decisiones 114 y 119): la celda lo dice, para que la de la cabecera no las cubra. */
      return dicenSuCierre ? { apunte: "Sin fecha" } : {};
    }
    const fecha = fechaDelProveedor(de(columna)?.tarjeta, campo, ventana, { porVentana: true });
    return { apunte: `Del proveedor${fecha ? ` · a ${dia(fecha)}` : esSinFecha(campo, ventana) ? ", sin fecha" : ""}` };
  };

  /** La cifra de la tarjeta si la hay, y si no la del activo de siempre. */
  const cifra = (
    columna: ColumnaComparada,
    rutaEnTarjeta: string,
    delActivo: (activo: BdbAssetSearchResult) => number | undefined | null
  ): number | undefined => {
    const fuente = de(columna);
    if (fuente === undefined) return undefined;
    if (fuente.tarjeta) {
      const [, campo, ventana] = rutaEnTarjeta.split(".");
      return cifraDeLaTarjeta(fuente.tarjeta, campo as string, ventana as string).valor;
    }
    return numero(delActivo(fuente.activo));
  };

  const porVentana = (
    ventana: "1y" | "3y" | "5y" | "10y",
    titulo: string,
    campo: "annualized_return" | "volatility",
    escribir: (v: number) => string | null
  ): FilaComparada => {
    const leer = (columna: ColumnaComparada) =>
      cifra(
        columna,
        `metrics.${campo}.${ventana}`,
        (activo) => activo.metrics[`${campo === "annualized_return" ? "annualized_return" : "volatility"}_${ventana}`]
      );
    return {
      id: `${campo}-${ventana}`,
      titulo,
      comparable: true,
      valor: leer,
      metodoDe: metodoSiEsSuya(campo, ventana),
      /* Una rentabilidad va en verde o rojo según su signo, que ya lleva escrito (Óscar, 20-11-2026); la volatilidad, sin color.
         El signo se decide con la cifra tal como se escribe (dos decimales del %): un «+0,00 %» no se pinta. */
      celda: (c) => {
        const valor = leer(c);
        const signo = campo === "annualized_return" ? formato.signoDe(valor, 4) : null;
        return { ...celda(valor, escribir), ...(signo ? { signo } : {}), ...dichoDelProveedor(c, campo, ventana) };
      }
    };
  };

  /* Lo que la lista dice que no se enseña no es que falte: se escribe «No aplica», con o sin
     tarjeta. Si no se le aplica a ninguna columna, la fila no sale: una fila entera de «No aplica»
     no dice nada, y en una tabla mixta sí hace falta decirlo. */
  const aplica = (metrica: MetricaDeInstrumento, columna: ColumnaComparada) =>
    seEnsenaLaMetrica(metrica, tipoDe(de(columna)));
  const aplicaAAlguna = (metrica: MetricaDeInstrumento) =>
    fuentes.some((fuente) => seEnsenaLaMetrica(metrica, tipoDe(fuente)));
  const sharpe = (columna: ColumnaComparada) =>
    aplica("sharpe", columna)
      ? cifra(columna, "metrics.sharpe.3y", (activo) => activo.metrics.sharpe_3y)
      : undefined;
  /* Solo de la tarjeta: la base de siempre no lo tiene. */
  const sortino = (columna: ColumnaComparada) =>
    aplica("sortino", columna) ? cifra(columna, "metrics.sortino.3y", () => undefined) : undefined;
  /* La caída a TRES años en todas las columnas, y no «la que cada uno tenga». La tabla
     anterior enseñaba la histórica o la de cinco según el activo, con la ventana en un
     emergente: dos ventanas distintas en la misma fila no se comparan, y es la regla
     que esta pantalla existe para respetar. La base de siempre no guarda la de tres,
     así que una columna suya la deja vacía. */
  const caida = (columna: ColumnaComparada) =>
    cifra(columna, "metrics.max_drawdown.3y", () => undefined);
  const costeCorriente = (columna: ColumnaComparada): number | undefined => {
    const fuente = de(columna);
    if (fuente === undefined) return undefined;
    if (fuente.tarjeta) return numero(valorEn(fuente.tarjeta, "costs.ongoing_charge"));
    return numero((fuente.activo as BdbAssetSearchResult & { costs?: { ongoing_charge?: number } }).costs?.ongoing_charge);
  };

  const filas: FilaComparada[] = [
    {
      id: "categoria",
      /* El sector de una acción, como en el Buscador: una acción no tiene categoría, y 292 de las 305
         tarjetas traen sector (04-11-2026). */
      titulo: "Categoría o sector",
      textoLargo: true,
      celda: (c) => {
        const fuente = de(c);
        const categoria = clasificacionDeTarjeta(fuente?.tarjeta) ?? categoriaLegible(fuente?.activo.category);
        return categoria ? { texto: categoria } : FALTA;
      }
    },
    {
      id: "divisa",
      /* De la clase, no de las cifras: esas van en euros salvo las del proveedor. */
      titulo: "Divisa de la clase",
      celda: (c) => {
        const divisa =
          (valorEn(de(c)?.tarjeta, "identity.currency") as string | undefined) ?? de(c)?.activo.currency;
        return divisa ? { texto: divisa } : FALTA;
      }
    },
    porVentana("1y", "Rentabilidad anualizada 1 año", "annualized_return", conSigno),
    porVentana("3y", "Rentabilidad anualizada 3 años", "annualized_return", conSigno),
    porVentana("5y", "Rentabilidad anualizada 5 años", "annualized_return", conSigno),
    porVentana("10y", "Rentabilidad anualizada 10 años", "annualized_return", conSigno),
    ...(aplicaAAlguna("morningstar")
      ? [
          {
            id: "estrellas",
            titulo: rotuloDeEstrellas(!modoCliente),
            celda: (c: ColumnaComparada) => {
              if (!aplica("morningstar", c)) return NO_APLICA;
              /* Del activo que devuelve el servidor, en cualquiera de las dos bases. */
              const estrellas = estrellasDeMorningstar(de(c)?.activo.morningstar_rating);
              return estrellas !== undefined
                ? { texto: textoDeEstrellas(estrellas), valor: estrellas }
                : FALTA;
            }
          }
        ]
      : []),
    porVentana("1y", "Volatilidad 1 año", "volatility", pct),
    porVentana("3y", "Volatilidad 3 años", "volatility", pct),
    ...(aplicaAAlguna("sharpe")
      ? [
          {
            id: "sharpe-3y",
            titulo: "Sharpe 3 años",
            comparable: true,
            valor: sharpe,
            metodoDe: metodoSiEsSuya("sharpe", "3y"),
            celda: (c: ColumnaComparada) => (aplica("sharpe", c) ? { ...celda(sharpe(c), formato.ratio), ...dichoDelProveedor(c, "sharpe", "3y") } : NO_APLICA)
          }
        ]
      : []),
    ...(aplicaAAlguna("sortino")
      ? [
          {
            id: "sortino-3y",
            titulo: "Sortino 3 años",
            comparable: true,
            valor: sortino,
            celda: (c: ColumnaComparada) => (aplica("sortino", c) ? celda(sortino(c), formato.ratio) : NO_APLICA)
          }
        ]
      : []),
    {
      id: "caida-3y",
      titulo: "Caída máxima 3 años",
      comparable: true,
      valor: caida,
      /* La tarjeta puede traer la caída del proveedor donde no hay la nuestra (`metrics.provider.max_drawdown`), como la
         rentabilidad o el Sharpe. Hasta el 20-11-2026 esta fila no lo miraba: una caída del proveedor se habría puesto junto
         a las nuestras sin la marca «No comparable entre sí» ni el «Del proveedor» de la celda (§3 del método: misma
         identidad, `(method, window)`). Medido ese día en 8092: ninguna de las 1.334 tarjetas lo trae, así que no cambia
         ninguna tabla de hoy; cierra el hueco antes de que llegue. */
      metodoDe: metodoSiEsSuya("max_drawdown", "3y"),
      /* Una caída es siempre una pérdida, y lleva su signo escrito («−12,00 %»): en rojo, como la rentabilidad que baja (propuesta C3
         de las láminas, aprobada por Óscar el 21-11-2026). Se decide con la cifra tal como se escribe, a dos decimales del %: la caída
         se guarda negativa, y solo la que se escribe con su menos va en rojo. Una de 0,00 % (un monetario que nunca cae) no es una
         pérdida; y una que llegara positiva sería un error del dato: ninguna de las dos lleva color, y nunca el verde. */
      celda: (c) => {
        const valor = caida(c);
        return { ...celda(valor, pct), ...(formato.signoDe(valor, 4) === "baja" ? { signo: "baja" as const } : {}), ...dichoDelProveedor(c, "max_drawdown", "3y") };
      }
    },
    /* ACT-09: el coste corriente, que pesa tanto como la rentabilidad al comparar fondos. De la tarjeta
       si la hay, y si no del activo de siempre; en una acción no aplica. */
    ...(aplicaAAlguna("costeCorriente")
      ? [
          {
            id: "coste-corriente",
            titulo: "Coste corriente",
            /* La fracción, para el papel (ACT-09): la escribe con el formato común sin recalcular. Donde no aplica no hay valor, y la
               celda lo dice («No aplica»). */
            valor: (c: ColumnaComparada) => (aplica("costeCorriente", c) ? costeCorriente(c) : undefined),
            celda: (c: ColumnaComparada) => (aplica("costeCorriente", c) ? celda(costeCorriente(c), pct) : NO_APLICA)
          }
        ]
      : [])
  ];

  if (!modoCliente && retroPorActivo && aplicaAAlguna("retrocesion")) {
    filas.push({
      id: "retro",
      titulo: "Retrocesión",
      celda: (c) => (aplica("retrocesion", c) ? celda(retroPorActivo.get(c.id) ?? undefined, pct) : NO_APLICA)
    });
  }

  return filas;
}
