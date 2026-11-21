import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CommercialRetroImportPreviewRow, CommercialRetroImportRun, CommercialRetroRecord } from "../src/types/commercialRetro";

const db = vi.hoisted(() => ({
  currentUser: { uid: "admin", email: "admin@test.local" } as { uid: string; email?: string } | null,
  docs: new Map<string, Record<string, unknown>>(), commits: 0, failCommit: 0, stamp: 0,
  getDoc: vi.fn(), getDocs: vi.fn()
}));
vi.mock("../src/firebase", () => ({ auth: db, firestore: {} }));
interface Ref { path: string }
const snapshot = (ref: Ref) => ({ id: ref.path.split("/").at(-1)!, exists: () => db.docs.has(ref.path), data: () => db.docs.get(ref.path)! });
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (_db: unknown, name: string, id: string) => ({ path: `${name}/${id}` }),
  query: (ref: Ref) => ref, orderBy: vi.fn(), limit: vi.fn(),
  serverTimestamp: () => `version-${db.stamp}`,
  getDoc: (...args: unknown[]) => db.getDoc(...args),
  getDocs: (...args: unknown[]) => db.getDocs(...args),
  setDoc: async (ref: Ref, data: Record<string, unknown>) => { db.docs.set(ref.path, structuredClone(data)); },
  updateDoc: async (ref: Ref, data: Record<string, unknown>) => { db.docs.set(ref.path, { ...db.docs.get(ref.path), ...data }); },
  deleteDoc: async (ref: Ref) => { db.docs.delete(ref.path); },
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<unknown>) => {
    db.stamp += 1;
    const writes: Array<() => void> = [];
    const result = await callback({
      get: async (ref: Ref) => snapshot(ref),
      set: (ref: Ref, data: Record<string, unknown>) => writes.push(() => { db.docs.set(ref.path, data); }),
      update: (ref: Ref, data: Record<string, unknown>) => writes.push(() => { db.docs.set(ref.path, { ...db.docs.get(ref.path), ...data }); }),
      delete: (ref: Ref) => writes.push(() => { db.docs.delete(ref.path); })
    });
    db.commits += 1;
    if (db.commits === db.failCommit) throw new Error("fallo simulado");
    writes.forEach((write) => write());
    return result;
  }
}));
import { applyCommercialRetroImport, undoCommercialRetroImport, getCommercialRetroByIsin,
  getCommercialRetroList, invalidateCommercialRetroCache, COMMERCIAL_RETRO_CACHE_TTL_MS,
  COMMERCIAL_RETRO_BATCH_SIZE, parseCommercialRetroImportRun, timestampToIso
} from "../src/adapters/commercialRetroStore";
import { clearSessionCaches } from "../src/core/sessionCaches";

const isin = (n: number) => `LU${String(n).padStart(10, "0")}`;
const record = (n = 1, retro_pct = 0.45): CommercialRetroRecord => ({ isin: isin(n), retro_pct, as_of_date: "2026-09-05", source: "ADMIN_UI" });
const meta = { as_of_date: "2026-09-05", scale: "porcentaje" as const, replace_all: false };
function row(n: number, action: CommercialRetroImportPreviewRow["action"] = "CREATE", existing?: CommercialRetroRecord): CommercialRetroImportPreviewRow {
  return { action, existing, entry: { isin: isin(n), retro_pct: 0.6, as_of_date: meta.as_of_date, line_number: n }, changes: [] };
}
function currentRun(): CommercialRetroImportRun {
  const [path, data] = [...db.docs].find(([path]) => path.startsWith("commercial_retro_imports/"))!;
  return parseCommercialRetroImportRun(path.split("/")[1], data)!;
}
beforeEach(() => {
  db.currentUser = { uid: "admin" }; db.docs.clear(); db.commits = 0; db.failCommit = 0; db.stamp = 0;
  invalidateCommercialRetroCache();
  db.getDoc.mockReset().mockImplementation(async (ref: Ref) => snapshot(ref));
  db.getDocs.mockReset().mockImplementation(async () => ({ forEach: (cb: (snap: ReturnType<typeof snapshot>) => void) => {
    [...db.docs.keys()].filter((path) => path.startsWith("commercial_retro/")).forEach((path) => cb(snapshot({ path })));
  } }));
});
afterEach(() => vi.useRealTimers());

