/**
 * Una referencia con huecos en su serie no se compara (decisión de Óscar del 20-11-2026; lo que quedaba de GES-5).
 *
 * El índice se arrastra plano donde no tiene dato. Si lo viejo es su punto de partida, su rentabilidad incluye lo que se
 * movió antes del periodo; si el hueco está en medio, su camino —y con él su riesgo— no es el que fue. La regla es la del
 * €STR de la liquidez: dos datos seguidos a más de 7 días naturales, contando el que hace de punto de partida, y no hay
 * comparación; se dice entre qué fechas faltan.
 *
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { read, utils } from "xlsx";
import { crearExcel, crearInformePdf } from "../../src/gestor/informes";
import type { DatosDelInforme } from "../../src/gestor/informes/tipos";
import { HUECO_MAXIMO_DE_LA_REFERENCIA, analizar, preparar } from "../../src/gestor/motor/analisis";
import { metrica } from "../../src/gestor/motor/metricas/registro";
import { HUECO_MAXIMO_DEL_ESTR, serieDeLaReferencia } from "../../src/gestor/motor/referencia";
import { analizarConLaReferencia } from "../../src/gestor/ui/estado/useAnalisisDeCartera";
import type { DatosDeMercado, Punto } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie, serieDiaria } from "./ayudas";
import { paginasDe } from "./informesAyudas";

const TODO = { desde: "1900-01-01", hasta: "2100-01-01" };
const FIN = "2024-02-09";

/* 1.000 € en 10 títulos de A a 100 € el 01-01-2024; A vale 110 € el 09-02: la cartera gana un 10 %. Su serie empieza la
   víspera del primer movimiento, el 31-12-2023, que es desde donde se mide el índice. */
