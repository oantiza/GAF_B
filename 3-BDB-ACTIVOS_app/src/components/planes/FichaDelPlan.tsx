import { useState, type ReactNode } from "react";
import { leerSerieDelPlan } from "../../adapters/planesDeLaBase";
import { useModoCliente } from "../../app/ClientModeContext";
import { OaaLineChart } from "../../charts/oaa";
import * as formato from "../../core/formato";
import {
  avisosDelPlan,
  celdaDeComision,
  celdaDeRentabilidad,
  lineasDeDatos,
  lineasDeRentabilidad,
  lineasDeRiesgo,
  notasDeLectura,
  type LineaDelPlan
} from "../../core/planes/lectura";
import {
  diasDeRetrasoDeLaRentabilidad,
  hayHistoriaPara,
  MAXIMO_A_COMPARAR,
  nombreDelTipo,
  PERIODOS_DEL_GRAFICO,
  puntosDelPeriodo,
  type PeriodoDelGrafico,
  type PlanDePensiones,
  type VentanaDeRentabilidad
} from "../../core/planes/modelo";
import { useAsyncData } from "../../core/useAsyncData";
import { AsyncErrorBanner } from "../AsyncErrorBanner";
import { Ausencia } from "../ui/Ausencia";
import { Aviso } from "../ui/Aviso";
import { Button } from "../ui/Button";
import { Cifra } from "../ui/Cifra";
import { Esqueleto } from "../ui/Esqueleto";
import { PageHeader } from "../ui/PageHeader";
import { Panel } from "../ui/Panel";
import { Respuesta, type DatoDeRespuesta } from "../ui/Respuesta";
import { SegmentedControl } from "../ui/SegmentedControl";
import { EnlaceDeVuelta } from "./EnlaceDeVuelta";

/**
 * La ficha de un plan de pensiones o de una EPSV: qué es, cómo ha evolucionado el valor de su participación y las
 * cifras que da el proveedor. Todo a la vista, sin pestañas: son cuatro bloques.
 *
 * En el orden de toda pantalla (rediseño del 14-11-2026): la vuelta a la lista, la cabecera con lo que es, la banda
 * con lo que el proveedor da —el valor de la participación, la rentabilidad a 1, 3 y 5 años, cada una con **su**
 * fecha, y la comisión que publica el banco—; después, el plan, la evolución, la rentabilidad, el riesgo y las notas.
 *
 * **No hay ninguna cifra nuestra.** El gráfico dibuja el valor de la participación tal como se publicó —el último de
 * cada mes—, sin llevarlo a base 100 ni compararlo con nada. Y no hay botón de añadir a cartera: un plan no es
 * cartera.
 */

/** El eje del gráfico, con punto de millar y dos decimales (PLA-19, FMT-06): «1.234,56 €». */
const euros = (valor: unknown): string => (typeof valor === "number" ? (formato.importe(valor) ?? "") : "");

/**
 * El valor de la participación con los cinco decimales que da el proveedor, y con punto de millar (FMT-06): «1.234,56789 €».
 * `lectura` lo escribe con `fmtNum`, que no agrupa las cuatro cifras; aquí se escribe con el módulo común.
 */
const valorDeLaParticipacion = (importe: number): string => `${formato.numero(importe, { decimales: 5 }) ?? ""}\u00a0€`;

/**
 * Las líneas de un bloque. Con `conSigno`, las cifras son rentabilidades —resultados—: llevan su signo escrito y su
 * color. Las demás, en tinta.
 */
