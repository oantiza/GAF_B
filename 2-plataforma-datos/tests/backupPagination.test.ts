import { describe, it, expect } from 'vitest';
import { paginatedDocuments } from '../scripts/runBackupExport';

describe('backup pagination', () => {
  it('reads bounded pages without duplicates, including an exact page boundary', async () => {
    const values = Array.from({ length: 200 }, (_, i) => ({ id: String(i).padStart(4, '0') }));
    const sizes: number[] = [];
    const collection = {
      orderBy() {
        let start = 0;
        let limit = 0;
        const query = {
          limit(value: number) { limit = value; return query; },
          startAfter(doc: { id: string }) { start = values.indexOf(doc) + 1; return query; },
          async get() { const docs = values.slice(start, start + limit); sizes.push(docs.length); return { docs, size: docs.length }; }
        };
        return query;
      }
    };
    const found = [];
    for await (const doc of paginatedDocuments(collection as any)) found.push(doc.id);
    expect(found).toEqual(values.map(doc => doc.id));
    expect(sizes).toEqual([100, 100, 0]);
  });
  it('rejects an unbounded page request', async () => {
    await expect(paginatedDocuments({} as any, 0).next()).rejects.toThrow('Invalid backup page size');
  });
});