describe("commercial retro cache", () => {
  test("preserves timestamp context and nanosecond revisions", async () => {
    const value = { seconds: 1, nanoseconds: 234, toDate() { return new Date(this.seconds * 1000); } };
    expect(timestampToIso(value)).toBe("1970-01-01T00:00:01.000Z");
    db.docs.set(`commercial_retro/${isin(1)}`, { ...record(), updated_at: value });
    expect((await getCommercialRetroByIsin(isin(1)))?.revision).toBe("1:234");
  });
  test("expires the entire generation after TTL", async () => {
    vi.useFakeTimers(); db.docs.set(`commercial_retro/${isin(1)}`, { ...record() });
    await getCommercialRetroList(); await getCommercialRetroList(); expect(db.getDocs).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(COMMERCIAL_RETRO_CACHE_TTL_MS + 1);
    await getCommercialRetroList(); expect(db.getDocs).toHaveBeenCalledTimes(2);
  });
  test("never shares cached commercial data with another user or signed-out session", async () => {
    db.docs.set(`commercial_retro/${isin(1)}`, { ...record() }); await getCommercialRetroList();
    db.currentUser = { uid: "other" }; db.getDoc.mockRejectedValue(new Error("permission-denied"));
    await expect(getCommercialRetroByIsin(isin(1))).rejects.toThrow("permission-denied");
    db.currentUser = null; expect(await getCommercialRetroList()).toEqual([]);
    expect(await getCommercialRetroByIsin(isin(1))).toBeNull();
  });
  test("forced refresh clears deleted records and negative lookups", async () => {
    db.docs.set(`commercial_retro/${isin(1)}`, { ...record() }); await getCommercialRetroList();
    await getCommercialRetroByIsin(isin(2));
    db.docs.delete(`commercial_retro/${isin(1)}`); db.docs.set(`commercial_retro/${isin(2)}`, { ...record(2) });
    await getCommercialRetroList(true);
    expect(await getCommercialRetroByIsin(isin(1))).toBeNull();
    expect((await getCommercialRetroByIsin(isin(2)))?.retro_pct).toBe(0.45);
  });
  test("a response in flight cannot revive a cleared session cache", async () => {
    let resolve!: (value: unknown) => void;
    db.getDoc.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = getCommercialRetroByIsin(isin(1)); clearSessionCaches();
    resolve({ exists: () => true, id: isin(1), data: () => record() });
    expect(await pending).toBeNull();
    expect(await getCommercialRetroByIsin(isin(1))).toBeNull();
  });
});

