import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { COLOR_DE_LA_SERIE_SIN_COLOR, inkOnSequentialStep, withAlpha } from "../src/charts/oaa/chartTheme";
import { CHART_PALETTE, CHART_REFERENCE_COLOR, CLASS_COLORS, OAA_COLORS, SEQUENTIAL_RAMP, UNCLASSIFIED_COLOR } from "../src/core/theme";

/**
 * Espejo theme.ts ↔ tokens.css (auditoría 14-10-2026, MEDIA-19 y tooling).
 *
 * Recharts no resuelve var(--token) en todos los atributos SVG, así que
 * theme.ts copia la paleta. La guía exige cambiar los dos lados a la vez; esta
 * prueba es la que lo hace cumplir, y la que permite al censo deadCssD3 dar
 * por vivas las --series-N que solo se consumen a través de CHART_PALETTE.
 */
const tokensCss = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

function token(name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokensCss);
  if (!match) throw new Error(`${name} no está declarado en tokens.css`);
  return match[1].trim().toLowerCase();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("espejo theme.ts ↔ tokens.css", () => {
  test("CHART_PALETTE reproduce --serie-1..6 en valor y en orden, y la referencia, --serie-referencia", () => {
    const nombres = ["--serie-1", "--serie-2", "--serie-3", "--serie-4", "--serie-5", "--serie-6"];
    expect(CHART_PALETTE).toHaveLength(nombres.length);
    CHART_PALETTE.forEach((color, index) => {
      expect(color.toLowerCase(), nombres[index]).toBe(token(nombres[index]));
    });
    /* Dirección A (18-11-2026): la referencia tiene color propio y ya no es un puesto de la paleta. */
    expect(CHART_REFERENCE_COLOR.toLowerCase()).toBe(token("--serie-referencia"));
    expect(CHART_PALETTE.map((color) => color.toLowerCase())).not.toContain(CHART_REFERENCE_COLOR.toLowerCase());
  });

  test("CLASS_COLORS reproduce los --clase-*, y el resto es el gris de lo no clasificado", () => {
    const pares: Array<[string, string]> = [
      [CLASS_COLORS.rentaVariable, "--clase-renta-variable"],
      [CLASS_COLORS.rentaFija, "--clase-renta-fija"],
      [CLASS_COLORS.liquidez, "--clase-liquidez"],
      [CLASS_COLORS.alternativos, "--clase-alternativos"],
      [CLASS_COLORS.mixto, "--clase-mixto"],
      [CLASS_COLORS.activosReales, "--clase-activos-reales"],
      [CLASS_COLORS.resto, "--clase-resto"]
    ];
    expect(pares).toHaveLength(Object.keys(CLASS_COLORS).length);
    for (const [espejo, nombre] of pares) expect(espejo.toLowerCase(), nombre).toBe(token(nombre));
    expect(UNCLASSIFIED_COLOR).toBe(CLASS_COLORS.resto);
  });

  test("los colores sueltos de OAA_COLORS coinciden con su token", () => {
    const pairs: Array<[string, string]> = [
      [OAA_COLORS.spruce, "--marca"],
      [OAA_COLORS.spruceHover, "--marca-fuerte"],
      [OAA_COLORS.rail, "--marco"],
      [OAA_COLORS.gold, "--laton"],
      [OAA_COLORS.aviso, "--aviso"],
      [OAA_COLORS.sube, "--sube"],
      [OAA_COLORS.baja, "--baja"],
      [OAA_COLORS.background, "--papel"],
      [OAA_COLORS.surfaceMuted, "--banda"],
      [OAA_COLORS.border, "--filete"],
      [OAA_COLORS.borderStrong, "--filete-fuerte"],
      [OAA_COLORS.text, "--tinta"],
      [OAA_COLORS.chartZero, "--chart-zero"],
      [OAA_COLORS.chartAxis, "--chart-axis"],
      [OAA_COLORS.textSecondary, "--tinta-2"],
      [OAA_COLORS.textTertiary, "--tinta-3"],
      [OAA_COLORS.chartGrid, "--chart-grid"],
      [OAA_COLORS.textMuted, "--chart-reference"],
      [OAA_COLORS.chartCursorFill, "--chart-cursor-fill"]
    ];
    for (const [mirror, name] of pairs) expect(normalize(mirror), name).toBe(normalize(token(name)));
    /* Dos alias: el ocre de serie es el latón, y el cursor, la línea de referencia. */
    expect(token("--ochre-50")).toBe("var(--laton)");
    expect(token("--chart-crosshair")).toBe("var(--chart-reference)");
    expect(OAA_COLORS.chartCrosshair).toBe(OAA_COLORS.textMuted);
  });

  /* Paso 2 del rediseño: la rampa entera es token (--rampa-0..7), no solo los tres puntos de la leyenda de gradiente
     que se retiró; la leyenda de las matrices enseña ahora sus clases. */
  test("la rampa secuencial reproduce --rampa-0..7 en valor y en orden, y acaba en el marino del marco", () => {
    expect(SEQUENTIAL_RAMP).toHaveLength(8);
    SEQUENTIAL_RAMP.forEach((color, paso) => {
      expect(color.toLowerCase(), `--rampa-${paso}`).toBe(token(`--rampa-${paso}`));
    });
    expect(SEQUENTIAL_RAMP[7].toLowerCase()).toBe(token("--marco"));
  });

  test("la rampa va de clara a oscura sin volver atrás, con el hueco entre el paso 4 y el 5", () => {
    const luz = SEQUENTIAL_RAMP.map(luminance);
    for (let paso = 1; paso < luz.length; paso += 1) expect(luz[paso], `paso ${paso}`).toBeLessThan(luz[paso - 1]);
    /* Entre 0,178 y 0,232 ni la tinta ni el papel llegan a 4,5:1 (chartTheme.ts, inkOnSequentialStep). */
    expect(luz[4]).toBeGreaterThan(0.232);
    expect(luz[5]).toBeLessThan(0.178);
  });
});

