import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as zlib from 'zlib';
import { once } from 'events';
import { pipeline } from 'stream/promises';
import * as admin from 'firebase-admin';
import dotenv from 'dotenv';
import { maintainLocalBackups } from './maintainLocalBackups';
import { ALLOWED_PROJECT_ID } from '../src/config/projectAllowlist';

dotenv.config({ path: path.join(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ quiet: true });

// Clon Gestor Activos Financieros: la base de datos de este proyecto es la suya,
// nunca la de BDB. FORBIDDEN_PROJECT_ID queda como red de seguridad.
const PROJECT_ID = ALLOWED_PROJECT_ID;
const FORBIDDEN_PROJECT_ID = 'bbdd-activos-financieros';
const FORMAT_VERSION = 'bdb-complete-backup.v2';
const LOCK_FILE = '.backup-export.lock';

interface FileManifest {
  file: string;
  kind: 'firestore' | 'firebase_auth';
  root_collection?: string;
  records: number;
  bytes_gzip: number;
  sha256_gzip: string;
}

function runId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface BackupLock {
  fd: number;
  path: string;
}

// Horas tras las que un bloqueo se considera abandonado aunque no se pueda
// comprobar su proceso. Muy por encima de lo que tarda una copia (minutos): el
// margen es para no matar una exportacion viva, no para apurar.
const STALE_LOCK_HOURS = 6;

/** Si el proceso que dejo el bloqueo sigue existiendo. */
function processAlive(pid: number): boolean {
  try {
    // Señal 0: no envia nada, solo comprueba existencia y permisos.
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    // EPERM = existe pero es de otro usuario. Existe, que es lo que se pregunta.
    return error?.code === 'EPERM';
  }
}

/**
 * Bloqueo abandonado: su proceso ya no existe, o es tan viejo que no puede ser
 * una copia en curso.
 *
 * El 07-09-2026 el proceso 39056 murio a mitad de la exportacion sin liberar el
 * bloqueo. Como `acquireBackupLock` solo miraba si el fichero existia, la tarea
 * programada diaria fallo con BACKUP_ALREADY_RUNNING tres dias seguidos y en
 * silencio, hasta que alguien lo retiro a mano. Un bloqueo sirve para no
 * solapar dos copias vivas; si no hay copia viva, no hay nada que proteger.
 */
function staleLock(lockPath: string, nowMs: number): { stale: boolean; reason: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch {
    // Desaparecio entre el EEXIST y esta lectura: otra copia lo libero.
    return { stale: true, reason: 'el bloqueo ya no esta' };
  }
  let parsed: { pid?: unknown; started_at?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { stale: true, reason: 'contenido ilegible' };
  }
  const pid = typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) ? parsed.pid : null;
  if (pid !== null && !processAlive(pid)) {
    return { stale: true, reason: `el proceso ${pid} ya no existe` };
  }
  const startedAt = typeof parsed.started_at === 'string' ? Date.parse(parsed.started_at) : NaN;
  const ageHours = Number.isNaN(startedAt) ? null : (nowMs - startedAt) / 3_600_000;
  if (ageHours !== null && ageHours > STALE_LOCK_HOURS) {
    return { stale: true, reason: `abierto hace ${ageHours.toFixed(1)} h` };
  }
  if (pid === null && ageHours === null) {
    return { stale: true, reason: 'sin pid ni fecha con los que decidir' };
  }
  return { stale: false, reason: pid !== null ? `el proceso ${pid} sigue vivo` : 'reciente' };
}

