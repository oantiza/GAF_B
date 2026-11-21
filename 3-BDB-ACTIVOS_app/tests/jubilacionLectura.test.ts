/**
 * Lo que la pantalla de Jubilación escribe al motor y lo que lee de él.
 *
 * Dos cosas se vigilan aquí que el motor no puede vigilar por sí solo: que lo que no se ha escrito no llegue como
 * si se hubiera escrito, y que las cuentas que se enseñan —el libro del bruto al neto, las bases, las series de
 * los gráficos— cuadren con las del motor céntimo a céntimo.
 */
import { describe, expect, test } from "vitest";
import { importeTitular } from "../src/core/formato";
import {
  compararFormasDeCobro,
  conservaSuValor,
  datosDeLaSimulacion,
  duracion,
  edadDeAgotamiento,
  edadesSinCobrarEntero,
  frasesDeEscenarios,
  lecturaDeEscenarios,
  lecturaDeLaSupervivencia,
  libroDelPrimerAnio,
  mapaFiscal,
  metodo,
  eurosSinSignoEnCero,
  procedenciaFiscal,
  reglasEnElTiempo,
  repartoConMayorResto,
  respuestaAlMes,
  respuestaDelPrimerAnio,
  serieDeIngresos,
  serieDeSaldos
} from "../src/core/jubilacion/lectura";
import { calcular, DEFECTO, type EntradaDeJubilacion, type ResultadoDisponible } from "../src/core/jubilacion/motor";
import { probabilidadDeLlegar, supervivientes, TABLA_DE_MORTALIDAD } from "../src/core/jubilacion/supervivencia";
import {
  cambiarTerritorio,
  conElCasoDeLaDfb,
  datosDeEjemplo,
  datosVacios,
  entradaDelMotor,
  quedaAlgoDelEjemplo,
  saldosDeLaCartera,
  sinDatosDelCliente,
  totalDeAhorros
} from "../src/core/jubilacion/simulacion";

const BIZKAIA = { territorio: "bizkaia", ccaa: "referencia" };

function resultado(entrada: Partial<EntradaDeJubilacion> = {}): ResultadoDisponible {
  const r = calcular(entrada);
  if (!r.disponible) throw new Error(r.mensaje);
  return r;
}

const CON_EPSV = { tieneEpsv: true, epsvPre: 89000, epsvPreRent: 27000, epsvPost: 11000, epsvPostRent: 3000 } as const;

describe("de lo escrito al motor", () => {
  test("la pantalla abre vacía y sin nada que calcular", () => {
    const vacios = datosVacios();
    expect(sinDatosDelCliente(vacios)).toBe(true);
    expect(entradaDelMotor(vacios)).toEqual({ entrada: null, falta: "Falta la edad del cliente.", supuestos: [] });
    expect(quedaAlgoDelEjemplo(vacios)).toBe(false);
    /* Las hipótesis y la residencia sí llevan valor: son del asesor y de la casa, y están a la vista. */
    expect(vacios.territorio).toBe("bizkaia");
    expect([vacios.rentabilidad, vacios.inflacion, vacios.edadFin]).toEqual([3, 2, 95]);
  });

  test("la edad del caso por defecto del motor no se cuela cuando falta la del cliente", () => {
    const soloPension = { ...datosVacios(), pension: 1800 };
    expect(entradaDelMotor(soloPension).entrada).toBeNull();
    expect(sinDatosDelCliente(soloPension)).toBe(false);
    const sinJubilar = { ...datosVacios(), edad: 58, jubilado: false, pension: 1800 };
    expect(entradaDelMotor(sinJubilar)).toMatchObject({ entrada: null, falta: "Falta la edad a la que se jubilará el cliente." });
    expect(entradaDelMotor({ ...sinJubilar, edadJubilacion: 66 }).entrada).toMatchObject({ edad: 58, edadJubilacion: 66 });
  });

  test("un importe sin escribir no cuenta, y no arrastra los del caso por defecto", () => {
    const { entrada, supuestos } = entradaDelMotor({ ...datosVacios(), edad: 67, pension: 1500 });
    expect(supuestos).toEqual([]);
    expect(entrada).toMatchObject({ edad: 67, edadJubilacion: 67, pension: 1500, liquidez: 0, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0, seguros: 0 });
    const r = resultado(entrada!);
    expect(r.base.saldoInicial).toBe(0);
    expect(r.anio1.retiradaAhorros).toBe(0);
    expect(duracion(r).clase).toBe("sin-ahorros");
  });

  test("sin el coste de adquisición se calcula con el coste igual al valor, y se dice", () => {
    const datos = { ...datosVacios(), edad: 65, pension: 2000, fondos: 100000, acciones: 50000, accionesCoste: 40000 };
    const { entrada, supuestos } = entradaDelMotor(datos);
    expect(entrada).toMatchObject({ fondos: 100000, fondosCoste: 100000, acciones: 50000, accionesCoste: 40000 });
    expect(supuestos).toHaveLength(1);
    expect(supuestos[0]).toContain("Falta el coste de adquisición de los fondos de inversión");
    expect(supuestos[0]).not.toContain("acciones");
    expect(supuestos[0]).toContain("sale por lo bajo");
    /* Y es verdad que sale por lo bajo: con el coste real, que es menor, el IRPF del primer año es mayor. */
    const conCoste = resultado({ ...entrada!, fondosCoste: 60000 });
    expect(conCoste.anio1.impuesto).toBeGreaterThan(resultado(entrada!).anio1.impuesto);
    /* Un coste escrito, aunque sea cero, es un coste: no se avisa. */
    expect(entradaDelMotor({ ...datos, fondosCoste: 0 }).supuestos).toEqual([]);
    expect(entradaDelMotor({ ...datos, fondosCoste: 0 }).entrada?.fondosCoste).toBe(0);
  });

  test("el ahorro anual solo cuenta mientras quedan años hasta la jubilación", () => {
    const datos = { ...datosVacios(), edad: 60, pension: 2000, ahorroAnual: 6000 };
    expect(entradaDelMotor(datos).entrada?.ahorroAnual).toBe(0);
    expect(entradaDelMotor({ ...datos, jubilado: false, edadJubilacion: 67 }).entrada?.ahorroAnual).toBe(6000);
  });

  test("el ejemplo es el caso de regresión del motor, y se sabe mientras quede algo de él", () => {
    const ejemplo = datosDeEjemplo(BIZKAIA);
    expect(resultado(entradaDelMotor(ejemplo).entrada!).resumen.netoMensual).toBeCloseTo(resultado(DEFECTO).resumen.netoMensual, 9);
    expect(resultado(entradaDelMotor(ejemplo).entrada!).resumen.netoMensual).toBeCloseTo(2575.58228, 4);
    expect(entradaDelMotor(ejemplo).supuestos).toEqual([]);
    expect(totalDeAhorros(ejemplo)).toBe(200000);
    expect(quedaAlgoDelEjemplo(ejemplo)).toBe(true);
    expect(quedaAlgoDelEjemplo({ ...ejemplo, pension: 1750 })).toBe(true);
    expect(quedaAlgoDelEjemplo({ ...ejemplo, pension: 1750, liquidez: 10000, fondos: 80000, acciones: null })).toBe(false);
    /* El ejemplo conserva la residencia que estuviera elegida. */
    expect(datosDeEjemplo({ territorio: "navarra", ccaa: "referencia" }).territorio).toBe("navarra");
  });

  test("el caso práctico de la DFB reproduce las bases que publica la Hacienda Foral", () => {
    const caso = conElCasoDeLaDfb({ ...datosVacios(), edad: 65 });
    expect(caso).toMatchObject({ territorio: "bizkaia", ejemplo: "dfb", epsvCobro: "capital", epsvPre: 89000, epsvPost: 11000 });
    const c = resultado(entradaDelMotor(caso).entrada!).capital!;
    // Régimen transitorio: 100.000 × 62/70 = 88.571,43 al 60 %. Régimen 2026: 70.000 × 70 % = 49.000 al trabajo y 30.000 al ahorro.
    expect(c.transitorio!.bases.detalle.tramoPre).toBeCloseTo(88571.43, 2);
    expect(c.nuevo!.bases.general).toBeCloseTo(49000, 6);
    expect(c.nuevo!.bases.ahorro).toBeCloseTo(30000, 6);
    expect(quedaAlgoDelEjemplo(caso)).toBe(true);
    expect(quedaAlgoDelEjemplo({ ...caso, epsvPre: 50000, epsvPost: 20000 })).toBe(false);
  });

  test("cambiar de modelo fiscal vacía la previsión; cambiar entre territorios del mismo modelo, no", () => {
    const conEpsv = { ...datosDeEjemplo(BIZKAIA), ...CON_EPSV, epsvCobro: "mixto" as const };
    expect(cambiarTerritorio(conEpsv, "gipuzkoa")).toMatchObject({ territorio: "gipuzkoa", tieneEpsv: true, epsvPre: 89000, epsvCobro: "mixto" });
    const enNavarra = cambiarTerritorio(conEpsv, "navarra");
    expect(enNavarra).toMatchObject({ territorio: "navarra", tieneEpsv: false, epsvPre: null, epsvPreRent: null, epsvCobro: "renta" });
    /* Lo que no es de la previsión se queda. */
    expect(enNavarra).toMatchObject({ pension: 2000, fondos: 100000, ejemplo: "inicial" });
    expect(cambiarTerritorio(enNavarra, "estatal", "madrid")).toMatchObject({ territorio: "estatal", ccaa: "madrid" });
    expect(cambiarTerritorio(enNavarra, "estatal").ccaa).toBe("referencia");
    /* El caso de la DFB solo existe en Bizkaia: al salir de ella deja de ser un ejemplo cargado. */
    const caso = conElCasoDeLaDfb({ ...datosVacios(), edad: 65 });
    expect(cambiarTerritorio(caso, "alava")).toMatchObject({ territorio: "alava", tieneEpsv: false, epsvPre: null, ejemplo: null });
  });
});

