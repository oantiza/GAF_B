import { useMemo, type ReactNode } from "react";
import { useModoCliente } from "../app/ClientModeContext";
import { effectiveCommercialRetroPct } from "../core/commercialRetroEffective";
import { oFalta, porcentaje, ratio, rentabilidad } from "../core/formato";
import { regionLegible } from "../core/etiquetasDeReparto";
import { sectorLegible, type SwapAlternative } from "../core/fundSwapper";
import { CLASS_LABELS, TYPE_LABELS, readableBackendLabel } from "../core/labels";
import { seEnsenaLaMetrica } from "../core/metricasPorInstrumento";
import { gruposDeComparabilidad, metricFrequencyLabel, notaDeLosGrupos, rotuloDeLaVentana } from "../core/metricsFrequency";
import { fmtRetroPoints } from "../core/positionsShared";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { CommercialRetroRecord } from "../types/commercialRetro";
import type { CeldaDeTabla, ColumnaDeTabla } from "../types/tablaDeDatos";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { notasDeCorteYBase } from "../adapters/comparativaDeActivos";
import { Cifra } from "./ui/Cifra";

/**
 * Las alternativas a una posición. Existía dos veces, en Sustituir y en Posiciones, y cada copia decía una cosa: «Mismo
 * producto y clase» frente a «Misma clase», uno frente a dos decimales, «Retro» frente a «Retrocesión».
 *
 * **El orden es el que llega, y por la retrocesión no se ordena nunca** (decisión 17 de Óscar): queda como dato en su
 * columna. Tampoco se reordena por las demás: las cifras pueden salir de métodos distintos, y quien llama ya las trae
 * ordenadas por afinidad.
 */

const AFINIDAD: Record<number, string> = { 1: "Muy afín", 2: "Afín", 3: "Mismo producto y clase", 4: "Elección libre" };

/* La afinidad es una escala, no un estado libre: cada nivel tiene su distintivo. */
const DISTINTIVO: Record<number, string> = { 1: "badge badge--ok", 2: "badge badge--info", 3: "badge" };

