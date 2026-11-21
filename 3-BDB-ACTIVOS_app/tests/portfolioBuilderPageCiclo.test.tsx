// @vitest-environment happy-dom

/**
 * La página de Diseño de cartera con el ciclo de vida: lo que sustituye la cartera pasa por la guardia, y
 * lo que se recuerda de la sesión llega adonde debe (hallazgos 47 y 53, decisión 14).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CicloDeCartera } from "../src/app/useCicloDeCartera";
import type { BdbManualPortfolioPosition, BdbPortfolioImportResult } from "../src/types/bdbAssets";

const IMPORTACION = {
  imported_positions: [{ asset_id: "X", weight_percent: 100, label: "Fondo importado" }],
  rejected_positions: [],
  source_label: "Fichero",
  warnings: []
} as unknown as BdbPortfolioImportResult;

const importacion = vi.hoisted(() => ({ resultado: null as unknown }));

vi.mock("../src/core/portfolioImport", () => ({
  buildLocalPortfolioImport: async () => importacion.resultado
}));
vi.mock("../src/adapters/assetDataSource", () => {
  const dataSource = {
    getComparableAssets: async () => [],
    buildManualPortfolioSummary: async () => ({ weighted_metrics: {}, warnings: [], by_economic_asset_class: [], total_weight_percent: 100, validation_status: "VALID" }),
    buildManualPortfolioOptimizationPreview: async () => null
  };
  return { getAssetDataSource: () => dataSource };
});

type PropsDelConstructor = Record<string, never> & {
  onReset: () => void;
  onImportText: (texto: string) => Promise<void>;
  onConfirmImport: () => void;
  onRiskProfileChange: (perfil: string | null) => void;
  portfolioNotice: string | null;
  selectedRiskProfileId: string | null;
  riskProfilePreview: unknown;
};
const visto = vi.hoisted(() => ({ props: null as unknown, informe: null as unknown, montajes: 0 }));

vi.mock("../src/components/PortfolioBuilder", () => ({
  PortfolioBuilder: (props: unknown) => {
    visto.props = props;
    return createElement("section", { "data-vista": "constructor" });
  }
}));
vi.mock("../src/pages/PortfolioReportPage", () => ({
  PortfolioReportPage: (props: unknown) => {
    visto.informe = props;
    return createElement("section", { "data-vista": "informe" });
  }
}));

const { PortfolioBuilderPage } = await import("../src/pages/PortfolioBuilderPage");
const { disenoEnSesion, perfilEnSesion, olvidarTrabajoDeCartera } = await import("../src/core/disenoEnSesion");
const { clearSessionCaches } = await import("../src/core/sessionCaches");

const CARTERA: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 40 }
];

let root: Root;
let host: HTMLDivElement;

function cicloDePrueba(sigue: boolean, generacion = 0) {
  const pendientes: (() => void)[] = [];
  const ciclo = {
    abierta: null,
    sinGuardar: true,
    guardando: false,
    generacion,
    conGuardia: vi.fn((accion: () => void) => {
      if (sigue) accion();
      else pendientes.push(accion);
    }),
    sustituir: vi.fn(),
    guardar: vi.fn(async () => ({ ok: true, mensaje: "guardada" })),
    dialogo: null
  };
  return { ciclo: ciclo as unknown as CicloDeCartera & typeof ciclo, pendientes };
}

async function montar(ciclo: CicloDeCartera | undefined, overrides: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      createElement(PortfolioBuilderPage, {
        positions: CARTERA,
        setPositions: () => undefined,
        sourceKind: "LOCAL_MOCK",
        totalCapital: 250000,
        onCapitalChange: () => undefined,
        portfolioName: "Actual",
        onPortfolioNameChange: () => undefined,
        onViewChange: () => undefined,
        ciclo,
        ...overrides
      } as never)
    );
  });
}

const props = () => visto.props as PropsDelConstructor;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearSessionCaches();
  importacion.resultado = IMPORTACION;
  visto.props = null;
  visto.informe = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("lo que sustituye la cartera pasa por la guardia", () => {
  test("«Cargar las posiciones»: si se cancela, no se sustituye; lo importado no hereda nombre ni capital de la anterior, ni es la abierta", async () => {
    const { ciclo, pendientes } = cicloDePrueba(false);
    await montar(ciclo);
    await act(async () => {
      await props().onImportText("texto");
    });
    expect(ciclo.sustituir).not.toHaveBeenCalled();
    await act(async () => props().onConfirmImport());
    expect(ciclo.conGuardia).toHaveBeenCalledTimes(1);
    expect(ciclo.sustituir).not.toHaveBeenCalled();
    // El asesor dice «Descartar».
    await act(async () => pendientes[0]());
    /* Decisión 38: nombre y capital se vacían; el `null` es que no hay cartera abierta. */
    expect(ciclo.sustituir).toHaveBeenCalledWith({ positions: IMPORTACION.imported_positions, capital: undefined, nombre: "" }, null);
    expect(props().portfolioNotice).toContain("El nombre y el capital de la cartera anterior no se conservan.");
  });

  test("sobre una cartera vacía, lo importado conserva el nombre y el capital que se acaban de poner", async () => {
    const { ciclo } = cicloDePrueba(true);
    await montar(ciclo, { positions: [] });
    await act(async () => {
      await props().onImportText("texto");
    });
    await act(async () => props().onConfirmImport());
    expect(ciclo.sustituir).toHaveBeenCalledWith({ positions: IMPORTACION.imported_positions, capital: 250000, nombre: "Actual" }, null);
    expect(props().portfolioNotice).not.toContain("no se conserva");
  });

  test("sobre una cartera vacía, el capital del fichero manda sobre el que hubiera, y el nombre se queda", async () => {
    importacion.resultado = { ...IMPORTACION, detected_capital: 700000 };
    const { ciclo } = cicloDePrueba(true);
    await montar(ciclo, { positions: [] });
    await act(async () => {
      await props().onImportText("texto");
    });
    await act(async () => props().onConfirmImport());
    expect(ciclo.sustituir).toHaveBeenCalledWith({ positions: IMPORTACION.imported_positions, capital: 700000, nombre: "Actual" }, null);
  });

  test("un extracto con patrimonio trae su capital", async () => {
    importacion.resultado = { ...IMPORTACION, detected_capital: 700000 };
    const { ciclo } = cicloDePrueba(true);
    await montar(ciclo);
    await act(async () => {
      await props().onImportText("texto");
    });
    await act(async () => props().onConfirmImport());
    expect(ciclo.sustituir).toHaveBeenCalledWith({ positions: IMPORTACION.imported_positions, capital: 700000, nombre: "" }, null);
    expect(props().portfolioNotice).toContain("Capital tomado del extracto");
    expect(props().portfolioNotice).toContain("El nombre de la cartera anterior no se conserva.");
  });

  test("«Nueva cartera» deja todo vacío, sin capital: F-04", async () => {
    const { ciclo, pendientes } = cicloDePrueba(false);
    await montar(ciclo);
    await act(async () => props().onReset());
    expect(ciclo.sustituir).not.toHaveBeenCalled();
    await act(async () => pendientes[0]());
    expect(ciclo.sustituir).toHaveBeenCalledWith({ positions: [], capital: undefined, nombre: "" }, null);
  });
});