const c = cartera(
  [activo("A")],
  [mov("aportacion", "2024-01-01", { importe: "1000" }), mov("compra", "2024-01-01", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" })]
);
const mercado: DatosDeMercado = { precios: new Map([["A", serie(["2024-01-01", 100], [FIN, 110])]]), cambios: new Map() };
const preparado = preparar(c, mercado, new Map(), FIN);
const conIndice = (puntos: Punto[]) => analizar(preparado, TODO, { nombre: "Índice", serie: puntos }).referencia;

/* El motivo dice el porqué y nada más: entre qué dos datos no hay ninguno, cuántos días van de uno a otro y el máximo. */
const faltan = (desde: string, hasta: string, dias: number) => `El índice no tiene datos entre el ${desde} y el ${hasta}: son ${dias} días, y el máximo para compararlo son 7.`;

describe("el punto de partida del índice no puede ser viejo", () => {
  test("con el último dato anterior al inicio de hace tres meses no hay comparación: antes salía +18 % y la cartera «perdía» 8 puntos", () => {
    /* El índice: 100 el 02-10-2023, y después un dato cada día desde el 05-01 (112) hasta el 09-02 (118). Antes se tomaba
       el 100 de octubre como nivel del 31-12: 118 / 100 − 1 = +18 %, y 10 % − 18 % = −8 puntos, contra un tramo —de
       octubre a enero— que no es del periodo. Del 02-10 al 05-01 van 95 días. */
    const referencia = conIndice([...serie(["2023-10-02", 100]), ...serieDiaria("2024-01-05", FIN, 112, 118)]);
    expect(referencia?.disponible).toBe(false);
    expect(referencia?.rentabilidad).toBeNull();
    expect(referencia?.rentabilidadAnualizada).toBeNull();
    expect(referencia?.diferencia).toBeNull();
    expect(referencia?.serie).toEqual([]);
    expect(referencia?.riesgo).toBeUndefined();
    expect(referencia?.motivo).toBe(faltan("02/10/2023", "05/01/2024", 95));
  });

  test("con el dato de partida de la misma semana se compara: del 29-12 al 05-01 van 7 días", () => {
    /* 100 el 29-12-2023 (dos días antes del inicio) y a diario desde el 05-01 hasta el 09-02 (104): +4 %, y 10 − 4 = 6 puntos. */
    const referencia = conIndice([...serie(["2023-12-29", 100]), ...serieDiaria("2024-01-05", FIN, 100, 104)]);
    expect(referencia?.disponible).toBe(true);
    expect(referencia?.rentabilidad).toBeCloseTo(0.04, 12);
    expect(referencia?.diferencia).toBeCloseTo(0.06, 12);
  });

  test("y un día más, no: del 28-12 al 05-01 van 8 días", () => {
    expect(conIndice([...serie(["2023-12-28", 100]), ...serieDiaria("2024-01-05", FIN, 100, 104)])?.motivo).toBe(faltan("28/12/2023", "05/01/2024", 8));
  });
});

describe("un hueco en medio del periodo", () => {
  /* A diario del 29-12 al 10-01 (100), nada hasta `vuelve`, y a diario hasta el 09-02, que acaba en 105. */
  const conHuecoHasta = (vuelve: string) => conIndice([...serieDiaria("2023-12-29", "2024-01-10", 100, 100), ...serieDiaria(vuelve, FIN, 100, 105)]);

  test("nueve días sin dato, del 10 al 19 de enero: no se compara y se dice entre qué fechas faltan", () => {
    /* Antes salía +5 % (105 / 100 − 1) y una diferencia de +5 puntos, con el índice plano esos nueve días. */
    const referencia = conHuecoHasta("2024-01-19");
    expect(referencia?.disponible).toBe(false);
    expect(referencia?.rentabilidad).toBeNull();
    expect(referencia?.diferencia).toBeNull();
    expect(referencia?.motivo).toBe(faltan("10/01/2024", "19/01/2024", 9));
  });

  test("el corte es de una semana, como en el €STR: 7 días se comparan, 8 no", () => {
    expect(HUECO_MAXIMO_DE_LA_REFERENCIA).toBe(7);
    /* Del 10-01 al 17-01 van 7 días: se compara, +5 % el índice y 10 − 5 = 5 puntos a favor de la cartera. */
    const justo = conHuecoHasta("2024-01-17");
    expect(justo?.disponible).toBe(true);
    expect(justo?.rentabilidad).toBeCloseTo(0.05, 12);
    expect(justo?.diferencia).toBeCloseTo(0.05, 12);
    /* Del 10-01 al 18-01 van 8. */
    expect(conHuecoHasta("2024-01-18")?.motivo).toBe(faltan("10/01/2024", "18/01/2024", 8));
  });

  test("un índice con un dato a la semana se compara: siete días entre datos no son un hueco", () => {
    /* Los viernes del 29-12-2023 al 09-02-2024: siete datos, 100 los seis primeros y 104 el último. +4 %, y 6 puntos. */
    const viernes = ["2023-12-29", "2024-01-05", "2024-01-12", "2024-01-19", "2024-01-26", "2024-02-02", FIN];
    const referencia = conIndice(viernes.map((fecha, i) => ({ fecha, valor: i === viernes.length - 1 ? 104 : 100 })));
    expect(referencia?.disponible).toBe(true);
    expect(referencia?.rentabilidad).toBeCloseTo(0.04, 12);
    expect(referencia?.diferencia).toBeCloseTo(0.06, 12);
  });

  test("se dice el primer hueco, no el mayor", () => {
    /* Dos huecos: del 10-01 al 19-01 (9 días) y del 22-01 al 05-02 (14 días). */
    const referencia = conIndice([...serieDiaria("2023-12-29", "2024-01-10", 100, 100), ...serieDiaria("2024-01-19", "2024-01-22", 100, 100), ...serieDiaria("2024-02-05", FIN, 100, 105)]);
    expect(referencia?.motivo).toBe(faltan("10/01/2024", "19/01/2024", 9));
  });
});

describe("solo cuenta lo que hay entre el punto de partida y el final del periodo", () => {
  test("un hueco anterior al punto de partida no impide comparar", () => {
    /* Un dato suelto de enero de 2022 y, casi dos años después, a diario desde el 29-12-2023: el punto de partida es el del
       31-12, y lo de antes no entra. +4 %, y 6 puntos. */
    const referencia = conIndice([...serie(["2022-01-03", 50]), ...serieDiaria("2023-12-29", FIN, 100, 104)]);
    expect(referencia?.disponible).toBe(true);
    expect(referencia?.rentabilidad).toBeCloseTo(0.04, 12);
    expect(referencia?.diferencia).toBeCloseTo(0.06, 12);
  });

  test("ni uno posterior al último día del periodo", () => {
    /* A diario hasta el 09-02 (104) y el dato siguiente, el 01-06: la cartera está valorada hasta el 09-02. */
    const referencia = conIndice([...serieDiaria("2023-12-29", FIN, 100, 104), ...serie(["2024-06-01", 130])]);
    expect(referencia?.disponible).toBe(true);
    expect(referencia?.rentabilidad).toBeCloseTo(0.04, 12);
  });

  test("si además el índice acaba atrasado, se dice eso: es lo primero que hay que saber", () => {
    /* A diario solo hasta el 10-01: le faltan 30 días hasta el 09-02. */
    expect(conIndice(serieDiaria("2023-12-29", "2024-01-10", 100, 100))?.motivo).toBe("El índice llega hasta el 10/01/2024: está atrasado para este periodo.");
  });
});

describe("la regla vale igual para una cartera de referencia", () => {
  /* La mezcla de una cartera de referencia solo tiene las fechas con dato de sus dos fondos: un hueco en los dos es un
     hueco en ella. Mitad y mitad; los dos fondos valen 100 todos los días y 108 el último. */
  const mezcla = (fondo: Punto[]) => serieDeLaReferencia({ nombre: "Cartera de referencia", base: { rf: fondo, rv: fondo }, pesos: { rf: 0.5, rv: 0.5 } }, "2023-12-31", FIN);
  const conLaMezcla = (fondo: Punto[]) => {
    const lista = mezcla(fondo);
    if (!("serie" in lista)) throw new Error(lista.motivo);
    return analizar(preparado, TODO, lista).referencia;
  };

  test("con los dos fondos a diario se compara: 0,5 × 1,08 + 0,5 × 1,08 = 1,08, +8 %, y 2 puntos a favor de la cartera", () => {
    const referencia = conLaMezcla(serieDiaria("2023-12-29", FIN, 100, 108));
    expect(referencia?.disponible).toBe(true);
    expect(referencia?.rentabilidad).toBeCloseTo(0.08, 12);
    expect(referencia?.diferencia).toBeCloseTo(0.02, 12);
  });

  test("con nueve días sin dato en los dos fondos, no", () => {
    const referencia = conLaMezcla([...serieDiaria("2023-12-29", "2024-01-10", 100, 100), ...serieDiaria("2024-01-19", FIN, 100, 108)]);
    expect(referencia?.disponible).toBe(false);
    expect(referencia?.motivo).toBe(faltan("10/01/2024", "19/01/2024", 9));
  });
});

describe("la misma regla que el €STR de la liquidez", () => {
  test("el plazo es el mismo: si uno cambia, el otro tiene que decidirse a la vez", () => {
    /* La decisión de Óscar fue «la regla que ya tiene el €STR de la liquidez». Son dos constantes, y esta prueba las ata. */
    expect(HUECO_MAXIMO_DE_LA_REFERENCIA).toBe(HUECO_MAXIMO_DEL_ESTR);
  });
});

describe("por el camino de la pantalla: la referencia elegida en la cartera", () => {
  /* `analizarConLaReferencia` es lo que llama la pantalla: recorta el periodo, monta la serie de la referencia y analiza. */
  test("un activo del catálogo con ocho días sin dato no se compara, y con siete sí", () => {
    const conOcho = analizarConLaReferencia(preparado, TODO, { nombre: "Fondo de fuera", serie: [...serieDiaria("2023-12-29", "2024-01-10", 100, 100), ...serieDiaria("2024-01-18", FIN, 100, 105)] }).referencia;
    expect(conOcho?.disponible).toBe(false);
    expect(conOcho?.motivo).toBe(faltan("10/01/2024", "18/01/2024", 8));
    const conSiete = analizarConLaReferencia(preparado, TODO, { nombre: "Fondo de fuera", serie: [...serieDiaria("2023-12-29", "2024-01-10", 100, 100), ...serieDiaria("2024-01-17", FIN, 100, 105)] }).referencia;
    expect(conSiete?.disponible).toBe(true);
    expect(conSiete?.rentabilidad).toBeCloseTo(0.05, 12);
  });

  test("una cartera de referencia con nueve días sin dato en sus dos fondos, tampoco", () => {
    const fondo = [...serieDiaria("2023-12-29", "2024-01-10", 100, 100), ...serieDiaria("2024-01-19", FIN, 100, 108)];
    const referencia = analizarConLaReferencia(preparado, TODO, { nombre: "Cartera de referencia", base: { rf: fondo, rv: fondo }, pesos: { rf: 0.5, rv: 0.5 } }).referencia;
    expect(referencia?.disponible).toBe(false);
    expect(referencia?.motivo).toBe(faltan("10/01/2024", "19/01/2024", 9));
  });
});

describe("un periodo que empieza a mitad de la serie", () => {
  /*
   * El índice tiene un hueco de 9 días, del 10 al 19 de enero, y fuera de él un dato cada día (100 hasta el 8 de febrero,
   * 104 el 9). El periodo se pide con `desde`: se mide desde el cierre de ese día, y el punto de partida del índice es su
   * último dato en o antes de él. La cartera vale 1.000 € todos los días menos el último, que vale 1.100 €: +10 %.
   */
  const indice = [...serieDiaria("2023-12-29", "2024-01-10", 100, 100), ...serieDiaria("2024-01-19", FIN, 100, 104)];
  const desde = (dia: string) => analizar(preparado, { desde: dia, hasta: "2100-01-01" }, { nombre: "Índice", serie: indice }).referencia;

  test("si empieza después del hueco, el hueco no cuenta: se compara", () => {
    /* Desde el 19-01: el punto de partida es el dato de ese día (100), y hasta el 09-02 hay uno cada día. +4 %, y 6 puntos. */
    const referencia = desde("2024-01-19");
    expect(referencia?.disponible).toBe(true);
    expect(referencia?.rentabilidad).toBeCloseTo(0.04, 12);
    expect(referencia?.diferencia).toBeCloseTo(0.06, 12);
  });

  test("si empieza dentro del hueco, el punto de partida es el dato de antes del hueco, y es viejo: no se compara", () => {
    /* Desde el 15-01: el último dato en o antes es el del 10-01, y el siguiente es el del 19-01. Nueve días. */
    const referencia = desde("2024-01-15");
    expect(referencia?.disponible).toBe(false);
    expect(referencia?.motivo).toBe(faltan("10/01/2024", "19/01/2024", 9));
  });

  test("si empieza justo antes del hueco, tampoco", () => {
    expect(desde("2024-01-09")?.motivo).toBe(faltan("10/01/2024", "19/01/2024", 9));
  });
});

describe("lo que esta regla no ve: el primer dato de una cartera de referencia", () => {
  /*
   * Una cartera de referencia llega ya mezclada, con su primer dato fechado en el inicio del periodo aunque el valor de sus
   * fondos sea de hasta 14 días antes (la tolerancia es de la propia mezcla, `core/benchmarkProfiles.ts`). Aquí se deja
   * escrito lo que pasa hoy, para que cambiarlo sea una decisión y no un descuido.
   */
  const mezcla = (fondo: Punto[]) => serieDeLaReferencia({ nombre: "Cartera de referencia", base: { rf: fondo, rv: fondo }, pesos: { rf: 0.5, rv: 0.5 } }, "2023-12-31", FIN);

  test("con el último valor de sus fondos de 14 días antes del inicio se compara; el mismo fondo, como activo, no", () => {
    /* Último dato antes del inicio, el 17-12-2023 (14 días antes del 31-12); después, a diario desde el 02-01 hasta el 09-02 (104). */
    const fondo = [...serie(["2023-12-17", 100]), ...serieDiaria("2024-01-02", FIN, 100, 104)];
    const lista = mezcla(fondo);
    if (!("serie" in lista)) throw new Error(lista.motivo);
    const comoCartera = analizar(preparado, TODO, lista).referencia;
    expect(comoCartera?.disponible).toBe(true);
    expect(comoCartera?.rentabilidad).toBeCloseTo(0.04, 12);
    /* Como activo, del 17-12 al 02-01 van 16 días. */
    expect(conIndice(fondo)?.motivo).toBe(faltan("17/12/2023", "02/01/2024", 16));
  });

  test("con 15 días, la mezcla ya no arranca en el inicio del periodo", () => {
    const lista = mezcla([...serie(["2023-12-16", 100]), ...serieDiaria("2024-01-02", FIN, 100, 104)]);
    if (!("serie" in lista)) return;
    /* Si da serie, no empieza el 31-12: empieza donde los dos fondos tienen dato. */
    expect(lista.serie[0]?.fecha > "2023-12-31").toBe(true);
  });
});

describe("en los informes: la regla es del motor, y los tres dicen por qué no se compara", () => {
  /*
   * La comparación la da el análisis, y cada informe enseña lo que el análisis dice. Con el hueco de 9 días del 10 al 19 de
   * enero, el del asesor y el Excel dan el motivo. El del CLIENTE también desde la decisión A-197 (20-11-2026): su sección
   * «Frente a su referencia» sale igual, sin cifras, y dice qué es la referencia y por qué no se compara. Hasta entonces
   * dejaba de salir sin decirlo, como con una referencia atrasada. La línea del glosario de la diferencia no sale: no hay
   * diferencia que explicar.
   */
  const conHueco = [...serieDiaria("2023-12-29", "2024-01-10", 100, 100), ...serieDiaria("2024-01-19", FIN, 100, 105)];
  const aDiario = serieDiaria("2023-12-29", FIN, 100, 105);
  const datosCon = (puntos: Punto[]): DatosDelInforme => ({ analisis: analizar(preparado, TODO, { nombre: "Índice", serie: puntos }), cartera: c, generado: FIN });
  const MOTIVO = faltan("10/01/2024", "19/01/2024", 9);
  const textoDe = async (tipo: "asesor" | "cliente", datos: DatosDelInforme, nombre: string) =>
    (await paginasDe(await crearInformePdf(tipo, datos), nombre)).paginas.join("\n").split(/\s+/).join(" ");

  test("el del asesor dice por qué no se compara", async () => {
    const texto = await textoDe("asesor", datosCon(conHueco), "asesor-con-una-referencia-con-hueco");
    expect(texto).toContain(`No se puede comparar: ${MOTIVO}`);
    /* Y no da ninguna cifra de la comparación: antes, +5,00 % el índice y +5,00 pp a favor de la cartera (10 % − 5 %). */
    expect(texto).not.toContain("+5,00 pp");
    /* Con un dato cada día sí la da, y no dice que no se pueda comparar. */
    const aDiarioDelAsesor = await textoDe("asesor", datosCon(aDiario), "asesor-con-una-referencia-a-diario");
    expect(aDiarioDelAsesor).toContain("+5,00 pp");
    expect(aDiarioDelAsesor).not.toContain("No se puede comparar");
  });

  test("el del cliente saca «Frente a su referencia» y dice por qué no compara, sin cifras; con el índice a diario, compara", async () => {
    const sin = await textoDe("cliente", datosCon(conHueco), "cliente-con-una-referencia-con-hueco");
    expect(sin).toContain("Frente a su referencia");
    expect(sin).toContain(`La referencia de esta cartera es Índice. En este periodo no se puede comparar con ella. ${MOTIVO}`);
    expect(sin).toContain("Cuando los tenga, este informe la comparará.");
    /* Ni la comparación ni su línea del glosario: no hay cifras que dar. */
    expect(sin).not.toContain("Se compara con");
    expect(sin).not.toContain("Frente a la referencia");
    expect(sin).not.toContain("puntos porcentuales");
    /* Con un dato cada día: la sección, con qué se compara, y la línea del glosario. La cartera, +10 %; el índice, +5 %. */
    const con = await textoDe("cliente", datosCon(aDiario), "cliente-con-una-referencia-a-diario");
    expect(con).toContain("Frente a su referencia");
    expect(con).toContain("Se compara con Índice.");
    expect(con).toContain("Frente a la referencia");
    expect(con).toContain("En este periodo la cartera ha rendido 5,00 puntos porcentuales más que su referencia.");
  });

  test("el Excel da el motivo en el lugar de la cifra", async () => {
    const libro = read(Buffer.from(await (await crearExcel(datosCon(conHueco))).arrayBuffer()), { type: "buffer" });
    const resumen = utils.sheet_to_json<unknown[]>(libro.Sheets.Resumen, { header: 1, raw: true, defval: null }) as unknown[][];
    const fila = resumen.find((f) => f[0] === metrica("diferenciaConLaReferencia").nombre)!;
    expect(fila[1]).toBe(MOTIVO);
  });
});
