/**
 * El desglose del resultado de un periodo: de dónde viene lo ganado o perdido.
 *
 *     resultado = variación de precio + ingresos + efecto divisa − comisiones y gastos
 *
 * y, posición a posición, cuánto aportó cada una al resultado (en la divisa base) y a la
 * rentabilidad (en puntos porcentuales). La contribución se enlaza día a día, de modo que
 * la suma de las contribuciones es exactamente la rentabilidad ponderada por tiempo.
 */
import { cuadrar } from "./decimal";
import { tramoDe, type Periodo } from "./rentabilidad";
import type { Valoracion } from "./valoracion";

export interface DesgloseDePosicion {
  activoId: string;
  valorInicial: number;
  valorFinal: number;
  /** Lo invertido en la posición en el periodo, neto de lo cobrado por ventas. */
  invertido: number;
  precio: number;
  divisa: number;
  ingresos: number;
  costes: number;
  /** precio + divisa + ingresos − costes. */
  resultado: number;
  /** Aportación a la rentabilidad de la cartera, en fracción: 0,012 son 1,2 puntos. */
  contribucion: number;
}

export interface Desglose {
  /** Las cuatro partes y su suma, sin redondear. */
  precio: number;
  ingresos: number;
  divisa: number;
  costes: number;
  resultado: number;
  /** Las mismas cifras redondeadas al céntimo de forma que sumen exactamente el resultado. */
  cuadrado: { precio: number; ingresos: number; divisa: number; costes: number; resultado: number };
  posiciones: DesgloseDePosicion[];
  /** Lo que no es de ninguna posición: intereses, comisiones de la cuenta y divisa del efectivo. */
  efectivo: { ingresos: number; costes: number; divisa: number; resultado: number; contribucion: number };
  /** La suma de todas las contribuciones: coincide con la TWR del periodo. */
  contribucionTotal: number;
}

export function desgloseDelPeriodo(valoracion: Valoracion, periodo: Periodo): Desglose | undefined {
  const tramo = tramoDe(valoracion, periodo);
  if (!tramo) return undefined;
  const { i0, i1 } = tramo;
  const posiciones: DesgloseDePosicion[] = [];
  const efectivo = { ingresos: 0, costes: 0, divisa: 0, resultado: 0, contribucion: 0 };

  /* El factor acumulado ANTES de cada día: lo que una unidad de rentabilidad de ese día pesa en el total. */
  const acumulado = new Float64Array(i1 - i0);
  let factor = 1;
  for (let k = i0 + 1; k <= i1; k += 1) {
    acumulado[k - i0 - 1] = factor;
    factor *= 1 + valoracion.rentabilidad[k];
  }
  /* Un día que no se encadena (sin dinero del cliente, GES-9, o con un capital residual, GES-2) no pesa en la contribución,
     como no pesa en la TWR: así la suma de las contribuciones sigue siendo la rentabilidad del periodo. */
  const peso = (k: number): number => (valoracion.encadena[k] === 1 ? acumulado[k - i0 - 1] / valoracion.capital[k] : 0);

  for (const serie of valoracion.porActivo.values()) {
    const posicion: DesgloseDePosicion = {
      activoId: serie.activoId,
      valorInicial: i0 >= 0 ? serie.valor[i0] : 0,
      valorFinal: serie.valor[i1],
      invertido: 0,
      precio: 0,
      divisa: 0,
      ingresos: 0,
      costes: 0,
      resultado: 0,
      contribucion: 0
    };
    for (let k = i0 + 1; k <= i1; k += 1) {
      const delDia = serie.efectoPrecio[k] + serie.efectoDivisa[k] + serie.ingresos[k] - serie.costes[k];
      posicion.invertido += serie.invertido[k];
      posicion.precio += serie.efectoPrecio[k];
      posicion.divisa += serie.efectoDivisa[k];
      posicion.ingresos += serie.ingresos[k];
      posicion.costes += serie.costes[k];
      if (delDia !== 0) posicion.contribucion += delDia * peso(k);
    }
    posicion.resultado = posicion.precio + posicion.divisa + posicion.ingresos - posicion.costes;
    const huboAlgo = posicion.valorInicial !== 0 || posicion.valorFinal !== 0 || posicion.invertido !== 0 || posicion.resultado !== 0;
    if (huboAlgo) posiciones.push(posicion);
  }

  for (let k = i0 + 1; k <= i1; k += 1) {
    const delDia = valoracion.ingresosSueltos[k] - valoracion.costesSueltos[k] + valoracion.divisaDelEfectivo[k];
    efectivo.ingresos += valoracion.ingresosSueltos[k];
    efectivo.costes += valoracion.costesSueltos[k];
    efectivo.divisa += valoracion.divisaDelEfectivo[k];
    if (delDia !== 0) efectivo.contribucion += delDia * peso(k);
  }
  efectivo.resultado = efectivo.ingresos - efectivo.costes + efectivo.divisa;

  const precio = posiciones.reduce((suma, p) => suma + p.precio, 0);
  const ingresos = posiciones.reduce((suma, p) => suma + p.ingresos, 0) + efectivo.ingresos;
  const divisa = posiciones.reduce((suma, p) => suma + p.divisa, 0) + efectivo.divisa;
  const costes = posiciones.reduce((suma, p) => suma + p.costes, 0) + efectivo.costes;
  const resultado = precio + ingresos + divisa - costes;
  const [precioC, ingresosC, divisaC, menosCostesC] = cuadrar([precio, ingresos, divisa, -costes]);

  posiciones.sort((a, b) => b.resultado - a.resultado);
  return {
    precio,
    ingresos,
    divisa,
    costes,
    resultado,
    cuadrado: { precio: precioC, ingresos: ingresosC, divisa: divisaC, costes: -menosCostesC + 0, resultado: Math.round((precioC + ingresosC + divisaC + menosCostesC) * 100) / 100 + 0 },
    posiciones,
    efectivo,
    contribucionTotal: posiciones.reduce((suma, p) => suma + p.contribucion, 0) + efectivo.contribucion
  };
}
