/**
 * El tema del papel. Hasta el 14-11-2026 esta prueba exigía que el papel copiara los tokens de la pantalla; ese día Óscar pidió
 * recuperar el aspecto de los informes de antes, y el papel vuelve a tener su paleta propia: la de `CLIENT_REPORT_PALETTE` del
 * commit 8da9cb9d, con el granate en el tema de cliente y el acero azul del papel interno de antes en el interno. Lo que sigue
 * fijado contra la pantalla son los dos colores con signo y, desde el 15-11-2026, los colores de cada clase de activo y el gris
 * del resto (Óscar: «que coincidan»): un resultado o una clase se leen igual en la pantalla y en el papel. Y se miden los contrastes: al menos 4,5:1 sobre blanco para todo lo que es texto, y 3:1 para filetes y rellenos con
 * información.
 *
 * Desde el 18-11-2026 el gris del resto ya no se copia de la pantalla. La dirección A cambió allí los colores de clase y aclaró
 * el del resto hasta una piedra (`#B3AC9E`) que sobre blanco da 2,26:1, por debajo del 3:1 de aquí abajo. Óscar vio el informe de
 * muestra dibujado de tres maneras y eligió: renta fija, renta variable y liquidez siguen a la pantalla; «Otros» y lo sin
 * clasificar se quedan con el gris azulado que el papel copió el 15-11 (apartado 14.3 de `docs/frontend/SISTEMA_DISENO.md`).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { colorDeLaClase } from "../../src/core/coloresDeClase";
import { UNCLASSIFIED_COLOR } from "../../src/core/theme";
import {
  BLANCO_DESDE_EL_PASO,
  COLOR_DE_CLASE,
  COLORES_DE_DATOS,
  PAPEL,
  RAMPA_DEL_TEMA,
  SERIES,
  SERIES_DEL_TEMA,
  SIN_CLASIFICAR,
  TEMAS,
  colorDeCategoria,
  colorDeSerie,
  colorDelSigno
} from "../../src/reports/plantilla/tema";

const PLANTILLA = fileURLToPath(new URL("../../src/reports/plantilla/", import.meta.url));
const TOKENS = readFileSync(fileURLToPath(new URL("../../src/styles/tokens.css", import.meta.url)), "utf8");

/** El valor de un token de pantalla: su primera declaración. */
function token(nombre: string): string {
  const valor = new RegExp(`--${nombre}\\s*:\\s*(#[0-9a-fA-F]{6})\\b`).exec(TOKENS)?.[1];
  if (!valor) throw new Error(`tokens.css no declara --${nombre}`);
  return valor.toLowerCase();
}

