/**
 * El Modo cliente, mirado en el navegador: lo que el asesor enseña en su pantalla no puede dejar ver nada reservado a él.
 *
 * Lo comprobaba `auditInterfaz.mjs` (`npm run audit:ui`, auditoría del 16-10-2026, ALTA-14), que desde que la aplicación
 * pide acceso no entraba y medía la pantalla de acceso en todas las rutas. El 19-11-2026 pasó aquí, al recorrido
 * (`auditoriaFrontend.mjs`), y aquella se retiró. Las pruebas de `tests/clientModeReport.test.tsx` miran lo mismo
 * componente a componente; esto lo mira con la página entera montada: barra, menú y paneles.
 *
 * Lo que se dejó de vigilar al retirarla, y conviene saber: ella medía el Modo cliente y un contraste propio en los
 * seis anchos, y salía con código 1 ante cualquier hallazgo. El recorrido mide el Modo cliente en los anchos que se le
 * pidan, pasa axe-core en uno solo salvo con `AUDIT_AXE=todos`, y es un informe que hay que leer: solo sale con código
 * 1 cuando la pasada no midió lo que dice o cuando en Modo cliente la página lleva algo del asesor
 * (`informeDelRecorrido.mjs`).
 */

/** La clave del almacenamiento del navegador donde la aplicación guarda el modo (`src/app/ClientModeContext.tsx`). */
export const CLAVE_DEL_MODO_CLIENTE = "bdb-activos.client-mode.v1";

/**
 * Lo que no puede leerse en Modo cliente, con el fichero que lo pinta. Cada palabra tiene que existir hoy en ese
 * fichero, fuera de los comentarios —si no, vigila algo que no puede salir nunca—, y lo comprueba
 * `tests/herramientasDeCaptura.test.ts`: el 19-11-2026 cuatro de las once de la lista de entonces ya no estaban en
 * ninguna pantalla, otras tres vivían en pantallas que no se medían en este modo, y dos no salían con la cartera de
 * muestra. Dónde vive cada una se midió ese día con una sonda: en modo asesor se leen todas en su pantalla, y en Modo
 * cliente, ninguna.
 * «etrocesi» caza «retrocesión», «retrocesiones» y «Retrocesiones» de una vez.
 */
export const PALABRAS_DEL_ASESOR = [
  { palabra: "Informe interno del asesor", vive: "src/components/PortfolioReport.tsx" },
  { palabra: "Propuesta de mejora", vive: "src/components/PortfolioReport.tsx" },
  { palabra: "etrocesi", vive: "src/components/PortfolioReport.tsx" },
  { palabra: "Métricas por posición", vive: "src/components/OptimizationPreviewPanel.tsx" },
  { palabra: "Avisos de calidad", vive: "src/components/OptimizationPreviewPanel.tsx" },
  { palabra: "Avisos de cartera", vive: "src/components/OptimizationPreviewPanel.tsx" },
  { palabra: "Señales de datos", vive: "src/components/PortfolioXray.tsx" },
  { palabra: "Datos enriquecidos", vive: "src/components/PortfolioDataDiagnostic.tsx" }
];

/**
 * La marca con que la aplicación señala lo que solo ve el asesor: el distintivo «Interno» (`Distintivo`, tono
 * `interno`). En Modo cliente no puede quedar ninguno en la página, diga lo que diga el bloque que lo lleva.
 */
export const MARCA_DE_INTERNO = ".distintivo--interno";

/**
 * Dentro de la página: si el interruptor de Modo cliente quedó encendido, qué palabras del asesor hay, cuántos
 * distintivos «Interno» quedan y si se lee lo que la pantalla tiene que enseñar. Se pasa a `page.evaluate`, así que no
 * puede usar nada de fuera: el interruptor le llega por su selector, que es el de `entrarEnLaApp.mjs`.
 *
 * Las palabras se buscan en todo el texto que la página lleva dentro, se vea o no: un panel plegado tiene su cuerpo
 * oculto, y el asesor lo abre de un clic delante del cliente. Lo que tiene que leerse, en cambio, se busca en lo que
 * se ve: si no está, la pantalla no llegó a pintarse y no se ha medido nada.
 */
export function comprobarModoCliente({ palabras, debeLeerse, marcaDeInterno, interruptor }) {
  const raiz = document.getElementById("root");
  const todoElTexto = raiz?.textContent ?? "";
  const loQueSeVe = raiz?.innerText ?? "";
  return {
    activo: (interruptor ? document.querySelector(interruptor) : null)?.getAttribute("aria-checked") === "true",
    fugas: palabras.filter((palabra) => todoElTexto.includes(palabra)),
    internos: marcaDeInterno && raiz ? raiz.querySelectorAll(marcaDeInterno).length : 0,
    seLee: !debeLeerse || loQueSeVe.includes(debeLeerse),
    debeLeerse: debeLeerse ?? ""
  };
}

/** Lo que se dice de una pantalla medida en Modo cliente, o nada si está como debe. */
export function fallosDelModoCliente(comprobacion) {
  if (!comprobacion) return [];
  const fallos = comprobacion.fugas.map((palabra) => `en Modo cliente se lee «${palabra}»`);
  if (comprobacion.internos) fallos.push(`en Modo cliente ${comprobacion.internos === 1 ? "queda 1 distintivo" : `quedan ${comprobacion.internos} distintivos`} «Interno»`);
  if (!comprobacion.seLee) fallos.unshift(`no se lee «${comprobacion.debeLeerse}»: la pantalla no llegó a pintarse y no se midió lo que ve el cliente`);
  if (!comprobacion.activo) fallos.unshift("el Modo cliente no quedó encendido: no se midió lo que ve el cliente");
  return fallos;
}
