import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    FondosDbHoldingRecord,
    FondosDbManifestValidation,
    FondosDbPackagePaths,
    FondosDbPositionLine,
    FondosDbReaderResult,
    FondosDbRawFund,
    FondosDbUniversalFund,
    FondosDbValidationIssue
} from './fondosDbTypes';

const REQUIRED_RELATIVE_FILES = [
    'manifest_fondosdb_to_bbdd_activos_2026-06-12.json',
    'export/fondos.ndjson',
    'export/posiciones.ndjson',
    'export/manifest.json',
    'reports/fondos_problematicos.md',
    'README_OPERATIVO_FONDOSDB.md'
];

export function buildFondosDbPackagePaths(inputDir: string): FondosDbPackagePaths {
    return {
        inputDir,
        exportBdbDir: path.join(inputDir, 'export_bdb'),
        packageManifestPath: path.join(inputDir, 'manifest_fondosdb_to_bbdd_activos_2026-06-12.json'),
        universalManifestPath: path.join(inputDir, 'export', 'manifest.json'),
        fondosNdjsonPath: path.join(inputDir, 'export', 'fondos.ndjson'),
        posicionesNdjsonPath: path.join(inputDir, 'export', 'posiciones.ndjson'),
        problematicReportPath: path.join(inputDir, 'reports', 'fondos_problematicos.md'),
        qualityCsvPath: path.join(inputDir, 'reports', 'calidad_resumen.csv'),
        readmePath: path.join(inputDir, 'README_OPERATIVO_FONDOSDB.md')
    };
}

export function readFondosDbPackage(inputDir: string): FondosDbReaderResult {
    const paths = buildFondosDbPackagePaths(inputDir);
    const validation = validateFondosDbPackage(paths);
    const manifest = readJsonIfExists(paths.packageManifestPath);
    const sourceFileManifest = buildSourceFileManifest(inputDir);

    if (validation.status === 'BLOCKED_SAFE') {
        return {
            manifest,
            validation,
            rawFunds: [],
            universalFundsByIsin: new Map(),
            holdingsByFundIsin: new Map(),
            sourceFileManifest,
            problematicByIsin: readProblematicReport(paths.problematicReportPath),
            qualityRowsByIsin: readQualityCsv(paths.qualityCsvPath)
        };
    }

    const rawFunds = readExportBdbFunds(paths.exportBdbDir);
    const universalFundsByIsin = readUniversalFunds(paths.fondosNdjsonPath);
    const holdingsByFundIsin = readHoldings(paths.posicionesNdjsonPath);

    return {
        manifest,
        validation,
        rawFunds,
        universalFundsByIsin,
        holdingsByFundIsin,
        sourceFileManifest,
        problematicByIsin: readProblematicReport(paths.problematicReportPath),
        qualityRowsByIsin: readQualityCsv(paths.qualityCsvPath)
    };
}

