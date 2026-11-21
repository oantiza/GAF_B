import { describe, expect, test } from "vitest";
import { aggregateToAreas, regionKeyToArea } from "../src/charts/worldMapGeo";

describe("mapa geográfico", () => {
  test("reconoce las claves geográficas en español y sus equivalentes europeos", () => {
    expect(regionKeyToArea("Europa")).toBe("europe");
    expect(regionKeyToArea("Iberia")).toBe("europe");
    expect(regionKeyToArea("Ireland")).toBe("europe");
    expect(regionKeyToArea("EE.UU.")).toBe("north_america");
    expect(regionKeyToArea("Japón")).toBe("japan");
    expect(regionKeyToArea("Norteamérica")).toBe("north_america");
  });

  test("acumula las exposiciones europeas para colorear el mapa", () => {
    const areas = aggregateToAreas([
      { key: "Europa", weight_percent: 62 },
      { key: "Iberia", weight_percent: 2.2 },
      { key: "Ireland", weight_percent: 2.6 },
      { key: "Global", weight_percent: 33.2 }
    ]);
    expect(areas.europe).toBeCloseTo(66.8);
  });
});
