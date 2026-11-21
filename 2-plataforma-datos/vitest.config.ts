import { configDefaults, defineConfig } from 'vitest/config';

// `_legacy/` es historico no ejecutable (scripts/README.md): no lo recogen ni los tsconfig ni la suite. Un test
// que vive ahi documenta lo que hacia el codigo archivado y no forma parte de la CI; si un test vigente necesita
// algo de `_legacy/`, vive en `tests/` (decision 6.8, 17-10-2026). El resto de la configuracion es la de serie.
export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, '_legacy/**']
    }
});
