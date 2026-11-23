/* eslint-disable react-refresh/only-export-components -- PDF components are rendered on demand, outside the browser React tree. */
/**
 * El informe de costes de una propuesta, en la plantilla única (tema cliente). Es una estimación de un año: los euros van
 * enteros, como decidió Óscar el 11-11-2026, y lo que redondea a cero no se escribe como un cero. Aquí no se calcula nada:
 * las cifras salen de `core/portfolioCosts`, las mismas que la pantalla.
 *
 * Tres hojas: la presentación con la cifra y cómo se compone; el coste de cada activo, en una tabla que repite su
 * cabecera si salta de hoja; y qué significa cada coste.
 */
/* Este módulo trae @react-pdf y la plantilla: las pantallas lo cargan de forma dinámica, al pedir el documento. */
import type { ManagementFeeDraft } from "../components/PortfolioManagementFee";
import { descargar, diaDelDocumento, nombreDelFichero } from "../core/descargaDeFicheros";
import { fechaLarga, importeTitular, oFalta, peso, porcentaje } from "../core/formato";
import { BASE_DE_LECTURA_EUR, calculatePortfolioManagementFee, comisionIndicada, detalleDeLaOperacion, esSoloDeAcciones, fraseDelCoste, fuenteDeLaFila, LO_QUE_NO_INCLUYE_EL_COSTE, operacionEnUnaCasilla, SIN_MEDIA_QUE_DAR, type calculatePortfolioCosts } from "../core/portfolioCosts";
import { datosHasta } from "../core/serieParada";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { firmaDelInforme } from "./firmaDelInforme";
import { Apunte, Subtitulo } from "./textosDelInforme";
import { AvisoLegal, CifrasDestacadas, DocumentoDeInforme, HojasDeSecciones, Nota, Parrafo, Presentacion, Tabla, renderizarInforme, type CifraDestacada, type ColumnaDeTabla, type FilaDeTabla, type SeccionDeInforme } from "./plantilla";

export interface CostsPdfInput {
  costs: ReturnType<typeof calculatePortfolioCosts>;
  management: ManagementFeeDraft;
  date?: string;
  /** Para quién es, si se ha dicho. Sin él, la cabecera no dice «Preparado para». */
  clientName?: string;
  /** Quién lo elabora: va al membrete, encima de la identidad del asesor. No hay nombre por defecto. */
  banker?: { name?: string; email?: string };
  /** Las posiciones cuyos datos se quedaron en una fecha, con esa fecha (decisión B-78). Se dice en su fila. */
  seriesParadas?: ReadonlyMap<string, string>;
}

const TITULO = "El coste de su cartera";
const DOCUMENTO = "Costes de la propuesta";
const ADVERTENCIA = "Estimación de un año: no es una factura ni un compromiso de tarifas";
const NO_APLICA = textoDeAusencia("no-aplica");
const FALTA = textoDeAusencia("falta");
const falta = FALTA.toLocaleLowerCase("es-ES");
/* Entre la cifra y su «%»: no se parten al saltar de línea. */
const ESPACIO_DURO = String.fromCharCode(0xa0);

/* Es una estimación: euros enteros. Lo que falta se dice, y un importe que redondea a cero no se escribe como un cero. */
const euros = (valor: number | null | undefined) =>
  typeof valor !== "number" || !Number.isFinite(valor) ? FALTA : valor > 0 && valor < 0.5 ? `< ${importeTitular(1)}` : oFalta(importeTitular(valor));
const tasa = (valor: number | null | undefined, decimales = 2) => oFalta(porcentaje(valor, { decimales }));

/* Lo mismo que dice `fuenteDeLaFila`, con las palabras del papel. Con o sin KID en la ficha, la cifra sale del proveedor de datos, y eso es lo que se dice. */
function fuenteEnElPapel(fuentes: Parameters<typeof fuenteDeLaFila>[0]): string {
  const fuente = fuenteDeLaFila(fuentes);
  return fuente === "Proveedor" || fuente === "Proveedor, sin KID" ? "Proveedor de datos" : fuente;
}

