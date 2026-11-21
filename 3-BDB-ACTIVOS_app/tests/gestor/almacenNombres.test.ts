import { describe, expect, it } from "vitest";
import { LONGITUD_MAXIMA, nombreDeFichero, nombreDeFicheroPara, sanearNombre } from "../../src/gestor/almacen/nombres";

describe("nombres de fichero", () => {
  it("un nombre normal se queda igual, con tildes y eñes", () => {
    expect(nombreDeFichero({ nombre: "Familia García" })).toBe("Familia García.cartera.json");
    expect(nombreDeFichero({ nombre: "Cartera modelo 60-40" })).toBe("Cartera modelo 60-40.cartera.json");
    expect(nombreDeFichero({ nombre: "Señora Núñez" })).toBe("Señora Núñez.cartera.json");
  });

  it("quita los caracteres que Windows prohíbe y los de control", () => {
    expect(sanearNombre('A\\B/C:D*E?F"G<H>I|J')).toBe("A B C D E F G H I J");
    expect(sanearNombre("Línea\nnueva\tcon tab")).toBe("Línea nueva con tab");
    expect(sanearNombre("50/50: ¿mitad?")).toBe("50 50 ¿mitad");
  });

  it("sin puntos ni espacios al final ni punto al principio", () => {
    expect(sanearNombre("Cartera...")).toBe("Cartera");
    expect(sanearNombre("Cartera . . ")).toBe("Cartera");
    expect(sanearNombre(".oculta")).toBe("oculta");
    expect(sanearNombre("  espacios  dobles  ")).toBe("espacios dobles");
  });

  it("los nombres reservados de Windows llevan delante «Cartera»", () => {
    expect(nombreDeFichero({ nombre: "CON" })).toBe("Cartera CON.cartera.json");
    expect(sanearNombre("nul")).toBe("Cartera nul");
    expect(sanearNombre("Com1")).toBe("Cartera Com1");
    expect(sanearNombre("LPT9")).toBe("Cartera LPT9");
    /* Windows mira hasta el primer punto. */
    expect(sanearNombre("aux.datos")).toBe("Cartera aux.datos");
    /* Que empiece igual no lo hace reservado. */
    expect(sanearNombre("Consolidada")).toBe("Consolidada");
    expect(sanearNombre("COM10")).toBe("COM10");
  });

  it("un nombre vacío o que se queda en nada", () => {
    expect(nombreDeFichero({ nombre: "" })).toBe("Cartera sin nombre.cartera.json");
    expect(sanearNombre("   ")).toBe("Cartera sin nombre");
    expect(sanearNombre("???")).toBe("Cartera sin nombre");
    expect(sanearNombre("...")).toBe("Cartera sin nombre");
  });

  it("un nombre muy largo se corta a 120 caracteres completos", () => {
    const largo = "a".repeat(300);
    expect(sanearNombre(largo)).toHaveLength(LONGITUD_MAXIMA);
    /* Con emojis (dos unidades UTF-16 cada uno) no se parte ninguno. */
    const conEmojis = "\u{1F4C8}".repeat(200);
    const saneado = sanearNombre(conEmojis);
    expect(Array.from(saneado)).toHaveLength(LONGITUD_MAXIMA);
    expect(saneado).toBe("\u{1F4C8}".repeat(LONGITUD_MAXIMA));
    /* Si el corte deja un espacio o un punto al final, se quita. */
    expect(sanearNombre(`${"b".repeat(119)} resto`)).toBe("b".repeat(119));
    expect(nombreDeFicheroPara(largo, "abcd1234").length).toBeLessThan(255);
  });

  it("el sufijo de desempate va entre paréntesis", () => {
    expect(nombreDeFicheroPara("Familia García", "3f2a9c1b")).toBe("Familia García (3f2a9c1b).cartera.json");
  });
});
