/**
 * Los tres gráficos propios del informe de cliente, que la plantilla no tiene: el mapa del mundo, el mapa de riesgo y rentabilidad y la
 * matriz de solapamiento. Dibujados con las primitivas SVG de @react-pdf y los colores del papel de antes (`tinta.ts`): el mapa con un
 * color por zona y su tira de cifras debajo; la composición en el granate del tema con su aro de bronce, y las carteras de referencia en
 * gris y a trazos; la matriz en la rampa de bronce, con la cifra siempre impresa. Solo dibujan lo que reciben: ninguna cifra se calcula aquí.
 */
import { Circle, G, Line, Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { GEO_AREAS, GEO_VIEWBOX_BOX } from "../../charts/worldMapGeo";
import { rentabilidadDeLaLinea } from "../../core/lecturaDelMapa";
import { cotaDelSolapamiento } from "../../core/overlap";
import { porcentaje } from "../../core/formato";
import type { ReferenceProfile } from "../../core/benchmarkProfiles";
import { FUENTE, PAPEL, TEMAS, Texto, useHoja } from "../plantilla";
import type { CifraDelMapa } from "../../core/repartoDelInforme";
import { MATRIZ, nombreEnLineas, pasoDeLaMatriz, type ConoDelInforme, type FronteraDelInforme, type Medidor } from "./datos";
import { colorDeLaCifra, RAMPA_DE_LA_MATRIZ, rellenoDeLaZona, tintaSobreElPaso } from "./tinta";

const LETRA_DEL_EJE = 6.8;
const LETRA_DEL_ROTULO = 7.4;
/* El gris de las carteras de referencia del papel de antes: 3,6:1 sobre el papel, como elemento gráfico. */
const GRIS_DE_REFERENCIA = "#818B8E";
/* Sus rótulos, en un gris de texto (6,4:1). */
const TEXTO_DE_REFERENCIA = "#556168";

const s = StyleSheet.create({
  leyenda: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", marginTop: 2 },
  marca: { flexDirection: "row", alignItems: "center", marginLeft: 9, marginBottom: 2 },
  muestra: { width: 7, height: 7, marginRight: 3 },
  textoDeLeyenda: { fontSize: LETRA_DEL_EJE, color: PAPEL.tinta2, lineHeight: 1.3 },
  cifras: { flexDirection: "row", marginTop: 8 },
  cifra: { flex: 1, minHeight: 38, paddingTop: 7, paddingHorizontal: 7, borderTopWidth: 1.6 },
  rotuloDeCifra: { fontSize: 7, color: PAPEL.tinta2, lineHeight: 1.2 },
  valorDeCifra: { fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: 12.5, lineHeight: 1.2, marginTop: 3, color: PAPEL.tinta },
  filaDeNombre: { flexDirection: "row", alignItems: "center", borderBottomWidth: 0.55, borderBottomColor: PAPEL.rejilla },
  numero: { width: MATRIZ.anchoDelNumero, fontSize: LETRA_DEL_EJE, fontWeight: 600, color: TEMAS.cliente.tono },
  /* Sin `textOverflow`: el «…» de @react-pdf aprieta la última línea hasta juntar las palabras. Las líneas las corta `nombreEnLineas`. */
  nombre: { flex: 1, paddingRight: MATRIZ.holguraDelNombre, lineHeight: MATRIZ.interlinea, color: PAPEL.tinta }
});

/* ------------------------------------------------------------------------------------------------ El cono estadístico */

/**
 * El cono estadístico: de hoy al final del plazo, la franja clara (nueve de cada diez resultados), la oscura (la mitad) y la línea central a
 * trazos, en el granate del tema; una línea fina marca el valor de hoy, para que se vea qué parte del cono queda por debajo. A la derecha,
 * los tres casos con su cifra. Solo dibuja lo que recibe (`prepararElCono`): la escala es visual y no se imprime como cifra.
 */
export function ConoEstadistico({ cono }: { cono: ConoDelInforme }) {
  const { ancho } = useHoja();
  const color = TEMAS.cliente.color;
  /* Alto del papel de antes: la hoja del cono quedaba a media llenar con 138, y el cono casi plano no se leía (16-11-2026). */
  const alto = 170;
  const izquierda = 4;
  const derecha = ancho - 112;
  const arriba = 10;
  const abajo = alto - 18;
  const puntos = cono.puntos;
  const ultimo = puntos.length - 1;
  const minimo = Math.min(cono.base, ...puntos.map((punto) => punto.p5));
  const maximo = Math.max(cono.base, ...puntos.map((punto) => punto.p95));
  const holgura = (maximo - minimo || 1) * 0.06;
  const x = (i: number) => izquierda + (i / Math.max(1, ultimo)) * (derecha - izquierda);
  const y = (valor: number) => abajo - ((valor - (minimo - holgura)) / (maximo - minimo + holgura * 2)) * (abajo - arriba);
  const franja = (alta: "p95" | "p75", baja: "p5" | "p25") =>
    `${puntos.map((punto, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(punto[alta]).toFixed(1)}`).join(" ")} ${[...puntos].reverse().map((punto, k) => `L${x(ultimo - k).toFixed(1)} ${y(punto[baja]).toFixed(1)}`).join(" ")} Z`;
  const central = puntos.map((punto, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(punto.p50).toFixed(1)}`).join(" ");
  const final = puntos[ultimo];
  /* Los tres rótulos de la derecha, sin pisarse: al menos 15 puntos entre uno y otro. */
  const alturas = [y(final.p95), y(final.p50), y(final.p5)];
  if (alturas[1] - alturas[0] < 15) alturas[0] = alturas[1] - 15;
  if (alturas[2] - alturas[1] < 15) alturas[2] = alturas[1] + 15;
  const casos = [
    { titulo: "Caso favorable", caso: cono.favorable, altura: alturas[0], borde: y(final.p95) },
    { titulo: "Caso central", caso: cono.central, altura: alturas[1], borde: y(final.p50) },
    { titulo: "Caso desfavorable", caso: cono.desfavorable, altura: alturas[2], borde: y(final.p5) }
  ];
  /* El filo de la franja clara, a trazos: sin él el cono se deshace en el papel, que es donde menos contraste hay. */
  const filo = (cual: "p5" | "p95") => puntos.map((punto, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(punto[cual]).toFixed(1)}`).join(" ");
  const letra = { fontFamily: FUENTE.sans, fontSize: LETRA_DEL_EJE, fill: PAPEL.tinta2 };
  return (
    <View wrap={false} style={{ marginTop: 6 }}>
      <Svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`}>
        <Path d={franja("p95", "p5")} fill={color} fillOpacity={0.12} stroke="none" />
        <Path d={franja("p75", "p25")} fill={color} fillOpacity={0.2} stroke="none" />
        {/* El valor de hoy: lo que queda por debajo de esta línea es perder. */}
        <Line x1={izquierda} y1={y(cono.base)} x2={derecha} y2={y(cono.base)} stroke={PAPEL.tinta2} strokeWidth={0.6} strokeDasharray="1.5 2.5" />
        <Path d={filo("p95")} fill="none" stroke={color} strokeWidth={0.6} strokeOpacity={0.5} strokeDasharray="2.5 2" />
        <Path d={filo("p5")} fill="none" stroke={color} strokeWidth={0.6} strokeOpacity={0.5} strokeDasharray="2.5 2" />
        <Path d={central} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray="5 3" />
        <Line x1={izquierda} y1={abajo} x2={derecha} y2={abajo} stroke={PAPEL.filete} strokeWidth={0.6} />
        {Array.from({ length: cono.anos + 1 }, (_, i) => (
          <Text key={i} x={x(Math.round((ultimo * i) / cono.anos))} y={alto - 6} textAnchor={i === 0 ? "start" : i === cono.anos ? "end" : "middle"} style={letra}>
            {i === 0 ? `Hoy · ${cono.hoy}` : i === 1 ? "a 1 año" : `a ${i} años`}
          </Text>
        ))}
        {casos.map(({ titulo, caso, altura, borde }) => (
          <G key={titulo}>
            {/* El hilo que lleva del filo del cono a su rótulo, como en el papel de antes: el rótulo se separa para no pisarse. */}
            <Line x1={derecha} y1={borde} x2={derecha + 4} y2={altura + 3} stroke={PAPEL.tinta3} strokeWidth={0.5} />
            <Text x={derecha + 6} y={altura - 1} style={{ ...letra, fontSize: LETRA_DEL_EJE - 0.4 }}>{titulo}</Text>
            <Text x={derecha + 6} y={altura + 7.5} style={{ fontFamily: FUENTE.sans, fontSize: LETRA_DEL_ROTULO, fontWeight: 600, fill: PAPEL.tinta }}>{`${caso.valor} (${caso.variacion})`}</Text>
          </G>
        ))}
      </Svg>
      <View style={[s.leyenda, { justifyContent: "flex-start", marginTop: 4 }]}>
        <View style={[s.marca, { marginLeft: 0 }]}><View style={[s.muestra, { backgroundColor: color, opacity: 0.32 }]} /><Texto style={s.textoDeLeyenda}>La mitad de los resultados</Texto></View>
        <View style={s.marca}><View style={[s.muestra, { backgroundColor: color, opacity: 0.12 }]} /><Texto style={s.textoDeLeyenda}>Nueve de cada diez</Texto></View>
        <View style={s.marca}><View style={{ width: 12, height: 0, borderTopWidth: 1.4, borderTopColor: color, borderStyle: "dashed", marginRight: 3 }} /><Texto style={s.textoDeLeyenda}>Caso central</Texto></View>
        <View style={s.marca}><View style={{ width: 12, height: 0, borderTopWidth: 0.6, borderTopColor: PAPEL.tinta2, borderStyle: "dotted", marginRight: 3 }} /><Texto style={s.textoDeLeyenda}>Valor de hoy</Texto></View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ El mapa del mundo */

