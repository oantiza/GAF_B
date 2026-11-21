import { useId, useState } from "react";
import { tituloDeCambiosSinGuardar } from "../core/textosDeCartera";
import { DRAFT_NAME_MAX_LENGTH } from "../core/localPortfolioStorage";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";

interface CambiosSinGuardarDialogProps {
  /** El nombre de la cartera. Sin él, el diálogo lo pide: una cartera no se guarda sin nombre. */
  nombre: string;
  guardando: boolean;
  /** Por qué no se ha podido guardar: el diálogo sigue abierto y no se ha perdido nada. */
  error: string | null;
  /** Sin posiciones no hay nada que guardar: no se ofrece, porque dejaría vacía la cartera guardada. */
  sinPosiciones?: boolean;
  /**
   * Se ha guardado, y hay algo que decir: una posición que se ha quedado fuera, un aviso del servidor. La acción no
   * sigue sola, porque sustituiría lo de la pantalla y la posición desaparecería sin una palabra.
   */
  avisoAlGuardar?: string | null;
  onContinuar?: () => void;
  onGuardar: (nombre: string) => void;
  onDescartar: () => void;
  onCancelar: () => void;
}

/**
 * La pregunta antes de que algo sustituya una cartera con cambios: abrir otra, importar, «Llevar a
 * Diseño de cartera», «Nueva cartera» o «Salir». Es la pieza del diálogo con tres salidas; las de dos,
 * con `ConfirmDialog`.
 */
export function CambiosSinGuardarDialog({
  nombre,
  guardando,
  error,
  sinPosiciones = false,
  avisoAlGuardar = null,
  onContinuar,
  onGuardar,
  onDescartar,
  onCancelar
}: CambiosSinGuardarDialogProps) {
  const tituloId = useId();
  const [nombreTecleado, setNombreTecleado] = useState("");
  const faltaNombre = !nombre.trim() && !sinPosiciones;
  const nombreFinal = nombre.trim() || nombreTecleado.trim();

  if (avisoAlGuardar) {
    return (
      <ModalDialog className="ui-confirm-dialog" labelledBy={tituloId} onClose={onCancelar} size="sm">
        <DialogHeader title="Guardada, con un aviso" titleId={tituloId} />
        <DialogBody>
          <Aviso anunciar titulo="Guardada, con un aviso.">
            {avisoAlGuardar}
          </Aviso>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onContinuar} variant="primary">
            Continuar
          </Button>
          <Button autoFocus onClick={onCancelar} variant="secondary">
            Quedarme aquí
          </Button>
        </DialogFooter>
      </ModalDialog>
    );
  }

  return (
    <ModalDialog
      className="ui-confirm-dialog"
      labelledBy={tituloId}
      onClose={() => {
        if (!guardando) onCancelar();
      }}
      size="sm"
    >
      <DialogHeader title={tituloDeCambiosSinGuardar(nombre)} titleId={tituloId} />
      {faltaNombre || error || sinPosiciones ? (
        <DialogBody>
          {sinPosiciones ? <p>Se ha quedado sin posiciones, así que no hay nada que guardar. Si la descartas, lo guardado sigue como estaba.</p> : null}
          {faltaNombre ? (
            /* Un formulario: Intro guarda y continúa, si hay nombre, como en «Guardar la propuesta». */
            <form
              onSubmit={(evento) => {
                evento.preventDefault();
                if (nombreFinal && !guardando) onGuardar(nombreFinal);
              }}
            >
              <Campo rotulo="Nombre para guardarla">
                <input
                  disabled={guardando}
                  maxLength={DRAFT_NAME_MAX_LENGTH}
                  onChange={(evento) => setNombreTecleado(evento.target.value)}
                  placeholder="Cliente · propuesta"
                  type="text"
                  value={nombreTecleado}
                />
              </Campo>
            </form>
          ) : null}
          {error ? (
            <Aviso titulo="No se ha guardado." tono="error">
              {error}
            </Aviso>
          ) : null}
        </DialogBody>
      ) : null}
      <DialogFooter>
        {sinPosiciones ? null : (
          <Button busy={guardando} disabled={!nombreFinal} onClick={() => onGuardar(nombreFinal)} variant="primary">
            Guardar y continuar
          </Button>
        )}
        <Button disabled={guardando} onClick={onDescartar} variant="danger">
          Descartar
        </Button>
        {/* Una acción peligrosa arranca en «Cancelar»: un Intro de más no se lleva la cartera. */}
        <Button autoFocus disabled={guardando} onClick={onCancelar} variant="secondary">
          Cancelar
        </Button>
      </DialogFooter>
    </ModalDialog>
  );
}
