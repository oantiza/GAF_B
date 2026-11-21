import { notaDeLasSinPrecio } from "../sinPrecio";
import type { Metrica } from "./tipos";

export const patrimonio: Metrica = {
  id: "patrimonio",
  nombre: "Patrimonio",
  ayuda: "Lo que vale hoy la cartera: sus posiciones a precio de mercado más el efectivo.",
  formato: "importe",
  conSigno: false,
  valor: (analisis) => (analisis.vacia ? null : analisis.patrimonio),
  /* Una posición sin precio no se puede valorar: el patrimonio no la cuenta, y lo dice. */
  salvedad: (analisis) => (analisis.vacia ? undefined : notaDeLasSinPrecio(analisis) ?? undefined)
};