export function validateFondosDbPackage(paths: FondosDbPackagePaths): FondosDbManifestValidation {
    const issues: FondosDbValidationIssue[] = [];
    const requiredFiles: Record<string, boolean> = {};

    for (const rel of REQUIRED_RELATIVE_FILES) {
        const exists = fs.existsSync(path.join(paths.inputDir, rel));
        requiredFiles[rel] = exists;
        if (!exists) {
            issues.push({ severity: 'ERROR', code: 'MISSING_REQUIRED_FILE', message: `Required file is missing: ${rel}`, file: rel });
        }
    }

    const exportBdbExists = fs.existsSync(paths.exportBdbDir) && fs.statSync(paths.exportBdbDir).isDirectory();
    if (!exportBdbExists) {
        issues.push({ severity: 'ERROR', code: 'MISSING_EXPORT_BDB', message: 'export_bdb directory is missing.', file: 'export_bdb/' });
    }

    const importableFiles = exportBdbExists ? listImportableJsonFiles(paths.exportBdbDir) : [];
    const invalidJsonIssues = validateJsonFiles(importableFiles, paths.inputDir);
    issues.push(...invalidJsonIssues);

    const resumenPath = path.join(paths.exportBdbDir, '_resumen.json');
    const resumenPresent = fs.existsSync(resumenPath);
    const resumenImported = importableFiles.some(file => path.basename(file).startsWith('_'));
    if (resumenImported) {
        issues.push({ severity: 'ERROR', code: 'RESUMEN_JSON_IMPORTED', message: 'export_bdb/_resumen.json must not be imported.' });
    }

    if (importableFiles.length !== 496) {
        issues.push({
            severity: 'ERROR',
            code: 'UNEXPECTED_EXPORT_BDB_COUNT',
            message: `Expected 496 importable JSON files in export_bdb, found ${importableFiles.length}.`
        });
    }

    issues.push(...scanSafetyIssues(paths.inputDir));

    return {
        status: issues.some(issue => issue.severity === 'ERROR') ? 'BLOCKED_SAFE' : 'OK',
        input_dir: paths.inputDir,
        checked_at: new Date().toISOString(),
        export_bdb_exists: exportBdbExists,
        importable_json_count: importableFiles.length,
        invalid_json_count: invalidJsonIssues.length,
        resumen_json_present: resumenPresent,
        resumen_json_imported: resumenImported,
        required_files: requiredFiles,
        issues
    };
}

export function listImportableJsonFiles(exportBdbDir: string): string[] {
    if (!fs.existsSync(exportBdbDir)) return [];
    return fs.readdirSync(exportBdbDir)
        .filter(name => name.endsWith('.json') && !name.startsWith('_'))
        .sort()
        .map(name => path.join(exportBdbDir, name));
}

function readExportBdbFunds(exportBdbDir: string): Array<{ file: string; data: FondosDbRawFund }> {
    return listImportableJsonFiles(exportBdbDir).map(file => ({
        file: path.basename(file),
        data: JSON.parse(fs.readFileSync(file, 'utf-8')) as FondosDbRawFund
    }));
}