describe("los saldos de la cartera activa", () => {
  const activos = [
    { asset_id: "F1", instrument_type: "FUND" as const },
    { asset_id: "F2", instrument_type: "FUND" as const },
    { asset_id: "E1", instrument_type: "ETF" as const },
    { asset_id: "S1", instrument_type: "STOCK" as const },
    { asset_id: "I1", instrument_type: "INDEX" as const }
  ];

  test("cada posición va a la casilla de su envoltorio fiscal, por su peso sobre el capital", () => {
    const posiciones = [
      { asset_id: "F1", weight_percent: 40 },
      { asset_id: "F2", weight_percent: 20 },
      { asset_id: "E1", weight_percent: 25 },
      { asset_id: "S1", weight_percent: 15 }
    ];
    expect(saldosDeLaCartera(posiciones, activos, 300000)).toEqual({ fondos: 180000, acciones: 120000, pesoSinClasificar: 0, pesoTotal: 100 });
  });

  test("no normaliza ni clasifica lo que no conoce: lo dice", () => {
    const posiciones = [
      { asset_id: "F1", weight_percent: 50 },
      { asset_id: "I1", weight_percent: 10 },
      { asset_id: "NO-ESTA", weight_percent: 20 }
    ];
    const saldos = saldosDeLaCartera(posiciones, activos, 100000);
    expect(saldos).toEqual({ fondos: 50000, acciones: 0, pesoSinClasificar: 30, pesoTotal: 80 });
    /* El 20 % que la cartera no reparte y el 30 % sin clasificar no aparecen en ninguna casilla. */
    expect(saldos.fondos + saldos.acciones).toBe(50000);
  });
});

