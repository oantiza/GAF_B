// @vitest-environment happy-dom
/**
 * Los restos de la posición sin precio (20-11-2026, tras la A-196 y A-197): lo que seguía callado o incoherente.
 *
 *  - «Llevar a una propuesta» dice por qué no hay nada que llevar, en vez de esconderse.
 *  - Composición dice que no hay nada que repartir cuando lo único que hay no tiene precio y no hay efectivo.
 *  - El cupón corrido de un bono sin precio no se da («Falta el dato»): la posición vale cero entero.
 *  - El aviso de la comprobación de la cartera dice que la rentabilidad no vale, como el de los días pasados.
 *  - Ingresos y costes: un fondo sin precio no entra en el coste corriente ni en su cobertura, y lo dice.
 *
 * Los dos informes del asesor, en `restosSinPrecioInformes.test.ts` (el PDF no se genera en happy-dom).
 *
 * Cuentas: el mercado es el de `posicionSinPrecioPantalla.test.tsx` (el dólar, desde el 04-01-2025: lo comprado el 03-01 pagando en
 * euros no tiene precio). Una cartera de un solo valor: 1.000 € aportados y 1.000 € pagados por B el 03-01 dejan el efectivo en 0.
 * El bono: nominal 10.000 USD, cupón anual del 5 %, vence el 30-06-2030, ACT/ACT. El 31-01-2025 el cupón anterior es del
 * 30-06-2024 (215 días: 184 hasta el 31-12 y 31 de enero) sobre un periodo regular de 365 días (30-06-2024 a 30-06-2025):
 * 10.000 × 5 % × 215 / 365 = 294,52 USD.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import { BloqueBonos } from "../../src/gestor/ui/analisis/BloqueBonos";
import { BloqueComposicion } from "../../src/gestor/ui/analisis/BloqueComposicion";
import { BloqueIngresosYCostes } from "../../src/gestor/ui/analisis/BloqueIngresosYCostes";
import { LlevarADiseno } from "../../src/gestor/ui/comparar/LlevarADiseno";
import { activo, cartera, mov, serie } from "./ayudas";
import { datosDeVista, panel, pintar, type Pintado } from "./vistaAnalisisDatos";

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

const ESPACIO_DURO = String.fromCharCode(0xa0);
const plano = (texto: string | null | undefined) => (texto ?? "").replaceAll(ESPACIO_DURO, " ").replace(/\s+/g, " ").trim();
const FIN = "2025-01-31";
const MERCADO: MercadoCargado = {
  datos: { precios: new Map([["A", serie(["2025-01-02", 100], [FIN, 120])]]), cambios: new Map([["USD", serie(["2025-01-04", 1.25])]]) },
  fichas: new Map(),
  avisos: []
};
const B_DEL_CATALOGO = activo("B", "ACCION", "USD", { origen: "catalogo", isin: "XB0000000002" });
const SOLO_B = (aportado: string) => cartera([B_DEL_CATALOGO], [mov("aportacion", "2025-01-02", { importe: aportado }), mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" })]);

describe("Llevar a una propuesta, con ninguna posición del catálogo con precio", () => {
  it("dice por qué no hay nada que llevar, con su nombre, y no ofrece el botón", async () => {
    pintado = await pintar(<LlevarADiseno analisis={datosDeVista(SOLO_B("3000"), MERCADO, FIN).analisis} onSendToBuilder={() => undefined} />);
    const bloque = panel(pintado.vista, "Llevar a una propuesta");
    expect(plano(bloque.querySelector("p.cmp-note")?.textContent)).toBe("No hay nada que llevar a Diseño: ninguna posición del catálogo tiene precio a 31/01/2025, y a Diseño solo pasan las que tienen valor de mercado. No pasa, porque no tiene precio: Activo B.");
    expect(bloque.querySelector("button")).toBeNull();
  });

  it("sin posiciones del catálogo sin precio no hay nada que explicar: el bloque no sale", async () => {
    const propia = cartera([activo("P")], [mov("aportacion", "2025-01-02", { importe: "1000" })]);
    pintado = await pintar(<LlevarADiseno analisis={datosDeVista(propia, MERCADO, FIN).analisis} onSendToBuilder={() => undefined} />);
    expect(pintado.vista.textContent).toBe("");
  });
});

describe("Composición, con una sola posición sin precio y sin efectivo", () => {
  it("sale, y dice que no hay nada que repartir y por qué", async () => {
    /* 1.000 € aportados y 1.000 € pagados por B: efectivo 0, y B sin precio. El patrimonio que se puede valorar es 0. */
    const analisis = datosDeVista(SOLO_B("1000"), MERCADO, FIN).analisis;
    expect(analisis.composicion.porTipoDeProducto.lineas).toHaveLength(0);
    pintado = await pintar(<BloqueComposicion analisis={analisis} />);
    const nota = plano(panel(pintado.vista, "Composición").querySelector("p.cmp-note")?.textContent);
    expect(nota).toBe("No hay nada que repartir: la cartera no tiene efectivo y su única posición no tiene precio, así que no se sabe cuánto vale. El reparto no incluye Activo B, que no tiene precio.");
  });

  it("una cartera sin posiciones ni efectivo sigue sin bloque", async () => {
    pintado = await pintar(<BloqueComposicion analisis={datosDeVista(cartera([activo("P")], []), MERCADO, FIN).analisis} />);
    expect(pintado.vista.textContent).toBe("");
  });
});

