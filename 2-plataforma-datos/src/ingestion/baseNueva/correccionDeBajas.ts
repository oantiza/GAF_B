/**
 * Deshacer una baja falsa en la nube, y nada más.
 *
 * Existe por lo que pasó el 04-11-2026: un re-mapeo sin red leyó el «no lo tengo» de un proveedor
 * como una baja, esa pasada se subió, y cinco instrumentos que cotizan salieron en la web como
 * «Dejó de cotizar». Subir el catálogo entero lo arregla, pero arrastra todo lo demás, y el sitio
 * publicado no está preparado para leerlo.
 *
 * Por eso la regla es estrecha, y va en una función pura para poder probarla sin nube:
 * solo se toca un instrumento que en la nube esté en DELISTED, y nunca se escribe DELISTED.
 */

export type EstadoDeCotizacion = 'TRADING' | 'OUT_OF_SCOPE' | 'DELISTED' | 'NEVER_RESOLVED' | 'UNDETERMINED';

export interface Disponibilidad {
    state: EstadoDeCotizacion;
    since: string;
    last_checked: string;
}

/** Una orden que toque más que esto ya no es corregir unas bajas: es otra cosa. */
export const MAXIMO_DE_CORRECCIONES = 10;

const ESTADOS: readonly string[] = ['TRADING', 'OUT_OF_SCOPE', 'DELISTED', 'NEVER_RESOLVED', 'UNDETERMINED'];
const FECHA = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export interface PasoDeCorreccion {
    id: string;
    antes: unknown;
    despues: Disponibilidad;
    accion: 'escribir' | 'saltar';
    motivo: string;
}

function estadoDe(valor: unknown): unknown {
    return valor !== null && typeof valor === 'object' ? (valor as { state?: unknown }).state : undefined;
}

/**
 * Qué se haría con cada instrumento. Lanza si la orden está mal, porque una orden mal escrita no
 * se corrige a medias contra producción: no se ejecuta.
 */
export function planDeCorreccion(
    deseado: Record<string, Disponibilidad>,
    enLaNube: Record<string, unknown>
): PasoDeCorreccion[] {
    const ids = Object.keys(deseado).sort();
    if (ids.length === 0) throw new Error('la orden no nombra ningun instrumento.');
    if (ids.length > MAXIMO_DE_CORRECCIONES) {
        throw new Error(`la orden nombra ${ids.length} instrumentos y el maximo es ${MAXIMO_DE_CORRECCIONES}.`);
    }
    return ids.map((id) => {
        const despues = deseado[id] as Disponibilidad;
        if (!ESTADOS.includes(despues.state)) throw new Error(`${id}: estado desconocido '${String(despues.state)}'.`);
        if (despues.state === 'DELISTED') throw new Error(`${id}: esta orden deshace bajas, no las escribe.`);
        if (!FECHA.test(despues.since) || !FECHA.test(despues.last_checked)) {
            throw new Error(`${id}: las fechas van como AAAA-MM-DD.`);
        }
        const claves = Object.keys(despues).sort().join(',');
        if (claves !== 'last_checked,since,state') throw new Error(`${id}: campos de mas o de menos: ${claves}.`);

        const antes = enLaNube[id];
        if (antes === undefined) {
            return { id, antes: null, despues, accion: 'saltar', motivo: 'no existe en la nube' };
        }
        if (estadoDe(antes) !== 'DELISTED') {
            return { id, antes, despues, accion: 'saltar', motivo: 'en la nube no consta como baja' };
        }
        return { id, antes, despues, accion: 'escribir', motivo: 'baja que se deshace' };
    });
}
