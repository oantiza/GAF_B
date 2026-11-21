/**
 * scripts/restoreSriKidEvidence.ts — devuelve a la maestra la evidencia del KID que sostiene
 * el SRI de un activo, tomandola de la copia de seguridad mas nueva que todavia la tenga.
 *
 * Por que existe: el 31-10-2026 se republicaron tres fondos con `--accept-canonical` para
 * aceptar el valor canonico en un conflicto de propiedad. Esa bandera no distingue: salta la
 * funcion que conserva los datos de la app, y con ella se fue `risk.sri_kid_evidence` de
 * LU1254412460 y LU1919971074. El SRI siguio siendo 3, pero sin nada detras. Un numero
 * regulatorio sin su evidencia es peor que no tenerlo: no se puede comprobar.
 *
 * Lo que este script NO hace, a proposito:
 *  - No toca el SRI. Solo restituye la evidencia, y solo si respalda el valor que ya hay vivo.
 *  - No sobrescribe una evidencia presente. Si ya hay una, no hay nada que reparar.
 *  - No elige la copia por una fecha escrita aqui: busca de la mas nueva a la mas vieja la
 *    primera que tenga evidencia para ese ISIN, igual que `resolveLatestBackup` elige la de
 *    siembra. Una fecha escrita en el codigo caduca; el disco, no.
 *
 * Deja rastro en `_sri_evidence_repair_audit/<isin>-<yyyymmdd>`, que es la convencion de la
 * maestra para las reparaciones fuera de la tuberia (`_nav_currency_repair_audit` y las otras).
 *
 * Uso, desde `2-plataforma-datos`:
 *   npx tsx scripts/restoreSriKidEvidence.ts --ids LU1254412460,LU1919971074
 *   BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
 *     npx tsx scripts/restoreSriKidEvidence.ts --ids <isines> --write
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as zlib from 'zlib';
import dotenv from 'dotenv';
import { getDb, isPlatformWriteAuthorized } from '../src/loader/writer';

dotenv.config({ path: path.join(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ quiet: true });

const BACKUPS_DIR = 'data/backups';
const EVIDENCE_FIELD_PATH = 'risk.sri_kid_evidence';
const AUDIT_COLLECTION = '_sri_evidence_repair_audit';

export type SriKidEvidence = {
  sri?: unknown;
  date?: unknown;
  source?: unknown;
  sha256?: unknown;
  [key: string]: unknown;
};

export type RestoreDecision = {
  accion: 'restaurar' | 'ya_presente' | 'sri_no_respaldado' | 'sin_sri_vivo' | 'sin_evidencia_en_copias';
  motivo: string;
};

/**
 * La decision, aparte de Firestore y del disco para poder probarla.
 *
 * El criterio que importa es el ultimo: una evidencia solo vale si dice el mismo SRI que esta
 * publicado. Devolver una que diga otro numero no repara nada, documenta una contradiccion.
 */
export function evaluateRestore(
  liveSri: unknown,
  liveEvidence: unknown,
  evidence: SriKidEvidence | undefined
): RestoreDecision {
  if (liveEvidence !== undefined && liveEvidence !== null) {
    return { accion: 'ya_presente', motivo: 'la maestra ya tiene evidencia; no hay nada que reparar' };
  }
  if (!evidence) {
    return { accion: 'sin_evidencia_en_copias', motivo: `ninguna copia de ${BACKUPS_DIR} trae ${EVIDENCE_FIELD_PATH}` };
  }
  if (typeof liveSri !== 'number') {
    return { accion: 'sin_sri_vivo', motivo: 'la maestra no publica un SRI, asi que no hay nada que respaldar' };
  }
  if (evidence.sri !== liveSri) {
    return {
      accion: 'sri_no_respaldado',
      motivo: `la evidencia dice SRI ${String(evidence.sri)} y la maestra publica ${liveSri}: decide Oscar`,
    };
  }
  return { accion: 'restaurar', motivo: `la evidencia respalda el SRI ${liveSri} que ya esta publicado` };
}

/** Las copias, de la mas nueva a la mas vieja. Los nombres son marcas ISO y ordenan como texto. */
export function backupsNewestFirst(backupsDir = BACKUPS_DIR): string[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => path.join(backupsDir, entrada.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'assets.ndjson.gz')))
    .sort()
    .reverse();
}

