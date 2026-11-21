/**
 * Planes de pensiones y EPSV: cómo se escribe cada cifra (decisión D-11).
 *
 * Lo que se vigila: que la cifra de pantalla es la de la base y no otra; que «No aplica» y «Falta el dato» no se
 * confunden —un plan de dos años no tiene rentabilidad a diez, y eso no es un hueco—; que en Modo cliente no se
 * nombra de quién es el dato; y que los avisos dicen la fecha que los causa.
 */
import { describe, expect, test } from "vitest";
import {
  aniosDeHistoria,
  avisoCortoDelPlan,
  avisosDelPlan,
  celdaDeComision,
  celdaDeEstrellas,
  celdaDelValor,
  celdaDeRentabilidad,
  celdaDeVolatilidad,
  lineasDeDatos,
  lineasDelPlan,
  lineasDeRentabilidad,
  lineasDeRiesgo,
  notasDeComparacion,
  notasDeLectura
} from "../src/core/planes/lectura";
import type { PlanDePensiones } from "../src/core/planes/modelo";

/* March Moderado EPSV el 13-11-2026, con las cifras que dio el buscador del banco. */
const EPSV: PlanDePensiones = {
  id: "F00000Q2PL",
  nombre: "March Moderado EPSV",
  tipo: "EPSV",
  empleoSimplificado: false,
  gestora: "March Gestión de Pensiones EGFP",
  categoria: "Mixtos Euros Defensivos PP",
  estrellas: 3,
  estrellasFecha: "2026-10-31",
  fechaInicio: "2013-06-10",
  patrimonio: 14480813,
  aportacionMinima: 0,
  valor: { importe: 12.81215, fecha: "2026-11-10" },
  rentabilidad: { "1m": -0.0009, "6m": 0.0177, ytd: 0.0299, "1y": 0.0303, "3y": 0.0404, "5y": 0.0148, "10y": 0.0154 },
  rentabilidadFecha: "2026-11-10",
  volatilidad: { "1y": 0.031562, "3y": 0.0292779 },
  sharpe: 0.48996,
  alfa: -0.0036,
  beta: 0.62,
  r2: 0.7777,
  ratioDeInformacion: -0.7,
  comisionDeGestion: 0.015,
  consultado: "2026-11-13"
};

const PLAN: PlanDePensiones = {
  id: "F0GBR052AF",
  nombre: "Mundiplan Audaz Global PP",
  tipo: "PENSION_PLAN",
  empleoSimplificado: false,
  codigoDgsfp: "N1981",
  gestora: "AXA Pensiones EGFP",
  categoria: "RV Global PP",
  fechaInicio: "2000-07-14",
  rentabilidad: { "1y": 0.114 },
  rentabilidadFecha: "2026-11-05",
  volatilidad: {},
  valor: { importe: 23.61874, fecha: "2026-11-05" },
  consultado: "2026-11-13"
};

/** Un plan que empezó en mayo de 2026: medio año de historia. */
const NUEVO: PlanDePensiones = { ...PLAN, id: "F0GBR0NUEV", nombre: "Altex Quality A PP", fechaInicio: "2026-05-05", rentabilidad: { "1m": 0.01 }, valor: undefined };

const valorDe = (lineas: ReturnType<typeof lineasDelPlan>, clave: string) => lineas.find((linea) => linea.clave === clave)?.celda;

describe("las cifras, como se escriben", () => {
  test("la rentabilidad, la volatilidad y la comisión son las de la base, en tanto por ciento", () => {
    expect(celdaDeRentabilidad(EPSV, "1y")).toEqual({ texto: "+3,03\u00a0%", valor: 0.0303 });
    expect(celdaDeRentabilidad(EPSV, "1m").texto).toBe("−0,09\u00a0%");
    expect(celdaDeVolatilidad(EPSV, "3y").texto).toBe("2,93\u00a0%");
    expect(celdaDeComision(EPSV).texto).toBe("1,50\u00a0%");
    expect(celdaDeEstrellas(EPSV).texto).toBe("★★★☆☆");
    expect(celdaDelValor(EPSV)).toEqual({ texto: "12,81215\u00a0€", valor: 12.81215, apunte: "10/11/2026" });
  });

  test("los ratios: Sharpe y beta sin unidad; alfa y R², en tanto por ciento", () => {
    const riesgo = lineasDeRiesgo(EPSV);
    expect(valorDe(riesgo, "sharpe-3y")?.texto).toBe("0,49");
    expect(valorDe(riesgo, "alfa-3y")?.texto).toBe("−0,36\u00a0%");
    expect(valorDe(riesgo, "beta-3y")?.texto).toBe("0,62");
    expect(valorDe(riesgo, "r2-3y")?.texto).toBe("77,77\u00a0%");
    expect(valorDe(riesgo, "informacion-3y")?.texto).toBe("−0,70");
  });

  test("un cero es un cero: una aportación mínima de 0 € se escribe", () => {
    expect(valorDe(lineasDeDatos(EPSV, { conProveedor: true }), "minima")).toEqual({ texto: "0,00\u00a0€", valor: 0 });
  });
});

