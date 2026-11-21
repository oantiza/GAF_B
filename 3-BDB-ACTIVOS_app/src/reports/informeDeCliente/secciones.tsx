/* eslint-disable react-refresh/only-export-components */
/**
 * Las secciones del informe de cliente, en el orden de siempre: la portada (a página completa, como el papel de antes, con las cifras que
 * responden); la composición de la cartera y su reparto; la distribución geográfica; la evolución simulada y el mapa de riesgo y
 * rentabilidad; las crisis pasadas y el solapamiento entre fondos; la guía de interpretación con el alcance de las cifras; y, si se pide,
 * el histórico ampliado. Las hojas las reparte la plantilla (`HojasDeSecciones`): la tabla fluye y repite su cabecera, y la numeración es
 * «Página x de N».
 *
 * El aspecto es el del informe de cliente de antes (decisión de Óscar del 14-11-2026): tarjetas de cifras con la cifra en Fraunces, el
 * reparto global en cuatro tarjetas con el guion de su clase y las categorías en barras gruesas de colores, el mapa con un color por zona,
 * la evolución con su sombreado, las crisis en tarjetas y la guía con sus números grandes en granate.
 *
 * Lo que este documento enseña al cliente no cambia con la plantilla: ni costes, ni datos internos, ni nada del emisor.
 */
import { StyleSheet, View } from "@react-pdf/renderer";
import { numero, peso } from "../../core/formato";
import {
  AvisoLegal,
  COLOR_DE_CLASE,
  CifrasDestacadas,
  FUENTE,
  GraficoDeLineas,
  ListaDePartes,
  MEDIDAS,
  Nota,
  PAPEL,
  Parrafo,
  Portada,
  SIN_CLASIFICAR,
  Tabla,
  TEMAS,
  Texto,
  colorDelSigno,
  seccionesQueProceden,
  type CeldaDeTabla,
  type ColumnaDeTabla,
  type DatoDeRejilla,
  type ParteDelTodo,
  type SeccionDeInforme
} from "../plantilla";
import { buildReportGeography, cifrasDelMapa } from "../../core/repartoDelInforme";
import { FUERA_DE_LA_MATRIZ, GEO_AREAS, TITULO_DEL_ANEXO, type DatosDelInforme, type SolapamientoDelInforme, TITULO_DE_LAS_CIFRAS } from "./datos";
import { FronteraEficiente, MapaDeRiesgo, MapaDelMundo, MatrizDeSolapamiento, ConoEstadistico } from "./graficos";

const { color: GRANATE, tono: BRONCE_DE_TEXTO } = TEMAS.cliente;

