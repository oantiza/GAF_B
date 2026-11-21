/**
 * Mapa de rutas. Nació en la ola 3b (auditoría 11-08, §5.4) con 9 destinos y lo
 * rehízo la decisión 1 del rediseño el 02-11-2026.
 *
 * Qué cambió entonces, y por qué está escrito aquí: de septiembre no quedó ningún
 * documento que dijera por qué se eligió un mapa, y el motivo se perdió. Los cuatro
 * cambios salen de cuatro cosas medidas sobre este fichero y `navModel.tsx`, y están
 * en `docs/rediseno-2026-11/MAPA_NAVEGACION_2026-11-02.md`.
 *
 * - `posiciones-globales` DEJA de ser un destino: era el mismo componente que
 *   `posiciones` —`PositionsWorkbench`, modos `global` y `extracto`— colocado en otra
 *   sección del rail. Ahora es un modo, y su URL redirige con la intención.
 * - «Carteras guardadas» ASCIENDE de panel del Constructor a destino propio. Desde la decisión 26
 *   (04-11-2026) es la tabla de `/carteras-guardadas`, sin montar Diseño debajo, y
 *   `/cartera/guardadas` redirige a ella.
 * - La ficha gana dirección propia, `/activo/<ISIN>`, en vez de ser un parámetro del
 *   Buscador. No es entrada del rail: nadie pulsa «Ficha» sin un instrumento delante.
 * - `salud-catalogo` entra en el rail, en la sección de datos.
 *
 * 13-11-2026: entra `jubilacion`, el simulador de jubilación. Es un destino nuevo y no un panel de otro: no trabaja
 * sobre un activo ni sobre una cartera, sino sobre el plan de un cliente, y por eso estrena sección en el menú.
 * El mismo día entra `planes`, el catálogo de planes de pensiones y EPSV (decisión D-11): cuelga de `/jubilacion`
 * porque es donde se habla de ellos, y es destino propio porque no es parte del simulador ni del Buscador de activos.
 * Su ficha y su comparación van al final de la dirección (`#plan=…`, `#comparar=…`) y las resuelve la propia pantalla.
 *
 * Todas las URLs de los mapas anteriores siguen funcionando como redirects con
 * intención: `/agenda` abre Mercado en la pestaña Calendario,
 * `/cartera/optimizacion` abre el Constructor en el paso Optimizar, etc.
 * `/` y `/inicio` llevan al Constructor: la página de inicio debe ponerte a
 * trabajar, no a leer qué hace cada botón (§5.3).
 */
export const APP_ROUTE_PATHS = {
  mercado: "/mercado",
  buscador: "/buscador",
  comparador: "/comparador",
  cartera: "/cartera",
  "carteras-guardadas": "/carteras-guardadas",
  informes: "/cartera/informes",
  analisis: "/analisis",
  "cartera-real": "/cartera-real",
  posiciones: "/posiciones",
  jubilacion: "/jubilacion",
  planes: "/jubilacion/planes",
  "salud-catalogo": "/salud-catalogo",
  sistema: "/sistema"
} as const;

export type AppRouteId = keyof typeof APP_ROUTE_PATHS;

/**
 * Intención que viaja con una URL legacy o un deep-link: pestaña o panel
 * inicial del destino. Se consume una vez al montar la página; la navegación
 * por el rail no lleva intención (cada página abre en su vista por defecto).
 */
export type RouteIntent =
  | { kind: "mercado-tab"; tab: "calendario" | "estrategia" }
  | { kind: "builder-panel"; panel: "composition" | "optimization" }
  /* El modo con el que abre Posiciones. Lo trae `/posiciones-globales`, que era un
     destino y ahora es este modo. */
  | { kind: "posiciones-modo"; modo: "extracto" | "global" }
  /* El instrumento que `/activo/<ISIN>` pide. A diferencia de las otras, esta
     intencion NO se consume al montar: mientras la ficha este abierta la URL la
     sigue, igual que hacia `?activo=`. */
  | { kind: "ficha"; assetId: string }
  /* Una dirección que no existe. Se queda en la barra, para que se vea cuál era, y la pantalla lo dice:
     antes llevaba a Diseño de cartera sin decir nada. */
  | { kind: "desconocida" };

