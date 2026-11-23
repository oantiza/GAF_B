/**
 * El motor del simulador de jubilación y sus reglas fiscales (IRPF 2026 por territorio).
 *
 * Son las pruebas del simulador de NUVIA (`docs/nuvia-jubilacion-motor.test.mjs`), traídas con el motor el
 * 13-11-2026. Contrastan el cálculo con importes verificables a mano y con el caso práctico de la Hacienda Foral
 * de Bizkaia (CASO-PRACTICO-EPSV-26), y cubren Álava, Gipuzkoa, Navarra, el estatal con la escala de referencia y
 * las 15 comunidades de régimen común, con su escala autonómica y, en siete de ellas, su mínimo del contribuyente
 * propio.
 *
 * **Cada cifra esperada se calcula a mano a partir de la norma citada en `src/core/jubilacion/fiscal.ts`, nunca a
 * partir de la salida del motor.** La cuenta va en el comentario de su línea. Las de «regresión exacta» son las
 * del motor de origen: si una se mueve, el motor ha dejado de calcular lo que calculaba.
 */
import { describe, expect, test } from "vitest";
import * as F from "../src/core/jubilacion/fiscal";
import * as M from "../src/core/jubilacion/motor";
import type { EntradaDeJubilacion, ResultadoDisponible } from "../src/core/jubilacion/motor";

const cerca = (a: number | undefined, b: number, tol = 0.01, msg = "") => expect(Math.abs((a ?? NaN) - b), `${msg} ${a} ≠ ${b}`).toBeLessThanOrEqual(tol);
/** El espacio duro que escribe el formato de euros, como espacio corriente, para comparar frases. */
const plano = (texto: string) => texto.replaceAll(String.fromCharCode(0xa0), " ");

/** Calcula y exige resultado: una entrada que no calcula aquí es un fallo de la prueba. */
function calcular(entrada: Partial<EntradaDeJubilacion> = {}, opciones: M.OpcionesDelCalculo = {}): ResultadoDisponible {
  const r = M.calcular(entrada, opciones);
  if (!r.disponible) throw new Error(`No calcula: ${r.mensaje}`);
  return r;
}

function cfgDe(territorio: string, ccaa?: string): F.Configuracion {
  const cfg = F.configuracion(territorio, ccaa);
  if (!cfg) throw new Error(`Sin configuración para ${territorio}`);
  return cfg;
}

const SIN_AHORROS = { liquidez: 0, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0 };

describe("IRPF de los territorios vascos", () => {
  test("pensión de 2.000 € × 14 a los 65 años", () => {
    // 28.000 − bonificación 3.000 = 25.000; 18.080 × 23 % + 6.920 × 28 % = 6.096; − 1.615 = 4.481.
    // Edad cumplida a 31-12: a los 65 ya se aplica la deducción por edad, 393 × (30.000 − 25.000) / 10.000 = 196,50 → 4.284,50.
    const t = M.irpf({ trabajo: 28000, edad: 65 });
    expect(t.bonificacion).toBe(3000);
    expect(t.baseGeneral).toBe(25000);
    cerca(t.deduccionEdad, 196.5);
    cerca(t.total, 4284.5);
    cerca(M.irpf({ trabajo: 28000, edad: 64 }).total, 4481, 0.01, "A los 64 no hay deducción por edad");
    expect(t.marginalGeneral).toBe(0.28);
  });

  test("bonificación del trabajo y otras rentas", () => {
    expect(M.bonificacionTrabajo(14000, 0)).toBe(8000);
    cerca(M.bonificacionTrabajo(23000, 0), 3000, 0.5);
    expect(M.bonificacionTrabajo(14000, 8000), "Con más de 7.500 € de otras rentas se limita a 3.000 €").toBe(3000);
    expect(M.bonificacionTrabajo(2000, 0), "Nunca deja el rendimiento en negativo").toBe(2000);
  });

  test("la minoración solo reduce la cuota general, y la escala del ahorro", () => {
    const t = M.irpf({ trabajo: 0, ahorro: 10000, edad: 60 });
    cerca(t.cuotaAhorro, 7500 * 0.19 + 2500 * 0.2);
    expect(t.minoracion, "La minoración no reduce la cuota del ahorro").toBe(0);
  });

  test("deducción por edad (edad cumplida a 31 de diciembre)", () => {
    expect(M.deduccionEdad(64, 15000), "Antes de cumplir 65 no hay deducción").toBe(0);
    expect(M.deduccionEdad(65, 15000), "Se aplica ya en el año en que se cumplen 65 (art. 83 NF 13/2013; FAQ 900006436 HFB)").toBe(393);
    expect(M.deduccionEdad(70, 15000)).toBe(393);
    expect(M.deduccionEdad(74, 15000)).toBe(393);
    expect(M.deduccionEdad(75, 15000), "La mayor, desde el año en que se cumplen 75").toBe(714);
    expect(M.deduccionEdad(80, 15000)).toBe(714);
    cerca(M.deduccionEdad(70, 25000), 196.5);
    expect(M.deduccionEdad(70, 30000)).toBe(0);
  });

  test("Álava y Gipuzkoa: misma escala, minoración, bonificación y deducción por edad que Bizkaia (NF 21/2025 y NF 6/2025)", () => {
    for (const t of ["alava", "gipuzkoa"]) {
      const x = M.irpf({ trabajo: 28000, edad: 65, territorio: t });
      expect(x.bonificacion).toBe(3000);
      cerca(x.total, 4284.5, 0.01, t);
      cerca(M.irpf({ trabajo: 28000, edad: 64, territorio: t }).total, 4481, 0.01, t);
      cerca(M.irpf({ trabajo: 0, ahorro: 10000, edad: 60, territorio: t }).cuotaAhorro, 7500 * 0.19 + 2500 * 0.2, 0.01, t);
      expect(M.deduccionEdad(70, 15000, t)).toBe(393);
      cerca(M.deduccionEdad(70, 25000, t), 393 - 0.0393 * 5000, 0.01, t); // art. 83.2: 393 − 0,0393 × (BI − 20.000)
      cerca(calcular({ territorio: t }).resumen.netoMensual, calcular().resumen.netoMensual, 1e-6, `${t} sin EPSV coincide con Bizkaia`);
    }
  });
});

