import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  METRICAS_DE_LA_LISTA,
  motivoDeQueNoAplique,
  seEnsenaLaMetrica
} from "../src/core/metricasPorInstrumento";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

function ficherosDe(carpeta: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) ficherosDe(ruta, salida);
    else salida.push(ruta);
  }
  return salida;
}

describe("la lista de métricas por tipo de instrumento", () => {
  test("a una acción no le aplican, y a un fondo sí", () => {
    for (const metrica of ["sharpe", "sortino", "morningstar", "retrocesion", "costeCorriente"] as const) {
      expect(seEnsenaLaMetrica(metrica, "STOCK"), metrica).toBe(false);
      expect(seEnsenaLaMetrica(metrica, "FUND"), metrica).toBe(true);
      expect(seEnsenaLaMetrica(metrica, "ETF"), metrica).toBe(true);
    }
  });

  test("un tipo desconocido se enseña: no saber qué es no es motivo para decir que no le aplica", () => {
    for (const tipo of [undefined, null, "", "OTHER"]) expect(seEnsenaLaMetrica("sharpe", tipo)).toBe(true);
  });

  test("cada entrada dice por qué", () => {
    for (const metrica of METRICAS_DE_LA_LISTA) {
      expect(motivoDeQueNoAplique(metrica, "STOCK").length, metrica).toBeGreaterThan(20);
      expect(motivoDeQueNoAplique(metrica, "FUND"), metrica).toBe("");
    }
  });
});

/**
 * Las pantallas que enseñan una cifra de un instrumento concreto tienen que preguntarle a la lista.
 * Es lo que hace que decidirlo de otra métrica se cambie en un sitio: la regla del Sharpe estaba en
 * cuatro sitios y se olvidó en otros cuatro.
 *
 * Lo que cuenta es leer la cifra de un activo. El Sharpe de una cartera, que es otra cosa y sí se enseña,
 * no pasa por `.sharpe_3y` de un activo.
 */
const LEEN_LA_CIFRA_DE_UN_ACTIVO = /(?:\bm|metrics|\.metrics)\.sharpe_3y|sharpe3a|morningstar_rating|\.ongoingPct|\.retroPct/;

/** Lo que lee esa cifra para otra cosa que enseñarla, y por qué. */
const NO_LA_ENSENAN: Record<string, string> = {
  "src/components/AssetComparison.tsx": "pasa las estrellas al PDF; la pantalla las pinta comparativaDeActivos",
  "src/components/PositionsWorkbench.tsx": "suma el coste y la retrocesión para los totales; las filas las pinta tablaDePosiciones"
};

/** Los adaptadores que cargan la cifra para otros, sin pintarla. Las pantallas son las que preguntan. */
const SOLO_LA_TRANSPORTAN = /src[\\/]adapters[\\/](?!comparativaDeActivos|componerLista|componerFicha)/;

describe("el recorrido por las pantallas", () => {
  const ficheros = ["src/components", "src/pages", "src/adapters"]
    .flatMap((carpeta) => ficherosDe(join(RAIZ, carpeta)))
    .filter((ruta) => /\.tsx?$/.test(ruta) && !SOLO_LA_TRANSPORTAN.test(ruta) && !/datosDeMuestra/.test(ruta))
    .map((ruta) => relative(RAIZ, ruta).replace(/\\/g, "/"));

  test("la señal encuentra pantallas: si esto falla, es la prueba la que se ha quedado ciega", () => {
    const conLaCifra = ficheros.filter((ruta) => LEEN_LA_CIFRA_DE_UN_ACTIVO.test(readFileSync(join(RAIZ, ruta), "utf8")));
    expect(conLaCifra).toContain("src/adapters/comparativaDeActivos.ts");
    expect(conLaCifra.length).toBeGreaterThan(2);
  });

  test("ninguna pantalla enseña la cifra de un activo sin preguntar a la lista", () => {
    const sinPreguntar = ficheros.filter((ruta) => {
      if (ruta in NO_LA_ENSENAN) return false;
      const codigo = readFileSync(join(RAIZ, ruta), "utf8");
      return LEEN_LA_CIFRA_DE_UN_ACTIVO.test(codigo) && !/metricasPorInstrumento/.test(codigo);
    });
    expect(sinPreguntar, "Estas pantallas enseñan una métrica sin leer src/core/metricasPorInstrumento.ts").toEqual([]);
  });

  test("las excepciones existen de verdad", () => {
    for (const ruta of Object.keys(NO_LA_ENSENAN)) expect(ficheros, ruta).toContain(ruta);
  });
});
