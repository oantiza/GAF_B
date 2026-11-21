/* eslint-disable react-refresh/only-export-components */
/**
 * «Cómo ha ido su cartera»: abre las cifras, detrás de la cartera (Óscar, 16-11-2026). Las tres que contestan el informe —lo que vale,
 * lo ganado o perdido y lo aportado—, cada una con lo que significa (hasta el 16-11 iban en la portada); lo que ha pasado en el periodo,
 * en una frase hecha con las cifras del análisis, y cómo ha ido el patrimonio frente al dinero puesto.
 */
import { fechaLarga, importe, importeTitular, rentabilidad, signoDe } from "../../../../core/formato";
import { GraficoDeLineas, Parrafo } from "../../../../reports/plantilla";
import { metrica } from "../../../motor/metricas/registro";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { CifrasConFrase, LoContadoComoCero, Pequena, Subtitulo } from "../piezas";

/** Lo que ha pasado en el periodo, en una frase hecha con las cifras del análisis. */
function resumenEnUnaFrase(datos: DatosDelInforme): string {
  const r = datos.analisis.rentabilidad!;
  const divisa = datos.analisis.cartera.divisaBase;
  const euros = (valor: number) => importe(valor, { divisa }) ?? "";
  const verbo = signoDe(r.resultado, 2) !== "baja" ? "ha ganado" : "ha perdido";
  const neto = signoDe(r.aportacionesNetas, 2) !== "baja" ? `ha aportado, neto de retiradas, ${euros(r.aportacionesNetas)}` : `ha retirado, neto de aportaciones, ${euros(Math.abs(r.aportacionesNetas))}`;
  const inicio = r.valorInicial !== 0
    ? `Al empezar el periodo la cartera valía ${euros(r.valorInicial)} y al final ${euros(r.valorFinal)}. Entre medias ${neto}`
    : `La cartera empezó dentro del periodo: ${neto} y al final vale ${euros(r.valorFinal)}`;
  return `${inicio}. Descontado ese dinero, la cartera ${verbo} ${euros(Math.abs(r.resultado))}, una rentabilidad del ${rentabilidad(r.twr) ?? ""}.`;
}

/** Lo que vale la cartera, lo ganado o perdido y lo aportado: lo que contesta el informe, cada cifra con lo que significa. */
function CifrasDelCliente({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const r = analisis.rentabilidad!;
  const divisa = analisis.cartera.divisaBase;
  return (
    <CifrasConFrase
      cifras={[
        { rotulo: "Patrimonio", cifra: importeTitular(analisis.patrimonio, { divisa }), apunte: `a ${fechaLarga(analisis.fecha) ?? analisis.fecha}`, principal: true, frase: metrica("patrimonio").ayuda },
        {
          rotulo: "Ganado o perdido",
          cifra: importeTitular(r.resultado, { divisa, conSigno: true }),
          signo: signoDe(r.resultado, 0),
          apunte: `${rentabilidad(r.twr) ?? ""} de rentabilidad`,
          frase: metrica("resultado").ayuda
        },
        {
          rotulo: "Aportado neto",
          cifra: importeTitular(r.aportacionesNetas, { divisa }),
          apunte: `Aportado ${importeTitular(r.entradas, { divisa })} · retirado ${importeTitular(Math.abs(r.salidas), { divisa })}`,
          frase: metrica("aportacionesNetas").ayuda
        }
      ]}
    />
  );
}

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const evolucion = analisis.evolucion;
  return (
    <>
      <CifrasDelCliente datos={datos} />
      <Parrafo>{resumenEnUnaFrase(datos)}</Parrafo>
      <LoContadoComoCero analisis={analisis} />
      {evolucion.length > 1 ? (
        <>
          <Subtitulo juntoAlTitulo={200}>Cómo ha evolucionado</Subtitulo>
          <GraficoDeLineas
            fechas={evolucion.map((punto) => punto.fecha)}
            series={[
              { nombre: "Valor de la cartera", valores: evolucion.map((punto) => punto.valor) },
              { nombre: "Dinero aportado", valores: evolucion.map((punto) => punto.aportado), referencia: true }
            ]}
            formato={(valor) => importeTitular(valor, { divisa })}
            alto={170}
          />
          <Pequena>La línea continua es lo que valía la cartera cada día; la discontinua, el dinero aportado: lo que valía al empezar el periodo más lo que se ha puesto y menos lo que se ha sacado. La distancia entre las dos es lo ganado o perdido hasta ese día.</Pequena>
        </>
      ) : null}
    </>
  );
}

export const vistazo: SeccionDeInforme = {
  id: "vistazo",
  titulo: "Cómo ha ido su cartera",
  /*
   * Abre las cifras detrás de la cartera. No fuerza hoja: si la cartera deja sitio para las tres cifras y su frase, empieza ahí, y el
   * gráfico, que no se separa de su subtítulo, sigue donde quepa; si no, en la siguiente. Con hoja forzada, una cartera de cuarenta
   * posiciones dejaba una hoja con dos filas y el reparto, y una de cinco, media hoja en blanco (16-11-2026).
   */
  juntoAlTitulo: 190,
  procede: hayCifras,
  Contenido
};
