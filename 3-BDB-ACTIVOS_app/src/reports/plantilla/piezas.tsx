/* eslint-disable react-refresh/only-export-components */
/**
 * Las piezas de texto de la plantilla, con el aspecto del papel de cliente de antes: la presentación de la primera hoja (título
 * grande en Fraunces), las tarjetas de cifras (caja gris muy clara, rótulo pequeño y la cifra grande en Fraunces), el título de
 * sección, el párrafo, la nota con su filete lateral, el aviso y la rejilla de datos. Ninguna lleva bandas ni rellenos de color:
 * el color del tema va en filetes, en los números de sección y en los totales.
 *
 * Las cifras llegan ya escritas por `src/core/formato.ts` (con su signo, su espacio duro y su menos tipográfico). Una
 * cifra que falta llega como `null` y se escribe con su frase de ausencia (`src/core/textoDeAusencia.ts`).
 */
import { StyleSheet, View } from "@react-pdf/renderer";
import type { ClaseDeAusencia } from "../../types/fichaInstrumento";
import { textoDeAusencia } from "../../core/textoDeAusencia";
import { AVISO_LEGAL } from "./avisoLegal";
import { useInforme } from "./contexto";
import { FUENTE } from "./fuentes";
import { Texto, estilosBase } from "./primitivas";
import { MEDIDAS, PAPEL, TEMAS, colorDelSigno } from "./tema";

const M = MEDIDAS;

const s = StyleSheet.create({
  contexto: { fontSize: M.presentacion.contexto, fontWeight: 500, letterSpacing: 0.6, lineHeight: 1.35 },
  titulo: { fontFamily: FUENTE.serifa, fontWeight: 300, fontSize: M.presentacion.titulo, lineHeight: 1.08, marginTop: 8, color: PAPEL.tinta },
  entradilla: { fontSize: M.presentacion.entradilla, color: PAPEL.tinta2, lineHeight: 1.45, marginTop: 8 },
  fileteCorto: { width: 60, height: 1.5, marginTop: 14, marginBottom: 4 },
  tarjetas: { flexDirection: "row", flexWrap: "wrap", marginTop: 12 },
  tarjeta: { borderWidth: 0.55, borderColor: PAPEL.filete, borderRadius: 3, backgroundColor: PAPEL.fondo, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8 },
  guion: { width: 20, height: 2, marginBottom: 6 },
  rotulo: { fontSize: M.cifras.rotulo + 0.5, fontWeight: 500, letterSpacing: 0.3, color: PAPEL.tinta2, lineHeight: 1.25 },
  valor: { fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: M.cifras.cifra, lineHeight: 1.15, marginTop: 6 },
  valorPrincipal: { fontSize: M.cifras.principal },
  valorAusente: { fontSize: M.cifras.ausencia, fontFamily: FUENTE.sans, fontWeight: 400, color: PAPEL.tinta3, lineHeight: 1.25, marginTop: 10, marginBottom: 3 },
  apunte: { fontSize: M.cifras.apunte, color: PAPEL.tinta3, lineHeight: 1.3, marginTop: 4 },
  seccion: { marginTop: M.seccion.aireEncima, paddingTop: 10, borderTopWidth: 0.65, borderTopColor: PAPEL.filete },
  tituloDeSeccion: { fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: M.seccion.titulo, lineHeight: 1.2, color: PAPEL.tinta },
  tituloDeHoja: { fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: M.seccion.pagina, lineHeight: 1.12, color: PAPEL.tinta },
  numero: { fontFamily: FUENTE.serifa, fontWeight: 300 },
  reglaDeHoja: { height: M.seccion.filete, backgroundColor: PAPEL.filete, marginTop: 9 },
  procedencia: { fontSize: M.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.4, marginTop: 4 },
  procedenciaDeHoja: { fontSize: 8.5, color: PAPEL.tinta2, lineHeight: 1.45, marginTop: 9 },
  nota: { marginTop: 9, borderLeftWidth: M.nota.filete, paddingLeft: M.nota.sangria, paddingVertical: 1 },
  textoDeNota: { fontSize: M.nota.letra, lineHeight: M.nota.interlineado, color: PAPEL.tinta2 },
  rejilla: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  dato: { borderTopWidth: 0.55, borderTopColor: PAPEL.rejilla, paddingTop: 5, paddingRight: 12, paddingBottom: 8 },
  datoRotulo: { fontSize: 7, fontWeight: 500, letterSpacing: 0.5, lineHeight: 1.3 },
  datoValor: { fontSize: M.cuerpo.letra, lineHeight: 1.3, marginTop: 3, color: PAPEL.tinta },
  datoAusente: { fontSize: M.seccion.procedencia, color: PAPEL.tinta3, lineHeight: 1.3, marginTop: 3 },
  legal: { fontSize: 7, color: PAPEL.tinta3, lineHeight: 1.5, marginTop: 13.5 }
});

