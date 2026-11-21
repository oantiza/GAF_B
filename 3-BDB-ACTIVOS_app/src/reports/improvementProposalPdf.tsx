/* eslint-disable react-refresh/only-export-components -- PDF components are rendered on demand, outside the browser React tree. */
/**
 * PDF de la propuesta de «Mejorar cartera» (uso interno del asesor), con la plantilla única de informes (`./plantilla`) en
 * su tema interno: acero, «USO INTERNO» y «No entregar al cliente» en cada hoja, y la identidad del asesor en la cabecera.
 *
 * Documento propio mientras el informe interno de cartera no incorpora la sección:
 * sustituciones, comparativa antes/después en la ventana de confirmación, validación
 * criterio a criterio, equivalencia de cada cambio y lo que se descartó. Sin
 * retrocesiones ni datos comerciales: la propuesta se juzga por el inversor.
 */
import { View } from "@react-pdf/renderer";
import { descargar, diaDelDocumento, nombreDelFichero } from "../core/descargaDeFicheros";
import { fecha, fechaLarga, numero, peso, porcentaje, puntos, ratio, rentabilidad, signoDe } from "../core/formato";
import { cifrasEnPantalla, textoEnPantalla } from "../core/glosarioDePantalla";
import { leerIdentidad } from "../core/identidadDelAsesor";
import { NOTA_DE_LAS_ACCIONES } from "../core/portfolioCosts";
import { fraseDelTipoDeRespaldo, tipoDeRespaldo } from "../core/tipoDeRespaldo";
import type { ImprovementProposal, ImprovementResponse } from "../adapters/improvePortfolioBackend";
import type { FundEquivalence } from "../core/fundEquivalence";
import { VERDICT_LABELS } from "../core/fundEquivalence";
import { excluidosSinRepetir, IMPROVEMENT_STATUS_LABELS, improvementSummary, notasDelPeriodo, rejectionLabel } from "../core/portfolioImprovement";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../core/textosDeCartera";
import { ventanasEnPalabras } from "./ventanasEnPalabras";
import {
  Aviso,
  AvisoLegal,
  DocumentoDeInforme,
  Hoja,
  Nota,
  Parrafo,
  Presentacion,
  Tabla,
  TituloDeSeccion,
  renderizarInforme,
  type CeldaDeTabla,
  type IdentidadDelAsesor
} from "./plantilla";

export interface ImprovementProposalPdfInput {
  portfolioName: string;
  response: ImprovementResponse;
  /** Índice de la propuesta a imprimir dentro de `response.proposals`. */
  proposalIndex?: number;
  /** Nombre y coste corriente por activo, para rotular y explicar la diferencia de coste. */
  assets: Record<string, { name: string; ongoingCharge?: number | null }>;
  /** Equivalencia posición→candidato con clave `${posición}:${candidato}`. */
  equivalence?: Record<string, Pick<FundEquivalence, "verdict" | "reason" | "shared" | "differing" | "missing">>;
  /** Posiciones sin candidato y motivo (del cliente). */
  skipped?: { asset_id: string; reason: string }[];
  /** La fecha ya escrita («13 de octubre de 2026»). Por defecto, la de hoy con el mes escrito. */
  date?: string;
  /** La cartera lleva alguna acción: en el coste cuenta como cero, y quien enseña esa media lo dice (decisión 10). */
  hayAcciones?: boolean;
  /** Quién firma. Sin ella, la que el asesor guardó en este navegador (`leerIdentidad`). */
  identidad?: IdentidadDelAsesor;
}

/** Lo que el documento dice de sí mismo en la cabecera y en el nombre del fichero. */
const DOCUMENTO = "Propuesta de mejora";

const cifra = (valor: number | null | undefined): number | null => (typeof valor === "number" && Number.isFinite(valor) ? valor : null);

/**
 * Una fila del antes y después. Las diferencias de dos porcentajes van en puntos, «+0,43 pp», como la validación del mismo
 * documento (revisión final, V3-8). Solo la rentabilidad lleva el color de su signo: un ratio, una volatilidad, una caída
 * o un coste no llevan color (apartado 6 del sistema).
 */
