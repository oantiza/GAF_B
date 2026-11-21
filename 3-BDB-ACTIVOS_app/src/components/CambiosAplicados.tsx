import type { PortfolioOptimizationDiffResult } from "../core/portfolioOptimizationDiff";
import { CambiosDePeso, CifrasDeLosCambios } from "./CambiosDePeso";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";

/**
 * Lo que acaba de cambiar una propuesta aplicada, junto a quien la ha aplicado. Vivía dentro de la comprobación previa:
 * al bajar esta al final del paso, el resultado de optimizar se quedaba debajo de «Fondos equivalentes».
 */
export function CambiosAplicados({
  comparacion,
  capital,
  carteraCambiada = false,
  onVolverALosPesosAnteriores
}: {
  comparacion: PortfolioOptimizationDiffResult;
  capital?: number;
  /** La cartera ya no es la que dejó la propuesta: lo de aquí es lo que hizo la propuesta, no lo que hay ahora. */
  carteraCambiada?: boolean;
  /** Deshace lo aplicado: la cartera vuelve a como estaba antes de la propuesta. */
  onVolverALosPesosAnteriores?: () => void;
}) {
  return (
    <Panel
      acciones={
        onVolverALosPesosAnteriores ? (
          <Button onClick={onVolverALosPesosAnteriores} size="sm" variant="secondary">
            Volver a los pesos anteriores
          </Button>
        ) : null
      }
      claseDelCuerpo="stack stack--tight"
      rotulo="Antes / después"
      titulo={`Cambios aplicados · ${comparacion.source}`}
      tituloId="optimization-diff-title"
    >
      {carteraCambiada ? (
        /* Ocre, como los otros dos avisos de una propuesta que ya no es de esta cartera (Optimizar y Fondos equivalentes). */
        <Aviso anunciar tono="aviso">
          La cartera ha cambiado después de aplicar la propuesta. Esto es lo que hizo la propuesta, no lo que hay ahora; sus cifras del modelo
          ya no son de estos pesos y no se enseñan.
        </Aviso>
      ) : (
        <CifrasDeLosCambios comparacion={comparacion} conRetrocesion />
      )}
      <CambiosDePeso capital={capital} comparacion={comparacion} titulo="Cambios de peso aplicados" />
    </Panel>
  );
}
