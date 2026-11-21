import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useAccessibleDialog } from "../../core/useAccessibleDialog";
import { Button } from "./Button";

type DialogSize = "sm" | "md" | "lg";

interface ModalDialogProps {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  size?: DialogSize;
  className?: string;
  closeOnBackdrop?: boolean;
}

export function ModalDialog({
  labelledBy,
  onClose,
  children,
  size = "md",
  className = "",
  closeOnBackdrop = true
}: ModalDialogProps) {
  const dialogRef = useAccessibleDialog<HTMLElement>({ open: true, onClose });

  return createPortal(
    <div
      className="ui-dialog-backdrop"
      role="presentation"
      onMouseDown={closeOnBackdrop ? onClose : undefined}
    >
      <section
        ref={dialogRef}
        className={`ui-dialog ui-dialog--${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>,
    document.body
  );
}

interface DialogHeaderProps {
  titleId: string;
  title: ReactNode;
  eyebrow?: ReactNode;
  onClose?: () => void;
  actions?: ReactNode;
}

export function DialogHeader({ titleId, title, eyebrow, onClose, actions }: DialogHeaderProps) {
  return (
    <header className="ui-dialog__header">
      <div className="ui-dialog__heading">
        {eyebrow ? <p className="ui-dialog__eyebrow">{eyebrow}</p> : null}
        {/* Un diálogo es su propio documento: su título es `h2`, y lo que lleva dentro, `h3` (MAR-32). */}
        <h2 id={titleId}>{title}</h2>
      </div>
      {actions}
      {onClose ? (
        <Button variant="quiet" size="sm" iconOnly aria-label="Cerrar" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Button>
      ) : null}
    </header>
  );
}

export function DialogBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ui-dialog__body ${className}`.trim()}>{children}</div>;
}

export function DialogFooter({
  children,
  className = "",
  nota
}: {
  children: ReactNode;
  className?: string;
  /** Lo que hay que leer antes de pulsar: junto a los botones, a la vista aunque el cuerpo haga scroll. */
  nota?: ReactNode;
}) {
  return (
    <footer className={`ui-dialog__footer ${className}`.trim()}>
      {nota ? <p className="ui-dialog__footer-nota">{nota}</p> : null}
      {children}
    </footer>
  );
}
