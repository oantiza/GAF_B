export const HOLDINGS_DOCUMENT_MAX_BYTES = 450_000;

export const HOLDINGS_STORAGE_MODE = {
    SINGLE_DOCUMENT: 'SINGLE_DOCUMENT',
    CHUNKED: 'CHUNKED',
    CHUNK: 'CHUNK'
} as const;

export type FundHoldingsStorageMode =
    | typeof HOLDINGS_STORAGE_MODE.SINGLE_DOCUMENT
    | typeof HOLDINGS_STORAGE_MODE.CHUNKED;

export type MasterHoldingsStorageMode =
    | FundHoldingsStorageMode
    | typeof HOLDINGS_STORAGE_MODE.CHUNK;
