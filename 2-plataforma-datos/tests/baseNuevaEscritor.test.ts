import { describe, it, expect } from 'vitest';

import {
    BLOQUES_DE_INSTRUMENTO,
    mapearInstrumento,
    plegar,
    rutasPosiblesDe,
    versionDelMetodo,
    type FichaCanonica,
    type RegistroUniversal
} from '../src/ingestion/baseNueva/mapper';
import {
    enRango,
    puedeEscribir,
    rangoDe,
    rutasAjenas,
    validarDueno,
    validarEscritura,
    validarForma
} from '../src/config/baseNueva/validadores';
import { TraduccionDesconocida, traducir, TIPO_PRODUCTO, DOMICILIO } from '../src/ingestion/baseNueva/traducciones';

/**
 * El escritor de plataforma: mapper del canónico a la base nueva, y las dos puertas.
 *
 * Las pruebas de aquí comprueban lo que el dry-run sobre el canónico real no puede: los
 * casos que no están en los datos de hoy pero llegarán, y las reglas que tienen que
 * aguantar cuando lleguen.
 */

const AHORA = '2026-11-01T10:00:00.000Z';
const ISIN = 'IE00BYR8H148';

/** Casi las de IE00B4L5Y983 el 05-11-2026, en fraccion: una a cero, para comprobar que los ceros viajan. */
const CAJA = {
    large_value: 0.242569,
    large_blend: 0.340793,
    large_growth: 0.227598,
    mid_value: 0.055016,
    mid_blend: 0.085421,
    mid_growth: 0.042717,
    small_value: 0.001863,
    small_blend: 0.004022,
    small_growth: 0
};

/** Una ficha canónica mínima pero realista, con la forma que tiene de verdad. */
function ficha(cambios: Record<string, unknown> = {}): FichaCanonica {
    return {
        isin: ISIN,
        name: 'Un Fondo Global de Prueba',
        currency: 'EUR',
        report_date: '2026-09-30',
        generated_at: '2026-10-31T13:32:32+00:00',
        regulatory: {
            domicile: 'LUX',
            legal_framework: 'UCITS',
            launch_date_class: '2015-03-02',
            sfdr_article: '8',
            sri: 4,
            srri: 5,
            management_company: 'Una Gestora',
            kid: {
                date: '2026-10-01',
                url: `https://ejemplo.invalid/kid/${ISIN}.pdf`,
                sha256: 'a'.repeat(64)
            }
        },
        ms: {
            category_morningstar: 'EAA Fund Global Large-Cap Blend Equity',
            report_date: '2026-09-30',
            costs: { ter: 0.53, management_fee: 0.5 },
            portfolio: { as_of: '2026-09-30' },
            sustainability_rating: 3,
            medalist_rating: 'Neutral',
            objective: 'Crecimiento del capital a largo plazo.',
            holdings_stats: { holdings_count_equity: 88, top10_weight: 36.02511 },
            holdings_top10: [{ name: 'Una Empresa', isin: 'US0378331005', weight: 4.5 }],
            fixed_income: {}
        },
        classification_v2: { asset_type: 'equity', official_benchmark: 'Un Indice Global' },
        portfolio_exposure_v2: {
            asset_mix: { equity: 0.95, bond: 0.0, cash: 0.05, other: 0.0 },
            exposure_confidence: 0.9,
            sectors: { tecnologia: 0.3, salud: 0.2 }
        },
        provenance: { version: 'paquete-2026-10-31', fields: { currency: 'morningstar_lt:sal_quote' } },
        ...cambios
    };
}

/** Un registro universal mínimo, con los nombres y las unidades que tiene de verdad. */
function universal(cambios: Record<string, unknown> = {}): RegistroUniversal {
    return {
        _id: ISIN,
        identificacion: {
            tipo_producto: 'fondo',
            clase_activo: 'Equity',
            divisa_base: 'EUR',
            domicilio: 'LUX',
            marco_legal: 'UCITS',
            nombre: 'Un Fondo Global de Prueba',
            categoria_morningstar: 'EAA Fund Global Large-Cap Blend Equity',
            indice_benchmark_oficial: 'Un Indice Global',
            fecha_lanzamiento_clase: '2015-03-02',
            clase_cubierta: false
        },
        riesgo: {
            fecha_dato: '2026-09-30',
            volatilidad_pct: { '3a': { fondo: 12.34, categoria: 11.1, indice: 10.0 } },
            sharpe: { '3a': { fondo: 0.42 } },
            alpha: { '3a': { fondo: 1.5, categoria: -0.31, indice: -1.62 } },
            beta: { '3a': { fondo: 0.98, indice: 0.34 } },
            r2: { '3a': { fondo: 93.04 } },
            max_drawdown: { pct: -5.7359, periodo: '3a' }
        },
        rentabilidad: {
            fecha_dato: '2026-09-30',
            trailing_pct: { '1a': { fondo: -3.0063 }, '3a_anualizada': { fondo: 2.5 }, ytd: { fondo: 1.1 }, '1m': { fondo: 0.2 } }
        },
        costes: { ter_pct: 0.53, comision_gestion_aplicada_pct: 0.5, comision_suscripcion_max_pct: 2.0 },
        valoracion: { patrimonio_fondo_meur: 970.4, patrimonio_divisa: 'EUR', patrimonio_fecha: '2026-10-29' },
        ...cambios
    };
}

/** Busca un documento por su ruta relativa. */
function doc(resultado: ReturnType<typeof mapearInstrumento>, sufijo: string) {
    return resultado.documentos.find((documento) => documento.ruta.endsWith(sufijo));
}

