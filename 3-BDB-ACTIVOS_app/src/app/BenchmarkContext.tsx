/* eslint-disable react-refresh/only-export-components */
// Benchmark de referencia ELEGIDO POR EL USUARIO, compartido por toda la app.
//
// Antes vivía en un useState local de XrayAdvanced, así que la elección no salía
// de esa pantalla: los dos PDF llevaban "equilibrado" fijo y el informe seguía
// diciendo «Equilibrado» aunque en X-Ray estuviera seleccionado «Dinámico».
// Mismo patrón que ClientModeContext (persistencia en localStorage incluida).
//
// DEFAULT_BENCHMARK_ID e isKnownBenchmarkId viven en core/benchmarkProfiles para
// que los generadores de PDF no tengan que importar este módulo de React.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_BENCHMARK_ID, isKnownBenchmarkId } from "../core/benchmarkProfiles";

export const BENCHMARK_STORAGE_KEY = "bdb-activos.benchmark.v1";

export { DEFAULT_BENCHMARK_ID, isKnownBenchmarkId };

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface BenchmarkContextValue {
  benchmarkId: string;
  setBenchmarkId: (benchmarkId: string) => void;
}

const BenchmarkContext = createContext<BenchmarkContextValue>({
  benchmarkId: DEFAULT_BENCHMARK_ID,
  setBenchmarkId: () => undefined
});

export function readBenchmarkId(storage?: StorageLike | null): string {
  if (!storage) return DEFAULT_BENCHMARK_ID;
  try {
    const stored = storage.getItem(BENCHMARK_STORAGE_KEY);
    // Un id guardado que ya no exista (renombrar o retirar un perfil) no debe
    // dejar la app comparando contra nada: se cae al perfil por defecto.
    return isKnownBenchmarkId(stored) ? (stored as string) : DEFAULT_BENCHMARK_ID;
  } catch {
    return DEFAULT_BENCHMARK_ID;
  }
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function BenchmarkProvider({ children, initialValue }: { children: ReactNode; initialValue?: string }) {
  const browserStorage = getBrowserStorage();
  const [benchmarkId, setBenchmarkIdState] = useState(
    () => (isKnownBenchmarkId(initialValue) ? (initialValue as string) : readBenchmarkId(browserStorage))
  );

  useEffect(() => {
    if (!browserStorage) return;
    try { browserStorage.setItem(BENCHMARK_STORAGE_KEY, benchmarkId); } catch { /* almacenamiento no disponible */ }
  }, [browserStorage, benchmarkId]);

  /* Como el Modo cliente: con dos pestañas, cambiarla en una dejaba la otra comparando contra la anterior, y su PDF
     diría otra referencia (MAR-30). El navegador avisa a las demás de lo que cambia en su almacenamiento. */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const alCambiarEnOtraPestana = (evento: StorageEvent) => {
      if (evento.key !== BENCHMARK_STORAGE_KEY || evento.newValue === null) return;
      setBenchmarkIdState(isKnownBenchmarkId(evento.newValue) ? evento.newValue : DEFAULT_BENCHMARK_ID);
    };
    window.addEventListener("storage", alCambiarEnOtraPestana);
    return () => window.removeEventListener("storage", alCambiarEnOtraPestana);
  }, []);

  const value = useMemo<BenchmarkContextValue>(() => ({
    benchmarkId,
    setBenchmarkId: (next: string) => setBenchmarkIdState(isKnownBenchmarkId(next) ? next : DEFAULT_BENCHMARK_ID)
  }), [benchmarkId]);

  return <BenchmarkContext.Provider value={value}>{children}</BenchmarkContext.Provider>;
}

export function useBenchmark(): BenchmarkContextValue {
  return useContext(BenchmarkContext);
}
