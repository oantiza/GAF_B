import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cargarEsquemas, rutasDe, subcoleccionesDeclaradas } from '../src/config/baseNueva/esquemas';
import { validarEscritura, validarForma } from '../src/config/baseNueva/validadores';
import { BLOQUES_DE_INSTRUMENTO, rutasPosiblesDe } from '../src/ingestion/baseNueva/mapper';
import type { SerieExportada } from '../src/ingestion/baseNueva/series';
import {
    calcularPrimaDescuento,
    mapearDelEmisor,
    MINIMO_DE_OBSERVACIONES,
    type ArgumentosDeLaPrima,
    type EntradasDelEmisor,
    type PuntoVlEmisor
} from '../src/ingestion/baseNueva/emisorDeEtf';

const ISIN = 'IE00B4L5Y983';
const AHORA = '2026-11-08T18:00:00.000Z';
const TIPO_DATOS = 'instrument-declared-issuer-data.v2.schema.json';
const TIPO_VL = 'instrument-issuer-nav.v2.schema.json';
const TIPO_PRIMA = 'instrument-computed-premium-discount.v2.schema.json';

/** Días hábiles hacia atrás desde el 03-11-2026, ascendentes. */
function dias(n: number): string[] {
    const salida: string[] = [];
    const cursor = new Date(Date.UTC(2026, 10, 3));
    while (salida.length < n) {
        const d = cursor.getUTCDay();
        if (d !== 0 && d !== 6) salida.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return salida.reverse();
}
const DIAS = dias(261);

function mercado(valor: (dia: string, i: number) => number, currency = 'EUR'): SerieExportada {
    return {
        instrument_id: ISIN,
        series_id: 'EODHD:EUNL.XETRA',
        source: 'eodhd',
        price_class: 'MARKET_PRICE',
        currency,
        points: DIAS.map((dia, i) => [dia, valor(dia, i)])
    };
}

function argumentos(extra: Partial<ArgumentosDeLaPrima> = {}): ArgumentosDeLaPrima {
    return {
        clase: 'ISSUER_NAV',
        conAncla: false,
        puntosDeVl: DIAS.map((dia) => [dia, 100]),
        divisaDelVl: 'EUR',
        serieDeMercado: mercado(() => 100),
        politica: 'ACCUMULATING',
        pagos: [],
        divisaDeLosPagos: undefined,
        historialConsultado: false,
        cambios: new Map(),
        seriesIdDelVl: `ISSUER:ishares:${ISIN}`,
        ...extra
    };
}

function emisorDeIshares(): Record<string, unknown> {
    return {
        fuente: 'ishares',
        id_emisor: '251882',
        fecha_descarga: '2026-11-08T13:50:22+00:00',
        nombre: 'iShares Core MSCI World UCITS ETF USD (Acc)',
        clase_activo: 'Equity',
        divisa_clase: 'USD',
        ter_pct: 0.2,
        politica: { valor: 'acumulacion', texto: 'Accumulating' },
        replica: { tipo: 'fisica', estructura: 'Physical Replication', metodo: 'Optimised', muestreo: true },
        indice: { nombre: 'MSCI World Index', ticker: 'NDDUWI' },
        patrimonio: {
            clase: { valor: 100_000_000, divisa: 'USD', fecha: '2026-11-06' },
            fondo: { valor: 150_000_000, divisa: 'USD', fecha: '2026-11-06' }
        },
        vl: {
            clase_de_serie: 'VL_EMISOR',
            divisa: 'USD',
            fuente: 'ishares:vl_historico',
            fecha_descarga: '2026-11-08T13:50:22+00:00',
            primera_fecha: DIAS[0],
            ultima_fecha: DIAS[DIAS.length - 1],
            observaciones: DIAS.length
        },
        cartera: { fecha: '2026-11-05', num_posiciones: 1280, peso_top10_pct: 25.1, exposicion: { Sector: { fecha: '2026-11-05', pesos_pct: { Energy: 3 } } } }
    };
}

function universal(emisor: Record<string, unknown>, tipoProducto = 'etf'): Record<string, unknown> {
    return { _id: ISIN, identificacion: { tipo_producto: tipoProducto }, emisor };
}

function entradas(extra: Partial<EntradasDelEmisor> = {}): EntradasDelEmisor {
    return {
        puntosDeVl: DIAS.map((fecha) => ({ fecha, vl: 100 })) as PuntoVlEmisor[],
        serieDeMercado: mercado(() => 90, 'EUR'),
        cambios: new Map([['USD', new Map(DIAS.map((dia) => [dia, 1.1]))]]),
        ...extra
    };
}

describe('la prima o el descuento', () => {
    it('da cero si cierre y VL coinciden, y publica su identidad', () => {
        const r = calcularPrimaDescuento(argumentos());
        expect(r).toMatchObject({
            publicada: true,
            mean: 0,
            latest: 0,
            observations: 261,
            nav_adjustment: 'NONE',
            market_series_id: 'EODHD:EUNL.XETRA',
            nav_series_id: `ISSUER:ishares:${ISIN}`,
            nav_series_class: 'ISSUER_NAV',
            distributions_in_window: 0,
            as_of: '2026-11-03',
            window_start: '2025-11-03'
        });
        expect(r).not.toHaveProperty('fx_source');
    });

    it('es cierre / VL - 1, con media y ultima por separado', () => {
        const r = calcularPrimaDescuento(argumentos({ serieDeMercado: mercado((_d, i) => (i === DIAS.length - 1 ? 102 : 101)) }));
        if (!r.publicada) throw new Error('debia publicarse');
        expect(r.latest).toBeCloseTo(0.02, 12);
        expect(r.mean).toBeCloseTo((260 * 0.01 + 0.02) / 261, 12);
    });

    it('convierte el VL a la divisa de la cotizacion con el cambio del BCE de ese dia', () => {
        const cambios = new Map([['USD', new Map(DIAS.map((dia) => [dia, 1.25]))]]);
        const r = calcularPrimaDescuento(
            argumentos({ puntosDeVl: DIAS.map((dia) => [dia, 125]), divisaDelVl: 'USD', serieDeMercado: mercado(() => 100, 'EUR'), cambios })
        );
        if (!r.publicada) throw new Error('debia publicarse');
        expect(r.mean).toBeCloseTo(0, 12);
        expect(r.fx_source).toBe('ECB_REFERENCE');
    });

    it('sin cambio en un dia, ese dia no cuenta; sin ninguno, no hay cifra', () => {
        const cambios = new Map([['USD', new Map(DIAS.slice(10).map((dia) => [dia, 1.25]))]]);
        const conHuecos = calcularPrimaDescuento(
            argumentos({ puntosDeVl: DIAS.map((dia) => [dia, 125]), divisaDelVl: 'USD', serieDeMercado: mercado(() => 100, 'EUR'), cambios })
        );
        if (!conHuecos.publicada) throw new Error('debia publicarse');
        expect(conHuecos.observations).toBe(251);
        expect(
            calcularPrimaDescuento(argumentos({ puntosDeVl: DIAS.map((dia) => [dia, 125]), divisaDelVl: 'USD', cambios: new Map() }))
        ).toEqual({ publicada: false, motivo: 'NO_FX_RATE' });
    });

    it('en una clase de reparto ajusta el VL hacia atras, y sin ajustar saldria un descuento que no existe', () => {
        /* VL 100 hasta la fecha ex, luego 98: el emisor no ajusta. El cierre ajustado es 98 todo el rato: ya descontó el pago de 2. */
        const ex = DIAS[150]!;
        const pagos = [{ ex, importe: 2 }];
        const puntosDeVl = DIAS.map((dia): [string, number] => [dia, dia < ex ? 100 : 98]);
        const conAjuste = calcularPrimaDescuento(
            argumentos({
                puntosDeVl,
                serieDeMercado: mercado(() => 98),
                politica: 'DISTRIBUTING',
                pagos,
                divisaDeLosPagos: 'EUR',
                historialConsultado: true
            })
        );
        if (!conAjuste.publicada) throw new Error('debia publicarse');
        expect(conAjuste.mean).toBeCloseTo(0, 10);
        expect(conAjuste.nav_adjustment).toBe('DISTRIBUTIONS_BACK_ADJUSTED');
        expect(conAjuste.distributions_in_window).toBe(1);

        const sinAjuste = DIAS.reduce((suma, dia) => suma + 98 / (dia < ex ? 100 : 98) - 1, 0) / DIAS.length;
        expect(sinAjuste).toBeLessThan(-0.01);
    });

    it('un pago posterior al ultimo cierre no entra: el cierre ajustado aun no lo conoce', () => {
        const pagos = [{ ex: '2026-11-05', importe: 2 }];
        const r = calcularPrimaDescuento(
            argumentos({ politica: 'DISTRIBUTING', pagos, divisaDeLosPagos: 'EUR', historialConsultado: true })
        );
        if (!r.publicada) throw new Error('debia publicarse');
        expect(r.nav_adjustment).toBe('NONE');
        expect(r.mean).toBe(0);
    });

    it('una clase que no declara politica y trae pagos se ajusta igual; sin pagos no hay cifra', () => {
        const ex = DIAS[200]!;
        const r = calcularPrimaDescuento(
            argumentos({
                puntosDeVl: DIAS.map((dia): [string, number] => [dia, dia < ex ? 100 : 99]),
                serieDeMercado: mercado(() => 99),
                politica: undefined,
                pagos: [{ ex, importe: 1 }],
                divisaDeLosPagos: 'EUR',
                historialConsultado: true
            })
        );
        expect(r.publicada).toBe(true);
        expect(calcularPrimaDescuento(argumentos({ politica: undefined }))).toEqual({ publicada: false, motivo: 'DISTRIBUTIONS_UNAVAILABLE' });
    });

    it('cada ausencia dice su motivo', () => {
        const casos: [Partial<ArgumentosDeLaPrima>, string][] = [
            [{ clase: 'ISSUER_CUMULATIVE_RETURN' }, 'ISSUER_SERIES_IS_CUMULATIVE_RETURN'],
            [{ clase: 'ISSUER_NAV_DERIVED', conAncla: false }, 'DERIVED_WITHOUT_ANCHOR'],
            [{ puntosDeVl: undefined }, 'NO_NAV_POINTS'],
            [{ divisaDelVl: undefined }, 'NO_NAV_POINTS'],
            [{ serieDeMercado: undefined }, 'NO_MARKET_SERIES'],
            [{ serieDeMercado: { ...mercado(() => 100), price_class: 'NAV' } }, 'NO_MARKET_SERIES'],
            [
                { politica: 'DISTRIBUTING', pagos: [{ ex: DIAS[100]!, importe: 1 }], divisaDeLosPagos: 'USD', historialConsultado: true },
                'DISTRIBUTION_CURRENCY_MISMATCH'
            ],
            [{ puntosDeVl: DIAS.slice(-(MINIMO_DE_OBSERVACIONES - 1)).map((dia) => [dia, 100]) }, 'INSUFFICIENT_OVERLAP'],
            [{ serieDeMercado: mercado((_d, i) => (i === 5 ? 121 : 100)) }, 'SCALE_MISMATCH']
        ];
        for (const [extra, motivo] of casos) {
            expect(calcularPrimaDescuento(argumentos(extra)), motivo).toEqual({ publicada: false, motivo });
        }
    });

    it('el VL deducido con ancla si da prima, y se identifica como deducido', () => {
        const r = calcularPrimaDescuento(argumentos({ clase: 'ISSUER_NAV_DERIVED', conAncla: true }));
        expect(r).toMatchObject({ publicada: true, nav_series_class: 'ISSUER_NAV_DERIVED' });
    });
});

describe('el bloque del emisor en la base', () => {
    it('sin bloque no sale nada', () => {
        expect(mapearDelEmisor({ _id: ISIN, identificacion: { tipo_producto: 'etf' } }, entradas(), AHORA).documentos).toEqual([]);
    });

    it('escribe los datos del emisor, la serie y la prima, y los tres validan', () => {
        const r = mapearDelEmisor(universal(emisorDeIshares()), entradas(), AHORA);
        expect(r.avisos).toEqual([]);
        const porTipo = (tipo: string) => r.documentos.filter((d) => d.tipo === tipo);
        expect(porTipo(TIPO_DATOS)).toHaveLength(1);
        expect(porTipo(TIPO_PRIMA)).toHaveLength(1);
        expect(porTipo(TIPO_VL).map((d) => d.ruta)).toEqual([`instruments/${ISIN}/issuer_nav/2025`, `instruments/${ISIN}/issuer_nav/2026`]);
        for (const d of r.documentos) {
            const veredicto = validarEscritura(d.tipo, d.documento, d.comoDueno ?? 'platform');
            expect(veredicto.ok, `${d.tipo}: ${JSON.stringify(veredicto)}`).toBe(true);
        }

        const datos = porTipo(TIPO_DATOS)[0]!.documento;
        expect(datos).toMatchObject({
            source: 'issuer:ishares',
            as_of: '2026-11-08',
            costs: { ongoing_charge: 0.002 },
            distribution_policy: { value: 'ACCUMULATING', text: 'Accumulating' },
            replication: { type: 'PHYSICAL', sampling: true },
            index: { name: 'MSCI World Index', ticker: 'NDDUWI' },
            size: { share_class: { aum: 100_000_000, currency: 'USD', as_of: '2026-11-06' } },
            holdings: { as_of: '2026-11-05', positions_count: 1280 }
        });
        expect((datos['nav'] as Record<string, unknown>)['last_value']).toBe(100);
        expect(datos['costs']).not.toHaveProperty('swap_fee');
        expect(r.perdidas).toEqual([expect.stringContaining('exposicion')]);
    });

    it('la serie del emisor no se confunde con la de las metricas: otra coleccion y otro series_id', () => {
        const r = mapearDelEmisor(universal(emisorDeIshares()), entradas(), AHORA);
        for (const d of r.documentos.filter((documento) => documento.tipo === TIPO_VL)) {
            expect(d.ruta).toContain('/issuer_nav/');
            expect(d.documento['series_id']).toBe(`ISSUER:ishares:${ISIN}`);
            expect(d.documento['value_kind']).toBe('NAV');
            expect(d.documento['series_id']).not.toBe('EODHD:EUNL.XETRA');
        }
        expect(r.documentos.some((d) => d.ruta.includes('/price_series/'))).toBe(false);
        expect(subcoleccionesDeclaradas().get('instruments/*/issuer_nav/*')).toBe(TIPO_VL);
        /* `price_series` sigue sin admitir ninguna clase del emisor. */
        const mercadoEnElContrato = cargarEsquemas().find((e) => e.fichero === 'instrument-price-series.v2.schema.json')!;
        const clases = rutasDe(mercadoEnElContrato).find((ruta) => ruta.ruta === 'price_class')!.nodo['enum'];
        expect(clases).toEqual(['NAV', 'MARKET_PRICE']);
    });

    it('la comision de swap va aparte del TER y no se suma, y el cero es un dato', () => {
        const emisor = {
            ...emisorDeIshares(),
            fuente: 'invesco',
            ter_pct: 0.05,
            comision_swap_pct: 0.0718,
            replica: { tipo: 'sintetica', metodo: 'Synthetic' },
            vl: {
                clase_de_serie: 'VL_EMISOR_DERIVADO',
                derivado: true,
                base: 10000,
                divisa: 'USD',
                fuente: 'invesco:vl_historico',
                primera_fecha: DIAS[0],
                ultima_fecha: DIAS[DIAS.length - 1],
                observaciones: DIAS.length,
                metodo: 'vl_ancla * crecimiento / crecimiento_en_fecha_ancla',
                anclaje: { vl: 14.7862, fecha: '2026-11-03', crecimiento: 88346.5 },
                cota_relativa_redondeo: 3.96e-6
            },
            cartera: { fecha: '2026-11-04', num_posiciones: 629, naturaleza: 'cesta_de_sustitucion', peso_top10_pct: 42.4 }
        };
        const r = mapearDelEmisor(universal(emisor), entradas(), AHORA);
        const datos = r.documentos.find((d) => d.tipo === TIPO_DATOS)!.documento;
        expect((datos['costs'] as Record<string, number>)['ongoing_charge']).toBeCloseTo(0.0005, 10);
        expect((datos['costs'] as Record<string, number>)['swap_fee']).toBeCloseTo(0.000718, 10);
        expect(datos['nav']).toMatchObject({
            series_class: 'ISSUER_NAV_DERIVED',
            derived: true,
            anchor: { value: 14.7862, date: '2026-11-03', growth: 88346.5 },
            rounding_bound: 3.96e-6
        });
        expect((datos['holdings'] as Record<string, unknown>)['nature']).toBe('SUBSTITUTE_BASKET');
        expect(r.documentos.find((d) => d.tipo === TIPO_PRIMA)!.documento['status']).toBe('PUBLISHED');

        const sinSwap = mapearDelEmisor(universal({ ...emisor, comision_swap_pct: 0 }), entradas(), AHORA);
        expect((sinSwap.documentos.find((d) => d.tipo === TIPO_DATOS)!.documento['costs'] as Record<string, number>)['swap_fee']).toBe(0);
    });

    it('la rentabilidad acumulada se guarda como crecimiento, sin precio y sin prima, diciendo por que', () => {
        const emisor = {
            ...emisorDeIshares(),
            fuente: 'invesco',
            vl: {
                clase_de_serie: 'RENTABILIDAD_ACUMULADA_EMISOR',
                derivado: true,
                base: 10000,
                divisa: 'USD',
                fuente: 'invesco:vl_historico',
                metodo: 'crecimiento de 10000, sin anclar',
                motivo_sin_anclaje: 'clase_que_reparte',
                ultimo_declarado: 39.26
            }
        };
        const puntosDeVl = DIAS.map((fecha, i) => ({ fecha, crecimiento: 10000 + i }));
        const r = mapearDelEmisor(universal(emisor), entradas({ puntosDeVl }), AHORA);
        const nav = r.documentos.find((d) => d.tipo === TIPO_VL)!.documento;
        expect(nav['value_kind']).toBe('GROWTH');
        const datos = r.documentos.find((d) => d.tipo === TIPO_DATOS)!.documento;
        expect(datos['nav']).toMatchObject({ series_class: 'ISSUER_CUMULATIVE_RETURN', no_anchor_reason: 'SHARE_CLASS_DISTRIBUTES', last_declared_value: 39.26 });
        expect(datos['nav']).not.toHaveProperty('last_value');
        const prima = r.documentos.find((d) => d.tipo === TIPO_PRIMA)!;
        expect(prima.documento).toMatchObject({ status: 'NOT_PUBLISHED', absence_reason: 'ISSUER_SERIES_IS_CUMULATIVE_RETURN' });
        expect(prima.documento).not.toHaveProperty('mean');
        for (const d of r.documentos) expect(validarEscritura(d.tipo, d.documento, d.comoDueno ?? 'platform').ok, d.tipo).toBe(true);
    });

    it('un fondo sin cotizacion no lleva prima; lo que cotiza si, aunque en la base sea FUND', () => {
        const fondo = mapearDelEmisor(
            universal(emisorDeIshares(), 'fondo'),
            entradas({ serieDeMercado: { ...mercado(() => 100), price_class: 'NAV' } }),
            AHORA
        );
        expect(fondo.documentos.some((d) => d.tipo === TIPO_PRIMA)).toBe(false);
        expect(fondo.ausencias).toEqual([expect.objectContaining({ ruta: 'computed/premium_discount', razon: 'NOT_APPLICABLE' })]);
        expect(fondo.documentos.some((d) => d.tipo === TIPO_DATOS)).toBe(true);

        const monetarioCotizado = mapearDelEmisor(universal(emisorDeIshares(), 'monetario'), entradas(), AHORA);
        expect(monetarioCotizado.documentos.some((d) => d.tipo === TIPO_PRIMA)).toBe(true);
    });

    it('un ETF sin serie de mercado lleva documento, y dice que no la tiene', () => {
        const r = mapearDelEmisor(universal(emisorDeIshares()), entradas({ serieDeMercado: undefined }), AHORA);
        expect(r.documentos.find((d) => d.tipo === TIPO_PRIMA)!.documento).toMatchObject({ status: 'NOT_PUBLISHED', absence_reason: 'NO_MARKET_SERIES' });
    });

    it('una serie dudosa se rechaza entera y lo dice; un vocabulario desconocido deja fuera solo ese dato', () => {
        const dudosa = mapearDelEmisor(
            universal(emisorDeIshares()),
            entradas({ puntosDeVl: [{ fecha: '2026-01-02', vl: 1 }, { fecha: '2026-01-02', vl: 2 }] }),
            AHORA
        );
        expect(dudosa.documentos.some((d) => d.tipo === TIPO_VL)).toBe(false);
        expect(dudosa.avisos.join()).toContain('repetida');
        expect(dudosa.ausencias).toEqual([expect.objectContaining({ ruta: 'issuer_nav' })]);

        const raro = mapearDelEmisor(universal({ ...emisorDeIshares(), replica: { tipo: 'hibrida' } }), entradas(), AHORA);
        const datos = raro.documentos.find((d) => d.tipo === TIPO_DATOS)!.documento;
        expect(datos).not.toHaveProperty('replication');
        expect(raro.avisos.join()).toContain('hibrida');
        expect(datos['costs']).toMatchObject({ ongoing_charge: 0.002 });
    });

    it('no toca los bloques declarados de siempre, y no cuenta en la cobertura', () => {
        const r = mapearDelEmisor(universal(emisorDeIshares()), entradas(), AHORA);
        for (const d of r.documentos) {
            expect(d.ruta).not.toMatch(/declared\/(costs|profile|size|holdings|distributions)$/);
            expect(d.ruta).not.toMatch(/computed\/metrics$/);
        }
        expect(BLOQUES_DE_INSTRUMENTO['declared/issuer_data']).toBe(TIPO_DATOS);
        expect(BLOQUES_DE_INSTRUMENTO['computed/premium_discount']).toBe(TIPO_PRIMA);
        expect(rutasPosiblesDe(ISIN)).toContain(`instruments/${ISIN}/declared/issuer_data`);
        for (const tipo of [TIPO_DATOS, TIPO_PRIMA]) {
            const esquema = cargarEsquemas().find((e) => e.fichero === tipo)!;
            const cuentan = rutasDe(esquema).filter((ruta) => ruta.esHoja && ruta.cuentaCuando !== 'NUNCA');
            expect(cuentan.map((ruta) => ruta.ruta), tipo).toEqual([]);
        }
    });

    it('el contrato de la prima exige cifras si se publica y motivo si no', () => {
        const base = { computed_at: AHORA, method: 'PREMIUM_DISCOUNT_V1', window: '1y' };
        expect(validarForma(TIPO_PRIMA, { ...base, status: 'PUBLISHED' }).ok).toBe(false);
        expect(validarForma(TIPO_PRIMA, { ...base, status: 'NOT_PUBLISHED' }).ok).toBe(false);
        expect(validarForma(TIPO_PRIMA, { ...base, status: 'NOT_PUBLISHED', absence_reason: 'NO_MARKET_SERIES' }).ok).toBe(true);
    });
});

describe('la subida a la nube', () => {
    it('se lleva los datos del emisor desde la decision 53, sin un filtro que los deje fuera', () => {
        const subida = readFileSync(join(__dirname, '..', 'scripts', 'subirALaNube.ts'), 'utf-8');
        expect(subida).not.toMatch(/pendienteDeLasCondicionesDeUso/);
        expect(subida).not.toMatch(/issuer_nav['"`/]\s*\)/);
        /* El unico filtro es el de la cartera completa del emisor (B-79), que nombra sus dos contratos y no toca a estos. */
        expect(subida).toMatch(/const locales = await leerElEmulador\(parte, conCarteraDelEmisor\);/);
        expect(subida).toMatch(/decision 53/);
    });
});