const s = StyleSheet.create({
  subtitulo: { fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: 12.5, lineHeight: 1.2, color: PAPEL.tinta, marginTop: 10 },
  procedencia: { fontSize: MEDIDAS.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.4, marginTop: 4 },
  pequeno: { fontSize: MEDIDAS.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.4, marginTop: 6 },
  columnas: { flexDirection: "row", alignItems: "stretch", marginTop: 4 },
  crisis: { flexDirection: "row", marginTop: 12 },
  ficha: { flex: 1, borderWidth: 0.55, borderColor: PAPEL.filete, borderRadius: 3, backgroundColor: PAPEL.fondo, paddingHorizontal: 10, paddingVertical: 9 },
  guion: { width: 20, height: 2, marginBottom: 6, backgroundColor: GRANATE },
  nombreDeCrisis: { fontSize: 7, fontWeight: 500, letterSpacing: 0.6, color: PAPEL.tinta2, lineHeight: 1.3 },
  cifraDeCrisis: { fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: MEDIDAS.cifras.cifra, lineHeight: 1.15, marginTop: 5, marginBottom: 2 },
  ausenciaDeCrisis: { fontSize: MEDIDAS.cifras.ausencia, color: PAPEL.tinta3, lineHeight: 1.25, marginTop: 9, marginBottom: 3 },
  linea: { fontSize: MEDIDAS.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.4, marginTop: 2 },
  lineaMenor: { fontSize: MEDIDAS.tabla.apunte, color: PAPEL.tinta3, lineHeight: 1.35, marginTop: 2 },
  tituloDeMatriz: { fontSize: 7, fontWeight: 500, letterSpacing: 0.8, color: BRONCE_DE_TEXTO, lineHeight: 1.3, marginTop: 10 },
  fueraDeLaMatriz: { fontSize: MEDIDAS.cuerpo.letra, fontWeight: 600, lineHeight: 1.3, color: PAPEL.tinta },
  entrada: { flexDirection: "row", marginTop: 8 },
  numeroDeEntrada: { width: 43, fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: 22, lineHeight: 1, color: GRANATE },
  tituloDeEntrada: { fontSize: MEDIDAS.cuerpo.letra, fontWeight: 600, lineHeight: 1.3 },
  subtituloDeEntrada: { fontSize: 7.4, fontWeight: 500, letterSpacing: 0.5, color: BRONCE_DE_TEXTO, lineHeight: 1.35, marginTop: 1 },
  textoDeEntrada: { fontSize: 8.5, color: PAPEL.tinta2, lineHeight: 1.45, marginTop: 3 }
});

type Seccion = SeccionDeInforme<DatosDelInforme>;

/* ------------------------------------------------------------------------------------------------ La presentación */

/**
 * La portada a página completa, como la del papel de antes: el antetítulo, «Informe de su cartera» muy grande, para quién es, la rejilla
 * (periodo, valoración, fecha, perfil y horizonte, solo los que hay) y quien lo elabora. **No lleva ninguna cifra de la cartera** (Óscar,
 * 15-11-2026: en los informes, las métricas nunca van en la portada): van en su sección, «Cifras de la cartera», delante de la
 * geografía, como en la hoja 03 del papel de antes.
 */
const presentacion: Seccion = {
  id: "presentacion",
  titulo: "Presentación",
  comienzo: "portada",
  procede: () => true,
  Contenido: ({ datos }) => {
    const rejilla: DatoDeRejilla[] = [
      { rotulo: "Periodo de análisis", valor: datos.periodo },
      ...(datos.valoracion ? [{ rotulo: "Valoración actual", valor: datos.valoracion }] : []),
      { rotulo: "Fecha de creación", valor: datos.fechaDeCreacion },
      ...(datos.perfil ? [{ rotulo: "Perfil de la cartera", valor: datos.perfil }] : []),
      ...(datos.horizonte ? [{ rotulo: "Horizonte de la cartera", valor: datos.horizonte }] : [])
    ];
    return (
      <Portada
        antetitulo={datos.esMuestra ? "Informe de muestra" : "Informe personalizado"}
        titulo={"Informe\nde su cartera"}
        destinatario={datos.clientName || undefined}
        entradilla={datos.metodologia ?? undefined}
        datos={rejilla}
      />
    );
  }
};

/* ------------------------------------------------------------------------------------------------ La composición y su reparto */

const composicion: Seccion = {
  id: "composicion",
  titulo: "Composición de la cartera",
  procedencia: (datos) => `Distribución del capital por fondo y estrategia a fecha ${datos.fechaCorta}.`,
  procede: () => true,
  juntoAlTitulo: 120,
  Contenido: ({ datos }) => {
    const columnas: ColumnaDeTabla[] = [
      { titulo: "Fondo / estrategia", ancho: 3.7 },
      { titulo: "Peso", ancho: 0.8, cifra: true },
      ...(datos.conImporte ? [{ titulo: "Importe", ancho: 1.25, cifra: true }] : []),
      { titulo: "Rent. dividendo prevista", ancho: 1.15, cifra: true },
      { titulo: "Divisa", ancho: 0.7, cifra: true }
    ];
    const filas = datos.filas.map((fila) => ({
      celdas: [
        { texto: fila.nombre, apunte: fila.apunte },
        fila.peso,
        ...(datos.conImporte ? [fila.importe] : []),
        { texto: fila.dividendo.texto, motivo: fila.dividendo.motivo },
        fila.divisa
      ] as CeldaDeTabla[]
    }));
    return <Tabla columnas={columnas} filas={filas} total={["Total cartera", datos.totalPeso, ...(datos.conImporte ? [datos.totalImporte] : []), "", ""]} />;
  }
};

