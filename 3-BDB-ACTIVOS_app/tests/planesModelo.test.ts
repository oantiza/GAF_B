/**
 * Planes de pensiones y EPSV: el modelo (decisión D-11).
 *
 * Lo que se vigila: que un documento de la base se lee sin inventar nada —lo que no está, no está—, que sin saber si
 * es plan o EPSV no hay plan, que los filtros encuentran lo que un asesor escribiría, y que las tres cosas que cambian
 * cómo se lee una cifra (valor parado, rentabilidades atrasadas, categorías distintas) se detectan con sus fechas.
 *
 * El documento de ejemplo es el de March Moderado EPSV tal como quedó escrito en la base el 13-11-2026.
 */
import { describe, expect, test } from "vitest";
import {
  categoriasDistintas,
  DIAS_PARA_AVISAR,
  diasDeRetrasoDeLaRentabilidad,
  diasEntre,
  diasSinValor,
  direccionDeLaVista,
  fechasDeRentabilidadDispares,
  filtrarPlanes,
  FILTRO_INICIAL,
  hayFiltro,
  hayHistoriaPara,
  MAXIMO_A_COMPARAR,
  nombreDelTipo,
  nombreLargoDelTipo,
  planDeDocumento,
  plegar,
  puntosDelPeriodo,
  serieDeDocumento,
  TODOS,
  valoresDe,
  vistaDeLaDireccion,
  type PlanDePensiones
} from "../src/core/planes/modelo";

const DOCUMENTO_EPSV = {
  plan_id: "F00000Q2PL",
  schema_version: "base-nueva.pension-plan.v2",
  updated_at: "2026-11-13T08:15:05+00:00",
  source: "MORNINGSTAR",
  checked_at: "2026-11-13",
  product_type: "EPSV",
  identity: { name: "March Moderado EPSV", legal_name: "March Moderado EPSV", manager_name: "March Gestión de Pensiones EGFP", currency: "EUR" },
  return_basis: "TOTAL_RETURN",
  provider_category: "Mixtos Euros Defensivos PP",
  star_rating: 3,
  star_rating_as_of: "2026-10-31",
  inception_date: "2013-06-10",
  aum: 14480813,
  minimum_investment: 0,
  nav: { value: 12.81215, date: "2026-11-10" },
  trailing_return: { "1m": -0.0009, "6m": 0.0177, "1y": 0.0303, "3y": 0.0404, "5y": 0.0148, "10y": 0.0154 },
  ytd_return: 0.0299,
  returns_as_of: "2026-11-10",
  volatility: { "1y": 0.031562, "3y": 0.0292779 },
  sharpe: { "3y": 0.48996 },
  provider_alpha: { "3y": -0.0036 },
  beta: { "3y": 0.62 },
  r2: { "3y": 0.7777 },
  information_ratio: { "3y": -0.7 },
  management_fee: 0.015,
  series: { first_date: "2013-06-28", last_date: "2026-11-10", daily_observations: 3429, monthly_points: 162 }
};

const epsv = planDeDocumento("F00000Q2PL", DOCUMENTO_EPSV) as PlanDePensiones;

const plan = (cambios: Partial<PlanDePensiones> = {}): PlanDePensiones => ({
  id: "F0GBR052AF",
  nombre: "Mundiplan Audaz Global PP",
  tipo: "PENSION_PLAN",
  empleoSimplificado: false,
  codigoDgsfp: "N1981",
  gestora: "AXA Pensiones EGFP",
  categoria: "RV Global PP",
  rentabilidad: { "1y": 0.114 },
  rentabilidadFecha: "2026-11-05",
  volatilidad: {},
  valor: { importe: 23.61874, fecha: "2026-11-05" },
  consultado: "2026-11-13",
  ...cambios
});

