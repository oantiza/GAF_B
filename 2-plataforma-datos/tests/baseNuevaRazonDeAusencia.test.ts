import { describe, it, expect } from 'vitest';

import { razonSinMetricasPropias, MOTIVOS_DEL_EXTRACTOR } from '../src/ingestion/baseNueva/mapper';
import { AUSENCIAS } from '../src/config/baseNueva/vocabulario';
import { ETIQUETAS_AUSENCIA } from '../src/config/baseNueva/etiquetas';

/**
 * Por qué falta una métrica: la razón se LEE del motivo, no se supone.
 *
 * Esto existe por el hallazgo del 03-11-2026. Los dos sitios que registran la ausencia de
 * `computed/metrics` escribían `NOT_YET_FETCHED` siempre, y medido sobre la base esa razón era
 * falsa en **137 de los 149** instrumentos sin métricas. No era un matiz de etiqueta: la glosa
 * de `NOT_YET_FETCHED` dice «la fuente lo tiene y todavía no lo hemos traído», o sea afirma
 * algo sobre la FUENTE, y de eso no había prueba en ninguno de los 137.
 *
 * Y las tres se deciden al contrario: «aún no pedido» es trabajo pendiente, «no facilitado» es
 * un techo de la fuente y «no aplica» no es nada que arreglar. Prometer la primera cuando la
 * verdad es la segunda hace que alguien espere un dato que no va a llegar.
 *
 * La prueba que importa a largo plazo es la última: `NOT_YET_FETCHED` solo puede salir del
 * único motivo que lo justifica. Si alguien vuelve a ponerlo por defecto, se pone roja.
 */
const sinNada: Record<string, unknown> = {};