/** El color de la raya de cada tarjeta del reparto global: el de la pantalla en las tres clases y el gris del papel en «Otros» (`COLOR_DE_CLASE`). */
const COLOR_DE_LA_CLASE: Record<string, string> = {
  "Renta fija": COLOR_DE_CLASE.rentaFija,
  "Renta variable": COLOR_DE_CLASE.rentaVariable,
  Liquidez: COLOR_DE_CLASE.liquidez,
  Otros: COLOR_DE_CLASE.otros
};

/** El ancho de la columna del reparto global y el de las categorías, con el filete que las separa: los del papel de antes (39 % y 61 %). */
const ANCHO_GLOBAL = 196;
const ANCHO_DE_CATEGORIAS = 290;

const reparto: Seccion = {
  id: "reparto",
  titulo: "Reparto de la cartera",
  procedencia: "Por clase de activo y por categoría, en porcentaje de toda la cartera.",
  procede: () => true,
  /* El título y el bloque van enteros: el bloque mide según las categorías (y sus nombres de dos líneas), y con un alto fijo de 175 el
     título se quedaba solo al pie de la hoja cuando medía más (visto el 15-11-2026 con diez posiciones). */
  entera: true,
  Contenido: ({ datos }) => {
    const otras = datos.categorias.find((fila) => fila.agrupa)?.agrupa;
    /* Lo que redondea a cero no lleva signo (el módulo común): un reparto neto puede dar −0,04, y «−0,0 %» no dice nada. */
    const categorias: ParteDelTodo[] = datos.categorias.map((fila) => ({
      nombre: fila.label,
      /* «Otras N» no lleva barra, para que no parezca la mayor por ser una suma; ella y lo que no entra en el reparto, en gris. */
      fraccion: fila.agrupa ? null : fila.value / 100,
      cifra: peso(fila.value / 100),
      color: fila.fuera || fila.agrupa ? SIN_CLASIFICAR : undefined
    }));
    const notaDeOtras = otras ? `«Otras ${otras.cuantas} categorías» es la suma de ${otras.cuantas} categorías que no caben en la hoja; la mayor de ellas pesa el ${peso(otras.mayor / 100)}.` : null;
    return (
      <View style={s.columnas} wrap={false}>
        <View style={{ width: ANCHO_GLOBAL, paddingRight: 14 }}>
          <Texto style={[s.subtitulo, { marginTop: 4 }]}>Composición global</Texto>
          {/* Cuatro tarjetas de dos en dos, cada una con el guion de su clase; la cifra, en tinta: no tiene signo. */}
          <CifrasDestacadas
            columnas={2}
            cifras={datos.composicionGlobal.map((fila) => ({ rotulo: fila.label, cifra: peso(fila.value / 100), color: COLOR_DE_LA_CLASE[fila.label] ?? SIN_CLASIFICAR }))}
          />
          {datos.loQueNoEntra ? <Texto style={s.pequeno}>{datos.loQueNoEntra}</Texto> : null}
        </View>
        <View style={{ width: ANCHO_DE_CATEGORIAS, paddingLeft: 15, borderLeftWidth: 0.65, borderLeftColor: PAPEL.filete }}>
          <Texto style={[s.subtitulo, { marginTop: 4 }]}>Composición por categoría</Texto>
          <ListaDePartes partes={categorias} ancho={ANCHO_DE_CATEGORIAS - 15} />
          {categorias.length ? (notaDeOtras ? <Texto style={s.pequeno}>{notaDeOtras}</Texto> : null) : <Texto style={s.pequeno}>Desglose por categoría: falta el dato.</Texto>}
        </View>
      </View>
    );
  }
};