describe("EPSV", () => {
  test("caso práctico de la DFB de 2026, en capital", () => {
    const c = calcular({ pension: 0, ...SIN_AHORROS, tieneEpsv: true, epsvPre: 89000, epsvPreRent: 27000, epsvPost: 11000, epsvPostRent: 3000, epsvCobro: "capital" }).capital!;
    // Régimen transitorio: 100.000 × 62/70 = 88.571,43 al 60 %; resto: 3.000 de rentabilidad + 8.428,57 al 70 %.
    cerca(c.transitorio!.bases.detalle.tramoPre, 88571.43, 0.01);
    cerca(c.transitorio!.bases.general, 88571.43 * 0.6 + 8428.57 * 0.7, 0.02);
    cerca(c.transitorio!.bases.ahorro, 3000);
    // Régimen 2026: 30.000 de rentabilidad al ahorro; 70.000 × 70 % = 49.000 al trabajo.
    cerca(c.nuevo!.bases.general, 49000);
    cerca(c.nuevo!.bases.ahorro, 30000);
    expect(c.elegido).toBe(c.transitorio!.impuesto <= c.nuevo!.impuesto ? "transitorio" : "nuevo");
    expect(c.neto > 0 && c.neto < 100000).toBe(true);
  });

  test("sin reducción si no es el primer cobro", () => {
    const c = calcular({ tieneEpsv: true, epsvPost: 100000, epsvPostRent: 20000, epsvCobro: "capital", primerCobro: false, regimen: "nuevo" }).capital!;
    cerca(c.bases.general, 80000);
  });

  test("renta temporal de 15 años: rentabilidad exenta y limitada a su duración", () => {
    const f = calcular({ pension: 0, ...SIN_AHORROS, tieneEpsv: true, epsvPost: 100000, epsvPostRent: 30000, epsvRenta: "temporal", epsvAniosRenta: 15 }).base.filas;
    expect(f[0].retiradaEpsv).toBeGreaterThan(0);
    cerca(f[0].retiradaEpsv, f[14].retiradaEpsv, 0.01, "Cuantía constante");
    expect(f[15].retiradaEpsv, "Termina con el contrato").toBe(0);
    expect(f[0].irpf.ahorro, "Rentabilidad exenta").toBe(0);
    cerca(f[0].epsvRentExenta, f[0].retiradaEpsv * 0.3);
  });

  test("estimación reglada sin certificado", () => {
    expect(calcular({ tieneEpsv: true, epsvPost: 1000, epsvDesglose: "estimacion", antiguedad: 20 }).resumen.ratioEpsv).toBe(0.2);
    expect(calcular({ tieneEpsv: true, epsvPost: 1000, epsvDesglose: "estimacion", antiguedad: 50 }).resumen.ratioEpsv).toBe(0.35);
    expect(calcular({ tieneEpsv: true, epsvPost: 1000, epsvDesglose: "estimacion", antiguedadConocida: false }).resumen.ratioEpsv).toBe(0.25);
  });

  describe("sin desglose, la estimación es del saldo de hoy y lo que crece hasta jubilarse es todo rentabilidad (22-11-2026)", () => {
    // Bizkaia, cobro en capital, primer cobro: 100.000 € de saldo sin desglose, todo anterior a 2026, diez años al 5 % y sin
    // IPC (para que los topes no se actualicen). Derechos a la jubilación: 100.000 × 1,05^10 = 162.889,46 €; de ellos,
    // 100.000 × (1,05^10 − 1) = 62.889,46 € de tramo posterior, todo rentabilidad: no hay aportaciones desde 2026.
    const derechos = 100000 * 1.05 ** 10;
    const crecimiento = derechos - 100000;
    const e = { pension: 0, ...SIN_AHORROS, edad: 55, edadJubilacion: 65, rentabilidad: 5, inflacion: 0, tieneEpsv: true, epsvPre: 100000, epsvPost: 0, epsvDesglose: "estimacion", epsvCobro: "capital" } as const;

    test("sin antigüedad conocida (25 %), en los dos regímenes", () => {
      const c = calcular({ ...e, antiguedadConocida: false }).capital!;
      cerca(c.bruto, derechos, 0.01);
      // Estimación del saldo de hoy: 100.000 × 25 % = 25.000 de rentabilidad y 75.000 aportados, todo antes de 2026.
      // Régimen transitorio: cuota = aportaciones previas / totales = 75.000 / (75.000 + 0) = 1, la prestación entera al 60 %:
      // 162.889,46 × 60 % = 97.733,68 a la base general y nada al ahorro (lo mismo que con certificado). Antes: cuota por los
      // derechos, 100.000 × 60 % = 60.000 más 62.889,46 × 75 % = 47.167,10 de «aportación» al 70 % = 93.017 y 15.722 de ahorro.
      cerca(c.transitorio!.bases.detalle.tramoPre, derechos, 0.01);
      cerca(c.transitorio!.bases.detalle.tramoPost, 0, 0.01);
      cerca(c.transitorio!.bases.general, derechos * 0.6, 0.01);
      expect(c.transitorio!.bases.ahorro).toBe(0);
      // Régimen 2026: rentabilidad 25.000 + 62.889,46 = 87.889,46 al ahorro; aportado 75.000 × 70 % = 52.500 a la general.
      // Antes: 162.889,46 × 25 % = 40.722 al ahorro y 122.167 × 70 % = 85.517 a la general.
      cerca(c.nuevo!.bases.ahorro, 25000 + crecimiento, 0.01);
      cerca(c.nuevo!.bases.general, 75000 * 0.7, 0.01);
      // Lo que se cobra en renta: (25.000 + 62.889,46) / 162.889,46 = 53,96 % de rentabilidad.
      cerca(calcular({ ...e, antiguedadConocida: false }).resumen.ratioEpsv, (25000 + crecimiento) / derechos, 1e-12);
      // Y da lo mismo que un certificado que dijera esos 25.000 de rentabilidad.
      const cert = calcular({ ...e, epsvDesglose: "certificado", epsvPreRent: 25000 }).capital!;
      for (const regimen of ["transitorio", "nuevo"] as const) {
        cerca(c[regimen]!.bases.general, cert[regimen]!.bases.general, 1e-6, regimen);
        cerca(c[regimen]!.bases.ahorro, cert[regimen]!.bases.ahorro, 1e-6, regimen);
      }
    });

    test("con veinte años de antigüedad (20 %)", () => {
      const c = calcular({ ...e, antiguedadConocida: true, antiguedad: 20 }).capital!;
      // Estimación: 100.000 × 20 × 1 % = 20.000 de rentabilidad y 80.000 aportados.
      // Transitorio: cuota 80.000 / 80.000 = 1 → 162.889,46 × 60 % = 97.733,68 y nada al ahorro.
      cerca(c.transitorio!.bases.general, derechos * 0.6, 0.01);
      expect(c.transitorio!.bases.ahorro).toBe(0);
      // Régimen 2026: 20.000 + 62.889,46 = 82.889,46 al ahorro; 80.000 × 70 % = 56.000 a la general.
      cerca(c.nuevo!.bases.ahorro, 20000 + crecimiento, 0.01);
      cerca(c.nuevo!.bases.general, 56000, 0.01);
    });

    test("en renta, la rentabilidad de cada cobro es la de los dos tramos juntos", () => {
      // Renta flexible (no exenta), sin pensión: la rentabilidad del primer cobro es cobro × 87.889,46 / 162.889,46.
      const f = calcular({ ...e, antiguedadConocida: false, epsvCobro: "renta" }).base.filas[0];
      expect(f.retiradaEpsv).toBeGreaterThan(0);
      cerca(f.epsvRent, (f.retiradaEpsv * (25000 + crecimiento)) / derechos, 1e-6);
      cerca(f.epsvTrabajo, (f.retiradaEpsv * 75000) / derechos, 1e-6);
    });

    test("jubilándose hoy no cambia nada: la estimación cubre el saldo entero", () => {
      const hoy = calcular({ ...e, edad: 65, antiguedadConocida: false });
      const c = hoy.capital!;
      cerca(c.bruto, 100000, 1e-9);
      // Transitorio: cuota 75.000 / 75.000 = 1 → 100.000 × 60 % = 60.000 y nada al ahorro.
      cerca(c.transitorio!.bases.general, 60000, 1e-6);
      expect(c.transitorio!.bases.ahorro).toBe(0);
      // Régimen 2026: 100.000 × 25 % = 25.000 al ahorro; 75.000 × 70 % = 52.500 a la general.
      cerca(c.nuevo!.bases.ahorro, 25000, 1e-6);
      cerca(c.nuevo!.bases.general, 52500, 1e-6);
      cerca(hoy.resumen.ratioEpsv, 0.25, 1e-12);
    });
  });

  test("Álava y Gipuzkoa: la exención de la rentabilidad en renta no supera el 40 % de la renta (arts. 9.44 NF 33/2013 y 9.39 NF 3/2014)", () => {
    // Pago anual de 10.000 € con 50 % de rentabilidad: 5.000 € de rentabilidad; exentos como máximo 4.000 €; 1.000 € a la base del ahorro.
    for (const t of ["alava", "gipuzkoa"]) {
      const rp = F.rentaPeriodica(cfgDe(t), 10000, 0.5, true);
      cerca(rp.exento, 4000);
      cerca(rp.ahorro, 1000);
      cerca(rp.trabajo, 5000);
    }
    const b = F.rentaPeriodica(cfgDe("bizkaia"), 10000, 0.5, true);
    cerca(b.exento, 5000, 0.01, "Bizkaia: sin tope (art. 9.38 NF 13/2013)");
    expect(b.ahorro).toBe(0);
    // Con 30 % de rentabilidad, por debajo del tope, los tres territorios coinciden.
    for (const t of ["alava", "gipuzkoa"]) cerca(F.rentaPeriodica(cfgDe(t), 10000, 0.3, true).exento, 3000);
    // En la proyección: una renta temporal de 15 años con 60 % de rentabilidad certificada deja el exceso en el ahorro en Álava, no en Bizkaia.
    const e = { pension: 0, ...SIN_AHORROS, tieneEpsv: true, epsvPost: 100000, epsvPostRent: 60000, epsvRenta: "temporal", epsvAniosRenta: 15 } as const;
    const fa = calcular({ territorio: "alava", ...e }).base.filas[0];
    const fb = calcular(e).base.filas[0];
    cerca(fa.epsvRentExenta, 0.4 * fa.retiradaEpsv, 0.01);
    cerca(fa.irpf.ahorro, 0.2 * fa.retiradaEpsv, 0.01);
    cerca(fb.epsvRentExenta, 0.6 * fb.retiradaEpsv, 0.01);
    expect(fb.irpf.ahorro).toBe(0);
  });

  test("con rentabilidad negativa antes de jubilarse, la pérdida no crea base ni impuesto (P1-02)", () => {
    // Art. 37.e (NF 33/2013 de Álava, NF 3/2014 de Gipuzkoa; ficha KA-01878 de la DFB para la NF 13/2013): el rendimiento es
    // «la diferencia positiva» entre los derechos y lo aportado; el resto de la prestación es trabajo (art. 18.a), y nunca más
    // que lo cobrado. Bizkaia, 100.000 € de derechos anteriores a 2026 (70.000 aportados y 30.000 de rentabilidad), nada
    // posterior, diez años hasta la jubilación al −2 %: derechos 100.000 × 0,98^10 = 81.707,28 €, todos de aportaciones
    // anteriores a 2026.
    const derechos = 100000 * 0.98 ** 10;
    const e = { pension: 0, ...SIN_AHORROS, edad: 57, edadJubilacion: 67, rentabilidad: -2, tieneEpsv: true, epsvPre: 100000, epsvPreRent: 30000, epsvPost: 0, epsvCobro: "capital" } as const;
    const c = calcular(e).capital!;
    cerca(c.bruto, derechos, 0.01);
    // Régimen transitorio: todo lo aportado es anterior a 2026 → cuota 70.000 / 70.000 = 1, la prestación entera al 60 %:
    // 81.707,28 × 60 % = 49.024,37 a la base general y nada al ahorro. Antes salían 18.292,72 € de aportación fantasma al 70 %
    // (+12.804,90 de base general) y −18.292,72 de ahorro.
    cerca(c.transitorio!.bases.detalle.tramoPre, derechos, 0.01);
    cerca(c.transitorio!.bases.detalle.tramoPost, 0, 0.01);
    cerca(c.transitorio!.bases.detalle.aportacion, 0, 0.01);
    cerca(c.transitorio!.bases.general, derechos * 0.6, 0.01);
    expect(c.transitorio!.bases.ahorro).toBe(0);
    // Régimen 2026: rendimiento 81.707,28 − 70.000 = 11.707,28 al ahorro; 70.000 × 70 % = 49.000 al trabajo (esto ya salía bien).
    cerca(c.nuevo!.bases.ahorro, derechos - 70000, 0.01);
    cerca(c.nuevo!.bases.general, 49000, 0.01);
    // Sin certificado, la cuota del transitorio se estima con los derechos: 100.000 / 81.707,28 = 1,22 se acota a 1.
    // La base es la misma, 49.024,37, y no 100.000 × 60 % = 60.000 como antes.
    const s = calcular({ ...e, epsvDesglose: "estimacion" }).capital!;
    cerca(s.transitorio!.bases.general, derechos * 0.6, 0.01);
    expect(s.transitorio!.bases.ahorro).toBe(0);
    // Si la pérdida se come toda la rentabilidad —5.000 de rentabilidad y 95.000 aportados—, no hay diferencia positiva:
    // en el régimen 2026, rendimiento 0 y los 81.707,28 cobrados son aportación al 70 % = 57.195,10. Antes eran 95.000 × 70 % =
    // 66.500 de base general (más de lo cobrado) y −13.292,72 de ahorro.
    const p = calcular({ ...e, epsvPreRent: 5000, regimen: "nuevo" }).capital!;
    expect(p.nuevo!.bases.ahorro).toBe(0);
    cerca(p.nuevo!.bases.general, derechos * 0.7, 0.01);
    // Y en renta, con el certificado: (5.000 − 18.292,72) / 81.707,28 < 0 → rentabilidad 0, todo el cobro es trabajo.
    const r = calcular({ ...e, epsvPreRent: 5000, epsvCobro: "renta" }).base.filas[0];
    expect(r.epsvRent).toBe(0);
    cerca(r.epsvTrabajo, r.retiradaEpsv, 1e-9);
  });

  describe("un tramo certificado con pérdida: la diferencia positiva es la de la EPSV entera (N06, 22-11-2026)", () => {
    // Bizkaia, jubilándose hoy (sin crecimiento ni IPC), cobro en capital, primer cobro, con la reducción: el tope de
    // 300.000 € cubre cualquiera de estos cobros, así que la aportación integra el 70 % y lo anterior a 2026, el 60 %.
    // Aportado = saldo − rentabilidad en cada tramo.
    const e = { pension: 0, ...SIN_AHORROS, edad: 65, edadJubilacion: 65, inflacion: 0, tieneEpsv: true, epsvCobro: "capital" } as const;

    test("60.000 con +20.000 antes de 2026 y 40.000 con −20.000 después: no hay rendimiento", () => {
      const caso = { ...e, epsvPre: 60000, epsvPreRent: 20000, epsvPost: 40000, epsvPostRent: -20000 } as const;
      const c = calcular(caso).capital!;
      cerca(c.bruto, 100000, 1e-9);
      // Derechos 60.000 + 40.000 = 100.000; aportado 40.000 + 60.000 = 100.000; diferencia 0.
      // Régimen 2026: rendimiento max(0, 20.000 − 20.000) = 0; los 100.000 son aportación → 100.000 × 70 % = 70.000 a la
      // general y 0 al ahorro. Antes la pérdida se leía como 0 y salían 20.000 al ahorro y 80.000 × 70 % = 56.000.
      cerca(c.nuevo!.bases.general, 70000, 1e-6);
      expect(c.nuevo!.bases.ahorro).toBe(0);
      // Transitorio: cuota = aportado antes / aportado total = 40.000 / 100.000 = 0,4 → 40.000 al 60 % = 24.000; el resto,
      // 60.000, con rendimiento max(0, min(60.000, −20.000, 0)) = 0 → 60.000 al 70 % = 42.000. Total 66.000 y 0 al ahorro.
      // Antes: cuota 40.000 / 80.000 = 0,5 → 50.000 × 60 % + 50.000 × 70 % = 65.000.
      cerca(c.transitorio!.bases.detalle.tramoPre, 40000, 1e-6);
      cerca(c.transitorio!.bases.detalle.tramoPost, 60000, 1e-6);
      cerca(c.transitorio!.bases.general, 66000, 1e-6);
      expect(c.transitorio!.bases.ahorro).toBe(0);
      // En renta: (20.000 − 20.000) / 100.000 = 0 de rentabilidad; todo el cobro es trabajo.
      const f = calcular({ ...caso, epsvCobro: "renta" }).base.filas[0];
      expect(f.retiradaEpsv).toBeGreaterThan(0);
      expect(f.epsvRent).toBe(0);
      cerca(f.epsvTrabajo, f.retiradaEpsv, 1e-9);
      expect(M.avisos(caso)).toEqual([]);
    });

    test("pérdida en los dos tramos: la aportación no pasa de lo cobrado", () => {
      // 60.000 con −20.000 (aportados 80.000) y 40.000 con −10.000 (aportados 50.000): derechos 100.000, aportado 130.000.
      const c = calcular({ ...e, epsvPre: 60000, epsvPreRent: -20000, epsvPost: 40000, epsvPostRent: -10000 }).capital!;
      // Régimen 2026: sin rendimiento; lo cobrado, 100.000, es todo aportación → 70.000, y no 130.000 × 70 % = 91.000.
      cerca(c.nuevo!.bases.general, 70000, 1e-6);
      expect(c.nuevo!.bases.ahorro).toBe(0);
      // Transitorio: cuota 80.000 / 130.000 → 100.000 × 80/130 × 60 % + 100.000 × 50/130 × 70 % = 100.000 × 83 / 130 = 63.846,15.
      cerca(c.transitorio!.bases.general, (100000 * 83) / 130, 1e-6);
      expect(c.transitorio!.bases.ahorro).toBe(0);
    });

    test("ganancia neta con un tramo en pérdida: el rendimiento del tramo posterior no pasa del de la EPSV entera", () => {
      // 50.000 con −10.000 antes de 2026 (aportados 60.000) y 50.000 con +15.000 después (aportados 35.000): derechos 100.000,
      // aportado 95.000, diferencia positiva 5.000.
      const c = calcular({ ...e, epsvPre: 50000, epsvPreRent: -10000, epsvPost: 50000, epsvPostRent: 15000 }).capital!;
      // Régimen 2026: 5.000 al ahorro y 95.000 × 70 % = 66.500 a la general.
      cerca(c.nuevo!.bases.ahorro, 5000, 1e-6);
      cerca(c.nuevo!.bases.general, 66500, 1e-6);
      // Transitorio: cuota 60.000 / 95.000; tramo anterior 100.000 × 60/95 = 63.157,89 al 60 % = 37.894,74; tramo posterior
      // 100.000 × 35/95 = 36.842,11, con rendimiento min(36.842,11; 15.000; 5.000) = 5.000 al ahorro y 31.842,11 al 70 % =
      // 22.289,47. General 60.184,21. Sin acotar a la EPSV entera serían 15.000 al ahorro y 53.184,21 a la general.
      const tramoPre = (100000 * 60) / 95;
      cerca(c.transitorio!.bases.ahorro, 5000, 1e-6);
      cerca(c.transitorio!.bases.general, tramoPre * 0.6 + (100000 - tramoPre - 5000) * 0.7, 1e-6);
      cerca(c.transitorio!.bases.general, 60184.21, 0.01);
    });

    test("una pérdida mayor que el saldo del tramo es posible y se respeta; la ganancia sí se limita al saldo, y se avisa", () => {
      // 40.000 € de derechos con −60.000 € de rentabilidad: se aportaron 100.000 € a ese tramo.
      const caso = { ...e, epsvPre: 60000, epsvPreRent: 20000, epsvPost: 40000, epsvPostRent: -60000 } as const;
      expect(M.normalizar(caso).epsvPostRent).toBe(-60000);
      expect(M.avisos(caso)).not.toContain("La rentabilidad de la EPSV no puede superar su saldo: se limita al saldo.");
      // Rendimiento de la EPSV entera max(0, 20.000 − 60.000) = 0 → régimen 2026, 100.000 × 70 % = 70.000 a la general.
      cerca(calcular(caso).capital!.nuevo!.bases.general, 70000, 1e-6);
      cerca(calcular(caso).capital!.nuevo!.bases.ahorro, 0, 1e-6);
      // La ganancia no pasa del saldo: lo aportado no puede ser negativo.
      const conGanancia = { ...caso, epsvPreRent: 90000 };
      expect(M.normalizar(conGanancia).epsvPreRent).toBe(60000);
      expect(M.avisos(conGanancia)).toContain("La rentabilidad de la EPSV no puede superar su saldo: se limita al saldo.");
    });

    describe("un tramo a 0 € conserva su pérdida (H1-02 de la auditoría del 22-11-2026)", () => {
      test("la pérdida hasta la jubilación que deja el tramo posterior en 0 € resta igual que con un céntimo de saldo", () => {
        // A los 64, jubilándose a los 65, con un −2 % ese año: 49.000 antes de 2026 (+20.000 de rentabilidad, 29.000
        // aportados) y 1.000 después (sin rentabilidad, 1.000 aportados). La pérdida del año, 50.000 × −2 % = −1.000, va al
        // tramo posterior: 0 € de derechos con −1.000 de rentabilidad. Derechos 49.000, aportado 30.000: la diferencia
        // positiva de la EPSV entera es 20.000 − 1.000 = 19.000.
        const caso = { ...e, edad: 64, edadJubilacion: 65, rentabilidad: -2, regimen: "nuevo", epsvPre: 49000, epsvPreRent: 20000, epsvPost: 1000, epsvPostRent: 0 } as const;
        const c = calcular(caso).capital!;
        cerca(c.bruto, 49000, 1e-6);
        // Régimen 2026: 19.000 al ahorro y 49.000 − 19.000 = 30.000 de aportación × 70 % = 21.000 a la general. Antes salían
        // 20.000 al ahorro y 29.000 × 70 % = 20.300: con el tramo a 0 €, la pérdida se tiraba.
        cerca(c.nuevo!.bases.ahorro, 19000, 1e-6);
        cerca(c.nuevo!.bases.general, 21000, 1e-6);
        // Con un céntimo más de saldo: pérdida 50.000,01 × −2 % = −1.000,0002, tramo posterior 0,01 € → ahorro 18.999,9998 y
        // general 30.000,01 × 70 % = 21.000,007. La cifra no salta: antes saltaba 1.000 € en la base del ahorro.
        const conCentimo = calcular({ ...caso, epsvPost: 1000.01 }).capital!;
        cerca(conCentimo.nuevo!.bases.ahorro, 18999.9998, 1e-6);
        cerca(conCentimo.nuevo!.bases.general, 21000.007, 1e-6);
        // Transitorio: cuota 29.000 / (29.000 + 1.000) → 49.000 × 29/30 = 47.366,67 al 60 % y 1.633,33 sin rendimiento
        // (min(1.633,33; −1.000; 19.000) < 0) al 70 %: 28.420 + 1.143,33 = 29.563,33. Ya era así: no dependía de la razón.
        cerca(c.transitorio!.bases.general, ((49000 * 29) / 30) * 0.6 + ((49000 * 1) / 30) * 0.7, 1e-6);
        expect(c.transitorio!.bases.ahorro).toBe(0);
      });

      test("un tramo anterior a 0 € con −20.000 de rentabilidad quita la ganancia del posterior", () => {
        // 0 € antes de 2026 con −20.000 (se aportaron 20.000 y se perdieron) y 50.000 después con +15.000 (aportados 35.000):
        // derechos 50.000, aportado 55.000, diferencia positiva max(0, 15.000 − 20.000) = 0.
        const caso = { ...e, epsvPre: 0, epsvPreRent: -20000, epsvPost: 50000, epsvPostRent: 15000 } as const;
        // La pérdida no se limita al saldo del tramo (c525a845): se conserva aunque el saldo sea 0.
        expect(M.normalizar(caso).epsvPreRent).toBe(-20000);
        const c = calcular(caso).capital!;
        // Régimen 2026: nada al ahorro y 50.000 × 70 % = 35.000 a la general. Antes, 15.000 al ahorro y 35.000 × 70 % = 24.500.
        expect(c.nuevo!.bases.ahorro).toBe(0);
        cerca(c.nuevo!.bases.general, 35000, 1e-6);
        // Transitorio: cuota 20.000 / 55.000 = 4/11 → 50.000 × 4/11 = 18.181,82 al 60 % = 10.909,09; el resto, 31.818,18, sin
        // rendimiento (min(31.818,18; 15.000; −5.000) < 0) al 70 % = 22.272,73. General 33.181,82 y nada al ahorro (antes,
        // 15.000 al ahorro y 16.818,18 × 70 % de aportación).
        cerca(c.transitorio!.bases.detalle.tramoPre, (50000 * 4) / 11, 1e-6);
        expect(c.transitorio!.bases.ahorro).toBe(0);
        cerca(c.transitorio!.bases.general, ((50000 * 4) / 11) * 0.6 + ((50000 * 7) / 11) * 0.7, 1e-6);
        // Con un céntimo de saldo en el tramo anterior ya era así: ahora 0 € y 0,01 € dan lo mismo.
        const conCentimo = calcular({ ...caso, epsvPre: 0.01 }).capital!;
        expect(conCentimo.nuevo!.bases.ahorro).toBe(0);
        expect(conCentimo.transitorio!.bases.ahorro).toBe(0);
      });
    });
  });

  describe("sin desglose y con un año de antigüedad o menos, el saldo no se da por anterior a 2026 (N05, 22-11-2026)", () => {
    // Bizkaia, jubilándose hoy, cobro en capital, primer cobro: 100.000 € de saldo sin desglose, escritos como «Saldo total»
    // (el formulario los guarda en el tramo anterior a 2026).
    const e = { pension: 0, ...SIN_AHORROS, edad: 65, edadJubilacion: 65, inflacion: 0, tieneEpsv: true, epsvPre: 100000, epsvPost: 0, epsvDesglose: "estimacion", antiguedadConocida: true, epsvCobro: "capital" } as const;

    test("con un año, el saldo va entero al tramo posterior y, si ya se cobra, no hay reducción por los dos años (H1-03, 23-11-2026)", () => {
      const o = M.normalizar({ ...e, antiguedad: 1 });
      expect(o.epsvPre).toBe(0);
      expect(o.epsvPost).toBe(100000);
      // Cobra hoy (65 y 65) con un año de antigüedad: 1 + 0 < 2, «más de 2 años» no puede cumplirse y la casilla, aunque llegue
      // marcada (`dosAnios` por defecto), no aplica la reducción.
      expect(o.dosAnios).toBe(false);
      const c = calcular({ ...e, antiguedad: 1 }).capital!;
      // Estimación: 1 año × 1 % = 1 % → 1.000 de rentabilidad y 99.000 aportados, todo desde 2026.
      // Sin los dos años no hay reducción: 1.000 al ahorro y los 99.000 enteros a la general. (Con la reducción del 30 % salían
      // 99.000 × 70 % = 69.300: unos 12.800 € de IRPF de menos.)
      cerca(c.nuevo!.bases.ahorro, 1000, 1e-6);
      cerca(c.nuevo!.bases.general, 99000, 1e-6);
      // Transitorio: sin aportaciones anteriores, cuota 0 → da lo mismo que el de 2026, y se elige el de 2026.
      cerca(c.transitorio!.bases.general, 99000, 1e-6);
      expect(c.automatico).toBe(true);
      expect(c.elegido).toBe("nuevo");
      // Escribir 0 es lo mismo: el campo no baja de un año.
      expect(M.normalizar({ ...e, antiguedad: 0 }).epsvPre).toBe(0);
    });

    test("con un año de antigüedad y cinco hasta jubilarse, los dos años sí pueden cumplirse y la reducción se aplica (H1-03)", () => {
      // 65 → 70: 1 + 5 = 6 ≥ 2. Sin rentabilidad ni inflación el saldo no crece: 1.000 de rentabilidad (1 %) y 99.000 aportados,
      // todo desde 2026 → 1.000 al ahorro y 99.000 × 70 % = 69.300 a la general.
      const caso = { ...e, edadJubilacion: 70, rentabilidad: 0, antiguedad: 1 } as const;
      expect(M.normalizar(caso).dosAnios).toBe(true);
      const c = calcular(caso).capital!;
      cerca(c.nuevo!.bases.ahorro, 1000, 1e-6);
      cerca(c.nuevo!.bases.general, 69300, 1e-6);
      // Con la casilla desmarcada por el asesor, la reducción no se aplica.
      cerca(calcular({ ...caso, dosAnios: false }).capital!.nuevo!.bases.general, 99000, 1e-6);
    });

    test("la regla solo toca sin desglose y con antigüedad conocida, y no en invalidez o dependencia (H1-03)", () => {
      const uno = { ...e, antiguedad: 1 } as const;
      expect(M.normalizar({ ...uno, antiguedadConocida: false }).dosAnios).toBe(true);
      expect(M.normalizar({ ...uno, epsvDesglose: "certificado" }).dosAnios).toBe(true);
      expect(M.normalizar({ ...uno, contingencia: "invalidez" }).dosAnios).toBe(true);
      // Con dos años de antigüedad, ya cobrando: 2 + 0 ≥ 2.
      expect(M.normalizar({ ...e, antiguedad: 2 }).dosAnios).toBe(true);
    });

    test("con dos años, o sin antigüedad conocida, el saldo sigue siendo anterior a 2026", () => {
      const c = calcular({ ...e, antiguedad: 2 }).capital!;
      // Estimación 2 %: 2.000 de rentabilidad y 98.000 aportados antes de 2026. Transitorio: cuota 98.000 / 98.000 = 1 →
      // 100.000 × 60 % = 60.000 y nada al ahorro; régimen 2026: 2.000 al ahorro y 98.000 × 70 % = 68.600.
      cerca(c.transitorio!.bases.general, 60000, 1e-6);
      expect(c.transitorio!.bases.ahorro).toBe(0);
      cerca(c.nuevo!.bases.general, 68600, 1e-6);
      expect(c.elegido).toBe("transitorio");
      expect(M.normalizar({ ...e, antiguedad: 2 }).epsvPre).toBe(100000);
      expect(M.normalizar({ ...e, antiguedadConocida: false, antiguedad: 1 }).epsvPre).toBe(100000);
      // Con certificado la antigüedad no cuenta: el tramo es el que dice.
      expect(M.normalizar({ ...e, epsvDesglose: "certificado", antiguedad: 1 }).epsvPre).toBe(100000);
    });

    test("un saldo que quedó en el tramo posterior al pasar a «Sin desglose» se trata como el resto (H1-03, 22-11-2026)", () => {
      // Lo que queda al cambiar el selector desde «Con certificado»: 100.000 escritos en el tramo posterior, o el reparto del
      // caso de la DFB, 89.000 / 11.000. La pantalla dice «Saldo total: 100.000 €» y que se trata como aportado hasta 2025.
      for (const [epsvPre, epsvPost] of [
        [0, 100000],
        [89000, 11000]
      ] as const) {
        const caso = { ...e, antiguedad: 10, epsvPre, epsvPost } as const;
        const o = M.normalizar(caso);
        expect(o.epsvPre).toBe(100000);
        expect(o.epsvPost).toBe(0);
        const c = calcular(caso).capital!;
        // Estimación 10 años × 1 % = 10 %: 10.000 de rentabilidad y 90.000 aportados, todo antes de 2026. Transitorio:
        // cuota 90.000 / 90.000 = 1 → 100.000 × 60 % = 60.000 a la general y nada al ahorro; régimen 2026: 10.000 al ahorro y
        // 90.000 × 70 % = 63.000. Se elige el transitorio. Antes, con 0 / 100.000, el saldo se quedaba en el tramo
        // posterior: los dos regímenes daban 63.000 y 10.000, y el IRPF del cobro salía 3.149,43 € más alto (medido el
        // 22-11-2026 con un 3 % y un IPC del 2 %).
        cerca(c.transitorio!.bases.general, 60000, 1e-6);
        expect(c.transitorio!.bases.ahorro).toBe(0);
        cerca(c.nuevo!.bases.general, 63000, 1e-6);
        cerca(c.nuevo!.bases.ahorro, 10000, 1e-6);
        expect(c.elegido).toBe("transitorio");
        // El mismo impuesto que escribiendo los 100.000 como «Saldo total».
        expect(c.impuesto).toBe(calcular({ ...e, antiguedad: 10 }).capital!.impuesto);
      }
      // Con un año de antigüedad, el saldo entero va al tramo posterior, venga de donde venga.
      const o = M.normalizar({ ...e, antiguedad: 1, epsvPre: 89000, epsvPost: 11000 });
      expect(o.epsvPre).toBe(0);
      expect(o.epsvPost).toBe(100000);
      // Con certificado, cada tramo es el suyo.
      const certificado = M.normalizar({ ...e, epsvDesglose: "certificado", antiguedad: 10, epsvPre: 89000, epsvPost: 11000 });
      expect([certificado.epsvPre, certificado.epsvPost]).toEqual([89000, 11000]);
    });
  });
});

