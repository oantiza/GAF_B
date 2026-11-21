import { useMemo } from "react";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbManualPortfolioSummary,
  BdbRiskProfilePreview
} from "../types/bdbAssets";
import { useModoCliente } from "../app/ClientModeContext";
import { oFalta, peso } from "../core/formato";
import { evaluatePortfolioHealth } from "../core/portfolioHealth";
import { concentrationBand } from "../core/concentration";
import { coberturaDeLaSimulacion } from "../core/medidaDeLaCartera";
import { usePortfolioHorizon } from "../core/usePortfolioHorizon";
import { textoEnPantalla } from "../core/glosarioDePantalla";
import type { PortfolioFeasibilityCheck } from "../core/portfolioConstraints";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";

interface PortfolioStatusPanelProps {
  summary: BdbManualPortfolioSummary | null;
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  riskProfilePreview: BdbRiskProfilePreview | null;
  /** Las restricciones de la cartera: lo que bloquea proponerla y lo que avisa. */
  feasibility?: PortfolioFeasibilityCheck;
}

type StatusTone = "ok" | "mid" | "bad" | "neutro";

interface StatusRow {
  id: string;
  tone: StatusTone;
  title: string;
  detail?: string;
  /** Aún se está midiendo: su punto no da un color que luego cambie. */
  enCurso?: boolean;
}

/**
 * El estado de la propuesta: pesos, perfil, concentración y datos. En el lateral de Componer son cuatro filas con su punto
 * de color y el recuento con el enlace a Comprobar (el rediseño las dejó en una línea; volvieron el 14-11-2026); arriba del
 * paso Comprobar, en «Qué hay que revisar», va lo que pide atención. Los dos salen de aquí, con la misma cuenta. Es del
 * asesor: en Modo cliente no sale ninguno, y la cobertura que el cliente necesita ya la dice la simulación bajo su título.
 */
