/**
 * Palabras que llegaban en crudo a la pantalla: revisión del 05-11-2026. Se traducen en la capa de pantalla, porque lo que
 * hay debajo lo lee también el papel.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CLASE_DE_ACTIVO_DEL_BUSCADOR } from "../src/adapters/componerLista";
import { AsyncErrorBanner } from "../src/components/AsyncErrorBanner";
import { categoriaLegible, regionLegible } from "../src/core/etiquetasDeReparto";

describe("las etiquetas de los repartos y de los filtros", () => {
  test("«Accion» es la categoría de una acción, «Acciones», en cualquier caja (decisión 83); lo que no está en la tabla no se toca", () => {
    expect(categoriaLegible("Accion")).toBe("Acciones");
    expect(categoriaLegible("ACCION")).toBe("Acciones");
    expect(categoriaLegible("Fondo")).toBe("Fondo");
    expect(categoriaLegible(null)).toBeUndefined();
  });

  test("la región que llega en inglés sale en español, y la que no se conoce, tal cual: no se inventa", () => {
    expect(regionLegible("Germany")).toBe("Alemania");
    expect(regionLegible("Spain")).toBe("España");
    expect(regionLegible("Switzerland")).toBe("Suiza");
    expect(regionLegible("Atlantis")).toBe("Atlantis");
  });

  test("el filtro de clase del Buscador no enseña «OTHER»", () => {
    expect(CLASE_DE_ACTIVO_DEL_BUSCADOR.OTHER).toBe("Otros");
  });
});

describe("un fallo de contrato", () => {
  const CONTRATO = "Contrato de backend inválido en diagnostics: se esperaba object";

  test("dice en palabras qué ha pasado, y lo técnico se queda en el detalle", () => {
    const html = renderToStaticMarkup(<AsyncErrorBanner error={new Error(CONTRATO)} />);
    const [antes, detalle] = html.split("Detalle técnico");
    expect(antes).toContain("El servidor ha devuelto una respuesta que la aplicación no sabe leer");
    expect(antes).not.toContain("Contrato de backend");
    expect(detalle).toContain(CONTRATO);
  });
});
