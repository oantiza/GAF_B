import type { Metrica } from "./tipos";

export const resultadoRealizado: Metrica = {
  id: "resultadoRealizado",
  nombre: "Resultado realizado",
  ayuda: "Lo ganado o perdido en las ventas del periodo: lo cobrado menos lo que costaron los títulos vendidos, empezando por los más antiguos. No es un cálculo fiscal.",
  formato: "importe",
  conSigno: true,
  valor: (analisis) => analisis.realizado,
  motivoSinValor: (analisis) => (analisis.realizado === null ? "Falta el coste de alguna venta." : undefined)
};