describe("lo que se lee del resultado", () => {
  test("el libro del primer año cuadra: bruto, menos cuotas, más deducciones, igual al neto", () => {
    for (const entrada of [{}, { territorio: "navarra" }, { territorio: "estatal", ccaa: "madrid" }, { ...CON_EPSV }, { pension: 0 }, { pension: 600, ...{ liquidez: 0, fondos: 0, acciones: 0 } }]) {
      const r = resultado(entrada);
      const libro = libroDelPrimerAnio(r);
      const entra = libro.filter((l) => !l.total && ["pension", "ahorros", "prevision"].includes(l.clave)).reduce((s, l) => s + l.anual, 0);
      const bruto = libro.find((l) => l.clave === "bruto")!;
      const neto = libro.find((l) => l.clave === "neto")!;
      expect(entra).toBeCloseTo(bruto.anual, 6);
      expect(bruto.anual).toBeCloseTo(r.anio1.bruto, 9);
      const movimientos = libro.filter((l) => !l.total && !["pension", "ahorros", "prevision"].includes(l.clave)).reduce((s, l) => s + l.signo * l.anual, 0);
      expect(bruto.anual + movimientos).toBeCloseTo(neto.anual, 6);
      expect(neto.anual).toBeCloseTo(r.anio1.neto, 9);
      expect(libro.at(-1)!.clave).toBe("neto");
      expect(libro.every((l) => l.anual >= 0)).toBe(true);
    }
  });

  test("una pensión que no paga impuesto lo dice, en vez de dejar el libro sin fila de IRPF", () => {
    const libro = libroDelPrimerAnio(resultado({ pension: 600, liquidez: 0, fondos: 0, acciones: 0 }));
    expect(libro.map((l) => l.clave)).toEqual(["pension", "bruto", "sin-irpf", "neto"]);
    expect(libro.find((l) => l.clave === "sin-irpf")).toMatchObject({ anual: 0, nota: "Las rentas del año no llegan a pagar impuesto" });
  });

  test("las tres bases recogen todo lo cobrado, y sus cuotas dan el impuesto", () => {
    const r = resultado({ ...CON_EPSV, epsvRenta: "temporal" });
    const mapa = mapaFiscal(r);
    const [general, ahorro, exento] = mapa.bloques;
    expect(mapa.bloques.map((b) => b.clave)).toEqual(["general", "ahorro", "exento"]);
    expect(general.cuota! + ahorro.cuota! - (mapa.deducciones?.anual ?? 0)).toBeCloseTo(mapa.total, 6);
    expect(mapa.total).toBeCloseTo(r.anio1.impuesto, 9);
    expect(mapa.sobreElBruto).toBeCloseTo(r.anio1.impuesto / r.anio1.bruto, 12);
    /* Renta de 15 años en Bizkaia: la rentabilidad de la EPSV queda exenta y no aparece en el ahorro. */
    expect(exento.partidas.map((p) => p.concepto)).toContain("EPSV: rentabilidad exenta");
    expect(ahorro.partidas.map((p) => p.concepto)).not.toContain("EPSV: rentabilidad");
    expect(general.partidas[0]).toMatchObject({ concepto: "Pensión pública", anual: r.anio1.pension });
    /* Lo que entra en renta —sin contar reducciones ni pasos del cálculo— es lo cobrado en bruto más los intereses no retirados. */
    const rentas = (b: (typeof mapa.bloques)[number]) => b.partidas.filter((p) => !p.resta && !p.intermedia).reduce((s, p) => s + p.anual, 0);
    expect(rentas(general) + rentas(ahorro) + rentas(exento)).toBeCloseTo(r.anio1.bruto + r.anio1.interes, 4);
  });

  test("sin rentas del ahorro ni capital que retirar, cada bloque dice que está vacío", () => {
    const mapa = mapaFiscal(resultado({ liquidez: 0, fondos: 0, acciones: 0 }));
    expect(mapa.bloques[1]).toMatchObject({ vacio: "Sin rentas en esta base este año.", partidas: [] });
    expect(mapa.bloques[2]).toMatchObject({ vacio: "Nada este año.", partidas: [] });
    /* Antes de los 65 no hay deducción por edad, y se dice cuándo empieza. */
    expect(mapaFiscal(resultado({ edad: 62, edadJubilacion: 62, pension: 0, liquidez: 0, fondos: 0, acciones: 0, ...CON_EPSV })).sinDeducciones).toBe(
      "La deducción por edad se aplica desde el año en que se cumplen 65 años."
    );
  });

  test("la serie de ingresos reparte el bruto de cada año sin perder un euro", () => {
    for (const entrada of [{}, { ...CON_EPSV }, { ...CON_EPSV, epsvCobro: "mixto" as const }, { territorio: "estatal", ccaa: "cataluna", edad: 58, edadJubilacion: 66 }]) {
      const r = resultado(entrada);
      for (const unidades of ["hoy", "nominal"] as const) {
        const serie = serieDeIngresos(r, unidades);
        expect(serie).toHaveLength(r.entrada.aniosPlan);
        serie.forEach((p, i) => {
          expect(p.pension + p.ahorros + p.prevision + p.irpf).toBeCloseTo(p.bruto, 6);
          expect(p.pension + p.ahorros + p.prevision).toBeCloseTo(p.neto, 6);
          expect(p.edad).toBe(r.entrada.edadJubilacion + i);
        });
      }
      const hoy = serieDeIngresos(r, "hoy")[0];
      expect(hoy.neto).toBeCloseTo(r.resumen.netoMensual / r.resumen.deflactor1, 9);
      expect(serieDeIngresos(r, "nominal")[0].neto).toBeCloseTo(r.resumen.netoMensual, 9);
    }
  });

  test("la serie de saldos empieza en el patrimonio de la jubilación y acaba donde acaba cada escenario", () => {
    const r = resultado({ edad: 60, edadJubilacion: 65 });
    const saldos = serieDeSaldos(r, "hoy");
    expect(saldos).toHaveLength(r.entrada.aniosPlan + 1);
    expect(saldos[0].edad).toBe(65);
    expect(saldos.at(-1)!.edad).toBe(95);
    /* En la jubilación todos los escenarios parten de lo mismo, en euros de hoy: cinco años de IPC descontados. */
    for (const e of r.escenarios) expect(saldos[0][e.clave]).toBeCloseTo(r.base.saldoInicial / 1.02 ** 5, 6);
    expect(saldos.at(-1)!.base).toBeCloseTo(0, 0);
    expect(saldos.at(-1)!.optimista).toBeGreaterThan(1000);
    expect(saldos.at(-1)!.conservador).toBe(0);
    expect(serieDeSaldos(r, "nominal")[0].base).toBeCloseTo(r.base.saldoInicial, 9);
    /* Sin el escenario de mal comienzo, su línea no existe. */
    expect("estres" in serieDeSaldos(resultado({ estres: false }), "hoy")[0]).toBe(false);
  });

  test("cada escenario se lee en una línea, con su hipótesis", () => {
    const lectura = lecturaDeEscenarios(resultado(), "hoy");
    expect(lectura.map((e) => e.clave)).toEqual(["conservador", "base", "optimista", "estres"]);
    expect(lectura.map((e) => e.hipotesis)).toEqual(["1,5\u00a0% al año", "3,0\u00a0% al año", "4,5\u00a0% al año", "−12\u00a0% y −5\u00a0% los dos primeros años; después, 3,0\u00a0%"]);
    expect(lectura[0].resultado).toBe("Se agotan a los 89 años");
    expect(lectura[1].resultado).toBe("Llegan justo a los 95 años");
    expect(lectura[2].resultado).toMatch(/^Llegan a los 95 años y sobran [\d.]+\s€$/);
    expect(lectura[1].cobertura).toBeCloseTo(1, 9);
    expect(lectura[0].cobertura).toBeLessThan(1);
    expect(lecturaDeEscenarios(resultado({ liquidez: 0, fondos: 0, acciones: 0 }), "hoy").every((e) => e.resultado === "Sin ahorros")).toBe(true);
  });

  test("cuánto dura: las cuatro frases", () => {
    expect(duracion(resultado())).toMatchObject({ clase: "llega", edad: 95, titulo: "Los ahorros duran hasta los 95 años" });
    expect(duracion(resultado({ estrategia: "conservar" }))).toMatchObject({ clase: "se-mantiene", edad: null });
    expect(duracion(resultado({ liquidez: 0, fondos: 0, acciones: 0 }))).toMatchObject({ clase: "sin-ahorros", edad: null });
    /* Una renta temporal de 15 años se acaba antes que el plan: el patrimonio se agota a los 80. */
    const temporal = resultado({ pension: 0, liquidez: 0, fondos: 0, acciones: 0, tieneEpsv: true, epsvPost: 100000, epsvRenta: "temporal" });
    expect(duracion(temporal)).toMatchObject({ clase: "se-agota", edad: 80, titulo: "Los ahorros se agotan a los 80 años" });
  });

  /* Auditoría 16-11-2026 (JUB-5). Las cifras salen de una cuenta a mano: sin rentabilidad ni inflación, 100.000 € en
     fondos para diez años son 10.000 € al año. Con el mal comienzo: 100.000 × 0,88 = 88.000, menos 10.000 = 78.000;
     78.000 × 0,95 = 74.100, menos 10.000 = 64.100; y después, sin rentabilidad, 54.100, 44.100, 34.100, 24.100, 14.100
     y 4.100 al cierre del octavo año. El noveno, el de los 73, solo quedan 4.100 € para pagar 10.000. */
  const SIN_RENTABILIDAD = { ...BIZKAIA, edad: 65, edadJubilacion: 65, pension: 0, liquidez: 0, depositos: 0, acciones: 0, seguros: 0, tieneEpsv: false, rentabilidad: 0, inflacion: 0, estres: true, estrategia: "consumir" } as const;

  test("la edad de agotamiento es la del primer año que no se cobra entero, no la del siguiente", () => {
    const r = resultado({ ...SIN_RENTABILIDAD, edadFin: 75, fondos: 100000, fondosCoste: 100000 });
    const estres = r.escenarios.find((e) => e.clave === "estres")!;
    expect(estres.filas[7]).toMatchObject({ edad: 72, retiradaAhorros: 10000 });
    expect(estres.filas[7].saldo).toBeCloseTo(4100, 6);
    expect(estres.filas[8].edad).toBe(73);
    expect(estres.filas[8].previsto).toBeCloseTo(10000, 6);
    expect(estres.filas[8].retiradaAhorros).toBeCloseTo(4100, 6);
    /* El motor sigue diciendo 74, como el de NUVIA; lo que se escribe es el año en que ya no llega. */
    expect(estres.edadAgotado).toBe(74);
    expect(edadDeAgotamiento(estres)).toBe(73);
    expect(lecturaDeEscenarios(r, "hoy").find((e) => e.clave === "estres")).toMatchObject({ resultado: "Se agotan a los 73 años", edadAgotado: 73 });
    /* La hipótesis llega justo: su último año se cobra entero. */
    expect(edadDeAgotamiento(r.base)).toBeNull();
    expect(duracion(r)).toMatchObject({ clase: "llega", edad: 75 });
  });

  test("si es el último año del plan el que se queda corto, también se dice", () => {
    /* 50.000 € para cinco años: 44.000 − 10.000 = 34.000; 32.300 − 10.000 = 22.300; 12.300; 2.300; y el quinto año, el de
       los 69, quedan 2.300 € para pagar 10.000. Antes se leía «Llegan justo a los 70 años». */
    const r = resultado({ ...SIN_RENTABILIDAD, edadFin: 70, fondos: 50000, fondosCoste: 50000 });
    const estres = r.escenarios.find((e) => e.clave === "estres")!;
    expect(estres.filas[4].edad).toBe(69);
    expect(estres.filas[4].retiradaAhorros).toBeCloseTo(2300, 6);
    expect(estres.agotado).toBeNull();
    expect(edadDeAgotamiento(estres)).toBe(69);
    expect(lecturaDeEscenarios(r, "hoy").find((e) => e.clave === "estres")!.resultado).toBe("Se agotan a los 69 años");
  });

  /* Decisión A-168 (JUB-6). Sin rentabilidad ni inflación: 100.000 € de EPSV en renta constante hasta los 75 son
     10.000 € al año. Con el mal comienzo la EPSV queda en 88.000 − 10.000 = 78.000; 74.100 − 10.000 = 64.100; y
     después 54.100, 44.100, 34.100, 24.100, 14.100 y 4.100 al cierre del octavo año. El noveno, el de los 73, solo
     quedan 4.100 € para pagar 10.000. La liquidez no cae con el mercado: sigue pagando lo suyo. */
  const EPSV_QUE_SE_ACABA = { ...SIN_RENTABILIDAD, edadFin: 75, fondos: 0, liquidez: 100000, tieneEpsv: true, epsvPre: 0, epsvPost: 100000, epsvCobro: "renta", epsvRenta: "vitalicia" } as const;

  test("si la EPSV se acaba antes que los ahorros, la frase lo dice", () => {
    /* Viviendo de lo que rinden, con rentabilidad cero no se retira nada de los ahorros: los 100.000 € llegan enteros. */
    const r = resultado({ ...EPSV_QUE_SE_ACABA, estrategia: "conservar" });
    const estres = r.escenarios.find((e) => e.clave === "estres")!;
    expect(estres.filas[8]).toMatchObject({ edad: 73 });
    expect(estres.filas[8].retiradaEpsv).toBeCloseTo(4100, 6);
    expect(edadesSinCobrarEntero(r, estres)).toEqual({ prevision: 73, ahorros: null });
    const lectura = lecturaDeEscenarios(r, "hoy").find((e) => e.clave === "estres")!;
    expect(lectura.resultado).toBe("Llegan a los 75 años y sobran 100.000 €; la EPSV se agota a los 73");
    expect(lectura).toMatchObject({ edadAgotado: null, edadSinPrevision: 73, edadSinAhorros: null });
    /* En la hipótesis no falta nada, y no se añade nada. */
    expect(lecturaDeEscenarios(r, "hoy").find((e) => e.clave === "base")).toMatchObject({ edadSinPrevision: null, edadSinAhorros: null });
    expect(frasesDeEscenarios(r, "hoy")!.find((f) => f.clave === "estres")!.seAgota).toBe(true);
  });

  test("y si después se acaba todo, se dicen las dos edades; en territorio común es el plan de pensiones", () => {
    /* Gastando los ahorros, 100.000 € de liquidez son 10.000 € al año y se acaban justo a los 75. El último año, el de
       los 74, la EPSV ya no paga nada: no se cobra entero. */
    const r = resultado(EPSV_QUE_SE_ACABA);
    expect(lecturaDeEscenarios(r, "hoy").find((e) => e.clave === "estres")!.resultado).toBe("Se agotan a los 74 años; la EPSV, ya a los 73");
    const comun = resultado({ ...EPSV_QUE_SE_ACABA, estrategia: "conservar", territorio: "estatal", ccaa: "referencia" });
    expect(lecturaDeEscenarios(comun, "hoy").find((e) => e.clave === "estres")!.resultado).toBe("Llegan a los 75 años y sobran 100.000 €; el plan de pensiones se agota a los 73");
  });

  test("una renta temporal que termina cuando estaba previsto no cuenta como agotada antes de tiempo", () => {
    const temporal = resultado({ ...SIN_RENTABILIDAD, edadFin: 85, fondos: 0, liquidez: 100000, tieneEpsv: true, epsvPre: 0, epsvPost: 100000, epsvCobro: "renta", epsvRenta: "temporal", epsvAniosRenta: 15, estrategia: "conservar" });
    expect(edadesSinCobrarEntero(temporal, temporal.base)).toEqual({ prevision: null, ahorros: null });
  });

  test("la renta vitalicia se dice aproximada donde se elige y entre los datos de la simulación (JUB-3)", () => {
    for (const territorio of ["bizkaia", "estatal"]) {
      const r = resultado({ territorio, ccaa: "referencia", ...CON_EPSV, epsvRenta: "vitalicia", edadFin: 90 });
      const opcion = r.textos.bloqueRenta.find((o) => o.v === "vitalicia")!;
      expect(opcion.t).toBe("Renta vitalicia (aproximada)");
      expect(opcion.d).toContain("cuantía constante hasta la edad del plan, donde se acaba");
      expect(datosDeLaSimulacion(r).map(([, valor]) => valor).join(" | ")).toContain("renta vitalicia, aproximada con una cuantía constante hasta los 90 años");
    }
  });

  test("fuera del País Vasco una renta temporal puede durar menos de quince años (JUB-4)", () => {
    expect(resultado({ territorio: "estatal", ccaa: "referencia", ...CON_EPSV, epsvRenta: "temporal", epsvAniosRenta: 5 }).entrada.epsvAniosRenta).toBe(5);
    expect(resultado({ territorio: "navarra", ...CON_EPSV, epsvRenta: "temporal", epsvAniosRenta: 1 }).entrada.epsvAniosRenta).toBe(2);
    /* En el modelo vasco los quince años son el requisito de la exención, y siguen siendo el mínimo. */
    expect(resultado({ ...BIZKAIA, ...CON_EPSV, epsvRenta: "temporal", epsvAniosRenta: 5 }).entrada.epsvAniosRenta).toBe(15);
    /* Cinco años de 100.000 € sin rentabilidad son 20.000 € al año, y el sexto ya no hay cobro. */
    const cinco = resultado({ territorio: "estatal", ccaa: "referencia", edad: 65, edadJubilacion: 65, edadFin: 75, pension: 0, liquidez: 0, depositos: 0, fondos: 0, acciones: 0, seguros: 0, tieneEpsv: true, epsvPre: 0, epsvPost: 100000, epsvCobro: "renta", epsvRenta: "temporal", epsvAniosRenta: 5, rentabilidad: 0, inflacion: 0 });
    expect(cinco.base.filas.slice(0, 6).map((f) => Math.round(f.retiradaEpsv))).toEqual([20000, 20000, 20000, 20000, 20000, 0]);
  });

  test("en los territorios forales las reglas del IRPF se actualizan con el IPC, y en territorio común se quedan fijas (A-159)", () => {
    /* Solo pensión, entre los 66 y los 74 años: mismas reglas por edad. La pensión, 2.000 € × 14 = 28.000 €, sube con el IPC.
       En Bizkaia, con las reglas de 2026: 28.000 − 3.000 de bonificación = 25.000; 18.080 × 23 % + 6.920 × 28 % = 6.096;
       menos 1.615 de minoración y 196,50 de deducción por edad = 4.284,50 €. Con las reglas actualizadas, ese es el
       impuesto de todos los años en euros de hoy: la misma pensión real paga lo mismo. */
    const SOLO_PENSION = { liquidez: 0, fondos: 0, acciones: 0 } as const;
    const real = (f: ResultadoDisponible["base"]["filas"][number]) => f.impuesto / f.deflactor;
    const bizkaia = resultado({ ...SOLO_PENSION, inflacion: 2 });
    expect(bizkaia.escalasConElIpc).toBe(true);
    expect(real(bizkaia.base.filas[1])).toBeCloseTo(4284.5, 6);
    expect(real(bizkaia.base.filas[9])).toBeCloseTo(4284.5, 6);
    /* Y en euros de cada año sube lo que el IPC: nueve años al 2 %. */
    expect(bizkaia.base.filas[9].impuesto).toBeCloseTo(4284.5 * 1.02 ** 9, 6);
    expect(bizkaia.base.filas[9].irpf.minoracion).toBeCloseTo(1615 * 1.02 ** 9, 6);
    expect(bizkaia.base.filas[9].irpf.marginalGeneral).toBe(bizkaia.base.filas[1].irpf.marginalGeneral);
    expect(metodo(bizkaia).noTieneEnCuenta[0]).toBe(
      "Las escalas, las deducciones y los límites del IRPF de 2026 se actualizan cada año con el IPC supuesto, como vienen haciendo las Haciendas forales vascas: es un supuesto. Si un año no se actualizan, el impuesto real sería mayor que el estimado."
    );
    expect(reglasEnElTiempo(bizkaia)).toBe("reglas del IRPF de 2026 actualizadas con el IPC");
    /* Sin inflación no hay nada que actualizar: las dos formas dan lo mismo. */
    const sinIpc = resultado({ ...SOLO_PENSION, inflacion: 0 }).base.filas;
    expect(real(sinIpc[9])).toBeCloseTo(4284.5, 6);

    /* Navarra también, por decisión expresa de Óscar: en euros de hoy paga lo mismo a los 66 que a los 74. La frase dice
       que es un supuesto y que en 2026 no actualizó su escala. */
    const navarra = resultado({ ...SOLO_PENSION, inflacion: 2, territorio: "navarra" });
    expect(navarra.escalasConElIpc).toBe(true);
    expect(real(navarra.base.filas[9])).toBeCloseTo(real(navarra.base.filas[1]), 6);
    expect(real(navarra.base.filas[9])).toBeCloseTo(real(resultado({ ...SOLO_PENSION, inflacion: 0, territorio: "navarra" }).base.filas[9]), 6);
    expect(metodo(navarra).noTieneEnCuenta[0]).toBe(
      "Las escalas, las deducciones y los límites del IRPF de 2026 se actualizan cada año con el IPC supuesto: es un supuesto, y en 2026 Navarra no actualizó su escala. Si un año no se actualizan, el impuesto real sería mayor que el estimado."
    );

    /* En territorio común las reglas siguen fijas en euros nominales: con IPC, la misma pensión real paga cada año más. */
    const fijo = resultado({ ...SOLO_PENSION, inflacion: 2, territorio: "estatal", ccaa: "referencia" });
    expect(fijo.escalasConElIpc).toBe(false);
    expect(real(fijo.base.filas[9])).toBeGreaterThan(real(fijo.base.filas[1]));
    expect(metodo(fijo).noTieneEnCuenta[0]).toBe(
      "Las reglas del IRPF de 2026 se mantienen fijas, en euros nominales, todos los años del plan: si las escalas se actualizan con la inflación, el impuesto real sería menor que el estimado."
    );
    expect(reglasEnElTiempo(fijo)).toBe("reglas del IRPF de 2026 fijas");
    /* Y el motor puede dejarlas fijas también en Bizkaia, que es como calcula el de NUVIA. */
    const comoNuvia = calcular({ ...SOLO_PENSION, inflacion: 2 }, { escalasDelIrpf: "fijas" });
    if (!comoNuvia.disponible) throw new Error(comoNuvia.mensaje);
    expect(comoNuvia.escalasConElIpc).toBe(false);
    expect(real(comoNuvia.base.filas[9])).toBeGreaterThan(real(comoNuvia.base.filas[1]));
  });

  test("antes de jubilarse, el cobro en capital también se calcula con los topes actualizados (A-159)", () => {
    /* Un cliente de 45 que se jubila a los 65, con un IPC del 2 %: veinte años, por 1,02^20. Sin rentabilidad, una EPSV de
       100.000 € aportados antes de 2026 se cobra de una vez. Con las reglas actualizadas, la cuenta es la de hoy con todo
       dividido entre ese factor y el resultado multiplicado por él: el impuesto del cobro es el de cobrar hoy
       100.000 / 1,02^20 euros, por 1,02^20. */
    const factor = 1.02 ** 20;
    const entrada = { ...BIZKAIA, edad: 45, edadJubilacion: 65, edadFin: 85, pension: 0, liquidez: 0, depositos: 0, fondos: 0, acciones: 0, seguros: 0, tieneEpsv: true, epsvPre: 100000, epsvPreRent: 0, epsvPost: 0, epsvPostRent: 0, epsvCobro: "capital", rentabilidad: 0, inflacion: 2 } as const;
    const dentroDeVeinte = resultado(entrada);
    const hoy = resultado({ ...entrada, edad: 65, epsvPre: 100000 / factor });
    expect(dentroDeVeinte.capital!.bruto).toBeCloseTo(100000, 6);
    expect(dentroDeVeinte.capital!.impuesto).toBeCloseTo(hoy.capital!.impuesto * factor, 4);
    expect(dentroDeVeinte.capital!.bases.general).toBeCloseTo(hoy.capital!.bases.general * factor, 4);
  });

  test("los límites que son de una forma de cobro solo se dicen cuando se ha elegido", () => {
    const limites = (entrada: Partial<EntradaDeJubilacion>) => metodo(resultado(entrada)).noTieneEnCuenta.join(" ");
    /* El cálculo es de una persona: se dice siempre, porque el caso normal de un cliente es una pareja. */
    expect(limites({})).toContain("Un solo contribuyente, en declaración individual: no reparte los ahorros con el cónyuge ni cuenta su pensión.");
    expect(limites({})).not.toMatch(/renta vitalicia|cobrado de una vez/);
    expect(limites({ ...CON_EPSV, epsvRenta: "vitalicia" })).toContain("La renta vitalicia se reparte hasta la edad del plan");
    expect(limites({ ...CON_EPSV, epsvRenta: "vitalicia" })).not.toContain("cobrado de una vez");
    /* Todo de una vez: no queda renta que repartir, y lo cobrado va a la liquidez, con sus intereses tributando cada año. */
    expect(limites({ ...CON_EPSV, epsvCobro: "capital", epsvRenta: "vitalicia" })).toContain("Lo cobrado de una vez se suma a la liquidez");
    expect(limites({ ...CON_EPSV, epsvCobro: "capital", epsvRenta: "vitalicia" })).not.toContain("renta vitalicia");
    const capital = resultado({ pension: 0, liquidez: 0, fondos: 0, acciones: 0, ...CON_EPSV, epsvCobro: "capital" });
    /* Y es lo que el motor hace: sin más ahorros que ese cobro, el primer año ya hay intereses en la base del ahorro. */
    expect(capital.anio1.interes).toBeCloseTo(capital.capital!.neto * 0.03, 6);
  });

  test("la liquidez al 0 % con rentabilidad negativa se dice solo cuando pasa (JUB-6 y A-191)", () => {
    const limites = (entrada: Partial<EntradaDeJubilacion>) => metodo(resultado(entrada)).noTieneEnCuenta.join(" ");
    const frase = "Con una rentabilidad negativa, la liquidez y los depósitos rinden un 0 %, antes y después de la jubilación: el efectivo no pierde euros, solo poder de compra, y eso ya lo recoge la inflación.";
    /* Un 3 %: los escenarios rinden 1,5 %, 3 % y 4,5 %, ninguno negativo. */
    expect(limites({ rentabilidad: 3 })).not.toContain(frase);
    /* Un 1 %: la rentabilidad más baja es 1 − 1,5 = −0,5 %, y en ese escenario la liquidez rinde un 0 %. */
    expect(limites({ rentabilidad: 1 })).toContain(frase);
    expect(limites({ rentabilidad: -1 })).toContain(frase);
    /* Sin liquidez ni cobro de una vez, no hay liquidez que rinda nada. */
    expect(limites({ rentabilidad: -1, liquidez: 0, depositos: 0 })).not.toContain(frase);
    expect(limites({ rentabilidad: -1, liquidez: 0, depositos: 0, ...CON_EPSV, epsvCobro: "capital" })).toContain(frase);
  });

  test("la procedencia y los datos de la simulación dicen de dónde sale cada cifra", () => {
    expect(procedenciaFiscal(resultado().cfg)).toBe("IRPF de Bizkaia 2026 · NF 13/2013 · fuentes consultadas el 04-10-2026");
    expect(procedenciaFiscal(resultado({ territorio: "estatal", ccaa: "madrid" }).cfg)).toBe(
      "IRPF estatal (territorio común) 2026 · Ley 35/2006 · Comunidad de Madrid · fuentes consultadas el 04-10-2026; la ley autonómica de la Comunidad de Madrid, el 05-10-2026"
    );
    const datos = Object.fromEntries(datosDeLaSimulacion(resultado({ edad: 60, edadJubilacion: 66, ahorroAnual: 5000, ...CON_EPSV, epsvCobro: "mixto", epsvPctCapital: 30 })));
    expect(datos["Edad actual"]).toBe("60 años");
    expect(datos["Jubilación"]).toBe("A los 66 años");
    expect(datos["Ahorro anual hasta la jubilación"]).toMatch(/^5\.000\s€$/);
    expect(datos["EPSV"]).toMatch(/^100\.000\s€, mixto, 30\s% de una vez · retiradas periódicas$/);
    expect(datos["Rentabilidad e inflación supuestas"]).toBe("3,0\u00a0% y 2,0\u00a0% al año");
    expect(Object.fromEntries(datosDeLaSimulacion(resultado()))["EPSV"]).toBe("No");
    expect(Object.fromEntries(datosDeLaSimulacion(resultado({ territorio: "navarra" })))["Plan de pensiones"]).toBe("No");
  });
});