describe("El bono sin precio no da su cupón corrido", () => {
  const BONO = { cupon: "0.05", frecuencia: 1, vencimiento: "2030-06-30", base: "ACT/ACT" as const };
  const sinPrecio = () => cartera([activo("BO", "BONO", "USD", { bono: BONO })], [mov("aportacion", "2025-01-02", { importe: "10000" }), mov("compra", "2025-01-03", { activoId: "BO", titulos: "10000", importe: "-9000" })]);
  const conPrecio = () =>
    cartera([activo("BO", "BONO", "EUR", { bono: BONO })], [mov("aportacion", "2025-01-02", { importe: "10000" }), mov("compra", "2025-01-03", { activoId: "BO", titulos: "10000", precio: "90", importe: "-9000" })]);

  it("el motor lo deja en null sin precio y lo calcula con precio: 10.000 × 5 % × 215 / 365 = 294,52", () => {
    expect(datosDeVista(sinPrecio(), MERCADO, FIN).analisis.bonos[0].cuponCorrido).toBeNull();
    expect(datosDeVista(conPrecio(), MERCADO, FIN).analisis.bonos[0].cuponCorrido).toBeCloseTo((10000 * 0.05 * 215) / 365, 9);
  });

  it("la pantalla dice «Falta el dato» en el cupón corrido, y con precio da la cifra", async () => {
    pintado = await pintar(<BloqueBonos analisis={datosDeVista(sinPrecio(), MERCADO, FIN).analisis} />);
    let texto = plano(panel(pintado.vista, "Bonos").textContent);
    expect(texto).toContain("Cupón corrido");
    expect(texto).toContain("Falta el dato");
    expect(texto).not.toContain("294,52");
    await pintado.desmontar();
    pintado = await pintar(<BloqueBonos analisis={datosDeVista(conPrecio(), MERCADO, FIN).analisis} />);
    texto = plano(panel(pintado.vista, "Bonos").textContent);
    expect(texto).toContain("294,52");
    expect(texto).not.toContain("Falta el dato");
  });
});

describe("Ingresos y costes, con un fondo sin precio", () => {
  /* A, una acción con precio; B, un fondo en dólares pagado sin precio. B vale cero en todo el periodo: no entra en el coste corriente
     estimado ni en su cobertura, y la cobertura dice que falta. Con B como acción, que no tiene coste corriente, no hay nada que decir. */
  const FONDO_B = activo("B", "FONDO", "USD", { origen: "catalogo", isin: "XB0000000002" });
  const movs = [
    mov("aportacion", "2025-01-02", { importe: "3000" }),
    mov("compra", "2025-01-02", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
    mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" })
  ];
  const FRASE = "No entra el coste corriente de Activo B, que no tiene precio: no se conoce su valor, y la cobertura no lo cuenta.";

  it("el motor lo nombra, y la pantalla lo dice junto al coste corriente", async () => {
    const analisis = datosDeVista(cartera([activo("A"), FONDO_B], movs), MERCADO, FIN).analisis;
    expect(analisis.ingresosYCostes.sinPrecioFueraDeLosGastosCorrientes).toEqual(["Activo B"]);
    pintado = await pintar(<BloqueIngresosYCostes analisis={analisis} />);
    expect(plano(panel(pintado.vista, "Ingresos y costes del periodo").textContent)).toContain(FRASE);
  });

  it("una acción sin precio no tiene coste corriente que perder: ni lista ni frase", async () => {
    const analisis = datosDeVista(cartera([activo("A"), activo("B", "ACCION", "USD")], movs), MERCADO, FIN).analisis;
    expect(analisis.ingresosYCostes.sinPrecioFueraDeLosGastosCorrientes).toEqual([]);
    pintado = await pintar(<BloqueIngresosYCostes analisis={analisis} />);
    expect(plano(pintado.vista.textContent)).not.toContain("No entra el coste corriente");
  });
});
