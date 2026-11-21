/**
 * El demo simula «Rentabilidad objetivo» con el mismo contrato que el servidor (decisión 61): por debajo de la de menor riesgo, esa; por
 * encima de lo que se puede dar, «Sin solución» con su cifra; y sin series no hay medida, así que no la inventa.
 */
import { describe, expect, test } from "vitest";
import { demoResponse } from "../src/adapters/demoBackend";
import { frontierStateFromError, frontierStateFromRawResponse } from "../src/adapters/portfolioFrontierAdapter";
import { notaDeLaRentabilidadObjetivo } from "../src/core/notaDeLaPropuesta";
import { PREFIJO_SIN_SOLUCION } from "../src/types/portfolioFrontier";

const IDS = ["A1", "B22", "C333", "D4444", "E55555"];
const peticion = (objetivo: unknown, extra: Record<string, unknown> = {}) => ({
  schema_version: "portfolio-optimization-request.v1",
  asset_ids: IDS,
  window: "3Y",
  objective: "TARGET_RETURN",
  target_return: objetivo,
  current_weights: Object.fromEntries(IDS.map((id) => [id, 0.2])),
  ...extra
});

type Punto = { expected_return: number; volatility: number; weights: Record<string, number> };
type Respuesta = {
  min_volatility_portfolio: Punto;
  max_sharpe_portfolio: Punto;
  target_return_portfolio: Punto;
  target_portfolio?: Punto;
  target_return_measured?: unknown;
  methodology: { target_return?: number; target_return_floor?: number };
};

const responder = async (objetivo: unknown, extra?: Record<string, unknown>) =>
  (await demoResponse("optimize_portfolio", peticion(objetivo, extra))) as unknown as Respuesta;

const rentabilidades = async () => {
  const base = await responder(0);
  return { baja: base.min_volatility_portfolio.expected_return, sharpe: base.max_sharpe_portfolio.expected_return };
};

/** Lo más que se llega sin tope: todo en el activo que más rinde. */
const techo = async () => {
  const respuesta = (await demoResponse("optimize_portfolio", { ...peticion(0), objective: "MAX_SHARPE" })) as unknown as { frontier: Punto[] };
  return Math.max(...respuesta.frontier.map((punto) => punto.expected_return));
};

describe("Rentabilidad objetivo en el demo", () => {
  test("entre la de menor riesgo y Máximo Sharpe da exactamente lo pedido, y solo lo manda en su campo", async () => {
    const { baja, sharpe } = await rentabilidades();
    const objetivo = (baja + sharpe) / 2;
    const respuesta = await responder(objetivo);
    expect(respuesta.target_return_portfolio.expected_return).toBeCloseTo(objetivo, 5);
    expect(respuesta.methodology.target_return).toBe(objetivo);
    expect(respuesta.target_portfolio).toBeUndefined();
  });

  test("por encima de Máximo Sharpe sigue subiendo: no se queda en ella diciendo que llega", async () => {
    const { sharpe } = await rentabilidades();
    const arriba = await techo();
    const objetivo = (sharpe + arriba) / 2;
    expect(objetivo).toBeGreaterThan(sharpe);
    expect((await responder(objetivo)).target_return_portfolio.expected_return).toBeCloseTo(objetivo, 5);
  });

  test("por debajo de la de menor riesgo, esa cartera, como el servidor", async () => {
    const respuesta = await responder(-0.5);
    expect(respuesta.target_return_portfolio.weights).toEqual(respuesta.min_volatility_portfolio.weights);
    expect(respuesta.methodology.target_return).toBe(-0.5);
    expect(respuesta.methodology.target_return_floor).toBeCloseTo(respuesta.min_volatility_portfolio.expected_return, 5);
    const estado = frontierStateFromRawResponse(respuesta);
    if (estado.status !== "result") throw new Error("sin resultado");
    expect(notaDeLaRentabilidadObjetivo(estado.model)).toContain("la cartera de menor riesgo ya tiene una media de la serie del");
  });

  test("lo inalcanzable es «Sin solución», con su cifra, y la pantalla lo enseña como tal", async () => {
    const error = await responder(5).then(() => null, (causa: unknown) => causa);
    expect(error).toBeInstanceOf(Error);
    const estado = frontierStateFromError(error);
    expect(estado.status).toBe("error");
    if (estado.status !== "error") return;
    expect(estado.message.startsWith(PREFIJO_SIN_SOLUCION)).toBe(true);
    expect(estado.message).toContain("la media de la serie llega como mucho");
    /* Una rentabilidad: con su signo (apartado 6). */
    expect(estado.message).toContain("y has pedido un +500,00\u00a0%");
  });

  test("sin series no hay medida: la pantalla dice que falta, y no habla de regularizar", async () => {
    const { baja, sharpe } = await rentabilidades();
    const respuesta = await responder((baja + sharpe) / 2);
    expect(respuesta.target_return_measured).toBeUndefined();
    const estado = frontierStateFromRawResponse(respuesta);
    expect(estado.status).toBe("result");
    if (estado.status !== "result") return;
    const nota = notaDeLaRentabilidadObjetivo(estado.model);
    expect(nota).toContain("La medida con la serie no está: falta el dato.");
    expect(nota).not.toContain("regularizadas");
  });
});
