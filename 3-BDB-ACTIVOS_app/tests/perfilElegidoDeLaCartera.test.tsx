// @vitest-environment happy-dom

/**
 * Decisión 59 completada en producto: el nivel guardado de la cartera arrastra el «Perfil elegido
 * (informativo)» de Comprobar, y solo en ese sentido; «Guardar como…» y «Guardar como propuesta» heredan
 * perfil y horizonte de la cartera de origen. Se prueba con el ciclo de verdad y la página de verdad; solo
 * el Constructor (lo que se pinta) y el catálogo son de prueba.
 */
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

vi.mock("../src/adapters/assetDataSource", () => {
  const dataSource = {
    getComparableAssets: async () => [],
    buildManualPortfolioSummary: async () => ({ weighted_metrics: {}, warnings: [], by_economic_asset_class: [], total_weight_percent: 100, validation_status: "VALID" }),
    buildManualPortfolioOptimizationPreview: async () => null
  };
  return { getAssetDataSource: () => dataSource };
});

type PropsDelConstructor = {
  selectedRiskProfileId: string | null;
  onRiskProfileChange: (perfil: string | null) => void;
  perfilYHorizonte?: { risk_profile_level?: number; horizon_years?: number };
  onPerfilYHorizonteChange?: (valor: { risk_profile_level?: number; horizon_years?: number }) => void;
  onSaveLocalPortfolio: (name: string, positions: BdbManualPortfolioPosition[], assets: BdbAssetDetail[], capital: number | undefined) => void;
};
const guardado = vi.hoisted(() => ({ pedidos: [] as unknown[] }));
vi.mock("../src/core/guardarCartera", async (original) => {
  const modulo = await original<typeof import("../src/core/guardarCartera")>();
  return {
    ...modulo,
    guardarCartera: (peticion: Parameters<typeof modulo.guardarCartera>[0]) => {
      guardado.pedidos.push(peticion);
      return modulo.guardarCartera(peticion);
    }
  };
});
const visto = vi.hoisted(() => ({ props: null as unknown }));
vi.mock("../src/components/PortfolioBuilder", () => ({
  PortfolioBuilder: (props: unknown) => {
    visto.props = props;
    return null;
  }
}));

const { useCicloDeCartera } = await import("../src/app/useCicloDeCartera");
const { PortfolioBuilderPage } = await import("../src/pages/PortfolioBuilderPage");
const { perfilEnSesion } = await import("../src/core/disenoEnSesion");
const { clearSessionCaches } = await import("../src/core/sessionCaches");
const { readLocalPortfoliosFromStorage } = await import("../src/core/localPortfolioStorage");
type Ciclo = import("../src/app/useCicloDeCartera").CicloDeCartera;

const POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 40 }
];
const invertible = (asset_id: string) =>
  ({ asset_id, is_investable: true, role: "INVESTABLE", instrument_type: "FUND", quality_flags: [] }) as unknown as BdbAssetDetail;

const guardada = (extra: Partial<BdbSavedLocalPortfolio> = {}): BdbSavedLocalPortfolio => ({
  portfolio_id: "p1",
  name: "Cliente",
  created_at: "2026-11-01T10:00:00.000Z",
  updated_at: "2026-11-01T10:00:00.000Z",
  sourceKind: "LOCAL_MOCK",
  positions: POSICIONES,
  ...extra
});

let root: Root;
let host: HTMLDivElement;
let ciclo: Ciclo;

function Marco({ conDiseno = true }: { conDiseno?: boolean }) {
  const [positions, setPositions] = useState(POSICIONES);
  const [capital, setCapital] = useState<number | undefined>(undefined);
  const [nombre, setNombre] = useState("Cliente");
  const delMarco = useCicloDeCartera({ sourceKind: "LOCAL_MOCK", positions, capital, nombre, setPositions, setCapital, setNombre });
  useEffect(() => {
    ciclo = delMarco;
  }, [delMarco]);
  if (!conDiseno) return null;
  return createElement(PortfolioBuilderPage, {
    positions,
    setPositions,
    sourceKind: "LOCAL_MOCK",
    totalCapital: capital,
    onCapitalChange: setCapital,
    portfolioName: nombre,
    onPortfolioNameChange: setNombre,
    onViewChange: () => undefined,
    ciclo: delMarco
  });
}

async function montar(conDiseno = true) {
  await act(async () => root.render(createElement(Marco, { conDiseno })));
}

const props = () => visto.props as PropsDelConstructor;

async function abrir(perfilYHorizonte: { risk_profile_level?: number; horizon_years?: number }, extra: Partial<BdbSavedLocalPortfolio> = {}) {
  await act(async () =>
    ciclo.sustituir({ positions: POSICIONES, capital: undefined, nombre: "Cliente", perfilYHorizonte }, guardada({ ...perfilYHorizonte, ...extra }))
  );
}