/* ------------------------------------------------------------------------------------------------ Las cifras */

/**
 * Las cuatro cifras que responden, con sus notas. Van tras el reparto y delante de la geografía, como en la hoja 03 del papel de antes
 * («Cifras y distribución geográfica»); en la portada no van (Óscar, 15-11-2026). No abren hoja: siguen al reparto donde caben, para
 * no dejar media hoja en blanco ni añadir una al documento.
 */
const cifras: Seccion = {
  id: "cifras",
  titulo: TITULO_DE_LAS_CIFRAS,
  procede: () => true,
  /* El título, las tarjetas y sus notas van enteros: el título no se queda solo al pie de una hoja. */
  entera: true,
  Contenido: ({ datos }) => (
    <>
      <CifrasDestacadas
        cifras={datos.cifras.map((cifra, i) => ({
          rotulo: cifra.label,
          cifra: cifra.ausencia ? null : cifra.value,
          motivo: cifra.ausencia,
          signo: cifra.signo ?? null,
          principal: i === 0
        }))}
      />
      {datos.fraseDelRespaldo ? <Texto style={s.pequeno}>{datos.fraseDelRespaldo}</Texto> : null}
      {/* Sin cifras, por qué: es lo que explica el «Falta el dato» de las cifras, y la guía manda aquí a leerlo. */}
      {datos.sinCifra ? <Nota>{datos.sinCifra}</Nota> : null}
      {/* Bajo las cifras, solo el tipo sin riesgo (A-143). Una muestra lo sigue diciendo: no son cifras reales. */}
      <Nota>{`${datos.notaDelTipoSinRiesgo}${datos.ilustrativas ? " Cifras ilustrativas, no operativas." : ""}`}</Nota>
    </>
  )
};

/* ------------------------------------------------------------------------------------------------ La geografía */

const geografia: Seccion = {
  id: "geografia",
  titulo: "Distribución geográfica",
  procedencia: (datos) => {
    const { noDeclarado, sinSituar } = buildReportGeography(datos.regiones, datos.equityLookThrough);
    return [
      datos.equityLookThrough ? "Distribución de la parte de renta variable según los datos geográficos disponibles." : null,
      noDeclarado > 0.05 ? "La parte sin ubicación se muestra como «No declarado»." : null,
      sinSituar > 0.05 ? "La parte que sus datos nombran y el mapa no sabe situar se muestra como «Sin situar»." : null
    ].filter(Boolean).join(" ") || null;
  },
  procede: () => true,
  juntoAlTitulo: 320,
  Contenido: ({ datos }) => {
    const { totals, noDeclarado, sinSituar } = buildReportGeography(datos.regiones, datos.equityLookThrough);
    const zonas = GEO_AREAS
      .map((area) => ({ id: area.id, label: area.label, value: totals[area.id] || 0 }))
      .filter((area) => area.value > 0)
      .sort((a, b) => b.value - a.value);
    /* En % de la renta variable, lo que no entra no es de esa cuenta. Sin renta variable, las filas son de toda la cartera y lleva la suya (decisión 85). */
    const cifras = cifrasDelMapa(zonas, noDeclarado, sinSituar, datos.equityLookThrough ? 0 : datos.fueraDelReparto);
    return <MapaDelMundo totales={totals} cifras={cifras} />;
  }
};

/* ------------------------------------------------------------------------------------------------ La evolución y el mapa */

