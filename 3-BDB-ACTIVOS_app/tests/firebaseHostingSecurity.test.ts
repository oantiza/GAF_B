import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

describe("Firebase Hosting security policy", () => {
  const GATE = "scripts/requireFirebaseDeployApproval.mjs";
  const gate = (proyecto: string | undefined, extra: NodeJS.ProcessEnv = {}) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    delete env.GCLOUD_PROJECT;
    if (proyecto !== undefined) env.GCLOUD_PROJECT = proyecto;
    return spawnSync(process.execPath, [GATE], { env, encoding: "utf8" });
  };

  /* Itera las claves del propio firebase.json: un objetivo nuevo sin puerta rompe esta prueba. */
  it("cada objetivo de despliegue abre con la puerta", () => {
    const desplegables = new Set([
      "hosting", "functions", "firestore", "database", "storage",
      "remoteconfig", "extensions", "dataconnect", "apphosting",
    ]);
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), "firebase.json"), "utf8")) as Record<string, { predeploy?: string[] }>;
    const objetivos = Object.keys(raw).filter((clave) => desplegables.has(clave));
    expect(objetivos.length).toBeGreaterThan(0);
    for (const objetivo of objetivos) {
      expect(raw[objetivo].predeploy?.[0]).toBe(`node ${GATE}`);
    }
  });

  /* Sale con 2: en Windows, cross-spawn convierte una salida 1 en un ENOENT falso. */
  it("desde esta carpeta no se despliega a ningun proyecto, ni al nuevo, y dice adonde ir", () => {
    for (const proyecto of ["bdb-gestor-de-activos", "gestor-activos-local", "un-proyecto-que-aparece-manana"]) {
      const r = gate(proyecto);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("deploy blocked");
      expect(r.stderr).toContain("4-base-nueva");
    }
  });

  it("el proyecto de BDB se rechaza nombrandolo", () => {
    const r = gate("bbdd-activos-financieros");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("EN USO");
  });

  it("falla cerrada: sin proyecto rechaza", () => {
    const r = gate(undefined);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GCLOUD_PROJECT");
  });

  it("la frase de aprobacion antigua ya no abre la puerta", () => {
    const frase = { BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY: "YES_I_UNDERSTAND_SHARED_PROJECT" };
    expect(gate("bdb-gestor-de-activos", frase).status).toBe(2);
    expect(gate("bbdd-activos-financieros", frase).status).toBe(2);
  });

  const config = JSON.parse(readFileSync(resolve(process.cwd(), "firebase.json"), "utf8")) as {
    hosting: { headers: HeaderRule[] };
  };

  it("sets browser hardening headers for every route", () => {
    const global = config.hosting.headers.find((rule) => rule.source === "**");
    const keys = new Set(global?.headers.map((header) => header.key));

    expect(keys).toEqual(new Set([
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
      "Cache-Control"
    ]));
    expect(global?.headers.find((header) => header.key === "Content-Security-Policy")?.value)
      .toContain("frame-ancestors 'none'");
    expect(global?.headers.find((header) => header.key === "Cache-Control")?.value)
      .toBe("no-cache, no-store, max-age=0, must-revalidate");
  });

  it("revalidates HTML and caches fingerprinted assets immutably", () => {
    const index = config.hosting.headers.find((rule) => rule.source === "/index.html");
    const assets = config.hosting.headers.find((rule) => rule.source === "/assets/**");

    expect(index?.headers).toContainEqual({
      key: "Cache-Control",
      value: "no-cache, max-age=0, must-revalidate"
    });
    expect(assets?.headers).toContainEqual({
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable"
    });
  });

  it("permite solo los recursos necesarios para PDF WASM y tipografías", () => {
    const global = config.hosting.headers.find((rule) => rule.source === "**");
    const csp = global?.headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";

    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).toContain("font-src 'self' data:;");
    expect(csp).toContain("connect-src 'self' data:");
  });

  /* S-14 (auditoría 29-09): las letras van autoalojadas (las de pantalla, en src/assets/fuentes-de-pantalla, desde base.css),
     no hay imágenes externas ni Realtime Database; la CSP deja de abrir Google
     Fonts, `img-src https:` y `*.firebaseio.com`. */
  it("S-14: la CSP no abre Google Fonts, imágenes externas ni firebaseio", () => {
    const global = config.hosting.headers.find((rule) => rule.source === "**");
    const csp = global?.headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

    expect(csp).not.toContain("fonts.googleapis.com");
    expect(csp).not.toContain("fonts.gstatic.com");
    expect(csp).not.toContain("firebaseio.com");
    expect(directive("img-src")).toBe("img-src 'self' data:");
    expect(directive("style-src")).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive("font-src")).toBe("font-src 'self' data:");
    expect(directive("connect-src")).not.toMatch(/wss:/);
    // Lo abierto para S-02 y App Check/reCAPTCHA se conserva.
    expect(directive("script-src")).toContain("https://apis.google.com");
    expect(directive("script-src")).toContain("https://www.gstatic.com/recaptcha/");
    expect(directive("frame-src")).toContain("https://www.google.com/recaptcha/");
    expect(directive("frame-src")).toContain("https://bbdd-activos-financieros.firebaseapp.com");
    // Coherencia con el código: las letras de pantalla son ficheros propios, no un servicio de fuera.
    const base = readFileSync(resolve(process.cwd(), "src/styles/base.css"), "utf8");
    const origenes = [...base.matchAll(/@font-face\s*\{[^}]*src:\s*url\("([^"]+)"\)/g)].map((m) => m[1]);
    /* IBM Plex Sans, Plex Mono 400 y 500, y los dos subconjuntos de Source Serif 4 (dirección A, 18-11-2026). */
    expect(origenes.length).toBeGreaterThanOrEqual(5);
    for (const origen of origenes) expect(origen).toMatch(/^\.\.\/assets\/fuentes-de-pantalla\/[a-z-]+\.woff2$/);
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("deja pasar el acceso con Google (S-02, auditoría 29-09): apis.google.com y el iframe del authDomain", () => {
    const global = config.hosting.headers.find((rule) => rule.source === "**");
    const csp = global?.headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

    // signInWithPopup carga https://apis.google.com/js/api.js y el iframe
    // https://<authDomain>/__/auth/iframe; sin ellos el SDK falla con
    // auth/internal-error (confirmado en producción el 30-09).
    expect(directive("script-src")).toContain("https://apis.google.com");
    expect(directive("frame-src")).toContain("https://bbdd-activos-financieros.firebaseapp.com");
  });
});
