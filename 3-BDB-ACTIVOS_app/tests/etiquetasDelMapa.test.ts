/**
 * Los nombres de los puntos de un mapa no se pisan entre sí.
 *
 * En Análisis, «Frente a la referencia», la cartera cae casi encima de la cartera de referencia que más se le parece. Los
 * dos nombres se escribían a la derecha de su punto, uno sobre el otro, y no se leía ninguno. Las cajas se comprueban
 * aquí con las mismas medidas que usa la colocación: 10 px sobre la línea base y 3 por debajo.
 */
import { describe, expect, test } from "vitest";
import { colocarNombres, type NombreColocado, type PuntoConNombre } from "../src/charts/oaa/etiquetasDelMapa";

const AREA = { x: 60, y: 10, width: 800, height: 240 };

function caja(nombre: NombreColocado, ancho: number) {
  const izquierda = nombre.ancla === "start" ? nombre.x : nombre.ancla === "end" ? nombre.x - ancho : nombre.x - ancho / 2;
  return { izquierda, derecha: izquierda + ancho, arriba: nombre.y - 10, abajo: nombre.y + 3 };
}

function sePisan(a: ReturnType<typeof caja>, b: ReturnType<typeof caja>): boolean {
  return Math.min(a.derecha, b.derecha) > Math.max(a.izquierda, b.izquierda) && Math.min(a.abajo, b.abajo) > Math.max(a.arriba, b.arriba);
}

describe("los nombres de los puntos de un mapa", () => {
  test("un punto solo lleva su nombre a la derecha, a la altura de su centro", () => {
    const [nombre] = colocarNombres([{ id: "a", x: 200, y: 100, radio: 6, ancho: 80, prioridad: 1 }], AREA);
    /* A mano: 200 + 6 de radio + 5 de aire = 211, y la línea base 4 px bajo el centro. */
    expect(nombre).toEqual({ id: "a", x: 211, y: 104, ancla: "start" });
  });

  test("pegado al borde derecho, a la izquierda: a la derecha se saldría", () => {
    const [nombre] = colocarNombres([{ id: "a", x: 840, y: 100, radio: 6, ancho: 80, prioridad: 1 }], AREA);
    expect(nombre).toEqual({ id: "a", x: 829, y: 104, ancla: "end" });
  });

  test("la cartera pegada a una cartera de referencia: se leen los dos nombres", () => {
    /* El caso de la pantalla: la cartera a 14 px de «Equilibrado», casi a la misma altura. */
    const puntos: PuntoConNombre[] = [
      { id: "equilibrado", x: 400, y: 100, radio: 6.5, ancho: 76, prioridad: 46 },
      { id: "cartera", x: 414, y: 100, radio: 6, ancho: 131, prioridad: 92 }
    ];
    const [equilibrado, cartera] = colocarNombres(puntos, AREA);
    /* La cartera elige la primera y se queda a su derecha. */
    expect(cartera).toEqual({ id: "cartera", x: 425, y: 104, ancla: "start" });
    /* «Equilibrado» no cabe a la derecha (ahí están el punto y el nombre de la cartera): se va a la izquierda. */
    expect(equilibrado.ancla).toBe("end");
    expect(sePisan(caja(equilibrado, 76), caja(cartera, 131))).toBe(false);
  });

  test("ningún nombre tapa el punto de otro", () => {
    const puntos: PuntoConNombre[] = [
      { id: "a", x: 300, y: 100, radio: 6, ancho: 90, prioridad: 2 },
      { id: "b", x: 340, y: 102, radio: 6, ancho: 60, prioridad: 1 }
    ];
    const [a] = colocarNombres(puntos, AREA);
    /* A la derecha de «a» está el punto «b», a 40 px: su nombre, de 90, lo taparía. Se va a la izquierda. */
    expect(a.ancla).toBe("end");
  });

  test("un punto sin nombre también ocupa su sitio", () => {
    const [nombre] = colocarNombres([{ id: "a", x: 300, y: 100, radio: 6, ancho: 90, prioridad: 1 }], AREA, [{ x: 330, y: 100, radio: 4 }]);
    expect(nombre.ancla).toBe("end");
  });

  test("con los dos lados ocupados, encima; y con encima ocupado, debajo", () => {
    const vecinos = [
      { x: 270, y: 100, radio: 6 },
      { x: 330, y: 100, radio: 6 }
    ];
    const [encima] = colocarNombres([{ id: "a", x: 300, y: 100, radio: 6, ancho: 90, prioridad: 1 }], AREA, vecinos);
    /* A mano: centrado en el punto, con la línea base 6 de radio + 5 de aire por encima del centro. */
    expect(encima).toEqual({ id: "a", x: 300, y: 89, ancla: "middle" });
    const [debajo] = colocarNombres([{ id: "a", x: 300, y: 100, radio: 6, ancho: 90, prioridad: 1 }], AREA, [...vecinos, { x: 300, y: 82, radio: 6 }]);
    /* Debajo: el centro, más el radio, el aire y lo que sube la letra (10) hasta su línea base. */
    expect(debajo).toEqual({ id: "a", x: 300, y: 121, ancla: "middle" });
  });

  test("cinco carteras de referencia en fila y la cartera entre dos: ningún nombre pisa a otro", () => {
    const anchos = [83, 62, 76, 55, 55];
    const puntos: PuntoConNombre[] = [
      ...[120, 230, 400, 600, 790].map((x, indice) => ({ id: `r${indice}`, x, y: 200 - indice * 40, radio: 6.5, ancho: anchos[indice], prioridad: 46 })),
      { id: "cartera", x: 414, y: 118, radio: 6, ancho: 131, prioridad: 92 }
    ];
    const nombres = colocarNombres(puntos, AREA);
    const cajas = nombres.map((nombre, indice) => caja(nombre, puntos[indice].ancho));
    for (let i = 0; i < cajas.length; i += 1) {
      for (let j = i + 1; j < cajas.length; j += 1) expect(sePisan(cajas[i], cajas[j]), `${puntos[i].id} y ${puntos[j].id}`).toBe(false);
      /* Y todos dentro del gráfico. */
      expect(cajas[i].izquierda).toBeGreaterThanOrEqual(AREA.x);
      expect(cajas[i].derecha).toBeLessThanOrEqual(AREA.x + AREA.width);
    }
  });

  test("devuelve los nombres en el orden en que entraron los puntos, aunque coloque antes al de más prioridad", () => {
    const puntos: PuntoConNombre[] = [
      { id: "segundo", x: 100, y: 100, radio: 6, ancho: 40, prioridad: 1 },
      { id: "primero", x: 500, y: 100, radio: 6, ancho: 40, prioridad: 9 }
    ];
    expect(colocarNombres(puntos, AREA).map((nombre) => nombre.id)).toEqual(["segundo", "primero"]);
  });
});
