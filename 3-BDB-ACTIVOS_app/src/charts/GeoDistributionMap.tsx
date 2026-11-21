import { useState } from "react";
import { GEO_AREAS, GEO_VIEWBOX, type GeoAreaId } from "./worldMapGeo";
import { Ausencia } from "../components/ui/Ausencia";
import { NO_DECLARADO } from "../components/xrayBreakdownLabels";
import { buildRegionTable, zoneColor, ZONE_CHIP, ZONE_LABEL, type Macro } from "../core/regionTaxonomy";
import { pesoDelGrafico } from "./oaa/chartFormatters";

interface GeoRow {
  key: string;
  weight_percent: number;
}
interface GeoDistributionMapProps {
  rows: GeoRow[];
  /**
   * `wide`: mapa a la izquierda y desglose por regiones a la derecha (Análisis).
   * `stacked`: mapa arriba y tres filas por macro-zona debajo, con el color de la
   * zona en una marca (columna lateral del Constructor).
   */
  layout?: "wide" | "stacked";
  /**
   * % de la renta variable que nadie declara (núcleo: `unclassified_weight_percent`). Las filas son % de TODA la RV, así
   * que las zonas suman 100 menos esto, y se dice para que no parezca un hueco: bajo el mapa, o en su propia fila en
   * `stacked`.
   */
  unclassifiedPercent?: number;
  /** Lo que hay que saber del reparto, como «Canadá y África aún no se separan». En `stacked`, lo dice el panel anfitrión. */
  nota?: string | null;
}

/** Área del mapa -> macro-zona (hue). */
const AREA_MACRO: Record<GeoAreaId, Macro> = {
  north_america: "america",
  latin_america: "america",
  europe: "emea",
  africa: "emea",
  middle_east: "emea",
  asia: "asia",
  japan: "asia",
  oceania: "asia"
};

const MACROS: Macro[] = ["america", "emea", "asia"];
/* Un decimal, como el resto de pesos de la página. */
const fmt = (v: number) => pesoDelGrafico(v);

/* Cada zona, con su color (América azul, Europa latón, Asia verde salvia; dirección A, 18-11-2026) y la intensidad según su peso: los tramos son
   los de siempre (menos de 25, de 25 a 50, de 50 a 75 y desde 75 %). El color de la zona es el mismo en el mapa, en su
   leyenda y en el punto de la tabla de al lado. Vive en `core/regionTaxonomy.ts` (`zoneColor`, `ZONE_CHIP`). */

/**
 * La tabla de regiones por macro-zona: las mismas filas y los mismos nombres en Análisis y en Carteras guardadas, para que
 * la misma cartera se lea igual en las dos (decisión 50). Una fila a 0,0 % no informa de nada: solo lista lo que pesa.
 */