/** Lee `risk.sri_kid_evidence` de un ISIN en una copia concreta. `undefined` si no esta. */
export async function readEvidenceFromBackup(backupDir: string, isin: string): Promise<SriKidEvidence | undefined> {
  const filePath = path.join(backupDir, 'assets.ndjson.gz');
  if (!fs.existsSync(filePath)) return undefined;
  const lines = readline.createInterface({
    input: fs.createReadStream(filePath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) {
      if (!line.includes(`"assets/${isin}"`)) continue;
      const row = JSON.parse(line) as { path?: string; data?: { risk?: { sri_kid_evidence?: SriKidEvidence } } };
      if (row.path !== `assets/${isin}`) continue;
      const evidence = row.data?.risk?.sri_kid_evidence;
      return evidence && typeof evidence === 'object' ? evidence : undefined;
    }
  } finally {
    lines.close();
  }
  return undefined;
}

/** La copia mas nueva que todavia tenga evidencia para ese ISIN. */
export async function findEvidence(
  isin: string,
  backupsDir = BACKUPS_DIR
): Promise<{ backupDir: string; evidence: SriKidEvidence } | undefined> {
  for (const backupDir of backupsNewestFirst(backupsDir)) {
    const evidence = await readEvidenceFromBackup(backupDir, isin);
    if (evidence) return { backupDir, evidence };
  }
  return undefined;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function auditId(isin: string, now: Date): string {
  return `${isin}-${now.toISOString().slice(0, 10).replace(/-/g, '')}`;
}

async function main(): Promise<void> {
  const ids = (flag('--ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
  const write = process.argv.includes('--write');
  const backupsDir = flag('--backups-dir') || BACKUPS_DIR;
  if (ids.length === 0) throw new Error('Falta --ids <ISIN[,ISIN...]>.');
  if (write && !isPlatformWriteAuthorized()) {
    throw new Error('Falta el gate BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES delante de este comando.');
  }

  const db = getDb();
  const now = new Date();
  let restaurados = 0;
  let bloqueados = 0;

  for (const isin of ids) {
    const snapshot = await db.doc(`assets/${isin}`).get();
    if (!snapshot.exists) {
      console.log(`[sri-evidence] ${isin}: no esta en la maestra`);
      bloqueados += 1;
      continue;
    }
    const risk = (snapshot.data()?.risk || {}) as Record<string, unknown>;
    const encontrada = await findEvidence(isin, backupsDir);
    const decision = evaluateRestore(risk.sri_kid_1a7, risk.sri_kid_evidence, encontrada?.evidence);
    const origen = encontrada ? path.basename(encontrada.backupDir) : '-';
    console.log(`[sri-evidence] ${isin}: ${decision.accion} — ${decision.motivo} (copia: ${origen})`);

    if (decision.accion !== 'restaurar' || !encontrada) {
      if (decision.accion !== 'ya_presente') bloqueados += 1;
      continue;
    }
    if (!write) {
      console.log(`[sri-evidence] ${isin}: en seco; con --write se escribiria ${EVIDENCE_FIELD_PATH}`);
      continue;
    }

    await db.doc(`assets/${isin}`).set(
      { risk: { sri_kid_evidence: encontrada.evidence } },
      { mergeFields: [EVIDENCE_FIELD_PATH] }
    );
    await db.doc(`${AUDIT_COLLECTION}/${auditId(isin, now)}`).set({
      asset_id: isin,
      created_at: now.toISOString(),
      field_path: EVIDENCE_FIELD_PATH,
      restored_from_backup: path.basename(encontrada.backupDir),
      restored_evidence: encontrada.evidence,
      live_sri: risk.sri_kid_1a7 ?? null,
      reason: 'republish con --accept-canonical del 31-10-2026 retiro la evidencia sin tocar el SRI',
    });

    const verificado = (await db.doc(`assets/${isin}`).get()).data()?.risk?.sri_kid_evidence;
    if (!verificado || verificado.sha256 !== encontrada.evidence.sha256) {
      throw new Error(`Postverify fallido en ${isin}: la evidencia no quedo escrita.`);
    }
    console.log(`[sri-evidence] ${isin}: escrita y verificada (KID ${String(encontrada.evidence.date)})`);
    restaurados += 1;
  }

  console.log(`[sri-evidence] restaurados=${restaurados} bloqueados=${bloqueados} modo=${write ? 'write' : 'dry-run'}`);
  if (bloqueados > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
