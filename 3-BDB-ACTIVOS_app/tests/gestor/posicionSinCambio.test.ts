/**
 * Una posición en otra divisa sin tipo de cambio no vale 0 €: su valor no se conoce, y va como una posición sin precio
 * (aprobado por Óscar el 22-11-2026).
 *
 * Hasta ese día el motor la valoraba a 0 € con la fuente de su precio de siempre («de su operación»): no salía en
 * `sinPrecio`, el informe del cliente la daba a 0,00 € sin una palabra, y lo perdido iba al efecto divisa. Tener precio
 * —100 $— y no tener cambio es no tener valor en euros, igual que no tener precio. Si el movimiento trae su `cambio`, ese
 * cambio la valora, como siempre.
 *
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { crearInformePdf } from "../../src/gestor/informes";
import { notaDeLosPrecios } from "../../src/gestor/informes/secciones/cliente/notas";
import type { DatosDelInforme } from "../../src/gestor/informes/tipos";
import { FUENTE, analizar, preparar, type Analisis } from "../../src/gestor/motor/analisis";
import type { Movimiento } from "../../src/gestor/motor/modelo";
import { notaDeLasCifrasQueLasCuentanComoCero, notaDeLasSinPrecio } from "../../src/gestor/motor/sinPrecio";
import { MERCADO_VACIO, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";
import { paginasDe } from "./informesAyudas";

const FIN = "2025-01-31";
const PERIODO = { desde: "2025-01-01", hasta: FIN };
const U = activo("U", "ACCION", "USD", { nombre: "Acción en dólares" });

/*
 * 2.000 € aportados el 02-01-2025 y, ese mismo día, 10 títulos de U a 100 $ pagados con 1.000 € del efectivo en euros. El
 * movimiento trae lo pagado en euros, pero no su cambio, y el mercado no tiene ningún cambio del dólar.
 *   U tiene precio —100 $, el de su operación— y no tiene valor en euros: no hay con qué pasar 1.000 $ a euros.
 *   Efectivo: 2.000 − 1.000 = 1.000 €. Coste de U: los 1.000 € pagados, que están en euros.
 * Como una posición sin precio, cuenta como cero en la serie del valor:
 *   patrimonio 0 + 1.000 = 1.000 €, y su nota dice que no incluye U;
 *   02-01: capital 0 + 2.000 (lo aportado) y valor 1.000 → 1.000 / 2.000 − 1 = −50 %; el resto de días, sin cambios: TWR −50 %;
 *   resultado 1.000 − 0 − 2.000 = −1.000 €, todo variación de precio, como el de una sin precio; nada de efecto divisa.
 */
const SIN_CAMBIO: Movimiento[] = [
  mov("aportacion", "2025-01-02", { importe: "2000" }),
  mov("compra", "2025-01-02", { activoId: "U", titulos: "10", precio: "100", importe: "-1000" })
];
const analizada = (movimientos: Movimiento[], mercado: DatosDeMercado = MERCADO_VACIO): Analisis =>
  analizar(preparar(cartera([U], movimientos, { nombre: "Cartera con una posición sin cambio" }), mercado, new Map(), FIN), PERIODO);
const de = (analisis: Analisis) => analisis.posiciones.find((posicion) => posicion.activo.id === "U")!;

describe("una posición en dólares sin ningún cambio a euros", () => {
  const analisis = analizada(SIN_CAMBIO);

  test("su valor no se conoce: va en `sinPrecio`, sin precio, valor, peso ni resultado; su coste sí se sabe", () => {
    const u = de(analisis);
    expect(u.fuente).toBe(FUENTE.sinPrecio);
    /* Antes: precio 100, valor 0, peso 0, latente −1.000 € y −100 %. */
    for (const cifra of [u.precio, u.valor, u.peso, u.latente, u.latentePct, u.resultadoDelPeriodo, u.contribucion]) expect(cifra).toBeNull();
    expect(u.coste).toBe(1000);
    expect(analisis.sinPrecio.map((posicion) => posicion.activo.id)).toEqual(["U"]);
  });

  test("el patrimonio, el resultado y la TWR son los de una posición sin precio: la cuentan como cero, y lo dicen", () => {
    expect(analisis.patrimonio).toBe(1000);
    expect(analisis.efectivo.total).toBe(1000);
    expect(analisis.rentabilidad!.resultado).toBeCloseTo(-1000, 9);
    expect(analisis.rentabilidad!.twr).toBeCloseTo(-0.5, 12);
    /* Lo perdido es variación de precio, como en una posición sin precio; antes eran −1.000 € de efecto divisa. */
    expect(analisis.desglose!.cuadrado.precio).toBeCloseTo(-1000, 9);
    expect(analisis.desglose!.cuadrado.divisa).toBe(0);
    expect(notaDeLasSinPrecio(analisis, "Esa cifra")).toBe("Esa cifra no incluye Acción en dólares, que no tiene precio.");
    expect(notaDeLasCifrasQueLasCuentanComoCero(analisis)).toBe("Estas cifras cuentan Acción en dólares como cero, porque no tiene precio.");
  });

  test("la comprobación de la cartera dice que falta el cambio, y pide el cambio, no un precio", () => {
    const codigos = analisis.integridad.avisos.map((aviso) => aviso.codigo);
    expect(codigos).toContain("FALTA_EL_CAMBIO");
    const sinPrecio = analisis.integridad.avisos.find((aviso) => aviso.codigo === "SIN_PRECIO" && aviso.activoId === "U")!;
    expect(sinPrecio.gravedad).toBe("error");
    expect(sinPrecio.mensaje).toBe("Acción en dólares no tiene tipo de cambio USD/EUR: cuenta como cero, y la rentabilidad de cualquier periodo que incluya esta fecha no vale. Escribe el cambio en sus operaciones.");
    /* No se valora con ningún cambio, así que no hay un cambio antiguo del que avisar. */
    expect(codigos).not.toContain("CAMBIO_ANTIGUO");
  });

  test("si el cambio llega después, los días sin él cuentan como cero y se dice, y desde entonces se valora", () => {
    /*
     * El dólar a 1,25 desde el 10-01. Del 02-01 al 09-01, U cuenta como cero; el 10-01 pasa a valer 10 × 100 / 1,25 = 800 €.
     * Patrimonio 1.000 + 800 = 1.800 €. TWR: −50 % el 02-01 y, el 10-01, 1.800 / 1.000 − 1 = +80 %: 0,5 × 1,8 − 1 = −10 %,
     * que es 1.800 / 2.000 − 1. Resultado 1.800 − 2.000 = −200 €, todo variación de precio: lo recuperado el 10-01 lo es
     * como lo perdido el 02-01, igual que cuando a una posición le llega el precio.
     */
    const tarde = analizada(SIN_CAMBIO, { precios: new Map(), cambios: new Map([["USD", serie(["2025-01-10", 1.25])]]) });
    expect(de(tarde).fuente).toBe(FUENTE.operacion);
    expect(de(tarde).valor).toBeCloseTo(800, 9);
    expect(tarde.sinPrecio).toEqual([]);
    expect(tarde.patrimonio).toBeCloseTo(1800, 9);
    expect(tarde.rentabilidad!.twr).toBeCloseTo(-0.1, 12);
    expect(tarde.desglose!.cuadrado.precio).toBeCloseTo(-200, 9);
    expect(tarde.desglose!.cuadrado.divisa).toBeCloseTo(0, 9);
    const pasado = tarde.integridad.avisos.find((aviso) => aviso.codigo === "SIN_PRECIO" && aviso.activoId === "U")!;
    expect(pasado.mensaje).toBe("Acción en dólares no tuvo tipo de cambio USD/EUR del 02/01/2025 al 09/01/2025: esos días contó como cero, y la rentabilidad de cualquier periodo que los incluya no vale. Escribe el cambio en sus operaciones.");
  });
});

