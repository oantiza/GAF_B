/** In-memory data must never outlive the authenticated session that loaded it. */
const invalidators = new Set<() => void>();
let epoch = 0;

export function registerSessionCache(invalidate: () => void): void {
  invalidators.add(invalidate);
}

export function clearSessionCaches(): void {
  epoch += 1;
  invalidators.forEach((invalidate) => invalidate());
}

export function sessionCacheEpoch(): number {
  return epoch;
}

/**
 * U-08 (auditoría 29-09): estado de pantalla que sobrevive al desmontaje por
 * ruta (BdbActivosApp monta cada analizador al navegar) pero nunca a la
 * sesión: se vacía con clearSessionCaches y, además, lo escrito bajo otro
 * epoch no se restaura. Solo memoria: nunca localStorage (datos de clientes).
 */
export interface SessionSlot<T> {
  /** Valor guardado en esta sesión, o el inicial si no hay nada válido. */
  read(): T;
  write(value: T): void;
  reset(): void;
}

export function createSessionSlot<T>(initial: () => T): SessionSlot<T> {
  let stored: { epoch: number; value: T } | null = null;
  const reset = () => {
    stored = null;
  };
  registerSessionCache(reset);
  return {
    read: () => (stored && stored.epoch === epoch ? stored.value : initial()),
    write: (value) => {
      stored = { epoch, value };
    },
    reset
  };
}
