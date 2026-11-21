import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { maintainLocalBackups } from '../scripts/maintainLocalBackups';
import { acquireBackupLock, releaseBackupLock } from '../scripts/runBackupExport';

const temporaryRoots: string[] = [];

function backup(root: string, name: string, options: { manifest?: boolean; verified?: boolean; ageDays: number }): string {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  if (options.manifest) fs.writeFileSync(path.join(directory, 'manifest.json'), '{}', 'utf8');
  if (options.verified) fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ verification: 'PASS' }), 'utf8');
  const timestamp = new Date(Date.now() - options.ageDays * 86_400_000);
  fs.utimesSync(directory, timestamp, timestamp);
  return directory;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('local backup retention', () => {
  it('impide dos exportaciones simultaneas y libera el bloqueo al terminar', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-backup-lock-'));
    temporaryRoots.push(root);
    const first = acquireBackupLock(root);

    expect(() => acquireBackupLock(root)).toThrow('BACKUP_ALREADY_RUNNING');
    releaseBackupLock(first);

    const next = acquireBackupLock(root);
    releaseBackupLock(next);
  });

  it('solo poda backups verificados de mas de 30 dias', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-backup-retention-'));
    temporaryRoots.push(root);
    const oldComplete = backup(root, 'old-complete', { manifest: true, verified: true, ageDays: 31 });
    const recentComplete = backup(root, 'recent-complete', { manifest: true, verified: true, ageDays: 5 });
    const oldIncomplete = backup(root, 'old-incomplete', { manifest: true, ageDays: 40 });
    const aborted = backup(root, 'aborted', { ageDays: 40 });

    const dryRun = maintainLocalBackups({ root, retentionDays: 30 });
    expect(dryRun.find((entry) => entry.directory === 'old-complete')?.prune_eligible).toBe(true);
    expect(dryRun.find((entry) => entry.directory === 'aborted')?.status).toBe('ABORTED_NO_MANIFEST');
    expect(dryRun.find((entry) => entry.directory === 'old-incomplete')?.status).toBe('INCOMPLETE_UNVERIFIED');
    expect(fs.existsSync(oldComplete)).toBe(true);

    const applied = maintainLocalBackups({ root, retentionDays: 30, apply: true });
    expect(applied.find((entry) => entry.directory === 'old-complete')?.deleted).toBe(true);
    expect(fs.existsSync(oldComplete)).toBe(false);
    expect(fs.existsSync(recentComplete)).toBe(true);
    expect(fs.existsSync(oldIncomplete)).toBe(true);
    expect(fs.existsSync(aborted)).toBe(true);
  });
});

describe('bloqueo abandonado', () => {
  function root(): string {
    const created = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-backup-stale-'));
    temporaryRoots.push(created);
    return created;
  }

  function writeLock(directory: string, content: unknown): string {
    const lockPath = path.join(directory, '.backup-export.lock');
    fs.writeFileSync(lockPath, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
    return lockPath;
  }

  /*
   * Un pid que con certeza no existe. Hasta el 09-11-2026 la prueba usaba el 39056 fijo, el del
   * caso real de abajo, y ese dia era un proceso vivo de esta maquina (olkexthost.exe): el
   * sistema reutiliza los pid, asi que un numero fijo no prueba nada y falla segun el dia. Aqui se
   * lanza un proceso hijo trivial, se espera a que termine y se usa su pid, comprobando que nadie
   * lo ha reutilizado todavia; si ya lo esta, se repite.
   */
  function pidQueNoExiste(): number {
    for (let intento = 0; intento < 20; intento += 1) {
      const hijo = spawnSync(process.execPath, ['-e', '']);
      const pid = hijo.pid;
      if (pid === undefined || pid <= 0) continue;
      try {
        process.kill(pid, 0);
      } catch (error: any) {
        if (error?.code === 'ESRCH') return pid;
      }
    }
    throw new Error('no se encontro un pid libre en 20 intentos');
  }

  // El 07-09-2026 el proceso 39056 murio a mitad de la exportacion sin liberar
  // el bloqueo, y la tarea programada diaria fallo tres dias en silencio.
  it('retira el bloqueo de un proceso que ya no existe', () => {
    const directory = root();
    writeLock(directory, { pid: pidQueNoExiste(), started_at: new Date().toISOString() });

    const lock = acquireBackupLock(directory);

    expect(JSON.parse(fs.readFileSync(lock.path, 'utf8')).pid).toBe(process.pid);
    releaseBackupLock(lock);
  });

  it('respeta el bloqueo de un proceso vivo', () => {
    const directory = root();
    writeLock(directory, { pid: process.pid, started_at: new Date().toISOString() });

    expect(() => acquireBackupLock(directory)).toThrow('BACKUP_ALREADY_RUNNING');
  });

  it('retira un bloqueo demasiado viejo aunque su pid siga vivo', () => {
    // Un pid se reutiliza: el proceso vivo puede no ser el que dejo el bloqueo.
    const directory = root();
    const hace8Horas = new Date(Date.now() - 8 * 3_600_000).toISOString();
    writeLock(directory, { pid: process.pid, started_at: hace8Horas });

    const lock = acquireBackupLock(directory);
    releaseBackupLock(lock);
  });

  it('no retira un bloqueo reciente de un proceso vivo por la edad', () => {
    const directory = root();
    const hace2Horas = new Date(Date.now() - 2 * 3_600_000).toISOString();
    writeLock(directory, { pid: process.pid, started_at: hace2Horas });

    expect(() => acquireBackupLock(directory)).toThrow('BACKUP_ALREADY_RUNNING');
  });

  it('retira un bloqueo ilegible', () => {
    const directory = root();
    writeLock(directory, 'no soy json');

    const lock = acquireBackupLock(directory);
    releaseBackupLock(lock);
  });

  it('retira un bloqueo sin pid ni fecha con los que decidir', () => {
    const directory = root();
    writeLock(directory, { nota: 'vacio' });

    const lock = acquireBackupLock(directory);
    releaseBackupLock(lock);
  });
});
