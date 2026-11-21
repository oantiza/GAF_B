/**
 * src/loader/packageReader.ts — lector de paquete canonico AGNOSTICO de fecha/recuento.
 *
 * A diferencia del reader legacy (fondosDbReader.validateFondosDbPackage), NO exige un
 * manifiesto con fecha fija ni un recuento exacto (496). Lee directamente:
 *   - export_bdb/*.json     (canonico, 1 por activo)
 *   - export/fondos.ndjson  (universal)
 *   - export/posiciones.ndjson (holdings)
 * Reusa listImportableJsonFiles del reader legacy y replica la construccion de holdings
 * VERBATIM para garantizar paridad de forma con los 404 ya escritos.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { validators } from '../../contracts/validators';
import { listImportableJsonFiles } from '../ingestion/fondosdb/fondosDbReader';
import {
    FondosDbHoldingRecord,
    FondosDbPositionLine,
    FondosDbRawFund,
    FondosDbUniversalFund
} from '../ingestion/fondosdb/fondosDbTypes';

export interface CanonicalPackagePaths {
    exportBdbDir: string;
    fondosNdjsonPath: string;
    posicionesNdjsonPath: string;
    manifestPath?: string;
    problematicReportPath?: string;
    qualityCsvPath?: string;
}

export interface CanonicalPackage {
    rawFunds: Array<{ file: string; data: FondosDbRawFund; isin: string }>;
    rawByIsin: Map<string, { file: string; data: FondosDbRawFund }>;
    universalByIsin: Map<string, FondosDbUniversalFund>;
    holdingsByFundIsin: Map<string, FondosDbHoldingRecord[]>;
    problematicByIsin: Map<string, { flags: string[]; bucket?: string }>;
    qualityByIsin: Map<string, { bucket?: string; flags: string[] }>;
    duplicateIsins: Set<string>;
    canonicalValidationIssues: CanonicalValidationIssue[];
}

export interface CanonicalValidationIssue {
    source: 'export_bdb' | 'posiciones.ndjson';
    file: string;
    line?: number;
    asset_id: string | null;
    errors: string[];
}

function normIsin(value: unknown): string {
    return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function sha1(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex');
}

function sha256File(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function nonEmptyLineCount(filePath: string): number {
    return fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter((line) => line.trim()).length;
}

export function readCanonicalPackage(paths: CanonicalPackagePaths): CanonicalPackage {
    const rawFunds: Array<{ file: string; data: FondosDbRawFund; isin: string }> = [];
    const rawByIsin = new Map<string, { file: string; data: FondosDbRawFund }>();
    const seen = new Set<string>();
    const duplicateIsins = new Set<string>();
    const canonicalValidationIssues: CanonicalValidationIssue[] = [];

    for (const filePath of listImportableJsonFiles(paths.exportBdbDir)) {
        const base = path.basename(filePath);
        let data: FondosDbRawFund;
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FondosDbRawFund;
        } catch (error: any) {
            canonicalValidationIssues.push({
                source: 'export_bdb',
                file: base,
                asset_id: isinFromFileName(base),
                errors: [`JSON no valido: ${String(error?.message || error)}`]
            });
            continue;
        }
        const isin = normIsin(data.isin);
        const canonicalContract = data.classification_v2?.asset_type === 'stock'
            ? validators.canonicalStock(data)
            : validators.canonicalFund(data);
        if (!canonicalContract.ok) {
            canonicalValidationIssues.push({
                source: 'export_bdb',
                file: base,
                asset_id: isin || isinFromFileName(base),
                errors: formatContractErrors(canonicalContract.errors)
            });
        }
        rawFunds.push({ file: base, data, isin });
        if (isin) {
            if (seen.has(isin)) duplicateIsins.add(isin);
            seen.add(isin);
            if (!rawByIsin.has(isin)) rawByIsin.set(isin, { file: base, data });
        }
    }

    const universal = readUniversalFunds(paths.fondosNdjsonPath);
    const holdings = readHoldings(paths.posicionesNdjsonPath, canonicalValidationIssues);
    validateNdjsonManifest(paths, universal.stats, holdings.stats);

    return {
        rawFunds,
        rawByIsin,
        universalByIsin: universal.byIsin,
        holdingsByFundIsin: holdings.byFund,
        problematicByIsin: paths.problematicReportPath
            ? readProblematicReport(paths.problematicReportPath)
            : new Map(),
        qualityByIsin: paths.qualityCsvPath ? readQualityCsv(paths.qualityCsvPath) : new Map(),
        duplicateIsins,
        canonicalValidationIssues
    };
}

export function canonicalIssuesForAsset(pkg: CanonicalPackage, assetId: string): CanonicalValidationIssue[] {
    const normalized = normIsin(assetId);
    return pkg.canonicalValidationIssues.filter((issue) => issue.asset_id === normalized);
}

function isinFromFileName(file: string): string | null {
    const match = path.basename(file, path.extname(file)).toUpperCase().match(/[A-Z]{2}[A-Z0-9]{10}/);
    return match ? normIsin(match[0]) : null;
}

function formatContractErrors(errors: Array<{ instancePath?: string; message?: string }>): string[] {
    return errors.map((error) => `${error.instancePath || '/'} ${error.message || 'no valida'}`.trim());
}

interface NdjsonStats {
    lineCount: number;
    sha1ByIsin: Map<string, string>;
}

function emptyStats(): NdjsonStats {
    return { lineCount: 0, sha1ByIsin: new Map() };
}

function readUniversalFunds(fondosNdjsonPath: string): { byIsin: Map<string, FondosDbUniversalFund>; stats: NdjsonStats } {
    const byIsin = new Map<string, FondosDbUniversalFund>();
    const stats = emptyStats();
    if (!fs.existsSync(fondosNdjsonPath)) return { byIsin, stats };
    for (const line of fs.readFileSync(fondosNdjsonPath, 'utf-8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        stats.lineCount++;
        const fund = JSON.parse(line) as FondosDbUniversalFund;
        const isin = normIsin(fund._id || fund.meta?.isin);
        if (isin) {
            byIsin.set(isin, fund);
            stats.sha1ByIsin.set(isin, sha1(line.trim()));
        }
    }
    return { byIsin, stats };
}

/** Construccion de holdings VERBATIM respecto al reader legacy (paridad con los 404). */
function readHoldings(
    posicionesNdjsonPath: string,
    validationIssues: CanonicalValidationIssue[]
): { byFund: Map<string, FondosDbHoldingRecord[]>; stats: NdjsonStats } {
    const byFund = new Map<string, FondosDbHoldingRecord[]>();
    const stats = emptyStats();
    if (!fs.existsSync(posicionesNdjsonPath)) return { byFund, stats };

    const fileName = path.basename(posicionesNdjsonPath) || 'posiciones.ndjson';
    const lines = fs.readFileSync(posicionesNdjsonPath, 'utf-8').split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        if (!line.trim()) continue;
        stats.lineCount++;
        let parsed: FondosDbPositionLine;
        try {
            parsed = JSON.parse(line) as FondosDbPositionLine;
        } catch (error: any) {
            validationIssues.push({
                source: 'posiciones.ndjson',
                file: fileName,
                line: lineIndex + 1,
                asset_id: null,
                errors: [`JSON no valido: ${String(error?.message || error)}`]
            });
            continue;
        }
        const fundIsin = normIsin(parsed.isin);
        const contract = validators.canonicalHoldings(parsed);
        if (!contract.ok) {
            validationIssues.push({
                source: 'posiciones.ndjson',
                file: fileName,
                line: lineIndex + 1,
                asset_id: fundIsin || null,
                errors: formatContractErrors(contract.errors)
            });
            continue;
        }
        if (!fundIsin) continue;

        const records: FondosDbHoldingRecord[] = (parsed.posiciones || []).map((position, index) => {
            const holdingIsin = position.isin ? String(position.isin).toUpperCase() : null;
            const holdingTicker = position.ticker ? String(position.ticker).toUpperCase() : null;
            const stableKey = holdingIsin || holdingTicker || `${position.nombre || 'holding'}-${index + 1}`;
            return {
                asset_id: fundIsin,
                source_fund_isin: fundIsin,
                holding_id: `${fundIsin}:${stableKey}:${index + 1}`,
                as_of_date: parsed.fecha || null,
                name: position.nombre || null,
                identifiers: { isin: holdingIsin, ticker: holdingTicker },
                holding_type: position.tipo || null,
                weight_pct: position.peso_pct ?? null,
                currency: position.divisa || null,
                sector: position.sector || null,
                country: position.pais || null,
                source_metadata: {
                    source: 'FondosDB' as const,
                    file: 'export/posiciones.ndjson',
                    part: parsed.parte,
                    total_parts: parsed.total_partes
                },
                raw_source_position: position,
                procedencia: parsed.procedencia ?? null
            };
        });

        byFund.set(fundIsin, [...(byFund.get(fundIsin) || []), ...records]);
    }

    return { byFund, stats };
}

