/**
 * A-205 (decisión de Óscar del 21-11-2026): el precio de una posición de un extracto de posiciones, en su divisa.
 *
 * El extracto de Andbank trae el precio de mercado en la divisa del activo («Precio de mercado» con «Div») y, aparte, el
 * contravalor en euros, hecho con el cambio que aplicó el banco. Hasta ahora el precio se deducía del contravalor con el
 * cambio del día que usa el gestor, y la posición heredaba el cambio del banco. Ahora se guarda el precio en su divisa, con
 * esa divisa al lado, y se valora con él. Un fichero de antes, sin ese precio, se lee y se valora como antes.
 *
 * La cartera: 100 acciones en dólares que entran a 90 $ el 02-01-2026. El dólar, a 1,125 por euro el 02-01 y a 1,10 el
 * 05-01. El extracto del 05-01 declara un precio de 99,55 $ y un contravalor de 9.000 € (el banco usó 9.955 / 9.000 =
 * 1,10611 $ por euro).
 *
 *   con el precio en su divisa:  99,55 $; 100 × 99,55 / 1,10 = 9.955 / 1,10 = 9.050,00 €
 *   sin él (como antes):         9.000 × 1,10 / 100 = 99,00 $; 100 × 99 / 1,10 = 9.000,00 €
 *
 * Cada cifra esperada sale de esas cuentas, no del motor. La pantalla, con la misma cartera, en
 * `precioDelExtractoEnSuDivisaPantalla.test.tsx`.
 */
import { describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import { ErrorDeFormato, VERSION_ACTUAL, leer, serializar } from "../../src/gestor/almacen/formato";
import { crearExcel, crearInformePdf } from "../../src/gestor/informes";
import type { DatosDelInforme } from "../../src/gestor/informes/tipos";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import { posicionesPorActivo } from "../../src/gestor/motor/integridad";
import type { ExtractoDeclarado, PosicionDeclarada } from "../../src/gestor/motor/modelo";
import { FUENTE, valorar } from "../../src/gestor/motor/valoracion";
import { cartera } from "./ayudas";
import { paginasDe } from "./informesAyudas";
import { ANTERIOR, DIA, ISIN, MERCADO, NUEVA, U, conPosicion } from "./precioDelExtractoEnSuDivisaDatos";

describe("la valoración", () => {
  it("con el precio en su divisa vale ese precio: 99,55 $ y 9.050,00 €", () => {
    const v = valorar(NUEVA, MERCADO, { hasta: DIA });
    const k = v.indice.get(DIA)!;
    expect(v.porActivo.get("U")!.precio[k]).toBeCloseTo(99.55, 10);
    expect(v.porActivo.get("U")!.fuente[k]).toBe(FUENTE.extracto);
    expect(v.valor[k]).toBeCloseTo(9050, 8);
    /* El día 2, con el precio de la entrada: 100 × 90 / 1,125 = 8.000 €. */
    expect(v.valor[0]).toBeCloseTo(8000, 8);
  });

  it("sin él —la forma de antes—, el precio sale del contravalor como hasta ahora: 99,00 $ y 9.000,00 €", () => {
    const v = valorar(ANTERIOR, MERCADO, { hasta: DIA });
    const k = v.indice.get(DIA)!;
    expect(v.porActivo.get("U")!.precio[k]).toBeCloseTo(99, 10);
    expect(v.valor[k]).toBeCloseTo(9000, 8);
  });

  it("un precio en otra divisa que la del activo no se usa: vuelve al contravalor", () => {
    const enEuros = conPosicion({ activoId: "U", nombre: "Accion americana", titulos: "100", valor: "9000", precio: "90.5", divisa: "EUR" });
    const v = valorar(enEuros, MERCADO, { hasta: DIA });
    expect(v.porActivo.get("U")!.precio[v.indice.get(DIA)!]).toBeCloseTo(99, 10);
  });

  it("vale aunque el extracto no dé el contravalor", () => {
    const soloPrecio = conPosicion({ activoId: "U", nombre: "Accion americana", titulos: "100", precio: "99.55", divisa: "USD" });
    const v = valorar(soloPrecio, MERCADO, { hasta: DIA });
    expect(v.valor[v.indice.get(DIA)!]).toBeCloseTo(9050, 8);
  });
});

describe("el fichero de la cartera", () => {
  /* Un fichero de la versión 1 escrito antes de A-205, pegado como texto: su posición no tiene precio ni divisa. */
  const FICHERO_ANTERIOR = `{
  "formato": "gestor-carteras",
  "version": 1,
  "guardado": "2026-11-20T10:00:00.000Z",
  "cartera": {
    "id": "cartera-anterior",
    "nombre": "Cartera de antes",
    "divisaBase": "EUR",
    "creada": "2026-01-01T00:00:00.000Z",
    "modificada": "2026-11-20T10:00:00.000Z",
    "cuentas": { "efectivo": { "nombre": "Cuenta de efectivo" }, "valores": { "nombre": "Cuenta de valores" } },
    "activos": [{ "id": "U", "nombre": "Accion americana", "tipo": "ACCION", "divisa": "USD", "isin": "${ISIN}", "origen": "manual" }],
    "movimientos": [{ "id": "m1", "tipo": "entradaDeTitulos", "fechaOperacion": "2026-01-02", "activoId": "U", "titulos": "100", "precio": "90" }],
    "preciosManuales": [],
    "extractos": [
      {
        "id": "e1",
        "fecha": "${DIA}",
        "posiciones": [{ "activoId": "U", "isin": "${ISIN}", "nombre": "Accion americana", "titulos": "100", "valor": "9000" }],
        "efectivo": []
      }
    ],
    "importaciones": []
  }
}
`;

  it("sigue en la versión 1: los dos campos son opcionales y el lector conserva lo que no conoce", () => {
    expect(VERSION_ACTUAL).toBe(1);
  });

  it("uno de antes se lee igual y se valora como hasta ahora: 99,00 $ y 9.000,00 €", () => {
    const leida = leer(FICHERO_ANTERIOR);
    expect(leida.versionOriginal).toBe(1);
    expect(leida.migrada).toBe(false);
    const posicion = leida.cartera.extractos[0].posiciones[0];
    expect(posicion.precio).toBeUndefined();
    expect(posicion.divisa).toBeUndefined();
    const v = valorar(leida.cartera, MERCADO, { hasta: DIA });
    expect(v.porActivo.get("U")!.precio[v.indice.get(DIA)!]).toBeCloseTo(99, 10);
    expect(v.valor[v.indice.get(DIA)!]).toBeCloseTo(9000, 8);
  });

  it("uno nuevo guarda el precio y su divisa detrás del valor, y se lee igual que se escribió", () => {
    const texto = serializar(NUEVA, "2026-11-21T10:00:00.000Z");
    const sangria = " ".repeat(12);
    expect(texto).toContain([`"titulos": "100",`, `"valor": "9000",`, `"precio": "99.55",`, `"divisa": "USD"`].join(`\n${sangria}`));
    expect(leer(texto).cartera).toEqual(NUEVA);
  });

  it("un precio que no es un decimal, o una divisa que no es un texto, no se abren", () => {
    const conPrecioMalo = FICHERO_ANTERIOR.replace(`"valor": "9000" }`, `"valor": "9000", "precio": "99,55", "divisa": "USD" }`);
    expect(() => leer(conPrecioMalo)).toThrow(ErrorDeFormato);
    expect(() => leer(conPrecioMalo)).toThrow("un precio que no es un número decimal válido");
    const conDivisaMala = FICHERO_ANTERIOR.replace(`"valor": "9000" }`, `"valor": "9000", "precio": "99.55", "divisa": 840 }`);
    expect(() => leer(conDivisaMala)).toThrow("una divisa que no es un texto");
  });
});

describe("una posición en varias filas", () => {
  const extracto = (posiciones: PosicionDeclarada[]): ExtractoDeclarado => ({ id: "e", fecha: DIA, posiciones, efectivo: [] });
  const c = cartera([U], []);

  it("conserva el precio si es el mismo en todas, y lo deja fuera si no", () => {
    const iguales = extracto([
      { activoId: "U", nombre: "A", titulos: "60", valor: "5400", precio: "99.55", divisa: "USD" },
      { activoId: "U", nombre: "A", titulos: "40", valor: "3600", precio: "99.550", divisa: "USD" }
    ]);
    /* 60 + 40 = 100 títulos y 5.400 + 3.600 = 9.000 €; el precio es uno, 99,55 $. */
    expect(posicionesPorActivo(c, iguales)).toEqual([{ activoId: "U", nombre: "A", titulos: "100", valor: "9000", precio: "99.55", divisa: "USD" }]);
    const distintos = extracto([
      { activoId: "U", nombre: "A", titulos: "60", valor: "5400", precio: "99.55", divisa: "USD" },
      { activoId: "U", nombre: "A", titulos: "40", valor: "3600" }
    ]);
    expect(posicionesPorActivo(c, distintos)).toEqual([{ activoId: "U", nombre: "A", titulos: "100", valor: "9000" }]);
  });
});

describe("el Excel y el informe del asesor dicen la misma cifra que la pantalla", () => {
  const plano = (texto: string) => texto.replace(/\s+/g, " ").trim();
  const datos: DatosDelInforme = { analisis: analizar(preparar(NUEVA, MERCADO, new Map(), DIA), { desde: "2026-01-01", hasta: DIA }), cartera: NUEVA, generado: DIA };

  it("el análisis del que leen los tres: 99,55 $ del extracto y 9.050,00 €", () => {
    const [p] = datos.analisis.posiciones;
    expect(p.precio).toBeCloseTo(99.55, 10);
    expect(p.valor).toBeCloseTo(9050, 8);
    expect(p.fuente).toBe(FUENTE.extracto);
  });

  it("el Excel, en la hoja de posiciones", async () => {
    const libro = read(Buffer.from(await (await crearExcel(datos)).arrayBuffer()), { type: "buffer" });
    const [cabecera, fila] = utils.sheet_to_json<unknown[]>(libro.Sheets.Posiciones, { header: 1, raw: true, defval: null }) as [string[], unknown[]];
    const de = (columna: string) => fila[cabecera.indexOf(columna)];
    expect(de("Precio") as number).toBeCloseTo(99.55, 10);
    expect(de("Valor") as number).toBeCloseTo(9050, 8);
    expect(de("Fuente del precio")).toBe("Extracto del banco");
  });

  it("el informe del asesor, en sus posiciones", async () => {
    const { paginas } = await paginasDe(await crearInformePdf("asesor", datos), "asesor-precio-del-extracto-en-su-divisa");
    const todo = plano(paginas.join(" "));
    expect(todo).toContain("99,55");
    expect(todo).toContain("9.050,00 €");
    /* Y no la cifra de antes, la del contravalor del banco. */
    expect(todo).not.toContain("9.000,00 €");
  });
});