type Fila = CostsPdfInput["costs"]["rows"][number];

/** Todo lo que el documento escribe, calculado una vez: las secciones solo lo colocan. */
function lecturaDeLosCostes({ costs, management, date }: CostsPdfInput) {
  /* Sin capital declarado todo va en porcentajes (decisión 5): el capital de ejemplo de Diseño no llega hasta aquí. */
  const conCapital = costs.totalCapital != null;
  const fee = calculatePortfolioManagementFee(costs, management.input.trim() === "" ? null : Number(management.input), management.unit);
  /* Sin capital, un importe en euros no se puede sumar a un porcentaje: se enseña aparte y no entra en la cifra. */
  const gestionAparte = management.enabled && !conCapital && management.unit === "euros";
  const gestionEnLaCifra = management.enabled && !gestionAparte;
  const total = gestionEnLaCifra ? fee.combinedAnnualEur : costs.avgCostPct != null ? costs.totalCostEur : null;
  const rate = gestionEnLaCifra ? fee.combinedRate : costs.avgCostPct;
  /* Con la comisión dentro, la cifra ya no es solo de los productos. */
  const rotulo = gestionEnLaCifra ? "Coste anual de los productos y la gestión" : "Coste corriente anual de los productos";
  const fecha = date ?? oFalta(fechaLarga(new Date()));
  const analizadas = costs.rows.length === 1 ? "1 posición analizada" : `${costs.rows.length} posiciones analizadas`;
  const baseDeLectura = oFalta(importeTitular(BASE_DE_LECTURA_EUR));
  const frase = fraseDelCoste(costs, rate);
  /* La lectura en euros solo se explica si la frase la lleva: sin cifra, o con un 0,00 %, no la lleva. */
  /* La frase la escribe `fraseDelCoste` con el mismo formato: se busca la base escrita. */
  const fraseConEuros = !conCapital && frase.includes(baseDeLectura);
  const operacion = costs.operacion;
  const parcial = operacion.sinDato > 0 && operacion.pesoKid + operacion.pesoProveedor > 0;
  const enEuros = (cifra: number | null) => (cifra == null || costs.totalCapital == null ? FALTA : euros(cifra * costs.totalCapital));
  const tasaDeOperacion = operacion.tasa ?? (parcial ? operacion.medido : null);
  const example = costs.rows.find((row) => row.capital != null && row.ongoingPct != null);
  const soloAcciones = esSoloDeAcciones(costs);
  /* Solo acciones y sin comisión: la cifra vale cero porque no hay nada que medir, y un 0,00 % se leería como que la cartera sale gratis (decisión A-65). */
  const cifraQueNoAplica = soloAcciones && rate === 0;
  return { conCapital, fee, gestionAparte, total, rate, rotulo, fecha, analizadas, baseDeLectura, frase, fraseConEuros, operacion, parcial, enEuros, tasaDeOperacion, example, soloAcciones, cifraQueNoAplica };
}

type Datos = CostsPdfInput & { l: ReturnType<typeof lecturaDeLosCostes> };

/* ------------------------------------------------------------------------------------------------ La presentación */

