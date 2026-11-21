/**
 * El foco del teclado bajo una columna fija (WCAG 2.4.11; dirección A, 18-11-2026): cuánto desplaza la tabla para
 * dejar a la vista lo enfocado. Cada cifra esperada sale de la cuenta a mano que va en su comentario, no de ejecutar
 * la función.
 *
 * El escenario de todas, salvo donde se diga: el contenedor se ve de 100 a 700; la columna fija de la izquierda (el
 * nombre) va de 100 a 300, y la de la derecha (las acciones) de 600 a 700. La zona libre es, pues, de 300 a 600, y el
 * margen, el de la pieza: 8.
 */
import { describe, expect, test } from "vitest";
import { desplazamientoParaElFoco, MARGEN_DEL_FOCO, type Tramo } from "../src/components/tabla/focoBajoColumnaFija";

const vista: Tramo = { left: 100, right: 700 };
const fijasALaIzquierda: Tramo[] = [{ left: 100, right: 300 }];
const fijasALaDerecha: Tramo[] = [{ left: 600, right: 700 }];
const cuanto = (enfocado: Tramo, enCeldaFija = false) =>
  desplazamientoParaElFoco({ enfocado, vista, fijasALaIzquierda, fijasALaDerecha, enCeldaFija });

describe("desplazamientoParaElFoco", () => {
  test("el margen de la pieza es de 8 px", () => {
    expect(MARGEN_DEL_FOCO).toBe(8);
  });

  test("tapado por la izquierda: se desplaza hacia la izquierda lo que asoma bajo el nombre, más el margen", () => {
    // De 280 a 330: 20 px bajo la columna que acaba en 300. 280 − 300 − 8 = −28.
    expect(cuanto({ left: 280, right: 330 })).toBe(-28);
  });

  test("tapado entero por la izquierda (el «1A» de Planes a 768, con Mayús+Tab)", () => {
    // De 200 a 215, del todo bajo el nombre. 200 − 300 − 8 = −108.
    expect(cuanto({ left: 200, right: 215 })).toBe(-108);
  });

  test("tapado por la derecha: se desplaza hacia la derecha lo que asoma bajo las acciones, más el margen", () => {
    // De 580 a 630: 30 px bajo la columna que empieza en 600. 630 − 600 + 8 = 38; su principio queda en 542, libre.
    expect(cuanto({ left: 580, right: 630 })).toBe(38);
  });

  test("más allá del centro de la columna de acciones sigue tapado por la derecha, no por la izquierda", () => {
    // De 660 a 675; el centro de las acciones es 650. 675 − 600 + 8 = 83; su principio queda en 577, libre.
    expect(cuanto({ left: 660, right: 675 })).toBe(83);
  });

  test("fuera de la vista por la derecha: queda junto a las acciones, no bajo ellas", () => {
    // De 750 a 800. 800 − 600 + 8 = 208; su principio queda en 542, libre.
    expect(cuanto({ left: 750, right: 800 })).toBe(208);
  });

  test("lo que no cabe entero en la zona libre se alinea por su principio", () => {
    // De 550 a 900: 350 px en una zona de 300. Traerlo por la derecha (900 − 600 + 8 = 308) dejaría su principio en
    // 242, bajo el nombre; por el principio: 550 − 300 − 8 = 242, y queda en 308.
    expect(cuanto({ left: 550, right: 900 })).toBe(242);
  });

  test("a la vista: no se mueve nada", () => {
    // De 400 a 450, dentro de 300-600.
    expect(cuanto({ left: 400, right: 450 })).toBe(0);
    // Justo en los bordes de la zona libre también se ve entero.
    expect(cuanto({ left: 300, right: 600 })).toBe(0);
  });

  test("dentro de una celda fija: se mueve con ella y nunca queda tapado", () => {
    // El nombre del plan, de 120 a 200, dentro de la columna fija de la izquierda.
    expect(cuanto({ left: 120, right: 200 }, true)).toBe(0);
    // Y el botón de las acciones, de 620 a 690, aunque las otras celdas fijas no lo dejarían en la zona libre.
    expect(cuanto({ left: 620, right: 690 }, true)).toBe(0);
  });

  test("sin columnas fijas no se mueve nada: lo que haga falta lo hace el navegador", () => {
    // De 650 a 750 asoma por la derecha de la vista, pero no hay celda fija que lo tape.
    expect(
      desplazamientoParaElFoco({
        enfocado: { left: 650, right: 750 },
        vista,
        fijasALaIzquierda: [],
        fijasALaDerecha: [],
        enCeldaFija: false
      })
    ).toBe(0);
  });

  test("con una sola columna fija, la otra frontera es el borde de la vista", () => {
    // Solo el nombre (100-300): la zona libre va de 300 a 700. De 690 a 720: 720 − 700 + 8 = 28.
    expect(
      desplazamientoParaElFoco({
        enfocado: { left: 690, right: 720 },
        vista,
        fijasALaIzquierda,
        fijasALaDerecha: [],
        enCeldaFija: false
      })
    ).toBe(28);
  });
});