function validateNdjsonManifest(paths: CanonicalPackagePaths, fondosStats: NdjsonStats, posicionesStats: NdjsonStats): void {
    const manifestPath = paths.manifestPath || deriveManifestPath(paths.fondosNdjsonPath);
    if (!manifestPath) return;
    if (!fs.existsSync(manifestPath)) {
        if (paths.manifestPath) throw new Error(`[package manifest] no existe manifest.json esperado: ${manifestPath}`);
        return;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const expectedVersion = process.env.FONDOSDB_NDJSON_MANIFEST_SCHEMA_VERSION;
    const schemaVersion = manifest.esquema_version ?? manifest.schema_version;
    const acceptedVersions = expectedVersion ? [String(expectedVersion)] : ['2', '3', 'fondosdb-ndjson.v1'];
    if (!acceptedVersions.includes(String(schemaVersion))) {
        throw new Error(`[package manifest] esquema_version esperado '${acceptedVersions.join(' o ')}', recibido '${String(schemaVersion)}' (${manifestPath})`);
    }

    if (String(schemaVersion) === '3') validateStrongPackageManifest(paths, manifestPath, manifest);

    assertManifestCount(manifest, ['n_fondos', 'fondos', 'fondos_count', 'total_fondos', 'fondos_ndjson', 'fondos.ndjson'], fondosStats.lineCount, 'fondos.ndjson');
    assertManifestCount(manifest, ['n_lineas_posiciones', 'posiciones', 'posiciones_count', 'total_posiciones', 'posiciones_ndjson', 'posiciones.ndjson'], posicionesStats.lineCount, 'posiciones.ndjson', { optional: true });

    for (const entry of extractFundSha1Entries(manifest)) {
        const actual = fondosStats.sha1ByIsin.get(entry.isin);
        if (!actual) throw new Error(`[package manifest] sha1 declarado para ISIN no presente en fondos.ndjson: ${entry.isin}`);
        if (actual.toLowerCase() !== entry.sha1.toLowerCase()) {
            throw new Error(`[package manifest] sha1 no coincide para ${entry.isin}: esperado ${entry.sha1}, calculado ${actual}`);
        }
    }
}

function validateStrongPackageManifest(paths: CanonicalPackagePaths, manifestPath: string, manifest: any): void {
    const packageId = typeof manifest.package_id === 'string' ? manifest.package_id : '';
    if (!/^[a-f0-9]{64}$/i.test(packageId)) {
        throw new Error('[package manifest] package_id SHA256 ausente o invalido');
    }
    const files = manifest.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
        throw new Error('[package manifest] files fuerte ausente');
    }
    const manifestDir = path.resolve(path.dirname(manifestPath));
    for (const [name, rawMeta] of Object.entries(files as Record<string, any>)) {
        const filePath = path.resolve(manifestDir, name);
        if (path.dirname(filePath) !== manifestDir) {
            throw new Error(`[package manifest] ruta fuera del paquete: ${name}`);
        }
        const meta = rawMeta as { bytes?: number; sha256?: string; line_count?: number };
        if (!fs.existsSync(filePath)) throw new Error(`[package manifest] fichero ausente: ${name}`);
        if (fs.statSync(filePath).size !== Number(meta.bytes)) {
            throw new Error(`[package manifest] bytes no coinciden para ${name}`);
        }
        if (!/^[a-f0-9]{64}$/i.test(String(meta.sha256 || '')) || sha256File(filePath) !== String(meta.sha256).toLowerCase()) {
            throw new Error(`[package manifest] sha256 no coincide para ${name}`);
        }
        if (meta.line_count !== undefined && nonEmptyLineCount(filePath) !== Number(meta.line_count)) {
            throw new Error(`[package manifest] line_count no coincide para ${name}`);
        }
    }

    const summaryPath = path.join(paths.exportBdbDir, '_resumen.json');
    if (!fs.existsSync(summaryPath)) throw new Error('[package manifest] falta export_bdb/_resumen.json');
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    if (summary.package_id !== packageId) {
        throw new Error(`[package manifest] export y export_bdb pertenecen a snapshots distintos (${packageId}/${String(summary.package_id)})`);
    }
    if (Number(summary.errores || 0) !== 0) {
        throw new Error(`[package manifest] export_bdb declara ${summary.errores} errores`);
    }
    const canonicalFiles = summary.files;
    if (!canonicalFiles || typeof canonicalFiles !== 'object' || Array.isArray(canonicalFiles)) {
        throw new Error('[package manifest] export_bdb/_resumen.json no contiene hashes de ficheros');
    }
    const expectedNames = Object.keys(canonicalFiles).sort();
    const actualNames = listImportableJsonFiles(paths.exportBdbDir).map((file) => path.basename(file)).sort();
    if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) {
        throw new Error('[package manifest] export_bdb contiene ficheros no declarados o faltantes');
    }
    const exportBdbRoot = path.resolve(paths.exportBdbDir);
    for (const [name, rawMeta] of Object.entries(canonicalFiles as Record<string, any>)) {
        const filePath = path.resolve(exportBdbRoot, name);
        if (path.dirname(filePath) !== exportBdbRoot || !fs.existsSync(filePath)) {
            throw new Error(`[package manifest] canonico ausente o fuera del paquete: ${name}`);
        }
        const meta = rawMeta as { bytes?: number; sha256?: string };
        if (fs.statSync(filePath).size !== Number(meta.bytes) || sha256File(filePath) !== String(meta.sha256 || '').toLowerCase()) {
            throw new Error(`[package manifest] canonico alterado: ${name}`);
        }
    }
}

