/* eslint-disable react-refresh/only-export-components -- PDF components are rendered on demand, outside the browser React tree. */
/**
 * «Su ingreso en la jubilación», en la plantilla única (tema cliente), con el nombre «Simulación de jubilación» en la
 * cabecera. Sus cuentas son las de la pantalla: salen de `core/jubilacion/lectura`, no de aquí.
 *
 * Lo que fijó Óscar el 13-11-2026 manda sobre el orden: primero la respuesta (lo que le queda al cliente al mes, la cifra
 * en grande, con las pocas líneas que la explican y los escenarios en frases) y después las cuentas, que aquí son el
 * anexo: el plan año a año, el cobro si lo hay, las cuentas del primer año y el método. Es una simulación, y lo dice junto
 * a la cifra y en el pie de cada hoja; no es asesoramiento fiscal ni una recomendación.
 *
 * Los dos gráficos (las barras apiladas del ingreso y las líneas de los saldos) son de este documento: la plantilla no
 * los tiene. Van con sus colores: la pensión en acero, los ahorros en oliva, y los escenarios con su trazo propio, para
 * que se distingan también impresos en gris.
 */
import { G, Line, Polyline, Rect, Svg, Text as TextoDeSvg, View } from "@react-pdf/renderer";
import { descargar, diaDelDocumento, nombreDelFichero } from "../core/descargaDeFicheros";
import { fechaLarga, importeTitular, oFalta, porcentaje } from "../core/formato";
import { consultaFuentes, resumenParametros } from "../core/jubilacion/fiscal";
import {
  cortesDelEje,
  datosDeLaSimulacion,
  divisorDe,
  duracion,
  frasesDeEscenarios,
  libroDelPrimerAnio,
  mapaFiscal,
  metodo,
  NOMBRE_DE_LAS_UNIDADES,
  procedenciaFiscal,
  reglasEnElTiempo,
  respuestaAlMes,
  saldoAlCierre,
  serieDeIngresos,
  serieDeSaldos,
  type FormaComparada,
  type LecturaDeSupervivencia,
  type PuntoDeIngresos,
  type PuntoDeSaldos,
  type Unidades
} from "../core/jubilacion/lectura";
import type { ClaveDeEscenario, ResultadoDisponible } from "../core/jubilacion/motor";
import { firmaDelInforme } from "./firmaDelInforme";
import { Apunte, Subtitulo } from "./textosDelInforme";
import {
  Aviso,
  COLORES_DE_DATOS,
  DocumentoDeInforme,
  FUENTE,
  HojasDeSecciones,
  MEDIDAS,
  Nota,
  PAPEL,
  Parrafo,
  Presentacion,
  Rejilla,
  SERIES,
  Tabla,
  Texto,
  TEMAS,
  colorDeSerie,
  renderizarInforme,
  useHoja,
  type FilaDeTabla,
  type SeccionDeInforme
} from "./plantilla";

export interface InformeDeJubilacionInput {
  resultado: ResultadoDisponible;
  /** En qué unidades se escriben los importes: las que el asesor tiene en pantalla. */
  unidades: Unidades;
  /** La misma simulación con las tres formas de cobro, si hay previsión que cobrar. */
  formas: FormaComparada[] | null;
  /** Cuántos llegan a la edad del plan, según la tabla de mortalidad: la misma lectura que enseña la pantalla. */
  supervivencia?: LecturaDeSupervivencia | null;
  /** Lo que se ha supuesto para poder calcular y cambia la cifra: se dice en la primera hoja. */
  supuestos: string[];
  /** Los datos son de un ejemplo: el documento lo dice en la primera hoja, en la cabecera y en el pie de cada hoja. */
  ejemplo: boolean;
  /** Para quién es, si se ha dicho. Sin él, la cabecera no dice «Preparado para». */
  clientName?: string;
  /** Quién lo elabora: va al membrete, encima de la identidad del asesor. */
  banker?: { name?: string; email?: string };
  date?: string;
}

const TITULO = "Su ingreso en la jubilación";

/** Lo que dice la cabecera de cada hoja, y el nombre del fichero: una simulación (Óscar, 13-11-2026), y si es un ejemplo, también. */
const DOCUMENTO = "Simulación de jubilación";
const documentoDeLaJubilacion = ({ ejemplo }: Pick<InformeDeJubilacionInput, "ejemplo">) => (ejemplo ? `${DOCUMENTO} · ejemplo` : DOCUMENTO);

/* Las partes del ingreso, como en el papel de antes: la pensión en acero, los ahorros en oliva, la previsión en bronce y el IRPF en arena, la parte
   del bruto que no llega. Ninguna en granate: una barra granate se leería como una pérdida. */