const evolucion: Seccion = {
  id: "evolucion",
  titulo: "Evolución simulada",
  /* Sigue a la geografía si cabe (Óscar, 15-11-2026). Abría hoja, como la hoja 04 del papel de antes, y con carteras de
     muchas posiciones el mapa del mundo quedaba solo en la suya, con media hoja en blanco. */
  procede: () => true,
  juntoAlTitulo: 260,
  procedencia: (datos) => datos.periodoDeLaEvolucion,
  Contenido: ({ datos }) => {
    const { serie } = datos;
    return (
      <>
        <Parrafo>{datos.fraseDeLaEvolucion}</Parrafo>
        {serie ? (
          <GraficoDeLineas
            fechas={serie.fechas}
            series={[
              { nombre: datos.nombreDeLaSerie, valores: serie.cartera },
              ...(serie.referencia ? [{ nombre: datos.nombreDeLaReferencia, valores: serie.referencia, referencia: true }] : [])
            ]}
            formato={(valor) => numero(valor, { decimales: 1 })}
            formatoDelEje={(valor) => numero(valor)}
            alto={160}
          />
        ) : (
          <Parrafo>Falta la serie histórica de la composición: no hay evolución que dibujar.</Parrafo>
        )}
        {serie ? <Nota titulo={datos.resumenDeLaEvolucion.titulo ?? undefined}>{datos.resumenDeLaEvolucion.texto}</Nota> : null}
      </>
    );
  }
};

const mapa: Seccion = {
  id: "mapa",
  titulo: "Mapa riesgo-rentabilidad frente a carteras de referencia",
  procedencia: (datos) => datos.mapa.subtitulo,
  procede: () => true,
  juntoAlTitulo: 300,
  /* El mapa y su lectura no se separan: la nota sola en otra hoja no se entiende. */
  Contenido: ({ datos }) => (
    <View wrap={false}>
      <MapaDeRiesgo portfolio={datos.mapa.portfolio} profiles={datos.mapa.profiles} comparable={datos.mapa.comparable} />
      <Nota>{datos.mapa.nota}</Nota>
    </View>
  )
};

/* ------------------------------------------------------------------------------------------------ La frontera eficiente */

/**
 * La frontera eficiente, delante del cono y en la hoja de análisis avanzado, como en el papel del 02-11-2026. Vuelve por decisión de
 * Óscar del 16-11-2026 («También la frontera»), que revisa el punto 1 de A-136, y con las dos condiciones que faltaban: cifras en los
 * dos ejes y la nota de que la curva depende del periodo. Lo que queda fuera del cálculo se nombra aquí mismo, bajo el gráfico, y no
 * en un anexo propio: A-136.5 dejó un solo anexo, y los dos de aquel papel repetían las mismas cuatro filas en hojas casi en blanco.
 */
const frontera: Seccion = {
  id: "frontera",
  titulo: "Frontera eficiente",
  procedencia: (datos) => datos.frontera?.subtitulo || null,
  procede: (datos) => datos.frontera !== null,
  /* El gráfico, su lectura y lo que queda fuera no se separan: la curva sola en una hoja no dice nada. */
  entera: true,
  Contenido: ({ datos }) => {
    const laFrontera = datos.frontera!;
    if (laFrontera.ausencia) return <Parrafo>{laFrontera.ausencia}</Parrafo>;
    return (
      <>
        {laFrontera.cobertura ? <Texto style={s.procedencia}>{laFrontera.cobertura}</Texto> : null}
        <FronteraEficiente frontera={laFrontera} />
        <Nota>{laFrontera.nota}</Nota>
        <LoQueQuedaFuera fuera={laFrontera.fuera} titulo="Fuera de la frontera:" />
      </>
    );
  }
};

/* ------------------------------------------------------------------------------------------------ El cono estadístico */

