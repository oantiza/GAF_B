import { EnlaceAFicha } from "../ui/EnlaceAFicha";
import { useMemo } from "react";
import { describeMetricsMethodology } from "../../core/metricsMethodology";
import type { CeldaDeTabla } from "../../types/tablaDeDatos";
import type { ClaseDeAusencia } from "../../types/fichaInstrumento";
/* La pieza trae su hoja: si la pidiera cada pantalla, una que la olvide la pinta sin estilo. */
import "../../styles/tabla.css";

/**
 * La tabla comparativa: los instrumentos son las COLUMNAS y los campos las filas.
 *
 * Lo que la hace distinta de una tabla corriente es lo que hace cuando una fila pone
 * una al lado de otra dos cifras que no salen del mismo cálculo. En el buscador eso se
 * resolvía agrupando; aquí no se puede, porque las columnas son los instrumentos que el
 * asesor ha elegido comparar. Así que **la fila se marca y se dice por qué**.
 *
 * Y la idea no es nueva en esta aplicación: el comparador de hoy ya avisa de esto para
 * el Sharpe a tres años desde el 03-09-2026, con `describeMetricsMethodology`. Lo que
 * cambia es que ahora lo hace **cada fila de cifras**, no solo esa, y con la misma
 * función, que ya estaba escrita y probada.
 */

export interface ColumnaComparada {
  id: string;
  nombre: string;
  /** El instrumento de la columna: su nombre lleva a la ficha. */
  enlaceAFicha?: string;
  apunte?: string;
  /** El método con que se calcularon sus cifras. */
  metodo?: string;
  /** La frecuencia de muestreo de esas cifras. */
  frecuencia?: string;
}

export interface FilaComparada {
  id: string;
  titulo: string;
  /** Cierto si sus valores pueden venir de métodos distintos. */
  comparable?: boolean;
  celda: (columna: ColumnaComparada) => CeldaDeTabla;
  /** El valor numérico, para decidir si la fila mezcla métodos. */
  valor?: (columna: ColumnaComparada) => number | undefined;
  /** El método de esta cifra, si no es el de su columna: la del proveedor donde no hay nuestra (decisión 110). */
  metodoDe?: (columna: ColumnaComparada) => { metodo?: string; frecuencia?: string } | undefined;
  /** Es texto y no una cifra: puede partir en dos líneas en vez de ensanchar la columna. */
  textoLargo?: boolean;
}

const CLASE_DE_AUSENCIA: Record<ClaseDeAusencia, string> = {
  "no-aplica": "tabla__celda--no-aplica",
  falta: "tabla__celda--falta",
  "sin-pedir": "tabla__celda--sin-pedir"
};

export interface TablaComparativaProps {
  columnas: ColumnaComparada[];
  filas: FilaComparada[];
  titulo: string;
  /** Lo que hay que saber para leer alguna celda, debajo de la tabla. */
  notas?: readonly string[];
}

export function TablaComparativa({ columnas, filas, titulo, notas = [] }: TablaComparativaProps) {
  /* La misma función que usa el comparador de hoy, aplicada fila a fila: solo cuentan
     las columnas que TIENEN la cifra, porque una sin valor no aporta metodología y
     contarla daría un aviso falso. Se calcula una vez por fila, no dos. */
  const mezcla = useMemo(
    () =>
      new Map(
        filas
          .filter((fila) => fila.comparable)
          .map((fila) => [
            fila.id,
            describeMetricsMethodology(
              columnas.map((columna) => {
                const suyo = fila.metodoDe?.(columna);
                return {
                  value: fila.valor?.(columna),
                  method: suyo?.metodo ?? columna.metodo,
                  frequency: suyo?.frecuencia ?? columna.frecuencia
                };
              }),
              fila.titulo
            )
          ])
      ),
    [columnas, filas]
  );
  const hayMezcla = [...mezcla.values()].some((aviso) => aviso.mixed);

  /* MAR-25: el mismo marco que `TablaDeDatos` —enfocable y con nombre, para desplazarlo con el teclado cuando las
     columnas no caben—, y las notas fuera de él, para que no se vayan de lado con las columnas. El `div` de fuera no
     lleva clase: solo agrupa, y el marco sigue siendo lo que era para la hoja. */
  return (
    <div>
      <div aria-label={`${titulo} (tabla desplazable)`} className="tabla__marco" role="group" tabIndex={0}>
        <table className="tabla tabla--comparativa">
          <caption className="sr-only">{titulo}</caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Dato</span></th>
              {columnas.map((columna) => (
                <th className="tabla__celda--cifra" key={columna.id} scope="col">
                  {columna.enlaceAFicha ? (
                    <EnlaceAFicha isin={columna.enlaceAFicha}>{columna.nombre}</EnlaceAFicha>
                  ) : (
                    columna.nombre
                  )}
                  {columna.apunte ? <span className="tabla__apunte">{columna.apunte}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => {
              const metodologia = mezcla.get(fila.id);

              return (
                <tr className={metodologia?.mixed ? "tabla__fila--incomparable" : undefined} key={fila.id}>
                  <th scope="row">
                    {fila.titulo}
                    {metodologia?.mixed ? (
                      <span className="tabla__marca-incomparable">No comparable entre sí</span>
                    ) : null}
                  </th>
                  {columnas.map((columna) => {
                    const celda = fila.celda(columna);
                    const clase = [
                      "tabla__celda--cifra",
                      fila.textoLargo ? "tabla__celda--texto-largo" : "",
                      celda.ausencia ? CLASE_DE_AUSENCIA[celda.ausencia] : ""
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <td className={clase} key={columna.id}>
                        <span className={celda.ausencia ? "tabla__ausencia" : undefined}>
                          {celda.texto}
                        </span>
                        {celda.apunte ? <span className="tabla__apunte">{celda.apunte}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hayMezcla ? (
        <p className="tabla__aviso">
          <b>Las filas marcadas mezclan métodos de cálculo y no se comparan.</b> Unas cifras se obtienen con rentabilidades mensuales y meses cerrados, otras con
          rentabilidades diarias, y las hay copiadas del proveedor con el método que él use.
          Ponerlas en la misma fila no las vuelve comparables, así que la fila lo dice en vez de
          callarlo.
        </p>
      ) : null}
      {notas.map((nota, indice) => (
        // Por posición: dos notas con el mismo texto chocaban con la clave del texto.
        <p className="tabla__aviso" key={indice}>
          {nota}
        </p>
      ))}
    </div>
  );
}
