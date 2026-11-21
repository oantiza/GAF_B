/**
 * El eje vertical de los gráficos de líneas: marcas a pasos iguales que se pueden escribir tal cual.
 *
 * Con el eje en automático, la curva de tipos del euro (de 2,65 a 3,72) marcaba 2,5 · 2,85 · 3,2 · 3,55 · 3,9 y, con
 * un decimal, se leía «2,5 · 2,8 · 3,2 · 3,5 · 3,9»: cuatro saltos iguales escritos como 0,3 · 0,4 · 0,3 · 0,4. El
 * cono estadístico iba de 65 en 65. Y la etiqueta del final de una línea cortaba el nombre a mitad de paréntesis:
 * «Parte medida (8… 140,3».
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ejeVertical, propiedadesDelEje } from "../src/charts/oaa/ejeVertical";
import { nombreAlFinalDeLaLinea, textoAlFinalDeLaLinea } from "../src/charts/oaa/etiquetasFinales";

const pasos = (marcas: readonly number[]) => marcas.slice(1).map((marca, indice) => Number((marca - marcas[indice]).toFixed(9)));

describe("las marcas del eje vertical", () => {
  test("la curva de tipos: pasos iguales y escritos con un decimal sin redondear ninguno", () => {
    const eje = ejeVertical([2.65, 3.12, 3.18, 3.45, 3.69, 3.72, 3.68]);
    /* A mano: de 2,65 a 3,72 hay 1,07. De 0,1 en 0,1 serían doce marcas; de 0,2 en 0,2, de 2,6 a 3,8, son siete. */
    expect(eje?.marcas).toEqual([2.6, 2.8, 3, 3.2, 3.4, 3.6, 3.8]);
    expect(eje?.dominio).toEqual([2.6, 3.8]);
    expect(eje?.decimales).toBe(1);
    expect(new Set(pasos(eje!.marcas)).size).toBe(1);
  });

  test("una serie en base 100: de diez en diez, ceñida a la serie", () => {
    const eje = ejeVertical([100, 98.2, 117.4, 141.9, 140.3]);
    /* De 98,2 a 141,9: de diez en diez, de 90 a 150, siete marcas. Con el tope de cinco iría de 80 a 160. */
    expect(eje?.marcas).toEqual([90, 100, 110, 120, 130, 140, 150]);
    expect(eje?.decimales).toBe(0);
  });

  test("el cono: nunca de 65 en 65", () => {
    const eje = ejeVertical([100, 96, 131, 88, 247]);
    /* De 88 a 247 hay 159: de 25 en 25, de 75 a 250, son ocho; de 50 en 50, de 50 a 250, cinco. */
    expect(eje?.marcas).toEqual([50, 100, 150, 200, 250]);
  });

  test("si el paso pide dos decimales, lo dice", () => {
    const eje = ejeVertical([2.52, 3.71]);
    /* 1,19 de recorrido: de 0,2 en 0,2, de 2,4 a 3,8, son ocho marcas; de 0,25 en 0,25, de 2,5 a 3,75, seis. */
    expect(eje?.marcas).toEqual([2.5, 2.75, 3, 3.25, 3.5, 3.75]);
    expect(eje?.decimales).toBe(2);
  });

  test("lo que no es una cifra no cuenta, y sin cifras no hay eje", () => {
    expect(ejeVertical([null, undefined, Number.NaN, 10, 20])?.dominio).toEqual([10, 20]);
    expect(ejeVertical([null, undefined])).toBeNull();
    expect(propiedadesDelEje(null)).toEqual({ domain: ["auto", "auto"] });
  });

  test("al eje se le pasan las marcas, su recorrido y que las pinte todas", () => {
    expect(propiedadesDelEje(ejeVertical([1, 2]))).toEqual({ ticks: [1, 1.2, 1.4, 1.6, 1.8, 2], domain: [1, 2], interval: 0 });
  });
});

describe("el nombre al final de la línea", () => {
  test("pierde el paréntesis antes que cortarse por la mitad", () => {
    expect(nombreAlFinalDeLaLinea("Parte medida (88 %)")).toBe("Parte medida");
    expect(nombreAlFinalDeLaLinea("Máx. Sharpe (máx. 35 % por activo)")).toBe("Máx. Sharpe");
  });

  test("si cabe, se queda entero, con su paréntesis", () => {
    expect(nombreAlFinalDeLaLinea("Cartera (88 %)")).toBe("Cartera (88 %)");
  });

  test("y si ni sin paréntesis cabe, se recorta", () => {
    expect(nombreAlFinalDeLaLinea("Índice mundial de renta variable (MSCI)")).toBe("Índice mundial…");
  });

  test("una línea sola lleva solo su último valor: el título ya dice de quién es", () => {
    const fondo = { label: "Amundi Funds - Global Equity Responsible A EUR (C)" };
    expect(textoAlFinalDeLaLinea(fondo, "150,8", true)).toBe("150,8");
    /* Con otra línea al lado, cada una dice cuál es. */
    expect(textoAlFinalDeLaLinea(fondo, "150,8", false)).toBe("Amundi Funds -… · 150,8");
    /* Y un nombre corto dado a mano se escribe siempre, separado del valor por « · »: «1 150,8» se leía «1.150,8». */
    expect(textoAlFinalDeLaLinea({ ...fondo, etiquetaFinal: "1" }, "150,8", true)).toBe("1 · 150,8");
  });
});

describe("ningún gráfico deja el eje vertical de una serie temporal en automático", () => {
  const RAIZ = path.resolve(__dirname, "..", "src", "charts");
  const ficheros = (carpeta: string): string[] =>
    readdirSync(carpeta).flatMap((nombre) => {
      const ruta = path.join(carpeta, nombre);
      return statSync(ruta).isDirectory() ? ficheros(ruta) : ruta.endsWith(".tsx") ? [ruta] : [];
    });
  /* La frontera y el plano riesgo-rentabilidad son nubes de puntos con su propia escala: no entran aquí. */
  const DE_LINEAS = ["OaaLineChart.tsx", "OaaMonteCarloChart.tsx", "EuroYieldCurveChart.tsx"];

  test.each(DE_LINEAS)("%s usa las marcas calculadas", (nombre) => {
    const ruta = ficheros(RAIZ).find((candidata) => candidata.endsWith(nombre));
    expect(ruta).toBeDefined();
    const texto = readFileSync(ruta!, "utf8");
    expect(texto).toContain("propiedadesDelEje(eje)");
    expect(texto).not.toContain('domain={["auto", "auto"]}');
  });
});