/**
 * El mapa del mundo, como en el papel de antes: cada zona con su color, la leyenda de las zonas encima, y debajo la tira de cifras
 * (como mucho cinco, de `cifrasDelMapa`), cada una con el filete del color de su zona, que suman lo mismo que lo que el mapa reparte.
 * El color identifica la zona; la cifra va escrita.
 */
export function MapaDelMundo({ totales, cifras }: { totales: Record<string, number>; cifras: readonly CifraDelMapa[] }) {
  const { ancho } = useHoja();
  const caja = GEO_VIEWBOX_BOX;
  const alto = Math.round((ancho * caja.h) / caja.w);
  return (
    <View wrap={false}>
      <View style={s.leyenda}>
        {cifras.map((cifra) => (
          <View key={cifra.id} style={s.marca}>
            <View style={[s.muestra, { backgroundColor: colorDeLaCifra(cifra) }]} />
            <Texto style={s.textoDeLeyenda}>{cifra.label}</Texto>
          </View>
        ))}
      </View>
      <Svg style={{ marginTop: 6 }} width={ancho} height={alto} viewBox={`${caja.x} ${caja.y} ${caja.w} ${caja.h}`}>
        {GEO_AREAS.map((area) => (
          <Path key={area.id} d={area.d} fill={rellenoDeLaZona(area.id, totales[area.id] || 0, cifras)} stroke={PAPEL.blanco} strokeWidth={1.25} />
        ))}
      </Svg>
      <View style={s.cifras}>
        {cifras.map((cifra) => (
          <View key={cifra.id} style={[s.cifra, { borderTopColor: colorDeLaCifra(cifra) }]}>
            <Texto style={s.rotuloDeCifra}>{cifra.label}</Texto>
            <Texto style={s.valorDeCifra}>{porcentaje(cifra.value / 100, { decimales: 1 }) ?? ""}</Texto>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------------------- Los ejes de la frontera y del mapa de riesgo */

/** Los cortes del eje: redondos, con aire alrededor de cada punto. */
function ejeDelMapa(valores: number[], pasoMinimo: number, noNegativo = false) {
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  const bruto = (maximo - minimo) / 4 || pasoMinimo;
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const factor = [1, 2, 2.5, 3, 5, 10].find((valor) => valor * magnitud >= bruto) ?? 10;
  const paso = Math.max(pasoMinimo, factor * magnitud);
  const aire = (maximo - minimo) * 0.04 || paso * 0.2;
  const bajo = Math.floor((minimo - aire) / paso) * paso;
  const min = noNegativo ? Math.max(0, bajo) : bajo;
  const max = Math.ceil((maximo + aire) / paso) * paso;
  const cortes = Array.from({ length: Math.round((max - min) / paso) + 1 }, (_, i) => Number((min + i * paso).toPrecision(12)));
  return { min, max, cortes, paso };
}

/** Un corte del eje en porcentaje, con los decimales que pida su paso: «6 %», «2,5 %». */
const corteEnPorcentaje = (valor: number, paso: number) => porcentaje(valor, { decimales: Math.abs(paso * 100 - Math.round(paso * 100)) > 1e-9 ? 1 : 0 }) ?? "";

/* ------------------------------------------------------------------------------------------------ La frontera eficiente */

/**
 * La frontera eficiente histórica: la curva en bronce, el punto de menor oscilación y el de mejor relación entre rentabilidad y riesgo,
 * y, si se sitúa, la cartera en granate con su aro. **Con cifras en los dos ejes** (Óscar, 16-11-2026, al recuperarla): la curva de
 * aquel papel no tenía ninguna, y sin escala no se puede leer qué riesgo ni qué rentabilidad marca cada punto. Los ejes usan los mismos
 * cortes redondos que el mapa de riesgo (`ejeDelMapa`), para que los dos gráficos se lean igual.
 */
export function FronteraEficiente({ frontera }: { frontera: FronteraDelInforme }) {
  const { ancho } = useHoja();
  const { curva, minVol, maxSharpe, cartera } = frontera;
  const puntos = [...curva, minVol, maxSharpe, ...(cartera ? [{ vol: cartera.vol, ret: cartera.ret }] : [])];
  const ejeX = ejeDelMapa(puntos.map((punto) => punto.vol), 0.02, true);
  const ejeY = ejeDelMapa(puntos.map((punto) => punto.ret), 0.02);
  /* Alto medido para que la frontera y el cono quepan juntos en una hoja, como la 05 del papel del 02-11 («Optimización y
     proyección»): con 196 el cono se iba a la siguiente por unos pocos puntos. */
  const alto = 158;
  const { color: granate, filete: bronce } = TEMAS.cliente;
  const izquierda = 44;
  const derecha = ancho - 14;
  const arriba = 14;
  const abajo = 112;
  const x = (valor: number) => izquierda + ((valor - ejeX.min) / (ejeX.max - ejeX.min || 1)) * (derecha - izquierda);
  const y = (valor: number) => abajo - ((valor - ejeY.min) / (ejeY.max - ejeY.min || 1)) * (abajo - arriba);
  const letra = { fontFamily: FUENTE.sans, fontSize: LETRA_DEL_EJE, fill: PAPEL.tinta3 };
  const trazo = curva.map((punto, i) => `${i === 0 ? "M" : "L"}${x(punto.vol).toFixed(1)} ${y(punto.ret).toFixed(1)}`).join(" ");
  const leyendaY = alto - 8;
  return (
    <View wrap={false} style={{ marginTop: 6 }}>
      <Svg width={ancho} height={alto}>
        {ejeY.cortes.map((corte, i) => (
          <G key={`y-${corte}`}>
            <Line x1={izquierda} x2={derecha} y1={y(corte)} y2={y(corte)} stroke={i === 0 ? PAPEL.fileteFuerte : PAPEL.rejilla} strokeWidth={0.7} />
            <Text style={letra} x={izquierda - 6} y={y(corte) + 2.6} textAnchor="end">{corteEnPorcentaje(corte, ejeY.paso)}</Text>
          </G>
        ))}
        {ejeX.cortes.map((corte) => (
          <G key={`x-${corte}`}>
            <Line x1={x(corte)} x2={x(corte)} y1={abajo} y2={abajo + 3} stroke={PAPEL.fileteFuerte} strokeWidth={0.75} />
            <Text style={letra} x={x(corte)} y={abajo + 13} textAnchor="middle">{corteEnPorcentaje(corte, ejeX.paso)}</Text>
          </G>
        ))}
        <Text style={letra} x={(izquierda + derecha) / 2} y={abajo + 26} textAnchor="middle">Riesgo (volatilidad)</Text>
        <Text style={letra} x={0} y={8}>Rentabilidad</Text>
        <Path d={trazo} fill="none" stroke={bronce} strokeWidth={1.6} />
        <Circle cx={x(minVol.vol)} cy={y(minVol.ret)} r={3.6} fill={GRIS_DE_REFERENCIA} />
        <Circle cx={x(maxSharpe.vol)} cy={y(maxSharpe.ret)} r={3.6} fill={bronce} />
        {cartera ? (
          <>
            <Circle cx={x(cartera.vol)} cy={y(cartera.ret)} r={6} fill={granate} stroke={bronce} strokeWidth={1.7} />
            <Text
              style={{ ...letra, fontSize: LETRA_DEL_ROTULO, fontWeight: 600, fill: granate }}
              x={Math.min(Math.max(x(cartera.vol), izquierda + 30), derecha - 30)}
              y={y(cartera.ret) - 11}
              textAnchor="middle"
            >{cartera.rotulo}</Text>
          </>
        ) : null}
        {cartera ? (
          <>
            <Circle cx={izquierda + 4} cy={leyendaY - 2.6} r={4.2} fill={granate} stroke={bronce} strokeWidth={1.2} />
            <Text style={{ ...letra, fill: PAPEL.tinta2 }} x={izquierda + 12} y={leyendaY}>{cartera.rotulo}</Text>
          </>
        ) : null}
        <Circle cx={izquierda + (cartera ? 110 : 4)} cy={leyendaY - 2.6} r={4.2} fill={bronce} />
        <Text style={{ ...letra, fill: PAPEL.tinta2 }} x={izquierda + (cartera ? 118 : 12)} y={leyendaY}>Mejor relación rentabilidad-riesgo</Text>
        <Circle cx={izquierda + (cartera ? 258 : 152)} cy={leyendaY - 2.6} r={4.2} fill={GRIS_DE_REFERENCIA} />
        <Text style={{ ...letra, fill: PAPEL.tinta2 }} x={izquierda + (cartera ? 266 : 160)} y={leyendaY}>Menor oscilación</Text>
      </Svg>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ El mapa de riesgo y rentabilidad */

/**
 * El mapa en sí: las carteras de referencia (rombos grises unidos por una línea a trazos) y, si la hay, la composición simulada (punto
 * granate con aro de bronce y su rótulo). Con `comparable`, la distancia vertical de la composición a la línea, a trazos de bronce.
 */
export function MapaDeRiesgo({ portfolio, profiles: referencias, comparable }: { portfolio: { vol: number; ret: number } | null; profiles: readonly ReferenceProfile[]; comparable: boolean }) {
  const { ancho } = useHoja();
  const perfiles = [...referencias].sort((a, b) => a.vol - b.vol);
  const vols = perfiles.map((perfil) => perfil.vol);
  const rets = perfiles.map((perfil) => perfil.ret);
  if (portfolio) {
    vols.push(portfolio.vol);
    rets.push(portfolio.ret);
  }
  if (vols.length === 0) return null;
  const ejeX = ejeDelMapa(vols, 0.03, true);
  const ejeY = ejeDelMapa(rets, 0.05);
  const alto = 214;
  const { color: granate, filete: bronce } = TEMAS.cliente;
  const izquierda = 44;
  const derecha = ancho - 14;
  const arriba = 20;
  const abajo = 162;
  const x = (valor: number) => izquierda + ((valor - ejeX.min) / (ejeX.max - ejeX.min || 1)) * (derecha - izquierda);
  const y = (valor: number) => abajo - ((valor - ejeY.min) / (ejeY.max - ejeY.min || 1)) * (abajo - arriba);
  const letra = { fontFamily: FUENTE.sans, fontSize: LETRA_DEL_EJE, fill: PAPEL.tinta3 };
  const curva = perfiles.map((perfil, i) => `${i === 0 ? "M" : "L"}${x(perfil.vol).toFixed(1)} ${y(perfil.ret).toFixed(1)}`).join(" ");
  const rombo = (cx: number, cy: number, radio = 4) => `M${cx} ${cy - radio} L${cx + radio} ${cy} L${cx} ${cy + radio} L${cx - radio} ${cy} Z`;
  const enLaLinea = portfolio ? rentabilidadDeLaLinea(portfolio.vol, perfiles) : null;
  const leyendaY = alto - 8;
  return (
    <View wrap={false} style={{ marginTop: 6 }}>
      <Svg width={ancho} height={alto}>
        {ejeY.cortes.map((corte, i) => (
          <G key={`y-${corte}`}>
            <Line x1={izquierda} x2={derecha} y1={y(corte)} y2={y(corte)} stroke={i === 0 ? PAPEL.fileteFuerte : PAPEL.rejilla} strokeWidth={0.7} />
            <Text style={letra} x={izquierda - 6} y={y(corte) + 2.6} textAnchor="end">{corteEnPorcentaje(corte, ejeY.paso)}</Text>
          </G>
        ))}
        {ejeX.cortes.map((corte) => (
          <G key={`x-${corte}`}>
            <Line x1={x(corte)} x2={x(corte)} y1={abajo} y2={abajo + 3} stroke={PAPEL.fileteFuerte} strokeWidth={0.75} />
            <Text style={letra} x={x(corte)} y={abajo + 13} textAnchor="middle">{corteEnPorcentaje(corte, ejeX.paso)}</Text>
          </G>
        ))}
        <Text style={letra} x={(izquierda + derecha) / 2} y={abajo + 26} textAnchor="middle">Riesgo (volatilidad)</Text>
        <Text style={letra} x={0} y={8}>Rentabilidad</Text>
        {perfiles.length ? <Path d={curva} fill="none" stroke={GRIS_DE_REFERENCIA} strokeWidth={1} strokeDasharray="3 3" /> : null}
        {portfolio && enLaLinea !== null && comparable ? (
          <>
            <Line x1={x(portfolio.vol)} y1={y(portfolio.ret)} x2={x(portfolio.vol)} y2={y(enLaLinea)} stroke={bronce} strokeWidth={1.25} strokeDasharray="2 2" />
            <Path d={rombo(x(portfolio.vol), y(enLaLinea), 3.5)} fill={PAPEL.blanco} stroke={bronce} strokeWidth={1.2} />
          </>
        ) : null}
        {perfiles.map((perfil) => <Path key={perfil.id} d={rombo(x(perfil.vol), y(perfil.ret), 4.2)} fill={GRIS_DE_REFERENCIA} />)}
        {perfiles.map((perfil) => {
          /* Con pesos fijados la composición puede caer encima de una referencia (decisión 39), y su punto taparía el rótulo: entonces va
             debajo. El rótulo sale a la derecha del rombo, salvo el de Agresivo, que sale a la izquierda. */
          const distancia = portfolio ? x(portfolio.vol) - x(perfil.vol) : Number.POSITIVE_INFINITY;
          const izquierdo = perfil.id === "agresivo";
          const tapado = portfolio !== null && Math.abs(y(portfolio.ret) - y(perfil.ret)) < 11 && (izquierdo ? distancia > -55 && distancia < 1 : distancia > -1 && distancia < 55);
          return (
            <Text
              key={`${perfil.id}-rotulo`}
              style={{ ...letra, fill: TEXTO_DE_REFERENCIA }}
              x={tapado ? x(perfil.vol) : izquierdo ? x(perfil.vol) - 7 : x(perfil.vol) + 7}
              y={tapado ? y(perfil.ret) + 14 : y(perfil.ret) + 2.6}
              textAnchor={tapado ? "middle" : izquierdo ? "end" : "start"}
            >{perfil.label}</Text>
          );
        })}
        {portfolio ? (
          <>
            <Circle cx={x(portfolio.vol)} cy={y(portfolio.ret)} r={6.2} fill={granate} stroke={bronce} strokeWidth={1.7} />
            <Text style={{ ...letra, fontSize: LETRA_DEL_ROTULO, fontWeight: 600, fill: granate }} x={Math.min(Math.max(x(portfolio.vol), izquierda + 50), derecha - 50)} y={y(portfolio.ret) - 11} textAnchor="middle">Composición simulada</Text>
          </>
        ) : null}
        {portfolio ? (
          <>
            <Circle cx={izquierda + 4} cy={leyendaY - 2.6} r={4.2} fill={granate} stroke={bronce} strokeWidth={1.2} />
            <Text style={{ ...letra, fill: PAPEL.tinta2 }} x={izquierda + 12} y={leyendaY}>Composición simulada</Text>
          </>
        ) : null}
        {perfiles.length ? (
          <>
            <Path d={rombo(izquierda + (portfolio ? 120 : 4), leyendaY - 2.6, 4)} fill={GRIS_DE_REFERENCIA} />
            <Text style={{ ...letra, fill: PAPEL.tinta2 }} x={izquierda + (portfolio ? 128 : 12)} y={leyendaY}>Carteras de referencia</Text>
          </>
        ) : null}
      </Svg>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ La matriz de solapamiento */

/**
 * La matriz: el nombre de cada fondo en su fila, numerado, y a la derecha las casillas, con la cifra impresa en cada cruce que la tiene y
 * el tono de su paso detrás. En blanco, la diagonal y lo que no llega al umbral.
 */
export function MatrizDeSolapamiento({ nombres, valores, casilla, mide }: { nombres: readonly string[]; valores: ReadonlyArray<ReadonlyArray<number | null>>; casilla: number; mide: Medidor }) {
  const n = nombres.length;
  const lado = n * casilla;
  const anchoDeLosNombres = MATRIZ.ancho - lado - 10;
  const cuerpoDeLaCifra = casilla >= 32 ? 7.9 : 7.4;
  const anchoDelTexto = anchoDeLosNombres - MATRIZ.anchoDelNumero - MATRIZ.holguraDelNombre - 1;
  /* El nombre va a 7,9 si todos caben enteros en las líneas de su fila; si alguno no, a 7,4, que en una casilla baja deja una línea más. */
  const enLineas = (cuerpo: number) => {
    const maxLineas = Math.max(1, Math.floor((casilla - 2) / (cuerpo * MATRIZ.interlinea)));
    return nombres.map((nombre) => nombreEnLineas(nombre, anchoDelTexto, maxLineas, (texto) => mide(texto, cuerpo)));
  };
  const aLoGrande = enLineas(7.9);
  const cabenEnteros = aLoGrande.every((lineas) => !lineas[lineas.length - 1]?.endsWith("…"));
  const cuerpoDelNombre = cabenEnteros ? 7.9 : 7.4;
  const lineas = cabenEnteros ? aLoGrande : enLineas(7.4);
  const letra = { fontFamily: FUENTE.sans };
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
      <View style={{ width: anchoDeLosNombres }}>
        <View style={{ height: MATRIZ.cabecera }} />
        {nombres.map((_nombre, i) => (
          <View key={i} style={[s.filaDeNombre, { height: casilla }, i === 0 ? { borderTopWidth: 0.75, borderTopColor: PAPEL.filete } : {}]}>
            <Text style={[s.numero, { fontFamily: FUENTE.sans, fontSize: cuerpoDelNombre }]}>{String(i + 1)}</Text>
            <Texto style={[s.nombre, { fontSize: cuerpoDelNombre }]}>{lineas[i].join("\n")}</Texto>
          </View>
        ))}
      </View>
      <Svg width={lado} height={MATRIZ.cabecera + lado}>
        {nombres.map((_nombre, j) => (
          <Text key={`c${j}`} x={(j + 0.5) * casilla} y={8.5} textAnchor="middle" style={{ ...letra, fontSize: 7, fontWeight: 600, fill: TEMAS.cliente.tono }}>{String(j + 1)}</Text>
        ))}
        {valores.flatMap((fila, i) => fila.map((valor, j) => {
          const x = j * casilla;
          const y = MATRIZ.cabecera + i * casilla;
          const paso = valor === null ? null : pasoDeLaMatriz(valor);
          const tinta = paso === null ? PAPEL.tinta : tintaSobreElPaso(paso);
          const cota = valor === null ? null : cotaDelSolapamiento(valor);
          return (
            <G key={`${i}-${j}`}>
              <Rect x={x + 0.75} y={y + 0.75} width={casilla - 1.5} height={casilla - 1.5} rx={1} fill={paso === null ? PAPEL.blanco : RAMPA_DE_LA_MATRIZ[paso]}
                stroke={paso === null ? PAPEL.filete : undefined} strokeWidth={paso === null ? 0.55 : 0} />
              {cota ? (
                <>
                  <Text x={x + casilla / 2} y={y + casilla / 2 - 1.8} textAnchor="middle" style={{ ...letra, fontSize: 6.3, fill: tinta }}>{cota.antes}</Text>
                  <Text x={x + casilla / 2} y={y + casilla / 2 + 7} textAnchor="middle" style={{ ...letra, fontSize: cuerpoDeLaCifra, fontWeight: 500, fill: tinta }}>{cota.cifra}</Text>
                </>
              ) : null}
            </G>
          );
        }))}
      </Svg>
    </View>
  );
}
