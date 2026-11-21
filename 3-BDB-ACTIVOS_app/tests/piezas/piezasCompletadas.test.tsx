// @vitest-environment happy-dom
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AsyncErrorBanner } from "../../src/components/AsyncErrorBanner";
import { EmptyState } from "../../src/components/ui/AsyncState";
import { Button } from "../../src/components/ui/Button";
import { ESPERA_DEL_ANUNCIO_MS } from "../../src/components/ui/anunciar";
import { PanelDePestana, SegmentedTabs } from "../../src/components/ui/SegmentedTabs";
import { AppError } from "../../src/core/appError";
import { pintar, pulsar } from "./pintar";

/** Las piezas que ya existían y se completan en el paso 2: botón, pestañas, estado vacío y banner de error. */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
  vi.useRealTimers();
});

const anunciador = () => document.querySelector("[data-anunciador]");

describe("el botón", () => {
  test("tiene tamaño grande", () => {
    expect(renderToStaticMarkup(<Button size="lg">Descargar el informe</Button>)).toContain('class="ui-button ui-button--secondary ui-button--lg"');
  });

  test("trabajando, lo anuncia sin cambiar su nombre", () => {
    vi.useFakeTimers();
    const vista = pintar(<Button>Guardar</Button>);
    quitar = vista.quitar;
    vista.repintar(<Button busy>Guardar</Button>);
    const boton = vista.host.querySelector("button")!;
    expect(boton.disabled).toBe(true);
    expect(boton.getAttribute("aria-busy")).toBe("true");
    expect(boton.textContent).toBe("Guardar");
    act(() => vi.advanceTimersByTime(ESPERA_DEL_ANUNCIO_MS));
    const region = anunciador()!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.className).toBe("sr-only");
    expect(region.textContent).toBe("Trabajando…");
  });

  test("anuncia lo que se le diga, y no vuelve a anunciar mientras sigue trabajando", () => {
    vi.useFakeTimers();
    const vista = pintar(
      <Button busy textoAlTrabajar="Calculando la frontera…">
        Optimizar
      </Button>
    );
    quitar = vista.quitar;
    act(() => vi.advanceTimersByTime(ESPERA_DEL_ANUNCIO_MS));
    expect(anunciador()!.textContent).toBe("Calculando la frontera…");
    act(() => {
      anunciador()!.textContent = "";
    });
    vista.repintar(
      <Button busy className="otra" textoAlTrabajar="Calculando la frontera…">
        Optimizar
      </Button>
    );
    act(() => vi.advanceTimersByTime(ESPERA_DEL_ANUNCIO_MS));
    expect(anunciador()!.textContent).toBe("");
  });
});

describe("el panel de una pestaña", () => {
  test("lleva el id, el rol y el nombre que casan con su pestaña", () => {
    const vista = pintar(
      <>
        <SegmentedTabs
          idPrefix="analisis"
          label="Secciones"
          onChange={() => undefined}
          tabs={[
            { id: "resumen", label: "Resumen" },
            { id: "datos", label: "Datos" }
          ]}
          value="datos"
        />
        <PanelDePestana idPrefix="analisis" pestana="datos">
          <p>Contenido</p>
        </PanelDePestana>
      </>
    );
    quitar = vista.quitar;
    const pestana = vista.host.querySelector('[role="tab"][aria-selected="true"]')!;
    const panel = vista.host.querySelector('[role="tabpanel"]')!;
    expect(pestana.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(pestana.id);
    expect(panel.hasAttribute("tabindex")).toBe(false);
  });

  test("enfocable, si no empieza por algo que se pueda enfocar", () => {
    expect(renderToStaticMarkup(<PanelDePestana enfocable idPrefix="x" pestana="a">Texto</PanelDePestana>)).toBe(
      '<div aria-labelledby="x-tab-a" id="x-panel-a" role="tabpanel" tabindex="0">Texto</div>'
    );
  });
});

describe("el estado vacío", () => {
  /* MAR-32: con la regla de `Panel`, `h2` el estado vacío que ocupa un bloque, `h3` el que va dentro de uno. */
  test("h2 por defecto, y el nivel que se pida", () => {
    expect(renderToStaticMarkup(<EmptyState description="d" title="Sin comparación" />)).toContain("<h2>Sin comparación</h2>");
    expect(renderToStaticMarkup(<EmptyState description="d" nivel={2} title="Sin carteras" />)).toContain("<h2>Sin carteras</h2>");
    expect(renderToStaticMarkup(<EmptyState description="d" nivel={3} title="Sin datos" />)).toContain("<h3>Sin datos</h3>");
  });
});

describe("el banner de error de una carga", () => {
  test("es un aviso de error que se anuncia, con «Reintentar» hecho con la pieza Button", () => {
    const reintentar = vi.fn();
    const vista = pintar(<AsyncErrorBanner error={new Error("Series no disponibles.")} onRetry={reintentar} />);
    quitar = vista.quitar;
    const banner = vista.host.querySelector(".async-error-banner")!;
    expect(banner.className).toBe("aviso aviso--error async-error-banner");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.querySelector(".aviso__titulo")?.textContent).toBeTruthy();
    expect(banner.textContent).toContain("Series no disponibles.");
    const boton = banner.querySelector(".aviso__accion button")!;
    expect(boton.className).toContain("ui-button");
    expect(boton.textContent).toBe("Reintentar");
    pulsar(boton);
    expect(reintentar).toHaveBeenCalledTimes(1);
  });

  test("un tope del servidor no se arregla reintentando: sin botón", () => {
    const vista = pintar(<AsyncErrorBanner error={new AppError("BACKEND", "Demasiados activos.", { limite: true })} onRetry={() => undefined} />);
    quitar = vista.quitar;
    expect(vista.host.querySelector("button")).toBeNull();
  });
});
