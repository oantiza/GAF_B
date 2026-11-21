import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    mapearInstrumento,
    BLOQUES_QUE_NO_APLICAN_A_UNA_ACCION,
    type RegistroUniversal
} from '../src/ingestion/baseNueva/mapper';
import { componerTarjeta, calcularCalidad, type InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';
import { aplicaAlInstrumento } from '../src/ingestion/baseNueva/aplicabilidad';
import { validarForma } from '../src/config/baseNueva/validadores';
import { cargarEsquemas, rutasDe } from '../src/config/baseNueva/esquemas';
import { AUSENCIAS, PREDICADOS_DE_APLICABILIDAD } from '../src/config/baseNueva/vocabulario';
import { AJUSTE_DE_SERIE, CLASE_ACTIVO, PAIS_DEL_MERCADO } from '../src/ingestion/baseNueva/traducciones';

/**
 * La acción como instrumento: lo que el contrato de una acción tiene que impedir.
 *
 * Cada prueba de aquí nombra lo que dejaría pasar si no existiera, y todas salen de algo
 * medido el 01-11-2026 sobre las 73 acciones del universo del extractor. La que más importa es
 * la primera: el mapper de fondos habría archivado NUESTRAS métricas en un bloque llamado
 * `declared/provider_risk`, porque el filtro que separa las nuestras de las del proveedor es
 * `meta.procedencia` y las acciones no la traen —0 de 73—. Eso es el segundo de los cinco
 * defectos que motivan esta base, reproducido el primer día que entra un tipo nuevo.
 */

const AHORA = '2026-11-01T12:00:00.000Z';
const ISIN = 'DE0005140008';

/** El registro universal de una acción, con la forma medida del canónico del 01-11-2026. */
function universalDeAccion(cambios: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        _id: ISIN,
        identificacion: {
            nombre: 'Deutsche Bank Aktiengesellschaft',
            tipo: 'accion',
            tipo_producto: 'accion',
            isin: ISIN,
            ticker: 'DBK',
            mercado: 'XETRA',
            pais: 'Germany',
            divisa_base: 'EUR',
            sector: 'Financial Services',
            industria: 'Banks - Regional',
            descripcion: 'Banca corporativa y de inversion.',
            /* Las acciones NO traen `clase_activo`: es un campo de ficha de fondo. */
            fecha_dato: '2026-07-17'
        },
        valoracion: { vl: 30.835, vl_fecha: '2026-07-17', vl_divisa: 'EUR' },
        rentabilidad: {
            fecha_dato: '2026-07-17',
            trailing_pct: {
                '1a': { fondo: 23.1551 },
                '3a_anualizada': { fondo: 50.897 },
                '5a_anualizada': { fondo: 29.2925 }
            }
        },
        riesgo: {
            fecha_dato: '2026-07-17',
            volatilidad_pct: { '1a': { fondo: 32.9074 }, '3a': { fondo: 31.9484 } },
            sharpe: { '1a': { fondo: 0.6444 }, '3a': { fondo: 1.503 } },
            rf_pct: { '1a': { fondo: 1.9508 } },
            max_drawdown: { pct: -46.36, periodo: '5a' },
            historial_precios: {
                source_history: 'eodhd',
                divisa_metricas: 'EUR',
                source_listing_id: 'EODHD:DBK.XETRA',
                first_date: '1994-02-01',
                last_date: '2026-07-17',
                observations_count: 8209,
                history_quality_status: 'COMPLETE'
            }
        },
        fundamentales: {
            currency: 'EUR',
            dividends: { yield_ratio: 0.0316, forward_annual_rate: 1.0, payout_ratio: 0.3067, ex_dividend_date: '2026-05-29' },
            per_share: { dividend: 1.0, eps: 3.16 },
            valuation: { market_cap: 58992398336.0, pe_trailing: 9.7579 }
        },
        meta: { isin: ISIN, actualizado: '2026-07-18T16:47:11+00:00' },
        ...cambios
    };
}

/** La ficha de `export_bdb` de una acción. */
function fichaDeAccion(cambios: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        isin: ISIN,
        name: 'Deutsche Bank Aktiengesellschaft',
        currency: 'EUR',
        report_date: '2026-07-17',
        generated_at: '2026-11-01T18:39:44+00:00',
        ms: { objective: 'Banca corporativa y de inversion.' },
        classification_v2: { asset_type: 'stock', asset_subtype: 'common_stock' },
        provenance: { version: 1, fields: {} },
        ...cambios
    };
}

