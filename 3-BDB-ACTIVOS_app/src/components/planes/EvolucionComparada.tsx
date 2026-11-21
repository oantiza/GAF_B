import { useMemo, useState } from "react";
import { leerSerieDelPlan } from "../../adapters/planesDeLaBase";
import { OaaLineChart } from "../../charts/oaa";
import * as formato from "../../core/formato";
import {
  evolucionComparada,
  hayEvolucionPara,
  lineasQueAcabanAntes,
  mesMas,
  nombreDelMes,
  ultimoMesCerrado,
  type PlanParaComparar
} from "../../core/planes/evolucionComparada";
import { PERIODOS_DEL_GRAFICO, type PeriodoDelGrafico, type PlanDePensiones } from "../../core/planes/modelo";
import { useAsyncData } from "../../core/useAsyncData";
import { AsyncErrorBanner } from "../AsyncErrorBanner";
import { Esqueleto } from "../ui/Esqueleto";
import { Panel } from "../ui/Panel";
import { SegmentedControl } from "../ui/SegmentedControl";

/**
 * La evolución de los planes que se comparan, en un mismo gráfico y en base 100.
 *
 * **Es el único cálculo de Planes y EPSV**, y lo pidió Óscar sabiendo que lo es (13-11-2026): dos valores de
 * participación no se pueden dibujar juntos tal cual —uno vale 12 € y otro 230 €—, así que cada serie se divide por su
 * valor en un mes común. Cómo se elige ese mes, por qué no entra el mes en curso y qué pasa con un plan que dejó de
 * publicar está en `core/planes/evolucionComparada.ts`; aquí solo se dibuja y se dice.
 *
 * Las líneas van numeradas, al final de cada una y en la leyenda: no se distinguen solo por el color. Cada plan es una
 * serie más, en su orden (`papel: "serie"`): aquí no hay cartera ni referencia, y ninguno va en el marino de la principal.
 */
export function EvolucionComparada({ planes, conProveedor }: { planes: readonly PlanDePensiones[]; conProveedor: boolean }) {
  const [periodo, setPeriodo] = useState<PeriodoDelGrafico>("todo");
  const ids = planes.map((plan) => plan.id).join(",");
  const { data, error, loading, retry } = useAsyncData<PlanParaComparar[]>(
    () => Promise.all(planes.map(async (plan) => ({ id: plan.id, nombre: plan.nombre, serie: await leerSerieDelPlan(plan.id) }))),
    [ids]
  );
  /* El día de la consulta más reciente fija cuál es el último mes entero. */
  const consultado = planes.map((plan) => plan.consultado).sort().at(-1) ?? "";

  const { elegido, disponibles, evolucion } = useMemo(() => {
    if (!data || !consultado) return { elegido: periodo, disponibles: new Set<PeriodoDelGrafico>(), evolucion: null };
    const queHay = new Set(PERIODOS_DEL_GRAFICO.map((opcion) => opcion.id).filter((id) => hayEvolucionPara(data, id, consultado)));
    /* Un periodo que la historia común no cubre no se dibuja con otro nombre: se vuelve a «Todo». */
    const vigente: PeriodoDelGrafico = queHay.has(periodo) ? periodo : "todo";
    return { elegido: vigente, disponibles: queHay, evolucion: evolucionComparada(data, vigente, consultado) };
  }, [data, periodo, consultado]);

  const hayGrafico = evolucion?.mesBase !== undefined && evolucion.mesFinal !== undefined;
  const mesEnCurso = consultado ? mesMas(ultimoMesCerrado(consultado), 1) : "";
  const meses = hayGrafico ? new Set(evolucion.lineas.flatMap((linea) => linea.puntos.map((punto) => punto.mes))).size : 0;

  /* La procedencia va bajo el título: la base, hasta cuándo, cuántos datos y de quién. */
  const procedencia = hayGrafico
    ? `Base 100 en ${nombreDelMes(evolucion.mesBase as string)} · el último valor de cada mes, hasta ${nombreDelMes(evolucion.mesFinal as string)} · ${formato.numero(meses) ?? ""} meses${conProveedor ? " · Morningstar" : ""}`
    : "El valor de la participación de cada plan, en base 100";

  return (
    <Panel
      acciones={
        hayGrafico ? (
          <SegmentedControl
            label="Periodo del gráfico"
            onChange={setPeriodo}
            options={PERIODOS_DEL_GRAFICO.map((opcion) => ({ id: opcion.id, label: opcion.nombre, disabled: !disponibles.has(opcion.id) }))}
            value={elegido}
          />
        ) : undefined
      }
      subtitulo={procedencia}
      titulo="Evolución comparada"
    >
      {error ? <AsyncErrorBanner error={error} onRetry={retry} /> : null}
      {loading && !data ? (
        <div aria-busy="true">
          <p className="sr-only" role="status">
            Leyendo las series…
          </p>
          <Esqueleto alto={340} />
        </div>
      ) : null}
      {evolucion && hayGrafico ? (
        <>
          <OaaLineChart
            ariaLabel={`Evolución en base 100 de ${evolucion.lineas.map((linea) => linea.nombre).join(", ")}, de ${nombreDelMes(evolucion.mesBase as string)} a ${nombreDelMes(evolucion.mesFinal as string)}`}
            height={340}
            referenceValue={100}
            series={evolucion.lineas.map((linea, indice) => ({
              id: linea.id,
              label: `${indice + 1} · ${linea.nombre}`,
              papel: "serie" as const,
              etiquetaFinal: String(indice + 1),
              values: linea.puntos.map((punto) => ({ date: punto.fecha, value: punto.valor }))
            }))}
          />
          <div className="planes-notas">
            <p className="cmp-note">
              Cada línea vale 100 en {nombreDelMes(evolucion.mesBase as string)}
              {elegido === "todo" ? ", el primer mes en que todos tienen valor," : ""} y enseña cuánto ha cambiado desde entonces el valor de la participación de ese plan. Es el único
              cálculo de esta pantalla: reescala los valores publicados para que arranquen juntos, y no es la rentabilidad que da el proveedor, que tiene sus propias fechas.
            </p>
            <p className="cmp-note">Va mes a mes y solo con meses enteros: {nombreDelMes(mesEnCurso)} no ha acabado y no entra.</p>
            {lineasQueAcabanAntes(evolucion).map((linea) => (
              <p className="cmp-note" key={linea.id}>
                {linea.nombre} no tiene ningún mes completo después de {nombreDelMes(linea.ultimoMes)}: su línea acaba ahí.
              </p>
            ))}
          </div>
        </>
      ) : null}
      {evolucion && !hayGrafico ? (
        <p className="cmp-note">No hay ningún mes en que al menos dos de estos planes tengan valor: no hay evolución que comparar.</p>
      ) : null}
      {evolucion?.fuera.map((plan) => (
        <p className="cmp-note" key={plan.id}>
          {plan.nombre} no se dibuja: {plan.motivo}.
        </p>
      ))}
    </Panel>
  );
}
