import { describe, it, expect } from 'vitest';

import { mapearInstrumento, type FichaCanonica, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import {
    apartarFueraDeRango,
    cifrasFueraDeRango,
    esquemaDe,
    rangoDe,
    rutasApartables,
    validarEscritura,
    validarForma
} from '../src/config/baseNueva/validadores';
import { rutasDe } from '../src/config/baseNueva/esquemas';
import { calcularCalidad, componerTarjeta, type InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';

/**
 * Decisión B-73 (Óscar, 09-11-2026): una cifra fuera de rango bloquea solo su ventana, y la
 * rentabilidad de una acción tiene un tope más ancho que la de un fondo.
 *
 * El caso que la motivó es Moderna (US60770K1079): +980,95 % a un año, real y contrastado. Con el
 * tope de 5 para todos, su documento de métricas no se escribía entero y la acción se quedaba sin
 * volatilidad, Sharpe ni caída máxima.
 */

const TIPO = 'instrument-computed-metrics.v2.schema.json';
const AHORA = '2026-11-09T12:00:00.000Z';

/** Las cifras de Moderna, en fracción, sin el `inputs`, que es lo que dice qué tipo de instrumento es. */
const CIFRAS_DE_MODERNA = {
    computed_at: '2026-11-06',
    as_of: '2026-11-06',
    return_basis: 'TOTAL_RETURN',
    volatility: { '1y': 1.936697, '3y': 1.234451, '5y': 1.040084 },
    annualized_return: { '1y': 9.8095, '3y': 0.5025, '5y': 0.015 },
    ytd_return: 7.62,
    max_drawdown: { '1y': -0.34881, '3y': -0.87365, '5y': -0.940577 }
};

const comoAccion = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...CIFRAS_DE_MODERNA,
    method: 'EXTRACTOR_DAILY_V2',
    frequency: 'DAILY',
    inputs: { series_id: 'EODHD:MRNA.US', currency: 'EUR', series_adjustment: 'SPLIT_AND_DIVIDEND_ADJUSTED' },
    ...cambios
});

const comoFondo = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...CIFRAS_DE_MODERNA,
    method: 'EXTRACTOR_MONTHLY_V2',
    frequency: 'MONTHLY',
    inputs: { series_id: 'vl:LU0000000000', currency: 'EUR', distribution_policy_resolution: 'OFFICIAL_REGISTER' },
    ...cambios
});

const comoEtf = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...comoFondo(),
    inputs: {
        series_id: 'EODHD:XXXX.XETRA',
        currency: 'EUR',
        series_class: 'MARKET_PRICE',
        series_adjustment: 'SPLIT_AND_DIVIDEND_ADJUSTED'
    },
    ...cambios
});