function porRuta(resultado: ReturnType<typeof mapearInstrumento>): Record<string, Record<string, unknown>> {
    return Object.fromEntries(
        resultado.documentos.map((documento) => [documento.ruta.replace(`instruments/${ISIN}`, '').replace(/^\//, '') || '<raiz>', documento.documento])
    );
}

describe('la cotizacion que no es la principal (decision 46)', () => {
    const TIPO = 'instrument-declared-equity.v2.schema.json';
    const universalCon = (aviso: unknown) => {
        const universal = universalDeAccion() as Record<string, unknown>;
        return { ...universal, identificacion: { ...(universal['identificacion'] as object), cotizacion_aviso: aviso } };
    };
    const listadoDe = (universal: unknown) =>
        (porRuta(mapearInstrumento(fichaDeAccion(), universal as RegistroUniversal, AHORA))['declared/equity'] as Record<string, unknown>)[
            'listing'
        ] as Record<string, unknown>;

    it.each([
        ['mercado_de_origen_no_disponible', 'HOME_MARKET_NOT_AVAILABLE'],
        ['divisa_de_origen_no_disponible', 'HOME_CURRENCY_NOT_AVAILABLE']
    ])('%s se escribe como %s, y valida', (aviso, motivo) => {
        const documento = porRuta(mapearInstrumento(fichaDeAccion(), universalCon(aviso) as RegistroUniversal, AHORA))['declared/equity'];
        expect((documento?.['listing'] as Record<string, unknown>)['non_primary_reason']).toBe(motivo);
        expect(validarForma(TIPO, documento as Record<string, unknown>).ok).toBe(true);
    });

    it('sin aviso el campo no existe', () => {
        expect(listadoDe(universalDeAccion())).not.toHaveProperty('non_primary_reason');
    });

    it('un motivo que nadie ha traducido para la ingesta, no se inventa', () => {
        const parado = mapearInstrumento(fichaDeAccion(), universalCon('otro_motivo') as RegistroUniversal, AHORA);
        expect(parado.errores.join(' ')).toContain('cotizacion_aviso');
    });
});

describe('una accion no se archiva nunca como si sus cifras fueran del proveedor', () => {
    it('no escribe provider_risk ni provider_returns, y pone sus metricas en computed/metrics', () => {
        /*
         * El defecto que esta prueba impide, medido: las volatilidades, los Sharpe y las
         * rentabilidades de las 73 acciones las calcula el extractor sobre la serie de EODHD.
         * El mapper de fondos las habria metido en `declared/provider_risk` porque
         * `meta.procedencia` esta vacia en las 73 y su filtro dice entonces «no es nuestra».
         */
        const resultado = mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA);
        expect(resultado.errores).toEqual([]);
        const bloques = porRuta(resultado);
        expect(Object.keys(bloques)).not.toContain('declared/provider_risk');
        expect(Object.keys(bloques)).not.toContain('declared/provider_returns');
        expect(bloques['computed/metrics']).toBeDefined();
        /* En fracción, como todo el contrato: el canónico las trae en por ciento. El
           `closeTo` es por el ruido de dividir entre 100, que es el mismo que ya tienen las
           cifras de los fondos. */
        const volatilidad = bloques['computed/metrics']?.['volatility'] as Record<string, number>;
        expect(volatilidad['1y']).toBeCloseTo(0.329074, 9);
        expect(volatilidad['3y']).toBeCloseTo(0.319484, 9);
    });

    it('declara su propio metodo, que NO es el de los fondos', () => {
        /*
         * `EXTRACTOR_MONTHLY_V2` es mensual: rentabilidades de cierre de mes por raiz de 12 y
         * ventanas de meses cerrados. El de una accion es diario y cuenta la ventana desde el
         * ultimo dia de la serie. METODO_PROPIO_METRICAS dice que cambiar un parametro cambia
         * la version; aqui cambian cuatro, asi que etiquetarlas igual haria comparable lo que
         * no lo es.
         */
        const metricas = porRuta(mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA))['computed/metrics'];
        expect(metricas?.['method']).toBe('EXTRACTOR_DAILY_V2');
        expect(metricas?.['frequency']).toBe('DAILY');
        expect(metricas?.['method']).not.toBe('EXTRACTOR_MONTHLY_V2');
    });

    it('con el sello de la version 3 se publica como V3, y la tarjeta sigue avisando del muestreo diario (A-158)', () => {
        /* La ficha de una accion no llevaba sello hasta la version 3: sin el, es V2 (la prueba de
           arriba). Con el, la volatilidad ya esta anualizada con las observaciones que hay. */
        const base = universalDeAccion();
        const riesgo = base['riesgo'] as Record<string, unknown>;
        const sello = 'core.metricas v3: rentabilidades diarias, en euros, volatilidad anualizada con las observaciones de la ventana';
        const universal = {
            ...base,
            riesgo: { ...riesgo, historial_precios: { ...(riesgo['historial_precios'] as Record<string, unknown>), metodo: sello } }
        };
        const resultado = mapearInstrumento(fichaDeAccion(), universal as RegistroUniversal, AHORA);
        const bloques = porRuta(resultado);
        expect(bloques['computed/metrics']?.['method']).toBe('EXTRACTOR_DAILY_V3');
        expect(bloques['computed/metrics']?.['frequency']).toBe('DAILY');

        const instrumento: InstrumentoLeido = {
            instrument_id: ISIN,
            raiz: bloques['<raiz>'] as Record<string, unknown>,
            bloques: {
                'declared/equity': bloques['declared/equity'],
                'declared/dividends': bloques['declared/dividends'],
                'declared/quote': bloques['declared/quote']
            },
            calculadas: bloques['computed/metrics']
        };
        const tarjeta = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA);
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok, JSON.stringify(tarjeta)).toBe(true);
        expect((tarjeta?.['metrics'] as Record<string, unknown>)['method']).toBe('EXTRACTOR_DAILY_V3');
        const avisos = (tarjeta?.['quality'] as Record<string, unknown>)['warnings'] as { code: string }[];
        expect(avisos.map((a) => a.code)).toContain('METRICAS_DE_MUESTREO_DIARIO');
    });

    it('con el sello de la version 4 se publica como V4, y la tarjeta la admite (MET-6 y MET-7)', () => {
        const base = universalDeAccion();
        const riesgo = base['riesgo'] as Record<string, unknown>;
        const sello = 'core.metricas v4: rentabilidades diarias, en euros, volatilidad anualizada con las observaciones de la ventana';
        const universal = {
            ...base,
            riesgo: { ...riesgo, historial_precios: { ...(riesgo['historial_precios'] as Record<string, unknown>), metodo: sello } }
        };
        const bloques = porRuta(mapearInstrumento(fichaDeAccion(), universal as RegistroUniversal, AHORA));
        expect(bloques['computed/metrics']?.['method']).toBe('EXTRACTOR_DAILY_V4');
        const instrumento: InstrumentoLeido = {
            instrument_id: ISIN,
            raiz: bloques['<raiz>'] as Record<string, unknown>,
            bloques: {
                'declared/equity': bloques['declared/equity'],
                'declared/dividends': bloques['declared/dividends'],
                'declared/quote': bloques['declared/quote']
            },
            calculadas: bloques['computed/metrics']
        };
        const tarjeta = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA);
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok, JSON.stringify(tarjeta)).toBe(true);
        expect((tarjeta?.['metrics'] as Record<string, unknown>)['method']).toBe('EXTRACTOR_DAILY_V4');
    });

    it('la caida maxima de una accion entra en TODAS sus ventanas', () => {
        /*
         * Medido el 02-11-2026 sobre la base ya escrita: de las 297 acciones con metricas
         * nuestras, 290 tenian caida maxima y las 290 la tenian SOLO a cinco anos, porque el
         * canonico traia un escalar con su `periodo` suelto. Las otras dos ventanas se
         * calculaban y se tiraban.
         */
        const u = universalDeAccion() as Record<string, unknown>;
        u['riesgo'] = {
            ...(u['riesgo'] as Record<string, unknown>),
            max_drawdown_pct: {
                '1a': { fondo: -18.2 },
                '3a': { fondo: -31.4 },
                '5a': { fondo: -46.36 }
            }
        };
        const metricas = porRuta(mapearInstrumento(fichaDeAccion(), u as RegistroUniversal, AHORA))['computed/metrics'];
        const caida = metricas?.['max_drawdown'] as Record<string, number>;
        expect(Object.keys(caida).sort()).toEqual(['1y', '3y', '5y']);
        expect(caida['1y']).toBeCloseTo(-0.182, 10);
    });

    it('sin las ventanas, el escalar de siempre sigue dando la suya', () => {
        // Un canonico anterior al 02-11-2026 no trae `max_drawdown_pct`.
        const metricas = porRuta(mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA))['computed/metrics'];
        const caida = metricas?.['max_drawdown'] as Record<string, number>;
        expect(Object.keys(caida)).toEqual(['5y']);
        expect(caida['5y']).toBeCloseTo(-0.4636, 10);
    });

    it('el documento de metricas de una accion lo firma el LOTE, no la plataforma', () => {
        const metricas = mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA).documentos.find(
            (d) => d.ruta.endsWith('computed/metrics')
        );
        expect(metricas?.comoDueno).toBe('batch');
    });
});

