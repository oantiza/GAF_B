import { describe, expect, test } from "vitest";
import { fraseDeLaParteMedida, motivoParaElCliente, parteMedidaDeLaSimulacion, pesoEnElPapel, type ParteMedida } from "../src/core/parteMedida";

const MUESTRA = [
  { asset_id: "IE00B4L5Y983", weight_percent: 24 },
  { asset_id: "IE00B3XXRP09", weight_percent: 12 },
  { asset_id: "LU1883318740", weight_percent: 10 },
  { asset_id: "LU0329355670", weight_percent: 8 },
  { asset_id: "IE00B11XZ103", weight_percent: 20 },
  { asset_id: "LU0430492750", weight_percent: 10 },
  { asset_id: "FR0013367265", weight_percent: 9 },
  { asset_id: "LU1103307408", weight_percent: 7 }
];
const FUERA_VANGUARD = { asset_ids: MUESTRA.filter((p) => p.asset_id !== "IE00B3XXRP09").map((p) => p.asset_id), excluded_assets: [{ asset_id: "IE00B3XXRP09", reason: "QUALITY_BLOCKED" }] };
const NOMBRES: Record<string, string> = { IE00B3XXRP09: "Vanguard S&P 500 UCITS ETF", A: "Fondo A", B: "Fondo B", C: "Fondo C", D: "Fondo D" };
const nombreDe = (id: string) => NOMBRES[id] ?? id;

describe("qué parte de la cartera mide la simulación", () => {
  test("sobre la cartera original: 100 − 12 = 88 %, 7 de 8", () => {
    const parte = parteMedidaDeLaSimulacion(FUERA_VANGUARD, MUESTRA)!;
    expect(parte.requested).toBe(8);
    expect(parte.included).toBe(7);
    expect(parte.weightPercent).toBeCloseTo(88, 10);
    expect(parte.excluded).toEqual([{ assetId: "IE00B3XXRP09", weightPercent: 12, reason: "QUALITY_BLOCKED", reasonLabel: "bloqueado por calidad del dato" }]);
  });

  test("con pesos que no suman 100 se normaliza: 60 + 30 de 200 son el 90 % si A y B pesan 120 y 60", () => {
    const parte = parteMedidaDeLaSimulacion(
      { asset_ids: ["A", "B"], excluded_assets: [] },
      [{ asset_id: "A", weight_percent: 120 }, { asset_id: "B", weight_percent: 60 }, { asset_id: "C", weight_percent: 15 }, { asset_id: "D", weight_percent: 5 }]
    )!;
    expect(parte.weightPercent).toBeCloseTo(90, 10);
    expect(parte.excluded.map((item) => item.reason)).toEqual([null, null]);
    expect(parte.excluded[0].reasonLabel).toBe("Fuera del histórico disponible");
  });

  test("peso 0, posición repetida y una sola posición", () => {
    const parte = parteMedidaDeLaSimulacion(
      { asset_ids: ["A"], excluded_assets: [] },
      [{ asset_id: "A", weight_percent: 50 }, { asset_id: "A", weight_percent: 50 }, { asset_id: "C", weight_percent: 0 }]
    )!;
    expect(parte).toEqual({ requested: 1, included: 1, weightPercent: 100, excluded: [] });
  });

  test("una simulación que mide lo que la cartera no tiene no es de esta cartera", () => {
    expect(parteMedidaDeLaSimulacion({ asset_ids: ["AJENO"], excluded_assets: [] }, MUESTRA)).toBeNull();
    expect(parteMedidaDeLaSimulacion({ asset_ids: [], excluded_assets: [] }, MUESTRA)).toBeNull();
    expect(parteMedidaDeLaSimulacion(FUERA_VANGUARD, [])).toBeNull();
    expect(parteMedidaDeLaSimulacion(null, MUESTRA)).toBeNull();
  });
});

