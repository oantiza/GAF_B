/**
 * Hoja «Ingresos y costes»: ingresos (bruto, retención, neto) y costes con sus porcentajes sobre el patrimonio medio. Si
 * alguna posición no tiene precio, una última fila dice que ese patrimonio medio la cuenta como cero.
 */
import type { LineaDeIngreso } from "../../motor/analisis";
import { notaDeLoContadoComoCero, notaDelCosteCorrienteSinPrecio } from "../../motor/sinPrecio";
import { importe, porcentaje, type Celda, type HojaDelExcel } from "./celdas";

const linea = (rotulo: string, l: LineaDeIngreso): Celda[] => [rotulo, importe(l.bruto), importe(l.retencion), importe(l.neto)];

export const hojaIngresosYCostes: HojaDelExcel = {
  nombre: "Ingresos y costes",
  anchos: [52, 16, 16, 16],
  filas: ({ analisis }) => {
    const ic = analisis.ingresosYCostes;
    const comoCero = notaDeLoContadoComoCero(analisis, { quien: "El patrimonio medio" });
    /* Lo que no entra en los gastos corrientes: fondos sin precio y fondos sin valor parte del periodo (H2-02, 22-11-2026). */
    const gastosIncompletos = notaDelCosteCorrienteSinPrecio(analisis);
    return [
      ["Ingresos", "Bruto", "Retención", "Neto"],
      linea("Dividendos", ic.dividendos),
      linea("Cupones", ic.cupones),
      linea("Intereses", ic.intereses),
      linea("Otros", ic.otros),
      ["Dividendos y cupones cobrados, netos de retención", null, null, importe(ic.ingresosNetos)],
      ["Dividendos y cupones sobre el patrimonio medio", null, null, porcentaje(ic.ingresosPct)],
      [],
      ["Costes", "Importe", "Sobre el patrimonio medio"],
      ["Costes de operación", importe(ic.costesDeOperacion)],
      ["Costes del servicio", importe(ic.costesDelServicio)],
      ["Costes explícitos", importe(ic.costesExplicitos), porcentaje(ic.costesExplicitosPct)],
      ["Gastos corrientes (estimados)", importe(ic.gastosCorrientes), ic.gastosCorrientes !== null && !ic.gastosCorrientesCompletos ? "Parcial" : null],
      ["Cobertura de los gastos corrientes (sobre lo invertido en fondos y ETF)", porcentaje(ic.coberturaDeGastosCorrientes)],
      ["Costes totales", importe(ic.costesTotales), porcentaje(ic.costesTotalesPct)],
      ["Impuestos y retenciones", importe(ic.impuestos)],
      ["Patrimonio medio", importe(ic.patrimonioMedio)],
      ...(gastosIncompletos ? [[], [gastosIncompletos]] : []),
      ...(comoCero ? [[], [`${comoCero} Los porcentajes de esta hoja son sobre ese patrimonio.`]] : [])
    ];
  }
};