describe('el derecho a calcular: una accion lo declara con el ajuste de su serie', () => {
    it('declara que la serie lleva desdoblamientos y dividendos, y que por eso es retorno total', () => {
        const metricas = porRuta(mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA))['computed/metrics'];
        const entradas = metricas?.['inputs'] as Record<string, unknown>;
        expect(entradas['series_adjustment']).toBe('SPLIT_AND_DIVIDEND_ADJUSTED');
        expect(metricas?.['return_basis']).toBe('TOTAL_RETURN');
        /* Y NO usa el campo de los fondos: una accion no tiene politica de reparto de clase. */
        expect(entradas['distribution_policy_resolution']).toBeUndefined();
    });

    it('una fuente de serie cuyo ajuste no esta declarado NO publica metricas', () => {
        /*
         * No es una precaucion teorica: una serie sin ajustar da rentabilidad de solo precio y
         * se queda corta en el dividendo entero. Publicarla como retorno total seria el mismo
         * defecto con otra cara, asi que la tabla no tiene valor por defecto.
         */
        const universal = universalDeAccion();
        (((universal['riesgo'] as Record<string, unknown>)['historial_precios'] as Record<string, unknown>))[
            'source_history'
        ] = 'un_proveedor_nuevo';
        const resultado = mapearInstrumento(fichaDeAccion(), universal, AHORA);
        expect(Object.keys(porRuta(resultado))).not.toContain('computed/metrics');
        expect(resultado.ausencias.some((a) => a.ruta === 'computed/metrics' && a.razon === 'NOT_PROVIDED')).toBe(true);
    });

    it('el contrato EXIGE uno de los dos derechos: sin ninguno, no valida', () => {
        const base = {
            computed_at: AHORA,
            method: 'EXTRACTOR_DAILY_V2',
            frequency: 'DAILY',
            return_basis: 'TOTAL_RETURN',
            volatility: { '1y': 0.33 }
        };
        const TIPO = 'instrument-computed-metrics.v2.schema.json';
        /* Con el ajuste de la serie: vale (es una accion). */
        expect(
            validarForma(TIPO, {
                ...base,
                inputs: { series_id: 'EODHD:DBK.XETRA', currency: 'EUR', series_adjustment: 'SPLIT_AND_DIVIDEND_ADJUSTED' }
            }).ok
        ).toBe(true);
        /* Con el grado de la politica: vale (es un fondo). */
        expect(
            validarForma(TIPO, {
                ...base,
                method: 'EXTRACTOR_MONTHLY_V2',
                frequency: 'MONTHLY',
                inputs: { series_id: 'vl:IE00B4L5Y983', currency: 'EUR', distribution_policy_resolution: 'OFFICIAL_REGISTER' }
            }).ok
        ).toBe(true);
        /* Sin ninguno de los dos: NO vale. La barrera se traduce, no se relaja. */
        expect(validarForma(TIPO, { ...base, inputs: { series_id: 'x', currency: 'EUR' } }).ok).toBe(false);
    });
});

describe('el 1-7 de una accion no entra, y lo impide el contrato', () => {
    it('ningun esquema admite VOL_BUCKET como origen del indicador de riesgo', () => {
        /*
         * Decision de Oscar del 01-11-2026. Las 312 acciones de la base vieja llevan un 1-7
         * que NO viene de ningun KID: se calculo con un cubo de volatilidad en
         * readmodel/mappers.py y se archivo como si fuera regulatorio. Estaba declarado en el
         * contrato y sin usar, y asi bastaba una linea de mapper para reproducirlo; retirado
         * del enum, lo rechaza el esquema.
         */
        const origenes = cargarEsquemas()
            .flatMap((esquema) => rutasDe(esquema).map((ruta) => ({ fichero: esquema.fichero, ruta })))
            .filter(({ ruta }) => ruta.ruta.endsWith('risk_score_source'));
        expect(origenes.length).toBeGreaterThan(0);
        for (const { fichero, ruta } of origenes) {
            expect(ruta.nodo['enum'], `${fichero}:${ruta.ruta}`).toEqual(['SRI_KID', 'SRRI']);
        }
    });

    it('la tarjeta de una accion no lleva indicador de riesgo, y dice por que', () => {
        const tarjeta = tarjetaDeAccion();
        expect((tarjeta?.['metrics'] as Record<string, unknown>)?.['risk_score']).toBeUndefined();
        const avisos = (tarjeta?.['quality'] as Record<string, unknown>)['warnings'] as { code: string }[];
        expect(avisos.map((a) => a.code)).toContain('SIN_INDICADOR_REGULATORIO');
    });
});