const presentacion: SeccionDeInforme<Datos> = {
  id: "presentacion",
  titulo: "Presentación",
  comienzo: "presentacion",
  procede: () => true,
  Contenido: ({ datos }) => {
    const { costs, l } = datos;
    const noAplica: CifraDestacada = { rotulo: "", cifra: null, motivo: "no-aplica" };
    const cifras: CifraDestacada[] = l.conCapital
      ? [
          { rotulo: "Capital analizado", cifra: euros(costs.totalCapital) },
          l.cifraQueNoAplica ? { ...noAplica, rotulo: l.rotulo, principal: true } : { rotulo: l.rotulo, cifra: euros(l.total), principal: true },
          l.cifraQueNoAplica ? { ...noAplica, rotulo: "Sobre el capital" } : { rotulo: "Sobre el capital", cifra: tasa(l.rate) }
        ]
      : [{ rotulo: l.rotulo, cifra: l.frase, principal: true }];
    return (
      <>
        <Presentacion
          contexto={[datos.clientName?.trim() ?? "", l.fecha, `${l.analizadas}${l.conCapital ? "" : " · capital no declarado"}`]}
          titulo={TITULO}
        />
        <CifrasDestacadas cifras={cifras} />
        {/* Con espacios duros, los tres últimos términos van juntos: «impuestos.» se quedaba solo en la segunda línea (decisión 80). Los lleva la constante. */}
        <Parrafo>{LO_QUE_NO_INCLUYE_EL_COSTE}</Parrafo>
        <Parrafo>
          {l.conCapital
            ? "Todos los importes corresponden a una estimación de un año sobre el capital analizado."
            : `No se ha declarado un capital: las cifras son porcentajes anuales, una estimación de un año${l.fraseConEuros ? `, y los euros por cada ${l.baseDeLectura} son solo una forma de leerlos` : ""}.`}
        </Parrafo>
      </>
    );
  }
};

/* ------------------------------------------------------------------------------------------------ Cómo se compone */

const composicion: SeccionDeInforme<Datos> = {
  id: "composicion",
  titulo: "Cómo se compone el coste",
  procede: () => true,
  juntoAlTitulo: 120,
  Contenido: ({ datos }) => {
    const { costs, management, l } = datos;
    const filas: FilaDeTabla[] = [
      {
        celdas: [
          {
            texto: costs.missing && l.conCapital ? "Costes corrientes identificados" : "Costes corrientes de los activos",
            apunte: l.soloAcciones ? SIN_MEDIA_QUE_DAR : l.conCapital ? `Media ponderada: ${costs.avgCostPct == null ? falta : tasa(costs.avgCostPct)}. Cada activo contribuye según su peso en la cartera.` : "Media ponderada: cada activo contribuye según su peso en la cartera."
          },
          l.soloAcciones ? NO_APLICA : l.conCapital ? euros(costs.totalCostEur) : tasa(costs.avgCostPct)
        ]
      }
    ];
    /* Sin comisión indicada, ni la fila ni su frase. */
    if (management.enabled) {
      filas.push({
        celdas: [
          {
            texto: "Asesoramiento o gestión de la cartera",
            apunte: l.fee.valid ? `${comisionIndicada(l.fee, management.unit)} ${l.gestionAparte ? "Sin capital declarado no se puede expresar en porcentaje, y por eso no se suma a los costes corrientes." : "Se suma una sola vez a los costes corrientes."}` : `Comisión indicada: ${falta}.`
          },
          l.conCapital || l.gestionAparte ? euros(l.fee.annualEur) : tasa(l.fee.rate)
        ]
      });
    }
    if (!l.soloAcciones) {
      /* Decisión 43. Con su fuente y sobre qué parte del peso. No entra en la cifra de arriba, y la entrada máxima no entra en ninguna: es un pago único. */
      filas.push({
        celdas: [
          { texto: l.parcial ? "Costes de operación de los fondos, parcial" : "Costes de operación de los fondos", apunte: `No entran en la cifra de arriba. ${detalleDeLaOperacion(l.operacion)}`.replace(/ %/g, `${ESPACIO_DURO}%`) },
          l.conCapital ? l.enEuros(l.tasaDeOperacion) : tasa(l.tasaDeOperacion)
        ]
      });
      if (costs.corrienteMasOperacionPct != null) {
        filas.push({
          celdas: [
            {
              texto: "Coste corriente más operación",
              apunte: `${l.conCapital ? `${tasa(costs.corrienteMasOperacionPct)} sobre el capital. ` : ""}Las dos son anuales y sobre el valor de la inversión. No lleva la comisión de gestión ni la entrada máxima.`
            },
            l.conCapital ? l.enEuros(costs.corrienteMasOperacionPct) : tasa(costs.corrienteMasOperacionPct)
          ]
        });
      }
    }
    const aviso = [
      l.soloAcciones ? null : `Cobertura de costes: ${tasa(costs.coveragePct, 0)} del peso de la cartera.`,
      l.soloAcciones
        ? null
        : costs.missing
          ? `${costs.missing} ${costs.missing === 1 ? "posición" : "posiciones"} sin coste corriente. ${l.conCapital ? `Los importes identificados son parciales; ${falta} del coste de toda la cartera.` : `${FALTA} del coste de toda la cartera.`} Un dato ausente no equivale a un coste cero.`
          : costs.acciones
            ? "Todos los fondos y ETF analizados tienen un coste corriente."
            : "Todas las posiciones analizadas tienen un coste corriente.",
      costs.acciones ? `${costs.acciones === 1 ? "1 acción: no tiene" : `${costs.acciones} acciones: no tienen`} coste corriente, ${l.soloAcciones ? "y en su fila dice «No aplica»." : "en su fila dice «No aplica» y en la media cuenta como cero."}` : null,
      management.enabled && !l.fee.valid ? `La comisión adicional está activada pero su importe no es válido o está pendiente. ${FALTA} del coste con gestión.` : null
    ].filter((frase): frase is string => frase !== null);
    return (
      <>
        <Tabla columnas={[{ titulo: "Concepto", ancho: 3.2 }, { titulo: l.conCapital ? "Al año" : "Sobre la cartera", ancho: 1, cifra: true }]} filas={filas} />
        {aviso.length ? <Nota>{aviso.join(" ")}</Nota> : null}
        {costs.normalized ? (
          <Parrafo>{`Los pesos originales sumaban ${oFalta(peso(costs.inputWeight / 100))} y se han normalizado al 100 % exclusivamente para este análisis${l.conCapital ? ", repartiendo el capital declarado" : ""}. No se modifican las posiciones guardadas.`}</Parrafo>
        ) : null}
        <Parrafo>
          {l.conCapital
            ? "La estimación mantiene constantes el capital y las tarifas durante un año. El coste efectivo variará si cambia la valoración, la composición o las condiciones aplicables."
            : "La estimación mantiene constantes la composición y las tarifas durante un año. El coste efectivo variará si cambia la composición o las condiciones aplicables."}
        </Parrafo>
      </>
    );
  }
};