describe("tintas y rampa: contraste de texto", () => {
  test("toda tinta de texto de theme.ts supera 4,5:1 sobre blanco; textMuted no, y por eso no es texto", () => {
    for (const ink of [OAA_COLORS.text, OAA_COLORS.textSecondary, OAA_COLORS.textTertiary]) {
      expect(contrast(ink, "#FFFFFF"), ink).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(OAA_COLORS.textMuted, "#FFFFFF")).toBeLessThan(4.5);
    expect(contrast(OAA_COLORS.gold, "#FFFFFF")).toBeLessThan(4.5);
  });

  test("la cifra impresa en cada paso de la rampa se lee (≥ 4,5:1)", () => {
    SEQUENTIAL_RAMP.forEach((fill, step) => {
      expect(contrast(inkOnSequentialStep(step), fill), `paso ${step}`).toBeGreaterThanOrEqual(4.5);
    });
  });

  test("la cifra sobre cada paso da lo que dice tokens.css (tinta del 0 al 4, papel del 5 al 7)", () => {
    /* La rampa de la dirección A (18-11-2026), con la tinta #1C1A17 y el papel #FFFFFF: calculado aparte con la fórmula
       de WCAG 2.x, no con la salida de esta prueba. */
    const esperado = [15.02, 13.48, 11.17, 8.79, 6.36, 6.46, 8.54, 16.75];
    SEQUENTIAL_RAMP.forEach((fill, step) => {
      expect(Number(contrast(inkOnSequentialStep(step), fill).toFixed(2)), `paso ${step}`).toBe(esperado[step]);
    });
  });

  test("withAlpha tiñe un color de la paleta sin reescribir canales a mano", () => {
    /* El marino #0F1E33 y el latón #A8824A. */
    expect(withAlpha(OAA_COLORS.spruce, 0.06)).toBe("rgba(15, 30, 51, 0.06)");
    expect(withAlpha(OAA_COLORS.gold, 0.1)).toBe("rgba(168, 130, 74, 0.1)");
  });
});

/* Los colores de los PDF viven en la plantilla única (`src/reports/plantilla/tema.ts`), atados a sus tokens por
   `tests/plantilla/tema.test.ts`; el contraste de los tokens lo mide `tests/contrastePaleta.test.ts`. Hasta el 14-11-2026 aquí se medía también la paleta del papel de cliente de antes, retirada ese día.
   Se queda lo de la pantalla: que cada serie se vea sobre el papel. */
describe("series de la pantalla: contraste sobre el papel", () => {
  test("las seis series y la referencia se ven sobre el papel (≥ 3:1)", () => {
    /* El resto de lo que exige una paleta categórica —banda de claridad, suelo de
       croma, separación bajo daltonismo— se mide con el validador de `dataviz`, que
       vive fuera del repositorio; el resultado de la última pasada (18-11-2026) está
       escrito en `tokens.css`, §5, y en `coloresDeClase.ts`. Aquí se fija lo único que se puede comprobar sin él y lo
       que más fácil se rompe al retocar un color: que cada serie se vea. */
    for (const [i, color] of CHART_PALETTE.entries()) {
      expect(contrast(color, "#FFFFFF"), `serie ${i + 1} (${color})`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(CHART_REFERENCE_COLOR, "#FFFFFF"), `referencia (${CHART_REFERENCE_COLOR})`).toBeGreaterThanOrEqual(3);
  });

  /* Hasta la dirección A el gris de una serie sin color propio era `CHART_PALETTE[6]` y lo cubría la prueba anterior;
     ahora es `--chart-reference` (chartTheme.ts) y se dibuja como LÍNEA, así que se le exige lo mismo que a una serie. */
  test("el gris de una serie sin color propio se ve como línea sobre el papel (≥ 3:1)", () => {
    expect(COLOR_DE_LA_SERIE_SIN_COLOR.toLowerCase()).toBe(token("--chart-reference"));
    expect(contrast(COLOR_DE_LA_SERIE_SIN_COLOR, "#FFFFFF"), COLOR_DE_LA_SERIE_SIN_COLOR).toBeGreaterThanOrEqual(3);
  });

  /* El resto («Otros», «sin clasificar») ya no es una serie de la paleta: es un relleno con su nombre al lado, como lo
     era el dorado de los activos reales (2,58:1). Lo que se le exige es lo de un relleno de reparto: que no se confunda
     con la liquidez, el otro gris, y que no sea texto. */
  test("el gris del resto es solo relleno: no es texto y se separa del gris de la liquidez", () => {
    /* El 3:1 que cubría al resto cuando era `CHART_PALETTE[6]` se cedió a propósito en la dirección A: es solo relleno,
       siempre con su nombre al lado, y tenía que ser más claro para no confundirse con la liquidez; queda un suelo de 2:1
       para que siga viéndose sobre el papel. */
    expect(contrast(CLASS_COLORS.resto, "#FFFFFF")).toBeGreaterThanOrEqual(2);
    expect(contrast(CLASS_COLORS.resto, "#FFFFFF")).toBeLessThan(4.5);
    expect(contrast(CLASS_COLORS.liquidez, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(contrast(CLASS_COLORS.resto, CLASS_COLORS.liquidez)).toBeGreaterThanOrEqual(1.4);
    expect(Number(contrast(CLASS_COLORS.resto, CLASS_COLORS.liquidez).toFixed(2))).toBe(1.44);
  });
});
