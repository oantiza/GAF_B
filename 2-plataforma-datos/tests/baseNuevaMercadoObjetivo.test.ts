import { describe, expect, it } from 'vitest';

import { cargarEsquemas, rutasDe, subcoleccionesDeclaradas } from '../src/config/baseNueva/esquemas';
import { validarEscritura, validarForma } from '../src/config/baseNueva/validadores';
import { BLOQUES_DE_INSTRUMENTO, rutasPosiblesDe } from '../src/ingestion/baseNueva/mapper';
import { calcularCalidad, componerTarjeta, type InstrumentoLeido } from '../src/ingestion/baseNueva/calidadYTarjeta';
import {
    documentoDelMercadoObjetivo,
    fechaEstricta,
    mapearMercadoObjetivo,
    SUFIJO_MERCADO_OBJETIVO,
    TIPO_MERCADO_OBJETIVO
} from '../src/ingestion/baseNueva/mercadoObjetivo';

/**
 * El mercado objetivo del EMT del fabricante en la base nueva (decisión 58 de Óscar, 09-11-2026).
 *
 * Los fixtures siguen la forma del bloque `mercado_objetivo` que fija Dirección, y sus valores salen de la medición de
 * `INFORME_EMT_EET_2026-11-09.md` (fechas de fichero y de mercado objetivo por emisor, plantilla, 5 años, B en los cuatro canales,
 * renta Y en iShares y NEUTRAL en Vanguard). Las URL, las huellas y los ISIN de Vanguard e Invesco son ficticios a propósito:
 * ningún dato de un EMT real que no esté en el informe.
 */

const ISHARES = 'IE00B4L5Y983';
/* Ficticios, con forma de ISIN. */
const VANGUARD = 'IE00000VANG1';
const INVESCO = 'IE0000INVES2';
const ORO_FISICO = 'IE00B4ND3602';

function bloqueComun(): Record<string, unknown> {
    return {
        tipo_inversor: { minorista: 'SI', profesional: 'SI', contraparte_elegible: 'SI' },
        conocimiento: { basico: 'SI', informado: 'SI', avanzado: 'SI' },
        capacidad_perdidas: { sin_perdidas: 'NO', sin_garantia: 'SI' },
        periodo_minimo: { anos: 5 },
        distribucion: { solo_ejecucion: 'B', conveniencia: 'B', asesoramiento: 'B', gestion_cartera: 'B' }
    };
}

function deIshares(): Record<string, unknown> {
    return {
        fuente: 'emisor:ishares',
        url_fichero: 'https://ejemplo.invalid/ishares/emt.xlsx',
        sha256_fichero: 'a'.repeat(64),
        version_plantilla: 'V4',
        fichero_generado: '2026-10-30',
        fecha_mercado_objetivo: '2026-09-30',
        ...bloqueComun(),
        objetivos: { crecimiento: 'SI', rentas: 'SI' },
        preferencias_esg_consideradas: 'NEUTRAL'
    };
}

function deVanguard(): Record<string, unknown> {
    return {
        fuente: 'emisor:vanguard',
        url_fichero: 'https://ejemplo.invalid/vanguard/emt.xlsx',
        sha256_fichero: 'b'.repeat(64),
        version_plantilla: 'V4.2',
        fichero_generado: '2026-10-01',
        fecha_mercado_objetivo: '2026-01-31',
        ...bloqueComun(),
        objetivos: { crecimiento: 'SI', rentas: 'NEUTRAL' },
        preferencias_esg_consideradas: 'NEUTRAL'
    };
}

function deInvesco(): Record<string, unknown> {
    return {
        fuente: 'emisor:invesco',
        url_fichero: 'https://ejemplo.invalid/invesco/emt.csv',
        sha256_fichero: 'c'.repeat(64),
        version_plantilla: 'V4.2',
        fichero_generado: '2026-09-30',
        fecha_mercado_objetivo: '2025-12-31',
        ...bloqueComun(),
        objetivos: { crecimiento: 'SI', rentas: 'SI' },
        preferencias_esg_consideradas: 'NEUTRAL'
    };
}

