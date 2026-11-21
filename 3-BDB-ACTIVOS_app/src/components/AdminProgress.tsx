/**
 * Barra de progreso compartida del panel Admin (refresco manual y backfill de históricos).
 * "preview" solo lee y "apply" escribe: lo dice el título de la barra, no su color.
 * Estilos en modules.css (.admin-progress*).
 */
import { numero, peso } from "../core/formato";

export interface AdminProgress {
  phase: "preview" | "apply";
  done: number;
  total: number;
  hits: number;
  skipped: number;
  errors: number;
}

interface PhaseLabels {
  preview: string;
  apply: string;
}

const DEFAULT_TITLES: PhaseLabels = { preview: "Previsualizando", apply: "Aplicando actualización" };
const DEFAULT_HITS: PhaseLabels = { preview: "candidatos", apply: "actualizados" };

export function AdminProgressBar({
  progress,
  cancelRequested,
  titles = DEFAULT_TITLES,
  hitsLabels = DEFAULT_HITS
}: {
  progress: AdminProgress;
  cancelRequested: boolean;
  titles?: PhaseLabels;
  hitsLabels?: PhaseLabels;
}) {
  const { phase, done, total, hits, skipped, errors } = progress;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="admin-progress">
      <div className="admin-progress__head">
        <span>
          {titles[phase]}
          {cancelRequested ? " · cancelando tras el lote en curso…" : "…"}
        </span>
        <span>
          {numero(done)} de {numero(total)} · {peso(pct / 100)}
        </span>
      </div>
      <div
        className="admin-progress__track"
        role="progressbar"
        /* PLA-20: con nombre y con el avance en palabras, no solo en números. */
        aria-label={titles[phase]}
        aria-valuetext={`${done} de ${total}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div
          className="admin-progress__fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="admin-progress__meta">
        <span>{hitsLabels[phase]} {hits}</span>
        <span>omitidos {skipped}</span>
        <span>errores {errors}</span>
      </div>
    </div>
  );
}