/* ------------------------------------------------------------------------------------------------ Costes por activo */

const porActivo: SeccionDeInforme<Datos> = {
  id: "por-activo",
  titulo: "Costes por activo",
  comienzo: "nueva",
  procedencia: ({ costs, l }) => `${costs.rows.length === 1 ? "1 posición" : `${costs.rows.length} posiciones`} · ${l.conCapital ? "importes anuales en euros" : "costes en porcentaje"}`,
  procede: () => true,
  Contenido: ({ datos }) => {
    const { costs, seriesParadas, l } = datos;
    const siAplica = (row: Fila, cifra: string) => (row.aplicaCoste ? cifra : NO_APLICA);
    const columnas: Array<ColumnaDeTabla & { celda: (row: Fila) => string }> = [
      { titulo: "Peso", ancho: 7, cifra: true, celda: (row) => oFalta(peso(row.weight / 100)) },
      ...(l.conCapital ? [{ titulo: "Capital", ancho: 11, cifra: true, celda: (row: Fila) => euros(row.capital) }] : []),
      { titulo: "Corriente", ancho: l.conCapital ? 12 : 15, cifra: true, celda: (row) => siAplica(row, tasa(row.ongoingPct)) },
      ...(l.conCapital ? [{ titulo: "Coste anual", ancho: 10, cifra: true, celda: (row: Fila) => siAplica(row, euros(row.costEur)) }] : []),
      { titulo: "Operación", ancho: l.conCapital ? 12.5 : 15, cifra: true, celda: (row) => siAplica(row, operacionEnUnaCasilla(row.operacionPct)) },
      { titulo: "Entrada máx.", ancho: l.conCapital ? 12.5 : 15, cifra: true, celda: (row) => siAplica(row, tasa(row.entradaPct)) }
    ];
    /* Las tres columnas de tasas, con sitio para «Falta el dato» en una línea: a 9,5 y 10 se partía en dos (14-11-2026). Lo pone
       el nombre, que ya se partía en dos líneas. Con capital son ocho columnas y no caben todas a lo ancho de un A4 vertical. */
    const nombre: ColumnaDeTabla = { titulo: "Activo / ISIN", ancho: l.conCapital ? 22 : 30 };
    const fuente: ColumnaDeTabla = { titulo: "Fuente", ancho: l.conCapital ? 14 : 18 };
    const filas: FilaDeTabla[] = costs.rows.map((row) => ({
      celdas: [
        { texto: row.name, apunte: [row.asset?.isin ?? row.assetId, seriesParadas?.has(row.assetId) ? datosHasta(seriesParadas.get(row.assetId) ?? "", row.assetId) : null].filter(Boolean).join("\n") },
        ...columnas.map((columna) => columna.celda(row)),
        siAplica(row, fuenteEnElPapel(row.fuentes))
      ]
    }));
    /* El total va bajo su columna: el coste anual en euros con capital, el corriente en porcentaje sin él. */
    const columnaDelTotal = columnas.findIndex((columna) => columna.titulo === (l.conCapital ? "Coste anual" : "Corriente")) + 1;
    const total = [costs.missing && l.conCapital ? "Coste corriente anual identificado" : "Coste corriente anual de los productos", ...columnas.map(() => ""), ""];
    total[columnaDelTotal] = l.soloAcciones ? NO_APLICA : l.conCapital ? euros(costs.totalCostEur) : tasa(costs.avgCostPct);
    return (
      <>
        <Tabla columnas={[nombre, ...columnas, fuente]} filas={filas} total={total} />
        {/* La nota de redondeo: la suma de las cifras redondeadas puede no cuadrar con el total. */}
        <Apunte arriba={9}>
          {`${l.conCapital
            ? "Los cálculos utilizan toda la precisión disponible. La suma de cifras redondeadas puede diferir unos euros del total."
            : "Los cálculos utilizan toda la precisión disponible. La media puede diferir unas centésimas de la que sale con las cifras redondeadas."}${l.soloAcciones ? "" : " Cada cifra sale de lo que dice «Fuente»: el KID, con su fecha; donde no lo hay, o no da esa cifra, el proveedor de datos. La entrada máxima es un pago único y no entra en ningún total."}`}
        </Apunte>
      </>
    );
  }
};

