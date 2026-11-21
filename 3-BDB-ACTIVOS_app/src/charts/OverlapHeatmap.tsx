import { useMemo } from "react";
import { OaaEmptyState, OaaOverlapHeatmap, type OaaOverlapCell, type OaaOverlapItem } from "./oaa";
import { rotuloDeCarteraPublicada } from "../core/carteraPublicada";
import { procedenciaDeLaCartera } from "../core/carteraDelEmisor";
import { calculateOverlap, NOTA_MAS_DE_100, NOTA_SIN_COMUNES, pasaDeCien, sinComunes, situacionDeLaCartera } from "../core/overlap";
import { corteDeLaMatriz, estadoDeLaPosicion, FUERA_DE_LA_MATRIZ, notasDeLasFechasDelSolapamiento } from "../core/reportOverlap";
import type { BdbAssetHoldings } from "../types/bdbAssets";

export interface OverlapSeries {
  asset_id: string;
  display_name: string;
  /** Una acción no tiene subyacentes: no entra en la matriz, y se dice debajo. */
  instrument_type?: string;
  holdings: BdbAssetHoldings | null;
  /** La réplica que da el proveedor, si llega (`product_profile.replication`). Nunca la del emisor. */
  replica?: string;
  /** Su cartera no se pudo cargar: es un fallo, no que no la publique. */
  noSePudoLeer?: boolean;
}

export interface OverlapHeatmapProps {
  series: OverlapSeries[];
  /** EN RETIRADA: la matriz no da color a los activos; se acepta y no se usa. */
  colors?: string[];
  /**
   * Si junto a un ETF medido con la cartera completa de su emisor se dice que es «del emisor». En Modo cliente, no: se dice que es
   * la cartera completa y de cuándo es (`seEnsena("carteraDelEmisor")`). Por defecto, sí.
   */
  nombrarAlEmisor?: boolean;
}

/**
 * Solo entran los fondos que publican al menos la mitad de su cartera (Óscar, 11-11-2026): los demás, y las acciones, van debajo con su
 * motivo, con las mismas palabras que el informe interno (`corteDeLaMatriz`). La regla de la mitad sigue en `calculateOverlap`.
 */
export function OverlapHeatmap({ series, nombrarAlEmisor = true }: OverlapHeatmapProps) {

  const { cells, items, sinMatriz, fuera, pasaDe100, haySinComunes, notasDeFechas } = useMemo(() => {
    const situaciones = series.map((item) => situacionDeLaCartera(item.instrument_type, item.holdings, item.replica));
    const corte = corteDeLaMatriz(series.map((item, index) => ({
      display_name: item.display_name,
      status: estadoDeLaPosicion(situaciones[index].situacion, item.noSePudoLeer),
      published: situaciones[index].publicada
    })));
    const medidas = corte.dentro.map((index) => ({ serie: series[index], publicada: situaciones[index].publicada }));
    const items: OaaOverlapItem[] = medidas.map(({ serie, publicada }) => ({
      key: serie.asset_id,
      label: serie.display_name,
      /* La cartera completa de un ETF lo dice, con su fecha: puede ser más antigua que la del proveedor. Fuera del Modo cliente dice
         además que es la del emisor (B-79, revisada el 14-11-2026). */
      detalle: publicada
        ? `${rotuloDeCarteraPublicada(publicada)}${serie.holdings?.issuer_portfolio ? ` · ${procedenciaDeLaCartera(serie.holdings.issuer_portfolio, nombrarAlEmisor)}` : ""}`
        : undefined
    }));

    const cells: OaaOverlapCell[] = corte.sinMatriz ? [] : medidas.flatMap(({ serie: row }, rowIndex) =>
      medidas.map(({ serie: column }, columnIndex) => {
        const overlap = calculateOverlap(row.holdings, column.holdings);
        return {
          rowKey: row.asset_id,
          columnKey: column.asset_id,
          rowLabel: row.display_name,
          columnLabel: column.display_name,
          rowIndex,
          columnIndex,
          value: overlap.overlapPercent,
          commonTop: overlap.commonTop,
          noAplica: false
        };
      })
    );

    return {
      cells,
      items,
      sinMatriz: corte.sinMatriz,
      fuera: corte.fuera,
      /* IMP-7: si las carteras que se comparan son de fechas separadas por más de un mes, o de alguna no consta la fecha, se dice. */
      notasDeFechas: corte.sinMatriz ? [] : notasDeLasFechasDelSolapamiento(medidas.map(({ serie }) => ({ display_name: serie.display_name, asOfDate: serie.holdings?.as_of_date }))),
      pasaDe100: cells.some((cell) => cell.rowIndex !== cell.columnIndex && pasaDeCien(cell.value)),
      haySinComunes: cells.some((cell) => cell.rowIndex !== cell.columnIndex && sinComunes(cell.value))
    };
  }, [nombrarAlEmisor, series]);

  const listaDeFuera = fuera.length > 0 ? (
    <>
      <p className="cmp-note">{FUERA_DE_LA_MATRIZ}</p>
      {fuera.map((linea, i) => <p className="cmp-note" key={`${i}-${linea}`}>{linea}</p>)}
    </>
  ) : null;

  if (sinMatriz) {
    return (
      <>
        <OaaEmptyState>{sinMatriz}</OaaEmptyState>
        {listaDeFuera}
      </>
    );
  }

  return (
    <>
      <OaaOverlapHeatmap
        cells={cells}
        items={items}
        height={Math.max(250, items.length * 42 + 92)}
        dataQuality="real"
        dataQualityLabel="Cartera publicada"
        dataQualityNote="Calculado sobre las posiciones publicadas de cada activo."
      />
      {notasDeFechas.map((nota) => <p className="cmp-note" key={nota}>{nota}</p>)}
      <p className="cmp-note">
        Cada cifra suma los títulos comunes entre lo que se ha recibido, con el peso real de cada uno y sin reescalar: por eso dice
        «al menos», y el solapamiento real puede ser mayor. No cuentan los derivados, sus contrapartidas ni el efectivo, cuando el
        dato dice qué es cada línea. Solo entran los fondos de los que se ha recibido al menos la mitad de su cartera, sumando el
        peso de sus líneas publicadas: la lista dice de cada uno cuántas son y qué peso suman.{haySinComunes ? ` ${NOTA_SIN_COMUNES}` : ""}{pasaDe100 ? ` ${NOTA_MAS_DE_100}` : ""}
      </p>
      {listaDeFuera}
    </>
  );
}
