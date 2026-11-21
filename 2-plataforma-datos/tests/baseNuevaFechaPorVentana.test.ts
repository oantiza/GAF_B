import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mapearInstrumento, type FichaCanonica, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import { validarEscritura, validarForma } from '../src/config/baseNueva/validadores';
import { calcularCalidad, componerTarjeta, type InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';

/**
 * Decisión B-74 (Óscar, 09-11-2026): una fecha por cifra en `declared/provider_returns`.
 *
 * Morningstar da el 1 mes, el año en curso y el 1 año de `sal_trailingReturn`, a fin de mes, y el 3,
 * 5 y 10 años anualizados de `ETFsnapshot`/`MFsnapshot`, a fin de trimestre. Medido el 09-11-2026,
 * 437 de las 795 fichas con cifra traen las dos fechas (30-09 y 31-10), y en 747 las cifras de Morningstar están desplazadas al contraste. El canónico trae la de cada ventana en
 * `rentabilidad.fecha_dato_por_ventana`, por su clave canónica, junto a `fecha_dato`, que se conserva.
 */

const AHORA = '2026-11-09T12:00:00.000Z';
const ISIN = 'IE00BYR8H148';
const TIPO = 'instrument-declared-provider-returns.v2.schema.json';

function ficha(): FichaCanonica {
    return {
        isin: ISIN,
        name: 'Un Fondo',
        currency: 'EUR',
        report_date: '2026-10-31',
        generated_at: '2026-11-08T13:32:32+00:00',
        regulatory: { domicile: 'LUX' },
        ms: { report_date: '2026-10-31', portfolio: { as_of: '2026-09-30' }, costs: { ter: 0.5 }, fixed_income: {} },
        classification_v2: { asset_type: 'equity' },
        portfolio_exposure_v2: { asset_mix: { equity: 0.95, bond: 0, cash: 0.05, other: 0 }, exposure_confidence: 0.9 },
        provenance: { version: 'paquete', fields: { currency: 'morningstar_lt:sal_quote' } }
    };
}

const TRAILING = {
    '1m': { fondo: 0.8 },
    ytd: { fondo: 7.1, categoria: 6.2 },
    '1a': { fondo: 9.5, categoria: 8.1, indice: 9.9 },
    '3a_anualizada': { fondo: 6.2, categoria: 5.4 },
    '5a_anualizada': { fondo: 7.4 },
    '10a_anualizada': { fondo: 6.9 }
};

function universal(rentabilidad: Record<string, unknown>, cambios: Record<string, unknown> = {}): RegistroUniversal {
    return {
        _id: ISIN,
        identificacion: { tipo_producto: 'fondo', clase_activo: 'Equity', divisa_base: 'EUR', domicilio: 'LUX', nombre: 'Un Fondo' },
        riesgo: { fecha_dato: '2026-10-31' },
        rentabilidad,
        costes: { ter_pct: 0.5 },
        valoracion: { vl: 10, vl_fecha: '2026-11-06', vl_divisa: 'EUR' },
        ...cambios
    };
}

const retornos = (u: RegistroUniversal) => {
    const documento = mapearInstrumento(ficha(), u, AHORA).documentos.find((d) => d.ruta.endsWith('/declared/provider_returns'));
    expect(documento).toBeDefined();
    expect(validarEscritura(documento!.tipo, documento!.documento, 'platform').motivos).toEqual([]);
    return documento!.documento;
};

describe('B-74. Una fecha por cifra en provider_returns', () => {
    it('con las dos fechas de Morningstar, cada ventana lleva la suya y as_of es la mas reciente', () => {
        const documento = retornos(
            universal({
                fecha_dato: '2026-10-31',
                fecha_dato_por_ventana: {
                    '1m': '2026-10-31',
                    ytd: '2026-10-31',
                    '1a': '2026-10-31',
                    '3a_anualizada': '2026-09-30',
                    '5a_anualizada': '2026-09-30',
                    '10a_anualizada': '2026-09-30'
                },
                trailing_pct: TRAILING
            })
        );
        expect(documento['as_of']).toBe('2026-10-31');
        /* Todas las ventanas presentes, y solo ellas: el 1 mes no tiene sitio en el bloque. */
        expect(documento['as_of_by_window']).toEqual({
            '1y': '2026-10-31',
            '3y': '2026-09-30',
            '5y': '2026-09-30',
            '10y': '2026-09-30',
            ytd: '2026-10-31'
        });
        /* Las cifras no cambian de sitio: quien lee trailing_return.3y sigue encontrando solo sujetos. */
        expect(Object.keys((documento['trailing_return'] as Record<string, object>)['3y']!)).toEqual(['fund', 'category']);
    });

    it('sin el objeto nuevo, como hasta hoy: una sola fecha y ningun mapa', () => {
        const documento = retornos(universal({ fecha_dato: '2026-09-30', trailing_pct: TRAILING }));
        expect(documento['as_of']).toBe('2026-09-30');
        expect(documento).not.toHaveProperty('as_of_by_window');
    });

    it('con todas las fechas iguales no hay mapa, y as_of es la comun', () => {
        const todas = '2026-10-31';
        const documento = retornos(
            universal({
                fecha_dato: todas,
                fecha_dato_por_ventana: { ytd: todas, '1a': todas, '3a_anualizada': todas, '5a_anualizada': todas, '10a_anualizada': todas },
                trailing_pct: TRAILING
            })
        );
        expect(documento['as_of']).toBe(todas);
        expect(documento).not.toHaveProperty('as_of_by_window');
    });

    it('una ventana que el objeto no fecha lleva fecha_dato, como hasta hoy', () => {
        const documento = retornos(
            universal({
                fecha_dato: '2026-10-31',
                fecha_dato_por_ventana: { '3a_anualizada': '2026-09-30' },
                trailing_pct: { '1a': { fondo: 9.5 }, '3a_anualizada': { fondo: 6.2 } }
            })
        );
        expect(documento['as_of']).toBe('2026-10-31');
        expect(documento['as_of_by_window']).toEqual({ '1y': '2026-10-31', '3y': '2026-09-30' });
    });

    it('la cifra del fondo que la nuestra desplazo sigue con la fecha del proveedor, no con la del objeto', () => {
        /* Como Allianz en la decision 110: el 1 año del fondo es nuestro y el suyo vuelve del contraste con su fecha. */
        const documento = retornos(
            universal(
                {
                    fecha_dato: '2026-11-06',
                    fecha_dato_por_ventana: { '1a': '2026-11-06', '3a_anualizada': '2026-09-30' },
                    trailing_pct: { '1a': { fondo: 9.7, categoria: 8.1 }, '3a_anualizada': { fondo: 6.2 } }
                },
                {
                    meta: {
                        procedencia: { 'rentabilidad.trailing_pct.1a.fondo': 'vl_eodhd:eod', 'rentabilidad.fecha_dato': 'vl_eodhd:eod' },
                        contraste: {
                            'rentabilidad.fecha_dato': { valor: '2026-10-31' },
                            'rentabilidad.trailing_pct.1a.fondo': { valor: 9.5 }
                        }
                    }
                }
            )
        );
        expect((documento['trailing_return'] as Record<string, Record<string, number>>)['1y']!['fund']).toBeCloseTo(0.095, 10);
        expect(documento['as_of_by_window']).toEqual({ '1y': '2026-10-31', '3y': '2026-09-30' });
        expect(documento['as_of']).toBe('2026-10-31');
    });

    it('lo desplazado toma la fecha de su ventana del contraste, cuando el contraste la guarda', () => {
        const documento = retornos(
            universal(
                {
                    fecha_dato: '2026-11-06',
                    trailing_pct: { '1a': { fondo: 9.7, categoria: 8.1 }, '3a_anualizada': { fondo: 6.4 }, '5a_anualizada': { fondo: 7.4 } }
                },
                {
                    meta: {
                        procedencia: {
                            'rentabilidad.fecha_dato': 'vl_eodhd:eod',
                            'rentabilidad.trailing_pct.1a.fondo': 'vl_eodhd:eod',
                            'rentabilidad.trailing_pct.3a_anualizada.fondo': 'vl_eodhd:eod'
                        },
                        contraste: {
                            'rentabilidad.fecha_dato': { valor: '2026-09-30' },
                            'rentabilidad.trailing_pct.1a.fondo': { valor: 9.5 },
                            'rentabilidad.trailing_pct.3a_anualizada.fondo': { valor: 6.2 },
                            'rentabilidad.fecha_dato_por_ventana.1a': { valor: '2026-10-31' },
                            'rentabilidad.fecha_dato_por_ventana.3a_anualizada': { valor: '2026-09-30' }
                        }
                    }
                }
            )
        );
        /* El 5 años no está desplazado ni fechado: lleva la del bloque, que es la del proveedor (la desplazada). */
        expect(documento['as_of_by_window']).toEqual({ '1y': '2026-10-31', '3y': '2026-09-30', '5y': '2026-09-30' });
        expect(documento['as_of']).toBe('2026-10-31');
    });

    it('una ventana nuestra que no se publica (un hueco) deja la del proveedor con la fecha del contraste', () => {
        /* LU1683285321, D-9: nuestro bloque desplazó al del proveedor, y nuestras 1, 3 y 5 años no salen por un hueco. */
        const documento = retornos(
            universal(
                { fecha_dato: '2026-10-31', trailing_pct: { '1m': { fondo: 5.5 } } },
                {
                    meta: {
                        procedencia: { 'rentabilidad.fecha_dato': 'vl_eodhd:eod', 'rentabilidad.trailing_pct.1m.fondo': 'vl_eodhd:eod' },
                        contraste: {
                            'rentabilidad.fecha_dato': { valor: '2026-09-30' },
                            'rentabilidad.trailing_pct.1a.fondo': { valor: 5.9 },
                            'rentabilidad.trailing_pct.3a_anualizada.fondo': { valor: 5.7 },
                            'rentabilidad.fecha_dato_por_ventana.1a': { valor: '2026-10-31' },
                            'rentabilidad.fecha_dato_por_ventana.3a_anualizada': { valor: '2026-09-30' }
                        }
                    }
                }
            )
        );
        expect((documento['trailing_return'] as Record<string, Record<string, number>>)['1y']!['fund']).toBeCloseTo(0.059, 10);
        expect(documento['as_of_by_window']).toEqual({ '1y': '2026-10-31', '3y': '2026-09-30' });
        expect(documento['as_of']).toBe('2026-10-31');
    });

    it('LU1295551144, el canonico que genera el extractor: las ocho fechas llegan por contraste', () => {
        const ruta = resolve(__dirname, 'fixtures', 'b74_LU1295551144_contraste.json');
        const linea = JSON.parse(readFileSync(ruta, 'utf-8')) as RegistroUniversal;
        const documento = mapearInstrumento({ ...ficha(), isin: 'LU1295551144' }, linea, AHORA).documentos.find((d) =>
            d.ruta.endsWith('/declared/provider_returns')
        )!;
        expect(validarEscritura(documento.tipo, documento.documento, 'platform').motivos).toEqual([]);
        const d = documento.documento as Record<string, any>;
        /* El 1 año y el año en curso, de `sal_trailingReturn` a fin de mes; el 3, 5 y 10, de `ETFsnapshot` a fin de trimestre. */
        expect(d['as_of_by_window']).toEqual({
            '1y': '2026-10-31',
            '3y': '2026-09-30',
            '5y': '2026-09-30',
            '10y': '2026-09-30',
            ytd: '2026-10-31'
        });
        expect(d['as_of']).toBe('2026-10-31');
        /* Y las cifras del fondo son las de Morningstar que nuestra serie desplazó, no las nuestras. */
        expect(d['trailing_return']['1y']['fund']).toBeCloseTo(0.0632612, 10);
        expect(d['trailing_return']['3y']['fund']).toBeCloseTo(0.14768098, 10);
        expect(d['ytd_return']['fund']).toBeCloseTo(0.0805782, 10);
    });

    it('el contrato rechaza una ventana que no existe y una fecha sin forma de fecha', () => {
        const base = { source: 'x', as_of: '2026-10-31', return_basis: 'TOTAL_RETURN', trailing_return: { '1y': { fund: 0.1 } } };
        expect(validarForma(TIPO, { ...base, as_of_by_window: { '1y': '2026-10-31', '3y': '2026-09-30' } }).ok).toBe(true);
        expect(validarForma(TIPO, { ...base, as_of_by_window: { '1m': '2026-10-31', '3y': '2026-09-30' } }).ok).toBe(false);
        expect(validarForma(TIPO, { ...base, as_of_by_window: { '1y': '31-10-2026', '3y': '2026-09-30' } }).ok).toBe(false);
        /* Un mapa de una sola ventana no dice nada que as_of no diga. */
        expect(validarForma(TIPO, { ...base, as_of_by_window: { '1y': '2026-10-31' } }).ok).toBe(false);
    });
});

/* ------------------------------------------------------------------ la tarjeta */

describe('B-74 en la tarjeta: cada rentabilidad del proveedor con su fecha', () => {
    const TARJETA = 'instrument-read-card.v2.schema.json';
    const POR_VENTANA = { '1y': '2026-10-31', '3y': '2026-09-30', '5y': '2026-09-30' };

    const material = (retornos: Record<string, unknown>, nuestras: Record<string, unknown>, desde?: string): InstrumentoLeido => ({
        instrument_id: ISIN,
        raiz: { instrument_id: ISIN, instrument_type: 'FUND', schema_version: 'base-nueva.instrument.v2', updated_at: AHORA, identity: { name: 'Un Fondo', currency: 'EUR' }, classification: { asset_class: 'EQUITY' } },
        bloques: {
            'declared/provider_returns': {
                source: 'x',
                as_of: '2026-10-31',
                return_basis: 'TOTAL_RETURN',
                trailing_return: { '1y': { fund: 0.095 }, '3y': { fund: 0.062 }, '5y': { fund: 0.074 } },
                ...retornos
            },
            'declared/provider_risk': { source: 'x', as_of: '2026-10-31', return_basis: 'TOTAL_RETURN', volatility: { '1y': { fund: 0.12 } } }
        },
        calculadas: {
            computed_at: AHORA,
            as_of: '2026-10-31',
            method: 'EXTRACTOR_MONTHLY_V2',
            frequency: 'MONTHLY',
            return_basis: 'TOTAL_RETURN',
            inputs: { series_id: 'EODHD:x', currency: 'EUR', last_date: '2026-10-31' },
            volatility: { '1y': 0.121 },
            ...nuestras
        },
        serieValidaDesde: desde
    });
    const proveedor = (instrumento: InstrumentoLeido): Record<string, unknown> => {
        const tarjeta = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA)!;
        expect(validarForma(TARJETA, tarjeta).motivos).toEqual([]);
        return (tarjeta['metrics'] as Record<string, Record<string, unknown>>)['provider']!;
    };

    it('con fechas distintas en lo que ensena, returns_as_of es la mas reciente y lleva la de cada ventana', () => {
        const suyo = proveedor(material({ as_of_by_window: POR_VENTANA }, {}));
        expect(suyo['annualized_return']).toEqual({ '1y': 0.095, '3y': 0.062, '5y': 0.074 });
        expect(suyo['returns_as_of']).toBe('2026-10-31');
        expect(suyo['returns_as_of_by_window']).toEqual(POR_VENTANA);
    });

    it('si lo que ensena comparte fecha, una sola, y solo cuando no es la del riesgo, como hasta hoy', () => {
        /* El 1 año es nuestro: el bloque del proveedor ensena el 3 y el 5, los dos a 30-09. */
        const suyo = proveedor(material({ as_of_by_window: POR_VENTANA }, { annualized_return: { '1y': 0.097 } }));
        expect(suyo['annualized_return']).toEqual({ '3y': 0.062, '5y': 0.074 });
        expect(suyo['returns_as_of']).toBe('2026-09-30');
        expect(suyo).not.toHaveProperty('returns_as_of_by_window');
    });

    it('sin el objeto, como hasta hoy: la fecha del bloque para todas', () => {
        const suyo = proveedor(material({ as_of: '2026-09-30' }, {}));
        expect(suyo['returns_as_of']).toBe('2026-09-30');
        expect(suyo).not.toHaveProperty('returns_as_of_by_window');
        const igualAlRiesgo = proveedor(material({}, {}));
        expect(igualAlRiesgo).not.toHaveProperty('returns_as_of');
    });

    it('la historia sin revisar se mira con la fecha de cada ventana, no con la mas reciente', () => {
        /* Desde el 15-10-2023: el 3 años a 31-10-2026 empieza el 31-10-2023 y no la toca; a 30-09-2026 empieza el 30-09-2023 y si. */
        const desde = '2023-10-15';
        const conMapa = proveedor(material({ as_of_by_window: POR_VENTANA }, {}, desde));
        expect(conMapa['annualized_return']).toEqual({ '1y': 0.095 });
        /* Sin mapa, el bloque entero es a 31-10 y el 3 años se quedaba, fechado un mes de mas. */
        const sinMapa = proveedor(material({}, {}, desde));
        expect(sinMapa['annualized_return']).toEqual({ '1y': 0.095, '3y': 0.062 });
    });

    describe('un fondo sin metricas propias: el titular es del proveedor', () => {
        const sinPropias = (retornos: Record<string, unknown>): Record<string, unknown> => {
            const instrumento = { ...material({ ytd_return: { fund: 0.071 }, ...retornos }, {}), calculadas: undefined };
            const tarjeta = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA)!;
            expect(validarForma(TARJETA, tarjeta).motivos).toEqual([]);
            const metricas = tarjeta['metrics'] as Record<string, unknown>;
            expect(metricas['source']).toBe('PROVIDER');
            return metricas;
        };

        it('con dos fechas, cada ventana del titular lleva la suya; as_of sigue siendo la del riesgo', () => {
            const metricas = sinPropias({ as_of_by_window: { ...POR_VENTANA, ytd: '2026-10-31' } });
            expect(metricas['annualized_return']).toEqual({ '1y': 0.095, '3y': 0.062, '5y': 0.074 });
            expect(metricas['as_of']).toBe('2026-10-31');
            expect(metricas['returns_as_of']).toBe('2026-10-31');
            expect(metricas['returns_as_of_by_window']).toEqual({ ...POR_VENTANA, ytd: '2026-10-31' });
        });

        it('sin el mapa, rentabilidad del 30-09 y riesgo del 31-10: returns_as_of dice la de la rentabilidad', () => {
            /* Hasta la B-74 la tarjeta la enseñaba bajo el as_of del riesgo. Era el defecto (Dirección, 09-11-2026). */
            const metricas = sinPropias({ as_of: '2026-09-30' });
            expect(metricas['as_of']).toBe('2026-10-31');
            expect(metricas['returns_as_of']).toBe('2026-09-30');
            expect(metricas).not.toHaveProperty('returns_as_of_by_window');
        });

        it('sin el mapa y con la misma fecha que el riesgo, nada que añadir', () => {
            const metricas = sinPropias({});
            expect(metricas).not.toHaveProperty('returns_as_of');
            expect(metricas).not.toHaveProperty('returns_as_of_by_window');
        });

        it('con el titular nuestro no aparece nunca', () => {
            const instrumento = material({ as_of_by_window: POR_VENTANA }, { annualized_return: { '1y': 0.097 } });
            const tarjeta = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA)!;
            expect(tarjeta['metrics']).not.toHaveProperty('returns_as_of');
            expect(tarjeta['metrics']).not.toHaveProperty('returns_as_of_by_window');
        });
    });
});
