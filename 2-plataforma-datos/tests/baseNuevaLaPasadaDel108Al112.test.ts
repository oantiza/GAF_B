import { describe, it, expect } from 'vitest';

import { calcularCalidad, componerTarjeta, ventanaTocaLoSinRevisar, type InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';
import { mapearInstrumento, type FichaCanonica, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import { validarEscritura, validarForma } from '../src/config/baseNueva/validadores';

/**
 * Las decisiones 108 a 112 de Óscar (05-11-2026), con resultados escritos a mano. Lo medido sobre el catálogo está en cada decisión:
 * aquí están las reglas, con los casos que las motivaron.
 */

const AHORA = '2026-11-05T18:00:00.000Z';
const ISIN = 'IE00BYR8H148';

function ficha(exposicion: Record<string, unknown> = {}): FichaCanonica {
    return {
        isin: ISIN,
        name: 'Un Fondo',
        currency: 'EUR',
        report_date: '2026-09-30',
        generated_at: '2026-10-31T13:32:32+00:00',
        regulatory: { domicile: 'LUX' },
        ms: { report_date: '2026-09-30', portfolio: { as_of: '2026-09-30' }, costs: { ter: 0.5 }, fixed_income: {} },
        classification_v2: { asset_type: 'equity' },
        portfolio_exposure_v2: { asset_mix: { equity: 0.95, bond: 0, cash: 0.05, other: 0 }, exposure_confidence: 0.9, ...exposicion },
        provenance: { version: 'paquete', fields: { currency: 'morningstar_lt:sal_quote' } }
    };
}

function universal(cambios: Record<string, unknown> = {}): RegistroUniversal {
    return {
        _id: ISIN,
        identificacion: { tipo_producto: 'fondo', clase_activo: 'Equity', divisa_base: 'EUR', domicilio: 'LUX', nombre: 'Un Fondo' },
        riesgo: { fecha_dato: '2026-09-30' },
        rentabilidad: { fecha_dato: '2026-09-30' },
        costes: { ter_pct: 0.5 },
        valoracion: { vl: 10, vl_fecha: '2026-11-03', vl_divisa: 'USD' },
        ...cambios
    };
}

const doc = (resultado: ReturnType<typeof mapearInstrumento>, sufijo: string) =>
    resultado.documentos.find((documento) => documento.ruta.endsWith(sufijo));

/* -------------------------------------------------------------------------- 108 */

const ETF = { identificacion: { tipo_producto: 'etf', clase_activo: 'Equity', divisa_base: 'USD', domicilio: 'IRL', nombre: 'Un ETF' } };

describe('108. Lo que se negocia', () => {
    it('un ETF lo lleva en su bloque del precio, y pasa el contrato', () => {
        const negociacion = { plaza: 'AS', divisa: 'USD', fecha_corte: '2026-11-04', sesiones: 255, sesiones_sin_volumen: 4, mediana_negociada: 56145.05, sesiones_de_la_mediana: 251 };
        const bloque = doc(mapearInstrumento(ficha(), universal({ ...ETF, negociacion }), AHORA), '/declared/quote')!;
        expect(bloque.documento['trading']).toEqual({ exchange: 'AS', currency: 'USD', as_of: '2026-11-04', sessions: 255, sessions_without_volume: 4, median_traded_value: 56145.05, median_sessions: 251 });
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
    });

    it('sin volumen del proveedor no lleva cuenta ni mediana, y no es un cero', () => {
        const negociacion = { plaza: 'MC', divisa: 'EUR', fecha_corte: '2026-11-03', sesiones: 261, volumen: 'NO_LO_DA_EL_PROVEEDOR' };
        /* El precio en la divisa de su plaza: en USD frente a una negociacion en EUR ya no se escribe (09-11-2026). */
        const valoracion = { vl: 10, vl_fecha: '2026-11-03', vl_divisa: 'EUR' };
        const bloque = doc(mapearInstrumento(ficha(), universal({ ...ETF, negociacion, valoracion }), AHORA), '/declared/quote')!;
        expect(bloque.documento['trading']).toEqual({ exchange: 'MC', currency: 'EUR', as_of: '2026-11-03', sessions: 261 });
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
    });

    it('un fondo no lo lleva aunque le llegue: se suscribe al valor liquidativo', () => {
        const negociacion = { plaza: 'XETRA', divisa: 'EUR', fecha_corte: '2026-11-03', sesiones: 253, sesiones_sin_volumen: 0, mediana_negociada: 1 };
        const bloque = doc(mapearInstrumento(ficha(), universal({ negociacion }), AHORA), '/declared/quote')!;
        expect(bloque.documento).not.toHaveProperty('trading');
    });

    it('media línea no se escribe', () => {
        const bloque = doc(mapearInstrumento(ficha(), universal({ ...ETF, negociacion: { plaza: 'AS', sesiones: 255 } }), AHORA), '/declared/quote')!;
        expect(bloque.documento).not.toHaveProperty('trading');
    });

    it('no mueve la cobertura: tenerlo no dice nada del instrumento', () => {
        const material = (trading?: Record<string, unknown>): InstrumentoLeido => ({
            instrument_id: ISIN,
            raiz: { instrument_type: 'ETF' },
            bloques: { 'declared/quote': { source: 'x', as_of: '2026-11-03', price: 1, price_class: 'MARKET_PRICE', ...(trading ? { trading } : {}) } }
        });
        const sin = calcularCalidad(material(), AHORA);
        const con = calcularCalidad(material({ exchange: 'AS', as_of: '2026-11-04', sessions: 255, sessions_without_volume: 4, median_traded_value: 1 }), AHORA);
        expect([con.aplicables, con.presentes]).toEqual([sin.aplicables, sin.presentes]);
    });
});

/* -------------------------------------------------------------------------- 109 */

/*
 * El proveedor da bolsa 101,6 y liquidez −1,6. Hasta el 21-11-2026 la clase se salía más de un punto y el fondo se quedaba
 * sin reparto; desde la C-29 suma 1 y lo tiene. La regla de la 109 sigue para lo que no suma 1, y por eso aquí la liquidez
 * no viene: el reparto suma 1,016.
 */
const JPMORGAN_INDIA_NETO = { equity: 1.016, bond: 0, cash: -0.016, other: 0 };
const JPMORGAN_INDIA = {
    asset_mix: { equity: 1.016, bond: 0, cash: 0, other: 0 },
    equity_regions: { asia_emerging: 1 },
    sectors: { technology: 0.3, financial_services: 0.7 },
    equity_styles: { value: 0.5, blend: 0.3, growth: 0.2 },
    market_caps: { large: 0.7, mid: 0.2, small: 0.1 },
    bond_types: { government: 1 }
};

describe('109. Regiones y sectores, aunque el reparto no pase', () => {
    it('se conservan, sin las clases que no cuadran, y el documento pasa el contrato', () => {
        const resultado = mapearInstrumento(ficha(JPMORGAN_INDIA), universal(), AHORA);
        const bloque = doc(resultado, '/declared/exposure')!;
        expect(bloque.documento['asset_mix']).toBeUndefined();
        expect(bloque.documento['asset_mix_completion']).toBeUndefined();
        expect(bloque.documento['equity_regions']).toEqual({ asia_emerging: 1 });
        expect(bloque.documento['sectors']).toEqual({ technology: 0.3, financial_services: 0.7 });
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
        /* El hueco del reparto sigue diciéndose, y el aviso: el documento no es un reparto. */
        expect(resultado.ausencias.map((a) => a.ruta)).toContain('declared/exposure.asset_mix');
    });

    it('lo de la renta fija no: la decisión conserva lo de la variable', () => {
        const bloque = doc(mapearInstrumento(ficha(JPMORGAN_INDIA), universal(), AHORA), '/declared/exposure')!;
        expect(bloque.documento).not.toHaveProperty('bond_types');
    });

    it('sin nada de la renta variable no hay documento: un mapa a ceros no dice nada', () => {
        /* Suma 1,45: sin reparto. Con la liquidez a −0,45 sumaría 1 y, desde la C-29, sería un reparto neto que se escribe. */
        const sinNada = { asset_mix: { equity: 0, bond: 1.39, cash: 0, other: 0.06 }, equity_regions: { eurozone: 0 }, sectors: {}, bond_types: { government: 1 } };
        expect(doc(mapearInstrumento(ficha(sinNada), universal(), AHORA), '/declared/exposure')).toBeUndefined();
    });

    it('C-29: con la liquidez a −1,6 el reparto de JPMorgan India suma 1 y se escribe con su signo, con sus regiones y sectores', () => {
        const bloque = doc(mapearInstrumento(ficha({ ...JPMORGAN_INDIA, asset_mix: JPMORGAN_INDIA_NETO }), universal(), AHORA), '/declared/exposure')!;
        expect(bloque.documento['asset_mix']).toEqual({ equity: 1.016, fixed_income: 0, cash: -0.016, other: 0 });
        expect(bloque.documento['asset_mix_completion']).toBe('REPORTED');
        expect(bloque.documento['equity_regions']).toEqual({ asia_emerging: 1 });
        expect(validarEscritura(bloque.tipo, bloque.documento, 'platform').ok).toBe(true);
    });

    it('una suma de regiones que no cuadra no se empeora: con una zona que no es un peso, no se conserva un trozo', () => {
        /* BLK Systematic: Estados Unidos 448 %, zona euro 144 %, Europa ex-euro 387 %, y el resto suma 36 %. */
        const blk = { ...JPMORGAN_INDIA, equity_regions: { united_states: 4.48, eurozone: 1.44, europe_ex_euro: 3.87, japan: 0.36 } };
        const bloque = doc(mapearInstrumento(ficha(blk), universal(), AHORA), '/declared/exposure')!;
        expect(bloque.documento).not.toHaveProperty('equity_regions');
        expect(bloque.documento['sectors']).toEqual({ technology: 0.3, financial_services: 0.7 });
        /* Todo pesos y suma 107 %, como BlackRock Emerging Markets: se conserva tal cual, y quien reparte normaliza. */
        const em = { ...JPMORGAN_INDIA, equity_regions: { asia_emerging: 0.774, asia_developed: 0.3 } };
        expect(doc(mapearInstrumento(ficha(em), universal(), AHORA), '/declared/exposure')!.documento['equity_regions']).toEqual({ asia_emerging: 0.774, asia_developed: 0.3 });
        /* Con reparto que cuadra sigue su regla de siempre: se salta lo que no es peso. */
        const conReparto = { asset_mix: { equity: 0.95, bond: 0, cash: 0.05, other: 0 }, equity_regions: { eurozone: 5.16, japan: 0.2 } };
        expect(doc(mapearInstrumento(ficha(conReparto), universal(), AHORA), '/declared/exposure')!.documento['equity_regions']).toEqual({ japan: 0.2 });
    });

    it('las nueve celdas se quedan si el proveedor le da renta variable, y no si la da negativa', () => {
        const celdas = { large_value: 0.5, large_blend: 0.5, large_growth: 0, mid_value: 0, mid_blend: 0, mid_growth: 0, small_value: 0, small_blend: 0, small_growth: 0 };
        const con = doc(mapearInstrumento(ficha({ ...JPMORGAN_INDIA, equity_style_box: celdas }), universal(), AHORA), '/declared/exposure')!;
        expect(con.documento['equity_style_box']).toEqual(celdas);
        const corto = { ...JPMORGAN_INDIA, asset_mix: { equity: -0.134, bond: 0.421, cash: 0.61, other: 0.102 }, equity_style_box: celdas };
        expect(doc(mapearInstrumento(ficha(corto), universal(), AHORA), '/declared/exposure')!.documento).not.toHaveProperty('equity_style_box');
    });

    it('con el reparto que cuadra no cambia nada', () => {
        /* Con algo de renta fija: sin ella, desde el 21-11-2026 los tipos de bono no se escriben (reglasDeDatos21-11). */
        const normal = { asset_mix: { equity: 0.9, bond: 0.05, cash: 0.05, other: 0 }, sectors: { tecnologia: 0.3 }, bond_types: { government: 1 } };
        const bloque = doc(mapearInstrumento(ficha(normal), universal(), AHORA), '/declared/exposure')!;
        expect(bloque.documento['asset_mix_completion']).toBe('REPORTED');
        expect(bloque.documento['bond_types']).toEqual({ government: 1 });
    });

    it('la tarjeta lo lleva sin reparto, y el aviso de que no lo hay sigue', () => {
        const material: InstrumentoLeido = {
            instrument_id: ISIN,
            raiz: { instrument_id: ISIN, instrument_type: 'FUND', schema_version: 'base-nueva.instrument.v2', updated_at: AHORA, identity: { name: 'Un Fondo', currency: 'EUR' }, classification: { asset_class: 'EQUITY' } },
            bloques: { 'declared/exposure': { source: 'x', as_of: '2026-09-30', equity_regions: { asia_emerging: 1 }, confidence: 0.9 } }
        };
        const calidad = calcularCalidad(material, AHORA);
        const tarjeta = componerTarjeta(material, calidad, AHORA)!;
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok).toBe(true);
        expect(tarjeta['exposure']).toEqual({ equity_regions: { asia_emerging: 1 }, confidence: 0.9, derivation: 'DECLARED' });
        expect((calidad.documento['warnings'] as { code: string }[]).map((a) => a.code)).toContain('SIN_REPARTO_DE_ACTIVOS');
        expect((calidad.documento['fitness'] as Record<string, { apt: boolean }>)['RADIOGRAFIA_DE_CARTERA']!.apt).toBe(false);
    });

    it('un documento con clases sigue sin ese aviso', () => {
        const material: InstrumentoLeido = {
            instrument_id: ISIN,
            raiz: { instrument_type: 'FUND' },
            bloques: { 'declared/exposure': { source: 'x', as_of: '2026-09-30', asset_mix: { equity: 1, fixed_income: 0, cash: 0, other: 0 }, confidence: 0.9 } }
        };
        expect(((calcularCalidad(material, AHORA).documento['warnings'] ?? []) as { code: string }[]).map((a) => a.code)).not.toContain('SIN_REPARTO_DE_ACTIVOS');
    });
});

/* -------------------------------------------------------------------------- 110 */

/** Allianz AT2: nuestra serie solo llega a 1 año, y el proveedor daba 2,98, 2,18 y 0,95 %. */
const ALLIANZ = {
    identificacion: { tipo_producto: 'fondo', clase_activo: 'Equity', divisa_base: 'EUR', domicilio: 'LUX', nombre: 'Un Fondo', politica_distribucion: 'acumulacion' },
    riesgo: {
        fecha_dato: '2026-10-31',
        volatilidad_pct: { '1a': { fondo: 0.1972, categoria: 0.545 }, '3a': { categoria: 0.553 } },
        sharpe: { '1a': { fondo: -0.3768 } },
        historial_precios: { source_listing_id: 'EODHD:LU1383852487.EUFUND', divisa_metricas: 'EUR', politica: 'kid_acumulacion' }
    },
    rentabilidad: {
        fecha_dato: '2026-10-31',
        trailing_pct: { '1a': { fondo: 2.0, categoria: 2.1 }, '3a_anualizada': { categoria: 2.8 } }
    },
    meta: {
        procedencia: {
            'rentabilidad.fecha_dato': 'vl_eodhd:eod',
            'rentabilidad.trailing_pct.1a.fondo': 'vl_eodhd:eod',
            'riesgo.volatilidad_pct.1a.fondo': 'vl_eodhd:eod',
            'riesgo.sharpe.1a.fondo': 'vl_eodhd:eod',
            'riesgo.fecha_dato': 'vl_eodhd:eod'
        },
        contraste: {
            'rentabilidad.fecha_dato': { valor: '2026-09-30' },
            'riesgo.fecha_dato': { valor: '2026-10-31' },
            'rentabilidad.trailing_pct.1a.fondo': { valor: 2.0 },
            'rentabilidad.trailing_pct.3a_anualizada.fondo': { valor: 2.978901 },
            'rentabilidad.trailing_pct.5a_anualizada.fondo': { valor: 2.179793 },
            'rentabilidad.trailing_pct.10a_anualizada.fondo': { valor: 0.954905 },
            'riesgo.volatilidad_pct.1a.fondo': { valor: 0.197 },
            'riesgo.volatilidad_pct.3a.fondo': { valor: 0.296 },
            'riesgo.sharpe.1a.fondo': { valor: -0.226 },
            'riesgo.sharpe.10a.fondo': { valor: 0.317 }
        }
    }
};

describe('110. Sin cifra nuestra, la del proveedor', () => {
    const resultado = mapearInstrumento(ficha(), universal(ALLIANZ), AHORA);

    it('recupera las ventanas que nuestra serie no alcanza, en su bloque y como suyas', () => {
        const retornos = doc(resultado, '/declared/provider_returns')!.documento['trailing_return'] as Record<string, Record<string, number>>;
        expect(retornos['3y']!['fund']).toBeCloseTo(0.02978901, 10);
        expect(retornos['3y']!['category']).toBeCloseTo(0.028, 10);
        expect(retornos['5y']!['fund']).toBeCloseTo(0.02179793, 10);
        expect(retornos['10y']!['fund']).toBeCloseTo(0.00954905, 10);
        expect(doc(resultado, '/declared/provider_returns')!.documento['as_of']).toBe('2026-09-30');
    });

    it('y lo mismo en el riesgo, con el Sharpe a 10 años donde el nuestro no se puede calcular', () => {
        const riesgo = doc(resultado, '/declared/provider_risk')!.documento as Record<string, Record<string, Record<string, number>>>;
        expect(riesgo['volatility']!['3y']!['fund']).toBeCloseTo(0.00296, 10);
        expect(riesgo['sharpe']!['10y']).toEqual({ fund: 0.317 });
    });

    it('la cifra de la ventana donde sí hay nuestra sigue siendo del proveedor en su bloque, y lo nuestro no se mezcla', () => {
        const retornos = doc(resultado, '/declared/provider_returns')!.documento['trailing_return'] as Record<string, Record<string, number>>;
        expect(retornos['1y']!['fund']).toBeCloseTo(0.02, 10);
        const metricas = doc(resultado, '/computed/metrics')!.documento as Record<string, Record<string, number>>;
        expect(metricas['annualized_return']).toEqual({ '1y': 0.02 });
    });

    const material = (): InstrumentoLeido => ({
        instrument_id: ISIN,
        raiz: { instrument_id: ISIN, instrument_type: 'FUND', schema_version: 'base-nueva.instrument.v2', updated_at: AHORA, identity: { name: 'Un Fondo', currency: 'EUR' }, classification: { asset_class: 'EQUITY' } },
        bloques: {
            'declared/provider_returns': { source: 'x', as_of: '2026-09-30', return_basis: 'TOTAL_RETURN', trailing_return: { '1y': { fund: 0.0199 }, '3y': { fund: 0.0298 }, '10y': { fund: 0.0095 } } },
            'declared/provider_risk': { source: 'x', as_of: '2026-10-31', return_basis: 'TOTAL_RETURN', volatility: { '1y': { fund: 0.002 }, '3y': { fund: 0.003 } }, sharpe: { '1y': { fund: -0.2 }, '10y': { fund: 0.317 } } }
        },
        calculadas: { computed_at: AHORA, as_of: '2026-10-31', method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', return_basis: 'TOTAL_RETURN', inputs: { series_id: 'EODHD:x', currency: 'EUR' }, annualized_return: { '1y': 0.02 }, volatility: { '1y': 0.00197 }, sharpe: { '1y': -0.3768 } }
    });

    it('la tarjeta la lleva aparte, ventana a ventana, sin la que ya es nuestra y con su propia fecha', () => {
        const instrumento = material();
        const tarjeta = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA)!;
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok).toBe(true);
        const metricas = tarjeta['metrics'] as Record<string, unknown>;
        expect(metricas['annualized_return']).toEqual({ '1y': 0.02 });
        expect(metricas['source']).toBe('COMPUTED');
        expect(metricas['provider']).toEqual({
            source: 'PROVIDER',
            method: 'TRAILING_PROVIDER',
            as_of: '2026-10-31',
            returns_as_of: '2026-09-30',
            annualized_return: { '3y': 0.0298, '10y': 0.0095 },
            volatility: { '3y': 0.003 },
            sharpe: { '10y': 0.317 }
        });
    });

    it('sin cifras nuestras, el titular sigue siendo suyo y no hay bloque aparte', () => {
        const instrumento = { ...material(), calculadas: undefined };
        const metricas = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA)!['metrics'] as Record<string, unknown>;
        expect(metricas['source']).toBe('PROVIDER');
        expect(metricas['annualized_return']).toEqual({ '1y': 0.0199, '3y': 0.0298, '10y': 0.0095 });
        expect(metricas).not.toHaveProperty('provider');
    });
});

