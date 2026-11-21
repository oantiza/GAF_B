import { withAlpha } from "./chartTheme";

/**
 * Muestra de la leyenda, fiel al trazo del gráfico (auditoría 16-10: la leyenda
 * de Monte Carlo pintaba cuadrados sólidos para bandas al 12-22 % y la misma
 * muestra para una banda y para la mediana discontinua):
 * - `swatch` (por defecto): cuadrado relleno, para barras, porciones y puntos.
 * - `band`: relleno translúcido (`opacity`) con el borde en el color pleno,
 *   para un área; `color` ha de ser un `#RRGGBB` de la paleta.
 * - `line` / `dash`: segmento continuo o discontinuo, para una serie de línea.
 */
export type OaaLegendVariant = "swatch" | "band" | "line" | "dash";

export interface OaaLegendItem {
  id: string;
  label: string;
  color: string;
  value?: string;
  hollow?: boolean;
  variant?: OaaLegendVariant;
  /** Opacidad del relleno de una muestra `band` (la misma que el área). */
  opacity?: number;
}

const MARK_CLASS: Partial<Record<OaaLegendVariant, string>> = {
  line: "oaa-legend-mark--line",
  dash: "oaa-legend-mark--line oaa-legend-mark--dash"
};

function swatchStyle(item: OaaLegendItem) {
  /* Valores calculados en tiempo de ejecución: el color de la serie. */
  if (item.variant === "line" || item.variant === "dash") return { borderTopColor: item.color };
  if (item.variant === "band") {
    return { background: withAlpha(item.color, item.opacity ?? 0.12), borderColor: item.color };
  }
  return { background: item.hollow ? "var(--papel)" : item.color, borderColor: item.color };
}

export function OaaLegend({ items }: { items: OaaLegendItem[] }) {
  if (!items.length) {
    return null;
  }
  return (
    <ul className="oaa-chart-legend">
      {items.map((item) => (
        <li key={item.id}>
          <i className={item.variant ? MARK_CLASS[item.variant] : undefined} style={swatchStyle(item)} />
          <span>{item.label}</span>
          {item.value ? <strong>{item.value}</strong> : null}
        </li>
      ))}
    </ul>
  );
}