describe('el mapper: del canonico a la base nueva', () => {
    it('mapea un fondo completo y TODO lo que saca pasa las dos puertas', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        expect(resultado.errores).toEqual([]);
        expect(resultado.documentos.length).toBeGreaterThanOrEqual(10);
        for (const documento of resultado.documentos) {
            const veredicto = validarEscritura(documento.tipo, documento.documento, 'platform');
            expect(veredicto.motivos, `${documento.ruta}`).toEqual([]);
            expect(veredicto.ok).toBe(true);
        }
    });

    it.each([
        ['sintetica, como el ETF de bancos de Invesco', 'Synthetic Replication', 'SYNTHETIC', false],
        ['fisica completa', 'Physical Full', 'PHYSICAL_FULL', false],
        ['fisica por muestreo', 'Physical Sample', 'PHYSICAL_SAMPLING', false],
        ['no aplica: se queda ausente (C-17)', 'NOT Applicable', undefined, false],
        ['sin dato', undefined, undefined, false],
        ['un literal nuevo: ausente y anotado, sin parar la ficha', 'Hybrid Replication', undefined, true]
    ])('la replica de Morningstar: %s', (_caso, cruda, esperada, avisa) => {
        const base = universal();
        const conReplica = { ...base, identificacion: { ...(base['identificacion'] as object), replicacion: cruda } } as RegistroUniversal;
        const resultado = mapearInstrumento(ficha(), conReplica, AHORA);
        expect(resultado.errores).toEqual([]);
        const raiz = resultado.documentos.find((d) => d.tipo === 'instrument.v2.schema.json');
        expect((raiz?.documento['product'] as Record<string, unknown>)['replication']).toBe(esperada);
        expect(validarEscritura(raiz!.tipo, raiz!.documento, 'platform').motivos).toEqual([]);
        expect(resultado.avisos.some((aviso) => aviso.includes('replicacion desconocida'))).toBe(avisa);
    });

    it('el contrato no deja escribir una replica fuera de sus tres codigos', () => {
        const raiz = mapearInstrumento(ficha(), universal(), AHORA).documentos.find((d) => d.tipo === 'instrument.v2.schema.json')!;
        const product = { ...(raiz.documento['product'] as object), replication: 'Synthetic Replication' };
        expect(validarForma(raiz.tipo, { ...raiz.documento, product }).ok).toBe(false);
    });

    it.each([
        ['una estrella valida', 4, 4],
        ['sin estrella', null, undefined],
        ['fuera de escala', 6, undefined],
        ['con decimales', 3.5, undefined]
    ])('las estrellas de Morningstar: %s', (_caso, cruda, esperada) => {
        const base = ficha();
        const conEstrella = { ...base, ms: { ...(base as unknown as { ms: object }).ms, rating_stars: cruda } } as unknown as FichaCanonica;
        const resultado = mapearInstrumento(conEstrella, universal(), AHORA);
        const raiz = resultado.documentos.find((d) => d.tipo === 'instrument.v2.schema.json');
        const clasificacion = raiz?.documento['classification'] as Record<string, unknown>;
        expect(clasificacion['morningstar_rating']).toBe(esperada);
        expect(validarEscritura(raiz!.tipo, raiz!.documento, 'platform').motivos).toEqual([]);
        expect(resultado.ausencias.some((a) => a.ruta === 'classification.morningstar_rating')).toBe(esperada === undefined);
    });

    it('convierte los por cientos a FRACCION, que es la conversion que mas veces falta hoy', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        const riesgo = doc(resultado, '/declared/provider_risk')?.documento as Record<string, any>;
        // 12,34 % de volatilidad entra como 0,1234, no como 12,34.
        expect(riesgo['volatility']['3y']['fund']).toBeCloseTo(0.1234, 10);
        // El R2 del 93,04 % entra como 0,9304.
        expect(riesgo['r2']['3y']['vs_benchmark']).toBeCloseTo(0.9304, 10);
        // La beta es un ratio y NO se divide.
        expect(riesgo['beta']['3y']['vs_benchmark']).toBeCloseTo(0.98, 10);
        // El Sharpe tampoco.
        expect(riesgo['sharpe']['3y']['fund']).toBeCloseTo(0.42, 10);
        const costes = doc(resultado, '/declared/costs')?.documento as Record<string, any>;
        expect(costes['ongoing_charge']).toBeCloseTo(0.0053, 10);
    });

    describe('los costes: manda el KID, cifra a cifra (decision 43 de Oscar)', () => {
        const conKid = (costes: Record<string, unknown>, documento: Record<string, unknown> = {}) =>
            ficha({
                regulatory: {
                    sri: 4,
                    srri: 5,
                    kid: { date: '2026-08-19', url: `https://ejemplo.invalid/kid/${ISIN}.pdf`, sha256: 'a'.repeat(64), costs: costes, ...documento }
                }
            });
        const delProveedor = universal({
            costes: {
                ter_pct: 1.81,
                comision_gestion_aplicada_pct: 0.8,
                comision_suscripcion_max_pct: 5.0,
                mifid_emt_exante: { corrientes_pct: 1.0135, transaccion_pct: 0.71205, fecha: '2026-06-30' }
            }
        });
        const costesDe = (resultado: ReturnType<typeof mapearInstrumento>) =>
            doc(resultado, '/declared/costs')?.documento as Record<string, any>;

        it('el coste corriente, la operacion y la entrada salen del KID, con su fecha (BlackRock A2: 1,81 % frente a 1,01 %)', () => {
            const resultado = mapearInstrumento(conKid({ management_and_other_pct: 1.01, transaction_pct: 0.4, entry_pct: 3.0 }), delProveedor, AHORA);
            expect(resultado.errores).toEqual([]);
            const costes = costesDe(resultado);
            expect(costes['ongoing_charge']).toBeCloseTo(0.0101, 10);
            expect(costes['transaction_costs']).toBeCloseTo(0.004, 10);
            expect(costes['entry_charge']).toBeCloseTo(0.03, 10);
            expect(costes['document_date']).toBe('2026-08-19');
            expect(costes['ongoing_charge_source']).toBe('KID');
            expect(costes['transaction_costs_source']).toBe('KID');
            expect(costes['entry_charge_source']).toBe('KID');
            expect(costes['management_fee']).toBeCloseTo(0.008, 10);
        });

        it('es cifra a cifra: un KID que da la entrada solo en euros no la trae, y esa es del proveedor (PIMCO)', () => {
            const costes = costesDe(mapearInstrumento(conKid({ management_and_other_pct: 1.39, transaction_pct: 0.21 }), delProveedor, AHORA));
            expect(costes['ongoing_charge_source']).toBe('KID');
            expect(costes['transaction_costs_source']).toBe('KID');
            expect(costes['entry_charge']).toBeCloseTo(0.05, 10);
            expect(costes['entry_charge_source']).toBe('PROVIDER');
        });

        it('un cero que dice el KID es un cero, aunque el proveedor diga otra cosa (BNY: 0,00 % frente a 5 %)', () => {
            const costes = costesDe(mapearInstrumento(conKid({ management_and_other_pct: 1.39, transaction_pct: 0.0, entry_pct: 0.0 }), delProveedor, AHORA));
            expect(costes['entry_charge']).toBe(0);
            expect(costes['entry_charge_source']).toBe('KID');
            expect(costes['transaction_costs']).toBe(0);
            expect(costes['transaction_costs_source']).toBe('KID');
        });

        it('un coste corriente de cero no se cree: ningun fondo cuesta cero, y era una mala lectura', () => {
            const costes = costesDe(mapearInstrumento(conKid({ management_and_other_pct: 0.0 }), delProveedor, AHORA));
            expect(costes['ongoing_charge']).toBeCloseTo(0.0181, 10);
            expect(costes['ongoing_charge_source']).toBe('PROVIDER');
        });

        it('sin KID, las tres son del proveedor, y lo dicen (iShares)', () => {
            const resultado = mapearInstrumento(ficha({ regulatory: { srri: 6 } }), delProveedor, AHORA);
            const costes = costesDe(resultado);
            expect(costes['ongoing_charge']).toBeCloseTo(0.0181, 10);
            expect(costes['ongoing_charge_source']).toBe('PROVIDER');
            expect(costes['transaction_costs']).toBeCloseTo(0.0071205, 10);
            expect(costes['transaction_costs_source']).toBe('PROVIDER');
            expect(costes['entry_charge_source']).toBe('PROVIDER');
            expect(costes['document_date']).toBeUndefined();
            expect(costes['document_url']).toBeUndefined();
        });

        it('sin documento que citar no es KID, por muchas cifras que traiga', () => {
            const costes = costesDe(
                mapearInstrumento(conKid({ management_and_other_pct: 1.01, transaction_pct: 0.4 }, { url: undefined, sha256: undefined }), delProveedor, AHORA)
            );
            expect(costes['ongoing_charge']).toBeCloseTo(0.0181, 10);
            expect(costes['ongoing_charge_source']).toBe('PROVIDER');
            expect(costes['transaction_costs_source']).toBe('PROVIDER');
        });

        it('una cifra del KID fuera del contrato no entra: cae al proveedor y queda el aviso', () => {
            const resultado = mapearInstrumento(conKid({ management_and_other_pct: 1.01, transaction_pct: 82.0 }), delProveedor, AHORA);
            const costes = costesDe(resultado);
            expect(costes['transaction_costs']).toBeCloseTo(0.0071205, 10);
            expect(costes['transaction_costs_source']).toBe('PROVIDER');
            expect(resultado.avisos.some((aviso) => aviso.startsWith('transaction_costs fuera del rango'))).toBe(true);
        });

        it('un KID sin fecha legible se queda sin fecha: no se le pone otra', () => {
            const costes = costesDe(mapearInstrumento(conKid({ management_and_other_pct: 1.01 }, { date: undefined }), delProveedor, AHORA));
            expect(costes['ongoing_charge_source']).toBe('KID');
            expect(costes['document_date']).toBeUndefined();
        });

        it('lo que sale pasa el contrato', () => {
            const resultado = mapearInstrumento(conKid({ management_and_other_pct: 1.01, transaction_pct: 0.4, entry_pct: 3.0 }), delProveedor, AHORA);
            const documento = doc(resultado, '/declared/costs');
            expect(validarEscritura('instrument-declared-costs.v2.schema.json', documento?.documento, 'platform').ok).toBe(true);
        });
    });

    it('traduce los periodos del canonico a un solo nombre: 3a pasa a 3y', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        const riesgo = doc(resultado, '/declared/provider_risk')?.documento as Record<string, any>;
        expect(Object.keys(riesgo['volatility'])).toEqual(['3y']);
        expect(riesgo['volatility']['3a']).toBeUndefined();
    });

    it('separa de quien es una cifra de contra que se mide', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        const riesgo = doc(resultado, '/declared/provider_risk')?.documento as Record<string, any>;
        // La volatilidad es ABSOLUTA: el sujeto dice de quien es, y entran los tres.
        expect(Object.keys(riesgo['volatility']['3y']).sort()).toEqual(['benchmark', 'category', 'fund']);
        // El alpha es RELATIVO: solo entra la columna cuyo significado se puede nombrar.
        expect(Object.keys(riesgo['provider_alpha']['3y'])).toEqual(['vs_benchmark']);
        // Y las dos que se quedan fuera se CUENTAN, no se tiran calladas.
        expect(resultado.perdidas.filter((p) => p.includes('columna relativa')).length).toBeGreaterThan(0);
    });

    it('la politica de distribucion entra UNKNOWN y queda anotada: no se adivina del nombre', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        const perfil = doc(resultado, '/declared/profile')?.documento as Record<string, any>;
        expect(perfil['distribution_policy']).toBe('UNKNOWN');
        expect(resultado.ausencias.some((a) => a.ruta === 'declared/profile.distribution_policy')).toBe(true);
    });

    it('guarda el nombre del indice pero NO le inventa divisa ni variante', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        const raiz = doc(resultado, `instruments/${ISIN}`)?.documento as Record<string, any>;
        expect(raiz['classification']['official_benchmark']).toEqual({ name: 'Un Indice Global' });
        expect(resultado.ausencias.some((a) => a.ruta.endsWith('official_benchmark.currency'))).toBe(true);
        expect(resultado.ausencias.some((a) => a.ruta.endsWith('official_benchmark.variant'))).toBe(true);
    });

    it('un reparto con las cuatro clases es REPORTED', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        const exposicion = doc(resultado, '/declared/exposure')?.documento as Record<string, any>;
        expect(exposicion['asset_mix_completion']).toBe('REPORTED');
        expect(exposicion['asset_mix']['fixed_income']).toBe(0);
    });

    it('un reparto incompleto que SUMA 1 se completa por aritmetica y lo dice', () => {
        const resultado = mapearInstrumento(
            ficha({
                portfolio_exposure_v2: {
                    asset_mix: { equity: 0.97, cash: 0.03 },
                    exposure_confidence: 0.9
                }
            }),
            universal(),
            AHORA
        );
        const exposicion = doc(resultado, '/declared/exposure')?.documento as Record<string, any>;
        expect(exposicion['asset_mix_completion']).toBe('IMPLIED_BY_SUM');
        expect(exposicion['asset_mix']['fixed_income']).toBe(0);
        expect(exposicion['asset_mix']['other']).toBe(0);
        expect(validarEscritura(doc(resultado, '/declared/exposure')!.tipo, exposicion, 'platform').ok).toBe(true);
    });

    /**
     * El canonico de un fondo que no declara la clase en `identificacion.clase_activo`, asi que
     * la unica que llega es la suplente, `classification_v2.asset_type`. Es el caso real de
     * LU2504555777: las dos ortografias venian a null salvo la suplente, con «other».
     */
    const sinClaseEnElUniversal = (): RegistroUniversal => {
        const registro = universal();
        delete (registro.identificacion as Record<string, unknown>)['clase_activo'];
        return registro;
    };

    it('si el proveedor dice "other" y su propio reparto dice otra cosa, se deduce y se marca', () => {
        /*
         * Medido el 02-11-2026: LU2504555777 llega con `classification_v2.asset_type: "other"`
         * y con su propio reparto declarando 95,6 % de renta variable, reportado y con
         * confianza 0,9. Las dos cosas son del mismo proveedor y se contradicen. Era el unico
         * OTHER de 1.077, y una radiografia de cartera lo pintaba en «otros» siendo renta
         * variable: cada campo defendible por separado y el conjunto enganando.
         */
        const resultado = mapearInstrumento(
            ficha({
                classification_v2: { asset_type: 'other', official_benchmark: 'Un Indice Global' },
                portfolio_exposure_v2: {
                    asset_mix: { equity: 0.955768, bond: 0.004639, cash: 0.039593, other: 0 },
                    exposure_confidence: 0.9
                }
            }),
            sinClaseEnElUniversal(),
            AHORA
        );
        const raiz = doc(resultado, `instruments/${ISIN}`)?.documento as Record<string, any>;
        expect(raiz['classification']['asset_class']).toBe('EQUITY');
        expect(raiz['classification']['asset_class_resolution']).toBe('DERIVED_FROM_ASSET_MIX');
        expect(resultado.avisos.some((a) => a.includes('deducida del reparto'))).toBe(true);
    });

    it('una clase que el proveedor AFIRMA no se corrige con una deduccion nuestra', () => {
        /* La deduccion solo entra desde «other», el cajon de sastre. Si el proveedor dice
           renta fija y su reparto dice renta variable, eso es una discrepancia que hay que
           mirar, no un valor que haya que arreglar por detras. */
        const resultado = mapearInstrumento(
            ficha({
                classification_v2: { asset_type: 'fixed_income', official_benchmark: 'Un Indice Global' },
                portfolio_exposure_v2: {
                    asset_mix: { equity: 1, bond: 0, cash: 0, other: 0 },
                    exposure_confidence: 0.9
                }
            }),
            sinClaseEnElUniversal(),
            AHORA
        );
        const raiz = doc(resultado, `instruments/${ISIN}`)?.documento as Record<string, any>;
        expect(raiz['classification']['asset_class']).toBe('FIXED_INCOME');
        expect(raiz['classification']['asset_class_resolution']).toBe('PROVIDER');
    });

    it('un mixto se deduce MIXTO, y lo que no llega al umbral se queda en OTHER', () => {
        const conMezcla = (mezcla: Record<string, number>) =>
            (
                doc(
                    mapearInstrumento(
                        ficha({
                            classification_v2: { asset_type: 'other', official_benchmark: 'Un Indice Global' },
                            portfolio_exposure_v2: { asset_mix: mezcla, exposure_confidence: 0.9 }
                        }),
                        sinClaseEnElUniversal(),
                        AHORA
                    ),
                    `instruments/${ISIN}`
                )?.documento as Record<string, any>
            )['classification'];

        expect(conMezcla({ equity: 0.6, bond: 0.4, cash: 0, other: 0 })['asset_class']).toBe('ALLOCATION');
        /* 0,75 de renta variable no llega al 0,80 de «ser de una clase», y el resto no es
           renta fija, asi que no hay mixto que declarar: se queda como lo dijo el proveedor. */
        const flojo = conMezcla({ equity: 0.75, bond: 0.05, cash: 0.2, other: 0 });
        expect(flojo['asset_class']).toBe('OTHER');
        expect(flojo['asset_class_resolution']).toBe('PROVIDER');
    });

    it('sin reparto cerrado no se deduce nada: un reparto que no suma 1 no es un reparto', () => {
        const resultado = mapearInstrumento(
            ficha({
                classification_v2: { asset_type: 'other', official_benchmark: 'Un Indice Global' },
                portfolio_exposure_v2: {
                    asset_mix: { equity: 0.8, bond: 0, cash: 0, other: 0 },
                    exposure_confidence: 0.9
                }
            }),
            sinClaseEnElUniversal(),
            AHORA
        );
        const raiz = doc(resultado, `instruments/${ISIN}`)?.documento as Record<string, any>;
        expect(raiz['classification']['asset_class']).toBe('OTHER');
        expect(raiz['classification']['asset_class_resolution']).toBe('PROVIDER');
        expect(doc(resultado, '/declared/exposure')?.documento['asset_mix']).toBeUndefined();
    });

    it('un CENTINELA del canonico no entra como valor: es una ausencia disfrazada', () => {
        // Medido el 01-11 leyendo la base escrita: 90 instrumentos tenian 'Not Benchmarked'
        // y 27 'N/A' en el nombre del indice. El contrato no puede cazarlo —un nombre de
        // indice es texto libre y un centinela es texto libre valido— asi que lo caza el
        // mapper, con la lista del vocabulario.
        for (const centinela of ['Not Benchmarked', 'N/A', 'None', '-', 'unknown']) {
            const resultado = mapearInstrumento(
                ficha({ classification_v2: { asset_type: 'equity', official_benchmark: centinela } }),
                universal({
                    identificacion: {
                        ...(universal()['identificacion'] as Record<string, unknown>),
                        indice_benchmark_oficial: centinela
                    }
                }),
                AHORA
            );
            const raiz = doc(resultado, `instruments/${ISIN}`)!.documento as Record<string, any>;
            expect(raiz['classification']['official_benchmark'], centinela).toBeUndefined();
            expect(resultado.ausencias.some((a) => a.ruta === 'classification.official_benchmark')).toBe(true);
        }
    });

    it('un reparto con las cuatro clases que NO suma 1 tampoco entra', () => {
        // La primera version solo comprobaba la suma cuando FALTABAN clases, y dejo pasar 58
        // repartos de cuatro clases que sumaban entre 0,80 y 0,99. Un reparto que suma 0,80
        // deja sin contar el 20 % del fondo, y cualquier grafico lo normaliza y muestra una
        // composicion que no es la del fondo.
        const resultado = mapearInstrumento(
            ficha({
                portfolio_exposure_v2: {
                    asset_mix: { equity: 0.6, bond: 0.15, cash: 0.05, other: 0.0 },
                    exposure_confidence: 0.9
                }
            }),
            universal(),
            AHORA
        );
        expect(doc(resultado, '/declared/exposure')).toBeUndefined();
        expect(resultado.avisos.some((aviso) => aviso.includes('no suma 1'))).toBe(true);
    });

    describe('el reparto neto del proveedor, si suma 1 (decision A-63 y, desde el 21-11-2026, C-29)', () => {
        const tipo = 'instrument-declared-exposure.v2.schema.json';
        const conMezcla = (mezcla: Record<string, number>) =>
            mapearInstrumento(
                ficha({ portfolio_exposure_v2: { asset_mix: mezcla, exposure_confidence: 0.9, equity_style_box: CAJA } }),
                universal(),
                AHORA
            );
        const exposicionDe = (resultado: ReturnType<typeof conMezcla>) =>
            doc(resultado, '/declared/exposure')?.documento as Record<string, any> | undefined;
        const sinReparto = (resultado: ReturnType<typeof conMezcla>) => {
            expect(exposicionDe(resultado)).toBeUndefined();
            expect(resultado.ausencias.some((a) => a.ruta === 'declared/exposure.asset_mix' && a.razon === 'NOT_PROVIDED')).toBe(true);
        };

        it('Lazard Small Caps: bolsa 100,04 y renta fija -0,08 entran tal cual, y el documento valida', () => {
            // Los numeros de FR0000174310 en el canonico del 05-11-2026: suma 1 y se quedaba sin nada por 0,08 puntos.
            const resultado = conMezcla({ equity: 1.000401, bond: -0.000844, cash: 0.000432, other: 0.000011 });
            const exposicion = exposicionDe(resultado)!;
            expect(exposicion['asset_mix']).toEqual({ equity: 1.000401, fixed_income: -0.000844, cash: 0.000432, other: 0.000011 });
            expect(exposicion['asset_mix_completion']).toBe('REPORTED');
            expect(exposicion['equity_style_box']).toEqual(CAJA);
            expect(validarForma(tipo, exposicion).motivos).toEqual([]);
            expect(resultado.ausencias.some((a) => a.ruta === 'declared/exposure.asset_mix')).toBe(false);
        });

        it('una negativa no se convierte en cero, aunque lo demas sume 1 con la tolerancia', () => {
            // Dunas Valor Prudente: sin bolsa sumaba 1,009946 y hasta el 05-11-2026 entraba con la bolsa a cero.
            const exposicion = exposicionDe(conMezcla({ equity: -0.009946, bond: 0.689525, cash: 0.26446, other: 0.055961 }))!;
            expect(exposicion['asset_mix']).toEqual({ equity: -0.009946, fixed_income: 0.689525, cash: 0.26446, other: 0.055961 });
            expect(exposicion['asset_mix_completion']).toBe('REPORTED');
            expect(validarForma(tipo, exposicion).motivos).toEqual([]);
        });

        it('el limite de la A-63 entra, como entraba: -1 y 101 exactos, y lo que suma 1', () => {
            const exposicion = exposicionDe(conMezcla({ equity: 1.01, bond: 0, cash: -0.01, other: 0 }))!;
            expect(exposicion['asset_mix']['equity']).toBe(1.01);
            expect(exposicion['asset_mix']['cash']).toBe(-0.01);
            expect(validarForma(tipo, exposicion).motivos).toEqual([]);
        });

        it('desde la C-29 tambien lo de mas alla, si suma 1: el reparto neto del proveedor, con su signo', () => {
            const resultado = conMezcla({ equity: 1.0101, bond: 0, cash: -0.0101, other: 0 });
            expect(exposicionDe(resultado)!['asset_mix']).toEqual({ equity: 1.0101, fixed_income: 0, cash: -0.0101, other: 0 });
            expect(resultado.avisos.join(' ')).not.toContain('fuera de rango');
        });

        it('ES0137396000: bolsa 319,8 % y liquidez -242,6 % suman 1 y entran tal cual, y el documento valida', () => {
            // Los numeros del canonico del 17-11-2026: 3,198089 + 0,115421 - 2,425742 + 0,112232 = 1,000000.
            const resultado = conMezcla({ equity: 3.198089, bond: 0.115421, cash: -2.425742, other: 0.112232 });
            const exposicion = exposicionDe(resultado)!;
            expect(exposicion['asset_mix']).toEqual({ equity: 3.198089, fixed_income: 0.115421, cash: -2.425742, other: 0.112232 });
            expect(exposicion['asset_mix_completion']).toBe('REPORTED');
            expect(validarForma(tipo, exposicion).motivos).toEqual([]);
            expect(resultado.ausencias.some((a) => a.ruta === 'declared/exposure.asset_mix')).toBe(false);
        });

        it('una clase neta no completa las que faltan con nada raro: -2,43 y 3,42 suman 1 y las otras dos salen a cero', () => {
            // -2,43 + 3,43 = 1,00: la particion esta cerrada, y bond y other son cero por aritmetica.
            const exposicion = exposicionDe(conMezcla({ equity: 3.43, cash: -2.43 }))!;
            expect(exposicion['asset_mix']).toEqual({ equity: 3.43, cash: -2.43, fixed_income: 0, other: 0 });
            expect(exposicion['asset_mix_completion']).toBe('IMPLIED_BY_SUM');
        });

        it('fuera de los topes (de -5 a 6) no hay reparto, sume lo que sume: es un error de unidades', () => {
            // 60 - 59 = 1, pero un 6.000 % de bolsa no es apalancamiento: es un porcentaje leido como fraccion.
            const por = conMezcla({ equity: 60, bond: 0, cash: -59, other: 0 });
            sinReparto(por);
            expect(por.avisos.join(' ')).toContain('asset_mix con una clase fuera de rango: equity 60, cash -59');
            expect(por.ausencias.find((a) => a.ruta === 'declared/exposure.asset_mix')?.detalle).toContain('de -5 a 6');
            // Los bordes cuentan como dentro: -5 + 6 = 1.
            expect(exposicionDe(conMezcla({ equity: 6, bond: 0, cash: -5, other: 0 }))!['asset_mix']['cash']).toBe(-5);
            sinReparto(conMezcla({ equity: 6.01, bond: 0, cash: -5.01, other: 0 }));
        });

        it('una clase muy fuera que no suma 1 no se toma por no declarada: no hay reparto', () => {
            // Con la regla de antes del 05-11 salia bolsa 0 % en un fondo que dice 150 %.
            sinReparto(conMezcla({ equity: 1.5, bond: 0.99, cash: 0.01, other: 0 }));
            sinReparto(conMezcla({ equity: -2.43, bond: 0.99, cash: 0.01, other: 0 }));
        });

        it('la suma sigue mandando: con las clases dentro, lo que no suma 1 no es un reparto', () => {
            sinReparto(conMezcla({ equity: 1.005, bond: 0.01, cash: 0, other: 0 }));
        });

        it('un reparto neto no deduce la clase de la raiz: un fondo que vende bolsa no es un monetario', () => {
            // ES0139112009 en el canonico del 17-11: bolsa -1,881353, renta fija 0,410258, liquidez 2,463339, otros 0,007756.
            // Si el proveedor lo diera como OTHER, la liquidez del 246 % lo haria CAPITAL_PRESERVATION.
            const resultado = mapearInstrumento(
                ficha({
                    classification_v2: { asset_type: 'other', official_benchmark: 'Un Indice Global' },
                    portfolio_exposure_v2: { asset_mix: { equity: -1.881353, bond: 0.410258, cash: 2.463339, other: 0.007756 }, exposure_confidence: 0.9 }
                }),
                sinClaseEnElUniversal(),
                AHORA
            );
            const raiz = doc(resultado, `instruments/${ISIN}`)?.documento as Record<string, any>;
            expect(raiz['classification']['asset_class']).toBe('OTHER');
            expect(raiz['classification']['asset_class_resolution']).toBe('PROVIDER');
            expect((doc(resultado, '/declared/exposure')?.documento as Record<string, any>)['asset_mix']['equity']).toBe(-1.881353);
        });

        it('y con un reparto neto los mapas de la renta variable siguen la regla de cuando no habia reparto', () => {
            // BLK Systematic (LU1373035234): regiones con Estados Unidos al 448 %. Sin la guarda quedaria un 36 % suelto.
            const resultado = mapearInstrumento(
                ficha({
                    portfolio_exposure_v2: {
                        asset_mix: { equity: 0.003534, bond: 0.467073, cash: 1.336999, other: -0.807606 },
                        equity_regions: { united_states: 4.479336, united_kingdom: 0.191915, middle_east: 0.167587 },
                        sectors: { technology: 0.6, healthcare: 0.4 },
                        exposure_confidence: 0.9
                    }
                }),
                universal(),
                AHORA
            );
            const exposicion = doc(resultado, '/declared/exposure')?.documento as Record<string, any>;
            expect(exposicion['asset_mix']['other']).toBe(-0.807606);
            expect(exposicion).not.toHaveProperty('equity_regions');
            expect(exposicion['sectors']).toEqual({ technology: 0.6, healthcare: 0.4 });
        });

        it('un negativo no hace que aplique lo que no aplica: sin renta fija no se reclama su detalle', () => {
            const resultado = conMezcla({ equity: 1.000401, bond: -0.000844, cash: 0.000432, other: 0.000011 });
            expect(resultado.ausencias.find((a) => a.ruta === 'declared/fixed_income')?.razon).toBe('NOT_APPLICABLE');
            // Y sin renta variable tampoco lleva caja, porque no hay a que peso multiplicarla.
            const sinBolsa = exposicionDe(conMezcla({ equity: -0.009946, bond: 0.689525, cash: 0.26446, other: 0.055961 }))!;
            expect(sinBolsa).not.toHaveProperty('equity_style_box');
        });

        it('la regla vive en el contrato, y es la misma en el bloque y en su copia de la tarjeta', () => {
            for (const clase of ['equity', 'fixed_income', 'cash', 'alternative', 'real_asset', 'other']) {
                expect(rangoDe(tipo, `asset_mix.${clase}`)).toEqual({ minimum: -5, maximum: 6 });
                expect(rangoDe('instrument-read-card.v2.schema.json', `exposure.asset_mix.${clase}`)).toEqual({ minimum: -5, maximum: 6 });
            }
            // Solo el reparto por clase: un sector y la confianza siguen de 0 a 1.
            expect(rangoDe(tipo, 'sectors.*')).toEqual({ minimum: 0, maximum: 1 });
            expect(rangoDe(tipo, 'confidence')).toEqual({ minimum: 0, maximum: 1 });
            expect(rangoDe('instrument-read-card.v2.schema.json', 'exposure.sectors.*')).toEqual({ minimum: 0, maximum: 1 });
        });
    });

    describe('las nueve celdas de la caja de estilo y tamano (decision 51)', () => {
        const conCaja = (caja: unknown, mezcla: Record<string, number> = { equity: 0.95, bond: 0, cash: 0.05, other: 0 }) =>
            mapearInstrumento(
                ficha({ portfolio_exposure_v2: { asset_mix: mezcla, exposure_confidence: 0.9, equity_style_box: caja } }),
                universal(),
                AHORA
            );
        const exposicionDe = (resultado: ReturnType<typeof conCaja>) =>
            doc(resultado, '/declared/exposure')?.documento as Record<string, any>;
        const tipo = 'instrument-declared-exposure.v2.schema.json';

        it('viajan tal cual, ceros incluidos, y el documento valida', () => {
            const resultado = conCaja(CAJA);
            expect(exposicionDe(resultado)['equity_style_box']).toEqual(CAJA);
            expect(validarEscritura(tipo, exposicionDe(resultado), 'platform').ok).toBe(true);
            expect(resultado.ausencias.some((a) => a.ruta.endsWith('equity_style_box'))).toBe(false);
        });

        it('una celda negativa entra: es lo neto de cortos, y las nueve siguen sumando 1', () => {
            const conCortos = { ...CAJA, large_value: 0.3, small_growth: -0.05 };
            const resultado = conCaja(conCortos);
            expect(exposicionDe(resultado)['equity_style_box']['small_growth']).toBe(-0.05);
            expect(validarEscritura(tipo, exposicionDe(resultado), 'platform').ok).toBe(true);
        });

        it('sin las nueve no hay caja, y el resto del bloque se escribe', () => {
            const { mid_blend: _fuera, ...ocho } = CAJA;
            const resultado = conCaja(ocho);
            expect(exposicionDe(resultado)['equity_style_box']).toBeUndefined();
            expect(exposicionDe(resultado)['asset_mix']).toBeDefined();
            expect(resultado.avisos.some((aviso) => aviso.includes('mid_blend'))).toBe(true);
            expect(resultado.ausencias.some((a) => a.ruta === 'declared/exposure.equity_style_box' && a.razon === 'NOT_PROVIDED')).toBe(true);
        });

        it('si no suman 1 no hay caja: no se normaliza', () => {
            const resultado = conCaja({ ...CAJA, large_value: 0.5 });
            expect(exposicionDe(resultado)['equity_style_box']).toBeUndefined();
            expect(resultado.avisos.some((aviso) => aviso.includes('no suma 1'))).toBe(true);
        });

        it('una celda fuera del tope no tira el documento: se queda sin caja y se dice', () => {
            const resultado = conCaja({ ...CAJA, large_value: 30.2, large_blend: -29.4 });
            expect(exposicionDe(resultado)['equity_style_box']).toBeUndefined();
            expect(validarEscritura(tipo, exposicionDe(resultado), 'platform').ok).toBe(true);
            expect(resultado.avisos.some((aviso) => aviso.includes('large_value'))).toBe(true);
        });

        it('sin renta variable no se escribe, porque ahi no aplica (decision 17)', () => {
            const resultado = conCaja(CAJA, { equity: 0, bond: 0.95, cash: 0.05, other: 0 });
            expect(exposicionDe(resultado)['equity_style_box']).toBeUndefined();
            expect(resultado.ausencias.some((a) => a.ruta.endsWith('equity_style_box'))).toBe(false);
        });

        it('el contrato pide las nueve, con sus nombres y dentro del tope', () => {
            const base = exposicionDe(conCaja(CAJA));
            const { mid_blend: _fuera, ...ocho } = CAJA;
            expect(validarForma(tipo, { ...base, equity_style_box: ocho }).ok).toBe(false);
            expect(validarForma(tipo, { ...base, equity_style_box: { ...ocho, gigante_value: 0.1 } }).ok).toBe(false);
            expect(validarForma(tipo, { ...base, equity_style_box: { ...CAJA, large_value: 25.5 } }).ok).toBe(false);
            expect(validarForma(tipo, { ...base, equity_style_box: { ...CAJA, large_value: -25.5 } }).ok).toBe(false);
        });
    });

    it('un reparto que NO suma 1 no se completa con ceros: no hay bloque', () => {
        // Es el caso de 111 fondos del canonico real, con repartos que suman 0,00097 o 0,12.
        const resultado = mapearInstrumento(
            ficha({
                portfolio_exposure_v2: {
                    asset_mix: { equity: 0.1, other: 0.02 },
                    exposure_confidence: 0.9
                }
            }),
            universal(),
            AHORA
        );
        expect(doc(resultado, '/declared/exposure')).toBeUndefined();
        expect(
            resultado.ausencias.some(
                (a) => a.ruta === 'declared/exposure.asset_mix' && (a.detalle ?? '').includes('no suma 1')
            )
        ).toBe(true);
        expect(resultado.avisos.some((aviso) => aviso.includes('no suma 1'))).toBe(true);
    });

    it('un peso NEGATIVO de cartera entra: una posicion corta o un futuro es real', () => {
        const base = ficha();
        const ms = { ...(base['ms'] as Record<string, unknown>) };
        ms['holdings_top10'] = [{ name: 'Euro Buxl Future Dec 26', weight: -5.2917 }];
        const resultado = mapearInstrumento({ ...base, ms }, universal(), AHORA);
        const cartera = doc(resultado, '/declared/holdings')!;
        expect((cartera.documento as Record<string, any>)['top'][0]['weight']).toBeCloseTo(-0.052917, 10);
        expect(validarEscritura(cartera.tipo, cartera.documento, 'platform').ok).toBe(true);
    });

    it('un valor fuera del rango del CONTRATO no se escribe: se deja fuera y se avisa', () => {
        const base = ficha();
        const ms = { ...(base['ms'] as Record<string, unknown>) };
        ms['fixed_income'] = { investment_grade_pct: 105.0, avg_credit_quality: 'A+' };
        const resultado = mapearInstrumento({ ...base, ms }, universal(), AHORA);
        const rf = doc(resultado, '/declared/fixed_income')!;
        expect((rf.documento as Record<string, any>)['investment_grade']).toBeUndefined();
        // Pero el resto del bloque se conserva: no se tira el documento por un campo.
        expect((rf.documento as Record<string, any>)['avg_credit_quality']).toBe('A');
        expect(resultado.avisos.some((aviso) => aviso.includes('investment_grade fuera del rango'))).toBe(true);
        expect(validarEscritura(rf.tipo, rf.documento, 'platform').ok).toBe(true);
    });

    it('la calidad crediticia pierde el matiz de la agencia a proposito: A+ pasa a A', () => {
        const base = ficha();
        const ms = { ...(base['ms'] as Record<string, unknown>) };
        ms['fixed_income'] = { avg_credit_quality: 'BBB-' };
        const resultado = mapearInstrumento({ ...base, ms }, universal(), AHORA);
        expect((doc(resultado, '/declared/fixed_income')!.documento as Record<string, any>)['avg_credit_quality']).toBe(
            'BBB'
        );
    });

    it('una fecha centinela NO entra: 0000-00-00 no es una fecha', () => {
        const resultado = mapearInstrumento(
            ficha(),
            universal({
                identificacion: {
                    ...(universal()['identificacion'] as Record<string, unknown>),
                    fecha_lanzamiento_clase: '0000-00-00'
                }
            }),
            AHORA
        );
        const raiz = doc(resultado, `instruments/${ISIN}`)!.documento as Record<string, any>;
        // La ficha trae una fecha buena como suplente; lo que importa es que el centinela no pasa.
        expect(raiz['product']['inception_date']).toBe('2015-03-02');
        const soloCentinela = mapearInstrumento(
            ficha({ regulatory: { domicile: 'LUX', launch_date_class: '0000-00-00' } }),
            universal({
                identificacion: {
                    ...(universal()['identificacion'] as Record<string, unknown>),
                    fecha_lanzamiento_clase: '0000-00-00'
                }
            }),
            AHORA
        );
        const sinFecha = doc(soloCentinela, `instruments/${ISIN}`)!.documento as Record<string, any>;
        expect(sinFecha['product']['inception_date']).toBeUndefined();
    });

    it('el patrimonio pasa de millones a unidades, y la divisa es un campo', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        const tamano = doc(resultado, '/declared/size')!.documento as Record<string, any>;
        expect(tamano['aum']).toBeCloseTo(970_400_000, 2);
        expect(tamano['currency']).toBe('EUR');
    });

    it('la evidencia del KID declara EN QUE GRADO ata el documento a este ISIN', () => {
        const conIsinEnLaUrl = mapearInstrumento(ficha(), universal(), AHORA);
        const reg = doc(conIsinEnLaUrl, '/declared/regulatory')!.documento as Record<string, any>;
        expect(reg['kid_evidence']['isin_evidence']).toBe('DOCUMENT_URL');
        expect(reg['sri']).toBe(4);

        const base = ficha();
        const regulatory = { ...(base['regulatory'] as Record<string, unknown>) };
        regulatory['kid'] = { date: '2026-10-01', url: 'https://ejemplo.invalid/kid/otro.pdf', sha256: 'b'.repeat(64) };
        const sinAtar = mapearInstrumento({ ...base, regulatory }, universal(), AHORA);
        const reg2 = doc(sinAtar, '/declared/regulatory')!.documento as Record<string, any>;
        expect(reg2['kid_evidence']['isin_evidence']).toBe('NONE');
    });

    it('sin documento detras, el SRI no se escribe aunque el numero este', () => {
        const base = ficha();
        const regulatory = { ...(base['regulatory'] as Record<string, unknown>) };
        delete regulatory['kid'];
        const resultado = mapearInstrumento({ ...base, regulatory }, universal(), AHORA);
        const reg = doc(resultado, '/declared/regulatory')!.documento as Record<string, any>;
        expect(reg['sri']).toBeUndefined();
        expect(reg['srri']).toBe(5);
        expect(
            resultado.ausencias.some(
                (a) => a.ruta === 'declared/regulatory.sri' && (a.detalle ?? '').includes('no hay documento')
            )
        ).toBe(true);
    });

    it('el periodo de mantenimiento del KID va a declared/regulatory, con su evidencia, y valida el contrato', () => {
        const conPlazo = (kid: Record<string, unknown>) => {
            const base = ficha();
            const regulatory = { ...(base['regulatory'] as Record<string, unknown>) };
            regulatory['kid'] = { ...(regulatory['kid'] as Record<string, unknown>), ...kid };
            return mapearInstrumento({ ...base, regulatory }, universal(), AHORA);
        };
        const resultado = conPlazo({ recommended_holding_years: 5 });
        const documento = doc(resultado, '/declared/regulatory')!;
        const reg = documento.documento as Record<string, any>;
        expect(reg['recommended_holding_years']).toBe(5);
        expect(reg['kid_evidence']['document_date']).toBe('2026-10-01');
        expect(validarEscritura(documento.tipo, reg, 'platform').ok).toBe(true);

        /* Puede llevar decimales: un KID de seis meses dice 0,5 años. */
        const medio = doc(conPlazo({ recommended_holding_years: 0.5 }), '/declared/regulatory')!.documento as Record<string, any>;
        expect(medio['recommended_holding_years']).toBe(0.5);

        /* Sin el campo en la ficha, el documento sale igual y sin él: no se inventa. */
        const sinPlazo = doc(mapearInstrumento(ficha(), universal(), AHORA), '/declared/regulatory')!.documento as Record<string, any>;
        expect(sinPlazo).not.toHaveProperty('recommended_holding_years');
    });

    it('el periodo del KID no se escribe sin documento, huella y fecha, y un 0 no es un plazo', () => {
        const base = ficha();
        const regulatory = { ...(base['regulatory'] as Record<string, unknown>) };
        regulatory['kid'] = { url: `https://ejemplo.invalid/kid/${ISIN}.pdf`, sha256: 'a'.repeat(64), recommended_holding_years: 5 };
        const sinFecha = mapearInstrumento({ ...base, regulatory }, universal(), AHORA);
        const reg = doc(sinFecha, '/declared/regulatory')!.documento as Record<string, any>;
        expect(reg).not.toHaveProperty('recommended_holding_years');
        expect(
            sinFecha.ausencias.some(
                (a) => a.ruta === 'declared/regulatory.recommended_holding_years' && (a.detalle ?? '').includes('no hay documento')
            )
        ).toBe(true);

        const conCero = { ...(base['regulatory'] as Record<string, unknown>) };
        conCero['kid'] = { ...(conCero['kid'] as Record<string, unknown>), recommended_holding_years: 0 };
        const cero = mapearInstrumento({ ...base, regulatory: conCero }, universal(), AHORA);
        const regCero = doc(cero, '/declared/regulatory')!.documento as Record<string, any>;
        expect(regCero).not.toHaveProperty('recommended_holding_years');
        expect(regCero['sri']).toBe(4);
        expect(cero.avisos.some((a) => a.includes('recommended_holding_years no es un plazo'))).toBe(true);
    });

    it('el contrato rechaza un plazo de 0 o negativo', () => {
        const valido = { source: 'canonical:fondosdb', as_of: '2026-09-30' };
        expect(validarForma('instrument-declared-regulatory.v2.schema.json', { ...valido, recommended_holding_years: 3 }).ok).toBe(true);
        expect(validarForma('instrument-declared-regulatory.v2.schema.json', { ...valido, recommended_holding_years: 0 }).ok).toBe(false);
        expect(validarForma('instrument-declared-regulatory.v2.schema.json', { ...valido, recommended_holding_years: -1 }).ok).toBe(false);
    });

    it('el medalist rating NO se guarda como calificacion ESG: se cuenta como perdida', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        const esg = doc(resultado, '/declared/sustainability')!.documento as Record<string, any>;
        expect(esg['esg_globes']).toBe(3);
        expect(esg['esg_rating']).toBeUndefined();
        expect(resultado.perdidas.some((p) => p.includes('medalist_rating'))).toBe(true);
    });

    it('las ventanas de trailing que el contrato no declara se cuentan como perdida, y ytd NO', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        const retornos = doc(resultado, '/declared/provider_returns')!.documento as Record<string, any>;
        expect(retornos['ytd_return']['fund']).toBeCloseTo(0.011, 10);
        expect(resultado.perdidas).toContain('rentabilidad.trailing_pct.1m');
        expect(resultado.perdidas.some((p) => p.includes('trailing_pct.ytd'))).toBe(false);
    });

    it('el mapper NO produce nada que no sea suyo: ni computed, ni quality, ni la tarjeta', () => {
        const resultado = mapearInstrumento(ficha(), universal(), AHORA);
        for (const documento of resultado.documentos) {
            expect(documento.ruta).not.toContain('/computed/');
            expect(documento.ruta).not.toContain('/quality/');
            expect(documento.ruta).not.toContain('/read/');
            expect(puedeEscribir(documento.tipo, 'platform'), documento.tipo).toBe(true);
        }
    });

    it('un ISIN que no tiene forma de ISIN para el instrumento entero', () => {
        const resultado = mapearInstrumento(ficha({ isin: 'NO-ES-UN-ISIN' }), universal({ _id: 'NO-ES-UN-ISIN' }), AHORA);
        expect(resultado.documentos).toEqual([]);
        expect(resultado.errores.length).toBe(1);
    });

    it('sin divisa utilizable para el instrumento entero, no sale con una por defecto', () => {
        const resultado = mapearInstrumento(
            ficha({ currency: undefined }),
            universal({ identificacion: { tipo_producto: 'fondo', clase_activo: 'Equity', nombre: 'X' } }),
            AHORA
        );
        expect(resultado.documentos).toEqual([]);
        expect(resultado.errores[0]).toContain('divisa');
    });

    it('plegar quita diacriticos y baja a minusculas, para la busqueda por subcadena', () => {
        expect(plegar('Fondo Ibérico de Acciones')).toBe('fondo iberico de acciones');
    });
});

