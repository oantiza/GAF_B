import { useId, useState } from "react";
import { DRAFT_NAME_MAX_LENGTH } from "../core/localPortfolioStorage";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";

interface GuardarCarteraDialogProps {
  /** «Guardar como…», «Guardar la propuesta» cuando aún no tiene nombre, o «Renombrar» desde Guardadas. */
  titulo: string;
  /** El nombre de la cartera: es el mismo campo, no otro nombre aparte. */
  nombre: string;
  /** Nombres que ya están guardados, para avisar antes de crear otra con el mismo. */
  nombresGuardados: readonly string[];
  guardando: boolean;
  error: string | null;
  onGuardar: (nombre: string) => void;
  onCancelar: () => void;
  /** El botón que confirma. «Guardar» por defecto. */
  rotuloDelBoton?: string;
  /** Lo que se dice si el nombre ya está guardado. Por defecto, que se creará otra con el mismo. */
  avisoDeRepetido?: string;
}

export function GuardarCarteraDialog({
  titulo,
  nombre,
  nombresGuardados,
  guardando,
  error,
  onGuardar,
  onCancelar,
  rotuloDelBoton = "Guardar",
  avisoDeRepetido = "Ya hay una propuesta guardada con este nombre: se creará otra con el mismo."
}: GuardarCarteraDialogProps) {
  const tituloId = useId();
  const [valor, setValor] = useState(nombre);
  const limpio = valor.trim();
  const repetido = nombresGuardados.some((guardado) => guardado.trim().toLocaleLowerCase("es") === limpio.toLocaleLowerCase("es"));

  return (
    <ModalDialog
      className="ui-confirm-dialog"
      labelledBy={tituloId}
      onClose={() => {
        if (!guardando) onCancelar();
      }}
      size="sm"
    >
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          if (limpio && !guardando) onGuardar(limpio);
        }}
      >
        <DialogHeader title={titulo} titleId={tituloId} />
        <DialogBody>
          <Campo pista={repetido ? avisoDeRepetido : undefined} rotulo="Nombre de la propuesta">
            <input
              autoFocus
              disabled={guardando}
              maxLength={DRAFT_NAME_MAX_LENGTH}
              onChange={(evento) => setValor(evento.target.value)}
              placeholder="Cliente · propuesta"
              type="text"
              value={valor}
            />
          </Campo>
          {error ? (
            <Aviso titulo="No se ha guardado." tono="error">
              {error}
            </Aviso>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button disabled={guardando} onClick={onCancelar} variant="secondary">
            Cancelar
          </Button>
          <Button busy={guardando} disabled={!limpio} type="submit" variant="primary">
            {rotuloDelBoton}
          </Button>
        </DialogFooter>
      </form>
    </ModalDialog>
  );
}
