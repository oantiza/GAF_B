export function normalizeIsoUtcDateTime(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const candidate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? `${trimmed}T00:00:00.000Z`
        : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
            ? trimmed
            : /^\d{4}-\d{2}-\d{2}T/.test(trimmed)
                ? `${trimmed}Z`
                : trimmed;

    const date = new Date(candidate);
    return Number.isNaN(date.getTime()) ? trimmed : date.toISOString();
}
