/**
 * Lo que el documento reparte a sus piezas: el tema, la identidad del asesor, qué documento es y para quién, y la
 * advertencia del pie; y lo que cada hoja reparte a lo suyo: si va apaisada y su ancho útil.
 *
 * Van por contexto de React, que @react-pdf propaga como cualquier árbol (lo comprueba `tests/plantilla/piezas.test.tsx`).
 * Una advertencia: lo que devuelve una función `render` de @react-pdf (el número de página) se compone fuera del árbol,
 * así que dentro de un `render` no se lee contexto; las piezas lo leen antes y le pasan los valores ya resueltos.
 */
import { createContext, useContext } from "react";
import { ADVERTENCIA_DEL_PIE } from "./avisoLegal";
import { anchoUtil, type TemaDeInforme } from "./tema";

/** Quién firma el documento. Todo es opcional: lo que falte no se inventa. */
export interface IdentidadDelAsesor {
  nombre?: string;
  entidad?: string;
  /** Un correo o un teléfono. */
  contacto?: string;
  /** El logotipo, en *data URL* PNG o JPEG. Cualquier otra cosa no se imprime. */
  logotipo?: string;
}

export interface ContextoDelInforme {
  tema: TemaDeInforme;
  identidad: IdentidadDelAsesor;
  /** Qué documento es: «Informe de cartera». */
  documento: string;
  /** Para quién es, en el de cliente: «Familia García». */
  destinatario?: string;
  advertencia: string;
}

export const ContextoDeInforme = createContext<ContextoDelInforme>({
  tema: "cliente",
  identidad: {},
  documento: "Informe",
  advertencia: ADVERTENCIA_DEL_PIE
});

export interface ContextoDeLaHoja {
  apaisada: boolean;
  /** De margen a margen, en puntos. */
  ancho: number;
}

export const ContextoDeHoja = createContext<ContextoDeLaHoja>({ apaisada: false, ancho: anchoUtil(false) });

export const useInforme = () => useContext(ContextoDeInforme);
export const useHoja = () => useContext(ContextoDeHoja);

/** La identidad sin espacios sobrantes y sin campos vacíos. */
export function identidadLimpia(identidad: IdentidadDelAsesor | undefined): IdentidadDelAsesor {
  const limpio = (valor: string | undefined) => (valor && valor.trim() ? valor.trim() : undefined);
  const logotipo = identidad?.logotipo && /^data:image\/(png|jpe?g);base64,/i.test(identidad.logotipo) ? identidad.logotipo : undefined;
  return { nombre: limpio(identidad?.nombre), entidad: limpio(identidad?.entidad), contacto: limpio(identidad?.contacto), logotipo };
}
