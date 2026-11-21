import { describe, expect, it } from "vitest";
import {
  accountSecurityErrorMessage,
  authErrorMessage,
  camposDelErrorDeAcceso,
  isCompleteTotpCode,
  normalizeTotpCode,
  passwordResetErrorMessage
} from "../src/auth/authSecurity";

describe("account security helpers", () => {
  it("normalizes a pasted TOTP without accepting more than six digits", () => {
    expect(normalizeTotpCode(" 12-34 5678 ")).toBe("123456");
    expect(isCompleteTotpCode("123456")).toBe(true);
    expect(isCompleteTotpCode("12345")).toBe(false);
  });

  it("maps authentication failures to non-sensitive messages", () => {
    expect(authErrorMessage({ code: "auth/invalid-credential" })).toContain("no son correctos");
    expect(authErrorMessage({ code: "auth/invalid-verification-code" })).toContain("código");
  });

  it("maps Google sign-in failures to actionable messages", () => {
    expect(authErrorMessage({ code: "auth/popup-blocked" })).toContain("ventanas emergentes");
    expect(authErrorMessage({ code: "auth/account-exists-with-different-credential" })).toContain("otro método de acceso");
    expect(authErrorMessage({ code: "auth/admin-restricted-operation" })).toContain("invitación");
  });

  it("un correo mal escrito se dice en llano, sin «configuración» ni «iniciar sesión» (MAR-04)", () => {
    for (const code of ["auth/invalid-email", "auth/missing-email"]) {
      expect(authErrorMessage({ code })).toBe("Revisa el correo: no tiene forma de dirección (nombre@empresa.com).");
      expect(passwordResetErrorMessage({ code })).toBe("Revisa el correo: no tiene forma de dirección (nombre@empresa.com).");
    }
    const otro = passwordResetErrorMessage({ code: "auth/unauthorized-domain" });
    expect(otro).not.toContain("iniciar sesión");
    expect(otro).toContain("enlace");
    expect(passwordResetErrorMessage({ code: "auth/network-request-failed" })).toContain("Revisa la conexión");
  });

  it("solo los errores de credenciales señalan los campos (MAR-31)", () => {
    expect(camposDelErrorDeAcceso({ code: "auth/invalid-credential" })).toBe("credenciales");
    expect(camposDelErrorDeAcceso({ code: "auth/wrong-password" })).toBe("credenciales");
    expect(camposDelErrorDeAcceso({ code: "auth/invalid-email" })).toBe("correo");
    expect(camposDelErrorDeAcceso({ code: "auth/network-request-failed" })).toBeNull();
    expect(camposDelErrorDeAcceso({ code: "auth/too-many-requests" })).toBeNull();
  });

  it("requires a recent login for sensitive account changes", () => {
    expect(accountSecurityErrorMessage({ code: "auth/requires-recent-login" })).toContain("vuelve a entrar");
  });
});