describe('la raiz y la tarjeta de una accion no son las de un fondo con huecos', () => {
    it('ni una accion ni un fondo necesitan categoria para EXISTIR', () => {
        /* Medido: las 73 acciones traen `ms.category_morningstar` a null, las 73. Exigir la
           categoria dejaba a las 73 sin raiz; poner ahi el sector seria un valor valido en un
           campo que significa otra cosa.
         *
         * Y desde el 02-11-2026 tampoco la exige un FONDO, por decision de Oscar. Esta prueba
         * afirmaba lo contrario, y lo que ese bloqueo costaba estaba medido: `LU2504555777`,
         * un fondo vivo de 1.533 M€ cuya categoria Morningstar no publica, no tenia raiz, y
         * trece de sus documentos colgaban de un padre que no existia. Existir y servir para
         * algo son dos preguntas distintas: la segunda la contesta la aptitud
         * COMPARAR_CON_SU_GRUPO, que es la prueba de aqui al lado. */
        const TIPO = 'instrument.v2.schema.json';
        const comun = {
            schema_version: 'base-nueva.instrument.v2',
            updated_at: AHORA,
            identity: { name: 'Algo', name_folded: 'algo', currency: 'EUR' }
        };
        expect(
            validarForma(TIPO, {
                ...comun,
                instrument_id: ISIN,
                instrument_type: 'STOCK',
                classification: { asset_class: 'EQUITY' }
            }).ok
        ).toBe(true);
        expect(
            validarForma(TIPO, {
                ...comun,
                instrument_id: 'IE00BYR8H148',
                instrument_type: 'FUND',
                classification: { asset_class: 'EQUITY' }
            }).ok
        ).toBe(true);
        /* Lo que sigue siendo obligatorio en los dos: la clase de activo. Sin ella no hay ni
           radiografia ni reparto, y eso si deja al instrumento sin poder entrar en una
           cartera. */
        expect(
            validarForma(TIPO, {
                ...comun,
                instrument_id: 'IE00BYR8H148',
                instrument_type: 'FUND',
                classification: {}
            }).ok
        ).toBe(false);
    });

    it('la tarjeta lleva sector, industria y mercado, que es lo que ocupa el sitio de la categoria', () => {
        const tarjeta = tarjetaDeAccion();
        const clasificacion = tarjeta?.['classification'] as Record<string, unknown>;
        expect(clasificacion['sector']).toBe('Financial Services');
        expect(clasificacion['industry']).toBe('Banks - Regional');
        expect(clasificacion['exchange']).toBe('XETRA');
        expect(clasificacion['category']).toBeUndefined();
    });

    it('la tarjeta lleva precio con su fecha y su clase, o no lleva precio', () => {
        /* La base nueva no guardaba el precio de NADA hasta el 01-11-2026, y la ficha que
           Oscar decidio lo lleva. Las tres claves van juntas: el contrato las exige. */
        const cotizacion = tarjetaDeAccion()?.['quote'] as Record<string, unknown>;
        expect(cotizacion['price']).toBe(30.835);
        expect(cotizacion['as_of']).toBe('2026-07-17');
        expect(cotizacion['price_class']).toBe('MARKET_PRICE');
    });

    it('la tarjeta no lleva columna de costes vacia', () => {
        expect(tarjetaDeAccion()?.['costs']).toBeUndefined();
    });

    it('el reparto de una accion viaja MARCADO como derivado del tipo', () => {
        /* Sin la marca, una radiografia veria dos repartos con la misma pinta y confianza 1,
           uno medido por un tercero y otro deducido de que es una accion. */
        const exposicion = tarjetaDeAccion()?.['exposure'] as Record<string, unknown>;
        expect(exposicion['derivation']).toBe('BY_INSTRUMENT_TYPE');
        expect(exposicion['asset_mix']).toEqual({ equity: 1, fixed_income: 0, cash: 0, other: 0 });
    });

    it('la tarjeta dice que la metrica es NUESTRA, con su metodo', () => {
        const metricas = tarjetaDeAccion()?.['metrics'] as Record<string, unknown>;
        expect(metricas['source']).toBe('COMPUTED');
        expect(metricas['method']).toBe('EXTRACTOR_DAILY_V2');
        expect(metricas['as_of']).toBe('2026-07-17');
    });
});

describe('el Sharpe de una accion fuera del euro', () => {
    it('no se publica, porque falta el tipo libre de riesgo de su divisa', () => {
        /*
         * No es suprimirlo: METODO_PROPIO_METRICAS dice que el Sharpe no se suprime bajo
         * ningun concepto y nombra los dos unicos casos en que no sale, que son ingredientes
         * que faltan. Desde V2 el motivo vigente es otro: la par. 9 del metodo, que retira el
         * Sharpe de la accion individual. Esta barrera lo deja fuera en las que no cotizan en
         * euros; las que si cotizan son la deuda declarada en esa misma seccion.
         */
        const universal = universalDeAccion();
        (universal['identificacion'] as Record<string, unknown>)['divisa_base'] = 'USD';
        (universal['valoracion'] as Record<string, unknown>)['vl_divisa'] = 'USD';
        const resultado = mapearInstrumento(fichaDeAccion({ currency: 'USD' }), universal, AHORA);
        const metricas = porRuta(resultado)['computed/metrics'];
        expect(metricas?.['sharpe']).toBeUndefined();
        /* Pero la volatilidad sigue: es insumo del riesgo de la cartera. */
        expect(metricas?.['volatility']).toBeDefined();
        expect(
            resultado.ausencias.some(
                (a) => a.ruta === 'computed/metrics.sharpe' && a.razon === 'NOT_APPLICABLE'
            )
        ).toBe(true);
    });

    it('en euros si se publica', () => {
        const metricas = porRuta(mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA))['computed/metrics'];
        expect(metricas?.['sharpe']).toEqual({ '1y': 0.6444, '3y': 1.503 });
    });
});

