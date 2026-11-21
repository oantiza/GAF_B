/**
 * La tabla de la plantilla, con el aspecto del papel de cliente de antes: cabecera sin relleno, en letra pequeña del tono del
 * tema (bronce en el de cliente, gris acero en el interno), con un filete fino debajo, que se repite al saltar de hoja; filas
 * que nunca se parten, con un filete muy claro entre ellas; filas de grupo que no se quedan solas al pie; y fila de total con
 * un filete encima, en Fraunces y en el color del tema, que nunca abre hoja sola. Texto a la izquierda, cifras a la derecha
 * (en Roboto Flex, cuyas cifras tienen todas el mismo ancho: las columnas cuadran).
 */
import { StyleSheet, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { ClaseDeAusencia } from "../../types/fichaInstrumento";
import { useInforme } from "./contexto";
import { FUENTE } from "./fuentes";
import { textoDelMotivo } from "./piezas";
import { Texto } from "./primitivas";
import { MEDIDAS, PAPEL, TEMAS, colorDelSigno } from "./tema";

const M = MEDIDAS.tabla;

const s = StyleSheet.create({
  cabecera: { flexDirection: "row", borderBottomWidth: M.filete, borderBottomColor: PAPEL.filete, alignItems: "flex-end" },
  titulo: { fontSize: M.cabecera, fontWeight: 500, letterSpacing: 0.5, lineHeight: 1.35 },
  fila: { flexDirection: "row", alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: PAPEL.rejilla },
  celda: { fontSize: M.celda, lineHeight: 1.3, color: PAPEL.tinta },
  ausente: { fontSize: M.apunte, color: PAPEL.tinta3, lineHeight: 1.3, paddingTop: 1 },
  apunte: { fontSize: M.apunte, color: PAPEL.tinta3, letterSpacing: 0.2, lineHeight: 1.3, marginTop: 2 },
  grupo: { flexDirection: "row", borderBottomWidth: M.filete, borderBottomColor: PAPEL.filete, paddingTop: 10, paddingBottom: 4 },
  textoDeGrupo: { fontSize: M.celda, fontWeight: 600, lineHeight: 1.3 },
  total: { fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: M.total, lineHeight: 1.25 }
});

export interface ColumnaDeTabla {
  titulo: string;
  /** Peso relativo del ancho: una columna con 2 es el doble de ancha que una con 1. Por defecto, 1. */
  ancho?: number;
  /** Una columna de cifras: va a la derecha. */
  cifra?: boolean;
}

/**
 * Una celda. Una cadena es su texto (vacía, si la celda no lleva nada a propósito, como el «Qué es» de un total);
 * `null` es un dato que falta, y se escribe «Falta el dato».
 */
export type CeldaDeTabla =
  | string
  | null
  | {
      /** El texto ya escrito; `null` si falta. */
      texto: string | null;
      /** Verde o rojo, para un resultado o una rentabilidad (el signo va escrito en el texto). */
      signo?: "sube" | "baja" | "neutro" | null;
      /** Una segunda línea, más pequeña (un ISIN, una fecha). */
      apunte?: string | null;
      /** Por qué falta, si falta. Por defecto, «Falta el dato». */
      motivo?: ClaseDeAusencia | string;
    };

/** Una fila de datos o una fila de grupo, que abre un grupo de filas con su nombre. */
export type FilaDeTabla = { celdas: readonly CeldaDeTabla[] } | { grupo: string };

const esGrupo = (fila: FilaDeTabla): fila is { grupo: string } => "grupo" in fila;

export interface PropiedadesDeLaTabla {
  columnas: readonly ColumnaDeTabla[];
  filas: readonly FilaDeTabla[];
  /** La fila de total, que va al final con un filete encima, en Fraunces y en el color del tema. */
  total?: readonly CeldaDeTabla[];
}

type Bloque = { elementos: ReactElement[]; datos: number };

export function Tabla({ columnas, filas, total }: PropiedadesDeLaTabla) {
  const { tema } = useInforme();
  const { color, tono } = TEMAS[tema];
  const suma = columnas.reduce((acumulado, columna) => acumulado + (columna.ancho ?? 1), 0);
  const ancho = (i: number) => `${((columnas[i].ancho ?? 1) / suma) * 100}%`;
  const alinear = (i: number) => (columnas[i].cifra ? "right" : "left");
  const relleno = (i: number) => ({
    paddingLeft: i === 0 ? 0 : M.rellenoHorizontal,
    paddingRight: i === columnas.length - 1 ? 0 : M.rellenoHorizontal
  });

  const celda = (contenido: CeldaDeTabla | undefined, i: number, esTotal: boolean) => {
    /* `null` es un dato que falta; `undefined` (una fila más corta que las columnas), una celda vacía. */
    const dato = typeof contenido === "object" && contenido !== null ? contenido : { texto: contenido === undefined ? "" : contenido };
    const textAlign = alinear(i);
    return (
      <View key={i} style={[{ width: ancho(i), paddingVertical: M.rellenoVertical }, relleno(i)]}>
        {dato.texto === null ? (
          <Texto style={[s.ausente, { textAlign }]}>{textoDelMotivo("motivo" in dato ? dato.motivo : undefined)}</Texto>
        ) : (
          <Texto
            style={[
              s.celda,
              esTotal ? s.total : {},
              /* En el total, el color del tema; una cifra con signo lleva el suyo también ahí. */
              { textAlign, color: "signo" in dato && dato.signo && dato.signo !== "neutro" ? colorDelSigno(dato.signo) : esTotal ? color : PAPEL.tinta }
            ]}
          >
            {dato.texto}
          </Texto>
        )}
        {"apunte" in dato && dato.apunte ? <Texto style={[s.apunte, { textAlign }]}>{dato.apunte}</Texto> : null}
      </View>
    );
  };

  const filaDeDatos = (celdas: readonly CeldaDeTabla[], clave: string, ultima: boolean) => (
    <View key={clave} style={[s.fila, ultima ? { borderBottomWidth: 0 } : {}]} wrap={false}>
      {columnas.map((_, i) => celda(celdas[i], i, false))}
    </View>
  );

  /* Cada fila de grupo va con la primera fila de su grupo: un grupo no empieza solo al pie de una hoja. */
  const bloques: Bloque[] = [];
  let grupoPendiente: ReactElement | null = null;
  filas.forEach((fila, f) => {
    if (esGrupo(fila)) {
      if (grupoPendiente) bloques.push({ elementos: [grupoPendiente], datos: 0 });
      grupoPendiente = (
        <View key={`g${f}`} style={s.grupo}>
          <Texto style={s.textoDeGrupo}>{fila.grupo}</Texto>
        </View>
      );
      return;
    }
    const ultima = total !== undefined && f === filas.length - 1;
    const elemento = filaDeDatos(fila.celdas, `f${f}`, ultima);
    bloques.push({ elementos: grupoPendiente ? [grupoPendiente, elemento] : [elemento], datos: 1 });
    grupoPendiente = null;
  });
  if (grupoPendiente) bloques.push({ elementos: [grupoPendiente], datos: 0 });

  /* Las dos últimas filas de datos van con el total (todas, si son tres o menos): el total nunca abre una hoja solo. */
  let cola = 0;
  if (total) {
    const necesarias = bloques.reduce((n, b) => n + b.datos, 0) <= 3 ? Infinity : 2;
    let vistas = 0;
    while (cola < bloques.length && vistas < necesarias) {
      vistas += bloques[bloques.length - 1 - cola].datos;
      cola += 1;
    }
  }
  const sueltos = bloques.slice(0, bloques.length - cola);
  const finales = bloques.slice(bloques.length - cola);

  return (
    <View style={{ marginTop: 3 }}>
      <View style={s.cabecera} fixed wrap={false}>
        {columnas.map((columna, i) => (
          <View key={`${columna.titulo}-${i}`} style={[{ width: ancho(i), paddingVertical: M.rellenoVertical }, relleno(i)]}>
            <Texto style={[s.titulo, { textAlign: alinear(i), color: tono }]}>{columna.titulo}</Texto>
          </View>
        ))}
      </View>
      {sueltos.map((bloque, b) =>
        bloque.elementos.length === 1 ? bloque.elementos[0] : (
          <View key={`b${b}`} wrap={false}>
            {bloque.elementos}
          </View>
        )
      )}
      {total ? (
        <View wrap={false}>
          {finales.flatMap((bloque) => bloque.elementos)}
          <View style={[s.fila, { borderBottomWidth: M.filete, borderBottomColor: PAPEL.filete, borderTopWidth: M.filete, borderTopColor: PAPEL.filete, paddingTop: 3, paddingBottom: 1 }]}>
            {columnas.map((_, i) => celda(total[i], i, true))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
