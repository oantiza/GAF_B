/**
 * Markdown editorial (react-markdown + remark-gfm).
 *
 * No lleva estilos propios: se apoya en la clase `.prose` del sistema, de modo
 * que el informe de estrategia y cualquier texto largo comparten exactamente el
 * mismo ritmo tipográfico que el resto de la aplicación.
 */

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

type NivelDeEncabezado = 2 | 3 | 4;

const ETIQUETAS = ["h2", "h3", "h4", "h5", "h6"] as const;

/** Lo que este fichero necesita saber de un nodo del árbol de Markdown. */
interface NodoDeMarkdown {
  type: string;
  depth?: number;
  children?: NodoDeMarkdown[];
  data?: { hProperties?: Record<string, unknown> };
}

function titulosDe(nodo: NodoDeMarkdown, hallados: NodoDeMarkdown[] = []): NodoDeMarkdown[] {
  if (nodo.type === "heading") hallados.push(nodo);
  for (const hijo of nodo.children ?? []) titulosDe(hijo, hallados);
  return hallados;
}

/**
 * El título más alto del documento pasa a ser de primer nivel, y los demás suben con él. Un informe escrito todo con
 * `###` (el de estrategia: así se lo pide el prompt al modelo) queda con títulos de primer nivel, que son los que toman
 * `nivel`. Sin esto sus títulos caían al fondo de la escalera: salían como `h6`, a dos tercios del tamaño del texto que
 * encabezaban, y el esquema saltaba del título del bloque a un sexto nivel.
 */
function tituloMasAltoArriba() {
  return (arbol: NodoDeMarkdown) => {
    const titulos = titulosDe(arbol);
    if (titulos.length === 0) return;
    const masAlto = Math.min(...titulos.map((titulo) => titulo.depth ?? 1));
    if (masAlto <= 1) return;
    for (const titulo of titulos) titulo.depth = (titulo.depth ?? 1) - masAlto + 1;
  };
}

/**
 * Numera las tablas del documento, en su orden. La caja de cada una se enfoca y dice qué es (más abajo), y con el
 * número no se llaman todas igual: un informe de estrategia lleva varias.
 */
function tablasNumeradas() {
  return (arbol: NodoDeMarkdown) => {
    let orden = 0;
    const visitar = (nodo: NodoDeMarkdown) => {
      if (nodo.type === "table") {
        orden += 1;
        nodo.data = { ...nodo.data, hProperties: { ...nodo.data?.hProperties, "data-orden": orden } };
      }
      for (const hijo of nodo.children ?? []) visitar(hijo);
    };
    visitar(arbol);
  };
}

/**
 * El documento se inserta en una página que ya tiene su propio título: los encabezados del markdown bajan para no
 * competir con él. `nivel` es el que toma el título más alto del documento; por defecto, `h2`. Dentro de un bloque,
 * cuyo título es `h2` (el informe de estrategia, la lectura de una propuesta), `3`, para que el esquema no se salte
 * ningún nivel. Cada nivel del documento baja un escalón más, sin pasar de `h6`.
 */
function componentesDesde(nivel: NivelDeEncabezado): Components {
  const etiqueta = (profundidad: number) => ETIQUETAS[Math.min(ETIQUETAS.length - 1, nivel - 2 + profundidad - 1)];
  const H1 = etiqueta(1);
  const H2 = etiqueta(2);
  const H3 = etiqueta(3);
  const H4 = etiqueta(4);
  const H5 = etiqueta(5);
  const H6 = etiqueta(6);
  return {
    h1: ({ children }) => <H1>{children}</H1>,
    h2: ({ children }) => <H2>{children}</H2>,
    h3: ({ children }) => <H3>{children}</H3>,
    h4: ({ children }) => <H4>{children}</H4>,
    h5: ({ children }) => <H5>{children}</H5>,
    h6: ({ children }) => <H6>{children}</H6>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    /* La tabla de un texto puede no caber: su caja se desplaza de lado, se enfoca y dice qué es, como el marco de la
       pieza de tablas (apartado 14.7 del sistema). El número se lo pone `tablasNumeradas`. */
    table: ({ children, node }) => {
      const orden = node?.properties?.["data-orden"];
      const cual = orden ? `Tabla ${orden}` : "Tabla";
      return (
        <div aria-label={`${cual} del texto (tabla desplazable)`} className="table-wrap" role="group" tabIndex={0}>
          <table>{children}</table>
        </div>
      );
    }
  };
}

const COMPONENTES: Record<NivelDeEncabezado, Components> = {
  2: componentesDesde(2),
  3: componentesDesde(3),
  4: componentesDesde(4)
};

const COMPLEMENTOS = [remarkGfm, tituloMasAltoArriba, tablasNumeradas];

export function MarkdownView({ children, nivel = 2 }: { children: string; nivel?: NivelDeEncabezado }) {
  return (
    <div className="prose">
      <Markdown remarkPlugins={COMPLEMENTOS} components={COMPONENTES[nivel]}>
        {children}
      </Markdown>
    </div>
  );
}