export function DesgloseDeRegiones({
  rows,
  activeMacro = null,
  onActiveMacro
}: {
  rows: GeoRow[];
  activeMacro?: Macro | null;
  onActiveMacro?: (macro: Macro | null) => void;
}) {
  const visibleTable = buildRegionTable(rows).table.filter((r) => r.value > 0.005);
  return (
    <table className="geo-map-table" aria-label="Distribución geográfica">
      <tbody>
        {visibleTable.map((r, i) =>
          r.group ? (
            <tr
              key={`g${i}`}
              className={`geo-map-group-row ${r.macro && activeMacro === r.macro ? "active" : ""}`}
              onMouseEnter={() => r.macro && onActiveMacro?.(r.macro)}
              onMouseLeave={() => onActiveMacro?.(null)}
            >
              <td>
                {/* El color de la zona, el del mapa: valor por dato, en tiempo de ejecución. */}
                <i style={{ background: r.macro ? ZONE_CHIP[r.macro] : "var(--tinta-2)" }} />
                {r.label}
              </td>
              <td className="geo-map-num">{fmt(r.value)}</td>
            </tr>
          ) : (
            <tr key={`r${i}`} className="geo-map-subrow">
              <td>{r.label}</td>
              <td className="geo-map-num">{fmt(r.value)}</td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

/**
 * Distribución geográfica estilo Morningstar: mapa (Natural Earth) a la izquierda,
 * coloreado por zona (América azul, Europa / O. Medio / África latón, Asia verde salvia) con
 * la INTENSIDAD según el peso de cada una; tabla jerárquica a la derecha, coordinada por
 * color. ANA-17: cada zona del mapa es una parada de teclado con nombre, dentro de un
 * grupo y no de una imagen.
 */
export function GeoDistributionMap({ rows, layout = "wide", unclassifiedPercent = 0, nota = null }: GeoDistributionMapProps) {
  const [activeMacro, setActiveMacro] = useState<Macro | null>(null);
  /* El mapa se pinta con los totales completos de `macroTotals`; el desglose, solo con lo que pesa. */
  const { table, macroTotals, other: sinSituar } = buildRegionTable(rows);
  const hasData = table.some((r) => r.value > 0.005);

  const stacked = layout === "stacked";
  const hayNoDeclarado = unclassifiedPercent > 0.05;
  /* Una región que no se sabe situar no se calla: las zonas no sumarían lo que deben y no se sabría por qué. */
  const sinSituarNote = sinSituar > 0.05 ? `${fmt(sinSituar)} sin situar` : null;

  return (
    <div className={stacked ? "geo-map geo-map--stacked" : "geo-map"}>
      <div className="geo-map-figure">
        {stacked ? null : <h3 className="geo-map-column-title">Exposición por región de la renta variable</h3>}
        <svg
          className="geo-map-svg"
          viewBox={GEO_VIEWBOX}
          role="group"
          aria-label="Distribución geográfica de la renta variable por zona: un color por zona y, más intenso, más peso"
        >
          {GEO_AREAS.map((a) => {
            const macro = AREA_MACRO[a.id];
            const v = macroTotals[macro];
            return (
              <path
                key={a.id}
                tabIndex={0}
                role="img"
                aria-label={`${a.label}, en ${ZONE_LABEL[macro]}: ${fmt(v)} de la renta variable`}
                className={`geo-map-area geo-map-zona ${activeMacro === macro ? "active" : ""}`}
                d={a.d}
                fill={zoneColor(macro, v)}
                stroke="var(--papel)"
                strokeWidth={0.5}
                strokeLinejoin="round"
                onFocus={() => setActiveMacro(macro)}
                onBlur={() => setActiveMacro(null)}
                onMouseEnter={() => setActiveMacro(macro)}
                onMouseLeave={() => setActiveMacro(null)}
              >
                <title>{`${ZONE_LABEL[macro]}: ${fmt(v)}`}</title>
              </path>
            );
          })}
        </svg>
        {stacked ? (
          <div className="geo-map-zonas">
            {MACROS.map((m) => (
              <div
                key={m}
                className={activeMacro === m ? "active" : undefined}
                onMouseEnter={() => setActiveMacro(m)}
                onMouseLeave={() => setActiveMacro(null)}
              >
                {/* La marca es la leyenda del mapa: sin ella, el color de cada zona no
                    tendría nombre. Valor por dato, calculado en tiempo de ejecución. */}
                <i aria-hidden="true" style={{ background: ZONE_CHIP[m] }} />
                <span>{ZONE_LABEL[m]}</span>
                <strong>{fmt(macroTotals[m])}</strong>
              </div>
            ))}
            {sinSituarNote ? (
              <div>
                <i aria-hidden="true" />
                <span>Sin situar</span>
                <strong>{fmt(sinSituar)}</strong>
              </div>
            ) : null}
            {hayNoDeclarado ? (
              <div>
                <i aria-hidden="true" />
                <span><Ausencia clase="falta" motivo={NO_DECLARADO} /></span>
                <strong>{fmt(unclassifiedPercent)}</strong>
              </div>
            ) : null}
          </div>
        ) : (
        <div className="geo-map-chips">
          {MACROS.map((m) => (
            <span
              key={m}
              className={`geo-map-macro-chip ${activeMacro === m ? "active" : ""}`}
              onMouseEnter={() => setActiveMacro(m)}
              onMouseLeave={() => setActiveMacro(null)}
            >
              {/* El color de la zona: valor por dato, calculado en tiempo de ejecución. */}
              <i style={{ background: ZONE_CHIP[m] }} />
              {ZONE_LABEL[m]} <strong>{fmt(macroTotals[m])}</strong>
            </span>
          ))}
        </div>
        )}
        {stacked ? null : (
          <>
            <p className="geo-map-note">
              {["Un color por zona; más intenso, más peso", sinSituarNote, nota].filter(Boolean).join(" · ")}.
            </p>
            {hayNoDeclarado ? (
              <p className="geo-map-note">
                <Ausencia clase="falta" motivo={`${NO_DECLARADO}: ${fmt(unclassifiedPercent)} de la renta variable`} />
              </p>
            ) : null}
          </>
        )}
      </div>

      {hasData && !stacked ? (
        <div>
          <div className="geo-map-table-head">
            <h3 className="geo-map-column-title">Por región</h3>
            <span>% RV</span>
          </div>
          <DesgloseDeRegiones rows={rows} activeMacro={activeMacro} onActiveMacro={setActiveMacro} />
        </div>
      ) : null}
    </div>
  );
}
