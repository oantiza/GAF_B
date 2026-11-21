import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SystemStatusResponse } from "../src/adapters/systemStatusBackend";
/* PLA-22: la página envoltorio (`SystemStatusPage`) ya no la montaba ninguna ruta y se retiró; se prueba el contenido,
   que es lo que monta la pestaña «Estado del sistema» de Sistema. */
import { SystemStatusContent } from "../src/pages/SystemStatusPage";


const NOW = new Date("2026-07-12T12:00:00Z");

/* PLA-12: la fecha y la hora, en la hora local de quien mira, con el formato común «12/07/2026 10:45». Se calcula aquí
   aparte, con los métodos del propio `Date`, para que la prueba no dependa del huso en que corre. */
const dos = (n: number) => String(n).padStart(2, "0");
const horaLocal = (iso: string) => {
  const d = new Date(iso);
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
};

const STATUS_FIXTURE = {
  integrity: {
    checked_at: "2026-07-12T08:45:00Z",
    status: "WARN",
    freshness: {
      price_refresh: "OK",
      metrics_refresh: "WARN",
      backup: "FAIL"
    },
    counts: {
      assets_total: 753,
      assets_isin_active: 740,
      search_index_missing: 2,
      portfolios: 7,
      recuento_extra: 1234
    },
    problems: [
      {
        severity: "INFO",
        check: "metrics_cycle_partial",
        detail: "El ciclo continuará en la próxima ejecución."
      },
      {
        severity: "WARN",
        check: "search_index_missing",
        detail: "Dos activos están fuera del buscador.",
        sample: ["ES0000000001", "LU0000000002"]
      },
      {
        severity: "FAIL",
        check: "backup_freshness",
        detail: "El backup supera el umbral crítico."
      }
    ]
  },
  backup: {
    completed_at: "2026-07-07T03:00:00Z",
    verification: "SHA256_OK",
    firestore_records: 12345
  },
  prices: {
    last_run: "2026-07-12T07:30:00Z",
    read_budget_used: 1200,
    read_budget_max: 2000
  },
  metrics: {
    last_run: "2026-07-10T08:00:00Z",
    cycle_completed: false,
    stopped_by_budget: true,
    read_budget_used: 6000,
    read_budget_max: 6000
  }
} as unknown as SystemStatusResponse;

const EMPTY_FIXTURE = {
  integrity: null,
  backup: null,
  prices: null,
  metrics: null
} satisfies SystemStatusResponse;

function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