describe("la frase de cobertura", () => {
  const parte = (excluded: ParteMedida["excluded"], weightPercent: number, included = 1, requested = included + excluded.length): ParteMedida => ({ requested, included, weightPercent, excluded });
  const fuera = (assetId: string, weightPercent: number, reason: string | null = "QUALITY_BLOCKED") => ({ assetId, weightPercent, reason, reasonLabel: "x" });

  test("la de la muestra, sacada del dato", () => {
    expect(fraseDeLaParteMedida(parteMedidaDeLaSimulacion(FUERA_VANGUARD, MUESTRA), nombreDe))
      .toBe("Mide el 88,0\u00a0% de la cartera (7 de 8 posiciones); queda fuera Vanguard S&P 500 UCITS ETF (12,0\u00a0%) por una incidencia en su serie de precios.");
  });

  test("con el 100 % medido no hay frase", () => {
    expect(fraseDeLaParteMedida(parte([], 100, 8), nombreDe)).toBeNull();
    expect(fraseDeLaParteMedida(null, nombreDe)).toBeNull();
  });

  test("dos con el mismo motivo lo dicen una vez; con motivos distintos, cada uno el suyo", () => {
    expect(fraseDeLaParteMedida(parte([fuera("A", 12), fuera("B", 20)], 68, 3), nombreDe))
      .toBe("Mide el 68,0\u00a0% de la cartera (3 de 5 posiciones); quedan fuera Fondo B (20,0\u00a0%) y Fondo A (12,0\u00a0%), por una incidencia en su serie de precios.");
    expect(fraseDeLaParteMedida(parte([fuera("A", 12), fuera("B", 20, "INSUFFICIENT_HISTORY"), fuera("C", 8, "FX_SERIES_MISSING")], 60, 2), nombreDe))
      .toBe("Mide el 60,0\u00a0% de la cartera (2 de 5 posiciones); quedan fuera Fondo B (20,0\u00a0%), por no tener historia suficiente en este periodo; Fondo A (12,0\u00a0%), por una incidencia en su serie de precios; y Fondo C (8,0\u00a0%), por no tener conversión a euros.");
  });

  test("con más de tres se cuentan y se manda al anexo, sumando lo que pesan", () => {
    expect(fraseDeLaParteMedida(parte([fuera("A", 10), fuera("B", 10), fuera("C", 5), fuera("D", 5)], 70, 3), nombreDe))
      .toBe("Mide el 70,0\u00a0% de la cartera (3 de 7 posiciones); quedan fuera 4 posiciones (30,0\u00a0% del peso), detalladas en el anexo.");
  });

  test("con nombres muy largos tampoco cabe: se cuentan, y una sola posición siempre se nombra", () => {
    const largo = (id: string) => `Fondo con un nombre larguísimo de los que publica el catálogo, clase de acumulación en euros cubierta ${id}`;
    const frase = fraseDeLaParteMedida(parte([fuera("A", 20), fuera("B", 15, "DISTRIBUTES_WITHOUT_PAYMENTS"), fuera("C", 15, "INSUFFICIENT_HISTORY")], 50, 2), largo);
    expect(frase).toBe("Mide el 50,0\u00a0% de la cartera (2 de 5 posiciones); quedan fuera 3 posiciones (50,0\u00a0% del peso), detalladas en el anexo.");
    expect(fraseDeLaParteMedida(parte([fuera("A", 20)], 80, 1), largo)).toContain(`queda fuera ${largo("A")} (20,0\u00a0%) por una incidencia`);
  });

  test("lo que no llega al 100 no se escribe como si llegara", () => {
    expect(pesoEnElPapel(99.96)).toBe("99,96\u00a0%");
    expect(pesoEnElPapel(100)).toBe("100,0\u00a0%");
    expect(pesoEnElPapel(87.654)).toBe("87,7\u00a0%");
    /* Tampoco se escribe como si llegara al mínimo para dar una cifra (decisión 59). Un 80 % en coma flotante es un 80. */
    expect(pesoEnElPapel(79.99)).toBe("79,99\u00a0%");
    expect(pesoEnElPapel(79.96)).toBe("79,96\u00a0%");
    expect(pesoEnElPapel(79.9)).toBe("79,9\u00a0%");
    expect(pesoEnElPapel(79.99999999999999)).toBe("80,0\u00a0%");
    expect(pesoEnElPapel(80)).toBe("80,0\u00a0%");
    expect(fraseDeLaParteMedida(parte([fuera("A", 0.04)], 99.96, 1), nombreDe)).toContain("Mide el 99,96\u00a0% de la cartera (1 de 2 posiciones)");
  });

  test("ningún motivo enseña un código, y el que no se conoce tampoco", () => {
    for (const codigo of ["QUALITY_BLOCKED", "PRICE_SERIES_MISSING", "INSUFFICIENT_HISTORY", "FX_SERIES_MISSING", "FX_QUARANTINE", "NON_INVESTABLE", "DISTRIBUTES_WITHOUT_PAYMENTS", "ASSET_CAP_EXCEEDED", "OTRO_CODIGO", null, undefined]) {
      expect(motivoParaElCliente(codigo)).not.toMatch(/[A-Z_]{4,}/);
    }
    expect(motivoParaElCliente("OTRO_CODIGO")).toBe("falta de datos en este periodo");
    /* Decisión 58: ninguna de las dos afirma que falte la serie de cambio, porque en la cuarentena existe. */
    expect(motivoParaElCliente("FX_SERIES_MISSING")).toBe("no tener conversión a euros");
    expect(motivoParaElCliente("FX_QUARANTINE")).toBe("no tener una conversión a euros fiable");
  });
});