describe("El plan de retiradas", () => {
  test("la retirada creciente agota el capital justo al final", () => {
    const W = M.retiradaCreciente(200000, 0.03, 0.02, 30);
    let b = 200000;
    for (let k = 1; k <= 30; k += 1) b = b * 1.03 - W * 1.02 ** (k - 1);
    cerca(b, 0, 0.01);
  });

  /* JUB-6 (auditoría del 16-11-2026, tabla de bajos; decidido por Óscar el 17-11-2026): con una rentabilidad negativa, la
     liquidez rinde un 0 % en la proyección y también al calcular la retirada que agota los ahorros. */
  describe("con una rentabilidad negativa, la liquidez rinde un 0 % también al calcular la retirada", () => {
    /* Dos años de plan, sin pensión, sin IPC y sin previsión: 100.000 € de liquidez y 100.000 € en fondos que costaron
       100.000, así que vender no da ganancia y la liquidez no da intereses. No hay IRPF, y la retirada es todo el neto. */
    const DOS_ANIOS = { edad: 65, edadJubilacion: 65, edadFin: 67, pension: 0, liquidez: 100000, depositos: 0, fondos: 100000, fondosCoste: 100000, acciones: 0, accionesCoste: 0, seguros: 0, ahorroAnual: 0, tieneEpsv: false, inflacion: 0, estrategia: "consumir", estres: false } as const;

    test("la retirada que agota liquidez e inversiones, con dos rentabilidades, sale de su fórmula", () => {
      // Sin retiradas habría, al final del año 1: 100.000 + 100.000 × 0,98 = 198.000; y del año 2: 100.000 + 100.000 × 0,98² = 196.040.
      // W × (1 / 198.000 + 1 / 196.040) = 1 → W = 198.000 × 196.040 / (198.000 + 196.040) = 38.815.920.000 / 394.040 = 98.507,56.
      cerca(M.retiradaQueAgota(100000, 100000, 0, -0.02, 0, 2), 98507.56, 0.01);
      // Solo liquidez, al 0 %: 100.000 / 2 = 50.000 cada año. Con el −2 % de antes, 100.000 × 0,02 / ((1 / 0,98)² − 1) = 49.494,95.
      cerca(M.retiradaQueAgota(100000, 0, 0, -0.02, 0, 2), 50000, 0.01);
      // Si las dos rinden lo mismo, es la renta creciente de siempre: 200.000 / (1 / 1,02 + 1 / 1,02²) = 200.000 / 1,9415609 = 103.009,90.
      cerca(M.retiradaQueAgota(100000, 100000, 0.02, 0.02, 0, 2), 103009.9, 0.01);
      expect(M.retiradaQueAgota(100000, 100000, 0.02, 0.02, 0.01, 30)).toBe(M.retiradaCreciente(200000, 0.02, 0.01, 30));
    });

    test("con un −2 %, el plan retira lo que la proyección puede pagar y no sobra nada al final", () => {
      const res = calcular({ ...DOS_ANIOS, rentabilidad: -2 });
      const [y1, y2] = res.base.filas;
      // 98.507,56 los dos años (la cuenta de arriba). Antes salía 200.000 × 0,02 / ((1 / 0,98)² − 1) = 97.010,10, como si la
      // liquidez perdiera un 2 %, y al final del año 2 sobraban 99.990,2 − 97.010,1 = 2.980,1 €.
      cerca(res.plan.W1, 98507.56, 0.01);
      cerca(y1.retiradaAhorros, 98507.56, 0.01);
      cerca(y2.retiradaAhorros, 98507.56, 0.01);
      expect(y1.interes).toBe(0);
      expect(y1.impuesto).toBe(0);
      // Tras el año 1 queda 198.000 × (1 − 98.507,56 / 198.000) = 198.000² / 394.040 = 99.492,44, y tras el año 2, nada.
      cerca(y1.saldo, 99492.44, 0.01);
      cerca(res.base.saldoFinal, 0, 0.01);
      expect(res.base.edadAgotado).toBeNull();
    });

    test("con rentabilidad positiva, o conservando el capital, nada cambia", () => {
      const res = calcular({ ...DOS_ANIOS, rentabilidad: 2 });
      // 103.009,90 (la cuenta de arriba), y la liquidez da 100.000 × 2 % = 2.000 € de intereses el primer año.
      cerca(res.plan.W1, 103009.9, 0.01);
      cerca(res.base.filas[0].interes, 2000, 1e-6);
      cerca(res.base.saldoFinal, 0, 0.01);
      // Conservando, con −2 % no hay rentabilidad por encima del IPC que retirar: 200.000 × máx(0, −0,02 − 0) = 0.
      expect(calcular({ ...DOS_ANIOS, rentabilidad: -2, estrategia: "conservar" }).plan.W1).toBe(0);
      // Y con 3 % e IPC del 1 %, (100.000 + 100.000) × (0,03 − 0,01) = 4.000.
      cerca(calcular({ ...DOS_ANIOS, rentabilidad: 3, inflacion: 1, estrategia: "conservar" }).plan.W1, 4000, 1e-6);
    });

    /* A-191 (Óscar, 17-11-2026): la misma regla antes de jubilarse. */
    test("antes de jubilarse, con un −2 % la liquidez llega entera y los fondos pierden lo suyo", () => {
      // Diez años hasta la jubilación, sin ahorro: 50.000 € de liquidez y 50.000 € en fondos.
      const DIEZ_ANIOS = { ...DOS_ANIOS, edad: 55, liquidez: 50000, fondos: 50000, fondosCoste: 50000 };
      const negativa = calcular({ ...DIEZ_ANIOS, rentabilidad: -2 });
      // La liquidez, al 0 %: 50.000. Antes era 50.000 × 0,98¹⁰ = 50.000 × 0,8170728 = 40.853,64.
      cerca(negativa.plan.ini.liq, 50000, 1e-6);
      // Los fondos siguen con la rentabilidad elegida: 50.000 × 0,98¹⁰ = 40.853,64.
      cerca(negativa.plan.ini.V, 40853.64, 0.01);
      // Con un 3 %, la liquidez crece como antes: 50.000 × 1,03¹⁰ = 50.000 × 1,3439164 = 67.195,82.
      cerca(calcular({ ...DIEZ_ANIOS, rentabilidad: 3 }).plan.ini.liq, 67195.82, 0.01);
    });
  });

  test("caso inicial: cifras y coherencia del escenario base", () => {
    const r = calcular();
    const y1 = r.anio1;
    cerca(y1.pension, 28000);
    cerca(y1.bruto, y1.pension + y1.retiradaAhorros + y1.retiradaEpsv, 1e-6);
    cerca(y1.neto, y1.bruto - y1.impuesto, 1e-6);
    cerca(r.resumen.pensionNetaMensual + r.resumen.restoNetoMensual, r.resumen.netoMensual, 1e-6, "pensión neta + retiradas netas = total");
    cerca(r.base.saldoFinal, 0, 1);
    expect(r.base.edadAgotado, "El plan base dura hasta la edad elegida").toBeNull();
    cerca(r.base.filas[1].pension, 28000 * 1.02, 1e-6, "La pensión se revaloriza con el IPC");
  });

  test("escenarios: mismas retiradas, distinta duración", () => {
    const [con, base, opt, estres] = calcular().escenarios;
    cerca(con.filas[0].previsto, base.filas[0].previsto, 1e-6);
    expect(con.edadAgotado !== null && con.edadAgotado < 95, "Con menos rentabilidad el dinero dura menos").toBe(true);
    expect(opt.saldoFinal, "Con más rentabilidad sobra patrimonio").toBeGreaterThan(0);
    expect(estres.clave).toBe("estres");
    expect(estres.edadAgotado !== null && estres.edadAgotado < 95).toBe(true);
  });

  test("conservar el capital y fase previa a la jubilación", () => {
    const f = calcular({ estrategia: "conservar" }).base.filas.at(-1)!;
    cerca(f.saldo / (f.deflactor * 1.02), 200000, 1, "Mantiene el poder adquisitivo del capital");
    const a = calcular({ edad: 55, edadJubilacion: 65, ahorroAnual: 6000 });
    expect(a.resumen.patrimonioJubilacion).toBeGreaterThan(200000 * 1.03 ** 10);
    expect(a.resumen.deflactor1, "Euros de hoy descuentan diez años de IPC").toBeGreaterThan(1.2);
  });

  test("un cliente ya jubilado de más de 75 años empieza su plan a su edad, no a los 75", () => {
    /* El motor de origen acotaba la jubilación a 75: a los 80 empezaba el plan cinco años atrás, con la pensión
       deflactada (25.360 € en vez de 28.000 €) y un IRPF de 3.196 € en vez de 4.124 €. */
    for (const edad of [76, 80, 90]) {
      const r = calcular({ edad, edadJubilacion: edad, liquidez: 0, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0, edadFin: 100 });
      expect(r.entrada.edadJubilacion, `${edad}`).toBe(edad);
      expect(r.entrada.aniosHastaJubilacion).toBe(0);
      const f = r.base.filas[0];
      expect(f.edad).toBe(edad);
      cerca(f.pension, 28000, 1e-9);
      expect(f.deflactor).toBe(1);
      // 28.000 − 3.000 = 25.000 → 6.096 − 1.615 = 4.481; deducción por edad desde los 75: 714 × (30.000 − 25.000) / 10.000 = 357 → 4.124.
      cerca(f.impuesto, 4124, 0.01, `IRPF a los ${edad}`);
      expect(r.base.filas).toHaveLength(100 - edad);
    }
    /* Quien aún no ha cumplido 75 no puede aplazar la jubilación más allá, como antes. */
    expect(M.normalizar({ edad: 70, edadJubilacion: 80 }).edadJubilacion).toBe(75);
    expect(M.normalizar({ edad: 75, edadJubilacion: 75 }).edadJubilacion).toBe(75);
  });

  test("avisos y límites de la entrada", () => {
    expect(M.avisos({ pension: 0, liquidez: 0, fondos: 0, acciones: 0 }).length).toBeGreaterThan(0);
    expect(M.normalizar({ edad: 70, edadJubilacion: 60 }).edadJubilacion).toBe(70);
    expect(M.normalizar({ edad: 65, edadFin: 60 }).edadFin).toBe(66);
  });
});

