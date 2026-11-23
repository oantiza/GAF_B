import type {
  BdbPortfolioAllocationBucket,
  BdbPortfolioLookThrough,
  BdbPortfolioReportPosition,
  BdbPortfolioXray
} from "../types/bdbAssets";
import { categoriaLegible } from "../core/etiquetasDeReparto";
import { numero, oFalta, peso } from "../core/formato";
import { origenDeLaLinea, resumenDeLasAcciones, resumenDeLoMirado } from "../core/holdingsLookthrough";
import { textoEnPantalla } from "../core/glosarioDePantalla";
import { CLASS_LABELS, TYPE_LABELS, readableBackendLabel } from "../core/labels";
import { recuentoEnPantalla, senalDeLoQueQuedaFuera, type FueraDeLaMedida } from "../core/medidaDeLaCartera";
import { CLAVE_SIN_REPARTO, filasDeExposicion, fraseDeLoQueNoTieneReparto, type RepartoDeLaCartera } from "../core/radiografiaDeLaCartera";
import { esSinClasificar } from "../core/riesgoPorClase";
import { NOTA_DEL_REPARTO_NETO, tieneCortosOApalancamiento } from "../core/repartoNeto";
import { filasPorCategoria } from "../core/repartoDelPapel";
import { useClientMode } from "../app/ClientModeContext";
import type { ColumnaDeTabla, FilaAgrupable } from "../types/tablaDeDatos";
import { FilasDeReparto, LoQueNoEntra, type FilaDeReparto } from "./FilasDeReparto";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { Ausencia } from "./ui/Ausencia";
import { Cifra } from "./ui/Cifra";
import { ClaseConColor } from "./ui/ClaseConColor";
import { Distintivo } from "./ui/Distintivo";
import { Esqueleto } from "./ui/Esqueleto";
import { Panel } from "./ui/Panel";

interface PortfolioXrayProps {
  xray: BdbPortfolioXray;
  /**
   * Lo que la serie de la cartera deja fuera. «Sin avisos de datos» no se puede decir mientras algo
   * se quede fuera del cálculo por la calidad de su dato: esa frase mira otra cosa.
   */
  fueraDeLaMedida?: readonly FueraDeLaMedida[];
  /** Con ellas, «Datos completos» no cuenta lo que se queda fuera del cálculo. */
  posiciones?: readonly BdbPortfolioReportPosition[];
  /** Lo que no entra en estos repartos: lo no invertible se dice, y la exposición no se reescala en silencio. */
  reparto?: RepartoDeLaCartera;
}

/* Un decimal, como el resto de pesos de la página: «56,0 %», no «56,00 %». */
function formatPercent(value: number): string {
  return oFalta(peso(value / 100));
}

/* Las categorías llegan con su nombre (`portfolio.ts`): `readableBackendLabel` escribiría «Rf dkk» donde dice «RF DKK». Las mismas filas que el
   papel (`filasPorCategoria`): la base nueva no le pone categoría a una acción, y aquí salía «N/D» donde el papel dice «Acciones» (decisión 83), y un
   fondo sin categoría salía «N/D» donde el papel dice «No declarado». Por peso, como el papel. */
function filasDeCategoria(xray: BdbPortfolioXray, posiciones: readonly BdbPortfolioReportPosition[] | undefined): FilaDeReparto[] {
  return [...filasPorCategoria({ xray, positions: posiciones ? [...posiciones] : [] })]
    .sort((a, b) => b.weight_percent - a.weight_percent)
    .map((bucket) => ({ clave: bucket.key, rotulo: categoriaLegible(bucket.key) ?? bucket.key, peso: bucket.weight_percent }));
}

function bucketItems(buckets: BdbPortfolioAllocationBucket[], labels?: Record<string, string>): FilaDeReparto[] {
  return buckets.map((bucket) => ({
    clave: bucket.key,
    rotulo: labels?.[bucket.key] ?? categoriaLegible(readableBackendLabel(bucket.key)) ?? bucket.key,
    peso: bucket.weight_percent
  }));
}

interface FilaSubyacente extends FilaAgrupable {
  nombre: string;
  identificador: string | null;
  peso: number;
  /** «Directa + 2 fondos», «3 fondos»; `fuentes` es lo que ordena: cuántos sitios la llevan. */
  origen: string;
  fuentes: number;
}

