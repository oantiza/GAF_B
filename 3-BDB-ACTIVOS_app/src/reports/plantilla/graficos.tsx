/* eslint-disable react-refresh/only-export-components */
/**
 * Los gráficos de la plantilla, dibujados con las primitivas SVG de @react-pdf (ninguno es una imagen) y con la paleta del
 * papel de antes: la cartera en el color del tema (granate en el de cliente, acero en el interno), la referencia a trazos en
 * la tinta secundaria, y después la paleta de datos (marino o granate, oliva, ciruela, marrón y bronce).
 *
 *  - `GraficoDeLineas`: series sobre las mismas fechas. Cortes redondos en el eje, huecos que parten la línea, etiqueta
 *    directa al final de cada línea con su nombre y su último valor (sin pisarse), leyenda con dos series o más, el eje de
 *    fechas con `fechaDeEje` y, si la cartera va sola (con o sin referencia), un sombreado suave debajo de su línea.
 *  - `ListaDePartes`: las partes de un todo como las barras del papel de antes: punto de color, nombre, barra gruesa y
 *    redondeada sobre su carril, y la cifra, legible sin la barra. Un color por categoría.
 *
 * Solo dibujan lo que reciben: los cortes del eje y el aclarado de puntos son de presentación, no cifras del informe.
 */
import { Circle, G, Line, Path, Polyline, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ClaseDeAusencia } from "../../types/fichaInstrumento";
import { useHoja, useInforme } from "./contexto";
import { aclarar, colocarEtiquetas, cortesDelEje, marcasDeFechas, tramos, ultimoValor } from "./escalas";
import { FUENTE } from "./fuentes";
import { textoDelMotivo } from "./piezas";
import { Texto } from "./primitivas";
import { MEDIDAS, PAPEL, SERIES_DEL_TEMA, colorDeCategoria, colorDeSerie, type TemaDeInforme } from "./tema";
import { sanearTexto } from "./texto";

const LETRA_DEL_EJE = 6.8;
const LETRA_DEL_ROTULO = 7.7;
/* Ancho medio de una letra, en fracción del cuerpo, por lo alto (Roboto Flex anda por 0,52): para reservar sitio a los
   rótulos sin medirlos. */
const ANCHO_DE_LETRA = 0.56;
/* El sombreado de debajo de la línea de la cartera, como en el papel de antes. */
const OPACIDAD_DEL_SOMBREADO = 0.07;
const anchoDe = (texto: string, cuerpo: number) => texto.length * cuerpo * ANCHO_DE_LETRA;

const s = StyleSheet.create({
  leyenda: { flexDirection: "row", flexWrap: "wrap", marginTop: 6, marginBottom: 2 },
  marca: { flexDirection: "row", alignItems: "center", marginRight: 13.5 },
  textoDeLeyenda: { fontSize: 7.7, color: PAPEL.tinta, lineHeight: 1.3, marginLeft: 6 },
  parte: { flexDirection: "row", alignItems: "center", minHeight: 18, marginBottom: 2 },
  punto: { width: 6.5, height: 6.5, borderRadius: 3.25, marginRight: 7 },
  nombreDeParte: { fontSize: 7.7, lineHeight: 1.2, color: PAPEL.tinta2, paddingRight: 8 },
  cifraDeParte: { width: 46, textAlign: "right", fontSize: 7.7, fontWeight: 600, lineHeight: 1.3, color: PAPEL.tinta },
  parteAusente: { width: 46, textAlign: "right", fontSize: MEDIDAS.tabla.apunte, color: PAPEL.tinta3, lineHeight: 1.3 }
});

export interface SerieDeLineas {
  nombre: string;
  /** Un valor por fecha, en el mismo orden que `fechas`. `null` es un hueco: parte la línea. */
  valores: ReadonlyArray<number | null>;
  /** La referencia (lo aportado, el índice): tinta secundaria y a trazos. Las demás toman la paleta en orden, la primera en el color del tema. */
  referencia?: boolean;
  /**
   * A trazos largos, para que dos series que no son referencia no se distingan solo por el color (INF-09): impreso en gris, la
   * segunda de una comparativa se lee por su trazo. La leyenda enseña la misma muestra.
   */
  aTrazosLargos?: boolean;
}

