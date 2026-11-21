import { useEffect, useMemo, useRef, useState } from "react";
import type { FrontierResult } from "./frontier";
import {
  buildApproximateFrontierInputs,
  computeApproximateFrontier,
  hasCachedApproximateFrontier,
  type ApproximateFrontierInputs
} from "./frontierPresentation";
import type { BdbAssetDetail } from "../types/bdbAssets";

/* Auditoría 27-07 (T2/P7): computeFrontier corría síncrono en cada arrastre
   de peso. Caché de módulo por huella de entradas (core) y debounce corto:
   mientras se arrastra se enseña el último resultado y el recálculo llega al
   soltar. Primer render síncrono (o directo de caché en montajes posteriores). */
const FRONTIER_RECOMPUTE_DEBOUNCE_MS = 120;

export function useApproximateFrontier(assets: readonly BdbAssetDetail[]): { result: FrontierResult | null; inputs: ApproximateFrontierInputs } {
  // Huella por VALORES (no identidad): un array recreado con el mismo
  // contenido no recalcula nada.
  const inputs = useMemo(() => buildApproximateFrontierInputs(assets), [assets]);
  const [result, setResult] = useState<FrontierResult | null>(() => computeApproximateFrontier(inputs));
  const appliedKey = useRef(inputs.key);

  useEffect(() => {
    if (inputs.key === appliedKey.current) {
      return;
    }
    if (hasCachedApproximateFrontier(inputs.key)) {
      appliedKey.current = inputs.key;
      setResult(computeApproximateFrontier(inputs));
      return;
    }
    const timer = setTimeout(() => {
      appliedKey.current = inputs.key;
      setResult(computeApproximateFrontier(inputs));
    }, FRONTIER_RECOMPUTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputs]);

  return { result, inputs };
}
