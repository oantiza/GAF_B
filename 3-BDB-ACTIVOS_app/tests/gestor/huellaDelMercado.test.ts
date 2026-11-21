/**
 * GES-07 · La huella que decide si hay que volver a pedir los precios a la plataforma. La carga
 * pide cada activo desde el año anterior a SU primer movimiento, así que la huella tiene que
 * cambiar cuando cambia ese año, aunque no cambie el primer movimiento de la cartera.
 */
import { describe, expect, it } from "vitest";
import { huellaDeLoQueSePide } from "../../src/gestor/ui/estado/useAnalisisDeCartera";
import { activo, cartera, mov } from "./ayudas";

const FONDO = activo("F", "FONDO", "EUR", { origen: "catalogo", isin: "LU0000000001" });
const BASE = [
  mov("aportacion", "2018-01-02", { id: "a", importe: "100000" }),
  mov("suscripcion", "2022-03-01", { id: "s1", activoId: "F", titulos: "10", precio: "100", importe: "-1000" })
];

describe("la huella de lo que se pide a la plataforma", () => {
  it("cambia al añadir un movimiento anterior de un activo que ya estaba, aunque la cartera ya empezase antes", () => {
    const antes = huellaDeLoQueSePide(cartera([FONDO], BASE), "2026-11-13");
    /* El primer movimiento de la cartera sigue siendo de 2018; el del fondo pasa de 2022 a 2019. */
    const despues = huellaDeLoQueSePide(cartera([FONDO], [...BASE, mov("suscripcion", "2019-05-02", { id: "s0", activoId: "F", titulos: "5", precio: "90", importe: "-450" })]), "2026-11-13");
    expect(despues).not.toBe(antes);
  });

  it("no cambia con un movimiento posterior del mismo activo en un año que ya se pedía", () => {
    const antes = huellaDeLoQueSePide(cartera([FONDO], BASE), "2026-11-13");
    const despues = huellaDeLoQueSePide(cartera([FONDO], [...BASE, mov("suscripcion", "2024-05-02", { id: "s2", activoId: "F", titulos: "5", precio: "110", importe: "-550" })]), "2026-11-13");
    expect(despues).toBe(antes);
  });
});
