import { Ausencia } from "./ui/Ausencia";
import { Cifra, type TipoDeCifra } from "./ui/Cifra";
import { claseDeLaDiferencia, NOTA_DEL_COLOR_DE_LA_DIFERENCIA, type SentidoDeLaCifra } from "../core/sentidoDeLaDiferencia";

/** Las cuatro cifras que se miden con la serie de una cartera. */
export interface MetricasDeCartera {
  cagr?: number | null;
  volatility?: number | null;
  /** `null` con volatilidad cero: el Sharpe no existe, y se escribe que falta, nunca un 0. */
  sharpe?: number | null;
  max_drawdown?: number | null;
}

/**
 * Qué es cada cifra decide cómo se escribe (apartado 6 de `SISTEMA_DISENO.md`): la rentabilidad, con signo y color; la
 * volatilidad y la caída máxima, porcentajes sin color; el Sharpe, un ratio.
 *
 * La diferencia de dos porcentajes va en puntos, «−5,24 pp», como Buscar sustituciones, Comparar propuestas y el papel (V3-8 de la revisión final):
 * «−5,24 %» se lee como una variación relativa. El Sharpe no es un porcentaje y va sin unidad, con su signo.
 *
 * Desde el 14-11-2026 (Óscar: recuperar el color y los datos de antes del rediseño), la diferencia vuelve a ir en verde si la segunda cartera
 * mejora y en rojo si empeora, según el sentido de cada cifra: más rentabilidad y más Sharpe, mejor; menos volatilidad y una caída menos
 * profunda, mejor. El signo escrito no cambia: una volatilidad que baja se escribe con «−» y va en verde. Lo que se escribe como cero, sin color.
 */
function Diferencia({ antes, despues, tipo, sentido }: { antes: number; despues: number; tipo: TipoDeCifra; sentido: SentidoDeLaCifra }) {
  const valor = despues - antes;
  const clase = claseDeLaDiferencia(antes, despues, sentido, tipo === "ratio" ? 2 : 4);
  if (tipo === "ratio") return <Cifra className={clase} tipo="ratio" valor={valor} conSigno />;
  return <Cifra className={clase} colorDeSigno={false} tipo="puntos" valor={valor} />;
}

/**
 * Una cabecera de cifra parte en dos líneas si no cabe (modules.css), y el «%» no se queda solo en la segunda: el espacio que lo separa de su
 * número no parte. Es lo que deja caber la tabla entera a 1024 con «Parte medida (88 %)» y «Máx. Sharpe (máx. 35 % por activo)».
 */
const cabecera = (rotulo: string) => rotulo.replace(/ %/g, "\u00a0%");

function Fila({ label, conActual, a, b, tipo, sentido, noAplica = false }: {
  label: string;
  conActual: boolean;
  a?: number | null;
  b?: number | null;
  tipo: TipoDeCifra;
  sentido: SentidoDeLaCifra;
  /** En alguna de las dos no se enseña: el Sharpe de una sola acción. */
  noAplica?: "a" | "b" | false;
}) {
  const comparable = !noAplica && typeof a === "number" && typeof b === "number" && !Number.isNaN(a) && !Number.isNaN(b);
  return (
    <tr>
      <td>{label}</td>
      {conActual ? (
        <td className="num">{noAplica === "a" ? <Ausencia clase="no-aplica" /> : <Cifra tipo={tipo} valor={a} estrecha />}</td>
      ) : null}
      <td className="num">{noAplica === "b" ? <Ausencia clase="no-aplica" /> : <Cifra tipo={tipo} valor={b} estrecha />}</td>
      {conActual ? (
        <td className="num">
          {comparable
            ? <strong><Diferencia antes={a} despues={b} tipo={tipo} sentido={sentido} /></strong>
            : <Ausencia clase={noAplica ? "no-aplica" : "falta"} estrecha={!noAplica} />}
        </td>
      ) : null}
    </tr>
  );
}

/**
 * La tabla de la Comparativa de Simular: la misma cuenta se lee igual en todas partes. Sin `rotuloA`, una sola columna: no hay con qué
 * compararla, y una resta contra nada sería una cifra inventada.
 *
 * El envoltorio va aquí, en la pieza, y no en las pantallas que la usan (trampa 5): con una cabecera larga, como «Parte medida (88 %)» o
 * «Máx. Sharpe (máx. 35 % por activo)», la tabla no cabía en su columna a 1024 y a 1280, y sin él empujaba la página y cortaba «Diferencia».
 * Desde que esas cabeceras parten en dos líneas cabe entera en los seis anchos; si un rótulo más largo no cupiera, se desliza en su caja.
 */
export function TablaDeMetricasComparativas({ aria, rotuloA, rotuloB, a, b, sharpeNoAplica = false }: {
  aria: string;
  rotuloA?: string;
  rotuloB: string;
  a?: MetricasDeCartera;
  b?: MetricasDeCartera;
  sharpeNoAplica?: "a" | "b" | false;
}) {
  const conActual = rotuloA !== undefined;
  return (
    <>
    <div aria-label={`${aria} (tabla desplazable)`} className="report-table-wrapper" role="group" tabIndex={0}>
      <table className="report-table backtest-metrics-table" aria-label={aria}>
        <thead>
          <tr>
            <th scope="col">Métrica</th>
            {rotuloA !== undefined ? <th className="num" scope="col">{cabecera(rotuloA)}</th> : null}
            <th className="num" scope="col">{cabecera(rotuloB)}</th>
            {conActual ? <th className="num" scope="col">Diferencia</th> : null}
          </tr>
        </thead>
        <tbody>
          <Fila label="Rentabilidad anualizada" conActual={conActual} a={a?.cagr} b={b?.cagr} tipo="rentabilidad" sentido="mas" />
          <Fila label="Volatilidad" conActual={conActual} a={a?.volatility} b={b?.volatility} tipo="porcentaje" sentido="menos" />
          <Fila label="Sharpe" conActual={conActual} a={a?.sharpe} b={b?.sharpe} tipo="ratio" sentido="mas" noAplica={sharpeNoAplica} />
          <Fila label="Caída máxima" conActual={conActual} a={a?.max_drawdown} b={b?.max_drawdown} tipo="porcentaje" sentido="menosProfunda" />
        </tbody>
      </table>
    </div>
    {/* Sin diferencia no hay color que explicar. */}
    {conActual ? <p className="cmp-note">{NOTA_DEL_COLOR_DE_LA_DIFERENCIA}</p> : null}
    </>
  );
}
