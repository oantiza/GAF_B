import type { InstrumentType } from "../types/bdbAssets";
import { Button } from "./ui/Button";
import { SegmentedControl } from "./ui/SegmentedControl";

export type AssetFilterValue = "ALL" | InstrumentType;

interface AssetSearchFiltersProps {
  activeFilter: AssetFilterValue;
  hasActiveCriteria?: boolean;
  onClear?: () => void;
  onFilterChange: (filter: AssetFilterValue) => void;
}

const filterOptions: Array<{ label: string; id: AssetFilterValue }> = [
  { label: "Todos", id: "ALL" },
  { label: "Fondos", id: "FUND" },
  { label: "Acciones", id: "STOCK" },
  { label: "ETF", id: "ETF" }
];
/* ACT-10: el mismo orden que el filtro de producto del Buscador (Todos · Fondos · Acciones · ETF). */

/* Auditoría 14-10 (MEDIA-21): el grupo de chips con aria-pressed hecho a mano
   pasa a la primitiva SegmentedControl (flechas, Inicio/Fin, foco), y el
   «Limpiar» a Button. Un control = una primitiva. */
export function AssetSearchFilters({
  activeFilter,
  hasActiveCriteria = false,
  onClear,
  onFilterChange
}: AssetSearchFiltersProps) {
  return (
    <div className="asset-filter-group">
      <SegmentedControl
        label="Filtro por tipo instrumental"
        onChange={onFilterChange}
        options={filterOptions}
        value={activeFilter}
      />
      {hasActiveCriteria && onClear ? (
        <Button size="sm" variant="quiet" onClick={onClear}>
          Limpiar búsqueda y filtros
        </Button>
      ) : null}
    </div>
  );
}
