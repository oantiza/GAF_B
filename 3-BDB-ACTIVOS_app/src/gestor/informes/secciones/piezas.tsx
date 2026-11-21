/* eslint-disable react-refresh/only-export-components */
/**
 * Las piezas de los tres informes del gestor que la plantilla (`src/reports/plantilla/`) no trae, hechas con sus
 * primitivas (`Texto`, `PAPEL`, `MEDIDAS`, `colorDelSigno`) y con su mismo aspecto: papel blanco, filetes grises y
 * ningún relleno de color.
 *
 *  - `Subtitulo`: el título de un bloque dentro de una sección («Por clase de activo», «Efectivo»), sin número.
 *  - `Pequena`: una línea de letra pequeña bajo una tabla o un gráfico: de dónde sale, cómo se lee.
 *  - `DosColumnas`: dos bloques lado a lado.
 *  - `CifrasConFrase`: las cifras destacadas de la plantilla, con la frase que explica cada una debajo.
 *  - `RejillaConSigno`: la rejilla de la plantilla, con el color del signo y una línea bajo la cifra.
 *  - `TablaDeMeses`: la rentabilidad de cada mes y de cada año, catorce columnas en una hoja vertical.
 *  - `TablaCompacta`: la tabla de la plantilla con letra de 7 pt, para las tablas anchas del asesor (posiciones,
 *    cerradas, movimientos): con la letra de 8,6 pt cada fila ocupaba hasta tres líneas y el informe, siete hojas más.
 *  - `Vinetas`: una lista de puntos.
 */
