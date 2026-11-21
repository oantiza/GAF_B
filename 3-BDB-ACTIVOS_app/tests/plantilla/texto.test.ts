/**
 * El saneado del texto de fuera y la cobertura de glifos: lo que `sanearTexto` deja pasar tiene glifo en las seis
 * fuentes de la plantilla (Fraunces y Roboto Flex desde el 14-11-2026) (abiertas con fontkit, que viene con @react-pdf), y nada que se vea desaparece en silencio.
 */
import { describe, expect, test } from "vitest";
import { SIN_TRANSCRIPCION, sanearTexto, tieneGlifo } from "../../src/reports/plantilla/texto";
import { WOFF_DE_LA_PLANTILLA, abrirFuente } from "./fuentesDeLaPlantilla";

const FUENTES = WOFF_DE_LA_PLANTILLA.map((fichero) => ({ fichero, fuente: abrirFuente(fichero) }));

/** Los caracteres que no son glifos: saltos y tabulador. */
const DE_CONTROL = new Set(["\n", "\r", "\t"]);

describe("sanearTexto", () => {
  test.each([
    /* Lo de Latin-1 se queda (ó, á); solo cambia la letra que la fuente no tiene. */
    ["Kraków", "Kraków"],
    ["Łódź", "Lódz"],
    ["Česká spořitelna", "Ceská sporitelna"],
    ["Ørsted Ærø", "Ørsted Ærø"],
    ["Société Générale · Ñ", "Société Générale · Ñ"],
    ["2024 → 2025", "2024 a 2025"],
    ["≥ 5 años", "al menos 5 años"],
    ["riesgo ≤ 4", "riesgo como máximo 4"],
    ["≈ 2 %", "aprox. 2 %"],
    ["▲ 3 %", "+ 3 %"],
    ["β del fondo", "beta del fondo"],
    ["∑ pesos", "suma pesos"],
    ["0,5 ‰", "0,5 por mil"],
    ["✓ revisado", "sí revisado"],
    ["₹ 1.000", "INR 1.000"],
    ["1⅓ años", "1 1/3 años"],
    ["10 000\u{202F}€", "10 000\u{00A0}€"],
    ["pala\u{00AD}bra", "palabra"],
    ["A\u{200B}B", "AB"],
    ["Fondo ‐ clase A", "Fondo - clase A"],
    ["l’Oréal ½ ² €", "l’Oréal ½ ² €"]
  ])("«%s» → «%s»", (entrada, salida) => {
    expect(sanearTexto(entrada)).toBe(salida);
  });

  test("lo que no tiene lectura latina se dice, no desaparece", () => {
    expect(sanearTexto("日本株式ファンド")).toBe(SIN_TRANSCRIPCION);
    expect(sanearTexto("Fondo Россия 2,5 %")).toBe(`Fondo ${SIN_TRANSCRIPCION} 2,5 %`);
    expect(sanearTexto("Emoji 😀 fin")).toBe(`Emoji ${SIN_TRANSCRIPCION} fin`);
  });

  test("las cifras del módulo común pasan tal cual", () => {
    for (const cifra of ["201.298\u{00A0}€", "\u{2212}2,66\u{00A0}%", "+10,39\u{00A0}%", "13/11/2026", "1.234,56\u{00A0}USD", "+1,25\u{00A0}pp"]) {
      expect(sanearTexto(cifra)).toBe(cifra);
    }
  });

  test("todo carácter que deja pasar, en todo el plano básico y en algunos astrales, tiene glifo en las cuatro fuentes", () => {
    const sinGlifo = new Map<string, Set<string>>();
    const puntos = [...Array.from({ length: 0x10000 }, (_, i) => i).filter((i) => i < 0xd800 || i > 0xdfff), 0x1f600, 0x1d400, 0x20000];
    for (const punto of puntos) {
      for (const caracter of sanearTexto(String.fromCodePoint(punto))) {
        if (DE_CONTROL.has(caracter)) continue;
        for (const { fichero, fuente } of FUENTES) {
          if (!fuente.hasGlyphForCodePoint(caracter.codePointAt(0)!)) {
            const clave = `U+${caracter.codePointAt(0)!.toString(16).toUpperCase()}`;
            sinGlifo.set(clave, (sinGlifo.get(clave) ?? new Set()).add(fichero));
          }
        }
      }
    }
    expect([...sinGlifo.keys()]).toEqual([]);
  }, 60_000);

  test("lo que la lista declara con glifo lo tiene de verdad en las cuatro", () => {
    for (let punto = 0x20; punto < 0x10000; punto += 1) {
      const caracter = String.fromCodePoint(punto);
      if (punto >= 0xd800 && punto <= 0xdfff) continue;
      if (!tieneGlifo(caracter)) continue;
      for (const { fichero, fuente } of FUENTES) expect(fuente.hasGlyphForCodePoint(punto), `${fichero} U+${punto.toString(16)}`).toBe(true);
    }
  });

  test("nada que se vea desaparece en silencio: solo los invisibles se quedan en nada", () => {
    const vacios: string[] = [];
    for (let punto = 0x20; punto < 0x10000; punto += 1) {
      if (punto >= 0xd800 && punto <= 0xdfff) continue;
      const caracter = String.fromCodePoint(punto);
      if (sanearTexto(caracter) === "" && !/\p{Cf}|\p{Mn}|\p{Me}|\p{Variation_Selector}/u.test(caracter)) vacios.push(`U+${punto.toString(16).toUpperCase()}`);
    }
    /* El guion blando (U+00AD) es Cf; las marcas combinantes sueltas (Mn) no se ven sin su letra. */
    expect(vacios).toEqual([]);
  });
});
