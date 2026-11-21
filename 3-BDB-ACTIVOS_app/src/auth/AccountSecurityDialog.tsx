import { useState } from "react";
import QRCode from "qrcode";
import {
  multiFactor,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  TotpMultiFactorGenerator
} from "firebase/auth";
import type { Auth, MultiFactorInfo, TotpSecret, User } from "firebase/auth";
import { Button } from "../components/ui/Button";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "../components/ui/ModalDialog";
import { NOMBRE_DE_LA_CASA } from "../core/marca";
import {
  accountSecurityErrorMessage,
  isCompleteTotpCode,
  normalizeTotpCode
} from "./authSecurity";

interface AccountSecurityDialogProps {
  auth: Auth;
  user: User;
  onAccountChanged: (snapshot: { emailVerified: boolean; mfaEnrolled: boolean }) => void;
  onClose: () => void;
}

type BusyAction = "refresh" | "verify-email" | "reset-password" | "start-totp" | "finish-totp" | "remove-totp" | null;
type View = "overview" | "enroll-totp";

function factorLabel(factor: MultiFactorInfo): string {
  return factor.displayName || (factor.factorId === TotpMultiFactorGenerator.FACTOR_ID
    ? "Aplicación de autenticación"
    : "Segundo factor");
}

function formatSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/**
 * B5 (auditoría 29-09): `reload(user)` refresca el perfil pero NO el token de
 * ID, y el backend exige el claim `email_verified` en el token
 * (functions_python/main.py). Sin forzar el refresco, el diálogo decía
 * «Verificado» y todas las callables fallaban hasta que caducara el token
 * (≤ 1 h). Lo mismo al inscribir o retirar el TOTP, que cambia los claims de
 * segundo factor. Si el refresco falla, se propaga: mejor un error visible que
 * anunciar un estado que el backend aún no reconoce.
 */
async function reloadAndRefreshToken(user: User): Promise<void> {
  await reload(user);
  await user.getIdToken(true);
}