function deriveManifestPath(fondosNdjsonPath: string): string | undefined {
    if (!fondosNdjsonPath) return undefined;
    return path.join(path.dirname(fondosNdjsonPath), 'manifest.json');
}

function assertManifestCount(manifest: any, aliases: string[], actual: number, label: string, options: { optional?: boolean } = {}): void {
    const expected = findManifestValue(manifest, aliases);
    if (expected === undefined) {
        if (options.optional) return;
        throw new Error(`[package manifest] falta conteo para ${label}`);
    }
    if (Number(expected) !== actual) {
        throw new Error(`[package manifest] conteo ${label} no cuadra: manifest=${expected}, lineas=${actual}`);
    }
}

function findManifestValue(manifest: any, aliases: string[]): unknown {
    const containers = [manifest, manifest.counts, manifest.conteos, manifest.totals, manifest.resumen].filter(Boolean);
    for (const container of containers) {
        for (const alias of aliases) {
            const value = container[alias];
            if (typeof value === 'number' || typeof value === 'string') return value;
            if (value && (typeof value.records === 'number' || typeof value.lineas === 'number' || typeof value.count === 'number')) {
                return value.records ?? value.lineas ?? value.count;
            }
        }
    }
    return undefined;
}

function extractFundSha1Entries(manifest: any): Array<{ isin: string; sha1: string }> {
    const entries: Array<{ isin: string; sha1: string }> = [];
    const objects = [
        manifest.sha1_por_fondo,
        manifest.fondos_sha1,
        manifest.hashes_por_fondo,
        manifest.files?.['fondos.ndjson']?.sha1_por_fondo,
        manifest.files?.['fondos.ndjson']?.sha1_by_fund
    ].filter(Boolean);

    for (const obj of objects) {
        for (const [isin, hash] of Object.entries(obj)) {
            if (typeof hash === 'string') entries.push({ isin: normIsin(isin), sha1: hash });
        }
    }

    const arrays = [manifest.fondos, manifest.funds, manifest.files?.['fondos.ndjson']?.fondos].filter(Array.isArray);
    for (const arr of arrays) {
        for (const item of arr) {
            const isin = normIsin(item?.isin ?? item?._id ?? item?.meta?.isin);
            const hash = item?.sha1 ?? item?.hash_sha1 ?? item?.line_sha1 ?? item?.hash;
            if (isin && typeof hash === 'string') entries.push({ isin, sha1: hash });
        }
    }
    return entries;
}