function universal(isin: string, mercadoObjetivo: unknown, tipoProducto = 'etf'): Record<string, unknown> {
    return { _id: isin, identificacion: { tipo_producto: tipoProducto }, mercado_objetivo: mercadoObjetivo };
}

function documentoDe(isin: string, bloque: unknown, tipoProducto = 'etf'): Record<string, unknown> {
    const r = mapearMercadoObjetivo(universal(isin, bloque, tipoProducto));
    if (r.documento === null) throw new Error(`debia salir documento: ${r.avisos.join(' | ')}`);
    return r.documento.documento;
}

describe('el bloque mercado_objetivo de los tres emisores', () => {
    it('iShares: se traduce entero, SI/NO a YES/NO, y valida su contrato', () => {
        const r = mapearMercadoObjetivo(universal(ISHARES, deIshares()));
        expect(r.avisos).toEqual([]);
        expect(r.documento).not.toBeNull();
        expect(r.documento!.ruta).toBe(`instruments/${ISHARES}/declared/target_market`);
        expect(r.documento!.tipo).toBe(TIPO_MERCADO_OBJETIVO);
        expect(r.documento!.comoDueno).toBeUndefined();
        expect(r.documento!.documento).toEqual({
            source: 'issuer:ishares',
            source_url: 'https://ejemplo.invalid/ishares/emt.xlsx',
            sha256: 'a'.repeat(64),
            template_version: 'V4',
            file_generated_at: '2026-10-30',
            target_market_as_of: '2026-09-30',
            investor_type: { retail: 'YES', professional: 'YES', eligible_counterparty: 'YES' },
            knowledge: { basic: 'YES', informed: 'YES', advanced: 'YES' },
            loss_capacity: { no_loss: 'NO', no_guarantee: 'YES' },
            objectives: { capital_growth: 'YES', income: 'YES' },
            min_holding_period: { years: 5 },
            esg_preferences_considered: 'NEUTRAL',
            distribution: { execution_only: 'B', appropriateness: 'B', advice: 'B', portfolio_management: 'B' }
        });
        expect(validarEscritura(TIPO_MERCADO_OBJETIVO, r.documento!.documento, 'platform').ok).toBe(true);
    });

    it('Vanguard e Invesco: plantilla V4.2, cada uno con su fecha de mercado objetivo', () => {
        const vanguard = documentoDe(VANGUARD, deVanguard());
        expect(vanguard).toMatchObject({
            source: 'issuer:vanguard',
            template_version: 'V4.2',
            file_generated_at: '2026-10-01',
            target_market_as_of: '2026-01-31',
            objectives: { capital_growth: 'YES', income: 'NEUTRAL' }
        });
        const invesco = documentoDe(INVESCO, deInvesco());
        expect(invesco).toMatchObject({ source: 'issuer:invesco', template_version: 'V4.2', target_market_as_of: '2025-12-31' });
        for (const documento of [vanguard, invesco]) {
            expect(validarForma(TIPO_MERCADO_OBJETIVO, documento).ok).toBe(true);
        }
    });

    it('vale tambien para un fondo, no solo para un ETF', () => {
        expect(documentoDe(VANGUARD, deVanguard(), 'fondo')['source']).toBe('issuer:vanguard');
    });

    it('la fuente queda abierta a mas emisores, siempre con el prefijo issuer:', () => {
        expect(documentoDe(ISHARES, { ...deIshares(), fuente: 'emisor:amundi' })['source']).toBe('issuer:amundi');
        const sinPrefijo = mapearMercadoObjetivo(universal(ISHARES, { ...deIshares(), fuente: 'ishares' }));
        expect(sinPrefijo.documento).toBeNull();
        expect(sinPrefijo.avisos.join()).toContain('fuente');
    });
});