describe("SystemStatusContent", () => {
  it("renders health, freshness, ages, partial metrics, counts and sorted problems", () => {
    const html = renderToStaticMarkup(<SystemStatusContent snapshot={STATUS_FIXTURE} now={NOW} />);
    const text = plainText(html);

    expect(text).toContain("Requiere atención");
    expect(html).toContain("system-health-hero is-warn");
    expect(html).toContain("system-freshness-card is-ok");
    expect(html).toContain("system-freshness-card is-warn");
    expect(html).toContain("system-freshness-card is-fail");
    /* Rediseño: el estado de cada comprobación es un `Distintivo` con su palabra; el tono lo refuerza. */
    expect(html).toContain('<span class="distintivo distintivo--neutro">Información</span>');
    expect(html).toContain('<span class="distintivo distintivo--marca">Correcto</span>');

    /* PLA-12: fechas «12/07/2026 10:45» (antes «12 jul 2026, 10:45») y recuentos con su punto de millar. */
    expect(text).toContain(`Comprobación publicada: ${horaLocal("2026-07-12T08:45:00Z")}`);
    expect(text).toContain(horaLocal("2026-07-12T07:30:00Z"));
    expect(text).toContain(horaLocal("2026-07-10T08:00:00Z"));
    expect(text).toContain(horaLocal("2026-07-07T03:00:00Z"));
    expect(text).toContain("Antigüedad: 0 días");
    expect(text).toContain("Antigüedad: 2 días");
    expect(text).toContain("Antigüedad: 5 días");
    expect(text).toContain("Ciclo parcial · límite de lecturas alcanzado");
    expect(text).toContain("Lecturas: 1.200 de 2.000");
    expect(text).toContain("Lecturas: 6.000 de 6.000");
    expect(text).toContain("Verificación: SHA256_OK");
    expect(text).toContain("Registros Firestore: 12.345");
    /* PLA-18: la copia se llama igual que en Operaciones. */
    expect(text).toContain("Copia de la maestra");

    /* Los conteos van en una tabla de dos columnas: rótulo y cifra seguidos. */
    expect(text).toContain("Documentos en assets753");
    expect(text).toContain("Activos ISIN activos740");
    expect(text).toContain("Activos fuera del buscador2");
    expect(text).toContain("Carteras guardadas7");
    expect(text).toContain("Recuento extra1.234");
    expect(text).not.toContain("Watermarks");
    expect(text).toContain("Última ejecución de cada proceso");
    /* El nombre escrito de cada comprobación, no su código. */
    expect(text).toContain("Antigüedad de la copia de seguridad");
    expect(text).not.toContain("Backup freshness");

    const failIndex = text.indexOf("El backup supera el umbral crítico.");
    const warnIndex = text.indexOf("Dos activos están fuera del buscador.");
    const infoIndex = text.indexOf("El ciclo continuará en la próxima ejecución.");
    expect(failIndex).toBeGreaterThan(-1);
    expect(warnIndex).toBeGreaterThan(failIndex);
    expect(infoIndex).toBeGreaterThan(warnIndex);
    expect(text).toContain("Muestra: ES0000000001, LU0000000002");
  });

  it("traduce lo que venía en inglés: inventarios, valor liquidativo y verificación", () => {
    const snapshot = {
      ...STATUS_FIXTURE,
      integrity: {
        ...STATUS_FIXTURE.integrity,
        counts: { admin_inventory_rows: 1097, admin_inventory_rebuilt: 0, fund_quality_rebuilt: 1 },
        problems: [{ severity: "WARN", check: "upstream_nav_stale", detail: "LU1066281574: el proveedor sigue sin publicar un NAV reciente" }]
      },
      backup: { ...STATUS_FIXTURE.backup, verification: "PASS" }
    } as unknown as SystemStatusResponse;
    const text = plainText(renderToStaticMarkup(<SystemStatusContent snapshot={snapshot} now={NOW} />));

    expect(text).toContain("Filas del inventario de administración1.097");
    expect(text).toContain("Inventario de administración reconstruidoNo");
    expect(text).toContain("Inventario de calidad de fondos reconstruidoSí");
    expect(text).toContain("Valor liquidativo sin actualizar en el proveedor");
    expect(text).toContain("Verificación: correcta");
    for (const fuera of ["Admin inventory", "Fund quality", "Upstream nav", "PASS"]) expect(text).not.toContain(fuera);
  });

  it("renders the OK summary when integrity reports no problems", () => {
    const snapshot: SystemStatusResponse = {
      ...STATUS_FIXTURE,
      integrity: {
        ...STATUS_FIXTURE.integrity,
        status: "OK",
        problems: [],
        freshness: { price_refresh: "OK", metrics_refresh: "OK", backup: "OK" }
      }
    };

    const text = plainText(renderToStaticMarkup(<SystemStatusContent snapshot={snapshot} now={NOW} />));

    expect(text).toContain("Sistema operativo");
    expect(text).toContain("Sin incidencias publicadas");
  });

  it("uses «Sin datos» and «Falta el dato» safely when every backend document is null", () => {
    const html = renderToStaticMarkup(<SystemStatusContent snapshot={EMPTY_FIXTURE} now={NOW} />);
    const text = plainText(html);

    /* Lo que falta se dice con la palabra común (antes «N/D»). */
    expect(text).not.toContain("N/D");
    expect(text).toContain("Sin datos");
    expect(text).toContain("Estado no disponible");
    expect(text).toContain("Comprobación publicada: Falta el dato");
    expect(text).toContain("Antigüedad: falta el dato");
    expect(text).toContain("Sin marcador");
    expect(text).toContain("Verificación: falta el dato");
    expect(text).toContain("Registros Firestore: falta el dato");
    expect(text).toContain("El semáforo publicado no incluye conteos.");
    expect(text).toContain("Sin detalle de incidencias");
  });
});

