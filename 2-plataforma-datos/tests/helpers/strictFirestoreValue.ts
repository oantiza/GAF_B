function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function assertNoUndefinedFirestoreValue(value: unknown, path = '$'): void {
    if (value === undefined) {
        throw new Error(`Cannot use undefined as a Firestore value at ${path}`);
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoUndefinedFirestoreValue(item, `${path}[${index}]`));
        return;
    }

    if (!isPlainObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
        assertNoUndefinedFirestoreValue(child, `${path}.${key}`);
    }
}

export function cloneFirestoreValue<T>(value: T): T {
    assertNoUndefinedFirestoreValue(value);
    return JSON.parse(JSON.stringify(value));
}
