import congelados from "virtual:precios-congelados";
import type { BdbQualityFlag } from "../types/bdbAssets";
import * as formato from "./formato";

/**
 * Lo que no cotiza y se sigue valorando a su último precio. Es un solo caso, NH Hotel Group, por decisión de Óscar del
 * 12-11-2026: hay clientes que lo tienen, no se negocia y se espera una OPA de exclusión a ese precio. Se queda dado de alta:
 * se puede añadir a una cartera y elegir, aunque la base diga, con verdad, que está `DELISTED`.
 *
 * Se decide por la marca de la política del histórico (`PRICE_FROZEN_DELISTED`, con su `frozen_price`), nunca por el ISIN
 * escrito aquí: la lista la saca `vite.config.ts` del mismo fichero que lee el servidor. Que sea uno solo lo vigila
 * `functions_python/tests/test_precio_congelado.py`, y otro pide su decisión.
 */
export interface PrecioCongelado {
  /** Desde cuándo vale el precio en la política (`frozen_price.from`). */
  desde: string | null;
  valor: number | null;
}

export function precioCongeladoDe(isin: string | null | undefined): PrecioCongelado | undefined {
  return isin && Object.hasOwn(congelados, isin) ? congelados[isin] : undefined;
}

/** Si un instrumento se valora a su último precio por decisión: lo dice la política, o la marca que manda el servidor. */
export function valoradoAPrecioCongelado(isin: string | null | undefined, marcas: readonly BdbQualityFlag[] = []): boolean {
  return precioCongeladoDe(isin) !== undefined || marcas.includes("PRICE_FROZEN_DELISTED");
}

/**
 * Lo que se dice de él en vez de «Dejó de cotizar», en dos trozos para la ficha: el rótulo y lo que va en negrita.
 * La fecha es la de la base (`availability.since`) y el precio, el de la política; sin precio no se escribe uno.
 */
export function rotuloDePrecioCongelado(isin: string, desde: unknown): { rotulo: string; valor: string } {
  const precio = precioCongeladoDe(isin)?.valor;
  const dia = typeof desde === "string" ? formato.fecha(desde) : null;
  const fecha = dia ? ` desde el ${dia}` : "";
  const escrito = formato.precio(precio);
  return {
    rotulo: `Sin negociación${fecha} · `,
    valor: escrito ? `valorado a ${escrito} por decisión` : "valorado a su último precio por decisión"
  };
}

/** La misma frase, de una pieza: «Sin negociación desde el 15/09/2025 · valorado a 6,50 € por decisión». */
export function textoDePrecioCongelado(isin: string, desde: unknown): string {
  const { rotulo, valor } = rotuloDePrecioCongelado(isin, desde);
  return `${rotulo}${valor}`;
}
