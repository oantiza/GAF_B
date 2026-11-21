import { afterEach, describe, expect, test, vi } from "vitest";
import { diaLocal } from "../src/core/fechaLocal";
import { fecha } from "../src/core/formato";

const MADRID = "Europe/Madrid";

describe("el día en que se genera un documento", () => {
  test("alrededor de la medianoche de Madrid en invierno (UTC+1)", () => {
    expect(diaLocal("2026-11-04T22:59:59.000Z", MADRID)).toBe("2026-11-04");
    expect(diaLocal("2026-11-04T23:00:00.000Z", MADRID)).toBe("2026-11-05");
    expect(diaLocal("2026-11-04T23:30:00.000Z", MADRID)).toBe("2026-11-05");
    expect(diaLocal("2026-11-05T00:59:59.000Z", MADRID)).toBe("2026-11-05");
  });

  test("alrededor de la medianoche de Madrid en verano (UTC+2): las dos horas en que salía la fecha de ayer", () => {
    expect(diaLocal("2026-07-14T21:59:59.000Z", MADRID)).toBe("2026-07-14");
    expect(diaLocal("2026-07-14T22:00:00.000Z", MADRID)).toBe("2026-07-15");
    expect(diaLocal("2026-07-14T23:59:59.000Z", MADRID)).toBe("2026-07-15");
  });

  test("cambio de año y de mes", () => {
    expect(diaLocal("2026-12-31T23:30:00.000Z", MADRID)).toBe("2027-01-01");
    expect(diaLocal("2026-10-31T23:30:00.000Z", MADRID)).toBe("2026-11-01");
  });

  test("al oeste de Greenwich el día va por detrás, y también se respeta", () => {
    expect(diaLocal("2026-11-05T02:00:00.000Z", "America/New_York")).toBe("2026-11-04");
    expect(diaLocal("2026-11-05T02:00:00.000Z", "UTC")).toBe("2026-11-05");
  });

  test("una fecha sin hora ya es un día, y no se mueve con el huso", () => {
    expect(diaLocal("2026-09-06", "America/New_York")).toBe("2026-09-06");
    expect(diaLocal(" 2026-09-06 ", MADRID)).toBe("2026-09-06");
  });

  test("lo que no es una fecha no se inventa", () => {
    expect(diaLocal("sin fecha", MADRID)).toBeNull();
    expect(diaLocal("", MADRID)).toBeNull();
  });

  test("lo que devuelve se escribe sin mover el día", () => {
    expect(fecha(diaLocal("2026-11-04T23:30:00.000Z", MADRID))).toBe("05/11/2026");
    /* Lo que no es una fecha no se formatea: quien lo pinta dice que falta. */
    expect(fecha(diaLocal("sin fecha", MADRID))).toBeNull();
  });

  describe("sin zona, la del navegador", () => {
    afterEach(() => vi.unstubAllEnvs());

    test("con el reloj de Madrid, a las 00:30 ya es el día siguiente", () => {
      vi.stubEnv("TZ", MADRID);
      expect(diaLocal("2026-11-04T23:30:00.000Z")).toBe("2026-11-05");
    });
  });
});