const COLUMNAS_SUBYACENTES: ColumnaDeTabla<FilaSubyacente>[] = [
  { id: "nombre", titulo: "Nombre", encabezaFila: true, celda: (fila) => ({ texto: fila.nombre, valor: fila.nombre }) },
  {
    id: "identificador",
    titulo: "ISIN / ticker",
    /* Una pata de derivado o de divisa no tiene ISIN: no es un dato que nos falte. */
    celda: (fila) => (fila.identificador ? { texto: fila.identificador, valor: fila.identificador } : { texto: "Sin identificador", ausencia: "no-aplica" })
  },
  { id: "peso", titulo: "Peso agregado", cifra: true, celda: (fila) => ({ texto: oFalta(peso(fila.peso / 100)), valor: fila.peso }) },
  { id: "origen", titulo: "Origen", celda: (fila) => ({ texto: fila.origen, valor: fila.fuentes }) }
];

function filasSubyacentes(rows: BdbPortfolioLookThrough["rows"]) {
  return rows.map((row) => ({
    id: row.key,
    nombre: row.name,
    identificador: row.identifier ?? null,
    peso: row.weight_percent,
    origen: origenDeLaLinea(row),
    fuentes: row.fund_count + (row.direct_weight_percent ? 1 : 0)
  }));
}

/**
 * Las acciones que hay de verdad detrás de la cartera, lo que el cliente reconoce (decisión 9). Se lee del código de cada línea y
 * nunca del nombre: si algún fondo con renta variable no lo trae, que es lo que pasa en la nube hasta que se suba el catálogo, no se
 * da una lista a medias. Al cliente no se le enseña nada, y al asesor se le dice qué fondo es.
 */
export function MayoresAcciones({
  lookThrough,
  loading,
  error
}: {
  lookThrough?: BdbPortfolioLookThrough | null;
  loading?: boolean;
  error?: string | null;
}) {
  const { enabled: clientMode } = useClientMode();
  const acciones = lookThrough?.equities;
  const sinClase = acciones?.unclassified_funds ?? [];
  const filas = acciones?.rows ?? [];
  const sePuedeDar = lookThrough && sinClase.length === 0 && filas.length > 0;
  if (clientMode && !sePuedeDar) return null;

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      subtitulo={
        sePuedeDar
          ? `Las ${filas.length} mayores, de lo que llevan los fondos y de lo que hay en directo · ${resumenDeLoMirado(lookThrough)}`
          : "De lo que llevan los fondos y de lo que hay en directo"
      }
      titulo="Mayores acciones de la cartera"
    >
      {loading ? (
        <div className="stack stack--2" aria-busy="true">
          <p className="analisis-nota" role="status">Cargando las carteras de los fondos…</p>
          <Esqueleto lineas={5} />
        </div>
      ) : error ? (
        <div className="empty-inline">
          <strong>No se han podido cargar las carteras de los fondos</strong>
          <span>{error}</span>
        </div>
      ) : sinClase.length > 0 ? (
        <div className="empty-inline">
          <strong>No se pueden separar las acciones de esta cartera</strong>
          <span>
            No consta de qué tipo es cada línea de {sinClase.join(", ")}, y no se deduce del nombre. Hace falta actualizar el catálogo.
          </span>
        </div>
      ) : sePuedeDar ? (
        <>
          <TablaDeDatos columnas={COLUMNAS_SUBYACENTES} deActivos filas={filasSubyacentes(filas)} titulo="Mayores acciones de la cartera" />
          <p className="page-footnote">
            Excluye derivados, divisa y efectivo; la renta fija se lee en Exposición agregada. {resumenDeLasAcciones(lookThrough)}
          </p>
        </>
      ) : (
        <div className="empty-inline">
          <strong>Sin acciones identificadas</strong>
          <span>Las carteras publicadas de las posiciones no llevan acciones.</span>
        </div>
      )}
    </Panel>
  );
}

/**
 * Las mayores posiciones subyacentes, sean lo que sean. Del asesor, y solo suya (decisión 9): aporta lo que «Mayores acciones» no
 * dice, qué bonos y qué fondos hay debajo y cómo de grandes son las patas de los derivados. Por eso sus pesos no se suman.
 */
