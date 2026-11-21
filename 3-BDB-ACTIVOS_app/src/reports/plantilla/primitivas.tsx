/* eslint-disable react-refresh/only-export-components */
/**
 * La letra de la plantilla: `Texto`, que sanea lo que imprime y no parte palabras con guiones de sílaba. Todas las
 * piezas escriben con él.
 */
import { StyleSheet, Text } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { FUENTE } from "./fuentes";
import { MEDIDAS, PAPEL } from "./tema";
import { sanearTexto } from "./texto";

type UnEstilo = Parameters<typeof StyleSheet.create>[0][string];
export type Estilo = UnEstilo | UnEstilo[];

/* Sin guiones de sílaba: lo que escribe el asesor se imprime tal cual. Solo se parte una palabra que no cabría en ninguna línea. */
const sinPartir = (palabra: string) => (palabra.length > 60 ? palabra.match(/.{1,60}/g) ?? [palabra] : [palabra]);

/** Sanea las cadenas de unos hijos de texto; deja pasar los demás (otros `Texto` dentro de un párrafo). */
function saneados(hijos: ReactNode): ReactNode {
  if (typeof hijos === "string") return sanearTexto(hijos);
  if (Array.isArray(hijos)) return hijos.map((hijo) => (typeof hijo === "string" ? sanearTexto(hijo) : hijo));
  return hijos;
}

/**
 * Un texto de la plantilla. Admite una cadena o, para un párrafo con una palabra en seminegrita, varios `Texto`
 * anidados.
 */
export function Texto({ children, style, fixed }: { children: ReactNode; style?: Estilo; fixed?: boolean }) {
  return (
    <Text hyphenationCallback={sinPartir} style={style} fixed={fixed}>
      {saneados(children)}
    </Text>
  );
}

export const estilosBase = StyleSheet.create({
  /* Sin lineHeight en la página: rompe el pie fijo al recomponer (`tests/pdfPagination.test.tsx`). */
  /* El texto corrido en la tinta secundaria, como en el papel de antes (5,9:1). */
  parrafo: { fontSize: MEDIDAS.cuerpo.letra, lineHeight: MEDIDAS.cuerpo.interlineado, color: PAPEL.tinta2, marginTop: 5 },
  fuerte: { fontWeight: 600, color: PAPEL.tinta },
  serifa: { fontFamily: FUENTE.serifa }
});
