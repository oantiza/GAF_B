import { describe, expect, it } from "vitest";
import {
  isAppRouteId,
  pathForAsset,
  pathForRoute,
  resolveRoute,
  routeIdFromPath
} from "../src/app/appRoutes";

describe("app routes (mapa 15→9, ola 3b)", () => {
  it("resolves every primary route", () => {
    expect(routeIdFromPath("/mercado")).toBe("mercado");
    expect(routeIdFromPath("/buscador")).toBe("buscador");
    expect(routeIdFromPath("/comparador")).toBe("comparador");
    expect(routeIdFromPath("/cartera")).toBe("cartera");
    expect(routeIdFromPath("/cartera/informes?cliente=1")).toBe("informes");
    expect(routeIdFromPath("/analisis")).toBe("analisis");
    expect(routeIdFromPath("/cartera-real/")).toBe("cartera-real");
    expect(routeIdFromPath("/posiciones")).toBe("posiciones");
    expect(routeIdFromPath("/carteras-guardadas")).toBe("carteras-guardadas");
    expect(routeIdFromPath("/jubilacion")).toBe("jubilacion");
    expect(routeIdFromPath("/jubilacion/planes")).toBe("planes");
    /* La ficha de un plan va al final de la dirección: el destino sigue siendo el catálogo de planes. */
    expect(routeIdFromPath("/jubilacion/planes#plan=F00000Q2PL")).toBe("planes");
    expect(routeIdFromPath("/salud-catalogo")).toBe("salud-catalogo");
    expect(routeIdFromPath("/sistema/")).toBe("sistema");
  });

  it("redirects the old 15-destination map with tab intent", () => {
    expect(resolveRoute("/agenda")).toEqual({
      id: "mercado",
      intent: { kind: "mercado-tab", tab: "calendario" }
    });
    expect(resolveRoute("/estrategia")).toEqual({
      id: "mercado",
      intent: { kind: "mercado-tab", tab: "estrategia" }
    });
    expect(resolveRoute("/cartera/optimizacion")).toEqual({
      id: "cartera",
      intent: { kind: "builder-panel", panel: "optimization" }
    });
    expect(routeIdFromPath("/dashboard")).toBe("analisis");
    expect(routeIdFromPath("/xray?cliente=1")).toBe("analisis");
    expect(routeIdFromPath("/informes")).toBe("informes");
    expect(routeIdFromPath("/admin")).toBe("sistema");
  });

  it("sends the root, /inicio and unknown paths to the Constructor", () => {
    expect(routeIdFromPath("/")).toBe("cartera");
    expect(routeIdFromPath("/inicio")).toBe("cartera");
    expect(routeIdFromPath("/ruta-inexistente")).toBe("cartera");
  });

  it("marks an unknown path as such, so the screen can say it does not exist", () => {
    expect(resolveRoute("/ruta-inexistente")).toEqual({ id: "cartera", intent: { kind: "desconocida" } });
    expect(resolveRoute("/")).toEqual({ id: "cartera" });
    expect(resolveRoute("/index.html")).toEqual({ id: "cartera" });
    expect(resolveRoute("/cartera")).toEqual({ id: "cartera" });
  });

  it("builds and validates route identifiers", () => {
    expect(pathForRoute("mercado")).toBe("/mercado");
    expect(pathForRoute("cartera")).toBe("/cartera");
    expect(pathForRoute("informes")).toBe("/cartera/informes");
    expect(pathForRoute("analisis")).toBe("/analisis");
    expect(pathForRoute("sistema")).toBe("/sistema");
    expect(isAppRouteId("posiciones")).toBe(true);
    expect(isAppRouteId("sistema")).toBe(true);
    expect(isAppRouteId("informes")).toBe(true);
    // Los destinos retirados del mapa ya no son ids de ruta.
    expect(isAppRouteId("inicio")).toBe(false);
    expect(isAppRouteId("dashboard")).toBe(false);
    expect(isAppRouteId("xray")).toBe(false);
    expect(isAppRouteId("optimizacion")).toBe(false);
    expect(isAppRouteId("guardadas")).toBe(false);
    expect(isAppRouteId("admin")).toBe(false);
  });
});

/**
 * Decisión 1 del rediseño (02-11-2026). Cada prueba de aquí fija un cambio del mapa y
 * nombra lo que dejaría pasar si no existiera.
 */
describe("el mapa del 02-11-2026", () => {
  it("«Posiciones globales» deja de ser destino y pasa a ser un modo, sin romper su URL", () => {
    /* Era el MISMO componente que «Extracto externo» —`PositionsWorkbench`, modos
       `global` y `extracto`— en otra sección del rail. Lo que no puede pasar es que el
       enlace viejo abra el modo que no es: por eso la redirección lleva intención. */
    expect(isAppRouteId("posiciones-globales")).toBe(false);
    expect(resolveRoute("/posiciones-globales")).toEqual({
      id: "posiciones",
      intent: { kind: "posiciones-modo", modo: "global" }
    });
    expect(resolveRoute("/posiciones")).toEqual({ id: "posiciones" });
  });

  it("«Carteras guardadas» es la tabla, y la otra dirección lleva a ella (decisión 26)", () => {
    expect(pathForRoute("carteras-guardadas")).toBe("/carteras-guardadas");
    expect(resolveRoute("/carteras-guardadas")).toEqual({ id: "carteras-guardadas" });
    /* Sin intención y sin montar Diseño: es una redirección, no otro destino. */
    expect(resolveRoute("/cartera/guardadas")).toEqual({ id: "carteras-guardadas" });
    expect(resolveRoute("/cartera/guardadas/")).toEqual({ id: "carteras-guardadas" });
  });

  it("la ficha tiene dirección propia y su destino sigue siendo el Buscador", () => {
    /* `/activo/<ISIN>` dice «este instrumento»; `?activo=` decía «el buscador, en este
       estado». El destino no cambia porque la pantalla que monta la ficha es el
       Buscador, y por eso el rail marca el Buscador y no una entrada «Ficha». */
    expect(resolveRoute("/activo/ES0105836003")).toEqual({
      id: "buscador",
      intent: { kind: "ficha", assetId: "ES0105836003" }
    });
    expect(pathForAsset("ES0105836003")).toBe("/activo/ES0105836003");
    /* Un ISIN con caracteres que una URL escapa vuelve entero, no a medias. */
    expect(resolveRoute(pathForAsset("ES0125140A14/B"))).toEqual({
      id: "buscador",
      intent: { kind: "ficha", assetId: "ES0125140A14/B" }
    });
    /* Y `/activo/` sin ISIN no es una ficha vacía: es el Buscador. */
    expect(resolveRoute("/activo/")).toEqual({ id: "buscador" });
  });

  it("«Salud del catálogo» sale de la vista previa y entra en el mapa", () => {
    expect(pathForRoute("salud-catalogo")).toBe("/salud-catalogo");
    expect(isAppRouteId("salud-catalogo")).toBe(true);
  });
});

describe("una dirección de ficha con un % mal formado", () => {
  it("no hace lanzar al arrancar: es una ficha que no existe", () => {
    for (const ruta of ["/activo/%ZZ", "/activo/100%"]) {
      const resuelta = resolveRoute(ruta);
      expect(resuelta.id).toBe("buscador");
      expect(resuelta.intent?.kind).toBe("ficha");
    }
  });
});