beforeEach(() => {
  guardado.pedidos.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  clearSessionCaches();
  visto.props = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("el nivel guardado arrastra el perfil elegido", () => {
  test("abrir una cartera con nivel pone ese perfil en Comprobar", async () => {
    await montar();
    expect(props().selectedRiskProfileId).toBeNull();
    await abrir({ risk_profile_level: 4, horizon_years: 3 });
    expect(props().selectedRiskProfileId).toBe("RISK_4");
    expect(perfilEnSesion.read()).toBe("RISK_4");
    /* Arrastrar no es cambiar la cartera: abierta y sin tocar sigue sin cambios. */
    expect(ciclo.sinGuardar).toBe(false);
  });

  test("abrirla con Diseño sin montar (desde Carteras guardadas) también: al llegar, el perfil elegido es el suyo", async () => {
    await montar(false);
    await abrir({ risk_profile_level: 7 });
    expect(visto.props).toBeNull();
    await montar(true);
    expect(props().selectedRiskProfileId).toBe("RISK_7");
  });

  test("una cartera sin nivel no pone ninguno: el elegido de la anterior se olvida, como siempre (decisión 14)", async () => {
    await montar();
    await act(async () => props().onRiskProfileChange("RISK_6"));
    expect(props().selectedRiskProfileId).toBe("RISK_6");
    await abrir({ horizon_years: 5 });
    expect(props().selectedRiskProfileId).toBeNull();
    expect(perfilEnSesion.read()).toBeNull();
  });

  test("cambiar el nivel en los controles de la cartera mueve el perfil elegido; tocar solo el horizonte, no", async () => {
    await montar();
    await abrir({ risk_profile_level: 4, horizon_years: 3 });
    await act(async () => props().onPerfilYHorizonteChange!({ risk_profile_level: 8, horizon_years: 3 }));
    expect(props().selectedRiskProfileId).toBe("RISK_8");
    expect(ciclo.sinGuardar).toBe(true);

    /* El asesor mira contra otro perfil y luego escribe el horizonte: lo que miraba se queda. */
    await act(async () => props().onRiskProfileChange("RISK_2"));
    await act(async () => props().onPerfilYHorizonteChange!({ risk_profile_level: 8, horizon_years: 6 }));
    expect(props().selectedRiskProfileId).toBe("RISK_2");
  });

  test("dejar el nivel en «Sin definir» no quita el perfil elegido: «Sin definir» no es ningún perfil", async () => {
    await montar();
    await abrir({ risk_profile_level: 4 });
    await act(async () => props().onPerfilYHorizonteChange!({}));
    expect(ciclo.perfilYHorizonte).toEqual({});
    expect(props().selectedRiskProfileId).toBe("RISK_4");
  });

  test("elegir otro perfil en Comprobar no toca la cartera: ni su nivel ni sus cambios sin guardar", async () => {
    await montar();
    await abrir({ risk_profile_level: 4, horizon_years: 3 });
    await act(async () => props().onRiskProfileChange("RISK_9"));
    expect(props().selectedRiskProfileId).toBe("RISK_9");
    expect(ciclo.perfilYHorizonte).toEqual({ risk_profile_level: 4, horizon_years: 3 });
    expect(props().perfilYHorizonte).toEqual({ risk_profile_level: 4, horizon_years: 3 });
    expect(ciclo.sinGuardar).toBe(false);
    await act(async () => props().onRiskProfileChange(null));
    expect(ciclo.perfilYHorizonte).toEqual({ risk_profile_level: 4, horizon_years: 3 });
  });
});

describe("guardar otra cartera desde esta hereda perfil y horizonte", () => {
  test("«Guardar como…» (modo demo): la nueva lleva los de la de origen tal como están en pantalla", async () => {
    await montar();
    await abrir({ risk_profile_level: 4, horizon_years: 3 });
    await act(async () => props().onPerfilYHorizonteChange!({ risk_profile_level: 5, horizon_years: 3 }));
    guardado.pedidos.length = 0;
    let resultado: Awaited<ReturnType<Ciclo["guardar"]>> | undefined;
    await act(async () => {
      resultado = await ciclo.guardar({ nombre: "Copia", comoNueva: true });
    });
    expect(guardado.pedidos[0]).toMatchObject({ sobre: null, perfilYHorizonte: { risk_profile_level: 5, horizon_years: 3 } });
    /* El catálogo de prueba no devuelve activos, así que la copia no llega a escribirse: lo que el modo demo
       escribe con ese pedido está en guardarCartera.test.ts. */
    expect(resultado?.ok).toBe(false);
  });

  test("«Guardar como propuesta» (modo demo): la propuesta guardada lleva los de la de origen", async () => {
    await montar();
    await abrir({ risk_profile_level: 6, horizon_years: 10 });
    await act(async () => {
      props().onSaveLocalPortfolio("Cliente · propuesta de mejora", POSICIONES, [invertible("A"), invertible("B")], undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const propuesta = readLocalPortfoliosFromStorage(localStorage).find((cartera) => cartera.name === "Cliente · propuesta de mejora");
    expect(propuesta).toMatchObject({ risk_profile_level: 6, horizon_years: 10 });
    expect(propuesta?.portfolio_id).not.toBe("p1");
  });

  test("«Guardar como propuesta» de una cartera sin ellos: la propuesta tampoco lleva ninguno", async () => {
    await montar();
    await abrir({});
    await act(async () => {
      props().onSaveLocalPortfolio("Sin nada · propuesta de mejora", POSICIONES, [invertible("A"), invertible("B")], undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const propuesta = readLocalPortfoliosFromStorage(localStorage).find((cartera) => cartera.name === "Sin nada · propuesta de mejora")!;
    expect(propuesta).toBeTruthy();
    expect("risk_profile_level" in propuesta || "horizon_years" in propuesta).toBe(false);
  });
});