describe("«No aplica» no es «Falta el dato»", () => {
  test("los años de historia salen de la fecha de inicio", () => {
    expect(aniosDeHistoria(EPSV)).toBeGreaterThan(13);
    expect(aniosDeHistoria(NUEVO)).toBeLessThan(1);
    expect(aniosDeHistoria({ consultado: "2026-11-13" })).toBeUndefined();
  });

  test("la historia se mide hasta la fecha de la cifra, no hasta la de la consulta (JUB-9)", () => {
    /* Empezó el 15-10-2023 y se consulta el 13-11-2026: del 15-10-2023 al 15-10-2026 van 1.096 días (2024 es bisiesto) y 29
       más hasta el 13-11, 1.125 / 365,25 = 3,08 años. Pero sus rentabilidades son del 30-09-2026: 1.096 − 15 = 1.081 días,
       2,96 años. A esa fecha no había tres años: la rentabilidad a tres no aplica. Antes se decía que faltaba el dato. */
    const reciente: PlanDePensiones = { ...PLAN, fechaInicio: "2023-10-15", consultado: "2026-11-13", rentabilidadFecha: "2026-09-30", rentabilidad: { "1y": 0.04 } };
    expect(aniosDeHistoria(reciente)).toBeCloseTo(1125 / 365.25, 10);
    expect(aniosDeHistoria(reciente, "2026-09-30")).toBeCloseTo(1081 / 365.25, 10);
    expect(celdaDeRentabilidad(reciente, "3y").ausencia).toBe("no-aplica");
    /* Con las rentabilidades al 10-11-2026 (1.096 + 26 = 1.122 días, 3,07 años) sí debería estar: falta el dato. */
    expect(celdaDeRentabilidad({ ...reciente, rentabilidadFecha: "2026-11-10" }, "3y").ausencia).toBe("falta");
    /* Sin fecha de las rentabilidades vale la de la consulta, como antes. */
    expect(celdaDeRentabilidad({ ...reciente, rentabilidadFecha: undefined }, "3y").ausencia).toBe("falta");
    /* Las estrellas, con la suya: a 30-09-2026 no había tres años. */
    expect(celdaDeEstrellas({ ...reciente, estrellas: undefined, estrellasFecha: "2026-09-30" }).ausencia).toBe("no-aplica");
    expect(celdaDeEstrellas({ ...reciente, estrellas: undefined, estrellasFecha: undefined }).ausencia).toBe("falta");
  });

  test("a un plan de medio año no le falta la rentabilidad a tres: no aplica", () => {
    expect(celdaDeRentabilidad(NUEVO, "3y").ausencia).toBe("no-aplica");
    expect(celdaDeRentabilidad(NUEVO, "1y").ausencia).toBe("no-aplica");
    expect(celdaDeVolatilidad(NUEVO, "3y").ausencia).toBe("no-aplica");
    expect(celdaDeEstrellas(NUEVO).ausencia).toBe("no-aplica");
    /* El año en curso y los meses sueltos no piden años de historia: si no están, faltan. */
    expect(celdaDeRentabilidad(NUEVO, "ytd").ausencia).toBe("falta");
  });

  test("a un plan de veintiséis años sin esa cifra sí le falta", () => {
    expect(celdaDeRentabilidad(PLAN, "10y")).toEqual({ texto: "Falta el dato", ausencia: "falta" });
    expect(celdaDeRentabilidad(PLAN, "10y", true).texto).toBe("Falta");
    expect(celdaDeVolatilidad(PLAN, "3y").ausencia).toBe("falta");
    expect(celdaDeEstrellas(PLAN).ausencia).toBe("falta");
  });

  test("sin fecha de inicio no se sabe, y entonces falta", () => {
    expect(celdaDeRentabilidad({ ...NUEVO, fechaInicio: undefined }, "3y").ausencia).toBe("falta");
  });

  test("la comisión que el banco no publica falta: no se rellena con otra", () => {
    expect(celdaDeComision(PLAN)).toEqual({ texto: "Falta el dato", ausencia: "falta" });
  });

  test("una EPSV no tiene código de la DGSFP: la casilla está cerrada, no vacía", () => {
    expect(valorDe(lineasDeDatos(EPSV, { conProveedor: true }), "dgsfp")?.ausencia).toBe("no-aplica");
    expect(valorDe(lineasDeDatos(PLAN, { conProveedor: true }), "dgsfp")?.texto).toBe("N1981");
  });
});

