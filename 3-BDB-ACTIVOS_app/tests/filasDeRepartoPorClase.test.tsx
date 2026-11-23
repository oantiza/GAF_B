// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { FilasDeReparto } from "../src/components/FilasDeReparto";
import { buildReportFromAssets, CLAVE_SIN_DATO_DEL_REPARTO } from "../src/core/portfolio";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { pintar } from "./piezas/pintar";

/**
 * El reparto por clase de activo de Análisis (Exposición) lleva, delante de cada nombre, el punto del color de su clase:
 * el mismo color del aro de Diseño y de las barras de «En qué está invertida» (14-11-2026, Óscar: «le faltan colores en
 * general»). Los demás repartos (producto, categoría, divisa) no son clases y no lo llevan.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

const FILAS = [
  { clave: "EQUITY", rotulo: "Renta variable", peso: 54 },
  { clave: "fixed_income", rotulo: "Renta fija", peso: 30 },
  { clave: "cash", rotulo: "Liquidez", peso: 9 },
  { clave: "other", rotulo: "Otros", peso: 7 }
];

const puntos = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".clase-con-color__punto")].map((punto) => punto.style.background.toUpperCase());

/**
 * 20-11-2026. Las posiciones que no traen el dato de un reparto —sin divisa declarada— llegan juntas bajo una clave propia
 * (`CLAVE_SIN_DATO_DEL_REPARTO`), y el reparto por divisa de Análisis la escribía tal cual: «N/D», que el sistema no deja en
 * pantalla. Ahora quien pinta dice cuál es esa clave y la fila la escribe la pieza de la ausencia.
 */
describe("la fila de lo que no trae el dato del reparto", () => {
  /* Como llega de `toBuckets`: por peso, y lo que falta donde le toque. */
  const POR_DIVISA = [
    { clave: "EUR", rotulo: "EUR", peso: 50 },
    { clave: CLAVE_SIN_DATO_DEL_REPARTO, rotulo: CLAVE_SIN_DATO_DEL_REPARTO, peso: 30 },
    { clave: "USD", rotulo: "USD", peso: 20 }
  ];
  const textos = (host: HTMLElement) => [...host.querySelectorAll("li")].map((fila) => fila.textContent);

  test("con `claveDeLoQueFalta` dice «Falta el dato» con la pieza, en ocre, y va la última con su peso", () => {
    const vista = pintar(<FilasDeReparto claveDeLoQueFalta={CLAVE_SIN_DATO_DEL_REPARTO} filas={POR_DIVISA} />);
    quitar = vista.quitar;
    expect(textos(vista.host)).toEqual(["EUR50,0 %", "USD20,0 %", "Falta el dato30,0 %"]);
    const ultima = vista.host.querySelector("li:last-child")!;
    expect(ultima.querySelector(".xray-dist-label .ausencia.ausencia--falta")?.textContent).toBe("Falta el dato");
    /* Ni en el texto ni en la ayuda al pasar el ratón. */
    expect(vista.host.innerHTML).not.toContain("N/D");
    /* Las demás filas siguen como estaban. */
    expect([...vista.host.querySelectorAll(".xray-dist-label")].map((rotulo) => rotulo.getAttribute("title"))).toEqual(["EUR", "USD", null]);
    expect(vista.host.querySelectorAll(".ausencia")).toHaveLength(1);
  });

  test("si todo lo que hay es lo que falta, es la única fila", () => {
    const vista = pintar(<FilasDeReparto claveDeLoQueFalta={CLAVE_SIN_DATO_DEL_REPARTO} filas={[POR_DIVISA[1]]} />);
    quitar = vista.quitar;
    expect(textos(vista.host)).toEqual(["Falta el dato30,0 %"]);
  });

  test("sin esa clave en las filas, nada cambia, y sin `claveDeLoQueFalta` la pieza no adivina cuál es", () => {
    const sinHueco = pintar(<FilasDeReparto claveDeLoQueFalta={CLAVE_SIN_DATO_DEL_REPARTO} filas={[POR_DIVISA[0], POR_DIVISA[2]]} />);
    expect(textos(sinHueco.host)).toEqual(["EUR50,0 %", "USD20,0 %"]);
    expect(sinHueco.host.querySelector(".ausencia")).toBeNull();
    sinHueco.quitar();
    const sinClave = pintar(<FilasDeReparto filas={[{ clave: "N/D", rotulo: "Sin sector", peso: 30 }, { clave: "EUR", rotulo: "EUR", peso: 20 }]} />);
    quitar = sinClave.quitar;
    expect(textos(sinClave.host)).toEqual(["Sin sector30,0 %", "EUR20,0 %"]);
  });

  test("la clave no cambia y el reparto la sigue usando: el informe interno la imprime tal cual, y no se toca desde la pantalla", () => {
    expect(CLAVE_SIN_DATO_DEL_REPARTO).toBe("N/D");
    const activo = (asset_id: string, resto: Record<string, unknown>) => ({
      asset_id, display_name: asset_id, instrument_type: "FUND", economic_asset_class: "EQUITY", coverage_status: "COMPLETE",
      is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}, ...resto
    }) as unknown as BdbAssetDetail;
    const informe = buildReportFromAssets({
      source: "BBDD_LIVE_API",
      portfolioName: "",
      manualPositions: [{ asset_id: "CON", weight_percent: 70 }, { asset_id: "SIN", weight_percent: 30 }],
      assets: [activo("CON", { currency: "EUR", region: "Europe" }), activo("SIN", {})]
    });
    expect(informe.xray.by_currency).toEqual([{ key: "EUR", weight_percent: 70 }, { key: "N/D", weight_percent: 30 }]);
    expect(informe.xray.by_region).toEqual([{ key: "Europe", weight_percent: 70 }, { key: "N/D", weight_percent: 30 }]);
  });
});

describe("las filas de un reparto por clase de activo", () => {
  test("con `porClase`, cada fila lleva el punto del color de su clase, por mayúsculas o minúsculas; lo demás, gris", () => {
    const vista = pintar(<FilasDeReparto filas={FILAS} porClase />);
    quitar = vista.quitar;
    expect(puntos(vista.host)).toEqual(["#2F5D8A", "#4E7D6A", "#8A8F98", "#B3AC9E"]);
    /* El punto es decorativo: el texto de la fila no cambia. */
    expect([...vista.host.querySelectorAll("li")].map((fila) => fila.textContent)).toEqual([
      "Renta variable54,0 %",
      "Renta fija30,0 %",
      "Liquidez9,0 %",
      "Otros7,0 %"
    ]);
    expect(vista.host.querySelector(".clase-con-color__punto")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("sin `porClase` (producto, categoría, divisa) no hay punto: no son clases de activo", () => {
    const vista = pintar(<FilasDeReparto filas={[{ clave: "EUR", rotulo: "EUR", peso: 80 }, { clave: "USD", rotulo: "USD", peso: 20 }]} />);
    quitar = vista.quitar;
    expect(puntos(vista.host)).toEqual([]);
    expect(vista.host.textContent).toContain("EUR80,0 %");
  });
});
