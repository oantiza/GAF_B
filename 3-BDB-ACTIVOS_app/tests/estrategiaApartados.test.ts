import { describe, expect, test } from "vitest";
import { trozosDelTexto } from "../src/reports/weeklyReportPdf";

/* El informe completo de estrategia viene en markdown. Antes se le quitaba el formato entero y luego se partía en párrafos,
   así que «## Cierre y lectura de la sesión» quedaba como la primera línea de su párrafo, con la misma letra (14-11-2026). */
describe("los apartados del informe completo", () => {
  test("un título del texto es un apartado, separado de su párrafo aunque no haya línea en blanco", () => {
    expect(trozosDelTexto("## Cierre y lectura de la sesión\nLos mercados cerraron con tono mixto.\n\n## Datos\nLa Fed mantuvo los tipos.")).toEqual([
      { apartado: true, texto: "Cierre y lectura de la sesión" },
      { apartado: false, texto: "Los mercados cerraron con tono mixto." },
      { apartado: true, texto: "Datos" },
      { apartado: false, texto: "La Fed mantuvo los tipos." }
    ]);
  });

  test("sin títulos, los párrafos siguen partiéndose por las líneas en blanco y sin formato", () => {
    expect(trozosDelTexto("Uno **fuerte**.\n\n\nDos, _suave_.")).toEqual([
      { apartado: false, texto: "Uno fuerte." },
      { apartado: false, texto: "Dos, suave." }
    ]);
  });

  test("una almohadilla sin espacio no es un título, y un bloque de código no se imprime", () => {
    expect(trozosDelTexto("#hashtag del día\n```\ncódigo\n```\nFin.")).toEqual([
      { apartado: false, texto: "hashtag del día" },
      { apartado: false, texto: "Fin." }
    ]);
  });
});