const COLOR_DE_INGRESO = { pension: COLORES_DE_DATOS.acero, ahorros: COLORES_DE_DATOS.oliva, prevision: COLORES_DE_DATOS.bronce, irpf: COLORES_DE_DATOS.arena } as const;
/* Cada escenario con su color y su trazo, y la leyenda con el mismo: en papel, dos colores de trazo igual no se distinguen. */
const TRAZO_DE_ESCENARIO: Record<ClaveDeEscenario, { color: string; ancho: number; trazo?: string }> = {
  base: { color: SERIES.cartera, ancho: 1.6 },
  conservador: { color: colorDeSerie(1), ancho: 1.2, trazo: "5 3" },
  optimista: { color: colorDeSerie(2), ancho: 1.2, trazo: "1.5 2.5" },
  estres: { color: colorDeSerie(3), ancho: 1.2, trazo: "8 2.5 1.5 2.5" }
};

/** Un importe de la simulación, en euros enteros: es una estimación. Un cero se escribe «0 €», nunca «−0 €» (INF-13). */
const euros = (valor: number, conSigno = false) => oFalta(importeTitular(valor, { conSigno }));

/* ------------------------------------------------------------------------------------------------ Los gráficos */

const MARGEN = { izquierda: 56, derecha: 6, arriba: 8, abajo: 20 };
const LETRA_DEL_EJE = { fontFamily: FUENTE.sans, fontSize: 7.4, fill: PAPEL.tinta3 };

/** Las edades que se rotulan en el eje: de cinco en cinco, y la última si no queda pegada a otra. */
function edadesDelEje(edades: number[]): number[] {
  const marcadas = edades.filter((edad) => edad % 5 === 0);
  const ultima = edades[edades.length - 1];
  if (ultima !== undefined && !marcadas.includes(ultima) && ultima - (marcadas[marcadas.length - 1] ?? -99) >= 3) marcadas.push(ultima);
  return marcadas;
}

