/**
 * El concepto para el cliente de un cargo (aprobado por Óscar el 21-11-2026): un texto corto que el asesor escribe en una
 * comisión o un gasto para que el informe de costes del cliente nombre y agrupe el cargo con él. Es otra cosa que la nota,
 * que es suya y sigue sin salir en el papel del cliente (`notasDelAsesorFueraDelCliente.test.ts`).
 *
 * Se comprueba de punta a punta: el fichero lo guarda y lee, y una cartera de antes, sin él, se sigue leyendo igual; el
 * motor rechaza uno que no es texto o que es largo; el formulario lo pide solo en los dos tipos que lo admiten (en `formularioDeMovimiento.test.tsx`); el informe
 * de costes agrupa y nombra por él, y sin él dice «Comisión o gasto»; y la importación de Andbank no lo rellena.
 *
 * Las cifras esperadas, a mano: dieciocho cargos de 4,25 €; seis llevan concepto (los de i = 0, 3, 6, 9, 12 y 15) y doce no.
 * 6 × 4,25 = 25,50 € y 12 × 4,25 = 51,00 €; los dieciocho, 76,50 €.
 */
import { describe, expect, it, test } from "vitest";
import { importe as importeComun } from "../../src/core/formato";
import { ErrorDeFormato, leer, serializar } from "../../src/gestor/almacen/formato";
import { importadorDeAndbank } from "../../src/gestor/importacion/andbank";
import { crearInformePdf } from "../../src/gestor/informes";
import { conceptoDelCargo } from "../../src/gestor/informes/secciones/costes/comun";
import type { DatosDelInforme } from "../../src/gestor/informes/tipos";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import { sumarDias } from "../../src/gestor/motor/fechas";
import { validarMovimiento, contextoDe } from "../../src/gestor/motor/libro";
import { LARGO_DEL_CONCEPTO, type Cartera } from "../../src/gestor/motor/modelo";
import type { Punto } from "../../src/gestor/motor/valoracion";
import { MOVIMIENTOS_COMPLETOS, OPERACIONES_COMPLETAS, POSICIONES_COMPLETAS, documento } from "./andbankDeMuestra";
import { activo, cartera, mov } from "./ayudas";
import { HOY, paginasDe, plano } from "./informesAyudas";

const importe = (valor: number) => importeComun(valor) ?? "";
const CONCEPTO = "Custodia trimestral";
const NOTA = "Zqnota";
const PDF = { timeout: 30_000 };

/** Una cartera con un fondo y dieciocho cargos de 4,25 €, uno cada quince días; uno de cada tres con concepto, todos con nota. */
function carteraConCargos(cuantos = 18): Cartera {
  const desde = "2026-01-02";
  const fondo = activo("FA", "FONDO", "EUR", { nombre: "Fondo Global de Prueba" });
  return cartera([fondo], [
    mov("aportacion", desde, { importe: "20000" }),
    mov("suscripcion", desde, { activoId: "FA", titulos: "100", precio: "100", importe: "-10000" }),
    ...Array.from({ length: cuantos }, (_, i) =>
      mov("comision", sumarDias("2026-01-15", i * 15), { importe: "-4.25", nota: `${NOTA}${i}`, ...(i % 3 === 0 ? { conceptoCliente: CONCEPTO } : {}) })
    )
  ], { nombre: "Cartera con conceptos" });
}

function datosDe(c: Cartera): DatosDelInforme {
  const dias: string[] = [];
  for (let dia = "2025-12-28"; dia <= HOY; dia = sumarDias(dia, 1)) dias.push(dia);
  const precios = new Map<string, Punto[]>([["FA", dias.map((fecha) => ({ fecha, valor: 100 }))]]);
  const preparado = preparar(c, { precios, cambios: new Map() }, new Map(), HOY);
  return { analisis: analizar(preparado, { desde: "2025-12-31", hasta: HOY }), cartera: c, generado: HOY };
}

