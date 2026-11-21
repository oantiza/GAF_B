import { useMemo } from "react";

import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { OaaDonutChart, OaaStyleBoxChart } from "../charts/oaa";
import { cajaDeEstilo, hayAlgoQueDibujar, notasDeLaCaja } from "../core/cajaDeEstilo";
import { repartoDeclarado, type EquityRegionAllocation } from "../core/equityRegions";
import { computeEquitySectorAllocation } from "../core/equitySectors";
import { numero, oFalta, peso } from "../core/formato";
import { perfilDeRentaFija, type CifraDeRentaFija } from "../core/perfilDeRentaFija";
import { FilasDeReparto } from "./FilasDeReparto";
import { breakdownLabel, NO_DECLARADO, sectorDonutSlices } from "./xrayBreakdownLabels";
import { Ausencia } from "./ui/Ausencia";
import { Panel } from "./ui/Panel";

interface XrayMetricsStyleProps {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
}

const SIN_RENTA_VARIABLE = "Sin renta variable en esta cartera";
const conUnDecimal = (porcentaje: number) => oFalta(peso(porcentaje / 100));
const hayRentaVariable = ({ rows, unclassified_weight_percent: noDeclarado }: EquityRegionAllocation) => rows.length > 0 || noDeclarado > 0;
const noDeclaradoDeLaRentaVariable = (parte: number) => `${NO_DECLARADO}: ${conUnDecimal(parte)} de la renta variable`;

/**
 * Un reparto de la renta variable: lo publicado, y lo que no se publica escrito aparte (decisión 11). Sin esa línea
 * la lista no llega al 100 % y no dice por qué.
 */
function RepartoDeRentaVariable({ titulo, reparto }: { titulo: string; reparto: EquityRegionAllocation }) {
  const { rows, unclassified_weight_percent: noDeclarado } = reparto;
  return (
    <div className="xray-dist-block">
      <h3>{titulo}</h3>
      {!hayRentaVariable(reparto) ? <Ausencia clase="no-aplica" motivo={SIN_RENTA_VARIABLE} /> : null}
      {rows.length > 0 ? (
        <FilasDeReparto filas={rows.map((row) => ({ clave: row.key, rotulo: breakdownLabel(row.key), peso: row.weight_percent }))} />
      ) : null}
      {noDeclarado > 0 ? (
        <p className="xray-dist-pie">
          <Ausencia clase="falta" motivo={noDeclaradoDeLaRentaVariable(noDeclarado)} />
        </p>
      ) : null}
    </div>
  );
}

/** Una cifra de la renta fija con lo que la respalda: sin cobertura no se sabe sobre qué parte se lee. */
function FilaDeRentaFija({
  rotulo,
  cifra,
  escribir,
  femenino = false
}: {
  rotulo: string;
  cifra: CifraDeRentaFija;
  escribir: (valor: number) => string;
  femenino?: boolean;
}) {
  const declarado = femenino ? "Declarada" : "Declarado";
  return (
    <li>
      <span className="xray-dist-label">
        {rotulo}
        <small className="xray-dist-cobertura">
          {cifra.valor === null
            ? `Ninguna posición ${femenino ? "la" : "lo"} declara`
            : cifra.cobertura >= 99.95
              ? `${declarado} por toda la renta fija`
              : `${declarado} por el ${conUnDecimal(cifra.cobertura)} de la renta fija`}
        </small>
      </span>
      <b>{cifra.valor === null ? <Ausencia clase="falta" estrecha /> : escribir(cifra.valor)}</b>
    </li>
  );
}

const enPorcentaje = (fraccion: number) => oFalta(peso(fraccion));
const enAnios = (anios: number) => `${oFalta(numero(anios, { decimales: 1 }))} años`;