export interface ResolvedRoute {
  id: AppRouteId;
  intent?: RouteIntent;
}

const ROUTE_IDS = new Set<AppRouteId>(Object.keys(APP_ROUTE_PATHS) as AppRouteId[]);
const ROUTE_BY_PATH = new Map<string, AppRouteId>(
  Object.entries(APP_ROUTE_PATHS).map(([id, path]) => [path, id as AppRouteId])
);

/** URLs del mapa de 15 destinos → destino nuevo (+ intención de pestaña). */
const LEGACY_ROUTE_BY_PATH = new Map<string, ResolvedRoute>([
  ["/", { id: "cartera" }],
  ["/index.html", { id: "cartera" }],
  ["/inicio", { id: "cartera" }],
  ["/agenda", { id: "mercado", intent: { kind: "mercado-tab", tab: "calendario" } }],
  ["/estrategia", { id: "mercado", intent: { kind: "mercado-tab", tab: "estrategia" } }],
  ["/dashboard", { id: "analisis" }],
  ["/xray", { id: "analisis" }],
  ["/informes", { id: "informes" }],
  ["/cartera/optimizacion", { id: "cartera", intent: { kind: "builder-panel", panel: "optimization" } }],
  ["/cartera/guardadas", { id: "carteras-guardadas" }],
  ["/admin", { id: "sistema" }],
  /* 02-11-2026: dejo de ser destino y paso a ser un modo de Posiciones. La URL no se
     rompe y ademas abre el modo que pedia, que es el punto de guardar la intencion. */
  ["/posiciones-globales", { id: "posiciones", intent: { kind: "posiciones-modo", modo: "global" } }]
]);

/** El prefijo de la ficha. `/activo/<ISIN>`, con el ISIN en el propio camino. */
const PREFIJO_FICHA = "/activo/";

/** La direccion canonica de la ficha de un instrumento. */
export function pathForAsset(assetId: string): string {
  return `${PREFIJO_FICHA}${encodeURIComponent(assetId)}`;
}

function normalizePathname(pathname: string): string {
  const cleanPath = pathname.split(/[?#]/, 1)[0] || "/";
  if (cleanPath === "/") return cleanPath;
  return cleanPath.replace(/\/+$/, "") || "/";
}

export function isAppRouteId(value: string): value is AppRouteId {
  return ROUTE_IDS.has(value as AppRouteId);
}

export function pathForRoute(routeId: AppRouteId): string {
  return APP_ROUTE_PATHS[routeId];
}

/** Resuelve un pathname a destino + intención. Lo desconocido abre en Constructor, marcado como tal. */
export function resolveRoute(pathname: string): ResolvedRoute {
  const normalizedPath = normalizePathname(pathname);
  const canonical = ROUTE_BY_PATH.get(normalizedPath);
  if (canonical) return { id: canonical };
  /* La ficha tiene direccion propia, y su destino en el menu es el Buscador, porque de
     ahi se llega. Un `/activo/` sin ISIN detras no es una ficha: es el Buscador, y llega
     aqui ya sin la barra final porque `normalizePathname` la quita. */
  if (normalizedPath === PREFIJO_FICHA.slice(0, -1)) return { id: "buscador" };
  if (normalizedPath.startsWith(PREFIJO_FICHA)) {
    /* Un `%` mal formado hace lanzar a `decodeURIComponent`, y esto se llama al montar el marco: la aplicación no
       arrancaba. Se trata como lo que es, una ficha que no existe. */
    const crudo = normalizedPath.slice(PREFIJO_FICHA.length);
    let assetId = crudo;
    try {
      assetId = decodeURIComponent(crudo);
    } catch {
      /* Se queda el texto tal cual: la ficha dirá que no lo encuentra. */
    }
    return assetId
      ? { id: "buscador", intent: { kind: "ficha", assetId } }
      : { id: "buscador" };
  }
  return LEGACY_ROUTE_BY_PATH.get(normalizedPath) ?? { id: "cartera", intent: { kind: "desconocida" } };
}

export function routeIdFromPath(pathname: string): AppRouteId {
  return resolveRoute(pathname).id;
}
