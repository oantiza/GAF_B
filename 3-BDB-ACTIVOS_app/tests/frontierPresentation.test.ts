import { describe, expect, test } from "vitest";
import { concaveFrontierEnvelope } from "../src/core/frontierPresentation";

interface Point {
  id: string;
  vol: number;
  ret: number;
}

const envelope = (points: Point[]) => concaveFrontierEnvelope(points, (p) => p.vol, (p) => p.ret);
const ids = (points: Point[]) => points.map((p) => p.id);

describe("concaveFrontierEnvelope", () => {
  test("elimina dientes, duplicados de volatilidad y puntos dominados", () => {
    const points: Point[] = [
      { id: "dominated-low", vol: 0.08, ret: 0.035 },
      { id: "start", vol: 0.08, ret: 0.04 },
      { id: "tooth", vol: 0.12, ret: 0.055 },
      { id: "middle", vol: 0.18, ret: 0.11 },
      { id: "dominated-flat", vol: 0.21, ret: 0.108 },
      { id: "end", vol: 0.26, ret: 0.13 }
    ];

    expect(ids(envelope(points))).toEqual(["start", "middle", "end"]);
  });

  test("mantiene intacta una frontera ya concava", () => {
    const points: Point[] = [
      { id: "a", vol: 0.06, ret: 0.03 },
      { id: "b", vol: 0.1, ret: 0.06 },
      { id: "c", vol: 0.16, ret: 0.09 },
      { id: "d", vol: 0.24, ret: 0.12 }
    ];

    expect(ids(envelope(points))).toEqual(["a", "b", "c", "d"]);
  });
});