function useEstadoDeLaCartera({ summary, positions, assets, riskProfilePreview }: Omit<PortfolioStatusPanelProps, "feasibility">): StatusRow[] {
  /* La misma cobertura que el panel de la simulación, de la misma respuesta: dos cifras de cobertura en una
     pantalla, «88 % del peso» arriba y «100 % de la cartera» debajo, no se pueden leer. */
  const { data: horizonte, error: errorDeLaSimulacion } = usePortfolioHorizon(positions);
  const rows = useMemo<StatusRow[]>(() => {
    if (!summary || positions.length === 0) return [];
    const health = evaluatePortfolioHealth({ positions, assets });
    const largest = positions.reduce((max, position) => Math.max(max, position.weight_percent || 0), 0);
    // Umbral único de concentración (MEDIA-06): antes aquí el 40 % justo ya era «bad».
    const largestBand = concentrationBand(largest);
    const largestTone: StatusTone = largestBand === "HIGH" ? "bad" : largestBand === "WATCH" ? "mid" : "ok";
    const investable = positions.length - summary.non_investable_assets.length;
    /* Con métodos distintos la volatilidad no se suma y `metric_coverage` cae a 0, aunque las cifras
       existan: entonces lo que se mide es la rentabilidad, y el riesgo sale de la simulación. */
    const metodosDistintos = summary.weighted_metrics.volatility_comparable === false;
    const coverage = metodosDistintos
      ? summary.weighted_metrics.return_coverage_3y
      : summary.weighted_metrics.metric_coverage;
    const metricsComplete = coverage === undefined || coverage >= 0.999;
    const conPeso = positions.some((position) => (position.weight_percent || 0) > 0);
    const midiendo = conPeso && !horizonte && !errorDeLaSimulacion;
    const dataTone: StatusTone = horizonte
      ? horizonte.coverageWeightPercent >= 99.95 ? "ok" : "mid"
      : investable < positions.length ? "mid" : metricsComplete ? "ok" : "mid";

    const list: StatusRow[] = [];
    if (summary.validation_status !== "VALID") {
      /* El estado lo dice su palabra, no solo el punto de color (14-11-2026): «Pesos sin cuadrar», «Datos parciales». */
      list.push({
        id: "weights",
        tone: summary.validation_status === "EMPTY" ? "mid" : "bad",
        title: summary.validation_status === "EMPTY" ? "Pesos sin repartir" : "Pesos sin cuadrar",
        detail: `suma ${oFalta(peso(health.weight_sum_pct / 100))} · normaliza al 100 %`
      });
    }
    /* Decisión 14: nadie elige un perfil por defecto, y el perfil no se mide contra la cartera. Por
       eso ni recuento de señales —ninguna era un riesgo y tres salían siempre— ni color de «bien». */
    list.push({
      id: "profile",
      tone: "neutro",
      title: riskProfilePreview ? `Perfil ${riskProfilePreview.selected_profile.risk_profile_label}` : "Perfil: sin elegir",
      detail: riskProfilePreview ? "informativo" : undefined
    });
    list.push({
      id: "concentration",
      tone: largestTone,
      title: largestTone === "ok" ? "Concentración baja" : largestTone === "mid" ? "Concentración media" : "Concentración alta",
      detail: `mayor posición ${oFalta(peso(largest / 100))}`
    });
    list.push({
      id: "data",
      tone: dataTone,
      enCurso: midiendo,
      title: midiendo ? "Datos" : dataTone === "ok" ? "Datos completos" : "Datos parciales",
      detail: horizonte
        ? `${coberturaDeLaSimulacion(horizonte)} en la simulación`
        : `${investable}/${positions.length} invertibles · ${
            /* Sin la cifra de cobertura no se escribe un cero ni una frase a medias («métricas para Falta el dato…»): se
               dice lo que se sabe. */
            !metodosDistintos && !metricsComplete
              ? typeof coverage === "number"
                ? `métricas para ${oFalta(peso(coverage))} de la cartera`
                : "métricas parciales"
              : midiendo
                ? "midiendo…"
                : metodosDistintos
                  ? typeof coverage === "number"
                    ? `rentabilidad para ${oFalta(peso(coverage))} de la cartera · riesgo sin medir`
                    : "riesgo sin medir"
                  : "métricas completas"
          }`
    });
    return list;
  }, [assets, errorDeLaSimulacion, horizonte, positions, riskProfilePreview, summary]);

  return rows;
}

/** Lo que pide atención en el estado: lo que no está bien («mid» o «bad»). */
const pideAtencion = (row: StatusRow) => row.tone === "bad" || row.tone === "mid";

/** Cuántas cosas hay que revisar: las de las restricciones (bloqueos y avisos) y las del estado. */
function recuentoDeRevisar(rows: StatusRow[], feasibility: PortfolioFeasibilityCheck | undefined): number {
  return (feasibility?.blocking_issues.length ?? 0) + (feasibility?.warnings.length ?? 0) + rows.filter(pideAtencion).length;
}

/* Escritas enteras para que el censo de CSS vea su uso. El punto refuerza; la palabra de la fila dice el estado. */
const CLASE_DEL_TONO: Record<StatusTone, string> = {
  ok: "diseno-estado__fila--bien",
  mid: "diseno-estado__fila--atencion",
  bad: "diseno-estado__fila--mal",
  neutro: ""
};

/**
 * El lateral de Componer: el bloque «Estado», con sus filas —pesos (solo si fallan), perfil, concentración y datos—, cada una
 * con su punto de color (bien, verde; atención, ocre; mal, rojo) y su palabra, y al pie el recuento con el enlace al paso
 * Comprobar, donde está el detalle. Volvió el 14-11-2026 (Óscar: recuperar el color y los datos de antes del rediseño):
 * la línea sola con el recuento ya no decía, por ejemplo, «Concentración baja · mayor posición 18,0 %» cuando estaba bien.
 */
