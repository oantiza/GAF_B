import { useId, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ModalDialog";

/**
 * U-17 (auditoría 29-09). Sustituye a `window.confirm`: mismo contrato
 * (pregunta → sí/no) pero con el diálogo del sistema — trampa de foco, Escape,
 * restauración del foco y la tipografía de la casa — y textos en castellano
 * («Aplicar» / «Cancelar», nunca «OK»).
 */
export interface ConfirmOptions {
  title: ReactNode;
  /** Cuerpo del diálogo. Una cadena con saltos de línea se parte en párrafos. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` para acciones destructivas o escrituras irreversibles. */
  tone?: Extract<ButtonVariant, "primary" | "danger">;
}

interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

function paragraphs(message: ReactNode): ReactNode {
  if (typeof message !== "string") return message;
  return message
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => <p key={index}>{line}</p>);
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Aplicar",
  cancelLabel = "Cancelar",
  tone = "primary",
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const titleId = useId();
  return (
    <ModalDialog className="ui-confirm-dialog" labelledBy={titleId} onClose={onCancel} size="sm">
      {/* La confirmación puede abrirse sobre otro diálogo (FundSwapModal): Escape
          se resuelve aquí y no sigue hasta el documento, donde cerraría también
          el diálogo de debajo. */}
      <div
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <DialogHeader title={title} titleId={titleId} onClose={onCancel} />
        {message ? <DialogBody>{paragraphs(message)}</DialogBody> : null}
        <DialogFooter>
          {/* En una acción peligrosa, el foco arranca en «Cancelar»: un Intro de más no borra nada. */}
          <Button autoFocus={tone === "danger"} onClick={onCancel} variant="secondary">
            {cancelLabel}
          </Button>
          <Button autoFocus={tone !== "danger"} onClick={onConfirm} variant={tone}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </div>
    </ModalDialog>
  );
}
