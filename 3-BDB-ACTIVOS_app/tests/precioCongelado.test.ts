import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import congelados from "virtual:precios-congelados";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";
import { componerFila } from "../src/adapters/componerLista";
import { accionDeCarteraBloqueada, activoParaLaAccion, etiquetaDeAccionDeCartera, motivoDeNoInvertible } from "../src/core/accionDeCartera";
import { historicalSelectionRestriction, isInvestableAsset } from "../src/core/assetMapping";
import { textoDePrecioCongelado, valoradoAPrecioCongelado } from "../src/core/precioCongelado";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

/**
 * NH Hotel Group se queda dado de alta, como único caso excepcional, valorado a su último precio (Óscar, 12-11-2026): hay clientes
 * que lo tienen, no se negocia y se espera una OPA de exclusión a ese precio. La base sigue diciendo que está `DELISTED`, y es verdad.
 * Se decide por la marca de la política del histórico, que la app recibe de `vite.config.ts`; las demás bajas no cambian de trato, y
 * Ercros lo fija.
 */

const NH = "ES0161560018";
const ERCROS = "ES0125140A14";
const TEXTO_NH = "Sin negociación desde el 15/09/2025 · valorado a 6,50 € por decisión";

const raizDeBaja = (isin: string, since: string) => ({
  instrument_id: isin,
  instrument_type: "STOCK",
  identity: { name: isin === NH ? "NH Hoteles" : "Ercros", currency: "EUR" },
  availability: { state: "DELISTED", since }
});
const instrumento = (isin: string, since: string): InstrumentoDeLaBase => ({
  isin,
  raiz: raizDeBaja(isin, since),
  tarjeta: { instrument_id: isin, availability: { state: "DELISTED", since } },
  calidad: undefined,
  bloques: {}
});

describe("la marca llega a la app desde la política del servidor", () => {
  test("es la misma lista que la política, y un solo caso", () => {
    const { assets } = JSON.parse(readFileSync(new URL("../functions_python/fund_history_policies.json", import.meta.url), "utf8")) as {
      assets: Record<string, { flags?: string[]; frozen_price?: { from: string; value: number } }>;
    };
    const conLaMarca = Object.keys(assets).filter((isin) => (assets[isin].flags ?? []).includes("PRICE_FROZEN_DELISTED"));
    expect(conLaMarca, "PRICE_FROZEN_DELISTED es una excepción de Óscar para NH: añadir otro pide su decisión").toEqual([NH]);
    expect(congelados).toEqual({ [NH]: { desde: assets[NH].frozen_price?.from, valor: assets[NH].frozen_price?.value } });
    expect(congelados[NH]).toEqual({ desde: "2025-09-15", valor: 6.5 });
  });

  test("la política decide, o la marca del servidor; Ercros no la lleva", () => {
    expect(valoradoAPrecioCongelado(NH)).toBe(true);
    expect(valoradoAPrecioCongelado(ERCROS)).toBe(false);
    expect(valoradoAPrecioCongelado("XS0000000001", ["PRICE_FROZEN_DELISTED"])).toBe(true);
  });
});

describe("la ficha y las listas no dicen «Dejó de cotizar» de NH", () => {
  test("la ficha dice desde cuándo no se negocia y a cuánto se valora, con la fecha de la base y el precio de la política", () => {
    const { rotulo, valor, estado } = componerFicha(instrumento(NH, "2025-09-15")).disponibilidad;
    expect(`${rotulo}${valor}`).toBe(TEXTO_NH);
    expect(rotulo).not.toContain("Dejó de cotizar");
    expect(estado).toBe("baja");
    expect(textoDePrecioCongelado(NH, "2025-09-15")).toBe(TEXTO_NH);
  });

  test("Ercros sigue diciendo que dejó de cotizar", () => {
    expect(componerFicha(instrumento(ERCROS, "2026-09-11")).disponibilidad).toMatchObject({ rotulo: "Dejó de cotizar", estado: "baja" });
  });

  test("la fila del Buscador de NH no está de baja y lleva su frase; la de Ercros, su fecha", () => {
    const nh = componerFila(instrumento(NH, "2025-09-15").tarjeta!);
    expect(nh.dejoDeCotizar).toBeUndefined();
    expect(nh.valoradoAPrecioCongelado).toBe(TEXTO_NH);
    const ercros = componerFila(instrumento(ERCROS, "2026-09-11").tarjeta!);
    expect(ercros.dejoDeCotizar).toBe("2026-09-11");
    expect(ercros.valoradoAPrecioCongelado).toBeUndefined();
  });
});

describe("NH se puede añadir a una cartera; Ercros no", () => {
  test("el botón de la ficha y el de añadir del Buscador", () => {
    const nh = activoParaLaAccion(NH, raizDeBaja(NH, "2025-09-15"));
    expect(etiquetaDeAccionDeCartera(nh, false)).toBe("Añadir");
    expect(accionDeCarteraBloqueada(nh, false)).toBe(false);
    expect(motivoDeNoInvertible(NH, "NH Hoteles", raizDeBaja(NH, "2025-09-15"))).toBeNull();

    const ercros = activoParaLaAccion(ERCROS, raizDeBaja(ERCROS, "2026-09-11"));
    expect(etiquetaDeAccionDeCartera(ercros, false)).toBe("No disponible");
    expect(accionDeCarteraBloqueada(ercros, false)).toBe(true);
    expect(motivoDeNoInvertible(ERCROS, "Ercros", raizDeBaja(ERCROS, "2026-09-11"))).toBe("Ercros dejó de cotizar el 11/09/2026: no se añade a la cartera.");
  });

  test("la marca quita la restricción de baja, y solo esa", () => {
    expect(historicalSelectionRestriction({ quality_flags: ["PRICE_FROZEN_DELISTED", "NON_INVESTABLE_DELISTED"] })).toBeUndefined();
    expect(historicalSelectionRestriction({ quality_flags: ["NON_INVESTABLE_DELISTED"] })).toBe("NON_INVESTABLE_DELISTED");
    expect(historicalSelectionRestriction({ quality_flags: ["PRICE_FROZEN_DELISTED", "NON_INVESTABLE_SUSPENDED"] })).toBe("NON_INVESTABLE_SUSPENDED");
  });

  test("el activo que sirve la función, con la marca, es invertible en Diseño", () => {
    const detalle = {
      asset_id: NH,
      isin: NH,
      display_name: "NH Hoteles",
      instrument_type: "STOCK",
      is_investable: true,
      role: "INVESTABLE",
      quality_flags: ["PRICE_FROZEN_DELISTED", "MISSING_HOLDINGS"]
    } as BdbAssetDetail;
    expect(isInvestableAsset(detalle)).toBe(true);
  });
});