export function PortfolioStatusPanel({ onVerComprobar, feasibility, ...props }: PortfolioStatusPanelProps & { onVerComprobar?: () => void }) {
  const { seEnsena } = useModoCliente();
  const rows = useEstadoDeLaCartera(props);
  if (rows.length === 0 || !seEnsena("estadoDeLaCartera")) return null;
  const cuantas = recuentoDeRevisar(rows, feasibility);
  return (
    <Panel claseDelCuerpo="stack stack--tight" titulo="Estado" tituloId="portfolio-status-title">
      <ul aria-label="Estado de la propuesta" className="diseno-estado__filas">
        {rows.map((row) => (
          <li className={["diseno-estado__fila", row.enCurso ? "" : CLASE_DEL_TONO[row.tone]].filter(Boolean).join(" ")} key={row.id}>
            <i aria-hidden="true" className="diseno-estado__punto" />
            <span>
              <b>{row.title}</b>
              {row.detail ? ` · ${row.detail}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="diseno-estado" role="status">
        <span>{cuantas === 0 ? "Nada que revisar" : cuantas === 1 ? "1 cosa que revisar" : `${cuantas} cosas que revisar`}</span>
        {onVerComprobar ? (
          <>
            <span aria-hidden="true">·</span>
            <Button aria-label="Ver lo que hay que revisar, en el paso Comprobar" onClick={onVerComprobar} size="sm" variant="quiet">
              Ver
            </Button>
          </>
        ) : null}
      </p>
    </Panel>
  );
}

/**
 * «Qué hay que revisar», arriba del paso Comprobar: primero lo que impide proponerla (error), después los avisos, y si
 * no hay nada, una nota que lo dice. Al pie, el estado de los datos, que no es un aviso pero hace falta para leer las
 * cifras.
 */
export function QueHayQueRevisar({ feasibility, ...props }: PortfolioStatusPanelProps) {
  const { seEnsena } = useModoCliente();
  const rows = useEstadoDeLaCartera(props);
  if (rows.length === 0 || !seEnsena("estadoDeLaCartera")) return null;
  const bloqueos = feasibility?.blocking_issues ?? [];
  const avisos = feasibility?.warnings ?? [];
  const delEstado = rows.filter(pideAtencion);
  const datos = rows.find((row) => row.id === "data");
  const perfil = rows.find((row) => row.id === "profile");
  return (
    <Panel claseDelCuerpo="diseno-revisar" titulo="Qué hay que revisar" tituloId="portfolio-status-title">
      {bloqueos.map((issue) => (
        <Aviso key={`b-${issue.code}-${issue.asset_id ?? issue.scope ?? issue.message}`} titulo="Impide proponerla." tono="error">
          {textoEnPantalla(issue.message)}
        </Aviso>
      ))}
      {delEstado.map((row) => (
        <Aviso key={`e-${row.id}`} titulo={`${row.title}.`}>
          {row.detail ? `${row.detail.charAt(0).toLocaleUpperCase("es")}${row.detail.slice(1)}.` : null}
        </Aviso>
      ))}
      {avisos.map((issue) => (
        <Aviso key={`a-${issue.code}-${issue.asset_id ?? issue.scope ?? issue.message}`}>{textoEnPantalla(issue.message)}</Aviso>
      ))}
      {bloqueos.length + delEstado.length + avisos.length === 0 ? (
        <Aviso tono="nota" titulo="Nada que revisar.">
          Nada impide proponerla y no hay avisos sobre sus pesos, su concentración ni sus datos.
        </Aviso>
      ) : null}
      <p className="panel__subtitle">
        {[perfil ? `${perfil.title}${perfil.detail ? ` · ${perfil.detail}` : ""}` : null, datos && !pideAtencion(datos) ? `Datos · ${datos.detail}` : null]
          .filter(Boolean)
          .join(". ")}
      </p>
    </Panel>
  );
}
