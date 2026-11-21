import { useEffect, useState } from "react";
import { useModoCliente } from "../app/ClientModeContext";
import { PositionsWorkbench, type PositionsWorkbenchMode } from "../components/PositionsWorkbench";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { PositionsPortfolioTransfer } from "../core/positionsToPortfolio";

/**
 * Posiciones (decisión 1 del rediseño, 02-11-2026): un destino con dos modos.
 *
 * Hasta hoy eran dos entradas del rail en dos secciones distintas —«Extracto externo»
 * bajo Cartera real y «Posiciones globales» bajo Cartera—, y las dos montaban el mismo
 * componente, `PositionsWorkbench`, cambiando una prop. Un componente en dos sitios
 * obliga al asesor a recordar cuál de las dos secciones tiene la mesa de trabajo que
 * quiere; con un selector dentro, no.
 *
 * El estado NO se pierde al cambiar de modo: cada modo tiene su propia ranura de sesión
 * en `PositionsWorkbench`, que la lee al montarse. Por eso el componente se monta de nuevo
 * con cada modo (`key`): sin ella seguía montado, enseñaba en Globales lo pegado en Extracto
 * y lo escribía en la ranura del otro modo (18-11-2026). Un extracto pegado sigue ahí
 * después de ir a Globales y volver, y Globales no lo ve.
 */

interface PosicionesPageProps {
  sourceKind: AssetDataSourceKind;
  /** Abre las posiciones convertidas a peso como cartera activa en el Constructor. */
  onSendToBuilder?: (portfolio: PositionsPortfolioTransfer) => void;
  /** El modo con el que abre. Lo trae `/posiciones-globales`, que ahora redirige aquí. */
  initialMode?: PositionsWorkbenchMode;
}

export function PosicionesPage({ sourceKind, onSendToBuilder, initialMode }: PosicionesPageProps) {
  const { seEnsena } = useModoCliente();
  const [mode, setMode] = useState<PositionsWorkbenchMode>(initialMode ?? "extracto");

  /* La intención de una URL se consume al montar, pero el componente puede seguir
     montado cuando llega otra: igual que MercadoPage con sus pestañas. */
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  /* Decisión 19: Posiciones globales no se ve en Modo cliente, tampoco por `/posiciones-globales`.
     El modo elegido se conserva y vuelve al quitar el interruptor. */
  const modoEfectivo = seEnsena("posicionesGlobales") ? mode : "extracto";

  return (
    <PositionsWorkbench
      key={modoEfectivo}
      mode={modoEfectivo}
      onModeChange={setMode}
      onSendToBuilder={onSendToBuilder}
      sourceKind={sourceKind}
    />
  );
}
