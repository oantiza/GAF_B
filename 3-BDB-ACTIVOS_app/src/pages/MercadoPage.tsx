import { lazy, Suspense, useEffect, useState } from "react";
import { LoadingState } from "../components/ui/AsyncState";
import { PageHeader } from "../components/ui/PageHeader";
import { PanelDePestana, SegmentedTabs } from "../components/ui/SegmentedTabs";
import { usePestanaEnLaDireccion } from "../core/usePestanaEnLaDireccion";
import "../styles/mercado.css";

import { MERCADO_TABS, type MercadoTab } from "./mercadoTabs";

const MacroPage = lazy(() => import("./MacroPage").then((m) => ({ default: m.MacroPage })));
const StrategyPage = lazy(() => import("./StrategyPage").then((m) => ({ default: m.StrategyPage })));

/* Ola 3: un solo nivel de pestañas. «Agenda» era un contenedor de tres
   pestañas más; ahora sus tres vistas cuelgan directamente de Mercado. */
export type { MercadoTab };

interface MercadoPageProps {
  /** Pestaña inicial cuando se llega por una URL legacy (/agenda, /estrategia). */
  initialTab?: MercadoTab;
}

const IDS_DE_PESTANA: readonly MercadoTab[] = MERCADO_TABS.map((pestana) => pestana.id);
const PRIMERA: MercadoTab = "calendario";

/**
 * Antes de que el gancho lea la dirección, se pone al día lo que llega de otra forma, sin entrada nueva en el
 * historial: una dirección antigua (`/estrategia`, que trae `initialTab`) y una del formato anterior de esta misma
 * pantalla (`/mercado#dividendos`, ACT-17), que alguien pudo guardar o compartir. Las dos acaban en
 * `#pestana=dividendos`, el formato común de toda la aplicación.
 */
function ponerAlDiaLaDireccion(initialTab: MercadoTab | undefined) {
  let crudo = window.location.hash.replace(/^#/, "");
  try {
    crudo = decodeURIComponent(crudo);
  } catch {
    /* Un `%` mal formado no es ninguna pestaña: se queda como está y el gancho lo lee como la primera. */
  }
  const delFormatoAnterior = IDS_DE_PESTANA.find((id) => id === crudo);
  const pedida = initialTab ?? delFormatoAnterior;
  if (!pedida) return;
  const hash = pedida === PRIMERA ? "" : `#pestana=${encodeURIComponent(pedida)}`;
  const destino = `${window.location.pathname}${window.location.search}${hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== destino) {
    window.history.replaceState(window.history.state, "", destino);
  }
}

/**
 * Mercado: ¿qué pasa en los mercados esta semana que deba contar a mis clientes? Cuatro pestañas —tipos y
 * calendario, dividendos, resultados y el informe de estrategia—, y la elegida va en la dirección
 * (`/mercado#pestana=dividendos`) con el gancho común: se puede recargar, compartir y volver con «Atrás». Una
 * dirección sin pestaña es la primera, así que pulsar «Mercado» en el menú estando ya aquí vuelve a ella.
 */
export function MercadoPage({ initialTab }: MercadoPageProps) {
  /* Va antes del gancho para que este lea ya la dirección puesta al día. */
  useState(() => {
    ponerAlDiaLaDireccion(initialTab);
    return true;
  });
  const [tab, elegir] = usePestanaEnLaDireccion<MercadoTab>(IDS_DE_PESTANA, PRIMERA);

  /* La intención de una dirección antigua puede llegar con la pantalla ya montada. */
  useEffect(() => {
    if (initialTab) elegir(initialTab);
  }, [initialTab, elegir]);

  return (
    <article className="mercado-page">
      <PageHeader
        description="Tipos del BCE, calendario económico, dividendos y resultados del IBEX 35, y el informe de estrategia."
        title="Mercado"
      />
      <SegmentedTabs idPrefix="mercado" label="Secciones de mercado" onChange={elegir} tabs={MERCADO_TABS} value={tab} />
      <PanelDePestana className="mercado-panel" idPrefix="mercado" pestana={tab}>
        <Suspense fallback={<LoadingState>Cargando módulo…</LoadingState>}>
          {tab === "estrategia" ? <StrategyPage embedded /> : <MacroPage tab={tab} />}
        </Suspense>
      </PanelDePestana>
    </article>
  );
}
