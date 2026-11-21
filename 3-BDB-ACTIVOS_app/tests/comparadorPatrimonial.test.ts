import { describe, expect, test } from "vitest";
import {
  cifrasDelModo,
  EJEMPLO_PATRIMONIAL,
  filasAMedias,
  hoyEnHoraLocal,
  huellaDeLosDatos,
  primerDiaDelMes,
  quedaAlgoDelEjemplo,
  resultadoPatrimonial,
  type AportacionPatrimonial
} from "../src/core/comparadorPatrimonial";

const AÑO = 365.2425;
const fila = (id: number, date: string, amount: number | null): AportacionPatrimonial => ({ id, date, amount });

describe("la TIR del Comparador patrimonial, con resultados conocidos", () => {
  test("una sola aportación: la TIR es la rentabilidad anualizada, a mano", () => {
    /* 366 días entre las dos fechas, con la convención del módulo de 365,2425 días al año. */
    const resultado = resultadoPatrimonial([fila(1, "2020-01-01", 1000)], 1100, "2021-01-01");
    const anos = 366 / AÑO;
    expect(resultado.capital).toBe(1000);
    expect(resultado.years).toBeCloseTo(anos, 10);
    expect(resultado.tir).toBeCloseTo(Math.pow(1.1, 1 / anos) - 1, 6);
  });

  test("sin ganar nada, la TIR es cero", () => {
    expect(resultadoPatrimonial([fila(1, "2020-01-01", 1000)], 1000, "2024-01-01").tir).toBeCloseTo(0, 6);
  });

  test("perdiendo, la TIR es negativa y se escribe tal cual", () => {
    const resultado = resultadoPatrimonial([fila(1, "2020-01-01", 1000)], 500, "2021-01-01");
    expect(resultado.tir).toBeCloseTo(Math.pow(0.5, AÑO / 366) - 1, 6);
  });

  test("las cifras de siempre siguen saliendo igual: 6,11 % y 5,8 años", () => {
    /* Los flujos con que abría la pantalla, rehechos a mano en la auditoría: 6,109 %. */
    const resultado = resultadoPatrimonial(
      EJEMPLO_PATRIMONIAL.flows.map((flujo) => ({ ...flujo })),
      EJEMPLO_PATRIMONIAL.finalValue,
      EJEMPLO_PATRIMONIAL.finalDate
    );
    expect(resultado.capital).toBe(70000);
    expect(resultado.tir).toBeCloseTo(0.06109, 4);
    expect(resultado.years).toBeCloseTo(5.8, 1);
    expect(resultado.start).toBe("2021-01-15");
    expect(resultado.end).toBe("2026-11-04");
  });

  test("el orden en que se escriben las filas no cambia la cifra", () => {
    const enOrden = resultadoPatrimonial([fila(1, "2021-01-15", 50000), fila(2, "2023-06-15", 20000)], 95000, "2026-11-04");
    const alReves = resultadoPatrimonial([fila(2, "2023-06-15", 20000), fila(1, "2021-01-15", 50000)], 95000, "2026-11-04");
    expect(alReves.tir).toBeCloseTo(enOrden.tir!, 10);
    expect(alReves.start).toBe("2021-01-15");
  });
});

describe("lo que no está no se calcula", () => {
  test("sin valor final no hay TIR, y un cero no lo sustituye", () => {
    const resultado = resultadoPatrimonial([fila(1, "2021-01-15", 50000)], null, "2026-11-04");
    expect(resultado.tir).toBeNull();
    expect(resultado.start).toBe("");
    expect(resultado.capital).toBe(50000);
  });

  test("sin aportaciones completas tampoco", () => {
    for (const filas of [[fila(1, "", null)], [fila(1, "2021-01-15", null)], [fila(1, "", 50000)], [fila(1, "2021-01-15", 0)]]) {
      const resultado = resultadoPatrimonial(filas, 95000, "2026-11-04");
      expect(resultado.tir).toBeNull();
      expect(resultado.start).toBe("");
      expect(resultado.capital).toBe(0);
    }
  });

  test("una fila a medias no cuenta y se dice cuántas hay", () => {
    const filas = [fila(1, "2021-01-15", 50000), fila(2, "", 20000), fila(3, "2023-06-15", null), fila(4, "", null)];
    expect(resultadoPatrimonial(filas, 95000, "2026-11-04").capital).toBe(50000);
    /* La vacía no está a medias: todavía no se ha escrito. */
    expect(filasAMedias(filas)).toBe(2);
  });
});

describe("las fechas que no cuadran", () => {
  test("una aportación posterior a la fecha final no da TIR, y se dice cuál", () => {
    /* `xirr` la calcularía: daba −12,94 % con la aportación de 2025 y la fecha final de 2020. */
    const resultado = resultadoPatrimonial([fila(1, "2025-01-01", 50000)], 100000, "2020-01-01");
    expect(resultado.tir).toBeNull();
    expect(resultado.start).toBe("");
    expect(resultado.posterior).toBe("2025-01-01");
    expect(resultado.capital).toBe(50000);
  });

  test("con varias, nombra la más tardía; y una aportación el mismo día final sí vale", () => {
    expect(
      resultadoPatrimonial([fila(1, "2030-01-01", 1), fila(2, "2031-01-01", 1), fila(3, "2020-01-01", 1)], 10, "2026-01-01").posterior
    ).toBe("2031-01-01");
    const mismoDia = resultadoPatrimonial([fila(1, "2020-01-01", 1000), fila(2, "2021-01-01", 100)], 1200, "2021-01-01");
    expect(mismoDia.posterior).toBeNull();
    expect(mismoDia.tir).not.toBeNull();
  });
});