/** El trazo de la referencia, a trazos cortos, y el de una serie a trazos largos. */
export const TRAZO_DE_LA_REFERENCIA = "4 3";
export const TRAZO_LARGO = "7 3";

interface SerieDibujada extends SerieDeLineas {
  color: string;
  grosor: number;
  /** El patrón de trazo, o ninguno si es continua. */
  trazo?: string;
}

/** El color, el grosor y el trazo de cada serie: la primera que no es referencia, en el color del tema y a 1,6; las demás, la paleta en orden. */
export function estiloDeLasSeries(series: readonly SerieDeLineas[], tema: TemaDeInforme = "cliente"): SerieDibujada[] {
  let orden = 0;
  return series.map((serie) => {
    if (serie.referencia) return { ...serie, color: SERIES_DEL_TEMA[tema].referencia, grosor: 1.2, trazo: TRAZO_DE_LA_REFERENCIA };
    const color = colorDeSerie(orden, tema);
    const grosor = orden === 0 ? 1.6 : 1.2;
    orden += 1;
    return { ...serie, color, grosor, ...(serie.aTrazosLargos ? { trazo: TRAZO_LARGO } : {}) };
  });
}

/** La muestra de una serie en la leyenda: su color y su mismo trazo. */
function MuestraDeLinea({ color, trazo }: { color: string; trazo?: string }) {
  return (
    <Svg width={17} height={6}>
      <Line x1={0} x2={17} y1={3} y2={3} stroke={color} strokeWidth={1.6} strokeDasharray={trazo} />
    </Svg>
  );
}

export interface PropiedadesDelGraficoDeLineas {
  /** Días «AAAA-MM-DD», en orden. */
  fechas: readonly string[];
  series: readonly SerieDeLineas[];
  /** Cómo se escribe un valor en la etiqueta del final de cada línea (del módulo común: `importeTitular`, `porcentaje`…). */
  formato: (valor: number) => string | null;
  /** Cómo se escribe un corte del eje. Por defecto, `formato`. */
  formatoDelEje?: (valor: number) => string | null;
  /** Alto en puntos. */
  alto?: number;
  /** Ancho en puntos. Por defecto, el de la hoja. */
  ancho?: number;
}