describe('las traducciones: exhaustivas y sin valor por defecto', () => {
    it('un tipo de producto desconocido para, no cae en OTHER', () => {
        expect(() => traducir(TIPO_PRODUCTO, 'tipo_producto', 'criptofondo')).toThrow(TraduccionDesconocida);
        expect(() => traducir(TIPO_PRODUCTO, 'tipo_producto', undefined)).toThrow(TraduccionDesconocida);
    });

    it('un domicilio desconocido no se recorta a dos letras', () => {
        expect(traducir(DOMICILIO, 'domicilio', 'LUX')).toBe('LU');
        expect(traducir(DOMICILIO, 'domicilio', 'USA')).toBe('US');
        expect(() => traducir(DOMICILIO, 'domicilio', 'CHE')).toThrow(TraduccionDesconocida);
    });

    it('un ETC no es un ETF, y se dice', () => {
        expect(traducir(TIPO_PRODUCTO, 'tipo_producto', 'etc')).toBe('OTHER');
        expect(traducir(TIPO_PRODUCTO, 'tipo_producto', 'etf')).toBe('ETF');
    });
});

describe('las dos puertas de escritura', () => {
    it('la forma: un documento con una ruta no declarada no pasa', () => {
        const bueno = {
            instrument_id: ISIN,
            instrument_type: 'FUND',
            schema_version: 'base-nueva.instrument.v2',
            updated_at: AHORA,
            identity: { name: 'X', name_folded: 'x', currency: 'EUR' },
            classification: { category: 'Y', asset_class: 'EQUITY' }
        };
        expect(validarForma('instrument.v2.schema.json', bueno).ok).toBe(true);
        expect(validarForma('instrument.v2.schema.json', { ...bueno, volatilidad_3a: 0.12 }).ok).toBe(false);
    });

    it('el dueno: la plataforma no puede escribir lo que es del lote', () => {
        expect(puedeEscribir('instrument-computed-metrics.v2.schema.json', 'platform')).toBe(false);
        expect(puedeEscribir('instrument-computed-metrics.v2.schema.json', 'batch')).toBe(true);
        expect(puedeEscribir('instrument.v2.schema.json', 'platform')).toBe(true);
        expect(validarDueno('instrument-read-card.v2.schema.json', {}, 'platform').ok).toBe(false);
    });

    it('el dueno: la plataforma no puede tocar las decisiones humanas de un bloque suyo', () => {
        // Es el caso que lo justifica: las retrocesiones acordadas viven en _overrides, con
        // dueno human, dentro de un documento de la plataforma. Una pasada que no lo sepa
        // las borra en silencio.
        expect(rutasAjenas('instrument-declared-costs.v2.schema.json', 'platform')).toContain('_overrides');
        const conOverride = {
            source: 'canonical:fondosdb',
            as_of: '2026-09-30',
            ongoing_charge: 0.0053,
            _overrides: {
                ongoing_charge: {
                    value: 0.0057,
                    decided_by: 'alguien',
                    decided_at: AHORA,
                    reason: 'retrocesion acordada'
                }
            }
        };
        const veredicto = validarEscritura('instrument-declared-costs.v2.schema.json', conOverride, 'platform');
        expect(veredicto.ok).toBe(false);
        expect(veredicto.motivos.some((motivo) => motivo.includes('_overrides'))).toBe(true);
        // El mismo documento sin la decision humana sí pasa.
        const { _overrides: _fuera, ...sinOverride } = conOverride;
        expect(validarEscritura('instrument-declared-costs.v2.schema.json', sinOverride, 'platform').ok).toBe(true);
    });

    it('un tipo que no existe no pasa ninguna de las dos puertas', () => {
        expect(validarForma('inventado.v9.schema.json', {}).ok).toBe(false);
        expect(validarDueno('inventado.v9.schema.json', {}, 'platform').ok).toBe(false);
    });

    it('el rango lo manda el contrato, y el mapper lo lee de ahi', () => {
        const rango = rangoDe('instrument-declared-costs.v2.schema.json', 'ongoing_charge');
        expect(rango).toEqual({ minimum: 0, maximum: 0.2 });
        expect(enRango('instrument-declared-costs.v2.schema.json', 'ongoing_charge', 0.0053)).toBe(true);
        expect(enRango('instrument-declared-costs.v2.schema.json', 'ongoing_charge', -0.0001)).toBe(false);
        // Una ruta sin rango declarado no restringe nada.
        expect(enRango('instrument.v2.schema.json', 'identity.name', 42)).toBe(true);
    });
});

