import { describe, expect, test } from "vitest";
import {
  hayCambiosSinGuardar,
  huellaDeCartera,
  type CarteraAbierta,
  type ContenidoDeCartera
} from "../src/core/carteraActiva";
import { diaDeGuardada, textoDeGuardada, tituloDeCambiosSinGuardar } from "../src/core/textosDeCartera";

const BASE: ContenidoDeCartera = {
  positions: [
    { asset_id: "A", weight_percent: 60, label: "Fondo A" },
    { asset_id: "B", weight_percent: 40, label: "Fondo B" }
  ],
  capital: 250000,
  nombre: "Cliente · propuesta"
};

function abierta(contenido: ContenidoDeCartera): CarteraAbierta {
  return { portfolio_id: "p1", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", huella: huellaDeCartera(contenido) };
}

describe("cambios sin guardar", () => {
  test("una cartera que no se ha guardado nunca solo tiene algo que perder si tiene posiciones", () => {
    expect(hayCambiosSinGuardar(BASE, null)).toBe(true);
    expect(hayCambiosSinGuardar({ positions: [], capital: undefined, nombre: "" }, null)).toBe(false);
    expect(hayCambiosSinGuardar({ positions: [], capital: 1000, nombre: "Escrito" }, null)).toBe(false);
  });

  test("recién abierta no hay cambios", () => {
    expect(hayCambiosSinGuardar(BASE, abierta(BASE))).toBe(false);
  });

  test("cambiar un peso, el capital, el nombre o un importe fijo son cambios", () => {
    const original = abierta(BASE);
    expect(hayCambiosSinGuardar({ ...BASE, positions: [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }] }, original)).toBe(true);
    expect(hayCambiosSinGuardar({ ...BASE, capital: 300000 }, original)).toBe(true);
    expect(hayCambiosSinGuardar({ ...BASE, capital: undefined }, original)).toBe(true);
    expect(hayCambiosSinGuardar({ ...BASE, nombre: "Otro" }, original)).toBe(true);
    expect(hayCambiosSinGuardar({ ...BASE, positions: [{ asset_id: "A", weight_percent: 60, keepEuros: true, targetEuros: 150000 }, BASE.positions[1]] }, original)).toBe(true);
    expect(hayCambiosSinGuardar({ ...BASE, positions: [BASE.positions[0]] }, original)).toBe(true);
    expect(hayCambiosSinGuardar({ ...BASE, positions: [] }, original)).toBe(true);
  });

  test("no son cambios: el orden, la etiqueta, los espacios del nombre ni lo que no sobrevive al redondeo", () => {
    const original = abierta(BASE);
    expect(hayCambiosSinGuardar({ ...BASE, positions: [...BASE.positions].reverse() }, original)).toBe(false);
    expect(hayCambiosSinGuardar({ ...BASE, positions: BASE.positions.map(({ asset_id, weight_percent }) => ({ asset_id, weight_percent })) }, original)).toBe(false);
    expect(hayCambiosSinGuardar({ ...BASE, nombre: "  Cliente ·  propuesta " }, original)).toBe(false);
    expect(hayCambiosSinGuardar({ ...BASE, positions: [{ asset_id: "A", weight_percent: 60.000001 }, BASE.positions[1]] }, original)).toBe(false);
  });

  test("keepEuros en falso y ausente son lo mismo, como vuelven del servidor", () => {
    expect(hayCambiosSinGuardar({ ...BASE, positions: BASE.positions.map((p) => ({ ...p, keepEuros: false, targetEuros: 5 })) }, abierta(BASE))).toBe(false);
  });
});

describe("textos", () => {
  const ahora = new Date(2026, 10, 4, 18, 30);

  test("hoy, ayer y otro día", () => {
    expect(textoDeGuardada(new Date(2026, 10, 4, 12, 30).toISOString(), ahora)).toBe("Guardada hoy 12:30");
    expect(textoDeGuardada(new Date(2026, 10, 3, 18, 2).toISOString(), ahora)).toBe("Guardada ayer 18:02");
    expect(textoDeGuardada(new Date(2026, 9, 28, 9, 5).toISOString(), ahora)).toBe("Guardada el 28/10/2026 09:05");
  });

  test("una fecha ilegible no se inventa", () => {
    expect(textoDeGuardada("no es una fecha", ahora)).toBe("Guardada");
  });

  test("el aviso nombra la cartera, y sin nombre habla de la activa", () => {
    expect(tituloDeCambiosSinGuardar("Cliente · propuesta")).toBe("La cartera Cliente · propuesta tiene cambios sin guardar");
    expect(tituloDeCambiosSinGuardar("  ")).toBe("La cartera activa tiene cambios sin guardar");
  });
});

describe("el día de una cartera en la lista", () => {
  test("a las 00:05 de Madrid es ese día, aunque en Greenwich sea el anterior", () => {
    const zona = process.env.TZ;
    process.env.TZ = "Europe/Madrid";
    try {
      expect(diaDeGuardada("2026-11-04T23:05:00.000Z")).toBe("05/11/2026");
    } finally {
      if (zona === undefined) delete process.env.TZ;
      else process.env.TZ = zona;
    }
  });

  test("una fecha que no se lee no se inventa", () => {
    expect(diaDeGuardada("no es una fecha")).toBe("Falta el dato");
  });
});