/* P1-03 (auditoría del 20-11-2026; Óscar, 21-11-2026): lo vendido se lleva la parte de su coste que le toca (arts. 34.1.a y
   35.1 LIRPF) y la pérdida se compensa con las ganancias de lo vendido de los cuatro años siguientes y después caduca (art.
   49.1.b LIRPF, 54.2.b DFL 4/2008, 66.1.b de las NF 13/2013, 33/2013 y 3/2014). Sin el cruce del 25 % con los intereses
   que permiten el territorio común y Navarra: opción prudente. */
describe("Pérdidas de lo vendido: coste proporcional y compensación en cuatro años", () => {
  const PLAZO = 4;
  /* El ejemplo de la auditoría: 100.000 € de coste que caen a 88.000 €. */
  const CAIDA: M.CarteraFiscal = { V: 88000, K: 100000, pendientes: [] };

  test("las cinco normas dan cuatro años, y solo el común y Navarra cruzan con los rendimientos", () => {
    for (const id of ["bizkaia", "alava", "gipuzkoa"]) {
      const regla = F.reglaDeCompensacion(cfgDe(id));
      expect(regla.plazo, id).toBe(4);
      expect(regla.cruceConRendimientos, id).toBe(0);
      expect(regla.articulo, id).toMatch(/^art\. 66\.1\.b de la NF /);
    }
    expect(F.reglaDeCompensacion(cfgDe("navarra"))).toEqual({ plazo: 4, cruceConRendimientos: 0.25, articulo: "art. 54.2.b del DFL 4/2008" });
    expect(F.reglaDeCompensacion(cfgDe("estatal", "madrid"))).toEqual({ plazo: 4, cruceConRendimientos: 0.25, articulo: "art. 49.1.b de la Ley 35/2006" });
  });

  test("el ejemplo de la auditoría: vender la mitad en pérdidas y liquidar tras subir un 50 %", () => {
    // Año 1, se venden 44.000 € (la mitad): se van 44.000 × 100.000 / 88.000 = 50.000 € de coste, y la pérdida es
    // 50.000 − 44.000 = 6.000 €. Queda la otra mitad: 44.000 € que costaron 50.000 €. Antes salían solo 44.000 € de coste y
    // quedaban 56.000.
    const v1 = M.vender(CAIDA, 44000, 1, PLAZO);
    cerca(v1.costeRetirado, 50000, 1e-9);
    cerca(v1.perdida, 6000, 1e-9);
    expect(v1.ganancia).toBe(0);
    cerca(v1.K, 50000, 1e-9);
    cerca(v1.V, 44000, 1e-9);
    expect(v1.pendientes).toEqual([{ origen: 1, importe: expect.closeTo(6000, 6) }]);
    // Año 2, sube un 50 %: 44.000 × 1,5 = 66.000 €, y se vende todo. Ganancia 66.000 − 50.000 = 16.000 €; la pérdida del
    // año 1 le quita 6.000, y tributan 10.000 €. Con el coste de antes (56.000) también salían 10.000, pero sin plazo.
    const v2 = M.vender({ ...v1, V: 66000 }, 66000, 2, PLAZO);
    cerca(v2.gananciaBruta, 16000, 1e-9);
    cerca(v2.compensado, 6000, 1e-9);
    cerca(v2.ganancia, 10000, 1e-9);
    cerca(v2.K, 0, 1e-9);
    expect(v2.pendientes).toEqual([]);
    expect(v2.perdidasPendientes).toBe(0);
  });

  test("vender todo en pérdidas se lleva todo el coste", () => {
    // 88.000 − 100.000 = −12.000 €, y no queda coste sin valor. Antes quedaban 100.000 − 88.000 = 12.000 € de coste con V = 0.
    const v = M.vender(CAIDA, 88000, 1, PLAZO);
    cerca(v.costeRetirado, 100000, 1e-9);
    cerca(v.perdida, 12000, 1e-9);
    expect(v.V).toBe(0);
    cerca(v.K, 0, 1e-9);
  });

  test("la pérdida vale hasta el cuarto año siguiente y después caduca sin compensar", () => {
    const v1 = M.vender(CAIDA, 44000, 1, PLAZO);
    // Año 5 —el cuarto siguiente al 1—: aún compensa. 16.000 − 6.000 = 10.000.
    const enPlazo = M.vender({ ...v1, V: 66000 }, 66000, 5, PLAZO);
    cerca(enPlazo.compensado, 6000, 1e-9);
    cerca(enPlazo.ganancia, 10000, 1e-9);
    // Si en los años 2 a 5 no se vende nada, al cierre del 5 la pérdida caduca entera: 6.000 €.
    let c: M.CarteraFiscal = v1;
    let caducada = 0;
    for (let anio = 2; anio <= 5; anio += 1) {
      const sinVenta = M.vender(c, 0, anio, PLAZO);
      caducada += sinVenta.perdidaCaducada;
      c = sinVenta;
      cerca(sinVenta.perdidasPendientes, anio < 5 ? 6000 : 0, 1e-9, `año ${anio}`);
    }
    cerca(caducada, 6000, 1e-9);
    // Año 6: la misma venta tributa entera, 66.000 − 50.000 = 16.000 €. Con el coste de antes habrían tributado 10.000.
    const fuera = M.vender({ ...c, V: 66000 }, 66000, 6, PLAZO);
    expect(fuera.compensado).toBe(0);
    cerca(fuera.ganancia, 16000, 1e-9);
  });

  test("dos pérdidas se compensan la más antigua primero", () => {
    // Pendientes 1.000 € del año 1 y 2.000 € del año 3; en el año 4 se ganan 1.500 €: 1.000 del año 1 y 500 del año 3.
    const v = M.vender({ V: 15000, K: 13500, pendientes: [{ origen: 1, importe: 1000 }, { origen: 3, importe: 2000 }] }, 15000, 4, PLAZO);
    cerca(v.gananciaBruta, 1500, 1e-9);
    cerca(v.compensado, 1500, 1e-9);
    expect(v.ganancia).toBe(0);
    expect(v.pendientes).toEqual([{ origen: 3, importe: expect.closeTo(1500, 6) }]);
  });

  test("«Mal comienzo» en Bizkaia: las pérdidas de los dos primeros años rebajan las ganancias de los cuatro siguientes", () => {
    /* Pensión de 2.000 € × 14, sin liquidez, 100.000 € en fondos que costaron 100.000, un 10 % y sin IPC, conservando el
       capital: se retira 100.000 × (10 % − 0 %) = 10.000 € al año. El mal comienzo es −12 % y −5 %, y después un 10 %. */
    const r = calcular({ territorio: "bizkaia", pension: 2000, liquidez: 0, depositos: 0, fondos: 100000, fondosCoste: 100000, acciones: 0, accionesCoste: 0, rentabilidad: 10, inflacion: 0, estrategia: "conservar", edadFin: 75, estres: true });
    const f = r.escenarios.find((e) => e.clave === "estres")!.filas;
    cerca(r.plan.W1, 10000, 1e-6);
    // Año 1: V = 88.000; se venden 10.000 con 10.000 × 100.000 / 88.000 = 11.363,64 de coste → pérdida 1.363,64.
    //   Quedan V = 78.000 y K = 88.636,36.
    cerca(f[0].perdida, 1363.64, 0.01);
    // Año 2: V = 78.000 × 0,95 = 74.100; coste 10.000 × 88.636,36 / 74.100 = 11.961,72 → pérdida 1.961,72. V = 64.100, K = 76.674,64.
    cerca(f[1].perdida, 1961.72, 0.01);
    // Año 3: V = 64.100 × 1,1 = 70.510; coste 10.000 × 76.674,64 / 70.510 = 10.874,29 → pérdida 874,29. V = 60.510, K = 65.800,35.
    cerca(f[2].perdida, 874.29, 0.01);
    cerca(f[2].perdidasPendientes, 1363.64 + 1961.72 + 874.29, 0.02);
    // Año 4: V = 66.561; coste 10.000 × 65.800,35 / 66.561 = 9.885,72 → ganancia 114,28, compensada con la del año 1.
    cerca(f[3].gananciaBruta, 114.28, 0.01);
    cerca(f[3].compensado, 114.28, 0.01);
    expect(f[3].ganancia).toBe(0);
    // Año 5: V = 56.561 × 1,1 = 62.217,10; K = 55.914,63; coste 8.987,02 → ganancia 1.012,98, compensada. A la del año 1 le
    //   quedan 1.363,64 − 114,28 − 1.012,98 = 236,38, y su plazo acaba este año: caducan.
    cerca(f[4].compensado, 1012.98, 0.01);
    cerca(f[4].perdidaCaducada, 236.38, 0.01);
    // Año 6: ganancia 1.829,98, compensada con la del año 2, a la que le quedan 1.961,72 − 1.829,98 = 131,74 y caducan.
    cerca(f[5].compensado, 1829.98, 0.01);
    cerca(f[5].perdidaCaducada, 131.74, 0.01);
    // Año 7: ganancia 2.572,71; la del año 3 (874,29) cabe entera y tributan 2.572,71 − 874,29 = 1.698,42.
    cerca(f[6].gananciaBruta, 2572.71, 0.01);
    cerca(f[6].compensado, 874.29, 0.01);
    cerca(f[6].ganancia, 1698.42, 0.01);
    expect(f[6].perdidasPendientes).toBe(0);
    // Su IRPF, con la pensión a los 71: base general 28.000 − 3.000 = 25.000 → 4.481 tras la minoración; el ahorro, al 19 %:
    //   1.698,42 × 0,19 = 322,70; la deducción por edad, 393 × (30.000 − 25.000 − 1.698,42) / 10.000 = 129,75.
    //   4.481 + 322,70 − 129,75 = 4.673,95. Con el coste de antes, ese año tributaban 2.030,04 → 4.749,99.
    cerca(f[6].impuesto, 4673.95, 0.01);
    // Año 1, sin ahorro que tribute: 4.481 − 393 × 5.000 / 10.000 = 4.284,50.
    cerca(f[0].impuesto, 4284.5, 0.01);
    // Las ganancias que tributan en los diez años: 1.698,42 + 3.247,92 + 3.861,74 + 4.419,77 = 13.227,85 (antes 13.799,32).
    cerca(f.reduce((s, x) => s + x.ganancia, 0), 13227.85, 0.02);
  });

  test("el caso por defecto no cambia: nunca vende en pérdidas", () => {
    /* 150.000 € que costaron 115.000: K / V = 0,7667. Con el mal comienzo, 0,7667 / 0,88 = 0,8712 y 0,8712 / 0,95 = 0,9171;
       vender a prorrata no mueve esa proporción, y después la rentabilidad la baja. Nunca llega a 1: no hay pérdidas, y el
       coste que sale es el de antes. Las cifras del motor de origen las fija «Regresión exacta del motor de origen». */
    for (const e of calcular().escenarios) {
      for (const fila of e.filas) {
        expect(fila.perdida, `${e.clave}, año ${fila.anio}`).toBe(0);
        expect(fila.compensado, `${e.clave}, año ${fila.anio}`).toBe(0);
        expect(fila.ganancia).toBe(fila.gananciaBruta);
      }
    }
  });
});