describe('el mapper: el bloque de repartos', () => {
    const PAGOS = {
        historial_consultado: true,
        divisa: 'EUR',
        yield_12m_pct: 2.51509,
        historial: [
            { fecha: '2025-03-07', importe_por_participacion: 1.0, vl_en_la_fecha: 48.31, renta: 1.0 },
            { fecha: '2026-03-06', importe_por_participacion: 1.25, vl_en_la_fecha: 49.54, renta: 1.25 }
        ]
    };

    it('publica los pagos, y el documento pasa las dos puertas', () => {
        const r = mapearInstrumento(ficha(), universal({ distribuciones: PAGOS }), AHORA);
        const bloque = doc(r, '/declared/distributions')?.documento as Record<string, any>;
        expect(bloque['records_checked']).toBe(true);
        expect(bloque['currency']).toBe('EUR');
        expect(bloque['payments']).toHaveLength(2);
        expect(bloque['payments'][1]).toEqual({
            date: '2026-03-06',
            amount_per_share: 1.25,
            nav_on_date: 49.54,
            income: 1.25
        });
        const veredicto = validarEscritura(
            'instrument-declared-distributions.v2.schema.json',
            bloque,
            'platform'
        );
        expect(veredicto.motivos).toEqual([]);
    });

    it('el rendimiento entra en FRACCION, no en por ciento', () => {
        const r = mapearInstrumento(ficha(), universal({ distribuciones: PAGOS }), AHORA);
        const bloque = doc(r, '/declared/distributions')?.documento as Record<string, any>;
        expect(bloque['yield_12m']).toBeCloseTo(0.0251509, 10);
    });

    it('un pago sin fecha o sin importe no entra, y se cuenta', () => {
        const r = mapearInstrumento(
            ficha(),
            universal({
                distribuciones: {
                    historial_consultado: true,
                    divisa: 'EUR',
                    historial: [
                        { importe_por_participacion: 1.0 },
                        { fecha: '2026-03-06' },
                        { fecha: '2026-04-06', importe_por_participacion: 0.5 }
                    ]
                }
            }),
            AHORA
        );
        const bloque = doc(r, '/declared/distributions')?.documento as Record<string, any>;
        expect(bloque['payments']).toHaveLength(1);
        expect(r.avisos.some((a) => a.includes('sin fecha o sin importe'))).toBe(true);
    });

    it('pagos con importe y sin divisa: fuera los pagos, no el bloque', () => {
        // Un importe sin divisa no es un importe, y el contrato lo rechaza. Tirar el
        // documento entero por eso perderia la marca de consultado, que si vale.
        const r = mapearInstrumento(
            ficha(),
            universal({
                distribuciones: {
                    historial_consultado: true,
                    historial: [{ fecha: '2026-03-06', importe_por_participacion: 1.25 }]
                }
            }),
            AHORA
        );
        const bloque = doc(r, '/declared/distributions')?.documento as Record<string, any>;
        expect(bloque['payments']).toBeUndefined();
        expect(bloque['records_checked']).toBe(true);
        expect(r.avisos.some((a) => a.includes('sin divisa'))).toBe(true);
        expect(
            validarEscritura('instrument-declared-distributions.v2.schema.json', bloque, 'platform').ok
        ).toBe(true);
    });

    it('sin la marca de consultado, records_checked es false y el rendimiento SE PUBLICA', () => {
        // Es el caso de 765 de las 843 clases antes de la pasada del 01-11: traen
        // rendimiento y no traen marca. Exigir la marca dejaria ese dato sin publicar.
        const r = mapearInstrumento(
            ficha(),
            universal({ distribuciones: { yield_12m_pct: 3.05 } }),
            AHORA
        );
        const bloque = doc(r, '/declared/distributions')?.documento as Record<string, any>;
        expect(bloque['records_checked']).toBe(false);
        expect(bloque['yield_12m']).toBeCloseTo(0.0305, 10);
        expect(bloque['payments']).toBeUndefined();
    });

    it('sin nada de reparto no hay bloque, y la ausencia dice que falta la PASADA', () => {
        const r = mapearInstrumento(ficha(), universal(), AHORA);
        expect(doc(r, '/declared/distributions')).toBeUndefined();
        const ausencia = r.ausencias.find((a) => a.ruta === 'declared/distributions');
        expect(ausencia?.razon).toBe('NOT_YET_FETCHED');
    });

    it('los pagos resuelven la politica del perfil con su grado, sin mirar el nombre', () => {
        const r = mapearInstrumento(ficha(), universal({ distribuciones: PAGOS }), AHORA);
        const perfil = doc(r, '/declared/profile')?.documento as Record<string, any>;
        expect(perfil['distribution_policy']).toBe('DISTRIBUTING');
        expect(perfil['distribution_policy_resolution']).toBe('PROVIDER_DISTRIBUTION_RECORDS');
    });

    it('la marca sola, sin pagos, resuelve ACUMULACION con el grado mas debil', () => {
        const r = mapearInstrumento(
            ficha(),
            universal({ distribuciones: { historial_consultado: true } }),
            AHORA
        );
        const perfil = doc(r, '/declared/profile')?.documento as Record<string, any>;
        expect(perfil['distribution_policy']).toBe('ACCUMULATING');
        expect(perfil['distribution_policy_resolution']).toBe('PROVIDER_NO_RECORDS');
    });

    it('el bloque esta en el registro, asi que el escritor lo cuenta como ruta posible', () => {
        expect(BLOQUES_DE_INSTRUMENTO['declared/distributions']).toBe(
            'instrument-declared-distributions.v2.schema.json'
        );
        expect(rutasPosiblesDe(ISIN)).toContain(`instruments/${ISIN}/declared/distributions`);
    });
});

