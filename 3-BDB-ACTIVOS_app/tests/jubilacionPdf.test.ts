/**
 * El informe de jubilación que se entrega al cliente. Se afirma sobre lo que sale impreso, no sobre el código que
 * lo escribe: las cifras de la pantalla, las hojas con su pie, y que un ejemplo no pueda salir sin decir que lo es.
 */
import { writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { importeTitular, oFalta } from "../src/core/formato";

import { compararFormasDeCobro, cortesDelEje, lecturaDeLaSupervivencia } from "../src/core/jubilacion/lectura";
import { calcular, DEFECTO, type EntradaDeJubilacion, type ResultadoDisponible } from "../src/core/jubilacion/motor";
import { createJubilacionPdfBlob, type InformeDeJubilacionInput } from "../src/reports/jubilacionPdf";
import { extractPdfPageTexts } from "./support/pdfText";

/** Un importe del informe de Jubilación: en euros enteros, como los escribe la lectura. */
const fmtEur = (valor: number) => oFalta(importeTitular(valor));

function resultado(entrada: Partial<EntradaDeJubilacion> = {}): ResultadoDisponible {
  const r = calcular(entrada);
  if (!r.disponible) throw new Error(r.mensaje);
  return r;
}

/** El espacio duro de los importes, como espacio corriente, para comparar con lo que se lee del papel. */
const plano = (texto: string) => texto.replaceAll(String.fromCharCode(0xa0), " ");

/** Las hojas del informe, leídas del PDF. Con `JUBILACION_QA_DIR` se guarda cada uno para mirarlo. */
async function hojas(nombre: string, input: Partial<InformeDeJubilacionInput> & { resultado: ResultadoDisponible }): Promise<string[]> {
  const blob = await createJubilacionPdfBlob({ unidades: "hoy", formas: null, supuestos: [], ejemplo: false, date: "13 de noviembre de 2026", ...input });
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (process.env.JUBILACION_QA_DIR) await writeFile(`${process.env.JUBILACION_QA_DIR}/${nombre}.pdf`, bytes);
  return extractPdfPageTexts(bytes).map(plano);
}

/** Toda hoja lleva su pie con su número, y ninguna enseña un hueco de código. */
function hojasEnOrden(paginas: string[], documento = "Simulación de jubilación") {
  paginas.forEach((pagina, i) => {
    expect(pagina).toContain(`Página ${i + 1} de ${paginas.length}`);
    /* La cabecera y el pie de cada hoja dicen lo que es: una simulación. Desde la plantilla única (14-11-2026) la cabecera
       lleva el nombre del documento y el sello, y el pie la advertencia; antes, el pie decía «Independent Private Bankers · …». */
    expect(pagina).toContain(documento);
    expect(pagina).toContain("CONFIDENCIAL");
    expect(pagina).toMatch(/simulación/i);
    expect(pagina).not.toContain("Independent Private Bankers");
    expect(pagina).not.toMatch(/undefined|NaN|\[object|N\/D| de el /);
  });
}

describe("informe de jubilación", () => {
  test("cuatro hojas con las cifras de la pantalla, su procedencia y su pie", async () => {
    const res = resultado();
    const paginas = await hojas("bizkaia", { resultado: res, supervivencia: lecturaDeLaSupervivencia(res, "mujer"), clientName: "Cliente de prueba", banker: { name: "Asesor de prueba", email: "" } });
    expect(paginas).toHaveLength(4);
    hojasEnOrden(paginas);
    const [portada, plan, cuentas, comoSeCalcula] = paginas;
    /* El caso de regresión del motor: 2.575,58 netos, 2.990,17 brutos y 414,58 de IRPF al mes. La primera hoja es la respuesta:
       una cifra, las líneas que la explican, el ingreso de cada año y hasta cuándo llegan los ahorros. */
    expect(portada).toContain(plano(fmtEur(2576)));
    expect(portada).toContain("al mes");
    expect(portada).toContain("Pensión pública");
    expect(portada).toContain(plano(fmtEur(2333)));
    expect(portada).toContain("De los ahorros");
    expect(portada).toContain(plano(fmtEur(657)));
    expect(portada).toContain(plano(fmtEur(2990)));
    expect(portada).toContain("IRPF · 13,9 % del bruto");
    /* 414 y no 415: el IRPF es lo que va del bruto al neto ya redondeados, para que las líneas sumen la cifra (PLA-21). */
    expect(portada).toContain(plano(fmtEur(-414)));
    expect(portada).toContain("Cliente de prueba");
    expect(portada).toContain("Asesor de prueba");
    expect(portada).toContain("13 de noviembre de 2026 · Bizkaia · IRPF de Bizkaia 2026");
    expect(portada).toContain("Después del IRPF de Bizkaia. Los ahorros duran hasta los 95 años.");
    expect(portada).toContain("Importes en euros de hoy");
    /* Lo que es, junto a la cifra y junto a los escenarios: una simulación, con rentabilidades elegidas para simular. */
    expect(portada).toMatch(/simulación de jubilación/i);
    /* La frase sigue con «fiscal o de inversión», que pierde su ligadura «fi» al extraer el texto: se mira hasta ahí y su final. */
    expect(portada).toContain("Simulación con los datos de hoy: no es una previsión, una promesa ni asesoramiento");
    expect(portada).toContain("o de inversión. Primer año de jubilación, a los 65 años.");
    expect(portada).toContain("Rentabilidades elegidas para simular, no previstas ni prometidas");
    expect(portada).toContain("De dónde sale el ingreso de cada año");
    expect(portada).toContain("Hasta cuándo llegan los ahorros");
    expect(portada).toContain("Con la hipótesis, un 3,0 % al año");
    expect(portada).toContain("Llegan justo a los 95 años");
    expect(portada).toContain("Si rinden un 1,5 % al año");
    expect(portada).toContain("Se agotan a los 89 años");
    expect(portada).toContain("Con un mal comienzo: −12 % y −5 % los dos primeros años");
    /* Cuántos llegan a la edad del plan, con quién lo dice y con lo que la cifra no es. */
    expect(portada).toContain("De cada 100 mujeres de 65 años, 23 llegan a cumplir los 95. A esa edad este plan ya ha gastado los ahorros.");
    expect(portada).toContain("INE, tablas de mortalidad de 2024 · consultadas el 13-11-2026.");
    expect(portada).toContain("no es una previsión ni un dato del cliente");
    /* Las tablas de impuestos ya no están en la primera hoja: son del anexo. */
    expect(portada).not.toContain("IRPF de la base general");
    expect(portada).not.toContain("Base del ahorro");
    expect(portada).not.toMatch(/ejemplo/i);
    expect(plan).toContain("El plan, año a año");
    expect(plan).toContain("65 años");
    expect(plan).toContain("94 años");
    expect(plan).toContain("Cuánto dura el patrimonio");
    expect(plan).toContain("Mal comienzo");
    expect(plan).toContain("Con qué datos se ha calculado");
    expect(plan).toContain("Hasta los 95 años");
    expect(cuentas).toContain("Las cuentas del primer año");
    expect(cuentas).toContain("Del bruto al neto");
    /* El neto del año: 30.906,99 €. */
    expect(cuentas).toContain(plano(fmtEur(30907)));
    expect(cuentas).toContain("IRPF de la base general");
    expect(cuentas).toContain("Qué tributa y dónde");
    expect(cuentas).toContain("Base general");
    expect(cuentas).toContain("Base del ahorro");
    expect(cuentas).toContain("NF 13/2013 · fuentes consultadas el 04-10-2026");
    expect(cuentas).toContain("IRPF del año");
    expect(cuentas).toContain("Minoración de cuota");
    expect(comoSeCalcula).toContain("Un solo contribuyente, en declaración individual");
    expect(comoSeCalcula).toContain("Lo que no tiene en cuenta");
    /* Bizkaia: las reglas se actualizan con el IPC (A-159). */
    expect(comoSeCalcula).toContain("se actualizan cada año con el IPC supuesto");
    expect(comoSeCalcula).toContain("https://www.bizkaia.eus/");
    expect(comoSeCalcula).toContain("No es una liquidación tributaria");
    expect(comoSeCalcula).toContain("elegidas para simular, que no son una previsión ni una promesa");
    expect(comoSeCalcula).toContain("ni una recomendación de inversión");
    expect(comoSeCalcula).toContain("es un supuesto elegido para simular, no una previsión ni una rentabilidad prometida");
    /* Sin marca de banco y sin cocina. */
    expect(paginas.join(" ")).not.toMatch(/andbank|nuvia|retrocesi[oó]n/i);
  });

  test("un ejemplo no sale sin decir que lo es, en la portada y en el pie de cada hoja", async () => {
    const res = resultado();
    const paginas = await hojas("ejemplo", { resultado: res, supervivencia: lecturaDeLaSupervivencia(res, null), ejemplo: true, clientName: "Da igual" });
    /* Sin sexo indicado, la tabla de ambos sexos. */
    expect(paginas[0]).toContain("De cada 100 personas de 65 años, 17 llegan a cumplir los 95.");
    /* El antetítulo se imprime en versales. */
    expect(paginas[0]).toMatch(/ejemplo · cifras inventadas/i);
    hojasEnOrden(paginas, "Simulación de jubilación · ejemplo");
  });

  test("con EPSV cobrada de una vez, una hoja más tras el plan: las tres formas y los dos regímenes", async () => {
    const entrada: EntradaDeJubilacion = { ...DEFECTO, tieneEpsv: true, epsvPre: 89000, epsvPreRent: 27000, epsvPost: 11000, epsvPostRent: 3000, epsvCobro: "capital" };
    const res = resultado(entrada);
    const paginas = await hojas("epsv-capital", { resultado: res, formas: compararFormasDeCobro(entrada) });
    expect(paginas).toHaveLength(5);
    hojasEnOrden(paginas);
    /* En la portada, el impuesto del cobro de una vez se dice aparte del IRPF del mes. */
    expect(paginas[0]).toContain(`Aparte, el cobro de la EPSV de una vez añade ${plano(fmtEur(res.capital!.impuesto))} al IRPF del primer año`);
    /* La EPSV cobrada entera de una vez no da renta: en las líneas de la respuesta no hay ninguna «De la EPSV». */
    expect(paginas[0]).not.toContain("De la EPSV");
    const cobro = paginas[2];
    expect(cobro).toContain("El cobro de la EPSV");
    expect(cobro).toContain("Lo que queda del cobro de una vez");
    expect(cobro).toContain("Régimen transitorio");
    expect(cobro).toContain("Régimen desde 2026");
    expect(cobro).toContain("aplicado");
    /* Régimen de 2026: 70.000 × 70 % = 49.000 a la base general y 30.000 a la del ahorro. */
    expect(cobro).toContain(plano(fmtEur(49000)));
    expect(cobro).toContain(plano(fmtEur(30000)));
    expect(cobro).toContain(plano(fmtEur(res.capital!.neto)));
    expect(cobro).toContain("En renta, de una vez o parte de cada forma");
    expect(cobro).toContain("Todo de una vez · la elegida");
    expect(cobro).toContain("Mixto: el 50 % de una vez");
    expect(cobro).toContain("Las cifras no dicen cuál conviene");
  });

  test("en Navarra habla de plan de pensiones y cita su norma; en euros de cada año lo dice", async () => {
    const entrada: EntradaDeJubilacion = { ...DEFECTO, territorio: "navarra", edad: 60, edadJubilacion: 66, tieneEpsv: true, epsvPre: 60000, epsvPost: 40000, epsvCobro: "mixto", epsvPctCapital: 40 };
    const paginas = await hojas("navarra-mixto", {
      resultado: resultado(entrada),
      unidades: "nominal",
      formas: compararFormasDeCobro(entrada),
      supuestos: ["Falta el coste de adquisición de los fondos de inversión: se calcula con el coste igual al valor de hoy."]
    });
    expect(paginas).toHaveLength(5);
    hojasEnOrden(paginas);
    const todo = paginas.join(" ");
    expect(todo).toContain("Plan de pensiones");
    expect(todo).toContain("DFL 4/2008");
    expect(todo).toContain("Importes en euros de cada año");
    expect(todo).toContain("Al jubilarse a los 66 años, dentro de 6");
    expect(todo).toContain("Cobro del plan de pensiones");
    expect(todo).toContain("El cobro del plan de pensiones");
    /* La parte que se cobra en renta es una línea más de la respuesta, con su nombre. */
    expect(paginas[0]).toContain("Del plan de pensiones");
    expect(todo).toContain("Falta el coste de adquisición de los fondos de inversión");
    expect(todo).not.toMatch(/\bEPSV\b/);
    /* En Navarra la escala ya es la cuota de la base: no se repite en una fila intermedia. */
    expect(todo).not.toContain("Impuesto según escala");
  });

  describe("lleva lo que la pantalla avisa y lo supuesto de una EPSV sin desglose, con su texto (H2-17, 22-11-2026)", () => {
    const COSTE = "Falta el coste de adquisición de los fondos de inversión, las acciones y ETF: se calcula con el coste igual al valor de hoy. La plusvalía ya acumulada no cuenta, y el IRPF de las retiradas sale por lo bajo.";
    /* El texto se lee del PDF, que pierde las ligaduras «fi» y «fl»: se mira hasta ellas. */
    const ESTIMACION_1 = "Sin desglose, Hacienda Foral de Bizkaia estima la rentabilidad en el 1 % de lo cobrado: un 1 % por año de antigüedad, con un máximo del 35 %, o el 25 % si no se conoce la antigüedad. El simulador la aplica al saldo de hoy; lo que crezca hasta la jubilación cuenta entero como rentabilidad.";
    const TRAMO_1 = "Con un año de antigüedad o menos, la primera aportación puede ser de 2026: el simulador trata el saldo entero como posterior a 2025 y no aplica el régimen transitorio. El certi";

    test("sin desglose y en capital, lo supuesto de la EPSV va en la hoja de su cobro, y la primera hoja sigue cabiendo entera", async () => {
      const entrada: EntradaDeJubilacion = { ...DEFECTO, edad: 55, edadJubilacion: 65, tieneEpsv: true, epsvDesglose: "estimacion", antiguedad: 1, epsvPre: 100000, epsvPost: 0, epsvCobro: "mixto", epsvPctCapital: 50 };
      const res = resultado(entrada);
      const paginas = await hojas("sin-desglose", { resultado: res, formas: compararFormasDeCobro(entrada), supervivencia: lecturaDeLaSupervivencia(res, "mujer"), supuestos: [COSTE] });
      /* Las mismas cinco hojas que con certificado: la respuesta, el plan, el cobro y los dos anexos. */
      expect(paginas).toHaveLength(5);
      hojasEnOrden(paginas);
      expect(paginas[0]).toContain(`Supuestos. ${COSTE}`);
      expect(paginas[0]).not.toContain("Sin desglose");
      expect(paginas[1]).toContain("El plan, año a año");
      expect(paginas[2]).toContain("El cobro de la EPSV");
      expect(paginas[2]).toContain(`Supuestos. ${ESTIMACION_1} ${TRAMO_1}`);
    });

    test("lo que el motor corrige de la entrada va en la primera hoja, como en la pantalla", async () => {
      /* Jubilación a los 60 con 66 años: la pantalla dice que se usa la edad actual. */
      const entrada: EntradaDeJubilacion = { ...DEFECTO, edad: 66, edadJubilacion: 60 };
      const res = resultado(entrada);
      expect(res.avisos).toEqual(["La edad de jubilación no puede ser anterior a la edad actual: se usa la edad actual."]);
      const paginas = await hojas("aviso-del-motor", { resultado: res, supervivencia: lecturaDeLaSupervivencia(res, "mujer"), supuestos: [COSTE] });
      expect(paginas).toHaveLength(4);
      hojasEnOrden(paginas);
      expect(paginas[0]).toContain(`Supuestos. ${COSTE} La edad de jubilación no puede ser anterior a la edad actual: se usa la edad actual.`);
    });

    test("sin la hoja del cobro, lo supuesto de la EPSV va en la primera hoja", async () => {
      const entrada: EntradaDeJubilacion = { ...DEFECTO, edad: 65, edadJubilacion: 65, tieneEpsv: true, epsvDesglose: "estimacion", antiguedad: 10, epsvPre: 100000, epsvPost: 0, epsvCobro: "renta" };
      const paginas = await hojas("sin-desglose-sin-cobro", { resultado: resultado(entrada), formas: null });
      expect(paginas).toHaveLength(4);
      hojasEnOrden(paginas);
      /* Jubilado hoy: sin crecimiento hasta la jubilación, la nota no lo menciona. */
      expect(paginas[0]).toContain(
        "Supuestos. Sin desglose, Hacienda Foral de Bizkaia estima la rentabilidad en el 10 % de lo cobrado: un 1 % por año de antigüedad, con un máximo del 35 %, o el 25 % si no se conoce la antigüedad. El simulador trata el saldo como aportado hasta 2025. Si el cliente ha aportado en 2026, el certi"
      );
    });
  });

  test("solo pensión, con una comunidad autónoma: su ley en las fuentes y sin gráfico que rompa nada", async () => {
    const paginas = await hojas("madrid-solo-pension", { resultado: resultado({ territorio: "estatal", ccaa: "madrid", liquidez: 0, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0 }) });
    expect(paginas).toHaveLength(4);
    hojasEnOrden(paginas);
    const todo = paginas.join(" ");
    expect(todo).toContain("Sin ahorros que retirar");
    expect(todo).toContain("Comunidad de Madrid");
    expect(todo).toContain("la ley autonómica de la Comunidad de Madrid, el 05-10-2026");
    /* Sin ahorros no hay escenarios que contar: la primera hoja no los trae. */
    expect(paginas[0]).not.toContain("Hasta cuándo llegan los ahorros");
  });

  test("un IRPF de cero se imprime «0 €», nunca «−0 €» (INF-13)", async () => {
    /* 600 € × 14 pagas, sin ahorros: ningún año paga impuesto. */
    const paginas = await hojas("sin-irpf", { resultado: resultado({ edad: 66, edadJubilacion: 66, pension: 600, liquidez: 0, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0 }) });
    hojasEnOrden(paginas);
    const todo = paginas.join(" ");
    expect(todo).toContain("IRPF · 0,0 % del bruto");
    expect(todo).not.toMatch(/[−-]0 €/);
  });

  test("un plan largo, de los 55 a los 105 años, sigue cabiendo en sus hojas", async () => {
    const entrada: EntradaDeJubilacion = { ...DEFECTO, edad: 55, edadJubilacion: 55, edadFin: 105, tieneEpsv: true, epsvPre: 200000, epsvPreRent: 80000, epsvPost: 30000, epsvPostRent: 5000, epsvRenta: "vitalicia" };
    const paginas = await hojas("plan-largo", { resultado: resultado(entrada), formas: compararFormasDeCobro(entrada), clientName: "Cliente con un nombre bastante largo para la portada" });
    expect(paginas).toHaveLength(5);
    hojasEnOrden(paginas);
    expect(paginas[1]).toContain("104 años");
  });

  test("los cortes del eje son redondos y cubren el máximo", () => {
    expect(cortesDelEje(2990)).toEqual([0, 1000, 2000, 3000]);
    expect(cortesDelEje(200000)).toEqual([0, 50000, 100000, 150000, 200000]);
    expect(cortesDelEje(1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(cortesDelEje(0)).toEqual([0, 1]);
    for (const maximo of [7, 123, 4567, 89012, 345678, 1234567]) {
      const cortes = cortesDelEje(maximo);
      expect(cortes[0]).toBe(0);
      expect(cortes.at(-1)!).toBeGreaterThanOrEqual(maximo);
      expect(cortes.length).toBeGreaterThanOrEqual(3);
      expect(cortes.length).toBeLessThanOrEqual(7);
    }
  });
});
