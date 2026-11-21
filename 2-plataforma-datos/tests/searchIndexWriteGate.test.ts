import { describe, expect, it } from 'vitest';
import { assertSearchIndexWriteGate } from '../scripts/reconcileSearchIndexLive';

describe('search index write gate', () => {
  it('rechaza write sin el gate de plataforma antes de acceder a Firestore', () => {
    expect(() => assertSearchIndexWriteGate(true, {})).toThrow(
      'Gate cerrado: BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES'
    );
  });

  it('permite dry-run sin gate y write solo con el valor exacto', () => {
    expect(() => assertSearchIndexWriteGate(false, {})).not.toThrow();
    expect(() => assertSearchIndexWriteGate(true, {
      BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES'
    })).not.toThrow();
  });
});
