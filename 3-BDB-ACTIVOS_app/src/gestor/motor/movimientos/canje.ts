import { CERO, d, dOpcional } from "../decimal";
import type { DefinicionDeMovimiento, Efecto } from "../efectos";
import { divisaDelEfectivo } from "../modelo";
import { erroresDeForma, requiereActivo, requierePositivo } from "./comun";

/**
 * Canje o fusión: los títulos de un activo se convierten en títulos de otro (un cambio de
 * ISIN, una fusión por absorción). Los lotes pasan al activo nuevo con su coste y su fecha
 * de compra: no se realiza resultado. Si se cobra un pico en efectivo, se anota como ingreso.
 */
export const canje: DefinicionDeMovimiento = {
  tipo: "canje",
  nombre: "Canje o fusión",
  grupo: "corporativas",
  descripcion: "Los títulos de un activo se cambian por los de otro: un cambio de ISIN o una fusión. Se conserva el coste y no hay ganancia ni pérdida.",
  orden: 6,
  signoDelEfectivo: 1,
  campos: [
    { campo: "activo", obligatorio: true, rotulo: "Activo que desaparece" },
    { campo: "titulos", obligatorio: false, rotulo: "Títulos canjeados", ayuda: "En blanco, toda la posición." },
    { campo: "destinoActivo", obligatorio: true, rotulo: "Activo que se recibe" },
    { campo: "destinoTitulos", obligatorio: true, rotulo: "Títulos recibidos" },
    { campo: "importe", obligatorio: false, rotulo: "Efectivo cobrado por picos" }
  ],
  validar(movimiento, contexto) {
    const errores = erroresDeForma(movimiento);
    requiereActivo(movimiento, contexto, errores);
    const destino = movimiento.destino;
    if (!destino?.activoId) errores.push("Falta el activo que se recibe.");
    else if (!contexto.activo(destino.activoId)) errores.push("El activo que se recibe no está en la cartera.");
    else if (destino.activoId === movimiento.activoId) errores.push("El activo que se recibe tiene que ser distinto del que desaparece.");
    requierePositivo(destino?.titulos, "el número de títulos recibidos", errores);
    const titulos = dOpcional(movimiento.titulos);
    if (titulos && titulos.lte(0)) errores.push("Los títulos canjeados tienen que ser más que cero.");
    const importe = dOpcional(movimiento.importe);
    if (importe && importe.lt(0)) errores.push("El efectivo cobrado no puede ser negativo.");
    return errores;
  },
  efectos(movimiento, contexto) {
    const destino = movimiento.destino!;
    const efectos: Efecto[] = [{
      clase: "canje",
      activoId: movimiento.activoId!,
      destinoId: destino.activoId!,
      titulos: dOpcional(movimiento.titulos),
      titulosDestino: d(destino.titulos!)
    }];
    const importe = dOpcional(movimiento.importe);
    if (importe && importe.gt(0)) {
      const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
      efectos.push({ clase: "efectivo", divisa, importe });
      efectos.push({ clase: "ingreso", categoria: "otro", activoId: destino.activoId, divisa, bruto: importe, retencion: CERO, neto: importe });
    }
    return efectos;
  }
};
