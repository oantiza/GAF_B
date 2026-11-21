import { createContext, useContext } from "react";

export interface AuthSessionContextValue {
  /** El identificador del usuario de la sesión: lo que no cambia aunque cambie su correo. */
  uid: string;
  email: string | null;
  emailVerified: boolean;
  mfaEnrolled: boolean;
  openSecurity: () => void;
  signOut: () => void;
}

export const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function useAuthSession() {
  return useContext(AuthSessionContext);
}
