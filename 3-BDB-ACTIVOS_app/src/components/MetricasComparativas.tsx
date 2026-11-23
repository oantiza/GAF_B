import { Ausencia } from "./ui/Ausencia";
import { Cifra, type TipoDeCifra } from "./ui/Cifra";
import { claseDeLaDiferencia, NOTA_DEL_COLOR_DE_LA_DIFERENCIA, veredictoDeLaDiferencia, type SentidoDeLaCifra } from "../core/sentidoDeLaDiferencia";

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
 *
 * Con `conPalabra` (Diseño › Simular, Óscar, 20-11-2026, y la rentabilidad objetivo de Optimizar, 21-11-2026), junto a la cifra va además la palabra, «mejora» o «empeora», con el mismo sentido que
 * el color: el estado no se dice solo con color (regla 3). Lo que se escribe como cero no lleva palabra, como no lleva color.
 */
function Diferencia({ antes, despues, tipo, sentido, conPalabra }: { antes: number; despues: number; tipo: TipoDeCifra; sentido: SentidoDeLaCifra; conPalabra: boolean }) {
  const valor = despues - antes;
  const decimales = tipo === "ratio" ? 2 : 4;
  const clase = claseDeLaDiferencia(antes, despues, sentido, decimales);
  const cifra = tipo === "ratio"
    ? <Cifra className={clase} tipo="ratio" valor={valor} conSigno />
    : <Cifra className={clase} colorDeSigno={false} tipo="puntos" valor={valor} />;
  const veredicto = conPalabra ? veredictoDeLaDiferencia(antes, despues, sentido, decimales) : null;
  if (!veredicto) return cifra;
  return <>{cifra} <span className={`diferencia__palabra ${clase}`}>{veredicto}</span></>;
}

/**
 * Una cabecera de cifra parte en dos líneas si no cabe (modules.css), y el «%» no se queda solo en la segunda: el espacio que lo separa de su
 * número no parte. Es lo que deja caber la tabla entera a 1024 con «Parte medida (88 %)» y «Máx. Sharpe (máx. 35 % por activo)».
 */
const cabecera = (rotulo: string) => rotulo.replace(/ %/g, "\u00a0%");

function Fila({ label, conActual, conPalabra, a, b, tipo, sentido, noAplica = false }: {
  label: string;
  conActual: boolean;
  conPalabra: boolean;
  a?: number | null;
  b?: number | null;
  tipo: TipoDeCifra;
  sentido: SentidoDeLaCifra;
  /** En alguna de las dos, o en las dos, no se enseña: el Sharpe de una sola acción. */
  noAplica?: "a" | "b" | "ambas" | false;
}) {
  const comparable = !noAplica && typeof a === "number" && typeof b === "number" && !Number.isNaN(a) && !Number.isNaN(b);
  return (
    <tr>
      <td>{label}</td>
      {conActual ? (
        <td className="num">{noAplica === "a" || noAplica === "ambas" ? <Ausencia clase="no-aplica" /> : <Cifra tipo={tipo} valor={a} estrecha />}</td>
      ) : null}
      <td className="num">{noAplica === "b" || noAplica === "ambas" ? <Ausencia clase="no-aplica" /> : <Cifra tipo={tipo} valor={b} estrecha />}</td>
      {conActual ? (
        <td className="num">
          {comparable
            ? <strong><Diferencia antes={a} despues={b} tipo={tipo} sentido={sentido} conPalabra={conPalabra} /></strong>
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
export function TablaDeMetricasComparativas({ aria, rotuloA, rotuloB, a, b, sharpeNoAplica = false, conPalabra = false }: {
  aria: string;
  /**
   * La palabra «mejora» o «empeora» junto a cada diferencia. En Simular (Óscar, 20-11-2026) y en la tabla de la rentabilidad objetivo de
   * Optimizar (`MedidaDelObjetivo`, Óscar, 21-11-2026).
   */
  conPalabra?: boolean;
  rotuloA?: string;
  rotuloB: string;
  a?: MetricasDeCartera;
  b?: MetricasDeCartera;
  sharpeNoAplica?: "a" | "b" | "ambas" | false;
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
          <Fila label="Rentabilidad anualizada" conActual={conActual} conPalabra={conPalabra} a={a?.cagr} b={b?.cagr} tipo="rentabilidad" sentido="mas" />
          <Fila label="Volatilidad" conActual={conActual} conPalabra={conPalabra} a={a?.volatility} b={b?.volatility} tipo="porcentaje" sentido="menos" />
          <Fila label="Sharpe" conActual={conActual} conPalabra={conPalabra} a={a?.sharpe} b={b?.sharpe} tipo="ratio" sentido="mas" noAplica={sharpeNoAplica} />
          <Fila label="Caída máxima" conActual={conActual} conPalabra={conPalabra} a={a?.max_drawdown} b={b?.max_drawdown} tipo="porcentaje" sentido="menosProfunda" />
        </tbody>
      </table>
    </div>
    {/* Sin diferencia no hay color que explicar. */}
    {conActual ? <p className="cmp-note">{NOTA_DEL_COLOR_DE_LA_DIFERENCIA}</p> : null}
    </>
  );
}
