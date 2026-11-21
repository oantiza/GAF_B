import type { MouseEvent } from "react";

/**
 * «← Planes y EPSV», encima de la cabecera de una ficha o de una comparación: la vuelta a la lista (anatomía de una
 * pantalla, apartado 3 de `SISTEMA_DISENO.md`).
 *
 * Es un enlace de verdad a la lista —la dirección de la sección, sin nada tras el `#`—, así que se puede abrir en otra
 * pestaña o copiar. El clic normal no recarga: vuelve con `alVolver`, que conserva el filtro y lo marcado.
 */
export function EnlaceDeVuelta({ alVolver }: { alVolver: () => void }) {
  const alPulsar = (evento: MouseEvent<HTMLAnchorElement>) => {
    if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault();
    alVolver();
  };
  return (
    <a className="planes-vuelta" href={window.location.pathname} onClick={alPulsar}>
      <span aria-hidden="true">←</span> Planes y EPSV
    </a>
  );
}
