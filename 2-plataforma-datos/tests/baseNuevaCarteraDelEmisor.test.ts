import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

import {
    COLECCION_DE_TROZOS,
    CONTRATOS_FUERA_DE_LA_SUBIDA,
    TIPO_RESUMEN,
    TIPO_TROZO,
    esDeLaCarteraDelEmisor,
    mapearCarteraDelEmisor,
    type LineaDelExtractor
} from '../src/ingestion/baseNueva/carteraDelEmisor';
import { BLOQUES_DE_INSTRUMENTO, rutasPosiblesDe } from '../src/ingestion/baseNueva/mapper';
import { validarForma } from '../src/config/baseNueva/validadores';
import { cargarEsquemas, subcoleccionesDeclaradas } from '../src/config/baseNueva/esquemas';

/**
 * La cartera completa del emisor de un ETF (decisión B-79, 11-11-2026): uso interno, solo para el asesor.
 *
 * Los cuatro casos del encargo —un ETF físico, uno sintético que no se usa, uno troceado y uno que no se puede leer— y lo que
 * la hace segura: que vive aparte de `declared/holdings`, que lo dice en el dato, y que no sube a la nube sin pedirlo.
 */

const ISIN = 'IE00B5BMR087';

function cabecera(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        isin: ISIN,
        fuente: 'ishares',
        fecha: '2026-11-06',
        fecha_descarga: '2026-11-09T23:48:55+00:00',
        url: 'https://www.blackrock.com/x/get-fund-document?portfolioId=253743',
        obtenido: '2026-11-09T23:48:55+00:00',
        replica: 'fisica',
        uso: 'medir',
        num_posiciones: 3,
        num_posiciones_declarado: 2,
        lineas_sin_tipo: 0,
        ...extra
    };
}

function lineasIshares(cuantas: number): Record<string, unknown>[] {
    return Array.from({ length: cuantas }, (_, i) => ({
        nombre: `ACCION ${i + 1}`,
        ticker: `T${i + 1}`,
        /* Decrecientes y sumando cerca del 100 %. */
        peso_pct: Math.round(((2 * (cuantas - i)) / (cuantas * (cuantas + 1))) * 100 * 1e6) / 1e6,
        clase_activo: 'Equity',
        tipo: 'accion',
        sector: 'Information Technology',
        divisa: 'USD',
        valor_mercado: (cuantas - i) * 1000,
        divisa_valor_mercado: 'USD'
    }));
}

function enPartes(posiciones: Record<string, unknown>[], porParte: number, extra: Record<string, unknown> = {}): LineaDelExtractor[] {
    const partes: Record<string, unknown>[][] = [];
    for (let i = 0; i < posiciones.length; i += porParte) partes.push(posiciones.slice(i, i + porParte));
    return partes.map((parte, i) => ({ ...cabecera(extra), parte: i + 1, total_partes: partes.length, posiciones: parte }));
}

function todosValidan(documentos: { tipo: string; documento: unknown; ruta: string }[]): void {
    for (const d of documentos) {
        const veredicto = validarForma(d.tipo, d.documento);
        expect(veredicto.ok, `${d.ruta}: ${JSON.stringify(veredicto)}`).toBe(true);
    }
}

