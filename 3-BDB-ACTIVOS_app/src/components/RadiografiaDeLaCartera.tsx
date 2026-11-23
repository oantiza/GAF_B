import { useMemo } from "react";
import { DesgloseDeRegiones } from "../charts/GeoDistributionMap";
import { oFalta, peso } from "../core/formato";
import { CLAVE_SIN_REPARTO, fraseDelSinRepartoEnLaLectura, radiografiaDeLaCartera } from "../core/radiografiaDeLaCartera";
import { buildRegionTable, NOTA_CANADA_Y_AFRICA } from "../core/regionTaxonomy";
import { NOTA_DEL_REPARTO_NETO, tieneCortosOApalancamiento } from "../core/repartoNeto";
import type { BdbAssetDataSourceKind, BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { FilasDeReparto, LoQueNoEntra } from "./FilasDeReparto";
import { Ausencia } from "./ui/Ausencia";
import { Cifra } from "./ui/Cifra";
import { Panel } from "./ui/Panel";
import { breakdownLabel, NO_DECLARADO } from "./xrayBreakdownLabels";

const SOBRE_LA_RENTA_VARIABLE = "Lo que declara cada activo, en % de la renta variable.";

/** Lo que nadie declara, escrito aparte: sin esa línea el reparto no llega al 100 % y no dice por qué. */
function NoDeclarado({ pct }: { pct: number }) {
  return pct > 0 ? (
    <p className="xray-dist-pie">
      <Ausencia clase="falta" motivo={`${NO_DECLARADO}: ${oFalta(peso(pct / 100))} de la renta variable`} />
    </p>
  ) : null;
}

/** Lo que no tiene reparto de activos y no entra en la renta variable (A-211), escrito aparte como lo no declarado. */
function SinReparto({ pct }: { pct: number }) {
  const frase = fraseDelSinRepartoEnLaLectura(pct, "renta variable");
  return frase ? (
    <p className="xray-dist-pie">
      <Ausencia clase="falta" motivo={frase} />
    </p>
  ) : null;
}

/**
 * La radiografía de una cartera guardada: exposición agregada, sectores y regiones, con las mismas piezas y las mismas cifras
 * que Análisis (decisión 50). Lo que hace y por qué, en `core/radiografiaDeLaCartera`.
 */
export function RadiografiaDeLaCartera({
  positions,
  assets,
  source
}: {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  source: BdbAssetDataSourceKind;
}) {
  const { exposicion, porSuClasePct, sinReparto, sinRepartoPct, sectores, regiones, fuera, fueraDelReparto } = useMemo(
    () => radiografiaDeLaCartera(positions, assets, source),
    [assets, positions, source]
  );
  const sinSituar = buildRegionTable(regiones.rows).other;
  const hayRentaVariable = sectores.rows.length > 0 || sectores.unclassified_weight_percent > 0;
  /* Sin renta variable medida, pero con algo sin reparto, no se puede decir que no la haya (A-211): lo dice `SinReparto`. */
  const sinRentaVariable = <Ausencia clase="no-aplica" motivo="Sin renta variable en esta cartera" />;
  const sinMedir = fraseDelSinRepartoEnLaLectura(sinRepartoPct, "renta variable") !== null;

  return (
    <>
      {fuera.length > 0 ? (
        <p className="field__hint">
          {fuera.length === 1 ? "No cuenta aquí, porque no está en el catálogo" : "No cuentan aquí, porque no están en el catálogo"}: {fuera.join(", ")}.
        </p>
      ) : null}
      {/* Los tres paneles van bajo el `h2` de la propuesta abierta (en Guardadas): son `h3` (MAR-32). */}
      <div className="radiografia__conjunto">
        <Panel claseDelCuerpo="stack stack--tight" nivel={3} subtitulo="Lo que hay dentro de cada activo, en % de la cartera." titulo="Exposición agregada">
          <FilasDeReparto claveDeLoQueFalta={CLAVE_SIN_REPARTO} filas={exposicion} porClase vacio="Sin posiciones invertibles con peso." />
          <LoQueNoEntra partes={fueraDelReparto} sobreLaCartera />
          {sinReparto ? <p className="xray-dist-pie">{sinReparto}</p> : null}
          {/* C-29: con un fondo de reparto neto dentro, una clase de la cartera puede salir en negativo o pasar del 100 %. */}
          {tieneCortosOApalancamiento(exposicion.map((fila) => fila.peso), 100) ? <p className="xray-dist-pie">{NOTA_DEL_REPARTO_NETO}</p> : null}
          {porSuClasePct > 0.05 ? (
            <p className="xray-dist-pie">El <Cifra tipo="peso" valor={porSuClasePct / 100} /> del peso cuenta por su clase de activo (activos sin desglose de exposición).</p>
          ) : null}
        </Panel>
        <Panel claseDelCuerpo="stack stack--tight" nivel={3} subtitulo={SOBRE_LA_RENTA_VARIABLE} titulo="Por sector">
          {hayRentaVariable ? (
            <FilasDeReparto filas={sectores.rows.map((fila) => ({ clave: fila.key, rotulo: breakdownLabel(fila.key), peso: fila.weight_percent }))} vacio="Ninguna posición declara sus sectores." />
          ) : sinMedir ? null : (
            sinRentaVariable
          )}
          <NoDeclarado pct={sectores.unclassified_weight_percent} />
          <SinReparto pct={sinRepartoPct} />
        </Panel>
        <Panel claseDelCuerpo="stack stack--tight" nivel={3} subtitulo={SOBRE_LA_RENTA_VARIABLE} titulo="Por región">
          {regiones.rows.length > 0 ? (
            <DesgloseDeRegiones rows={regiones.rows} />
          ) : regiones.unclassified_weight_percent > 0 || sinMedir ? null : (
            sinRentaVariable
          )}
          <NoDeclarado pct={regiones.unclassified_weight_percent} />
          <SinReparto pct={sinRepartoPct} />
          {sinSituar > 0.05 ? <p className="xray-dist-pie"><Cifra tipo="peso" valor={sinSituar / 100} /> sin situar.</p> : null}
          {regiones.canadaYAfricaSinSeparar ? <p className="xray-dist-pie">{NOTA_CANADA_Y_AFRICA}.</p> : null}
        </Panel>
      </div>
    </>
  );
}