export function AccountSecurityDialog({ auth, user, onAccountChanged, onClose }: AccountSecurityDialogProps) {
  const [emailVerified, setEmailVerified] = useState(user.emailVerified);
  const [factors, setFactors] = useState<MultiFactorInfo[]>(() => [...multiFactor(user).enrolledFactors]);
  const [view, setView] = useState<View>("overview");
  const [totpSecret, setTotpSecret] = useState<TotpSecret | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function beginAction(action: BusyAction) {
    setBusy(action);
    setError(null);
    setMessage(null);
  }

  async function refreshAccount() {
    beginAction("refresh");
    try {
      await reloadAndRefreshToken(user);
      const nextFactors = [...multiFactor(user).enrolledFactors];
      setEmailVerified(user.emailVerified);
      setFactors(nextFactors);
      onAccountChanged({ emailVerified: user.emailVerified, mfaEnrolled: nextFactors.length > 0 });
      setMessage("Estado de la cuenta actualizado.");
    } catch (nextError) {
      setError(accountSecurityErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function sendVerification() {
    beginAction("verify-email");
    try {
      await sendEmailVerification(user);
      setMessage("Correo de verificación enviado.");
    } catch (nextError) {
      setError(accountSecurityErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function sendPasswordReset() {
    if (!user.email) {
      setError("La cuenta no tiene un correo asociado.");
      return;
    }
    beginAction("reset-password");
    try {
      await sendPasswordResetEmail(auth, user.email);
      setMessage("Enlace para cambiar la contraseña enviado.");
    } catch (nextError) {
      setError(accountSecurityErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function startTotpEnrollment() {
    if (!emailVerified) {
      setError("Verifica primero el correo electrónico de la cuenta.");
      return;
    }
    beginAction("start-totp");
    try {
      const session = await multiFactor(user).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      const uri = secret.generateQrCodeUrl(user.email || user.uid, NOMBRE_DE_LA_CASA);
      const image = await QRCode.toDataURL(uri, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 220,
        color: { dark: "#20272E", light: "#FFFFFF" }
      });
      setTotpSecret(secret);
      setQrCode(image);
      setTotpCode("");
      setView("enroll-totp");
    } catch (nextError) {
      setError(accountSecurityErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function finishTotpEnrollment() {
    if (!totpSecret || !isCompleteTotpCode(totpCode)) {
      setError("Introduce el código de seis dígitos de la aplicación.");
      return;
    }
    beginAction("finish-totp");
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, totpCode);
      await multiFactor(user).enroll(assertion, "Aplicación de autenticación");
      await reloadAndRefreshToken(user);
      const nextFactors = [...multiFactor(user).enrolledFactors];
      setFactors(nextFactors);
      setTotpSecret(null);
      setQrCode(null);
      setTotpCode("");
      setView("overview");
      onAccountChanged({ emailVerified: user.emailVerified, mfaEnrolled: nextFactors.length > 0 });
      setMessage("Verificación en dos pasos activada.");
    } catch (nextError) {
      setError(accountSecurityErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function removeFactor(uid: string) {
    beginAction("remove-totp");
    try {
      await multiFactor(user).unenroll(uid);
      await reloadAndRefreshToken(user);
      const nextFactors = [...multiFactor(user).enrolledFactors];
      setFactors(nextFactors);
      setPendingRemoval(null);
      onAccountChanged({ emailVerified: user.emailVerified, mfaEnrolled: nextFactors.length > 0 });
      setMessage("Verificación en dos pasos desactivada.");
    } catch (nextError) {
      setError(accountSecurityErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function copySecret() {
    if (!totpSecret) return;
    try {
      await navigator.clipboard.writeText(totpSecret.secretKey);
      setError(null);
      setMessage("Clave copiada.");
    } catch {
      setError("No se pudo copiar la clave. Selecciónala manualmente.");
    }
  }

  function cancelEnrollment() {
    setTotpSecret(null);
    setQrCode(null);
    setTotpCode("");
    setError(null);
    setMessage(null);
    setView("overview");
  }

  return (
    <ModalDialog
      labelledBy="account-security-title"
      onClose={onClose}
      size="sm"
      className="account-security-dialog"
      closeOnBackdrop={view === "overview"}
    >
      <DialogHeader
        titleId="account-security-title"
        eyebrow="Cuenta"
        title={view === "overview" ? "Seguridad de acceso" : "Activar verificación en dos pasos"}
        onClose={onClose}
      />
      <DialogBody className="account-security-body">
        {view === "overview" ? (
          <>
            <div className="account-security-identity">
              <span>Cuenta</span>
              <strong>{user.email || "Sin correo"}</strong>
            </div>

            {error ? <p className="account-security-feedback is-error" role="alert">{error}</p> : null}
            {message ? <p className="account-security-feedback is-success" role="status">{message}</p> : null}

            <section className="account-security-section" aria-labelledby="security-email-title">
              <div className="account-security-section-head">
                <div>
                  <h3 id="security-email-title">Correo electrónico</h3>
                  <p>{emailVerified ? "Dirección verificada" : "Verificación pendiente"}</p>
                </div>
                <span className={`account-security-status ${emailVerified ? "is-ok" : "is-pending"}`}>
                  {emailVerified ? "Verificado" : "Pendiente"}
                </span>
              </div>
              <div className="account-security-actions">
                {!emailVerified ? (
                  <Button size="sm" onClick={() => void sendVerification()} busy={busy === "verify-email"}>
                    Enviar verificación
                  </Button>
                ) : null}
                <Button variant="quiet" size="sm" onClick={() => void refreshAccount()} busy={busy === "refresh"}>
                  Actualizar estado
                </Button>
              </div>
            </section>

            <section className="account-security-section" aria-labelledby="security-password-title">
              <div className="account-security-section-head">
                <div>
                  <h3 id="security-password-title">Contraseña</h3>
                  <p>Cambio mediante enlace seguro</p>
                </div>
              </div>
              <div className="account-security-actions">
                <Button size="sm" onClick={() => void sendPasswordReset()} busy={busy === "reset-password"}>
                  Enviar enlace
                </Button>
              </div>
            </section>

            <section className="account-security-section" aria-labelledby="security-mfa-title">
              <div className="account-security-section-head">
                <div>
                  <h3 id="security-mfa-title">Verificación en dos pasos</h3>
                  <p>{factors.length > 0 ? factorLabel(factors[0]) : "Sin segundo factor"}</p>
                </div>
                <span className={`account-security-status ${factors.length > 0 ? "is-ok" : "is-neutral"}`}>
                  {factors.length > 0 ? "Activa" : "Inactiva"}
                </span>
              </div>
              {factors.length === 0 ? (
                <div className="account-security-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void startTotpEnrollment()}
                    disabled={!emailVerified}
                    busy={busy === "start-totp"}
                  >
                    Activar
                  </Button>
                </div>
              ) : factors.map((factor) => (
                <div className="account-security-factor" key={factor.uid}>
                  <span>{factorLabel(factor)}</span>
                  {pendingRemoval === factor.uid ? (
                    <span className="account-security-factor-actions">
                      <Button variant="quiet" size="sm" onClick={() => setPendingRemoval(null)}>Cancelar</Button>
                      <Button variant="danger" size="sm" onClick={() => void removeFactor(factor.uid)} busy={busy === "remove-totp"}>
                        Confirmar
                      </Button>
                    </span>
                  ) : (
                    <Button variant="quiet" size="sm" onClick={() => setPendingRemoval(factor.uid)}>Desactivar</Button>
                  )}
                </div>
              ))}
            </section>
          </>
        ) : (
          /* Un formulario para que Intro en el código lo confirme, como en el acceso. El botón vive en el pie y se
             asocia por `form`. */
          <form
            className="account-totp-enrollment"
            id="account-totp-enrollment-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (isCompleteTotpCode(totpCode) && busy !== "finish-totp") void finishTotpEnrollment();
            }}
          >
            {error ? <p className="account-security-feedback is-error" role="alert">{error}</p> : null}
            {message ? <p className="account-security-feedback is-success" role="status">{message}</p> : null}
            {qrCode && totpSecret ? (
              <>
                <img className="account-totp-qr" src={qrCode} alt="Código QR para la aplicación de autenticación" />
                <div className="account-totp-secret">
                  <span>Clave manual</span>
                  <div>
                    <code>{formatSecret(totpSecret.secretKey)}</code>
                    <button type="button" aria-label="Copiar clave" title="Copiar clave" onClick={() => void copySecret()}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <rect x="8" y="8" width="11" height="11" rx="1" />
                        <path d="M16 8V5H5v11h3" />
                      </svg>
                    </button>
                  </div>
                </div>
                <label className="account-totp-code">
                  <span>Código de seis dígitos</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={totpCode}
                    onChange={(event) => setTotpCode(normalizeTotpCode(event.target.value))}
                    autoFocus
                  />
                </label>
              </>
            ) : null}
          </form>
        )}
      </DialogBody>
      <DialogFooter>
        {view === "overview" ? (
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={cancelEnrollment} disabled={busy === "finish-totp"}>Cancelar</Button>
            <Button
              variant="primary"
              type="submit"
              form="account-totp-enrollment-form"
              disabled={!isCompleteTotpCode(totpCode)}
              busy={busy === "finish-totp"}
            >
              Confirmar código
            </Button>
          </>
        )}
      </DialogFooter>
    </ModalDialog>
  );
}
