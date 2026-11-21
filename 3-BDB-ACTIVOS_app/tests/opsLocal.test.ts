import { describe, expect, test } from "vitest";
import {
  describeOpsError,
  documentosLabel,
  extractIsins,
  formatCorrectionValue,
  fuenteLabel,
  horasLabel,
  interpretCorrectionValue,
  planActionLabel,
  planActionWrites,
  reclasificacionCambios,
  suggestModo,
  tipoLabel
} from "../src/core/opsLocal";

describe("Sistema · Operaciones · ayudas puras", () => {
  test("saca los ISIN de un texto pegado, sin repetir y en mayúsculas", () => {
    expect(extractIsins("LU0113257694, ie00b4l5y983 y otra vez LU0113257694\nbasura")).toEqual(["LU0113257694", "IE00B4L5Y983"]);
    expect(extractIsins("")).toEqual([]);
  });

  test("interpreta el valor tecleado en una corrección como lo haría el CLI", () => {
    expect(interpretCorrectionValue("4")).toBe(4);
    expect(interpretCorrectionValue("3,5")).toBe(3.5);
    expect(interpretCorrectionValue("-1.25")).toBe(-1.25);
    expect(interpretCorrectionValue("true")).toBe(true);
    expect(interpretCorrectionValue("No")).toBe(false);
    expect(interpretCorrectionValue("null")).toBeNull();
    expect(interpretCorrectionValue("")).toBeNull();
    expect(interpretCorrectionValue("Luxemburgo")).toBe("Luxemburgo");
    expect(formatCorrectionValue(true)).toBe("Sí");
    expect(formatCorrectionValue(1234.5)).toBe("1.234,5");
    /* Antes «—», que no dice que falta un dato. */
    expect(formatCorrectionValue(null)).toBe("Falta el dato");
  });

  test("etiquetas legibles: acciones del plan, procedencias, tipos y horas", () => {
    expect(planActionLabel("CREATE")).toBe("Crear");
    expect(planActionLabel("SKIP_EXISTS")).toBe("Ya existe");
    expect(planActionLabel("ALGO_NUEVO")).toBe("algo nuevo");
    expect(planActionWrites("REPUBLICAR")).toBe(true);
    expect(planActionWrites("SIN_CAMBIOS")).toBe(false);
    expect(planActionLabel("ARCHIVE")).toBe("Archivar");
    expect(planActionLabel("MISSING")).toBe("No está en la maestra");
    expect(fuenteLabel("manual:oscar")).toBe("Corrección manual · oscar");
    expect(fuenteLabel("kid_gestora:dws")).toBe("KID de la gestora · dws");
    /* FMT-08: una raya se lee como un dato; lo que falta se dice. */
    expect(fuenteLabel(null)).toBe("Falta el dato");
    expect(tipoLabel("accion")).toBe("Acción");
    expect(tipoLabel("")).toBe("Sin tipo");
    expect(horasLabel(0.5)).toBe("30\u00a0min");
    expect(horasLabel(27.94)).toBe("27,9\u00a0h");
    expect(horasLabel(3)).toBe("3\u00a0h");
    /* Antes «—», que no dice que falta un dato. */
    expect(horasLabel(null)).toBe("Falta el dato");
  });

  test("los documentos de una alta se leen sin rutas internas", () => {
    expect(documentosLabel(["assets/LU1", "assets/LU1/holdings/latest", "assets/LU1/metrics/latest"])).toBe("Ficha · Cartera · Métricas iniciales");
    expect(documentosLabel(["assets/LU1", "assets/LU1/holdings/manifest", "assets/LU1/holdings/chunks/parts/0000", "assets/LU1/holdings/chunks/parts/0001",
      "assets/LU1/metrics/latest"])).toBe("Ficha · Cartera (2 partes) · Métricas iniciales");
    expect(documentosLabel(undefined)).toBe("");
  });

  test("los errores de la plataforma se leen en español y conservan el original como detalle", () => {
    const concurrente = describeOpsError({ asset_id: "ES0105046009", error: "RECLASSIFY_CONCURRENT_MODIFICATION: assets/ES0105046009 cambió" });
    expect(concurrente).toEqual({
      donde: "ES0105046009",
      mensaje: "El documento cambió mientras se escribía: no se escribió nada. Repite la pasada en seco.",
      detalle: "RECLASSIFY_CONCURRENT_MODIFICATION: assets/ES0105046009 cambió"
    });
    expect(describeOpsError({ path: "assets/LU1/metrics/latest", error: "contract: /windows/1y/annualized_volatility must be >= 0" }).mensaje)
      .toBe("Un documento no cumple el contrato de la maestra: no se escribió ese activo.");
    expect(describeOpsError("algo raro").mensaje).toBe("La plataforma devolvió un error.");
    expect(describeOpsError("algo raro").detalle).toBe("algo raro");
    expect(planActionLabel("REPAIR")).toBe("Reparar");
    expect(planActionWrites("REPAIR")).toBe(true);
    // Filas del plan del republish que la plataforma retiene (hold:*) o deja en revisión (review:*).
    expect(planActionLabel("RETENIDA")).toBe("Retenida, no se escribe");
    expect(planActionLabel("REVISION")).toBe("En revisión, no se escribe");
    expect(planActionWrites("RETENIDA")).toBe(false);
    expect(planActionWrites("REVISION")).toBe(false);
  });

  test("una reclasificación dice qué cambia sin nombres de campo internos", () => {
    expect(reclasificacionCambios({ quita: ["costs", "fixed_income_profile"], metricas: "MARK", indice: "UPDATE" })).toBe(
      "Se quitan costes, perfil de renta fija · Métricas: se invalidan hasta que la app las recalcule como acción · Buscador: pasa a acción"
    );
    expect(reclasificacionCambios({ quita: [], metricas: "CREATE_MARKER", indice: null })).toBe("Métricas: no había: se crean para que la app las calcule");
    expect(planActionWrites("RECLASSIFY")).toBe(true);
    expect(planActionWrites("SKIP")).toBe(false);
    expect(planActionLabel("RECLASSIFY")).toBe("Reclasificar");
  });

  test("sugiere alta si algo es nuevo en el universo y republicar si no", () => {
    expect(suggestModo(["ya_estaba", "nuevo"])).toBe("alta");
    expect(suggestModo(["ya_estaba", "invalido"])).toBe("republish");
  });
});
