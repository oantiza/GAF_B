/**
 * La evolución comparada de los planes, en base 100: el único cálculo de Planes y EPSV.
 *
 * Cada cifra esperada sale de una cuenta a mano —valor del mes entre valor del mes base, por cien—, nunca de la salida
 * de la función. Lo que se vigila: que las series se alinean por mes y no por día, que el mes sin acabar no entra, que
 * la base es el primer mes que tienen todos, que un periodo que la historia común no cubre no se ofrece, y que a un
 * plan sin valores en el periodo no se le inventa un tramo.
 */
import { describe, expect, test } from "vitest";
import {
  evolucionComparada,
  finDeMes,
  hayEvolucionPara,
  lineasQueAcabanAntes,
  mesMas,
  nombreDelMes,
  ultimoLaborableDelMes,
  ultimoMesCerrado,
  type PlanParaComparar
} from "../src/core/planes/evolucionComparada";
import type { SerieDelPlan } from "../src/core/planes/modelo";

const serie = (puntos: Array<[string, number]>): SerieDelPlan => ({
  desde: puntos[0][0],
  hasta: puntos[puntos.length - 1][0],
  puntos: puntos.map(([fecha, valor]) => ({ fecha, valor }))
});

/** Consultado el 13 de noviembre de 2026: noviembre no ha acabado, así que el último mes entero es octubre. */
const CONSULTADO = "2026-11-13";

/* A publica el 31 de agosto, el 30 de septiembre y el 30 de octubre; B, el 29 de septiembre y el 31 de octubre. */
const A: PlanParaComparar = {
  id: "A",
  nombre: "Plan A",
  serie: serie([
    ["2026-08-31", 10],
    ["2026-09-30", 11],
    ["2026-10-30", 12.1],
    ["2026-11-10", 12.5]
  ])
};
const B: PlanParaComparar = {
  id: "B",
  nombre: "Plan B",
  serie: serie([
    ["2026-09-29", 200],
    ["2026-10-31", 210],
    ["2026-11-05", 230]
  ])
};

describe("el calendario", () => {
  test("los meses se suman y se restan cruzando el año", () => {
    expect(mesMas("2026-10", -12)).toBe("2025-10");
    expect(mesMas("2026-01", -1)).toBe("2025-12");
    expect(mesMas("2025-12", 1)).toBe("2026-01");
    expect(mesMas("2026-10", -120)).toBe("2016-10");
  });

  test("el último día de cada mes, con su bisiesto", () => {
    expect(finDeMes("2026-10")).toBe("2026-10-31");
    expect(finDeMes("2026-09")).toBe("2026-09-30");
    expect(finDeMes("2024-02")).toBe("2024-02-29");
    expect(finDeMes("2026-02")).toBe("2026-02-28");
  });

  test("el mes de la consulta no ha acabado: el último entero es el anterior", () => {
    expect(ultimoMesCerrado("2026-11-13")).toBe("2026-10");
    expect(ultimoMesCerrado("2026-01-02")).toBe("2025-12");
    expect(nombreDelMes("2026-10")).toBe("octubre de 2026");
  });
});

describe("dos planes en base 100", () => {
  const evolucion = evolucionComparada([A, B], "todo", CONSULTADO);

  test("la base es el primer mes que tienen los dos, y ahí los dos valen 100", () => {
    /* A tiene agosto y B no: el primer mes común es septiembre. */
    expect(evolucion.mesBase).toBe("2026-09");
    expect(evolucion.lineas.map((linea) => linea.puntos[0])).toEqual([
      { mes: "2026-09", fecha: "2026-09-30", valor: 100 },
      { mes: "2026-09", fecha: "2026-09-30", valor: 100 }
    ]);
  });

  test("cada punto es su valor entre el del mes base, por cien", () => {
    const [a, b] = evolucion.lineas;
    /* A: 12,1 / 11 × 100 = 110. B: 210 / 200 × 100 = 105. */
    expect(a.puntos[1].valor).toBeCloseTo(110, 10);
    expect(b.puntos[1].valor).toBeCloseTo(105, 10);
  });

  test("se alinean por mes: el 30 y el 31 de octubre son el mismo punto del gráfico", () => {
    expect(evolucion.lineas.map((linea) => linea.puntos.map((punto) => punto.fecha))).toEqual([
      ["2026-09-30", "2026-10-31"],
      ["2026-09-30", "2026-10-31"]
    ]);
  });

  test("noviembre no entra: un plan tendría su valor del día 10 y el otro el del 5", () => {
    expect(evolucion.mesFinal).toBe("2026-10");
    expect(evolucion.lineas.flatMap((linea) => linea.puntos.map((punto) => punto.mes))).not.toContain("2026-11");
  });

  test("lo anterior a la base no se dibuja: agosto de A queda fuera", () => {
    expect(evolucion.lineas[0].puntos.map((punto) => punto.mes)).toEqual(["2026-09", "2026-10"]);
    expect(evolucion.fuera).toEqual([]);
  });
});

