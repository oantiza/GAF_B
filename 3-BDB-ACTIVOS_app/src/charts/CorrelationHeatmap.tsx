import { OaaCorrelationHeatmap, OaaEmptyState } from "./oaa";
import { matrizDeCorrelacion, NO_SE_MIDE } from "../core/correlation";
export interface CorrSeries {
  asset_id: string;
  display_name: string;
  values: number[];
  sin_dividendos?: boolean;
}

export interface CorrelationHeatmapProps {
  /** Eje temporal compartido de las series (mismo orden y longitud que values). */
  dates: string[];
  series: CorrSeries[];
  /** EN RETIRADA: la matriz no da color a los activos; se acepta y no se usa. */
  colors?: string[];
  /** El número de cada serie en los demás bloques de la pantalla, en el orden de `series`. Sin él, 1, 2, 3… */
  numeros?: readonly number[];
}

export function CorrelationHeatmap({ dates, series, numeros }: CorrelationHeatmapProps) {
  if (series.length < 2) {
    return <OaaEmptyState>Hacen falta al menos 2 series con histórico común para calcular la correlación.</OaaEmptyState>;
  }
  const n = series.length;
  const { matrix, noSeMide } = matrizDeCorrelacion(dates, series);
  const items = series.map((item, indice) => ({
    key: item.asset_id,
    label: item.display_name,
    numero: numeros?.[indice]
  }));
  const cells = series.flatMap((row, rowIndex) =>
    series.map((column, columnIndex) => ({
      rowKey: row.asset_id,
      columnKey: column.asset_id,
      rowLabel: row.display_name,
      columnLabel: column.display_name,
      rowIndex,
      columnIndex,
      value: matrix[rowIndex][columnIndex],
      rotulo: rowIndex !== columnIndex && (noSeMide[rowIndex] || noSeMide[columnIndex]) ? NO_SE_MIDE : undefined
    }))
  );

  return (
    <OaaCorrelationHeatmap
      cells={cells}
      items={items}
      height={Math.max(250, n * 42 + 92)}
      dataQuality="real"
      dataQualityLabel="Histórico"
      dataQualityNote="Correlación de rentabilidades alineadas por fecha sobre el histórico común."
    />
  );
}
