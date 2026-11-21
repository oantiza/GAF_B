import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { FIREBASE_CONFIGURED } from "../firebaseEnv";

/**
 * Devuelve true si el usuario actual es admin por custom claim `admin`.
 *
 * A3.5: la allowlist VITE_ADMIN_EMAILS desapareció — horneaba emails en el
 * bundle público y duplicaba una decisión que ya vive en el claim (se pone con
 * scripts/set_admin.py). El backend re-verifica en cada callable admin
 * (_require_admin), así que este hook solo decide qué UI se monta.
 */
export function useIsAdmin(): boolean {
  return useAdminClaim().isAdmin;
}

export interface AdminClaimState {
  /** true solo con el claim `admin` confirmado en el token. */
  isAdmin: boolean;
  /** false mientras el claim está en vuelo: `isAdmin` aún no dice nada. */
  resolved: boolean;
}

/**
 * B4 / R-07 (auditoría 29-09): la misma lectura del claim, pero exponiendo
 * si ya se ha resuelto. Lo necesitan las pantallas que deben decidir entre
 * «todavía no sé» y «no es admin» (p. ej. no consultar `commercial_retro`,
 * que las reglas de Firestore reservan al admin, con una cuenta sin claim).
 * Sin Firebase configurado no hay claim que leer: se resuelve a no-admin.
 */
export function useAdminClaim(): AdminClaimState {
  const [state, setState] = useState<AdminClaimState>(() => ({ isAdmin: false, resolved: !FIREBASE_CONFIGURED }));

  /* MEDIA-07 (auditoría 16-10-2026): antes el claim se leía una sola vez al
     montar. Ahora se escucha onIdTokenChanged: cada token nuevo (refresco
     horario, «Actualizar estado» en Seguridad, cambio de usuario) vuelve a leer
     el claim. Solo la última lectura escribe el estado. */
  useEffect(() => {
    if (!FIREBASE_CONFIGURED) {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let lastRead = 0;
    const read = async (user: User | null) => {
      const readId = ++lastRead;
      let admin = false;
      if (user) {
        try {
          const token = await user.getIdTokenResult();
          admin = token.claims?.admin === true;
        } catch {
          // Mantiene `admin` en false si no se puede leer el claim.
        }
      }
      if (!cancelled && readId === lastRead) setState({ isAdmin: admin, resolved: true });
    };
    const subscribe = async () => {
      const [{ auth }, { onIdTokenChanged }] = await Promise.all([import("../firebase"), import("firebase/auth")]);
      if (cancelled) return;
      if (!auth) {
        setState({ isAdmin: false, resolved: true });
        return;
      }
      unsubscribe = onIdTokenChanged(auth, (user) => void read(user));
    };
    void subscribe();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return state;
}