function Lineas({ lineas, conSigno = false }: { lineas: readonly LineaDelPlan[]; conSigno?: boolean }) {
  return (
    <div className="rows">
      {lineas.map((linea) => {
        const { celda } = linea;
        let valor: ReactNode = celda.texto;
        if (celda.ausencia) valor = <Ausencia clase={celda.ausencia} />;
        else if (conSigno && typeof celda.valor === "number") valor = <Cifra tipo="rentabilidad" valor={celda.valor} />;
        else if (linea.clave === "valor" && typeof celda.valor === "number") valor = valorDeLaParticipacion(celda.valor);
        return (
          <div className="rows__item" key={linea.clave}>
            <span className="rows__label">{linea.rotuloEnSuBloque ?? linea.rotulo}</span>
            <span className="rows__value">
              {valor}
              {celda.apunte ? ` · ${celda.apunte}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Lo que el proveedor da del plan, en una banda: cada cifra con su fecha, y lo que no da, dicho. */
function datosDeLaRespuesta(plan: PlanDePensiones, conProveedor: boolean): DatoDeRespuesta[] {
  const fechaDeLaRentabilidad = plan.rentabilidadFecha ? formato.fecha(plan.rentabilidadFecha) : null;
  /* Las rentabilidades pueden ir meses por detrás: el apunte lo dice con su fecha, y el aviso de arriba lo explica. */
  const retraso = diasDeRetrasoDeLaRentabilidad(plan);
  const apunteDeLaRentabilidad = fechaDeLaRentabilidad
    ? `a ${fechaDeLaRentabilidad}${retraso !== undefined ? `, ${formato.numero(retraso) ?? ""} días antes de la consulta` : ""}`
    : undefined;
  const rentabilidad = (ventana: VentanaDeRentabilidad, rotulo: string): DatoDeRespuesta => {
    const celda = celdaDeRentabilidad(plan, ventana);
    return {
      rotulo,
      cifra: <Cifra ausencia={celda.ausencia ?? "falta"} tipo="rentabilidad" valor={plan.rentabilidad[ventana]} />,
      apunte: celda.ausencia ? undefined : apunteDeLaRentabilidad
    };
  };
  const comision = celdaDeComision(plan);
  return [
    {
      rotulo: "Valor de la participación",
      /* Con los cinco decimales que da el proveedor, como la fila «Valor de la participación» de «El plan» (FMT-06):
         arriba salía con cuatro y abajo con cinco, la misma cifra escrita de dos maneras. */
      cifra: <Cifra decimales={5} tipo="importe" valor={plan.valor?.importe} />,
      apunte: plan.valor ? `a ${formato.fecha(plan.valor.fecha) ?? plan.valor.fecha}` : undefined,
      principal: true
    },
    rentabilidad("1y", "Rentabilidad a 1 año"),
    rentabilidad("3y", "Rentabilidad anualizada a 3 años"),
    rentabilidad("5y", "Rentabilidad anualizada a 5 años"),
    {
      rotulo: "Comisión de gestión",
      /* Un coste: sin color. La que publica el banco, y si no la publica, falta. */
      cifra: <Cifra ausencia={comision.ausencia ?? "falta"} tipo="porcentaje" valor={plan.comisionDeGestion} />,
      apunte: comision.ausencia ? undefined : conProveedor ? "la que publica el banco" : "la que publica la entidad comercializadora"
    }
  ];
}

function EvolucionDelPlan({ plan, conProveedor }: { plan: PlanDePensiones; conProveedor: boolean }) {
  const [periodo, setPeriodo] = useState<PeriodoDelGrafico>("todo");
  const { data, error, loading, retry } = useAsyncData(async () => ({ serie: await leerSerieDelPlan(plan.id) }), [plan.id]);
  const serie = data?.serie;
  const puntos = serie ? puntosDelPeriodo(serie, hayHistoriaPara(serie, periodo) ? periodo : "todo") : [];
  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];

  /* La procedencia va bajo el título: de qué fechas, cuántos valores y de quién. */
  const procedencia = primero && ultimo
    ? `El último valor de cada mes, ${formato.periodo(primero.fecha, ultimo.fecha) ?? ""} · ${formato.numero(puntos.length) ?? ""} valores${conProveedor ? " · Morningstar" : ""}`
    : "El último valor publicado de cada mes";

  return (
    <Panel
      acciones={
        serie ? (
          <SegmentedControl
            label="Periodo del gráfico"
            onChange={setPeriodo}
            options={PERIODOS_DEL_GRAFICO.map((opcion) => ({ id: opcion.id, label: opcion.nombre, disabled: !hayHistoriaPara(serie, opcion.id) }))}
            value={hayHistoriaPara(serie, periodo) ? periodo : "todo"}
          />
        ) : undefined
      }
      className="planes-ficha__principal"
      subtitulo={procedencia}
      titulo="Evolución del valor de la participación"
    >
      {error ? <AsyncErrorBanner error={error} onRetry={retry} /> : null}
      {loading && !data ? (
        <div aria-busy="true">
          <p className="sr-only" role="status">
            Leyendo la serie…
          </p>
          <Esqueleto alto={320} />
        </div>
      ) : null}
      {data && !serie ? (
        <p className="cmp-note">
          <Ausencia clase="falta" motivo="Sin serie" />: no hay evolución que dibujar de este plan.
        </p>
      ) : null}
      {serie ? (
        <>
          <OaaLineChart
            ariaLabel={`Valor de la participación de ${plan.nombre}, ${primero && ultimo ? (formato.periodo(primero.fecha, ultimo.fecha) ?? "") : ""}`}
            height={320}
            /* El plan es la serie principal de su ficha: marino, por su papel. */
            /* «Valor», y no el rótulo entero: la etiqueta del final de la línea lo cortaba en «Valor de la par…», y el título
               del bloque ya dice de qué valor se habla. */
            series={[{ id: plan.id, label: "Valor", papel: "cartera", values: puntos.map((punto) => ({ date: punto.fecha, value: punto.valor })) }]}
            showLegend={false}
            yAxisWidth={64}
            yFormatter={euros}
          />
          <p className="cmp-note">
            En euros, tal como se publicó: no está en base 100 ni descuenta la inflación. Un plan no reparte, así que su valor recoge todo lo que ha ganado o perdido, ya
            descontadas sus comisiones.
          </p>
        </>
      ) : null}
    </Panel>
  );
}

export function FichaDelPlan({
  plan,
  marcado,
  cuantosMarcados,
  alMarcar,
  alComparar,
  alVolver
}: {
  plan: PlanDePensiones;
  /** Si está entre los que se van a comparar. */
  marcado: boolean;
  cuantosMarcados: number;
  alMarcar: (id: string) => void;
  /** Ir a la comparación de los marcados. */
  alComparar: () => void;
  alVolver: () => void;
}) {
  const { seEnsena } = useModoCliente();
  const conProveedor = seEnsena("fuenteDeDatos");
  const avisos = avisosDelPlan(plan);
  const consultado = `Consultado el ${formato.fecha(plan.consultado) ?? plan.consultado}${conProveedor ? " · Morningstar" : ""}`;
  const lleno = !marcado && cuantosMarcados >= MAXIMO_A_COMPARAR;

  return (
    <div className="planes-ficha">
      <EnlaceDeVuelta alVolver={alVolver} />
      <PageHeader
        actions={
          <>
            <Button
              aria-pressed={marcado}
              disabled={lleno}
              onClick={() => alMarcar(plan.id)}
              /* Desactivado, dice por qué (PLA-24). */
              title={lleno ? `Ya hay ${MAXIMO_A_COMPARAR} planes para comparar: quita uno para añadir otro.` : undefined}
              variant="secondary"
            >
              {marcado ? "Quitar de la comparación" : "Añadir a la comparación"}
            </Button>
            {/* Con este y al menos otro marcado, la comparación está a un clic desde la ficha. */}
            {marcado && cuantosMarcados >= 2 ? (
              <Button onClick={alComparar} variant="primary">
                {`Comparar ${cuantosMarcados} planes`}
              </Button>
            ) : null}
          </>
        }
        eyebrow={[nombreDelTipo(plan.tipo), plan.categoria, plan.gestora].filter(Boolean).join(" · ")}
        title={plan.nombre}
      />

      {avisos.map((aviso) => (
        <Aviso key={aviso}>{aviso}</Aviso>
      ))}

      <Respuesta datos={datosDeLaRespuesta(plan, conProveedor)} etiqueta={`Las cifras de ${plan.nombre}, según su proveedor`} />

      <div className="planes-ficha__flujo">
        <Panel claseDelCuerpo="stack stack--tight" className="planes-ficha__lateral" subtitulo={consultado} titulo="El plan">
          <Lineas lineas={lineasDeDatos(plan, { conProveedor })} />
        </Panel>

        <EvolucionDelPlan conProveedor={conProveedor} plan={plan} />

        <Panel
          claseDelCuerpo="stack stack--tight"
          subtitulo={plan.rentabilidadFecha ? `A ${formato.fecha(plan.rentabilidadFecha) ?? plan.rentabilidadFecha}${conProveedor ? " · Morningstar" : ""}` : consultado}
          titulo="Rentabilidad"
        >
          <Lineas conSigno lineas={lineasDeRentabilidad(plan).filter((linea) => linea.clave !== "rentabilidad-fecha")} />
        </Panel>

        <Panel claseDelCuerpo="stack stack--tight" subtitulo={consultado} titulo="Riesgo y ratios">
          <Lineas lineas={lineasDeRiesgo(plan)} />
        </Panel>
      </div>

      <div className="planes-notas">
        {notasDeLectura({ conProveedor }).map((nota) => (
          <p className="cmp-note" key={nota}>
            {nota}
          </p>
        ))}
        <p className="cmp-note">Esta ficha describe el plan: no es una recomendación ni dice si le conviene a un cliente.</p>
      </div>
    </div>
  );
}