describe('sin fecha del mercado objetivo no hay documento', () => {
    it('un bloque sin fecha_mercado_objetivo no produce documento, y lo dice', () => {
        const { fecha_mercado_objetivo: _fuera, ...sinFecha } = deIshares();
        const r = mapearMercadoObjetivo(universal(ISHARES, sinFecha));
        expect(r.documento).toBeNull();
        expect(r.ausencia).toEqual({ ruta: SUFIJO_MERCADO_OBJETIVO, razon: 'NOT_PROVIDED', detalle: 'bloque mercado_objetivo incompleto' });
        expect(r.avisos.join()).toContain('fecha_mercado_objetivo (01000)');
    });

    it('una fecha que no existe o con hora detras tampoco vale', () => {
        for (const mala of ['2026-02-30', '2026-09-30T00:00:00Z', '30/09/2026', '0000-00-00', 20260930]) {
            const r = mapearMercadoObjetivo(universal(ISHARES, { ...deIshares(), fecha_mercado_objetivo: mala }));
            expect(r.documento, String(mala)).toBeNull();
        }
        expect(fechaEstricta('2024-02-29')).toBe('2024-02-29');
        expect(fechaEstricta('2026-02-29')).toBeUndefined();
    });

    it('faltando la huella, el fichero o la plantilla tampoco: sin ellos no se vuelve a la fila de origen', () => {
        for (const clave of ['url_fichero', 'sha256_fichero', 'version_plantilla', 'fuente']) {
            const bloque = deIshares();
            delete bloque[clave];
            expect(mapearMercadoObjetivo(universal(ISHARES, bloque)).documento, clave).toBeNull();
        }
        expect(mapearMercadoObjetivo(universal(ISHARES, { ...deIshares(), sha256_fichero: 'A'.repeat(64) })).documento).toBeNull();
    });

    it('una fecha de fichero mala se queda fuera con aviso, y el documento sale', () => {
        const r = mapearMercadoObjetivo(universal(ISHARES, { ...deIshares(), fichero_generado: '2026-13-01' }));
        expect(r.documento!.documento).not.toHaveProperty('file_generated_at');
        expect(r.avisos.join()).toContain('00005');
        const { fichero_generado: _fuera, ...sinGenerado } = deIshares();
        const sinAviso = mapearMercadoObjetivo(universal(ISHARES, sinGenerado));
        expect(sinAviso.documento!.documento).not.toHaveProperty('file_generated_at');
        expect(sinAviso.avisos).toEqual([]);
    });
});

describe('el periodo minimo (05080), en anos o en codigo', () => {
    it('en anos, tal cual, tambien con decimales y en cero', () => {
        expect(documentoDe(ISHARES, deIshares())['min_holding_period']).toEqual({ years: 5 });
        expect(documentoDe(ISHARES, { ...deIshares(), periodo_minimo: { anos: 3 } })['min_holding_period']).toEqual({ years: 3 });
        expect(documentoDe(ISHARES, { ...deIshares(), periodo_minimo: { anos: 0.92 } })['min_holding_period']).toEqual({ years: 0.92 });
        expect(documentoDe(ISHARES, { ...deIshares(), periodo_minimo: { anos: 0 } })['min_holding_period']).toEqual({ years: 0 });
    });

    it('en codigo, sin convertirlo a anos', () => {
        const documento = documentoDe(ISHARES, { ...deIshares(), periodo_minimo: { codigo: 'L' } });
        expect(documento['min_holding_period']).toEqual({ code: 'L' });
        expect(validarForma(TIPO_MERCADO_OBJETIVO, documento).ok).toBe(true);
    });

    it('lo que no es ni lo uno ni lo otro se queda fuera, con aviso, y el resto del documento sale', () => {
        for (const malo of [{ anos: 5, codigo: 'L' }, { codigo: 'X' }, { anos: -1 }, { anos: '5' }, { anos: 101 }, {}]) {
            const r = mapearMercadoObjetivo(universal(ISHARES, { ...deIshares(), periodo_minimo: malo }));
            expect(r.documento!.documento, JSON.stringify(malo)).not.toHaveProperty('min_holding_period');
            expect(r.avisos.join(), JSON.stringify(malo)).toContain('05080');
        }
    });

    it('el contrato admite uno solo de los dos', () => {
        const base = documentoDe(ISHARES, deIshares());
        expect(validarForma(TIPO_MERCADO_OBJETIVO, { ...base, min_holding_period: { years: 5, code: 'L' } }).ok).toBe(false);
        expect(validarForma(TIPO_MERCADO_OBJETIVO, { ...base, min_holding_period: {} }).ok).toBe(false);
    });
});

