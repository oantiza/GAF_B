import { describe, expect, test } from "vitest";
import { anchoDelTexto, decimalesDeLasMarcas, marcasDelEje } from "../src/core/escalaDelPlano";
import { separarEtiquetas } from "../src/charts/oaa/etiquetasFinales";

describe("las marcas de un eje del plano", () => {
  test("los casos de la captura: volatilidades de 5 a 17 % y rentabilidades con el cero dentro", () => {
    expect(marcasDelEje([0.0525, 0.1695])).toEqual([0.05, 0.1, 0.15, 0.2]);
    expect(marcasDelEje([0.0214, 0.1633], { conCero: true })).toEqual([0, 0.05, 0.1, 0.15, 0.2]);
  });

  test("el cero entra aunque todas sean positivas o todas negativas", () => {
    expect(marcasDelEje([0.2, 0.3], { conCero: true })).toContain(0);
    expect(marcasDelEje([-0.08, -0.03], { conCero: true })).toContain(0);
  });

  test("siempre entre cuatro y cinco marcas, y abarcan todos los valores", () => {
    /* Un barrido determinista: 2.000 parejas de valores repartidos por varias magnitudes. */
    let semilla = 12345;
    const azar = () => {
      semilla = (semilla * 1664525 + 1013904223) % 4294967296;
      return semilla / 4294967296;
    };
    for (let intento = 0; intento < 2000; intento += 1) {
      const magnitud = 10 ** (Math.floor(azar() * 4) - 3);
      const valores = [(azar() - 0.3) * magnitud, (azar() - 0.3) * magnitud, (azar() - 0.3) * magnitud];
      const marcas = marcasDelEje(valores, { conCero: intento % 2 === 0 });
      expect(marcas.length, `${valores}`).toBeGreaterThanOrEqual(4);
      expect(marcas.length, `${valores}`).toBeLessThanOrEqual(5);
      expect(marcas[0]).toBeLessThanOrEqual(Math.min(...valores) + 1e-9);
      expect(marcas[marcas.length - 1]).toBeGreaterThanOrEqual(Math.max(...valores) - 1e-9);
    }
  });

  test("un solo valor también tiene escala", () => {
    const marcas = marcasDelEje([0.1]);
    expect(marcas.length).toBeGreaterThanOrEqual(4);
    expect(marcas[0]).toBeLessThan(0.1);
    expect(marcas[marcas.length - 1]).toBeGreaterThan(0.1);
  });

  test("sin valores no hay marcas, y un no-número no se cuela", () => {
    expect(marcasDelEje([])).toEqual([]);
    expect(marcasDelEje([Number.NaN, 0.1, 0.2]).every(Number.isFinite)).toBe(true);
  });

  test("no arrastra el ruido de multiplicar en coma flotante", () => {
    expect(marcasDelEje([0.01, 0.31])).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

  test("los decimales son los que hacen falta", () => {
    expect(decimalesDeLasMarcas([0, 0.05, 0.1])).toBe(0);
    expect(decimalesDeLasMarcas([0, 0.025, 0.05])).toBe(1);
    expect(decimalesDeLasMarcas([0, 0.0025, 0.005])).toBe(2);
  });
});

describe("el ancho de una etiqueta", () => {
  test("las mayúsculas ocupan más, y por eso se mide por letra y no por cuenta", () => {
    expect(anchoDelTexto("COMMONWEALTH BANK")).toBeGreaterThan(anchoDelTexto("Commonwealth Bank"));
  });

  test("un nombre largo no cabe junto a un punto a media altura del plano", () => {
    /* 338 de ancho útil con el punto en el centro: 170 a cada lado. */
    expect(anchoDelTexto("DPAM B - Equities NewGems Sustainable B Cap")).toBeGreaterThan(170);
    expect(anchoDelTexto("Fondo A")).toBeLessThan(170);
  });
});

describe("las etiquetas del final de las líneas", () => {
  const separacion = (posiciones: number[]) => {
    const orden = [...posiciones].sort((a, b) => a - b);
    return orden.slice(1).map((y, indice) => y - orden[indice]);
  };

  test("si no chocan, cada una se queda donde acaba su línea", () => {
    expect(separarEtiquetas([40, 120, 200], 14, 0, 280)).toEqual([40, 120, 200]);
  });

  test("dos líneas que acaban a 13 px se separan lo justo, a los dos lados de su media", () => {
    const [a, b] = separarEtiquetas([100, 113], 14, 0, 280);
    expect(b - a).toBeCloseTo(14, 10);
    expect((a + b) / 2).toBeCloseTo(106.5, 10);
  });

  test("devuelve las posiciones en el orden en que entraron", () => {
    const [arriba, abajo] = separarEtiquetas([113, 100], 14, 0, 280);
    expect(arriba).toBeGreaterThan(abajo);
  });

  test("varias a la vez, y un grupo que al crecer alcanza al de al lado", () => {
    const salida = separarEtiquetas([100, 101, 102, 115, 200], 14, 0, 280);
    for (const hueco of separacion(salida)) expect(hueco).toBeGreaterThanOrEqual(14 - 1e-9);
    expect(salida[4]).toBe(200);
  });

  test("no se salen del gráfico", () => {
    const salida = separarEtiquetas([2, 3, 275, 279], 14, 6, 278);
    expect(Math.min(...salida)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...salida)).toBeLessThanOrEqual(278);
    for (const hueco of separacion(salida)) expect(hueco).toBeGreaterThanOrEqual(14 - 1e-9);
  });
});
