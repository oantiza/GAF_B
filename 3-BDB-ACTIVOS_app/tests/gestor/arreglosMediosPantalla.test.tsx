// @vitest-environment happy-dom
/**
 * Auditoría · arreglos medios y bajos de la pantalla del gestor: textos que decían algo falso o
 * ambiguo, cuentas mal hechas en los rótulos y estados que faltaban. Cada cifra esperada lleva su
 * cuenta a mano junto a ella.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import { analizar, fechaDeInicioDelPeriodo, periodosHabituales, preparar } from "../../src/gestor/motor/analisis";
import { metrica } from "../../src/gestor/motor/metricas/registro";
import { periodoEnPalabras } from "../../src/gestor/informes/formato";
import { periodoDelAnalisis } from "../../src/gestor/ui/estado/useAnalisisDeCartera";
import { BloqueContribucion } from "../../src/gestor/ui/analisis/BloqueContribucion";
import { BloqueIngresosYCostes } from "../../src/gestor/ui/analisis/BloqueIngresosYCostes";
import { BloqueRentabilidad } from "../../src/gestor/ui/analisis/BloqueRentabilidad";
import { RespuestaDeLaCartera } from "../../src/gestor/ui/RespuestaDeLaCartera";
import { VistaResumen } from "../../src/gestor/ui/vistas/VistaResumen";
import { activo, cartera, mov, serie } from "./ayudas";
import { mercado as mercadoDeAuditoria, TODO } from "./auditoria/ayudasAuditoria";
import { datosDeLaDemo, datosDeVista, HOY, panel, pintar, type Pintado } from "./vistaAnalisisDatos";

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

/* 10.000 € el 2 ene 2025 en un fondo a 100 €; vale 110 el 13-11-2026. Un solo activo: su concentración es una nota, no cuenta. */
const FONDO = activo("A", "FONDO");
const conAvisoDeMercado = (avisos: string[]): MercadoCargado => ({
  datos: { precios: new Map([["A", serie(["2025-01-02", 100], ["2026-11-13", 110])]]), cambios: new Map() },
  fichas: new Map(),
  avisos
});
const BASE = [
  mov("aportacion", "2025-01-02", { importe: "10000" }),
  mov("suscripcion", "2025-01-02", { activoId: "A", titulos: "100", precio: "100", importe: "-10000" })
];

describe("GES-19 · el panel «cosas que revisar» cuenta todos los avisos que enseña", () => {
  it("sin avisos del motor y uno de mercado: «Una cosa que revisar»", async () => {
    pintado = await pintar(<VistaResumen datos={datosDeVista(cartera([FONDO], BASE), conAvisoDeMercado(["No se han podido leer los cambios."]))} />);
    expect(pintado.vista.textContent).toContain("Una cosa que revisar");
    expect(pintado.vista.textContent).not.toContain("1 cosas");
  });

  it("uno del motor y uno de mercado: «2 cosas que revisar»", async () => {
    /* Una comisión de 5 € con la cuenta a cero: efectivo en negativo, un aviso. */
    const c = cartera([FONDO], [...BASE, mov("comision", "2025-02-03", { importe: "-5" })]);
    pintado = await pintar(<VistaResumen datos={datosDeVista(c, conAvisoDeMercado(["No se han podido leer los cambios."]))} />);
    expect(pintado.vista.textContent).toContain("2 cosas que revisar");
  });
});

describe("GES-11 · «ingresos» y «costes» no nombran dos cifras distintas", () => {
  const datos = datosDeLaDemo();

  it("el Resumen dice que sus ingresos van netos de retención e incluyen los intereses, y que sus costes son los de la cuenta con impuestos", async () => {
    pintado = await pintar(<VistaResumen datos={datos} />);
    const bloque = panel(pintado.vista, "De dónde viene el resultado").textContent ?? "";
    expect(bloque).toContain("Ingresos netos de retención");
    expect(bloque).toContain("Costes e impuestos de la cuenta");
    expect(bloque).not.toMatch(/Ingresos(?! netos)/);
  });

  it("la variación de precio dice en su propia fila que ya lleva descontadas las comisiones de compras y ventas (MOT-05)", async () => {
    /* Antes solo lo decía la nota de la fila de costes, que no sale cuando la cuenta no tiene costes. */
    pintado = await pintar(<VistaResumen datos={datos} />);
    const filas = [...panel(pintado.vista, "De dónde viene el resultado").querySelectorAll(".rows > *")].map((fila) => fila.textContent ?? "");
    const precio = filas.find((fila) => fila.includes("Variación de precio"));
    expect(precio).toContain("ya descontadas las comisiones de compras y ventas");
  });

  it("Análisis llama a su cifra «dividendos y cupones cobrados» y dice que no lleva los intereses; la métrica se llama igual", async () => {
    pintado = await pintar(<BloqueIngresosYCostes analisis={datos.analisis} />);
    const texto = pintado.vista.textContent ?? "";
    expect(texto).toContain("Dividendos y cupones cobrados, netos de retención");
    expect(texto).toContain("Sin los intereses de la cuenta");
    expect(texto).toContain("Costes pagados, sin impuestos");
    expect(metrica("ingresos").nombre).toBe("Dividendos y cupones cobrados");
    expect(metrica("costes").nombre).toBe("Costes totales");
  });
});

describe("DIR-02 · «En qué está invertida» dice que mira dentro de los fondos", () => {
  it("el bloque lo dice y la liquidez explica que incluye la de los fondos", async () => {
    pintado = await pintar(<VistaResumen datos={datosDeLaDemo()} />);
    const bloque = panel(pintado.vista, "En qué está invertida").textContent ?? "";
    expect(bloque).toContain("mirando dentro de cada fondo");
    expect(bloque).toContain("incluye la liquidez que mantienen los fondos");
  });
});

