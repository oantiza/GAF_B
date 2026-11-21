import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { OaaEmptyState } from "./OaaEmptyState";
import { rotuloDelSello, type CalidadDelDato } from "./selloDeCalidad";
import { TablaAlternativa, type DatosAlternativos } from "./TablaAlternativa";

export type OaaDataQuality = CalidadDelDato;

export interface OaaChartQualityProps {
  dataQuality?: OaaDataQuality;
  dataQualityLabel?: ReactNode;
  dataQualityNote?: ReactNode;
}

interface OaaChartFrameProps extends OaaChartQualityProps {
  height?: number;
  className?: string;
  empty?: boolean;
  emptyText?: ReactNode;
  /** La tabla alternativa: las mismas cifras que pinta el gráfico, para el lector de pantalla. */
  alternativa?: DatosAlternativos;
  children: ReactNode;
}

/**
 * El sello de calidad del dato. ANA-25: lo que significa ya no va en `title`, que no se ve con teclado ni en tableta: va
 * como texto, detrás del sello, para el lector de pantalla. Lo que se ve lo dice la procedencia del bloque (`Panel`).
 */
function OaaDataQualityBadge({
  dataQuality,
  dataQualityLabel,
  dataQualityNote
}: OaaChartQualityProps) {
  if (!dataQuality) return null;
  return (
    <span className={`oaa-data-pill ${dataQuality}`}>
      {rotuloDelSello(dataQuality, dataQualityLabel)}
      {dataQualityNote ? <span className="sr-only">: {dataQualityNote}</span> : null}
    </span>
  );
}

/**
 * Si el marco se ve. Dentro de un panel oculto (`hidden`: una pestaña que no es la elegida y sigue montada, como las de
 * la ficha) mide 0 × 0, y la librería de gráficos lo dice por consola cada vez que mide: «The width(0) and height(0)
 * of chart should be greater than 0». Un gráfico que no se ve no se dibuja; se dibuja cuando su panel se enseña, que
 * es cuando el marco pasa a tener tamaño y el observador avisa.
 */
function useSeVe(): [RefObject<HTMLDivElement | null>, boolean] {
  const marco = useRef<HTMLDivElement | null>(null);
  const [seVe, setSeVe] = useState(true);
  useLayoutEffect(() => {
    const nodo = marco.current;
    if (!nodo) return;
    const mirar = () => setSeVe(nodo.closest("[hidden]") === null);
    mirar();
    if (typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(mirar);
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);
  return [marco, seVe];
}

export function OaaChartFrame({
  height = 280,
  className = "",
  empty,
  emptyText,
  alternativa,
  dataQuality,
  dataQualityLabel,
  dataQualityNote,
  children
}: OaaChartFrameProps) {
  const [marco, seVe] = useSeVe();
  const isEmpty = empty || dataQuality === "none";
  const resolvedEmptyText = emptyText ?? (dataQuality === "none" ? "Sin datos suficientes para este cálculo." : undefined);
  const badge = (
    <div className="oaa-chart-quality">
      <OaaDataQualityBadge dataQuality={dataQuality} dataQualityLabel={dataQualityLabel} dataQualityNote={dataQualityNote} />
    </div>
  );

  if (isEmpty) {
    return (
      <div className={`oaa-chart-frame ${className}`} ref={marco} style={{ minHeight: Math.max(96, height * 0.45) }}>
        {dataQuality ? badge : null}
        <OaaEmptyState>{resolvedEmptyText}</OaaEmptyState>
      </div>
    );
  }

  return (
    <div className={`oaa-chart-frame ${className}`} ref={marco} style={{ height }}>
      {dataQuality ? badge : null}
      {seVe ? children : null}
      {alternativa ? <TablaAlternativa {...alternativa} /> : null}
    </div>
  );
}