/* -------------------------------------------------------------------------- 111 */

describe('111. Una ventana con hueco', () => {
    const AB = {
        riesgo: {
            fecha_dato: '2026-10-31',
            volatilidad_pct: { '1a': { fondo: 10 } },
            historial_precios: {
                source_listing_id: 'EODHD:LU0232524495.EUFUND',
                divisa_metricas: 'EUR',
                huecos: [{ desde: '2018-07-18', hasta: '2022-09-07', dias: 1512, ventanas: ['5a', '10a'] }]
            }
        },
        rentabilidad: { fecha_dato: '2026-10-31', trailing_pct: { '1a': { fondo: 2.0 } } },
        identificacion: { tipo_producto: 'fondo', clase_activo: 'Equity', divisa_base: 'EUR', domicilio: 'LUX', nombre: 'Un Fondo', politica_distribucion: 'acumulacion' },
        meta: { procedencia: { 'rentabilidad.fecha_dato': 'vl_eodhd:eod', 'rentabilidad.trailing_pct.1a.fondo': 'vl_eodhd:eod', 'riesgo.volatilidad_pct.1a.fondo': 'vl_eodhd:eod' } }
    };

    it('el documento dice el hueco y las ventanas que cuesta, y pasa el contrato', () => {
        const bloque = doc(mapearInstrumento(ficha(), universal(AB), AHORA), '/computed/metrics')!;
        expect((bloque.documento['inputs'] as Record<string, unknown>)['series_gaps']).toEqual([
            { from: '2018-07-18', to: '2022-09-07', days: 1512, windows: ['5y', '10y'] }
        ]);
        expect(validarEscritura(bloque.tipo, bloque.documento, 'batch').ok).toBe(true);
    });

    it('sin huecos, nada', () => {
        const sinHueco = { ...AB, riesgo: { ...AB.riesgo, historial_precios: { source_listing_id: 'EODHD:x', divisa_metricas: 'EUR' } } };
        const bloque = doc(mapearInstrumento(ficha(), universal(sinHueco), AHORA), '/computed/metrics')!;
        expect(bloque.documento['inputs']).not.toHaveProperty('series_gaps');
    });
});