describe('lo que no aplica dice POR QUE, y no parece una laguna', () => {
    it('los once bloques de fondo salen como NOT_APPLICABLE y con explicacion', () => {
        /* Un campo ausente sin explicacion es la proxima persona preguntandose si se olvido.
           NOT_PROVIDED manda a alguien a buscar un dato que no existe; NOT_APPLICABLE cierra
           la pregunta. */
        const resultado = mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA);
        for (const bloque of Object.keys(BLOQUES_QUE_NO_APLICAN_A_UNA_ACCION)) {
            const ausencia = resultado.ausencias.find((a) => a.ruta === bloque);
            expect(ausencia, `falta la ausencia de ${bloque}`).toBeDefined();
            expect(ausencia?.razon, bloque).toBe('NOT_APPLICABLE');
            expect((ausencia?.detalle ?? '').length, bloque).toBeGreaterThan(30);
        }
    });

    it('toda razon de ausencia es una de las tres del vocabulario', () => {
        const resultado = mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA);
        for (const ausencia of resultado.ausencias) {
            expect(AUSENCIAS as readonly string[]).toContain(ausencia.razon);
        }
    });

    it('los fundamentales se CUENTAN como sin sitio, no se tiran callados', () => {
        /* Existen —71 de 73 traen el resumen entero— y no entran en F1 porque son del EMISOR:
           su sitio es issuers/{id}/fundamentals/latest, que esta escrito y vacio. */
        const resultado = mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA);
        expect(resultado.perdidas.some((p) => p.startsWith('fundamentales.{'))).toBe(true);
        expect(resultado.perdidas.some((p) => p.includes('payout_ratio'))).toBe(true);
    });

    it('la cobertura de una accion no cuenta los bloques de fondo', () => {
        /*
         * Es la leccion del 30-10 aplicada a un tipo nuevo: el denominador es la poblacion a
         * la que el campo aplica. Sin el predicado ACCION y sin marcar los bloques de fondo,
         * una accion contaria el coste corriente de un producto sin coste corriente.
         */
        const calidad = calcularCalidad(instrumentoAccionLeido(), AHORA);
        expect(calidad.aplicables).toBeLessThan(80);
        const rutasAusentes = (calidad.documento['absences'] as { path: string }[]).map((a) => a.path);
        for (const bloque of Object.keys(BLOQUES_QUE_NO_APLICAN_A_UNA_ACCION)) {
            expect(rutasAusentes.filter((r) => r.startsWith(`${bloque}.`)), bloque).toEqual([]);
        }
    });

    it('un fondo sigue contando MUCHAS mas rutas que una accion', () => {
        const fondo = calcularCalidad(instrumentoFondoMinimo(), AHORA);
        const accion = calcularCalidad(instrumentoAccionLeido(), AHORA);
        expect(fondo.aplicables).toBeGreaterThan(accion.aplicables * 2);
    });
});

describe('las aptitudes de una accion no son las de un fondo', () => {
    it('no es apta para comparar por coste ni para mostrar alpha, y dice que no aplica', () => {
        const calidad = calcularCalidad(instrumentoAccionLeido(), AHORA);
        const aptitudes = calidad.documento['fitness'] as Record<string, { apt: boolean; missing?: string[] }>;
        expect(aptitudes['COMPARAR_COSTE'].apt).toBe(false);
        expect(aptitudes['COMPARAR_COSTE'].missing?.[0]).toMatch(/^no aplica/);
        expect(aptitudes['MOSTRAR_ALPHA'].apt).toBe(false);
        expect(aptitudes['MOSTRAR_ALPHA'].missing?.[0]).toMatch(/^no aplica/);
    });

    it('SI es apta para una radiografia de cartera, con el reparto mas fiable que hay', () => {
        /* Si se le exigiera declared/exposure, las 73 saldrian no aptas teniendo la
           composicion mas conocida de la base. */
        const aptitudes = calcularCalidad(instrumentoAccionLeido(), AHORA).documento['fitness'] as Record<
            string,
            { apt: boolean }
        >;
        expect(aptitudes['RADIOGRAFIA_DE_CARTERA'].apt).toBe(true);
    });

    it('SI es apta para comparar rentabilidad, sin necesitar politica de reparto', () => {
        /* Su serie es la ajustada, asi que ya es de retorno total. Es la buena noticia del
           tipo: de las 469 metricas propias de fondos, 449 se retiraron el 01-11-2026 por no
           tener evidencia de la politica, y una accion no hereda ese problema. */
        const aptitudes = calcularCalidad(instrumentoAccionLeido(), AHORA).documento['fitness'] as Record<
            string,
            { apt: boolean }
        >;
        expect(aptitudes['COMPARAR_RENTABILIDAD'].apt).toBe(true);
    });
});