/* JUB-8: estas son las únicas cifras del fichero que NO salen de una cuenta a mano. Son lo que daba el motor de NUVIA el
   día que se trajo: si una se mueve, este motor ha dejado de calcular lo que calculaba aquel. No dicen que la regla esté
   bien; eso lo dicen los demás bloques, cada uno con su cuenta sobre la norma. */
describe("Regresión exacta del motor de origen", () => {
  test("Bizkaia (23-09-2026, refijada el 04-10-2026 por la regla de edad a 31-12)", () => {
    // Caso inicial: año 1 a los 65 con base 25.000 + ahorro ≈ 1.600 → deducción por edad ≈ 134 €.
    const r = calcular();
    expect(r.cfg.id, "Bizkaia es el territorio por defecto").toBe("bizkaia");
    cerca(r.resumen.netoMensual, 2575.58228, 1e-4);
    cerca(r.anio1.impuesto, 4975.003139, 1e-4);
    cerca(r.anio1.impuesto, 5053.156984 - r.anio1.irpf.deduccionEdad, 1e-4, "Respecto al 23-09 solo cambia la deducción por edad del año 1");
    expect(r.escenarios[0].agotado).toBe(25);
    // Caso DFB: el cobro no tiene deducción (base > 30.000 €), pero el año «sin cobro» sí la tiene (393 €): el coste del cobro sube 393 €.
    const dfb = calcular({ pension: 0, ...SIN_AHORROS, tieneEpsv: true, epsvPre: 89000, epsvPreRent: 27000, epsvPost: 11000, epsvPostRent: 3000, epsvCobro: "capital" }).capital!;
    cerca(dfb.transitorio!.impuesto, 15224.942857 + 393, 1e-4);
    cerca(dfb.nuevo!.impuesto, 17794.373086, 1e-4, "régimen 2026: +392,41 € (la iteración del neto mueve ligeramente los intereses del año)");
    cerca(dfb.neto, 84775.057143 - 393, 1e-4);
    /* Desde la A-159 (16-11-2026) los territorios vascos actualizan las reglas con el IPC, y el motor de origen no: estas
       dos cifras, que son de años futuros con inflación, se comparan con las reglas fijas, que es lo que él calcula. */
    const comoElDeOrigen = { escalasDelIrpf: "fijas" } as const;
    const g = calcular({ pension: 4000, fondos: 500000, fondosCoste: 200000, acciones: 300000, accionesCoste: 100000, seguros: 50000, segurosCoste: 40000, rentabilidad: 5, inflacion: 3, otrasDeducciones: 300 }, comoElDeOrigen);
    cerca(g.resumen.netoMensual, 6533.634285, 1e-4);
    cerca(g.base.filas[5].impuesto, 23904.94121, 1e-4);
    const m = calcular({ edad: 60, edadJubilacion: 67, pension: 2200, tieneEpsv: true, epsvPre: 50000, epsvPreRent: 10000, epsvPost: 5000, epsvPostRent: 500, epsvCobro: "mixto", epsvPctCapital: 30 }, comoElDeOrigen);
    cerca(m.resumen.netoMensual, 3355.585773, 1e-4);
    cerca(m.capital!.neto, 16239.775612, 1e-4);
  });

  test("la referencia y las comunidades sin mínimo propio calculan igual entre sí", () => {
    // Castilla-La Mancha tiene la misma escala que el art. 65 y no tiene mínimo propio: todo debe coincidir con la referencia.
    const entradas: Array<Partial<EntradaDeJubilacion>> = [
      {},
      { edad: 60, edadJubilacion: 67, pension: 2200, fondos: 300000, fondosCoste: 200000 },
      { pension: 1500, tieneEpsv: true, epsvPre: 60000, epsvPost: 40000, epsvCobro: "capital" },
      { pension: 0, ...SIN_AHORROS, otrasDeducciones: 0 }
    ];
    for (const e of entradas) {
      const ref = calcular({ territorio: "estatal", ccaa: "referencia", ...e });
      const clm = calcular({ territorio: "estatal", ccaa: "castilla-la-mancha", ...e });
      expect(clm.resumen.netoMensual).toBe(ref.resumen.netoMensual);
      expect(clm.anio1.impuesto).toBe(ref.anio1.impuesto);
      expect(clm.base.filas.map((f) => f.impuesto)).toEqual(ref.base.filas.map((f) => f.impuesto));
    }
    for (const id of ["referencia", "aragon", "cantabria", "castilla-la-mancha", "castilla-y-leon", "cataluna", "extremadura", "murcia", "rioja"]) {
      const cfg = cfgDe("estatal", id);
      expect(cfg.minimoAutonomico, id).toBeNull();
      const t = F.irpf(cfg, { trabajo: 28000, edad: 70 });
      expect(t.minimoAutonomico, id).toBe(t.minimoPersonal);
      expect(plano(t.desglose.general.find((x) => x.clave === "minimo")!.etiqueta), id).toMatch(/^Mínimo personal a escala \(6\.700 €\)$/);
      expect(F.resumenParametros(cfg).some((l) => /se aplica «a escala» en la parte estatal y en la autonómica\.$/.test(l)), id).toBe(true);
    }
  });
});

