import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Firestore } from "firebase/firestore";
import type { FirebaseApp } from "firebase/app";
import type { CommercialRetroImportPreviewRow } from "../src/types/commercialRetro";

// Opt-in integration suite. The demo prefix and loopback guards precede every connection.
describe.skipIf(process.env.BDB_TEST_EMULATORS !== "1")("commercial imports against actual Firestore rules", () => {
  let store: typeof import("../src/adapters/commercialRetroStore");
  let db: Firestore;
  let app: FirebaseApp;
  const isin = (n: number) => `IE${String(n).padStart(10, "0")}`;
  beforeAll(async () => {
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-bdb-audit";
    const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "";
    if (!projectId.startsWith("demo-") || ![firestoreHost, authHost].every((host) => /^(127\.0\.0\.1|localhost):\d+$/.test(host))) {
      throw new Error("Integration tests require demo- project and loopback emulators.");
    }
    const appApi = await import("firebase/app");
    const authApi = await import("firebase/auth");
    const fs = await import("firebase/firestore");
    app = appApi.initializeApp({ apiKey: "demo-key", projectId }, "retro-audit");
    db = fs.getFirestore(app);
    const auth = authApi.getAuth(app);
    const [host, port] = firestoreHost.split(":");
    fs.connectFirestoreEmulator(db, host, Number(port));
    authApi.connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const now = Math.floor(Date.now() / 1000);
    const token = [
      { alg: "none", typ: "JWT" },
      { iss: "owner", sub: "owner", aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit", iat: now, exp: now + 3600, uid: "retro-integration-admin", claims: { admin: true } }
    ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".";
    await authApi.signInWithCustomToken(auth, token);
    vi.doMock("../src/firebase", () => ({ auth, firestore: db }));
    store = await import("../src/adapters/commercialRetroStore");
    await Promise.all(Array.from({ length: 45 }, async (_, n) => {
      const response = await fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/assets/${isin(n)}`, {
        method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { asset_id: { stringValue: isin(n) } } })
      });
      if (!response.ok) throw new Error(`Emulator seed failed: ${response.status}`);
    }));
  }, 30_000);
  afterAll(async () => {
    if (db) await (await import("firebase/firestore")).terminate(db);
    if (app) await (await import("firebase/app")).deleteApp(app);
    vi.doUnmock("../src/firebase");
  });
  test("45 writes and their receipts commit in three transactions; exact timestamps support undo", async () => {
    const rows: CommercialRetroImportPreviewRow[] = Array.from({ length: 45 }, (_, n) => ({
      action: "CREATE", changes: [], entry: { isin: isin(n), retro_pct: 0.6, as_of_date: "2026-09-05", line_number: n + 1 }
    }));
    const result = await store.applyCommercialRetroImport(rows, { as_of_date: "2026-09-05", scale: "porcentaje", replace_all: false });
    expect(result).toMatchObject({ written: 45, batches: 3 });
    const run = await store.getLastCommercialRetroImport();
    expect(run?.applied_isins).toHaveLength(45);
    expect(await store.undoCommercialRetroImport(run!)).toEqual({ restored: 0, deleted: 45 });
    expect(await store.getCommercialRetroByIsin(isin(0))).toBeNull();
  }, 30_000);
  test("a later edit is preserved by transactional undo", async () => {
    await store.applyCommercialRetroImport([{ action: "CREATE", changes: [], entry: { isin: isin(0), retro_pct: 0.6, as_of_date: "2026-09-05", line_number: 1 } }], { as_of_date: "2026-09-05", scale: "porcentaje", replace_all: false });
    const run = await store.getLastCommercialRetroImport();
    await store.saveCommercialRetro({ isin: isin(0), retro_pct: 0.9, as_of_date: "2026-09-05", source: "ADMIN_UI" });
    await expect(store.undoCommercialRetroImport(run!)).rejects.toThrow("cambió después");
    expect((await store.getCommercialRetroByIsin(isin(0)))?.retro_pct).toBe(0.9);
  }, 30_000);
  test("pending unknown zero survives import undo and can be explicitly confirmed", async () => {
    const id = isin(44);
    await store.saveCommercialRetro({ isin: id, retro_pct: 0, status: "PENDING_CONFIRMATION", as_of_date: "2026-09-28", source: "FILE_IMPORT" });
    const pending = await store.getCommercialRetroByIsin(id);
    expect(pending?.status).toBe("PENDING_CONFIRMATION");
    await store.applyCommercialRetroImport([{ action: "UPDATE", changes: ["valor"], existing: pending!, entry: { isin: id, retro_pct: .5, as_of_date: "2026-09-28", line_number: 1 } }], { as_of_date: "2026-09-28", scale: "porcentaje", replace_all: false });
    await store.undoCommercialRetroImport((await store.getLastCommercialRetroImport())!);
    expect((await store.getCommercialRetroByIsin(id))?.status).toBe("PENDING_CONFIRMATION");
    await store.saveCommercialRetro({ isin: id, retro_pct: 0, as_of_date: "2026-09-28", source: "ADMIN_UI" });
    expect((await store.getCommercialRetroByIsin(id))?.status).toBe("CONFIRMED");
    const fs = await import("firebase/firestore");
    await expect(fs.updateDoc(fs.doc(db, "commercial_retro", id), { status: "INVALID", updated_at: fs.serverTimestamp() })).rejects.toThrow();
  }, 30_000);
  // S-09 (auditoría 29-09): topes de tamaño en note/source.
  test("S-09: una nota de más de 2.000 caracteres o un source largo quedan fuera de las reglas", async () => {
    const id = isin(43);
    await expect(store.saveCommercialRetro({ isin: id, retro_pct: 0.5, as_of_date: "2026-09-30", source: "ADMIN_UI", note: "x".repeat(2001) })).rejects.toThrow();
    await store.saveCommercialRetro({ isin: id, retro_pct: 0.5, as_of_date: "2026-09-30", source: "ADMIN_UI", note: "x".repeat(2000) });
    expect((await store.getCommercialRetroByIsin(id))?.note).toHaveLength(2000);
    const fs = await import("firebase/firestore");
    await expect(fs.updateDoc(fs.doc(db, "commercial_retro", id), { source: "S".repeat(201), updated_at: fs.serverTimestamp() })).rejects.toThrow();
  }, 30_000);
  // S-09 (auditoría 29-09): la foto de importación nace en partial y nunca sale de undone.
  test("S-09: commercial_retro_imports solo admite partial -> applied/undone y applied -> undone", async () => {
    const fs = await import("firebase/firestore");
    const receipt = (import_id: string, status: string) => ({ import_id, created_by: "test", status, previous: {}, applied: {}, created_at: fs.serverTimestamp() });
    await expect(fs.setDoc(fs.doc(db, "commercial_retro_imports", "s09-a"), receipt("s09-a", "applied"))).rejects.toThrow();
    await expect(fs.setDoc(fs.doc(db, "commercial_retro_imports", "s09-b"), receipt("s09-b", "partial"))).resolves.toBeUndefined();
    await expect(fs.updateDoc(fs.doc(db, "commercial_retro_imports", "s09-b"), { status: "applied" })).resolves.toBeUndefined();
    await expect(fs.updateDoc(fs.doc(db, "commercial_retro_imports", "s09-b"), { status: "partial" })).rejects.toThrow();
    await expect(fs.updateDoc(fs.doc(db, "commercial_retro_imports", "s09-b"), { status: "undone" })).resolves.toBeUndefined();
    await expect(fs.updateDoc(fs.doc(db, "commercial_retro_imports", "s09-b"), { status: "applied" })).rejects.toThrow();
    await expect(fs.updateDoc(fs.doc(db, "commercial_retro_imports", "s09-b"), { error: "tarde" })).rejects.toThrow();
    await expect(fs.setDoc(fs.doc(db, "commercial_retro_imports", "s09-c"), receipt("s09-c", "partial"))).resolves.toBeUndefined();
    await expect(fs.updateDoc(fs.doc(db, "commercial_retro_imports", "s09-c"), { status: "undone" })).resolves.toBeUndefined();
  }, 30_000);
});
