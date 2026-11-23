// @vitest-environment happy-dom
/**
 * El formulario de alta y edición de un movimiento: que editar no borra lo que no enseña
 * (GES-04), que el precio que propone sigue a la fecha y no se inventa en series ajustadas
 * por dividendos (GES-05), que avisa de un precio muy alejado del de mercado (DIR-03), que
 * escribe el importe sugerido en español (DIR-06) y que rotula el precio de un fondo como
 * valor liquidativo (DIR-07).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demostracion } from "../../src/gestor/demo/carteraDemo";
import { LARGO_DEL_CONCEPTO, type Cartera, type Movimiento } from "../../src/gestor/motor/modelo";
import type { DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { FormularioDeMovimiento } from "../../src/gestor/ui/dialogos/FormularioDeMovimiento";
import { activo, cartera, mov, serie } from "./ayudas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOY = "2026-11-13";

let root: Root | undefined;
let vista: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vista?.remove();
  root = undefined;
  document.body.innerHTML = "";
});

async function pintar(props: { cartera: Cartera; precios: DatosDeMercado; movimiento?: Movimiento; inicial?: Partial<Movimiento> }) {
  const alGuardar = vi.fn();
  vista = document.createElement("div");
  document.body.append(vista);
  root = createRoot(vista);
  await act(async () => root!.render(<FormularioDeMovimiento alCerrar={() => undefined} alGuardar={alGuardar} hoy={HOY} {...props} />));
  return alGuardar;
}

/** El campo cuyo rótulo es exactamente ese texto. */
function campo(rotulo: string): HTMLElement {
  const encontrado = [...document.body.querySelectorAll<HTMLElement>(".field")].find((label) => label.querySelector(".field__label")?.textContent === rotulo);
  if (!encontrado) throw new Error(`No hay un campo «${rotulo}»`);
  return encontrado;
}

function entrada(rotulo: string): HTMLInputElement {
  return campo(rotulo).querySelector("input")!;
}

