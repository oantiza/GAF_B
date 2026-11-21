/* eslint-disable react-refresh/only-export-components */
/**
 * La portada a página completa del papel de cliente de antes (`img/antes/informe-de-cliente/01.jpg`, commit 8da9cb9d): arriba a
 * la izquierda la identidad del asesor (su logotipo si lo tiene, y su entidad o su nombre en versalitas del color del tema) y
 * arriba a la derecha qué documento es y el sello; abajo, el antetítulo, el título muy grande en Fraunces Light, para quién es, un filete corto del
 * color del tema, la rejilla de datos y «Elaborado por» con quien firma. El pie es el de todas las hojas (para quién, el sello,
 * la advertencia y «Página 1 de N»).
 *
 * Donde el papel de antes decía «INDEPENDENT PRIVATE BANKERS» va la identidad del asesor, con el mismo tratamiento; sin
 * identidad, no va nada. Ningún informe lleva marca de entidad.
 *
 * Lo que se le pase como hijos va entre la rejilla y «Elaborado por». **Nunca las cifras de un informe** (Óscar, 15-11-2026: las
 * métricas no van en la portada): el informe de cliente las da en su sección «Cifras de la cartera».
 */
import { Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { ContextoDeHoja, useInforme } from "./contexto";
import { FUENTE } from "./fuentes";
import { Pie } from "./hoja";
import { textoDelMotivo, type DatoDeRejilla } from "./piezas";
import { Texto } from "./primitivas";
import { ABAJO_DEL_CUERPO, MEDIDAS, PAPEL, TEMAS, anchoUtil } from "./tema";

const M = MEDIDAS;

const s = StyleSheet.create({
  hoja: { backgroundColor: PAPEL.blanco, fontFamily: FUENTE.sans, fontSize: M.cuerpo.letra, color: PAPEL.tinta },
  cuerpo: { position: "absolute", top: M.cabecera.arriba + 4, left: M.margenLateral, right: M.margenLateral, bottom: ABAJO_DEL_CUERPO, justifyContent: "space-between" },
  arriba: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  identidad: { flexDirection: "row", alignItems: "center", flexShrink: 1, maxWidth: "70%" },
  logotipo: { height: 26, maxWidth: 90, objectFit: "contain", marginRight: 10 },
  marca: { fontSize: 8.5, fontWeight: 500, letterSpacing: 3.6, textTransform: "uppercase", lineHeight: 1.3 },
  documento: { flexDirection: "row", alignItems: "center" },
  nombreDelDocumento: { fontSize: 7, fontWeight: 500, letterSpacing: 0.5, color: PAPEL.tinta2, lineHeight: 1.3, marginRight: 10 },
  sello: { fontSize: 7.7, fontWeight: 500, letterSpacing: 3.1, lineHeight: 1.3 },
  antetitulo: { fontSize: 7.7, fontWeight: 500, letterSpacing: 2.2, textTransform: "uppercase", lineHeight: 1.3 },
  /* Un antetítulo que lleva datos (un periodo, una fecha) se escribe como viene: en versalitas cambiaría lo que dice. */
  antetituloComoViene: { fontSize: 7.7, fontWeight: 500, letterSpacing: 0.6, lineHeight: 1.3 },
  titulo: { marginTop: 14, maxWidth: 360, fontFamily: FUENTE.serifa, fontWeight: 300, fontSize: M.portada.titulo, lineHeight: 1.02, color: PAPEL.tinta },
  destinatario: { marginTop: 16, fontFamily: FUENTE.serifa, fontWeight: 600, fontSize: M.portada.destinatario, lineHeight: 1.2, color: PAPEL.tinta },
  entradilla: { marginTop: 12, fontSize: M.portada.valor, lineHeight: 1.45, color: PAPEL.tinta2, maxWidth: 420 },
  filete: { width: 90, height: 1.5, marginTop: 24 },
  rejilla: { marginTop: 18, flexDirection: "row", flexWrap: "wrap" },
  dato: { width: 158, marginRight: 8, marginBottom: 12 },
  rotulo: { fontSize: M.portada.rotulo, fontWeight: 500, letterSpacing: 0.9, lineHeight: 1.3 },
  valor: { marginTop: 4, fontSize: M.portada.valor, lineHeight: 1.3, color: PAPEL.tinta },
  ausente: { marginTop: 4, fontSize: 8.5, lineHeight: 1.3, color: PAPEL.tinta3 },
  firma: { marginTop: 14 },
  firmaNombre: { marginTop: 4, fontSize: M.portada.valor, lineHeight: 1.3, color: PAPEL.tinta },
  firmaResto: { marginTop: 2, fontSize: 7.7, lineHeight: 1.35, color: PAPEL.tinta3 }
});

export interface PropiedadesDeLaPortada {
  /** La línea de encima del título, en versalitas: «Informe personalizado». */
  antetitulo?: string;
  /** El antetítulo lleva datos (un periodo, una fecha): va como viene, sin versalitas. */
  antetituloComoViene?: boolean;
  /** El título, muy grande. Un salto de línea («Informe\nde su cartera») lo parte donde se quiere. */
  titulo: string;
  /** Para quién es, bajo el título, en Fraunces: «Familia García». */
  destinatario?: string;
  /** Una frase bajo el destinatario (la metodología de una muestra, por ejemplo). */
  entradilla?: string;
  /** La rejilla de datos: periodo, valoración, fecha, perfil, horizonte… Solo los que hay. */
  datos?: readonly DatoDeRejilla[];
  /** Sin «Elaborado por», aunque haya identidad (el documento ya dice quién firma en sus datos). */
  sinFirma?: boolean;
  /** Lo que va entre la rejilla y la firma. */
  children?: ReactNode;
}

/** «Elaborado por» de la portada: el nombre (o la entidad, si no hay nombre) y, debajo, la entidad y el contacto que haya. */
export function firmaDeLaPortada(identidad: { nombre?: string; entidad?: string; contacto?: string }): { quien: string; resto: string | null } | null {
  const quien = identidad.nombre ?? identidad.entidad;
  if (!quien) return null;
  const resto = [identidad.nombre ? identidad.entidad : undefined, identidad.contacto].filter(Boolean).join(" · ");
  return { quien, resto: resto || null };
}

export function Portada({ antetitulo, antetituloComoViene = false, titulo, destinatario, entradilla, datos = [], sinFirma = false, children }: PropiedadesDeLaPortada) {
  const { tema, identidad, documento } = useInforme();
  const { color, tono, sello } = TEMAS[tema];
  const marca = identidad.entidad ?? identidad.nombre;
  const firma = sinFirma ? null : firmaDeLaPortada(identidad);
  return (
    <Page size="A4" style={s.hoja}>
      <ContextoDeHoja.Provider value={{ apaisada: false, ancho: anchoUtil(false) }}>
        <Pie />
        <View style={s.cuerpo}>
          <View style={s.arriba}>
            <View style={s.identidad}>
              {identidad.logotipo ? <Image src={identidad.logotipo} style={s.logotipo} /> : null}
              {marca ? <Texto style={[s.marca, { color }]}>{marca}</Texto> : null}
            </View>
            <View style={s.documento}>
              <Texto style={s.nombreDelDocumento}>{documento}</Texto>
              <Text style={[s.sello, { color: tono }]}>{sello}</Text>
            </View>
          </View>
          <View>
            {antetitulo ? <Texto style={[antetituloComoViene ? s.antetituloComoViene : s.antetitulo, { color: tono }]}>{antetitulo}</Texto> : null}
            <Texto style={s.titulo}>{titulo}</Texto>
            {destinatario ? <Texto style={s.destinatario}>{destinatario}</Texto> : null}
            {entradilla ? <Texto style={s.entradilla}>{entradilla}</Texto> : null}
            <View style={[s.filete, { backgroundColor: color }]} />
            {datos.length ? (
              <View style={s.rejilla}>
                {datos.map((dato, i) => (
                  <View key={`${dato.rotulo}-${i}`} style={s.dato} wrap={false}>
                    <Texto style={[s.rotulo, { color: tono }]}>{dato.rotulo}</Texto>
                    {dato.valor !== null ? <Texto style={s.valor}>{dato.valor}</Texto> : <Texto style={s.ausente}>{textoDelMotivo(dato.motivo)}</Texto>}
                  </View>
                ))}
              </View>
            ) : null}
            {children}
            {firma ? (
              <View style={s.firma} wrap={false}>
                <Texto style={[s.rotulo, { color: tono }]}>Elaborado por</Texto>
                <Texto style={s.firmaNombre}>{firma.quien}</Texto>
                {firma.resto ? <Texto style={s.firmaResto}>{firma.resto}</Texto> : null}
              </View>
            ) : null}
          </View>
        </View>
      </ContextoDeHoja.Provider>
    </Page>
  );
}