/**
 * El cono estadístico, justo detrás del mapa de riesgo y rentabilidad y en su misma hoja si cabe (Óscar, 15-11-2026). Vuelve al papel de
 * cliente, de donde salió el 04-11 (decisión 3 de la auditoría), pero centrado en el tipo sin riesgo y no en la rentabilidad pasada: enseña
 * cuánto puede oscilar la inversión, pérdidas incluidas, y lo explica con las palabras del cliente. No se llama proyección ni previsión.
 * Sin cifra de la cartera, sin histórico que cubra el plazo o sin tipo sin riesgo, la sección no sale.
 */
const cono: Seccion = {
  id: "cono",
  titulo: "Cuánto podría oscilar su inversión",
  procedencia: (datos) => (datos.cono ? `Cono estadístico a ${datos.cono.anos} años. No es una previsión.` : null),
  procede: (datos) => datos.cono !== null,
  /* La explicación, el gráfico y sus casos no se separan: sueltos no se entienden. */
  entera: true,
  Contenido: ({ datos }) => {
    const elCono = datos.cono!;
    const numeroDeLasCrisis = seccionesQueProceden(SECCIONES_DEL_INFORME_DE_CLIENTE, datos).find((seccion) => seccion.id === "crisis")?.numero;
    return (
      <>
        {elCono.parrafos.slice(0, 2).map((parrafo, i) => <Parrafo key={i}>{parrafo}</Parrafo>)}
        <ConoEstadistico cono={elCono} />
        <Parrafo>{elCono.parrafos[2]}</Parrafo>
        <Nota>{`${elCono.nota}${numeroDeLasCrisis ? ` Lo que esta composición cayó en crisis reales está en la sección ${numeroDeLasCrisis}.` : ""}`}</Nota>
      </>
    );
  }
};

/* ------------------------------------------------------------------------------------------------ Las crisis y el solapamiento */

const crisis: Seccion = {
  id: "crisis",
  titulo: "Crisis pasadas",
  /* Abre hoja, con el solapamiento y su matriz debajo (Óscar, 12-11-2026, y de nuevo el 15-11: antes eso que no dejar hueco). */
  comienzo: "nueva",
  procede: () => true,
  juntoAlTitulo: 160,
  Contenido: ({ datos }) => {
    const { modelo, queMide, loQueNoEs } = datos.crisis;
    return (
      <>
        <Texto style={[s.subtitulo, { marginTop: 6 }]}>Cómo se habría comportado esta composición en crisis pasadas</Texto>
        {modelo.crisis.length === 0 ? (
          <Nota>{modelo.sinNinguna ?? ""}</Nota>
        ) : (
          <>
            <Texto style={s.procedencia}>{queMide}</Texto>
            <View style={s.crisis} wrap={false}>
              {modelo.crisis.map((caso, i) => (
                <View key={caso.id} style={[s.ficha, i < modelo.crisis.length - 1 ? { marginRight: 8 } : {}]}>
                  <View style={s.guion} />
                  <Texto style={s.nombreDeCrisis}>{caso.nombre}</Texto>
                  <Texto style={s.linea}>{caso.contexto}</Texto>
                  {caso.cifra ? (
                    <>
                      {/* Una variación, con su signo escrito; el color lo refuerza. */}
                      <Texto style={[s.cifraDeCrisis, { color: colorDelSigno(caso.cifra.startsWith("−") ? "baja" : caso.cifra.startsWith("+") ? "sube" : "neutro") }]}>{caso.cifra}</Texto>
                      {caso.tramo ? <Texto style={s.linea}>{caso.tramo}</Texto> : null}
                      {caso.parteMedida ? <Texto style={s.linea}>{caso.parteMedida}</Texto> : null}
                    </>
                  ) : (
                    <>
                      {/* «Sin datos», o «Falta el dato» si mide menos del 60 %: entonces dice cuánto mide y quién queda fuera (decisión 103). */}
                      <Texto style={s.ausenciaDeCrisis}>{caso.ausencia ?? ""}</Texto>
                      {caso.sinDato ? <Texto style={s.linea}>{caso.sinDato}</Texto> : null}
                    </>
                  )}
                  {caso.fuera ? <Texto style={s.lineaMenor}>{caso.fuera}</Texto> : null}
                </View>
              ))}
            </View>
            <Nota>{loQueNoEs}</Nota>
          </>
        )}
      </>
    );
  }
};

