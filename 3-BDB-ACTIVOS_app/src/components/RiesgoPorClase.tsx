import { useMemo } from "react";
import type { PortfolioHorizon } from "../adapters/portfolioHorizon";
import { colorDeLaClase } from "../core/coloresDeClase";
import * as formato from "../core/formato";
import { aniosEnPalabras } from "../core/glosarioDePantalla";
import { aportacionAlRiesgo, conTramosEstimados, MIDIENDO, pesoLegible } from "../core/medidaDeLaCartera";
import { CLAVE_SIN_CLASIFICAR, riesgoPorClase } from "../core/riesgoPorClase";
import type { BdbAssetDetail } from "../types/bdbAssets";
import { Ausencia } from "./ui/Ausencia";
import { ListaDePartes } from "./ui/ListaDePartes";
import { Panel } from "./ui/Panel";

interface RiesgoPorClaseProps {
  assets: readonly BdbAssetDetail[];
  /** La simulación que ya trae la pantalla: de ella sale lo que aporta cada posición, y se suma por clase. */
  horizonte: PortfolioHorizon | null | undefined;
  midiendo: boolean;
  anos: 3 | 5;
}

/**
 * «Riesgo por clase de activo» de Análisis (AN1, Óscar, 21-11-2026): lo que aporta cada clase a la volatilidad de la cartera,
 * junto al reparto por peso, para que se vea la diferencia entre pesar y aportar riesgo. Cada clase es la suma de lo que
 * aportan sus posiciones (contribución de Euler: por qué se puede sumar, en `core/riesgoPorClase`). La barra es la
 * aportación, en el color de su clase; el peso, en la línea de debajo, es el de la misma parte medida.
 */
export function RiesgoPorClase({ assets, horizonte, midiendo, anos }: RiesgoPorClaseProps) {
  const aportaciones = aportacionAlRiesgo(horizonte);
  const clases = useMemo(() => riesgoPorClase(aportaciones, assets), [aportaciones, assets]);
  const volatilidadNula = horizonte?.riskContributionsMeta?.reason === "ZERO_VOLATILITY";
  const unSoloMedido = Boolean(horizonte) && (horizonte?.backtest.asset_ids ?? []).length < 2;
  const sinClasificar = clases?.find((clase) => clase.clave === CLAVE_SIN_CLASIFICAR);

  const deLaParteMedida = horizonte
    ? `de la parte medida (${pesoLegible(horizonte.coverageWeightPercent)} del peso)${conTramosEstimados(horizonte) ? ", estimado" : ""}`
    : "de la parte medida";

  const cuerpo = () => {
    if (!horizonte && midiendo) return <p className="empty-inline">{MIDIENDO}</p>;
    if (volatilidadNula) {
      return (
        <p className="empty-inline">
          <Ausencia clase="no-aplica" motivo="No aplica: la volatilidad de la cartera es nula, y no hay riesgo que repartir." />
        </p>
      );
    }
    if (unSoloMedido) {
      return (
        <p className="empty-inline">
          <Ausencia clase="no-aplica" motivo="No aplica: la simulación mide un solo activo, y no hay reparto del riesgo." />
        </p>
      );
    }
    if (!clases) {
      return (
        <p className="empty-inline">
          <Ausencia clase="falta" motivo="Falta el dato: sin lo que aporta cada posición no se puede sumar por clase." />
        </p>
      );
    }
    return (
      <>
        <ListaDePartes
          etiqueta="Aportación al riesgo por clase de activo"
          partes={clases.map((clase) => ({
            nombre: clase.rotulo,
            fraccion: clase.riesgoPct / 100,
            apunte: `pesa ${formato.peso(clase.pesoPct / 100) ?? ""}${clase.riesgoPct < 0 ? " · reduce el riesgo" : ""}`,
            /* La clase en su color fijo, el mismo que en «En qué está invertida»; lo que no tiene clase, apagado. */
            color: colorDeLaClase(clase.clave),
            apagada: clase.clave === CLAVE_SIN_CLASIFICAR
          }))}
        />
        {sinClasificar ? (
          <p className="analisis-nota">
            «Sin clasificar»: {formato.cuantos(sinClasificar.posiciones, "posición", "posiciones")} sin clase de activo en su ficha.
          </p>
        ) : null}
        <p className="analisis-nota">
          Cada clase suma lo que aportan sus posiciones a la volatilidad de la cartera, con sus correlaciones; entre todas suman el
          100 %. Una aportación negativa reduce el riesgo del conjunto. Un fondo mixto cuenta entero como mixto, como en el reparto
          por peso.
        </p>
      </>
    );
  };

  return (
    <Panel
      claseDelCuerpo="stack stack--3"
      subtitulo={`Aportación a la volatilidad, ${deLaParteMedida} · ${aniosEnPalabras(horizonte?.years ?? anos)}`}
      titulo="Riesgo por clase de activo"
    >
      {cuerpo()}
    </Panel>
  );
}
