import { listaDeLasSinPrecio, notaDeLasSinPrecio } from "../sinPrecio";
import type { Metrica } from "./tipos";

export const resultadoLatente: Metrica = {
  id: "resultadoLatente",
  nombre: "Resultado latente",
  ayuda: "Lo que ganan o pierden las posiciones que siguen abiertas, respecto de lo que costaron. No está materializado: cambia con los precios. En un bono incluye el cupón corrido que ha ido devengando, no solo lo que ha cambiado su precio.",
  formato: "importe",
  conSigno: true,
  valor: (analisis) => analisis.latente,
  /*
   * Es el de las posiciones que tienen precio (`Analisis.latente`). No se da por dos causas: a alguna con precio le falta
   * el coste (un tipo de cambio), o ninguna tiene precio y no hay nada que sumar.
   */
  motivoSinValor: (analisis) => {
    if (analisis.latente !== null) return undefined;
    if (analisis.posiciones.some((posicion) => posicion.valor !== null && posicion.coste === null)) return "Falta un tipo de cambio para conocer el coste de alguna posición.";
    const sinPrecio = analisis.sinPrecio.length;
    return sinPrecio > 0 ? `${listaDeLasSinPrecio(analisis)} no ${sinPrecio === 1 ? "tiene precio: sin él" : "tienen precio: sin ellos"} no se conoce su resultado.` : undefined;
  },
  /* Con alguna sin precio, la cifra es la de las demás, y lo dice. */
  salvedad: (analisis) => (analisis.latente === null ? undefined : notaDeLasSinPrecio(analisis) ?? undefined)
};
