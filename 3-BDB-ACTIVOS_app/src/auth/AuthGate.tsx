import { lazy, Suspense, useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import type {
  Auth,
  getMultiFactorResolver,
  MultiFactorAssertion,
  MultiFactorError,
  MultiFactorResolver,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  User
} from "firebase/auth";
import { APUNTA_A_BDB, FIREBASE_CONFIGURED, PRODUCCION_SIN_CONFIGURAR } from "../firebaseEnv";
import { REQUIRE_EMAIL_VERIFIED } from "../config/runtimeConfig";
import { appLogger } from "../core/appLogger";
import { NOMBRE_DE_LA_CASA } from "../core/marca";
import { Button } from "../components/ui/Button";
import { AuthSessionContext, type AuthSessionContextValue } from "./AuthSessionContext";
import {
  authErrorMessage,
  camposDelErrorDeAcceso,
  firebaseAuthErrorCode,
  isCompleteTotpCode,
  normalizeTotpCode,
  passwordResetErrorMessage
} from "./authSecurity";
import {
  almacenDelNavegador,
  escribirUltimaActividad,
  haCaducadoLaSesion,
  olvidarUltimaActividad
} from "./cierrePorInactividad";
import { VigilanteDeInactividad } from "./VigilanteDeInactividad";
import { clearPortfolioStorage } from "../core/localPortfolioStorage";
import { clearImprovementResult } from "../core/improvementResultStore";
import { clearSessionCaches } from "../core/sessionCaches";
import "../styles/components.css";
import "../styles/modules.css";

/**
 * Claves de sesión sin función de borrado alcanzable desde aquí: la selección
 * del comparador (`src/core/comparisonSelection.ts`) y la última tarea de
 * Operaciones (`src/adapters/opsLocalBackend.ts`, módulo de administración que
 * no debe entrar en la carga inicial). Los favoritos se quedan: son
 * preferencias. `tests/authGateSessionCleanup.test.tsx` comprueba que estas
 * claves son las que leen esos módulos.
 */
const SESSION_STORAGE_KEYS = ["bdb-activos.comparison-selection.v1", "bdb.ops.last-task"] as const;

/**
 * Lo que la sesión deja en el almacenamiento del navegador y sobrevive a una
 * recarga: la cartera activa, las guardadas en el navegador, el último
 * resultado de «Mejorar cartera» (ALTA-21, auditoría 14-10-2026), la selección
 * del comparador y la última tarea de Operaciones. Se borra al cerrar sesión o
 * al cambiar de usuario, nunca en la primera resolución de la sesión: recargar
 * la página no debe perder el borrador. Por eso no va en `clearSessionCaches`,
 * que también corre al arrancar.
 */
function clearPersistedSessionData(): void {
  if (typeof window === "undefined") return;
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      clearPortfolioStorage(storage);
      SESSION_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
    }
  } catch {
    // Storage can be unavailable in hardened/private browser modes.
  }
  clearImprovementResult();
}

const AccountSecurityDialog = lazy(() =>
  import("./AccountSecurityDialog").then((module) => ({ default: module.AccountSecurityDialog }))
);

interface AuthRuntime {
  auth: Auth;
  createTotpSignInAssertion: (enrollmentId: string, oneTimePassword: string) => MultiFactorAssertion;
  getEnrolledFactorCount: (user: User) => number;
  getMultiFactorResolver: typeof getMultiFactorResolver;
  onAuthStateChanged: typeof onAuthStateChanged;
  /** Recarga el usuario y fuerza un token nuevo (con `email_verified` al día). */
  reloadUser: (user: User) => Promise<void>;
  sendEmailVerification: (user: User) => Promise<void>;
  sendPasswordResetEmail: typeof sendPasswordResetEmail;
  signInWithEmailAndPassword: typeof signInWithEmailAndPassword;
  signInWithGoogle: () => Promise<unknown>;
  signOut: typeof signOut;
  totpFactorId: string;
}