export function acquireBackupLock(backupsRoot: string, now: Date = new Date()): BackupLock {
  fs.mkdirSync(backupsRoot, { recursive: true });
  const lockPath = path.join(path.resolve(backupsRoot), LOCK_FILE);
  const write = (): BackupLock => {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`, 'utf8');
    return { fd, path: lockPath };
  };
  try {
    return write();
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const verdict = staleLock(lockPath, now.getTime());
    if (!verdict.stale) {
      throw new Error(`BACKUP_ALREADY_RUNNING: existe ${lockPath} (${verdict.reason})`);
    }
    console.log(`[backup] bloqueo abandonado retirado: ${verdict.reason}`);
    fs.rmSync(lockPath, { force: true });
    // Un solo reintento: si vuelve a existir es que otra copia acaba de
    // arrancar de verdad, y entonces si hay que ceder.
    try {
      return write();
    } catch (retry: any) {
      if (retry?.code === 'EEXIST') {
        throw new Error(`BACKUP_ALREADY_RUNNING: existe ${lockPath} (otra copia acaba de tomarlo)`);
      }
      throw retry;
    }
  }
}

export function releaseBackupLock(lock: BackupLock): void {
  try {
    fs.closeSync(lock.fd);
  } finally {
    if (fs.existsSync(lock.path)) fs.unlinkSync(lock.path);
  }
}

function getApp(): admin.app.App {
  const projectId = (process.env.FIREBASE_PROJECT_ID || PROJECT_ID).replace(/^["']|["']$/g, '');
  if (projectId === FORBIDDEN_PROJECT_ID) throw new Error(`Proyecto de BDB prohibido en este clon: ${projectId}`);
  if (projectId !== PROJECT_ID) throw new Error(`Project id fuera de allowlist: ${projectId}`);
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.FIREBASE_SERVICE_ACCOUNT_PATH.replace(/^["']|["']$/g, '');
  }
  return admin.apps[0] || admin.initializeApp({ projectId });
}

function encode(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    return { __bdb_type: 'non_finite_number', value: String(value) };
  }
  if (typeof value === 'bigint') return { __bdb_type: 'bigint', value: value.toString() };
  if (value instanceof Date) return { __bdb_type: 'date', value: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __bdb_type: 'bytes', value: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') {
    const item = value as Record<string, unknown> & {
      toDate?: () => Date;
      latitude?: number;
      longitude?: number;
      path?: string;
      firestore?: unknown;
    };
    if (typeof item.toDate === 'function') {
      const date = item.toDate();
      if (date instanceof Date) {
        return {
          __bdb_type: 'timestamp',
          seconds: String((item as { seconds?: number }).seconds ?? Math.floor(date.getTime() / 1000)),
          nanoseconds: (item as { nanoseconds?: number }).nanoseconds ?? (date.getTime() % 1000) * 1_000_000,
          value: date.toISOString(),
        };
      }
    }
    if (typeof item.latitude === 'number' && typeof item.longitude === 'number') {
      return { __bdb_type: 'geopoint', latitude: item.latitude, longitude: item.longitude };
    }
    if (typeof item.path === 'string' && item.firestore) {
      return { __bdb_type: 'document_reference', path: item.path };
    }
    return Object.fromEntries(
      Object.entries(item)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, encode(nested)])
    );
  }
  return String(value);
}

async function writeLine(stream: fs.WriteStream, value: unknown): Promise<void> {
  if (!stream.write(`${JSON.stringify(value)}\n`)) await once(stream, 'drain');
}

function canHaveNestedCollections(rootCollection: string, collectionId: string, documentPath: string, documentId: string): boolean {
  const depth = documentPath.split('/').length;
  if (rootCollection === 'assets') {
    return depth === 2 || (collectionId === 'holdings' && documentId === 'manifest');
  }
  if (rootCollection === 'bdb_activos') return depth === 2;
  return depth <= 4;
}

/** Bound each RPC and its buffered response, including the large assets root. */
export async function* paginatedDocuments(
  collection: admin.firestore.CollectionReference,
  pageSize = 100,
): AsyncGenerator<admin.firestore.QueryDocumentSnapshot> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('Invalid backup page size');
  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = collection.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) yield doc;
    if (snapshot.size < pageSize) return;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}

async function walkCollection(
  collection: admin.firestore.CollectionReference,
  rootCollection: string,
  stream: fs.WriteStream,
  counts: { records: number; max_depth: number },
): Promise<void> {
  const seen = new Set<string>();
  for await (const doc of paginatedDocuments(collection)) {
    seen.add(doc.ref.path);
    const depth = doc.ref.path.split('/').length;
    counts.records += 1;
    counts.max_depth = Math.max(counts.max_depth, depth);
    await writeLine(stream, {
      path: doc.ref.path,
      root_collection: rootCollection,
      data: encode(doc.data()),
    });
    if (canHaveNestedCollections(rootCollection, collection.id, doc.ref.path, doc.id)) {
      const nested = await doc.ref.listCollections();
      for (const child of nested) await walkCollection(child, rootCollection, stream, counts);
    }
  }
  // Documentos "fantasma": referencias sin datos propios pero con subcolecciones
  // (p. ej. bdb_activos/{uid} cuando la app no materializa el padre). collection.get()
  // no los devuelve y sus subcolecciones (las carteras) quedaban fuera del backup
  // (auditoría A2, 2026-07-10). listDocuments() sí los incluye.
  const refs = await collection.listDocuments();
  for (const ref of refs) {
    if (seen.has(ref.path)) continue;
    if (canHaveNestedCollections(rootCollection, collection.id, ref.path, ref.id)) {
      const nested = await ref.listCollections();
      for (const child of nested) await walkCollection(child, rootCollection, stream, counts);
    }
  }
}

async function gzipWithHash(source: string, target: string): Promise<{ bytes: number; sha256: string }> {
  await pipeline(fs.createReadStream(source), zlib.createGzip({ level: 9 }), fs.createWriteStream(target));
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(target);
  for await (const chunk of input) hash.update(chunk as Buffer);
  return { bytes: fs.statSync(target).size, sha256: hash.digest('hex') };
}

async function exportFirestoreRoot(
  collection: admin.firestore.CollectionReference,
  outDir: string,
): Promise<FileManifest & { max_depth: number }> {
  const safeName = collection.id.replace(/[^A-Za-z0-9_.-]/g, '_');
  const tempPath = path.join(outDir, `${safeName}.ndjson`);
  const gzipPath = `${tempPath}.gz`;
  const stream = fs.createWriteStream(tempPath, { encoding: 'utf8' });
  const counts = { records: 0, max_depth: 0 };
  await walkCollection(collection, collection.id, stream, counts);
  stream.end();
  await once(stream, 'finish');
  const compressed = await gzipWithHash(tempPath, gzipPath);
  fs.unlinkSync(tempPath);
  return {
    file: path.basename(gzipPath),
    kind: 'firestore',
    root_collection: collection.id,
    records: counts.records,
    max_depth: counts.max_depth,
    bytes_gzip: compressed.bytes,
    sha256_gzip: compressed.sha256,
  };
}

async function exportAuth(app: admin.app.App, outDir: string): Promise<FileManifest> {
  const tempPath = path.join(outDir, 'firebase_auth_users.ndjson');
  const gzipPath = `${tempPath}.gz`;
  const stream = fs.createWriteStream(tempPath, { encoding: 'utf8' });
  let records = 0;
  let pageToken: string | undefined;
  do {
    const page = await app.auth().listUsers(1000, pageToken);
    for (const user of page.users) {
      records += 1;
      await writeLine(stream, encode(user.toJSON()));
    }
    pageToken = page.pageToken;
  } while (pageToken);
  stream.end();
  await once(stream, 'finish');
  const compressed = await gzipWithHash(tempPath, gzipPath);
  fs.unlinkSync(tempPath);
  return {
    file: path.basename(gzipPath),
    kind: 'firebase_auth',
    records,
    bytes_gzip: compressed.bytes,
    sha256_gzip: compressed.sha256,
  };
}

async function verifyFile(outDir: string, file: FileManifest): Promise<void> {
  const fullPath = path.join(outDir, file.file);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(fullPath)) hash.update(chunk as Buffer);
  if (hash.digest('hex') !== file.sha256_gzip) throw new Error(`SHA256 no coincide: ${file.file}`);
  let records = 0;
  const lines = readline.createInterface({ input: fs.createReadStream(fullPath).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    JSON.parse(line);
    records += 1;
  }
  if (records !== file.records) throw new Error(`Recuento no coincide: ${file.file} (${records}/${file.records})`);
}

async function runBackup(backupsRoot: string): Promise<void> {
  const app = getApp();
  const firestore = app.firestore();
  const outDir = path.join(backupsRoot, runId());
  fs.mkdirSync(outDir, { recursive: true });

  const files: Array<FileManifest & { max_depth?: number }> = [];
  const roots = (await firestore.listCollections()).sort((left, right) => left.id.localeCompare(right.id));
  for (const collection of roots) {
    const result = await exportFirestoreRoot(collection, outDir);
    files.push(result);
    console.log(`[backup] ${collection.id}: ${result.records} documentos`);
  }
  files.push(await exportAuth(app, outDir));

  const manifest = {
    format_version: FORMAT_VERSION,
    project_id: PROJECT_ID,
    exported_at: new Date().toISOString(),
    contains_sensitive_app_data: true,
    automatic_local_pruning: false,
    firestore_root_collections: roots.map((collection) => collection.id),
    firestore_records: files.filter((file) => file.kind === 'firestore').reduce((sum, file) => sum + file.records, 0),
    auth_users: files.find((file) => file.kind === 'firebase_auth')?.records || 0,
    files,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  for (const file of files) await verifyFile(outDir, file);
  const summary = {
    ...manifest,
    verification: 'PASS',
    verified_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`[backup] verificacion=PASS firestore=${manifest.firestore_records} auth=${manifest.auth_users}`);
  console.log(`[backup] destino ${outDir}`);

  // Marcador de frescura para el job de integridad (meta/backup_status).
  // Unica escritura del backup: un doc pequeno, SOLO tras verificacion PASS,
  // y opt-in via env para conservar la naturaleza read-only por defecto.
  if (process.env.BDB_BACKUP_WRITE_STATUS_DOC === 'true') {
    await firestore.doc('meta/backup_status').set({
      completed_at: summary.verified_at,
      verification: summary.verification,
      firestore_records: manifest.firestore_records,
      auth_users: manifest.auth_users,
      backup_dir: path.basename(outDir),
    });
    console.log('[backup] marcador meta/backup_status actualizado');
  } else {
    console.log('[backup] marcador meta/backup_status omitido (BDB_BACKUP_WRITE_STATUS_DOC!=true)');
  }
}

/**
 * Avisa de las carpetas de ejecuciones abortadas que siguen en el directorio.
 *
 * `maintainLocalBackups` ya las clasifica como ABORTED_NO_MANIFEST y la
 * retencion no las borra a proposito, para poder diagnosticarlas. El problema
 * es que nadie mira ese informe: en un listado, `2026-09-07T07-30-01-387Z`
 * --que solo llego a escribir `_archived_assets.ndjson`-- parece una copia mas.
 * Decirlo en el log de la exportacion lo pone donde ya se mira.
 */
function reportAbortedRuns(backupsRoot: string): void {
  try {
    const abortadas = maintainLocalBackups({ root: backupsRoot })
      .filter((entry) => entry.status === 'ABORTED_NO_MANIFEST')
      .map((entry) => entry.directory);
    if (abortadas.length > 0) {
      console.log(`[backup] AVISO: ${abortadas.length} ejecucion(es) abortada(s) sin manifiesto: ${abortadas.join(', ')}`);
      console.log('[backup] no son copias validas; se conservan para diagnostico y la retencion no las poda');
    }
  } catch (error) {
    // Un aviso nunca puede impedir una copia.
    console.log('[backup] no se pudo revisar ejecuciones abortadas:', error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  const backupsRoot = path.join(process.cwd(), 'data', 'backups');
  const lock = acquireBackupLock(backupsRoot);
  try {
    reportAbortedRuns(backupsRoot);
    await runBackup(backupsRoot);
  } finally {
    releaseBackupLock(lock);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[backup] ERROR:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