describe("las líneas de la ficha y de la comparación son las mismas", () => {
  test("todos los planes dan las mismas líneas y en el mismo orden", () => {
    const claves = (plan: PlanDePensiones) => lineasDelPlan(plan, { conProveedor: true }).map((linea) => linea.clave);
    expect(claves(EPSV)).toEqual(claves(PLAN));
    expect(claves(EPSV)).toEqual(claves(NUEVO));
    expect(claves(EPSV).slice(0, 2)).toEqual(["tipo", "dgsfp"]);
  });

  test("la primera línea dice qué es, y la fecha de las rentabilidades es una línea más", () => {
    expect(valorDe(lineasDelPlan(EPSV, { conProveedor: true }), "tipo")?.texto).toBe("Entidad de previsión social voluntaria (EPSV)");
    expect(valorDe(lineasDeRentabilidad(EPSV), "rentabilidad-fecha")?.texto).toBe("10/11/2026");
    expect(lineasDeRentabilidad(EPSV).find((linea) => linea.clave === "rentabilidad-1y")?.rotuloEnSuBloque).toBe("1 año");
  });
});

describe("Modo cliente: no se nombra de quién es el dato", () => {
  const todo = (conProveedor: boolean) =>
    [...lineasDelPlan(EPSV, { conProveedor }).map((linea) => linea.rotulo), ...notasDeLectura({ conProveedor }), ...notasDeComparacion([EPSV, PLAN], { conProveedor })].join(" ");

  test("fuera del modo, se dice: Morningstar y el banco", () => {
    expect(todo(true)).toContain("Morningstar");
    expect(todo(true)).toContain("según el banco");
  });

  test("dentro, ni uno ni otro; las fechas y las salvedades se quedan", () => {
    expect(todo(false)).not.toMatch(/Morningstar|el banco/);
    expect(todo(false)).toContain("Rentabilidades pasadas no garantizan rentabilidades futuras");
    expect(todo(false)).toContain("documento de datos fundamentales");
  });
});

describe("los avisos", () => {
  /* BSG Prometeo PP el 13-11-2026. */
  const parado: PlanDePensiones = { ...PLAN, valor: { importe: 10.5, fecha: "2024-06-05" }, rentabilidadFecha: "2023-12-28" };
  /* Dunas Valor Prudente el 13-11-2026. */
  const atrasado: PlanDePensiones = { ...PLAN, valor: { importe: 10.5, fecha: "2026-11-11" }, rentabilidadFecha: "2026-03-16" };

  test("un plan al día no lleva ninguno", () => {
    expect(avisosDelPlan(EPSV)).toEqual([]);
    expect(avisoCortoDelPlan(EPSV)).toBeUndefined();
  });

  test("un valor parado se dice con su fecha y sus días, y no opina sobre el plan", () => {
    const avisos = avisosDelPlan(parado);
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toContain("05/06/2024");
    expect(avisos[0]).toContain("891 días");
    expect(avisos[1]).toContain("28/12/2023");
    expect(avisoCortoDelPlan(parado)).toBe("Sin valor publicado desde el 05/06/2024: sus cifras no describen el presente.");
  });

  test("unas rentabilidades atrasadas con el valor al día, también", () => {
    const avisos = avisosDelPlan(atrasado);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("16/03/2026");
    expect(avisos[0]).toContain("11/11/2026");
    expect(avisoCortoDelPlan(atrasado)).toContain("16/03/2026");
  });

  test("si el valor y las rentabilidades se pararon el mismo día, se dice una vez", () => {
    expect(avisosDelPlan({ ...parado, rentabilidadFecha: "2024-06-05" })).toHaveLength(1);
  });
});

describe("las notas de una comparación", () => {
  test("plan con EPSV: no tributan igual, y se dice lo primero", () => {
    const notas = notasDeComparacion([EPSV, PLAN], { conProveedor: true });
    expect(notas[0]).toContain("no tributan igual");
    expect(notas.join(" ")).toContain("no son de la misma categoría");
  });

  test("dos planes de la misma clase, categoría y fecha: solo las notas de siempre", () => {
    const otro = { ...PLAN, id: "F0GBR0OTRO", nombre: "Otro PP" };
    expect(notasDeComparacion([PLAN, otro], { conProveedor: true })).toEqual(notasDeLectura({ conProveedor: true }));
  });

  test("fechas de rentabilidad de meses distintos, y el aviso de cada plan con su nombre", () => {
    const atrasado = { ...PLAN, id: "F0GBR0ATRA", nombre: "Dunas Valor Prudente I PP", rentabilidadFecha: "2026-03-16" };
    const notas = notasDeComparacion([PLAN, atrasado], { conProveedor: false }).join(" ");
    expect(notas).toContain("no son todas de la misma fecha");
    expect(notas).toContain("Dunas Valor Prudente I PP. Las rentabilidades son del 16/03/2026");
  });
});
