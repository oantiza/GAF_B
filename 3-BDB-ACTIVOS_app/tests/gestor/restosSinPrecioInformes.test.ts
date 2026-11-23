/**
 * Los restos de la posición sin precio en el informe del asesor (20-11-2026): el cupón corrido de un bono sin precio dice «Falta el
 * dato», y la cobertura del coste corriente dice que no cuenta a un fondo sin precio. Las cuentas, en `restosSinPrecio.test.tsx`:
 * el cupón corrido de 10.000 USD al 5 % anual, del 30-06-2024 al 31-01-2025, es 10.000 × 5 % × 215 / 365 = 294,52 USD.
 */
import { describe, expect, test } from "vitest";
import { crearInformePdf } from "../../src/gestor/informes";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import type { DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";
import { paginasDe } from "./informesAyudas";

const FIN = "2025-01-31";
const mercado: DatosDeMercado = {
  precios: new Map([["A", serie(["2025-01-02", 100], [FIN, 120])]]),
  cambios: new Map([["USD", serie(["2025-01-04", 1.25])]])
};
const datosDe = (activos: Array<ReturnType<typeof activo>>, movimientos: Array<ReturnType<typeof mov>>) => {
  const c = cartera(activos, movimientos, { nombre: "Cartera de prueba" });
  return { analisis: analizar(preparar(c, mercado, new Map(), FIN), { desde: "2025-01-01", hasta: FIN }), cartera: c, generado: FIN };
};

describe("el informe del asesor", () => {
  test("un bono sin precio dice «Falta el dato» en su cupón corrido y lo explica; con precio, 294,52", async () => {
    const bono = { cupon: "0.05", frecuencia: 1, vencimiento: "2030-06-30", base: "ACT/ACT" as const };
    const sin = datosDe([activo("BO", "BONO", "USD", { bono })], [mov("aportacion", "2025-01-02", { importe: "10000" }), mov("compra", "2025-01-03", { activoId: "BO", titulos: "10000", importe: "-9000" })]);
    const hojaSin = (await paginasDe(await crearInformePdf("asesor", sin), "asesor-bono-sin-precio")).paginas.find((pagina) => pagina.includes("Cupón corrido"))!;
    expect(hojaSin).toContain("Falta el dato");
    expect(hojaSin).toContain("De un bono sin precio no se da: la posición no tiene valor.");
    expect(hojaSin).not.toContain("294,52");
    const con = datosDe([activo("BO", "BONO", "EUR", { bono })], [mov("aportacion", "2025-01-02", { importe: "10000" }), mov("compra", "2025-01-03", { activoId: "BO", titulos: "10000", precio: "90", importe: "-9000" })]);
    const hojaCon = (await paginasDe(await crearInformePdf("asesor", con), "asesor-bono-con-precio")).paginas.find((pagina) => pagina.includes("Cupón corrido"))!;
    expect(hojaCon).toContain("294,52");
    expect(hojaCon).not.toContain("De un bono sin precio");
  }, 30_000);

  test("la cobertura del coste corriente dice que no cuenta a un fondo sin precio", async () => {
    const fondoB = activo("B", "FONDO", "USD", { origen: "catalogo", isin: "XB0000000002" });
    const datos = datosDe(
      [activo("A"), fondoB],
      [
        mov("aportacion", "2025-01-02", { importe: "3000" }),
        mov("compra", "2025-01-02", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
        mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" })
      ]
    );
    const { paginas } = await paginasDe(await crearInformePdf("asesor", datos), "asesor-fondo-sin-precio");
    expect(paginas.join("\n")).toContain("No entra el coste corriente de Activo B, que no tiene precio: no se conoce su valor, y la cobertura no lo cuenta.");
  }, 30_000);
});
