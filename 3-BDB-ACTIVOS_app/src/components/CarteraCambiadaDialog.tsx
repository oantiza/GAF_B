import { useId } from "react";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";

export type EleccionAnteLaGuardadaCambiada = "nueva" | "sobrescribir" | "cancelar";

interface CarteraCambiadaDialogProps {
  nombre: string;
  /** Qué se ha encontrado al volver a leerla antes de guardar. */
  estado: "cambiada" | "eliminada" | "sin-comprobar";
  onElegir: (eleccion: EleccionAnteLaGuardadaCambiada) => void;
}

/* Rediseño del 14-11-2026: el objeto que se guarda es la «propuesta», como en el resto de Diseño y Guardadas. */
const QUE_PASA: Record<CarteraCambiadaDialogProps["estado"], string> = {
  cambiada:
    "La propuesta guardada ha cambiado desde que la abriste: se ha guardado desde otra pestaña u otro equipo. Si la sobrescribes, lo que se guardó allí se pierde.",
  eliminada: "La propuesta guardada ya no existe: se ha eliminado desde otra pestaña u otro equipo.",
  "sin-comprobar":
    "No se ha podido comprobar si la propuesta guardada ha cambiado desde que la abriste. Si se ha guardado desde otra pestaña u otro equipo y la sobrescribes, lo que se guardó allí se pierde."
};

const TITULO_DEL_AVISO: Record<CarteraCambiadaDialogProps["estado"], string> = {
  cambiada: "Ha cambiado.",
  eliminada: "Ya no existe.",
  "sin-comprobar": "Sin comprobar."
};

/**
 * DIS-03: «Guardar» sobre una cartera que ha cambiado, o desaparecido, desde que se abrió. Tres salidas, como
 * `CambiosSinGuardarDialog`: con `ConfirmDialog`, cerrar o pulsar Escape sería una de las dos que escriben.
 * Cerrar es «Cancelar», y el foco arranca en lo que no pisa nada.
 */
export function CarteraCambiadaDialog({ nombre, estado, onElegir }: CarteraCambiadaDialogProps) {
  const tituloId = useId();
  return (
    <ModalDialog className="ui-confirm-dialog" labelledBy={tituloId} onClose={() => onElegir("cancelar")} size="sm">
      <DialogHeader title={nombre.trim() ? `${nombre.trim()}: no se ha guardado todavía` : "No se ha guardado todavía"} titleId={tituloId} />
      <DialogBody>
        <Aviso titulo={TITULO_DEL_AVISO[estado]}>{QUE_PASA[estado]}</Aviso>
      </DialogBody>
      <DialogFooter>
        <Button autoFocus onClick={() => onElegir("nueva")} variant="primary">
          Guardar como una propuesta nueva
        </Button>
        {estado === "eliminada" ? null : (
          <Button onClick={() => onElegir("sobrescribir")} variant="danger">
            Sobrescribir de todos modos
          </Button>
        )}
        <Button onClick={() => onElegir("cancelar")} variant="secondary">
          Cancelar
        </Button>
      </DialogFooter>
    </ModalDialog>
  );
}
