import { d, dOpcional, esDecimal, type Decimal } from "../decimal";
import type { ContextoDeMovimiento, DefinicionDeMovimiento, Efecto } from "../efectos";
import { divisaDelEfectivo, type Movimiento } from "../modelo";
import { erroresDeForma, multiplicadorDe, requiereActivo, requierePositivo } from "./comun";

/** El valor traspasado: el declarado o, si falta, participaciones × valor liquidativo del origen. */
function valorTraspasado(movimiento: Movimiento, contexto: ContextoDeMovimiento): Decimal | undefined {
  const declarado = dOpcional(movimiento.valor);
  if (declarado) return declarado;
  const titulos = dOpcional(movimiento.titulos);
  const precio = dOpcional(movimiento.precio);
  const activo = contexto.activo(movimiento.activoId);
  if (!titulos || !precio || !activo) return undefined;
  if (activo.divisa !== divisaDelEfectivo(movimiento, contexto.divisaBase)) return undefined;
  return titulos.times(precio).times(multiplicadorDe(activo));
}

/**
 * Traspaso entre fondos: salen participaciones de un fondo y entran en otro sin pasar por
 * la cuenta de efectivo del banco.
 *
 * Dos decisiones que conviene conocer:
 *  - El resultado del fondo de origen se da por realizado (FIFO) a efectos de seguimiento.
 *    No es un cálculo fiscal: en España el traspaso difiere la tributación.
 *  - Si el fondo de destino entra unos días después, el dinero figura entre tanto como
 *    «efectivo en tránsito»: cuenta como patrimonio, y así la rentabilidad no da un salto.
 */
export const traspaso: DefinicionDeMovimiento = {
  tipo: "traspaso",
  nombre: "Traspaso entre fondos",
  grupo: "compraventa",
  descripcion: "Se pasa dinero de un fondo a otro sin pasar por la cuenta de efectivo. Resta participaciones del fondo de origen y suma las del fondo de destino.",
  orden: 48,
  signoDelEfectivo: 0,
  campos: [
    { campo: "activo", obligatorio: true, rotulo: "Fondo de origen" },
    { campo: "titulos", obligatorio: true, rotulo: "Participaciones que salen" },
    { campo: "precio", obligatorio: false, rotulo: "Valor liquidativo del origen" },
    { campo: "valor", obligatorio: true, rotulo: "Importe traspasado" },
    { campo: "destinoActivo", obligatorio: true, rotulo: "Fondo de destino" },
    { campo: "destinoTitulos", obligatorio: true, rotulo: "Participaciones que entran" },
    { campo: "destinoPrecio", obligatorio: false, rotulo: "Valor liquidativo del destino" },
    { campo: "destinoFecha", obligatorio: false, rotulo: "Fecha en que entra el destino", ayuda: "Solo si el fondo de destino entra unos días después. Entre tanto, el dinero cuenta como efectivo en tránsito." },
    { campo: "fechaValor", obligatorio: false },
    { campo: "divisa", obligatorio: false }
  ],
  validar(movimiento, contexto) {
    const errores = erroresDeForma(movimiento);
    requiereActivo(movimiento, contexto, errores);
    requierePositivo(movimiento.titulos, "el número de participaciones que salen", errores);
    const destino = movimiento.destino;
    if (!destino?.activoId) errores.push("Falta el fondo de destino.");
    else if (!contexto.activo(destino.activoId)) errores.push("El fondo de destino no está en la cartera.");
    else if (destino.activoId === movimiento.activoId) errores.push("El fondo de destino tiene que ser distinto del de origen.");
    requierePositivo(destino?.titulos, "el número de participaciones que entran", errores);
    if (errores.length === 0) {
      const valor = valorTraspasado(movimiento, contexto);
      if (!valor) errores.push("Falta el importe traspasado.");
      else if (valor.lte(0)) errores.push("El importe traspasado tiene que ser mayor que cero.");
    }
    if (movimiento.valor !== undefined && esDecimal(movimiento.valor) && d(movimiento.valor).lte(0)) {
      errores.push("El importe traspasado tiene que ser mayor que cero.");
    }
    return [...new Set(errores)];
  },
  efectos(movimiento, contexto) {
    const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
    const valor = valorTraspasado(movimiento, contexto)!;
    const destino = movimiento.destino!;
    const llegada = destino.fecha && destino.fecha > movimiento.fechaOperacion ? destino.fecha : undefined;
    const efectos: Efecto[] = [
      { clase: "baja", activoId: movimiento.activoId!, titulos: d(movimiento.titulos!), cobrado: { divisa, importe: valor }, externo: false, realiza: true },
      { clase: "alta", activoId: destino.activoId!, titulos: d(destino.titulos!), pagado: { divisa, importe: valor }, externo: false, fecha: llegada }
    ];
    if (llegada) {
      efectos.push({ clase: "efectivo", divisa, importe: valor, transito: true });
      efectos.push({ clase: "efectivo", divisa, importe: valor.times(-1), transito: true, fecha: llegada });
    }
    return efectos;
  }
};