describe('B-73. El rango de la rentabilidad depende del tipo, y lo dice el contrato', () => {
    it('el documento de Moderna como ACCION se escribe entero, sin apartar nada', () => {
        const documento = comoAccion();
        expect(validarEscritura(TIPO, documento, 'batch').motivos).toEqual([]);
        const { documento: apartado, apartadas } = apartarFueraDeRango(TIPO, documento);
        expect(apartadas).toEqual([]);
        expect(apartado).toEqual(documento);
        expect(apartado).not.toHaveProperty('out_of_range');
    });

    it('el mismo documento como FONDO se escribe sin el 1 año ni el año en curso, y las dos quedan anotadas', () => {
        const documento = comoFondo();
        /* Entero, no pasa: es la barrera de antes. */
        expect(validarForma(TIPO, documento).ok).toBe(false);
        const { documento: apartado, apartadas } = apartarFueraDeRango(TIPO, documento);
        expect(apartadas.map((cifra) => cifra.tramos.join('.')).sort()).toEqual(['annualized_return.1y', 'ytd_return']);
        expect(apartado['annualized_return']).toEqual({ '3y': 0.5025, '5y': 0.015 });
        expect(apartado).not.toHaveProperty('ytd_return');
        expect(apartado['out_of_range']).toEqual({
            annualized_return: { '1y': { value: 9.8095, limit: 5 } },
            ytd_return: { value: 7.62, limit: 5 }
        });
        /* Lo que estaba bien sigue ahí, sin tocar. */
        expect(apartado['volatility']).toEqual(CIFRAS_DE_MODERNA.volatility);
        expect(apartado['max_drawdown']).toEqual(CIFRAS_DE_MODERNA.max_drawdown);
        expect(validarEscritura(TIPO, apartado, 'batch').motivos).toEqual([]);
        /* Y no se ha tocado el documento de entrada. */
        expect(documento['annualized_return']).toEqual(CIFRAS_DE_MODERNA.annualized_return);
    });

    it('un ETF tiene el rango de un fondo, aunque se mida sobre un precio ajustado como una accion', () => {
        const { documento: apartado, apartadas } = apartarFueraDeRango(TIPO, comoEtf());
        expect(apartadas.map((cifra) => `${cifra.tramos.join('.')} ${cifra.limite}`).sort()).toEqual([
            'annualized_return.1y 5',
            'ytd_return 5'
        ]);
        expect(validarEscritura(TIPO, apartado, 'batch').motivos).toEqual([]);
    });

    it('una accion por encima de 20 veces o por debajo de -100 % se aparta con el limite de la accion', () => {
        const documento = comoAccion({ annualized_return: { '1y': 24.1, '3y': -1.2, '5y': 0.015 }, ytd_return: -1.5 });
        const { documento: apartado } = apartarFueraDeRango(TIPO, documento);
        expect(apartado['out_of_range']).toEqual({
            annualized_return: { '1y': { value: 24.1, limit: 20 }, '3y': { value: -1.2, limit: -1 } },
            ytd_return: { value: -1.5, limit: -1 }
        });
        expect(apartado['annualized_return']).toEqual({ '5y': 0.015 });
        expect(validarEscritura(TIPO, apartado, 'batch').motivos).toEqual([]);
    });

    it('un fondo por encima de 20 anota el limite del fondo, que es el mas estrecho, no el de la envolvente', () => {
        const { apartadas } = apartarFueraDeRango(TIPO, comoFondo({ annualized_return: { '1y': 25 } }));
        expect(apartadas.find((cifra) => cifra.tramos.join('.') === 'annualized_return.1y')?.limite).toBe(5);
    });

    it('la volatilidad, la caida, los ratios y lo relativo no cambian de rango: [-5, 5] y [-20, 20]', () => {
        const documento = comoAccion({
            volatility: { '1y': 5.2 },
            sharpe: { '1y': 21 },
            relative: {
                benchmark: { name: 'S&P 500', currency: 'EUR', variant: 'NR', return_basis: 'TOTAL_RETURN' },
                beta: { '3y': 0.16 },
                r2: { '3y': 6 }
            }
        });
        const { documento: apartado } = apartarFueraDeRango(TIPO, documento);
        expect(apartado['out_of_range']).toEqual({
            volatility: { '1y': { value: 5.2, limit: 5 } },
            sharpe: { '1y': { value: 21, limit: 20 } },
            relative: { r2: { '3y': { value: 6, limit: 5 } } }
        });
        expect(apartado).not.toHaveProperty('volatility');
        expect(apartado).not.toHaveProperty('sharpe');
        expect(apartado['relative']).toEqual({
            benchmark: { name: 'S&P 500', currency: 'EUR', variant: 'NR', return_basis: 'TOTAL_RETURN' },
            beta: { '3y': 0.16 }
        });
        expect(validarEscritura(TIPO, apartado, 'batch').motivos).toEqual([]);
    });

    it('un valor fuera de rango que no es una cifra no se aparta: el documento sigue sin escribirse', () => {
        const documento = comoAccion({
            inputs: { series_id: 'EODHD:MRNA.US', currency: 'EUR', series_adjustment: 'SPLIT_AND_DIVIDEND_ADJUSTED', observations: 200000 }
        });
        const { documento: apartado, apartadas } = apartarFueraDeRango(TIPO, documento);
        expect(apartadas).toEqual([]);
        expect(validarForma(TIPO, apartado).ok).toBe(false);
    });

    it('lo apartado se anade a lo que ya hubiera anotado, sin pisarlo', () => {
        const documento = comoFondo({ out_of_range: { sortino: { '1y': { value: 23.4, limit: 20 } } } });
        const { documento: apartado } = apartarFueraDeRango(TIPO, documento);
        expect(Object.keys(apartado['out_of_range'] as object).sort()).toEqual(['annualized_return', 'sortino', 'ytd_return']);
    });
});

