/// <reference types="vite/client" />
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getToken as getAppCheckToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
} from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";
import {
  EMULATOR_HOSTS,
  firebaseConfig,
  FIREBASE_CONFIGURED,
  FUNCTIONS_REGION,
  USE_EMULATORS
} from "./firebaseEnv";

declare global {
  interface Window {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  }
}

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let functionsInstance: Functions | null = null;
let appCheckWarmup: Promise<void> = Promise.resolve();

if (FIREBASE_CONFIGURED) {
  app = initializeApp(firebaseConfig);
  const appCheckDisabled = import.meta.env.VITE_FIREBASE_APPCHECK_DISABLED === "true";
  const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
  const appCheckProvider = import.meta.env.VITE_FIREBASE_APPCHECK_PROVIDER || "enterprise";
  const appCheckDebugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;

  if (!appCheckDisabled && appCheckSiteKey && !USE_EMULATORS) {
    // S-03 (auditoría 29-09): el token de depuración de App Check solo tiene
    // sentido en desarrollo; en producción se ignora aunque la variable exista
    // (antes se horneaba en el bundle y se activaba en cualquier build).
    if (import.meta.env.DEV && appCheckDebugToken) {
      window.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken === "true" ? true : appCheckDebugToken;
    }
    // S6a (§5): el export `appCheck` no tenía ningún consumidor; la LLAMADA
    // se conserva — registra App Check en la app y es lo que protege el resto.
    const appCheckInstance = initializeAppCheck(app, {
      provider: appCheckProvider === "recaptcha-v3"
        ? new ReCaptchaV3Provider(appCheckSiteKey)
        : new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    // Observación 25-08→31-08 (APPCHECK_OBSERVACION_2026-09-01): ~la mitad de
    // las callables de las pantallas densas salían SIN token — las primeras
    // llamadas de la carga ganaban la carrera al intercambio de reCAPTCHA.
    // Calentamos el token una vez al arrancar; callBackend espera este warmup
    // (acotado) antes de la primera llamada.
    appCheckWarmup = getAppCheckToken(appCheckInstance)
      .then(() => undefined)
      .catch(() => undefined);
  }
  authInstance = getAuth(app);
  firestoreInstance = getFirestore(app);
  functionsInstance = getFunctions(app, FUNCTIONS_REGION);

  // Clon Gestor Activos Financieros: la base de datos del proyecto es el
  // emulador local. Sin esto la app solo sabe hablar con la nube y se queda
  // en la pantalla de acceso. `disableWarnings` evita el banner naranja que
  // Firebase pinta sobre la interfaz en cada carga.
  if (USE_EMULATORS) {
    connectAuthEmulator(authInstance, EMULATOR_HOSTS.auth, { disableWarnings: true });
    const [firestoreHost, firestorePort] = EMULATOR_HOSTS.firestore.split(":");
    connectFirestoreEmulator(firestoreInstance, firestoreHost, Number(firestorePort));
    const [functionsHost, functionsPort] = EMULATOR_HOSTS.functions.split(":");
    connectFunctionsEmulator(functionsInstance, functionsHost, Number(functionsPort));
  }
}

export { app };
export { FIREBASE_CONFIGURED, FUNCTIONS_REGION };
export const auth = authInstance;
export const firestore = firestoreInstance;
export const functions = functionsInstance;

/** Espera acotada al primer token de App Check: nunca resuelve más tarde de
    APPCHECK_WARMUP_MAX_MS aunque reCAPTCHA no responda, y tras el primer
    settle todas las esperas posteriores son inmediatas. */
const APPCHECK_WARMUP_MAX_MS = 4000;
export const appCheckReady: Promise<void> = Promise.race([
  appCheckWarmup,
  new Promise<void>((resolve) => {
    setTimeout(resolve, APPCHECK_WARMUP_MAX_MS);
  })
]);
