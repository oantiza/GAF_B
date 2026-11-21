import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useAuthSession } from "../auth/AuthSessionContext";
import { useAdminClaim } from "../auth/useIsAdmin";
import { peso } from "../core/formato";
import { DEFAULT_DATA_SOURCE_KIND, showPreviewDisclaimers } from "../config/runtimeConfig";
import { EmptyState, LoadingState } from "../components/ui/AsyncState";
import { Button } from "../components/ui/Button";
import "../styles/layout.css";
import "../styles/components.css";
import "../styles/charts.css";
import "../styles/modules.css";
import "../styles/impresion.css";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { BdbManualPortfolioPosition } from "../types/bdbAssets";
import {
  readCurrentPortfolioDraftCapitalFromStorage,
  readCurrentPortfolioDraftFromStorage,
  readCurrentPortfolioDraftNameFromStorage,
  writeCurrentPortfolioDraftCapitalToStorage,
  writeCurrentPortfolioDraftNameToStorage,
  writeCurrentPortfolioDraftToStorage
} from "../core/localPortfolioStorage";
import { getBrowserDraftStorage } from "../core/draftStorage";
import {
  readComparisonSelection,
  toggleComparisonId,
  writeComparisonSelection
} from "../core/comparisonSelection";
import { olvidarCatalogoEnSesion } from "../adapters/catalogoEnSesion";
import { MAX_COMPARISON_ASSETS } from "../core/comparisonSelection";
import { ESTADO_INICIAL_DEL_BUSCADOR, type EstadoDelBuscador } from "../core/estadoDelBuscador";
import { AbrirFichaContext } from "./AbrirFichaContext";
import { LimiteDePantalla } from "./LimiteDePantalla";
import { isAppRouteId, pathForAsset, pathForRoute, resolveRoute, type AppRouteId, type RouteIntent } from "./appRoutes";
import { NAV_SECTIONS, SYSTEM_SECTION, sectionForRoute, tituloForRoute, type NavItem } from "./navModel";
import { PageHeader } from "../components/ui/PageHeader";
import { useClientMode, useModoCliente } from "./ClientModeContext";
import { useFocoAlTitulo } from "./useFocoAlTitulo";
import { useOtraPestana } from "./useOtraPestana";
import { useCicloDeCartera } from "./useCicloDeCartera";
import { salirDelGestorY } from "../gestor/ui/salidaDeLaCartera";
import { canPrefetchActivePortfolio } from "../core/activePortfolioPrefetchPolicy";
import { LINEAS_DE_LA_CASA, MONOGRAMA_DE_LA_CASA, NOMBRE_DE_LA_CASA } from "../core/marca";
import type { PortfolioPageView } from "../pages/PortfolioBuilderPage";

const FichaDeActivo = lazy(() =>
  import("../components/ficha/FichaDeActivo").then((m) => ({ default: m.FichaDeActivo }))
);
const AssetComparisonPage = lazy(() =>
  import("../pages/AssetComparisonPage").then((m) => ({ default: m.AssetComparisonPage }))
);
const MercadoPage = lazy(() => import("../pages/MercadoPage").then((m) => ({ default: m.MercadoPage })));
const PortfolioBuilderPage = lazy(() =>
  import("../pages/PortfolioBuilderPage").then((m) => ({ default: m.PortfolioBuilderPage }))
);
const XrayPage = lazy(() => import("../pages/XrayPage").then((m) => ({ default: m.XrayPage })));
const PosicionesPage = lazy(() =>
  import("../pages/PosicionesPage").then((m) => ({ default: m.PosicionesPage }))
);
/* El Gestor de carteras ocupa el sitio de Rendimiento (13-11-2026). La pantalla anterior, «Análisis rápido de
   extractos», que analizaba los extractos en el servidor, se retiró el 14-11-2026. */
