import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as zlib from 'zlib';
import * as admin from 'firebase-admin';
import { HOST_EMULADOR_BASE_DE_SIEMPRE, HOST_EMULADOR_BASE_NUEVA } from '../src/config/projectAllowlist';

interface FileManifest {
  file: string;
  kind: 'firestore' | 'firebase_auth';
  records: number;
  sha256_gzip: string;
}

interface BackupManifest {
  format_version: string;
  project_id: string;
  firestore_records: number;
  files: FileManifest[];
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)])
    );
  }
  return value;
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function decode(value: unknown, db: admin.firestore.Firestore): unknown {
  if (Array.isArray(value)) return value.map((item) => decode(item, db));
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  switch (item.__bdb_type) {
    case 'timestamp':
      return new admin.firestore.Timestamp(Number(item.seconds), Number(item.nanoseconds));
    case 'date':
      return new Date(String(item.value));
    case 'geopoint':
      return new admin.firestore.GeoPoint(Number(item.latitude), Number(item.longitude));
    case 'document_reference':
      return db.doc(String(item.path));
    case 'bytes':
      return Buffer.from(String(item.value), 'base64');
    case 'bigint':
      return Number(item.value);
    case 'non_finite_number':
      return String(item.value) === 'NaN' ? Number.NaN : String(item.value) === 'Infinity' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    default:
      return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, decode(nested, db)]));
  }
}

function encodeForVerification(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { __bdb_type: 'non_finite_number', value: String(value) };
  }
  if (value instanceof Date) return { __bdb_type: 'date', value: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __bdb_type: 'bytes', value: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(encodeForVerification);
  if (typeof value === 'object') {
    const item = value as Record<string, unknown> & {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
      latitude?: number;
      longitude?: number;
      path?: string;
      firestore?: unknown;
    };
    if (typeof item.toDate === 'function') {
      const date = item.toDate();
      return {
        __bdb_type: 'timestamp',
        seconds: String(item.seconds ?? Math.floor(date.getTime() / 1000)),
        nanoseconds: item.nanoseconds ?? (date.getTime() % 1000) * 1_000_000,
        value: date.toISOString(),
      };
    }
    if (typeof item.latitude === 'number' && typeof item.longitude === 'number') {
      return { __bdb_type: 'geopoint', latitude: item.latitude, longitude: item.longitude };
    }
    if (typeof item.path === 'string' && item.firestore) {
      return { __bdb_type: 'document_reference', path: item.path };
    }
    return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, encodeForVerification(nested)]));
  }
  return String(value);
}

/** Donde viven las copias locales, relativo a la raiz del repositorio de la plataforma. */
const BACKUPS_DIR = 'data/backups';

/**
 * La copia de siembra es siempre la mas nueva que verifico PASS. Se elige leyendo el disco y no de
 * una fecha escrita en el README: el 31-10-2026 hubo cuatro copias en una mañana y la documentacion
 * se quedo apuntando a una vieja, que siembra la maestra con datos de antes sin avisar de nada.
 *
 * Los nombres son marcas de tiempo ISO, asi que ordenan bien como texto. Una copia sin summary.json
 * o cuya verificacion no sea PASS no se considera: a medio exportar no sirve para sembrar.
 */
export function resolveLatestBackup(backupsDir = BACKUPS_DIR): string {
  if (!fs.existsSync(backupsDir)) throw new Error(`No encuentro ${backupsDir}. Usa --backup <directorio>.`);
  const candidatas = fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => path.join(backupsDir, entrada.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'manifest.json')))
    .filter((dir) => {
      const resumen = path.join(dir, 'summary.json');
      if (!fs.existsSync(resumen)) return false;
      try {
        return JSON.parse(fs.readFileSync(resumen, 'utf8')).verification === 'PASS';
      } catch {
        return false;
      }
    })
    .sort();
  const elegida = candidatas[candidatas.length - 1];
  if (!elegida) throw new Error(`Ninguna copia de ${backupsDir} tiene summary.json con verification PASS. Usa --backup <directorio>.`);
  return elegida;
}