describe("la misma compra con su cambio escrito se valora con él, como siempre", () => {
  test("10 × 100 $ a 1,25 $/€ son 800 €", () => {
    /*
     * La compra trae su cambio: 1,25 dólares por euro, así que los 1.000 $ costaron 800 €. Sin cambios de mercado, ese es el
     * cambio de la cartera desde el 02-01 (`cambiosEfectivos`). U vale 10 × 100 / 1,25 = 800 €; efectivo 2.000 − 800 =
     * 1.200 €; patrimonio 2.000 €, TWR 2.000 / 2.000 − 1 = 0 y resultado 0.
     */
    const conCambio = analizada([
      mov("aportacion", "2025-01-02", { importe: "2000" }),
      mov("compra", "2025-01-02", { activoId: "U", titulos: "10", precio: "100", importe: "-800", cambio: "1.25" })
    ]);
    const u = de(conCambio);
    expect(u.fuente).toBe(FUENTE.operacion);
    expect(u.precio).toBe(100);
    expect(u.valor).toBeCloseTo(800, 9);
    expect(u.coste).toBe(800);
    expect(conCambio.sinPrecio).toEqual([]);
    expect(conCambio.patrimonio).toBeCloseTo(2000, 9);
    expect(conCambio.rentabilidad!.twr).toBeCloseTo(0, 12);
    expect(notaDeLasCifrasQueLasCuentanComoCero(conCambio)).toBeNull();
    expect(conCambio.integridad.avisos.map((aviso) => aviso.codigo)).not.toContain("FALTA_EL_CAMBIO");
  });
});

describe("el informe del cliente", () => {
  test("la da sin valor, dice que su patrimonio no la incluye y que sus cifras la cuentan como cero", async () => {
    const datos: DatosDelInforme = { analisis: analizada(SIN_CAMBIO), cartera: cartera([U], SIN_CAMBIO, { nombre: "Cartera con una posición sin cambio" }), generado: FIN };
    expect(notaDeLosPrecios(datos.analisis)).toBe("Los demás precios proceden de fuentes de mercado. Sin precio, y por eso cuentan como cero: Acción en dólares.");
    const { paginas } = await paginasDe(await crearInformePdf("cliente", datos), "cliente-con-una-posicion-sin-cambio");
    const texto = paginas.join("\n").split(/\s+/).join(" ");
    /* El patrimonio, 1.000 €, con la nota de lo que no incluye. Antes: 1.000 € sin nota y la posición a 0,00 €. */
    expect(texto).toContain("su cartera vale 1.000,00 €. Esa cifra no incluye Acción en dólares, que no tiene precio.");
    /* En «Posiciones», sin valor ni peso; antes, «0,00 €» y «0,0 %». */
    expect(texto).toContain("Acción en dólares Sin precio: no se puede valorar. Falta el dato Falta el dato");
    /* «Cómo ha ido», «Riesgo» y «De dónde viene» salen de la serie del valor, y cada una lo dice debajo. */
    expect(texto.split("Estas cifras cuentan Acción en dólares como cero, porque no tiene precio.").length - 1).toBe(3);
    /* Lo perdido, en la variación de precio; el efecto divisa, nada. Antes, −1.000,00 € de efecto divisa. */
    expect(texto).toContain("−1.000,00 € Dividendos");
    expect(texto).toContain("Efecto divisa Lo ganado o perdido por la variación del cambio en lo invertido en otras monedas. 0,00 €");
    expect(texto).toContain("Sin precio, y por eso cuentan como cero: Acción en dólares.");
    expect(texto).not.toMatch(/undefined|NaN|\[object|Infinity/);
  });
});
