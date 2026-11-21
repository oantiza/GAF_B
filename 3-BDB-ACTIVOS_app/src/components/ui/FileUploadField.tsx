import { useId, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";

interface FileUploadFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  helper?: ReactNode;
  /** Texto del botón. Por defecto, «Seleccionar archivo». */
  buttonLabel?: string;
  /** Texto cuando no hay fichero elegido. */
  emptyLabel?: string;
  /** El fichero que ya se cargó. El control nativo no lo recuerda al volver a la pantalla. */
  nombreCargado?: string | null;
}

const UPLOAD_ICON = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 16V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
  </svg>
);

/**
 * Carga de fichero con control propio.
 *
 * El input nativo se oculta visualmente (sigue siendo el elemento accesible y
 * enfocable) y se dibuja una zona con botón y nombre del fichero: mismo aspecto
 * en todos los navegadores y en español, en lugar del «Choose File» del sistema.
 */
export function FileUploadField({
  label,
  helper,
  className = "",
  id,
  buttonLabel = "Seleccionar archivo",
  emptyLabel = "Ningún archivo seleccionado",
  nombreCargado = null,
  onChange,
  ...inputProps
}: FileUploadFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = helper ? `${inputId}-helper` : undefined;
  const [fileName, setFileName] = useState<string | null>(nombreCargado);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    /* Con `multiple`, los nombres de todos: un extracto que el banco corta en varios ficheros se carga de una vez. */
    const names = Array.from(event.target.files ?? []).map((file) => file.name);
    setFileName(names.length > 0 ? names.join(" + ") : null);
    onChange?.(event);
  }

  return (
    <div className={`ui-file-upload ${className}`.trim()}>
      <label className="ui-field-label" htmlFor={inputId}>
        {label}
      </label>
      <div className={`ui-file-upload__control${fileName ? " has-file" : ""}`}>
        <input
          {...inputProps}
          id={inputId}
          type="file"
          className="ui-file-upload__input"
          aria-describedby={helperId}
          onChange={handleChange}
        />
        <span className="ui-file-upload__button" aria-hidden="true">
          {UPLOAD_ICON}
          {buttonLabel}
        </span>
        <span className="ui-file-upload__name">{fileName ?? emptyLabel}</span>
      </div>
      {helper ? (
        <span id={helperId} className="ui-file-upload__helper">
          {helper}
        </span>
      ) : null}
    </div>
  );
}
