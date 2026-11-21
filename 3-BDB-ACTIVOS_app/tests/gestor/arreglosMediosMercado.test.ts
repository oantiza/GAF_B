/**
 * Auditoría · GES-21: los avisos de mercado dicen en llano por qué no se ha podido leer algo, sin
 * pegar el mensaje técnico del lector (en inglés, del SDK de la base).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cargarMercado, motivoEnLlano, olvidarMercado, type FuenteDeMercado } from "../../src/gestor/mercado/cargar";
import { activo, cartera, mov } from "./ayudas";

/** Un error como los del lector de la base: un código y un mensaje técnico en inglés. */
const errorDeLaBase = (code: string, message: string) => Object.assign(new Error(message), { code });

function fuenteQueFalla(error: Error): FuenteDeMercado {
  const falla = async () => {
    throw error;
  };
  return { preciosDelAnio: falla, cambiosDelAnio: falla, libreDeRiesgoDelAnio: falla, tarjeta: falla };
}

const CARTERA = cartera([activo("ES0000000001", "ACCION", "EUR", { isin: "ES0000000001", origen: "catalogo", nombre: "Eléctrica" })], [
  mov("aportacion", "2024-01-02", { importe: "1000" }),
  mov("entradaDeTitulos", "2024-01-02", { activoId: "ES0000000001", titulos: "1", precio: "1" })
], { referencia: { activoId: "ES0000000001", nombre: "Eléctrica" } });

afterEach(() => vi.restoreAllMocks());

describe("GES-21 · los avisos de mercado no enseñan el mensaje técnico", () => {
  it("sin permiso: la frase llana, sin el texto del lector; el detalle va solo al registro", async () => {
    olvidarMercado();
    const registro = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mercado = await cargarMercado(CARTERA, "2024-06-30", fuenteQueFalla(errorDeLaBase("permission-denied", "Missing or insufficient permissions.")));
    const todos = mercado.avisos.join(" ");
    expect(todos).toContain("No se han podido leer los precios de Eléctrica: la sesión con la plataforma de datos no tiene permiso para leerlos");
    expect(todos).not.toContain("Missing or insufficient permissions");
    expect(registro).toHaveBeenCalled();
  });

  it("cada código conocido tiene su frase, y uno desconocido una genérica", () => {
    expect(motivoEnLlano(errorDeLaBase("unavailable", "Failed to get document because the client is offline."))).toBe("la plataforma de datos no responde; comprueba la conexión y pulsa «Reintentar»");
    expect(motivoEnLlano(errorDeLaBase("unauthenticated", "x"))).toContain("sesión");
    expect(motivoEnLlano(new Error("Something odd"))).toBe("la plataforma de datos no ha respondido como se esperaba");
  });
});