describe('el mapper: de quien es cada cifra', () => {
    /**
     * El defecto que esto arregla: 469 fondos tenian metricas calculadas por NOSOTROS
     * archivadas en `declared/provider_risk`, un bloque cuyo nombre dice que son del
     * proveedor. Las dos llegan en el mismo campo del canonico y solo la procedencia las
     * distingue.
     */
    const NUESTRA = {
        meta: {
            procedencia: {
                'riesgo.volatilidad_pct.3a.fondo': 'vl_eodhd:estr',
                'riesgo.sharpe.3a.fondo': 'vl_eodhd:estr',
                'riesgo.fecha_dato': 'vl_eodhd:eod'
            },
            contraste: {
                'riesgo.volatilidad_pct.3a.fondo': {
                    fuente: 'morningstar_lt:sal_riskVolatility',
                    valor: 5.578,
                    desplazada_por: 'vl_eodhd'
                },
                'riesgo.fecha_dato': {
                    fuente: 'morningstar_lt:sal_riskVolatility',
                    valor: '2026-08-31',
                    desplazada_por: 'vl_eodhd'
                }
            }
        }
    };
    const SERIE = {
        historial_precios: {
            source_listing_id: 'EODHD:LU0000000000.EUFUND',
            divisa_metricas: 'EUR',
            rf_referencia: 'ESTR_EUR',
            observations_count: 36,
            first_date: '2023-10-31',
            last_date: '2026-09-30'
        }
    };

    /** Un fondo cuyas metricas son nuestras y que SI tiene derecho a calcularlas. */
    function conDerecho(): RegistroUniversal {
        const u = universal(NUESTRA) as Record<string, unknown>;
        u['riesgo'] = { ...(u['riesgo'] as Record<string, unknown>), ...SERIE };
        u['identificacion'] = {
            ...(u['identificacion'] as Record<string, unknown>),
            politica_distribucion: 'acumulacion'
        };
        return u as RegistroUniversal;
    }

    /**
     * Las ventanas de la caida maxima y el Sortino, que hasta el 02-11-2026 no llegaban.
     *
     * El contrato declara las dos magnitudes a cuatro ventanas. La caida maxima se
     * calculaba en tres desde el principio y el canonico publicaba UNA sola, la mejor
     * disponible, en el escalar `riesgo.max_drawdown.pct` con su `periodo` suelto: medido
     * sobre la base, 625 instrumentos la tenian a tres anos, 290 a cinco y NINGUNO a uno.
     * El Sortino no lo calculaba nadie. Las dos pasan ahora por el mismo recorrido
     * generico que la volatilidad y el Sharpe, asi que anadir una metrica por ventana ya
     * no es inventar un camino.
     */
    function conVentanas(): RegistroUniversal {
        const u = conDerecho() as Record<string, unknown>;
        u['riesgo'] = {
            ...(u['riesgo'] as Record<string, unknown>),
            max_drawdown_pct: {
                '1a': { fondo: -14.1635 },
                '3a': { fondo: -26.6365 },
                '5a': { fondo: -32.0462 }
            },
            sortino: { '1a': { fondo: 0.31 }, '3a': { fondo: 0.77 } }
        };
        const meta = u['meta'] as Record<string, unknown>;
        u['meta'] = {
            ...meta,
            procedencia: {
                ...(meta['procedencia'] as Record<string, string>),
                'riesgo.max_drawdown_pct.1a.fondo': 'vl_eodhd:eod',
                'riesgo.max_drawdown_pct.3a.fondo': 'vl_eodhd:eod',
                'riesgo.max_drawdown_pct.5a.fondo': 'vl_eodhd:eod',
                'riesgo.sortino.1a.fondo': 'vl_eodhd:estr',
                'riesgo.sortino.3a.fondo': 'vl_eodhd:estr'
            }
        };
        return u as RegistroUniversal;
    }

    it('la caida maxima entra en TODAS sus ventanas, no solo en la mejor', () => {
        const r = mapearInstrumento(ficha(), conVentanas(), AHORA);
        const m = doc(r, '/computed/metrics')?.documento as Record<string, any>;
        expect(Object.keys(m['max_drawdown']).sort()).toEqual(['1y', '3y', '5y']);
        // En fraccion, con su signo: una caida es negativa y no se vuelve positiva.
        expect(m['max_drawdown']['1y']).toBeCloseTo(-0.141635, 10);
        expect(m['max_drawdown']['5y']).toBeCloseTo(-0.320462, 10);
    });

    it('el Sortino es un RATIO y no se divide por cien, como el Sharpe', () => {
        const r = mapearInstrumento(ficha(), conVentanas(), AHORA);
        const m = doc(r, '/computed/metrics')?.documento as Record<string, any>;
        expect(m['sortino']['3y']).toBeCloseTo(0.77, 10);
        expect(m['sortino']['5y']).toBeUndefined();
    });

    it('el escalar de siempre sigue sirviendo a un canonico viejo', () => {
        /* Un canonico generado antes del 02-11-2026 no trae `max_drawdown_pct`: trae el
           escalar con su periodo suelto. Esa unica ventana tiene que seguir llegando, y por
           eso el respaldo existe. Y como cualquier otra cifra nuestra, solo cuenta si la
           procedencia dice que es nuestra. */
        const u = conDerecho() as Record<string, unknown>;
        const meta = u['meta'] as Record<string, unknown>;
        u['meta'] = {
            ...meta,
            procedencia: {
                ...(meta['procedencia'] as Record<string, string>),
                'riesgo.max_drawdown.pct': 'vl_eodhd:eod'
            }
        };
        const r = mapearInstrumento(ficha(), u as RegistroUniversal, AHORA);
        const m = doc(r, '/computed/metrics')?.documento as Record<string, any>;
        expect(Object.keys(m['max_drawdown'])).toEqual(['3y']);
        expect(m['max_drawdown']['3y']).toBeCloseTo(-0.057359, 10);
        expect(m['sortino']).toBeUndefined();
    });

    it('un Sortino que el contrato no admite se queda fuera, y no tumba el documento', () => {
        /* Un Sortino de 23 existe: una serie casi monotona deja una desviacion a la baja
           minuscula y el cociente se dispara. El contrato topa los ratios en 20. Lo que NO
           puede pasar es que ese instrumento pierda tambien su volatilidad y su Sharpe, que
           estan bien, porque el documento entero se caiga en la puerta de forma. Y tampoco
           se recorta a 20: eso seria publicar una cifra que no calculamos. */
        const u = conVentanas() as Record<string, unknown>;
        u['riesgo'] = {
            ...(u['riesgo'] as Record<string, unknown>),
            sortino: { '1a': { fondo: 23.4 }, '3a': { fondo: 0.77 } }
        };
        const r = mapearInstrumento(ficha(), u as RegistroUniversal, AHORA);
        const d = r.documentos.find((x) => x.ruta.endsWith('/computed/metrics'))!;
        const m = d.documento as Record<string, any>;
        expect(Object.keys(m['sortino'])).toEqual(['3y']);
        expect(m['volatility']['3y']).toBeCloseTo(0.1234, 10);
        expect(validarEscritura(d.tipo, d.documento, 'batch').motivos).toEqual([]);
        expect(r.avisos).toContain('sortino.1y fuera del rango del contrato: 23.4');
        /* Y desde la decision B-73 el documento dice que la aparto y por que. */
        expect(m['out_of_range']).toEqual({ sortino: { '1y': { value: 23.4, limit: 20 } } });
    });

    it('nuestra cifra va a computed/metrics, no al bloque del proveedor', () => {
        const r = mapearInstrumento(ficha(), conDerecho(), AHORA);
        const propias = doc(r, '/computed/metrics')?.documento as Record<string, any>;
        expect(propias['volatility']['3y']).toBeCloseTo(0.1234, 10);
        expect(propias['method']).toBe('EXTRACTOR_MONTHLY_V2');
        expect(propias['frequency']).toBe('MONTHLY');
        expect(propias['inputs']['series_id']).toBe('EODHD:LU0000000000.EUFUND');
        expect(propias['inputs']['currency']).toBe('EUR');
        expect(propias['inputs']['distribution_policy_resolution']).toBe('OFFICIAL_REGISTER');
        expect(propias['inputs']['observations']).toBe(36);
    });

    it('la version del metodo la dice la ficha, y sin sello de la 3 es la 2 (A-158)', () => {
        /* Hasta la version 2 el identificador era una constante de aqui. Con una version nueva eso
           publicaria como V3 una ficha que nadie ha recalculado: la etiqueta sale del sello que el
           extractor deja en `riesgo.historial_precios.metodo`, y el contrato acepta las dos. */
        const metricasCon = (sello?: string): Record<string, any> => {
            const u = conDerecho() as Record<string, any>;
            if (sello !== undefined) {
                u['riesgo'] = { ...u['riesgo'], historial_precios: { ...u['riesgo']['historial_precios'], metodo: sello } };
            }
            const d = doc(mapearInstrumento(ficha(), u as RegistroUniversal, AHORA), '/computed/metrics')!;
            expect(validarEscritura(d.tipo, d.documento, 'batch').motivos).toEqual([]);
            return d.documento as Record<string, any>;
        };
        const detalle = 'cierre de mes, en euros, riesgo con rentabilidades mensuales';
        expect(metricasCon(`core.metricas v3: ${detalle}`)['method']).toBe('EXTRACTOR_MONTHLY_V3');
        /* La version 4 (MET-6 y MET-7, 17-11-2026): con su sello es V4, y el contrato la admite. */
        expect(metricasCon(`core.metricas v4: ${detalle}`)['method']).toBe('EXTRACTOR_MONTHLY_V4');
        expect(metricasCon(`core.metricas v2: ${detalle}`)['method']).toBe('EXTRACTOR_MONTHLY_V2');
        expect(metricasCon()['method']).toBe('EXTRACTOR_MONTHLY_V2');
        expect(metricasCon(`core.metricas v3: ${detalle}`)['frequency']).toBe('MONTHLY');
    });

    it('el sello se lee entero: ni un texto parecido ni un numero suelto suben la version', () => {
        expect(versionDelMetodo('core.metricas v3: cierre de mes')).toBe(3);
        expect(versionDelMetodo('core.metricas v4: cierre de mes')).toBe(4);
        /* Una version que aun no existe se lee como la ultima conocida: el contrato no admitiria otra. */
        expect(versionDelMetodo('core.metricas v5: lo que venga')).toBe(4);
        expect(versionDelMetodo('core.metricas v2: cierre de mes, en euros')).toBe(2);
        expect(versionDelMetodo('core.metricas v1')).toBe(2);
        expect(versionDelMetodo('metricas v3')).toBe(2);
        expect(versionDelMetodo('otra cosa con core.metricas v3 dentro')).toBe(2);
        expect(versionDelMetodo(undefined)).toBe(2);
        expect(versionDelMetodo(3)).toBe(2);
    });

    it('en computed/metrics una cifra es un NUMERO, no un mapa de sujetos', () => {
        // Es la cifra de ESTE instrumento: no hay categoria ni indice que declarar.
        const r = mapearInstrumento(ficha(), conDerecho(), AHORA);
        const propias = doc(r, '/computed/metrics')?.documento as Record<string, any>;
        expect(typeof propias['volatility']['3y']).toBe('number');
        const prov = doc(r, '/declared/provider_risk')?.documento as Record<string, any>;
        expect(typeof prov['volatility']['3y']).toBe('object');
    });

    it('se escribe como BATCH, porque lo calculo un lote aunque lo traiga la plataforma', () => {
        // La salida facil era poner x-owner platform en el contrato. Seria mentir sobre
        // quien calculo la cifra para que pasara la puerta.
        const r = mapearInstrumento(ficha(), conDerecho(), AHORA);
        const d = r.documentos.find((x) => x.ruta.endsWith('/computed/metrics'));
        expect(d?.comoDueno).toBe('batch');
        expect(validarEscritura(d!.tipo, d!.documento, 'batch').motivos).toEqual([]);
        expect(validarEscritura(d!.tipo, d!.documento, 'platform').ok).toBe(false);
    });

    it('la cifra del proveedor que la nuestra desplazo VUELVE a su bloque', () => {
        // Sin esto, exigir evidencia dejaba 452 fondos sin volatilidad de nadie.
        const r = mapearInstrumento(ficha(), conDerecho(), AHORA);
        const prov = doc(r, '/declared/provider_risk')?.documento as Record<string, any>;
        expect(prov['volatility']['3y']['fund']).toBeCloseTo(0.05578, 10);
        // Y NO la nuestra, que es 12,34 %.
        expect(prov['volatility']['3y']['fund']).not.toBeCloseTo(0.1234, 5);
    });

    it('el bloque del proveedor lleva la fecha DEL PROVEEDOR, no la de nuestro calculo', () => {
        const r = mapearInstrumento(ficha(), conDerecho(), AHORA);
        const prov = doc(r, '/declared/provider_risk')?.documento as Record<string, any>;
        expect(prov['as_of']).toBe('2026-08-31');
    });

    it('sin evidencia de la politica NO hay metrica propia, y se dice por que', () => {
        // El canonico trae nuestra cifra, pero la politica se apoyaba en el nombre de la
        // clase. 449 fondos caen aqui.
        const u = conDerecho() as Record<string, unknown>;
        u['identificacion'] = { ...(u['identificacion'] as Record<string, unknown>) };
        delete (u['identificacion'] as Record<string, unknown>)['politica_distribucion'];
        const r = mapearInstrumento(ficha(), u as RegistroUniversal, AHORA);
        expect(doc(r, '/computed/metrics')).toBeUndefined();
        const a = r.ausencias.find((x) => x.ruta === 'computed/metrics');
        expect(a?.razon).toBe('NOT_APPLICABLE');
        expect(a?.detalle).toContain('no hay derecho a calcular');
        // Pero la del proveedor sigue ahi, con su nombre.
        const prov = doc(r, '/declared/provider_risk')?.documento as Record<string, any>;
        expect(prov['volatility']['3y']['fund']).toBeCloseTo(0.05578, 10);
    });

    it('sin cifras propias de ningun tipo, la ausencia NO promete que la fuente lo tenga', () => {
        /*
         * Esta prueba exigia `NOT_YET_FETCHED` hasta el 03-11-2026, y su nombre decia por que:
         * la idea era «falta el almacen analitico». Pero esa razon no dice eso. Su glosa es
         * «la fuente lo tiene y todavia no lo hemos traido»: afirma algo sobre la FUENTE.
         *
         * Medido ese dia: con el defecto que esta prueba fijaba, la razon era falsa en 137 de
         * los 149 instrumentos sin metricas. La intencion era correcta y el vocabulario, no.
         * Ahora la razon sale del motivo que dejo el extractor —aqui, una serie que la fuente
         * no entrego— y `NOT_YET_FETCHED` queda para el unico grupo donde es verdad: las clases
         * que se pararon por su nombre, cuya politica consta en su KID.
         */
        const r = mapearInstrumento(ficha(), universal(), AHORA);
        expect(doc(r, '/computed/metrics')).toBeUndefined();
        const a = r.ausencias.find((x) => x.ruta === 'computed/metrics');
        expect(a?.razon).toBe('NOT_PROVIDED');
        expect(a?.detalle).toContain('serie');
    });

    it('la rentabilidad por anio natural se CUENTA como perdida, ya no desaparece', () => {
        const porAnio: Record<string, unknown> = {};
        porAnio['2024'] = { fondo: 8.4 };
        porAnio['2025'] = { fondo: 4.5 };
        const rent: Record<string, unknown> = { fecha_dato: '2026-09-30' };
        rent[['por', 'año', 'natural'].join('_')] = porAnio;
        const r = mapearInstrumento(ficha(), universal({ rentabilidad: rent }), AHORA);
        expect(r.perdidas.some((p) => p.includes('natural') && p.includes('2 a'))).toBe(true);
    });
});

describe('el contrato de las metricas propias', () => {
    const TIPO = 'instrument-computed-metrics.v2.schema.json';
    const base = {
        computed_at: '2026-10-29',
        method: 'EXTRACTOR_MONTHLY_V2',
        frequency: 'MONTHLY',
        return_basis: 'TOTAL_RETURN'
    };
    const inputs = {
        series_id: 'EODHD:X.EUFUND',
        currency: 'EUR',
        distribution_policy_resolution: 'OFFICIAL_REGISTER'
    };

    it('sin el grado de evidencia NO se puede escribir: es la barrera, no un consejo', () => {
        const sinGrado = validarForma(TIPO, {
            ...base,
            inputs: { series_id: inputs.series_id, currency: 'EUR' }
        });
        expect(sinGrado.ok).toBe(false);
        expect(sinGrado.motivos.join(' ')).toContain('distribution_policy_resolution');
        expect(validarForma(TIPO, { ...base, inputs }).ok).toBe(true);
    });

    it('un grado inventado tampoco: la lista es la misma que la del perfil', () => {
        const malo = { ...inputs, distribution_policy_resolution: 'NOMBRE_DE_LA_CLASE' };
        expect(validarForma(TIPO, { ...base, inputs: malo }).ok).toBe(false);
    });

    it('la divisa NO es siempre el euro: 14 fondos calculan en USD', () => {
        // Era `const EUR` con la explicacion de que la serie se convierte antes de
        // calcular. Nadie convierte: el extractor calcula en la divisa de la clase.
        expect(validarForma(TIPO, { ...base, inputs: { ...inputs, currency: 'USD' } }).ok).toBe(true);
        expect(validarForma(TIPO, { ...base, inputs: { ...inputs, currency: 'euros' } }).ok).toBe(false);
    });

    it('el metodo del extractor es un valor NOMBRADO, no texto libre', () => {
        expect(validarForma(TIPO, { ...base, inputs }).ok).toBe(true);
        expect(validarForma(TIPO, { ...base, method: 'GEOMETRIC_CAGR', inputs }).ok).toBe(true);
        expect(validarForma(TIPO, { ...base, method: 'core.metricas v1', inputs }).ok).toBe(false);
    });

    it('el tipo libre de riesgo puede faltar: sin euros no hay Sharpe que calcular', () => {
        // Exigirlo tiraba la volatilidad y la caida maxima de 13 fondos por no tener Sharpe.
        expect(validarForma(TIPO, { ...base, inputs: { ...inputs, currency: 'USD' } }).ok).toBe(true);
    });
});

