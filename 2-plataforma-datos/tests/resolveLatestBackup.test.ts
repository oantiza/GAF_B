import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLatestBackup } from '../scripts/restoreBackupToEmulator';

/**
 * La copia de siembra se elige del disco, no de una fecha escrita en el README (31-10-2026):
 * hubo cuatro copias en una mañana y la documentacion se quedo apuntando a una vieja.
 */
const temporaryRoots: string[] = [];

function raiz(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-latest-backup-'));
  temporaryRoots.push(root);
  return root;
}

function copia(root: string, name: string, options: { manifest?: boolean; verification?: string | null } = {}): string {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  if (options.manifest !== false) fs.writeFileSync(path.join(directory, 'manifest.json'), '{}', 'utf8');
  if (options.verification !== null) {
    fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ verification: options.verification ?? 'PASS' }), 'utf8');
  }
  return directory;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveLatestBackup', () => {
  it('elige la mas nueva: los nombres son marcas ISO y ordenan como texto', () => {
    const root = raiz();
    copia(root, '2026-10-29T09-08-21-424Z');
    copia(root, '2026-10-31T06-15-22-262Z');
    const ultima = copia(root, '2026-10-31T07-51-41-046Z');
    expect(resolveLatestBackup(root)).toBe(ultima);
  });

  it('salta la mas nueva si no verifico PASS, y la que esta a medio exportar', () => {
    const root = raiz();
    const buena = copia(root, '2026-10-31T06-15-22-262Z');
    copia(root, '2026-10-31T07-00-00-000Z', { verification: 'FAIL' });
    copia(root, '2026-10-31T07-30-00-000Z', { verification: null });
    copia(root, '2026-10-31T07-51-41-046Z', { manifest: false });
    expect(resolveLatestBackup(root)).toBe(buena);
  });

  it('un summary.json ilegible no rompe la eleccion: se descarta esa copia', () => {
    const root = raiz();
    const buena = copia(root, '2026-10-31T06-15-22-262Z');
    const roto = copia(root, '2026-10-31T07-51-41-046Z');
    fs.writeFileSync(path.join(roto, 'summary.json'), '{no es json', 'utf8');
    expect(resolveLatestBackup(root)).toBe(buena);
  });

  it('sin ninguna copia valida lo dice, en vez de sembrar con cualquier cosa', () => {
    const root = raiz();
    expect(() => resolveLatestBackup(root)).toThrow(/verification PASS/);
    copia(root, '2026-10-31T07-51-41-046Z', { verification: 'FAIL' });
    expect(() => resolveLatestBackup(root)).toThrow(/verification PASS/);
    expect(() => resolveLatestBackup(path.join(root, 'no-existe'))).toThrow(/No encuentro/);
  });
});