describe("la consulta del IPC y su huella", () => {
  test("el IPC se pide desde el día 1 del mes de la primera aportación", () => {
    expect(primerDiaDelMes("2021-01-15")).toBe("2021-01-01");
    expect(primerDiaDelMes("2021-01-01")).toBe("2021-01-01");
  });

  test("la huella cambia con cualquier dato que entra en el cálculo", () => {
    const base = huellaDeLosDatos([fila(1, "2021-01-15", 50000)], 95000, "2026-11-04", null);
    expect(huellaDeLosDatos([fila(1, "2021-01-16", 50000)], 95000, "2026-11-04", null)).not.toBe(base);
    expect(huellaDeLosDatos([fila(1, "2021-01-15", 50001)], 95000, "2026-11-04", null)).not.toBe(base);
    expect(huellaDeLosDatos([fila(1, "2021-01-15", 50000)], 40000, "2026-11-04", null)).not.toBe(base);
    expect(huellaDeLosDatos([fila(1, "2021-01-15", 50000)], 95000, "2026-11-05", null)).not.toBe(base);
    expect(huellaDeLosDatos([fila(1, "2021-01-15", 50000)], 95000, "2026-11-04", 2.5)).not.toBe(base);
  });

  test("y no con lo que no entra: una fila a medias, o el orden en que se escribieron", () => {
    const base = huellaDeLosDatos([fila(1, "2021-01-15", 50000), fila(2, "2023-06-15", 20000)], 95000, "2026-11-04", null);
    expect(huellaDeLosDatos([fila(2, "2023-06-15", 20000), fila(1, "2021-01-15", 50000)], 95000, "2026-11-04", null)).toBe(base);
    expect(huellaDeLosDatos([fila(1, "2021-01-15", 50000), fila(2, "2023-06-15", 20000), fila(3, "", 7)], 95000, "2026-11-04", null)).toBe(base);
  });

  test("hoy es el día de quien mira: a las 00:08 del 5 de noviembre es 5, no 4", () => {
    expect(hoyEnHoraLocal(new Date(2026, 10, 5, 0, 8))).toBe("2026-11-05");
    expect(hoyEnHoraLocal(new Date(2026, 0, 1, 23, 59))).toBe("2026-01-01");
  });
});

describe("la franja en un solo modo", () => {
  const comparison = {
    cartera: { valor_final_bruto: 95000, valor_final_neto: 85175, tir_nominal_bruta_pct: 9.61, tir_nominal_neta_pct: 8, tir_real_bruta_pct: 5, tir_real_neta_pct: 4 },
    letras: { valor_final_bruto: 60000, valor_final_neto: 54985, tir_nominal_bruta_pct: 2, tir_nominal_neta_pct: 1, tir_real_bruta_pct: 0, tir_real_neta_pct: -1 },
    deposito: { valor_final_bruto: 58000, valor_final_neto: 53000, tir_nominal_bruta_pct: 1, tir_nominal_neta_pct: 1, tir_real_bruta_pct: 0, tir_real_neta_pct: -1 }
  };
  const comun = { finalValue: 95000, tirLocal: 0.0961, inflacionAnualPct: 4, anos: 2, letrasAproximado: null };

  test("neto: valor, valor real y ventaja salen todos del neto", () => {
    const cifras = cifrasDelModo({ ...comun, comparison, neto: true });
    expect(cifras.modo).toBe("neto");
    expect(cifras.valorFinal).toBe(85175);
    expect(cifras.tirNominal).toBeCloseTo(0.08, 10);
    expect(cifras.tirReal).toBeCloseTo(0.04, 10);
    expect(cifras.valorReal).toBeCloseTo(85175 / 1.04 ** 2, 6);
    expect(cifras.enLetras).toBe(54985);
    expect(cifras.ventaja).toBe(30190);
  });

  test("bruto: todos del bruto", () => {
    const cifras = cifrasDelModo({ ...comun, comparison, neto: false });
    expect(cifras.modo).toBe("bruto");
    expect(cifras.valorFinal).toBe(95000);
    expect(cifras.valorReal).toBeCloseTo(95000 / 1.04 ** 2, 6);
    expect(cifras.ventaja).toBe(35000);
  });

  test("sin cálculo del servidor no hay modo: lo escrito y la TIR local, sin decir que es bruto o neto", () => {
    const cifras = cifrasDelModo({ ...comun, comparison: null, neto: true, inflacionAnualPct: null });
    expect(cifras.modo).toBeNull();
    expect(cifras.valorFinal).toBe(95000);
    expect(cifras.tirNominal).toBeCloseTo(0.0961, 10);
    expect(cifras.tirReal).toBeNull();
    expect(cifras.valorReal).toBeNull();
    expect(cifras.ventaja).toBeNull();
  });
});

describe("el rótulo «Ejemplo»", () => {
  const { flows, finalValue, finalDate } = EJEMPLO_PATRIMONIAL;
  const delEjemplo = flows.map((flujo) => ({ ...flujo }));

  test("sigue mientras quede un dato del ejemplo, aunque se hayan cambiado los otros", () => {
    expect(quedaAlgoDelEjemplo(delEjemplo, finalValue, finalDate)).toBe(true);
    expect(quedaAlgoDelEjemplo(delEjemplo, 120000, "2026-01-01")).toBe(true);
    expect(quedaAlgoDelEjemplo([fila(1, "2019-03-01", 1000)], finalValue, "2026-01-01")).toBe(true);
  });

  test("se va cuando ya no queda ninguno: entonces las cifras son de quien las escribió", () => {
    expect(quedaAlgoDelEjemplo([fila(1, "2019-03-01", 1000)], 120000, "2026-01-01")).toBe(false);
  });
});
