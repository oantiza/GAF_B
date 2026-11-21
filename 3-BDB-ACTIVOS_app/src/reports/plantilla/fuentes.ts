/**
 * Las dos tipografías de la plantilla, las del papel de cliente de antes (recuperadas el 14-11-2026, decisión de Óscar):
 * Fraunces en los títulos y en las cifras grandes, en 300, 400 y 600; Roboto Flex en todo lo demás, en 400, 500 y 600. Son
 * los TTF subconjuntados que usaba `clientReportTheme.ts` (commit 8da9cb9d), en `src/assets/fonts/`, con sus licencias
 * (`OFL-Fraunces.txt`, `OFL-RobotoFlex.txt`).
 *
 * Lo comprobado sobre un PDF generado (`tests/plantilla/fuentes.test.tsx`): @react-pdf incrusta el TTF, el texto se extrae,
 * y un documento con varios pesos lleva una cara por peso. Cada fichero se llama por dentro como lo que es («Fraunces-Light»,
 * «Fraunces-Regular», «Fraunces-SemiBold», «RobotoFlex-Regular», «RobotoFlex-Medium», «RobotoFlex-SemiBold»): pdfkit
 * reutiliza una fuente ya incrustada con el mismo nombre PostScript, y dos pesos con el mismo nombre saldrían con una sola
 * cara (decisión A-127).
 *
 * Las cifras de Roboto Flex tienen todas el mismo ancho (las columnas cuadran); las de Fraunces no, y por eso Fraunces solo
 * va en cifras sueltas (tarjetas, totales), nunca en una columna de cifras.
 *
 * Las familias llevan nombres propios («Informe Serif», «Informe Sans»): son las únicas que registra la aplicación.
 */
import { Font } from "@react-pdf/renderer";

export const FUENTE = {
  serifa: "Informe Serif",
  sans: "Informe Sans"
} as const;

/** En el navegador, la dirección del recurso; en Node (las pruebas), la ruta del fichero. */
function origen(url: string): string {
  if (!url.startsWith("file:")) return url;
  return decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
}

const SERIFA_300 = origen(new URL("../../assets/fonts/Fraunces-Light.ttf", import.meta.url).href);
const SERIFA_400 = origen(new URL("../../assets/fonts/Fraunces-Regular.ttf", import.meta.url).href);
const SERIFA_600 = origen(new URL("../../assets/fonts/Fraunces-SemiBold.ttf", import.meta.url).href);
const SANS_400 = origen(new URL("../../assets/fonts/RobotoFlex-400.ttf", import.meta.url).href);
const SANS_500 = origen(new URL("../../assets/fonts/RobotoFlex-500.ttf", import.meta.url).href);
const SANS_600 = origen(new URL("../../assets/fonts/RobotoFlex-600.ttf", import.meta.url).href);

export function registrarFuentes(): void {
  Font.register({
    family: FUENTE.serifa,
    fonts: [
      { src: SERIFA_300, fontWeight: 300 },
      { src: SERIFA_400, fontWeight: 400 },
      { src: SERIFA_600, fontWeight: 600 }
    ]
  });
  Font.register({
    family: FUENTE.sans,
    fonts: [
      { src: SANS_400, fontWeight: 400 },
      { src: SANS_500, fontWeight: 500 },
      { src: SANS_600, fontWeight: 600 }
    ]
  });
}

registrarFuentes();

/**
 * Olvida las dos familias y las vuelve a registrar. Se llama antes de cada documento.
 *
 * El objeto de fuente que @react-pdf guarda entre documentos arrastra estado del primero, y el SEGUNDO PDF de una sesión
 * pierde las letras que el primero no usó («ÁGUILA» sale «GUILA»). Volver a llamar a `Font.register` sin olvidar antes
 * no basta: añade fuentes a la familia en vez de reemplazarlas. Se olvidan solo estas dos familias, no el registro entero
 * (`Font.clear()`): así lo hacía cuando convivía con los papeles de antes, y no hay motivo para cambiarlo.
 */
export function refrescarFuentes(): void {
  const registradas = Font.getRegisteredFonts() as unknown as Record<string, unknown>;
  delete registradas[FUENTE.serifa];
  delete registradas[FUENTE.sans];
  registrarFuentes();
}