function readProblematicReport(file: string): Map<string, { flags: string[]; bucket?: string }> {
    const map = new Map<string, { flags: string[]; bucket?: string }>();
    if (!fs.existsSync(file)) return map;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
        const match = line.match(/^\- \*\*([A-Z0-9]{12})\*\* .* ([A-Z]+) \((\d+)\).* (.*)$/);
        if (!match) continue;
        map.set(match[1], {
            bucket: match[2],
            flags: match[4].split(';').map((flag) => flag.trim()).filter(Boolean)
        });
    }
    return map;
}

function readQualityCsv(file: string): Map<string, { bucket?: string; flags: string[] }> {
    const map = new Map<string, { bucket?: string; flags: string[] }>();
    if (!fs.existsSync(file)) return map;
    const [headerLine, ...rows] = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
    if (!headerLine) return map;
    const headers = parseCsvLine(headerLine);
    for (const row of rows) {
        const values = parseCsvLine(row);
        const record: Record<string, string> = {};
        headers.forEach((header, index) => (record[header] = values[index] || ''));
        if (!record.isin) continue;
        map.set(record.isin.toUpperCase(), {
            bucket: record.bucket,
            flags: record.flags ? record.flags.split(';').map((f) => f.trim()).filter(Boolean) : []
        });
    }
    return map;
}

function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"' && next === '"') {
            current += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            out.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    out.push(current);
    return out;
}