describe("el foco al cambiar de cartera", () => {
  const conElContenido = async (comprobar: (contenido: HTMLElement) => Promise<void>) => {
    const contenido = document.createElement("main");
    contenido.id = "contenido-principal";
    contenido.tabIndex = -1;
    document.body.appendChild(contenido);
    try {
      await comprobar(contenido);
    } finally {
      contenido.remove();
    }
  };

  test("el botón que abrió el diálogo ya no está: va al contenido, y no al cuerpo de la página", async () => {
    await conElContenido(async (contenido) => {
      await montar(cicloDePrueba(true, 0).ciclo);
      expect(document.activeElement).toBe(document.body);
      await montar(cicloDePrueba(true, 1).ciclo);
      expect(document.activeElement).toBe(contenido);
    });
  });

  test("si el foco sigue en algún sitio, no se le mueve", async () => {
    await conElContenido(async () => {
      const campo = document.createElement("input");
      document.body.appendChild(campo);
      try {
        await montar(cicloDePrueba(true, 0).ciclo);
        campo.focus();
        await montar(cicloDePrueba(true, 1).ciclo);
        expect(document.activeElement).toBe(campo);
      } finally {
        campo.remove();
      }
    });
  });

  test("al entrar, o si la cartera es la misma, no se toca", async () => {
    await conElContenido(async () => {
      await montar(cicloDePrueba(true, 3).ciclo);
      await montar(cicloDePrueba(true, 3).ciclo);
      expect(document.activeElement).toBe(document.body);
    });
  });
});