function filaDeMedida(
  rotulo: string,
  antes: number | null | undefined,
  despues: number | null | undefined,
  tipo: "rentabilidad" | "porcentaje" | "ratio"
): { celdas: CeldaDeTabla[] } {
  const a = cifra(antes);
  const d = cifra(despues);
  const diferencia = a !== null && d !== null ? d - a : null;
  const escribir = (valor: number | null) => (tipo === "rentabilidad" ? rentabilidad(valor) : tipo === "porcentaje" ? porcentaje(valor) : ratio(valor));
  /* Solo la diferencia de una rentabilidad lleva color: la de un ratio (el Sharpe), una volatilidad, una caída o un coste va en tinta. */
  const conColor = tipo === "rentabilidad";
  const diferenciaEscrita = tipo === "ratio" ? numero(diferencia, { decimales: 2, conSigno: true }) : puntos(diferencia);
  return {
    celdas: [
      rotulo,
      { texto: escribir(a), signo: tipo === "rentabilidad" ? signoDe(a, 4) : null },
      { texto: escribir(d), signo: tipo === "rentabilidad" ? signoDe(d, 4) : null },
      { texto: diferenciaEscrita, signo: conColor ? signoDe(diferencia, 4) : null }
    ]
  };
}

/** Los números de sección, seguidos, solo para las que salen. */
function numerador() {
  let n = 0;
  return () => {
    n += 1;
    return String(n).padStart(2, "0");
  };
}

/** La ventana («3Y») en palabras: «ventana 3 años». */
const ventanaEnPalabras = (ventana: string) => `ventana ${ventana.replace("Y", " años")}`;

