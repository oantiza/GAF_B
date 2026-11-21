// @vitest-environment happy-dom
/**
 * El color del gestor (14-11-2026, Óscar: «le faltan colores en general… dale más vida»).
 *
 * - G4: la casilla de cada mes en «Rentabilidad por meses y años» vuelve a decir cuánto fue de bueno o de malo el mes: verde
 *   si gana y rojo si pierde, en cinco intensidades de punto en punto porcentual, con tope en el 5 % mensual (la escala de
 *   antes del rediseño, commit 8da9cb9d). La cifra sigue escrita y se lee sobre su fondo: al menos 4,5:1 en las diez.
 * - «En qué está invertida» y «Por clase de activo»: cada clase con su color de toda la aplicación; «Otros» y «Sin
 *   clasificar», apagados.
 */
import { readFileSync } from "node:fs";
import { URL as UrlDeNode } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { colorDeLaClasePorNombre } from "../../src/core/coloresDeClase";
import { claseDelMes, colorDeLaParteDeClase } from "../../src/gestor/ui/analisis/lectura";
import { VistaAnalisis } from "../../src/gestor/ui/vistas/VistaAnalisis";
import { VistaResumen } from "../../src/gestor/ui/vistas/VistaResumen";
import { datosDeLaDemo, panel, pintar, type Pintado } from "./vistaAnalisisDatos";

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
  window.history.replaceState(null, "", "/");
});

