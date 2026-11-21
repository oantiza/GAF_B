import { describe, expect, it } from 'vitest';
import type { firestore } from 'firebase-admin';
import { reconcileSearchIndexLive } from '../scripts/reconcileSearchIndexLive';
import { entryFromRoot } from '../src/loader/searchIndex';
import { FakeSearchIndexRef } from './helpers/fakeSearchIndexRef';

const id = 'IE00B4ND3602';
const root = { asset_type: 'OTHER', identity: { name: 'Gold ETC', currency: 'USD' }, product: { product_type: 'etc' } };

function fakeDb(entry: Record<string, unknown>) {
  // meta/search_index con la semántica real de escritura (precondición lastUpdateTime, create/update).
  const ref = new FakeSearchIndexRef({ count: 1, entries: [entry] });
  const db = {
    collection: () => ({ get: async () => ({ docs: [{ id, data: () => root }] }) }),
    doc: () => ref,
  };
  return { db: db as unknown as firestore.Firestore, ref };
}

describe('reconciliación semántica del índice', () => {
  it('no escribe por un cambio en el orden de los campos devueltos por Firestore', async () => {
    const entry = entryFromRoot(id, root)!;
    const { db, ref } = fakeDb(Object.fromEntries(Object.entries(entry).reverse()));
    expect(await reconcileSearchIndexLive(db, true, {
      BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES',
    })).toBe(false);
    expect(ref.writes).toHaveLength(0);
  });

  it('detecta una diferencia real sin escribir en dry-run', async () => {
    const { db, ref } = fakeDb({ ...entryFromRoot(id, root), type: 'STOCK' });
    expect(await reconcileSearchIndexLive(db, false, {})).toBe(false);
    expect(ref.writes).toHaveLength(0);
    expect(await reconcileSearchIndexLive(db, true, {
      BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES',
    })).toBe(true);
    expect(ref.writes).toHaveLength(1);
    expect(ref.stored).toEqual(expect.objectContaining({ entries: [expect.objectContaining({ type: 'ETF' })] }));
  });

  it.each(['etc', 'etn', 'etp', 'exchange traded commodity'])('mantiene la paridad del filtro para %s', product_type => {
    expect(entryFromRoot(id, { ...root, product: { product_type } })?.type).toBe('ETF');
  });

  it('prioriza el tipo explícito y conserva OTHER cuando no hay señales', () => {
    expect(entryFromRoot(id, { ...root, asset_type: 'INDEX' })?.type).toBe('INDEX');
    expect(entryFromRoot(id, { ...root, product: {} })?.type).toBe('OTHER');
    expect(entryFromRoot(id, { ...root, product: { product_type: 'mutual fund' } })?.type).toBe('FUND');
  });

  it('usa los campos de respaldo de clase y divisa que admite Python', () => {
    expect(entryFromRoot(id, { asset_type: 'STOCK', identity: { name: 'Stock' }, currency: 'EUR', economic_asset_class: 'EQUITY' }))
      .toMatchObject({ currency: 'EUR', class: 'EQUITY' });
  });
});
