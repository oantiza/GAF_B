import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "../src/components/ui/Button";
import { EmptyState } from "../src/components/ui/AsyncState";
import { KpiStrip } from "../src/components/ui/KpiStrip";
import { PageHeader } from "../src/components/ui/PageHeader";
import { SegmentedControl } from "../src/components/ui/SegmentedControl";
import { SegmentedTabs } from "../src/components/ui/SegmentedTabs";

describe("UI primitives", () => {
  it("renders button variants with safe defaults", () => {
    const html = renderToStaticMarkup(<Button variant="danger">Eliminar</Button>);

    expect(html).toContain('type="button"');
    expect(html).toContain("ui-button--danger");
    expect(html).toContain("Eliminar");
  });

  it("keeps tabs and panels connected through aria attributes", () => {
    const html = renderToStaticMarkup(
      <SegmentedTabs
        tabs={[
          { id: "overview", label: "Resumen" },
          { id: "risk", label: "Riesgo" }
        ]}
        value="risk"
        onChange={() => undefined}
        label="Secciones"
        idPrefix="sample"
      />
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="sample-tab-risk"');
    expect(html).toContain('aria-controls="sample-panel-risk"');
    expect(html).toContain('aria-selected="true"');
  });

  it("renders shared page and metric hierarchy", () => {
    const html = renderToStaticMarkup(
      <>
        <PageHeader eyebrow="Cartera" title="Diagnóstico" description="Lectura para el asesor" />
        <KpiStrip items={[{ label: "Estado", value: "Vigilar", tone: "warn", note: "dos avisos" }]} />
      </>
    );

    expect(html).toContain("ui-page-header");
    expect(html).toContain("Diagnóstico");
    expect(html).toContain("ui-kpi__value ui-kpi__value--text warn");
    expect(html).toContain('<span class="ui-kpi__note">dos avisos</span>');
  });

  it("a strip of euro amounts says so, and any other strip keeps its class untouched", () => {
    const items = [{ label: "Valor", value: "1.234.567 €" }];
    expect(renderToStaticMarkup(<KpiStrip items={items} />)).toContain('<div class="ui-kpi-strip">');
    expect(renderToStaticMarkup(<KpiStrip importes items={items} />)).toContain('<div class="ui-kpi-strip ui-kpi-strip--importes">');
    expect(renderToStaticMarkup(<KpiStrip className="metrics-grid" importes items={items} />)).toContain('<div class="ui-kpi-strip ui-kpi-strip--importes metrics-grid">');
  });

  it("exposes segmented choices as pressed buttons", () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        label="Periodo"
        onChange={() => undefined}
        options={[
          { id: 1, label: "1A" },
          { id: 3, label: "3A" }
        ]}
        value={3}
      />
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Periodo"');
    expect(html).toContain('data-segment-id="3"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("renders a reusable empty state with its action", () => {
    const html = renderToStaticMarkup(
      <EmptyState description="Añade dos activos." title="Sin comparación" action={<Button>Buscar</Button>} />
    );

    expect(html).toContain("ui-empty-state");
    expect(html).toContain("Sin comparación");
    expect(html).toContain("Buscar");
  });
});
