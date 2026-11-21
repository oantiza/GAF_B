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
    const anchos = [...vista.host.querySelectorAll<HTMLElement>(".partes__barra")].map((barra) => barra.style.width);
    expect(anchos).toEqual(["54%", "100%", "0%", "0%"]);
    expect(vista.host.querySelectorAll("li")[3].querySelector(".ausencia--falta")?.textContent).toBe("Falta el dato");
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
