import type { ReactNode } from "react";

/* Sin `asset-detail-muted`: su tope de prosa (38em) estrechaba el vacío a media tarjeta, y el vacío ocupa el sitio del
   gráfico entero. La letra y el color los pone `.oaa-chart-empty`. */
export function OaaEmptyState({ children = "Sin datos suficientes para pintar el gráfico." }: { children?: ReactNode }) {
  return <p className="oaa-chart-empty">{children}</p>;
}
