import * as fs from 'fs';
import * as path from 'path';

export type BackupRetentionStatus = 'COMPLETE' | 'ABORTED_NO_MANIFEST' | 'INCOMPLETE_UNVERIFIED';

export interface BackupRetentionEntry {
  directory: string;
  absolute_path: string;
  age_days: number;
  status: BackupRetentionStatus;
  prune_eligible: boolean;
  deleted: boolean;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function verifiedSummary(directory: string): boolean {
  const summaryPath = path.join(directory, 'summary.json');
  if (!fs.existsSync(summaryPath)) return false;
  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf8'))?.verification === 'PASS';
  } catch {
    return false;
  }
}

function assertDirectChild(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (path.dirname(resolvedCandidate) !== resolvedRoot || resolvedCandidate === resolvedRoot) {
    throw new Error(`Ruta de backup fuera del directorio permitido: ${resolvedCandidate}`);
  }
}

export function maintainLocalBackups(options: {
  root: string;
  retentionDays?: number;
  nowMs?: number;
  apply?: boolean;
}): BackupRetentionEntry[] {
  const root = path.resolve(options.root);
  const retentionDays = options.retentionDays ?? 30;
  const nowMs = options.nowMs ?? Date.now();
  const apply = options.apply === true;
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error('retentionDays debe ser un numero positivo.');
  }
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry): BackupRetentionEntry => {
      const absolutePath = path.resolve(root, entry.name);
      assertDirectChild(root, absolutePath);
      const manifestExists = fs.existsSync(path.join(absolutePath, 'manifest.json'));
      const status: BackupRetentionStatus = !manifestExists
        ? 'ABORTED_NO_MANIFEST'
        : verifiedSummary(absolutePath)
          ? 'COMPLETE'
          : 'INCOMPLETE_UNVERIFIED';
      const ageDays = Math.max(0, (nowMs - fs.statSync(absolutePath).mtimeMs) / 86_400_000);
      const pruneEligible = status === 'COMPLETE' && ageDays > retentionDays;
      let deleted = false;
      if (apply && pruneEligible) {
        assertDirectChild(root, absolutePath);
        fs.rmSync(absolutePath, { recursive: true, force: false });
        deleted = true;
      }
      return {
        directory: entry.name,
        absolute_path: absolutePath,
        age_days: Number(ageDays.toFixed(2)),
        status,
        prune_eligible: pruneEligible,
        deleted,
      };
    })
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

function main(): void {
  const apply = process.argv.includes('--write');
  const root = path.resolve(flag('--root') || path.join(process.cwd(), 'data', 'backups'));
  const retentionDays = Number(flag('--retention-days') || 30);
  const entries = maintainLocalBackups({ root, retentionDays, apply });
  const summary = {
    mode: apply ? 'WRITE' : 'DRY_RUN',
    root,
    retention_days: retentionDays,
    scanned: entries.length,
    prune_eligible: entries.filter((entry) => entry.prune_eligible).length,
    deleted: entries.filter((entry) => entry.deleted).length,
    aborted_runs: entries.filter((entry) => entry.status === 'ABORTED_NO_MANIFEST').map((entry) => entry.directory),
    incomplete_runs: entries.filter((entry) => entry.status === 'INCOMPLETE_UNVERIFIED').map((entry) => entry.directory),
    entries,
  };
  const outputDir = path.join(process.cwd(), 'runs', `backup_retention_${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...summary, output_dir: outputDir }, null, 2));
}

if (require.main === module) main();