describe("Navarra", () => {
  test("escala general (art. 59.1), deducción por trabajo (art. 62.5) y mínimo personal (art. 62.9) de 2026", () => {
    // Pensión 2.000 × 14 = 28.000 a los 65 años. Escala: 4.458 × 13 % + 5.572 × 22 % + 11.145 × 25 % + 6.825 × 28 % = 6.502,63.
    // Deducción por trabajo: 700 € (tramo 17.500,01–35.000). Mínimo personal: 1.084 + 264 (≥ 65) + [1.280 − 0,0904 × (28.000 − 17.500)] = 1.678,80.
    // Cuota: 6.502,63 − 700 − 1.678,80 = 4.123,83.
    const t = M.irpf({ trabajo: 28000, edad: 65, territorio: "navarra" });
    cerca(t.cuotaGeneralBruta, 6502.63);
    cerca(t.deduccionTrabajo, 700);
    cerca(t.minimoPersonal, 1678.8);
    cerca(t.total, 4123.83);
    expect(t.marginalGeneral).toBe(0.28);
    const cfg = cfgDe("navarra");
    if (cfg.modelo !== "navarra") throw new Error("Navarra no sigue su modelo");
    const P = cfg.parametros;
    expect(F.deduccionTrabajoNavarra(P, 12500)).toBe(1400);
    cerca(F.deduccionTrabajoNavarra(P, 15000), 1400 - 0.14 * 2500); // 1.050
    cerca(F.deduccionTrabajoNavarra(P, 40000), 700 - 0.02 * 5000); // 600
    expect(F.deduccionTrabajoNavarra(P, 60000)).toBe(400);
    cerca(F.minimoPersonalNavarra(P, 70, 10000), 1084 + 264 + 1280);
    cerca(F.minimoPersonalNavarra(P, 76, 31000), 1084 + 585 + (150 - 0.075 * 1000));
    expect(F.minimoPersonalNavarra(P, 60, 40000)).toBe(1084);
    // La deducción por trabajo no supera la escala aplicada al rendimiento: 3.000 € de trabajo → escala 390 € < 1.400 €.
    cerca(M.irpf({ trabajo: 3000, edad: 60, territorio: "navarra" }).deduccionTrabajo, 390);
    // Escala del ahorro (art. 60): 10.000 € → 6.000 × 20 % + 4.000 × 22 % = 2.080.
    cerca(M.irpf({ trabajo: 0, ahorro: 10000, edad: 60, territorio: "navarra" }).cuotaAhorro, 2080);
  });

  test("plan de pensiones en capital: la reducción del 40 % solo sobre aportaciones anteriores a 2018 (DT 25.ª)", () => {
    const base = { territorio: "navarra", pension: 0, ...SIN_AHORROS, tieneEpsv: true, epsvPre: 60000, epsvPost: 40000, epsvCobro: "capital" } as const;
    const c = calcular(base).capital!;
    expect(c.opciones.length, "Un solo régimen").toBe(1);
    cerca(c.bases.general, 100000 - 0.4 * 60000);
    expect(c.bases.ahorro).toBe(0);
    cerca(c.bases.detalle.reduccion, 24000);
    // Fuera de la ventana temporal, o sin los dos años, no hay reducción.
    cerca(calcular({ ...base, primerCobro: false }).capital!.bases.general, 100000);
    cerca(calcular({ ...base, dosAnios: false }).capital!.bases.general, 100000);
    // Impuesto del cobro: escala(76.000) = 20.818,61 + 9.131 × 44 % = 24.836,25; deducción por trabajo 400 (rendimiento íntegro 100.000);
    // mínimo personal 1.084 + 264 (65 años); el ahorro del año (intereses del neto) queda absorbido igual con y sin cobro.
    cerca(calcular({ ...base, rentabilidad: 0 }).capital!.impuesto, 24836.25 - 400 - 1348, 0.01);
    // En renta, todo es trabajo: no hay parte en el ahorro ni exenta, aunque se elija renta temporal.
    const r = calcular({ ...base, epsvCobro: "renta", epsvRenta: "temporal" }).base.filas[0];
    expect(r.irpf.ahorro).toBe(0);
    expect(r.epsvRentExenta).toBe(0);
    cerca(r.epsvTrabajo, r.retiradaEpsv, 1e-6);
    expect(M.normalizar(base).epsvPreRent, "Fuera del modelo vasco no hay desglose de rentabilidad").toBe(0);
  });
});

describe("Territorio común", () => {
  test("escala de referencia: gastos (art. 19.2.f), reducción (art. 20), mínimo a escala (arts. 57, 63 y 65)", () => {
    // 28.000 − 2.000 de gastos = 26.000; sin reducción (≥ 19.747,5). A los 64, mínimo 5.550.
    // Estatal: escala(26.000) = 2.112,75 + 5.800 × 15 % = 2.982,75; escala(5.550) = 527,25; cuota 2.455,50. Autonómica de referencia: idéntica → total 4.911.
    const t = M.irpf({ trabajo: 28000, edad: 64, territorio: "estatal" });
    expect(t.gastos).toBe(2000);
    expect(t.reduccionTrabajo).toBe(0);
    expect(t.baseGeneral).toBe(26000);
    cerca(t.total, 4911);
    cerca(t.marginalGeneral, 0.3);
    // Desde el año en que se cumplen 65 (edad a 31-12): mínimo 6.700 → escala(6.700) = 636,50 → 2 × (2.982,75 − 636,50) = 4.692,50. Igual a los 70.
    cerca(M.irpf({ trabajo: 28000, edad: 65, territorio: "estatal" }).total, 4692.5);
    cerca(M.irpf({ trabajo: 28000, edad: 70, territorio: "estatal" }).total, 4692.5);
    // Desde los 75: mínimo 8.100 → escala(8.100) = 769,50 → 2 × (2.982,75 − 769,50) = 4.426,50.
    cerca(M.irpf({ trabajo: 28000, edad: 75, territorio: "estatal" }).total, 4426.5);
    cerca(M.irpf({ trabajo: 28000, edad: 74, territorio: "estatal" }).total, 4692.5);
    // 15.000 de trabajo a los 64. La reducción se mide sobre el rendimiento antes de los 2.000 € de la letra f)
    // (art. 20, párrafo que sigue a los tramos: solo restan los gastos de las letras a) a e) del art. 19.2; P1-01, 21-11-2026):
    // 15.000 está en el tramo b) → 7.302 − 1,75 × (15.000 − 14.852) = 7.302 − 259 = 7.043.
    // Base = 15.000 − 2.000 − 7.043 = 5.957; estatal 5.957 × 9,5 % − 527,25 = 565,915 − 527,25 = 38,665; con la autonómica de referencia, idéntica, 77,33.
    // A los 65 el mínimo (6.700) cubre toda la base: 0.
    const b = M.irpf({ trabajo: 15000, edad: 64, territorio: "estatal" });
    cerca(b.reduccionTrabajo, 7043, 1e-9);
    cerca(b.baseGeneral, 5957, 1e-9);
    cerca(b.total, 77.33, 1e-9);
    cerca(M.irpf({ trabajo: 15000, edad: 65, territorio: "estatal" }).total, 0);
    // Tramos b) y c) del art. 20: 16.000 → 7.302 − 1,75 × 1.148 = 5.293; 19.000 → 2.364,34 − 1,14 × 1.326,48 = 852,15.
    const cfg = cfgDe("estatal");
    if (cfg.modelo !== "comun") throw new Error("El estatal no sigue su modelo");
    const P = cfg.parametros;
    cerca(F.reduccionTrabajoComun(P, 16000, 0), 7302 - 1.75 * 1148);
    cerca(F.reduccionTrabajoComun(P, 19000, 0), 2364.34 - 1.14 * 1326.48);
    expect(F.reduccionTrabajoComun(P, 16000, 7000), "Sin reducción si otras rentas superan 6.500 €").toBe(0);
    // Solo ahorro, 10.000 €: 6.000 × 19 % + 4.000 × 21 % = 1.980; el mínimo (5.550) se aplica al ahorro: 1.054,50 → 925,50.
    cerca(M.irpf({ trabajo: 0, ahorro: 10000, edad: 60, territorio: "estatal" }).total, 925.5);
    expect(F.escalaGeneralVisible(cfg)).toEqual([[0, 0.19], [12450, 0.24], [20200, 0.3], [35200, 0.37], [60000, 0.45], [300000, 0.47]]);
  });

  test("la reducción del art. 20 se mide antes de los 2.000 € de gastos de la letra f) (P1-01)", () => {
    // Art. 20 LIRPF (redacción del RDL 4/2024): «el rendimiento neto del trabajo será el resultante de minorar el
    // rendimiento íntegro en los gastos previstos en las letras a), b), c), d) y e) del artículo 19.2». Una pensión no
    // tiene gastos de a) a e): la reducción se mide sobre la pensión íntegra; los 2.000 € se restan aparte, y la
    // reducción no puede dejar el saldo en negativo. Cada caso, a los 64 años y sin otras rentas:
    const caso = (trabajo: number) => M.irpf({ trabajo, edad: 64, territorio: "estatal" });
    // 14.852 (límite del tramo a): reducción 7.302; base 14.852 − 2.000 − 7.302 = 5.550.
    cerca(caso(14852).reduccionTrabajo, 7302, 1e-9);
    cerca(caso(14852).baseGeneral, 5550, 1e-9);
    // 16.000 (tramo b): 7.302 − 1,75 × 1.148 = 5.293; base 16.000 − 2.000 − 5.293 = 8.707. Con la regla de antes, sobre 14.000, eran 7.302 y 6.698.
    cerca(caso(16000).reduccionTrabajo, 5293, 1e-9);
    cerca(caso(16000).baseGeneral, 8707, 1e-9);
    // 18.000 (tramo c): 2.364,34 − 1,14 × (18.000 − 17.673,52) = 2.364,34 − 372,1872 = 1.992,1528; base 18.000 − 2.000 − 1.992,1528 = 14.007,8472.
    // Con la regla de antes, sobre 16.000, eran 5.293 y 10.707: 3.300,85 € menos de base.
    cerca(caso(18000).reduccionTrabajo, 1992.1528, 1e-9);
    cerca(caso(18000).baseGeneral, 14007.8472, 1e-9);
    // 19.747,50: el art. 20 solo reduce rendimientos «inferiores a 19.747,5 euros» → 0; base 17.747,50.
    expect(caso(19747.5).reduccionTrabajo).toBe(0);
    cerca(caso(19747.5).baseGeneral, 17747.5, 1e-9);
    // 20.500: 0 (con la regla de antes, sobre 18.500, eran 2.364,34 − 1,14 × 826,48 = 1.422,15); base 18.500.
    expect(caso(20500).reduccionTrabajo).toBe(0);
    cerca(caso(20500).baseGeneral, 18500, 1e-9);
    // 8.000: la reducción sería 7.302, pero el saldo tras los gastos es 6.000 y no puede quedar negativo → 6.000; base 0.
    cerca(caso(8000).reduccionTrabajo, 6000, 1e-9);
    expect(caso(8000).baseGeneral).toBe(0);
  });

  test("plan de pensiones en capital: el 40 % de la DT 12.ª solo sobre aportaciones anteriores a 2007", () => {
    const base = { territorio: "estatal", pension: 2000, tieneEpsv: true, epsvPre: 60000, epsvPost: 40000, epsvCobro: "capital" } as const;
    const c = calcular(base).capital!;
    cerca(c.bases.general, 76000);
    expect(c.bases.ahorro).toBe(0);
    expect(c.opciones.length).toBe(1);
    cerca(calcular({ ...base, primerCobro: false }).capital!.bases.general, 100000);
    expect(c.impuesto > 0 && c.neto < 100000).toBe(true);
  });
});

