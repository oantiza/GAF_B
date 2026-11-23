/**
 * Los dos informes PDF del gestor, leídos del papel: se generan con la demostración, en dos
 * periodos y con y sin asesor, y se afirma sobre el texto impreso, no sobre el código que lo
 * escribe. Cada PDF queda en `output/gestor/` para mirarlo página a página.
 */
import { describe, expect, test } from "vitest";
import { crearInformePdf } from "../../src/gestor/informes";
import { importe, rentabilidad } from "../../src/core/formato";
import { cifraDeMetrica, motivoDeMetrica, nombreDeMetrica, precioNetoDeCostes } from "../../src/gestor/informes/secciones/comun";
import type { DatosDelInforme } from "../../src/gestor/informes/tipos";
import { METRICAS, metrica, type Metrica } from "../../src/gestor/motor/metricas/registro";
import { datosDeLaDemo, datosSencillos, datosVacios, logotipoDePrueba, paginasDe, plano } from "./informesAyudas";

const ASESOR: DatosDelInforme["asesor"] = { nombre: "Laura Asesora Ejemplo", entidad: "Asesores Independientes Ejemplo, EAF", contacto: "laura@ejemplo.test · 600 000 000", logotipo: logotipoDePrueba() };

/*
 * Las cifras, escritas con el módulo común (`src/core/formato.ts`) como las escribe ahora el informe: antes, con el
 * formato propio del gestor (`gestor/informes/formato.ts`), que daba lo mismo salvo el «+» de las rentabilidades
 * (ahora siempre), el punto de millar fuera del euro y «pp» en lugar de «p.p.».
 */
const euros = (valor: number) => plano(importe(valor) ?? "");
const conSigno = (valor: number) => plano(importe(valor, { conSigno: true }) ?? "");
/** Lo que se imprime de una métrica: su cifra o, si no la tiene, su motivo. */
const deMetrica = (m: Metrica, datos: DatosDelInforme) => plano(cifraDeMetrica(m, datos.analisis) ?? motivoDeMetrica(m, datos.analisis));

