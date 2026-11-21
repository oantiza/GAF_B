import { useMemo } from "react";
import { useModoCliente } from "../../app/ClientModeContext";
import * as formato from "../../core/formato";
import { lineasDelPlan, notasDeComparacion, notasDeLectura, type LineaDelPlan } from "../../core/planes/lectura";
import { nombreDelTipo, type PlanDePensiones } from "../../core/planes/modelo";
import type { CeldaDeTabla } from "../../types/tablaDeDatos";
import { TablaComparativa, type ColumnaComparada, type FilaComparada } from "../tabla/TablaComparativa";
import { Aviso } from "../ui/Aviso";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/PageHeader";
import { Panel } from "../ui/Panel";
import { EnlaceDeVuelta } from "./EnlaceDeVuelta";
import { EvolucionComparada } from "./EvolucionComparada";

/**
 * La celda de una fila con el formato común: una rentabilidad, con su signo escrito; el valor de la participación,
 * con punto de millar (FMT-06). Lo que ordena y lo que falta no cambian. El color del signo no llega a esta tabla:
 * `TablaComparativa` solo pinta texto.
 */
function conFormatoComun(linea: LineaDelPlan): CeldaDeTabla {
  const { celda } = linea;
  if (celda.ausencia || typeof celda.valor !== "number") return celda;
  if (linea.clave.startsWith("rentabilidad-")) return { ...celda, texto: formato.rentabilidad(celda.valor) ?? celda.texto };
  if (linea.clave === "valor") return { ...celda, texto: `${formato.numero(celda.valor, { decimales: 5 }) ?? ""}\u00a0€` };
  return celda;
}

/**
 * Dos, tres o cuatro planes, uno junto a otro: cada plan es una columna y cada dato una fila.
 *
 * **Compara, no elige.** No hay ganador, ni orden, ni color que diga cuál es mejor: «este plan tiene estas cifras
 * y este otro, estas». Lo que sí hace es decir, debajo, lo que impide leer dos cifras como iguales: que no son de
 * la misma fecha, que se miden contra índices distintos, o que uno es un plan de pensiones y el otro una EPSV.
 *
 * Arriba va la evolución de todos en un mismo gráfico, en base 100 (`EvolucionComparada`): es el único cálculo de la
 * pantalla, y lo dice. Debajo, la tabla, que no calcula nada.
 */
export function ComparadorDePlanes({
  planes,
  ausentes = [],
  alVolver,
  alAbrir
}: {
  planes: readonly PlanDePensiones[];
  /** Los que pedía la dirección y no están en el catálogo: no se comparan, y se dice. */
  ausentes?: readonly string[];
  alVolver: () => void;
  alAbrir: (id: string) => void;
}) {
  const { seEnsena } = useModoCliente();
  const conProveedor = seEnsena("fuenteDeDatos");

  const { columnas, filas, avisos, deLectura } = useMemo(() => {
    const lineas = new Map(planes.map((plan) => [plan.id, lineasDelPlan(plan, { conProveedor })]));
    const columnasDeLaTabla: ColumnaComparada[] = planes.map((plan) => ({
      id: plan.id,
      nombre: plan.nombre,
      /* Lo primero que se lee bajo el nombre es qué es: plan de pensiones o EPSV. */
      apunte: nombreDelTipo(plan.tipo)
    }));
    const primeras = lineas.get(planes[0]?.id ?? "") ?? [];
    const filasDeLaTabla: FilaComparada[] = primeras.map((linea, indice) => ({
      id: linea.clave,
      titulo: linea.rotulo,
      textoLargo: linea.textoLargo,
      celda: (columna) => {
        const linea = lineas.get(columna.id)?.[indice];
        return linea ? conFormatoComun(linea) : { texto: "Falta el dato", ausencia: "falta" };
      }
    }));
    /* Lo que impide leer dos cifras como iguales va como aviso de la tabla; las notas de lectura, que salen en toda
       comparación, como notas, igual que en la ficha: tres barras seguidas daban peso de alarma a lo rutinario. */
    const deLectura = notasDeLectura({ conProveedor });
    const avisos = notasDeComparacion(planes, { conProveedor }).filter((nota) => !deLectura.includes(nota));
    return { columnas: columnasDeLaTabla, filas: filasDeLaTabla, avisos, deLectura };
  }, [planes, conProveedor]);

  const consultas = [...new Set(planes.map((plan) => plan.consultado))].sort();

  return (
    <div className="planes-comparador">
      <EnlaceDeVuelta alVolver={alVolver} />
      <PageHeader
        description="La evolución y las cifras de cada plan, una junto a otra. No hay orden ni ganador: ninguna cifra dice por sí sola qué plan conviene a un cliente."
        eyebrow={`Comparación · ${planes.map((plan) => nombreDelTipo(plan.tipo)).filter((tipo, i, todos) => todos.indexOf(tipo) === i).join(" y ")}`}
        title={`Comparación de ${planes.length} planes`}
      />

      {ausentes.length > 0 ? (
        <Aviso anunciar>
          {ausentes.length === 1 ? "Uno de los planes de la dirección no está en el catálogo y no se compara" : `${ausentes.length} de los planes de la dirección no están en el catálogo y no se comparan`}
          : {ausentes.join(", ")}.
        </Aviso>
      ) : null}

      <EvolucionComparada conProveedor={conProveedor} planes={planes} />

      <Panel
        acciones={planes.map((plan) => (
          <Button key={plan.id} onClick={() => alAbrir(plan.id)} size="sm" variant="quiet">
            Ficha de {plan.nombre}
          </Button>
        ))}
        subtitulo={`Consultado el ${consultas.map((dia) => formato.fecha(dia) ?? dia).join(" y el ")}${conProveedor ? " · Morningstar; la comisión, del buscador del banco" : ""}`}
        titulo="Plan a plan"
      >
        <TablaComparativa columnas={columnas} filas={filas} notas={avisos} titulo={`Comparación de ${planes.map((plan) => plan.nombre).join(", ")}`} />
        <div className="planes-notas">
          {deLectura.map((nota) => (
            <p className="cmp-note" key={nota}>
              {nota}
            </p>
          ))}
        </div>
      </Panel>
    </div>
  );
}