describe('cartera del emisor: un ETF fisico', () => {
    const { documentos, avisos } = mapearCarteraDelEmisor(ISIN, enPartes([
        { nombre: 'APPLE', ticker: 'AAPL', peso_pct: 7.86, clase_activo: 'Equity', tipo: 'accion', sector: 'Information Technology',
          divisa: 'USD', valor_mercado: 12044965532.32, divisa_valor_mercado: 'USD' },
        { nombre: 'USD CASH', ticker: 'USD', peso_pct: -0.66, clase_activo: 'Cash', tipo: 'liquidez', divisa: 'USD',
          valor_mercado: -9000000, divisa_valor_mercado: 'USD' },
        { nombre: 'S&P500 EMINI DEC 26', ticker: 'ESZ6', peso_pct: 0, clase_activo: 'Futures', tipo: 'derivado',
          valor_mercado: 0, divisa_valor_mercado: 'USD' }
    ], 2000));

    it('escribe el resumen y un trozo, y los dos validan contra su contrato', () => {
        expect(avisos).toEqual([]);
        expect(documentos.map((d) => d.ruta)).toEqual([
            `instruments/${ISIN}/declared/issuer_holdings`,
            `instruments/${ISIN}/${COLECCION_DE_TROZOS}/000`
        ]);
        todosValidan(documentos);
    });

    it('el resumen dice para quien es, de donde sale y que sirve para medir', () => {
        const r = documentos[0]!.documento;
        expect(r['audience']).toBe('ADVISOR_ONLY');
        expect(r['source']).toBe('issuer:ishares');
        expect(r['as_of']).toBe('2026-11-06');
        expect(r['retrieved_on']).toBe('2026-11-09');
        expect(r['nature']).toBe('PORTFOLIO');
        expect(r['usable_for_measurement']).toBe(true);
        expect(r['not_usable_reason']).toBeUndefined();
        expect(r['positions_count']).toBe(3);
        expect(r['declared_positions_count']).toBe(2);
        expect(r['chunk_count']).toBe(1);
        expect(r['weights_sum']).toBeCloseTo(0.072, 10);
        expect(r['weight_step']).toBeCloseTo(0.0001, 12);
        expect(r['market_value_currency']).toBe('USD');
        expect(r['market_value_total']).toBeCloseTo(12035965532.32, 2);
    });

    it('cada linea lleva el peso en fraccion con su signo, su tipo y el literal del emisor', () => {
        const [apple, caja, futuro] = documentos[1]!.documento['positions'] as Record<string, unknown>[];
        expect(apple).toEqual({
            name: 'APPLE', weight: 0.0786, ticker: 'AAPL', position_type: 'EQUITY', issuer_asset_class: 'Equity',
            issuer_sector: 'Information Technology', currency: 'USD', market_value: 12044965532.32
        });
        expect(caja!['weight']).toBeCloseTo(-0.0066, 12);
        expect(caja!['position_type']).toBe('CASH');
        expect(futuro!['position_type']).toBe('DERIVATIVE');
    });

    it('no toca la cartera del proveedor', () => {
        for (const d of documentos) {
            expect(d.ruta).not.toMatch(/\/declared\/holdings$/);
            expect(d.ruta).not.toMatch(/\/holdings_chunks\//);
        }
    });
});

describe('cartera del emisor: un ETF sintetico no se mide', () => {
    it('solo escribe el resumen, sin posiciones, y dice por que', () => {
        const { documentos } = mapearCarteraDelEmisor(
            'LU0274211480',
            enPartes(lineasIshares(40), 2000, {
                isin: 'LU0274211480', fuente: 'xtrackers', replica: 'sintetica', naturaleza: 'cesta_de_sustitucion',
                uso: 'no_medir', motivo_no_medir: 'cesta_de_sustitucion'
            })
        );
        expect(documentos).toHaveLength(1);
        const r = documentos[0]!.documento;
        expect(r['usable_for_measurement']).toBe(false);
        expect(r['not_usable_reason']).toBe('SUBSTITUTE_BASKET');
        expect(r['nature']).toBe('SUBSTITUTE_BASKET');
        expect(r['chunk_count']).toBe(0);
        expect(r['positions_count']).toBe(40);
        todosValidan(documentos);
    });

    it('el contrato no deja decir que sirve sin decir por que no cuando no sirve: el motivo es de la lista', () => {
        const { documentos, avisos } = mapearCarteraDelEmisor(ISIN, enPartes(lineasIshares(5), 2000, {
            uso: 'no_medir', motivo_no_medir: 'porque_si'
        }));
        expect(documentos).toEqual([]);
        expect(avisos[0]).toMatch(/sin motivo conocido/);
    });
});

describe('cartera del emisor: una cartera grande se trocea', () => {
    /* 4.500 lineas que el extractor manda en tres partes de 2.000: aqui son nueve trozos de 500. */
    const { documentos } = mapearCarteraDelEmisor('IE00BDBRDM35', enPartes(lineasIshares(4500), 2000, { isin: 'IE00BDBRDM35' }));
    const trozos = documentos.filter((d) => d.tipo === TIPO_TROZO);

    it('en trozos de 500, numerados y validos', () => {
        expect(trozos.map((d) => d.ruta.split('/').pop())).toEqual(['000', '001', '002', '003', '004', '005', '006', '007', '008']);
        expect(trozos.every((d) => (d.documento['positions'] as unknown[]).length === 500)).toBe(true);
        expect(documentos[0]!.documento['chunk_count']).toBe(9);
        expect(documentos[0]!.documento['positions_count']).toBe(4500);
        todosValidan(documentos);
    });

    it('conserva el orden: el trozo 000 lleva las mayores', () => {
        const primera = (trozos[0]!.documento['positions'] as Record<string, unknown>[])[0]!;
        const ultima = (trozos[8]!.documento['positions'] as Record<string, unknown>[])[499]!;
        expect(primera['name']).toBe('ACCION 1');
        expect(ultima['name']).toBe('ACCION 4500');
    });

    it('una cartera recortada por el tope no se trocea', () => {
        const recortada = mapearCarteraDelEmisor(ISIN, enPartes(lineasIshares(10), 2000, {
            uso: 'no_medir', motivo_no_medir: 'recortada', posiciones_guardadas: 10
        }));
        expect(recortada.documentos).toHaveLength(1);
        expect(recortada.documentos[0]!.documento['not_usable_reason']).toBe('TRUNCATED');
    });

    it('un valor de mercado que falta en una linea no se suma en ninguna', () => {
        const lineas = lineasIshares(3);
        delete lineas[1]!['valor_mercado'];
        const { documentos: docs, avisos } = mapearCarteraDelEmisor(ISIN, enPartes(lineas, 2000));
        expect(docs[0]!.documento['market_value_total']).toBeUndefined();
        expect((docs[1]!.documento['positions'] as Record<string, unknown>[]).some((p) => 'market_value' in p)).toBe(false);
        expect(avisos[0]).toMatch(/valor de mercado/);
    });
});

describe('cartera del emisor: uno que no se puede leer', () => {
    it('sin lineas del extractor no escribe nada', () => {
        expect(mapearCarteraDelEmisor('DE0005933956', [])).toEqual({ documentos: [], avisos: [] });
    });

    it('con partes que no cuadran no escribe nada, y lo dice', () => {
        const partes = enPartes(lineasIshares(4500), 2000);
        const { documentos, avisos } = mapearCarteraDelEmisor(ISIN, [partes[0]!, partes[2]!]);
        expect(documentos).toEqual([]);
        expect(avisos[0]).toMatch(/partes que no cuadran/);
    });
});

describe('cartera del emisor: aparte, solo para el asesor y fuera de la subida', () => {
    it('el resumen es un bloque del instrumento y los trozos una subcoleccion propia, distinta de holdings_chunks', () => {
        expect(BLOQUES_DE_INSTRUMENTO['declared/issuer_holdings']).toBe(TIPO_RESUMEN);
        expect(rutasPosiblesDe(ISIN)).toContain(`instruments/${ISIN}/declared/issuer_holdings`);
        expect(subcoleccionesDeclaradas().get(`instruments/*/${COLECCION_DE_TROZOS}/*`)).toBe(TIPO_TROZO);
        expect(COLECCION_DE_TROZOS).not.toBe('holdings_chunks');
    });

    it('los dos contratos dicen que son de uso interno y que ningun camino de cliente los lee', () => {
        for (const fichero of [TIPO_RESUMEN, TIPO_TROZO]) {
            const esquema = cargarEsquemas().find((e) => e.fichero === fichero);
            const descripcion = String(esquema?.json['description']);
            expect(descripcion, fichero).toMatch(/B-53/);
            expect(descripcion, fichero).toMatch(/B-79/);
            expect(descripcion, fichero).toMatch(/NINGUN camino de cliente/);
        }
    });

    it('no cuenta en la cobertura', () => {
        const esquema = cargarEsquemas().find((e) => e.fichero === TIPO_RESUMEN);
        expect(esquema?.json['x-counts-when']).toBe('NUNCA');
    });

    it('solo-cartera-del-emisor deja pasar sus dos rutas y ninguna otra', () => {
        expect(esDeLaCarteraDelEmisor(`instruments/${ISIN}/declared/issuer_holdings`)).toBe(true);
        expect(esDeLaCarteraDelEmisor(`instruments/${ISIN}/${COLECCION_DE_TROZOS}/003`)).toBe(true);
        expect(esDeLaCarteraDelEmisor(`instruments/${ISIN}/declared/holdings`)).toBe(false);
        expect(esDeLaCarteraDelEmisor(`instruments/${ISIN}/holdings_chunks/000`)).toBe(false);
        expect(esDeLaCarteraDelEmisor(`instruments/${ISIN}/declared/issuer_data`)).toBe(false);
        expect(esDeLaCarteraDelEmisor(`instruments/${ISIN}`)).toBe(false);
    });

    it('la subida a la nube la deja fuera salvo que se pida', () => {
        expect([...CONTRATOS_FUERA_DE_LA_SUBIDA].sort()).toEqual([TIPO_RESUMEN, TIPO_TROZO].sort());
        const subida = readFileSync(join(__dirname, '..', 'scripts', 'subirALaNube.ts'), 'utf-8');
        expect(subida).toMatch(/if \(!conCarteraDelEmisor && CONTRATOS_FUERA_DE_LA_SUBIDA\.has\(fichero\)\) continue;/);
        expect(subida).toMatch(/bandera\('con-cartera-del-emisor'\)/);
    });
});
