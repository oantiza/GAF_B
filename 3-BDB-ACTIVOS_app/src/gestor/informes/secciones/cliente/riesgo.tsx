/* eslint-disable react-refresh/only-export-components */
/**
 * «Riesgo, en dos cifras»: cuánto se mueve la cartera y su caída máxima en el periodo. El
 * ratio de Sharpe no va en el informe del cliente.
 */
import { fechaLarga } from "../../../../core/formato";
import { metrica } from "../../../motor/metricas/registro";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { cifraDeMetrica, hayCifras, motivoDeMetrica, tieneValor } from "../comun";
import { CifrasConFrase, LoContadoComoCero } from "../piezas";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const caida = analisis.riesgo!.maximaCaida;
  const dia = (fecha: string) => fechaLarga(fecha) ?? fecha;
  const tramo = caida.maximo && caida.minimo
    ? `Del ${dia(caida.maximo)} al ${dia(caida.minimo)}. ${caida.recuperacion ? `Recuperada el ${dia(caida.recuperacion)}.` : "Aún no se ha recuperado."}`
    : "No ha habido caídas en el periodo.";
  const volatilidad = metrica("volatilidad");
  const maximaCaida = metrica("maximaCaida");
  return (
    <>
      <CifrasConFrase
        cifras={[
          {
            rotulo: "Volatilidad",
            cifra: cifraDeMetrica(volatilidad, analisis),
            motivo: motivoDeMetrica(volatilidad, analisis),
            apunte: tieneValor(volatilidad, analisis) ? `Al año, medida con ${analisis.riesgo!.semanas} semanas` : undefined,
            frase: volatilidad.ayuda
          },
          { rotulo: "Caída máxima", cifra: cifraDeMetrica(maximaCaida, analisis), motivo: motivoDeMetrica(maximaCaida, analisis), apunte: tramo, frase: maximaCaida.ayuda }
        ]}
      />
      <LoContadoComoCero analisis={analisis} />
    </>
  );
}

export const riesgo: SeccionDeInforme = {
  id: "riesgo",
  titulo: "Riesgo, en dos cifras",
  juntoAlTitulo: 130,
  procede: (datos) => hayCifras(datos) && datos.analisis.riesgo !== undefined,
  Contenido
};
