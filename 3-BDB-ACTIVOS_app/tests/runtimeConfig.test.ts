import { describe, expect, it } from "vitest";
import {
  PRODUCTION_DEFAULT_DATA_SOURCE_KIND,
  SAFE_DEFAULT_DATA_SOURCE_KIND,
  parseEnabledUnlessOff,
  resolveDefaultDataSourceKind
} from "../src/config/runtimeConfig";

/* R-06 (revisión del 16-10-2026): el espejo de BDB_REQUIRE_EMAIL_VERIFIED solo
   se apaga con un «no» explícito; un valor mal escrito la deja activa. */
describe("parseEnabledUnlessOff", () => {
  it.each(["false", "FALSE", " off ", "Off", "0", "no", "NO"])("«%s» la apaga", (value) => {
    expect(parseEnabledUnlessOff(value)).toBe(false);
  });

  it.each([undefined, "", "true", "TRUE", "on", "ON", "1", "yes", "si", "flase"])("«%s» la deja activa", (value) => {
    expect(parseEnabledUnlessOff(value)).toBe(true);
  });
});

describe("resolveDefaultDataSourceKind", () => {
  it("usa BBDD_LIVE_API en producción con Firebase aunque no haya env explícita", () => {
    expect(
      resolveDefaultDataSourceKind({
        requestedDefaultDataSource: null,
        firebaseConfigured: true,
        isProduction: true
      })
    ).toBe(PRODUCTION_DEFAULT_DATA_SOURCE_KIND);
  });

  it("mantiene muestra estática en desarrollo si no se pide otra fuente", () => {
    expect(
      resolveDefaultDataSourceKind({
        requestedDefaultDataSource: null,
        firebaseConfigured: true,
        isProduction: false
      })
    ).toBe(SAFE_DEFAULT_DATA_SOURCE_KIND);
  });

  it("mantiene fallback local en desarrollo si se pide live sin Firebase", () => {
    expect(
      resolveDefaultDataSourceKind({
        requestedDefaultDataSource: "BBDD_LIVE_API",
        firebaseConfigured: false,
        isProduction: false
      })
    ).toBe(SAFE_DEFAULT_DATA_SOURCE_KIND);
  });

  it("falla en producción si se pide live sin Firebase", () => {
    expect(() =>
      resolveDefaultDataSourceKind({
        requestedDefaultDataSource: "BBDD_LIVE_API",
        firebaseConfigured: false,
        isProduction: true
      })
    ).toThrow("requiere Firebase");
  });

  it("falla en producción sin Firebase y sin fuente explícita", () => {
    expect(() =>
      resolveDefaultDataSourceKind({
        requestedDefaultDataSource: null,
        firebaseConfigured: false,
        isProduction: true
      })
    ).toThrow("requiere Firebase");
  });

  it("falla en producción si se pide una fuente local", () => {
    expect(() =>
      resolveDefaultDataSourceKind({
        requestedDefaultDataSource: "LOCAL_MOCK",
        firebaseConfigured: true,
        isProduction: true
      })
    ).toThrow("BBDD_LIVE_API");
  });

  it("respeta una fuente local pedida explícitamente en desarrollo", () => {
    expect(
      resolveDefaultDataSourceKind({
        requestedDefaultDataSource: "LOCAL_MOCK",
        firebaseConfigured: true,
        isProduction: false
      })
    ).toBe("LOCAL_MOCK");
  });
});