/**
 * Por qué no se siembra en ese emulador, o `undefined` si se puede.
 *
 * PLA-8 (auditoría del 16-11-2026): bastaba con que fuese local, así que `--emulator-host 127.0.0.1:8092` se aceptaba,
 * y ese es el emulador de la base NUEVA. Los dos arrancan en `singleProjectMode` y sirven con cualquier id de
 * proyecto: lo que separa las dos bases es el puerto. Sembrar ahí la copia de la maestra vieja —25.000 documentos
 * de `assets` y catorce colecciones más— la mezclaría con la base nueva, que además persiste en disco.
 */
export function motivoParaNoSembrarAhi(emulatorHost: string): string | undefined {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) return 'FIRESTORE_EMULATOR_HOST debe apuntar a localhost.';
  const puerto = emulatorHost.split(':')[1];
  if (puerto === HOST_EMULADOR_BASE_NUEVA.split(':')[1]) {
    return `El puerto ${puerto} es el del emulador de la base nueva: la copia de la maestra de siempre no se siembra ahi. El de la base de siempre es el ${HOST_EMULADOR_BASE_DE_SIEMPRE.split(':')[1]}.`;
  }
  return undefined;
}

async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function main(): Promise<void> {
  const pedida = flag('--backup');
  const backupDir = path.resolve(pedida || resolveLatestBackup());
  if (!pedida) console.log(`[restore] copia mas nueva con PASS: ${path.basename(backupDir)}`);
  const emulatorHost = flag('--emulator-host') || process.env.FIRESTORE_EMULATOR_HOST || '';
  const projectId = flag('--project') || 'bdb-restore-drill';
  if (!fs.existsSync(path.join(backupDir, 'manifest.json'))) throw new Error(`No es una copia valida: ${backupDir}`);
  const motivo = motivoParaNoSembrarAhi(emulatorHost);
  if (motivo) throw new Error(motivo);
  if (projectId === 'bbdd-activos-financieros') throw new Error('El proyecto de produccion esta prohibido en un restore drill.');
  process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;

  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.format_version !== 'bdb-complete-backup.v2') throw new Error(`Formato no soportado: ${manifest.format_version}`);
  const app = admin.initializeApp({ projectId }, `restore-${Date.now()}`);
  const db = app.firestore();
  const expected = new Map<string, string>();
  let batch = db.batch();
  let pending = 0;
  let restored = 0;

  for (const file of manifest.files) {
    const filePath = path.join(backupDir, file.file);
    if (await sha256(filePath) !== file.sha256_gzip) throw new Error(`SHA256 no coincide: ${file.file}`);
    if (file.kind !== 'firestore') continue;
    const lines = readline.createInterface({ input: fs.createReadStream(filePath).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { path: string; data: unknown };
      if (expected.has(row.path)) throw new Error(`Ruta duplicada en backup: ${row.path}`);
      expected.set(row.path, digest(row.data));
      batch.set(db.doc(row.path), decode(row.data, db) as admin.firestore.DocumentData);
      pending += 1;
      restored += 1;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }
  if (pending > 0) await batch.commit();
  if (restored !== manifest.firestore_records) throw new Error(`Recuento restaurado incorrecto: ${restored}/${manifest.firestore_records}`);

  let verified = 0;
  let mismatches = 0;
  const paths = [...expected.keys()];
  for (let offset = 0; offset < paths.length; offset += 200) {
    const refs = paths.slice(offset, offset + 200).map((documentPath) => db.doc(documentPath));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      const expectedHash = expected.get(snapshot.ref.path);
      const actualHash = snapshot.exists ? digest(encodeForVerification(snapshot.data())) : '';
      if (!snapshot.exists || actualHash !== expectedHash) mismatches += 1;
      verified += 1;
    }
  }
  const summary = {
    status: mismatches === 0 ? 'PASS' : 'FAIL',
    project_id: projectId,
    emulator_host: emulatorHost,
    backup_dir: backupDir,
    restored,
    verified,
    mismatches,
    auth_users_artifact_verified: manifest.files.find((file) => file.kind === 'firebase_auth')?.records || 0,
    completed_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(backupDir, 'restore_drill_summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  await app.delete();
  if (mismatches > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
