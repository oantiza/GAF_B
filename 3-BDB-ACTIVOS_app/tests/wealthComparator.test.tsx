import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { PatrimonialComparison } from "../src/adapters/macroReferenceBackend";
import {
  WealthComparator,
  WealthComparisonResults
} from "../src/components/WealthComparator";

const comparison: PatrimonialComparison = {
  cartera: {
    valor_final_bruto: 100000,
    valor_final_neto: 93450,
    tir_nominal_bruta_pct: 7.5,
    tir_nominal_neta_pct: 6.2,
    tir_real_bruta_pct: 4.4,
    tir_real_neta_pct: 3.1
  },
  letras: {
    valor_final_bruto: 82750,
    valor_final_neto: 80120,
    tir_nominal_bruta_pct: 3.1,
    tir_nominal_neta_pct: 2.5,
    tir_real_bruta_pct: 0.2,
    tir_real_neta_pct: -0.4
  },
  deposito: {
    valor_final_bruto: 81000,
    valor_final_neto: 78750,
    tir_nominal_bruta_pct: 2.8,
    tir_nominal_neta_pct: 2.2,
    tir_real_bruta_pct: -0.1,
    tir_real_neta_pct: null
  }
};

const brackets = [
  { threshold_eur: 0, rate_pct: 19 },
  { threshold_eur: 7500, rate_pct: 20 },
  { threshold_eur: 15000, rate_pct: 22 },
  { threshold_eur: 30000, rate_pct: 24 },
  { threshold_eur: 50000, rate_pct: 25.5 },
  { threshold_eur: 90000, rate_pct: 26 },
  { threshold_eur: 120000, rate_pct: 26.5 },
  { threshold_eur: 240000, rate_pct: 27 },
  { threshold_eur: 300000, rate_pct: 28 }
];

function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

describe("WealthComparator", () => {
  test("renderiza el depósito, el toggle exacto y la mecánica fiscal aprobada", () => {
    const html = renderToStaticMarkup(<WealthComparator />);
    const text = plainText(html);

    expect(text).toContain("Tipo del depósito (% anual)");
    expect(text).toContain("Vacío: curva histórica por año. El tipo fijo se renueva anualmente.");
    expect(text).toContain("Neto de impuestos (Bizkaia)");
    expect(text).toContain(
      "La cartera difiere impuestos hasta el reembolso (liquidación simulada al final del horizonte); depósitos y Letras tributan al devengo"
    );
    expect(text).toContain("En la simulación, el depósito liquida cada año y las Letras una sola vez al vencimiento final.");
    expect(html).toMatch(/<input[^>]+type="number"[^>]+placeholder="Curva histórica"/);
    expect(html).toMatch(/<input[^>]+type="number"[^>]+min="-5"[^>]+max="25"/);
    expect(html).toMatch(/<input[^>]+type="checkbox"/);
  });

  test("abre vacío: ni una cifra inventada, y sin Magnitudes clave hasta que haya datos", () => {
    const text = plainText(renderToStaticMarkup(<WealthComparator />));
    expect(text).toContain("Introduce tus aportaciones y el valor final");
    expect(text).toContain("Cargar ejemplo");
    expect(text).not.toContain("Magnitudes clave");
    for (const cifra of ["70.000", "95.000", "50.000", "20.000", "6,11"]) expect(text).not.toContain(cifra);
    /* Y los campos, vacíos: un cero creíble es peor que nada. */
    const html = renderToStaticMarkup(<WealthComparator />);
    expect(html).not.toContain('value="95.000"');
    expect(html).not.toContain('value="0"');
  });
});

describe("WealthComparisonResults", () => {
  test("muestra la vista bruta de las tres alternativas y la escala completa", () => {
    const html = renderToStaticMarkup(
      <WealthComparisonResults
        comparison={comparison}
        netTaxes={false}
        depositRateUsedPct={null}
        taxBrackets={brackets}
      />
    );
    const text = plainText(html);

    expect(html).toContain('data-tax-mode="bruto"');
    expect(text).toContain("Valor final bruto");
    expect(text).toContain("Cartera introducida100.000,00 €+7,50 %+4,40 %");
    expect(text).toContain("Letras del Tesoro82.750,00 €+3,10 %+0,20 %");
    expect(text).toContain("Depósito bancario (curva histórica anual)81.000,00 €+2,80 %−0,10 %");
    expect(text).toContain("Escala progresiva Bizkaia:");
    expect(text).toContain("desde 0 €: 19 %");
    expect(text).toContain("desde 7.500 €: 20 %");
    expect(text).toContain("desde 50.000 €: 25,5 %");
    expect(text).toContain("desde 300.000 €: 28 %");
    expect(text).not.toContain("Ejemplo");
  });

  test("lo que sale del ejemplo lo dice en cada fila", () => {
    const text = plainText(renderToStaticMarkup(<WealthComparisonResults comparison={comparison} ejemplo netTaxes={false} />));
    expect(text.match(/Ejemplo/g) ?? []).toHaveLength(3);
  });

  test("cambia a valores netos y etiqueta el tipo fijo renovable", () => {
    const html = renderToStaticMarkup(
      <WealthComparisonResults
        comparison={comparison}
        netTaxes
        depositRateUsedPct={2.75}
        taxBrackets={brackets}
      />
    );
    const text = plainText(html);

    expect(html).toContain('data-tax-mode="neto"');
    expect(text).toContain("Valor final neto");
    expect(text).toContain("Cartera introducida93.450,00 €+6,20 %+3,10 %");
    expect(text).toContain("Letras del Tesoro80.120,00 €+2,50 %−0,40 %");
    expect(text).toContain("Depósito bancario (2,75 % fijo, renovación anual)78.750,00 €+2,20 %Falta el dato");
    expect(text).not.toContain("100.000,00 €");
  });
});