describe("las formas de cobro, comparadas", () => {
  const entrada: EntradaDeJubilacion = { ...DEFECTO, ...CON_EPSV };

  test("sin previsión no hay nada que comparar", () => {
    expect(compararFormasDeCobro(DEFECTO)).toBeNull();
    expect(compararFormasDeCobro({ ...DEFECTO, tieneEpsv: true })).toBeNull();
    expect(compararFormasDeCobro({ ...entrada, territorio: "marte" })).toBeNull();
  });

  test("son la misma simulación con la forma de cobro cambiada, y nada más", () => {
    const formas = compararFormasDeCobro(entrada)!;
    expect(formas.map((f) => f.forma)).toEqual(["renta", "mixto", "capital"]);
    expect(formas.map((f) => f.elegida)).toEqual([true, false, false]);
    expect(formas[1].nombre).toBe("Mixto: el 50\u00a0% de una vez");
    for (const forma of formas) {
      const r = resultado({ ...entrada, epsvCobro: forma.forma, epsvPctCapital: 50 });
      expect(forma.netoMensual).toBeCloseTo(r.resumen.netoMensual / r.resumen.deflactor1, 9);
      const irpfDeLosAnios = r.base.filas.reduce((s, f) => s + f.impuesto / f.deflactor, 0);
      expect(forma.irpfDelPlan).toBeCloseTo(irpfDeLosAnios + (r.capital ? r.capital.impuesto / r.anio1.deflactor : 0), 6);
      expect(forma.netoDelPlan).toBeCloseTo(r.base.filas.reduce((s, f) => s + f.neto / f.deflactor, 0), 6);
      expect(forma.irpfDelCapital === null).toBe(r.capital === null);
    }
    /* En renta no hay cobro de una vez; en las otras dos, sí, y su impuesto está dentro del total del plan. */
    expect(formas[0].irpfDelCapital).toBeNull();
    expect(formas[2].irpfDelCapital!).toBeGreaterThan(formas[1].irpfDelCapital!);
    expect(formas[2].irpfDelPlan).toBeGreaterThan(formas[2].irpfDelCapital!);
  });

  test("lo cobrado de una vez no se pierde: entra en los ahorros y sale en las retiradas", () => {
    /* Sin rentabilidad, sin inflación y sin más ahorros que la EPSV: lo que el cliente ingresa en todo el plan, más el IRPF, es lo que tenía más su pensión. */
    const plano: EntradaDeJubilacion = { ...entrada, liquidez: 0, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0, rentabilidad: 0, inflacion: 0 };
    const pension = 30 * 28000;
    for (const forma of compararFormasDeCobro(plano)!) {
      expect(forma.netoDelPlan + forma.irpfDelPlan + forma.patrimonioFinal).toBeCloseTo(pension + 100000, 0);
    }
  });

  test("el mixto usa el porcentaje elegido cuando la simulación es mixta", () => {
    const formas = compararFormasDeCobro({ ...entrada, epsvCobro: "mixto", epsvPctCapital: 30 })!;
    expect(formas[1]).toMatchObject({ nombre: "Mixto: el 30\u00a0% de una vez", elegida: true });
    expect(formas[1].netoMensual).toBeCloseTo(resultado({ ...entrada, epsvCobro: "mixto", epsvPctCapital: 30 }).resumen.netoMensual, 9);
  });
});

