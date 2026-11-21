import { describe, it, expect } from 'vitest';

import { BASE_POR_VARIANTE, DIVISAS_DE_INDICE, leerIndice } from '../src/ingestion/baseNueva/indice';
import { aptitudesDe } from '../src/config/baseNueva/aptitudes';

/**
 * Leer la divisa y la variante del nombre de un índice.
 *
 * La prueba que importa de verdad es la última de la primera tanda: que esto **no** se
 * convierta en una licencia para deducir cosas de los nombres. Un sufijo oficial de índice se
 * lee; una propiedad que el nombre no codifica, no.
 */

describe('leer el nombre de un indice', () => {
    it('lee la divisa y la variante de los sufijos oficiales', () => {
        expect(leerIndice('MSCI Europe NR EUR')).toEqual({
            name: 'MSCI Europe NR EUR',
            currency: 'EUR',
            variant: 'NR',
            return_basis: 'TOTAL_RETURN',
            resolution: 'DERIVED_FROM_NAME'
        });
        expect(leerIndice('MSCI ACWI NR USD').currency).toBe('USD');
        expect(leerIndice('S&P 500 TR USD').variant).toBe('TR');
    });

    it('toma el ULTIMO token que encaja, porque van de sufijo', () => {
        // Un indice cubierto lleva el 'Hdg' despues de la divisa, y no estorba.
        const cubierto = leerIndice('MSCI World NR EUR Hdg');
        expect(cubierto.currency).toBe('EUR');
        expect(cubierto.variant).toBe('NR');
    });

    it('la variante decide la base: PR es solo precio, el resto reinvierte', () => {
        expect(BASE_POR_VARIANTE.PR).toBe('PRICE_RETURN');
        expect(BASE_POR_VARIANTE.NR).toBe('TOTAL_RETURN');
        expect(BASE_POR_VARIANTE.GR).toBe('TOTAL_RETURN');
        expect(BASE_POR_VARIANTE.TR).toBe('TOTAL_RETURN');
        expect(leerIndice('FTSE 100 PR GBP').return_basis).toBe('PRICE_RETURN');
    });

    it('lo que no nombra su divisa o su variante se queda SIN ella, no con una por defecto', () => {
        const soloNombre = leerIndice('Bloomberg Barclays Euro Agg 1-3Y');
        expect(soloNombre.currency).toBeUndefined();
        expect(soloNombre.variant).toBeUndefined();
        expect(soloNombre.return_basis).toBeUndefined();
        expect(soloNombre.resolution).toBeUndefined();
    });

    it('un tipo de interes no es un indice, y el analisis lo deja fuera por el camino honesto', () => {
        // Medido: 63 de los 651 'indices' del canonico son tipos —ESTR, Euribor, Letras del
        // Tesoro—. Contra un tipo del mercado monetario no se calcula un alpha de la misma
        // manera, y quedarse sin divisa ni variante los deja fuera sin tener que detectarlos.
        for (const tipo of ['Euro short-term rate', 'ESTR', 'Euribor a 3 meses', 'Letras del Tesoro a 6 meses']) {
            const leido = leerIndice(tipo);
            expect(leido.variant, tipo).toBeUndefined();
        }
    });

    it('la lista de divisas es CORTA a proposito: con la ISO completa, "All" seria el lek albanes', () => {
        expect(DIVISAS_DE_INDICE).not.toContain('ALL');
        expect(leerIndice('MSCI All Country World Index').currency).toBeUndefined();
        expect(DIVISAS_DE_INDICE).toContain('EUR');
        expect(DIVISAS_DE_INDICE).toContain('USD');
    });

    it('NO es una licencia para deducir del nombre: lo leido se marca como derivado', () => {
        // La diferencia con la politica de distribucion de un fondo es real: 'MSCI Europe NR
        // EUR' ES el nombre del indice y NR y EUR son sufijos oficiales que lo distinguen de
        // 'MSCI Europe GR USD', que es otro indice. Un 'Acc' en el nombre de un fondo es una
        // pista sobre algo que el nombre no codifica, y 540 de 844 clases no dicen nada.
        // Por eso esto sale con resolution y aquello no sale.
        expect(leerIndice('MSCI Europe NR EUR').resolution).toBe('DERIVED_FROM_NAME');
    });
});

describe('la base de rentabilidad protege el alpha', () => {
    const raizCon = (indice: Record<string, unknown>) => ({
        instrument_type: 'FUND',
        classification: { category: 'X', asset_class: 'EQUITY', official_benchmark: indice }
    });
    const bloques = {
        'declared/provider_risk': { return_basis: 'TOTAL_RETURN', provider_alpha: { '3y': { vs_benchmark: 0.01 } }, r2: { '3y': { vs_benchmark: 0.9 } } },
        'declared/provider_returns': { return_basis: 'TOTAL_RETURN', trailing_return: { '3y': { fund: 0.02 } } }
    };

    it('con la misma base, apto', () => {
        const veredicto = aptitudesDe({
            raiz: raizCon({ name: 'MSCI Europe NR EUR', currency: 'EUR', variant: 'NR', return_basis: 'TOTAL_RETURN' }),
            bloques
        });
        expect(veredicto.MOSTRAR_ALPHA.apt).toBe(true);
    });

    it('con base distinta NO es apto, y lo dice: un indice de solo precio contra un fondo de retorno total', () => {
        // Medido: 4 instrumentos caen aqui. El alpha que saldria seria el dividendo del
        // mercado, no el acierto del gestor.
        const veredicto = aptitudesDe({
            raiz: raizCon({ name: 'FTSE 100 PR GBP', currency: 'GBP', variant: 'PR', return_basis: 'PRICE_RETURN' }),
            bloques
        });
        expect(veredicto.MOSTRAR_ALPHA.apt).toBe(false);
        expect(veredicto.MOSTRAR_ALPHA.missing?.join(' ')).toContain('base distinta');
    });

    it('sin alpha del proveedor tampoco es apto, aunque el indice este completo', () => {
        const veredicto = aptitudesDe({
            raiz: raizCon({ name: 'MSCI Europe NR EUR', currency: 'EUR', variant: 'NR', return_basis: 'TOTAL_RETURN' }),
            bloques: { 'declared/provider_risk': { return_basis: 'TOTAL_RETURN' } }
        });
        expect(veredicto.MOSTRAR_ALPHA.apt).toBe(false);
        expect(veredicto.MOSTRAR_ALPHA.missing).toContain('declared/provider_risk.provider_alpha');
    });
});
