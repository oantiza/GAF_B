/**
 * El muestrario de las piezas comunes: una página solo de desarrollo, fuera de la aplicación (`/muestrario.html`
 * con el servidor de desarrollo). Enseña cada pieza en todos sus estados con datos de ejemplo, para revisar el
 * sistema de un vistazo y para fotografiarlo. No se enlaza desde el menú ni entra en la compilación: Vite solo compila
 * `index.html`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/layout.css";
import "../styles/components.css";
import { Muestrario } from "./Muestrario";

createRoot(document.getElementById("muestrario")!).render(
  <StrictMode>
    <Muestrario />
  </StrictMode>
);