function GraficoDeIngresos({ serie, alto }: { serie: PuntoDeIngresos[]; alto: number }) {
  const { ancho } = useHoja();
  const cortes = cortesDelEje(Math.max(1, ...serie.map((p) => p.bruto)));
  const tope = cortes[cortes.length - 1];
  const anchoUtil = ancho - MARGEN.izquierda - MARGEN.derecha;
  const altoUtil = alto - MARGEN.arriba - MARGEN.abajo;
  const paso = anchoUtil / Math.max(1, serie.length);
  const barra = Math.max(2, Math.min(16, paso * 0.78));
  const y = (valor: number) => MARGEN.arriba + altoUtil - (valor / tope) * altoUtil;
  const marcadas = new Set(edadesDelEje(serie.map((p) => p.edad)));
  return (
    <Svg height={alto} width={ancho} style={{ marginTop: 4 }}>
      {cortes.map((corte) => (
        <G key={corte}>
          <Line stroke={corte ? PAPEL.filete : PAPEL.fileteFuerte} strokeWidth={corte ? 0.5 : 0.75} x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={y(corte)} y2={y(corte)} />
          <TextoDeSvg style={LETRA_DEL_EJE} textAnchor="end" x={MARGEN.izquierda - 6} y={y(corte) + 2.5}>{euros(corte)}</TextoDeSvg>
        </G>
      ))}
      {serie.map((punto, i) => {
        const x = MARGEN.izquierda + i * paso + (paso - barra) / 2;
        let base = 0;
        return (
          <G key={punto.edad}>
            {(["pension", "ahorros", "prevision", "irpf"] as const).map((clave) => {
              const valor = punto[clave];
              if (valor <= 0.5) return null;
              const arriba = y(base + valor);
              const altura = y(base) - arriba - (base > 0 ? 0.4 : 0);
              base += valor;
              return <Rect fill={COLOR_DE_INGRESO[clave]} height={Math.max(0.3, altura)} key={clave} width={barra} x={x} y={arriba} />;
            })}
            {marcadas.has(punto.edad) ? (
              <TextoDeSvg style={LETRA_DEL_EJE} textAnchor="middle" x={x + barra / 2} y={alto - 8}>{String(punto.edad)}</TextoDeSvg>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

function GraficoDeSaldos({ serie, claves, alto = 176 }: { serie: PuntoDeSaldos[]; claves: ClaveDeEscenario[]; alto?: number }) {
  const { ancho } = useHoja();
  const cortes = cortesDelEje(Math.max(1, ...serie.flatMap((punto) => claves.map((clave) => punto[clave] ?? 0))));
  const tope = cortes[cortes.length - 1];
  const anchoUtil = ancho - MARGEN.izquierda - MARGEN.derecha;
  const altoUtil = alto - MARGEN.arriba - MARGEN.abajo;
  const x = (i: number) => MARGEN.izquierda + (serie.length > 1 ? i / (serie.length - 1) : 0) * anchoUtil;
  const y = (valor: number) => MARGEN.arriba + altoUtil - (Math.max(0, valor) / tope) * altoUtil;
  const marcadas = new Set(edadesDelEje(serie.map((p) => p.edad)));
  return (
    <Svg height={alto} width={ancho} style={{ marginTop: 4 }}>
      {cortes.map((corte) => (
        <G key={corte}>
          <Line stroke={corte ? PAPEL.filete : PAPEL.fileteFuerte} strokeWidth={corte ? 0.5 : 0.75} x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={y(corte)} y2={y(corte)} />
          <TextoDeSvg style={LETRA_DEL_EJE} textAnchor="end" x={MARGEN.izquierda - 6} y={y(corte) + 2.5}>{euros(corte)}</TextoDeSvg>
        </G>
      ))}
      {serie.map((punto, i) =>
        marcadas.has(punto.edad) ? (
          <TextoDeSvg key={punto.edad} style={LETRA_DEL_EJE} textAnchor={i === serie.length - 1 ? "end" : "middle"} x={x(i)} y={alto - 8}>{String(punto.edad)}</TextoDeSvg>
        ) : null
      )}
      {/* La hipótesis, la última: va encima de las demás. */}
      {[...claves].sort((a, b) => Number(a === "base") - Number(b === "base")).map((clave) => {
        const trazo = TRAZO_DE_ESCENARIO[clave];
        const puntos = serie.map((punto, i) => `${x(i).toFixed(2)},${y(punto[clave] ?? 0).toFixed(2)}`).join(" ");
        return <Polyline fill="none" key={clave} points={puntos} stroke={trazo.color} strokeDasharray={trazo.trazo} strokeWidth={trazo.ancho} strokeLinejoin="round" />;
      })}
    </Svg>
  );
}

/** La leyenda: un cuadro para una parte de la barra, un trazo (con su raya) para una línea. */
function Leyenda({ marcas }: { marcas: Array<{ texto: string; color: string; trazo?: string | null }> }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 5, marginBottom: 4 }}>
      {marcas.map((marca) => (
        <View key={marca.texto} style={{ flexDirection: "row", alignItems: "center", marginRight: 13.5 }}>
          <Svg width={14} height={8}>
            {marca.trazo === undefined ? <Rect x={3} y={0.5} width={7} height={7} fill={marca.color} /> : <Line x1={0} x2={14} y1={4} y2={4} stroke={marca.color} strokeWidth={1.5} strokeDasharray={marca.trazo ?? undefined} />}
          </Svg>
          <Texto style={{ fontSize: MEDIDAS.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.3, marginLeft: 4 }}>{marca.texto}</Texto>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ La lectura */

/** Todo lo que el documento escribe, leído una vez de `core/jubilacion/lectura`: las secciones solo lo colocan. */
function lecturaDeLaJubilacion(input: InformeDeJubilacionInput) {
  const res = input.resultado;
  const o = res.entrada;
  const y1 = res.anio1;
  const d = divisorDe(y1, input.unidades);
  /* Redondeadas para que sumen la cifra que se enseña, como en la pantalla (PLA-21). */
  const lineas = respuestaAlMes(res, input.unidades);
  const netoAlMes = lineas.find((linea) => linea.clave === "neto")?.alMes ?? Math.round(y1.neto / d / 12);
  const cliente = input.clientName?.trim() ?? "";
  const capital = res.capital;
  return {
    res,
    o,
    TX: res.textos,
    d,
    enUnidades: NOMBRE_DE_LAS_UNIDADES[input.unidades],
    fecha: input.date ?? oFalta(fechaLarga(new Date())),
    procedencia: procedenciaFiscal(res.cfg),
    dura: duracion(res),
    hayPrevision: o.tieneEpsv && o.epsvPre + o.epsvPost > 0,
    lineas,
    netoAlMes,
    frases: frasesDeEscenarios(res, input.unidades),
    ingresos: serieDeIngresos(res, input.unidades),
    capital,
    cliente,
    /* El gráfico de la primera hoja cede alto a lo que esa hoja lleve de más: el cobro de una vez y lo supuesto. La respuesta tiene que caber entera en una hoja. */
    altoDelGrafico: 168 - (capital ? 18 : 0) - (input.supuestos.length ? 26 : 0)
  };
}

type Datos = InformeDeJubilacionInput & { l: ReturnType<typeof lecturaDeLaJubilacion> };

/* Una cifra con su signo de suma o de resta, como en la pantalla: lo que se resta va con su menos; lo que suma, sin signo salvo que devuelva. */
const conSigno = (valor: number, signo: 1 | -1, devuelve = false) => (signo === -1 ? euros(-valor) : euros(valor, devuelve));

/* ------------------------------------------------------------------------------------------------ La respuesta */

/** La respuesta: una sola cifra en grande y, a su lado, las líneas que la explican, que suman la cifra. */
function Respuesta({ datos }: { datos: Datos }) {
  const { l } = datos;
  const color = TEMAS.cliente.color;
  return (
    /* Una tarjeta de cifras de la plantilla, como las del papel de antes: la caja gris muy clara con su borde fino, y el guion del tema. */
    <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 12, borderWidth: 0.55, borderColor: PAPEL.filete, borderRadius: 3, backgroundColor: PAPEL.fondo, paddingHorizontal: 12, paddingVertical: 12 }} wrap={false}>
      <View style={{ width: "46%", paddingRight: 14 }}>
        <View style={{ width: 20, height: 2, marginBottom: 7, backgroundColor: color }} />
        <Texto style={{ fontSize: MEDIDAS.cifras.rotulo + 0.5, fontWeight: 500, letterSpacing: 0.3, color: PAPEL.tinta2, lineHeight: 1.3 }}>Ingreso neto al mes · simulación</Texto>
        <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 4, marginBottom: 6 }}>
          {/* El único tamaño fuera de la escala, como `--fs-respuesta` en la pantalla: el doble de la cifra principal. */}
          <Texto style={{ fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: MEDIDAS.cifras.principal * 2, lineHeight: 1, color: PAPEL.tinta }}>{euros(l.netoAlMes)}</Texto>
          <Texto style={{ fontSize: MEDIDAS.presentacion.entradilla, color: PAPEL.tinta2, marginLeft: 6, marginBottom: 6 }}>al mes</Texto>
        </View>
        <Texto style={{ fontSize: MEDIDAS.cuerpo.letra, color: PAPEL.tinta2, lineHeight: 1.4 }}>{`Después del ${l.TX.irpf}. ${l.dura.titulo}.`}</Texto>
      </View>
      <View style={{ width: "54%", paddingLeft: 14, borderLeftWidth: 0.75, borderLeftColor: PAPEL.filete }}>
        {l.lineas.map((linea, i) => {
          const total = linea.clase === "total";
          return (
            <View
              key={linea.clave}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingVertical: 4.5,
                borderBottomWidth: total || linea.clase === "resta" || i === l.lineas.length - 1 ? 0 : 0.75,
                borderBottomColor: PAPEL.filete,
                borderTopWidth: total ? 0.75 : 0,
                borderTopColor: color
              }}
            >
              <Texto style={{ flex: 1, fontSize: MEDIDAS.tabla.celda, color: linea.clase === "suma" || total ? PAPEL.tinta : PAPEL.tinta2, fontWeight: total ? 600 : 400, lineHeight: 1.3, paddingRight: 10 }}>{linea.concepto}</Texto>
              <Texto style={{ fontSize: MEDIDAS.tabla.celda, color: PAPEL.tinta, fontWeight: total ? 600 : 400, lineHeight: 1.3, textAlign: "right" }}>{euros(linea.alMes)}</Texto>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ Las secciones */

const presentacion: SeccionDeInforme<Datos> = {
  id: "presentacion",
  titulo: "Presentación",
  comienzo: "presentacion",
  procede: () => true,
  Contenido: ({ datos }) => {
    const { l } = datos;
    const { o } = l;
    return (
      <>
        <Presentacion
          contexto={[datos.ejemplo ? "Ejemplo · cifras inventadas" : "", l.cliente, l.fecha, l.TX.nombre, `${l.res.cfg.irpf} ${l.res.cfg.ejercicio}`]}
          titulo={TITULO}
        />
        <Respuesta datos={datos} />
        {/* Es una simulación, y lo dice junto a la cifra (A-145). */}
        <Apunte arriba={7}>{`Simulación con los datos de hoy: no es una previsión, una promesa ni asesoramiento fiscal o de inversión. ${o.aniosHastaJubilacion ? `Al jubilarse a los ${o.edadJubilacion} años, dentro de ${o.aniosHastaJubilacion}` : `Primer año de jubilación, a los ${o.edadJubilacion} años`}. Media mensual: el total del año entre 12; la pensión se cobra en 14 pagas. Importes en ${l.enUnidades}.`}</Apunte>
        {/* El cobro de una vez no es una mensualidad: su impuesto y su neto se dicen aparte, para que el IRPF del mes no se lea como todo el del año. */}
        {l.capital ? (
          <Parrafo>{`Aparte, el cobro ${l.TX.de} de una vez añade ${euros(l.capital.impuesto / l.d)} al IRPF del primer año y deja ${euros(l.capital.neto / l.d)} netos, que se suman a los ahorros y ya están en las retiradas.`}</Parrafo>
        ) : null}
      </>
    );
  }
};

const ingresoDeCadaAnio: SeccionDeInforme<Datos> = {
  id: "ingreso",
  titulo: "De dónde sale el ingreso de cada año",
  procedencia: ({ l }) => `Media mensual · pensión y retiradas con un IPC del ${oFalta(porcentaje(l.o.inflacion))} · ${reglasEnElTiempo(l.res)} · ${l.enUnidades}`,
  procede: () => true,
  juntoAlTitulo: 150,
  Contenido: ({ datos }) => {
    const { l } = datos;
    return (
      <View wrap={false}>
        <GraficoDeIngresos alto={l.altoDelGrafico} serie={l.ingresos} />
        <Leyenda
          marcas={[
            { texto: "Pensión neta", color: COLOR_DE_INGRESO.pension },
            ...(l.ingresos.some((p) => p.ahorros > 0.5) ? [{ texto: "Ahorros netos", color: COLOR_DE_INGRESO.ahorros }] : []),
            ...(l.ingresos.some((p) => p.prevision > 0.5) ? [{ texto: `${l.TX.vasco ? "EPSV" : "Plan"}, neto`, color: COLOR_DE_INGRESO.prevision }] : []),
            { texto: "IRPF", color: COLOR_DE_INGRESO.irpf }
          ]}
        />
      </View>
    );
  }
};

const hastaCuando: SeccionDeInforme<Datos> = {
  id: "hasta-cuando",
  titulo: "Hasta cuándo llegan los ahorros",
  procedencia: ({ l }) => `Rentabilidades elegidas para simular, no previstas ni prometidas · las mismas retiradas en todos los casos · ${l.enUnidades}`,
  procede: ({ l }) => Boolean(l.frases),
  juntoAlTitulo: 90,
  Contenido: ({ datos }) => {
    const { l, supervivencia, supuestos } = datos;
    return (
      <>
        {/* Los escenarios, en frases: el caso y lo que pasa. El desenlace no es una cifra con signo: va en tinta y en seminegrita, y la diferencia la dicen las palabras. */}
        <View wrap={false}>
          {(l.frases ?? []).map((frase, i, todas) => (
            <View key={frase.clave} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4.5, borderBottomWidth: i === todas.length - 1 ? 0 : 0.75, borderBottomColor: PAPEL.filete }}>
              <Texto style={{ flex: 1, fontSize: MEDIDAS.tabla.celda, color: PAPEL.tinta2, lineHeight: 1.3, paddingRight: 10 }}>{frase.caso}</Texto>
              <Texto style={{ fontSize: MEDIDAS.tabla.celda, fontWeight: 600, lineHeight: 1.3, textAlign: "right", color: PAPEL.tinta }}>{frase.resultado}</Texto>
            </View>
          ))}
        </View>
        {/* La otra mitad de la edad del plan: cuántos llegan a ella. Con su fuente y con lo que la cifra no es. */}
        {supervivencia ? (
          <>
            <Apunte arriba={5} color={PAPEL.tinta}>{`${supervivencia.frase}${supervivencia.consecuencia ? ` ${supervivencia.consecuencia}` : ""}`}</Apunte>
            <Apunte arriba={1}>{`${supervivencia.fuente}.${supervivencia.disponible ? ` ${supervivencia.limite}` : ""}`}</Apunte>
          </>
        ) : null}
        {supuestos.length ? <Aviso palabra="Supuestos.">{supuestos.join(" ")}</Aviso> : null}
      </>
    );
  }
};

/* Sin escenarios, lo supuesto va igual en la primera hoja. */
const supuestosSinEscenarios: SeccionDeInforme<Datos> = {
  id: "supuestos",
  titulo: "Supuestos",
  sinNumero: true,
  procede: ({ l, supuestos }) => !l.frases && supuestos.length > 0,
  Contenido: ({ datos }) => <Aviso palabra="Supuestos.">{datos.supuestos.join(" ")}</Aviso>
};

const plan: SeccionDeInforme<Datos> = {
  id: "plan",
  titulo: "El plan, año a año",
  comienzo: "nueva",
  procede: () => true,
  Contenido: ({ datos }) => {
    const { l, unidades } = datos;
    const filas = l.res.base.filas;
    const salto = Math.max(5, Math.ceil(filas.length / 6 / 5) * 5);
    const filasDeAnios: FilaDeTabla[] = filas
      .filter((_, i) => i % salto === 0 || i === filas.length - 1)
      .map((fila) => {
        const mes = 12 * divisorDe(fila, unidades);
        return {
          celdas: [`${fila.edad} años`, euros(fila.pension / mes), euros((fila.retiradaAhorros + fila.retiradaEpsv) / mes), euros(-fila.impuesto / mes), euros(fila.neto / mes), euros(saldoAlCierre(fila, l.o.inflacion, unidades))]
        };
      });
    return (
      <>
        <Subtitulo primero>El ingreso y los ahorros de cada año</Subtitulo>
        <Apunte arriba={0}>{`Importes mensuales, salvo los ahorros al cierre de cada año · un año de cada ${salto} · ${l.enUnidades}`}</Apunte>
        <Tabla
          columnas={[{ titulo: "Edad", ancho: 12 }, { titulo: "Pensión bruta", ancho: 17, cifra: true }, { titulo: "Retiradas", ancho: 17, cifra: true }, { titulo: "IRPF", ancho: 16, cifra: true }, { titulo: "Neto al mes", ancho: 17, cifra: true }, { titulo: "Ahorros al cierre", ancho: 21, cifra: true }]}
          filas={filasDeAnios}
        />

        <View wrap={false}>
          <Subtitulo>Cuánto dura el patrimonio</Subtitulo>
          <Apunte arriba={0}>{`Todos los escenarios retiran lo mismo que el plan: solo cambia lo que rinde el patrimonio · ${l.enUnidades}`}</Apunte>
          <Leyenda marcas={l.res.escenarios.map((e) => ({ texto: e.nombre, color: TRAZO_DE_ESCENARIO[e.clave].color, trazo: TRAZO_DE_ESCENARIO[e.clave].trazo ?? null }))} />
          <GraficoDeSaldos claves={l.res.escenarios.map((e) => e.clave)} serie={serieDeSaldos(l.res, unidades)} />
        </View>

        <View wrap={false}>
          <Subtitulo>Con qué datos se ha calculado</Subtitulo>
          <Rejilla datos={datosDeLaSimulacion(l.res).map(([rotulo, valor]) => ({ rotulo, valor }))} columnas={3} />
        </View>
      </>
    );
  }
};

const cobro: SeccionDeInforme<Datos> = {
  id: "cobro",
  titulo: "El cobro",
  comienzo: "nueva",
  procede: ({ l, formas }) => Boolean(l.capital || formas),
  Contenido: ({ datos }) => {
    const { l, formas } = datos;
    const capital = l.capital;
    const pv = l.res.parametros.prevision;
    const variosRegimenes = capital !== null && capital.opciones.length > 1;
    return (
      <>
        {formas ? (
          <View wrap={false}>
            <Subtitulo primero>En renta, de una vez o parte de cada forma</Subtitulo>
            <Apunte arriba={0}>La misma simulación con cada forma de cobro; lo demás no cambia · euros de hoy</Apunte>
            <Tabla
              columnas={[{ titulo: "Forma de cobro", ancho: 32 }, { titulo: "Neto al mes, año 1", ancho: 17, cifra: true }, { titulo: "Neto del plan", ancho: 17, cifra: true }, { titulo: "IRPF del plan", ancho: 17, cifra: true }, { titulo: "Patrimonio final", ancho: 17, cifra: true }]}
              filas={formas.map((forma) => ({
                celdas: [
                  { texto: forma.elegida ? `${forma.nombre} · la elegida` : forma.nombre, apunte: forma.irpfDelCapital !== null ? `${euros(forma.irpfDelCapital)} de su IRPF son del cobro de una vez` : null },
                  euros(forma.netoMensual),
                  euros(forma.netoDelPlan),
                  euros(forma.irpfDelPlan),
                  euros(forma.patrimonioFinal)
                ]
              }))}
            />
            <Apunte arriba={6}>Suma de todos los años del plan, descontada solo la inflación. Las cifras no dicen cuál conviene: depende de cuánto se necesite cobrar y cuándo.</Apunte>
          </View>
        ) : null}
        {capital ? (
          <View wrap={false}>
            <Subtitulo primero={!formas}>Lo que queda del cobro de una vez</Subtitulo>
            <Apunte arriba={0}>{`${l.procedencia} · euros del año del cobro`}</Apunte>
            <Tabla
              columnas={(pv.modelo === "vasco"
                ? ["Régimen", "Cobro bruto", "Base general", "Base del ahorro", "IRPF que añade", "Neto"]
                : ["Régimen", "Cobro bruto", `Reducción ${oFalta(porcentaje(pv.reduccion, { decimales: 0 }))}`, "Base general", "IRPF que añade", "Neto"]
              ).map((titulo, i) => ({ titulo, ancho: i === 0 ? 30 : 14, cifra: i > 0 }))}
              filas={capital.opciones.map((opcion) => ({
                celdas: [
                  { texto: variosRegimenes && capital.elegido === opcion.clave ? `${opcion.titulo} · aplicado` : opcion.titulo, apunte: opcion.sub ?? null },
                  euros(opcion.bases.bruto),
                  pv.modelo === "vasco" ? euros(opcion.bases.general) : euros(-(opcion.bases.detalle.reduccion ?? 0)),
                  pv.modelo === "vasco" ? euros(opcion.bases.ahorro) : euros(opcion.bases.general),
                  euros(-opcion.impuesto),
                  euros(opcion.neto)
                ]
              }))}
            />
            <Apunte arriba={6}>{`El impuesto es el que este cobro añade al IRPF del primer año, y no está en «Del bruto al neto». Lo neto se suma a los ahorros y se reparte en el plan.${variosRegimenes ? ` ${capital.automatico ? "Se aplica el régimen de menor impuesto estimado. " : ""}El régimen que corresponde lo confirma la EPSV.` : ` La parte de los derechos anterior a ${pv.corte} la certifica la entidad gestora.`}`}</Apunte>
          </View>
        ) : null}
      </>
    );
  }
};

const cuentas: SeccionDeInforme<Datos> = {
  id: "cuentas",
  titulo: "Anexo · Las cuentas del primer año",
  comienzo: "nueva",
  procede: () => true,
  Contenido: ({ datos }) => {
    const { l } = datos;
    const d = l.d;
    /* Del bruto al neto, entero. Sin la nota de cada fila: la escala y las deducciones están debajo, en «Qué tributa y dónde». El neto es el total. */
    const libro = libroDelPrimerAnio(l.res);
    const neto = libro.find((linea) => linea.clave === "neto");
    const filasDelLibro: FilaDeTabla[] = libro
      .filter((linea) => linea.clave !== "neto")
      .map((linea) => ({ celdas: [linea.concepto, conSigno(linea.anual / d / 12, linea.signo, linea.clave === "deducciones"), conSigno(linea.anual / d, linea.signo, linea.clave === "deducciones")] }));
    /* Qué tributa y dónde: cada base abre su grupo; las deducciones y el IRPF del año, al final. */
    const mapa = mapaFiscal(l.res);
    const filasFiscales: FilaDeTabla[] = mapa.bloques.flatMap((bloque): FilaDeTabla[] => [
      { grupo: bloque.cuota !== null ? `${bloque.titulo} · ${bloque.escala.toLocaleLowerCase("es-ES")}` : bloque.titulo },
      ...bloque.partidas.map((partida): FilaDeTabla => ({ celdas: [partida.concepto, conSigno(partida.anual / d / 12, partida.resta ? -1 : 1), conSigno(partida.anual / d, partida.resta ? -1 : 1)] })),
      ...(bloque.vacio ? [{ celdas: [bloque.vacio, "", ""] }] : []),
      ...(bloque.cuota !== null
        ? [{ celdas: [`Impuesto de esta base${bloque.marginal ? ` · tipo marginal: ${oFalta(porcentaje(bloque.marginal))}` : ""}`, conSigno(bloque.cuota / d / 12, -1), conSigno(bloque.cuota / d, -1)] }]
        : [])
    ]);
    if (mapa.deducciones) {
      filasFiscales.push({ celdas: [`Deducciones en la cuota: ${mapa.deducciones.conceptos}`, conSigno(mapa.deducciones.anual / d / 12, 1, true), conSigno(mapa.deducciones.anual / d, 1, true)] });
    }
    return (
      <>
        <Subtitulo primero>Del bruto al neto</Subtitulo>
        <Apunte arriba={0}>{`Primer año de jubilación · ${l.procedencia} · ${l.enUnidades}`}</Apunte>
        <Tabla
          columnas={[{ titulo: "Concepto", ancho: 56 }, { titulo: "Al mes", ancho: 22, cifra: true }, { titulo: "Al año", ancho: 22, cifra: true }]}
          filas={filasDelLibro}
          total={neto ? [neto.concepto, conSigno(neto.anual / d / 12, neto.signo), conSigno(neto.anual / d, neto.signo)] : undefined}
        />

        <Subtitulo>Qué tributa y dónde</Subtitulo>
        <Apunte arriba={0}>A qué base va cada ingreso del primer año y qué impuesto sale de cada una</Apunte>
        <Tabla
          columnas={[{ titulo: "Concepto", ancho: 56 }, { titulo: "Al mes", ancho: 22, cifra: true }, { titulo: "Al año", ancho: 22, cifra: true }]}
          filas={filasFiscales}
          total={[`IRPF del año · ${oFalta(porcentaje(mapa.sobreElBruto, { decimales: 1 }))} de lo cobrado en bruto`, conSigno(mapa.total / d / 12, -1), conSigno(mapa.total / d, -1)]}
        />
      </>
    );
  }
};

const comoSeHaCalculado: SeccionDeInforme<Datos> = {
  id: "metodo",
  titulo: "Anexo · Cómo se ha calculado",
  comienzo: "nueva",
  procede: () => true,
  Contenido: ({ datos }) => {
    const { l } = datos;
    const cfg = l.res.cfg;
    const comoSeCalcula = metodo(l.res);
    /* Letra de consulta, como antes: el método tiene que caber entero en su hoja. */
    const punto = { fontSize: MEDIDAS.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.4, marginTop: 2 };
    return (
      <>
        {comoSeCalcula.pasos.map((paso, i) => (
          <Texto key={paso.titulo} style={punto}>{`${String(i + 1).padStart(2, "0")}  ${paso.titulo}. ${paso.texto}`}</Texto>
        ))}
        <Subtitulo>Lo que no tiene en cuenta</Subtitulo>
        {comoSeCalcula.noTieneEnCuenta.map((limite) => (
          <Texto key={limite} style={punto}>{`•  ${limite}`}</Texto>
        ))}
        <Subtitulo>{`Parámetros de ${cfg.ejercicio} · ${l.TX.nombre}`}</Subtitulo>
        {resumenParametros(cfg).map((parametro) => (
          <Texto key={parametro} style={punto}>{`•  ${parametro}`}</Texto>
        ))}
        <Subtitulo>Fuentes oficiales</Subtitulo>
        <Apunte arriba={0}>{`Consultadas ${consultaFuentes(cfg)}.`}</Apunte>
        {cfg.fuentes.slice(0, 4).map((fuente) => (
          <Apunte key={fuente.href} arriba={2}>{`${fuente.k} · ${fuente.t}: ${fuente.href}`}</Apunte>
        ))}
        {/* El texto legal de este documento es el suyo: el de la plantilla habla de «los precios y movimientos de la cartera», y aquí no hay
            cartera, sino una simulación. */}
        <Nota titulo="Simulación.">{`Una estimación orientativa, elaborada con los datos facilitados y con una rentabilidad y una inflación elegidas para simular, que no son una previsión ni una promesa. No es una liquidación tributaria, ni asesoramiento fiscal o jurídico personalizado, ni una recomendación de inversión. Vale para contribuyentes del ${cfg.irpf}${cfg.ccaa ? ", con la escala autonómica indicada" : ""}${l.hayPrevision ? `, y la tributación ${l.TX.de} debe confirmarse con su entidad gestora` : ""}.`}</Nota>
      </>
    );
  }
};

function InformeDeJubilacion(input: InformeDeJubilacionInput) {
  const datos: Datos = { ...input, l: lecturaDeLaJubilacion(input) };
  /* El título del cobro dice qué se cobra: «El cobro de la EPSV», «El cobro del plan de pensiones». */
  const secciones: SeccionDeInforme<Datos>[] = [presentacion, ingresoDeCadaAnio, hastaCuando, supuestosSinEscenarios, plan, { ...cobro, titulo: `El cobro ${datos.l.TX.de}` }, cuentas, comoSeHaCalculado];
  const cliente = datos.l.cliente;
  /* La cabecera y el pie de cada hoja dicen lo que es: una simulación (Óscar, 13-11-2026), y si es un ejemplo, también. */
  const documento = documentoDeLaJubilacion(input);
  const advertencia = input.ejemplo
    ? "Ejemplo con cifras inventadas: es una simulación"
    : "Simulación: no es una previsión, una promesa ni asesoramiento fiscal";
  return (
    <DocumentoDeInforme
      tema="cliente"
      documento={documento}
      titulo={cliente ? `${TITULO} - ${cliente}` : TITULO}
      asunto="Estimación del ingreso en la jubilación"
      identidad={firmaDelInforme(input.banker)}
      destinatario={cliente || undefined}
      advertencia={advertencia}
    >
      <HojasDeSecciones secciones={secciones} datos={datos} />
    </DocumentoDeInforme>
  );
}

export async function createJubilacionPdfBlob(input: InformeDeJubilacionInput): Promise<Blob> {
  return renderizarInforme(<InformeDeJubilacion {...input} />);
}

export async function downloadJubilacionPdf(input: InformeDeJubilacionInput): Promise<void> {
  descargar(await createJubilacionPdfBlob(input), nombreDelFicheroDeLaJubilacion(input));
}

/** «Simulación de jubilación - Familia García - 2026-11-14.pdf»: el documento de la cabecera, el cliente si lo hay y el día que imprime. */
export function nombreDelFicheroDeLaJubilacion(input: Pick<InformeDeJubilacionInput, "clientName" | "date" | "ejemplo">): string {
  return nombreDelFichero({ documento: documentoDeLaJubilacion(input), de: input.clientName, fecha: diaDelDocumento(input.date) });
}