describe('las piezas sueltas del vocabulario de acciones', () => {
    it('ACCION es un predicado declarado y evaluable', () => {
        expect(PREDICADOS_DE_APLICABILIDAD as readonly string[]).toContain('ACCION');
        expect(aplicaAlInstrumento('ACCION', { instrument_type: 'STOCK' })).toBe(true);
        expect(aplicaAlInstrumento('ACCION', { instrument_type: 'FUND' })).toBe(false);
        expect(aplicaAlInstrumento('FONDO_O_ETF', { instrument_type: 'STOCK' })).toBe(false);
    });

    it('el predicado de un subarbol gobierna a sus hijos', () => {
        /*
         * El indice de referencia declara que es cosa de fondos y tiene seis campos dentro.
         * Antes el predicado no se heredaba, asi que los seis contaban como aplicables a una
         * accion, que no tiene folleto donde declarar un indice. Un predicado que no manda en
         * su subarbol no sirve de nada.
         */
        const raiz = cargarEsquemas().find((e) => e.fichero === 'instrument.v2.schema.json');
        const dentroDelIndice = rutasDe(raiz!).filter((r) =>
            r.ruta.startsWith('classification.official_benchmark.')
        );
        expect(dentroDelIndice.length).toBeGreaterThanOrEqual(5);
        for (const ruta of dentroDelIndice) {
            expect(ruta.aplicaCuando, ruta.ruta).toBe('FONDO_O_ETF');
        }
    });

    it('los once bloques de fondo declaran que son de fondo, cada uno en su contrato', () => {
        /* Es lo que hace que un bloque nuevo no cuente en una accion por descuido: si alguien
           anade un contrato de fondo sin este predicado, esta prueba lo nombra. */
        const deFondo = [
            'instrument-declared-profile',
            'instrument-declared-costs',
            'instrument-declared-regulatory',
            'instrument-declared-exposure',
            'instrument-declared-provider-risk',
            'instrument-declared-provider-returns',
            'instrument-declared-sustainability',
            'instrument-declared-size',
            'instrument-declared-holdings',
            'instrument-declared-distributions'
        ];
        for (const nombre of deFondo) {
            const esquema = cargarEsquemas().find((e) => e.fichero === `${nombre}.v2.schema.json`);
            expect(esquema, nombre).toBeDefined();
            expect(esquema!.json['x-applies-when'], nombre).toBe('FONDO_O_ETF');
        }
    });

    it('los dos contratos de accion declaran que son de accion', () => {
        for (const nombre of ['instrument-declared-equity', 'instrument-declared-dividends']) {
            const esquema = cargarEsquemas().find((e) => e.fichero === `${nombre}.v2.schema.json`);
            expect(esquema, nombre).toBeDefined();
            expect(esquema!.json['x-applies-when'], nombre).toBe('ACCION');
        }
    });

    it('las tablas de traduccion de acciones no tienen valor por defecto', () => {
        expect(CLASE_ACTIVO['stock']).toBe('EQUITY');
        expect(PAIS_DEL_MERCADO['Germany']).toBe('DE');
        expect(PAIS_DEL_MERCADO['Un pais que no existe']).toBeUndefined();
        expect(AJUSTE_DE_SERIE['eodhd']).toBe('SPLIT_AND_DIVIDEND_ADJUSTED');
        expect(AJUSTE_DE_SERIE['un_proveedor_nuevo']).toBeUndefined();
    });

    const EXPORT_FICHAS = resolve(__dirname, '../../1-extractor/export/fondos.ndjson');
    it.skipIf(!existsSync(EXPORT_FICHAS))('toda bolsa de las fichas del export tiene pais', () => {
        const sinPais = new Set<string>();
        let acciones = 0;
        for (const linea of readFileSync(EXPORT_FICHAS, 'utf8').split('\n')) {
            if (!linea.trim()) continue;
            const id = (JSON.parse(linea) as { identificacion?: Record<string, unknown> }).identificacion ?? {};
            if (id['tipo'] !== 'accion' || typeof id['mercado'] !== 'string') continue;
            acciones += 1;
            const pais = id['pais'];
            if (typeof pais !== 'string' || PAIS_DEL_MERCADO[pais] === undefined) {
                sinPais.add(`${String(id['mercado'])} (${String(pais)})`);
            }
        }
        expect(acciones).toBeGreaterThan(0);
        expect([...sinPais]).toEqual([]);
    });

    it('el pais que viaja es el del MERCADO, y el contrato lo llama asi', () => {
        /*
         * Medido: los 73 paises se corresponden uno a uno con los 73 mercados, porque el campo
         * sale del Country del listado. Llamarlo domicilio habria afirmado donde esta
         * constituida la empresa, que es otra cosa: Ferrovial cotiza en Madrid y esta
         * constituida en Paises Bajos.
         */
        const equity = porRuta(mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA))['declared/equity'];
        expect((equity?.['listing'] as Record<string, unknown>)['country']).toBe('DE');
        const esquema = cargarEsquemas().find((e) => e.fichero === 'instrument-declared-equity.v2.schema.json');
        const rutas = rutasDe(esquema!).map((r) => r.ruta);
        expect(rutas).toContain('listing.country');
        expect(rutas).not.toContain('domicile');
        expect(rutas).not.toContain('country_of_incorporation');
    });
});

describe('el dividendo de una accion no es la politica de reparto de una clase', () => {
    it('un importe sin divisa no se escribe', () => {
        const TIPO = 'instrument-declared-dividends.v2.schema.json';
        const sobre = { source: 'canonical:fondosdb', as_of: '2026-07-17' };
        expect(validarForma(TIPO, { ...sobre, trailing_amount_per_share: 1.0 }).ok).toBe(false);
        expect(validarForma(TIPO, { ...sobre, trailing_amount_per_share: 1.0, currency: 'EUR' }).ok).toBe(true);
        /* Un rendimiento es una fraccion y no lleva divisa: no es un importe. */
        expect(validarForma(TIPO, { ...sobre, yield_12m: 0.0316 }).ok).toBe(true);
    });

    it('lo pagado y lo anunciado son campos distintos', () => {
        /* Uno es un hecho y el otro una expectativa del emisor: en un informe de cliente no se
           pueden presentar como lo mismo. */
        const dividendos = porRuta(mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA))[
            'declared/dividends'
        ];
        expect(dividendos?.['trailing_amount_per_share']).toBe(1.0);
        expect(dividendos?.['forward_amount_per_share']).toBe(1.0);
        expect(dividendos?.['yield_12m']).toBe(0.0316);
        expect(dividendos?.['currency']).toBe('EUR');
    });

    it('el rendimiento entra en FRACCION aunque el canonico lo traiga en por ciento', () => {
        const universal = universalDeAccion();
        const fundamentales = universal['fundamentales'] as Record<string, unknown>;
        delete (fundamentales['dividends'] as Record<string, unknown>)['yield_ratio'];
        fundamentales['dividend_yield_pct'] = 3.16;
        const dividendos = porRuta(mapearInstrumento(fichaDeAccion(), universal, AHORA))['declared/dividends'];
        expect(dividendos?.['yield_12m']).toBeCloseTo(0.0316, 6);
    });

    it('sin dato de dividendo es NOT_PROVIDED, no NOT_APPLICABLE', () => {
        /* Una empresa que no reparte y una de la que no tenemos el dato se ven igual desde
           aqui, y afirmar que no reparte sin saberlo es lo que esta base no hace. */
        const universal = universalDeAccion({ fundamentales: {} });
        const resultado = mapearInstrumento(fichaDeAccion(), universal, AHORA);
        expect(Object.keys(porRuta(resultado))).not.toContain('declared/dividends');
        const ausencia = resultado.ausencias.find((a) => a.ruta === 'declared/dividends');
        expect(ausencia?.razon).toBe('NOT_PROVIDED');
    });
});

