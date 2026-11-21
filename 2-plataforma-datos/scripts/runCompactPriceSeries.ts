import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import dotenv from 'dotenv';
import { validators } from '../contracts/validators';
import { ALLOWED_PROJECT_IDS } from '../src/config/projectAllowlist';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const WRITE_GATE = 'BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES';
const WRITE_GATE_VALUE = 'YES_I_UNDERSTAND_MASTER_DB_WRITES';
const REFRESH_RE = /^EODHD_(.+)_REFRESH_(\d{4})$/;

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function has(name: string): boolean {
    return process.argv.includes(name);
}

function db(): admin.firestore.Firestore {
    const projectId = process.env.FIREBASE_PROJECT_ID?.replace(/^["']|["']$/g, '');
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID ausente.');
    if (!ALLOWED_PROJECT_IDS.has(projectId)) throw new Error(`Project id fuera de allowlist: ${projectId}`);
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.FIREBASE_SERVICE_ACCOUNT_PATH.replace(/^["']|["']$/g, '');
    }
    if (!admin.apps.length) admin.initializeApp({ projectId });
    return admin.firestore();
}

function canonicalId(refreshId: string): { id: string; year: number } | null {
    const m = refreshId.match(REFRESH_RE);
    if (!m) return null;
    return { id: `EODHD_${m[1]}_${m[2]}`, year: Number(m[2]) };
}

function mergeSeries(assetId: string, canonId: string, year: number, docs: any[], now: string): any {
    const byDate = new Map<string, any>();
    for (const doc of docs) {
        for (const p of doc.points || []) {
            if (p?.date) byDate.set(String(p.date), p);
        }
    }
    const points = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const { _doc_id, _path, _year, ...seed } = docs[0] || {};
    return {
        ...seed,
        schema_version: 'asset-price-series.v1.2',
        asset_id: assetId,
        source_price_id: seed.source_price_id || seed.source_listing_id || canonId,
        document_id: canonId,
        year,
        points,
        first_date: points[0]?.date,
        last_date: points[points.length - 1]?.date,
        observations_count: points.length,
        refresh: false,
        updated_at: now
    };
}

function sampleDates(points: any[]): string[] {
    const dates = points.map((p) => String(p.date)).filter(Boolean);
    if (dates.length <= 5) return dates;
    const picks = new Set<number>([0, dates.length - 1]);
    while (picks.size < 5) picks.add(Math.floor((picks.size * 997) % dates.length));
    return [...picks].sort((a, b) => a - b).map((i) => dates[i]);
}

async function main(): Promise<void> {
    const write = has('--write');
    const cleanup = has('--apply-cleanup');
    const limit = flag('--limit') ? Number(flag('--limit')) : 0;
    if ((write || cleanup) && process.env[WRITE_GATE] !== WRITE_GATE_VALUE) {
        throw new Error(`SECURITY FAULT: ${WRITE_GATE} debe valer '${WRITE_GATE_VALUE}'.`);
    }
    if (cleanup && !write) throw new Error('--apply-cleanup requiere --write.');

    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(process.cwd(), 'runs', `compact_price_series_${runId}`);
    fs.mkdirSync(outDir, { recursive: true });
    const firestore = db();
    const now = new Date().toISOString();

    const plan: any[] = [];
    let scannedAssets = 0;
    const assetSnaps = await firestore.collection('assets').get();
    for (const assetSnap of assetSnaps.docs) {
        if (limit && scannedAssets >= limit) break;
        scannedAssets++;
        const assetId = assetSnap.id;
        const series = await firestore.collection(`assets/${assetId}/price_series`).get();
        const byCanon = new Map<string, any[]>();
        const refreshPaths: string[] = [];
        for (const snap of series.docs) {
            const c = canonicalId(snap.id);
            if (!c) continue;
            const data = snap.data();
            const item = { ...data, _doc_id: snap.id, _path: snap.ref.path, _year: c.year };
            refreshPaths.push(snap.ref.path);
            const arr = byCanon.get(c.id) || [];
            arr.push(item);
            byCanon.set(c.id, arr);
        }
        for (const [canonId, refreshDocs] of byCanon) {
            const canonSnap = await firestore.doc(`assets/${assetId}/price_series/${canonId}`).get();
            const docs = canonSnap.exists
                ? [{ ...(canonSnap.data() || {}), _doc_id: canonId, _path: canonSnap.ref.path, _year: refreshDocs[0]._year }, ...refreshDocs]
                : refreshDocs;
            const beforePoints = docs.reduce((acc, d) => acc + ((d.points || []).length), 0);
            const payload = mergeSeries(assetId, canonId, refreshDocs[0]._year, docs, now);
            const valid = validators.masterPriceSeriesV11(payload);
            const entry = {
                asset_id: assetId,
                canonical_path: `assets/${assetId}/price_series/${canonId}`,
                refresh_paths: refreshDocs.map((d) => d._path),
                canonical_existed: canonSnap.exists,
                buckets: docs.map((d) => d._doc_id),
                points_before: beforePoints,
                points_after: payload.points.length,
                sample_dates: sampleDates(payload.points),
                valid: valid.ok,
                validation_errors: valid.errors.map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
            };
            plan.push(entry);
            if (write) {
                if (!valid.ok) throw new Error(`Contrato invalido ${entry.canonical_path}: ${entry.validation_errors.join('; ')}`);
                await firestore.doc(entry.canonical_path).set(payload);
                const after = (await firestore.doc(entry.canonical_path).get()).data() || {};
                if ((after.points || []).length !== payload.points.length) {
                    throw new Error(`Postverify count mismatch ${entry.canonical_path}`);
                }
                for (const date of entry.sample_dates) {
                    if (!(after.points || []).some((p: any) => p.date === date)) {
                        throw new Error(`Postverify sample missing ${entry.canonical_path} ${date}`);
                    }
                }
            }
        }
        if (cleanup && write) {
            for (const docPath of refreshPaths) await firestore.doc(docPath).delete();
        }
    }

    const cleanupDocs = [...new Set(plan.flatMap((p) => p.refresh_paths))].sort();
    const summary = {
        run_id: runId,
        write,
        apply_cleanup: cleanup,
        scanned_assets: scannedAssets,
        series_to_compact: plan.length,
        canonical_writes: write ? plan.length : 0,
        refresh_docs_cleanup_candidates: cleanupDocs.length,
        refresh_docs_deleted: cleanup && write ? cleanupDocs.length : 0,
        invalid: plan.filter((p) => !p.valid).length
    };
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    fs.writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
    fs.writeFileSync(path.join(outDir, 'cleanup_docs.json'), JSON.stringify(cleanupDocs, null, 2) + '\n');
    console.log(`[compact] write=${write} cleanup=${cleanup} series=${summary.series_to_compact} canonical_writes=${summary.canonical_writes} invalid=${summary.invalid}`);
    console.log(`[compact] artefactos en ${outDir}`);
}

main().catch((e) => {
    console.error('[compact] ERROR:', e?.message || e);
    process.exit(1);
});
