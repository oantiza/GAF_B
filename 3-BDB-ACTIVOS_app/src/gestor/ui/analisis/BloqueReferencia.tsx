/**
 * Bloque 2: la cartera frente a su referencia, en el mismo periodo y en base 100. La referencia
 * se elige aquí mismo, a la vista («Comparar con»), y el cambio se guarda en la cartera.
 */
import { useMemo } from "react";
import { OaaLineChart, type OaaLineSeries } from "../../../charts/oaa";
import { Cifra } from "../../../components/ui/Cifra";
import { Panel } from "../../../components/ui/Panel";
import { esDemostracion } from "../../demo/carteraDemo";
import { fechaDeInicioDelPeriodo, type Analisis } from "../../motor/analisis";
import { metrica } from "../../motor/metricas/registro";
import type { ReferenciaDeCartera } from "../../motor/modelo";
import { nombreDeLaReferencia } from "../../motor/referencia";
import { SelectorDeReferencia } from "../dialogos/SelectorDeReferencia";
import type { CarteraAbierta } from "../estado/useCarteraAbierta";
import { FilaDeDato, FilaDeMetrica } from "../piezas";
import { aclarar, escrito } from "../textos";

const TITULO = "Frente a la referencia";

export function BloqueReferencia({ analisis, abierta, cargando = false }: { analisis: Analisis; abierta: CarteraAbierta; cargando?: boolean }) {
  const { cartera } = abierta;
  const referencia = analisis.referencia;
  const series = useMemo<OaaLineSeries[]>(() => {
    if (!referencia?.disponible) return [];
    return [
      { id: "cartera", label: "Cartera", papel: "cartera", values: aclarar(analisis.serie).map((punto) => ({ date: punto.fecha, value: punto.valor })) },
      { id: "indice", label: referencia.nombre, papel: "referencia", values: aclarar(referencia.serie).map((punto) => ({ date: punto.fecha, value: punto.valor })) }
    ];
  }, [analisis.serie, referencia]);

  if (!analisis.rentabilidad) return null;

  const cambiar = (nueva: ReferenciaDeCartera | undefined) => abierta.cambiar("Cambiar la referencia", (actual) => ({ ...actual, referencia: nueva }));
  const selector = (
    <SelectorDeReferencia
      alCambiar={cambiar}
      bloqueada={esDemostracion(cartera) ? "La cartera de demostración se compara con su propio índice, inventado como el resto de sus datos: aquí no se puede cambiar." : undefined}
      divisaBase={cartera.divisaBase}
      referencia={cartera.referencia}
    />
  );

  if (!cartera.referencia) {
    return (
      <Panel claseDelCuerpo="stack stack--tight" titulo={TITULO}>
        {selector}
      </Panel>
    );
  }

  /* Recién cambiada, el análisis aún es el de la anterior: no se enseña una comparación que ya no es la elegida. */
  const alDia = referencia !== undefined && referencia.nombre === nombreDeLaReferencia(cartera.referencia);
  if (cargando && !alDia) {
    return (
      <Panel claseDelCuerpo="stack stack--tight" subtitulo={nombreDeLaReferencia(cartera.referencia)} titulo={TITULO}>
        {selector}
        <p className="cmp-note">Leyendo los datos de la referencia…</p>
      </Panel>
    );
  }

  if (!referencia || !referencia.disponible) {
    return (
      <Panel claseDelCuerpo="stack stack--tight" subtitulo={nombreDeLaReferencia(cartera.referencia)} titulo={TITULO}>
        {selector}
        <p className="cmp-note">{referencia?.motivo ?? "No se ha podido leer la serie de la referencia. Mira la vista «Comprobaciones» de esta pestaña."}</p>
      </Panel>
    );
  }

  return (
    <Panel claseDelCuerpo="stack stack--tight" subtitulo={`${referencia.nombre} · en base 100 desde el ${escrito.fecha(fechaDeInicioDelPeriodo(analisis))}`} titulo={TITULO}>
      {selector}
      <OaaLineChart ariaLabel={`Evolución de la cartera frente a ${referencia.nombre}, en base 100`} height={260} series={series} />
      <div className="rows">
        <FilaDeDato rotulo="Rentabilidad de la cartera" salvedad={metrica("rentabilidad").salvedad?.(analisis)}><Cifra tipo="rentabilidad" valor={analisis.rentabilidad.twr} /></FilaDeDato>
        <FilaDeDato rotulo="Rentabilidad de la referencia">
          <Cifra tipo="rentabilidad" valor={referencia.rentabilidad} />
        </FilaDeDato>
        <FilaDeMetrica analisis={analisis} metrica={metrica("diferenciaConLaReferencia")} />
      </div>
    </Panel>
  );
}
