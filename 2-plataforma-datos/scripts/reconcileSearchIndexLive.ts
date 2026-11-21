import * as fs from 'fs';
import * as path from 'path';
import { isDeepStrictEqual } from 'node:util';
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import { validators } from '../contracts/validators';
import { entryFromRoot, SEARCH_INDEX_SCHEMA_VERSION } from '../src/loader/searchIndex';
import {
  SEARCH_INDEX_WRITE_MAX_ATTEMPTS,
  SearchIndexConcurrentModificationError,
  writeSearchIndexWithPrecondition,
} from '../src/loader/searchIndexWrite';
import { ALLOWED_PROJECT_ID } from '../src/config/projectAllowlist';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

const PROJECT_ID = ALLOWED_PROJECT_ID;
const APPROVAL = 'YES_I_UNDERSTAND_MASTER_DB_WRITES';
const WRITE_GATE = 'BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES';
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function byId(entries: unknown): Map<string, unknown> {
  const rows = Array.isArray(entries) ? entries as Array<Record<string, unknown>> : [];
  return new Map(rows.filter((row) => row.id).map((row) => [String(row.id), row]));
}

export function assertSearchIndexWriteGate(write: boolean, env: NodeJS.ProcessEnv = process.env): void {
  if (write && env[WRITE_GATE] !== APPROVAL) {
    throw new Error(`Gate cerrado: ${WRITE_GATE}`);
  }
}

export async function reconcileSearchIndexLive(
  db: admin.firestore.Firestore,
  write: boolean,
  env: NodeJS.ProcessEnv = process.env,
  attempt = 1
): Promise<boolean> {
  assertSearchIndexWriteGate(write, env);
  // El indice se lee ANTES que las raices: la precondicion de la escritura cubre todo lo que se
  // construye despues. Si otro escritor lo cambia entretanto, se vuelve a empezar (H06).
  const ref = db.doc('meta/search_index');
  const currentSnap = await ref.get();
  const roots = await db.collection('assets').get();
  const entries = roots.docs
    .filter((snapshot) => ISIN_RE.test(snapshot.id) && snapshot.data()?.quality?.status !== 'ARCHIVED_LEGACY')
    .map((snapshot) => entryFromRoot(snapshot.id, snapshot.data()))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.id.localeCompare(right.id));
  const payload = {
    schema_version: SEARCH_INDEX_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    count: entries.length,
    entries,
  };
  const validation = validators.masterSearchIndex(payload);
  if (!validation.ok) throw new Error(validation.errors.map((error) => `${error.instancePath} ${error.message}`).join('; '));

  const current = currentSnap.data() || {};
  const expectedIds = byId(payload.entries);
  const currentIds = byId(current.entries);
  const missing = [...expectedIds.keys()].filter((id) => !currentIds.has(id)).sort();
  const unknown = [...currentIds.keys()].filter((id) => !expectedIds.has(id)).sort();
  const changed = [...expectedIds.keys()].filter((id) => currentIds.has(id) && !isDeepStrictEqual(expectedIds.get(id), currentIds.get(id))).sort();
  const needsWrite = missing.length > 0 || unknown.length > 0 || changed.length > 0 || current.count !== payload.count;
  if (!write || !needsWrite) return false;
  try {
    await writeSearchIndexWithPrecondition(ref, currentSnap, payload);
    return true;
  } catch (error) {
    if (!(error instanceof SearchIndexConcurrentModificationError) || attempt >= SEARCH_INDEX_WRITE_MAX_ATTEMPTS) throw error;
    return reconcileSearchIndexLive(db, write, env, attempt + 1);
  }
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  assertSearchIndexWriteGate(write);
  if (write && flag('--approval') !== APPROVAL) throw new Error('Aprobacion de escritura ausente.');
  const projectId = process.env.FIREBASE_PROJECT_ID || PROJECT_ID;
  if (projectId !== PROJECT_ID) throw new Error(`Project id fuera de allowlist: ${projectId}`);
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const roots = await db.collection('assets').get();
  const entries = roots.docs
    .filter((snapshot) => ISIN_RE.test(snapshot.id) && snapshot.data()?.quality?.status !== 'ARCHIVED_LEGACY')
    .map((snapshot) => entryFromRoot(snapshot.id, snapshot.data()))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.id.localeCompare(right.id));
  const payload = {
    schema_version: SEARCH_INDEX_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    count: entries.length,
    entries,
  };
  const validation = validators.masterSearchIndex(payload);
  if (!validation.ok) throw new Error(validation.errors.map((error) => `${error.instancePath} ${error.message}`).join('; '));

  const ref = db.doc('meta/search_index');
  const currentSnap = await ref.get();
  const current = currentSnap.data() || {};
  const expectedIds = byId(payload.entries);
  const currentIds = byId(current.entries);
  const missing = [...expectedIds.keys()].filter((id) => !currentIds.has(id)).sort();
  const unknown = [...currentIds.keys()].filter((id) => !expectedIds.has(id)).sort();
  const changed = [...expectedIds.keys()].filter((id) => currentIds.has(id) && !isDeepStrictEqual(expectedIds.get(id), currentIds.get(id))).sort();
  const needsWrite = missing.length > 0 || unknown.length > 0 || changed.length > 0 || current.count !== payload.count;
  const applied = await reconcileSearchIndexLive(db, write);

  const summary = {
    mode: write ? 'WRITE' : 'DRY_RUN',
    root_reads: roots.size,
    current_count: currentIds.size,
    expected_count: payload.count,
    missing,
    unknown,
    changed,
    needs_write: needsWrite,
    applied,
  };
  const outDir = path.join(process.cwd(), 'runs', `search_index_reconcile_${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...summary, output_dir: outDir }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