/** Toda hoja lleva su pie con su número y ninguna enseña un hueco de código. */
function hojasEnOrden(paginas: string[]) {
  paginas.forEach((pagina, i) => {
    expect(pagina, `página ${i + 1}`).toContain(`Página ${i + 1} de ${paginas.length}`);
    expect(pagina, `página ${i + 1}`).not.toMatch(/undefined|NaN|\[object|Infinity/);
  });
}

describe("informe del cliente", () => {
  const casos = [
    { nombre: "cliente-inicio", datos: datosDeLaDemo("inicio") },
    { nombre: "cliente-inicio-con-asesor", datos: datosDeLaDemo("inicio", ASESOR) },
    { nombre: "cliente-anio", datos: datosDeLaDemo("anio") },
    { nombre: "cliente-anio-con-asesor", datos: datosDeLaDemo("anio", ASESOR) }
  ];

  for (const { nombre, datos } of casos) {
    test(`${nombre}: se genera, es breve y lleva las cifras del análisis`, async () => {
      const blob = await crearInformePdf("cliente", datos);
      const { bytes, paginas } = await paginasDe(blob, nombre);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(paginas.length).toBeGreaterThanOrEqual(5);
      expect(paginas.length).toBeLessThanOrEqual(12);
      hojasEnOrden(paginas);
      const texto = paginas.join("\n");
      const a = datos.analisis;
      const r = a.rentabilidad!;
      /* Las cifras que se imprimen, escritas como las escribe el informe. */
      const cifras = {
        patrimonio: euros(a.patrimonio),
        resultado: conSigno(r.resultado),
        rentabilidad: plano(rentabilidad(r.twr) ?? ""),
        aportado: euros(r.aportacionesNetas),
        volatilidad: deMetrica(metrica("volatilidad"), datos),
        caida: deMetrica(metrica("maximaCaida"), datos)
      };
      console.log(`[${nombre}] ${paginas.length} páginas`, cifras);
      for (const [clave, cifra] of Object.entries(cifras)) expect(texto, clave).toContain(cifra);
      /* El desglose suma el resultado: la fila de total es la del análisis, y sus tres partes suman al céntimo. */
      const c = a.desglose!.cuadrado;
      const precioNeto = precioNetoDeCostes(c);
      expect(texto).toContain(conSigno(c.resultado));
      expect(texto).toContain(`Variación de precio, neta de comisiones y gastos`);
      expect(texto).toContain(conSigno(precioNeto));
      expect(Math.round((precioNeto + c.ingresos + c.divisa) * 100)).toBe(Math.round(c.resultado * 100));
      /* Sin costes como cifra propia: ni su sección, ni la línea del desglose, ni el glosario. */
      expect(texto).not.toMatch(/^Costes$/m);
      expect(texto).not.toContain("Comisiones y gastos de la cuenta");
      expect(texto).not.toContain("Costes pagados directamente");
      expect(texto).not.toContain("Total de costes");
      expect(texto).not.toContain(euros(a.ingresosYCostes.costesTotales));
      expect(texto).toContain("Los costes de la cartera se detallan en «Costes de la cartera».");
      /* Sin marca de entidad ni jerga. */
      expect(texto).not.toContain("Independent Private Bankers");
      expect(texto).not.toMatch(/\bTWR\b/);
      expect(texto).not.toMatch(/\bTIR\b/);
      expect(texto).not.toContain("Sharpe");
      expect(texto).not.toMatch(/drawdown/i);
      if (datos.asesor) {
        expect(paginas[0]).toContain("Laura Asesora Ejemplo");
        expect(texto).toContain("Asesores Independientes Ejemplo, EAF");
      } else {
        expect(texto).not.toContain("Elaborado por");
      }
      /* Con el mapa del mundo, el PDF tarda alrededor de un segundo solo; con la suite entera en paralelo pasaba de los cinco del defecto. */
    }, 30_000);
  }

  test("la presentación dice el periodo como lo lee una persona", async () => {
    const { paginas } = await paginasDe(await crearInformePdf("cliente", datosDeLaDemo("anio")), "cliente-anio-portada");
    /* MOT-09 y DIR-08: la misma regla que la pantalla, la fecha desde la que se mide (el cierre del año anterior). */
    expect(paginas[0]).toContain("Del 31 de diciembre de 2025 al 13 de noviembre de 2026");
    /* El nombre del documento va ahora en la cabecera de cada hoja, como lo pone la plantilla (antes, «INFORME DE SU CARTERA» en la portada). */
    expect(paginas[0]).toContain("Informe de la cartera");
  });

  test("con la demostración, frente al índice y con los movimientos recortados a los últimos 40", async () => {
    const datos = datosDeLaDemo("inicio");
    const { paginas } = await paginasDe(await crearInformePdf("cliente", datos), "cliente-inicio-secciones");
    const texto = paginas.join("\n");
    expect(texto).toContain("Frente a su referencia");
    expect(texto).toContain(plano(rentabilidad(datos.analisis.referencia!.rentabilidad) ?? ""));
    expect(texto).toMatch(/En el periodo hubo \d+ movimientos; aquí van los 40 últimos/);
  });
});

describe("informe del asesor", () => {
  const casos = [
    { nombre: "asesor-inicio", datos: datosDeLaDemo("inicio") },
    { nombre: "asesor-inicio-con-asesor", datos: datosDeLaDemo("inicio", ASESOR) },
    { nombre: "asesor-anio", datos: datosDeLaDemo("anio") },
    { nombre: "asesor-anio-con-asesor", datos: datosDeLaDemo("anio", ASESOR) }
  ];

  for (const { nombre, datos } of casos) {
    test(`${nombre}: se genera, lleva todas las métricas del registro y la conciliación`, async () => {
      const blob = await crearInformePdf("asesor", datos);
      const { bytes, paginas } = await paginasDe(blob, nombre);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(paginas.length).toBeGreaterThanOrEqual(5);
      expect(paginas.length).toBeLessThanOrEqual(25);
      hojasEnOrden(paginas);
      const texto = paginas.join("\n");
      console.log(`[${nombre}] ${paginas.length} páginas`);
      /* Con el vocabulario del papel («Caída máxima», «Rentabilidad anualizada»); antes, el nombre de la pantalla del gestor. */
      for (const m of METRICAS) expect(texto, m.id).toContain(nombreDeMetrica(m));
      for (const m of METRICAS) expect(texto, `valor de ${m.id}`).toContain(deMetrica(m, datos));
      expect(texto).toContain("Conciliación con el extracto");
      expect(texto).toMatch(/Cuadra: \d+ líneas comprobadas/);
      expect(texto).toContain("Posiciones a la fecha");
      expect(texto).toContain("Posiciones cerradas en el periodo");
      expect(texto).toContain("Bonos");
      /* Todas las posiciones, por su nombre. */
      for (const p of datos.analisis.posiciones) expect(texto).toContain(p.activo.nombre);
    });
  }
});

describe("lo que no procede no se imprime", () => {
  test("sin referencia, sin bonos, sin ventas y sin avisos, esas secciones no aparecen ni por su título", async () => {
    const datos = datosSencillos();
    const a = datos.analisis;
    /* La cartera es la que dice ser. */
    expect(a.referencia).toBeUndefined();
    expect(a.bonos).toEqual([]);
    expect(a.cerradas).toEqual([]);
    expect(a.integridad.avisos).toEqual([]);

    const cliente = (await paginasDe(await crearInformePdf("cliente", datos), "cliente-sencilla")).paginas.join("\n");
    expect(cliente).not.toContain("Frente a su referencia");
    expect(cliente).toContain("Cómo ha ido su cartera");
    /* Sin renta variable que repartir, no hay mapa ni sectores, ni el título de su sección. */
    expect(cliente).not.toContain("Dónde está invertida");

    const asesor = (await paginasDe(await crearInformePdf("asesor", datos), "asesor-sencilla")).paginas.join("\n");
    expect(asesor).not.toContain("Posiciones cerradas en el periodo");
    expect(asesor).not.toMatch(/\bBonos\b/);
    expect(asesor).not.toMatch(/\bAvisos\b/);
    expect(asesor).not.toContain("Referencia:");
    expect(asesor).not.toContain("Conciliación con el extracto");
    expect(asesor).toContain("Integridad: sin avisos.");
    expect(asesor).toContain("Posiciones a la fecha");
  });

  test("una cartera vacía no lanza y dice que no hay datos", async () => {
    const datos = datosVacios();
    const cliente = await paginasDe(await crearInformePdf("cliente", datos), "cliente-vacia");
    const asesor = await paginasDe(await crearInformePdf("asesor", datos), "asesor-vacia");
    for (const { paginas } of [cliente, asesor]) {
      hojasEnOrden(paginas);
      expect(paginas.join("\n")).toContain("todavía no tiene movimientos: no hay cifras que enseñar");
      expect(paginas.length).toBeLessThanOrEqual(2);
    }
    expect(cliente.paginas.join("\n")).not.toContain("Cómo ha ido su cartera");
    /* El del asesor sigue enumerando las métricas, con su motivo (con el nombre del papel, `nombreDeMetrica`). */
    for (const m of METRICAS) expect(asesor.paginas.join("\n")).toContain(nombreDeMetrica(m));
  });
});
