export const HOLDINGS_LATEST_PATH_PATTERN = /^assets\/[^/]+\/holdings\/latest$/;
export const HOLDINGS_MANIFEST_PATH_PATTERN = /^assets\/[^/]+\/holdings\/manifest$/;
export const HOLDINGS_CHUNK_PATH_PATTERN = /^assets\/[^/]+\/holdings\/manifest\/chunks\/chunk_\d{4}$/;
export const LEGACY_INVALID_HOLDINGS_CHUNK_PATH_PATTERN = /^assets\/[^/]+\/holdings\/chunks\/chunk_\d{4}$/;
export const ROOT_ASSET_PATH_PATTERN = /^assets\/[^/]+$/;
export const FORBIDDEN_ASSET_SUBCOLLECTION_PATTERN = /\/(metrics|listings|price_series)(\/|$)/;

export function isValidFirestoreDocumentPath(docPath: string): boolean {
    const segments = docPath.split('/');
    if (segments.length === 0 || segments.some(segment => segment.length === 0)) return false;
    return segments.length % 2 === 0;
}

export function formatChunkId(index: number): string {
    return `chunk_${index.toString().padStart(4, '0')}`;
}

export function buildHoldingsChunkDocumentPath(fundAssetId: string, chunkId: string): string {
    return `assets/${fundAssetId}/holdings/manifest/chunks/${chunkId}`;
}

export function isAllowedHoldingsSetPath(docPath: string): boolean {
    return isValidFirestoreDocumentPath(docPath)
        && (
            HOLDINGS_LATEST_PATH_PATTERN.test(docPath)
            || HOLDINGS_MANIFEST_PATH_PATTERN.test(docPath)
            || HOLDINGS_CHUNK_PATH_PATTERN.test(docPath)
        );
}

export function isAllowedHoldingsDeletePath(docPath: string): boolean {
    return isValidFirestoreDocumentPath(docPath)
        && (
            HOLDINGS_LATEST_PATH_PATTERN.test(docPath)
            || HOLDINGS_MANIFEST_PATH_PATTERN.test(docPath)
            || HOLDINGS_CHUNK_PATH_PATTERN.test(docPath)
        );
}

export function isForbiddenHoldingsPlanPath(docPath: string): boolean {
    return ROOT_ASSET_PATH_PATTERN.test(docPath)
        || FORBIDDEN_ASSET_SUBCOLLECTION_PATTERN.test(docPath)
        || LEGACY_INVALID_HOLDINGS_CHUNK_PATH_PATTERN.test(docPath)
        || !isValidFirestoreDocumentPath(docPath);
}