function LoQueQuedaFuera({ fuera, titulo = FUERA_DE_LA_MATRIZ }: { fuera: readonly string[]; titulo?: string }) {
  if (!fuera.length) return null;
  return (
    <View style={{ marginTop: 9 }} wrap={false}>
      <Texto style={s.fueraDeLaMatriz}>{titulo}</Texto>
      {fuera.map((linea, i) => <Texto key={i} style={[s.linea, { fontSize: MEDIDAS.cuerpo.letra }]}>{linea}</Texto>)}
    </View>
  );
}

/** La matriz con su título, su nota, el fondo que no cruza y lo que queda fuera: un bloque que no se parte. */
function BloqueDeLaMatriz({ contenido, casilla, datos }: { contenido: SolapamientoDelInforme; casilla: number; datos: DatosDelInforme }) {
  const { nombres, valores, tituloMatriz, nota, bajoElUmbral, fuera, sinMatriz } = contenido;
  if (nombres.length >= 2) {
    return (
      <View wrap={false}>
        <Texto style={s.tituloDeMatriz}>{tituloMatriz}</Texto>
        <MatrizDeSolapamiento nombres={nombres} valores={valores} casilla={casilla} mide={datos.mide} />
        {nota ? <Nota>{nota}</Nota> : null}
        {bajoElUmbral ? <Parrafo>{bajoElUmbral}</Parrafo> : null}
        <LoQueQuedaFuera fuera={fuera} />
      </View>
    );
  }
  return (
    <>
      {sinMatriz ? <Parrafo>{sinMatriz}</Parrafo> : null}
      <LoQueQuedaFuera fuera={fuera} />
      {nota ? <Nota>{nota}</Nota> : null}
    </>
  );
}

const solapamiento: Seccion = {
  id: "solapamiento",
  titulo: "Solapamiento entre fondos",
  procedencia: (datos) => datos.solapamiento.contenido.alcance,
  procede: () => true,
  juntoAlTitulo: 80,
  Contenido: ({ datos }) => {
    const { contenido, casilla, parte } = datos.solapamiento;
    return (
      <>
        {contenido.frases.map((frase, i) => <Parrafo key={i}>{frase}</Parrafo>)}
        {parte === "todo" ? <BloqueDeLaMatriz contenido={contenido} casilla={casilla} datos={datos} /> : null}
        {/* La matriz que no cabe bajo las crisis va entera a la hoja siguiente, sin repetir la lectura. */}
        {datos.matrizAparte ? (
          <View break>
            <BloqueDeLaMatriz contenido={datos.matrizAparte.contenido} casilla={datos.matrizAparte.casilla} datos={datos} />
          </View>
        ) : null}
      </>
    );
  }
};

/* ------------------------------------------------------------------------------------------------ La guía y el histórico ampliado */

