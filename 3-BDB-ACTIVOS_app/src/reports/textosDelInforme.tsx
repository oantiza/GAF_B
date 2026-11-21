/**
 * Dos piezas de texto que la plantilla no trae y que piden los documentos de cliente que se han pasado a ella (la
 * comparativa de propuestas, el informe de costes, la propuesta de cambio y la simulación de jubilación), hechas solo con
 * sus primitivas:
 *  - `Subtitulo`: un apartado dentro de una sección («Caídas desde máximos»), en serifa y sin filete, para que no compita
 *    con el título numerado de la sección.
 *  - `Apunte`: una línea de letra pequeña bajo una tabla o un gráfico (de dónde sale, qué significa una columna).
 * Y `TextoEscrito`: lo que ha escrito alguien (el asesor), con sus saltos de línea tal cual.
 */
import { View } from "@react-pdf/renderer";
import { FUENTE, MEDIDAS, PAPEL, Texto } from "./plantilla";

export function Subtitulo({ children, primero = false }: { children: string; primero?: boolean }) {
  return (
    <View wrap={false} minPresenceAhead={60}>
      <Texto style={{ fontFamily: FUENTE.serifa, fontWeight: 600, fontSize: MEDIDAS.presentacion.entradilla, lineHeight: 1.3, color: PAPEL.tinta, marginTop: primero ? 6 : 15, marginBottom: 3 }}>
        {children}
      </Texto>
    </View>
  );
}

export function Apunte({ children, arriba = 4, color = PAPEL.tinta2 }: { children: string; arriba?: number; color?: string }) {
  return <Texto style={{ fontSize: MEDIDAS.seccion.procedencia, color, lineHeight: 1.4, marginTop: arriba }}>{children}</Texto>;
}

export function TextoEscrito({ texto }: { texto: string }) {
  return (
    <View style={{ marginTop: 3 }}>
      {texto.split(/\r?\n/).map((linea, indice) => (
        <Texto key={indice} style={{ fontSize: MEDIDAS.cuerpo.letra, lineHeight: MEDIDAS.cuerpo.interlineado, color: PAPEL.tinta }}>
          {linea || " "}
        </Texto>
      ))}
    </View>
  );
}
