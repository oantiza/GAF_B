import { useId, useState, type KeyboardEvent } from "react";
import { cifraLeida, leerCifraTecleada } from "../core/cifraTecleada";

interface CampoDeCifraAcotadaProps {
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  /** Lo que suben o bajan las flechas del teclado, como en el campo numérico de antes. */
  step: number;
  /** Se llama una vez al confirmar (al salir o con Intro), con una cifra dentro de `min`-`max`. */
  alConfirmar: (valor: number) => void;
  /** Si lo escrito vale. Con una cifra no válida a la vista, no se calcula con la anterior sin decirlo. */
  alCambiarValidez?: (valida: boolean) => void;
  describedBy?: string;
}

/** Lo que dice el campo cuando lo escrito no se aplica: cómo se ha leído, qué se admite y qué sigue valiendo. */
function textoDelError(escrito: string, leida: number | undefined, min: number, max: number, valor: number): string {
  const admite = `Escribe una cifra entre ${cifraLeida(min)} y ${cifraLeida(max)}, con coma decimal.`;
  const lectura = leida === undefined ? `«${escrito.trim()}» no se lee como una cifra.` : `Se ha leído ${cifraLeida(leida)}.`;
  return `${lectura} ${admite} Sigue valiendo ${cifraLeida(valor)}.`;
}

/**
 * DIS-04: un tope de los mandos de Optimizar y de Fondos equivalentes. Antes cada tecla se recortaba al rango: al borrar,
 * el campo vacío valía 0, se convertía en el mínimo y lo siguiente que se tecleaba se le añadía («15» en vez de «5»). Aquí
 * lo escrito es un borrador y se lee al confirmar, como los importes; lo que se sale del rango se marca y no se aplica.
 *
 * FMT-20: es un campo de texto con teclado decimal, no `type="number"`, que dejaba la coma en manos del navegador. Lo
 * escrito se lee con el lector único de la cifra tecleada (`cifraTecleada.ts`): coma decimal y punto de millar opcional.
 * Se enseña cómo se ha leído: la cifra confirmada vuelve al campo escrita en español («12.5» queda «12,5»), y la que no
 * se aplica lo dice en su error («Se ha leído 1.250»). Las flechas del teclado suben y bajan `step`, como antes.
 */
export function CampoDeCifraAcotada({ etiqueta, valor, min, max, step, alConfirmar, alCambiarValidez, describedBy }: CampoDeCifraAcotadaProps) {
  const [borrador, setBorrador] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notaId = useId();

  function marcar(mensaje: string | null) {
    setError(mensaje);
    alCambiarValidez?.(mensaje === null);
  }

  function confirmar() {
    if (borrador === null) return;
    if (borrador.trim() === "") {
      // Vacío: se queda la cifra que había.
      setBorrador(null);
      marcar(null);
      return;
    }
    const cifra = leerCifraTecleada(borrador);
    if (cifra === undefined || cifra < min || cifra > max) {
      marcar(textoDelError(borrador, cifra, min, max, valor));
      return;
    }
    setBorrador(null);
    marcar(null);
    if (cifra !== valor) alConfirmar(cifra);
  }

  /** Las flechas, como en el campo numérico: suben o bajan un paso desde lo escrito, sin salir del rango. */
  function pasoConFlecha(sentido: 1 | -1) {
    const desde = borrador === null ? valor : leerCifraTecleada(borrador);
    if (desde === undefined) return;
    const siguiente = Math.min(max, Math.max(min, Number((desde + sentido * step).toFixed(10))));
    setBorrador(cifraLeida(siguiente));
  }

  function alPulsar(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmar();
    } else if (event.key === "Escape") {
      setBorrador(null);
      marcar(null);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      pasoConFlecha(event.key === "ArrowUp" ? 1 : -1);
    }
  }

  const descrito = [describedBy, error ? notaId : null].filter(Boolean).join(" ");
  return (
    <label className="optimizer-num">
      <span>{etiqueta}</span>
      <input
        type="text"
        inputMode="decimal"
        lang="es"
        value={borrador ?? cifraLeida(valor)}
        aria-invalid={error ? true : undefined}
        aria-describedby={descrito || undefined}
        onChange={(event) => setBorrador(event.target.value)}
        onBlur={confirmar}
        onKeyDown={alPulsar}
      />
      {error ? (
        <span className="field__error" id={notaId} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
