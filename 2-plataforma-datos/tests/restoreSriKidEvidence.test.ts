import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { backupsNewestFirst, evaluateRestore, findEvidence } from '../scripts/restoreSriKidEvidence';

/**
 * La evidencia del KID se devuelve de la copia mas nueva que la tenga, y solo si respalda el SRI
 * que ya esta publicado. El 31-10-2026 `--accept-canonical` se llevo la evidencia de dos fondos
 * dejando el SRI 3 sin nada detras; devolver una que dijera otro numero habria sido peor.
 */
const temporaryRoots: string[] = [];

function raiz(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-sri-evidence-'));
  temporaryRoots.push(root);
  return root;
}

function copia(root: string, name: string, filas: Array<Record<string, unknown>>): string {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  const ndjson = `${filas.map((fila) => JSON.stringify(fila)).join('\n')}\n`;
  fs.writeFileSync(path.join(directory, 'assets.ndjson.gz'), zlib.gzipSync(Buffer.from(ndjson, 'utf8')));
  return directory;
}

function activo(isin: string, evidence: unknown): Record<string, unknown> {
  return { path: `assets/${isin}`, root_collection: 'assets', data: { risk: evidence === undefined ? {} : { sri_kid_evidence: evidence } } };
}

const EVIDENCIA = { sri: 3, date: '2026-03-26', source: 'morningstar_via_finect', sha256: 'abc' };

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('evaluateRestore', () => {
  it('restaura cuando la evidencia respalda el SRI publicado', () => {
    expect(evaluateRestore(3, undefined, EVIDENCIA)).toMatchObject({ accion: 'restaurar' });
  });

  it('no sobrescribe una evidencia que ya esta viva, aunque la de la copia sea otra', () => {
    expect(evaluateRestore(3, { sri: 3, sha256: 'otra' }, EVIDENCIA)).toMatchObject({ accion: 'ya_presente' });
  });

  it('se niega si la evidencia dice un SRI distinto del publicado: eso no es una reparacion', () => {
    const decision = evaluateRestore(4, undefined, EVIDENCIA);
    expect(decision.accion).toBe('sri_no_respaldado');
    expect(decision.motivo).toContain('decide Oscar');
  });

  it('sin SRI vivo no hay nada que respaldar', () => {
    expect(evaluateRestore(undefined, undefined, EVIDENCIA)).toMatchObject({ accion: 'sin_sri_vivo' });
    expect(evaluateRestore(null, undefined, EVIDENCIA)).toMatchObject({ accion: 'sin_sri_vivo' });
  });

  it('si ninguna copia trae evidencia lo dice, en vez de inventarse una', () => {
    expect(evaluateRestore(3, undefined, undefined)).toMatchObject({ accion: 'sin_evidencia_en_copias' });
  });
});

describe('findEvidence', () => {
  it('elige la copia mas nueva que todavia tenga la evidencia, saltando las de despues del borrado', async () => {
    const root = raiz();
    copia(root, '2026-10-29T09-08-21-424Z', [activo('LU1254412460', { ...EVIDENCIA, sha256: 'vieja' })]);
    copia(root, '2026-10-31T07-51-41-046Z', [activo('LU1254412460', EVIDENCIA)]);
    copia(root, '2026-10-31T08-36-46-698Z', [activo('LU1254412460', undefined)]);
    const encontrada = await findEvidence('LU1254412460', root);
    expect(path.basename(encontrada!.backupDir)).toBe('2026-10-31T07-51-41-046Z');
    expect(encontrada!.evidence.sha256).toBe('abc');
  });

  it('no confunde un ISIN con otro que lo contenga como prefijo', async () => {
    const root = raiz();
    copia(root, '2026-10-31T07-51-41-046Z', [
      activo('LU1254412460X', { ...EVIDENCIA, sha256: 'ajena' }),
      activo('LU1254412460', EVIDENCIA),
    ]);
    const encontrada = await findEvidence('LU1254412460', root);
    expect(encontrada!.evidence.sha256).toBe('abc');
  });

  it('devuelve undefined si el ISIN no esta en ninguna copia', async () => {
    const root = raiz();
    copia(root, '2026-10-31T07-51-41-046Z', [activo('LU1254412460', EVIDENCIA)]);
    expect(await findEvidence('LU0000000000', root)).toBeUndefined();
    expect(await findEvidence('LU1254412460', path.join(root, 'no-existe'))).toBeUndefined();
  });
});

describe('backupsNewestFirst', () => {
  it('ordena de la mas nueva a la mas vieja y descarta lo que no es una copia de activos', () => {
    const root = raiz();
    copia(root, '2026-10-29T09-08-21-424Z', [activo('LU1254412460', EVIDENCIA)]);
    copia(root, '2026-10-31T07-51-41-046Z', [activo('LU1254412460', EVIDENCIA)]);
    fs.mkdirSync(path.join(root, '2026-10-31T09-00-00-000Z'), { recursive: true });
    expect(backupsNewestFirst(root).map((dir) => path.basename(dir))).toEqual([
      '2026-10-31T07-51-41-046Z',
      '2026-10-29T09-08-21-424Z',
    ]);
    expect(backupsNewestFirst(path.join(root, 'no-existe'))).toEqual([]);
  });
});