describe('B-73. Los limites son los del contrato y no una copia', () => {
    const esquema = esquemaDe(TIPO)!;
    const defs = esquema.json['$defs'] as Record<string, Record<string, unknown>>;

    it('el contrato dice [-1, 20] para la accion y [-5, 5] para el fondo, y [-5, 20] es solo la envolvente', () => {
        /* Si alguien mueve un numero, esta prueba falla y obliga a decirlo: es la decision B-73. */
        expect([defs['cifra_rentabilidad_accion']!['minimum'], defs['cifra_rentabilidad_accion']!['maximum']]).toEqual([-1, 20]);
        expect([defs['cifra_fraction']!['minimum'], defs['cifra_fraction']!['maximum']]).toEqual([-5, 5]);
        expect(rangoDe(TIPO, 'annualized_return.1y')).toEqual({ minimum: -5, maximum: 20 });
        expect(rangoDe(TIPO, 'ytd_return')).toEqual({ minimum: -5, maximum: 20 });
        expect([defs['cifra_ratio']!['minimum'], defs['cifra_ratio']!['maximum']]).toEqual([-20, 20]);
    });

    it('el limite anotado sale del validador del contrato, con el mismo numero que el $defs', () => {
        const [fondo] = cifrasFueraDeRango(TIPO, comoFondo({ ytd_return: 6, annualized_return: { '3y': 0.1 } }));
        expect(fondo?.limite).toBe(defs['cifra_fraction']!['maximum']);
        const [accion] = cifrasFueraDeRango(TIPO, comoAccion({ ytd_return: 21, annualized_return: { '3y': 0.1 } }));
        expect(accion?.limite).toBe(defs['cifra_rentabilidad_accion']!['maximum']);
    });

    it('toda cifra del documento tiene sitio en out_of_range, y out_of_range no anota nada que no sea una cifra', () => {
        const cifras = rutasDe(esquema)
            .filter((ruta) => ruta.esHoja && (ruta.unidad === 'fraction' || ruta.unidad === 'ratio'))
            .map((ruta) => ruta.ruta)
            .filter((ruta) => !ruta.startsWith('out_of_range.'))
            .sort();
        expect(cifras.length).toBeGreaterThan(40);
        expect([...rutasApartables(TIPO)].sort()).toEqual(cifras);
    });

    it('la unidad de lo anotado es la de su cifra', () => {
        const unidad = (ruta: string) => rutasDe(esquema).find((r) => r.ruta === ruta)?.unidad;
        for (const ruta of rutasApartables(TIPO)) {
            expect(unidad(`out_of_range.${ruta}.value`), ruta).toBe(unidad(ruta));
            expect(unidad(`out_of_range.${ruta}.limit`), ruta).toBe(unidad(ruta));
        }
    });
});

/* ------------------------------------------------------------------ el mapper, de punta a punta */

const MODERNA = 'US60770K1079';

