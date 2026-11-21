// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Auth, User } from "firebase/auth";

/* B5 (auditoría 29-09): tras verificar el correo el diálogo hacía `reload(user)`
   y decía «Verificado», pero el token de ID seguía sin el claim
   `email_verified` que exige el backend (functions_python/main.py), así que
   todas las callables fallaban hasta que caducara el token (≤ 1 h). Tras
   `reload` hay que forzar `getIdToken(true)`; lo mismo al inscribir o retirar
   el TOTP, que también cambia los claims de segundo factor. */

const firebaseAuth = vi.hoisted(() => {
  const enrolledFactors: { uid: string; factorId: string; displayName?: string }[] = [];
  return {
    enrolledFactors,
    reload: vi.fn(async () => undefined),
    sendEmailVerification: vi.fn(async () => undefined),
    sendPasswordResetEmail: vi.fn(async () => undefined),
    enroll: vi.fn(async () => undefined),
    unenroll: vi.fn(async () => undefined),
    getSession: vi.fn(async () => ({}))
  };
});

vi.mock("firebase/auth", () => ({
  reload: firebaseAuth.reload,
  sendEmailVerification: firebaseAuth.sendEmailVerification,
  sendPasswordResetEmail: firebaseAuth.sendPasswordResetEmail,
  multiFactor: () => ({
    enrolledFactors: firebaseAuth.enrolledFactors,
    enroll: firebaseAuth.enroll,
    unenroll: firebaseAuth.unenroll,
    getSession: firebaseAuth.getSession
  }),
  TotpMultiFactorGenerator: {
    FACTOR_ID: "totp",
    generateSecret: vi.fn(async () => ({ secretKey: "ABCDEFGHIJKLMNOP", generateQrCodeUrl: () => "otpauth://totp/x" })),
    assertionForEnrollment: vi.fn(() => ({}))
  }
}));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") } }));

import { AccountSecurityDialog } from "../src/auth/AccountSecurityDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function makeUser(): User & { getIdToken: ReturnType<typeof vi.fn> } {
  const user = {
    uid: "uid-1",
    email: "oscar@example.com",
    emailVerified: false,
    getIdToken: vi.fn(async () => "token")
  };
  return user as unknown as User & { getIdToken: ReturnType<typeof vi.fn> };
}

async function mount(user: User, onAccountChanged = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AccountSecurityDialog auth={{} as Auth} user={user} onAccountChanged={onAccountChanged} onClose={() => {}} />);
  });
  return { onAccountChanged };
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`No hay botón «${label}»`);
  return found as HTMLButtonElement;
}

beforeEach(() => {
  firebaseAuth.enrolledFactors.length = 0;
  firebaseAuth.reload.mockClear();
  firebaseAuth.enroll.mockClear();
  firebaseAuth.unenroll.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  document.body.innerHTML = "";
});

describe("AccountSecurityDialog refresca el token de ID tras cambiar la cuenta", () => {
  test("«Actualizar estado»: tras reload fuerza getIdToken(true) antes de anunciar «Verificado»", async () => {
    const user = makeUser();
    firebaseAuth.reload.mockImplementationOnce(async () => {
      (user as { emailVerified: boolean }).emailVerified = true;
    });
    const { onAccountChanged } = await mount(user);
    expect(document.body.textContent).toContain("Pendiente");

    await act(async () => { button("Actualizar estado").click(); });

    expect(firebaseAuth.reload).toHaveBeenCalledTimes(1);
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(firebaseAuth.reload.mock.invocationCallOrder[0]).toBeLessThan(user.getIdToken.mock.invocationCallOrder[0]);
    expect(onAccountChanged).toHaveBeenCalledWith({ emailVerified: true, mfaEnrolled: false });
    expect(document.body.textContent).toContain("Verificado");
    expect(document.body.textContent).toContain("Estado de la cuenta actualizado.");
  });

  test("si el refresco del token falla, el diálogo lo dice en vez de anunciar «Verificado»", async () => {
    const user = makeUser();
    firebaseAuth.reload.mockImplementationOnce(async () => {
      (user as { emailVerified: boolean }).emailVerified = true;
    });
    user.getIdToken.mockRejectedValueOnce(Object.assign(new Error("network"), { code: "auth/network-request-failed" }));
    const { onAccountChanged } = await mount(user);

    await act(async () => { button("Actualizar estado").click(); });

    expect(onAccountChanged).not.toHaveBeenCalled();
    expect(document.body.querySelector("[role=\"alert\"]")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Estado de la cuenta actualizado.");
  });

  test("retirar el TOTP también fuerza el refresco del token", async () => {
    const user = makeUser();
    (user as { emailVerified: boolean }).emailVerified = true;
    firebaseAuth.enrolledFactors.push({ uid: "factor-1", factorId: "totp", displayName: "Aplicación de autenticación" });
    firebaseAuth.reload.mockImplementationOnce(async () => {
      firebaseAuth.enrolledFactors.length = 0;
    });
    const { onAccountChanged } = await mount(user);

    await act(async () => { button("Desactivar").click(); });
    await act(async () => { button("Confirmar").click(); });

    expect(firebaseAuth.unenroll).toHaveBeenCalledWith("factor-1");
    expect(firebaseAuth.reload).toHaveBeenCalledTimes(1);
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(onAccountChanged).toHaveBeenCalledWith({ emailVerified: true, mfaEnrolled: false });
  });

  test("inscribir el TOTP fuerza el refresco del token", async () => {
    const user = makeUser();
    (user as { emailVerified: boolean }).emailVerified = true;
    firebaseAuth.reload.mockImplementationOnce(async () => {
      firebaseAuth.enrolledFactors.push({ uid: "factor-1", factorId: "totp", displayName: "Aplicación de autenticación" });
    });
    const { onAccountChanged } = await mount(user);

    await act(async () => { button("Activar").click(); });
    const code = document.body.querySelector("input[inputmode=\"numeric\"]") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(code, "123456");
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Confirmar código").click(); });

    expect(firebaseAuth.enroll).toHaveBeenCalledTimes(1);
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(onAccountChanged).toHaveBeenCalledWith({ emailVerified: true, mfaEnrolled: true });
  });

  test("MAR-31: el código de seis dígitos se confirma con Intro, como en el acceso", async () => {
    const user = makeUser();
    (user as { emailVerified: boolean }).emailVerified = true;
    await mount(user);

    await act(async () => { button("Activar").click(); });
    const code = document.body.querySelector("input[inputmode=\"numeric\"]") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(code, "123456");
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Intro en un campo de un formulario lo envía; aquí se envía el formulario del propio campo.
    const formulario = code.closest("form");
    expect(formulario).not.toBeNull();
    expect(button("Confirmar código").getAttribute("type")).toBe("submit");
    expect(button("Confirmar código").getAttribute("form")).toBe(formulario!.id);
    await act(async () => {
      formulario!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(firebaseAuth.enroll).toHaveBeenCalledTimes(1);
  });
});
