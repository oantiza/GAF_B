import { useMemo, useState, type ReactNode } from "react";
import { columnasDeComposicion, filasDeComposicion, pesoRepartido, type FilaDeComposicion } from "../adapters/tablaDeComposicion";
import { isWeightBalanced } from "../core/weightTolerance";
import type { PortfolioHorizon } from "../adapters/portfolioHorizon";
import { useClientMode } from "../app/ClientModeContext";
import * as formato from "../core/formato";
import { aniosEnPalabras } from "../core/glosarioDePantalla";
import { aportacionAlRiesgo, conTramosEstimados, pesoLegible, type FueraDeLaMedida } from "../core/medidaDeLaCartera";
import type { ResolvedPositionBounds } from "../core/portfolioConstraints";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbPortfolioReport } from "../types/bdbAssets";
import type { ColumnaDeTabla } from "../types/tablaDeDatos";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { Button } from "./ui/Button";
import { Distintivo } from "./ui/Distintivo";
import { Panel } from "./ui/Panel";

interface ComposicionDeLaCarteraProps {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  posicionesDelInforme?: BdbPortfolioReport["positions"];
  /** La simulación que ya trae la pantalla: de ella sale lo que aporta cada posición. */
  horizonte: PortfolioHorizon | null | undefined;
  fuera: readonly FueraDeLaMedida[];
  limites?: readonly ResolvedPositionBounds[];
  capital?: number;
  midiendo: boolean;
  /** Los años del periodo elegido: la volatilidad de cada activo es la de esa ventana (ANA-14). 3 por defecto. */
  anos?: 3 | 5;
  /**
   * Cuántas posiciones se enseñan de entrada; las demás, con «Ver las N». Sin él, todas (y la tabla pagina de 25 en 25).
   * Una cabecera de grupo no cuenta como posición.
   */
  limiteDePosiciones?: number;
  /** Las acciones del bloque: «Abrir en Diseño». */
  acciones?: ReactNode;
}

/** Las filas que caben en las primeras `limite` posiciones, con la cabecera de su grupo si la tienen. */
function primerasPosiciones(filas: readonly FilaDeComposicion[], limite: number): FilaDeComposicion[] {
  const elegidas: FilaDeComposicion[] = [];
  let posiciones = 0;
  for (const fila of filas) {
    if (!fila.cabeceraDeGrupo) {
      if (posiciones >= limite) break;
      posiciones += 1;
    }
    elegidas.push(fila);
  }
  /* Una cabecera al final, sin ninguno de sus fondos debajo, no dice nada. */
  while (elegidas.length > 0 && elegidas[elegidas.length - 1].cabeceraDeGrupo) elegidas.pop();
  return elegidas;
}

/**
 * «Posiciones» de Análisis: la tabla de la cartera, con su fila de total. Lo que hace cada columna y por qué, en
 * `adapters/tablaDeComposicion`.
 */
export function ComposicionDeLaCartera({
  positions,
  assets,
  posicionesDelInforme,
  horizonte,
  fuera,
  limites,
  capital,
  midiendo,
  anos = 3,
  limiteDePosiciones,
  acciones
}: ComposicionDeLaCarteraProps) {
  const { enabled: clientMode } = useClientMode();
  const [todas, setTodas] = useState(false);
  const aportaciones = aportacionAlRiesgo(horizonte);
  const conImporte = typeof capital === "number" && Number.isFinite(capital) && capital > 0;
  const filas = useMemo(
    () => filasDeComposicion({ positions, assets, posicionesDelInforme, aportaciones, fuera, limites, capital, anos }),
    [anos, aportaciones, assets, capital, fuera, limites, posicionesDelInforme, positions]
  );
  const columnas = useMemo(
    () =>
      columnasDeComposicion({
        clientMode,
        conImporte,
        conLimites: filas.some((fila) => Boolean(fila.limite)),
        midiendo: midiendo && !horizonte,
        unSoloMedido: Boolean(horizonte) && (horizonte?.backtest.asset_ids ?? []).length < 2,
        anos
      }),
    [anos, clientMode, conImporte, filas, horizonte, midiendo]
  );
  const cuantas = positions.length;
  const recortada = typeof limiteDePosiciones === "number" && !todas && cuantas > limiteDePosiciones;
  const visibles = recortada ? primerasPosiciones(filas, limiteDePosiciones) : filas;
  const ensenadas = visibles.filter((fila) => !fila.cabeceraDeGrupo).length;

  const pesoTotal = positions.reduce((suma, posicion) => suma + (posicion.weight_percent || 0), 0);
  /* ANA-13: el importe reparte el capital entero, como el cuadro de costes; el pie es el capital, y si los pesos no suman 100 se dice. */
  const hayReparto = pesoRepartido(positions) > 0;
  const pie = (columna: ColumnaDeTabla<FilaDeComposicion>) => {
    if (columna.id === "peso") return { texto: formato.peso(pesoTotal / 100) ?? "" };
    if (columna.id === "importe" && conImporte && hayReparto) return { texto: formato.importe(capital as number) ?? "" };
    return undefined;
  };
  const avisoDelReparto =
    conImporte && hayReparto && !isWeightBalanced(pesoTotal)
      ? `Los pesos suman ${formato.peso(pesoTotal / 100)}: el importe reparte el capital entero en proporción a ellos, como el cuadro de costes. No se cambian los pesos guardados.`
      : null;
  const deLaParteMedida = horizonte
    ? `de la parte medida (${pesoLegible(horizonte.coverageWeightPercent)} del peso)${conTramosEstimados(horizonte) ? ", estimado" : ""}`
    : "de la parte medida";

  return (
    <Panel
      acciones={acciones}
      claseDelCuerpo="stack stack--tight"
      /* La columna de importe no sale sin capital: se dice aquí, y no con ocho rayas. */
      estado={!conImporte ? <Distintivo>Capital sin fijar</Distintivo> : null}
      subtitulo={`Peso de hoy · «Aporta al riesgo» es ${deLaParteMedida} · la volatilidad, la de cada activo por su cuenta a ${aniosEnPalabras(anos)}`}
      titulo="Posiciones"
    >
      <TablaDeDatos
        agrupada
        columnas={columnas}
        deActivos
        filas={visibles}
        pie={pie}
        porPagina={recortada ? undefined : true}
        rotuloDelPie={`Toda la cartera · ${cuantas} ${cuantas === 1 ? "posición" : "posiciones"}`}
        titulo="Posiciones de la cartera"
      />
      {recortada || (typeof limiteDePosiciones === "number" && todas && cuantas > limiteDePosiciones) ? (
        <div className="analisis-tabla-pie">
          <span>{recortada ? `${ensenadas} de ${formato.cuantos(cuantas, "posición", "posiciones")}` : cuantas === 1 ? "La única posición" : `Las ${cuantas} posiciones`}</span>
          <Button aria-expanded={!recortada} onClick={() => setTodas((antes) => !antes)} size="sm">
            {recortada ? `Ver las ${cuantas}` : `Ver solo las ${limiteDePosiciones} primeras`}
          </Button>
        </div>
      ) : null}
      {avisoDelReparto ? <p className="analisis-nota">{avisoDelReparto}</p> : null}
    </Panel>
  );
}