export function XrayMetricsStyle({ assets, positions }: XrayMetricsStyleProps) {
  const breakdown = useMemo(
    () => ({
      sectors: computeEquitySectorAllocation(positions, assets),
      styles: repartoDeclarado(positions, assets, (a) => a.exposure_detail?.equity_styles),
      caps: repartoDeclarado(positions, assets, (a) => a.exposure_detail?.market_caps),
      caja: cajaDeEstilo(positions, assets),
      rentaFija: perfilDeRentaFija(positions, assets)
    }),
    [assets, positions]
  );

  const { styles, caps, caja, rentaFija } = breakdown;
  const notas = notasDeLaCaja(caja);

  return (
    <Panel
      claseDelCuerpo="xray-style-body"
      className="xray-style-block"
      /* Un solo origen por sección, en su línea de procedencia: cinco sellos repetían lo mismo. */
      subtitulo="Lo que publica cada activo · estilo, tamaño y sectores en % de la renta variable · renta fija, media de lo que se declara."
      titulo="Estilo, sectores y renta fija"
    >
        <div className="xray-style-grid">
          <div className="xray-style-section xray-style-section--third">
            <h3>Estilo y tamaño</h3>
            {!caja ? <Ausencia clase="no-aplica" motivo={SIN_RENTA_VARIABLE} /> : null}
            {caja && hayAlgoQueDibujar(caja) ? (
              <OaaStyleBoxChart
                celdas={caja.celdas}
                cell={54}
                ariaLabel="Caja estilo tamaño de la cartera"
              />
            ) : null}
            {notas.aproximacion ? <p className="xray-dist-pie">{notas.aproximacion}</p> : null}
            {notas.cortos ? <p className="xray-dist-pie">{notas.cortos}</p> : null}
            {notas.noDeclarada !== null ? (
              <p className="xray-dist-pie">
                <Ausencia clase="falta" motivo={noDeclaradoDeLaRentaVariable(notas.noDeclarada)} />
              </p>
            ) : null}
          </div>
          <div className="xray-style-section xray-style-section--third">
            <h3>Sectores de la renta variable</h3>
            {/* Sin nada declarado no hay aro que cerrar: lo mismo que Estilo y Tamaño, al lado. */}
            {breakdown.sectors.rows.length > 0 ? (
              <OaaDonutChart
                data={sectorDonutSlices(breakdown.sectors.rows, breakdown.sectors.unclassified_weight_percent)}
                height={218}
                innerRadius={52}
                outerRadius={78}
              />
            ) : hayRentaVariable(breakdown.sectors) ? (
              <Ausencia clase="falta" motivo={noDeclaradoDeLaRentaVariable(breakdown.sectors.unclassified_weight_percent)} />
            ) : (
              <Ausencia clase="no-aplica" motivo={SIN_RENTA_VARIABLE} />
            )}
          </div>
          <div className="xray-style-section xray-style-section--third stack">
            <RepartoDeRentaVariable titulo="Estilo" reparto={styles} />
            <RepartoDeRentaVariable titulo="Tamaño" reparto={caps} />
            <div className="xray-dist-block">
              <h3>Renta fija</h3>
              {rentaFija ? (
                <>
                  <p className="xray-dist-pie">Sobre el {conUnDecimal(rentaFija.pesoEnLaCartera)} de la cartera que es renta fija</p>
                  <ul className="xray-dist-rows">
                    <FilaDeRentaFija rotulo="Grado de inversión" cifra={rentaFija.gradoDeInversion} escribir={enPorcentaje} />
                    <FilaDeRentaFija rotulo="Alto rendimiento" cifra={rentaFija.altoRendimiento} escribir={enPorcentaje} />
                    <FilaDeRentaFija rotulo="Duración modificada" cifra={rentaFija.duracionModificada} escribir={enAnios} femenino />
                    <FilaDeRentaFija rotulo="Duración efectiva" cifra={rentaFija.duracionEfectiva} escribir={enAnios} femenino />
                  </ul>
                </>
              ) : (
                <Ausencia clase="no-aplica" motivo="Sin renta fija en esta cartera" />
              )}
            </div>
          </div>
        </div>

        <p className="xray-style-note">
          Estilo y tamaño, ponderados por la exposición a renta variable; lo que un activo no declara no se reparte ni se deduce de su nombre. Grado de inversión, alto rendimiento y duración son medias ponderadas por el peso en renta fija de las posiciones que los declaran, cada una con su cobertura: si los dos primeros no suman 100, el resto no consta, y las dos duraciones no se mezclan porque miden cosas distintas.
        </p>
    </Panel>
  );
}
