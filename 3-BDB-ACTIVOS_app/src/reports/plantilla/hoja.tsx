/* eslint-disable react-refresh/only-export-components */
/**
 * La hoja y lo que se repite en todas, con el aspecto del papel de cliente de antes (decisión de Óscar del 14-11-2026):
 *
 *  - arriba, una línea fina: a la izquierda qué documento es y el sello del tema, en versalitas espaciadas («USO INTERNO»
 *    lleva debajo «No entregar al cliente»); a la derecha la identidad del asesor en el color del tema —su entidad o, si no
 *    la hay, su nombre, con su logotipo si lo tiene— y debajo quién firma y cómo contactar. Sin identidad, no va nada;
 *  - abajo, sobre un filete: para quién es (o quién firma) con el sello, la advertencia corta y «Página x de N».
 *
 * Las dos son fijas: salen en cada hoja, también cuando el contenido salta de página. El título grande de cada hoja lo pone
 * la sección que la abre (`TituloDeSeccion`), y la portada es una pieza aparte (`Portada`).
 */
import { Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { ContextoDeHoja, useInforme, type IdentidadDelAsesor } from "./contexto";
import { FUENTE } from "./fuentes";
import { Texto } from "./primitivas";
import { ABAJO_DEL_CUERPO, ARRIBA_DEL_CUERPO, MEDIDAS, NO_ENTREGAR, PAPEL, TEMAS, anchoUtil, type TemaDeInforme } from "./tema";

const M = MEDIDAS;

/** Lo que ocupa «Página 100 de 100» en la letra del pie, con holgura: el ancho que se le reserva. */
const ANCHO_DE_LA_PAGINACION = 66;

const s = StyleSheet.create({
  hoja: {
    paddingTop: ARRIBA_DEL_CUERPO,
    paddingBottom: ABAJO_DEL_CUERPO,
    paddingHorizontal: M.margenLateral,
    backgroundColor: PAPEL.blanco,
    fontFamily: FUENTE.sans,
    fontSize: M.cuerpo.letra,
    color: PAPEL.tinta
  },
  cabecera: { position: "absolute", top: M.cabecera.arriba, left: M.margenLateral, right: M.margenLateral, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  documento: { flexShrink: 1, marginRight: 18 },
  lineaDelDocumento: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  nombreDelDocumento: { fontSize: M.cabecera.documento, fontWeight: 500, letterSpacing: 0.5, color: PAPEL.tinta2, lineHeight: 1.3 },
  sello: { marginLeft: M.cabecera.sello.separacion, fontSize: M.cabecera.sello.letra, fontWeight: 600, letterSpacing: M.cabecera.sello.espaciado, lineHeight: 1.3 },
  noEntregar: { fontSize: M.cabecera.destinatario, color: PAPEL.tinta2, lineHeight: 1.3, marginTop: 2 },
  asesor: { flexDirection: "row", alignItems: "flex-start", flexShrink: 1, maxWidth: "55%" },
  logotipo: { height: M.cabecera.logotipo, width: M.cabecera.logotipo * 2.4, marginRight: M.cabecera.separacionDelLogotipo, alignItems: "flex-end" },
  imagen: { height: M.cabecera.logotipo, maxWidth: M.cabecera.logotipo * 2.4, objectFit: "contain" },
  marca: { fontSize: M.cabecera.identidad, fontWeight: 500, letterSpacing: M.cabecera.espaciadoDeLaIdentidad, textAlign: "right", lineHeight: 1.3 },
  quienTexto: { fontSize: M.cabecera.destinatario, color: PAPEL.tinta3, lineHeight: 1.3 },
  pie: {
    position: "absolute",
    bottom: M.pie.abajo,
    left: M.margenLateral,
    right: M.margenLateral,
    borderTopWidth: M.pie.filete,
    borderTopColor: PAPEL.filete,
    paddingTop: M.pie.aire,
    flexDirection: "row",
    alignItems: "flex-start",
    fontSize: M.pie.letra,
    color: PAPEL.tinta2
  },
  /* Las tres partes tienen su sitio medido: el número de página se escribe con `render`, después de repartir el ancho,
     así que sin un ancho propio la advertencia se montaba sobre «Página x de y» en cuanto la firma era larga. La firma
     se parte en dos líneas antes que empujar a las otras dos. */
  pieIzquierda: { flexDirection: "row", flexWrap: "wrap", flexShrink: 1, maxWidth: "40%" },
  /* Sin lineHeight en el pie: en una hoja con un nodo `render` (el número de página), @react-pdf vuelve a multiplicar el
     interlineado sin unidad en cada pasada, y el pie acaba fuera del papel (se midió: −4.230 pt en la primera hoja). */
  pieTexto: { fontSize: M.pie.letra, color: PAPEL.tinta2 },
  pieSello: { fontSize: M.pie.letra, fontWeight: 600, letterSpacing: 0.6 },
  pieCentro: { flex: 1, paddingHorizontal: 10, textAlign: "center", fontSize: M.pie.letra, color: PAPEL.tinta2 },
  pieDerecha: { width: ANCHO_DE_LA_PAGINACION, flexShrink: 0, textAlign: "right", fontSize: M.pie.letra, color: PAPEL.tinta2 }
});

/** Lo que va bajo el nombre del documento en la cabecera: «No entregar al cliente» en el interno; en el de cliente, nada. */
export function lineaBajoElDocumento(tema: TemaDeInforme): string | null {
  return tema === "interno" ? NO_ENTREGAR : null;
}

/** Para quién es el documento, como va en el pie del de cliente: «Preparado para Familia García». */
export function lineaDelDestinatario(tema: TemaDeInforme, destinatario: string | undefined): string | null {
  if (tema === "interno") return null;
  const quien = destinatario?.trim();
  return quien ? `Preparado para ${quien}` : null;
}

/** La identidad que va en la cabecera: la entidad (o el nombre, si no hay entidad) y la línea de quién firma y cómo contactar. */
export function partesDeLaIdentidad(identidad: IdentidadDelAsesor): { marca: string | null; quien: string[] } {
  const marca = identidad.entidad ?? identidad.nombre ?? null;
  const quien = [identidad.entidad ? identidad.nombre : undefined, identidad.contacto].filter((parte): parte is string => Boolean(parte));
  return { marca, quien };
}

/** La identidad del asesor arriba a la derecha: logotipo, la marca en el color del tema y, debajo, quién y cómo contactar. */
export function IdentidadEnLaCabecera({ alineada = "derecha" }: { alineada?: "derecha" | "izquierda" }) {
  const { tema, identidad } = useInforme();
  const { marca, quien } = partesDeLaIdentidad(identidad);
  if (!marca && !identidad.logotipo && quien.length === 0) return null;
  const derecha = alineada === "derecha";
  return (
    <View style={[s.asesor, derecha ? {} : { maxWidth: "70%" }]}>
      {identidad.logotipo ? (
        <View style={[s.logotipo, derecha ? {} : { alignItems: "flex-start" }]}>
          <Image src={identidad.logotipo} style={s.imagen} />
        </View>
      ) : null}
      {/* Sin entidad ni nombre, pero con un contacto (solo un correo, por ejemplo): va el contacto, que es lo que hay. */}
      {marca || quien.length ? (
        <View style={{ flexShrink: 1, alignItems: derecha ? "flex-end" : "flex-start" }}>
          {marca ? <Texto style={[s.marca, { color: TEMAS[tema].color, textAlign: derecha ? "right" : "left" }]}>{marca}</Texto> : null}
          {quien.length ? <Texto style={[s.quienTexto, { marginTop: marca ? 2 : 0, textAlign: derecha ? "right" : "left" }]}>{quien.join(" · ")}</Texto> : null}
        </View>
      ) : null}
    </View>
  );
}

function Cabecera({ documento }: { documento: string }) {
  const { tema } = useInforme();
  const { color, sello } = TEMAS[tema];
  const bajo = lineaBajoElDocumento(tema);
  return (
    <View fixed style={s.cabecera}>
      <View style={s.documento}>
        <View style={s.lineaDelDocumento}>
          <Texto style={s.nombreDelDocumento}>{documento}</Texto>
          <Text style={[s.sello, { color }]}>{sello}</Text>
        </View>
        {bajo ? <Texto style={s.noEntregar}>{bajo}</Texto> : null}
      </View>
      <IdentidadEnLaCabecera />
    </View>
  );
}

/** El pie de cada hoja, también el de la portada. */
export function Pie() {
  const { tema, identidad, destinatario, advertencia } = useInforme();
  const { color, sello } = TEMAS[tema];
  const quien = lineaDelDestinatario(tema, destinatario) ?? identidad.entidad ?? identidad.nombre;
  return (
    <View fixed style={s.pie}>
      <View style={s.pieIzquierda}>
        {quien ? <Texto style={s.pieTexto}>{`${quien} · `}</Texto> : null}
        <Text style={[s.pieSello, { color }]}>{sello}</Text>
      </View>
      <Texto style={s.pieCentro}>{advertencia}</Texto>
      <Text style={s.pieDerecha} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

/**
 * Una hoja (o una tira de hojas, si el contenido no cabe en una) con la cabecera y el pie fijos. `documento` sustituye, para
 * esta hoja, al del documento.
 */
export function Hoja({ children, apaisada = false, documento }: { children: ReactNode; apaisada?: boolean; documento?: string }) {
  const informe = useInforme();
  return (
    <Page size="A4" orientation={apaisada ? "landscape" : "portrait"} style={s.hoja}>
      <ContextoDeHoja.Provider value={{ apaisada, ancho: anchoUtil(apaisada) }}>
        <Cabecera documento={documento ?? informe.documento} />
        <Pie />
        {children}
      </ContextoDeHoja.Provider>
    </Page>
  );
}
