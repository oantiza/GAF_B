// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { importarReconocidos, reconocer } from "../../src/gestor/importacion/registro";
import { revisar } from "../../src/gestor/importacion/revision";
import { carteraVacia } from "../../src/gestor/motor/modelo";
import { PasoRevision } from "../../src/gestor/ui/importar/PasoRevision";
import { pintar } from "../piezas/pintar";
import { MOVIMIENTOS_COMPLETOS, OPERACIONES_COMPLETAS, POSICIONES_COMPLETAS, documento } from "./andbankDeMuestra";

vi.mock("../../src/gestor/mercado/plataforma", () => ({ catalogoDeActivos: vi.fn(async () => []) }));

/**
 * MAR-10: el filtro «Documento» de la revisión de una importación lo pinta la pieza Campo, y su rótulo nombra al
 * desplegable. Antes el rótulo era un texto dentro de una etiqueta que envolvía el control.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

describe("la revisión de una importación con varios documentos", () => {
  test("el filtro «Documento» tiene su rótulo enlazado al desplegable", async () => {
    const cartera = carteraVacia({ nombre: "Importada", ahora: "2026-01-01T00:00:00.000Z", id: "c" });
    const resultados = importarReconocidos(
      [documento("mov.xls", MOVIMIENTOS_COMPLETOS), documento("pos.xls", POSICIONES_COMPLETAS), documento("ops.xls", OPERACIONES_COMPLETAS)].map(reconocer),
      { divisaBase: "EUR" }
    );
    const revision = revisar(resultados, cartera, []);
    const vista = pintar(
      <PasoRevision
        alDecidir={vi.fn()}
        alMarcar={vi.fn()}
        cartera={cartera}
        decisiones={new Map()}
        marcas={new Map()}
        resultados={resultados}
        revision={revision}
        sinCatalogo={false}
      />
    );
    quitar = vista.quitar;
    await act(async () => undefined);
    const rotulo = [...vista.host.querySelectorAll("label.field__label")].find((label) => label.textContent === "Documento");
    expect(rotulo).toBeDefined();
    const control = document.getElementById(rotulo!.getAttribute("for")!) as HTMLSelectElement;
    expect(control.tagName).toBe("SELECT");
    expect([...control.options].map((opcion) => opcion.textContent)[0]).toBe("Todos");
  });
});