export function GraficoDeLineas({ fechas, series, formato, formatoDelEje = formato, alto = 180, ancho: anchoPedido }: PropiedadesDelGraficoDeLineas) {
  const { ancho: anchoDeLaHoja } = useHoja();
  const { tema } = useInforme();
  const ancho = anchoPedido ?? anchoDeLaHoja;
  const dibujadas = estiloDeLasSeries(series, tema);
  const todos = dibujadas.flatMap((serie) => serie.valores).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (fechas.length < 2 || todos.length === 0) return null;

  const cortes = cortesDelEje(Math.min(...todos), Math.max(...todos));
  const bajo = cortes[0];
  const tope = cortes[cortes.length - 1];
  const rotulosDelEje = cortes.map((corte) => sanearTexto(formatoDelEje(corte) ?? ""));
  const finales = dibujadas.map((serie) => {
    const ultimo = ultimoValor(serie.valores);
    return { serie, ultimo, nombre: sanearTexto(serie.nombre), valor: ultimo ? sanearTexto(formato(ultimo.valor) ?? "") : "" };
  });
  const margen = {
    izquierda: Math.max(24, ...rotulosDelEje.map((r) => anchoDe(r, LETRA_DEL_EJE))) + 7,
    derecha: Math.max(0, ...finales.map((f) => Math.max(anchoDe(f.nombre, LETRA_DEL_ROTULO) * 1.04, anchoDe(f.valor, LETRA_DEL_EJE)))) + 14,
    arriba: 6,
    abajo: 17
  };
  const anchoUtil = ancho - margen.izquierda - margen.derecha;
  const altoUtil = alto - margen.arriba - margen.abajo;
  const x = (i: number) => margen.izquierda + (i / (fechas.length - 1)) * anchoUtil;
  const y = (v: number) => margen.arriba + altoUtil - ((v - bajo) / (tope - bajo || 1)) * altoUtil;
  const letra = { fontFamily: FUENTE.sans, fontSize: LETRA_DEL_EJE, fill: PAPEL.tinta3 };

  const conFinal = finales.filter((f) => f.ultimo !== null);
  const alturas = colocarEtiquetas(
    conFinal.map((f) => y(f.ultimo!.valor)),
    21,
    margen.arriba + 7,
    margen.arriba + altoUtil - 10
  );
  const marcas = marcasDeFechas(fechas);
  /* El sombreado: solo si la cartera va sola entre las que no son referencia, y bajo cada tramo continuo de su línea. */
  const principales = dibujadas.filter((serie) => !serie.referencia);
  const sombreada = principales.length === 1 ? principales[0] : null;
  const suelo = margen.arriba + altoUtil;
  const sombras = sombreada
    ? tramos(sombreada.valores)
        .filter((tramo) => tramo.length > 1)
        .map((tramo) => {
          const puntos = aclarar(tramo).map((i) => `${x(i).toFixed(2)} ${y(sombreada.valores[i] as number).toFixed(2)}`);
          return `M${puntos.join(" L")} L${x(tramo[tramo.length - 1]).toFixed(2)} ${suelo.toFixed(2)} L${x(tramo[0]).toFixed(2)} ${suelo.toFixed(2)} Z`;
        })
    : [];

  return (
    <View wrap={false}>
      {dibujadas.length >= 2 ? (
        <View style={s.leyenda}>
          {dibujadas.map((serie, i) => (
            <View key={`${serie.nombre}-${i}`} style={s.marca}>
              <MuestraDeLinea color={serie.color} trazo={serie.trazo} />
              <Texto style={s.textoDeLeyenda}>{serie.nombre}</Texto>
            </View>
          ))}
        </View>
      ) : null}
      <Svg width={ancho} height={alto} style={{ marginTop: 4 }}>
        {cortes.map((corte, i) => (
          <G key={`corte-${corte}`}>
            <Line
              x1={margen.izquierda}
              x2={margen.izquierda + anchoUtil}
              y1={y(corte)}
              y2={y(corte)}
              stroke={i === 0 ? PAPEL.fileteFuerte : PAPEL.rejilla}
              strokeWidth={i === 0 ? 0.7 : 0.6}
            />
            <Text style={letra} x={margen.izquierda - 6} y={y(corte) + 2.6} textAnchor="end">
              {rotulosDelEje[i]}
            </Text>
          </G>
        ))}
        {marcas.map((marca) => {
          const mitad = anchoDe(marca.texto, LETRA_DEL_EJE) / 2;
          const centro = Math.min(Math.max(x(marca.indice), margen.izquierda + mitad), margen.izquierda + anchoUtil + margen.derecha - mitad);
          return (
            <G key={`marca-${marca.indice}`}>
              <Line x1={x(marca.indice)} x2={x(marca.indice)} y1={margen.arriba + altoUtil} y2={margen.arriba + altoUtil + 3} stroke={PAPEL.fileteFuerte} strokeWidth={0.75} />
              <Text style={letra} x={centro} y={alto - 3} textAnchor="middle">
                {marca.texto}
              </Text>
            </G>
          );
        })}
        {sombreada ? sombras.map((d, k) => <Path key={`sombra-${k}`} d={d} fill={sombreada.color} fillOpacity={OPACIDAD_DEL_SOMBREADO} stroke="none" />) : null}
        {dibujadas.map((serie, k) =>
          tramos(serie.valores).map((tramo, t) =>
            tramo.length === 1 ? (
              <Circle key={`s${k}-t${t}`} cx={x(tramo[0])} cy={y(serie.valores[tramo[0]] as number)} r={serie.grosor * 0.6} fill={serie.color} />
            ) : (
              <Polyline
                key={`s${k}-t${t}`}
                points={aclarar(tramo)
                  .map((i) => `${x(i).toFixed(2)},${y(serie.valores[i] as number).toFixed(2)}`)
                  .join(" ")}
                fill="none"
                stroke={serie.color}
                strokeWidth={serie.grosor}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={serie.trazo}
              />
            )
          )
        )}
        {conFinal.map((final, k) => {
          const { indice, valor } = final.ultimo!;
          const xEtiqueta = margen.izquierda + anchoUtil + 7;
          return (
            <G key={`final-${k}`}>
              <Circle cx={x(indice)} cy={y(valor)} r={2.1} fill={final.serie.color} stroke={PAPEL.blanco} strokeWidth={0.9} />
              <Text style={{ ...letra, fontSize: LETRA_DEL_ROTULO, fontWeight: 600, fill: PAPEL.tinta }} x={xEtiqueta} y={alturas[k] - 1}>
                {final.nombre}
              </Text>
              <Text style={{ ...letra, fill: PAPEL.tinta2 }} x={xEtiqueta} y={alturas[k] + 8.5}>
                {final.valor}
              </Text>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

export interface ParteDelTodo {
  nombre: string;
  /** La parte, como fracción del todo (0,24 es un 24 %): da el largo de la barra. `null` si falta, o si no lleva barra. */
  fraccion: number | null;
  /** La cifra ya escrita («24,0 %», «48.250 €»). `null` si falta. */
  cifra: string | null;
  /** El color de la barra y del punto. Por defecto, el de su categoría en orden (`colorDeCategoria`); «Otros», en gris (`SIN_CLASIFICAR`). */
  color?: string;
  motivo?: ClaseDeAusencia | string;
}

/** El ancho de la cifra de cada parte. */
const ANCHO_DE_LA_CIFRA = 46;

/** El color de cada parte: el suyo si lo trae; si no, el de su categoría en orden, contando solo las que no lo traen. */
export function coloresDeLasPartes(partes: ReadonlyArray<Pick<ParteDelTodo, "color">>): string[] {
  let orden = 0;
  return partes.map((parte) => parte.color ?? colorDeCategoria(orden++));
}

/**
 * Las partes de un todo como las barras del papel de antes: punto de color, nombre, barra gruesa y redondeada sobre su carril
 * y la cifra. Cada categoría lleva su color, en orden; la barra más larga es la parte mayor, y la cifra se lee sin la barra.
 * Una parte negativa (una posición corta) no dibuja barra.
 */
export function ListaDePartes({ partes, anchoDeBarra, ancho: anchoPedido }: { partes: readonly ParteDelTodo[]; anchoDeBarra?: number; ancho?: number }) {
  /* En una hoja apaisada, a todo lo ancho, el nombre quedaría lejos de su barra: la lista no pasa de 440 puntos. */
  const hoja = useHoja();
  const ancho = anchoPedido ?? Math.min(hoja.ancho, 440);
  const barra = anchoDeBarra ?? Math.min(200, ancho * 0.42);
  const anchoDelNombre = Math.max(60, ancho - barra - ANCHO_DE_LA_CIFRA - 6.5 - 7 - 6);
  const mayor = Math.max(0, ...partes.map((parte) => (typeof parte.fraccion === "number" && Number.isFinite(parte.fraccion) ? parte.fraccion : 0)));
  const colores = coloresDeLasPartes(partes);
  return (
    <View style={{ marginTop: 6, width: ancho }}>
      {partes.map((parte, i) => {
        const fraccion = typeof parte.fraccion === "number" && Number.isFinite(parte.fraccion) && mayor > 0 ? Math.max(0, parte.fraccion) / mayor : 0;
        const color = colores[i];
        return (
          <View key={`${parte.nombre}-${i}`} style={s.parte} wrap={false}>
            <View style={[s.punto, { backgroundColor: color }]} />
            <Texto style={[s.nombreDeParte, { width: anchoDelNombre }]}>{parte.nombre}</Texto>
            <Svg width={barra} height={8}>
              <Rect x={0} y={0} width={barra} height={8} rx={4} ry={4} fill={PAPEL.carril} />
              {fraccion > 0 ? <Rect x={0} y={0} width={Math.max(8, barra * fraccion)} height={8} rx={4} ry={4} fill={color} /> : null}
            </Svg>
            {parte.cifra !== null ? <Texto style={s.cifraDeParte}>{parte.cifra}</Texto> : <Texto style={s.parteAusente}>{textoDelMotivo(parte.motivo)}</Texto>}
          </View>
        );
      })}
    </View>
  );
}
