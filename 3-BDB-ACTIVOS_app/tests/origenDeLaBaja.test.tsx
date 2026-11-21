import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";
import { FichaInstrumento } from "../src/components/ficha/FichaInstrumento";

/**
 * «Dejó de cotizar» dice de dónde sale (decisión 13 de DECISIONES_DATOS_2026-11-07).
 *
 * Una baja puede ser un juicio nuestro —la CAM: ninguna fuente de precio lo prueba— o lo que contesta la fuente del
 * precio —Aena, por ISIN sustituido—. Antes la ficha solo ponía la fecha, y el contrato decía que DELISTED era que el
 * proveedor ya no lo resuelve, lo que es falso para una baja decidida. Los textos de aquí son los de la base nueva
 * local del 07-11-2026, tal cual.
 */

const MOTIVO_CAM =
  "Absorbida por Banco Sabadell en 2012; sin negociación desde 2011: la CNMV suspendió la negociación de sus cuotas participativas el 09-12-2011, antes de la apertura (Público, 10-12-2011). FIRDS la sigue dando admitida en XMAD desde el 23-07-2008 y sin baja reportada; ninguna fuente de precio la tiene";
const MOTIVO_AENA =
  "ISIN sustituido por ES0105046017: el listado que se le conocía es hoy de ese ISIN según EODHD, y FIRDS conoce ese y no este";

function conBaja(availability: Record<string, unknown>): InstrumentoDeLaBase {
  return {
    isin: "X",
    raiz: { instrument_type: "STOCK", identity: { name: "Un emisor", currency: "EUR" }, availability },
    tarjeta: { instrument_id: "X" },
    calidad: undefined,
    bloques: {}
  };
}

const CAM = conBaja({
  state: "DELISTED",
  since: "2011-12-09",
  reason: `${MOTIVO_CAM}. Baja decidida, no medida: Óscar, decisión 7 del 07-11-2026.`,
  basis: "DECISION",
  decision: { decided_by: "Óscar, decisión 7 del 07-11-2026", decided_at: "2026-11-07", reason: MOTIVO_CAM }
});
const AENA = conBaja({ state: "DELISTED", since: "2026-11-07", reason: MOTIVO_AENA, basis: "SOURCE_EVIDENCE" });

const nota = (instrumento: InstrumentoDeLaBase, modoCliente = false) =>
  (componerFicha(instrumento, undefined, { modoCliente }).disponibilidad.nota ?? []).map((t) => t.texto).join("");

describe("«Dejó de cotizar» dice si es una decisión nuestra o un dato de la fuente", () => {
  test("una baja decidida dice quién, cuándo y el motivo entero, y la fila sigue con su fecha", () => {
    const ficha = componerFicha(CAM);
    expect(ficha.disponibilidad).toMatchObject({ rotulo: "Dejó de cotizar", valor: "09/12/2011", estado: "baja" });
    expect(nota(CAM)).toBe(
      `Baja decidida por nosotros (Óscar, decisión 7 del 07-11-2026, 07/11/2026): ${MOTIVO_CAM}.`
    );
  });

  test("en Modo cliente, la baja decidida dice que la decidió la entidad y por qué, sin autor ni fecha", () => {
    expect(nota(CAM, true)).toBe(`Baja decidida por la entidad: ${MOTIVO_CAM}.`);
    expect(nota(CAM, true)).not.toContain("Óscar");
  });

  test("una baja por evidencia dice que es de la fuente del precio, con su motivo, y no que la decidimos", () => {
    expect(componerFicha(AENA).disponibilidad.valor).toBe("07/11/2026");
    expect(nota(AENA)).toBe(`Lo dice la fuente del precio, no una decisión nuestra: ${MOTIVO_AENA}.`);
    expect(nota(AENA)).not.toContain("decidida");
  });

  test("en Modo cliente, la de la fuente no nombra la cadena de proveedores que la prueba", () => {
    expect(nota(AENA, true)).toBe("Lo dice la fuente del precio, no una decisión nuestra: ya no lo da como cotizando.");
    expect(nota(AENA, true)).not.toContain("EODHD");
  });

  test("un documento anterior a `basis` se lee como evidencia de la fuente, y sin motivo no se inventa ninguno", () => {
    const antiguo = conBaja({ state: "DELISTED", since: "2026-09-21" });
    expect(nota(antiguo)).toBe("Lo dice la fuente del precio, no una decisión nuestra: ya no lo da como cotizando.");
    const decididaSinMotivo = conBaja({
      state: "DELISTED",
      since: "2026-09-11",
      basis: "DECISION",
      decision: { decided_by: "Óscar", decided_at: "2026-11-07" }
    });
    expect(nota(decididaSinMotivo)).toBe("Baja decidida por nosotros (Óscar, 07/11/2026).");
  });

  test("lo que cotiza no lleva nota de baja, y la ficha pinta la nota como aviso entre la respuesta y las pestañas", () => {
    expect(componerFicha(conBaja({ state: "TRADING", last_checked: "2026-11-07" })).disponibilidad.nota).toBeUndefined();
    const html = renderToStaticMarkup(<FichaInstrumento ficha={componerFicha(CAM)} />);
    expect(html).toMatch(/class="aviso aviso--aviso"[^>]*>.*Baja decidida por nosotros/);
    expect(html.indexOf('class="respuesta')).toBeLessThan(html.indexOf("Baja decidida por nosotros"));
    expect(html.indexOf("Baja decidida por nosotros")).toBeLessThan(html.indexOf('role="tablist"'));
  });
});