async function loadAuthRuntime(): Promise<AuthRuntime | null> {
  const [{ auth }, authApi] = await Promise.all([import("../firebase"), import("firebase/auth")]);
  if (!auth) {
    return null;
  }

  return {
    auth,
    createTotpSignInAssertion: authApi.TotpMultiFactorGenerator.assertionForSignIn,
    getEnrolledFactorCount: (user) => authApi.multiFactor(user).enrolledFactors.length,
    getMultiFactorResolver: authApi.getMultiFactorResolver,
    onAuthStateChanged: authApi.onAuthStateChanged,
    reloadUser: async (user) => {
      await authApi.reload(user);
      await user.getIdToken(true);
    },
    sendEmailVerification: (user) => authApi.sendEmailVerification(user),
    sendPasswordResetEmail: authApi.sendPasswordResetEmail,
    signInWithEmailAndPassword: authApi.signInWithEmailAndPassword,
    // No crea cuentas nuevas por sí solo: con el registro desactivado en el
    // proyecto, un Google sin cuenta previa recibe admin-restricted-operation.
    signInWithGoogle: () => authApi.signInWithPopup(auth, new authApi.GoogleAuthProvider()),
    signOut: authApi.signOut,
    totpFactorId: authApi.TotpMultiFactorGenerator.FACTOR_ID
  };
}

