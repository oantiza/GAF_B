/**
 * 15-11-2026. El texto que manda el servidor en un `failed-precondition` es el que lee el asesor, y el «[503]» del SDK no
 * se cuelga detrás de un mensaje nuestro. Los textos de los casos son los de `functions_python/optimization/repository.py`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { frontierStateFromError } from "../src/adapters/portfolioFrontierAdapter";
import { AsyncErrorBanner } from "../src/components/AsyncErrorBanner";
import { FrontierHistoricalView } from "../src/components/FrontierHistoricalView";
import { AppError, MENSAJE_GENERICO_PRECONDICION, motivoDelServidor, toAppError } from "../src/core/appError";

const OPTIMIZADOR =
  "El optimizador no ha conseguido una solución con estos activos y restricciones. Prueba con menos restricciones, con otro periodo o quitando algún activo.";
const BASE_CAIDA =
  "No se ha podido leer la base de activos en este momento. Es un fallo pasajero, no que el dato no exista: vuelve a intentarlo en unos segundos.";
const delSdk = (message: string, code = "functions/failed-precondition") => Object.assign(new Error(message), { code });

describe("toAppError con failed-precondition", () => {
  test("con texto propio, ese texto es el mensaje y no queda detalle que lo repita", () => {
    const error = toAppError(delSdk(`${OPTIMIZADOR} [400]`));
    expect(error.message).toBe(OPTIMIZADOR);
    expect(error.detail).toBeUndefined();
    expect(motivoDelServidor(error)).toBe(OPTIMIZADOR);
  });

  test("sin texto, o con el nombre del código que pone el SDK, queda el genérico y el detalle", () => {
    for (const texto of ["", "failed-precondition", "functions/failed-precondition", "FAILED_PRECONDITION"]) {
      const error = toAppError(delSdk(texto));
      expect(error.message).toBe(MENSAJE_GENERICO_PRECONDICION);
    }
    expect(toAppError(delSdk("failed-precondition")).detail).toBe("failed-precondition");
  });

  test("no cambia el tratamiento de otros códigos", () => {
    expect(toAppError(delSdk("Texto del servidor", "functions/invalid-argument")).message).toBe("La petición contiene un dato no válido.");
    expect(toAppError(delSdk("Texto del servidor", "functions/internal")).detail).toBe("Texto del servidor");
  });

  /* 20-11-2026: un fallo del programa en Optimizar llega como `internal` con texto propio, que dice que no es de las restricciones. */
  test("el error interno del optimizador se lee con su texto y su referencia, sin el estado HTTP", () => {
    const texto = "Error interno del optimizador: no es un problema de los activos ni de las restricciones elegidas, y cambiarlas no lo arregla. Ha quedado registrado con la referencia 1a2b3c4d.";
    const error = toAppError(delSdk(`${texto} [500]`, "functions/internal"));
    expect(error.message).toBe(texto);
    expect(error.kind).toBe("BACKEND");
  });
});

describe("el estado de la frontera", () => {
  test("un fallo del optimizador enseña el texto del servidor como texto principal", () => {
    const estado = frontierStateFromError(toAppError(delSdk(`${OPTIMIZADOR} [400]`)));
    expect(estado).toEqual({ status: "error", message: OPTIMIZADOR, textoDelServidor: true });
    expect(frontierStateFromError(delSdk(OPTIMIZADOR))).toEqual(estado);
  });

  test("los textos del optimizador que antes salían en inglés llegan en castellano como mensaje principal", () => {
    for (const texto of [
      "Hacen falta al menos dos activos con precios en euros y suficiente histórico en este periodo. Prueba con otro periodo o con otros activos. [400]",
      "Las posiciones no comparten histórico suficiente para simular esta cartera. Prueba con un periodo más corto o quita los activos con menos historia. [400]"
    ]) {
      const error = toAppError(delSdk(texto));
      expect(error.message).toBe(texto.replace(" [400]", ""));
      expect(error.detail).toBeUndefined();
    }
  });

  test("la pantalla lo lee sin «Detalle técnico» repetido", () => {
    const html = renderToStaticMarkup(createElement(FrontierHistoricalView, { state: frontierStateFromError(delSdk(OPTIMIZADOR)) }));
    expect(html).toContain("Prueba con menos restricciones");
    expect(html).not.toContain("Detalle técnico");
    expect(html.split("Prueba con menos restricciones").length).toBe(2);
  });

  test("el límite de activos a un año conserva su aviso y los «Sin solución» su tratamiento", () => {
    const limite =
      "El cálculo admite 13 activos como máximo y esta cartera tiene 14 con el periodo de 1 año: con 53 semanas de datos son pocos datos por activo. Pasa a 3 años, que admite 40, o quita activos hasta dejar 13.";
    const estado = frontierStateFromError(delSdk(limite));
    expect(estado.status === "error" && estado.limiteDelPeriodo).toBeTruthy();
    const sin = frontierStateFromError(toAppError(delSdk("Sin solución: ninguna cartera cumple lo pedido. [400]")));
    expect(sin).toEqual({ status: "error", message: "Sin solución: ninguna cartera cumple lo pedido." });
  });
});

describe("el «[503]» del SDK", () => {
  test("no sale detrás del fallo de lectura de la base", () => {
    const error = toAppError(delSdk(`${BASE_CAIDA} [503]`, "functions/unavailable"));
    expect(error.message).toBe(BASE_CAIDA);
    expect(renderToStaticMarkup(createElement(AsyncErrorBanner, { error }))).not.toContain("[503]");
  });

  test("en un fallo genérico se conserva en el detalle técnico, donde identifica el fallo", () => {
    const html = renderToStaticMarkup(createElement(AsyncErrorBanner, { error: toAppError(delSdk("backend exploded [503]", "functions/unavailable")) }));
    expect(html).toContain("backend exploded [503]");
  });

  test("un AppError ya traducido pasa tal cual", () => {
    expect(toAppError(new AppError("BACKEND", "x")).message).toBe("x");
  });
});
