/**
 * Bonos: cupón corrido y calendario de cupones, a partir de las condiciones del bono.
 * Las fechas de cupón se cuentan hacia atrás desde el vencimiento, como en el mercado.
 */
import { diasEntre, esUltimoDiaDelMes, sumarMeses, type Dia } from "./fechas";
import type { BaseDeCalculo, CondicionesDelBono } from "./modelo";

function numero(texto: string | undefined, porDefecto: number): number {
  const valor = texto === undefined ? Number.NaN : Number(texto);
  return Number.isFinite(valor) ? valor : porDefecto;
}

/** Días entre dos fechas en base 30/360 europea: cada mes cuenta treinta días. */
function dias30360(desde: Dia, hasta: Dia): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return (a2 - a1) * 360 + (m2 - m1) * 30 + (Math.min(d2, 30) - Math.min(d1, 30));
}

/** Las dos fechas de cupón que rodean a un día: la última pagada (o anterior) y la siguiente. */
export function periodoDeCupon(bono: CondicionesDelBono, fecha: Dia): { anterior: Dia; siguiente: Dia } {
  const meses = 12 / bono.frecuencia;
  const finDeMes = esUltimoDiaDelMes(bono.vencimiento);
  let k = 0;
  /* Retrocede desde el vencimiento hasta dejar el día dentro de [anterior, siguiente). */
  while (sumarMeses(bono.vencimiento, -meses * (k + 1), finDeMes) > fecha) k += 1;
  return {
    anterior: sumarMeses(bono.vencimiento, -meses * (k + 1), finDeMes),
    siguiente: sumarMeses(bono.vencimiento, -meses * k, finDeMes)
  };
}

/**
 * La parte de un cupón anual de 1 devengada entre `desde` y `fecha`. `desde` es la última
 * fecha de cupón o, en un primer cupón corto, la emisión; el periodo regular va siempre de
 * `anterior` a `siguiente`.
 */
function fraccionDevengada(base: BaseDeCalculo, frecuencia: number, desde: Dia, anterior: Dia, siguiente: Dia, fecha: Dia): number {
  switch (base) {
    case "ACT/ACT":
      /* ICMA: días devengados sobre los días del periodo REGULAR de cupón, por un cupón de 1/frecuencia. */
      return diasEntre(desde, fecha) / diasEntre(anterior, siguiente) / frecuencia;
    case "30/360":
      return dias30360(desde, fecha) / 360;
    case "ACT/365":
      return diasEntre(desde, fecha) / 365;
    case "ACT/360":
      return diasEntre(desde, fecha) / 360;
  }
}

/**
 * Cupón corrido de un bono un día, en fracción del nominal: multiplicado por el nominal da
 * el importe. El día que se paga un cupón vale cero (el cupón ya se ha cobrado). Antes de
 * la emisión y desde el vencimiento, cero.
 */
export function cuponCorrido(bono: CondicionesDelBono, fecha: Dia): number {
  const cupon = numero(bono.cupon, 0);
  if (cupon === 0 || fecha >= bono.vencimiento) return 0;
  if (bono.emision !== undefined && fecha <= bono.emision) return 0;
  const { anterior, siguiente } = periodoDeCupon(bono, fecha);
  const desde = bono.emision !== undefined && bono.emision > anterior ? bono.emision : anterior;
  if (fecha <= desde) return 0;
  return cupon * fraccionDevengada(bono.base, bono.frecuencia, desde, anterior, siguiente, fecha);
}

export interface PagoDelBono {
  fecha: Dia;
  clase: "cupon" | "vencimiento";
  /** Importe en fracción del nominal: 0,035 es un cupón del 3,5 %; 1 es la devolución del nominal a la par. */
  fraccion: number;
}

/** Los pagos de un bono entre dos fechas (las dos incluidas): cupones y devolución del nominal. */
export function calendarioDelBono(bono: CondicionesDelBono, desde: Dia, hasta: Dia): PagoDelBono[] {
  const pagos: PagoDelBono[] = [];
  const cupon = numero(bono.cupon, 0);
  const meses = 12 / bono.frecuencia;
  const finDeMes = esUltimoDiaDelMes(bono.vencimiento);
  for (let k = 0; k < 1200; k += 1) {
    const fecha = sumarMeses(bono.vencimiento, -meses * k, finDeMes);
    if (fecha < desde || (bono.emision !== undefined && fecha <= bono.emision)) break;
    if (fecha > hasta) continue;
    if (k === 0) pagos.push({ fecha, clase: "vencimiento", fraccion: numero(bono.amortizacion, 100) / 100 });
    if (cupon > 0) pagos.push({ fecha, clase: "cupon", fraccion: cupon / bono.frecuencia });
  }
  return pagos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.clase === "cupon" ? -1 : 1));
}