describe('una conversion de divisa no puede esconderse', () => {
    const TIPO = 'instrument-computed-metrics.v2.schema.json';
    const base = {
        computed_at: '2026-10-29',
        method: 'EXTRACTOR_MONTHLY_V2',
        frequency: 'MONTHLY',
        return_basis: 'TOTAL_RETURN'
    };
    const inputs = {
        series_id: 'EODHD:X.EUFUND',
        currency: 'EUR',
        distribution_policy_resolution: 'OFFICIAL_REGISTER'
    };

    /**
     * La regla: si `currency` y `source_currency` no coinciden, hubo conversion y
     * `fx_source` es obligatorio.
     *
     * El esquema NO puede expresarla, porque JSON Schema no compara dos campos entre si.
     * Asi que la sostiene esta prueba, igual que la allowlist de proyecto la sostiene una
     * prueba y no la disciplina.
     *
     * Lo que tapa, medido el 01-11-2026: de los 19.278 cubos de serie de la maestra, 2.971
     * estan convertidos a euros SIN el tipo del BCE, en 34 instrumentos. Hoy no afecta a
     * ninguna metrica propia —los 19 que las reciben son los del registro frances, con serie
     * y calculo en EUR, asi que no hay conversion: comprobado, cero solapamiento— pero el dia
     * que el almacen analitico calcule sobre esos cubos, omitir `fx_source` haria que una
     * metrica convertida a mano pareciera una metrica sin convertir.
     */
    const cumpleLaRegla = (ins: Record<string, unknown>): boolean => {
        const origen = ins['source_currency'];
        if (typeof origen !== 'string' || origen === ins['currency']) return true;
        return ins['fx_source'] === 'ECB_REFERENCE';
    };

    it('sin conversion, fx_source no hace falta: es el caso de los 19 de hoy', () => {
        const ins = { ...inputs, source_currency: 'EUR' };
        expect(cumpleLaRegla(ins)).toBe(true);
        expect(validarForma(TIPO, { ...base, inputs: ins }).ok).toBe(true);
    });

    it('con conversion y SIN declarar el tipo de cambio, la regla se incumple', () => {
        const ins = { ...inputs, source_currency: 'USD' };
        // El esquema la deja pasar, y por eso existe esta prueba.
        expect(validarForma(TIPO, { ...base, inputs: ins }).ok).toBe(true);
        expect(cumpleLaRegla(ins)).toBe(false);
    });

    it('con conversion y el tipo del BCE declarado, cumple', () => {
        const ins = { ...inputs, source_currency: 'USD', fx_source: 'ECB_REFERENCE' };
        expect(cumpleLaRegla(ins)).toBe(true);
        expect(validarForma(TIPO, { ...base, inputs: ins }).ok).toBe(true);
    });

    it('el tipo de cambio de un proveedor de precios NO es admisible', () => {
        const ins = { ...inputs, source_currency: 'USD', fx_source: 'EODHD' };
        expect(validarForma(TIPO, { ...base, inputs: ins }).ok).toBe(false);
        expect(cumpleLaRegla(ins)).toBe(false);
    });

    it('source_currency es un codigo ISO, no un nombre', () => {
        expect(validarForma(TIPO, { ...base, inputs: { ...inputs, source_currency: 'dolares' } }).ok).toBe(false);
    });
});

describe('el mapper: lo que calculamos contra un indice', () => {
    /**
     * Llegan de `riesgo.relativas`, el bloque PROPIO del extractor, y no de `riesgo.beta`,
     * donde vive la de Morningstar. Dos cifras de la misma magnitud en el mismo campo es
     * como se acaba sin saber cual calculo quien.
     */
    const RELATIVAS: Record<string, unknown> = {
        indice_nombre: 'MSCI World',
        indice_variante: 'NR',
        indice_proxy: 'IE00B03HD191',
        indice_clase_de_serie: 'VALOR_LIQUIDATIVO',
        base_indice: 'TOTAL_RETURN',
        fecha_dato: '2026-09-30',
        beta: { '3a': 1.3736 },
        r2: { '3a': 84.2927 },
        jensen_alpha: { '3a': -7.3206 },
        rentabilidad_activa: { '3a': -1.74 },
        tracking_error: { '3a': 8.0125 },
        information_ratio: { '3a': -0.2172 }
    };

    /** Un fondo con derecho a metricas propias Y con cifras contra su indice. */
    function conRelativas(cambios: Record<string, unknown> = {}): RegistroUniversal {
        const u = universal({
            meta: {
                procedencia: {
                    'riesgo.volatilidad_pct.3a.fondo': 'vl_eodhd:estr',
                    'riesgo.relativas.beta.3a': 'vl_eodhd:eod'
                }
            }
        }) as Record<string, unknown>;
        u['riesgo'] = {
            ...(u['riesgo'] as Record<string, unknown>),
            historial_precios: {
                source_listing_id: 'EODHD:LU0000000000.EUFUND',
                divisa_metricas: 'EUR',
                rf_referencia: 'ESTR_EUR'
            },
            relativas: { ...RELATIVAS, ...cambios }
        };
        u['identificacion'] = {
            ...(u['identificacion'] as Record<string, unknown>),
            politica_distribucion: 'acumulacion'
        };
        return u as RegistroUniversal;
    }

    function relativaDe(cambios: Record<string, unknown> = {}) {
        const r = mapearInstrumento(ficha(), conRelativas(cambios), AHORA);
        const m = doc(r, '/computed/metrics')?.documento as Record<string, any> | undefined;
        return { r, rel: m?.['relative'] as Record<string, any> | undefined };
    }

    it('la identidad del indice viaja ENTERA, con el ISIN del proxy que hizo de indice', () => {
        // Es lo que permite que un informe diga «medido contra este fondo indice» en vez
        // de insinuar que teniamos la serie del indice, que no la tenemos.
        const { rel } = relativaDe();
        expect(rel?.['benchmark']).toEqual({
            name: 'MSCI World',
            instrument_id: 'IE00B03HD191',
            currency: 'EUR',
            variant: 'NR',
            return_basis: 'TOTAL_RETURN',
            series_class: 'NAV'
        });
    });

    it('la clase de serie del proxy viaja, porque es el RUIDO que lleva la cifra', () => {
        // El proxy de MSCI ACWI es un ETF y toca a 57 fondos: un ETF cotizado infla la
        // volatilidad 1,2 puntos a un anio frente al valor liquidativo de un fondo indice.
        // Y no se deduce de la base: un ETF de acumulacion es TOTAL_RETURN y precio de
        // mercado a la vez.
        const { rel } = relativaDe({
            indice_clase_de_serie: 'PRECIO_DE_MERCADO',
            indice_proxy: 'IE00B6R52259'
        });
        expect(rel?.['benchmark']['series_class']).toBe('MARKET_PRICE');
        expect(rel?.['benchmark']['return_basis']).toBe('TOTAL_RETURN');
    });

    it('una clase de serie que no sepamos traducir PARA el mapeo, no lo adivina', () => {
        expect(() => relativaDe({ indice_clase_de_serie: 'INVENTADA' })).toThrow(TraduccionDesconocida);
    });

    describe('el nivel del propio indice (camino C, decision 23 del 07-11-2026)', () => {
        // Las cinco filas aprobadas el 07-11 miden contra la serie del propio indice en la bolsa
        // INDX de EODHD, no contra un ETF: el indice no es un instrumento de la base, asi que su
        // identidad va en `source_series_id` y `instrument_id` queda ausente y declarado.
        const NIVEL = {
            indice_nombre: 'S&P 500',
            indice_variante: 'TR',
            indice_proxy: 'SP500TR.INDX',
            indice_clase_de_serie: 'NIVEL_DE_INDICE',
            base_indice: 'TOTAL_RETURN'
        };

        it('viaja como INDEX_LEVEL con la serie de la fuente, y sin instrument_id', () => {
            const { r, rel } = relativaDe(NIVEL);
            expect(rel?.['benchmark']).toEqual({
                name: 'S&P 500',
                source_series_id: 'EODHD:SP500TR.INDX',
                currency: 'EUR',
                variant: 'TR',
                return_basis: 'TOTAL_RETURN',
                series_class: 'INDEX_LEVEL'
            });
            const m = doc(r, '/computed/metrics')?.documento as Record<string, unknown>;
            expect(validarForma('instrument-computed-metrics.v2.schema.json', m).ok).toBe(true);

        });

        it('la ausencia de instrument_id es NO APLICA, no un proxy pendiente de alta', () => {
            const { r } = relativaDe(NIVEL);
            const ausencia = r.ausencias.find((a) => a.ruta === 'computed/metrics.relative.benchmark.instrument_id');
            expect(ausencia?.razon).toBe('NOT_APPLICABLE');
            // Y contra un fondo indice no hay nada que declarar: el ISIN esta.
            expect(relativaDe().r.ausencias.some((a) => a.ruta.endsWith('relative.benchmark.instrument_id'))).toBe(false);
        });

        it('el contrato no deja un nivel de indice sin su serie, ni una serie sin su clase', () => {
            const { r } = relativaDe(NIVEL);
            const m = doc(r, '/computed/metrics')?.documento as Record<string, any>;
            const sinSerie = structuredClone(m);
            delete sinSerie['relative']['benchmark']['source_series_id'];
            expect(validarForma('instrument-computed-metrics.v2.schema.json', sinSerie).ok).toBe(false);
            const conIsin = structuredClone(m);
            conIsin['relative']['benchmark']['instrument_id'] = 'IE0032126645';
            expect(validarForma('instrument-computed-metrics.v2.schema.json', conIsin).ok).toBe(false);
            const otraClase = structuredClone(m);
            otraClase['relative']['benchmark']['series_class'] = 'NAV';
            expect(validarForma('instrument-computed-metrics.v2.schema.json', otraClase).ok).toBe(false);
        });

        it('la variante de precio publica beta, R2 y tracking error, y ningun alfa (decision 24)', () => {
            // Intermoney contra el EURO STOXX 50 de precio: el extractor no calcula alfa ni
            // rentabilidad activa contra un indice que excluye los dividendos, y el bloque llega
            // sin ellas. El mapper no las inventa ni se queja.
            const { r, rel } = relativaDe({
                indice_nombre: 'EURO STOXX 50',
                indice_variante: 'PR',
                indice_proxy: 'SX5E.INDX',
                indice_clase_de_serie: 'NIVEL_DE_INDICE',
                base_indice: 'PRICE_RETURN',
                jensen_alpha: undefined,
                rentabilidad_activa: undefined,
                information_ratio: undefined
            });
            expect(rel?.['benchmark']['return_basis']).toBe('PRICE_RETURN');
            expect(rel?.['benchmark']['source_series_id']).toBe('EODHD:SX5E.INDX');
            expect(rel?.['beta']).toBeDefined();
            expect(rel?.['tracking_error']).toBeDefined();
            expect(rel).not.toHaveProperty('jensen_alpha');
            expect(rel).not.toHaveProperty('active_return');
            const m = doc(r, '/computed/metrics')?.documento as Record<string, unknown>;
            expect(validarForma('instrument-computed-metrics.v2.schema.json', m).ok).toBe(true);
        });
    });

    it('las fracciones se convierten y los ratios NO', () => {
        const { rel } = relativaDe();
        // El R2 del 84,29 % entra como 0,8429; el alpha de -7,32 % como -0,0732.
        expect(rel?.['r2']['3y']).toBeCloseTo(0.842927, 10);
        expect(rel?.['jensen_alpha']['3y']).toBeCloseTo(-0.073206, 10);
        expect(rel?.['active_return']['3y']).toBeCloseTo(-0.0174, 10);
        expect(rel?.['tracking_error']['3y']).toBeCloseTo(0.080125, 10);
        // La beta y el ratio de informacion son ratios: van tal cual.
        expect(rel?.['beta']['3y']).toBeCloseTo(1.3736, 10);
        expect(rel?.['information_ratio']['3y']).toBeCloseTo(-0.2172, 10);
    });

    it('el periodo se traduce: 3a pasa a 3y', () => {
        const { rel } = relativaDe();
        expect(Object.keys(rel?.['beta'] as Record<string, number>)).toEqual(['3y']);
    });

    it('sin la variante del indice NO se escribe el bloque, y se avisa', () => {
        // Un alpha contra «MSCI World» sin decir que variante no se puede defender.
        const { r, rel } = relativaDe({ indice_variante: undefined });
        expect(rel).toBeUndefined();
        expect(r.avisos.some((a) => a.includes('identidad completa del indice'))).toBe(true);
    });

    it('sin la base de rentabilidad tampoco: el alpha depende de ella', () => {
        const { rel } = relativaDe({ base_indice: undefined });
        expect(rel).toBeUndefined();
    });

    it('un aviso del extractor no se cuenta como identidad incompleta', () => {
        // Cuando el extractor declina —clase en dolares contra un proxy en euros, los 7
        // de la pasada del 01-11— deja un aviso y ninguna cifra. Eso no es un bloque a
        // medias: es una negativa declarada, y no hay nada que advertir aqui.
        const u = conRelativas() as Record<string, any>;
        u['riesgo']['relativas'] = { aviso: 'sin_relativas_divisa_USD' };
        const r = mapearInstrumento(ficha(), u as RegistroUniversal, AHORA);
        expect(doc(r, '/computed/metrics')?.documento as Record<string, any>).not.toHaveProperty('relative');
        expect(r.avisos.some((a) => a.includes('identidad completa del indice'))).toBe(false);
    });

    describe('decisiones 20 y 21 del 07-11-2026: lo que su KID dice del indice', () => {
        const TEXTO =
            'encia temático que está compuesto en un 50 % por el Wilderhill Clean Energy Index (ECO) y en un 50 % por el Wilderhill New Energy Global Innovation Index (NEX)';
        const HUELLA = 'b46a8f9fc350ca9eacb9d4c19e5d0aa820dfc3d3c05e1bce1514557237fedaaa';

        function metricasCon(relativas: Record<string, unknown>) {
            const u = conRelativas() as Record<string, any>;
            u['riesgo']['relativas'] = relativas;
            const r = mapearInstrumento(ficha(), u as RegistroUniversal, AHORA);
            const m = doc(r, '/computed/metrics')?.documento as Record<string, any>;
            return { r, m };
        }

        it('KID compuesto con cifras retiradas: motivo, frase del KID y retirada con su fecha', () => {
            const { r, m } = metricasCon({
                aviso: 'sin_relativas_kid_compuesto',
                kid_estado: 'COMPUESTO',
                kid_texto: TEXTO,
                kid_sha256: HUELLA,
                kid_fecha_comprobacion: '2026-11-07',
                retirada: {
                    fecha: '2026-11-07',
                    decision: 'DECISIONES_DATOS_2026-11-07.md, punto 20',
                    indice_nombre: 'MSCI ACWI',
                    indice_proxy: 'IE00B6R52259',
                    ultima_fecha_dato: '2026-10-31'
                }
            });
            expect(m).not.toHaveProperty('relative');
            expect(m['relative_absence']).toBe('KID_DECLARES_COMPOSITE');
            expect(m['relative_absence_evidence']).toEqual({
                kid_excerpt: TEXTO,
                kid_sha256: HUELLA,
                checked_on: '2026-11-07'
            });
            expect(m['relative_withdrawal']).toEqual({
                withdrawn_on: '2026-11-07',
                decision: 'DECISIONES_DATOS_2026-11-07.md, punto 20',
                benchmark_name: 'MSCI ACWI',
                benchmark_instrument_id: 'IE00B6R52259',
                last_as_of: '2026-10-31'
            });
            expect(validarForma('instrument-computed-metrics.v2.schema.json', m).ok).toBe(true);
            expect(r.avisos.some((a) => a.includes('identidad completa del indice'))).toBe(false);
        });

        it('lo retirado contra el nivel del indice se reconoce por su serie, no por un ISIN', () => {
            // Decision 23: la retirada lleva la clase de serie, y la plataforma la pone en el
            // campo que le corresponde. Un informe entregado tiene que poder reconocer contra que
            // se midio.
            const { m } = metricasCon({
                aviso: 'sin_relativas_kid_compuesto',
                kid_estado: 'COMPUESTO',
                kid_texto: TEXTO,
                kid_sha256: HUELLA,
                kid_fecha_comprobacion: '2026-11-07',
                retirada: {
                    fecha: '2026-11-07',
                    decision: 'DECISIONES_DATOS_2026-11-07.md, punto 20',
                    indice_nombre: 'S&P 500',
                    indice_proxy: 'SP500TR.INDX',
                    indice_clase_de_serie: 'NIVEL_DE_INDICE',
                    ultima_fecha_dato: '2026-10-31'
                }
            });
            expect(m['relative_withdrawal']).toEqual({
                withdrawn_on: '2026-11-07',
                decision: 'DECISIONES_DATOS_2026-11-07.md, punto 20',
                benchmark_name: 'S&P 500',
                benchmark_source_series_id: 'EODHD:SP500TR.INDX',
                last_as_of: '2026-10-31'
            });
            expect(validarForma('instrument-computed-metrics.v2.schema.json', m).ok).toBe(true);
        });

        it('KID sin indice y nada que retirar: el motivo y la frase, sin retirada', () => {
            const { m } = metricasCon({
                aviso: 'sin_relativas_kid_sin_indice',
                kid_estado: 'KID_SIN_INDICE',
                kid_texto: 'No se gestiona en relación con un valor de referencia.'
            });
            expect(m['relative_absence']).toBe('KID_DECLARES_NO_BENCHMARK');
            expect(m['relative_absence_evidence']).toEqual({
                kid_excerpt: 'No se gestiona en relación con un valor de referencia.'
            });
            expect(m).not.toHaveProperty('relative_withdrawal');
            expect(validarForma('instrument-computed-metrics.v2.schema.json', m).ok).toBe(true);
        });

        it('un aviso del KID que no sepamos traducir PARA el mapeo', () => {
            expect(() => metricasCon({ aviso: 'sin_relativas_kid_inventado' })).toThrow(TraduccionDesconocida);
        });

        it('la clase cubierta escribe su motivo, sin frase del KID ni retirada (decision 30)', () => {
            // Hasta la decision 30 este aviso se dejaba sin valor a proposito y la ficha lo leia como
            // un hueco. Medido el 07-11-2026: 5 clases en la base con el aviso y sin motivo publicado.
            const { m } = metricasCon({ aviso: 'sin_relativas_clase_cubierta' });
            expect(m['relative_absence']).toBe('HEDGED_SHARE_CLASS');
            expect(m).not.toHaveProperty('relative');
            expect(m).not.toHaveProperty('relative_absence_evidence');
            expect(m).not.toHaveProperty('relative_withdrawal');
            expect(validarForma('instrument-computed-metrics.v2.schema.json', m).ok).toBe(true);
        });

        it('la referencia que es otra clase del mismo fondo escribe su motivo (C-28, regla 3)', () => {
            // Lo que escribe el extractor desde e1d02adb: el proxy entre parentesis y la firma aparte. Es el
            // caso de Vanguard Global Stock Index Investor, medido contra su clase EUR Acc.
            const { r, m } = metricasCon({
                aviso: 'sin_relativas_referencia_del_mismo_fondo(IE00B03HD191)',
                mismo_fondo_por: 'patrimonio_del_fondo'
            });
            expect(m['relative_absence']).toBe('SAME_FUND_REFERENCE');
            expect(m).not.toHaveProperty('relative');
            expect(m).not.toHaveProperty('relative_absence_evidence');
            expect(m).not.toHaveProperty('relative_withdrawal');
            expect(validarForma('instrument-computed-metrics.v2.schema.json', m).motivos).toEqual([]);
            expect(r.avisos.some((a) => a.includes('identidad completa del indice'))).toBe(false);
        });

        it('su retirada viaja como la del KID (§10 del metodo)', () => {
            // Lo que escribe el extractor desde el 21-11-2026 para Vanguard Global Stock Index Investor, medido con su
            // ficha del 17-11 (`_escribe_retirada` de `fetchers/vl_fondos.py`), con la clase de serie del proxy.
            const { m } = metricasCon({
                aviso: 'sin_relativas_referencia_del_mismo_fondo(IE00B03HD191)',
                mismo_fondo_por: 'patrimonio_del_fondo',
                retirada: {
                    fecha: '2026-11-21',
                    decision: 'DECISIONES_BASE_NUEVA_2026-11-01.md, decisión C-28 (regla 3)',
                    indice_nombre: 'MSCI World',
                    indice_proxy: 'IE00B03HD191',
                    indice_clase_de_serie: 'VALOR_LIQUIDATIVO',
                    ultima_fecha_dato: '2026-10-31'
                }
            });
            expect(m['relative_absence']).toBe('SAME_FUND_REFERENCE');
            expect(m['relative_withdrawal']).toEqual({
                withdrawn_on: '2026-11-21',
                decision: 'DECISIONES_BASE_NUEVA_2026-11-01.md, decisión C-28 (regla 3)',
                benchmark_name: 'MSCI World',
                benchmark_instrument_id: 'IE00B03HD191',
                last_as_of: '2026-10-31'
            });
            expect(validarForma('instrument-computed-metrics.v2.schema.json', m).motivos).toEqual([]);
        });

        it('el motivo de la C-28 tambien sin el parentesis del proxy', () => {
            const { m } = metricasCon({ aviso: 'sin_relativas_referencia_del_mismo_fondo' });
            expect(m['relative_absence']).toBe('SAME_FUND_REFERENCE');
        });

        it('los avisos que son del calculo y no del fondo siguen sin motivo', () => {
            const { m } = metricasCon({ aviso: 'sin_relativas_divisa_USD' });
            expect(m).not.toHaveProperty('relative_absence');
            expect(m).not.toHaveProperty('relative_absence_evidence');
        });

        it.each([
            ['NO_CONFIRMADO', 'NOT_CONFIRMED'],
            ['CONFIRMADO_MARCA', 'BRAND_ONLY']
        ])('el KID no confirma el indice (%s): se mide y el indice lo dice', (estado, valor) => {
            const { rel } = relativaDe({ kid_no_confirma: true, kid_estado: estado });
            expect(rel?.['benchmark']['kid_confirmation']).toBe(valor);
            expect(rel?.['jensen_alpha']['3y']).toBeCloseTo(-0.073206, 10);
        });

        it('sin marca, el indice no lleva kid_confirmation', () => {
            const { rel } = relativaDe();
            expect(rel?.['benchmark']).not.toHaveProperty('kid_confirmation');
        });

        it('un indice equivalente al declarado: name es el medido y equivalent_of el que declara', () => {
            const { m } = metricasCon({ ...RELATIVAS, indice_nombre: 'Bloomberg Euro Corp', equivalente_de: 'ICE BofA Euro Corporate' });
            const rel = m['relative'] as Record<string, any>;
            expect(rel?.['benchmark']['name']).toBe('Bloomberg Euro Corp');
            expect(rel?.['benchmark']['equivalent_of']).toBe('ICE BofA Euro Corporate');
            expect(validarForma('instrument-computed-metrics.v2.schema.json', m).motivos).toEqual([]);
        });

        it('medido contra el que declara, el indice no lleva equivalent_of', () => {
            const { rel } = relativaDe();
            expect(rel?.['benchmark']).not.toHaveProperty('equivalent_of');
        });

        it('un motivo con cifras no se escribe: seria contradecirse', () => {
            const { m } = metricasCon({ ...RELATIVAS, aviso: 'sin_relativas_kid_compuesto', kid_texto: TEXTO });
            expect(m['relative']).toBeDefined();
            expect(m).not.toHaveProperty('relative_absence');
        });
    });

    it('un fondo sin bloque de relativas sigue teniendo sus metricas propias', () => {
        // 694 fichas de 846 no tienen proxy aprobado el 01-11-2026. No es un fallo.
        const u = conRelativas() as Record<string, any>;
        delete u['riesgo']['relativas'];
        const r = mapearInstrumento(ficha(), u as RegistroUniversal, AHORA);
        const m = doc(r, '/computed/metrics')?.documento as Record<string, any>;
        expect(m['volatility']['3y']).toBeCloseTo(0.1234, 10);
        expect(m).not.toHaveProperty('relative');
    });

    it('todo lo que sale sigue pasando las dos puertas, y como BATCH', () => {
        const { r } = relativaDe();
        const d = r.documentos.find((x) => x.ruta.endsWith('/computed/metrics'));
        expect(d?.comoDueno).toBe('batch');
        expect(validarEscritura(d!.tipo, d!.documento, 'batch').motivos).toEqual([]);
    });
});