/* -------------------------------------------------------------------------- 112 */

describe('112. La fecha desde la que vale la serie', () => {
    it('la regla, con sus bordes: el 31-10-2026 a 10 años empieza el 31-10-2016', () => {
        expect(ventanaTocaLoSinRevisar('10y', '2026-10-31', '2018-10-26')).toBe(true);
        expect(ventanaTocaLoSinRevisar('5y', '2026-10-31', '2018-10-26')).toBe(false);
        expect(ventanaTocaLoSinRevisar('10y', '2026-10-31', '2016-10-31')).toBe(false);
        expect(ventanaTocaLoSinRevisar('10y', '2026-10-31', '2016-11-01')).toBe(true);
        /* Un 29 de febrero cae en el 28, y en el año en curso el periodo empieza a 31 de diciembre. */
        expect(ventanaTocaLoSinRevisar('1y', '2024-02-29', '2023-02-28')).toBe(false);
        expect(ventanaTocaLoSinRevisar('ytd', '2026-10-31', '2026-02-01')).toBe(true);
        expect(ventanaTocaLoSinRevisar('ytd', '2026-10-31', '2025-12-31')).toBe(false);
        /* Sin cierre no se sabe dónde empieza ningún periodo. */
        expect(ventanaTocaLoSinRevisar('1y', undefined, '2018-10-26')).toBe(true);
    });

    /** M&G Asian: la nuestra a 10 años da 9,64 %, y su serie solo vale desde el 26-10-2018. */
    const asian = (): InstrumentoLeido => ({
        instrument_id: ISIN,
        raiz: { instrument_id: ISIN, instrument_type: 'FUND', schema_version: 'base-nueva.instrument.v2', updated_at: AHORA, identity: { name: 'M&G Asian', currency: 'EUR' }, classification: { asset_class: 'EQUITY' } },
        bloques: {
            'declared/provider_returns': { source: 'x', as_of: '2026-09-30', return_basis: 'TOTAL_RETURN', trailing_return: { '5y': { fund: 0.06 }, '10y': { fund: 0.1023 } } },
            'declared/provider_risk': { source: 'x', as_of: '2026-10-31', return_basis: 'TOTAL_RETURN', sharpe: { '10y': { fund: 0.5 } } }
        },
        calculadas: { computed_at: AHORA, as_of: '2026-10-31', method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', return_basis: 'TOTAL_RETURN', inputs: { series_id: 'EODHD:x', currency: 'EUR' }, annualized_return: { '5y': 0.05, '10y': 0.0964 }, volatility: { '5y': 0.15, '10y': 0.162 }, max_drawdown: { '5y': -0.3, '10y': -0.35 }, sharpe: { '5y': 0.2 }, ytd_return: 0.11 },
        serieValidaDesde: '2018-10-26'
    });

    it('la tarjeta lleva la fecha y no lleva lo que la toca, sea de quien sea', () => {
        const instrumento = asian();
        const tarjeta = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA)!;
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok).toBe(true);
        const metricas = tarjeta['metrics'] as Record<string, unknown>;
        expect(metricas['series_valid_from']).toBe('2018-10-26');
        expect(metricas['windows_before_series_valid_from']).toEqual(['10y']);
        expect(metricas['annualized_return']).toEqual({ '5y': 0.05 });
        expect(metricas['volatility']).toEqual({ '5y': 0.15 });
        expect(metricas['max_drawdown']).toEqual({ '5y': -0.3 });
        expect(metricas['ytd_return']).toBe(0.11);
        /* La del proveedor a 10 años tampoco: al mismo cierre es la misma cifra, sobre la misma historia. Ver el contrato. */
        expect(metricas).not.toHaveProperty('provider');
    });

    it('computed/metrics no se toca: es la fuente, y lo que se quita es lo que se enseña', () => {
        const instrumento = asian();
        componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA);
        expect((instrumento.calculadas!['annualized_return'] as Record<string, number>)['10y']).toBe(0.0964);
    });

    it('una ventana a la que nada llega no se cuenta como quitada', () => {
        const instrumento = asian();
        instrumento.serieValidaDesde = '2022-06-01';
        const metricas = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA)!['metrics'] as Record<string, unknown>;
        expect(metricas['windows_before_series_valid_from']).toEqual(['5y', '10y']);
        /* A 3 y a 1 año ni hay cifra ni la toca. */
        expect(metricas).not.toHaveProperty('annualized_return');
    });

    it('sin esa fecha no cambia nada', () => {
        const instrumento = { ...asian(), serieValidaDesde: undefined };
        const metricas = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA)!['metrics'] as Record<string, unknown>;
        expect(metricas).not.toHaveProperty('series_valid_from');
        expect(metricas).not.toHaveProperty('windows_before_series_valid_from');
        expect(metricas['annualized_return']).toEqual({ '5y': 0.05, '10y': 0.0964 });
    });

    it('la marca de control no habla de lo que ya no se enseña', () => {
        const instrumento = asian();
        (instrumento.bloques['declared/provider_risk'] as Record<string, unknown>)['volatility'] = { '10y': { fund: 0.3 } };
        const metricas = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA)!['metrics'] as Record<string, unknown>;
        expect(metricas).not.toHaveProperty('control');
    });
});