describe('el precio, que la base no guardaba de nada', () => {
    it('un fondo tambien lo tiene, y como valor liquidativo', () => {
        /* El hueco era de la base y no de las acciones: taparlo solo en un tipo habria dejado
           772 fondos sin precio por una asimetria sin razon. */
        const TIPO = 'instrument-declared-quote.v2.schema.json';
        expect(
            validarForma(TIPO, { source: 'canonical:fondosdb', as_of: '2026-10-29', price: 144.71, price_class: 'NAV' }).ok
        ).toBe(true);
        /* Y las tres claves son obligatorias: un precio sin fecha no se ensena a un cliente, y
           uno sin decir si es valor liquidativo o cierre de mercado no se compara. */
        expect(validarForma(TIPO, { source: 'x', as_of: '2026-10-29', price: 144.71 }).ok).toBe(false);
        expect(validarForma(TIPO, { source: 'x', as_of: '2026-10-29', price_class: 'NAV' }).ok).toBe(false);
    });

    it('lleva su divisa, porque la de la clase no siempre es la suya', () => {
        /* Esta prueba decia lo contrario: la divisa del precio y la del instrumento eran la misma
           cadena en los 846 registros del canonico. Dejo de ser verdad al entrar los ETF: en 13 de
           28 la clase esta en USD y el precio en EUR (hallazgo 64 de la auditoria). Es opcional,
           porque sin ella la pantalla sabe decir que no se sabe. */
        const TIPO = 'instrument-declared-quote.v2.schema.json';
        const precio = { source: 'canonical:fondosdb', as_of: '2026-11-03', price: 129.07, price_class: 'MARKET_PRICE' };
        expect(validarForma(TIPO, { ...precio, currency: 'EUR' }).ok).toBe(true);
        expect(validarForma(TIPO, precio).ok).toBe(true);
        expect(validarForma(TIPO, { ...precio, currency: 'euros' }).ok).toBe(false);
    });

    it('una accion publica la fuente real de su precio, y sin procedencia la reserva (decision B-68)', () => {
        /* 510 acciones del canonico traen `eodhd` el 09-11-2026; las cinco sin procedencia tampoco traen precio. */
        const conFuente = universalDeAccion({ meta: { procedencia: { 'valoracion.vl': 'eodhd' } } });
        const cotizacion = porRuta(mapearInstrumento(fichaDeAccion(), conFuente as RegistroUniversal, AHORA))['declared/quote'];
        expect(cotizacion).toMatchObject({ source: 'eodhd', price: 30.835, price_class: 'MARKET_PRICE', currency: 'EUR' });
        expect(validarForma('instrument-declared-quote.v2.schema.json', cotizacion!).ok).toBe(true);
        const sinFuente = porRuta(mapearInstrumento(fichaDeAccion(), universalDeAccion() as RegistroUniversal, AHORA))['declared/quote'];
        expect(sinFuente?.['source']).toBe('canonical:fondosdb');
    });
});

// ---------------------------------------------------------------------------
// Material de apoyo
// ---------------------------------------------------------------------------

/** La acción tal como queda en la base, para la calidad y la tarjeta. */
function instrumentoAccionLeido(): InstrumentoLeido {
    const resultado = mapearInstrumento(fichaDeAccion(), universalDeAccion(), AHORA);
    const bloques = porRuta(resultado);
    return {
        instrument_id: ISIN,
        raiz: bloques['<raiz>'] as Record<string, unknown>,
        bloques: {
            'declared/equity': bloques['declared/equity'],
            'declared/dividends': bloques['declared/dividends'],
            'declared/quote': bloques['declared/quote']
        },
        calculadas: bloques['computed/metrics']
    };
}

function tarjetaDeAccion(): Record<string, unknown> | undefined {
    const instrumento = instrumentoAccionLeido();
    const calidad = calcularCalidad(instrumento, AHORA);
    const tarjeta = componerTarjeta(instrumento, calidad, AHORA);
    /* La tarjeta que se compruebe tiene que ser una que la base aceptaria. */
    expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok, JSON.stringify(tarjeta)).toBe(true);
    return tarjeta;
}

/** Un fondo mínimo, para comparar denominadores. */
function instrumentoFondoMinimo(): InstrumentoLeido {
    return {
        instrument_id: 'IE00BYR8H148',
        raiz: {
            instrument_id: 'IE00BYR8H148',
            instrument_type: 'FUND',
            schema_version: 'base-nueva.instrument.v2',
            updated_at: AHORA,
            identity: { name: 'Un fondo', name_folded: 'un fondo', currency: 'EUR' },
            classification: { category: 'RV Global', asset_class: 'EQUITY' }
        },
        bloques: {
            'declared/exposure': {
                source: 'canonical:fondosdb',
                as_of: '2026-09-30',
                asset_mix: { equity: 1, fixed_income: 0, cash: 0, other: 0 },
                confidence: 0.9
            }
        }
    };
}