describe('el top de posiciones: 25, y cuanto cubren', () => {
    /*
     * Hasta el 02-11-2026 el canonico solo traia 10 posiciones y el contrato admitia 25
     * desde el primer dia, asi que guardabamos menos de lo que cabia. Medido ese dia sobre
     * las 760 fichas con diez posiciones o mas: la mediana de cartera explicada pasa del
     * 40,9 % al 61,4 % y los fondos explicados al 90 % de 53 a 129.
     *
     * Y `coverage`, que el contrato pedia con una frase que explica por que y que nadie
     * escribia: «sin esto, una lista parcial parece completa».
     */
    const conPosiciones = (cuantas: number, cobertura?: number) => {
        const top = Array.from({ length: cuantas }, (_, i) => ({
            name: `Posicion ${i + 1}`,
            weight: 2,
            sector: 'technology'
        }));
        const resultado = mapearInstrumento(
            ficha({
                ms: {
                    ...(ficha()['ms'] as Record<string, unknown>),
                    holdings_top: top,
                    holdings_top_weight_sum: cobertura,
                    holdings_stats: { holdings_count_equity: 120, top10_weight: 20 }
                }
            }),
            universal(),
            AHORA
        );
        return doc(resultado, '/declared/holdings')?.documento as Record<string, any> | undefined;
    };

    it('guarda 25 cuando el canonico las trae', () => {
        const bloque = conPosiciones(25, 61.45);
        expect(bloque?.['top']).toHaveLength(25);
        expect(bloque?.['positions_count']).toBe(120);
        expect(bloque?.['coverage']).toBeCloseTo(0.6145, 4);
        expect(validarForma('instrument-declared-holdings.v2.schema.json', bloque!).ok).toBe(true);
    });

    it('no emite una lista que el contrato rechazaria', () => {
        /* Si un canonico futuro manda 40, se guardan las 25 que caben en vez de bloquear el
           documento entero. Es la regla de la casa: un mapper no emite un valor invalido. */
        const bloque = conPosiciones(40, 80);
        expect(bloque?.['top']).toHaveLength(25);
        expect(validarForma('instrument-declared-holdings.v2.schema.json', bloque!).ok).toBe(true);
    });

    it('un canonico viejo, con solo holdings_top10, sigue valiendo', () => {
        const viejo = ficha({
            ms: {
                ...(ficha()['ms'] as Record<string, unknown>),
                holdings_top10: [{ name: 'Una posicion', weight: 5 }],
                holdings_stats: { holdings_count_equity: 42, top10_weight: 20 }
            }
        });
        const bloque = doc(mapearInstrumento(viejo, universal(), AHORA), '/declared/holdings')
            ?.documento as Record<string, any>;
        expect(bloque['top']).toHaveLength(1);
        expect(bloque['positions_count']).toBe(42);
        /* Sin `coverage`: ese canonico no lo calculaba, y no se inventa aqui. */
        expect(bloque).not.toHaveProperty('coverage');
    });
});

describe('los titulos de la cartera se cuentan aparte (decision 55)', () => {
    const conEstadisticas = (estadisticas: Record<string, unknown>) => {
        const resultado = mapearInstrumento(
            ficha({
                ms: {
                    ...(ficha()['ms'] as Record<string, unknown>),
                    holdings_top10: [{ name: 'Una posicion', weight: 5 }],
                    holdings_stats: { ...estadisticas, top10_weight: 20 }
                }
            }),
            universal(),
            AHORA
        );
        return { resultado, bloque: doc(resultado, '/declared/holdings')?.documento as Record<string, any> | undefined };
    };

    it('solo acciones: los titulos son las acciones, como en iShares Core MSCI World', () => {
        const { bloque } = conEstadisticas({ holdings_count_equity: 1247 });
        expect(bloque?.['securities_count']).toBe(1247);
        expect(bloque?.['positions_count']).toBe(1247);
        expect(validarForma('instrument-declared-holdings.v2.schema.json', bloque!).ok).toBe(true);
    });

    it('solo bonos: los titulos son los bonos', () => {
        expect(conEstadisticas({ holdings_count_bond: 2992 }).bloque?.['securities_count']).toBe(2992);
    });

    it('cartera mixta: suma las dos clases, y positions_count sigue siendo solo los bonos', () => {
        const { bloque } = conEstadisticas({ holdings_count_equity: 52, holdings_count_bond: 191 });
        expect(bloque?.['securities_count']).toBe(243);
        expect(bloque?.['positions_count']).toBe(191);
        expect(validarForma('instrument-declared-holdings.v2.schema.json', bloque!).ok).toBe(true);
    });

    it('ninguna de las dos: no hay documento y por tanto no hay campo', () => {
        const { bloque, resultado } = conEstadisticas({});
        expect(bloque).toBeUndefined();
        expect(resultado.ausencias.some((a) => a.ruta === 'declared/holdings' && a.razon === 'NOT_PROVIDED')).toBe(true);
    });

    it('un cero no es un recuento: el campo se queda ausente, con su razon', () => {
        const { bloque, resultado } = conEstadisticas({ holdings_count_equity: 0 });
        expect(bloque).not.toHaveProperty('securities_count');
        expect(validarForma('instrument-declared-holdings.v2.schema.json', bloque!).ok).toBe(true);
        expect(resultado.ausencias.some((a) => a.ruta === 'declared/holdings.securities_count' && a.razon === 'NOT_PROVIDED')).toBe(true);
    });
});

describe('la cobertura solo se afirma cuando se puede', () => {
    it('con nocionales de derivado no hay cobertura, y se dice por que', () => {
        /*
         * El contrato exige `coverage <= 1`, y el 02-11-2026 bloqueo 63 documentos: la suma
         * de los pesos del top pasa del 100 % en las carteras con derivados -un futuro del S&P
         * al 109,74 %- y ahi la suma no es una fraccion del patrimonio de nadie. Recortarla a 1
         * diria que la cartera esta cubierta al 100 %.
         */
        const resultado = mapearInstrumento(
            ficha({
                ms: {
                    ...(ficha()['ms'] as Record<string, unknown>),
                    holdings_top: [{ name: 'E-mini S&P 500 Future', weight: 109.74 }],
                    holdings_top_weight_sum: 109.74,
                    holdings_stats: { holdings_count_equity: 113, top10_weight: 32.3 }
                }
            }),
            universal(),
            AHORA
        );
        const bloque = doc(resultado, '/declared/holdings')?.documento as Record<string, any>;
        expect(bloque).not.toHaveProperty('coverage');
        expect(validarForma('instrument-declared-holdings.v2.schema.json', bloque).ok).toBe(true);
        expect(
            resultado.ausencias.some(
                (a) => a.ruta === 'declared/holdings.coverage' && a.razon === 'NOT_APPLICABLE'
            )
        ).toBe(true);
    });
});


describe('una linea con un peso imposible no llega a la cartera', () => {
    const conForward = () =>
        mapearInstrumento(
            ficha({
                ms: {
                    ...(ficha()['ms'] as Record<string, unknown>),
                    holdings_top: [
                        { name: 'JPY/EUR - Currency Forward Purchased', weight: 3662.436, holding_type_code: 'CU' },
                        { name: 'NVIDIA Corp', weight: 5.638, holding_type_code: 'E' },
                        { name: 'Apple Inc', weight: 5.321, holding_type_code: 'E' }
                    ],
                    holdings_all: [
                        { name: 'JPY/EUR - Currency Forward Purchased', weight: 3662.436, holding_type_code: 'CU' },
                        { name: 'NVIDIA Corp', weight: 5.638, holding_type_code: 'E' },
                        { name: 'Apple Inc', weight: 5.321, holding_type_code: 'E' },
                        { name: 'Cash Offset', weight: -3662.551, holding_type_code: 'CQ' }
                    ],
                    holdings_top_weight_sum: 3673.395,
                    holdings_stats: { holdings_count_equity: 113, top10_weight: 32.3 }
                }
            }),
            universal(),
            AHORA
        );

    it('ni en el resumen ni en la lista, y la cobertura se rehace sin ella', () => {
        const resultado = conForward();
        const bloque = doc(resultado, '/declared/holdings')?.documento as Record<string, any>;
        expect(bloque['top'].map((l: Record<string, unknown>) => l['name'])).toEqual(['NVIDIA Corp', 'Apple Inc']);
        /* 5,638 + 5,321: es lo que se ha guardado, no la suma con el forward que trae el canonico. */
        expect(bloque['coverage']).toBeCloseTo(0.10959, 5);
        expect(validarForma('instrument-declared-holdings.v2.schema.json', bloque).ok).toBe(true);
        const trozo = doc(resultado, '/holdings_chunks/000')?.documento as Record<string, any>;
        expect(trozo['positions'].map((l: Record<string, unknown>) => l['name'])).toEqual(['NVIDIA Corp', 'Apple Inc']);
    });

    it('y lo dice, con el nombre de las lineas', () => {
        expect(conForward().avisos.join(' ')).toContain('2 lineas con un peso imposible');
        expect(conForward().avisos.join(' ')).toContain('Cash Offset');
    });
});

