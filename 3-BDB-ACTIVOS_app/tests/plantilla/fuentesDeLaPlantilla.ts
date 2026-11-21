/**
 * Las seis fuentes de la plantilla (Fraunces y Roboto Flex desde el 14-11-2026), abiertas con fontkit (viene con @react-pdf y no trae tipos: se declaran aquí, solo
 * lo que usan las pruebas).
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export interface FuenteAbierta {
  type: string;
  postscriptName: string;
  "OS/2": { usWeightClass: number };
  hasGlyphForCodePoint(punto: number): boolean;
  glyphForCodePoint(punto: number): { advanceWidth: number };
  unitsPerEm: number;
}

const require = createRequire(import.meta.url);
const fontkit = require("fontkit") as { openSync(ruta: string): FuenteAbierta };

/** Los ficheros de fuente de la plantilla. (El nombre se queda de cuando eran WOFF: hoy son los TTF del papel de antes.) */
export const WOFF_DE_LA_PLANTILLA = ["Fraunces-Light.ttf", "Fraunces-Regular.ttf", "Fraunces-SemiBold.ttf", "RobotoFlex-400.ttf", "RobotoFlex-500.ttf", "RobotoFlex-600.ttf"] as const;

/** Los de Roboto Flex, la letra de las cifras en columna: sus cifras tienen todas el mismo ancho. */
export const SANS_DE_LA_PLANTILLA = ["RobotoFlex-400.ttf", "RobotoFlex-500.ttf", "RobotoFlex-600.ttf"] as const;

export function abrirFuente(fichero: string): FuenteAbierta {
  return fontkit.openSync(fileURLToPath(new URL(`../../src/assets/fonts/${fichero}`, import.meta.url)));
}
