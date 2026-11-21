import { useEffect, useState } from "react";
import { fetchPortfolioHorizon, horizonFingerprint, type HorizonPosition, type PortfolioHorizon } from "../adapters/portfolioHorizon";
import { useAnalysisWindow } from "./analysisPreferences";

export function usePortfolioHorizon(positions: readonly HorizonPosition[]) {
  const window = useAnalysisWindow();
  /* INF-5 (auditoría del 16-11-2026): con todos los pesos a cero no se pide nada, y sin datos ni error las pantallas
     leían «calculando» para siempre. No es una espera ni un fallo: es que no hay qué medir, y se dice así. */
  const sinPesos = !positions.some((p) => p.weight_percent > 0);
  const fingerprint = horizonFingerprint(positions, window);
  /* `error` sigue siendo el texto, que es lo que leen las demás pantallas. `causa` es el error tal cual (ANA-05): sin él no se
     distingue «faltan datos» o «tope del cálculo», que no se reintentan, de un fallo de la petición. */
  const [state, setState] = useState<{ fingerprint: string; data?: PortfolioHorizon; error?: string; causa?: unknown }>({ fingerprint: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    if (sinPesos) return;
    const controller = new AbortController();
    // Debounce edits to positions; changing period immediately hides the old result.
    const timer = setTimeout(() => {
      void fetchPortfolioHorizon(positions, window, controller.signal).then((data) => {
        if (active) setState({ fingerprint, data });
      }).catch((error: unknown) => {
        if (active) setState({ fingerprint, error: error instanceof Error ? error.message : "No se pudo calcular el análisis.", causa: error });
      });
    }, 350);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  // Fingerprint contains every weight, asset, period and session epoch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, retry]);
  return { window, sinPesos, data: state.fingerprint === fingerprint ? state.data : undefined,
    error: state.fingerprint === fingerprint ? state.error : undefined,
    causa: state.fingerprint === fingerprint ? state.causa : undefined,
    retry: () => { setState({ fingerprint: "" }); setRetry((n) => n+1); } };
}