/* ------------------------------------------------------------------------------------------------ La guía */

const guia: SeccionDeInforme<Datos> = {
  id: "guia",
  titulo: "Qué significa cada coste",
  comienzo: "nueva",
  procede: () => true,
  Contenido: ({ datos }) => {
    const { costs, management, l } = datos;
    return (
      <>
        <Subtitulo primero>Coste corriente del activo</Subtitulo>
        <Parrafo>Es el porcentaje anual informado para cada producto. En fondos y ETF suele recoger los gastos recurrentes soportados por el vehículo, incluida su gestión. Se refleja habitualmente en el valor liquidativo: su estimación en euros no implica un cargo adicional de ese importe en cuenta.</Parrafo>
        <Parrafo>La comisión de gestión propia del activo es un dato informativo y no se suma de nuevo al coste corriente. Así se evita contar dos veces el mismo concepto.</Parrafo>
        <Parrafo>Los costes de operación son lo que el fondo paga al comprar y vender sus inversiones; también son anuales y también se reflejan en el valor liquidativo. La entrada (suscripción) máxima es lo más que se puede cobrar al invertir, una sola vez, y lo que se paga de verdad puede ser menos.</Parrafo>
        <Subtitulo>La media ponderada</Subtitulo>
        <Parrafo>
          {`Coste medio = suma de (peso relativo de cada activo × su coste corriente anual). No es una media simple: una posición con más ${l.conCapital ? "capital" : "peso"} tiene mayor influencia. ${l.conCapital
            ? "El coste en euros de cada fila es su capital multiplicado por su tasa anual; el total es la suma de esos importes."
            : l.fraseConEuros ? `Los euros por cada ${l.baseDeLectura} son ese porcentaje aplicado a ${l.baseDeLectura} y redondeado: una forma de leerlo, no el capital de esta cartera.` : ""}`.trim()}
        </Parrafo>
        {costs.acciones ? <Parrafo>{l.soloAcciones ? SIN_MEDIA_QUE_DAR : "Una acción no tiene coste corriente, y por eso cuenta como cero en la media. Un fondo o un ETF sin dato no cuenta como cero: es un dato que falta."}</Parrafo> : null}
        {l.example ? (
          <Nota titulo="Ejemplo de esta cartera.">{`${l.example.name}: ${euros(l.example.capital)} × ${tasa(l.example.ongoingPct, 4)} = ${euros(l.example.costEur)} estimados al año.`}</Nota>
        ) : null}
        <Subtitulo>Gestión de la cartera</Subtitulo>
        <Parrafo>Comisión por el servicio de gestión de la cartera, si la hay; ya incluye impuestos.</Parrafo>
        <Subtitulo>Alcance y datos pendientes</Subtitulo>
        <Parrafo>{`Se usan las cifras de cada activo al generar el documento, cada una con su fuente${management.enabled ? ", y la comisión indicada en este análisis" : ""}. La cifra principal no lleva los costes de operación ni la entrada máxima, que se enseñan aparte. ${LO_QUE_NO_INCLUYE_EL_COSTE} Por ello, la cifra representa los conceptos analizados y no garantiza recoger todos los gastos posibles.`}</Parrafo>
        <Parrafo>«Falta el dato» significa que no hay información suficiente. La cobertura mide el peso con costes conocidos; los activos sin dato no se consideran gratuitos. El documento es una estimación informativa, no una factura ni un compromiso de tarifas. Las condiciones definitivas deben contrastarse con la documentación de los productos y el contrato del servicio.</Parrafo>
        <AvisoLegal />
      </>
    );
  }
};