/** El canónico de Moderna del 06-11-2026, con la forma de `export/fondos.ndjson` y sus cifras. */
function universalDeModerna(): RegistroUniversal {
    return {
        _id: MODERNA,
        identificacion: {
            nombre: 'Moderna Inc',
            tipo: 'accion',
            tipo_producto: 'accion',
            isin: MODERNA,
            ticker: 'MRNA',
            mercado: 'US',
            pais: 'USA',
            divisa_base: 'USD',
            fecha_dato: '2026-11-06'
        },
        valoracion: { vl: 50, vl_fecha: '2026-11-06', vl_divisa: 'USD' },
        rentabilidad: {
            fecha_dato: '2026-11-06',
            trailing_pct: { '1a': { fondo: 980.9548 }, '3a_anualizada': { fondo: 50.2529 }, '5a_anualizada': { fondo: 1.5038 } }
        },
        riesgo: {
            fecha_dato: '2026-11-06',
            volatilidad_pct: { '1a': { fondo: 193.6697 }, '3a': { fondo: 123.4451 }, '5a': { fondo: 104.0084 } },
            sharpe: { '1a': { fondo: 5.0544 }, '3a': { fondo: 0.385 }, '5a': { fondo: -0.0061 } },
            rf_pct: { '1a': { fondo: 2.0696 } },
            max_drawdown_pct: { '1a': { fondo: -34.881 }, '3a': { fondo: -87.365 }, '5a': { fondo: -94.0577 } },
            max_drawdown: { pct: -94.0577, periodo: '5a' },
            historial_precios: {
                divisa: 'USD',
                divisa_metricas: 'EUR',
                divisa_origen: 'USD',
                fx_source: 'ECB_REFERENCE',
                rf_referencia: 'ESTR_EUR',
                source_history: 'eodhd',
                source_listing_id: 'EODHD:MRNA.US',
                first_date: '2018-12-07',
                last_date: '2026-11-06',
                observations_count: 1990,
                history_quality_status: 'COMPLETE'
            }
        },
        meta: { isin: MODERNA, actualizado: '2026-11-06T18:00:00+00:00' }
    };
}

function fichaDeModerna(): FichaCanonica {
    return {
        isin: MODERNA,
        name: 'Moderna Inc',
        currency: 'USD',
        report_date: '2026-11-06',
        generated_at: '2026-11-06T18:00:00+00:00',
        classification_v2: { asset_type: 'stock', asset_subtype: 'common_stock' },
        provenance: { version: 1, fields: {} }
    };
}

describe('B-73. Moderna, del canonico a la puerta de escritura', () => {
    const resultado = mapearInstrumento(fichaDeModerna(), universalDeModerna(), AHORA);
    const metricas = resultado.documentos.find((documento) => documento.ruta === `instruments/${MODERNA}/computed/metrics`);

    it('tiene computed/metrics, con su rentabilidad a un ano entera, y pasa la puerta', () => {
        expect(metricas).toBeDefined();
        const documento = metricas!.documento as Record<string, Record<string, number>>;
        expect(documento['annualized_return']!['1y']).toBeCloseTo(9.809548, 8);
        expect(documento['annualized_return']!['3y']).toBeCloseTo(0.502529, 8);
        expect(documento['volatility']!['5y']).toBeCloseTo(1.040084, 8);
        expect(documento).not.toHaveProperty('out_of_range');
        expect(validarEscritura(metricas!.tipo, metricas!.documento, 'batch').motivos).toEqual([]);
    });

    it('la raiz no sella una ausencia de metricas que ya no existe', () => {
        const raiz = resultado.documentos.find((documento) => documento.ruta === `instruments/${MODERNA}`);
        expect(raiz?.documento).not.toHaveProperty('metrics_absence');
    });

    it('con un desdoblamiento sin ajustar (mas de 20 veces) se aparta la ventana y se escribe lo demas', () => {
        const universal = universalDeModerna() as Record<string, any>;
        universal['rentabilidad']['trailing_pct']['1a'] = { fondo: 2450 };
        const conSplit = mapearInstrumento(fichaDeModerna(), universal as RegistroUniversal, AHORA);
        const documento = conSplit.documentos.find((d) => d.ruta.endsWith('/computed/metrics'))!;
        expect((documento.documento['annualized_return'] as Record<string, number>)['1y']).toBeUndefined();
        expect(documento.documento['out_of_range']).toEqual({ annualized_return: { '1y': { value: 24.5, limit: 20 } } });
        expect(conSplit.avisos).toContain('annualized_return.1y fuera del rango del contrato: 24.5');
        expect(validarEscritura(documento.tipo, documento.documento, 'batch').motivos).toEqual([]);
    });
});