export function ComposicionSubyacente({
  lookThrough,
  loading,
  error
}: {
  lookThrough?: BdbPortfolioLookThrough | null;
  loading?: boolean;
  error?: string | null;
}) {
  const rows = lookThrough?.rows ?? [];

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      /* Del asesor: en Modo cliente no se monta, y a su vista lo dice. */
      estado={<Distintivo tono="interno">Interno</Distintivo>}
      subtitulo={
        rows.length > 0 && lookThrough
          ? `Pesos brutos, incluye derivados · Las ${rows.length} mayores posiciones subyacentes, agregadas · ${resumenDeLoMirado(lookThrough)}`
          : "Pesos brutos, incluye derivados · Las mayores posiciones subyacentes, agregadas"
      }
      titulo="Composición subyacente"
    >
      {loading ? (
        <div className="stack stack--2" aria-busy="true">
          <p className="analisis-nota" role="status">Cargando posiciones subyacentes…</p>
          <Esqueleto lineas={5} />
        </div>
      ) : error ? (
        <div className="empty-inline">
          <strong>No se pudo cargar la composición subyacente</strong>
          <span>{error}</span>
        </div>
      ) : rows.length > 0 ? (
        <>
          <TablaDeDatos columnas={COLUMNAS_SUBYACENTES} deActivos filas={filasSubyacentes(rows)} titulo="Composición subyacente" />
          <p className="page-footnote">Además, derivados y divisa de los fondos: no se suman porque son importes nominales, no inversión directa.</p>
        </>
      ) : (
        <div className="empty-inline">
          <strong>Sin subyacentes agregables</strong>
          <span>Ninguna posición de esta cartera publica su cartera interna completa.</span>
        </div>
      )}
      {lookThrough?.warnings.length ? <p className="page-footnote">{lookThrough.warnings.slice(0, 3).join(" ")}</p> : null}
    </Panel>
  );
}

/** «Concentración por posición» enseña solo las mayores: la cartera entera ya está en la composición. */
const MAYORES_DE_LA_CONCENTRACION = 5;

