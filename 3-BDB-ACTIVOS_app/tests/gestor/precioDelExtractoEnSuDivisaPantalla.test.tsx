// @vitest-environment happy-dom
/**
 * A-205, en la pantalla: la cuenta de valores de la cartera dice el precio que el extracto da en la divisa del activo,
 * 99,55 $, y su valor, 100 × 99,55 / 1,10 = 9.050,00 € —lo mismo que el Excel y el informe del asesor
 * (`precioDelExtractoEnSuDivisa.test.ts`)—; con un fichero de antes, sin ese precio, 99,00 $ y 9.000,00 €, como hasta ahora.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import { VistaCuentas } from "../../src/gestor/ui/vistas/VistaCuentas";
import { ANTERIOR, DIA, MERCADO, NUEVA } from "./precioDelExtractoEnSuDivisaDatos";
import { datosDeVista, panel, pintar, type Pintado } from "./vistaAnalisisDatos";

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

const ESPACIO_DURO = String.fromCharCode(0xa0);
const plano = (texto: string | null | undefined) => (texto ?? "").replaceAll(ESPACIO_DURO, " ").replace(/\s+/g, " ").trim();
const CARGADO: MercadoCargado = { datos: MERCADO, fichas: new Map(), avisos: [] };

async function filaDeLaAccion(cartera: typeof NUEVA): Promise<string> {
  pintado = await pintar(<VistaCuentas datos={datosDeVista(cartera, CARGADO, DIA)} />);
  const fila = [...panel(pintado.vista, "Cuenta de valores").querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Accion americana"));
  return plano(fila?.textContent);
}

describe("la cuenta de valores", () => {
  it("con el precio del extracto en su divisa: 99,55 $ y 9.050,00 €", async () => {
    const texto = await filaDeLaAccion(NUEVA);
    expect(texto).toContain("99,55");
    expect(texto).toContain("9.050,00 €");
    expect(texto).toContain("Precio del extracto del banco");
  });

  it("con un fichero de antes: 99,00 $ y 9.000,00 €", async () => {
    const texto = await filaDeLaAccion(ANTERIOR);
    expect(texto).toContain("99,00");
    expect(texto).toContain("9.000,00 €");
  });
});