async function escribir(rotulo: string, valor: string) {
  const input = entrada(rotulo);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function pulsar(texto: string) {
  const boton = [...document.body.querySelectorAll("button")].find((candidato) => candidato.textContent?.trim() === texto);
  if (!boton) throw new Error(`No hay un botón «${texto}»`);
  await act(async () => boton.click());
}

/* Un fondo y un ETF de la plataforma, con su serie. El del ETF viene ajustada por dividendos. */
const FONDO = activo("F", "FONDO", "EUR", { origen: "catalogo", isin: "LU0000000001" });
const ETF = activo("E", "ETF", "EUR", { origen: "catalogo", isin: "IE0000000001" });
const MERCADO: DatosDeMercado = {
  precios: new Map([
    ["F", serie(["2025-06-30", 105], ["2026-11-13", 110])],
    ["E", serie(["2024-11-13", 80], ["2026-11-13", 100])]
  ]),
  cambios: new Map(),
  ajustadasPorDividendos: new Set(["E"])
};
const CARTERA = cartera([FONDO, ETF], [mov("aportacion", "2024-01-02", { importe: "100000" })]);

describe("GES-04 · editar un movimiento no borra lo que el formulario no enseña", () => {
  it("guardar el split de la demostración sin tocar nada lo deja igual que el original", async () => {
    const demo = demostracion(HOY);
    const split = demo.cartera.movimientos.find((movimiento) => movimiento.tipo === "split")!;
    expect(split.serieAjustada).toBe(false);
    const alGuardar = await pintar({ cartera: demo.cartera, precios: demo.mercado, movimiento: split });
    await pulsar("Guardar los cambios");
    expect(alGuardar).toHaveBeenCalledTimes(1);
    expect(alGuardar.mock.calls[0][0]).toEqual(split);
  });

  it("un campo desconocido, la fecha valor y el cambio sobreviven a la edición de la nota", async () => {
    /* `cambio` no se enseña (todo es en euros) y `x` no lo conoce esta versión: los dos se conservan. */
    const original = { ...mov("suscripcion", "2025-06-30", { id: "m-1", activoId: "F", titulos: "10", precio: "105", importe: "-1050", fechaValor: "2025-07-02", cambio: "1", nota: "Antes", origen: { via: "manual" } }), x: 1 } as Movimiento;
    const alGuardar = await pintar({ cartera: { ...CARTERA, movimientos: [...CARTERA.movimientos, original] }, precios: MERCADO, movimiento: original });
    await escribir("Nota (opcional)", "Después");
    await pulsar("Guardar los cambios");
    expect(alGuardar.mock.calls[0][0]).toEqual({ ...original, nota: "Después" });
  });

  it("si se cambia de tipo, los campos del tipo anterior que el nuevo no enseña se quitan; los desconocidos, no", async () => {
    const original = { ...mov("suscripcion", "2025-06-30", { id: "m-2", activoId: "F", titulos: "10", precio: "105", comision: "2", importe: "-1052", origen: { via: "manual" } }), x: 1 } as Movimiento;
    const alGuardar = await pintar({ cartera: { ...CARTERA, movimientos: [...CARTERA.movimientos, original] }, precios: MERCADO, movimiento: original });
    const selector = campo("Tipo de movimiento").querySelector("select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(selector, "aportacion");
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const rotuloDelImporte = [...document.body.querySelectorAll(".field__label")].map((nodo) => nodo.textContent ?? "").find((texto) => texto.startsWith("Importe"))!;
    await escribir(rotuloDelImporte, "1000");
    await pulsar("Guardar los cambios");
    expect(alGuardar).toHaveBeenCalledTimes(1);
    expect(alGuardar.mock.calls[0][0]).toEqual({ id: "m-2", tipo: "aportacion", fechaOperacion: "2025-06-30", importe: "1000", origen: { via: "manual" }, x: 1 });
  });

  it("el split enseña la casilla de la serie ajustada, y cambiarla cambia el movimiento", async () => {
    const demo = demostracion(HOY);
    const split = demo.cartera.movimientos.find((movimiento) => movimiento.tipo === "split")!;
    const alGuardar = await pintar({ cartera: demo.cartera, precios: demo.mercado, movimiento: split });
    const casilla = [...document.body.querySelectorAll<HTMLLabelElement>("label")].find((label) => label.textContent?.includes("La serie de precios de la plataforma ya viene ajustada por este split"))?.querySelector<HTMLInputElement>("input[type=checkbox]");
    expect(casilla).toBeDefined();
    expect(casilla!.checked).toBe(false);
    await act(async () => casilla!.click());
    await pulsar("Guardar los cambios");
    expect(alGuardar.mock.calls[0][0]).toEqual({ ...split, serieAjustada: true });
  });
});

describe("GES-05 y DIR-06 · el precio propuesto sigue a la fecha y el importe sale en español", () => {
  it("al cambiar la fecha vuelve a proponer el precio de ese día y recalcula el importe", async () => {
    await pintar({ cartera: CARTERA, precios: MERCADO, inicial: { tipo: "suscripcion", activoId: "F" } });
    await escribir("Fecha de operación", "2025-06-30");
    expect(entrada("Valor liquidativo").value).toBe("105");
    await escribir("Participaciones", "12,5");
    /* 12,5 × 105 = 1.312,50 */
    expect(entrada("Importe pagado").value).toBe("1.312,50");
    await escribir("Fecha de operación", "2026-11-13");
    expect(entrada("Valor liquidativo").value).toBe("110");
    /* 12,5 × 110 = 1.375,00 */
    expect(entrada("Importe pagado").value).toBe("1.375,00");
  });

  it("un precio tecleado no se cambia al mover la fecha", async () => {
    await pintar({ cartera: CARTERA, precios: MERCADO, inicial: { tipo: "suscripcion", activoId: "F" } });
    await escribir("Valor liquidativo", "107");
    await escribir("Fecha de operación", "2025-06-30");
    expect(entrada("Valor liquidativo").value).toBe("107");
  });

  it("en una serie ajustada por dividendos, una fecha pasada no rellena el precio y lo da como pista aproximada", async () => {
    await pintar({ cartera: CARTERA, precios: MERCADO, inicial: { tipo: "compra", activoId: "E" } });
    await escribir("Fecha de operación", "2025-03-03");
    expect(entrada("Precio por título").value).toBe("");
    const pista = campo("Precio por título").querySelector(".field__hint")?.textContent ?? "";
    expect(pista).toContain("aproximado");
    expect(pista).toContain("80,00 €");
    expect(pista).toContain("dividendos");
    /* Hoy la serie no está ajustada por nada posterior: el precio se rellena. */
    await escribir("Fecha de operación", "2026-11-13");
    expect(entrada("Precio por título").value).toBe("100");
  });
});

describe("DIR-03 · aviso de un precio muy alejado del de mercado", () => {
  it("avisa, sin bloquear, si el precio escrito se aleja más de un 20 % del de ese día", async () => {
    const alGuardar = await pintar({ cartera: CARTERA, precios: MERCADO, inicial: { tipo: "suscripcion", activoId: "F" } });
    await escribir("Fecha de operación", "2025-06-30");
    await escribir("Participaciones", "10");
    await escribir("Valor liquidativo", "52,5");
    /* 52,5 / 105 − 1 = −50 % */
    const pista = campo("Valor liquidativo").querySelector(".field__hint")?.textContent ?? "";
    expect(pista).toBe("El precio escrito se aleja un 50 % del de ese día, 105,00 €. Compruébalo.");
    await pulsar("Añadir a la cartera");
    expect(alGuardar).toHaveBeenCalledTimes(1);
  });

  it("no avisa dentro del 20 %", async () => {
    await pintar({ cartera: CARTERA, precios: MERCADO, inicial: { tipo: "suscripcion", activoId: "F" } });
    await escribir("Fecha de operación", "2025-06-30");
    /* 120 / 105 − 1 = +14,3 % */
    await escribir("Valor liquidativo", "120");
    expect(campo("Valor liquidativo").querySelector(".field__hint")).toBeNull();
  });

  it("con una serie ajustada por dividendos, dice que la comparación es aproximada", async () => {
    await pintar({ cartera: CARTERA, precios: MERCADO, inicial: { tipo: "compra", activoId: "E" } });
    await escribir("Fecha de operación", "2025-03-03");
    /* 40 / 80 − 1 = −50 % */
    await escribir("Precio por título", "40");
    const pista = campo("Precio por título").querySelector(".field__hint")?.textContent ?? "";
    expect(pista).toContain("se aleja un 50 %");
    expect(pista).toContain("aproximada");
  });
});

describe("DIR-07 · el precio de un fondo es su valor liquidativo", () => {
  it("rotula «Valor liquidativo» en suscripción y reembolso, y «Precio por título» en compra y venta", async () => {
    for (const [tipo, rotulo] of [["suscripcion", "Valor liquidativo"], ["reembolso", "Valor liquidativo"], ["compra", "Precio por título"], ["venta", "Precio por título"]] as const) {
      await pintar({ cartera: CARTERA, precios: MERCADO, inicial: { tipo } });
      expect(campo(rotulo)).toBeDefined();
      await act(async () => root!.unmount());
      root = undefined;
      document.body.innerHTML = "";
    }
  });
});

describe("A-199 · la ayuda del precio dice de dónde sale la divisa del activo", () => {
  /* Un ETF del catálogo con la ficha en dólares, comprado con euros: su divisa no es la de una bolsa, es la de su ficha. */
  const DEL_CATALOGO = activo("U", "ETF", "USD", { origen: "catalogo", isin: "IE0000000002" });
  const PROPIO = activo("P", "ACCION", "USD");

  it("del catálogo, «la divisa de su ficha en el catálogo»; dado de alta a mano, «la divisa con la que se dio de alta»; nunca «en la que cotiza»", async () => {
    for (const [elActivo, frase] of [
      [DEL_CATALOGO, "En USD, la divisa de su ficha en el catálogo."],
      [PROPIO, "En USD, la divisa con la que se dio de alta el activo."]
    ] as const) {
      const conEl = cartera([elActivo], [mov("aportacion", "2024-01-02", { importe: "100000" })]);
      await pintar({ cartera: conEl, precios: { precios: new Map(), cambios: new Map() }, inicial: { tipo: "compra", activoId: elActivo.id } });
      const texto = campo("Precio por título").textContent ?? "";
      expect(texto).toContain(frase);
      expect(texto).not.toContain("la divisa en la que cotiza");
      await act(async () => root!.unmount());
      root = undefined;
      document.body.innerHTML = "";
    }
  });
});

/* El concepto para el cliente (Óscar, 21-11-2026): solo en la comisión o gasto y en el otro cargo o abono. */
describe("el formulario pide el concepto para el cliente solo en los cargos", () => {
  const conMovimiento = (movimiento: Movimiento) => pintar({ cartera: { ...CARTERA, movimientos: [...CARTERA.movimientos, movimiento] }, precios: MERCADO, movimiento });
  const rotulos = () => [...document.body.querySelectorAll(".field__label")].map((nodo) => nodo.textContent ?? "");
  const entrada = (rotulo: string) => [...document.body.querySelectorAll<HTMLElement>(".field")].find((campo) => campo.querySelector(".field__label")?.textContent === rotulo)!.querySelector("input")!;

  it("en una comisión lo enseña, lo guarda recortado y vacío lo quita", async () => {
    const original = mov("comision", "2026-03-31", { id: "c-1", importe: "-30.25", nota: "Lo del trimestre", origen: { via: "manual" } });
    const alGuardar = await conMovimiento(original);
    expect(rotulos()).toContain("Concepto para el cliente (opcional)");
    expect(entrada("Concepto para el cliente (opcional)").maxLength).toBe(LARGO_DEL_CONCEPTO);
    const escribir = async (valor: string) => {
      const input = entrada("Concepto para el cliente (opcional)");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const guardar = async () => {
      const boton = [...document.body.querySelectorAll("button")].find((candidato) => candidato.textContent?.trim() === "Guardar los cambios")!;
      await act(async () => boton.click());
    };
    await escribir("  Custodia del primer trimestre  ");
    await guardar();
    expect(alGuardar.mock.calls[0][0]).toEqual({ ...original, conceptoCliente: "Custodia del primer trimestre" });
    await escribir("   ");
    await guardar();
    expect(alGuardar.mock.calls[1][0]).toEqual(original);
  });

  it("en una aportación no lo enseña", async () => {
    await conMovimiento(mov("aportacion", "2026-03-31", { id: "a-1", importe: "100", origen: { via: "manual" } }));
    expect(rotulos().some((rotulo) => rotulo.startsWith("Concepto para el cliente"))).toBe(false);
    expect(rotulos()).toContain("Nota (opcional)");
  });
});
