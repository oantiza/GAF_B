/**
 * src/loader/ingestionRun.ts — registra cada corrida de ESCRITURA en Firestore: `ingestion_runs/{run_id}`.
 *
 * Traza/auditoría operativa de la maestra (quién/cuándo/qué). Lo llaman los writers
 * (loader / republish / reclassify) tras un `--write` exitoso. Es additivo y no bloqueante:
 * si falla, se avisa pero no tumba la operación principal (los artefactos en disco `runs/` siguen siendo la fuente).
 */
import * as admin from 'firebase-admin';

export interface IngestionRunDoc {
    run_id: string;
    kind: 'load' | 'republish' | 'reclassify';
    summary: Record<string, unknown>;
}

export async function writeIngestionRun(db: admin.firestore.Firestore, run: IngestionRunDoc): Promise<void> {
    await db.doc(`ingestion_runs/${run.run_id}`).set({
        run_id: run.run_id,
        kind: run.kind,
        created_at: new Date().toISOString(),
        created_at_ts: admin.firestore.FieldValue.serverTimestamp(),
        summary: run.summary
    });
}
