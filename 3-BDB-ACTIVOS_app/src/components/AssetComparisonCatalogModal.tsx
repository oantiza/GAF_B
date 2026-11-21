import { useEffect, useMemo, useState } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { getCommercialRetroList } from "../adapters/commercialRetroStore";
import { NO_SE_ANADE_SIN_MEDIR, sinPrecioNiMetricas } from "../core/accionDeCartera";
import {
  buildComparisonCatalogRows,
  loadComparisonCatalogDetails,
  materializeComparisonCatalogSelection,
  ordenarCatalogoPorNombre,
  toggleComparisonCatalogSelection,
  type ComparisonCatalogRow
} from "../core/assetComparisonCatalog";
import { porcentaje, rentabilidad } from "../core/formato";
import { nombreDelMetodoEnPantalla } from "../core/metodoEnPantalla";
import { seEnsenaLaMetrica, type MetricaDeInstrumento } from "../core/metricasPorInstrumento";
import { rotuloDeLaVentana } from "../core/metricsFrequency";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { BdbAssetDetail, BdbAssetSearchResult, InstrumentType } from "../types/bdbAssets";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { CommercialRetroRecord } from "../types/commercialRetro";
import type { CeldaDeTabla, ColumnaDeTabla, FilaAgrupable } from "../types/tablaDeDatos";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { Button } from "./ui/Button";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { useClientMode } from "../app/ClientModeContext";
import { useCommercialRetroAccess } from "../auth/useCommercialRetroAccess";

const TYPE_LABELS: Record<InstrumentType, string> = {
  FUND: "Fondo",
  ETF: "ETF",
  STOCK: "Acción",
  INDEX: "Índice"
};

type FilaDelCatalogo = ComparisonCatalogRow & FilaAgrupable;

