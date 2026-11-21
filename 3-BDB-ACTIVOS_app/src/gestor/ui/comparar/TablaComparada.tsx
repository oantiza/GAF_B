/**
 * La tabla de la comparación: una fila por cifra y una columna por cartera. Las cifras, sus
 * nombres y sus ayudas salen del registro de métricas, igual que en el resto del gestor.
 */
import { Ausencia } from "../../../components/ui/Ausencia";
import type { Analisis } from "../../motor/analisis";
import { metrica } from "../../motor/metricas/registro";
import { NotaEmergente } from "../../../components/ui/NotaEmergente";
import { ValorDeMetrica } from "../piezas";
import { nombreDeMetrica } from "../textos";

const CIFRAS = ["rentabilidad", "rentabilidadAnualizada", "volatilidad", "maximaCaida", "sharpe"].map(metrica);

export interface ColumnaDeComparacion {
  clave: string;
  nombre: string;
  /** De dónde viene: «Esta cartera», «Cartera de cliente», «Propuesta de Diseño, simulada». */
  apunte: string;
  estado: "cargando" | "error" | "listo";
  analisis?: Analisis;
}

export function TablaComparada({ columnas }: { columnas: readonly ColumnaDeComparacion[] }) {
  return (
    <div aria-label="Comparación de carteras (tabla desplazable)" className="gestor-tabla-envoltorio" role="group" tabIndex={0}>
      <table className="gestor-tabla gestor-comparada">
        <thead>
          <tr>
            <th scope="col"><span className="gestor-oculto">Cifra</span></th>
            {columnas.map((columna) => (
              <th className="gestor-tabla__cifra" key={columna.clave} scope="col">
                {columna.nombre}
                <span className="gestor-fila__nota">{columna.apunte}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CIFRAS.map((cifra) => (
            <tr key={cifra.id}>
              <th scope="row">
                {nombreDeMetrica(cifra)} <NotaEmergente termino={nombreDeMetrica(cifra).toLowerCase()}>{cifra.ayuda}</NotaEmergente>
              </th>
              {columnas.map((columna) => (
                <td className="gestor-tabla__cifra" key={columna.clave}>
                  {columna.estado === "cargando" ? (
                    <span className="gestor-calculando">Calculando…</span>
                  ) : columna.estado === "error" || !columna.analisis ? (
                    <Ausencia clase="falta" motivo="No se ha podido calcular" />
                  ) : (
                    <ValorDeMetrica analisis={columna.analisis} metrica={cifra} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
