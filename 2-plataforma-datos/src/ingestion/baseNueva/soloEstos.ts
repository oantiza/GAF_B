/**
 * `--ids A,B,C`: una pasada de la base nueva limitada a unos instrumentos.
 *
 * Existe para refrescar unos pocos sin reescribir los demás (decisión D-9, 11-11-2026: once fondos
 * con la serie de Morningstar). Sin esto, cada pasada reescribe todo el catálogo, y lo que cambia
 * en todos es el sello de la pasada —`updated_at` de la raíz, `package_id` de la procedencia,
 * `computed_at` de la calidad y la tarjeta—: no hay forma de enseñar que los demás no se han
 * tocado si se han vuelto a escribir.
 *
 * Lo que entra es lo que cuelga de `instruments/{id}` para esos ids, tanto lo que se escribe como
 * lo que se busca como sobrante. Lo que no es de un instrumento —el índice de búsqueda, los
 * emisores, los cambios del BCE y el €STR— no entra en una pasada así, y cada orden lo dice.
 */

const ISIN_O_ID = /^[A-Z0-9][A-Z0-9._-]{2,40}$/;

/** Los ids de `--ids`, o `undefined` si la orden no lo lleva. Un `--ids` vacío o raro aborta. */
export function idsDeLaOrden(argv: readonly string[]): ReadonlySet<string> | undefined {
    const indice = argv.indexOf('--ids');
    if (indice === -1) return undefined;
    const valor = argv[indice + 1];
    if (valor === undefined || valor.startsWith('--')) throw new Error('--ids sin lista: pasa los ids separados por comas');
    const ids = valor
        .split(',')
        .map((id) => id.trim().toUpperCase())
        .filter((id) => id !== '');
    if (ids.length === 0) throw new Error('--ids vacio');
    const raros = ids.filter((id) => !ISIN_O_ID.test(id));
    if (raros.length > 0) throw new Error(`--ids con ids que no lo parecen: ${raros.join(', ')}`);
    return new Set(ids);
}

/** ¿Es esta ruta de uno de esos instrumentos? Sin lista, todas lo son. */
export function esDeEstos(ruta: string, ids: ReadonlySet<string> | undefined): boolean {
    if (ids === undefined) return true;
    const partes = ruta.split('/');
    return partes[0] === 'instruments' && partes[1] !== undefined && ids.has(partes[1]);
}

/**
 * ¿Recompone esta pasada del lote el índice de búsqueda? Sin `--ids`, siempre. Con `--ids`, solo si
 * la orden lleva además `--con-indice`.
 *
 * Hace falta para dar de ALTA unos pocos sin reescribir los demás (12-11-2026, once activos de un
 * cliente): un instrumento nuevo no se encuentra en el buscador hasta que entra en `search_shards`,
 * y sin esta opción la única forma era una pasada del lote entera, que reescribe la calidad y la
 * tarjeta de todo el catálogo con su sello. El índice se compone entonces de TODAS las raíces de la
 * base, no de las de la pasada: con una parte saldría un índice de esa parte. Lo que se reescribe
 * fuera de esos instrumentos son solo los fragmentos del índice.
 */
export function recomponeElIndice(argv: readonly string[], ids: ReadonlySet<string> | undefined): boolean {
    const pide = argv.includes('--con-indice');
    if (pide && ids === undefined) throw new Error('--con-indice es para una pasada con --ids: sin --ids el indice se recompone siempre');
    return ids === undefined || pide;
}

/** La línea que cada orden imprime para que se vea a qué se limita. */
export function describirIds(ids: ReadonlySet<string> | undefined): string {
    return ids === undefined ? 'todos' : `${ids.size} (${[...ids].join(', ')})`;
}