/** Una cifra, «No aplica» si la lista dice que a este tipo no le aplica, o «Falta» en columna estrecha. */
function cifraDelCatalogo(
  metrica: MetricaDeInstrumento | null,
  fila: FilaDelCatalogo,
  valor: number | undefined,
  escribir: (fraccion: number) => string | null
): CeldaDeTabla {
  if (metrica && !seEnsenaLaMetrica(metrica, fila.asset.instrument_type)) {
    return { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" };
  }
  const texto = typeof valor === "number" ? escribir(valor) : null;
  return texto !== null
    ? { texto, valor }
    : { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" };
}

interface AssetComparisonCatalogContentProps {
  rows: ComparisonCatalogRow[];
  stagedIds: string[];
  max: number;
  loading?: boolean;
  /** El aviso de que lo leído es solo el principio del catálogo, si lo es. */
  avisoDeLimite?: string | null;
  warning?: string | null;
  outsideSelected?: BdbAssetSearchResult[];
  onToggle: (assetId: string) => void;
  onCancel: () => void;
  onApply: () => void;
}

export function AssetComparisonCatalogContent({
  rows,
  stagedIds,
  max,
  loading = false,
  avisoDeLimite,
  warning,
  outsideSelected = [],
  onToggle,
  onCancel,
  onApply
}: AssetComparisonCatalogContentProps) {
  const { enabled: clientMode } = useClientMode();
  const filas = useMemo<FilaDelCatalogo[]>(
    () =>
      rows.map((row) => ({
        ...row,
        id: row.asset.asset_id,
        /* La columna que se ordena es la de 1 año. */
        escala: rotuloDeLaVentana(row.detail?.metrics ?? row.asset.metrics, "1y").method
      })),
    [rows]
  );
  const columnas = useMemo<ColumnaDeTabla<FilaDelCatalogo>[]>(() => {
    const lista: ColumnaDeTabla<FilaDelCatalogo>[] = [
      {
        id: "seleccion",
        titulo: `${stagedIds.length}/${max}`,
        acciones: true,
        celda: (fila) => {
          const checked = stagedIds.includes(fila.asset.asset_id);
          return {
            texto: "",
            nodo: (
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && (stagedIds.length >= max || sinPrecioNiMetricas(fila.asset))}
                aria-label={`${checked ? "Quitar" : "Seleccionar"} ${fila.asset.display_name}`}
                onChange={() => onToggle(fila.asset.asset_id)}
              />
            )
          };
        }
      },
      {
        id: "nombre",
        titulo: "Activo",
        celda: (fila) => ({
          texto: fila.asset.display_name,
          apunte: [fila.asset.isin ?? fila.asset.ticker ?? fila.asset.asset_id, sinPrecioNiMetricas(fila.asset) ? NO_SE_ANADE_SIN_MEDIR : null]
            .filter(Boolean)
            .join(" · ")
        })
      },
      /* ACT-14: fondo, ETF o acción es el «Producto», como en el Buscador y en el selector; «Tipo» no decía de qué. */
      { id: "tipo", titulo: "Producto", celda: (fila) => ({ texto: TYPE_LABELS[fila.asset.instrument_type] }) },
      {
        id: "coste",
        titulo: "Coste",
        tituloCompleto: "Coste corriente",
        cifra: true,
        celda: (fila) => cifraDelCatalogo("costeCorriente", fila, fila.ongoingCharge, porcentaje)
      },
      /* Un dato en su columna, y el orden no la usa (decisión 17). Con Modo cliente no se enseña. */
      ...(clientMode
        ? []
        : [
            {
              id: "retro",
              titulo: "Retrocesión",
              cifra: true,
              sinOrden: true,
              celda: (fila: FilaDelCatalogo) => cifraDelCatalogo("retrocesion", fila, fila.retroRate, porcentaje)
            }
          ]),
      {
        id: "rentabilidad",
        titulo: "Rent. 1A",
        tituloCompleto: "Rentabilidad 1 año",
        cifra: true,
        /* Nunca se ordena una cifra contra otra de escala distinta: al ordenar por ella, la tabla agrupa. */
        escalaMixta: true,
        celda: (fila) => cifraDelCatalogo(null, fila, fila.annualizedReturn1y, rentabilidad)
      }
    ];
    return lista;
  }, [clientMode, max, onToggle, stagedIds]);

  return (
    <>
      <DialogBody className="cmp-catalog-body">
        <div className="cmp-catalog-status" aria-live="polite">
          <span>{rows.length} activos coinciden con el filtro actual.</span>
          {avisoDeLimite ? <strong>{avisoDeLimite}</strong> : null}
          {loading ? <span>{clientMode ? "Cargando el coste corriente…" : "Cargando el coste corriente y las retrocesiones…"}</span> : null}
          {warning ? <span className="cmp-catalog-warning">{warning}</span> : null}
        </div>

        {outsideSelected.length > 0 ? (
          <section className="cmp-catalog-outside" aria-labelledby="cmp-catalog-outside-title">
            <div>
              <h3 id="cmp-catalog-outside-title">Seleccionados fuera del filtro</h3>
              <p>También cuentan para el máximo de {max}. Desmárcalos aquí para liberar espacio.</p>
            </div>
            <ul>
              {outsideSelected.map((asset) => {
                const checked = stagedIds.includes(asset.asset_id);
                return (
                  <li key={asset.asset_id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && stagedIds.length >= max}
                        onChange={() => onToggle(asset.asset_id)}
                      />
                      <span>{asset.display_name}</span>
                      <small>{asset.isin ?? asset.ticker ?? asset.asset_id}</small>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="cmp-catalog-table-wrap">
          {filas.length > 0 ? (
            <TablaDeDatos
              columnas={columnas}
              deActivos
              filas={filas}
              nombreDeEscala={nombreDelMetodoEnPantalla}
              seleccionada={(fila) => stagedIds.includes(fila.asset.asset_id)}
              titulo="Catálogo de activos"
            />
          ) : (
            <p className="cmp-catalog-empty">No hay activos que coincidan con el filtro actual.</p>
          )}
        </div>
      </DialogBody>
      <DialogFooter className="cmp-catalog-footer">
        <span>{stagedIds.length}/{max} seleccionados</span>
        <Button onClick={onCancel} variant="quiet">Cancelar</Button>
        {/* El botón dice lo que hace: la selección se marca y se desmarca, así que aplicarla también quita. Decía «Añadir a la comparación». */}
        <Button onClick={onApply} variant="primary">Aplicar la selección</Button>
      </DialogFooter>
    </>
  );
}

interface AssetComparisonCatalogModalProps {
  assets: BdbAssetSearchResult[];
  selected: BdbAssetSearchResult[];
  sourceKind: AssetDataSourceKind;
  max: number;
  avisoDeLimite: string | null;
  onApply: (assets: BdbAssetSearchResult[]) => void;
  onClose: () => void;
}

export function AssetComparisonCatalogModal({
  assets,
  selected,
  sourceKind,
  max,
  avisoDeLimite,
  onApply,
  onClose
}: AssetComparisonCatalogModalProps) {
  const { enabled: clientMode } = useClientMode();
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);
  const [detailsByAssetId, setDetailsByAssetId] = useState<Map<string, BdbAssetDetail>>(new Map());
  const [retroRecords, setRetroRecords] = useState<CommercialRetroRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [stagedIds, setStagedIds] = useState(() => selected.map((asset) => asset.asset_id));
  // B4 / R-07 (29-09): sin claim admin no se consulta `commercial_retro`; la
  // columna queda «sin dato» sin aviso de error. Mientras el claim se resuelve
  // tampoco, y el efecto se repite al confirmarse.
  const retroAccess = useCommercialRetroAccess();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setWarning(null);

    Promise.allSettled([
      loadComparisonCatalogDetails(dataSource, assets),
      clientMode || retroAccess !== "granted" ? Promise.resolve([]) : getCommercialRetroList()
    ]).then(([detailsResult, retroResult]) => {
      if (!active) return;
      const warnings: string[] = [];
      if (detailsResult.status === "fulfilled") {
        setDetailsByAssetId(detailsResult.value.detailsByAssetId);
        if (detailsResult.value.partial) warnings.push("Coste corriente parcial: faltan detalles de algunos activos.");
      } else {
        setDetailsByAssetId(new Map());
        warnings.push("No se pudo cargar el coste corriente; la selección sigue disponible.");
      }
      if (!clientMode && retroResult.status === "fulfilled") {
        setRetroRecords(retroResult.value);
      } else if (!clientMode) {
        setRetroRecords([]);
        warnings.push("No se pudieron cargar las retrocesiones.");
      }
      setWarning(warnings.join(" ") || null);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [assets, clientMode, dataSource, retroAccess]);

  const rows = useMemo(
    () => ordenarCatalogoPorNombre(buildComparisonCatalogRows(assets, detailsByAssetId, retroRecords)),
    [assets, detailsByAssetId, retroRecords]
  );
  const outsideSelected = useMemo(() => {
    const catalogIds = new Set(assets.map((asset) => asset.asset_id));
    return selected.filter((asset) => !catalogIds.has(asset.asset_id));
  }, [assets, selected]);

  function handleToggle(assetId: string) {
    setStagedIds((current) => toggleComparisonCatalogSelection(current, assetId, max));
  }

  function handleApply() {
    onApply(materializeComparisonCatalogSelection(stagedIds, selected, assets, detailsByAssetId));
  }

  return (
    <ModalDialog labelledBy="comparison-catalog-title" onClose={onClose} size="lg">
      <DialogHeader
        titleId="comparison-catalog-title"
        /* ACT-14: el diálogo se llama como el botón que lo abre, en palabras llanas. */
        eyebrow="Comparador"
        title="Elegir del catálogo"
        onClose={onClose}
      />
      <AssetComparisonCatalogContent
        rows={rows}
        stagedIds={stagedIds}
        max={max}
        loading={loading}
        avisoDeLimite={avisoDeLimite}
        warning={warning}
        outsideSelected={outsideSelected}
        onToggle={handleToggle}
        onCancel={onClose}
        onApply={handleApply}
      />
    </ModalDialog>
  );
}