import { StyleSheet, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { rentabilidad, signoDe } from "../../../core/formato";
import { textoDeAusencia } from "../../../core/textoDeAusencia";
import { CifrasDestacadas, MEDIDAS, PAPEL, TEMAS, Texto, colorDelSigno, useInforme, type CeldaDeTabla, type CifraDestacada, type ColumnaDeTabla } from "../../../reports/plantilla";
import type { Analisis } from "../../motor/analisis";
import type { RentabilidadDelAnio } from "../../motor/rentabilidad";
import { notaDeLasCifrasQueLasCuentanComoCero } from "../../motor/sinPrecio";
import { MESES_CORTOS } from "../formato";

const M = MEDIDAS;

/* La tabla de meses: catorce columnas en el ancho de una hoja vertical (505 pt). «−10,39 %» mide unos 33 pt a 7 pt. */
const MESES = { letra: 7, anio: 30, mes: 35.5, total: 47, relleno: 1.5 } as const;
/* La tabla compacta: la de la plantilla en pequeño. */
const COMPACTA = { letra: 7, apunte: 6.3, rellenoVertical: 3, rellenoHorizontal: 4 } as const;

const s = StyleSheet.create({
  subtitulo: { fontSize: M.cuerpo.letra, fontWeight: 600, color: PAPEL.tinta, lineHeight: 1.3, marginTop: 13.5, marginBottom: 1.5 },
  pequena: { fontSize: M.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.4 },
  columnas: { flexDirection: "row", marginHorizontal: -10.5 },
  columna: { width: "50%", paddingHorizontal: 10.5 },
  frases: { flexDirection: "row", marginTop: 6 },
  /* Cada frase, debajo de su tarjeta y con su mismo ancho: la tarjeta lleva 10 de relleno y 7 de calle con la siguiente. */
  frase: { paddingHorizontal: 10 },
  textoDeFrase: { fontSize: M.cifras.apunte, color: PAPEL.tinta2, lineHeight: 1.4 },
  rejilla: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  dato: { borderTopWidth: 0.75, borderTopColor: PAPEL.filete, paddingTop: 4.5, paddingRight: 12, paddingBottom: 7.5 },
  datoRotulo: { fontSize: M.cifras.apunte, color: PAPEL.tinta2, lineHeight: 1.3 },
  datoValor: { fontSize: M.cuerpo.letra, fontWeight: 600, lineHeight: 1.3, marginTop: 1.5 },
  datoApunte: { fontSize: M.seccion.procedencia, color: PAPEL.tinta3, lineHeight: 1.3, marginTop: 1.5 },
  datoAusente: { fontSize: M.seccion.procedencia, color: PAPEL.tinta3, lineHeight: 1.3, marginTop: 2 },
  cabeceraDeMeses: { flexDirection: "row", borderBottomWidth: M.tabla.filete, borderBottomColor: PAPEL.fileteFuerte },
  filaDeMeses: { flexDirection: "row", borderBottomWidth: M.tabla.filete, borderBottomColor: PAPEL.filete },
  tituloDeMes: { fontSize: MESES.letra, fontWeight: 600, color: PAPEL.tinta3, lineHeight: 1.3, textAlign: "right" },
  cifraDeMes: { fontSize: MESES.letra, lineHeight: 1.3, textAlign: "right" },
  textoCompacto: { fontSize: COMPACTA.letra, lineHeight: 1.3, color: PAPEL.tinta },
  tituloCompacto: { fontSize: COMPACTA.letra, fontWeight: 600, lineHeight: 1.3, color: PAPEL.tinta3 },
  apunteCompacto: { fontSize: COMPACTA.apunte, lineHeight: 1.3, color: PAPEL.tinta3, marginTop: 0.5 },
  vineta: { flexDirection: "row", marginTop: 3 },
  puntoDeVineta: { width: 10, fontSize: M.nota.letra, color: PAPEL.tinta2, lineHeight: 1.45 },
  textoDeVineta: { flex: 1, fontSize: M.nota.letra, color: PAPEL.tinta2, lineHeight: 1.45 }
});

/**
 * Un texto escrito fuera del informe (las ayudas del registro de métricas) con un espacio duro entre la cifra y su unidad,
 * como las que escribe el módulo común: «el 5 %» no se parte con el «%» solo en la línea siguiente.
 */
export function sinCortarLaUnidad(texto: string): string {
  return texto.replace(/(\d) ([%€])/g, "$1\u00a0$2");
}

/** El título de un bloque dentro de una sección. No se queda solo al pie: pasa a la hoja siguiente con lo que lleva debajo. */
export function Subtitulo({ children, juntoAlTitulo = 60 }: { children: string; juntoAlTitulo?: number }) {
  return (
    <View wrap={false} minPresenceAhead={juntoAlTitulo}>
      <Texto style={s.subtitulo}>{children}</Texto>
    </View>
  );
}

/** Letra pequeña: cómo se lee una tabla o un gráfico, de dónde sale una cifra. */
export function Pequena({ children, separada = false }: { children: string; separada?: boolean }) {
  return <Texto style={[s.pequena, { marginTop: separada ? 6 : 3 }]}>{children}</Texto>;
}

/**
 * Bajo las cifras que salen del valor de cada día, si alguna posición no tiene precio: «Estas cifras cuentan Activo B como
 * cero, porque no tiene precio.» (decisión A-197, 20-11-2026: el informe del cliente dice lo que falta). Nada si todas lo tienen.
 */
export function LoContadoComoCero({ analisis }: { analisis: Pick<Analisis, "sinPrecio"> }) {
  const frase = notaDeLasCifrasQueLasCuentanComoCero(analisis);
  return frase ? <Pequena separada>{frase}</Pequena> : null;
}

/** Dos bloques lado a lado, cada uno con la mitad del ancho. */
export function DosColumnas({ izquierda, derecha }: { izquierda: ReactNode; derecha: ReactNode }) {
  return (
    <View style={s.columnas}>
      <View style={s.columna}>{izquierda}</View>
      <View style={s.columna}>{derecha}</View>
    </View>
  );
}

/** Una cifra destacada con la frase que la explica, que va debajo de la fila de cifras, en su columna. */
export interface CifraConFrase extends CifraDestacada {
  frase: string;
}

/** Las cifras destacadas de la plantilla y, debajo de cada una y con su mismo ancho, la frase que dice qué es. */
export function CifrasConFrase({ cifras }: { cifras: readonly CifraConFrase[] }) {
  return (
    <View wrap={false}>
      <CifrasDestacadas cifras={cifras} />
      <View style={s.frases}>
        {cifras.map((cifra, i) => (
          <View key={`${cifra.rotulo}-${i}`} style={[s.frase, { flex: cifra.principal ? 1.3 : 1, marginRight: i === cifras.length - 1 ? 0 : M.cifras.separacion }]}>
            <Texto style={s.textoDeFrase}>{sinCortarLaUnidad(cifra.frase)}</Texto>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface DatoConSigno {
  rotulo: string;
  /** El valor ya escrito; `null` si falta, y se escribe `motivo` (o «Falta el dato»). */
  valor: string | null;
  signo?: "sube" | "baja" | "neutro" | null;
  /** Una línea bajo el valor: de qué fechas es, con qué se ha medido. */
  apunte?: string;
  motivo?: string;
}

/** La rejilla de la plantilla, con el color del signo en el valor y una línea pequeña debajo. */
export function RejillaConSigno({ datos, columnas = 4 }: { datos: readonly DatoConSigno[]; columnas?: number }) {
  const ancho = `${100 / Math.max(1, columnas)}%`;
  return (
    <View style={s.rejilla}>
      {datos.map((dato, i) => (
        <View key={`${dato.rotulo}-${i}`} style={[s.dato, { width: ancho }]} wrap={false}>
          <Texto style={s.datoRotulo}>{dato.rotulo}</Texto>
          {dato.valor !== null ? (
            <Texto style={[s.datoValor, { color: colorDelSigno(dato.signo) }]}>{dato.valor}</Texto>
          ) : (
            <Texto style={s.datoAusente}>{dato.motivo ?? textoDeAusencia("falta")}</Texto>
          )}
          {dato.apunte ? <Texto style={s.datoApunte}>{dato.apunte}</Texto> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * La rentabilidad de cada mes y de cada año, con su signo y su color (verde o rojo) y sin fondo en la casilla. Un mes en
 * que la cartera no existía va en blanco: no es un dato que falte, es que ese mes no hay cartera. `marcarParciales`
 * pone un asterisco también en los meses incompletos (el del asesor); el año incompleto lo lleva siempre.
 */
export function TablaDeMeses({ anios, marcarParciales = false }: { anios: readonly RentabilidadDelAnio[]; marcarParciales?: boolean }) {
  const celda = (ancho: number, contenido: ReactNode, i: number) => (
    <View key={i} style={{ width: ancho, paddingVertical: M.tabla.rellenoVertical - 1, paddingLeft: i === 0 ? 0 : MESES.relleno, paddingRight: i === 13 ? 0 : MESES.relleno }}>
      {contenido}
    </View>
  );
  const ancho = (i: number) => (i === 0 ? MESES.anio : i === 13 ? MESES.total : MESES.mes);
  const cifra = (valor: number, marca: boolean, i: number) =>
    celda(ancho(i), <Texto style={[s.cifraDeMes, { color: colorDelSigno(signoDe(valor, 4)) }]}>{`${rentabilidad(valor) ?? ""}${marca ? "*" : ""}`}</Texto>, i);
  return (
    <View style={{ marginTop: 4 }}>
      <View style={s.cabeceraDeMeses} fixed wrap={false}>
        {["Año", ...MESES_CORTOS, "Total"].map((titulo, i) => celda(ancho(i), <Texto style={[s.tituloDeMes, i === 0 ? { textAlign: "left" } : {}]}>{titulo}</Texto>, i))}
      </View>
      {anios.map((anio, f) => (
        <View key={anio.anio} style={[s.filaDeMeses, f === anios.length - 1 ? { borderBottomWidth: 0 } : {}]} wrap={false}>
          {celda(ancho(0), <Texto style={[s.cifraDeMes, { textAlign: "left", fontWeight: 600 }]}>{`${anio.anio}${anio.parcial ? "*" : ""}`}</Texto>, 0)}
          {anio.meses.map((mes, m) => (mes ? cifra(mes.rentabilidad, marcarParciales && mes.parcial === true, m + 1) : celda(ancho(m + 1), null, m + 1)))}
          {cifra(anio.total, false, 13)}
        </View>
      ))}
    </View>
  );
}

/** Una lista de puntos, en letra de nota. */
export function Vinetas({ puntos }: { puntos: readonly string[] }) {
  return (
    <View>
      {puntos.map((punto, i) => (
        <View key={i} style={s.vineta} wrap={false}>
          <Texto style={s.puntoDeVineta}>•</Texto>
          <Texto style={s.textoDeVineta}>{punto}</Texto>
        </View>
      ))}
    </View>
  );
}

/**
 * La tabla de la plantilla (cabecera sin relleno que se repite al saltar de hoja, filas que no se parten, filetes grises,
 * cifras a la derecha, total con filete del tema que nunca abre hoja solo) con letra de 7 pt y menos relleno, para las
 * tablas anchas del asesor. Las celdas son las de la plantilla (`CeldaDeTabla`): texto, signo, apunte y motivo.
 */
export function TablaCompacta({ columnas, filas, total }: { columnas: readonly ColumnaDeTabla[]; filas: ReadonlyArray<readonly CeldaDeTabla[]>; total?: readonly CeldaDeTabla[] }) {
  const { tema } = useInforme();
  const suma = columnas.reduce((acumulado, columna) => acumulado + (columna.ancho ?? 1), 0);
  const caja = (i: number) => ({
    width: `${((columnas[i].ancho ?? 1) / suma) * 100}%`,
    paddingVertical: COMPACTA.rellenoVertical,
    paddingLeft: i === 0 ? 0 : COMPACTA.rellenoHorizontal,
    paddingRight: i === columnas.length - 1 ? 0 : COMPACTA.rellenoHorizontal
  });
  const alinear = (i: number) => (columnas[i].cifra ? ("right" as const) : ("left" as const));
  const celda = (contenido: CeldaDeTabla | undefined, i: number, negrita: boolean) => {
    const dato = typeof contenido === "object" && contenido !== null ? contenido : { texto: contenido === undefined ? "" : contenido };
    const textAlign = alinear(i);
    return (
      <View key={i} style={caja(i)}>
        {dato.texto === null ? (
          <Texto style={[s.apunteCompacto, { textAlign }]}>{textoDelMotivo("motivo" in dato ? dato.motivo : undefined)}</Texto>
        ) : (
          <Texto style={[s.textoCompacto, { textAlign, fontWeight: negrita ? 600 : 400, color: colorDelSigno("signo" in dato ? dato.signo : null) }]}>{dato.texto}</Texto>
        )}
        {"apunte" in dato && dato.apunte ? <Texto style={[s.apunteCompacto, { textAlign }]}>{dato.apunte}</Texto> : null}
      </View>
    );
  };
  const fila = (celdas: readonly CeldaDeTabla[], clave: string | number, ultima: boolean) => (
    <View key={clave} style={[s.filaDeMeses, ultima ? { borderBottomWidth: 0 } : {}]} wrap={false}>
      {columnas.map((_, i) => celda(celdas[i], i, false))}
    </View>
  );
  /* Las dos últimas filas van con el total (todas, si son tres o menos): el total nunca abre una hoja solo. */
  const cola = total ? (filas.length <= 3 ? filas.length : 2) : 0;
  return (
    <View style={{ marginTop: 3 }}>
      <View style={s.cabeceraDeMeses} fixed wrap={false}>
        {columnas.map((columna, i) => (
          <View key={`${columna.titulo}-${i}`} style={caja(i)}>
            <Texto style={[s.tituloCompacto, { textAlign: alinear(i) }]}>{columna.titulo}</Texto>
          </View>
        ))}
      </View>
      {filas.slice(0, filas.length - cola).map((celdas, f) => fila(celdas, f, !total && f === filas.length - 1))}
      {total ? (
        <View wrap={false}>
          {filas.slice(filas.length - cola).map((celdas, f) => fila(celdas, `c${f}`, f === cola - 1))}
          <View style={[s.filaDeMeses, { borderBottomWidth: 0, borderTopWidth: M.tabla.filete, borderTopColor: TEMAS[tema].color }]}>
            {columnas.map((_, i) => celda(total[i], i, true))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** El texto de lo que falta: su motivo o la frase de su clase. */
function textoDelMotivo(motivo: string | undefined): string {
  if (motivo === undefined || motivo === "falta") return textoDeAusencia("falta");
  return motivo === "no-aplica" || motivo === "sin-pedir" ? textoDeAusencia(motivo) : motivo;
}