/* Cada cifra esperada es la que publica el INE en su tabla 27153, función «Supervivientes», año 2024, escrita aquí a
   mano desde la tabla: si una serie del módulo se desplaza una edad o se cruzan dos sexos, estas cuentas no salen. */
describe("cuántos llegan a la edad del plan", () => {
  test("la tabla es la del INE de 2024, de los 40 a los 100 años, y no se sale de ahí", () => {
    expect(TABLA_DE_MORTALIDAD).toMatchObject({ organismo: "INE", tabla: 27153, anio: 2024, edadInicial: 40, edadFinal: 100 });
    expect(supervivientes(40, null)).toBe(98798.558932);
    expect(supervivientes(100, null)).toBe(3852.350259);
    expect(supervivientes(65, "hombre")).toBe(89317.520434);
    expect(supervivientes(65, "mujer")).toBe(94383.74095);
    expect(supervivientes(100, "hombre")).toBe(2148.096225);
    expect(supervivientes(100, "mujer")).toBe(5349.6291);
    expect(supervivientes(39, null)).toBeNull();
    expect(supervivientes(101, "mujer")).toBeNull();
    expect(supervivientes(65.5, "hombre")).toBeNull();
    /* A cada edad quedan menos que a la anterior, y siempre más mujeres que hombres, con el total entre los dos. */
    for (let edad = 40; edad <= 100; edad++) {
      const [h, m, t] = [supervivientes(edad, "hombre")!, supervivientes(edad, "mujer")!, supervivientes(edad, null)!];
      expect(m).toBeGreaterThan(t);
      expect(t).toBeGreaterThan(h);
      if (edad > 40) for (const sexo of ["hombre", "mujer", null] as const) expect(supervivientes(edad, sexo)!).toBeLessThan(supervivientes(edad - 1, sexo)!);
    }
  });

  test("la proporción es supervivientes a la edad del plan entre supervivientes a la de hoy", () => {
    expect(probabilidadDeLlegar(65, 95, "hombre")).toBeCloseTo(10273.40701 / 89317.520434, 12);
    expect(probabilidadDeLlegar(67, 95, "mujer")).toBeCloseTo(21323.535955 / 93331.673637, 12);
    expect(probabilidadDeLlegar(65, 95, null)).toBeCloseTo(16070.297778 / 91851.116129, 12);
    expect(probabilidadDeLlegar(80, 90, "hombre")).toBeCloseTo(27821.829444 / 63835.566998, 12);
    /* Lo que no está en la tabla no se extrapola, y no hay proporción hacia atrás. */
    expect(probabilidadDeLlegar(65, 105, "mujer")).toBeNull();
    expect(probabilidadDeLlegar(39, 95, null)).toBeNull();
    expect(probabilidadDeLlegar(70, 70, null)).toBeNull();
    expect(probabilidadDeLlegar(70, 65, null)).toBeNull();
  });

  test("la frase dice de quiénes habla, y lleva su fuente y lo que no es", () => {
    /* 11,5 % de los hombres de 65, 22,8 % de las mujeres de 67 y 17,5 % de todos los de 65. */
    const hombre = lecturaDeLaSupervivencia(resultado(), "hombre")!;
    expect(hombre.frase).toBe("De cada 100 hombres de 65 años, 12 llegan a cumplir los 95.");
    expect(lecturaDeLaSupervivencia(resultado({ edad: 67, edadJubilacion: 67 }), "mujer")!.frase).toBe("De cada 100 mujeres de 67 años, 23 llegan a cumplir los 95.");
    expect(lecturaDeLaSupervivencia(resultado(), null)!.frase).toBe("De cada 100 personas de 65 años, 17 llegan a cumplir los 95.");
    expect(hombre).toMatchObject({ disponible: true, fuente: "INE, tablas de mortalidad de 2024 · consultadas el 13-11-2026" });
    expect(hombre.limite).toContain("no es una previsión ni un dato del cliente");
    /* 99,7 % de las mujeres de 60 cumplen 61: no se redondea a «100 de cada 100». */
    expect(lecturaDeLaSupervivencia(resultado({ edad: 60, edadJubilacion: 60, edadFin: 61 }), "mujer")!.frase).toBe("De cada 100 mujeres de 60 años, más de 99 llegan a cumplir los 61.");
  });

  /* Auditoría 16-11-2026 (JUB-1). «Vivir de lo que rinden» retira la rentabilidad por encima del IPC: con un 1 % y un IPC del
     3 % no hay nada que retirar, y el capital sin tocar pierde poder de compra. La pantalla decía que «conserva su valor». */
  test("vivir de lo que rinden con una rentabilidad por debajo del IPC: el capital pierde valor, y se dice cuánto", () => {
    /* 65 años, ya jubilado, 200.000 € en liquidez y nada más: no hay fase de ahorro ni impuestos que muevan el saldo. */
    const erosion = resultado({ edad: 65, edadJubilacion: 65, edadFin: 95, liquidez: 200000, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0, rentabilidad: 1, inflacion: 3, estrategia: "conservar" });
    /* Treinta años al 1 % con precios al 3 %: 200.000 × (1,01 / 1,03)^30 = 200.000 × 0,55530 = 111.059 € de hoy. */
    const alFinal = 200000 * Math.pow(1.01 / 1.03, 30);
    expect(Math.round(alFinal)).toBe(111059);
    expect(conservaSuValor(erosion)).toBe(false);
    expect(duracion(erosion)).toEqual({
      clase: "pierde-valor",
      titulo: "El capital pierde valor",
      detalle: `Con una rentabilidad del 1,0\u00a0% y un IPC del 3,0\u00a0% no hay nada que retirar sin tocar el capital, y este pierde poder de compra: de ${eurosSinSignoEnCero(200000)} a ${eurosSinSignoEnCero(alFinal)} de hoy a los 95.`,
      edad: null
    });
    expect(lecturaDeLaSupervivencia(erosion, null)!.consecuencia).toBe("Este plan no gasta el capital, pero con esta hipótesis pierde valor cada año: a esa edad compra menos que hoy.");
  });

  test("con la rentabilidad igual o por encima del IPC, el capital sí se mantiene", () => {
    const igual = resultado({ rentabilidad: 2, inflacion: 2, estrategia: "conservar" });
    expect(conservaSuValor(igual)).toBe(true);
    expect(duracion(igual)).toMatchObject({ clase: "se-mantiene", titulo: "El capital se mantiene" });
    expect(duracion(resultado({ rentabilidad: 3, inflacion: 2, estrategia: "conservar" }))).toMatchObject({ clase: "se-mantiene" });
  });

  test("y lo que significa para el plan depende de si gasta los ahorros", () => {
    expect(lecturaDeLaSupervivencia(resultado(), null)!.consecuencia).toBe("A esa edad este plan ya ha gastado los ahorros.");
    expect(lecturaDeLaSupervivencia(resultado({ estrategia: "conservar" }), null)!.consecuencia).toBe("Este plan conserva el capital, así que no depende de esa edad.");
    expect(lecturaDeLaSupervivencia(resultado({ liquidez: 0, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0 }), null)!.consecuencia).toBeNull();
  });

  test("más allá de los 100 años la tabla no dice nada, y se dice", () => {
    const lejos = lecturaDeLaSupervivencia(resultado({ edadFin: 105 }), "mujer")!;
    expect(lejos.disponible).toBe(false);
    expect(lejos.frase).toBe("La tabla de mortalidad acaba a los 100 años: no dice cuántas personas llegan a cumplir los 105.");
    expect(lejos.consecuencia).toBeNull();
  });
});