const luminancia = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a: string, b: string) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("la paleta del papel, la del papel de cliente de antes", () => {
  test("la tinta, los filetes y el fondo de las tarjetas", () => {
    expect(PAPEL).toMatchObject({
      blanco: "#FFFFFF",
      tinta: "#201E1B",
      tinta2: "#6B6459",
      tinta3: "#756F61",
      filete: "#DCD3C4",
      fondo: "#FBFCFD"
    });
  });

  test("los dos temas: misma estructura, otro color, otro tono, otro filete y otro sello", () => {
    expect(TEMAS).toEqual({
      cliente: { color: "#A81E33", tono: "#85704C", filete: "#9C8459", sello: "CONFIDENCIAL" },
      interno: { color: "#3F6B82", tono: "#62707A", filete: "#6B7A85", sello: "USO INTERNO" }
    });
    for (const clave of ["color", "tono", "filete", "sello"] as const) expect(TEMAS.cliente[clave], clave).not.toBe(TEMAS.interno[clave]);
  });

  test("los colores con signo son los de la pantalla, en los dos temas", () => {
    expect(PAPEL.sube.toLowerCase()).toBe(token("sube"));
    expect(PAPEL.baja.toLowerCase()).toBe(token("baja"));
    expect(PAPEL.sube.toLowerCase()).toBe("#0a7a53");
    expect(PAPEL.baja.toLowerCase()).toBe("#c2261b");
    expect([colorDelSigno("sube"), colorDelSigno("baja"), colorDelSigno("neutro"), colorDelSigno(null)]).toEqual([PAPEL.sube, PAPEL.baja, PAPEL.tinta, PAPEL.tinta]);
  });

  test("renta fija, renta variable y liquidez llevan el color que tienen en la pantalla", () => {
    expect(COLOR_DE_CLASE.rentaFija).toBe(colorDeLaClase("FIXED_INCOME"));
    expect(COLOR_DE_CLASE.rentaVariable).toBe(colorDeLaClase("EQUITY"));
    expect(COLOR_DE_CLASE.liquidez).toBe(colorDeLaClase("MONEY_MARKET"));
    /* Los de la dirección A, escritos: si la pantalla y el papel cambiaran a la vez, también tendría que cambiar esto. */
    expect([COLOR_DE_CLASE.rentaFija, COLOR_DE_CLASE.rentaVariable, COLOR_DE_CLASE.liquidez]).toEqual(["#4E7D6A", "#2F5D8A", "#8A8F98"]);
  });

  test("«Otros» y lo sin clasificar llevan el gris del papel, no el del resto de la pantalla", () => {
    expect(SIN_CLASIFICAR).toBe("#808B9F");
    expect(COLOR_DE_CLASE.otros).toBe(SIN_CLASIFICAR);
    expect(contraste(SIN_CLASIFICAR, PAPEL.blanco)).toBeGreaterThanOrEqual(3);
    /* Por qué no el de la pantalla: sobre blanco no llega al 3:1 que el papel exige a un relleno que informa (#B3AC9E da 2,26). */
    expect(
      contraste(UNCLASSIFIED_COLOR, PAPEL.blanco),
      "El gris del resto de la pantalla ya llega al 3:1 del papel: el papel podría volver a copiarlo. No es un fallo del papel; hay que volver a mirar con Óscar la decisión del 18-11-2026 (apartado 14.3 de SISTEMA_DISENO.md)."
    ).toBeLessThan(3);
  });

  /* Las rayas no van sobre el blanco de la hoja, sino sobre el fondo de su tarjeta (`PAPEL.fondo`), que es algo más oscuro: se
     mide también ahí. A mano, con la fórmula de contraste: liquidez `#8A8F98` da 3,25 sobre blanco y 3,16 sobre la tarjeta; el
     gris de «Otros», 3,44 y 3,35. */
  test("las cuatro rayas de clase se ven sobre el fondo de su tarjeta: al menos 3:1", () => {
    for (const [clase, color] of Object.entries(COLOR_DE_CLASE)) expect(contraste(color, PAPEL.fondo), clase).toBeGreaterThanOrEqual(3);
    expect(contraste(COLOR_DE_CLASE.liquidez, PAPEL.fondo)).toBeCloseTo(3.163, 2);
    expect(contraste(COLOR_DE_CLASE.otros, PAPEL.fondo)).toBeCloseTo(3.345, 2);
  });

  /* El color llega a cada tarjeta por el texto de su rótulo: si un rótulo cambiara en los datos y no en el mapa, esa clase caería
     en el gris sin que nada fallase. */
  test("cada rótulo del reparto global tiene su color de clase en el informe de cliente", () => {
    const informe = fileURLToPath(new URL("../../src/reports/informeDeCliente/", import.meta.url));
    const rotulos = [...readFileSync(informe + "datos.ts", "utf8").matchAll(/\{ label: "([^"]+)", value: deLaCartera\(/g)].map((m) => m[1]);
    expect(rotulos).toEqual(["Renta fija", "Renta variable", "Liquidez", "Otros"]);
    const secciones = readFileSync(informe + "secciones.tsx", "utf8");
    const mapa = secciones.slice(secciones.indexOf("const COLOR_DE_LA_CLASE"), secciones.indexOf("};", secciones.indexOf("const COLOR_DE_LA_CLASE")));
    const esperado: Record<string, string> = { "Renta fija": "rentaFija", "Renta variable": "rentaVariable", Liquidez: "liquidez", Otros: "otros" };
    for (const rotulo of rotulos) expect(mapa, rotulo).toMatch(new RegExp(`["']?${rotulo}["']?\\s*:\\s*COLOR_DE_CLASE\\.${esperado[rotulo]}\\b`));
  });

  test("ningún fichero de la plantilla importa la paleta de pantalla, tampoco por sus colores de clase", () => {
    const culpables = readdirSync(PLANTILLA).filter((nombre) => /from\s+"[^"]*core\/(theme|coloresDeClase)"/.test(readFileSync(PLANTILLA + nombre, "utf8")));
    expect(culpables).toEqual([]);
  });

  test("la plantilla no escribe colores fuera de tema.ts", () => {
    const culpables = readdirSync(PLANTILLA)
      .filter((nombre) => nombre !== "tema.ts")
      .filter((nombre) => /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(PLANTILLA + nombre, "utf8").replace(/url\(#[^)]*\)/g, "")));
    expect(culpables).toEqual([]);
  });
});

describe("los contrastes sobre el papel blanco", () => {
  test("todo lo que es texto, al menos 4,5:1", () => {
    const textos = {
      tinta: PAPEL.tinta,
      tinta2: PAPEL.tinta2,
      tinta3: PAPEL.tinta3,
      sube: PAPEL.sube,
      baja: PAPEL.baja,
      aviso: PAPEL.aviso,
      "color del tema de cliente": TEMAS.cliente.color,
      "tono del tema de cliente": TEMAS.cliente.tono,
      "color del tema interno": TEMAS.interno.color,
      "tono del tema interno": TEMAS.interno.tono
    };
    for (const [nombre, color] of Object.entries(textos)) expect(contraste(color, PAPEL.blanco), nombre).toBeGreaterThanOrEqual(4.5);
  });

  test("los filetes con color y los rellenos que llevan información, al menos 3:1", () => {
    const graficos = [
      TEMAS.cliente.filete,
      TEMAS.interno.filete,
      SIN_CLASIFICAR,
      ...Object.values(COLORES_DE_DATOS),
      ...Object.values(COLOR_DE_CLASE),
      ...SERIES_DEL_TEMA.cliente.demas,
      ...SERIES_DEL_TEMA.interno.demas
    ];
    for (const color of graficos) expect(contraste(color, PAPEL.blanco), color).toBeGreaterThanOrEqual(3);
  });

  test("la rampa de cada tema va de claro a oscuro, y su cifra se lee en cada paso (4,5:1)", () => {
    for (const tema of ["cliente", "interno"] as const) {
      const rampa = RAMPA_DEL_TEMA[tema];
      expect(rampa, tema).toHaveLength(7);
      for (let i = 1; i < rampa.length; i++) expect(luminancia(rampa[i]), `${tema} ${i}`).toBeLessThan(luminancia(rampa[i - 1]));
      rampa.forEach((tono, paso) => expect(contraste(tono, paso >= BLANCO_DESDE_EL_PASO ? PAPEL.blanco : PAPEL.tinta), `${tema} paso ${paso}`).toBeGreaterThanOrEqual(4.5));
    }
    expect(RAMPA_DEL_TEMA.cliente).toEqual(["#F7F3EC", "#EFE7D8", "#E3D6BE", "#D0BD9A", "#B89D72", "#86694A", "#5F4A33"]);
  });
});

describe("las series y las categorías", () => {
  test("la cartera va en el color de su tema; la referencia, en la tinta secundaria", () => {
    expect(SERIES_DEL_TEMA.cliente.cartera).toBe(TEMAS.cliente.color);
    expect(SERIES_DEL_TEMA.interno.cartera).toBe(TEMAS.interno.color);
    expect(SERIES_DEL_TEMA.cliente.referencia).toBe(PAPEL.tinta2);
    expect(SERIES).toBe(SERIES_DEL_TEMA.cliente);
  });

  test("las series van en orden y no reciclan: la séptima es gris", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => colorDeSerie(i))).toEqual([SERIES.cartera, ...SERIES.demas, SIN_CLASIFICAR]);
    expect(colorDeSerie(0, "interno")).toBe(TEMAS.interno.color);
    /* En cada tema, ninguna serie repite el color de la cartera. */
    for (const tema of ["cliente", "interno"] as const) expect(SERIES_DEL_TEMA[tema].demas).not.toContain(SERIES_DEL_TEMA[tema].cartera);
  });

  test("un color por categoría, ocho distintos, en el orden del papel de antes", () => {
    const ocho = [0, 1, 2, 3, 4, 5, 6, 7].map(colorDeCategoria);
    expect(new Set(ocho).size).toBe(8);
    expect(ocho.slice(0, 3)).toEqual([COLORES_DE_DATOS.acero, COLORES_DE_DATOS.granate, COLORES_DE_DATOS.marino]);
    expect(colorDeCategoria(8)).toBe(colorDeCategoria(0));
  });
});
