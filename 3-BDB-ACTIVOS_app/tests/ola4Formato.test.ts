import { describe, expect, test } from "vitest";
import { importe, importeTitular } from "../src/core/formato";
import { AppError, appErrorTitle, toAppError } from "../src/core/appError";
import { COVERAGE_BADGE, coverageBadgeFor } from "../src/core/coverageBadge";

describe("U-05 · importes con agrupación de millares", () => {
  const plain = (value: string) => value.replace(/\u00a0/g, " ");
  test("un importe agrupa siempre, también con cuatro cifras", () => {
    expect(plain(importeTitular(5000) ?? "")).toBe("5.000 €");
    expect(plain(importeTitular(8000) ?? "")).toBe("8.000 €");
    expect(plain(importeTitular(24000) ?? "")).toBe("24.000 €");
    expect(plain(importe(1234.5) ?? "")).toBe("1.234,50 €");
    expect(plain(importeTitular(-5000) ?? "")).toBe("−5.000 €");
  });
});

describe("U-02 · distintivo de cobertura", () => {
  test("cada estado usa la clase que estiliza modules.css", () => {
    expect(COVERAGE_BADGE.COMPLETE.cls).toBe("");
    expect(COVERAGE_BADGE.PARTIAL.cls).toBe("is-partial");
    expect(COVERAGE_BADGE.ROOT_ONLY.cls).toBe("is-partial");
    expect(COVERAGE_BADGE.MISSING.cls).toBe("is-missing");
  });

  test("un estado desconocido cae en «parcial» con etiqueta legible, no en verde", () => {
    const badge = coverageBadgeFor("SOME_NEW_STATE");
    expect(badge.cls).toBe("is-partial");
    expect(badge.label).not.toMatch(/_/);
  });
});

describe("U-06 · errores de Firebase en castellano", () => {
  test("permission-denied → texto propio, original en detail/cause", () => {
    const raw = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    const error = toAppError(raw);
    expect(error.kind).toBe("AUTH");
    expect(error.message).not.toMatch(/permissions/i);
    expect(error.message).toMatch(/permiso/);
    expect(error.detail).toBe("Missing or insufficient permissions.");
    expect(error.cause).toBe(raw);
  });

  test("functions/unauthenticated → sesión requerida", () => {
    const error = toAppError(Object.assign(new Error("UNAUTHENTICATED"), { code: "functions/unauthenticated" }));
    expect(error.kind).toBe("AUTH");
    expect(error.message).toMatch(/iniciar sesión/);
  });

  test.each([
    ["unavailable", "NETWORK"],
    ["deadline-exceeded", "NETWORK"],
    ["failed-precondition", "BACKEND"],
    ["invalid-argument", "BACKEND"],
    ["not-found", "BACKEND"],
    ["resource-exhausted", "BACKEND"],
    ["internal", "BACKEND"]
  ] as const)("código %s → texto en castellano (%s)", (code, kind) => {
    /* Un `failed-precondition` con texto es el servidor hablando en castellano (15-11-2026, tests/mensajesDelServidor.test.tsx);
       aquí es el que llega sin mensaje, con el nombre del código, que es lo que pone el SDK. */
    const mensaje = code === "failed-precondition" ? "FAILED_PRECONDITION" : "INTERNAL SERVER ERROR";
    const error = toAppError(Object.assign(new Error(mensaje), { code: `functions/${code}` }));
    expect(error.kind).toBe(kind);
    expect(error.message).not.toMatch(/INTERNAL|SERVER|ERROR/);
    expect(error.message).toMatch(/[áéíóúñ]|servicio|recurso|petición|operación/);
  });

  test("«Failed to fetch» sin código → NETWORK en castellano", () => {
    const error = toAppError(new TypeError("Failed to fetch"));
    expect(error.kind).toBe("NETWORK");
    expect(error.message).not.toMatch(/fetch/i);
    expect(error.detail).toBe("Failed to fetch");
  });

  test("un mensaje propio en castellano sin código se conserva (A2.3)", () => {
    const error = toAppError(new Error("La frontera histórica no ha terminado de calcularse."));
    expect(error.kind).toBe("BACKEND");
    expect(error.message).toBe("La frontera histórica no ha terminado de calcularse.");
  });

  test("un error en texto conserva su causa (revisión 16-10)", () => {
    const error = toAppError("El histórico no cubre el periodo completo seleccionado.");
    expect(error.kind).toBe("BACKEND");
    expect(error.message).toBe("El histórico no cubre el periodo completo seleccionado.");
    expect(error.cause).toBe("El histórico no cubre el periodo completo seleccionado.");
    expect(toAppError("Failed to fetch").kind).toBe("NETWORK");
    expect(toAppError("   ").message).toBe("No se pudo completar la operación.");
  });

  test("un texto propio recupera su tipo: el error guardado como message no pierde el título (tercera revisión)", () => {
    const sources = [
      new TypeError("Failed to fetch"),
      ...["permission-denied", "unauthenticated", "unavailable", "deadline-exceeded", "failed-precondition", "internal"].map(
        (code) => Object.assign(new Error("X"), { code: `functions/${code}` })
      )
    ];
    for (const source of sources) {
      const first = toAppError(source);
      const again = toAppError(first.message);
      expect(again.kind, first.message).toBe(first.kind);
      expect(again.message).toBe(first.message);
      expect(appErrorTitle(again)).toBe(appErrorTitle(first));
    }
    expect(toAppError("No hay conexión con el servidor. Comprueba la red y reinténtalo.").kind).toBe("NETWORK");
    expect(toAppError("Tu cuenta no tiene permiso para esta operación.").kind).toBe("AUTH");
    expect(toAppError("El histórico no cubre el periodo completo seleccionado.").kind).toBe("BACKEND");
  });

  test("un AppError ya construido pasa intacto", () => {
    const own = new AppError("BACKEND", "Contrato inválido.");
    expect(toAppError(own)).toBe(own);
  });
});