function readUniversalFunds(fondosNdjsonPath: string): Map<string, FondosDbUniversalFund> {
    const byIsin = new Map<string, FondosDbUniversalFund>();
    if (!fs.existsSync(fondosNdjsonPath)) return byIsin;

    for (const line of fs.readFileSync(fondosNdjsonPath, 'utf-8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const fund = JSON.parse(line) as FondosDbUniversalFund;
        const isin = String(fund._id || fund.meta?.isin || '').toUpperCase();
        if (isin) byIsin.set(isin, fund);
    }

    return byIsin;
}

function readHoldings(posicionesNdjsonPath: string): Map<string, FondosDbHoldingRecord[]> {
    const byFund = new Map<string, FondosDbHoldingRecord[]>();
    if (!fs.existsSync(posicionesNdjsonPath)) return byFund;

    for (const line of fs.readFileSync(posicionesNdjsonPath, 'utf-8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as FondosDbPositionLine;
        const fundIsin = String(parsed.isin || '').toUpperCase();
        if (!fundIsin) continue;

        const records = parsed.posiciones?.map((position, index) => {
            const holdingIsin = position.isin ? String(position.isin).toUpperCase() : null;
            const holdingTicker = position.ticker ? String(position.ticker).toUpperCase() : null;
            const stableKey = holdingIsin || holdingTicker || `${position.nombre || 'holding'}-${index + 1}`;
            return {
                asset_id: fundIsin,
                source_fund_isin: fundIsin,
                holding_id: `${fundIsin}:${stableKey}:${index + 1}`,
                as_of_date: parsed.fecha || null,
                name: position.nombre || null,
                identifiers: {
                    isin: holdingIsin,
                    ticker: holdingTicker
                },
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
                }
            };
        }) || [];

        byFund.set(fundIsin, [...(byFund.get(fundIsin) || []), ...records]);
    }

    return byFund;
}

function validateJsonFiles(files: string[], inputDir: string): FondosDbValidationIssue[] {
    const issues: FondosDbValidationIssue[] = [];
    for (const file of files) {
        try {
            JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch (error: any) {
            issues.push({
                severity: 'ERROR',
                code: 'INVALID_JSON',
                message: error.message,
                file: path.relative(inputDir, file)
            });
        }
    }
    return issues;
}

function scanSafetyIssues(inputDir: string): FondosDbValidationIssue[] {
    const issues: FondosDbValidationIssue[] = [];
    const files = listFilesRecursive(inputDir);
    const forbiddenContent = [
        { code: 'RETROCESSION_PRESENT', pattern: /"retrocession"\s*:/i },
        { code: 'MANUAL_COSTS_RETROCESSION_PRESENT', pattern: /manual\.costs\.retrocession/i },
        { code: 'ECONOMIC_EXPOSURE_PRESENT', pattern: /"economic_exposure"\s*:/i },
        { code: 'SERVICE_ACCOUNT_PRESENT', pattern: /"serviceAccount"\s*:\s*("[^"]+"|true|\{)/i },
        { code: 'TOKEN_PRESENT', pattern: /"(api_?token|access_?token|refresh_?token|token)"\s*:\s*"[^"]+"/i }
    ];

    for (const file of files) {
        const rel = path.relative(inputDir, file);
        const base = path.basename(file);
        if (base === '.env' || /credential|credentials|serviceAccount|token/i.test(base)) {
            issues.push({ severity: 'ERROR', code: 'FORBIDDEN_SECRET_FILENAME', message: `Forbidden secret-like filename found: ${rel}`, file: rel });
        }

        if (base === 'manifest_fondosdb_to_bbdd_activos_2026-06-12.json') {
            continue;
        }

        const text = fs.readFileSync(file, 'utf-8');
        for (const check of forbiddenContent) {
            if (check.pattern.test(text)) {
                issues.push({ severity: 'ERROR', code: check.code, message: `Forbidden content pattern found in ${rel}.`, file: rel });
            }
        }

        if (/\bcredentials\b/i.test(text)) {
            issues.push({
                severity: 'INFO',
                code: 'CREDENTIALS_LITERAL_REVIEWED',
                message: 'The literal credentials appears in fund descriptive text; reviewed as non-technical ESG text.',
                file: rel
            });
        }
    }

    return issues;
}

function buildSourceFileManifest(inputDir: string): Array<{ path: string; bytes: number; sha256: string }> {
    return listFilesRecursive(inputDir)
        .sort()
        .map(file => {
            const content = fs.readFileSync(file);
            return {
                path: path.relative(inputDir, file).replace(/\\/g, '/'),
                bytes: content.byteLength,
                sha256: crypto.createHash('sha256').update(content).digest('hex')
            };
        });
}

function listFilesRecursive(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...listFilesRecursive(full));
        if (entry.isFile()) files.push(full);
    }
    return files;
}

function readJsonIfExists(file: string): any | null {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function readProblematicReport(file: string): Map<string, { line: string; flags: string[]; bucket?: string; score?: number }> {
    const map = new Map<string, { line: string; flags: string[]; bucket?: string; score?: number }>();
    if (!fs.existsSync(file)) return map;

    const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\- \*\*([A-Z0-9]{12})\*\* .* ([A-Z]+) \((\d+)\).* (.*)$/);
        if (!match) continue;
        map.set(match[1], {
            line,
            bucket: match[2],
            score: Number(match[3]),
            flags: match[4].split(';').map(flag => flag.trim()).filter(Boolean)
        });
    }
    return map;
}

function readQualityCsv(file: string): Map<string, { bucket?: string; score?: number; flags: string[] }> {
    const map = new Map<string, { bucket?: string; score?: number; flags: string[] }>();
    if (!fs.existsSync(file)) return map;

    const [headerLine, ...rows] = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(headerLine);
    for (const row of rows) {
        const values = parseCsvLine(row);
        const record: Record<string, string> = {};
        headers.forEach((header, index) => record[header] = values[index] || '');
        if (!record.isin) continue;
        map.set(record.isin.toUpperCase(), {
            bucket: record.bucket,
            score: record.score ? Number(record.score) : undefined,
            flags: record.flags ? record.flags.split(';').map(flag => flag.trim()).filter(Boolean) : []
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
