// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import { createLatestRequest, useLatestRequest, type LatestRequest } from "../src/core/useLatestRequest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useLatestRequest (ALTA-12)", () => {
  test("solo la última petición abierta es vigente", () => {
    const request = createLatestRequest();
    const a = request.begin();
    expect(request.isCurrent(a)).toBe(true);
    const b = request.begin();
    expect(request.isCurrent(a)).toBe(false);
    expect(request.isCurrent(b)).toBe(true);
  });

  test("invalidate descarta la petición en vuelo sin abrir otra", () => {
    const request = createLatestRequest();
    const a = request.begin();
    request.invalidate();
    expect(request.isCurrent(a)).toBe(false);
  });

  test("el hook devuelve el mismo objeto en cada render y al desmontar nada queda vigente", () => {
    const seen: LatestRequest[] = [];
    function Probe({ tick }: { tick: number }) {
      seen.push(useLatestRequest());
      return createElement("span", null, String(tick));
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe, { tick: 1 })));
    act(() => root.render(createElement(Probe, { tick: 2 })));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);

    const id = seen[0].begin();
    expect(seen[0].isCurrent(id)).toBe(true);
    act(() => root.unmount());
    expect(seen[0].isCurrent(id)).toBe(false);
  });
});
