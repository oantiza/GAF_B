/**
 * Auditoría · arreglos medios y bajos del almacén y de las fechas de la lista (GES-27, GES-23).
 */
import { describe, expect, it } from "vitest";
import { almacenEnCarpeta } from "../../src/gestor/almacen/carpeta";
import { diaDeUnInstante } from "../../src/gestor/ui/formato";
import { activo, cartera, mov } from "./ayudas";
import { crearCarpetaFalsa } from "./carpetaFalsa";

describe("GES-27 · la lista espera al guardado que va por delante", () => {
  it("listar justo después de un guardado sin esperar ve la cartera ya guardada", async () => {
    const falsa = crearCarpetaFalsa();
    const almacen = almacenEnCarpeta(falsa.carpeta, { ahora: () => new Date("2026-11-13T09:00:00Z") });
    const c = cartera([activo("F", "FONDO")], [mov("aportacion", "2026-01-02", { id: "m-1", importe: "1000" })], { id: "aaaaaaaa-1111-4000-8000-000000000027", nombre: "Familia Cola" });
    await almacen.guardar(c);
    /* El guardado de salida (dos movimientos) no se espera, como al volver de una cartera; la lista se pide a la vez. */
    const guardado = almacen.guardar({ ...c, movimientos: [...c.movimientos, mov("aportacion", "2026-02-01", { id: "m-2", importe: "50" })] });
    const lista = await almacen.listar();
    await guardado;
    expect(lista.find((r) => r.id === c.id)?.movimientos).toBe(2);
  });
});

describe("GES-23 · la fecha de un instante guardado es la del día local", () => {
  it("lo guardado a las 00:30 de un día es de ese día, también donde la hora local va por delante de UTC", () => {
    /* Las 00:30 del 15-03-2026 en la hora del equipo; en España es el 14-03 a las 23:30 en UTC. */
    const instante = new Date(2026, 2, 15, 0, 30).toISOString();
    expect(diaDeUnInstante(instante)).toBe("2026-03-15");
  });
});