const SECCIONES: readonly SeccionDeInforme<Datos>[] = [presentacion, composicion, porActivo, guia];

function CostsDocument(input: CostsPdfInput) {
  const cliente = input.clientName?.trim() ?? "";
  const datos: Datos = { ...input, l: lecturaDeLosCostes(input) };
  return (
    <DocumentoDeInforme
      tema="cliente"
      documento={DOCUMENTO}
      titulo={cliente ? `${TITULO} - ${cliente}` : TITULO}
      asunto="Costes corrientes y gestión de cartera"
      identidad={firmaDelInforme(input.banker)}
      destinatario={cliente || undefined}
      advertencia={ADVERTENCIA}
    >
      <HojasDeSecciones secciones={SECCIONES} datos={datos} />
    </DocumentoDeInforme>
  );
}

export async function createCostsPdfBlob(input: CostsPdfInput): Promise<Blob> {
  return renderizarInforme(<CostsDocument {...input} />);
}
/** «Informe de costes - Familia García - 2026-11-14.pdf»: el documento, el cliente si lo hay y el día que imprime. */
export function nombreDelFicheroDeCostes(input: Pick<CostsPdfInput, "clientName" | "date">): string {
  return nombreDelFichero({ documento: DOCUMENTO, de: input.clientName, fecha: diaDelDocumento(input.date) });
}

export async function downloadCostsPdf(input: CostsPdfInput): Promise<void> {
  descargar(await createCostsPdfBlob(input), nombreDelFicheroDeCostes(input));
}
