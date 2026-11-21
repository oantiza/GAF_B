/// <reference types="vite/client" />

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

/**
 * El proyecto de BDB. Esta aqui para NEGARLO, no para usarlo.
 *
 * La regla que no se rompe en este clon es que nunca se escribe en BDB, y el 02-11-2026 se
 * vio lo facil que es equivocarse: al pedir la configuracion web del proyecto nuevo llego la
 * de BDB, con su `projectId`, y era exactamente la misma que `.env.local.bdb-original`.
 * Cableada, la aplicacion habria leido -y con una sesion de administrador, escrito- la base
 * de datos de produccion de BDB.
 *
 * Nadie se equivoca a proposito: se equivoca copiando el bloque de la pestana que tenia
 * abierta. Asi que el codigo lo comprueba, en vez de confiar en que no vuelva a pasar.
 */
const PROYECTO_DE_BDB = 'bbdd-activos-financieros';

/** true si la configuracion apunta a BDB. La aplicacion no arranca asi. */
export const APUNTA_A_BDB = firebaseConfig.projectId === PROYECTO_DE_BDB;

/**
 * true solo si hay config web de Firebase (en local sin backend, es false y la app funciona
 * en modo local). Apuntar a BDB cuenta como NO configurada: asi no se inicializa nada, ni
 * Firestore ni Auth ni App Check, antes de que el porton llegue a pintar su aviso.
 */
export const FIREBASE_CONFIGURED =
  Boolean(firebaseConfig.apiKey && firebaseConfig.projectId) && !APUNTA_A_BDB;

/**
 * Una build de PRODUCCION sin backend configurado. Tiene que parar la aplicacion.
 *
 * Sin configuracion, `AuthGate` deja pasar a cualquiera -y hace bien: en local la aplicacion
 * funciona contra el backend de demostracion y pedir una sesion que no existe no protegeria
 * nada-. Pero eso mismo en una build servida en internet es la aplicacion entera ABIERTA, sin
 * autenticacion, con el nombre de clientes dentro.
 *
 * Y no era hipotetico: medido el 02-11-2026, `.env.production` no fija
 * `VITE_FIREBASE_PROJECT_ID`, asi que una build de produccion hecha hoy arranca con
 * `FIREBASE_CONFIGURED` en false y se queda en modo local sin decirlo. La unica razon por la
 * que no ha pasado nada es que nunca se ha desplegado.
 *
 * Asi que olvidarse de las variables tiene que ser un error ruidoso y no una puerta abierta.
 */
export const PRODUCCION_SIN_CONFIGURAR = import.meta.env.PROD && !FIREBASE_CONFIGURED;

/** Region de las Cloud Functions (debe coincidir con el backend). */
export const FUNCTIONS_REGION = "europe-west1";

/** Emuladores locales (clon Gestor Activos Financieros).

    La base de datos de este proyecto es el emulador, no una nube. El cableado
    solo se activa en desarrollo: `import.meta.env.DEV` impide que una build de
    produccion pueda apuntar a un emulador aunque la variable quede puesta. */
export const USE_EMULATORS =
  import.meta.env.DEV && import.meta.env.VITE_FIREBASE_USE_EMULATORS === "true";

export const EMULATOR_HOSTS = {
  auth: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL || "http://127.0.0.1:9097",
  firestore: import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST || "127.0.0.1:8082",
  functions: import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5005"
};