describe('la razon de que no haya metricas propias', () => {
    it('cada motivo del extractor da su razon, y son tres distintas', () => {
        const perdidas: string[] = [];
        // La clase reparte: el metodo mensual presupone retorno total, asi que no hay cifra
        // que dar con ESTE metodo. No es un dato que la fuente no haya servido.
        expect(razonSinMetricasPropias({ aviso_metricas: 'sin_metricas_historial_repartos' }, 'FUND', perdidas).razon).toBe(
            'NOT_APPLICABLE'
        );
        // El unico grupo donde «aun no pedido» es VERDAD: el calculo se paro por el nombre de
        // la clase y su politica esta en su KID, que no ha entrado en el canonico.
        expect(razonSinMetricasPropias({ aviso_metricas: 'sin_metricas_nombre_reparto' }, 'FUND', perdidas).razon).toBe(
            'NOT_YET_FETCHED'
        );
        expect(
            razonSinMetricasPropias({ aviso_metricas: 'sin_metricas_politica_desconocida' }, 'FUND', perdidas).razon
        ).toBe('NOT_PROVIDED');
        expect(perdidas).toEqual([]);
    });

    it('una serie que la fuente dejo de servir es techo de la fuente, no una peticion pendiente', () => {
        const perdidas: string[] = [];
        const razon = razonSinMetricasPropias({ aviso_vl: 'serie_parada(1711d)' }, 'FUND', perdidas);
        expect(razon.razon).toBe('NOT_PROVIDED');
        expect(razon.detalle).toContain('1711d');
    });

    it('sin serie es que la fuente no la dio: un 404 o un 200 con el cuerpo vacio', () => {
        const perdidas: string[] = [];
        expect(razonSinMetricasPropias(sinNada, 'FUND', perdidas).razon).toBe('NOT_PROVIDED');
        expect(razonSinMetricasPropias({ observations_count: 0 }, 'FUND', perdidas).razon).toBe('NOT_PROVIDED');
    });

    it('un ETF con serie larga NO es un hueco de la fuente: es que nadie calcula sobre ella', () => {
        /*
         * Es el caso de los 18 ETF, y el que hacia falsa la etiqueta anterior en los dos
         * sentidos. Medido el 03-11-2026: 17 de 18 tienen serie de mercado de entre 480 y
         * 8.498 observaciones, y `1-extractor/fetchers/eodhd.py:908` devuelve el listado y
         * vuelve antes de la llamada que calcula. Decir «la fuente no lo da» de una serie de
         * 8.498 observaciones es afirmar que falta un dato que esta.
         */
        const perdidas: string[] = [];
        const etf = razonSinMetricasPropias({ observations_count: 8498 }, 'ETF', perdidas);
        expect(etf.razon).toBe('NOT_APPLICABLE');
        expect(etf.detalle).toContain('8498');
        expect(etf.detalle).toContain('via de calculo');
        // El mismo dato en un fondo si es longitud de serie.
        expect(razonSinMetricasPropias({ observations_count: 120 }, 'FUND', perdidas).razon).toBe('NOT_PROVIDED');
    });

    it('un motivo nuevo se NOMBRA como perdida en vez de convertirse en etiqueta', () => {
        /*
         * La diferencia entre no saber y afirmar. El vocabulario de motivos esta medido y es
         * cerrado hoy, asi que esta rama no deberia dispararse nunca; el dia que el extractor
         * invente uno, aparece en el plan y en la auditoria en vez de disfrazarse de razon.
         */
        const perdidas: string[] = [];
        const razon = razonSinMetricasPropias({ aviso_metricas: 'sin_metricas_algo_nuevo' }, 'FUND', perdidas);
        expect(razon.razon).not.toBe('NOT_YET_FETCHED');
        expect(razon.detalle).toContain('sin_metricas_algo_nuevo');
        expect(perdidas).toEqual(['riesgo.historial_precios.aviso_metricas = sin_metricas_algo_nuevo, sin clasificar']);
    });

    it('toda razon que sale de aqui esta en el vocabulario', () => {
        const perdidas: string[] = [];
        const casos: Array<[Record<string, unknown>, string | undefined]> = [
            [sinNada, 'FUND'],
            [{ observations_count: 5 }, 'STOCK'],
            [{ observations_count: 5 }, 'ETF'],
            [{ observations_count: 5 }, undefined],
            [{ aviso_vl: 'serie_parada(34d)' }, 'FUND'],
            ...Object.keys(MOTIVOS_DEL_EXTRACTOR).map(
                (m) => [{ aviso_metricas: m }, 'FUND'] as [Record<string, unknown>, string]
            )
        ];
        const permitidas = new Set<string>(AUSENCIAS as readonly string[]);
        for (const [historial, tipo] of casos) {
            const razon = razonSinMetricasPropias(historial, tipo, perdidas).razon;
            expect(permitidas.has(razon), `${razon} no esta en AUSENCIAS`).toBe(true);
            // Y tiene glosa: una razon sin glosa no se puede pintar.
            expect(ETIQUETAS_AUSENCIA[razon]?.glosa ?? '').not.toBe('');
        }
    });

    it('NOT_YET_FETCHED solo sale del unico motivo que lo justifica', () => {
        /*
         * La prueba que caza la reincidencia, y la que habria fallado contra el arbol de ayer:
         * entonces TODAS estas entradas devolvian NOT_YET_FETCHED. Afirmar que la fuente tiene
         * el dato exige saber cual es la fuente y que lo tiene; de las siete entradas de abajo,
         * solo una lo sabe.
         */
        const perdidas: string[] = [];
        const entradas: Array<[Record<string, unknown>, string | undefined]> = [
            [sinNada, 'FUND'],
            [{ observations_count: 0 }, 'FUND'],
            [{ observations_count: 8498 }, 'ETF'],
            [{ observations_count: 99 }, 'STOCK'],
            [{ aviso_vl: 'serie_parada(34d)' }, 'FUND'],
            [{ aviso_metricas: 'sin_metricas_historial_repartos' }, 'FUND'],
            [{ aviso_metricas: 'sin_metricas_politica_desconocida' }, 'FUND'],
            [{ aviso_metricas: 'sin_metricas_desconocido_del_futuro' }, 'FUND']
        ];
        for (const [historial, tipo] of entradas) {
            expect(
                razonSinMetricasPropias(historial, tipo, perdidas).razon,
                `${JSON.stringify(historial)} / ${String(tipo)}`
            ).not.toBe('NOT_YET_FETCHED');
        }
        // Y el que si: la politica esta en el KID y no ha entrado en el canonico.
        expect(razonSinMetricasPropias({ aviso_metricas: 'sin_metricas_nombre_reparto' }, 'FUND', perdidas).razon).toBe(
            'NOT_YET_FETCHED'
        );
    });
});