/**
 * Puerta de autenticacion.
 * - Si NO hay config de Firebase (local sin backend): no exige login, la app funciona en modo local.
 * - Si hay config: exige login con una cuenta existente antes de mostrar la app.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<AuthRuntime | null>(null);
  const [loading, setLoading] = useState(FIREBASE_CONFIGURED);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!FIREBASE_CONFIGURED) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    loadAuthRuntime()
      .then((loaded) => {
        if (!cancelled) {
          setRuntime(loaded);
        }
      })
      .catch((cause: unknown) => {
        // Auditoría 27-07 (D4): sin este catch, un fallo al cargar el módulo de
        // autenticación (red, CDN) dejaba runtime a null y la app se mostraba
        // SIN puerta de login en vez de ofrecer reintentar.
        appLogger.error("auth: no se pudo cargar el módulo de acceso", cause);
        if (!cancelled) {
          setRuntime(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  if (APUNTA_A_BDB) {
    /*
     * La configuracion apunta a la base de datos de BDB. No se abre la aplicacion ni en
     * desarrollo: este clon no toca BDB, y el 02-11-2026 se vio lo facil que es pegar el
     * bloque de configuracion equivocado desde la consola.
     */
    return (
      <main className="auth-screen">
        <div className="auth-card" role="alert">
          <span className="auth-brand">{NOMBRE_DE_LA_CASA}</span>
          <h1>Esta versión apunta a la base de datos de BDB</h1>
          <p className="auth-subtitle">
            <code>VITE_FIREBASE_PROJECT_ID</code> es el proyecto de BDB, que este programa no
            toca nunca. Cámbialo por el proyecto propio y vuelve a construir. No se abre nada
            hasta entonces.
          </p>
        </div>
      </main>
    );
  }

  if (PRODUCCION_SIN_CONFIGURAR) {
    /*
     * Una build de produccion sin backend configurado NO abre la aplicacion. Dejar pasar es
     * lo correcto en local -ahi no hay nada que proteger y el backend es el de
     * demostracion- y es la aplicacion entera abierta en internet, con nombres de clientes
     * dentro. Medido el 02-11-2026: `.env.production` no fija el proyecto, asi que este caso
     * es el que sale de construir hoy, no una hipotesis.
     */
    return (
      <main className="auth-screen">
        <div className="auth-card" role="alert">
          <span className="auth-brand">{NOMBRE_DE_LA_CASA}</span>
          <h1>Esta versión no tiene servidor configurado</h1>
          <p className="auth-subtitle">
            Se ha construido sin las variables de Firebase, así que no hay autenticación ni
            base de datos. No se abre la aplicación: una versión así dejaría los datos de
            clientes sin sesión. Configura <code>VITE_FIREBASE_API_KEY</code> y{" "}
            <code>VITE_FIREBASE_PROJECT_ID</code> y vuelve a construir.
          </p>
        </div>
      </main>
    );
  }

  if (!FIREBASE_CONFIGURED) {
    return <>{children}</>;
  }

  if (loading) {
    return <main className="auth-screen"><RegionDeEstado className="auth-loading" texto="Cargando acceso…" /></main>;
  }

  if (!runtime) {
    // Con Firebase configurado, "sin runtime" solo puede ser un fallo de carga:
    // pantalla de reintento, nunca la app en abierto.
    return (
      <main className="auth-screen">
        <div className="auth-card" role="alert">
          <span className="auth-brand">{NOMBRE_DE_LA_CASA}</span>
          <h1>No se pudo cargar el acceso</h1>
          <p className="auth-subtitle">
            Falló la carga del módulo de autenticación (conexión o red). Comprueba tu conexión y reinténtalo.
          </p>
          <button className="auth-submit" type="button" onClick={() => setLoadAttempt((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  return <AuthGateInner runtime={runtime}>{children}</AuthGateInner>;
}

function AuthGateInner({ children, runtime }: { children: ReactNode; runtime: AuthRuntime }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [accountSecurity, setAccountSecurity] = useState({ emailVerified: false, mfaEnrolled: false });
  const [cerradaPorInactividad, setCerradaPorInactividad] = useState(false);

  useEffect(() => {
    let previousUid: string | null | undefined;
    let disposed = false;
    let generation = 0;
    let primeraRespuesta = true;
    const unsubscribe = runtime.onAuthStateChanged(runtime.auth, (u) => {
      const esLaPrimera = primeraRespuesta;
      primeraRespuesta = false;
      const uidChanged = previousUid !== u?.uid;
      if (uidChanged) {
        clearSessionCaches();
        if (previousUid !== undefined) {
          clearPersistedSessionData();
        }
        previousUid = u?.uid ?? null;
        setSecurityOpen(false);
      }
      /* Decisión 46. La hora de la última actividad decide tres cosas: una sesión que venía de antes y lleva 30 minutos sin
         usarse (el portátil dormido, el navegador cerrado) no llega a pintarse; entrar cuenta como actividad; y sin sesión,
         una hora que no ha caducado no significa nada, y si se quedara, un rato después diría que se cerró por inactividad. */
      const almacen = almacenDelNavegador();
      const caducada = haCaducadoLaSesion(Date.now(), almacen);
      if (u && esLaPrimera && caducada) {
        clearPersistedSessionData();
        void Promise.resolve(runtime.signOut(runtime.auth)).catch((causa: unknown) => {
          appLogger.warn("auth: no se pudo cerrar una sesión caducada", causa);
          setCerradaPorInactividad(true);
          setUser(null);
          setLoading(false);
        });
        return;
      }
      if (u && !esLaPrimera && uidChanged) escribirUltimaActividad(almacen, Date.now());
      if (!u && !caducada) olvidarUltimaActividad(almacen);
      const current = ++generation;
      const settle = () => {
        if (disposed || current !== generation) return;
        setUser(u);
        setAccountSecurity({
          emailVerified: u?.emailVerified ?? false,
          mfaEnrolled: u ? runtime.getEnrolledFactorCount(u) > 0 : false
        });
        if (u) {
          setCerradaPorInactividad(false);
        } else {
          setSecurityOpen(false);
          /* La hora sigue caducada si la ha cerrado otra pestaña, o si se recarga el acceso: también lo dice. */
          if (caducada) setCerradaPorInactividad(true);
        }
        setLoading(false);
      };
      /* R-05: al arrancar, el SDK recarga el usuario (emailVerified al día) pero
         no renueva el token, que puede decir email_verified: false durante una
         hora; el backend mira el token. Se renueva antes de dejar pasar. */
      if (REQUIRE_EMAIL_VERIFIED && u?.emailVerified) {
        if (uidChanged) setLoading(true);
        void ensureVerifiedToken(u).finally(settle);
      } else {
        settle();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [runtime]);

  const session: AuthSessionContextValue | null = user
    ? {
        uid: user.uid,
        email: user.email,
        emailVerified: accountSecurity.emailVerified,
        mfaEnrolled: accountSecurity.mfaEnrolled,
        openSecurity: () => setSecurityOpen(true),
        signOut: () => {
          clearSessionCaches();
          setSecurityOpen(false);
          clearPersistedSessionData();
          olvidarUltimaActividad(almacenDelNavegador());
          void runtime.signOut(runtime.auth);
        }
      }
    : null;

  /* Sin preguntar por lo que no esté guardado, y es lo que Óscar aceptó: el aviso ya lo ha dicho y nadie ha respondido. La
     pantalla se va en el acto, aunque el cierre tarde o falle: una sesión que no se cierra del todo se vuelve a cerrar al
     recargar, porque la hora sigue caducada. */
  const cerrarPorInactividad = useCallback(() => {
    clearSessionCaches();
    setSecurityOpen(false);
    clearPersistedSessionData();
    setCerradaPorInactividad(true);
    setUser(null);
    void Promise.resolve(runtime.signOut(runtime.auth)).catch((causa: unknown) => {
      appLogger.warn("auth: no se pudo cerrar la sesión por inactividad", causa);
    });
  }, [runtime]);

  if (loading) {
    return <main className="auth-screen"><RegionDeEstado className="auth-loading" texto="Comprobando sesión…" /></main>;
  }
  if (!user) {
    return <LoginScreen cerradaPorInactividad={cerradaPorInactividad} runtime={runtime} />;
  }
  if (!session) {
    return null;
  }
  /* MEDIA-07 (auditoría 16-10-2026): el backend rechaza toda callable de una
     cuenta sin correo verificado; antes se entraba y todo fallaba después. */
  if (REQUIRE_EMAIL_VERIFIED && !accountSecurity.emailVerified) {
    return (
      <>
        <VerifyEmailScreen
          runtime={runtime}
          user={user}
          onVerified={() => setAccountSecurity((current) => ({ ...current, emailVerified: true }))}
          onSignOut={session.signOut}
        />
        <VigilanteDeInactividad alCerrar={cerrarPorInactividad} />
      </>
    );
  }
  return (
    <AuthSessionContext.Provider key={user.uid} value={session}>
      {children}
      {securityOpen ? (
        <Suspense fallback={null}>
          <AccountSecurityDialog
            auth={runtime.auth}
            user={user}
            onAccountChanged={setAccountSecurity}
            onClose={() => setSecurityOpen(false)}
          />
        </Suspense>
      ) : null}
      <VigilanteDeInactividad alCerrar={cerrarPorInactividad} />
    </AuthSessionContext.Provider>
  );
}

/**
 * MAR-24 · Una región viva que nace ya con su texto no la anuncian muchos lectores de pantalla: anuncian lo que CAMBIA
 * dentro de una región que ya estaba. Así que la región se monta vacía y el texto entra en el pintado siguiente; y donde
 * el texto va y viene (el aviso del acceso), la región se queda montada y cambia solo lo de dentro. Vacía, `.auth-vivo`
 * sale del flujo (modules.css). Comprobarlo de verdad pide un lector: tests/authGateRegionesVivas.test.tsx mira que el
 * texto llega a una región que ya existía.
 */
function RegionDeEstado({
  texto,
  className,
  claseDelTexto
}: {
  texto: string | null;
  className: string;
  claseDelTexto?: string;
}) {
  const [mostrado, setMostrado] = useState<string | null>(null);
  useEffect(() => {
    setMostrado(texto);
  }, [texto]);
  const contenido = mostrado && claseDelTexto ? <div className={claseDelTexto}>{mostrado}</div> : mostrado;
  return (
    <div className={className} role="status">
      {contenido}
    </div>
  );
}

/** Si la cuenta ya está verificada pero el token aún no lo dice, pide uno nuevo. */
async function ensureVerifiedToken(user: User): Promise<void> {
  try {
    const token = await user.getIdTokenResult();
    if (token.claims.email_verified !== true) {
      await user.getIdToken(true);
    }
  } catch (cause) {
    // Sin token renovado se entra igual: el backend dirá lo que falte.
    appLogger.warn("auth: no se pudo comprobar el token de la sesión", cause);
  }
}

function VerifyEmailScreen({
  runtime,
  user,
  onVerified,
  onSignOut
}: {
  runtime: AuthRuntime;
  user: User;
  onVerified: () => void;
  onSignOut: () => void;
}) {
  const [busy, setBusy] = useState<"send" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const email = user.email ?? "esta cuenta";

  async function sendLink() {
    setBusy("send");
    setError(null);
    setNotice(null);
    try {
      await runtime.sendEmailVerification(user);
      setNotice(`Enlace enviado a ${email}. Si no aparece, revisa también el correo no deseado.`);
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function checkVerified() {
    setBusy("check");
    setError(null);
    setNotice(null);
    try {
      await runtime.reloadUser(user);
      if (user.emailVerified) {
        onVerified();
        return;
      }
      setNotice("El correo todavía no consta como verificado. Abre el enlace del mensaje y vuelve a comprobarlo.");
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <span className="auth-brand">{NOMBRE_DE_LA_CASA}</span>
        <h1>Verifica tu correo electrónico</h1>
        <p className="auth-subtitle">
          La cuenta {email} todavía no tiene el correo verificado y, hasta entonces, el servidor no atiende sus
          consultas. Envía el enlace, ábrelo desde tu correo y vuelve aquí para comprobarlo.
        </p>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        <RegionDeEstado className="auth-vivo" claseDelTexto="auth-success" texto={notice} />
        <Button variant="primary" onClick={() => void checkVerified()} busy={busy === "check"} disabled={busy !== null}>
          {busy === "check" ? "Comprobando…" : "Ya lo he verificado"}
        </Button>
        <Button variant="secondary" onClick={() => void sendLink()} busy={busy === "send"} disabled={busy !== null}>
          {busy === "send" ? "Enviando…" : "Enviar enlace de verificación"}
        </Button>
        <Button variant="quiet" onClick={onSignOut} disabled={busy !== null}>
          Cerrar sesión
        </Button>
      </div>
    </main>
  );
}

function LoginScreen({ runtime, cerradaPorInactividad }: { runtime: AuthRuntime; cerradaPorInactividad: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(cerradaPorInactividad ? "Sesión cerrada por inactividad" : null);
  const [busy, setBusy] = useState(false);
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  /* Qué campos señala el error: solo los que lo explican. Un fallo de red no es culpa de lo escrito. */
  const [camposConError, setCamposConError] = useState<"credenciales" | "correo" | null>(null);
  const errorId = useId();

  function handleSignInError(err: unknown) {
    const code = firebaseAuthErrorCode(err);
    setCamposConError(camposDelErrorDeAcceso(err));
    if (code === "auth/multi-factor-auth-required") {
      const resolver = runtime.getMultiFactorResolver(runtime.auth, err as MultiFactorError);
      const hasTotp = resolver.hints.some((hint) => hint.factorId === runtime.totpFactorId);
      if (hasTotp) {
        setPassword("");
        setMfaCode("");
        setMfaResolver(resolver);
      } else {
        setError("La cuenta utiliza un segundo factor no compatible con esta aplicación.");
      }
      return;
    }
    // Cerrar la ventana de Google no es un error del usuario: silencio.
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      return;
    }
    setError(authErrorMessage(err));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await runtime.signInWithEmailAndPassword(runtime.auth, email, password);
    } catch (err) {
      handleSignInError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitGoogle() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await runtime.signInWithGoogle();
    } catch (err) {
      handleSignInError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaResolver || !isCompleteTotpCode(mfaCode)) {
      setError("Introduce el código de seis dígitos.");
      return;
    }
    const hint = mfaResolver.hints.find((candidate) => candidate.factorId === runtime.totpFactorId);
    if (!hint) {
      setError("No se encontró el segundo factor de la cuenta.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const assertion = runtime.createTotpSignInAssertion(hint.uid, mfaCode);
      await mfaResolver.resolveSignIn(assertion);
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setCamposConError("correo");
      setError("Introduce primero el correo electrónico.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await runtime.sendPasswordResetEmail(runtime.auth, normalizedEmail);
      setNotice("Si la cuenta existe, recibirá un enlace para cambiar la contraseña.");
    } catch (nextError) {
      if (firebaseAuthErrorCode(nextError) === "auth/user-not-found") {
        setNotice("Si la cuenta existe, recibirá un enlace para cambiar la contraseña.");
      } else {
        setCamposConError(camposDelErrorDeAcceso(nextError));
        setError(passwordResetErrorMessage(nextError));
      }
    } finally {
      setBusy(false);
    }
  }

  if (mfaResolver) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={submitMfa}>
          <span className="auth-brand">{NOMBRE_DE_LA_CASA}</span>
          <h1>Verificación en dos pasos</h1>
          <p className="auth-subtitle">Introduce el código de tu aplicación de autenticación.</p>
          <label className="auth-field auth-totp-field">
            <span className="ui-field-label">Código de seis dígitos</span>
            <input
              autoComplete="one-time-code"
              autoFocus
              inputMode="numeric"
              maxLength={6}
              type="text"
              value={mfaCode}
              onChange={(event) => setMfaCode(normalizeTotpCode(event.target.value))}
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
            />
          </label>
          {error ? <div className="auth-error" role="alert" id={errorId}>{error}</div> : null}
          <button className="auth-submit" type="submit" disabled={busy || !isCompleteTotpCode(mfaCode)} aria-busy={busy || undefined}>
            {busy ? "Verificando…" : "Verificar"}
          </button>
          <button
            className="auth-reset-link"
            type="button"
            onClick={() => {
              setMfaResolver(null);
              setMfaCode("");
              setError(null);
            }}
          >
            Volver al acceso
          </button>
        </form>
      </main>
    );
  }

  const correoConError = Boolean(error) && camposConError !== null;
  const claveConError = Boolean(error) && camposConError === "credenciales";

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <span className="auth-brand">{NOMBRE_DE_LA_CASA}</span>
        <h1>Acceso de asesor</h1>
        <p className="auth-subtitle">Introduce tus credenciales para continuar.</p>
        <label className="auth-field">
          <span className="ui-field-label">Correo electrónico</span>
          <input autoComplete="email" autoFocus type="email" placeholder="nombre@empresa.com" value={email}
            onChange={(event) => setEmail(event.target.value)} required aria-invalid={correoConError}
            aria-describedby={correoConError ? errorId : undefined} />
        </label>
        <label className="auth-field">
          <span className="ui-field-label">Contraseña</span>
          <input autoComplete="current-password" type="password" placeholder="Contraseña" value={password}
            onChange={(event) => setPassword(event.target.value)} required minLength={6} aria-invalid={claveConError}
            aria-describedby={claveConError ? errorId : undefined} />
        </label>
        {error ? <div className="auth-error" role="alert" id={errorId}>{error}</div> : null}
        <RegionDeEstado className="auth-vivo" claseDelTexto="auth-success" texto={notice} />
        <button className="auth-submit" type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Accediendo…" : "Entrar"}
        </button>
        <div className="auth-divider" role="separator" aria-label="u otro método de acceso">
          <span>o</span>
        </div>
        <button className="auth-google" type="button" onClick={() => void submitGoogle()} disabled={busy}>
          <svg className="auth-google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continuar con Google
        </button>
        <button className="auth-reset-link" type="button" onClick={() => void requestPasswordReset()} disabled={busy}>
          Restablecer contraseña
        </button>
      </form>
    </main>
  );
}
