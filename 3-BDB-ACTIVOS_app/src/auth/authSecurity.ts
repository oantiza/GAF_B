export function firebaseAuthErrorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

const CORREO_SIN_FORMA = "Revisa el correo: no tiene forma de dirección (nombre@empresa.com).";

function esCorreoSinForma(code: string): boolean {
  return code.includes("invalid-email") || code.includes("missing-email");
}

function sonCredenciales(code: string): boolean {
  return code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found");
}

/**
 * Qué campos del acceso señala un error: los dos si son las credenciales, solo el correo si está mal escrito, y
 * ninguno si es la red, los intentos o la configuración (no es culpa de lo que se ha escrito).
 */
export function camposDelErrorDeAcceso(error: unknown): "credenciales" | "correo" | null {
  const code = firebaseAuthErrorCode(error);
  if (sonCredenciales(code)) return "credenciales";
  if (esCorreoSinForma(code)) return "correo";
  return null;
}

/** «Restablecer contraseña» no está iniciando sesión: su error no lo dice. */
export function passwordResetErrorMessage(error: unknown): string {
  const code = firebaseAuthErrorCode(error);
  if (esCorreoSinForma(code)) return CORREO_SIN_FORMA;
  if (code.includes("too-many-requests") || code.includes("network-request-failed") || code.includes("user-disabled")) {
    return authErrorMessage(error);
  }
  return code
    ? `No se pudo enviar el enlace para cambiar la contraseña (${code}). Vuelve a intentarlo y, si se repite, avisa a administración.`
    : "No se pudo enviar el enlace para cambiar la contraseña. Vuelve a intentarlo.";
}

export function authErrorMessage(error: unknown): string {
  const code = firebaseAuthErrorCode(error);
  if (sonCredenciales(code)) {
    return "El correo o la contraseña no son correctos.";
  }
  if (esCorreoSinForma(code)) {
    return CORREO_SIN_FORMA;
  }
  if (code.includes("invalid-verification-code") || code.includes("invalid-multi-factor-session")) {
    return "El código no es válido o ha caducado.";
  }
  if (code.includes("too-many-requests")) {
    return "Se han realizado demasiados intentos. Espera unos minutos y vuelve a probar.";
  }
  if (code.includes("network-request-failed")) {
    return "No se pudo conectar con el servicio de acceso. Revisa la conexión.";
  }
  if (code.includes("user-disabled")) {
    return "Esta cuenta está deshabilitada. Contacta con administración.";
  }
  if (code.includes("popup-blocked")) {
    return "El navegador ha bloqueado la ventana de Google. Permite ventanas emergentes para este sitio y vuelve a intentarlo.";
  }
  if (code.includes("account-exists-with-different-credential")) {
    return "Ya existe una cuenta con ese correo con otro método de acceso. Entra con tu correo y contraseña.";
  }
  if (code.includes("admin-restricted-operation")) {
    return "Esta cuenta no está dada de alta. El acceso es solo por invitación.";
  }
  // Los códigos anteriores son los previsibles. Cualquier otro
  // (`unauthorized-domain`, `operation-not-allowed`, App Check…) apunta a una
  // configuración del proyecto, no a las credenciales: se muestra el código
  // para que quien lo sufre no se quede a ciegas.
  return code
    ? `No se pudo iniciar sesión: ${code}. No es la contraseña, es la configuración del acceso.`
    : "No se pudo iniciar sesión. Vuelve a intentarlo.";
}

export function accountSecurityErrorMessage(error: unknown): string {
  const code = firebaseAuthErrorCode(error);
  if (code.includes("requires-recent-login")) {
    return "Por seguridad, cierra la sesión y vuelve a entrar antes de repetir esta operación.";
  }
  if (code.includes("invalid-verification-code") || code.includes("code-expired")) {
    return "El código de seis dígitos no es válido o ha caducado.";
  }
  if (code.includes("unverified-email")) {
    return "Verifica primero el correo electrónico de la cuenta.";
  }
  if (code.includes("operation-not-allowed") || code.includes("unsupported-first-factor")) {
    return "La verificación en dos pasos todavía no está disponible para esta cuenta.";
  }
  if (code.includes("too-many-requests")) {
    return "Se han realizado demasiadas solicitudes. Espera unos minutos y vuelve a intentarlo.";
  }
  if (code.includes("network-request-failed")) {
    return "No se pudo conectar con Firebase. Revisa la conexión.";
  }
  return "No se pudo completar la operación de seguridad.";
}

export function normalizeTotpCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isCompleteTotpCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}
