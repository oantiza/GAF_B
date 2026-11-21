import { useModoCliente } from "../app/ClientModeContext";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";

/**
 * «No se han podido cargar los dividendos», con su «Reintentar» (hallazgo 93). Es lo que distingue
 * un fallo de un periodo sin nada previsto. El detalle de lo que dijo la fuente es para el asesor:
 * delante de un cliente solo se dice que no se ha podido, y que se puede volver a intentar.
 */
export function FalloDeAgenda({
  mensaje,
  detalle,
  onRetry
}: {
  mensaje: string;
  detalle?: string | null;
  onRetry: () => void;
}) {
  const { seEnsena } = useModoCliente();
  return (
    <Aviso
      accion={
        <Button onClick={onRetry} size="sm">
          Reintentar
        </Button>
      }
      titulo={mensaje}
      tono="error"
    >
      {detalle && seEnsena("fuenteDeDatos") ? detalle : null}
    </Aviso>
  );
}