/* ------------------------------------------------------------------ la tarjeta */

const TARJETA = 'instrument-read-card.v2.schema.json';

/** Lo que el lote lee de la base para componer la tarjeta, a partir de lo que el mapper produce. */
function leido(resultado: ReturnType<typeof mapearInstrumento>): InstrumentoLeido {
    const prefijo = `instruments/${resultado.instrument_id}`;
    const material: InstrumentoLeido = { instrument_id: resultado.instrument_id, raiz: {}, bloques: {} };
    for (const documento of resultado.documentos) {
        const sufijo = documento.ruta.slice(prefijo.length).replace(/^\//, '');
        if (sufijo === '') material.raiz = documento.documento;
        else if (sufijo === 'computed/metrics') material.calculadas = documento.documento;
        else material.bloques[sufijo] = documento.documento;
    }
    return material;
}

function tarjetaDe(resultado: ReturnType<typeof mapearInstrumento>): Record<string, any> {
    const material = leido(resultado);
    const tarjeta = componerTarjeta(material, calcularCalidad(material, AHORA), AHORA)!;
    expect(validarForma(TARJETA, tarjeta).motivos).toEqual([]);
    return tarjeta;
}

/** Un fondo cuya rentabilidad a un año es nuestra y se sale del rango de un fondo. */
function universalDeFondo(): RegistroUniversal {
    return {
        _id: 'LU0000000001',
        identificacion: {
            tipo_producto: 'fondo',
            clase_activo: 'Equity',
            divisa_base: 'EUR',
            domicilio: 'LUX',
            nombre: 'Un Fondo Con Un Ano Imposible',
            categoria_morningstar: 'EAA Fund Global Large-Cap Blend Equity',
            politica_distribucion: 'acumulacion'
        },
        riesgo: {
            fecha_dato: '2026-10-31',
            volatilidad_pct: { '1a': { fondo: 14.2 }, '3a': { fondo: 12.34 } },
            historial_precios: {
                source_listing_id: 'EODHD:LU0000000001.EUFUND',
                divisa_metricas: 'EUR',
                rf_referencia: 'ESTR_EUR',
                observations_count: 36,
                first_date: '2023-10-31',
                last_date: '2026-10-31'
            }
        },
        rentabilidad: {
            fecha_dato: '2026-10-31',
            trailing_pct: { '1a': { fondo: 980.9548 }, '3a_anualizada': { fondo: 6.1 } }
        },
        costes: { ter_pct: 0.53 },
        valoracion: { vl: 10, vl_fecha: '2026-10-31', vl_divisa: 'EUR' },
        meta: {
            procedencia: {
                'riesgo.volatilidad_pct.1a.fondo': 'vl_eodhd:estr',
                'riesgo.volatilidad_pct.3a.fondo': 'vl_eodhd:estr',
                'rentabilidad.trailing_pct.1a.fondo': 'vl_eodhd:eod',
                'rentabilidad.trailing_pct.3a_anualizada.fondo': 'vl_eodhd:eod',
                'rentabilidad.fecha_dato': 'vl_eodhd:eod',
                'riesgo.fecha_dato': 'vl_eodhd:eod'
            }
        }
    };
}

function fichaDeFondo(): FichaCanonica {
    return {
        isin: 'LU0000000001',
        name: 'Un Fondo Con Un Ano Imposible',
        currency: 'EUR',
        report_date: '2026-10-31',
        generated_at: '2026-11-08T13:32:32+00:00',
        regulatory: { domicile: 'LUX', legal_framework: 'UCITS' },
        ms: { category_morningstar: 'EAA Fund Global Large-Cap Blend Equity', report_date: '2026-10-31', costs: { ter: 0.53 }, fixed_income: {} },
        classification_v2: { asset_type: 'equity' },
        portfolio_exposure_v2: { asset_mix: { equity: 0.95, bond: 0, cash: 0.05, other: 0 }, exposure_confidence: 0.9 },
        provenance: { version: 'paquete', fields: { currency: 'morningstar_lt:sal_quote' } }
    };
}

describe('B-73 en la tarjeta: el mismo rango por tipo, con el tipo de la propia tarjeta', () => {
    it('la tarjeta de Moderna se escribe desde su canonico, con su rentabilidad a un ano', () => {
        const tarjeta = tarjetaDe(mapearInstrumento(fichaDeModerna(), universalDeModerna(), AHORA));
        expect(tarjeta['instrument_type']).toBe('STOCK');
        expect(tarjeta['metrics']['annualized_return']['1y']).toBeCloseTo(9.809548, 8);
        expect(tarjeta['metrics']).not.toHaveProperty('windows_out_of_range');
    });

    it('la de un fondo con el 1 ano fuera de rango sale sin esa cifra, y dice por que falta', () => {
        const resultado = mapearInstrumento(fichaDeFondo(), universalDeFondo(), AHORA);
        expect(resultado.errores).toEqual([]);
        const metricas = resultado.documentos.find((d) => d.ruta.endsWith('/computed/metrics'))!;
        expect(metricas.documento['out_of_range']).toEqual({ annualized_return: { '1y': { value: 9.809548, limit: 5 } } });
        const tarjeta = tarjetaDe(resultado);
        expect(tarjeta['metrics']['source']).toBe('COMPUTED');
        expect(tarjeta['metrics']['annualized_return']).toEqual({ '3y': 0.061 });
        expect(tarjeta['metrics']['volatility']['1y']).toBeCloseTo(0.142, 10);
        expect(tarjeta['metrics']['windows_out_of_range']).toEqual(['annualized_return.1y']);
    });

    it('el contrato de la tarjeta usa instrument_type: 9,8 vale en una accion y no en un fondo', () => {
        const material = leido(mapearInstrumento(fichaDeModerna(), universalDeModerna(), AHORA));
        const deAccion = componerTarjeta(material, calcularCalidad(material, AHORA), AHORA)!;
        expect(validarForma(TARJETA, deAccion).ok).toBe(true);
        expect(validarForma(TARJETA, { ...deAccion, instrument_type: 'FUND' }).ok).toBe(false);
        const conAnoEnCurso = { ...deAccion, metrics: { ...(deAccion['metrics'] as object), ytd_return: 7.62 } };
        expect(validarForma(TARJETA, conAnoEnCurso).ok).toBe(true);
        expect(validarForma(TARJETA, { ...conAnoEnCurso, metrics: { ...conAnoEnCurso.metrics, ytd_return: 21 } }).ok).toBe(false);
    });

    it('la tarjeta y computed/metrics dicen los mismos limites', () => {
        const defsTarjeta = esquemaDe(TARJETA)!.json['$defs'] as Record<string, Record<string, unknown>>;
        const defsMetricas = esquemaDe(TIPO)!.json['$defs'] as Record<string, Record<string, unknown>>;
        for (const nombre of ['cifra_rentabilidad', 'cifra_rentabilidad_accion', 'cifra_fraction', 'cifra_ratio']) {
            expect([defsTarjeta[nombre]!['minimum'], defsTarjeta[nombre]!['maximum']], nombre).toEqual([
                defsMetricas[nombre]!['minimum'],
                defsMetricas[nombre]!['maximum']
            ]);
        }
    });

    it('toda ruta que computed/metrics sabe apartar cabe en la lista de la tarjeta', () => {
        const rutas = rutasDe(esquemaDe(TARJETA)!);
        const patron = new RegExp(String(rutas.find((r) => r.ruta === 'metrics.windows_out_of_range[]')!.nodo['pattern']));
        expect([...rutasApartables(TIPO)].filter((ruta) => !patron.test(ruta))).toEqual([]);
        expect(rutas.find((r) => r.ruta === 'metrics.windows_out_of_range')!.nodo['maxItems']).toBe(rutasApartables(TIPO).size);
    });
});