describe('lo que el emisor deja vacio queda ausente, nunca NEUTRAL', () => {
    it('un bloque con solo lo obligatorio da un documento con solo lo obligatorio', () => {
        const minimo = {
            fuente: 'emisor:invesco',
            url_fichero: 'https://ejemplo.invalid/invesco/emt.csv',
            sha256_fichero: 'c'.repeat(64),
            version_plantilla: 'V4.2',
            fecha_mercado_objetivo: '2025-12-31'
        };
        const documento = documentoDe(INVESCO, minimo);
        expect(Object.keys(documento).sort()).toEqual(['sha256', 'source', 'source_url', 'target_market_as_of', 'template_version']);
        expect(validarForma(TIPO_MERCADO_OBJETIVO, documento).ok).toBe(true);
    });

    it('un subbloque con huecos lleva solo lo que el emisor dio, y uno vacio no se escribe', () => {
        const documento = documentoDe(ISHARES, {
            ...deIshares(),
            tipo_inversor: { minorista: 'SI' },
            conocimiento: {},
            distribucion: { asesoramiento: 'R' },
            preferencias_esg_consideradas: undefined
        });
        expect(documento['investor_type']).toEqual({ retail: 'YES' });
        expect(documento).not.toHaveProperty('knowledge');
        expect(documento['distribution']).toEqual({ advice: 'R' });
        expect(documento).not.toHaveProperty('esg_preferences_considered');
        expect(JSON.stringify(documento)).not.toContain('NEUTRAL');
    });

    it('NEUTRAL se guarda como NEUTRAL: no se toma por un si', () => {
        const documento = documentoDe(ISHARES, { ...deIshares(), tipo_inversor: { minorista: 'NEUTRAL', profesional: 'SI' } });
        expect(documento['investor_type']).toEqual({ retail: 'NEUTRAL', professional: 'YES' });
    });

    it('el mercado objetivo negativo viaja: un NO en minorista o en basico es un NO', () => {
        const documento = documentoDe(ISHARES, { ...deIshares(), tipo_inversor: { minorista: 'NO', profesional: 'SI' }, conocimiento: { basico: 'NO' } });
        expect(documento['investor_type']).toEqual({ retail: 'NO', professional: 'YES' });
        expect(documento['knowledge']).toEqual({ basic: 'NO' });
    });
});

