import { useMemo } from "react";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import {
  buildPortfolioOptimizationDiff,
  type PortfolioOptimizationApplyContext
} from "../core/portfolioOptimizationDiff";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../core/textosDeCartera";
import { CambiosDePeso, CifrasDeLosCambios } from "./CambiosDePeso";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { Panel } from "./ui/Panel";

export interface OptimizationProposal {
  weights: Record<string, number>;
  context: PortfolioOptimizationApplyContext;
  /** De dónde salen sus cifras (`notaDeLaPropuesta`): se lee antes de aplicar. */
  nota?: string | null;
}

interface OptimizationReviewDialogProps {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
  proposal: OptimizationProposal;
  blockedReason?: string | null;
  /** El capital de la cartera, solo si está fijado: con él se dice cuánto dinero hay que mover. */
  capital?: number;
  onCancel: () => void;
  onApply: (weights: Record<string, number>, context: PortfolioOptimizationApplyContext) => void;
}

function proposedPositions(
  positions: BdbManualPortfolioPosition[],
  weights: Record<string, number>
): BdbManualPortfolioPosition[] {
  return positions.map((position) => ({
    ...position,
    weight_percent: Math.round(((weights[position.asset_id] ?? 0) * 100 + Number.EPSILON) * 100) / 100
  }));
}

export function OptimizationReviewDialog({
  assets,
  positions,
  proposal,
  blockedReason,
  capital,
  onCancel,
  onApply
}: OptimizationReviewDialogProps) {
  const comparison = useMemo(
    () => buildPortfolioOptimizationDiff({
      source: proposal.context.source,
      before: positions,
      after: proposedPositions(positions, proposal.weights),
      assets,
      beforeMetrics: proposal.context.beforeMetrics,
      afterMetrics: proposal.context.afterMetrics
    }),
    [assets, positions, proposal]
  );

  return (
    <ModalDialog
      labelledBy="optimization-review-title"
      onClose={onCancel}
      size="lg"
      className="optimization-review-dialog"
      closeOnBackdrop={false}
    >
      <DialogHeader
        titleId="optimization-review-title"
        eyebrow="Optimización calculada"
        title="Revisar propuesta"
        onClose={onCancel}
      />
      <DialogBody className="optimization-review-body">
        {/* Lo pinta la pieza `Aviso` (MAR-21), en ocre; la caja de fuera lo sigue anunciando al aparecer, como antes. */}
        {blockedReason ? <div role="alert"><Aviso tono="aviso">{blockedReason}</Aviso></div> : null}
        <div className="optimization-review-notice" role="status">
          <strong>La cartera original no se ha modificado.</strong>
          <span>Comprueba los cambios y decide si quieres aplicarlos.</span>
        </div>

        <Panel
          claseDelCuerpo="stack stack--tight"
          nivel={3}
          rotulo="Antes / propuesta"
          titulo={`Diferencias · ${comparison.source}`}
          tituloId="optimization-review-diff-title"
        >
          {/* Decisión 6.3 (17-10-2026): las cifras son las del modelo de la frontera, no las ex post. */}
          <CifrasDeLosCambios comparacion={comparison} />
          {proposal.nota ? <p className="asset-detail-muted">{proposal.nota}</p> : null}
          <CambiosDePeso capital={capital} comparacion={comparison} />
        </Panel>
      </DialogBody>
      <DialogFooter nota={SIN_COMISIONES_NI_IMPUESTOS}>
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button variant="primary" disabled={!!blockedReason} onClick={() => { if (!blockedReason) onApply(proposal.weights, proposal.context); }}>
          Aplicar optimización
        </Button>
      </DialogFooter>
    </ModalDialog>
  );
}
