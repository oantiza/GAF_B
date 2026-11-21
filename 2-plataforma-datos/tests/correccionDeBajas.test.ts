import { describe, expect, it } from 'vitest';

import {
    MAXIMO_DE_CORRECCIONES,
    planDeCorreccion,
    type Disponibilidad
} from '../src/ingestion/baseNueva/correccionDeBajas';

const SIN_MEDIR: Disponibilidad = { state: 'UNDETERMINED', since: '2026-11-05', last_checked: '2026-11-05' };
const BAJA = { state: 'DELISTED', since: '2026-11-04', last_checked: '2026-11-04' };

describe('deshacer una baja falsa en la nube', () => {
    it('escribe solo lo que en la nube consta como baja', () => {
        const plan = planDeCorreccion(
            { A: SIN_MEDIR, B: SIN_MEDIR, C: SIN_MEDIR },
            { A: BAJA, B: { state: 'TRADING', since: '2026-01-01', last_checked: '2026-11-02' } }
        );
        expect(plan.map((p) => [p.id, p.accion])).toEqual([
            ['A', 'escribir'],
            ['B', 'saltar'],
            ['C', 'saltar']
        ]);
        expect(plan[2]?.motivo).toBe('no existe en la nube');
    });

    it('nunca escribe una baja', () => {
        expect(() =>
            planDeCorreccion({ A: { ...SIN_MEDIR, state: 'DELISTED' } }, { A: BAJA })
        ).toThrow('deshace bajas');
    });

    it('una orden mal escrita no se ejecuta, ni a medias', () => {
        expect(() => planDeCorreccion({}, {})).toThrow('ningun instrumento');
        expect(() =>
            planDeCorreccion({ A: SIN_MEDIR, B: { ...SIN_MEDIR, since: '5 nov' } }, { A: BAJA, B: BAJA })
        ).toThrow('AAAA-MM-DD');
        expect(() =>
            planDeCorreccion({ A: { ...SIN_MEDIR, state: 'OTRO' as Disponibilidad['state'] } }, { A: BAJA })
        ).toThrow('estado desconocido');
        expect(() =>
            planDeCorreccion({ A: { ...SIN_MEDIR, extra: 1 } as unknown as Disponibilidad }, { A: BAJA })
        ).toThrow('campos de mas');
    });

    it('no admite una orden grande: ya no seria corregir unas bajas', () => {
        const muchos: Record<string, Disponibilidad> = {};
        for (let i = 0; i <= MAXIMO_DE_CORRECCIONES; i += 1) muchos[`I${i}`] = SIN_MEDIR;
        expect(() => planDeCorreccion(muchos, {})).toThrow('el maximo');
    });
});