describe("un documento de la base, como plan", () => {
  test("se lee entero y sin tocar una cifra", () => {
    expect(epsv).toEqual({
      id: "F00000Q2PL",
      nombre: "March Moderado EPSV",
      nombreLegal: "March Moderado EPSV",
      tipo: "EPSV",
      empleoSimplificado: false,
      codigoDgsfp: undefined,
      gestora: "March Gestión de Pensiones EGFP",
      divisa: "EUR",
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
      serie: { desde: "2013-06-28", hasta: "2026-11-10", puntosDiarios: 3429, puntosMensuales: 162 },
      consultado: "2026-11-13"
    });
  });

  test("lo que el documento no trae no aparece: ni cero ni relleno", () => {
    const corto = planDeDocumento("F0GBR052AF", {
      checked_at: "2026-11-13",
      product_type: "PENSION_PLAN",
      modality: "SIMPLIFIED_EMPLOYMENT",
      dgsfp_code: "N1981",
      identity: { name: "Un plan PPES" }
    }) as PlanDePensiones;
    expect(corto.tipo).toBe("PENSION_PLAN");
    expect(corto.empleoSimplificado).toBe(true);
    expect(corto.rentabilidad).toEqual({});
    expect(corto.volatilidad).toEqual({});
    for (const campo of ["estrellas", "valor", "sharpe", "comisionDeGestion", "serie", "patrimonio", "rentabilidadFecha"] as const) {
      expect(corto[campo], campo).toBeUndefined();
    }
  });

  test("sin nombre, sin saber si es plan o EPSV, o sin fecha de consulta, no hay plan", () => {
    expect(planDeDocumento("F00000Q2PL", { ...DOCUMENTO_EPSV, product_type: undefined })).toBeUndefined();
    expect(planDeDocumento("F00000Q2PL", { ...DOCUMENTO_EPSV, product_type: "FONDO" })).toBeUndefined();
    expect(planDeDocumento("F00000Q2PL", { ...DOCUMENTO_EPSV, identity: {} })).toBeUndefined();
    expect(planDeDocumento("F00000Q2PL", { ...DOCUMENTO_EPSV, checked_at: undefined })).toBeUndefined();
  });

  test("un valor sin fecha no es un valor, y unas estrellas fuera de 1 a 5 no son estrellas", () => {
    expect(planDeDocumento("F00000Q2PL", { ...DOCUMENTO_EPSV, nav: { value: 12.8 } })?.valor).toBeUndefined();
    expect(planDeDocumento("F00000Q2PL", { ...DOCUMENTO_EPSV, star_rating: 0 })?.estrellas).toBeUndefined();
  });

  test("el tipo se dice con todas sus letras", () => {
    expect(nombreDelTipo("EPSV")).toBe("EPSV");
    expect(nombreDelTipo("PENSION_PLAN")).toBe("Plan de pensiones");
    expect(nombreLargoDelTipo(epsv)).toBe("Entidad de previsión social voluntaria (EPSV)");
    expect(nombreLargoDelTipo(plan({ empleoSimplificado: true }))).toBe("Plan de pensiones de empleo simplificado");
  });
});

describe("la serie mensual", () => {
  const serie = serieDeDocumento({
    points: [
      { date: "2026-10-30", value: 12.82 },
      { date: "2023-11-30", value: 11.4 },
      { date: "2026-11-10", value: 12.812 },
      { date: "mal", value: 3 },
      { date: "2026-09-30", value: -1 }
    ]
  });

  test("sale en orden y sin los puntos que no son puntos", () => {
    expect(serie?.puntos.map((p) => p.fecha)).toEqual(["2023-11-30", "2026-10-30", "2026-11-10"]);
    expect(serie?.desde).toBe("2023-11-30");
    expect(serie?.hasta).toBe("2026-11-10");
    expect(serieDeDocumento({ points: [] })).toBeUndefined();
    expect(serieDeDocumento({})).toBeUndefined();
  });

  test("un periodo elige puntos, no calcula: los valores son los mismos", () => {
    if (!serie) throw new Error("falta la serie");
    expect(puntosDelPeriodo(serie, "todo")).toHaveLength(3);
    expect(puntosDelPeriodo(serie, "1y")).toEqual([
      { fecha: "2026-10-30", valor: 12.82 },
      { fecha: "2026-11-10", valor: 12.812 }
    ]);
    /* La serie empieza el 30-11-2023: no hay tres años enteros hasta el 10-11-2026, ni cinco. */
    expect(hayHistoriaPara(serie, "1y")).toBe(true);
    expect(hayHistoriaPara(serie, "3y")).toBe(false);
    expect(hayHistoriaPara(serie, "todo")).toBe(true);
  });
});

