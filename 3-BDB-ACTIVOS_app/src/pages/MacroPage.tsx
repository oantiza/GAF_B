import { useEffect, useMemo, useState } from "react";
import { fetchEcbRates, type EcbRateId, type EcbRatesResult } from "../adapters/ecbRatesBackend";
import { fetchEcbYieldCurve, type EcbYieldCurveResult } from "../adapters/ecbYieldCurveBackend";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { EconomicCalendarPanel } from "../components/EconomicCalendarPanel";
import { DividendsPanel } from "../components/DividendsPanel";
import { EarningsPanel } from "../components/EarningsPanel";
import { EuroYieldCurvePanel } from "../charts/EuroYieldCurveChart";
import { fecha } from "../core/formato";
import { Ausencia } from "../components/ui/Ausencia";
import { Cifra } from "../components/ui/Cifra";
import { Esqueleto } from "../components/ui/Esqueleto";
import { Panel } from "../components/ui/Panel";
import { Respuesta, type DatoDeRespuesta } from "../components/ui/Respuesta";

import type { MacroTab } from "./mercadoTabs";

const SERIES: { id: EcbRateId; label: string }[] = [
  { id: "estr", label: "€STR" },
  { id: "dfr", label: "Facilidad de depósito" },
  { id: "mro", label: "Operaciones de financiación" },
  { id: "mlf", label: "Facilidad marginal de crédito" }
];

/** Las tres pestañas de la agenda de Mercado. La página ya tiene H1 y un solo nivel de pestañas. */
export function MacroPage({ tab }: { tab: MacroTab }) {
  const [rateResult, setRateResult] = useState<EcbRatesResult | null>(null);
  const [rateError, setRateError] = useState<unknown>(null);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [rateAttempt, setRateAttempt] = useState(0);
  const [yieldCurve, setYieldCurve] = useState<EcbYieldCurveResult | null>(null);
  const [yieldCurveError, setYieldCurveError] = useState<unknown>(null);
  const [yieldCurveLoading, setYieldCurveLoading] = useState(true);
  const [yieldCurveAttempt, setYieldCurveAttempt] = useState(0);
  /* ACT-17: los tipos y la curva solo se enseñan en «Tipos y calendario», y solo ahí se piden.
     Antes, abrir Dividendos o Resultados lanzaba las dos llamadas al BCE sin enseñar su resultado. */
  const enCalendario = tab === "calendario";

  useEffect(() => {
    if (!enCalendario) return;
    let active = true;
    setRatesLoading(true);
    setRateError(null);
    fetchEcbRates()
      .then((result) => {
        if (!active) return;
        setRateResult(result);
        setRatesLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRateResult(null);
        setRateError(error);
        setRatesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rateAttempt, enCalendario]);

  useEffect(() => {
    if (!enCalendario) return;
    let active = true;
    setYieldCurveLoading(true);
    setYieldCurveError(null);
    fetchEcbYieldCurve()
      .then((result) => {
        if (!active) return;
        setYieldCurve(result);
        setYieldCurveLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setYieldCurve(null);
        setYieldCurveError(error);
        setYieldCurveLoading(false);
      });
    return () => { active = false; };
  }, [yieldCurveAttempt, enCalendario]);

  const ratesById = useMemo(
    () => new Map((rateResult?.rates ?? []).map((rate) => [rate.id, rate])),
    [rateResult]
  );
  const liveRateCount = rateResult?.live_count ?? 0;

  /* La respuesta de la pestaña: los cuatro tipos, cada uno con la fecha de su observación, porque no se publican el
     mismo día (el €STR sale al día siguiente; los tipos clave cambian en las reuniones). Son niveles, no resultados:
     van sin color y sin signo. Lo que no ha llegado se dice; nunca se pone otro valor en su sitio. */
  const tipos: DatoDeRespuesta[] = SERIES.map(({ id, label }) => {
    const rate = ratesById.get(id);
    if (rate) return { rotulo: label, cifra: <Cifra tipo="porcentaje" valor={rate.value / 100} />, apunte: `a ${fecha(rate.date) ?? rate.date}` };
    return { rotulo: label, cifra: <Ausencia clase="falta" />, apunte: "sin observación del BCE" };
  });

  return (
    <article className="macro-page">
      <div className="stack stack--bloques">
        {tab === "calendario" ? (
          <>
            {rateError ? <AsyncErrorBanner error={rateError} onRetry={() => setRateAttempt((value) => value + 1)} /> : null}
            <Panel
              claseDelCuerpo="stack stack--tight"
              estado={!ratesLoading && liveRateCount < SERIES.length ? `${liveRateCount} de ${SERIES.length} series` : null}
              subtitulo="Banco Central Europeo · los tipos clave cambian en las reuniones del BCE; el €STR es diario"
              titulo="Tipos del BCE"
            >
              {ratesLoading ? (
                <>
                  <p className="sr-only">Consultando las últimas observaciones del BCE…</p>
                  <Esqueleto lineas={2} />
                </>
              ) : (
                <Respuesta datos={tipos} etiqueta="Los tipos del día" />
              )}
            </Panel>
            <EuroYieldCurvePanel
              result={yieldCurve}
              loading={yieldCurveLoading}
              error={yieldCurveError}
              onRetry={() => setYieldCurveAttempt((value) => value + 1)}
            />
            <EconomicCalendarPanel />
          </>
        ) : tab === "dividendos" ? (
          <DividendsPanel />
        ) : (
          <EarningsPanel />
        )}
      </div>
    </article>
  );
}