describe("los periodos", () => {
  const meses = (desde: string, cuantos: number, valor: (i: number) => number): Array<[string, number]> =>
    Array.from({ length: cuantos }, (_, i) => [finDeMes(mesMas(desde, i)), valor(i)] as [string, number]);

  /* Largo: de octubre de 2021 a octubre de 2026, 61 meses, sube 1 al mes desde 100. Corto: de octubre de 2024, 25 meses, desde 50. */
  const largo: PlanParaComparar = { id: "L", nombre: "Largo", serie: serie(meses("2021-10", 61, (i) => 100 + i)) };
  const corto: PlanParaComparar = { id: "C", nombre: "Corto", serie: serie(meses("2024-10", 25, (i) => 50 + i)) };

  test("a un año, la base es el mismo mes del año anterior", () => {
    const evolucion = evolucionComparada([largo, corto], "1y", CONSULTADO);
    expect(evolucion.mesBase).toBe("2025-10");
    expect(evolucion.lineas[0].puntos).toHaveLength(13);
    /* Largo vale 148 en octubre de 2025 y 160 en octubre de 2026: 160 / 148 × 100 = 108,108… */
    expect(evolucion.lineas[0].puntos.at(-1)?.valor).toBeCloseTo(108.1081, 4);
    /* Corto vale 62 y 74: 74 / 62 × 100 = 119,354… */
    expect(evolucion.lineas[1].puntos.at(-1)?.valor).toBeCloseTo(119.3548, 4);
  });

  test("«todo» empieza donde empieza el más joven", () => {
    const evolucion = evolucionComparada([largo, corto], "todo", CONSULTADO);
    expect(evolucion.mesBase).toBe("2024-10");
    /* Largo vale 136 en octubre de 2024: 160 / 136 × 100 = 117,647… */
    expect(evolucion.lineas[0].puntos.at(-1)?.valor).toBeCloseTo(117.6471, 4);
  });

  test("un periodo que la historia común no cubre no se ofrece", () => {
    const hay = (periodo: Parameters<typeof hayEvolucionPara>[1]) => hayEvolucionPara([largo, corto], periodo, CONSULTADO);
    expect(hay("1y")).toBe(true);
    /* Corto tiene dos años justos: tres no. */
    expect(hay("3y")).toBe(false);
    expect(hay("5y")).toBe(false);
    expect(hay("todo")).toBe(true);
    /* Con dos planes largos sí hay cinco años; diez, no. */
    expect(hayEvolucionPara([largo, { ...largo, id: "L2" }], "5y", CONSULTADO)).toBe(true);
    expect(hayEvolucionPara([largo, { ...largo, id: "L2" }], "10y", CONSULTADO)).toBe(false);
  });
});

