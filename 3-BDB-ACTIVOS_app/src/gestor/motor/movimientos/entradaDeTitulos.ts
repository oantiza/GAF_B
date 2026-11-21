import { CERO, d, dOpcional, type Decimal } from "../decimal";
import type { ContextoDeMovimiento, DefinicionDeMovimiento, ImporteEnDivisa } from "../efectos";
import { divisaDelEfectivo, type Movimiento } from "../modelo";
import { erroresDeForma, multiplicadorDe, requiereActivo, requierePositivo } from "./comun";

/** El coste con el que entran los títulos: el valor declarado o títulos × precio de coste. */
function costeDeEntrada(movimiento: Movimiento, contexto: ContextoDeMovimiento): ImporteEnDivisa | undefined {
  const valor = dOpcional(movimiento.valor);
  if (valor) return { divisa: divisaDelEfectivo(movimiento, contexto.divisaBase), importe: valor };
  const titulos = dOpcional(movimiento.titulos);
  const precio = dOpcional(movimiento.precio);
  const activo = contexto.activo(movimiento.activoId);
  if (!titulos || !precio || !activo) return undefined;
  const importe: Decimal = titulos.times(precio).times(multiplicadorDe(activo));
  return { divisa: activo.divisa, importe };
}

/**
 * Entrada de títulos sin efectivo: una posición que llega de otra entidad, o la posición
 * inicial de una cartera cuyo libro empieza a medio camino. Su valor de mercado de ese día
 * cuenta como aportación; su coste es el que se declare aquí.
 */
export const entradaDeTitulos: DefinicionDeMovimiento = {
  tipo: "entradaDeTitulos",
  nombre: "Entrada de títulos",
  grupo: "valores",
  descripcion: "Llegan títulos sin pagar efectivo: un traspaso desde otra entidad o la posición inicial de la cartera. Su valor cuenta como aportación.",
  orden: 11,
  signoDelEfectivo: 0,
  campos: [
    { campo: "activo", obligatorio: true },
    { campo: "titulos", obligatorio: true },
    { campo: "precio", obligatorio: false, rotulo: "Precio de coste por título", ayuda: "Lo que costó cada título en origen. Si no lo sabes, pon el precio del día." },
    { campo: "valor", obligatorio: false, rotulo: "Coste total", ayuda: "En lugar del precio de coste por título." }
  ],
  validar(movimiento, contexto) {
    const errores = erroresDeForma(movimiento);
    requiereActivo(movimiento, contexto, errores);
    requierePositivo(movimiento.titulos, "el número de títulos", errores);
    if (errores.length === 0) {
      const coste = costeDeEntrada(movimiento, contexto);
      if (!coste) errores.push("Falta el precio de coste por título o el coste total.");
      else if (coste.importe.lt(0)) errores.push("El coste no puede ser negativo.");
    }
    return errores;
  },
  efectos(movimiento, contexto) {
    return [{ clase: "alta", activoId: movimiento.activoId!, titulos: d(movimiento.titulos!), pagado: costeDeEntrada(movimiento, contexto)!, externo: true }];
  }
};

export { CERO };
