import { describe, it, expect } from 'vitest';

import { VOCABULARIOS_ETIQUETADOS, type Etiqueta } from '../src/config/baseNueva/etiquetas.js';

/**
 * Las etiquetas existen para que la pantalla, el informe interno y el informe de cliente
 * digan la MISMA palabra. Esa promesa se rompe en silencio de dos maneras: añadiendo un
 * valor al vocabulario y olvidando nombrarlo —llegaría a pantalla como su código en
 * mayúsculas—, o nombrando algo que ya no existe. Las dos fallan aquí.
 */
describe('etiquetas en español de los vocabularios cerrados', () => {
    it('cada valor de cada vocabulario tiene etiqueta', () => {
        const sinNombre: string[] = [];
        for (const { nombre, valores, etiquetas } of VOCABULARIOS_ETIQUETADOS) {
            for (const valor of valores) {
                if (!etiquetas[valor]) sinNombre.push(`${nombre}.${valor}`);
            }
        }
        expect(sinNombre).toEqual([]);
    });

    it('ninguna etiqueta nombra un valor que ya no existe', () => {
        const sobrantes: string[] = [];
        for (const { nombre, valores, etiquetas } of VOCABULARIOS_ETIQUETADOS) {
            const vivos = new Set<string>(valores);
            for (const clave of Object.keys(etiquetas)) {
                if (!vivos.has(clave)) sobrantes.push(`${nombre}.${clave}`);
            }
        }
        expect(sobrantes).toEqual([]);
    });

    it('las etiquetas están escritas como se acordó', () => {
        const mal: string[] = [];
        const revisar = (ruta: string, etiqueta: Etiqueta): void => {
            const { corta, glosa } = etiqueta;
            if (corta.trim() !== corta || corta.length === 0) mal.push(`${ruta}: corta vacía o con espacios`);
            if (corta.endsWith('.')) mal.push(`${ruta}: corta termina en punto`);
            // Una etiqueta en mayúsculas sería el código sin traducir colándose como nombre.
            if (corta === corta.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{2,}/.test(corta) && corta !== 'ETF') {
                mal.push(`${ruta}: corta parece el código sin traducir`);
            }
            if (glosa !== undefined && !glosa.endsWith('.')) mal.push(`${ruta}: glosa sin punto final`);
        };
        for (const { nombre, etiquetas } of VOCABULARIOS_ETIQUETADOS) {
            for (const [clave, etiqueta] of Object.entries(etiquetas)) revisar(`${nombre}.${clave}`, etiqueta);
        }
        expect(mal).toEqual([]);
    });

    it('los tres silencios se llaman distinto, que es el motivo de que existan', () => {
        const ausencias = VOCABULARIOS_ETIQUETADOS.find((v) => v.nombre === 'AUSENCIAS')!;
        const nombres = Object.values(ausencias.etiquetas).map((e) => e.corta);
        expect(new Set(nombres).size).toBe(nombres.length);
        // Y cada uno explica POR QUÉ falta: sin la glosa, «No aplica» y «No facilitado»
        // se leen igual de mal en una ficha.
        expect(Object.values(ausencias.etiquetas).every((e) => Boolean(e.glosa))).toBe(true);
    });
});