function ProposalDocument({ portfolioName, response, proposalIndex = 0, assets, equivalence = {}, skipped = [], date, hayAcciones = false, identidad }: ImprovementProposalPdfInput) {
  const proposal: ImprovementProposal | undefined = response.proposals[proposalIndex];
  const original = response.original;
  const windows = response.windows;
  /* El nombre: el que trae la sustitución o el del activo. La plantilla lo sanea al imprimirlo. */
  const name = (id: string, preferred?: string | null) => preferred || (assets[id]?.name ?? id);
  const ter = (id: string) => cifra(assets[id]?.ongoingCharge);
  const today = date ?? fechaLarga(new Date()) ?? "";
  const rejected = Object.entries(response.rejected_candidates).flatMap(([position, items]) => items.map((item) => ({ position, ...item })));
  /* Lo que llega del servidor va con coma decimal y signo menos, como todo el papel: «-0.38 pp» no se imprime (decisión 80). */
  /* Y con sus ventanas en palabras, si alguna llega abreviada («3A»). */
  /* Lo que manda el servidor se dice con las palabras de la pantalla (el glosario): «Coste corriente medio», no «ponderado». */
  const delServidor = (texto: string) => ventanasEnPalabras(cifrasEnPantalla(textoEnPantalla(texto)));
  const respaldo = tipoDeRespaldo(response);
  const siguiente = numerador();
  /* 15-11-2026: se mide con el periodo de Simular. Las notas son las de la pantalla; `excluded_assets` ya no repite lo que se dice aparte. */
  const notas = notasDelPeriodo(response, (id) => name(id));
  const otrosExcluidos = excluidosSinRepetir(response);
  const apartadas = response.excluded_positions ?? [];
  /* El tipo libre de la confirmación es el de sus fechas; un servidor anterior solo mandaba el de la ventana entera. */
  const tipoDeLaConfirmacion = response.risk_free_by_window?.confirmation ?? response.risk_free;
  const sinDescartes = skipped.length === 0 && rejected.length === 0 && otrosExcluidos.length === 0 && apartadas.length === 0;

  /* Las dos partes de la segunda hoja, como funciones: se numeran donde se escriben. */
  const porQue = () => (
    <>
      <TituloDeSeccion numero={siguiente()} titulo="Por qué cada cambio" procedencia="Equivalencia y descartes" juntoAlTitulo={70} arribaDelTodo />
      {proposal
        ? proposal.substitutions.map((sub) => {
            const eq = equivalence[`${sub.from_asset_id}:${sub.to_asset_id}`];
            const lineas = [
              `${eq ? `${VERDICT_LABELS[eq.verdict]} · ${eq.reason}` : "Equivalencia por etiquetas no disponible en este documento."} Correlación ${ratio(sub.correlation) ?? ""}, tracking error ${porcentaje(sub.tracking_error) ?? ""}.`,
              eq?.shared.length ? `Comparten: ${eq.shared.join("; ")}.` : null,
              eq?.differing.length ? `Difieren: ${eq.differing.join("; ")}.` : null,
              eq?.missing.length ? `Sin dato: ${eq.missing.join("; ")}.` : null
            ].filter((linea): linea is string => Boolean(linea));
            return (
              <Nota key={`eq-${sub.from_asset_id}`} titulo={`${name(sub.from_asset_id, sub.from_name)} por ${name(sub.to_asset_id, sub.to_name)}.`}>
                {lineas.join("\n")}
              </Nota>
            );
          })
        : null}
    </>
  );
  const resto = () => (
    <>
      <TituloDeSeccion numero={siguiente()} titulo="Candidatos descartados y posiciones sin alternativa" juntoAlTitulo={60} />
      {sinDescartes ? (
        <Parrafo>Ninguno.</Parrafo>
      ) : (
        <Tabla
          columnas={[{ titulo: "Activo", ancho: 2 }, { titulo: "Motivo", ancho: 3 }]}
          filas={[
            ...skipped.map((item) => ({ celdas: [name(item.asset_id), item.reason] })),
            ...apartadas.map((item) => ({ celdas: [name(item.asset_id), `Fuera de la medición, sin sustitutos: ${rejectionLabel(item.reason).toLocaleLowerCase("es")}`] })),
            ...rejected.map((item) => ({ celdas: [`${name(item.asset_id)} (para ${name(item.position)})`, delServidor(`${item.not_evaluable ? "No evaluable · " : ""}${rejectionLabel(item.reason)}${item.detail ? ` · ${item.detail}` : ""}`)] })),
            ...otrosExcluidos.map((item) => ({ celdas: [name(item.asset_id), rejectionLabel(item.reason)] }))
          ]}
        />
      )}

      <TituloDeSeccion numero={siguiente()} titulo="Método" juntoAlTitulo={60} />
      <Parrafo>
        Se buscan fondos de la misma categoría o región y la misma clase de activo que cada posición, se exige que su serie cubra la ventana completa y que se comporten como el fondo al que sustituyen (correlación y tracking error semanales). Los pesos no cambian.
      </Parrafo>
      {[notas.periodo, notas.apartadas, notas.completadas, notas.recorte].some(Boolean) ? (
        <Parrafo>{delServidor([notas.periodo, notas.apartadas, notas.completadas, notas.recorte].filter(Boolean).join(" "))}</Parrafo>
      ) : null}
      <Parrafo>
        {`Las combinaciones se eligen en los dos primeros tercios de la ventana${windows ? ` (del ${fecha(windows.selection.first_date) ?? ""} al ${fecha(windows.selection.last_date) ?? ""})` : ""} y solo valen si en el último tercio no empeoran volatilidad, caída máxima, Sharpe, rentabilidad ni coste más allá de las tolerancias, mejoran al menos un criterio de forma relevante y mantienen las exposiciones por clase, región y divisa.`}
      </Parrafo>
      <View wrap={false}>
        <Parrafo>
          {`Las series de fondos son valores liquidativos sin reinvertir reparto; por eso se compara dentro de la misma política de distribución. Las retrocesiones y condiciones comerciales no intervienen.${response.evaluated_combinations > 0 ? ` ${response.evaluated_combinations} combinaciones evaluadas${response.search === "GREEDY" ? " con búsqueda por pasos" : ""}.` : ""} Resultados históricos: no garantizan el comportamiento futuro.`}
        </Parrafo>
        <AvisoLegal />
      </View>
    </>
  );

  return (
    <DocumentoDeInforme
      tema="interno"
      documento={DOCUMENTO}
      titulo={`${DOCUMENTO} · ${portfolioName}`}
      asunto="Sustituciones de fondos equivalentes con pesos conservados"
      identidad={identidad ?? leerIdentidad()}
    >
      <Hoja>
        <Presentacion
          contexto={[today, IMPROVEMENT_STATUS_LABELS[response.status], response.window ? ventanaEnPalabras(response.window) : null].filter((parte): parte is string => Boolean(parte))}
          titulo={portfolioName || "Cartera"}
          entradilla={delServidor(improvementSummary(response))}
        />

        {proposal && original ? (
          <>
            {/* Seguida, como en la comparativa de activos: tras la presentación, el título grande quedaba pegado a su filete. */}
            <TituloDeSeccion numero={siguiente()} titulo="Sustituciones propuestas" juntoAlTitulo={70} />
            <Tabla
              columnas={[
                { titulo: "Fondo actual", ancho: 2.4 },
                { titulo: "Sustituto", ancho: 2.4 },
                { titulo: "Peso", cifra: true },
                { titulo: "Correlación", cifra: true },
                { titulo: "Dif. coste", cifra: true }
              ]}
              filas={proposal.substitutions.map((sub) => {
                const before = ter(sub.from_asset_id);
                const after = ter(sub.to_asset_id);
                return {
                  celdas: [
                    { texto: name(sub.from_asset_id, sub.from_name), apunte: sub.from_asset_id },
                    { texto: name(sub.to_asset_id, sub.to_name), apunte: sub.to_asset_id },
                    peso(sub.weight),
                    ratio(sub.correlation),
                    puntos(before !== null && after !== null ? after - before : null)
                  ]
                };
              })}
            />

            <TituloDeSeccion
              numero={siguiente()}
              titulo="Antes y después en la ventana de confirmación"
              procedencia={`${windows ? `${windows.confirmation.weeks} semanas, del ${fecha(windows.confirmation.first_date) ?? ""} al ${fecha(windows.confirmation.last_date) ?? ""}, fuera de la muestra con la que se eligieron los cambios. ` : ""}Mismas fechas, misma base, euros, pesos fijos al inicio${tipoDeLaConfirmacion ? `, tipo sin riesgo ${porcentaje(tipoDeLaConfirmacion.risk_free_rate) ?? ""}${response.risk_free_by_window?.confirmation ? ", el €STR medio de estas fechas" : ""}` : ""}.`}
              juntoAlTitulo={120}
            />
            <Tabla
              columnas={[{ titulo: "Medida", ancho: 2.6 }, { titulo: "Cartera actual", cifra: true }, { titulo: "Propuesta", cifra: true }, { titulo: "Diferencia", cifra: true }]}
              filas={[
                filaDeMedida("Rentabilidad anualizada", original.metrics.confirmation.cagr, proposal.metrics.confirmation.cagr, "rentabilidad"),
                filaDeMedida("Volatilidad", original.metrics.confirmation.volatility, proposal.metrics.confirmation.volatility, "porcentaje"),
                filaDeMedida("Sharpe", original.metrics.confirmation.sharpe, proposal.metrics.confirmation.sharpe, "ratio"),
                filaDeMedida("Caída máxima", original.metrics.confirmation.max_drawdown, proposal.metrics.confirmation.max_drawdown, "porcentaje"),
                filaDeMedida("Coste corriente medio", original.weighted_cost, proposal.weighted_cost, "porcentaje"),
                filaDeMedida("Rentabilidad anualizada (ventana de selección)", original.metrics.selection.cagr, proposal.metrics.selection.cagr, "rentabilidad")
              ]}
            />
            <Parrafo>{SIN_COMISIONES_NI_IMPUESTOS}</Parrafo>
            {hayAcciones ? <Parrafo>{`Las acciones no tienen coste corriente y cuentan como cero. ${NOTA_DE_LAS_ACCIONES}`}</Parrafo> : null}
            {respaldo !== null ? <Parrafo>{fraseDelTipoDeRespaldo(respaldo)}</Parrafo> : null}

            <TituloDeSeccion numero={siguiente()} titulo="Validación" juntoAlTitulo={60} />
            <Tabla
              columnas={[{ titulo: "Resultado", ancho: 1 }, { titulo: "Criterio", ancho: 4 }]}
              filas={proposal.validation.map((check) => ({
                celdas: [
                  check.status === "PASS" ? "Cumple" : check.status === "FAIL" ? "No cumple" : "No evaluable",
                  delServidor(`${check.label}${check.detail ? ` · ${check.detail}` : ""}`)
                ]
              }))}
            />
            {proposal.consistency ? (
              <Parrafo>
                {`Consistencia: la propuesta iguala o supera a la cartera actual en ${proposal.consistency.wins} de ${proposal.consistency.windows} ventanas móviles de ${proposal.consistency.rolling_weeks} semanas.`}
              </Parrafo>
            ) : null}
          </>
        ) : (
          <Aviso palabra="Sin propuesta.">
            {[
              delServidor(response.reason ?? IMPROVEMENT_STATUS_LABELS[response.status]),
              response.best_rejected
                ? `Mejor combinación evaluada: ${response.best_rejected.substitutions.map((sub) => `${sub.from_name} por ${sub.to_name}`).join("; ")}. No cumple: ${delServidor(response.best_rejected.failed.join(", "))}.`
                : null
            ]
              .filter(Boolean)
              .join("\n")}
          </Aviso>
        )}
        {/* Sin propuesta no hay cambios que explicar: los descartes y el método siguen en la misma hoja, que si no quedaba casi vacía. */}
        {proposal ? null : resto()}
      </Hoja>

      {proposal ? (
        <Hoja>
          {porQue()}
          {resto()}
        </Hoja>
      ) : null}
    </DocumentoDeInforme>
  );
}

export async function createImprovementProposalPdfBlob(input: ImprovementProposalPdfInput): Promise<Blob> {
  return renderizarInforme(<ProposalDocument {...input} />);
}

export async function downloadImprovementProposalPdf(input: ImprovementProposalPdfInput): Promise<void> {
  descargar(await createImprovementProposalPdfBlob(input), nombreDelFicheroDeLaMejora(input));
}

/** «Propuesta de mejora - Propuesta García - 2026-11-14.pdf»: el documento, la cartera y el día que imprime. */
export function nombreDelFicheroDeLaMejora(input: Pick<ImprovementProposalPdfInput, "portfolioName" | "date">): string {
  return nombreDelFichero({ documento: DOCUMENTO, de: input.portfolioName?.trim() || null, fecha: diaDelDocumento(input.date) });
}