describe("la lista y sus filtros", () => {
  const planes = [epsv, plan(), plan({ id: "F0GBR0AAAA", nombre: "Renta 4 Autónomos RV PPES", empleoSimplificado: true, gestora: "Renta 4 Pensiones EGFP", codigoDgsfp: "N5432" })];

  test("por producto: planes de pensiones o EPSV", () => {
    expect(filtrarPlanes(planes, { ...FILTRO_INICIAL, tipo: "EPSV" }).map((p) => p.id)).toEqual(["F00000Q2PL"]);
    expect(filtrarPlanes(planes, { ...FILTRO_INICIAL, tipo: "PENSION_PLAN" })).toHaveLength(2);
    expect(filtrarPlanes(planes, FILTRO_INICIAL)).toHaveLength(3);
  });

  test("la búsqueda no distingue tildes ni mayúsculas y mira nombre, gestora, categoría y código", () => {
    const buscar = (busqueda: string) => filtrarPlanes(planes, { ...FILTRO_INICIAL, busqueda }).map((p) => p.nombre);
    expect(buscar("autonomos")).toEqual(["Renta 4 Autónomos RV PPES"]);
    expect(buscar("GESTION march")).toEqual(["March Moderado EPSV"]);
    expect(buscar("n1981")).toEqual(["Mundiplan Audaz Global PP"]);
    expect(buscar("rv global")).toHaveLength(2);
    expect(buscar("no existe")).toEqual([]);
    expect(plegar("  Previsión ")).toBe("prevision");
  });

  test("categoría y gestora, y saber si hay algo filtrado", () => {
    expect(filtrarPlanes(planes, { ...FILTRO_INICIAL, categoria: "RV Global PP" })).toHaveLength(2);
    expect(filtrarPlanes(planes, { ...FILTRO_INICIAL, gestora: "AXA Pensiones EGFP" })).toHaveLength(1);
    expect(valoresDe(planes, "gestora")).toEqual(["AXA Pensiones EGFP", "March Gestión de Pensiones EGFP", "Renta 4 Pensiones EGFP"]);
    expect(hayFiltro(FILTRO_INICIAL)).toBe(false);
    expect(hayFiltro({ ...FILTRO_INICIAL, tipo: "EPSV" })).toBe(true);
    expect(hayFiltro({ ...FILTRO_INICIAL, categoria: TODOS, busqueda: "  " })).toBe(false);
  });
});

describe("lo que cambia cómo se lee una cifra", () => {
  test("los días entre dos fechas", () => {
    expect(diasEntre("2026-11-10", "2026-11-13")).toBe(3);
    expect(diasEntre("2024-06-05", "2026-11-13")).toBe(891);
  });

  test("un valor de hace tres días es normal; uno de hace 891, no", () => {
    expect(diasSinValor(epsv)).toBeUndefined();
    /* BSG Prometeo PP el 13-11-2026: último valor del 05-06-2024. */
    expect(diasSinValor(plan({ valor: { importe: 10.5, fecha: "2024-06-05" } }))).toBe(891);
    expect(diasSinValor(plan({ valor: undefined }))).toBeUndefined();
    expect(DIAS_PARA_AVISAR).toBe(45);
  });

  test("unas rentabilidades de marzo, consultadas en noviembre, van atrasadas", () => {
    expect(diasDeRetrasoDeLaRentabilidad(epsv)).toBeUndefined();
    /* Dunas Valor Prudente el 13-11-2026: rentabilidades del 16-03-2026 con el valor al día. */
    expect(diasDeRetrasoDeLaRentabilidad(plan({ rentabilidadFecha: "2026-03-16" }))).toBe(242);
  });

  test("dos planes con rentabilidades de la misma semana se comparan; de meses distintos, se avisa", () => {
    expect(fechasDeRentabilidadDispares([epsv, plan()])).toBe(false);
    expect(fechasDeRentabilidadDispares([epsv, plan({ rentabilidadFecha: "2026-03-16" })])).toBe(true);
    expect(fechasDeRentabilidadDispares([epsv, plan({ rentabilidadFecha: undefined })])).toBe(false);
  });

  test("dos categorías distintas no miden su alfa contra lo mismo", () => {
    expect(categoriasDistintas([epsv, plan()])).toBe(true);
    expect(categoriasDistintas([plan(), plan({ id: "F0GBR0BBBB" })])).toBe(false);
  });
});

describe("por dónde va la pantalla, escrito en la dirección", () => {
  test("una ficha, una comparación, y lo demás es la lista", () => {
    expect(vistaDeLaDireccion("#plan=F00000Q2PL")).toEqual({ tipo: "ficha", id: "F00000Q2PL" });
    expect(vistaDeLaDireccion("#comparar=F00000Q2PL,F0GBR052AF")).toEqual({ tipo: "comparar", ids: ["F00000Q2PL", "F0GBR052AF"] });
    for (const direccion of ["", "#", "#plan=", "#plan=corto", "#otra=cosa", "#comparar=F00000Q2PL", "#comparar=F00000Q2PL,F00000Q2PL"]) {
      expect(vistaDeLaDireccion(direccion), direccion).toEqual({ tipo: "lista" });
    }
  });

  test("no se comparan más de los que caben", () => {
    const muchos = ["F00000000A", "F00000000B", "F00000000C", "F00000000D", "F00000000E"];
    const vista = vistaDeLaDireccion(`#comparar=${muchos.join(",")}`);
    expect(vista.tipo === "comparar" ? vista.ids : []).toHaveLength(MAXIMO_A_COMPARAR);
  });

  test("ida y vuelta", () => {
    for (const vista of [{ tipo: "lista" as const }, { tipo: "ficha" as const, id: "F00000Q2PL" }, { tipo: "comparar" as const, ids: ["F00000Q2PL", "F0GBR052AF"] }]) {
      expect(vistaDeLaDireccion(direccionDeLaVista(vista))).toEqual(vista);
    }
  });
});