describe("la respuesta: una cifra y las pocas líneas que la explican", () => {
  test("de dónde sale el ingreso del primer año y cuánto se queda el IRPF, y cuadra con el libro entero", () => {
    const res = resultado();
    const lineas = respuestaDelPrimerAnio(res);
    expect(lineas.map((l) => [l.clave, l.concepto, l.clase])).toEqual([
      ["pension", "Pensión pública", "origen"],
      ["ahorros", "De los ahorros", "origen"],
      ["bruto", "Ingreso bruto", "suma"],
      ["irpf", "IRPF · 13,9\u00a0% del bruto", "resta"],
      ["neto", "Ingreso neto", "total"]
    ]);
    const de = (clave: string) => lineas.find((l) => l.clave === clave)!.anual;
    /* 2.000 € × 14 de pensión, y la retirada que agota 200.000 € al 3 % en 30 años subiendo con un IPC del 2 %:
       C × (r − i) / (1 − ((1 + i) / (1 + r))^30) = 7.881,99 €. */
    expect(de("pension")).toBe(28000);
    expect(de("ahorros")).toBeCloseTo((200000 * (0.03 - 0.02)) / (1 - (1.02 / 1.03) ** 30), 6);
    expect(de("ahorros")).toBeCloseTo(7881.99, 2);
    /* Lo que entra suma el bruto; menos el IRPF, el neto. Y es el mismo neto y el mismo impuesto del libro entero. */
    expect(de("pension") + de("ahorros")).toBeCloseTo(de("bruto"), 9);
    expect(de("irpf")).toBeLessThan(0);
    expect(de("bruto") + de("irpf")).toBeCloseTo(de("neto"), 9);
    const libro = libroDelPrimerAnio(res);
    expect(de("neto")).toBeCloseTo(libro.at(-1)!.anual, 9);
    expect(-de("irpf")).toBeCloseTo(mapaFiscal(res).total, 9);
    expect(de("neto") / 12).toBeCloseTo(res.resumen.netoMensual, 9);
  });

  test("la previsión cobrada en renta es una línea más, con su nombre; cobrada entera de una vez, no", () => {
    const epsv = { tieneEpsv: true, epsvPre: 60000, epsvPost: 40000 } as const;
    expect(respuestaDelPrimerAnio(resultado({ ...epsv, epsvCobro: "renta" })).map((l) => l.concepto)).toEqual(["Pensión pública", "De los ahorros", "De la EPSV", "Ingreso bruto", expect.stringMatching(/^IRPF · /), "Ingreso neto"]);
    expect(respuestaDelPrimerAnio(resultado({ ...epsv, territorio: "navarra", epsvCobro: "mixto" })).map((l) => l.concepto)).toContain("Del plan de pensiones");
    expect(respuestaDelPrimerAnio(resultado({ ...epsv, epsvCobro: "capital" })).map((l) => l.clave)).not.toContain("prevision");
    /* Solo pensión: una línea de origen, y la suma es ella misma. */
    const soloPension = respuestaDelPrimerAnio(resultado({ liquidez: 0, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0 }));
    expect(soloPension.map((l) => l.clave)).toEqual(["pension", "bruto", "irpf", "neto"]);
    expect(soloPension[0].anual).toBe(soloPension[1].anual);
  });
});