describe("la intensidad de cada mes", () => {
  it.each([
    [0.00004, ""], // se escribe «+0,00 %»: ni sube ni baja
    [-0.00004, ""],
    [0.0001, "gestor-mes--sube-1"],
    [0.004, "gestor-mes--sube-1"],
    [0.01, "gestor-mes--sube-1"], // «+1,00 %»: hasta un punto, el nivel 1
    [0.0101, "gestor-mes--sube-2"],
    [0.02, "gestor-mes--sube-2"],
    [0.03, "gestor-mes--sube-3"], // 0,03 × 100 = 3,0000000000000004: sin redondear saltaba al 4
    [0.030004, "gestor-mes--sube-3"], // se escribe «+3,00 %»
    [0.0351, "gestor-mes--sube-4"],
    [0.0401, "gestor-mes--sube-5"],
    [0.2, "gestor-mes--sube-5"], // tope en el 5 % mensual
    [-0.005, "gestor-mes--baja-1"],
    [-0.025, "gestor-mes--baja-3"],
    [-0.04, "gestor-mes--baja-4"],
    [-0.12, "gestor-mes--baja-5"]
  ])("%s → «%s»", (rentabilidad, clase) => {
    expect(claseDelMes(rentabilidad)).toBe(clase);
  });

  /* El contraste de la cifra sobre su fondo, con los colores de verdad de `tokens.css` y las mezclas de la hoja. */
  it("la cifra se lee sobre las diez casillas: al menos 4,5:1, con la tinta clara en las dos más fuertes", () => {
    const tokens = readFileSync(new UrlDeNode("../../src/styles/tokens.css", import.meta.url), "utf8");
    const hoja = readFileSync(new UrlDeNode("../../src/styles/gestor-analisis.css", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const token = (nombre: string) => {
      const valor = new RegExp(`--${nombre}:\\s*(#[0-9a-f]{6})`, "i").exec(tokens)?.[1];
      expect(valor, `el token --${nombre}`).toBeDefined();
      return [1, 3, 5].map((i) => parseInt(valor!.slice(i, i + 2), 16));
    };
    const lineal = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luz = (rgb: number[]) => 0.2126 * lineal(rgb[0]) + 0.7152 * lineal(rgb[1]) + 0.0722 * lineal(rgb[2]);
    const contraste = (a: number[], b: number[]) => {
      const [claro, oscuro] = [luz(a), luz(b)].sort((x, y) => y - x);
      return (claro + 0.05) / (oscuro + 0.05);
    };
    const papel = token("papel");
    for (const signo of ["sube", "baja"]) {
      const base = token(signo);
      for (let nivel = 1; nivel <= 5; nivel++) {
        const regla = new RegExp(`\\n\\.gestor-mes--${signo}-${nivel} \\{([^}]*)\\}`).exec(hoja)?.[1];
        expect(regla, `la regla de gestor-mes--${signo}-${nivel}`).toBeDefined();
        /* Mezcla en sRGB, como `color-mix(in srgb, …)`: canal a canal sobre los valores sin linealizar. Las claras se
           mezclan con el papel; la más fuerte, con la tinta. */
        const mezcla = /color-mix\(in srgb, var\(--(sube|baja)\) (\d+)%, var\(--(papel|tinta)\)\)/.exec(regla!);
        const parte = mezcla ? Number(mezcla[2]) / 100 : new RegExp(`background: var\\(--${signo}\\);`).test(regla!) ? 1 : NaN;
        expect(parte, `el fondo de gestor-mes--${signo}-${nivel}`).not.toBeNaN();
        if (mezcla) expect(mezcla[1]).toBe(signo);
        const otro = mezcla?.[3] === "tinta" ? token("tinta") : papel;
        const fondo = base.map((canal, i) => canal * parte + otro[i] * (1 - parte));
        const clara = /color: var\(--tinta-inversa\)/.test(regla!);
        expect(clara, `la tinta clara solo en los niveles 4 y 5 (${signo}-${nivel})`).toBe(nivel >= 4);
        const tinta = token(clara ? "tinta-inversa" : "tinta");
        expect(contraste(tinta, fondo), `contraste de gestor-mes--${signo}-${nivel}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    /* Las dos de antes, con un solo fondo por signo, ya no existen. */
    expect(hoja).not.toMatch(/\.gestor-mes--(sube|baja) \{/);
  });

  it("en pantalla, cada casilla lleva la clase de su mes", async () => {
    const datos = datosDeLaDemo();
    window.history.replaceState(null, "", "/cartera-real#pestana=analisis");
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    const tabla = panel(pintado.vista, "Rentabilidad por meses y años");
    let conColor = 0;
    for (const anio of datos.analisis.porMeses) {
      const fila = [...tabla.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("th")?.textContent === String(anio.anio))!;
      const casillas = [...fila.querySelectorAll("td")].slice(0, 12);
      anio.meses.forEach((mes, i) => {
        const esperada = mes ? claseDelMes(mes.rentabilidad) : "";
        expect(casillas[i].className).toBe(`gestor-tabla__cifra gestor-mes${esperada ? ` ${esperada}` : ""}`);
        if (esperada) conColor += 1;
      });
    }
    expect(conColor).toBeGreaterThan(5);
  });
});

describe("el color de la clase de activo", () => {
  it("cada clase, el suyo; «Otros» y «Sin clasificar», apagados", () => {
    expect(colorDeLaParteDeClase("Renta variable")).toEqual({ color: colorDeLaClasePorNombre("Renta variable") });
    expect(colorDeLaParteDeClase("Liquidez")).toEqual({ color: colorDeLaClasePorNombre("Liquidez") });
    expect(colorDeLaParteDeClase("Renta variable").color).not.toBe(colorDeLaParteDeClase("Renta fija").color);
    expect(colorDeLaParteDeClase("Otros")).toEqual({ apagada: true });
    expect(colorDeLaParteDeClase("Sin clasificar")).toEqual({ apagada: true });
  });

  const comprobarLista = (lista: Element) => {
    const partes = [...lista.querySelectorAll("li")];
    expect(partes.length).toBeGreaterThan(1);
    for (const parte of partes) {
      const nombre = parte.querySelector(".partes__nombre")!.firstChild!.textContent ?? "";
      const { color, apagada } = colorDeLaParteDeClase(nombre);
      if (apagada) {
        expect(parte.className).toBe("partes__parte partes__parte--apagada");
      } else {
        expect((parte as HTMLElement).style.getPropertyValue("--parte-color")).toBe(color);
      }
    }
  };

  it("«En qué está invertida», en el Resumen", async () => {
    pintado = await pintar(<VistaResumen datos={datosDeLaDemo("anio")} />);
    comprobarLista(panel(pintado.vista, "En qué está invertida").querySelector('ul[aria-label="Por clase de activo"]')!);
    /* Las principales posiciones no son categorías: van en el índigo de la pieza. */
    const posiciones = panel(pintado.vista, "En qué está invertida").querySelector('ul[aria-label="Principales posiciones"]')!;
    for (const parte of posiciones.querySelectorAll("li")) expect((parte as HTMLElement).style.getPropertyValue("--parte-color")).toBe("");
  });

  it("«Por clase de activo», en Análisis → Composición; los demás repartos, sin color de clase", async () => {
    window.history.replaceState(null, "", "/cartera-real#pestana=analisis&vista=composicion");
    pintado = await pintar(<VistaAnalisis datos={datosDeLaDemo()} />);
    const composicion = panel(pintado.vista, "Composición");
    comprobarLista(composicion.querySelector('ul[aria-label="Por clase de activo"]')!);
    for (const parte of composicion.querySelectorAll('ul[aria-label="Por divisa"] li')) {
      expect((parte as HTMLElement).style.getPropertyValue("--parte-color")).toBe("");
    }
  });
});
