// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { ListaDePartes } from "../../src/components/ui/ListaDePartes";
import { pintar } from "./pintar";

/**
 * La pieza ListaDePartes: la barra es proporcional a la fracción, «Otros» va en gris, y todo se lee sin la barra:
 * el nombre y la cifra son texto y la barra va oculta al lector de pantalla.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

const N = " ";

describe("la pieza ListaDePartes", () => {
  test("una lista con nombre, y cada parte se lee como texto: nombre y peso", () => {
    const vista = pintar(
      <ListaDePartes
        etiqueta="Por clase de activo"
        partes={[
          { nombre: "Renta variable", fraccion: 0.54 },
          { nombre: "Renta fija", fraccion: 0.3, apunte: "Gobiernos y empresas" },
          { nombre: "Otros", fraccion: 0.07, apagada: true }
        ]}
      />
    );
    quitar = vista.quitar;
    const lista = vista.host.querySelector("ul.partes")!;
    expect(lista.getAttribute("aria-label")).toBe("Por clase de activo");
    expect([...lista.querySelectorAll("li")].map((parte) => parte.textContent)).toEqual([
      `Renta variable54,0${N}%`,
      `Renta fijaGobiernos y empresas30,0${N}%`,
      `Otros7,0${N}%`
    ]);
    for (const carril of lista.querySelectorAll(".partes__carril")) expect(carril.getAttribute("aria-hidden")).toBe("true");
  });

  test("la barra es proporcional a la fracción, y queda dentro del carril", () => {
    const vista = pintar(
      <ListaDePartes
        partes={[
          { nombre: "A", fraccion: 0.54 },
          { nombre: "B", fraccion: 1.4 },
          { nombre: "C", fraccion: -0.1 },
          { nombre: "D", fraccion: null }
        ]}
      />
    );
    quitar = vista.quitar;
    const partes = [...vista.host.querySelectorAll<HTMLElement>("li")];
    /* Lo que no es positivo no lleva barra (C-29, 21-11-2026): su carril queda vacío. Hasta ese día era una barra de ancho 0. */
    const anchos = partes.map((parte) => parte.querySelector<HTMLElement>(".partes__barra")?.style.width ?? null);
    expect(anchos).toEqual(["54%", "100%", null, null]);
    expect(partes.every((parte) => parte.querySelector(".partes__carril") !== null)).toBe(true);
    expect(partes[3].querySelector(".ausencia--falta")?.textContent).toBe("Falta el dato");
  });

  test("C-29: la clase corta de un reparto neto se escribe con su signo y sin barra; la que pasa de 100, tal cual", () => {
    /* ES0137396000 en el canónico del 17-11-2026: 3,198089 + 0,115421 − 2,425742 + 0,112232 = 1. */
    const vista = pintar(
      <ListaDePartes
        partes={[
          { nombre: "Renta variable", fraccion: 3.198089 },
          { nombre: "Renta fija", fraccion: 0.115421 },
          { nombre: "Liquidez", fraccion: -2.425742 },
          { nombre: "Otros", fraccion: 0.112232, apagada: true }
        ]}
      />
    );
    quitar = vista.quitar;
    const partes = [...vista.host.querySelectorAll<HTMLElement>("li")];
    expect(partes.map((parte) => parte.textContent)).toEqual([
      `Renta variable319,8${N}%`,
      `Renta fija11,5${N}%`,
      `Liquidez−242,6${N}%`,
      `Otros11,2${N}%`
    ]);
    expect(partes[2].querySelector(".partes__barra")).toBeNull();
    expect(partes[0].querySelector<HTMLElement>(".partes__barra")?.style.width).toBe("100%");
  });

  test("«Otros» va apagada", () => {
    const vista = pintar(<ListaDePartes partes={[{ nombre: "Otros", fraccion: 0.07, apagada: true }, { nombre: "Renta variable", fraccion: 0.93 }]} />);
    quitar = vista.quitar;
    expect([...vista.host.querySelectorAll("li")].map((parte) => parte.className)).toEqual(["partes__parte partes__parte--apagada", "partes__parte"]);
  });

  /* 14-11-2026 (Óscar: «le faltan colores en general»): una parte puede traer el color de su categoría. */
  test("una parte con color lleva el de su categoría; sin él, el de la pieza; y «Otros» sigue en gris aunque lo traiga", () => {
    const vista = pintar(
      <ListaDePartes
        partes={[
          { nombre: "Renta variable", fraccion: 0.54, color: "#4A5BAC" },
          { nombre: "Renta fija", fraccion: 0.3, color: "#894B21" },
          { nombre: "Sin color", fraccion: 0.1 },
          { nombre: "Otros", fraccion: 0.06, apagada: true, color: "#0A97C1" }
        ]}
      />
    );
    quitar = vista.quitar;
    const colores = [...vista.host.querySelectorAll<HTMLElement>("li")].map((parte) => parte.style.getPropertyValue("--parte-color"));
    expect(colores).toEqual(["#4A5BAC", "#894B21", "", ""]);
  });
});
