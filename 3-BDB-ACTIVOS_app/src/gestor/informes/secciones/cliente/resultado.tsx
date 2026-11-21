/* eslint-disable react-refresh/only-export-components */
/**
 * «De dónde viene el resultado»: el desglose que suma (`desglose.cuadrado`), con los costes
 * dentro de la variación de precio (el informe del cliente no los da como cifra propia: van en
 * el informe de costes), lo que ha rendido
 * la cartera y el dinero del cliente, y la rentabilidad de cada mes y de cada año.
 */
import { importe, signoDe } from "../../../../core/formato";
import { Parrafo, Tabla, type CeldaDeTabla, type FilaDeTabla } from "../../../../reports/plantilla";
import { metrica } from "../../../motor/metricas/registro";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { cifraDeMetrica, hayCifras, motivoDeMetrica, precioNetoDeCostes, signoDeMetrica } from "../comun";
import { LoContadoComoCero, Pequena, Subtitulo, TablaDeMeses } from "../piezas";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const c = analisis.desglose!.cuadrado;
  const conSigno = (valor: number): CeldaDeTabla => ({ texto: importe(valor, { divisa, conSigno: true }), signo: signoDe(valor, 2) });
  const fila = (rotulo: string, valor: number, apunte: string): FilaDeTabla => ({ celdas: [{ texto: rotulo, apunte }, conSigno(valor)] });
  const anual = analisis.rentabilidad!.anualiza;
  const deMetrica = (rotulo: string, id: string): FilaDeTabla => {
    const m = metrica(id);
    return { celdas: [{ texto: rotulo, apunte: m.ayuda }, { texto: cifraDeMetrica(m, analisis), signo: signoDeMetrica(m, analisis), motivo: motivoDeMetrica(m, analisis) }] };
  };
  const rentabilidades: FilaDeTabla[] = [
    deMetrica("Rentabilidad de la cartera en el periodo", "rentabilidad"),
    ...(anual ? [deMetrica("Rentabilidad anualizada de la cartera", "rentabilidadAnualizada")] : []),
    deMetrica(anual ? "Rentabilidad anualizada de su dinero" : "Rentabilidad de su dinero en el periodo", "rentabilidadDelCliente")
  ];
  return (
    <>
      <Parrafo>{`En el periodo la cartera ${signoDe(c.resultado, 2) !== "baja" ? "ha ganado" : "ha perdido"} ${importe(Math.abs(c.resultado), { divisa }) ?? ""}. Estas son sus tres partes; sumadas, dan el resultado.`}</Parrafo>
      <Tabla
        columnas={[{ titulo: "Concepto", ancho: 72 }, { titulo: "Importe", ancho: 28, cifra: true }]}
        filas={[
          fila("Variación de precio, neta de comisiones y gastos", precioNetoDeCostes(c), "Lo que han subido o bajado de precio sus inversiones, medido en su moneda, incluido lo ganado o perdido en las ventas. Ya descontadas las comisiones y gastos de la cartera y los impuestos apuntados aparte en la cuenta."),
          fila("Dividendos, cupones e intereses, netos de retención", c.ingresos, "Lo cobrado por tener las inversiones y el efectivo, ya neto de retenciones."),
          fila("Efecto divisa", c.divisa, "Lo ganado o perdido por la variación del cambio en lo invertido en otras monedas.")
        ]}
        total={["Resultado del periodo", conSigno(c.resultado)]}
      />

      <Subtitulo>Lo que ha rendido</Subtitulo>
      <Tabla columnas={[{ titulo: "Rentabilidad", ancho: 76 }, { titulo: "Cifra", ancho: 24, cifra: true }]} filas={rentabilidades} />
      <LoContadoComoCero analisis={datos.analisis} />
      <Pequena separada>La rentabilidad de la cartera es la que se compara con un índice o con otra cartera; la de su dinero es la que ha obtenido usted con sus fechas de aportación y retirada. Las dos son correctas: miden cosas distintas.</Pequena>

      {analisis.porMeses.length > 0 ? (
        <>
          <Subtitulo juntoAlTitulo={90}>Mes a mes y año a año</Subtitulo>
          <Pequena>Rentabilidad de la cartera en cada mes y en cada año desde que existe, ya descontadas las comisiones. El asterisco marca los años incompletos: el primero cuenta desde que empezó la cartera y el último, hasta la fecha del informe. Los meses en blanco son anteriores al inicio de la cartera o posteriores a la fecha del informe.</Pequena>
          <TablaDeMeses anios={analisis.porMeses} />
        </>
      ) : null}
    </>
  );
}

export const resultado: SeccionDeInforme = {
  id: "resultado",
  titulo: "De dónde viene el resultado",
  /* Seguida del riesgo, sin forzar hoja: forzada, una cartera cuyas cifras empezaban a media hoja dejaba el riesgo solo en la suya
     (16-11-2026). La tabla del desglose no se separa del título. */
  juntoAlTitulo: 200,
  procede: (datos) => hayCifras(datos) && datos.analisis.desglose !== undefined,
  Contenido
};
