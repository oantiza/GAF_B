import type { PortfolioFeasibilityCheck, PortfolioConstraintIssue } from "../core/portfolioConstraints";
import { oFalta, peso } from "../core/formato";
import { textoEnPantalla } from "../core/glosarioDePantalla";
import { useClientMode } from "../app/ClientModeContext";
import { Panel } from "./ui/Panel";

interface PortfolioConstraintsPanelProps {
  feasibility: PortfolioFeasibilityCheck;
  /** El perfil que ha elegido el asesor. Sin él no se nombra ninguno (decisión 14). */
  perfilElegido?: string | null;
}

function formatWeight(value: number | undefined): string {
  return oFalta(peso(value));
}

function statusLabel(status: PortfolioFeasibilityCheck["status"]): string {
  if (status === "FEASIBLE") {
    return "Factible";
  }
  if (status === "WARNING") {
    return "Revisar";
  }

  return "Bloqueada";
}

function issueLine(issue: PortfolioConstraintIssue): string {
  /* El mensaje también lo imprime el informe interno: se traduce aquí, a la salida. */
  const parts = [textoEnPantalla(issue.message)];
  if (issue.current_weight !== undefined) {
    parts.push(`actual ${formatWeight(issue.current_weight)}`);
  }
  if (issue.min_weight !== undefined && issue.max_weight !== undefined && issue.min_weight === issue.max_weight) {
    parts.push(`objetivo ${formatWeight(issue.min_weight)}`);
  } else {
    if (issue.min_weight !== undefined) {
      parts.push(`mín. ${formatWeight(issue.min_weight)}`);
    }
    if (issue.max_weight !== undefined) {
      parts.push(`máx. ${formatWeight(issue.max_weight)}`);
    }
  }

  return parts.join(" · ");
}

export function PortfolioConstraintsPanel({ feasibility, perfilElegido }: PortfolioConstraintsPanelProps) {
  const { enabled: clientMode } = useClientMode();
  /* Decisión 6.13 (17-10): la factibilidad («Comprueba pesos, posiciones
     fijadas…») es diagnóstico del asesor, como el resto de ALTA-14:
     en modo cliente no existe, ni en el Informe ni en el paso Comprobar del
     Constructor. Se gatea aquí para cubrir los dos sitios a la vez. */
  if (clientMode) return null;
  /* Decisión 14: la línea «Nivel 5 - Equilibrado: idoneidad solo informativa» la pone el cálculo
     compartido con el papel (`REPORT_RISK_PROFILE_ID`), lo haya elegido alguien o no. Ese dato se deja
     como está, porque lo lee el PDF, y en pantalla solo se nombra el perfil que alguien ha elegido. */
  const infos = feasibility.infos.filter((issue) => issue.code !== "SUITABILITY_PREVIEW_ONLY");
  const lineaDePerfil: PortfolioConstraintIssue[] = perfilElegido
    ? [{ code: "SUITABILITY_PREVIEW_ONLY", severity: "INFO", message: `${perfilElegido}: idoneidad solo informativa.` }]
    : [];
  const topIssues = [...feasibility.blocking_issues, ...feasibility.warnings, ...lineaDePerfil, ...infos].slice(0, 5);

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      subtitulo="Comprueba pesos, posiciones fijadas y activos invertibles. No evalúa idoneidad."
      titulo="Restricciones de la cartera"
      tituloId="portfolio-constraints-title"
    >

      <div className={`portfolio-constraint-status is-${feasibility.status.toLowerCase()}`}>
        <strong>{statusLabel(feasibility.status)}</strong>
        <span>
          Fijado {formatWeight(feasibility.locked_weight)} · libre {formatWeight(feasibility.unlocked_budget)} · suma{" "}
          {formatWeight(feasibility.total_weight)}
        </span>
      </div>

      {topIssues.length > 0 ? (
        <ul className="portfolio-warnings">
          {topIssues.map((issue) => (
            <li key={`${issue.code}-${issue.asset_id ?? issue.scope ?? issue.message}`}>{issueLine(issue)}</li>
          ))}
        </ul>
      ) : (
        <p className="empty-inline">Sin bloqueos de restricciones para la cartera actual.</p>
      )}
    </Panel>
  );
}
