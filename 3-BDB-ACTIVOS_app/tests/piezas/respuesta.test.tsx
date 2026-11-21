// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Cifra } from "../../src/components/ui/Cifra";
import { Respuesta } from "../../src/components/ui/Respuesta";
import { pintar } from "./pintar";

/**
 * La pieza Respuesta: un grupo con nombre, cada dato leído en orden (rótulo, cifra, apunte), una sola cifra principal
 * y el color del signo solo donde se pide.
 */
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

const N = " ";

describe("la pieza Respuesta", () => {
  test("es un grupo con nombre, y cada dato se lee en orden", () => {
    const vista = pintar(
      <Respuesta
        datos={[
          { rotulo: "Rentabilidad anualizada", cifra: <Cifra tipo="rentabilidad" valor={0.119} />, apunte: "la referencia, +9,15 %" },
          { rotulo: "Volatilidad", cifra: <Cifra tipo="porcentaje" valor={0.078} /> },
          { rotulo: "Coste corriente", cifra: <Cifra tipo="porcentaje" valor={null} />, apunte: "sin el KID" }
        ]}
        etiqueta="Rentabilidad y riesgo de la cartera"
      />
    );
    quitar = vista.quitar;
    const grupo = vista.host.querySelector(".respuesta")!;
    expect(grupo.getAttribute("role")).toBe("group");
    expect(grupo.getAttribute("aria-label")).toBe("Rentabilidad y riesgo de la cartera");
    const datos = [...grupo.querySelectorAll(".respuesta__dato")].map((dato) => [...dato.children].map((hijo) => hijo.textContent));
    expect(datos).toEqual([
      ["Rentabilidad anualizada", `+11,90${N}%`, "la referencia, +9,15 %"],
      ["Volatilidad", `7,80${N}%`],
      ["Coste corriente", "Falta el dato", "sin el KID"]
    ]);
    expect(grupo.querySelector(".respuesta__dato--principal")).toBeNull();
  });

  test("una sola cifra principal: si se marcan dos, cuenta la primera", () => {
    const vista = pintar(
      <Respuesta
        datos={[
          { rotulo: "Patrimonio", cifra: "201.298 €", principal: true },
          { rotulo: "Resultado", cifra: "+18.582 €", principal: true },
          { rotulo: "Rentabilidad", cifra: "+10,39 %" }
        ]}
        etiqueta="Cuánto vale"
      />
    );
    quitar = vista.quitar;
    const principales = vista.host.querySelectorAll(".respuesta__dato--principal");
    expect(principales).toHaveLength(1);
    expect(principales[0].querySelector(".respuesta__rotulo")?.textContent).toBe("Patrimonio");
  });

  test("el signo colorea la cifra solo si sube o baja", () => {
    const vista = pintar(
      <Respuesta
        datos={[
          { rotulo: "Resultado", cifra: "+18.582 €", signo: "sube" },
          { rotulo: "Diferencia", cifra: "−4,72 pp", signo: "baja" },
          { rotulo: "Sin cambio", cifra: "0,00 %", signo: "neutro" }
        ]}
        etiqueta="Resultado"
      />
    );
    quitar = vista.quitar;
    expect([...vista.host.querySelectorAll(".respuesta__cifra")].map((cifra) => cifra.className)).toEqual([
      "respuesta__cifra cifra--sube",
      "respuesta__cifra cifra--baja",
      "respuesta__cifra"
    ]);
  });
});

describe("la banda abierta", () => {
  test("con `abierta` la banda lleva su variante, y sin ella no", () => {
    const datos = [
      { rotulo: "Activos", cifra: "1.334" },
      { rotulo: "Datos disponibles", cifra: "58,3 %", principal: true },
      { rotulo: "No aplican", cifra: "27.962" }
    ];
    const abierta = pintar(<Respuesta abierta className="otra" datos={datos} etiqueta="La salud del catálogo" />);
    const grupo = abierta.host.querySelector(".respuesta")!;
    expect(grupo.className).toBe("respuesta respuesta--abierta otra");
    expect(grupo.getAttribute("role")).toBe("group");
    expect(grupo.getAttribute("aria-label")).toBe("La salud del catálogo");
    abierta.quitar();
    const cerrada = pintar(<Respuesta datos={datos} etiqueta="La salud del catálogo" />);
    quitar = cerrada.quitar;
    expect(cerrada.host.querySelector(".respuesta")!.className).toBe("respuesta");
    expect(cerrada.host.querySelector(".respuesta--abierta")).toBeNull();
  });
});

/**
 * 14-11-2026, visto en la ficha de una acción a 768 px: «350,69 USD» no cabía en su casilla, cruzaba el filete y tocaba
 * la cifra de al lado («350,69 USD+35,40 %»). Cada dato tenía un ancho mínimo fijo, igual para una cifra corta que para
 * una larga, y la banda no doblaba de fila hasta que ese mínimo dejaba de caber. Ahora el mínimo de un dato es lo que
 * mide su contenido, que incluye la cifra entera porque no se parte.
 */
describe("la hoja de la Respuesta", () => {
  const hoja = readFileSync(path.resolve(process.cwd(), "src/styles/components.css"), "utf8").replaceAll("\r\n", "\n");
  const regla = (selector: string) => {
    const hallada = new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(hoja);
    expect(hallada, `la regla ${selector}`).not.toBeNull();
    return hallada![1];
  };

  test("un dato no se estrecha por debajo de su cifra: su ancho mínimo es el de su contenido", () => {
    expect(regla(".respuesta__dato")).toMatch(/min-width:\s*min-content/);
    expect(regla(".respuesta__dato--principal")).not.toContain("min-width");
  });

  test("la cifra no se parte, y por eso cuenta entera en ese mínimo", () => {
    expect(regla(".respuesta__cifra")).toMatch(/white-space:\s*nowrap/);
  });

  test("la banda dobla de fila cuando sus datos no caben, y el ancho mínimo de siempre lo pone el rótulo", () => {
    expect(regla(".respuesta")).toMatch(/flex-wrap:\s*wrap/);
    /* 80 px de contenido para un dato y 208 para el principal: lo que medían con el mínimo fijo de antes. */
    expect(regla(".respuesta__rotulo")).toMatch(/min-width:\s*calc\(var\(--s-12\) \+ var\(--s-6\)\)/);
    expect(regla(".respuesta__dato--principal .respuesta__rotulo")).toMatch(/min-width:\s*calc\(var\(--s-12\) \* 3 \+ var\(--s-6\)\)/);
  });

  /* Dirección A (18-11-2026): el tope baja de 24 a 20 px, el aire de la banda de cifras de la vista previa. */
  test("el relleno lateral de un dato baja con el ancho de la pantalla, entre 12 y 20 px, y es un token", () => {
    expect(regla(".respuesta__dato")).toMatch(/padding:\s*0 var\(--respuesta-relleno\)/);
    const tokens = readFileSync(path.resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
    expect(tokens).toMatch(/--respuesta-relleno:\s*clamp\(var\(--s-5\), calc\([\d.]+vw - \d+px\), var\(--s-7\)\)/);
    expect(tokens).toMatch(/--s-5:\s*12px/);
    expect(tokens).toMatch(/--s-7:\s*20px/);
  });
});