describe("las líneas de la respuesta, al mes y al euro, suman la cifra que se enseña (PLA-21)", () => {
  test("el reparto por el mayor resto da el total y no mueve ninguna partida más de un euro", () => {
    /* 2.333,33 y 656,83: los suelos suman 2.989; falta 1 € para 2.990, y va a la de mayor resto (0,83). */
    expect(repartoConMayorResto([2333.33, 656.83], 2990)).toEqual([2333, 657]);
    /* 2.333,4 + 1.000,4 = 3.333,8 → 3.334: suelos 3.333, falta 1 €; los dos restos son 0,4, va a la primera. */
    expect(repartoConMayorResto([2333.4, 1000.4], 3334)).toEqual([2334, 1000]);
    /* Una sola partida es el total. Sin partidas no hay nada que repartir. */
    expect(repartoConMayorResto([2100], 2100)).toEqual([2100]);
    expect(repartoConMayorResto([], 0)).toEqual([]);
  });

  test("el caso de regresión: 2.333 + 657 = 2.990 de bruto; menos 414 de IRPF, los 2.576 de la cifra", () => {
    const lineas = respuestaAlMes(resultado(), "hoy");
    /*
     * A mano, en euros de hoy y al mes: pensión 28.000 / 12 = 2.333,33; de los ahorros 7.881,99 / 12 = 656,83; bruto
     * 2.990,17; neto 2.575,58 (el del motor, `resumen.netoMensual`). Bruto y neto se redondean al euro: 2.990 y 2.576.
     * Las fuentes se reparten el bruto por el mayor resto: 2.333 y 657. El IRPF es lo que va del bruto al neto:
     * 2.990 − 2.576 = 414 (redondeado suelto eran 415, y 2.990 − 415 = 2.575 no era la cifra que se enseña).
     */
    expect(lineas.map((l) => [l.clave, l.alMes])).toEqual([
      ["pension", 2333],
      ["ahorros", 657],
      ["bruto", 2990],
      ["irpf", -414],
      ["neto", 2576]
    ]);
    const de = (clave: string) => lineas.find((l) => l.clave === clave)!.alMes;
    expect(de("pension") + de("ahorros")).toBe(de("bruto"));
    expect(de("bruto") + de("irpf")).toBe(de("neto"));
  });

  test("cuadra en cualquier caso y en las dos unidades, y ninguna línea se aparta más de un euro de su cifra exacta", () => {
    for (const entrada of [{}, { ...CON_EPSV }, { ...CON_EPSV, epsvCobro: "mixto" as const }, { territorio: "navarra" }, { pension: 600, liquidez: 0, fondos: 0, acciones: 0 }, { edad: 60, edadJubilacion: 67 }]) {
      const res = resultado(entrada);
      for (const unidades of ["hoy", "nominal"] as const) {
        const lineas = respuestaAlMes(res, unidades);
        const mes = 12 * (unidades === "hoy" ? res.anio1.deflactor : 1);
        const de = (clave: string) => lineas.find((l) => l.clave === clave)!.alMes;
        expect(lineas.filter((l) => l.clase === "origen").reduce((s, l) => s + l.alMes, 0)).toBe(de("bruto"));
        expect(de("bruto") + de("irpf")).toBe(de("neto"));
        for (const linea of lineas) expect(Math.abs(linea.alMes - linea.anual / mes)).toBeLessThanOrEqual(1);
        /* Un IRPF de cero es un cero, no un cero negativo. */
        expect(Object.is(de("irpf"), -0)).toBe(false);
      }
    }
  });
});

