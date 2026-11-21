import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { leerCifraTecleada } from "../../core/cifraTecleada";

/* Ola D2 (D2.1): useGrouping "always" — sin él, es-ES no agrupa los millares
   de cuatro cifras y la columna de importes alternaba «8000 €» con «24.000 €»
   (fmtEur ya lo hacía; el input era la excepción visible en el Constructor). */
const euroDisplayFormat = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 2,
  useGrouping: "always" as Intl.NumberFormatOptions["useGrouping"]
});

const INVALID_NOTE = "Cifra no válida: escríbela con números, por ejemplo 25.000";


interface EuroAmountInputProps {
  /** `null` = campo vacío: muestra el `placeholder` hasta que se confirme un importe. */
  value: number | null;
  /** Se llama UNA vez al confirmar (blur o Enter), nunca por tecla. */
  onCommit: (value: number) => void;
  /**
   * Teclear la cifra que ya había también confirma. Es para un valor que hoy es de ejemplo: escribir
   * «100.000» sobre unos 100.000 € de ejemplo es declararlos. Entrar y salir del campo sin teclear no
   * confirma nada: fijaría los de ejemplo sin que nadie los haya declarado (F-04).
   */
  confirmarLaMismaCifra?: boolean;
  min?: number;
  /** La frase de cifra no válida, si el campo no es de euros. */
  notaDeError?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  /** El id del campo, para que lo nombre su rótulo. Lo pone la pieza `Campo`. */
  id?: string;
  /** La pista y el error de fuera, que `Campo` enlaza. La nota de cifra no válida se añade detrás. */
  "aria-describedby"?: string;
  /** El error de fuera (`Campo`). Una cifra que no se puede leer lo marca igual. */
  "aria-invalid"?: boolean | "true" | "false";
}

/**
 * Campo de importe en euros con convención española (revisión 12-08).
 *
 * Sustituye a los `input[type=number]` de importes, que tenían dos vicios:
 * el navegador rechazaba los puntos de miles («20.000» se quedaba en 20 o en
 * nada según el motor), y cada tecla propagaba el cambio al estado global
 * (re-render de toda la página por pulsación: escribir era ir «uno a uno»).
 *
 * Aquí el borrador es local: muestra «250.000» formateado; al enfocar se
 * selecciona el texto tal cual (sin re-pintado, así la selección no pierde
 * carreras con el teclado) y teclear lo reemplaza; acepta «20.000», «20000»
 * o «20000,50» (el lector de la cifra tecleada, FMT-20) y confirma en blur/Enter.
 * Escape descarta la edición.
 */
export function EuroAmountInput({
  value,
  onCommit,
  confirmarLaMismaCifra = false,
  min = 0,
  notaDeError = INVALID_NOTE,
  ariaLabel,
  className,
  disabled,
  placeholder,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalidoDeFuera
}: EuroAmountInputProps) {
  // null = sin edición en curso: se muestra el valor formateado.
  const [draft, setDraft] = useState<string | null>(null);
  // N3-08 (cuarta pasada): una cifra que no se puede leer («25k») no se
  // descarta en silencio: se queda en el campo, marcada como no válida.
  const [invalid, setInvalid] = useState(false);
  // R4-13 (quinta pasada): si el importe cambia desde fuera (otra cartera, el
  // capital de un extracto), una cifra marcada como no válida deja de tapar el
  // importe nuevo; se descarta, como al pulsar Escape. Patrón de React para
  // ajustar el estado cuando cambia una prop, sin efecto. `Object.is` y no
  // `!==`: con un NaN, `!==` siempre es cierto y el render entraba en bucle (M1).
  const [shownValue, setShownValue] = useState(value);
  if (!Object.is(shownValue, value)) {
    setShownValue(value);
    if (invalid) {
      setDraft(null);
      setInvalid(false);
    }
  }
  const noteId = useId();
  // El select() del focus es síncrono; el mouseup posterior del mismo click
  // lo desharía, así que se anula una única vez.
  const keepSelectionOnMouseUp = useRef(false);
  // Si se ha tecleado desde que se entró en el campo. El foco solo no cuenta.
  const tecleado = useRef(false);
  // El Intro ya ha confirmado: el blur que viene detrás no vuelve a hacerlo con el borrador de antes.
  const confirmadoConIntro = useRef(false);

  function commit() {
    if (draft === null) {
      return;
    }
    if (draft.trim() === "") {
      // Entrada vacía: se conserva el valor anterior.
      setDraft(null);
      setInvalid(false);
      return;
    }
    /* FMT-20: el lector único de la cifra tecleada (`cifraTecleada.ts`), no el de los ficheros del banco. */
    const parsed = leerCifraTecleada(draft);
    /* Por debajo del mínimo tampoco se lee: «-500» se convertía en 0 € y quedaba fijado como capital real. */
    if (parsed === undefined || parsed < min) {
      setInvalid(true);
      return;
    }
    setDraft(null);
    setInvalid(false);
    const next = parsed;
    const huboTecleo = tecleado.current;
    tecleado.current = false;
    if (next !== value || (confirmarLaMismaCifra && huboTecleo)) {
      onCommit(next);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      /* La misma pulsación no sigue: si confirmar abre un diálogo con el foco en «Aceptar», la pulsaría sin que
         nadie hubiera leído la pregunta. */
      event.preventDefault();
      commit();
      confirmadoConIntro.current = true;
      event.currentTarget.blur();
      confirmadoConIntro.current = false;
    } else if (event.key === "Escape") {
      setDraft(null);
      setInvalid(false);
    }
  }

  function handleMouseUp(event: MouseEvent<HTMLInputElement>) {
    if (keepSelectionOnMouseUp.current) {
      event.preventDefault();
      keepSelectionOnMouseUp.current = false;
    }
  }

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        className={invalid ? [className, "is-invalid"].filter(Boolean).join(" ") : className}
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || invalidoDeFuera || undefined}
        aria-describedby={[describedBy, invalid ? noteId : undefined].filter(Boolean).join(" ") || undefined}
        title={invalid ? notaDeError : undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={draft ?? (value === null ? "" : value === 0 ? "0" : euroDisplayFormat.format(value))}
        onFocus={(event) => {
          // El borrador arranca del texto YA visible: el value no cambia en el
          // focus, no hay re-pintado y la selección síncrona es estable.
          setDraft(event.currentTarget.value);
          tecleado.current = false;
          keepSelectionOnMouseUp.current = true;
          event.currentTarget.select();
        }}
        onMouseUp={handleMouseUp}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
          tecleado.current = true;
        }}
        onBlur={() => {
          keepSelectionOnMouseUp.current = false;
          if (!confirmadoConIntro.current) commit();
        }}
        onKeyDown={handleKeyDown}
      />
      {/* MAR-05: la nota se ve junto al campo. Antes iba oculta y en un `title`, que en tableta no existe, y nada en
          pantalla decía que el importe anterior seguía vigente. */}
      {invalid ? (
        <span id={noteId} className="field__error" role="alert">
          {notaDeError}
        </span>
      ) : null}
    </>
  );
}
