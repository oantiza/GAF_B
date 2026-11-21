/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { seEnsena, type LoQueSeOculta } from "../core/modoCliente";

export const CLIENT_MODE_STORAGE_KEY = "bdb-activos.client-mode.v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ClientModeContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

const ClientModeContext = createContext<ClientModeContextValue>({
  enabled: false,
  setEnabled: () => undefined,
  toggle: () => undefined
});

export function readClientMode(storage?: StorageLike | null): boolean {
  if (!storage) return false;
  try { return storage.getItem(CLIENT_MODE_STORAGE_KEY) === "true"; } catch { return false; }
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function ClientModeProvider({ children, initialValue }: { children: ReactNode; initialValue?: boolean }) {
  const browserStorage = getBrowserStorage();
  const [enabled, setEnabled] = useState(() => initialValue ?? readClientMode(browserStorage));

  useEffect(() => {
    if (!browserStorage) return;
    try { browserStorage.setItem(CLIENT_MODE_STORAGE_KEY, String(enabled)); } catch { /* almacenamiento no disponible */ }
  }, [browserStorage, enabled]);

  /* Con dos pestañas abiertas, activarlo en una se queda en la otra: delante del cliente, esa seguiría enseñando
     retrocesiones y el correo. El navegador avisa a las demás de lo que cambia en su almacenamiento. */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const alCambiarEnOtraPestana = (evento: StorageEvent) => {
      if (evento.key === CLIENT_MODE_STORAGE_KEY && evento.newValue !== null) setEnabled(evento.newValue === "true");
    };
    window.addEventListener("storage", alCambiarEnOtraPestana);
    return () => window.removeEventListener("storage", alCambiarEnOtraPestana);
  }, []);

  const value = useMemo<ClientModeContextValue>(() => ({
    enabled,
    setEnabled,
    toggle: () => setEnabled((current) => !current)
  }), [enabled]);

  return <ClientModeContext.Provider value={value}>{children}</ClientModeContext.Provider>;
}

export function useClientMode(): ClientModeContextValue {
  return useContext(ClientModeContext);
}

/**
 * Lo que una pantalla pregunta antes de enseñar algo comercial o de cocina. Qué se oculta, qué se
 * queda siempre y por qué está en `src/core/modoCliente.ts`, que es la única definición.
 */
export function useModoCliente(): { activo: boolean; seEnsena: (que: LoQueSeOculta) => boolean } {
  const { enabled } = useContext(ClientModeContext);
  return useMemo(() => ({ activo: enabled, seEnsena: (que: LoQueSeOculta) => seEnsena(que, enabled) }), [enabled]);
}