const GestorDeCarterasPage = lazy(() =>
  import("../gestor/ui/GestorDeCarterasPage").then((m) => ({ default: m.GestorDeCarterasPage }))
);
const AdminPage = lazy(() => import("../pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const BuscadorNuevoPage = lazy(() =>
  import("../pages/BuscadorNuevoPage").then((m) => ({ default: m.BuscadorNuevoPage }))
);
const CarterasGuardadasPage = lazy(() =>
  import("../pages/CarterasGuardadasPage").then((m) => ({ default: m.CarterasGuardadasPage }))
);
const JubilacionPage = lazy(() => import("../pages/JubilacionPage").then((m) => ({ default: m.JubilacionPage })));
const PlanesPage = lazy(() => import("../pages/PlanesPage").then((m) => ({ default: m.PlanesPage })));
const SaludDelCatalogoPage = lazy(() =>
  import("../pages/SaludDelCatalogoPage").then((m) => ({ default: m.SaludDelCatalogoPage }))
);

const PAGE_FALLBACK = <LoadingState>Cargando módulo…</LoadingState>;
const FICHA_FALLBACK = <LoadingState>Cargando la ficha…</LoadingState>;

const RAIL_STATE_KEY = "bdb-activos.rail-collapsed.v1";

function totalPortfolioWeight(positions: BdbManualPortfolioPosition[]): number {
  return positions.reduce((sum, position) => sum + (position.weight_percent || 0), 0);
}

function readInitialRailState(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(RAIL_STATE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Qué instrumento pide la URL.
 *
 * Desde el 02-11-2026 la dirección canónica de una ficha es `/activo/<ISIN>`, y es la
 * que se escribe. `/buscador?activo=<ISIN>` era la de antes y se sigue leyendo: hay
 * enlaces mandados por correo con esa forma, y romperlos para estrenar la nueva sería
 * cobrarle al asesor el cambio de mapa.
 */
function readAssetParam(): string | null {
  if (typeof window === "undefined") return null;
  const porCamino = resolveRoute(window.location.pathname);
  if (porCamino.intent?.kind === "ficha") return porCamino.intent.assetId;
  return new URLSearchParams(window.location.search).get("activo")?.trim() || null;
}

/**
 * De qué pantalla se vino a la ficha abierta. Vive en la entrada del historial, junto a la dirección:
 * así sobrevive a recargar, y «Atrás» y «Adelante» la devuelven sola. Una ficha abierta en otra pestaña
 * o desde un enlace no viene de ningún sitio.
 */
function readOrigenDeFicha(): AppRouteId | null {
  if (typeof window === "undefined") return null;
  const origen: unknown = window.history.state?.origenDeFicha;
  return typeof origen === "string" && isAppRouteId(origen) ? origen : null;
}

/** El rótulo de la vuelta. La lista es «los resultados», porque es lo que se estaba mirando. */
function etiquetaDeVuelta(origen: AppRouteId): string {
  if (origen === "buscador") return "Volver a los resultados";
  if (origen === "comparador") return "Volver al Comparador";
  return `Volver a ${tituloForRoute(origen) ?? "la pantalla anterior"}`;
}

/** Un clic que pide otra pestaña, otra ventana o una descarga lo resuelve el navegador, no la aplicación. */
function esClicDelNavegador(evento: MouseEvent<HTMLAnchorElement>): boolean {
  return evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey;
}

/**
 * El recuadro de la barra superior: la propuesta que se está diseñando (rediseño del 13-11-2026). Antes decía
 * «Cartera activa», y dentro de la cartera de un cliente parecía hablar de ella (DIR-04). Dice si hay cambios sin
 * guardar, que es lo que más importa al cambiar de pantalla, y su nombre accesible es la frase entera: por debajo de
 * 900 px el rótulo y el nombre no se ven, y el botón se quedaba en «3 posiciones · 100,0 %» (DIS-19).
 */
export function ActivePortfolioChip({
  positions,
  name,
  sinGuardar = false,
  onOpen
}: {
  positions: BdbManualPortfolioPosition[];
  /** El nombre de la propuesta; sin él, «sin nombre». */
  name?: string;
  /** La propuesta tiene cambios que no están en ninguna cartera guardada. */
  sinGuardar?: boolean;
  onOpen: () => void;
}) {
  const nombre = name?.trim() ?? "";
  /* Sin posiciones y sin nombre no hay propuesta de la que hablar. Con nombre sí: se está empezando una. */
  if (positions.length === 0 && !nombre) return null;

  const recuento = `${positions.length} ${positions.length === 1 ? "posición" : "posiciones"}`;
  const suma = peso(totalPortfolioWeight(positions) / 100) ?? "";
  /* Sin `aria-label`: el nombre accesible es lo que se lee dentro, entero a cualquier ancho (por debajo de 900 px
     el rótulo y el nombre se ocultan a la vista, no al lector: `layout.css`). Con una etiqueta aparte, el texto
     visible dejaba de estar contenido en el nombre accesible (WCAG 2.5.3), y axe lo marcaba. */
  return (
    <button type="button" className="topbar-chip" onClick={onOpen} title={`Abrir en ${tituloForRoute("cartera")}`}>
      <span className="topbar-chip__label">Propuesta en curso</span>
      <span className={`topbar-chip__value${nombre ? "" : " topbar-chip__value--vacio"}`}>{nombre || "sin nombre"}</span>
      <span className="topbar-chip__count">
        {recuento} · {suma}
      </span>
      {sinGuardar ? <span className="topbar-chip__estado">sin guardar</span> : null}
      <span className="sr-only">. Abrir en {tituloForRoute("cartera")}</span>
    </button>
  );
}

export function ClientModeToggle() {
  const clientMode = useClientMode();
  return (
    <button
      type="button"
      className={`topbar-switch${clientMode.enabled ? " is-active" : ""}`}
      role="switch"
      aria-checked={clientMode.enabled}
      onClick={clientMode.toggle}
      title="Oculta información comercial y detalles técnicos en las vistas que ve el cliente"
    >
      <span className="topbar-switch__track" aria-hidden="true" />
      <span className="topbar-switch__label">Modo cliente</span>
    </button>
  );
}

/**
 * Shell y router de la app (ola 3b): 9 destinos, cada uno una página propia.
 * El enrutado salió de AssetSearch — ninguna ruta paga ya las peticiones del
 * buscador al montar (F2.9) — y las URLs del mapa anterior redirigen con su
 * intención de pestaña (appRoutes).
 */
export function BdbActivosApp() {
  const [sourceKind] = useState<AssetDataSourceKind>(DEFAULT_DATA_SOURCE_KIND);
  const [route, setRoute] = useState<{ id: AppRouteId; intent?: RouteIntent }>(() =>
    typeof window === "undefined" ? { id: "cartera" } : resolveRoute(window.location.pathname)
  );
  const [assetParam, setAssetParam] = useState<string | null>(() => readAssetParam());
  const [origenDeFicha, setOrigenDeFicha] = useState<AppRouteId | null>(() => readOrigenDeFicha());
  /* Por dónde va el Buscador: en memoria, y dura lo que dura la sesión. */
  const [estadoDelBuscador, setEstadoDelBuscador] = useState<EstadoDelBuscador>(ESTADO_INICIAL_DEL_BUSCADOR);
  /* Decisión 29: cada pestaña tiene su cartera, y la que se abre con otra delante lo dice. */
  const hayOtraPestana = useOtraPestana();
  const [anadidoAquiSolo, setAnadidoAquiSolo] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(readInitialRailState);
  /* El nombre del instrumento de la ficha abierta, para la pestaña del navegador: con tres fichas
     abiertas, o una en favoritos, «Ficha de activo» no dice cuál es cuál. Lo cuenta la ficha. */
  const [nombreDeFicha, setNombreDeFicha] = useState<string | null>(null);
  const [portfolioPositions, setPortfolioPositions] = useState<BdbManualPortfolioPosition[]>(() =>
    readCurrentPortfolioDraftFromStorage(getBrowserDraftStorage(sourceKind), sourceKind)
  );
  // Auditoría 11-08 (F2.7): el capital del borrador vive junto a las
  // posiciones, en el shell — antes lo hidrataba AssetSearch y solo existía
  // dentro del embudo del buscador.
  // F-04 (29-09): `undefined` hasta que el usuario lo fija, lo trae un extracto
  // o una cartera guardada; el PDF imprime N/D en vez de 100.000 € inventados.
  const [portfolioCapital, setPortfolioCapital] = useState<number | undefined>(() =>
    readCurrentPortfolioDraftCapitalFromStorage(getBrowserDraftStorage(sourceKind), sourceKind)
  );
  // Ola 1 (E1): la cartera activa tiene nombre; vive en el shell como el capital
  // y lo enseña el chip de la barra superior en todas las pantallas.
  const [portfolioName, setPortfolioName] = useState<string>(() =>
    readCurrentPortfolioDraftNameFromStorage(getBrowserDraftStorage(sourceKind), sourceKind)
  );
  // Hallazgo 47: qué cartera guardada está abierta, si hay cambios sin guardar y la pregunta antes de perderlos.
  const ciclo = useCicloDeCartera({
    sourceKind,
    positions: portfolioPositions,
    capital: portfolioCapital,
    nombre: portfolioName,
    setPositions: setPortfolioPositions,
    setCapital: setPortfolioCapital,
    setNombre: setPortfolioName
  });
  // Selección del comparador (máx. 5): sobrevive a la navegación y al F5 (F1).
  const [comparisonIds, setComparisonIds] = useState<string[]>(() =>
    readComparisonSelection(getBrowserDraftStorage(sourceKind))
  );
  /* MAR-22 y PLA-17: el permiso llega tarde, y hasta entonces no se sabe si la cuenta lo tiene. */
  const { isAdmin, resolved: permisoResuelto } = useAdminClaim();
  const authSession = useAuthSession();
  const modoCliente = useModoCliente();
  /* Delante de un cliente, ni los datos de la casa ni las carteras de otros clientes (decisión 19). */
  const sections = (isAdmin && modoCliente.seEnsena("seccionDatos") ? [...NAV_SECTIONS, SYSTEM_SECTION] : NAV_SECTIONS).map((section) => ({
    ...section,
    items: section.items.filter((item) => item.id !== "carteras-guardadas" || modoCliente.seEnsena("otrasCarteras"))
  }));
  const routeId = route.id;
  const contenido = useRef<HTMLElement>(null);
  useFocoAlTitulo(`${route.id}|${assetParam ?? ""}`, contenido);

  /* Salir de la sesión desmonta este marco: el catálogo leído no se queda para quien entre después. */
  useEffect(() => olvidarCatalogoEnSesion, []);

  useEffect(() => {
    writeCurrentPortfolioDraftToStorage(getBrowserDraftStorage(sourceKind), sourceKind, portfolioPositions);
  }, [portfolioPositions, sourceKind]);

  useEffect(() => {
    writeCurrentPortfolioDraftCapitalToStorage(getBrowserDraftStorage(sourceKind), sourceKind, portfolioCapital);
  }, [portfolioCapital, sourceKind]);

  useEffect(() => {
    writeCurrentPortfolioDraftNameToStorage(getBrowserDraftStorage(sourceKind), sourceKind, portfolioName);
  }, [portfolioName, sourceKind]);

  useEffect(() => {
    writeComparisonSelection(getBrowserDraftStorage(sourceKind), comparisonIds);
  }, [comparisonIds, sourceKind]);

  useEffect(() => {
    if (!canPrefetchActivePortfolio(sourceKind, Boolean(authSession), portfolioPositions, false)) return;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      if (!canPrefetchActivePortfolio(sourceKind, Boolean(authSession), portfolioPositions, document.hidden)) {
        return;
      }
      void import("../adapters/prefetchActivePortfolio")
        .then(({ prefetchActivePortfolio }) => prefetchActivePortfolio(sourceKind, portfolioPositions, controller.signal))
        .catch(() => undefined);
    }, 2_000);

    return () => { window.clearTimeout(timeoutId); controller.abort(); };
  }, [authSession, portfolioPositions, sourceKind]);

  const navigateTo = useCallback((id: AppRouteId, replace = false) => {
    if (typeof window !== "undefined") {
      const nextPath = pathForRoute(id);
      const mismaPantalla = window.location.pathname === nextPath;
      const anteriorUrl = window.location.href;
      const teniaAlgoTrasElHash = Boolean(window.location.hash);
      // search: si hay parámetros (p. ej. ?activo= de una ficha), la URL
      // limpia también cuenta como navegación — sin esto quedaban pegados.
      // hash (PLA-11): lo que va tras el `#` es dónde se está dentro de la pantalla —la ficha de un plan, una
      // comparación, una pestaña—. Ir al destino en el que ya se está vuelve a su inicio, y no a ese sitio.
      if (!mismaPantalla || window.location.search || window.location.hash) {
        if (replace) {
          window.history.replaceState({ routeId: id }, "", nextPath);
        } else {
          /* Con `pushState`: «Atrás» sigue recorriendo lo que la pantalla apuntó tras el `#`. */
          window.history.pushState({ routeId: id }, "", nextPath);
        }
        /* `pushState` no avisa a nadie: la pantalla, que sigue montada, se entera por el mismo evento que escucha
           cuando cambia lo de detrás del `#`. */
        if (mismaPantalla && teniaAlgoTrasElHash) {
          window.dispatchEvent(
            typeof HashChangeEvent === "function"
              ? new HashChangeEvent("hashchange", { oldURL: anteriorUrl, newURL: window.location.href })
              : new Event("hashchange")
          );
        }
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    setRoute({ id });
    setAssetParam(null);
  }, []);

  /* GES-01: ir a otra pantalla saca de la cartera abierta del gestor, si la hay. Antes se escribe lo pendiente
     y, si aun así se perderían cambios, se pregunta como en «← Todas las carteras». A la misma pantalla no se
     sale de nada. */
  const irA = useCallback(
    (id: AppRouteId) => (id === routeId ? navigateTo(id) : salirDelGestorY(() => navigateTo(id))),
    [navigateTo, routeId]
  );

  /* S6b (auditoría 27-07, T7): la ficha tiene URL propia — se puede compartir,
     recargar y volver atrás. Decisión 1 del rediseño (02-11-2026): esa URL pasa de
     `/buscador?activo=<id>` a `/activo/<id>`. El cambio no es cosmético: un parámetro
     dice «el buscador, en este estado» y un camino dice «este instrumento», que es lo
     que el asesor manda por correo. La forma vieja se sigue leyendo.

     Se abre desde cualquier pantalla, y la entrada del historial recuerda desde cuál. */
  const abrirFicha = useCallback(
    (assetId: string) => {
      const nextUrl = pathForAsset(assetId);
      if (window.location.pathname + window.location.search !== nextUrl) {
        window.history.pushState({ routeId: "buscador", origenDeFicha: routeId }, "", nextUrl);
        window.scrollTo({ top: 0, behavior: "auto" });
        setOrigenDeFicha(routeId);
      }
      setRoute((current) => (current.id === "buscador" ? current : { id: "buscador" }));
      setAssetParam(assetId);
    },
    [routeId]
  );

  /* CRIT-04 (auditoría 14-10-2026): Constructor e Informe de cliente son la
     misma página con dos rutas. Cambiar de vista ES navegar: la URL es la única
     fuente de verdad y el rail siempre la lleva a donde dice. */
  const handlePortfolioViewChange = useCallback(
    (view: PortfolioPageView) => navigateTo(view === "report" ? "informes" : "cartera"),
    [navigateTo]
  );

  const handleToggleComparison = useCallback((assetId: string) => {
    setComparisonIds((current) => toggleComparisonId(current, assetId));
  }, []);

  /* ACT-05: el Comparador lleva su propia lista y avisa de lo que añade y de lo que quita. Con un conmutador, un
     «añadir» con la selección llena no hacía nada aquí y sí en la pantalla, y un «añadir» de lo que ya estaba lo
     quitaba: las dos listas se separaban. Cada aviso hace solo lo que dice, y si no cabe, no toca nada. */
  const handleAddComparison = useCallback((assetId: string) => {
    setComparisonIds((current) =>
      current.includes(assetId) || current.length >= MAX_COMPARISON_ASSETS ? current : [...current, assetId]
    );
  }, []);

  const handleRemoveComparison = useCallback((assetId: string) => {
    setComparisonIds((current) => (current.includes(assetId) ? current.filter((id) => id !== assetId) : current));
  }, []);

  /* ACT-12 (c): qué activos están ya en la propuesta, con la misma referencia mientras las posiciones no cambien.
     Nuevo en cada pintado, el Buscador rehacía sus columnas en cada tecla. */
  const idsEnLaPropuesta = useMemo(() => portfolioPositions.map((posicion) => posicion.asset_id), [portfolioPositions]);

  const handleAddToPortfolio = useCallback(
    (asset: { asset_id: string; display_name: string }) => {
      setPortfolioPositions((currentPositions) =>
        currentPositions.some((position) => position.asset_id === asset.asset_id)
          ? currentPositions
          : [...currentPositions, { asset_id: asset.asset_id, weight_percent: 0, label: asset.display_name }]
      );
      if (hayOtraPestana) setAnadidoAquiSolo(true);
    },
    [hayOtraPestana]
  );

  /* El aviso de quien acaba de añadir se lee y se va; lo de la pestaña sigue dicho al lado del chip. */
  useEffect(() => {
    if (!anadidoAquiSolo) return;
    const temporizador = window.setTimeout(() => setAnadidoAquiSolo(false), 6000);
    return () => window.clearTimeout(temporizador);
  }, [anadidoAquiSolo]);

  // Auditoría 11-08 (F4): «Llevar al Constructor» desde Extracto externo.
  const handleSendPositionsToBuilder = (portfolio: import("../core/positionsToPortfolio").PositionsPortfolioTransfer) => {
    if (portfolio.positions.length === 0) return;
    /* Primero lo de Diseño, que es lo que se sustituye; después, la cartera del gestor de la que se sale (GES-01). */
    ciclo.conGuardia(() =>
      salirDelGestorY(() => {
        ciclo.sustituir({ positions: portfolio.positions, capital: portfolio.totalCapital, nombre: portfolio.name });
        navigateTo("cartera");
      })
    );
  };

  const abrirFichaSaliendoDelGestor = useCallback((assetId: string) => salirDelGestorY(() => abrirFicha(assetId)), [abrirFicha]);

  const toggleRail = useCallback(() => {
    setRailCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(RAIL_STATE_KEY, next ? "1" : "0");
      } catch {
        /* almacenamiento no disponible: el estado sigue siendo válido en memoria */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    // Canonicaliza la URL de entrada (legacy o con barras) conservando la
    // intención: /agenda reescribe a /mercado pero abre la pestaña Agenda.
    const entryRoute = resolveRoute(window.location.pathname);
    const canonicalPath = pathForRoute(entryRoute.id);
    /* Una ficha ya está en su dirección canónica aunque su destino sea el Buscador:
       `/activo/<ISIN>` no se reescribe a `/buscador`. La forma vieja con `?activo=`
       tampoco, para que un enlace de hace meses siga abriendo la ficha y no el
       buscador vacío. */
    const esFicha =
      entryRoute.intent?.kind === "ficha" ||
      (entryRoute.id === "buscador" && window.location.search.includes("activo="));
    /* Una dirección que no existe tampoco: se queda en la barra, para que se vea cuál era. */
    if (window.location.pathname !== canonicalPath && !esFicha && entryRoute.intent?.kind !== "desconocida") {
      window.history.replaceState({ routeId: entryRoute.id }, "", canonicalPath);
    }

    const handlePopState = () => {
      setRoute(resolveRoute(window.location.pathname));
      setAssetParam(readAssetParam());
      setOrigenDeFicha(readOrigenDeFicha());
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const direccionDesconocida = route.intent?.kind === "desconocida";
  const isActive = (id: AppRouteId) => !direccionDesconocida && routeId === id;

  const routeTitulo = tituloForRoute(routeId);
  const esFicha = routeId === "buscador" && Boolean(assetParam);
  /* MAR-23: con una ficha abierta, la pantalla no es el Buscador. Su entrada sigue marcada, porque la ficha
     cuelga de él, pero dice «estás dentro de esto» y no «estás aquí». */
  const ariaCurrentDe = (id: AppRouteId) => (isActive(id) ? (esFicha ? "location" : "page") : undefined);
  const pageTitle = direccionDesconocida ? "Esta página no existe" : esFicha ? "Ficha de activo" : routeTitulo ?? NOMBRE_DE_LA_CASA;
  /* La pestaña lleva el título de la pantalla, y en una ficha el del instrumento en cuanto se sabe. */
  const tituloDePestana = esFicha ? nombreDeFicha ?? pageTitle : pageTitle;
  const sectionLabel = direccionDesconocida ? null : sectionForRoute(routeId);
  /* Las migas: grupo, pantalla y, en una ficha, la ficha («Activos / Buscador / Ficha de activo»). Cuando grupo y
     pantalla se llaman igual («Mercado / Mercado»), no se repite: orienta, no tartamudea (D2.2). */
  const migas = [
    sectionLabel && sectionLabel !== routeTitulo ? sectionLabel : null,
    esFicha ? routeTitulo : null
  ].filter((miga): miga is string => Boolean(miga));
  const advisorEmail = authSession?.email ?? null;
  const advisorName = (advisorEmail?.split("@")[0]?.replace(/[._-]+/g, " ") || "Asesor").replace(
    /\b\p{L}/gu,
    (letter) => letter.toLocaleUpperCase("es")
  );
  const advisorInitial = advisorName.trim().charAt(0).toUpperCase() || "A";
  const isPreviewData = showPreviewDisclaimers(sourceKind);

  useEffect(() => {
    document.title = tituloDePestana === NOMBRE_DE_LA_CASA ? NOMBRE_DE_LA_CASA : `${tituloDePestana} · ${NOMBRE_DE_LA_CASA}`;
  }, [tituloDePestana]);

  /* El aviso de seguridad se escribe solo cuando hay algo que decir, y nunca delante del cliente. */
  const seEnsenaLaCuenta = modoCliente.seEnsena("correoYSeguridad");
  const cuentaProtegida = Boolean(authSession?.emailVerified && authSession?.mfaEnrolled);
  const avisoDeSeguridad = seEnsenaLaCuenta && !cuentaProtegida;

  /* Salud del catálogo y Sistema hablan del estado de la base, no de un cliente. Sin permiso no se
     montan, y delante de un cliente tampoco: se llega también escribiendo la dirección, y el
     interruptor promete que esto no se ve. Primero el permiso: a quien no lo tiene, decirle que
     quite Modo cliente sería mentirle. */
  const pantallaDeDatos = (pantalla: ReactNode) => {
    /* MAR-22 y PLA-17: mientras se confirma el permiso no se dice que no lo hay. Antes, un administrador que
       entraba por enlace leía un instante «Esta cuenta no tiene permisos», que para él era falso. Ni la pantalla
       se monta hasta saberlo. */
    if (!permisoResuelto) {
      return (
        <div>
          <PageHeader title={tituloForRoute(routeId)} />
          <LoadingState>Comprobando permisos…</LoadingState>
        </div>
      );
    }
    if (!isAdmin) {
      /* Auditoría 11-08 (D15 y N3.1): guard de ruta. Un no-admin nunca monta la página. */
      return (
        <div>
          <PageHeader title={tituloForRoute(routeId)} />
          <EmptyState
            title="Sección reservada al administrador"
            description="Esta cuenta no tiene permisos de administración, así que la página no se carga. Si crees que deberías tener acceso, contacta con el administrador de la aplicación."
            action={
              <Button onClick={() => navigateTo("buscador")} variant="primary">
                Ir al buscador
              </Button>
            }
          />
        </div>
      );
    }
    if (!modoCliente.seEnsena("seccionDatos")) {
      return (
        <div>
          <PageHeader title={tituloForRoute(routeId)} />
          <EmptyState title="No disponible en modo cliente" description="Desactiva Modo cliente para ver esta sección." />
        </div>
      );
    }
    return pantalla;
  };

  const saltarAlContenido = (evento: MouseEvent<HTMLAnchorElement>) => {
    /* Sin dejar que el navegador cambie la dirección: un `#` dispara `popstate`, y el enrutador
       lo tomaría por una navegación y perdería la intención con la que se abrió la pantalla. */
    evento.preventDefault();
    /* Sin desplazar: la barra superior es fija, y el navegador dejaba el título debajo de ella. */
    contenido.current?.focus({ preventScroll: true });
  };

  /* MAR-09: cada entrada es un enlace con la dirección de su destino, para abrirla en otra pestaña o copiarla. Un
     clic normal no recarga: navega dentro de la aplicación por el mismo camino de siempre, con sus guardas (la salida
     de la cartera abierta del gestor); con Ctrl, Cmd, Mayús o el botón central, actúa el navegador. */
  const entradaDelMenu = (item: NavItem) => {
    const activa = isActive(item.id);
    const alPulsar = (evento: MouseEvent<HTMLAnchorElement>) => {
      if (!item.ready) {
        evento.preventDefault();
        return;
      }
      if (evento.defaultPrevented || esClicDelNavegador(evento)) return;
      evento.preventDefault();
      irA(item.id);
    };
    return (
      <a
        className={`rail-link${activa ? " active" : ""}`}
        href={item.ready ? pathForRoute(item.id) : undefined}
        aria-current={ariaCurrentDe(item.id)}
        aria-disabled={item.ready ? undefined : true}
        aria-label={item.label}
        title={item.label}
        onClick={alPulsar}
      >
        {item.icon}
        <span>{item.label}</span>
        {/* El nombre bajo el icono en tablet. Solo a la vista: el enlace ya se llama como la entrada. */}
        <span aria-hidden="true" className="rail-link__corto">
          {item.corto ?? item.label}
        </span>
        {!item.ready ? <span className="rail-soon">pronto</span> : null}
      </a>
    );
  };

  const renderRoute = () => {
    if (direccionDesconocida) {
      return (
        <div>
          <PageHeader
            actions={
              <Button onClick={() => navigateTo("cartera")} variant="primary">
                {`Ir a ${tituloForRoute("cartera")}`}
              </Button>
            }
            description="Esta dirección no lleva a ninguna pantalla de la aplicación."
            title="Esta página no existe"
          />
        </div>
      );
    }
    switch (routeId) {
      case "mercado":
        return (
          <MercadoPage
            initialTab={route.intent?.kind === "mercado-tab" ? route.intent.tab : undefined}
          />
        );
      case "buscador":
        /*
         * Desde el 04-11-2026 son dos pantallas y ninguna monta a la otra: la lista y la ficha.
         * La ficha resuelve a este destino para que el menú siga marcando el Buscador, pero se
         * abre sola, sin pasar por la lista ni leer el catálogo. La clave le da a cada instrumento
         * una lectura propia: la ficha anterior no se enseña mientras llega la siguiente.
         */
        if (assetParam !== null) {
          return (
            <FichaDeActivo
              assetId={assetParam}
              comparacionLlena={comparisonIds.length >= MAX_COMPARISON_ASSETS}
              enCartera={portfolioPositions.some((posicion) => posicion.asset_id === assetParam)}
              enComparacion={comparisonIds.includes(assetParam)}
              key={assetParam}
              onAlternarComparacion={handleToggleComparison}
              onAnadirACartera={handleAddToPortfolio}
              onIrAlBuscador={() => navigateTo("buscador")}
              onNombre={setNombreDeFicha}
              sourceKind={sourceKind}
              vuelta={
                origenDeFicha
                  ? {
                      etiqueta: etiquetaDeVuelta(origenDeFicha),
                      direccion: pathForRoute(origenDeFicha),
                      alVolver: () => window.history.back()
                    }
                  : {
                      etiqueta: "Ir al Buscador",
                      direccion: pathForRoute("buscador"),
                      alVolver: () => navigateTo("buscador")
                    }
              }
            />
          );
        }
        return (
          <BuscadorNuevoPage
            alCambiarEstado={setEstadoDelBuscador}
            enCartera={idsEnLaPropuesta}
            estado={estadoDelBuscador}
            onAbrirCartera={() => navigateTo("cartera")}
            onAbrirComparador={() => navigateTo("comparador")}
            onAbrirFicha={abrirFicha}
            onAlternarComparacion={handleToggleComparison}
            onAnadirACartera={(isin, nombre) =>
              handleAddToPortfolio({ asset_id: isin, display_name: nombre })
            }
            paraComparar={comparisonIds}
            /* ACT-01: con la fuente, «Añadir» pregunta al servidor por el activo, como la ficha, y ve las marcas del
               equipo (suspendido, cerrado a suscripciones, bloqueado por calidad del dato). */
            sourceKind={sourceKind}
          />
        );
      case "comparador":
        return (
          <AssetComparisonPage
            assetIds={comparisonIds}
            sourceKind={sourceKind}
            onRemove={handleRemoveComparison}
            onAdd={handleAddComparison}
            onAddToPortfolio={handleAddToPortfolio}
            portfolioAssetIds={idsEnLaPropuesta}
            carteraActiva={{ positions: portfolioPositions, nombre: portfolioName, capital: portfolioCapital, sinGuardar: ciclo.sinGuardar }}
            onIrACarterasGuardadas={() => navigateTo("carteras-guardadas")}
            initialInstrumentFilter="ALL"
          />
        );
      case "cartera":
      case "informes":
        return (
          <PortfolioBuilderPage
            positions={portfolioPositions}
            setPositions={setPortfolioPositions}
            sourceKind={sourceKind}
            totalCapital={portfolioCapital}
            onCapitalChange={setPortfolioCapital}
            portfolioName={portfolioName}
            onPortfolioNameChange={setPortfolioName}
            view={routeId === "informes" ? "report" : "builder"}
            onViewChange={handlePortfolioViewChange}
            ciclo={ciclo}
            onIrA={navigateTo}
            initialPanel={route.intent?.kind === "builder-panel" ? route.intent.panel : "composition"}
          />
        );
      case "analisis":
        return (
          <XrayPage
            onBack={() => navigateTo("buscador")}
            positions={portfolioPositions}
            sourceKind={sourceKind}
            totalCapital={portfolioCapital}
            portfolioName={portfolioName}
            /* ANA-12: el nombre que se escribe en el diálogo del informe de cliente se queda en la propuesta, como
               en Informes; antes salía en el papel y se perdía. */
            onPortfolioNameChange={setPortfolioName}
            perfilYHorizonte={ciclo.perfilYHorizonte}
          />
        );
      case "cartera-real":
        return <GestorDeCarterasPage onSendToBuilder={handleSendPositionsToBuilder} />;
      case "posiciones":
        return (
          <PosicionesPage
            initialMode={route.intent?.kind === "posiciones-modo" ? route.intent.modo : undefined}
            onSendToBuilder={handleSendPositionsToBuilder}
            sourceKind={sourceKind}
          />
        );
      case "carteras-guardadas":
        return <CarterasGuardadasPage ciclo={ciclo} onIrA={navigateTo} sourceKind={sourceKind} />;
      case "jubilacion":
        return <JubilacionPage portfolioName={portfolioName} positions={portfolioPositions} sourceKind={sourceKind} totalCapital={portfolioCapital} />;
      case "planes":
        return <PlanesPage />;
      case "salud-catalogo":
        return pantallaDeDatos(<SaludDelCatalogoPage />);
      case "sistema":
        return pantallaDeDatos(<AdminPage />);
      default:
        return null;
    }
  };

  return (
    <div className="app-shell" data-rail={railCollapsed ? "collapsed" : "expanded"}>
      {/* La primera parada del tabulador: sin esto, cada pantalla exigía recorrer el marco entero. */}
      <a className="salto-al-contenido" href="#contenido-principal" onClick={saltarAlContenido}>
        Saltar al contenido
      </a>
      {/* MAR-23: el punto de referencia es la navegación, con su nombre; el marco que la envuelve no es contenido
          complementario, así que no es un `<aside>`. */}
      <div className="app-rail" id="primary-navigation">
        <div className="rail-brand">
          <span className="rail-brand__mark" aria-hidden="true">
            {MONOGRAMA_DE_LA_CASA}
          </span>
          <span className="rail-brand__text">
            <span className="rail-brand__name">{LINEAS_DE_LA_CASA[0]}</span>
            <span className="rail-brand__sub">{LINEAS_DE_LA_CASA[1]}</span>
          </span>
        </div>

        <nav className="rail-nav" aria-label="Navegación principal">
          {sections.map((section, indice) => {
            const idDelGrupo = `rail-grupo-${indice}`;
            return (
              <div key={section.label} className={`rail-section${section.tail ? " rail-section--tail" : ""}`}>
                {/* MAR-23: cada grupo es una lista con su nombre, y el lector lo dice al entrar en ella. */}
                <div className="rail-section__label" id={idDelGrupo}>
                  {section.label}
                </div>
                <ul className="rail-section__list" aria-labelledby={idDelGrupo}>
                  {section.items.map((item) => (
                    <li key={item.id}>{entradaDelMenu(item)}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="rail-foot">
          {/* El nombre sale de lo que hay antes de la arroba: es el correo, y delante de un
              cliente no se enseña. */}
          {seEnsenaLaCuenta ? (
            <>
              <span className="rail-avatar" aria-hidden="true">
                {advisorInitial}
              </span>
              <span className="rail-identity">
                <span className="rail-identity__name">{advisorName}</span>
                <span className="rail-identity__role">Asesor</span>
              </span>
            </>
          ) : null}
          <button
            type="button"
            className="rail-collapse"
            onClick={toggleRail}
            aria-label={railCollapsed ? "Desplegar navegación" : "Plegar navegación"}
            title={railCollapsed ? "Desplegar navegación" : "Plegar navegación"}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {railCollapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
            </svg>
          </button>
        </div>
      </div>

      <div className="app-main">
        <header className="app-topbar">
          {/* MAR-23: la miga dice dónde se está y no lleva a ningún sitio, así que no es una navegación. */}
          <p className="topbar-crumbs">
            {migas.map((miga) => (
              <span key={miga} className="topbar-crumbs__paso">
                <span>{miga}</span>
                <span className="topbar-crumbs__sep" aria-hidden="true">
                  /
                </span>
              </span>
            ))}
            <span className="topbar-crumbs__current">{pageTitle}</span>
          </p>

          <span className="topbar-spacer" />

          <div className="topbar-cluster">
            {/* Junto al recuadro de la propuesta, que es de lo que habla. En una pestaña recién abierta la
                propuesta suele estar vacía y el recuadro no sale: el aviso sí, que es cuando más falta hace.
                MAR-24: la región está siempre montada, vacía si no hay nada que decir, y cambia solo su texto:
                una región viva que nace llena no la anuncian muchos lectores. */}
            <span className={`topbar-pestana${anadidoAquiSolo ? " topbar-pestana--aviso" : ""}`} role="status">
              {hayOtraPestana
                ? anadidoAquiSolo
                  ? "Añadido a la propuesta de esta pestaña, no a la de las otras"
                  : "Esta pestaña tiene su propia propuesta en curso"
                : null}
            </span>
            {isPreviewData ? (
              <span className="badge is-warn" title="La aplicación no está conectada a la base de datos en vivo">
                Datos de muestra
              </span>
            ) : null}
            <ActivePortfolioChip
              positions={portfolioPositions}
              name={portfolioName}
              sinGuardar={ciclo.sinGuardar}
              onOpen={() => irA("cartera")}
            />
            <ClientModeToggle />
            {authSession ? (
              <>
                <span className="topbar-divider" aria-hidden="true" />
                {/* Delante de un cliente no sale: el botón abre el correo y el estado de seguridad de la cuenta. */}
                {seEnsenaLaCuenta ? (
                  <button
                    type="button"
                    className={`topbar-account${avisoDeSeguridad ? " topbar-account--aviso" : ""}`}
                    onClick={authSession.openSecurity}
                    title="Seguridad de la cuenta"
                  >
                    <span className="topbar-account__email">{authSession.email}</span>
                    <span className="topbar-account__corto">Cuenta</span>
                    {avisoDeSeguridad ? <span className="topbar-account__aviso">Revisar seguridad</span> : null}
                    {cuentaProtegida ? (
                      <span className="ui-visually-hidden">Cuenta protegida con verificación en dos pasos</span>
                    ) : null}
                  </button>
                ) : null}
                <Button variant="quiet" size="sm" onClick={() => ciclo.conGuardia(() => salirDelGestorY(authSession.signOut))}>
                  Salir
                </Button>
              </>
            ) : null}
          </div>
        </header>

        <main className="app-content" id="contenido-principal" ref={contenido} tabIndex={-1}>
          <AbrirFichaContext.Provider value={abrirFichaSaliendoDelGestor}>
            {/* MAR-02: si la pantalla falla, cae ella sola y el menú sigue. `reiniciarCon` le hace olvidar el error al navegar, sin volver a montar la pantalla; la salida
                es otra pantalla, y si la que falla es la lista del Buscador, Diseño de cartera. */}
            <LimiteDePantalla
              alSalir={() => navigateTo(routeId === "buscador" && !esFicha ? "cartera" : "buscador")}
              pantalla={pageTitle}
              reiniciarCon={`${routeId}|${assetParam ?? ""}`}
              rotuloDeSalida={routeId === "buscador" && !esFicha ? `Ir a ${tituloForRoute("cartera")}` : "Ir al Buscador"}
            >
              <Suspense fallback={esFicha ? FICHA_FALLBACK : PAGE_FALLBACK}>{renderRoute()}</Suspense>
            </LimiteDePantalla>
          </AbrirFichaContext.Provider>
        </main>
      </div>
      {ciclo.dialogo}
    </div>
  );
}