/** El texto de lo que falta: la frase de su clase o un motivo escrito. */
export function textoDelMotivo(motivo: ClaseDeAusencia | string | undefined): string {
  if (motivo === undefined) return textoDeAusencia("falta");
  return motivo === "falta" || motivo === "no-aplica" || motivo === "sin-pedir" ? textoDeAusencia(motivo) : motivo;
}

/* ------------------------------------------------------------------------------------------------ Rejilla */

export interface DatoDeRejilla {
  rotulo: string;
  /** El valor ya escrito. `null`: falta, y se escribe su motivo. */
  valor: string | null;
  /** Por qué falta: una clase de ausencia o una frase. Por defecto, «Falta el dato». */
  motivo?: ClaseDeAusencia | string;
}

/** Pares de rótulo y valor en columnas: el rótulo pequeño, en el tono del tema; el valor debajo, en tinta. */
export function Rejilla({ datos, columnas = 4 }: { datos: readonly DatoDeRejilla[]; columnas?: number }) {
  const { tema } = useInforme();
  const ancho = `${100 / Math.max(1, columnas)}%`;
  return (
    <View style={s.rejilla}>
      {datos.map((dato, i) => (
        <View key={`${dato.rotulo}-${i}`} style={[s.dato, { width: ancho }]} wrap={false}>
          <Texto style={[s.datoRotulo, { color: TEMAS[tema].tono }]}>{dato.rotulo}</Texto>
          {dato.valor !== null ? <Texto style={s.datoValor}>{dato.valor}</Texto> : <Texto style={s.datoAusente}>{textoDelMotivo(dato.motivo)}</Texto>}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ Presentación */

/**
 * Lo primero de la primera hoja de un documento sin portada, como abrían los papeles de cliente de antes: la línea de contexto
 * (cliente o cartera · periodo · «datos a …») en el tono del tema, el título grande en Fraunces, una entradilla si se quiere, un
 * filete corto del color del tema y una rejilla corta («Preparado para», «Elaborado por», «Fecha», «Perfil»).
 */
export function Presentacion({ contexto, titulo, entradilla, datos }: { contexto?: string | readonly string[]; titulo: string; entradilla?: string; datos?: readonly DatoDeRejilla[] }) {
  const { tema } = useInforme();
  const linea = typeof contexto === "string" ? contexto : contexto?.filter(Boolean).join(" · ");
  return (
    <View>
      {linea ? <Texto style={[s.contexto, { color: TEMAS[tema].tono }]}>{linea}</Texto> : null}
      <Texto style={s.titulo}>{titulo}</Texto>
      {entradilla ? <Texto style={s.entradilla}>{entradilla}</Texto> : null}
      <View style={[s.fileteCorto, { backgroundColor: TEMAS[tema].color }]} />
      {datos && datos.length > 0 ? (
        <View style={{ marginBottom: 4 }}>
          <Rejilla datos={datos} columnas={Math.min(4, datos.length)} />
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ Tarjetas de cifras */

export interface CifraDestacada {
  rotulo: string;
  /** La cifra ya escrita («201.298 €», «+10,39 %»). `null`: falta, y se escribe su frase de ausencia, más pequeña. */
  cifra: string | null;
  /** Una línea bajo la cifra: «a 13/11/2026», «su referencia, +13,88 %». */
  apunte?: string;
  /** La cifra que contesta el documento: más grande, y su tarjeta más ancha. Una como mucho. */
  principal?: boolean;
  /** Verde o rojo, para un resultado o una rentabilidad. El signo va escrito en la cifra; el color lo refuerza. */
  signo?: "sube" | "baja" | "neutro" | null;
  /** Por qué falta, si falta. Por defecto, «Falta el dato». */
  motivo?: ClaseDeAusencia | string;
  /** El color de su categoría, en el guion de encima del rótulo (una tarjeta de un reparto). La cifra sigue en tinta. */
  color?: string;
}

/** Las líneas que reserva el rótulo en una fila de tarjetas: dos si alguno es largo (más de 24 letras), una si no. */
const lineasDeLaFila = (fila: readonly CifraDestacada[]) => (fila.some((dato) => dato.rotulo.length > 24) ? 2 : 1);

/**
 * Tarjetas de cifras, como las del papel de antes: una caja gris muy clara con su borde fino, el rótulo pequeño y la cifra grande
 * en Fraunces. La cifra con signo, en verde o rojo; las demás, en tinta. Con `columnas`, las tarjetas van en rejilla (las cuatro
 * de un reparto, de dos en dos); sin ellas, todas en una fila.
 */
export function CifrasDestacadas({ cifras, columnas }: { cifras: readonly CifraDestacada[]; columnas?: number }) {
  const porFila = columnas ?? cifras.length;
  const separacion = M.cifras.separacion;
  const filas: CifraDestacada[][] = [];
  for (let i = 0; i < cifras.length; i += Math.max(1, porFila)) filas.push(cifras.slice(i, i + Math.max(1, porFila)));
  return (
    <View style={{ marginTop: 12 }} wrap={false}>
      {filas.map((fila, f) => (
        <View key={f} style={{ flexDirection: "row", marginTop: f === 0 ? 0 : separacion }}>
          {fila.map((dato, i) => (
            <View
              key={`${dato.rotulo}-${i}`}
              style={[s.tarjeta, { flex: dato.principal ? 1.3 : 1, marginRight: i === porFila - 1 ? 0 : separacion }]}
            >
              {dato.color ? <View style={[s.guion, { backgroundColor: dato.color }]} /> : null}
              {/* Si algún rótulo de la fila va en dos líneas, todos reservan las dos: las cifras quedan a la misma altura. */}
              <Texto style={[s.rotulo, { minHeight: lineasDeLaFila(fila) * (M.cifras.rotulo + 0.5) * 1.25 }]}>{dato.rotulo}</Texto>
              {dato.cifra !== null ? (
                <Texto style={[s.valor, dato.principal ? s.valorPrincipal : {}, { color: colorDelSigno(dato.signo) }]}>{dato.cifra}</Texto>
              ) : (
                <Texto style={s.valorAusente}>{textoDelMotivo(dato.motivo)}</Texto>
              )}
              {dato.apunte ? <Texto style={s.apunte}>{dato.apunte}</Texto> : null}
            </View>
          ))}
          {/* Una fila de la rejilla más corta que las demás guarda el ancho de las que faltan: las tarjetas no se estiran. */}
          {Array.from({ length: Math.max(0, porFila - fila.length) }, (_, i) => (
            <View key={`hueco-${i}`} style={{ flex: 1, marginRight: fila.length + i === porFila - 1 ? 0 : separacion }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ Título de sección */

/**
 * El título de una sección. La que abre una hoja lleva el título grande del papel de antes —su número en el color del tema y el
 * título en Fraunces de 19,5, con un filete fino debajo—; las que siguen en la misma hoja, el mismo par a 14,5 bajo un filete que
 * las separa de lo anterior. Debajo, si se da, la procedencia (de dónde sale y de cuándo es). No se queda solo al pie de una hoja:
 * si debajo no caben `juntoAlTitulo` puntos de contenido, pasa a la siguiente con él. Va suelto, como hermano de su contenido:
 * @react-pdf solo mueve un título a la hoja siguiente si tiene algo detrás en su mismo contenedor.
 */
export function TituloDeSeccion({ titulo, numero, procedencia, juntoAlTitulo = 110, arribaDelTodo = false }: {
  titulo: string;
  numero?: string;
  procedencia?: string | null;
  juntoAlTitulo?: number;
  /** Si abre la hoja: el título grande de la hoja, sin el filete que separa de lo anterior. */
  arribaDelTodo?: boolean;
}) {
  const { tema } = useInforme();
  const color = TEMAS[tema].color;
  if (arribaDelTodo) {
    return (
      <View wrap={false} minPresenceAhead={juntoAlTitulo} style={{ marginBottom: 14 }}>
        <Texto style={s.tituloDeHoja}>
          {numero ? <Texto style={[s.numero, { color }]}>{`${numero}   `}</Texto> : null}
          {titulo}
        </Texto>
        <View style={s.reglaDeHoja} />
        {procedencia ? <Texto style={s.procedenciaDeHoja}>{procedencia}</Texto> : null}
      </View>
    );
  }
  return (
    <View style={[s.seccion, { marginBottom: 4 }]} wrap={false} minPresenceAhead={juntoAlTitulo}>
      <Texto style={s.tituloDeSeccion}>
        {numero ? <Texto style={[s.numero, { color }]}>{`${numero}   `}</Texto> : null}
        {titulo}
      </Texto>
      {procedencia ? <Texto style={s.procedencia}>{procedencia}</Texto> : null}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ Párrafo, nota y aviso */

/** Un párrafo de texto base. */
export function Parrafo({ children }: { children: string }) {
  return <Texto style={estilosBase.parrafo}>{children}</Texto>;
}

/** Una nota: filete de bronce (o de acero, en el interno) a la izquierda, sin relleno. `titulo` va delante, en seminegrita. */
export function Nota({ titulo, children }: { titulo?: string; children: string }) {
  const { tema } = useInforme();
  return (
    <View style={[s.nota, { borderLeftColor: TEMAS[tema].filete }]} wrap={false}>
      <Texto style={s.textoDeNota}>
        {titulo ? <Texto style={estilosBase.fuerte}>{`${titulo.trim()} `}</Texto> : null}
        {children}
      </Texto>
    </View>
  );
}

/** Un aviso: como la nota, pero empieza siempre por su palabra en seminegrita («Aviso.»), porque en papel el color no basta. */
export function Aviso({ palabra = "Aviso.", children }: { palabra?: string; children: string }) {
  return <Nota titulo={palabra}>{children}</Nota>;
}

/** El texto legal del destinatario del documento (`avisoLegal.ts`), en letra pequeña. */
export function AvisoLegal() {
  const { tema } = useInforme();
  return <Texto style={s.legal}>{AVISO_LEGAL[tema]}</Texto>;
}