const guia: Seccion = {
  id: "guia",
  titulo: "Guía de interpretación",
  /* Seguida también (15-11-2026): abriendo hoja, el solapamiento se quedaba solo en la suya con media hoja en blanco. */
  procede: () => true,
  juntoAlTitulo: 140,
  Contenido: ({ datos }) => {
    return (
      <>
        <Parrafo>{datos.leadDeLaGuia}</Parrafo>
        {datos.entradas.map(([titulo, subtitulo, texto], i) => (
          <View key={titulo} style={s.entrada} wrap={false}>
            {/* El número grande en Fraunces y en granate, como la guía de antes. */}
            <Texto style={s.numeroDeEntrada}>{String(i + 1).padStart(2, "0")}</Texto>
            <View style={{ flex: 1 }}>
              <Texto style={s.tituloDeEntrada}>{titulo}</Texto>
              <Texto style={s.subtituloDeEntrada}>{subtitulo}</Texto>
              <Texto style={s.textoDeEntrada}>{texto}</Texto>
            </View>
          </View>
        ))}
        {/* El alcance y el texto legal van juntos: el legal no abre una hoja solo. */}
        <View wrap={false} style={{ marginTop: datos.lineaDeAlcance ? 12 : 0 }}>
          {datos.lineaDeAlcance ? <Texto style={s.subtitulo}>{TITULO_DEL_ANEXO}</Texto> : null}
          {datos.lineaDeAlcance ? <Parrafo>{datos.lineaDeAlcance}</Parrafo> : null}
          {datos.ampliado ? null : <AvisoLegal />}
        </View>
      </>
    );
  }
};

const historicoAmpliado: Seccion = {
  id: "historico-ampliado",
  titulo: "Histórico ampliado con referencias",
  procedencia: (datos) => datos.ampliado?.texto ?? null,
  comienzo: "nueva",
  procede: (datos) => datos.ampliado !== null,
  Contenido: ({ datos }) => {
    const ampliado = datos.ampliado!;
    const numeroDeLasCrisis = seccionesQueProceden(SECCIONES_DEL_INFORME_DE_CLIENTE, datos).find((seccion) => seccion.id === "crisis")?.numero ?? "";
    return (
      <>
        <Parrafo>{ampliado.metodologia}</Parrafo>
        {ampliado.extensiones.map((extension, i) => (
          <View key={`${extension.nombre}-${i}`} style={{ marginTop: 14 }} wrap={false}>
            <Texto style={s.subtitulo}>{extension.nombre}</Texto>
            {extension.lineas.map((linea, j) => <Parrafo key={j}>{linea}</Parrafo>)}
          </View>
        ))}
        <Nota>{`Reconstrucción retrospectiva: el modelo se calibra con información posterior al tramo estimado. No equivale a una inversión realizable en el pasado. Las métricas y la caída máxima incluyen esa estimación; las crisis pasadas de la sección ${numeroDeLasCrisis} no: solo usan precios observados. Los activos excluidos no se sustituyen por efectivo ni generan rentabilidad ficticia.`}</Nota>
        <AvisoLegal />
      </>
    );
  }
};

/** La evolución se titula por lo que dibuja: la composición actual, o solo la parte medida. */
const evolucionTitulada = (datos: DatosDelInforme): Seccion => ({ ...evolucion, titulo: datos.tituloDeLaEvolucion });

/**
 * La frontera abre hoja solo cuando hay curva que dibujar: con el cono debajo es la hoja de análisis avanzado del papel del 02-11,
 * donde la frontera y la proyección iban juntas, y así el cono deja de quedarse solo en una hoja a medio llenar. Cuando lo único que
 * imprime es por qué no hay curva, es una línea: abrir una hoja para ella dejaría media en blanco.
 */
const fronteraSegunLaCurva = (datos: DatosDelInforme): Seccion =>
  datos.frontera?.ausencia === null ? { ...frontera, comienzo: "nueva" } : frontera;

export const SECCIONES_DEL_INFORME_DE_CLIENTE: readonly Seccion[] = [
  presentacion,
  composicion,
  reparto,
  cifras,
  geografia,
  evolucion,
  mapa,
  frontera,
  cono,
  crisis,
  solapamiento,
  guia,
  historicoAmpliado
];

/** Las secciones con los títulos que dependen de los datos. */
export function seccionesDelInforme(datos: DatosDelInforme): Seccion[] {
  return SECCIONES_DEL_INFORME_DE_CLIENTE.map((seccion) => {
    if (seccion.id === "evolucion") return evolucionTitulada(datos);
    if (seccion.id === "frontera") return fronteraSegunLaCurva(datos);
    return seccion;
  });
}
