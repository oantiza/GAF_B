/*
 * Ola A2 (A2.6). Las fechas «solo día» del backend deben mostrarse como el
 * mismo día de calendario en cualquier huso horario. Antes, las funciones de
 * fecha parseaban «2026-08-25» como medianoche UTC y la formateaban en hora
 * local: al oeste de UTC salía el 24. Este fichero fija el huso ANTES de
 * importar el módulo para reproducir exactamente ese caso.
 *
 * Desde el 14-11-2026 lo afirma sobre el módulo único de formato
 * (`src/core/formato.ts`): el módulo antiguo, que es el que tenía el defecto,
 * ya no existe, y la garantía es la regla 8 del nuevo («un día AAAA-MM-DD se
 * pinta tal cual, sin pasar por un huso; un instante, en la hora local»).
 */
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import { compactDate, tooltipDate } from "../src/charts/oaa/chartFormatters";
import { fecha, fechaDeEje, fechaLarga, fechaYHora, periodo } from "../src/core/formato";

describe("las fechas al oeste de UTC", () => {
  it("un día se muestra como el día del dato, no el anterior", () => {
    expect(fecha("2026-08-25")).toBe("25/08/2026");
  });

  it("con el mes escrito, también", () => {
    expect(fechaLarga("2026-08-25")).toBe("25 de agosto de 2026");
  });

  it("en el eje de un gráfico, el mes del dato: el día 1 no cae en el mes anterior", () => {
    expect(fechaDeEje("2026-09-01")).toBe("sep 2026");
  });

  it("un periodo, de día a día, sin moverse", () => {
    expect(periodo("2025-12-31", "2026-11-01")).toBe("del 31/12/2025 al 01/11/2026");
  });

  it("un día sin hora, pedido con hora, es ese día y no se le inventa la medianoche", () => {
    /* El módulo antiguo escribía «25/08/2026 · 00:00»: una hora que el dato no trae. */
    expect(fechaYHora("2026-08-25")).toBe("25/08/2026");
  });

  it("un instante completo se muestra en la hora local", () => {
    // 2026-08-25T23:30Z son las 19:30 del mismo día en Nueva York (UTC-4).
    expect(fechaYHora("2026-08-25T23:30:00Z")).toBe("25/08/2026 19:30");
    // Y a las 02:30Z del 26 todavía es el 25 en Nueva York: el día es el local.
    expect(fecha("2026-08-26T02:30:00Z")).toBe("25/08/2026");
  });
});

/* MEDIA-09 (auditoría 16-10-2026): los ejes y tooltips de los gráficos y la
   fecha del informe de Estrategia formateaban con `new Date` en hora local, y
   al oeste de UTC enseñaban el día (y en el eje, el mes) anterior. */
describe("fechas de gráficos al oeste de UTC", () => {
  /* Paso 2 del rediseño: los gráficos escriben con el módulo común; el eje, «sep 2026» (`fechaDeEje`), y la nota,
     «01/09/2026» (`fecha`). Lo que se comprueba no cambia: el mes y el día son los del dato, no los anteriores. */
  it("el eje compacto muestra el mes del dato", () => {
    expect(compactDate("2026-09-01")).toBe("sep 2026");
  });

  it("el tooltip muestra el día del dato", () => {
    expect(tooltipDate("2026-09-01")).toBe("01/09/2026");
  });

  it("lo que no es fecha se devuelve tal cual, y el módulo único no lo formatea", () => {
    expect(compactDate("Hoy")).toBe("Hoy");
    expect(tooltipDate("")).toBe("");
    expect(fecha("no es fecha")).toBeNull();
    expect(fechaDeEje("no es fecha")).toBeNull();
  });
});