describe("transactional imports and undo", () => {
  test("writes 21 assets in two rule-compatible commits with atomic receipts", async () => {
    expect(COMMERCIAL_RETRO_BATCH_SIZE).toBe(20);
    const result = await applyCommercialRetroImport(Array.from({ length: 21 }, (_, n) => row(n)), meta);
    expect(result).toMatchObject({ written: 21, deleted: 0, batches: 2 });
    expect(currentRun()).toMatchObject({ status: "applied", schema_version: 2, applied_batches: 2 });
    expect(currentRun().applied_isins).toHaveLength(21);
  });
  test("undo restores updates and deletes only entries actually committed before a failure", async () => {
    db.docs.set(`commercial_retro/${isin(0)}`, { ...record(0) });
    const rows = Array.from({ length: 25 }, (_, n) => row(n)); rows[0] = row(0, "UPDATE", record(0));
    db.failCommit = 2;
    await expect(applyCommercialRetroImport(rows, meta)).rejects.toThrow("Se confirmaron 20 de 25");
    const run = currentRun(); expect(run.status).toBe("partial"); expect(run.applied_isins).toHaveLength(20);
    // A planned but uncommitted ISIN created independently must survive undo.
    db.docs.set(`commercial_retro/${isin(24)}`, { ...record(24, 0.9) });
    expect(await undoCommercialRetroImport(run)).toEqual({ restored: 1, deleted: 19 });
    expect(db.docs.get(`commercial_retro/${isin(0)}`)?.retro_pct).toBe(0.45);
    expect(db.docs.get(`commercial_retro/${isin(24)}`)?.retro_pct).toBe(0.9);
    expect(currentRun().status).toBe("undone");
    await expect(undoCommercialRetroImport(run)).rejects.toThrow("ya se deshizo");
  });
  test("undo refuses later edits even when the value was changed back to the imported value", async () => {
    await applyCommercialRetroImport([row(1)], meta);
    const path = `commercial_retro/${isin(1)}`;
    db.docs.set(path, { ...db.docs.get(path), updated_at: "later-version" });
    await expect(undoCommercialRetroImport(currentRun())).rejects.toThrow("cambió después");
    expect(db.docs.get(path)?.updated_at).toBe("later-version");
    expect(currentRun().undone_isins).toEqual([]);
  });
  test("stale preview cannot overwrite a concurrent edit", async () => {
    db.docs.set(`commercial_retro/${isin(1)}`, { ...record(1, 0.9) });
    await expect(applyCommercialRetroImport([row(1, "UPDATE", record())], meta)).rejects.toThrow("cambió después de la vista previa");
    expect(db.docs.get(`commercial_retro/${isin(1)}`)?.retro_pct).toBe(0.9);
    expect(currentRun().applied_isins).toEqual([]);
  });
  test("partial undo resumes from its receipt without overwriting already restored entries", async () => {
    await applyCommercialRetroImport(Array.from({ length: 21 }, (_, n) => row(n)), meta);
    db.failCommit = 4;
    await expect(undoCommercialRetroImport(currentRun())).rejects.toThrow("fallo simulado");
    expect(currentRun().undone_isins).toHaveLength(20);
    db.docs.set(`commercial_retro/${isin(0)}`, { ...record(0, 0.9) });
    expect(await undoCommercialRetroImport(currentRun())).toEqual({ restored: 0, deleted: 1 });
    expect(db.docs.get(`commercial_retro/${isin(0)}`)?.retro_pct).toBe(0.9);
  });
  /* ALTA-09 (auditoría 16-10-2026): el recibo no guardaba el estado aplicado y
     el deshacer lo leía como CONFIRMED. */
  test("el recibo guarda el estado aplicado y el deshacer de una fila PENDING la borra", async () => {
    const pendiente = { ...row(1), entry: { ...row(1).entry, status: "PENDING_CONFIRMATION" as const } };
    await applyCommercialRetroImport([pendiente], meta);
    expect(db.docs.get(`commercial_retro/${isin(1)}`)?.status).toBe("PENDING_CONFIRMATION");
    expect(currentRun().applied[isin(1)]).toMatchObject({ status: "PENDING_CONFIRMATION" });
    expect(await undoCommercialRetroImport(currentRun())).toEqual({ restored: 0, deleted: 1 });
    expect(db.docs.has(`commercial_retro/${isin(1)}`)).toBe(false);
  });
  test("confirmar por importación una fila PENDING y deshacer la devuelve a PENDING", async () => {
    const pendiente: CommercialRetroRecord = { ...record(1), status: "PENDING_CONFIRMATION" };
    db.docs.set(`commercial_retro/${isin(1)}`, { ...pendiente });
    await applyCommercialRetroImport([row(1, "UPDATE", pendiente)], meta);
    expect(db.docs.get(`commercial_retro/${isin(1)}`)?.status).toBe("CONFIRMED");
    expect(currentRun().applied[isin(1)]).toMatchObject({ status: "CONFIRMED" });
    expect(await undoCommercialRetroImport(currentRun())).toEqual({ restored: 1, deleted: 0 });
    expect(db.docs.get(`commercial_retro/${isin(1)}`)?.status).toBe("PENDING_CONFIRMATION");
  });
  test("legacy receipts require manual review and never write", async () => {
    db.docs.set("commercial_retro_imports/legacy", { import_id: "legacy", as_of_date: meta.as_of_date, previous: { [isin(1)]: null }, applied: {}, status: "partial" });
    await expect(undoCommercialRetroImport(currentRun())).rejects.toThrow("revisión manual");
    expect(db.commits).toBe(0);
  });
});