const NO_APLICA: CeldaDeTabla = { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" };
const FALTA: CeldaDeTabla = { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" };

const etiqueta = (nombres: Record<string, string>, valor: string | null | undefined) => (valor ? nombres[valor] ?? readableBackendLabel(valor) : null);

function cifraOFalta(valor: number | null | undefined, escribir: (valor: number) => string): CeldaDeTabla {
  return typeof valor === "number" && Number.isFinite(valor) ? { texto: escribir(valor), valor } : FALTA;
}

type FilaDeAlternativa = SwapAlternative & { id: string };

export function TablaDeAlternativas({
  alternativas,
  titulo,
  retrocesiones,
  retrocesionActual,
  accion
}: {
  alternativas: readonly SwapAlternative[];
  titulo: string;
  retrocesiones: ReadonlyMap<string, CommercialRetroRecord>;
  /** La de la posición que se sustituye, contra la que se calcula la diferencia. */
  retrocesionActual: number | null | undefined;
  /** El botón de cada fila, cuando desde esta tabla se puede hacer algo. */
  accion?: (alternativa: SwapAlternative) => ReactNode;
}) {
  const { seEnsena } = useModoCliente();
  const filas = useMemo<FilaDeAlternativa[]>(() => alternativas.map((alternativa) => ({ ...alternativa, id: alternativa.asset.asset_id })), [alternativas]);
  /* En una tabla solo de acciones la columna no sale; en una mixta, la celda dice «No aplica». */
  const conSharpe = alternativas.some(({ asset }) => seEnsenaLaMetrica("sharpe", asset.instrument_type));
  /* MET-4: si la lista se ordenó por cifras y estas no son del mismo cálculo o cierre, va por grupos, y se dice. Las acciones, que van por nombre, no. */
  const grupos = useMemo(() => (alternativas.some(({ grupo }) => grupo) ? gruposDeComparabilidad(alternativas.map(({ asset }) => asset)) : []), [alternativas]);
  const numeroDeGrupo = useMemo(() => new Map(grupos.flatMap(({ numero, activos }) => activos.map((asset) => [asset.asset_id, numero] as const))), [grupos]);
  const conRetrocesion = seEnsena("retrocesiones") && alternativas.some(({ asset }) => seEnsenaLaMetrica("retrocesion", asset.instrument_type));

  const columnas: ColumnaDeTabla<FilaDeAlternativa>[] = [
    {
      id: "alternativa",
      titulo: "Alternativa",
      encabezaFila: true,
      sinOrden: true,
      celda: ({ asset }) => ({
        texto: asset.display_name,
        nodo: (
          <>
            <span className="tabla-de-alternativas__nombre">{asset.display_name}</span>
            <span className="tabla__apunte">
              {[
                etiqueta(TYPE_LABELS, asset.instrument_type),
                /* De una acción dice su sector: que sea renta variable ya lo dice «Acción», y es por lo que está en la lista. */
                asset.instrument_type === "STOCK" ? sectorLegible(asset) : etiqueta(CLASS_LABELS, asset.economic_asset_class),
                asset.region ? regionLegible(asset.region) : null
              ].filter(Boolean).join(" · ")}
            </span>
            <span className="tabla__apunte">{asset.isin ?? asset.asset_id}</span>
          </>
        )
      })
    },
    {
      id: "afinidad",
      titulo: "Afinidad",
      sinOrden: true,
      celda: ({ asset, tier }) => ({
        texto: AFINIDAD[tier],
        nodo: (
          <>
            <span className={DISTINTIVO[tier] ?? "badge"}>{AFINIDAD[tier]}</span>
            <span className="tabla__apunte">{grupos.length > 1 ? `Grupo ${numeroDeGrupo.get(asset.asset_id)} · ` : ""}{metricFrequencyLabel(rotuloDeLaVentana(asset.metrics, "3y").frequency)}</span>
          </>
        )
      })
    },
    {
      id: "rentabilidad",
      titulo: "Rent. 3A",
      tituloCompleto: "Rentabilidad 3 años",
      cifra: true,
      sinOrden: true,
      /* La rentabilidad, con su signo y su color; la volatilidad, el Sharpe y la retrocesión, en tinta. */
      celda: ({ asset }) => {
        const celda = cifraOFalta(asset.metrics?.annualized_return_3y, (valor) => oFalta(rentabilidad(valor)));
        return celda.ausencia ? celda : { ...celda, nodo: <Cifra tipo="rentabilidad" valor={asset.metrics?.annualized_return_3y} /> };
      }
    },
    {
      id: "volatilidad",
      titulo: "Vol. 3A",
      tituloCompleto: "Volatilidad 3 años",
      cifra: true,
      sinOrden: true,
      celda: ({ asset }) => cifraOFalta(asset.metrics?.volatility_3y, (valor) => oFalta(porcentaje(valor)))
    },
    ...(conSharpe
      ? [
          {
            id: "sharpe",
            titulo: "Sharpe 3A",
            cifra: true,
            sinOrden: true,
            celda: ({ asset }: FilaDeAlternativa) =>
              seEnsenaLaMetrica("sharpe", asset.instrument_type) ? cifraOFalta(asset.metrics?.sharpe_3y, (valor) => oFalta(ratio(valor))) : NO_APLICA
          }
        ]
      : []),
    ...(conRetrocesion
      ? [
          {
            id: "retrocesion",
            titulo: "Retrocesión",
            cifra: true,
            sinOrden: true,
            celda: ({ asset }: FilaDeAlternativa) =>
              seEnsenaLaMetrica("retrocesion", asset.instrument_type)
                ? cifraOFalta(effectiveCommercialRetroPct(asset.asset_id, retrocesiones), (valor) => oFalta(porcentaje(valor / 100)))
                : NO_APLICA
          },
          {
            id: "diferencia",
            titulo: "Diferencia",
            cifra: true,
            sinOrden: true,
            celda: ({ asset }: FilaDeAlternativa) => {
              if (!seEnsenaLaMetrica("retrocesion", asset.instrument_type)) return NO_APLICA;
              const suya = effectiveCommercialRetroPct(asset.asset_id, retrocesiones);
              return typeof suya === "number" && typeof retrocesionActual === "number"
                ? { texto: fmtRetroPoints(suya - retrocesionActual), valor: suya - retrocesionActual }
                : FALTA;
            }
          }
        ]
      : []),
    ...(accion
      ? [
          {
            id: "accion",
            titulo: "Acciones",
            acciones: true,
            tituloOculto: true,
            celda: (fila: FilaDeAlternativa) => ({ texto: "", nodo: <span>{accion(fila)}</span> })
          }
        ]
      : [])
  ];

  /* Hallazgo 16: si las alternativas no comparten fecha de corte o base de rentabilidad, se dice debajo, como en Comparar activos. */
  const notas = [notaDeLosGrupos(grupos), ...notasDeCorteYBase(alternativas.map(({ asset }) => ({ activo: asset })))].filter((nota): nota is string => nota !== null);

  return (
    <div className="tabla-de-alternativas">
      <TablaDeDatos columnas={columnas} deActivos filas={filas} titulo={titulo} />
      {notas.map((nota, indice) => (
        <p className="tabla__aviso" key={indice}>
          {nota}
        </p>
      ))}
    </div>
  );
}