export function PortfolioXray({ xray, fueraDeLaMedida = [], posiciones, reparto }: PortfolioXrayProps) {
  const { enabled: clientMode } = useClientMode();
  const fuera = reparto?.fuera ?? [];
  const parteInvertible = reparto?.parteInvertible ?? 1;
  const porSuClasePct = typeof xray.pms_exposure_fallback_percent === "number" ? xray.pms_exposure_fallback_percent * parteInvertible : 0;
  const filasDeLaExposicion = filasDeExposicion(xray.pms_exposure_percent, parteInvertible, xray.pms_exposure_sin_reparto_percent ?? 0);
  const recuento = posiciones ? recuentoEnPantalla(posiciones, fueraDeLaMedida) : null;
  /* Las señales del núcleo solo miran los avisos de cada ficha: no saben que algo se ha quedado fuera de
     la simulación. Se dice aquí, sin tocar lo que también lee el papel. */
  const senalDeFuera = senalDeLoQueQuedaFuera(fueraDeLaMedida);
  const senales = senalDeFuera ? [senalDeFuera, ...xray.data_risk_signals] : xray.data_risk_signals;
  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      subtitulo={!clientMode ? "Reparto por producto, categoría y exposición. No optimiza ni evalúa idoneidad." : undefined}
      titulo="Estructura de la cartera"
      tituloId="portfolio-xray-title"
    >
      {/* «Benchmarks excluidos» sale de aquí y se anuncia entre las señales de datos, que es donde se lee. Y sin
          «Concentración: Balanceada»: un adjetivo no se pone al lado de la mayor posición con su cifra (decisión 18).
          Lo que el papel dice de la concentración no pasa por aquí. ANA-30: la mayor posición se dice una sola vez, con
          su nombre y su cifra; el bloque destacado que la repetía se fue. */}
      <dl aria-label="Estructura de la cartera" className="analisis-filas">
        <div className="analisis-filas__fila">
          <dt>Posiciones</dt>
          <dd>{`${xray.investable_positions}/${xray.total_positions}`}</dd>
        </div>
        <div className="analisis-filas__fila">
          <dt>
            Mayor posición
            {xray.top_position ? <small>{xray.top_position.display_name}</small> : null}
            {/* Qué es: el producto y la clase de activo, con el punto de su color (volvió el 14-11-2026, como antes del rediseño). */}
            {xray.top_position ? (
              <small>
                {TYPE_LABELS[xray.top_position.instrument_type] ?? readableBackendLabel(xray.top_position.instrument_type)}
                {" · "}
                <ClaseConColor clave={xray.top_position.economic_asset_class}>
                  {/* A-202: sin clase conocida, «Sin clasificar»; «Otros» es una clase. */}
                  {esSinClasificar(xray.top_position.economic_asset_class)
                    ? "Sin clasificar"
                    : (CLASS_LABELS[xray.top_position.economic_asset_class] ?? readableBackendLabel(xray.top_position.economic_asset_class))}
                </ClaseConColor>
              </small>
            ) : null}
          </dt>
          <dd>{xray.top_position ? formatPercent(xray.top_position.weight_percent) : <Ausencia clase="falta" />}</dd>
        </div>
        {!clientMode ? (
          <>
            <div className="analisis-filas__fila">
              <dt>Métricas de rentabilidad y riesgo</dt>
              <dd>{`${recuento?.conMetricas ?? xray.performance_preview_available}/${xray.investable_positions}`}</dd>
            </div>
            <div className="analisis-filas__fila">
              <dt>Datos completos</dt>
              <dd>{`${recuento?.completas ?? xray.coverage_complete_positions}/${xray.investable_positions}`}</dd>
            </div>
            <div className="analisis-filas__fila">
              <dt>Calidad disponible</dt>
              <dd>{`${xray.data_quality_summary_available}/${xray.investable_positions}`}</dd>
            </div>
          </>
        ) : null}
      </dl>

      <div className="xray-dist-grid">
        <div className="xray-dist-block">
          <h3>Producto</h3>
          <FilasDeReparto filas={bucketItems(xray.by_instrument_type, TYPE_LABELS)} vacio="Sin posiciones invertibles." />
          <LoQueNoEntra partes={fuera} />
        </div>
        <div className="xray-dist-block">
          <h3>Categoría</h3>
          <FilasDeReparto filas={filasDeCategoria(xray, posiciones)} vacio="Sin posiciones invertibles." />
          <LoQueNoEntra partes={fuera} />
        </div>
        <div className="xray-dist-block">
          <h3>Exposición agregada</h3>
          {/* A-203: lo que no tiene reparto va en su fila, «Falta el dato», y la frase de debajo dice qué posiciones son. */}
          <FilasDeReparto
            claveDeLoQueFalta={CLAVE_SIN_REPARTO}
            filas={filasDeLaExposicion}
            porClase
            vacio="Sin posiciones invertibles."
          />
          <LoQueNoEntra partes={fuera} sobreLaCartera />
          {/* C-29: con un fondo de reparto neto dentro, una clase de la cartera puede salir en negativo o pasar del 100 %. */}
          {tieneCortosOApalancamiento(filasDeLaExposicion.map((fila) => fila.peso), 100) ? <p className="cmp-note">{NOTA_DEL_REPARTO_NETO}</p> : null}
          {xray.pms_exposure_sin_reparto?.length ? <p className="cmp-note">{fraseDeLoQueNoTieneReparto(xray.pms_exposure_sin_reparto)}</p> : null}
          {porSuClasePct > 0.05 ? (
            <p className="cmp-note">
              {/* S6a (P5): con relleno por clase, se DICE cuánto peso va rellenado. */}
              El <Cifra tipo="peso" valor={porSuClasePct / 100} /> del peso cuenta por su clase de
              activo (activos sin desglose de exposición).
            </p>
          ) : null}
        </div>
      </div>

      {/* En modo cliente queda un solo bloque (sin «Señales de datos»): a todo el
          ancho, sin el tercio vacío a la derecha (revisión 16-10). */}
      <div className={clientMode ? "xray-dist-grid xray-dist-grid--secondary xray-dist-grid--single" : "xray-dist-grid xray-dist-grid--secondary"}>
        <div className="xray-dist-block">
          <h3>Concentración por posición</h3>
          {/* ANA-30: las cinco mayores, y cuántas hay; la lista entera no se repite aquí. */}
          {xray.investable_positions > MAYORES_DE_LA_CONCENTRACION ? (
            <p className="analisis-nota">{`Las ${MAYORES_DE_LA_CONCENTRACION} mayores de ${oFalta(numero(xray.investable_positions))}.`}</p>
          ) : null}
          <FilasDeReparto
            filas={xray.position_concentration.slice(0, MAYORES_DE_LA_CONCENTRACION).map((position) => ({
              clave: position.asset_id,
              rotulo: position.display_name,
              peso: position.weight_percent
            }))}
            vacio="Sin posiciones invertibles."
          />
        </div>
        {/* Auditoría 16-10: diagnóstico de datos («posiciones con avisos de
            calidad»): como los KPI de calidad de arriba, no existe en modo cliente. */}
        {!clientMode ? <div className="xray-dist-block">
          <h3>Señales de datos</h3>
          {senales.length > 0 || xray.excluded_non_investable_positions > 0 ? (
            <ul className="rows">
              {/* Cada señal es una frase, y se lee entera (`rows__label--frase`): recortada a dos líneas perdía el final,
                  que es lo que dice qué posición queda fuera del cálculo. */}
              {senales.map((signal) => (
                <li className="rows__item" key={signal}>
                  <span className="rows__label rows__label--frase">{textoEnPantalla(signal)}</span>
                </li>
              ))}
              {xray.excluded_non_investable_positions > 0 ? (
                <li className="rows__item" key="excluded">
                  <span className="rows__label rows__label--frase">
                    {xray.excluded_non_investable_positions === 1
                      ? "1 posición excluida de la lectura."
                      : `${xray.excluded_non_investable_positions} posiciones excluidas de la lectura.`}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="empty-inline">Sin señales adicionales.</p>
          )}
        </div> : null}
      </div>
    </Panel>
  );
}
