import { BENCHMARK_PROFILES, type BenchmarkProfile } from "./benchmarkProfiles";
import { errorDelNivelDePerfil } from "./perfilYHorizonte";

/**
 * Renta variable de cada nivel de la escala de diez, en %. Es la tabla de `RENTA_VARIABLE_POR_NIVEL` de
 * `functions_python/generador_de_carteras.py`, que es quien la usa para construir las carteras: una prueba lee ese
 * fichero y falla si las dos dejan de coincidir (decisión C-26).
 */
export const RENTA_VARIABLE_POR_NIVEL: Readonly<Record<number, number>> = {
  1: 0,
  2: 10,
  3: 20,
  4: 30,
  5: 40,
  6: 50,
  7: 60,
  8: 70,
  9: 85,
  10: 100
};

/**
 * La cartera de referencia cuya renta variable (`weights.rv`) queda más cerca de la del nivel; en empate, la de menos
 * renta variable. Se calcula con los pesos de `BENCHMARK_PROFILES`, no se guarda una correspondencia a mano: si un día
 * cambian los pesos de una referencia, la propuesta cambia con ellos.
 *
 * Es solo una propuesta. El nivel es una etiqueta que escribe el asesor, y una cartera hecha a mano puede tener más o
 * menos renta variable de la que dice la tabla. Sin nivel, o con uno que no vale, no hay propuesta: el nivel no se
 * deduce de nada.
 */
export function referenciaMasCercana(nivel: unknown): BenchmarkProfile | undefined {
  if (typeof nivel !== "number" || errorDelNivelDePerfil(nivel) !== null) return undefined;
  const rentaVariable = RENTA_VARIABLE_POR_NIVEL[nivel];
  if (rentaVariable === undefined) return undefined;
  let mejor: BenchmarkProfile | undefined;
  let mejorDistancia = Infinity;
  for (const perfil of BENCHMARK_PROFILES) {
    const distancia = Math.abs(perfil.weights.rv * 100 - rentaVariable);
    const mejora = distancia < mejorDistancia - 1e-9;
    const empata = Math.abs(distancia - mejorDistancia) <= 1e-9 && mejor !== undefined && perfil.weights.rv < mejor.weights.rv;
    if (mejora || empata) {
      mejor = perfil;
      mejorDistancia = distancia;
    }
  }
  return mejor;
}

/** Puntos de renta variable entre el nivel y su referencia más cercana; `undefined` si no hay propuesta. */
export function distanciaALaReferencia(nivel: unknown): number | undefined {
  const referencia = referenciaMasCercana(nivel);
  if (!referencia || typeof nivel !== "number") return undefined;
  return Math.abs(referencia.weights.rv * 100 - RENTA_VARIABLE_POR_NIVEL[nivel]!);
}
