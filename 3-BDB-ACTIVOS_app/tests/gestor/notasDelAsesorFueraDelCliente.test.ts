/**
 * La nota que el asesor escribe en un movimiento no llega al papel del cliente (P1-11 de la auditoría del 20-11-2026,
 * aprobado por Óscar el 21-11-2026). Es texto libre suyo —un acuerdo, una incidencia, algo del cliente— y antes salía en dos
 * sitios: en «Movimientos del periodo» del informe de cartera, en la columna del activo de todo movimiento de efectivo, y como
 * concepto de cada cargo en «Costes del servicio» del informe de costes.
 *
 * Se escribe una nota distinta en cada movimiento de la demostración, se generan los tres informes y se lee el texto impreso:
 * en los dos del cliente no aparece ninguna; en el del asesor, que es interno, sí. Sin esa última comprobación, un lector de
 * PDF que no leyera las tablas daría esta prueba por buena.
 */
import { describe, expect, test } from "vitest";
import { crearInformePdf } from "../../src/gestor/informes";
import { conceptoDelCargo } from "../../src/gestor/informes/secciones/costes/comun";
import type { DatosDelInforme } from "../../src/gestor/informes/tipos";
import { demostracion } from "../../src/gestor/demo/carteraDemo";
import { analizar, periodosHabituales, preparar } from "../../src/gestor/motor/analisis";
import { nombreDelTipo } from "../../src/gestor/motor/movimientos/registro";
import { HOY, paginasDe } from "./informesAyudas";

/** Una marca corta y de una sola palabra, para que el papel no la parta en dos líneas. */
const MARCA = "Zqnota";

function datosConNotas(): DatosDelInforme {
  const demo = demostracion(HOY);
  const cartera = { ...demo.cartera, movimientos: demo.cartera.movimientos.map((m, i) => ({ ...m, nota: `${MARCA}${i}` })) };
  const preparado = preparar(cartera, demo.mercado, demo.fichas, HOY);
  const periodo = periodosHabituales(preparado.valoracion, HOY).find((p) => p.id === "inicio")!.periodo;
  return { analisis: analizar(preparado, periodo, demo.referencia), cartera, generado: HOY };
}

/* Generar un PDF tarda segundos con la máquina cargada: más margen que los cinco por defecto. */
const PDF = { timeout: 30_000 };

describe("la nota del asesor en un movimiento (P1-11)", () => {
  const datos = datosConNotas();

  test("la cartera de la prueba lleva notas en movimientos de efectivo y en cargos del servicio", () => {
    const efectivoSinActivo = datos.cartera.movimientos.filter((m) => !m.activoId && m.fechaOperacion <= HOY);
    expect(efectivoSinActivo.length).toBeGreaterThan(5);
    expect(datos.analisis.ingresosYCostes.cargosDelServicio.length).toBeGreaterThan(0);
    expect(datos.analisis.ingresosYCostes.cargosDelServicio.every((cargo) => cargo.nota?.startsWith(MARCA))).toBe(true);
  });

  test("el concepto de un cargo es el nombre de su tipo, nunca la nota", () => {
    for (const cargo of datos.analisis.ingresosYCostes.cargosDelServicio) expect(conceptoDelCargo(cargo)).toBe(nombreDelTipo(cargo.tipo));
  });

  test("el informe de cartera para el cliente no imprime ninguna nota", PDF, async () => {
    const texto = (await paginasDe(await crearInformePdf("cliente", datos), "notas-del-asesor-cliente")).paginas.join("\n");
    expect(texto).toContain("Movimientos del periodo");
    /* Lo que va en su lugar en un movimiento de efectivo. */
    expect(texto).toContain("Efectivo");
    expect(texto).not.toContain(MARCA);
  });

  test("el informe de costes no imprime ninguna nota: el concepto es el tipo del cargo", PDF, async () => {
    const texto = (await paginasDe(await crearInformePdf("costes", datos), "notas-del-asesor-costes")).paginas.join("\n");
    expect(texto).toContain("Costes del servicio");
    expect(texto).toContain(nombreDelTipo("comision"));
    expect(texto).not.toContain(MARCA);
  });

  test("el informe del asesor, que es interno, sí las lleva", PDF, async () => {
    const texto = (await paginasDe(await crearInformePdf("asesor", datos), "notas-del-asesor-asesor")).paginas.join("\n");
    expect(texto).toContain(MARCA);
  });
});