describe("Lo que no está verificado no calcula", () => {
  test("una comunidad «en preparación», un territorio desconocido o vacío no dan ninguna cifra", () => {
    // Ninguna comunidad real está «en preparación»: se comprueba con una entrada ficticia que solo existe en esta prueba.
    const ficticia: F.Comunidad = { id: "prueba-en-preparacion", nombre: "Comunidad de prueba", estado: "en-preparacion" };
    F.CCAA.push(ficticia);
    try {
      const m = M.calcular({ territorio: "estatal", ccaa: ficticia.id });
      expect(m.disponible).toBe(false);
      if (m.disponible) return;
      expect(m.estado).toBe("en-preparacion");
      expect(m.resumen).toBeNull();
      expect(m.escenarios.length).toBe(0);
      expect(m.mensaje).toMatch(/en preparación/);
      // Una entrada con escala pero sin estado «verificada» tampoco calcula.
      ficticia.escalaAutonomica = F.ESCALAS.ESCALA_ART65;
      const conEscala = M.calcular({ territorio: "estatal", ccaa: ficticia.id });
      expect(conEscala.disponible === false && conEscala.estado).toBe("en-preparacion");
    } finally {
      F.CCAA.pop();
    }
    const estadoDe = (entrada: Partial<EntradaDeJubilacion>) => {
      const r = M.calcular(entrada);
      return r.disponible ? "calcula" : r.estado;
    };
    expect(estadoDe({ territorio: "marte" })).toBe("desconocido");
    expect(estadoDe({ territorio: null })).toBe("sin-territorio");
    expect(estadoDe({ territorio: "estatal", ccaa: "atlantida" })).toBe("desconocida");
    expect(calcular({ territorio: "estatal" }).cfg.ccaa?.id, "Sin comunidad, el estatal usa la escala de referencia").toBe("referencia");
    expect(F.CCAA.filter((c) => c.estado === "verificada").length, "La referencia y las 15 comunidades calculan").toBe(16);
    expect(F.CCAA.length, "15 comunidades de régimen común + referencia").toBe(16);
    expect(F.CCAA.some((c) => /ceuta|melilla/i.test(c.id)), "Ceuta y Melilla no se ofrecen").toBe(false);
    expect(F.FUERA_DE_ALCANCE.map((x) => x.id).join(",")).toBe("ceuta,melilla");
    expect(estadoDe({ territorio: "estatal", ccaa: "ceuta" }), "Ceuta no calcula").toBe("desconocida");
    expect(F.limites(cfgDe("estatal")).some((l) => /Ceuta y Melilla quedan fuera/.test(l)), "El límite se declara en el estatal").toBe(true);
  });

  test("cada territorio cita fuentes oficiales con su fecha y declara sus límites", () => {
    for (const t of F.TERRITORIOS) {
      expect(t.estado, t.id).toBe("verificada");
      expect(t.fuentes.length >= 4 && t.fuentes.every((f) => /^https:\/\//.test(f.href)), `${t.id}: fuentes`).toBe(true);
      expect(t.consulta).toBe("04-10-2026");
      expect(t.ejercicio).toBe(2026);
      expect(t.normativa.length, `${t.id}: normativa`).toBeGreaterThanOrEqual(4);
      const cfg = cfgDe(t.id);
      expect(F.limites(cfg).some((l) => /deducciones autonómicas del régimen común ni deducciones propias de los territorios forales/.test(l)), `${t.id}: límite común`).toBe(true);
      expect(F.resumenParametros(cfg).length).toBeGreaterThanOrEqual(4);
    }
    expect(F.limites(cfgDe("estatal")).some((l) => /referencia del art\. 65/.test(l))).toBe(true);
    expect(F.limites(cfgDe("navarra")).some((l) => /art\. 68/.test(l))).toBe(true);
    for (const t of ["navarra", "estatal"]) {
      expect(F.territorio(t)!.fuentes.some((f) => /BOE-A-2004-3453/.test(f.href)), `${t}: cita el RD 304/2004 en el BOE`).toBe(true);
    }
  });

  test("las reglas son de un ejercicio, y se sabe cuándo ha vencido", () => {
    expect(F.ejercicioVencido(new Date(2026, 10, 13))).toBe(false);
    expect(F.ejercicioVencido(new Date(2026, 11, 31))).toBe(false);
    expect(F.ejercicioVencido(new Date(2027, 0, 1))).toBe(true);
  });
});

/* Escalas autonómicas de 2026: texto consolidado de cada ley en el BOE (consulta 05-10-2026), contrastado con
   «Tributación Autonómica. Medidas 2026» del Ministerio de Hacienda (23-09-2026). Las cifras esperadas salen de
   esas tablas, calculadas a mano. */
describe("Las 15 comunidades de régimen común", () => {
  // La cuota íntegra publicada al inicio de cada tramo (columna «Cuota íntegra» de la ley).
  const CUOTAS_PUBLICADAS: Record<string, number[]> = {
    andalucia: [0, 1235, 2207, 4322, 8910],
    aragon: [0, 1241.89, 2218.39, 4580.89, 7455.79, 8993.29, 13593.29, 15993.29, 25993.29],
    asturias: [0, 1120.5, 1751.36, 3893.36, 7810.16, 11377.62, 15877.62, 37127.62],
    baleares: [0, 900, 1800, 3510, 6660, 10840, 15190, 22015, 35077.5],
    canarias: [0, 1237.32, 1889.83, 4200.11, 8203.88, 16593.85, 24213.1],
    cantabria: [0, 1105, 1985, 4044, 8508, 15258],
    "castilla-la-mancha": [0, 1182.75, 2112.75, 4362.75, 8950.75],
    "castilla-y-leon": [0, 1120.5, 2050.5, 4150.5, 7518.83],
    cataluna: [0, 1187.5, 2375, 4135, 7935, 15890, 22940, 36415],
    valenciana: [0, 1056, 2226, 3686, 5386, 7326, 9516, 11956, 19264, 32939, 47114],
    extremadura: [0, 964.88, 1720.5, 2360.5, 4285.5, 9493.5, 14240.5, 18800.5, 23945.5],
    galicia: [0, 1168.68, 2110.38, 4215.96, 8779.16],
    madrid: [0, 1135.79, 1739.53, 3841.42, 7651.1],
    murcia: [0, 1182.75, 2050.75, 3886.15, 8540.15],
    rioja: [0, 996, 1817.5, 3857.5, 4711.9, 6541.9, 8441.9, 23141.9]
  };

  test("verificadas, con fuente oficial fechada, nota y la aritmética de su escala comprobada", () => {
    const comunidades = F.CCAA.filter((c) => !c.referencia);
    expect(comunidades.length).toBe(15);
    expect(F.CCAA[0].id, "La escala de referencia es la primera opción").toBe("referencia");
    expect(F.CCAA[0].nombre).toBe("Escala de referencia (art. 65 LIRPF)");
    for (const c of comunidades) {
      expect(c.estado, c.id).toBe("verificada");
      expect(c.fuente!.href, `${c.id}: texto consolidado en el BOE`).toMatch(/^https:\/\/www\.boe\.es\/buscar\/act\.php\?id=/);
      expect(c.fuente!.consulta, c.id).toBe("05-10-2026");
      expect(c.nota && /No incluye deducciones autonómicas/.test(c.nota), `${c.id}: nota con el límite`).toBe(true);
      const pub = CUOTAS_PUBLICADAS[c.id];
      expect(pub.length, `${c.id}: mismo número de tramos que la ley`).toBe(c.escalaAutonomica!.length);
      c.escalaAutonomica!.forEach(([desde], i) => cerca(F.escala(desde, c.escalaAutonomica!).cuota, pub[i], 0.006, `${c.id} tramo ${i}`));
      // La ley de la comunidad encabeza las fuentes de la pantalla y del informe; la referencia conserva las del estatal.
      const cfg = cfgDe("estatal", c.id);
      expect(cfg.fuentes[0].href, c.id).toBe(c.fuente!.href);
      expect(cfg.fuentes[0].d).toMatch(/Consultada el 05-10-2026/);
      expect(cfg.fuentes.length).toBe(F.territorio("estatal")!.fuentes.length + 1);
      expect(F.limites(cfg).some((l) => l.startsWith(`La escala autonómica aplicada es la ${c.de}`)), `${c.id}: límite`).toBe(true);
      expect(c.de, `${c.id}: forma con artículo`).toMatch(/^(de|del) /);
      expect(F.consultaFuentes(cfg), `${c.id}: fecha de la fuente`).toBe(`el 04-10-2026; la ley autonómica ${c.de}, el 05-10-2026`);
      expect(cfg.fuentes[0].consulta, c.id).toBe("05-10-2026");
      expect(F.limites(cfg).some((l) => /deducciones autonómicas del régimen común/.test(l)), `${c.id}: deducciones autonómicas fuera`).toBe(true);
    }
    expect(cfgDe("estatal", "referencia").fuentes).toEqual(F.territorio("estatal")!.fuentes);
    expect(F.consultaFuentes(cfgDe("estatal", "referencia")), "La referencia conserva una sola fecha").toBe("el 04-10-2026");
    expect(F.consultaFuentes(cfgDe("navarra"))).toBe("el 04-10-2026");
    expect(F.deComunidad(F.comunidad("asturias"))).toBe("del Principado de Asturias");
    expect(F.deComunidad(F.comunidad("baleares"))).toBe("de las Illes Balears");
    expect(F.textos(cfgDe("estatal", "valenciana")).ambito).toMatch(/con la escala autonómica de la Comunitat Valenciana\./);
    expect(F.CCAA.filter((c) => c.minimoAutonomico).map((c) => c.id).join(",")).toBe("andalucia,asturias,baleares,canarias,valenciana,galicia,madrid");
  });

  test("pensión de 28.000 € a los 64 años en cada comunidad (escala estatal + autonómica, menos el mínimo a escala)", () => {
    // Común a todas: 28.000 − 2.000 de gastos = 26.000 de base (sin reducción del art. 20). Parte estatal: 2.982,75 − escala(5.550) 527,25 = 2.455,50.
    const casos: Record<string, number> = {
      andalucia: 4847.45, // 13.000 × 9,5 % + 8.100 × 12 % + 4.900 × 15 % = 2.942; mínimo propio 5.790 × 9,5 % = 550,05 → 2.391,95
      aragon: 4865.1375, // 13.072,50 × 9,5 % + 8.137,50 × 12 % + 4.790 × 15 % = 2.936,8875; 5.550 × 9,5 % = 527,25 → 2.409,6375
      asturias: 4818.406, // 12.450 × 9 % + 5.257,20 × 12 % + 8.292,80 × 14 % = 2.912,356; mínimo propio 6.105 × 9 % = 549,45 → 2.362,906
      baleares: 4896, // 10.000 × 9 % + 8.000 × 11,25 % + 8.000 × 14,25 % = 2.940; a los 64 el mínimo es 5.550 × 9 % = 499,50 → 2.440,50
      canarias: 4761.71, // 13.748 × 9 % + 5.674 × 11,5 % + 6.578 × 14 % = 2.810,75; mínimo propio 5.606 × 9 % = 504,54 → 2.306,21
      cantabria: 4693.75, // 13.000 × 8,5 % + 8.000 × 11 % + 5.000 × 14,5 % = 2.710; 5.550 × 8,5 % = 471,75 → 2.238,25
      "castilla-la-mancha": 4911, // misma escala que el art. 65: 2.982,75 − 527,25 = 2.455,50 (igual que la escala de referencia)
      "castilla-y-leon": 4818.5, // 12.450 × 9 % + 7.750 × 12 % + 5.800 × 14 % = 2.862,50; 5.550 × 9 % = 499,50 → 2.363
      cataluna: 4943.25, // 12.500 × 9,5 % + 9.500 × 12,5 % + 4.000 × 16 % = 3.015; 5.550 × 9,5 % = 527,25 → 2.487,75
      valenciana: 4728.26, // 12.000 × 8,8 % + 10.000 × 11,7 % + 4.000 × 14,6 % = 2.810; mínimo propio 6.105 × 8,8 % = 537,24 → 2.272,76
      extremadura: 4700.875, // 12.450 × 7,75 % + 7.750 × 9,75 % + 4.000 × 16 % + 1.800 × 17,5 % = 2.675,50; 5.550 × 7,75 % = 430,125 → 2.245,375
      galicia: 4779.648725, // 12.985,35 × 9 % + 8.083,25 × 11,65 % + 4.931,40 × 14,9 % = 2.845,158725; mínimo propio 5.789 × 9 % = 521,01 → 2.324,148725
      madrid: 4584.11868, // 13.362,22 × 8,5 % + 5.642,41 × 10,7 % + 6.995,37 × 12,8 % = 2.634,93393; mínimo propio 5.956,65 × 8,5 % = 506,31525 → 2.128,61868
      murcia: 4750.4, // 12.450 × 9,5 % + 7.750 × 11,2 % + 5.800 × 13,3 % = 2.822,15; 5.550 × 9,5 % = 527,25 → 2.294,90
      rioja: 4617.8 // 12.450 × 8 % + 7.750 × 10,6 % + 5.800 × 13,6 % = 2.606,30; 5.550 × 8 % = 444 → 2.162,30
    };
    expect(Object.keys(casos).length).toBe(15);
    for (const [id, esperado] of Object.entries(casos)) {
      const t = M.irpf({ trabajo: 28000, edad: 64, territorio: "estatal", ccaa: id });
      expect(t.baseGeneral, id).toBe(26000);
      expect(t.minimoPersonal, `${id}: la parte estatal conserva el mínimo del art. 57`).toBe(5550);
      cerca(t.total, esperado, 0.01, id);
      expect(calcular({ territorio: "estatal", ccaa: id }).resumen.netoMensual, id).toBeGreaterThan(0);
    }
  });

  test("mínimo autonómico propio a los 65 años (solo en la parte autonómica; la estatal sigue con 6.700 €)", () => {
    // Parte estatal a los 65: 2.982,75 − escala(6.700) 636,50 = 2.346,25.
    const casos: Record<string, [number, number]> = {
      andalucia: [6990, 4624.2], // 5.790 + 1.200 = 6.990 → 6.990 × 9,5 % = 664,05; 2.942 − 664,05 = 2.277,95
      asturias: [7370, 4595.306], // 6.105 + 1.265 = 7.370 → 7.370 × 9 % = 663,30; 2.912,356 − 663,30 = 2.249,056
      baleares: [7370, 4622.95], // lectura AEAT: 6.105 + 1.265 = 7.370 → 663,30; 2.940 − 663,30 = 2.276,70
      canarias: [6768, 4547.88], // 5.606 + 1.162 = 6.768 → 609,12; 2.810,75 − 609,12 = 2.201,63
      valenciana: [7370, 4507.69], // 6.105 + 1.265 = 7.370 → 7.370 × 8,8 % = 648,56; 2.810 − 648,56 = 2.161,44
      galicia: [6988, 4562.488725], // 5.789 + 1.199 = 6.988 → 628,92; 2.845,158725 − 628,92 = 2.216,238725
      madrid: [7190.91, 4369.95658] // 5.956,65 + 1.234,26 = 7.190,91 → 7.190,91 × 8,5 % = 611,22735; 2.634,93393 − 611,22735 = 2.023,70658
    };
    for (const [id, [minimoA, esperado]] of Object.entries(casos)) {
      const t = M.irpf({ trabajo: 28000, edad: 65, territorio: "estatal", ccaa: id });
      expect(t.minimoPersonal, id).toBe(6700);
      cerca(t.minimoAutonomico, minimoA, 1e-9, id);
      cerca(t.total, esperado, 0.01, id);
      expect(plano(t.desglose.general.find((x) => x.clave === "minimo")!.etiqueta), id).toMatch(/estatal 6\.700 € · autonómico/);
    }
    // Desde los 75: Madrid 7.190,91 + 1.502,58 = 8.693,49; Baleares 7.370 + 1.540 = 8.910; Andalucía 6.990 + 1.460 = 8.450.
    cerca(M.irpf({ trabajo: 28000, edad: 75, territorio: "estatal", ccaa: "madrid" }).minimoAutonomico, 8693.49, 1e-9);
    cerca(M.irpf({ trabajo: 28000, edad: 75, territorio: "estatal", ccaa: "baleares" }).minimoAutonomico, 8910, 1e-9);
    cerca(M.irpf({ trabajo: 28000, edad: 76, territorio: "estatal", ccaa: "andalucia" }).minimoAutonomico, 8450, 1e-9);
    // Baleares a los 64: sin incremento, 5.550 como el estatal.
    expect(M.irpf({ trabajo: 28000, edad: 64, territorio: "estatal", ccaa: "baleares" }).minimoAutonomico).toBe(5550);
    const cfgM = cfgDe("estatal", "madrid");
    expect(F.resumenParametros(cfgM).some((l) => plano(l).includes("mínimo propio de la Comunidad de Madrid (art. 56.3): 5.956,65 € (7.190,91 € desde los 65 y 8.693,49 € desde los 75)"))).toBe(true);
    expect(F.limites(cfgM).some((l) => /^La escala autonómica aplicada es la de la Comunidad de Madrid, con su mínimo del contribuyente propio en la parte autonómica/.test(l))).toBe(true);
  });

  test("el mínimo autonómico en la base del ahorro (arts. 56.2, 66 y 76)", () => {
    // Madrid, solo ahorro, 10.000 € a los 60: escala conjunta 6.000 × 19 % + 4.000 × 21 % = 1.980 (990 estatal + 990 autonómica).
    // Estatal: 990 − 5.550 × 9,5 % (527,25) = 462,75. Autonómica: 990 − 5.956,65 × 9,5 % (565,88175) = 424,11825. Total 886,86825.
    cerca(M.irpf({ trabajo: 0, ahorro: 10000, edad: 60, territorio: "estatal", ccaa: "madrid" }).total, 886.86825, 1e-6);
    // Base general 5.682 € y 2.000 € de ahorro, Madrid a los 60. Trabajo 14.900: reducción sobre los 14.900 (art. 20,
    // antes de los 2.000 € de la letra f) = 7.302 − 1,75 × 48 = 7.218 → base 14.900 − 2.000 − 7.218 = 5.682.
    // Estatal: el mínimo 5.550 cabe en la general → 5.682 × 9,5 % − 527,25 = 539,79 − 527,25 = 12,54; ahorro 2.000 × 9,5 % = 190.
    // Autonómica: 5.682 del mínimo propio absorben toda la general (0) y 274,65 pasan al ahorro: 190 − 274,65 × 9,5 % = 163,90825.
    const x = M.irpf({ trabajo: 14900, ahorro: 2000, edad: 60, territorio: "estatal", ccaa: "madrid" });
    cerca(x.baseGeneral, 5682, 1e-9);
    cerca(x.cuotaGeneral, 12.54, 1e-6);
    cerca(x.cuotaAhorro, 190 + 163.90825, 1e-6);
    cerca(x.total, 366.44825, 1e-6);
    // Con la escala de referencia el mismo caso da 12,54 × 2 + 2.000 × 19 % = 405,08.
    cerca(M.irpf({ trabajo: 14900, ahorro: 2000, edad: 60, territorio: "estatal" }).total, 405.08, 1e-9);
    cerca(M.irpf({ trabajo: 0, ahorro: 10000, edad: 60, territorio: "estatal" }).total, 925.5, 1e-9);
  });
});

describe("La voz del asesor", () => {
  /* El simulador de origen hablaba de tú a quien se jubila. Aquí lo usa un asesor, y lo que el motor escribe
     —avisos, límites, textos del territorio— habla del cliente. */
  const DE_TU = /\b(tu|tus|te|ti|tienes|tendr[áí]as|cobras|cobrar[áí]s|aportaste|pagaste|eliges|retiras|puedes|pagar[íi]as)\b/i;

  test("ni los textos del territorio, ni los límites, ni los avisos hablan de tú", () => {
    for (const [territorio, ccaa] of [["bizkaia"], ["alava"], ["gipuzkoa"], ["navarra"], ["estatal", "referencia"], ["estatal", "madrid"]] as const) {
      const cfg = cfgDe(territorio, ccaa);
      const T = F.textos(cfg);
      const frases = [
        ...Object.values(T).filter((valor): valor is string => typeof valor === "string"),
        ...T.bloqueRenta.flatMap((opcion) => [opcion.t, opcion.d]),
        ...F.limites(cfg),
        ...F.resumenParametros(cfg),
        ...F.opcionesCapital(cfg, { contingencia: "jubilacion", primerCobro: true, dosAnios: true, epsvDesglose: "certificado" }, { pre: 1, post: 1, preRent: 0, postRent: 0, ratio: 0 }, 1).flatMap((op) => [op.titulo, op.sub])
      ];
      for (const frase of frases) expect(frase, `${territorio}: «${frase}»`).not.toMatch(DE_TU);
    }
    const avisos = [
      ...M.avisos({ edad: 70, edadJubilacion: 60, edadFin: 50, pension: 0, ...SIN_AHORROS }),
      ...M.avisos({ tieneEpsv: true, epsvPre: 10, epsvPreRent: 20 })
    ];
    expect(avisos.length).toBeGreaterThanOrEqual(4);
    for (const aviso of avisos) expect(aviso).not.toMatch(DE_TU);
    for (const entrada of [{ territorio: null }, { territorio: "marte" }, { territorio: "estatal", ccaa: "atlantida" }]) {
      const r = M.calcular(entrada);
      expect(r.disponible === false && r.mensaje).not.toMatch(DE_TU);
    }
  });
});
