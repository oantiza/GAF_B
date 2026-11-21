import type { MouseEvent, ReactNode } from "react";
import { useAbrirFicha } from "../../app/AbrirFichaContext";
import { pathForAsset } from "../../app/appRoutes";

/**
 * El nombre de un instrumento, que lleva a su ficha. Es un enlace de verdad: se enfoca con el
 * tabulador, se abre con Intro, y con Ctrl o el botón central se abre en otra pestaña o se copia su
 * dirección. Un clic normal no recarga la aplicación.
 *
 * Detiene la propagación porque suele vivir en una fila pulsable: sin eso, Ctrl+clic abriría la
 * pestaña nueva y, además, se llevaría esta a la ficha.
 *
 * ```tsx
 * <EnlaceAFicha isin={activo.isin}>{activo.display_name}</EnlaceAFicha>
 * ```
 */
export function EnlaceAFicha({
  isin,
  children,
  alAbrir
}: {
  isin: string;
  children: ReactNode;
  /** Quien necesita hacer algo antes de abrirla, como anotar por dónde iba. */
  alAbrir?: () => void;
}) {
  const abrirFicha = useAbrirFicha();
  const abrir = alAbrir ?? (abrirFicha ? () => abrirFicha(isin) : undefined);

  const alPulsar = (evento: MouseEvent<HTMLAnchorElement>) => {
    evento.stopPropagation();
    /* Lo que pide otra pestaña, otra ventana o una descarga lo resuelve el navegador. */
    if (!abrir || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault();
    abrir();
  };

  return (
    <a className="enlace-a-ficha" href={pathForAsset(isin)} onClick={alPulsar}>
      {children}
    </a>
  );
}