describe('el vocabulario se valida', () => {
    it('un valor que no es SI, NO o NEUTRAL se queda fuera con aviso; el resto sale', () => {
        const r = mapearMercadoObjetivo(
            universal(ISHARES, { ...deIshares(), tipo_inversor: { minorista: 'Y', profesional: 'neutral', contraparte_elegible: 'SI' } })
        );
        expect(r.documento!.documento['investor_type']).toEqual({ eligible_counterparty: 'YES' });
        expect(r.avisos.join()).toContain('minorista (01010)');
        expect(r.avisos.join()).toContain('profesional (01020)');
    });

    it('el 05105 no admite NO, y un canal fuera de R/P/B/N tampoco entra', () => {
        const r = mapearMercadoObjetivo(
            universal(ISHARES, { ...deIshares(), preferencias_esg_consideradas: 'NO', distribucion: { solo_ejecucion: 'X', asesoramiento: 'B' } })
        );
        expect(r.documento!.documento).not.toHaveProperty('esg_preferences_considered');
        expect(r.documento!.documento['distribution']).toEqual({ advice: 'B' });
        expect(r.avisos.join()).toContain('05105');
        expect(r.avisos.join()).toContain('06010');
        expect(documentoDe(ISHARES, { ...deIshares(), preferencias_esg_consideradas: 'SI' })['esg_preferences_considered']).toBe('YES');
    });

    it('el 03050 no tiene sitio: si alguna vez llega, se avisa y no se escribe', () => {
        const r = mapearMercadoObjetivo(
            universal(ISHARES, { ...deIshares(), capacidad_perdidas: { sin_perdidas: 'NO', sin_garantia: 'SI', mas_alla_del_capital: 'SI' } })
        );
        expect(r.documento!.documento['loss_capacity']).toEqual({ no_loss: 'NO', no_guarantee: 'YES' });
        expect(r.avisos.join()).toContain('mas_alla_del_capital');
        const esquema = cargarEsquemas().find((e) => e.fichero === TIPO_MERCADO_OBJETIVO)!;
        const capacidad = rutasDe(esquema).filter((ruta) => ruta.ruta.startsWith('loss_capacity.')).map((ruta) => ruta.ruta);
        expect(capacidad).toEqual(['loss_capacity.no_loss', 'loss_capacity.no_guarantee']);
        expect(String(esquema.json['description'])).toContain('03050');
    });

    it('una clave de mas en el bloque se avisa y no rompe nada', () => {
        const r = mapearMercadoObjetivo(universal(ISHARES, { ...deIshares(), sri: 4 }));
        expect(r.documento!.documento).not.toHaveProperty('sri');
        expect(r.avisos.join()).toContain('mercado_objetivo.sri');
    });

    it('la funcion del bloque es pura: el mismo bloque da el mismo documento', () => {
        const a: string[] = [];
        const b: string[] = [];
        expect(documentoDelMercadoObjetivo(deIshares(), a)).toEqual(documentoDelMercadoObjetivo(deIshares(), b));
        expect(documentoDelMercadoObjetivo(undefined, a)).toBeNull();
        expect(documentoDelMercadoObjetivo({}, a)).toBeNull();
    });
});

describe('quien lleva documento y quien no', () => {
    it('sin bloque no hay documento ni aviso: la mayoria no lo tiene', () => {
        expect(mapearMercadoObjetivo({ _id: ISHARES, identificacion: { tipo_producto: 'etf' } })).toEqual({ documento: null, avisos: [] });
    });

    it('fuera de FUND y ETF no se escribe: el oro fisico tiene EMT y es OTHER', () => {
        const r = mapearMercadoObjetivo(universal(ORO_FISICO, deIshares(), 'etc'));
        expect(r.documento).toBeNull();
        expect(r.avisos.join()).toContain('tipo sin contrato');
        expect(mapearMercadoObjetivo(universal('ES0178430E18', deIshares(), 'accion')).documento).toBeNull();
    });

    it('sin ISIN valido no hay documento', () => {
        expect(mapearMercadoObjetivo(universal('no-es-un-isin', deIshares())).documento).toBeNull();
    });
});