describe("un cero no lleva signo (PLA-03, INF-13)", () => {
  test("«0 €», nunca «−0 €», aunque el importe sea un cero negativo o menos de medio euro", () => {
    expect(eurosSinSignoEnCero(-0)).toBe("0\u00a0€");
    expect(eurosSinSignoEnCero(-0.3)).toBe("0\u00a0€");
    expect(eurosSinSignoEnCero(0.4)).toBe("0\u00a0€");
    /* Medio euro ya es un euro, y con su signo. */
    expect(eurosSinSignoEnCero(-0.6)).toBe("−1\u00a0€");
    expect(eurosSinSignoEnCero(-414.58)).toBe("−415\u00a0€");
    /* Con decimales, el cero es el de esos decimales. */
    expect(eurosSinSignoEnCero(-0.004, 2)).toBe("0,00\u00a0€");
    expect(eurosSinSignoEnCero(-0.006, 2)).toBe("−0,01\u00a0€");
  });

  test("una pensión que no paga impuesto: la línea del IRPF vale cero, sin signo", () => {
    const lineas = respuestaAlMes(resultado({ pension: 600, liquidez: 0, fondos: 0, acciones: 0 }), "hoy");
    expect(lineas.find((l) => l.clave === "irpf")!.alMes).toBe(0);
    expect(Object.is(lineas.find((l) => l.clave === "irpf")!.alMes, -0)).toBe(false);
  });
});

describe("hasta cuándo llegan los ahorros, en frases", () => {
  test("la hipótesis primero, y lo que se acaba antes de la edad del plan, señalado", () => {
    expect(frasesDeEscenarios(resultado(), "hoy")).toEqual([
      { clave: "base", caso: "Con la hipótesis, un 3,0\u00a0% al año", resultado: "Llegan justo a los 95 años", seAgota: false },
      { clave: "conservador", caso: "Si rinden un 1,5\u00a0% al año", resultado: "Se agotan a los 89 años", seAgota: true },
      { clave: "optimista", caso: "Si rinden un 4,5\u00a0% al año", resultado: expect.stringMatching(/^Llegan a los 95 años y sobran 76\.918\s€$/), seAgota: false },
      { clave: "estres", caso: "Con un mal comienzo: −12\u00a0% y −5\u00a0% los dos primeros años; después, 3,0\u00a0%", resultado: "Se agotan a los 89 años", seAgota: true }
    ]);
    /* Son los mismos resultados de la lectura de escenarios, uno a uno. */
    const lectura = lecturaDeEscenarios(resultado(), "hoy");
    for (const frase of frasesDeEscenarios(resultado(), "hoy")!) expect(frase.resultado).toBe(lectura.find((e) => e.clave === frase.clave)!.resultado);
  });

  test("lo que sobra se dice en las unidades elegidas, y coincide con el último saldo del gráfico en esas unidades", () => {
    const r = resultado();
    const sobra = (frases: ReturnType<typeof frasesDeEscenarios>): string => frases!.find((f) => f.clave === "optimista")!.resultado;
    const deHoy = sobra(frasesDeEscenarios(r, "hoy"));
    const deCadaAnio = sobra(frasesDeEscenarios(r, "nominal"));
    expect(deHoy).not.toBe(deCadaAnio);
    /* Cada frase da el último punto de la serie de saldos en sus unidades, redondeado al euro. */
    expect(deHoy).toBe(`Llegan a los 95 años y sobran ${importeTitular(serieDeSaldos(r, "hoy").at(-1)!.optimista!)}`);
    expect(deCadaAnio).toBe(`Llegan a los 95 años y sobran ${importeTitular(serieDeSaldos(r, "nominal").at(-1)!.optimista!)}`);
    /*
     * La conversión, a mano: el caso por defecto se jubila hoy (65) y el plan dura hasta los 95, treinta cierres de año.
     * El último saldo es de cierre del año 30, así que en euros de hoy se divide por 1,02^30 = 1,811362 (IPC del 2 %).
     * Sobran 76.918 € de hoy (la cifra de la prueba anterior), luego en euros de cada año son 76.918 × 1,811362 ≈ 139.326 €.
     * El margen de 2 € cubre el redondeo al euro de los 76.918 (± 0,5 × 1,81).
     */
    const cifra = (frase: string): number => Number(frase.replace(/^.*sobran\s/, "").replace(/\D/g, ""));
    expect(cifra(deHoy)).toBe(76918);
    expect(Math.abs(cifra(deCadaAnio) - 139326)).toBeLessThanOrEqual(2);
  });

  test("sin el mal comienzo son tres, y sin ahorros no hay nada que contar", () => {
    expect(frasesDeEscenarios(resultado({ estres: false }), "hoy")!.map((f) => f.clave)).toEqual(["base", "conservador", "optimista"]);
    expect(frasesDeEscenarios(resultado({ liquidez: 0, fondos: 0, fondosCoste: 0, acciones: 0, accionesCoste: 0 }), "hoy")).toBeNull();
  });
});