describe('una accion contra su referencia (decision 24)', () => {
    const conRelativas = (relativas: Record<string, unknown>) => {
        const base = universalDeAccion();
        return universalDeAccion({ riesgo: { ...(base['riesgo'] as Record<string, unknown>), relativas } });
    };
    const CONTRA_EUROPA = {
        indice_nombre: 'MSCI Europe',
        indice_variante: 'NR',
        indice_proxy: 'IE0007987708',
        indice_clase_de_serie: 'VALOR_LIQUIDATIVO',
        base_indice: 'TOTAL_RETURN',
        alcance: 'AREA',
        beta: { '3a': 0.82, '5a': 0.91 },
        r2: { '3a': 30.5, '5a': 35.1 }
    };
    const metricasDe = (universal: Record<string, unknown>) =>
        porRuta(mapearInstrumento(fichaDeAccion(), universal as RegistroUniversal, AHORA))['computed/metrics'];
    const TIPO = 'instrument-computed-metrics.v2.schema.json';

    it('dice contra que se midio, con que frecuencia y que lo elegimos nosotros', () => {
        const metricas = metricasDe(conRelativas(CONTRA_EUROPA));
        const relativa = metricas?.['relative'] as Record<string, unknown>;
        expect(relativa['reference']).toBe('ASSIGNED_AREA_INDEX');
        expect(relativa['frequency']).toBe('MONTHLY');
        expect((relativa['benchmark'] as Record<string, unknown>)['instrument_id']).toBe('IE0007987708');
        expect((relativa['beta'] as Record<string, number>)['3y']).toBe(0.82);
        expect((relativa['r2'] as Record<string, number>)['3y']).toBeCloseTo(0.305, 9);
        expect(relativa['jensen_alpha']).toBeUndefined();
        expect(validarForma(TIPO, metricas as Record<string, unknown>).ok).toBe(true);
    });

    it('el S&P 500 de una accion americana es de su plaza, no de su area', () => {
        const metricas = metricasDe(conRelativas({ ...CONTRA_EUROPA, indice_nombre: 'S&P 500', alcance: 'MERCADO' }));
        expect((metricas?.['relative'] as Record<string, unknown>)['reference']).toBe('ASSIGNED_MARKET_INDEX');
    });

    it('sin referencia decidida lo dice, y no es lo mismo que un hueco', () => {
        const decidido = mapearInstrumento(
            fichaDeAccion(),
            conRelativas({ aviso: 'sin_referencia_de_mercado(TO)' }) as RegistroUniversal,
            AHORA
        );
        expect(porRuta(decidido)['computed/metrics']?.['relative_absence']).toBe('NO_REFERENCE_FOR_MARKET');
        expect(decidido.ausencias.find((a) => a.ruta === 'computed/metrics.relative')?.razon).toBe('NOT_APPLICABLE');

        const hueco = mapearInstrumento(fichaDeAccion(), universalDeAccion() as RegistroUniversal, AHORA);
        expect(porRuta(hueco)['computed/metrics']?.['relative_absence']).toBeUndefined();
        expect(hueco.ausencias.find((a) => a.ruta === 'computed/metrics.relative')?.razon).toBe('NOT_PROVIDED');
    });

    it('una bolsa sin fila en indices_de_accion.csv tiene su propio motivo, y tampoco es un hueco (decision 46)', () => {
        const sinFila = mapearInstrumento(
            fichaDeAccion(),
            conRelativas({ aviso: 'sin_relativas_bolsa_sin_referencia(XX)' }) as RegistroUniversal,
            AHORA
        );
        const metricas = porRuta(sinFila)['computed/metrics'];
        expect(metricas?.['relative_absence']).toBe('NO_REFERENCE_DECIDED_FOR_MARKET');
        expect(metricas?.['relative']).toBeUndefined();
        expect(validarForma(TIPO, metricas as Record<string, unknown>).ok).toBe(true);
        const ausencia = sinFila.ausencias.find((a) => a.ruta === 'computed/metrics.relative');
        expect(ausencia?.razon).toBe('NOT_APPLICABLE');
        expect(ausencia?.detalle).toContain('indices_de_accion.csv');
    });

    it('un aviso que no es un motivo decidido no escribe motivo', () => {
        const otro = porRuta(
            mapearInstrumento(fichaDeAccion(), conRelativas({ aviso: 'otra_cosa(XX)' }) as RegistroUniversal, AHORA)
        );
        expect(otro['computed/metrics']?.['relative_absence']).toBeUndefined();
    });

    it('la cobertura de una accion no se mueve por tener estas cifras', () => {
        const sinEllas = instrumentoAccionLeido();
        const conEllas = {
            ...sinEllas,
            calculadas: {
                ...sinEllas.calculadas,
                relative: metricasDe(conRelativas(CONTRA_EUROPA))?.['relative']
            }
        };
        const a = calcularCalidad(sinEllas, AHORA);
        const b = calcularCalidad(conEllas, AHORA);
        expect(b.aplicables).toBe(a.aplicables);
        expect(b.presentes).toBe(a.presentes);
        expect(b.cobertura).toBe(a.cobertura);
    });

    it('la tarjeta lleva la referencia y la base la acepta', () => {
        const sinEllas = instrumentoAccionLeido();
        const instrumento = {
            ...sinEllas,
            calculadas: {
                ...sinEllas.calculadas,
                relative: metricasDe(conRelativas(CONTRA_EUROPA))?.['relative']
            }
        };
        const tarjeta = componerTarjeta(instrumento, calcularCalidad(instrumento, AHORA), AHORA);
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok, JSON.stringify(tarjeta)).toBe(true);
        const relativa = (tarjeta?.['metrics'] as Record<string, unknown>)['relative'] as Record<string, unknown>;
        expect(relativa['source']).toBe('COMPUTED');
        expect(relativa['reference']).toBe('ASSIGNED_AREA_INDEX');
        expect(relativa['jensen_alpha']).toBeUndefined();
    });

    it('el contrato deja el alfa para los fondos y una tarjeta de accion no puede llevarlo', () => {
        const esquema = cargarEsquemas().find((e) => e.fichero === TIPO);
        const rutas = rutasDe(esquema as NonNullable<typeof esquema>);
        const predicado = (ruta: string) => rutas.find((r) => r.ruta === ruta)?.aplicaCuando;
        for (const campo of ['jensen_alpha', 'active_return', 'tracking_error', 'information_ratio']) {
            expect(predicado(`relative.${campo}`), campo).toBe('FONDO_O_ETF');
        }
        expect(predicado('relative.beta')).toBeUndefined();
        expect(rutas.find((r) => r.ruta === 'relative.beta')?.cuentaCuando).toBe('FONDO_O_ETF');
        /* Lo que solo rellena una accion no puede bajar la cobertura de un fondo: la movia en 798
           instrumentos. */
        expect(rutas.find((r) => r.ruta === 'relative.reference')?.cuentaCuando).toBe('NUNCA');
        expect(rutas.find((r) => r.ruta === 'relative.frequency')?.cuentaCuando).toBe('NUNCA');
        expect(rutas.find((r) => r.ruta === 'relative_absence')?.cuentaCuando).toBe('NUNCA');
    });
});