describe("el concepto para el cliente en el fichero de la cartera", () => {
  it("se guarda y se lee tal cual", () => {
    const c = carteraConCargos(3);
    const leida = leer(serializar(c, "2026-11-21T10:00:00.000Z")).cartera;
    expect(leida.movimientos.filter((m) => m.conceptoCliente === CONCEPTO)).toHaveLength(1);
    expect(leida).toEqual(c);
  });

  it("una cartera de antes, sin él, se lee igual y sigue sin él", () => {
    const c = carteraConCargos(3);
    const deAntes: Cartera = {
      ...c,
      movimientos: c.movimientos.map((m) => {
        const copia = { ...m };
        delete copia.conceptoCliente;
        return copia;
      })
    };
    const texto = serializar(deAntes, "2026-11-21T10:00:00.000Z");
    expect(texto).not.toContain("conceptoCliente");
    const leida = leer(texto).cartera;
    expect(leida).toEqual(deAntes);
    expect(leida.movimientos.every((m) => m.conceptoCliente === undefined)).toBe(true);
  });

  it("uno que no es texto no se abre, y lo dice", () => {
    const c = carteraConCargos(1);
    const roto = JSON.parse(serializar(c, "2026-11-21T10:00:00.000Z"));
    roto.cartera.movimientos[2].conceptoCliente = 12;
    expect(() => leer(JSON.stringify(roto))).toThrow(ErrorDeFormato);
    expect(() => leer(JSON.stringify(roto))).toThrow("El movimiento 3 tiene un concepto para el cliente que no es un texto.");
  });

  it(`el motor no admite uno de más de ${LARGO_DEL_CONCEPTO} caracteres`, () => {
    const c = carteraConCargos(0);
    const contexto = contextoDe(c);
    const justo = mov("comision", "2026-02-01", { importe: "-1", conceptoCliente: "x".repeat(LARGO_DEL_CONCEPTO) });
    const largo = mov("comision", "2026-02-01", { importe: "-1", conceptoCliente: "x".repeat(LARGO_DEL_CONCEPTO + 1) });
    expect(validarMovimiento(justo, contexto)).toEqual([]);
    expect(validarMovimiento(largo, contexto)).toContain(`El concepto para el cliente no puede pasar de ${LARGO_DEL_CONCEPTO} caracteres.`);
  });
});

describe("el informe de costes del cliente nombra y agrupa los cargos por su concepto", () => {
  test("el concepto de un cargo es el del asesor y, sin él, el nombre del tipo; nunca la nota", () => {
    expect(conceptoDelCargo({ tipo: "comision", concepto: CONCEPTO })).toBe(CONCEPTO);
    expect(conceptoDelCargo({ tipo: "comision" })).toBe("Comisión o gasto");
    expect(conceptoDelCargo({ tipo: "comision", concepto: "   " })).toBe("Comisión o gasto");
    expect(conceptoDelCargo({ tipo: "otroEfectivo" })).toBe("Otro cargo o abono");
  });

  test("con dieciocho cargos, dos grupos: 12 sin concepto por 51,00 € y 6 con él por 25,50 €", PDF, async () => {
    const datos = datosDe(carteraConCargos());
    const ic = datos.analisis.ingresosYCostes;
    expect(ic.cargosDelServicio).toHaveLength(18);
    expect(ic.costesDelServicio).toBeCloseTo(76.5, 9);
    expect(ic.cargosDelServicio.filter((cargo) => cargo.concepto === CONCEPTO)).toHaveLength(6);
    const texto = (await paginasDe(await crearInformePdf("costes", datos), "concepto-agrupado")).paginas.join("\n");
    expect(texto).toContain("18 cargos, agrupados por concepto");
    /* De más a menos importe: primero el grupo sin concepto. */
    expect(texto).toMatch(new RegExp(`Comisión o gasto\\s+12\\s+${escapar(plano(importe(51)))}`));
    expect(texto).toMatch(new RegExp(`${CONCEPTO}\\s+6\\s+${escapar(plano(importe(25.5)))}`));
    expect(texto.indexOf("Comisión o gasto")).toBeLessThan(texto.indexOf(CONCEPTO));
    expect(texto).toContain(plano(importe(76.5)));
    expect(texto).not.toContain(NOTA);
  });

  test("con pocos cargos, cada uno con su concepto, y la nota sigue fuera", PDF, async () => {
    const datos = datosDe(carteraConCargos(3));
    const texto = (await paginasDe(await crearInformePdf("costes", datos), "concepto-por-fecha")).paginas.join("\n");
    expect(texto).toContain("Los 3 cargos del servicio en su cuenta en el periodo, por fecha.");
    /* El de i = 0 (15/01/2026) lleva concepto; los de 30/01 y 14/02, no. */
    expect(texto).toMatch(new RegExp(`15/01/2026\\s+${CONCEPTO}`));
    expect(texto).toMatch(/30\/01\/2026\s+Comisión o gasto/);
    expect(texto).toMatch(/14\/02\/2026\s+Comisión o gasto/);
    expect(texto).not.toContain(NOTA);
  });
});

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("la importación de Andbank no rellena el concepto para el cliente", () => {
  it("la comisión de custodia del extracto llega sin él: el texto del banco no va al papel sin que el asesor lo escriba", () => {
    const resultado = importadorDeAndbank.importar(
      [
        { documento: documento("mov.xls", MOVIMIENTOS_COMPLETOS), tipo: "movimientos" },
        { documento: documento("pos.xls", POSICIONES_COMPLETAS), tipo: "posiciones" },
        { documento: documento("ops.xls", OPERACIONES_COMPLETAS), tipo: "operaciones" }
      ],
      { divisaBase: "EUR" }
    );
    const comisiones = resultado.movimientos.filter((propuesto) => propuesto.movimiento.tipo === "comision");
    expect(comisiones.length).toBeGreaterThan(0);
    expect(comisiones.some((propuesto) => propuesto.textoOriginal.includes("COMISION CUSTODIA"))).toBe(true);
    for (const propuesto of resultado.movimientos) expect(propuesto.movimiento.conceptoCliente).toBeUndefined();
  });
});