describe("JUB-9 · un mes solo cuenta si el plan lo cerró", () => {
  test("el último día laborable de cada mes", () => {
    /* El 31 de octubre de 2026 es sábado: el último laborable es el viernes 30. */
    expect(ultimoLaborableDelMes("2026-10")).toBe("2026-10-30");
    /* El 30 de septiembre de 2026 es miércoles. */
    expect(ultimoLaborableDelMes("2026-09")).toBe("2026-09-30");
    /* El 31 de mayo de 2026 es domingo: el viernes 29. */
    expect(ultimoLaborableDelMes("2026-05")).toBe("2026-05-29");
    /* El 30 de junio de 2024 es domingo: el viernes 28. */
    expect(ultimoLaborableDelMes("2024-06")).toBe("2024-06-28");
  });

  /* Atrasado: su serie se queda en el 12 de octubre de 2026. Se consulta el 13 de noviembre, con octubre ya acabado. */
  const atrasado: PlanParaComparar = {
    id: "T",
    nombre: "Atrasado",
    serie: serie([
      ["2026-08-31", 50],
      ["2026-09-30", 55],
      ["2026-10-12", 66]
    ])
  };

  test("un plan cuya serie se queda a mitad de octubre no tiene octubre: su línea acaba en septiembre", () => {
    const evolucion = evolucionComparada([A, atrasado], "todo", CONSULTADO);
    expect(evolucion.mesBase).toBe("2026-08");
    const [a, t] = evolucion.lineas;
    /* A sí cerró octubre: 12,1 / 10 × 100 = 121. */
    expect(a.puntos.map((punto) => punto.mes)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(a.puntos.at(-1)?.valor).toBeCloseTo(121, 10);
    /* El atrasado acaba en septiembre: 55 / 50 × 100 = 110. Antes llevaba octubre a 66 / 50 × 100 = 132, con el valor del día 12. */
    expect(t.puntos.map((punto) => punto.mes)).toEqual(["2026-08", "2026-09"]);
    expect(t.puntos.at(-1)?.valor).toBeCloseTo(110, 10);
    /* Y se dice que acaba antes, como de cualquier línea corta. */
    expect(lineasQueAcabanAntes(evolucion)).toEqual([{ id: "T", nombre: "Atrasado", ultimoMes: "2026-09" }]);
  });

  test("si su último valor es del último día laborable, el mes cuenta aunque la serie no siga", () => {
    const justo: PlanParaComparar = { id: "J", nombre: "Justo", serie: serie([["2026-09-30", 40], ["2026-10-30", 42]]) };
    const evolucion = evolucionComparada([A, justo], "todo", CONSULTADO);
    /* 42 / 40 × 100 = 105. */
    expect(evolucion.lineas[1].puntos.map((punto) => punto.mes)).toEqual(["2026-09", "2026-10"]);
    expect(evolucion.lineas[1].puntos.at(-1)?.valor).toBeCloseTo(105, 10);
  });

  test("y si la serie sigue en el mes siguiente, también: ese valor fue el último de su mes", () => {
    /* Último de octubre, el día 27; pero hay valor del 3 de noviembre: octubre está cerrado para él. 63 / 60 × 100 = 105. */
    const conHueco: PlanParaComparar = { id: "H", nombre: "Con hueco", serie: serie([["2026-09-30", 60], ["2026-10-27", 63], ["2026-11-03", 64]]) };
    const evolucion = evolucionComparada([A, conHueco], "todo", CONSULTADO);
    expect(evolucion.lineas[1].puntos.map((punto) => punto.mes)).toEqual(["2026-09", "2026-10"]);
    expect(evolucion.lineas[1].puntos.at(-1)?.valor).toBeCloseTo(105, 10);
  });
});

describe("lo que no se dibuja, se nombra", () => {
  /* Parado: dejó de publicar en junio de 2024, como BSG Prometeo. */
  const parado: PlanParaComparar = {
    id: "P",
    nombre: "Parado",
    serie: serie([
      ["2024-04-30", 10],
      ["2024-05-31", 10.5],
      ["2024-06-05", 10.6]
    ])
  };
  const vivo: PlanParaComparar = {
    id: "V",
    nombre: "Vivo",
    serie: serie([
      ["2024-04-30", 20],
      ["2024-05-31", 21],
      ["2024-06-28", 22],
      ["2026-09-30", 30],
      ["2026-10-30", 33]
    ])
  };

  test("un plan parado se dibuja hasta su último mes cerrado, y su línea acaba ahí", () => {
    const evolucion = evolucionComparada([vivo, parado], "todo", CONSULTADO);
    expect(evolucion.mesBase).toBe("2024-04");
    /* JUB-9: su último valor es del 5 de junio de 2024. Junio no lo cerró —el último día laborable fue el viernes 28—, así
       que no entra como si fuera su valor de fin de mes: la línea acaba en mayo. Antes acababa en junio, con el del día 5. */
    expect(evolucion.lineas[1].puntos.map((punto) => punto.mes)).toEqual(["2024-04", "2024-05"]);
    /* Mayo: 10,5 / 10 × 100 = 105. */
    expect(evolucion.lineas[1].puntos.at(-1)?.valor).toBeCloseTo(105, 10);
    expect(evolucion.mesFinal).toBe("2026-10");
  });

  test("y se dice cuál acaba antes y en qué mes; el que llega al final no se nombra", () => {
    const evolucion = evolucionComparada([vivo, parado], "todo", CONSULTADO);
    expect(lineasQueAcabanAntes(evolucion)).toEqual([{ id: "P", nombre: "Parado", ultimoMes: "2024-05" }]);
    expect(lineasQueAcabanAntes(evolucionComparada([A, B], "todo", CONSULTADO))).toEqual([]);
  });

  test("un mes que un plan no publicó es un hueco, no un punto inventado", () => {
    const evolucion = evolucionComparada([vivo, parado], "todo", CONSULTADO);
    const mesesDelVivo = evolucion.lineas[0].puntos.map((punto) => punto.mes);
    expect(mesesDelVivo).toEqual(["2024-04", "2024-05", "2024-06", "2026-09", "2026-10"]);
  });

  test("en el último año el parado no tiene valores: no se dibuja, y con uno solo no hay gráfico", () => {
    const evolucion = evolucionComparada([vivo, parado], "1y", CONSULTADO);
    expect(evolucion.lineas).toEqual([]);
    expect(evolucion.mesBase).toBeUndefined();
    expect(evolucion.fuera).toEqual([{ id: "P", nombre: "Parado", motivo: "no tiene valores en este periodo" }]);
    expect(hayEvolucionPara([vivo, parado], "1y", CONSULTADO)).toBe(false);
  });

  test("un plan sin serie se nombra y los demás se dibujan", () => {
    const evolucion = evolucionComparada([A, B, { id: "S", nombre: "Sin serie", serie: undefined }], "todo", CONSULTADO);
    expect(evolucion.lineas.map((linea) => linea.id)).toEqual(["A", "B"]);
    expect(evolucion.fuera).toEqual([{ id: "S", nombre: "Sin serie", motivo: "no tiene serie" }]);
  });

  test("con tres, si uno no coincide en el tiempo con los demás, se dibujan los que sí y se nombra el que queda fuera (PLA-07)", () => {
    /* C dejó de publicar en junio de 2024, antes de que A y B tuvieran valor: no comparte ningún mes con ninguno. */
    const C: PlanParaComparar = { id: "C", nombre: "Plan C", serie: serie([["2024-04-30", 10], ["2024-05-31", 10.5], ["2024-06-05", 10.6]]) };
    const evolucion = evolucionComparada([A, B, C], "todo", CONSULTADO);
    /* La regla no cambia entre los que entran: base en el primer mes que tienen A y B, septiembre. */
    expect(evolucion.mesBase).toBe("2026-09");
    expect(evolucion.lineas.map((linea) => linea.id)).toEqual(["A", "B"]);
    /* A: 12,1 / 11 × 100 = 110. B: 210 / 200 × 100 = 105. */
    expect(evolucion.lineas[0].puntos.at(-1)?.valor).toBeCloseTo(110, 10);
    expect(evolucion.lineas[1].puntos.at(-1)?.valor).toBeCloseTo(105, 10);
    expect(evolucion.fuera).toEqual([{ id: "C", nombre: "Plan C", motivo: "no tiene ningún mes con valor en común con los demás" }]);
    expect(hayEvolucionPara([A, B, C], "todo", CONSULTADO)).toBe(true);
  });

  test("si dos grupos igual de grandes coinciden, entra el que llega más tarde: el que dejó de publicar es el que sobra", () => {
    /* Vivo comparte abril-junio de 2024 con Parado, y septiembre-octubre de 2026 con B; Parado y B no comparten nada. */
    const vivo: PlanParaComparar = {
      id: "V",
      nombre: "Vivo",
      serie: serie([["2024-04-30", 20], ["2024-05-31", 21], ["2024-06-28", 22], ["2026-09-30", 30], ["2026-10-30", 33]])
    };
    const parado: PlanParaComparar = { id: "P", nombre: "Parado", serie: serie([["2024-04-30", 10], ["2024-05-31", 10.5], ["2024-06-05", 10.6]]) };
    const evolucion = evolucionComparada([vivo, parado, B], "todo", CONSULTADO);
    expect(evolucion.lineas.map((linea) => linea.id)).toEqual(["V", "B"]);
    expect(evolucion.mesBase).toBe("2026-09");
    /* Vivo: 33 / 30 × 100 = 110. B: 210 / 200 × 100 = 105. */
    expect(evolucion.lineas[0].puntos.at(-1)?.valor).toBeCloseTo(110, 10);
    expect(evolucion.lineas[1].puntos.at(-1)?.valor).toBeCloseTo(105, 10);
    expect(evolucion.fuera.map((plan) => plan.id)).toEqual(["P"]);
  });

  test("dos planes que no coinciden en ningún mes no tienen base común", () => {
    const antiguo: PlanParaComparar = { id: "X", nombre: "Antiguo", serie: serie([["2020-01-31", 5], ["2020-02-28", 6]]) };
    const evolucion = evolucionComparada([antiguo, B], "todo", CONSULTADO);
    expect(evolucion.lineas).toEqual([]);
    expect(evolucion.mesBase).toBeUndefined();
  });
});