describe("una nota dice algo de la cartera de ese momento", () => {
  const nota = () => (visto.props as { portfolioNotice: string | null }).portfolioNotice;
  const aplicarMejora = async (siguiente: BdbManualPortfolioPosition[]) => {
    await act(async () => (visto.props as { onApplyImprovement: (p: BdbManualPortfolioPosition[]) => void }).onApplyImprovement(siguiente));
  };

  test("mientras la cartera es esa, se queda; en cuanto cambia, se quita sola", async () => {
    const { ciclo } = cicloDePrueba(true);
    await montar(ciclo);
    await aplicarMejora(CARTERA);
    expect(nota()).toContain("Sustituciones de «Fondos equivalentes» aplicadas");

    await montar(ciclo);
    expect(nota()).toContain("Sustituciones de «Fondos equivalentes» aplicadas");

    await montar(ciclo, { positions: [{ asset_id: "A", weight_percent: 70 }, { asset_id: "B", weight_percent: 30 }] });
    expect(nota()).toBeNull();
  });

  test("un capital distinto también es otra cartera", async () => {
    const { ciclo } = cicloDePrueba(true);
    await montar(ciclo);
    await aplicarMejora(CARTERA);
    await montar(ciclo, { totalCapital: 300000 });
    expect(nota()).toBeNull();
  });
});

describe("el perfil (decisión 14)", () => {
  test("nadie llega con un nivel puesto", async () => {
    await montar(cicloDePrueba(true).ciclo);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(props().selectedRiskProfileId).toBeNull();
    expect(props().riskProfilePreview).toBeNull();
  });

  test("lo elegido se conserva en la sesión, y se olvida al cambiar de cartera", async () => {
    const { ciclo } = cicloDePrueba(true);
    await montar(ciclo);
    await act(async () => props().onRiskProfileChange("RISK_3"));
    expect(props().selectedRiskProfileId).toBe("RISK_3");
    expect(perfilEnSesion.read()).toBe("RISK_3");

    await act(async () => root.unmount());
    root = createRoot(host);
    await montar(ciclo);
    expect(props().selectedRiskProfileId).toBe("RISK_3");

    // Otra cartera: el marco olvida el trabajo y cambia la generación.
    olvidarTrabajoDeCartera();
    await montar(cicloDePrueba(true, 1).ciclo);
    expect(props().selectedRiskProfileId).toBeNull();
  });
});

describe("los candados del informe", () => {
  /* En esta pantalla solo los leen los PDF, y el papel no se mueve en esta tanda: por el menú, como siempre, sin ellos.
     Si deben llegar siempre es decisión de Óscar. */
  test("por el menú llega sin ellos, aunque la sesión los tenga", async () => {
    disenoEnSesion.write({ ...disenoEnSesion.read(), locks: { A: true } });
    await montar(cicloDePrueba(true).ciclo, { view: "report" });
    expect((visto.informe as { lockedWeights: Record<string, number> }).lockedWeights).toEqual({});
  });

  test("sin candados, ninguno", async () => {
    await montar(cicloDePrueba(true).ciclo, { view: "report" });
    expect((visto.informe as { lockedWeights: Record<string, number> }).lockedWeights).toEqual({});
  });
});

describe("el trabajo a medias", () => {
  test("una importación pendiente de confirmar sigue ahí al volver", async () => {
    const { ciclo } = cicloDePrueba(true);
    await montar(ciclo);
    await act(async () => {
      await props().onImportText("texto");
    });
    await act(async () => root.unmount());
    root = createRoot(host);
    await montar(ciclo);
    expect((visto.props as { importResult: unknown }).importResult).toEqual(IMPORTACION);
    await act(async () => props().onConfirmImport());
    expect(ciclo.sustituir).toHaveBeenCalledTimes(1);
  });
});
