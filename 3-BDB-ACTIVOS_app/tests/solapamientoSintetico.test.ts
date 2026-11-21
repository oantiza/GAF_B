import { describe, expect, test } from "vitest";
import { buildReportOverlap, conLaReplica, corteDeLaMatriz, solapamientoEnFrases, type OverlapPosition } from "../src/core/reportOverlap";
import { situacionDeLaCartera } from "../src/core/overlap";
import type { BdbAssetHoldings } from "../src/types/bdbAssets";

const cartera = (id: string, lineas: Array<{ name: string; w: number; code?: string }>): BdbAssetHoldings => ({
  asset_id: id, storage_mode: "SINGLE_DOCUMENT", as_of_date: "2026-09-30",
  holdings: lineas.map((l, i) => ({ name: l.name, isin: l.code ? undefined : `ISIN${i}`, weight_pct: l.w, ...(l.code ? { holding_type_code: l.code } : {}) }))
});
const diez = (id: string) => cartera(id, Array.from({ length: 10 }, (_, i) => ({ name: `Banco ${i}`, w: 10, code: "E" })));
const swap = (id: string) => cartera(id, [{ name: "TRS EURO STOXX Optimised Banks NR EUR", w: 100, code: "SE" }]);
const pos = (id: string, nombre: string, extra: Partial<OverlapPosition> = {}): OverlapPosition => ({ asset_id: id, display_name: nombre, weight_percent: 10, instrument_type: "ETF", ...extra });

describe("ETF sintético en el solapamiento", () => {
  test("una sola línea de swap: sale con la frase de la permuta y no con «no publica»", () => {
    const posiciones = [pos("A", "Físico"), pos("S", "Invesco EURO STOXX Optimised Banks UCITS ETF")];
    const modelo = buildReportOverlap(posiciones, new Map([["A", diez("A")], ["S", swap("S")]]));
    expect(modelo.positions[1].status).toBe("synthetic");
    const corte = corteDeLaMatriz(modelo.positions);
    expect(corte.fuera).toEqual(["Invesco EURO STOXX Optimised Banks UCITS ETF: replica su índice con una permuta (swap); su cartera es ese contrato, no las acciones, y no se puede medir lo que comparte."]);
    const texto = solapamientoEnFrases(modelo).frases.join(" ");
    expect(texto).toContain("replica su índice con una permuta");
    expect(texto).not.toContain("no publica");
  });

  test("con la réplica del proveedor sintética y sin cartera, también", () => {
    expect(situacionDeLaCartera("ETF", null, "Synthetic Replication").situacion).toBe("sintetica");
    expect(situacionDeLaCartera("ETF", null, "Physical Replication").situacion).toBe("sin_cartera");
    expect(situacionDeLaCartera("ETF", cartera("X", [{ name: "Alfa", w: 20, code: "E" }]), "Synthetic Replication").situacion).toBe("sintetica");
    expect(situacionDeLaCartera("ETF", cartera("X", [{ name: "Alfa", w: 20, code: "E" }])).situacion).toBe("insuficiente");
  });

  test("la frase de resumen cuenta aparte al sintético y al de menos de la mitad", () => {
    const posiciones = [pos("A", "Físico"), pos("B", "Otro físico"), pos("C", "DPAM corto"), pos("S", "Invesco")];
    const modelo = buildReportOverlap(posiciones, new Map([["A", diez("A")], ["B", diez("B")], ["C", cartera("C", [{ name: "Alfa", w: 20, code: "E" }])], ["S", swap("S")]]));
    const frases = solapamientoEnFrases(modelo).frases;
    expect(frases).toContain("1 de los 4 fondos no publica al menos la mitad de su cartera, y no se puede medir lo que comparte: DPAM corto. Y 1 replica su índice con una permuta, y no se puede medir lo que comparte: Invesco.");
    const dos = buildReportOverlap([pos("A", "Físico"), pos("B", "Otro"), pos("S", "Uno", {}), pos("T", "Dos")], new Map([["A", diez("A")], ["B", diez("B")], ["S", swap("S")], ["T", swap("T")]]));
    expect(solapamientoEnFrases(dos).frases).toContain("2 de los 4 fondos replican su índice con una permuta, y no se puede medir lo que comparten: Uno y Dos.");
  });

  test("el caso de la web: Invesco sin cartera en la base y con SYNTHETIC en su ficha, junto al DPAM corto", () => {
    const informe = [pos("A", "Físico"), pos("B", "Otro físico"), pos("C", "DPAM corto"), pos("S", "Invesco")];
    const fichas = [{ asset_id: "S", product_profile: { replication: "SYNTHETIC" } }, { asset_id: "A", product_profile: { replication: "PHYSICAL_FULL" } }, { asset_id: "C" }];
    const conReplica = conLaReplica(informe, fichas);
    expect(conReplica.map((p) => p.replica)).toEqual(["PHYSICAL_FULL", undefined, undefined, "SYNTHETIC"]);
    /* La base nueva no guarda cartera de un ETF por swap: Morningstar no le da recuento de acciones. */
    const cargas = new Map([["A", diez("A")], ["B", diez("B")], ["C", cartera("C", [{ name: "Alfa", w: 20, code: "E" }])], ["S", null]]);
    expect(buildReportOverlap(informe, cargas).positions[3].status).toBe("missing");
    const modelo = buildReportOverlap(conReplica, cargas);
    expect(modelo.positions[3].status).toBe("synthetic");
    expect(solapamientoEnFrases(modelo).frases).toContain("1 de los 4 fondos no publica al menos la mitad de su cartera, y no se puede medir lo que comparte: DPAM corto. Y 1 replica su índice con una permuta, y no se puede medir lo que comparte: Invesco.");
  });

  test("conLaReplica no pisa la que ya trae una posición", () => {
    expect(conLaReplica([pos("S", "Invesco", { replica: "Synthetic Replication" })], [{ asset_id: "S", product_profile: { replication: "PHYSICAL_FULL" } }])[0].replica).toBe("Synthetic Replication");
  });

  test("un ETF físico de diez líneas sigue como hoy", () => {
    const modelo = buildReportOverlap([pos("A", "Físico"), pos("B", "Otro físico")], new Map([["A", diez("A")], ["B", diez("B")]]));
    expect(modelo.positions.map((p) => p.status)).toEqual(["available", "available"]);
    expect(modelo.values[0][1]).toBe(100);
    expect(corteDeLaMatriz(modelo.positions).fuera).toEqual([]);
  });
});
