import { useModoCliente } from "../app/ClientModeContext";
import { esFaltaDeDatos, motivoDelServidor } from "../core/appError";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { Aviso } from "./ui/Aviso";

const NO_SE_PUEDE_GENERAR = "No se puede generar este informe: con los datos de hoy, la simulación no mide ninguna posición de la cartera.";

/**
 * Lo que dice el diálogo de un informe si no ha salido (decisión 105). Va dentro: el diálogo solo se cierra si sale bien, y detrás, difuminado,
 * no se leía y parecía que el botón no hacía nada.
 *
 * Son dos cosas distintas. Si el servidor dice que con estos datos no se puede, reintentar no lo arregla: se dice por qué, y delante del cliente solo que
 * no se puede, porque el motivo es cocina. Un fallo de verdad, de red o del servidor, sí se reintenta.
 *
 * La frase es la del informe de cliente. Quien la cambia es porque esa no sería cierta: la Comparativa de carteras dice cuál de las dos no mide nada, y
 * el informe interno, que sale aunque la simulación no mida nada, no la puede achacar a eso. El motivo, si no es el del error, es el de quien lo junta.
 */
export function AvisoDelInforme({
  error,
  onRetry,
  frase = NO_SE_PUEDE_GENERAR,
  motivo
}: {
  error: unknown;
  onRetry: () => void;
  frase?: string;
  motivo?: string;
}) {
  const { activo: modoCliente } = useModoCliente();
  if (!esFaltaDeDatos(error)) return <AsyncErrorBanner error={error} onRetry={onRetry} />;
  const porQue = modoCliente ? undefined : motivo ?? motivoDelServidor(error);
  /* Pide la atención del asesor y no es un fallo: el ocre, con su palabra, y se anuncia al aparecer. */
  return (
    <Aviso anunciar titulo={frase}>
      {porQue ? <span className="analisis-motivo">Motivo: {porQue}</span> : null}
    </Aviso>
  );
}