describe('el contrato y su registro', () => {
    const esquema = cargarEsquemas().find((e) => e.fichero === TIPO_MERCADO_OBJETIVO)!;

    it('existe, aplica a fondos y ETF y no cuenta nunca en la cobertura', () => {
        expect(esquema).toBeDefined();
        expect(esquema.coleccion).toBe('instruments/{instrument_id}/declared/target_market');
        expect(esquema.json['x-applies-when']).toBe('FONDO_O_ETF');
        expect(esquema.json['x-counts-when']).toBe('NUNCA');
        const cuentan = rutasDe(esquema).filter((ruta) => ruta.esHoja && ruta.cuentaCuando !== 'NUNCA');
        expect(cuentan.map((ruta) => ruta.ruta)).toEqual([]);
    });

    it('la descripcion dice lo que no es: sin EET, uso interno, nunca en informes de cliente', () => {
        const descripcion = String(esquema.json['description']);
        for (const frase of ['SOLO EL EMT', 'EET', 'decision 53', 'informe de cliente', '03050']) expect(descripcion).toContain(frase);
    });

    it('exige la fecha del mercado objetivo y no admite un campo inventado', () => {
        const base = documentoDe(ISHARES, deIshares());
        const { target_market_as_of: _fuera, ...sinFecha } = base;
        expect(validarForma(TIPO_MERCADO_OBJETIVO, sinFecha).ok).toBe(false);
        expect(validarForma(TIPO_MERCADO_OBJETIVO, { ...base, sri: 4 }).ok).toBe(false);
        expect(validarForma(TIPO_MERCADO_OBJETIVO, { ...base, esg_preferences_considered: 'NO' }).ok).toBe(false);
        expect(validarForma(TIPO_MERCADO_OBJETIVO, { ...base, investor_type: { retail: 'SI' } }).ok).toBe(false);
    });

    it('esta en el registro de bloques: sobrantes, auditoria y lote lo conocen', () => {
        expect(BLOQUES_DE_INSTRUMENTO[SUFIJO_MERCADO_OBJETIVO]).toBe(TIPO_MERCADO_OBJETIVO);
        expect(rutasPosiblesDe(ISHARES)).toContain(`instruments/${ISHARES}/declared/target_market`);
    });

    it('sube con el catalogo: subirALaNube lee las subcolecciones que declaran los contratos, y esta esta', () => {
        expect(subcoleccionesDeclaradas().get('instruments/*/declared/target_market')).toBe(TIPO_MERCADO_OBJETIVO);
    });

    it('no mueve la calidad, y de la tarjeta solo cambia la lista de secciones que existen', () => {
        const AHORA = '2026-11-09T12:00:00.000Z';
        const sin: InstrumentoLeido = {
            instrument_id: ISHARES,
            raiz: {
                instrument_id: ISHARES,
                instrument_type: 'ETF',
                schema_version: 'base-nueva.instrument.v2',
                updated_at: AHORA,
                identity: { name: 'Un ETF', name_folded: 'un etf', currency: 'USD' },
                classification: { category: 'RV Global', asset_class: 'EQUITY', official_benchmark: { name: 'Un Indice Global' } }
            },
            bloques: {
                'declared/costs': { source: 'canonical:fondosdb', as_of: '2026-09-30', ongoing_charge: 0.002 }
            }
        };
        const con: InstrumentoLeido = { ...sin, bloques: { ...sin.bloques, [SUFIJO_MERCADO_OBJETIVO]: documentoDe(ISHARES, deIshares()) } };
        const calidadSin = calcularCalidad(sin, AHORA);
        const calidadCon = calcularCalidad(con, AHORA);
        expect(calidadCon.documento).toEqual(calidadSin.documento);
        /* `available_sections` dice qué documentos hay que leer, y es lo que usa la app para pedirlos: que nombre `target_market`
           es lo que hará que la ficha lo lea. Nada más de la tarjeta cambia. */
        const tarjetaSin = componerTarjeta(sin, calidadSin, AHORA)!;
        const tarjetaCon = componerTarjeta(con, calidadCon, AHORA)!;
        expect(tarjetaCon['available_sections']).toEqual(['costs', 'target_market']);
        expect(tarjetaSin['available_sections']).toEqual(['costs']);
        expect({ ...tarjetaCon, available_sections: [] }).toEqual({ ...tarjetaSin, available_sections: [] });
        expect(validarForma('instrument-read-card.v2.schema.json', tarjetaCon).ok).toBe(true);
    });
});