describe("MOT-10 · el pie de la contribución cuadra con el resultado al céntimo", () => {
  it("precio + ingresos + divisa − costes del pie = resultado del pie", async () => {
    /*
     * El caso de `desglose.test.ts`: 406,6667 + 40 + 166,6667 − 15 = 598,3333. Redondeando cada parte por su cuenta,
     * 406,67 + 40,00 + 166,67 − 15,00 = 598,34 frente a 598,33; con las partes cuadradas, suman 598,33.
     */
    const c = cartera([activo("USA", "ACCION", "USD")], [
      mov("aportacion", "2025-03-03", { importe: "10000" }),
      mov("compra", "2025-03-03", { activoId: "USA", titulos: "50", precio: "100", cambio: "1.25", comision: "10", importe: "-4010" }),
      mov("dividendo", "2025-03-10", { activoId: "USA", importe: "40", retencion: "10" }),
      mov("comision", "2025-03-12", { importe: "-15", nota: "Custodia" })
    ]);
    const m = mercadoDeAuditoria({ USA: [["2025-03-03", 100], ["2025-03-14", 110]] }, { USD: [["2025-03-03", 1.25], ["2025-03-14", 1.2]] });
    const a = analizar(preparar(c, m, new Map(), "2025-03-14"), TODO);
    pintado = await pintar(<BloqueContribucion activos={c.activos} analisis={a} />);
    const celdas = [...pintado.vista.querySelectorAll("tfoot td")].map((td) => td.textContent ?? "");
    const centimos = (texto: string) => Math.round(Number(texto.replace(/−/g, "-").replace(/[^\d,+-]/g, "").replace(",", ".")) * 100);
    const [resultado, precio, ingresos, divisa, costes] = celdas.map(centimos);
    expect(resultado).toBe(59833);
    expect(precio + ingresos + divisa + costes).toBe(resultado); // los costes ya vienen con su signo menos
  });
});

describe("MOT-09 y DIR-08 · una sola regla para la fecha de inicio del periodo", () => {
  /* Una cartera nueva: aportación el 02-01-2026. El año en curso se mide desde la víspera, 01-01, pero se rotula el 02-01. */
  const nueva = cartera([FONDO], [
    mov("aportacion", "2026-01-02", { importe: "10000" }),
    mov("suscripcion", "2026-01-02", { activoId: "A", titulos: "100", precio: "100", importe: "-10000" })
  ]);
  const datosNueva = datosDeVista(nueva, conAvisoDeMercado([]), HOY, "anio");
  const demo = datosDeLaDemo("anio");

  it("con la cartera ya en marcha, la fecha desde la que se mide: el cierre del 31-12; si empieza después, su primer movimiento", () => {
    expect(fechaDeInicioDelPeriodo(demo.analisis)).toBe("2025-12-31");
    expect(datosNueva.analisis.periodo.desde).toBe("2026-01-01");
    expect(fechaDeInicioDelPeriodo(datosNueva.analisis)).toBe("2026-01-02");
  });

  it("la pantalla y el informe escriben la misma fecha", async () => {
    pintado = await pintar(<BloqueRentabilidad analisis={datosNueva.analisis} />);
    expect(pintado.vista.textContent).toContain("Del 02/01/2026 al 13/11/2026");
    expect(periodoEnPalabras(datosNueva.analisis)).toBe("Del 2 de enero de 2026 al 13 de noviembre de 2026");
    await pintado.desmontar();
    pintado = await pintar(<BloqueRentabilidad analisis={demo.analisis} />);
    expect(pintado.vista.textContent).toContain("Del 31/12/2025 al 13/11/2026");
    expect(periodoEnPalabras(demo.analisis)).toBe("Del 31 de diciembre de 2025 al 13 de noviembre de 2026");
  });
});

describe("GES-12 · un periodo imposible cae a «Desde el inicio» y lo dice", () => {
  const preparado = preparar(cartera([FONDO], BASE), conAvisoDeMercado([]).datos, new Map(), HOY);
  const periodos = periodosHabituales(preparado.valoracion, HOY);

  it("«Entre dos fechas» con desde = hasta se marca como caído", () => {
    const elegido = periodoDelAnalisis({ id: "libre", libre: { desde: "2026-03-01", hasta: "2026-03-01" } }, periodos);
    expect(elegido.caido).toBe(true);
    expect(elegido.periodo).toEqual(periodos.find((p) => p.id === "inicio")!.periodo);
    expect(periodoDelAnalisis({ id: "libre", libre: { desde: "2026-01-01", hasta: "2026-03-01" } }, periodos).caido).toBe(false);
  });

  it("la respuesta de la cartera dice «desde el inicio», no «entre las dos fechas»", async () => {
    const datos = { ...datosDeVista(cartera([FONDO], BASE), conAvisoDeMercado([])), elegido: { id: "libre" as const, libre: { desde: "2026-03-01", hasta: "2026-03-01" } }, periodoCaido: true };
    /* Desde el rediseño, el resultado del periodo va en la respuesta, sobre las pestañas, y no dentro del Resumen. */
    pintado = await pintar(<RespuestaDeLaCartera datos={datos} />);
    expect(pintado.vista.textContent).toContain("Resultado del periodo");
    expect(pintado.vista.textContent).toContain("desde el inicio, del 02/01/2025 al 13/11/2026");
    expect(pintado.vista.textContent).not.toContain("entre las dos fechas");
  });
});

describe("MOT-06 · la ayuda del resultado latente dice que en un bono incluye el cupón corrido", () => {
  it("lo dice en lenguaje llano", () => {
    expect(metrica("resultadoLatente").ayuda).toContain("En un bono incluye el cupón corrido");
  });
});
