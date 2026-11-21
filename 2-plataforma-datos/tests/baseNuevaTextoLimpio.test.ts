import { describe, it, expect } from 'vitest';

import { textoLimpio } from '../src/ingestion/baseNueva/mapper';

/**
 * Decisión 93: Actividad y Objetivo llegan del proveedor con cosas que no se leen. Cada caso es uno de los que
 * había en la base el 05-11-2026, y el resultado está escrito a mano.
 */
describe('textoLimpio', () => {
    it('los caracteres de control de Windows-1252 vuelven a ser la letra que eran', () => {
        expect(textoLimpio('Passenger Cars, \u008akoda, SEAT/CUPRA')).toBe('Passenger Cars, Škoda, SEAT/CUPRA');
        expect(textoLimpio('Regulated Activities \u0096 Hydrogen Infrastructure')).toBe('Regulated Activities – Hydrogen Infrastructure');
    });

    it('los espacios duros y los de anchura cero dejan de estorbar', () => {
        expect(textoLimpio('semi-efficient in pricing fundamentals')).toBe('semi-efficient in pricing fundamentals');
        expect(textoLimpio('values ​​and high market')).toBe('values and high market');
    });

    it('un espacio doble pasa a ser uno, y los saltos de línea se quedan', () => {
        expect(textoLimpio('uno  dos   tres')).toBe('uno dos tres');
        expect(textoLimpio('primer párrafo\n\nsegundo')).toBe('primer párrafo\n\nsegundo');
    });

    it('lo que ya perdió la letra no se adivina', () => {
        expect(textoLimpio('Amadeus GDS, Alt?a Passenger Service System')).toBe('Amadeus GDS, Alt?a Passenger Service System');
    });

    it('un texto limpio no cambia, ni los acentos ni la puntuación', () => {
        const limpio = 'Adolfo Domínguez, S.A. engages in the design; L’Oréal – «cosmética» (€).';
        expect(textoLimpio(limpio)).toBe(limpio);
    });

    it('lo que no es texto, o se queda en nada, no se escribe', () => {
        expect(textoLimpio(undefined)).toBeUndefined();
        expect(textoLimpio(12)).toBeUndefined();
        expect(textoLimpio('   ')).toBeUndefined();
        expect(textoLimpio('​')).toBeUndefined();
    });
});
