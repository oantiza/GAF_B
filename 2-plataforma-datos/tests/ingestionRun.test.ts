import { describe, expect, it } from 'vitest';
import { writeIngestionRun } from '../src/loader/ingestionRun';

describe('ingestion run audit docs', () => {
    it('writes server timestamp field for TTL', async () => {
        let writtenPath = '';
        let payload: any;
        const db = {
            doc: (path: string) => ({
                set: async (value: any) => {
                    writtenPath = path;
                    payload = value;
                }
            })
        };

        await writeIngestionRun(db as any, { run_id: 'run-1', kind: 'load', summary: { ok: true } });

        expect(writtenPath).toBe('ingestion_runs/run-1');
        expect(payload.created_at).toMatch(/Z$/);
        expect(payload.created_at_ts).toBeDefined();
    });
});