describe('la cartera lleva el codigo fino de cada linea', () => {
    it('en el resumen, para quien lea solo el resumen', () => {
        const resultado = mapearInstrumento(
            ficha({
                ms: {
                    ...(ficha()['ms'] as Record<string, unknown>),
                    holdings_top: [
                        { name: 'NVIDIA Corp', weight: 5, holding_type_code: 'E' },
                        { name: 'Una linea de justETF', weight: 4 }
                    ]
                }
            }),
            universal(),
            AHORA
        );
        const bloque = doc(resultado, '/declared/holdings')?.documento as Record<string, any>;
        expect(bloque['top'][0]['holding_type_code']).toBe('E');
        expect(bloque['top'][1]).not.toHaveProperty('holding_type_code');
        expect(validarForma('instrument-declared-holdings.v2.schema.json', bloque).ok).toBe(true);
    });
});

describe('la divisa del precio es la del precio', () => {
    const cotizacion = (valoracion: Record<string, unknown>, tipo = 'fondo') =>
        doc(
            mapearInstrumento(
                ficha(),
                universal({
                    identificacion: { ...(universal()['identificacion'] as Record<string, unknown>), tipo_producto: tipo },
                    valoracion
                }),
                AHORA
            ),
            '/declared/quote'
        )?.documento as Record<string, unknown> | undefined;

    it('un ETF de clase en dolares con precio en euros dice euros', () => {
        const bloque = cotizacion({ vl: 129.07, vl_fecha: '2026-11-03', vl_divisa: 'EUR' }, 'etf');
        expect(bloque).toMatchObject({ price: 129.07, as_of: '2026-11-03', currency: 'EUR', price_class: 'MARKET_PRICE' });
        expect(validarForma('instrument-declared-quote.v2.schema.json', bloque!).ok).toBe(true);
    });

    it('sin divisa, o con algo que no es una divisa, no se escribe ninguna', () => {
        expect(cotizacion({ vl: 10, vl_fecha: '2026-11-03' })).not.toHaveProperty('currency');
        expect(cotizacion({ vl: 10, vl_fecha: '2026-11-03', vl_divisa: 'euros' })).not.toHaveProperty('currency');
    });
});


describe('la cotizacion dice de donde viene el precio (decision B-68)', () => {
    /* Los tres codigos que el extractor escribe en `meta.procedencia['valoracion.vl']`, medidos el 09-11-2026 sobre
       `182481b2…`: 738 `vl_eodhd:eod`, 542 `eodhd` y 31 `morningstar_lt:sal_quote`. */
    const cotizacion = (tipo: string, procedencia?: string, valoracion: Record<string, unknown> = { vl: 86.69, vl_fecha: '2026-10-30', vl_divisa: 'EUR' }) =>
        doc(
            mapearInstrumento(
                ficha(),
                universal({
                    identificacion: { ...(universal()['identificacion'] as Record<string, unknown>), tipo_producto: tipo },
                    valoracion,
                    ...(procedencia === undefined ? {} : { meta: { procedencia: { 'valoracion.vl': procedencia, currency: 'otra:fuente' } } })
                }),
                AHORA
            ),
            '/declared/quote'
        )?.documento as Record<string, unknown> | undefined;

    it.each([
        ['fondo', 'vl_eodhd:eod', 'NAV'],
        ['fondo', 'morningstar_lt:sal_quote', 'NAV'],
        ['etf', 'eodhd', 'MARKET_PRICE']
    ])('un %s con el precio de %s lo publica tal cual', (tipo, procedencia, clase) => {
        const bloque = cotizacion(tipo, procedencia);
        expect(bloque).toMatchObject({ source: procedencia, price: 86.69, as_of: '2026-10-30', price_class: clase, currency: 'EUR' });
        expect(validarForma('instrument-declared-quote.v2.schema.json', bloque!).ok).toBe(true);
    });

    it('lee la procedencia del precio y no la de otro campo', () => {
        expect(cotizacion('fondo', 'vl_eodhd:eod')?.['source']).not.toBe('otra:fuente');
    });

    it('sin procedencia queda la reserva, canonical:fondosdb', () => {
        const bloque = cotizacion('fondo');
        expect(bloque?.['source']).toBe('canonical:fondosdb');
        expect(validarForma('instrument-declared-quote.v2.schema.json', bloque!).ok).toBe(true);
    });

    it('una fuente que el contrato todavia no nombra se escribe igual: el vocabulario no es un enum', () => {
        const bloque = cotizacion('fondo', 'fuente_nueva:endpoint');
        expect(bloque?.['source']).toBe('fuente_nueva:endpoint');
        expect(validarForma('instrument-declared-quote.v2.schema.json', bloque!).ok).toBe(true);
    });

    it('una procedencia vacia no vale como fuente', () => {
        expect(cotizacion('fondo', '')?.['source']).toBe('canonical:fondosdb');
    });
});

describe('un precio en otra divisa que su serie no se publica (09-11-2026)', () => {
    /* SPY el 09-11-2026, tal como lo trae el canonico: un valor liquidativo de justETF en EUR
       como precio de un ETF cuya serie y negociacion son en dolares. */
    const SPY = 'US78462F1030';
    const etf = (cambios: Record<string, unknown>, isin = ISIN) =>
        mapearInstrumento(
            ficha({ isin }),
            universal({
                _id: isin,
                identificacion: { ...(universal()['identificacion'] as Record<string, unknown>), tipo_producto: 'etf', divisa_base: 'USD' },
                ...cambios
            }),
            AHORA
        );
    const negociacionEn = (plaza: string, divisa?: string) => ({
        plaza,
        ...(divisa === undefined ? {} : { divisa }),
        fecha_corte: '2026-11-06',
        sesiones: 251
    });

    it('SPY: precio en EUR, serie y negociacion en USD: sin declared/quote y con aviso', () => {
        const resultado = etf(
            {
                valoracion: { vl: 658.7, vl_fecha: '2026-11-06', vl_divisa: 'EUR' },
                negociacion: negociacionEn('US', 'USD'),
                riesgo: { fecha_dato: '2026-09-30', historial_precios: { divisa_origen: 'USD', divisa_metricas: 'EUR' } },
                meta: { procedencia: { 'valoracion.vl': 'justetf' } }
            },
            SPY
        );
        expect(doc(resultado, '/declared/quote')).toBeUndefined();
        const aviso = resultado.avisos.find((texto) => texto.includes('declared/quote'));
        expect(aviso).toBeDefined();
        expect(aviso).toContain(SPY);
        expect(aviso).toContain('EUR');
        expect(aviso).toContain('USD');
        expect(aviso).toContain('justetf');
        expect(resultado.ausencias.find((ausencia) => ausencia.ruta === 'declared/quote')?.detalle).toBe(
            'declared/quote sin escribir: el precio viene en EUR (fuente justetf) y la serie es en USD'
        );
    });

    it('basta con que lo contradiga la negociacion, aunque la serie no diga su divisa', () => {
        const resultado = etf({
            valoracion: { vl: 658.7, vl_fecha: '2026-11-06', vl_divisa: 'EUR' },
            negociacion: negociacionEn('US', 'USD')
        });
        expect(doc(resultado, '/declared/quote')).toBeUndefined();
        expect(resultado.avisos.some((texto) => texto.includes('sin procedencia') && texto.includes('la negociacion es en USD'))).toBe(true);
    });

    it('clase en USD que cotiza en EUR en XETRA, con serie y precio en EUR: se escribe', () => {
        const resultado = etf({
            valoracion: { vl: 128.975, vl_fecha: '2026-11-06', vl_divisa: 'EUR' },
            negociacion: negociacionEn('XETRA', 'EUR')
        });
        const bloque = doc(resultado, '/declared/quote')?.documento;
        expect(bloque).toMatchObject({ price: 128.975, currency: 'EUR', price_class: 'MARKET_PRICE' });
        expect(validarForma('instrument-declared-quote.v2.schema.json', bloque!).ok).toBe(true);
        expect(resultado.avisos.some((texto) => texto.includes('declared/quote'))).toBe(false);
    });

    it('sin divisa de negociacion ni de serie no se bloquea nada', () => {
        const resultado = etf({
            valoracion: { vl: 128.975, vl_fecha: '2026-11-06', vl_divisa: 'EUR' },
            negociacion: negociacionEn('XETRA')
        });
        expect(doc(resultado, '/declared/quote')?.documento).toMatchObject({ price: 128.975, currency: 'EUR' });
    });

    it('Londres: precio en peniques frente a negociacion en libras es la misma moneda', () => {
        const resultado = etf({
            valoracion: { vl: 7012.5, vl_fecha: '2026-11-06', vl_divisa: 'GBX' },
            negociacion: negociacionEn('LSE', 'GBP')
        });
        expect(doc(resultado, '/declared/quote')?.documento).toMatchObject({ price: 7012.5, currency: 'GBX' });
    });

    it('frente a la serie, libras y peniques no son lo mismo: es un error de escala de cien', () => {
        const resultado = etf({
            valoracion: { vl: 70.125, vl_fecha: '2026-11-06', vl_divisa: 'GBP' },
            negociacion: negociacionEn('LSE', 'GBP'),
            riesgo: { fecha_dato: '2026-09-30', historial_precios: { divisa_origen: 'GBX' } }
        });
        expect(doc(resultado, '/declared/quote')).toBeUndefined();
    });

    it('un fondo solo se compara con su serie: no cotiza', () => {
        const conNegociacion = mapearInstrumento(
            ficha(),
            universal({ valoracion: { vl: 10, vl_fecha: '2026-11-03', vl_divisa: 'USD' }, negociacion: negociacionEn('XETRA', 'EUR') }),
            AHORA
        );
        expect(doc(conNegociacion, '/declared/quote')?.documento).toMatchObject({ price_class: 'NAV', currency: 'USD' });
        const conSerie = mapearInstrumento(
            ficha(),
            universal({
                valoracion: { vl: 10, vl_fecha: '2026-11-03', vl_divisa: 'USD' },
                riesgo: { fecha_dato: '2026-09-30', historial_precios: { divisa_origen: 'EUR' } }
            }),
            AHORA
        );
        expect(doc(conSerie, '/declared/quote')).toBeUndefined();
    });
});

describe('el mapper: un ETF, con el calculo mensual sobre su precio de mercado', () => {
    const historial = {
        clase_de_serie: 'PRECIO_DE_MERCADO',
        source_history: 'eodhd',
        source_listing_id: 'EODHD:EUNL.XETRA',
        divisa_metricas: 'EUR'
    };
    const etf = (tipoProducto: string, serie: Record<string, unknown> = historial) =>
        universal({
            identificacion: { ...universal().identificacion as object, tipo_producto: tipoProducto },
            riesgo: {
                fecha_dato: '2026-10-31',
                volatilidad_pct: { '3a': { fondo: 11.9 } },
                historial_precios: serie
            },
            meta: { procedencia: { 'riesgo.volatilidad_pct.3a.fondo': 'vl_eodhd:estr' } }
        });

    it('lo publica con el metodo de los fondos, diciendo sobre que precio y con que derecho', () => {
        const metricas = doc(mapearInstrumento(ficha(), etf('etf'), AHORA), 'computed/metrics')?.documento;
        expect(metricas?.['method']).toBe('EXTRACTOR_MONTHLY_V2');
        expect(metricas?.['frequency']).toBe('MONTHLY');
        const entradas = metricas?.['inputs'] as Record<string, unknown>;
        expect(entradas['series_class']).toBe('MARKET_PRICE');
        expect(entradas['series_adjustment']).toBe('SPLIT_AND_DIVIDEND_ADJUSTED');
        expect(entradas['distribution_policy_resolution']).toBeUndefined();
    });

    it('sin la clase de serie sigue haciendo falta la politica, como en un fondo', () => {
        const sinClase = { ...historial, clase_de_serie: undefined };
        const resultado = mapearInstrumento(ficha(), etf('etf', sinClase), AHORA);
        expect(doc(resultado, 'computed/metrics')).toBeUndefined();
    });

    it('el ETC no entra: su metodo no esta decidido', () => {
        expect(doc(mapearInstrumento(ficha(), etf('etc'), AHORA), 'computed/metrics')).toBeUndefined();
    });
});


describe('el mapper: a que fecha miden las metricas', () => {
    it('as_of es el cierre, no cuando se calcularon ni donde acaba la serie', () => {
        const u = universal({
            riesgo: {
                fecha_dato: '2026-09-30',
                volatilidad_pct: { '3a': { fondo: 11.9 } },
                historial_precios: { source_listing_id: 'EODHD:X.EUFUND', divisa_metricas: 'EUR', last_date: '2026-10-29' }
            },
            rentabilidad: { fecha_dato: '2026-09-30', trailing_pct: { '3a_anualizada': { fondo: 8 } } },
            distribuciones: { historial_consultado: true },
            meta: {
                procedencia: {
                    'riesgo.volatilidad_pct.3a.fondo': 'vl_eodhd:estr',
                    'rentabilidad.fecha_dato': 'vl_eodhd:eod'
                }
            }
        });
        const metricas = doc(mapearInstrumento(ficha(), u, AHORA), 'computed/metrics')?.documento;
        expect(metricas?.['as_of']).toBe('2026-09-30');
        expect((metricas?.['inputs'] as Record<string, unknown>)['last_date']).toBe('2026-10-29');
    });
});


describe('el mapper: por que no hay metricas', () => {
    const raizDe = (u: RegistroUniversal) =>
        doc(mapearInstrumento(ficha(), u, AHORA), `instruments/${ISIN}`)?.documento as Record<string, unknown>;
    const sinCifras = (historial: Record<string, unknown>) =>
        universal({ riesgo: { fecha_dato: '2026-09-30', historial_precios: historial }, rentabilidad: {} });

    it('la raiz lo dice, con un codigo que la ficha sabe contar', () => {
        expect(raizDe(sinCifras({ aviso_metricas: 'sin_metricas_kid_distribucion' }))['metrics_absence']).toEqual({
            reason: 'NOT_APPLICABLE',
            code: 'DISTRIBUTES'
        });
        expect(raizDe(sinCifras({ aviso_vl: 'serie_parada(34d)' }))['metrics_absence']).toEqual({
            reason: 'NOT_PROVIDED',
            code: 'SERIES_STOPPED'
        });
        expect(raizDe(sinCifras({}))['metrics_absence']).toEqual({ reason: 'NOT_PROVIDED', code: 'NO_PRICES' });
        expect(raizDe(sinCifras({ observations_count: 90 }))['metrics_absence']).toEqual({
            reason: 'NOT_PROVIDED',
            code: 'SHORT_HISTORY'
        });
    });

    it('el fondo con metricas no lleva el campo', () => {
        const u = universal({
            riesgo: {
                fecha_dato: '2026-10-31',
                volatilidad_pct: { '3a': { fondo: 11.9 } },
                historial_precios: { source_listing_id: 'EODHD:X.EUFUND', divisa_metricas: 'EUR' }
            },
            distribuciones: { historial_consultado: true },
            meta: { procedencia: { 'riesgo.volatilidad_pct.3a.fondo': 'vl_eodhd:estr' } }
        });
        expect(raizDe(u)['metrics_absence']).toBeUndefined();
    });
});


describe('el mapper: los dos defectos del catalogo', () => {
    it('sin divisa declarada, usa la del valor liquidativo', () => {
        const u = universal({
            identificacion: { ...(universal().identificacion as object), divisa_base: undefined },
            valoracion: { ...(universal().valoracion as object), vl_divisa: 'EUR' }
        });
        const resultado = mapearInstrumento({ ...ficha(), currency: undefined } as unknown as FichaCanonica, u, AHORA);
        expect(resultado.errores).toEqual([]);
        expect(doc(resultado, `instruments/${ISIN}`)).toBeDefined();
    });

    it('sin ninguna divisa, sigue sin entrar', () => {
        const u = universal({ identificacion: { ...(universal().identificacion as object), divisa_base: undefined } });
        const resultado = mapearInstrumento({ ...ficha(), currency: undefined } as unknown as FichaCanonica, u, AHORA);
        expect(resultado.errores[0]).toContain('sin divisa utilizable');
    });
});
