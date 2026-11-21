import { useCallback, useEffect, useRef, useState } from "react";

/**
 * La pestaña elegida, guardada al final de la dirección: `/analisis#pestana=exposicion`. Así se puede recargar,
 * compartir y volver con «Atrás» a la pestaña de antes (apartado 3 de `SISTEMA_DISENO.md`: «la pestaña va en la
 * dirección»). Generaliza lo que ya hacía Mercado a mano (ACT-17).
 *
 * - **Convive con lo que ya haya tras el `#`**: los trozos se separan con `&` y solo se toca el suyo. Con `#plan=X`, la
 *   pestaña queda en `#plan=X&pestana=riesgo`, y `#plan=X` sigue ahí.
 * - **La pestaña inicial no se escribe**: elegirla quita el trozo, y una dirección sin él es la inicial.
 * - **Cada cambio es una entrada del historial** (`pushState`), así que «Atrás» vuelve a la pestaña anterior. Se
 *   escribe con `history` y sin tocar `location.hash`, para no despertar al enrutador del marco (como Mercado y Planes).
 * - **Se recupera** al cargar, con «Atrás» y «Adelante» (`popstate`) y cuando otro cambia el `#` (`hashchange`). Lo que
 *   no es una de las pestañas se lee como la inicial.
 *
 * ```tsx
 * const [pestana, setPestana] = usePestanaEnLaDireccion(["resumen", "exposicion", "datos"] as const, "resumen");
 * <SegmentedTabs tabs={…} value={pestana} onChange={setPestana} … />
 * ```
 */
export function usePestanaEnLaDireccion<T extends string>(pestanas: readonly T[], inicial: T, clave = "pestana"): [T, (siguiente: T) => void] {
  /* Las pestañas suelen llegar como un literal nuevo en cada pintado: se leen de aquí para no repetir los efectos. */
  const vigentes = useRef({ pestanas, inicial, clave });
  useEffect(() => {
    vigentes.current = { pestanas, inicial, clave };
  });

  const [pestana, setPestana] = useState<T>(() => pestanaDeLaDireccion(window.location.hash, pestanas, inicial, clave));

  useEffect(() => {
    const leer = () => {
      const { pestanas: lista, inicial: porDefecto, clave: nombre } = vigentes.current;
      setPestana(pestanaDeLaDireccion(window.location.hash, lista, porDefecto, nombre));
    };
    window.addEventListener("popstate", leer);
    window.addEventListener("hashchange", leer);
    return () => {
      window.removeEventListener("popstate", leer);
      window.removeEventListener("hashchange", leer);
    };
  }, []);

  const elegir = useCallback((siguiente: T) => {
    const { inicial: porDefecto, clave: nombre } = vigentes.current;
    const hash = hashConLaPestana(window.location.hash, siguiente === porDefecto ? null : siguiente, nombre);
    const destino = `${window.location.pathname}${window.location.search}${hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== destino) {
      window.history.pushState(window.history.state, "", destino);
    }
    setPestana(siguiente);
  }, []);

  return [pestana, elegir];
}

/** Los trozos de lo que va tras el `#`, separados por `&`. */
function trozosDe(hash: string): string[] {
  return hash.replace(/^#/, "").split("&").filter(Boolean);
}

function pestanaDeLaDireccion<T extends string>(hash: string, pestanas: readonly T[], inicial: T, clave: string): T {
  const prefijo = `${clave}=`;
  const trozo = trozosDe(hash).find((t) => t.startsWith(prefijo));
  if (!trozo) return inicial;
  let valor: string;
  try {
    valor = decodeURIComponent(trozo.slice(prefijo.length));
  } catch {
    return inicial;
  }
  return pestanas.find((p) => p === valor) ?? inicial;
}

/** El `#` con la pestaña puesta (o quitada, con `null`) y el resto de trozos como estaban. */
function hashConLaPestana(hash: string, pestana: string | null, clave: string): string {
  const prefijo = `${clave}=`;
  const resto = trozosDe(hash).filter((t) => !t.startsWith(prefijo));
  const trozos = pestana === null ? resto : [...resto, `${prefijo}${encodeURIComponent(pestana)}`];
  return trozos.length ? `#${trozos.join("&")}` : "";
}
