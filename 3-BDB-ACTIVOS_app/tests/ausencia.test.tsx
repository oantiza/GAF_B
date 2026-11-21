import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Ausencia, CifraOAusencia } from "../src/components/ui/Ausencia";
import { KpiStrip } from "../src/components/ui/KpiStrip";
import { oFalta, porcentaje } from "../src/core/formato";
import { textoDeAusencia } from "../src/core/textoDeAusencia";

const pinta = (nodo: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(<>{nodo}</>);
const conDosDecimales = (v: number) => oFalta(porcentaje(v));

describe("la pieza que escribe que un dato no está", () => {
  test("los tres textos son fijos, y «Falta» solo en una columna estrecha", () => {
    expect(textoDeAusencia("no-aplica")).toBe("No aplica");
    expect(textoDeAusencia("falta")).toBe("Falta el dato");
    expect(textoDeAusencia("sin-pedir")).toBe("Sin pedir");

    expect(textoDeAusencia("falta", { estrecha: true })).toBe("Falta");
    expect(textoDeAusencia("no-aplica", { estrecha: true })).toBe("No aplica");
    expect(textoDeAusencia("sin-pedir", { estrecha: true })).toBe("Sin pedir");
  });

  test("cada clase se pinta con la suya, porque no aplica y falta no se pintan igual", () => {
    expect(pinta(<Ausencia clase="no-aplica" />)).toBe('<span class="ausencia ausencia--no-aplica">No aplica</span>');
    expect(pinta(<Ausencia clase="falta" />)).toBe('<span class="ausencia ausencia--falta">Falta el dato</span>');
    expect(pinta(<Ausencia clase="falta" estrecha />)).toBe('<span class="ausencia ausencia--falta">Falta</span>');
    expect(pinta(<Ausencia clase="sin-pedir" />)).toBe('<span class="ausencia ausencia--sin-pedir">Sin pedir</span>');
  });

  test("un motivo mejor cambia el texto, no la clase", () => {
    expect(pinta(<Ausencia clase="no-aplica" motivo="Sin capital fijado" />)).toBe(
      '<span class="ausencia ausencia--no-aplica">Sin capital fijado</span>'
    );
  });

  test("nunca escribe un guion, que se lee como cero, ni «N/D»", () => {
    for (const clase of ["no-aplica", "falta", "sin-pedir"] as const) {
      for (const estrecha of [false, true]) {
        const texto = textoDeAusencia(clase, { estrecha });
        expect(texto).not.toMatch(/^[-–—]$/);
        expect(texto).not.toBe("N/D");
      }
    }
  });

  test("CifraOAusencia escribe la cifra si la hay, y un cero es una cifra", () => {
    expect(pinta(<CifraOAusencia valor={0.1736} escribir={conDosDecimales} clase="falta" />)).toBe("17,36\u00a0%");
    expect(pinta(<CifraOAusencia valor={0} escribir={conDosDecimales} clase="falta" />)).toBe("0,00\u00a0%");
    expect(pinta(<CifraOAusencia valor={-0.05} escribir={conDosDecimales} clase="falta" />)).toBe("−5,00\u00a0%");
  });

  test("CifraOAusencia dice que falta si no hay cifra de verdad", () => {
    for (const valor of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pinta(<CifraOAusencia valor={valor} escribir={conDosDecimales} clase="falta" />)).toContain("Falta el dato");
    }
    expect(pinta(<CifraOAusencia valor={null} escribir={conDosDecimales} clase="no-aplica" />)).toContain("No aplica");
    expect(pinta(<CifraOAusencia valor={null} escribir={conDosDecimales} clase="falta" estrecha />)).toBe(
      '<span class="ausencia ausencia--falta">Falta</span>'
    );
  });

  test("el formato único tampoco escribe «N/D»: lo que falta no se formatea, y el papel dice «Falta el dato»", () => {
    /* Hasta el 14-11-2026 el papel escribía «N/D» con el módulo de formato antiguo, que ya no existe. */
    expect(porcentaje(null)).toBeNull();
    expect(oFalta(porcentaje(null))).toBe("Falta el dato");
  });

  test("entra en la tira de cifras", () => {
    const html = pinta(<KpiStrip items={[{ label: "Volatilidad", value: <Ausencia clase="falta" /> }]} />);
    expect(html).toContain('<span class="ausencia ausencia--falta">Falta el dato</span>');
  });
});
