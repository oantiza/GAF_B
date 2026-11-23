/**
 * Llevar las posiciones de la cartera a una propuesta nueva en Diseño, para trabajar sobre ellas
 * con las herramientas de pesos. Es el mismo camino que usa Rendimiento (`llevarADiseno`): se
 * resuelven contra el catálogo y pasan con su valor de mercado. Lo que no es del catálogo
 * (los activos propios) no puede pasar, y se dice cuáles antes de enviar.
 */
import { useState } from "react";
import { resolvePortfolioBatch } from "../../../adapters/resolvePortfolioBackend";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import { Panel } from "../../../components/ui/Panel";
import { useConfirm } from "../../../components/ui/useConfirm";
import { posicionesDelAnalisis, positionsToPortfolio, type PositionsPortfolioTransfer } from "../../../core/positionsToPortfolio";
import type { Analisis } from "../../motor/analisis";
import { escrito } from "../textos";

export function LlevarADiseno({ analisis, onSendToBuilder }: { analisis: Analisis; onSendToBuilder?: (cartera: PositionsPortfolioTransfer) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const divisa = analisis.cartera.divisaBase;
  /* Pasan con su valor de mercado: una posición sin precio no lo tiene (`valor` es `null`) y no puede pasar. */
  const delCatalogo = analisis.posiciones.flatMap((posicion) => (posicion.activo.origen === "catalogo" && posicion.activo.isin && posicion.valor !== null && posicion.valor > 0 ? [{ ...posicion, valor: posicion.valor }] : []));
  const propias = analisis.posiciones.filter((posicion) => !(posicion.activo.origen === "catalogo" && posicion.activo.isin));
  /* Las del catálogo que se quedan fuera por no tener precio: antes se descartaban sin decirlo. */
  const sinPrecio = analisis.sinPrecio.filter((posicion) => posicion.activo.origen === "catalogo" && posicion.activo.isin);
  if (!onSendToBuilder) return null;
  /* Sin ninguna que pueda pasar porque las del catálogo no tienen precio, el bloque no se esconde: dice por qué no hay nada que llevar. Si no hay del catálogo, no hay nada que explicar. */
  if (delCatalogo.length === 0) {
    if (sinPrecio.length === 0) return null;
    return (
      <Panel claseDelCuerpo="stack stack--tight" subtitulo={`Las posiciones a ${escrito.fecha(analisis.fecha)}, con su valor de mercado`} titulo="Llevar a una propuesta">
        <p className="cmp-note">
          No hay nada que llevar a Diseño: ninguna posición del catálogo tiene precio a {escrito.fecha(analisis.fecha)}, y a Diseño solo pasan las que tienen valor de mercado.
          {sinPrecio.length > 0 ? ` ${sinPrecio.length === 1 ? "No pasa, porque no tiene precio" : "No pasan, porque no tienen precio"}: ${sinPrecio.map((posicion) => posicion.activo.nombre).join(", ")}.` : ""}
          {propias.length > 0 ? ` No pasan, porque no son del catálogo: ${propias.map((posicion) => posicion.activo.nombre).join(", ")}.` : ""}
        </p>
      </Panel>
    );
  }

  async function llevar() {
    if (!onSendToBuilder || enviando) return;
    setEnviando(true);
    setAviso(null);
    try {
      const transfer = positionsToPortfolio(await resolvePortfolioBatch(posicionesDelAnalisis(delCatalogo.map((posicion) => ({ asset_id: posicion.activo.isin!, market_value: posicion.valor })))));
      if (transfer.positions.length === 0) {
        setAviso("Ninguna posición se reconoce como invertible en el catálogo: no hay nada que llevar a Diseño de cartera.");
        return;
      }
      if (
        transfer.excludedIds.length > 0 &&
        !(await confirm({
          title: "Algunas posiciones no pasan a Diseño de cartera",
          message: `Pasan ${transfer.positions.length} activos con ${escrito.importe(transfer.totalCapital, divisa)}. Se quedan fuera ${transfer.excludedIds.length} posiciones con ${escrito.importe(transfer.excludedCapital, divisa)}, que el catálogo no reconoce como invertibles: ${transfer.excludedIds.join(", ")}.`,
          confirmLabel: "Llevar a una propuesta"
        }))
      ) {
        return;
      }
      onSendToBuilder({ ...transfer, name: analisis.cartera.nombre });
    } catch (causa) {
      setAviso(causa instanceof Error ? causa.message : "No se han podido llevar las posiciones a Diseño de cartera.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Panel
      acciones={<Button busy={enviando} onClick={() => void llevar()} size="sm" textoAlTrabajar="Llevando las posiciones a Diseño…">Llevar a una propuesta</Button>}
      claseDelCuerpo="stack stack--tight"
      subtitulo={`Las posiciones a ${escrito.fecha(analisis.fecha)}, con su valor de mercado`}
      titulo="Llevar a una propuesta"
    >
      <p className="cmp-note">
        Crea una propuesta nueva en Diseño con estas posiciones; la cartera del cliente no cambia. Pasan {delCatalogo.length === 1 ? "1 posición del catálogo" : `${delCatalogo.length} posiciones del catálogo`}, con sus pesos a {escrito.fecha(analisis.fecha)}. El efectivo no pasa.
        {propias.length > 0 ? ` No pasan, porque no son del catálogo: ${propias.map((posicion) => posicion.activo.nombre).join(", ")}.` : ""}
        {sinPrecio.length > 0 ? ` ${sinPrecio.length === 1 ? "No pasa, porque no tiene precio" : "No pasan, porque no tienen precio"}: ${sinPrecio.map((posicion) => posicion.activo.nombre).join(", ")}.` : ""}
      </p>
      {aviso ? <Aviso tono="error">{aviso}</Aviso> : null}
      {confirmDialog}
    </Panel>
  );
}
