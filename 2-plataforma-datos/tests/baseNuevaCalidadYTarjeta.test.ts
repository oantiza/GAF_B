import { describe, it, expect } from 'vitest';

import { medimosLoMismo,
    avisosDe,
    calcularCalidad,
    componerTarjeta,
    huellaDeLasRutas,
    type InstrumentoLeido
} from '../src/ingestion/baseNueva/calidadYTarjeta';
import { aplicaAlInstrumento } from '../src/ingestion/baseNueva/aplicabilidad';
import { puedeEscribir, validarEscritura, validarForma } from '../src/config/baseNueva/validadores';
import { cargarEsquemas, rutasDe } from '../src/config/baseNueva/esquemas';
import { APTITUDES, PREDICADOS_DE_APLICABILIDAD } from '../src/config/baseNueva/vocabulario';
import { aptitudesDe } from '../src/config/baseNueva/aptitudes';

/**
 * El lote: `quality/latest` y `read/card`.
 *
 * Lo que de verdad se comprueba aquí no es que salgan documentos, es que la cobertura esté
 * calculada sobre la población a la que cada campo APLICA. Esa es la lección del 30-10, y es
 * la que convirtió un «la composición está entre el 20 % y el 77 %» en «está entre el 96 % y
 * el 99 %» sin que cambiara ni un dato.
 */

const AHORA = '2026-11-01T12:00:00.000Z';
const ISIN = 'IE00BYR8H148';

function instrumento(cambios: Partial<InstrumentoLeido> = {}): InstrumentoLeido {
    return {
        instrument_id: ISIN,
        raiz: {
            instrument_id: ISIN,
            instrument_type: 'FUND',
            schema_version: 'base-nueva.instrument.v2',
            updated_at: AHORA,
            identity: { name: 'Un fondo', name_folded: 'un fondo', currency: 'EUR' },
            classification: {
                category: 'RV Global',
                asset_class: 'EQUITY',
                official_benchmark: { name: 'Un Indice Global' }
            }
        },
        bloques: {
            'declared/profile': {
                source: 'canonical:fondosdb',
                as_of: '2026-09-30',
                distribution_policy: 'UNKNOWN'
            },
            'declared/costs': { source: 'canonical:fondosdb', as_of: '2026-09-30', ongoing_charge: 0.0053 },
            'declared/regulatory': {
                source: 'canonical:fondosdb',
                as_of: '2026-09-30',
                sri: 4,
                srri: 5,
                kid_evidence: {
                    document_url: `https://ejemplo.invalid/${ISIN}.pdf`,
                    sha256: 'a'.repeat(64),
                    document_date: '2026-10-01',
                    isin_evidence: 'DOCUMENT_URL'
                }
            },
            'declared/exposure': {
                source: 'canonical:fondosdb',
                as_of: '2026-09-30',
                asset_mix: { equity: 0.95, fixed_income: 0, cash: 0.05, other: 0 },
                asset_mix_completion: 'REPORTED',
                sectors: { tecnologia: 0.3 },
                confidence: 0.9
            },
            'declared/provider_risk': {
                source: 'canonical:fondosdb',
                as_of: '2026-09-30',
                return_basis: 'TOTAL_RETURN',
                volatility: { '3y': { fund: 0.1234, category: 0.111, benchmark: 0.1 } },
                sharpe: { '3y': { fund: 0.42 } },
                provider_alpha: { '3y': { vs_benchmark: 0.015 } },
                beta: { '3y': { vs_benchmark: 0.98 } },
                r2: { '3y': { vs_benchmark: 0.9304 } }
            },
            'declared/provider_returns': {
                source: 'canonical:fondosdb',
                as_of: '2026-09-30',
                return_basis: 'TOTAL_RETURN',
                trailing_return: { '3y': { fund: 0.025 } },
                ytd_return: { fund: 0.011 }
            },
            'declared/holdings': {
                source: 'canonical:fondosdb',
                as_of: '2026-09-30',
                positions_count: 88,
                top10_weight: 0.36,
                top: [{ name: 'Una Empresa', weight: 0.045 }]
            }
        },
        ...cambios
    };
}

describe('la tarjeta dice si cotiza y en que divisa esta el precio', () => {
    const tarjeta = (cambios: Partial<InstrumentoLeido> = {}) => {
        const material = instrumento(cambios);
        const compuesta = componerTarjeta(material, calcularCalidad(material, AHORA), AHORA)!;
        expect(validarForma('instrument-read-card.v2.schema.json', compuesta).ok).toBe(true);
        return compuesta;
    };
    const conRaiz = (extra: Record<string, unknown>) => ({ raiz: { ...instrumento().raiz, ...extra } });

    it('una baja lleva su estado y su fecha, que es lo que marca la fila', () => {
        const compuesta = tarjeta(conRaiz({ availability: { state: 'DELISTED', since: '2026-09-21', last_checked: '2026-11-02' } }));
        expect(compuesta['availability']).toEqual({ state: 'DELISTED', since: '2026-09-21' });
    });

    it('sin medir no se afirma nada: un fondo no lleva el campo', () => {
        expect(tarjeta()).not.toHaveProperty('availability');
    });

    it('el precio lleva su divisa si el bloque la trae', () => {
        const con = instrumento();
        con.bloques['declared/quote'] = { source: 'canonical:fondosdb', as_of: '2026-11-03', price: 129.07, price_class: 'MARKET_PRICE', currency: 'EUR' };
        expect(tarjeta({ bloques: con.bloques })['quote']).toEqual({ price: 129.07, as_of: '2026-11-03', price_class: 'MARKET_PRICE', currency: 'EUR' });
    });

    it('y sin ella el precio sigue: la tarjeta de antes del 05-11-2026 no la trae', () => {
        const con = instrumento();
        con.bloques['declared/quote'] = { source: 'canonical:fondosdb', as_of: '2026-11-03', price: 129.07, price_class: 'MARKET_PRICE' };
        expect(tarjeta({ bloques: con.bloques })['quote']).toEqual({ price: 129.07, as_of: '2026-11-03', price_class: 'MARKET_PRICE' });
    });
});

describe('el reparto neto llega a la tarjeta tal cual (decision A-63)', () => {
    const LAZARD = { equity: 1.000401, fixed_income: -0.000844, cash: 0.000432, other: 0.000011 };
    const conMezcla = (mezcla: Record<string, number>) => {
        const material = instrumento();
        material.bloques['declared/exposure'] = { ...material.bloques['declared/exposure'], asset_mix: mezcla };
        return material;
    };

    it('la cifra negativa pasa, y la tarjeta valida contra su contrato', () => {
        const material = conMezcla(LAZARD);
        const compuesta = componerTarjeta(material, calcularCalidad(material, AHORA), AHORA)!;
        expect((compuesta['exposure'] as Record<string, unknown>)['asset_mix']).toEqual(LAZARD);
        expect(validarEscritura('instrument-read-card.v2.schema.json', compuesta, 'batch').motivos).toEqual([]);
    });

    it('vuelve a servir para una radiografia, y una renta fija negativa no pide detalle de renta fija', () => {
        const material = conMezcla(LAZARD);
        expect(aptitudesDe(material).RADIOGRAFIA_DE_CARTERA.apt).toBe(true);
        expect(aplicaAlInstrumento('CON_RENTA_FIJA', { instrument_type: 'FUND', asset_mix: LAZARD })).toBe(false);
        expect(aplicaAlInstrumento('CON_RENTA_VARIABLE', { instrument_type: 'FUND', asset_mix: LAZARD })).toBe(true);
    });
});

describe('el contrato declara su aplicabilidad de forma evaluable', () => {
    it('toda ruta con x-applies-to declara tambien un x-applies-when de la lista', () => {
        // Sin esto, la cobertura se calcularia sobre una prosa y nadie podria reproducirla.
        const malas: string[] = [];
        for (const esquema of cargarEsquemas()) {
            const mirar = (ruta: string, nodo: Record<string, unknown>): void => {
                if (nodo['x-applies-to'] === undefined) return;
                const predicado = nodo['x-applies-when'];
                if (typeof predicado !== 'string') {
                    malas.push(`${esquema.fichero}:${ruta} tiene prosa y no predicado`);
                } else if (!(PREDICADOS_DE_APLICABILIDAD as readonly string[]).includes(predicado)) {
                    malas.push(`${esquema.fichero}:${ruta} predicado desconocido ${predicado}`);
                }
            };
            mirar('<raiz>', esquema.json);
            for (const ruta of rutasDe(esquema)) mirar(ruta.ruta, ruta.nodo);
        }
        expect(malas).toEqual([]);
    });

    it('un predicado que no se sabe evaluar devuelve "no lo se", no "si"', () => {
        // Darlo por cierto contaria la ruta como aplicable y bajaria la cobertura por una
        // suposicion nuestra.
        expect(aplicaAlInstrumento('CARTERA_REAL', { instrument_type: 'FUND' })).toBeUndefined();
        expect(aplicaAlInstrumento(undefined, { instrument_type: 'FUND' })).toBe(true);
    });

    it('decide renta fija y renta variable por el reparto, y no decide si no hay reparto', () => {
        const conRf = { instrument_type: 'FUND', asset_mix: { equity: 0.2, fixed_income: 0.8 } };
        expect(aplicaAlInstrumento('CON_RENTA_FIJA', conRf)).toBe(true);
        expect(aplicaAlInstrumento('CON_RENTA_VARIABLE', conRf)).toBe(true);
        const soloRv = { instrument_type: 'FUND', asset_mix: { equity: 1, fixed_income: 0 } };
        expect(aplicaAlInstrumento('CON_RENTA_FIJA', soloRv)).toBe(false);
        expect(aplicaAlInstrumento('FONDO_O_ETF', soloRv)).toBe(true);
        expect(aplicaAlInstrumento('FONDO_O_ETF', { instrument_type: 'STOCK' })).toBe(false);
        // Sin reparto no se puede decidir, y eso NO es lo mismo que que no aplique.
        expect(aplicaAlInstrumento('CON_RENTA_FIJA', { instrument_type: 'FUND' })).toBeUndefined();
    });

});

describe('para que sirve un instrumento: las cinco aptitudes', () => {
    it('siempre salen las cinco, para que se pueda preguntar por cualquiera', () => {
        const veredictos = aptitudesDe({ raiz: instrumento().raiz, bloques: instrumento().bloques });
        expect(Object.keys(veredictos).sort()).toEqual([...APTITUDES].sort());
    });

    it('cada no-apto NOMBRA las rutas que le faltan: una tarea, no un lamento', () => {
        const pelado = instrumento();
        delete pelado.bloques['declared/costs'];
        const veredictos = aptitudesDe({ raiz: pelado.raiz, bloques: pelado.bloques });
        expect(veredictos.COMPARAR_COSTE.apt).toBe(false);
        expect(veredictos.COMPARAR_COSTE.missing).toEqual(['declared/costs.ongoing_charge']);
    });

    it('con coste corriente es apto para comparar coste; sin el, no', () => {
        expect(aptitudesDe({ raiz: instrumento().raiz, bloques: instrumento().bloques }).COMPARAR_COSTE.apt).toBe(true);
    });

    it('la radiografia se da por buena con el reparto por clase de activo, sin exigir sectores', () => {
        // Es un juicio, con valor por defecto: una radiografia a ese nivel sigue siendo una
        // radiografia, y el detalle la refina. Exigir el detalle dejaria fuera a los fondos
        // sin renta variable por un campo que no les aplica.
        const sinSectores = instrumento();
        sinSectores.bloques['declared/exposure'] = {
            source: 'x',
            as_of: '2026-09-30',
            asset_mix: { equity: 1, fixed_income: 0, cash: 0, other: 0 },
            asset_mix_completion: 'REPORTED',
            confidence: 0.9
        };
        expect(
            aptitudesDe({ raiz: sinSectores.raiz, bloques: sinSectores.bloques }).RADIOGRAFIA_DE_CARTERA.apt
        ).toBe(true);

        const sinReparto = instrumento();
        delete sinReparto.bloques['declared/exposure'];
        const veredicto = aptitudesDe({ raiz: sinReparto.raiz, bloques: sinReparto.bloques });
        expect(veredicto.RADIOGRAFIA_DE_CARTERA.apt).toBe(false);
        expect(veredicto.RADIOGRAFIA_DE_CARTERA.missing).toContain('declared/exposure.asset_mix');
    });

    it('UNKNOWN en la politica de distribucion NO es comparable, y lo dice sin bloquear nada', () => {
        const veredictos = aptitudesDe({ raiz: instrumento().raiz, bloques: instrumento().bloques });
        expect(veredictos.COMPARAR_RENTABILIDAD.apt).toBe(false);
        expect(veredictos.COMPARAR_RENTABILIDAD.missing?.join(' ')).toContain('UNKNOWN');

        const conocida = instrumento();
        conocida.bloques['declared/profile'] = {
            source: 'x',
            as_of: '2026-09-30',
            distribution_policy: 'ACCUMULATING'
        };
        expect(
            aptitudesDe({ raiz: conocida.raiz, bloques: conocida.bloques }).COMPARAR_RENTABILIDAD.apt
        ).toBe(true);
    });

    it('mostrar alpha exige divisa y variante del indice, y NO mira el R2', () => {
        // El umbral del R2 se decidio de lectura y naciendo apagado: meterlo aqui lo
        // convertiria en una puerta de escritura, que es lo contrario de lo decidido.
        const sinDivisa = aptitudesDe({ raiz: instrumento().raiz, bloques: instrumento().bloques });
        expect(sinDivisa.MOSTRAR_ALPHA.apt).toBe(false);
        expect(sinDivisa.MOSTRAR_ALPHA.missing).toContain('classification.official_benchmark.currency');
        expect(sinDivisa.MOSTRAR_ALPHA.missing).toContain('classification.official_benchmark.variant');

        const completo = instrumento();
        completo.raiz = {
            ...completo.raiz,
            classification: {
                category: 'RV Global',
                asset_class: 'EQUITY',
                official_benchmark: { name: 'Un Indice', currency: 'EUR', variant: 'NR' }
            }
        };
        const apto = aptitudesDe({ raiz: completo.raiz, bloques: completo.bloques });
        expect(apto.MOSTRAR_ALPHA.apt).toBe(true);

        // Y con un R2 ridiculo sigue siendo apto: el filtro es de lectura.
        completo.bloques['declared/provider_risk'] = {
            ...(completo.bloques['declared/provider_risk'] as object),
            r2: { '3y': { vs_benchmark: 0.0002 } }
        };
        expect(aptitudesDe({ raiz: completo.raiz, bloques: completo.bloques }).MOSTRAR_ALPHA.apt).toBe(true);
    });

    it('mostrar alpha exige lo mismo que la tarjeta: sin categoria, el alfa del proveedor no la hace apta', () => {
        /* Medido el 08-11-2026 en LU2504555777: apto por el alfa del proveedor y la tarjeta sin alfa, porque
           sin categoria no hay con que nombrar la cifra del proveedor. La ficha decia «Si» sin cifra. */
        const sinCategoria = instrumento({
            calculadas: { computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', as_of: '2026-10-31' }
        });
        sinCategoria.raiz = {
            ...sinCategoria.raiz,
            classification: {
                asset_class: 'EQUITY',
                official_benchmark: { name: 'Un Indice', currency: 'EUR', variant: 'NR' }
            }
        };
        const tarjeta = componerTarjeta(sinCategoria, calcularCalidad(sinCategoria, AHORA), AHORA)!;
        expect((tarjeta['metrics'] as Record<string, unknown>)['relative']).toBeUndefined();
        const alfa = aptitudesDe({ raiz: sinCategoria.raiz, bloques: sinCategoria.bloques, calculadas: sinCategoria.calculadas }).MOSTRAR_ALPHA;
        expect(alfa.apt).toBe(false);
        expect(alfa.missing).toEqual(['classification.category']);

        // Con indice propio medido, la categoria del proveedor no hace falta: el alfa es el nuestro.
        const conPropio = instrumento({
            calculadas: {
                computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', as_of: '2026-10-31',
                relative: { benchmark: { name: 'Un Indice NR EUR', instrument_id: 'IE0000000001' }, beta: { '3y': 0.9 }, r2: { '3y': 0.8 }, jensen_alpha: { '3y': 0.01 } }
            }
        });
        conPropio.raiz = sinCategoria.raiz;
        const propio = aptitudesDe({ raiz: conPropio.raiz, bloques: conPropio.bloques, calculadas: conPropio.calculadas }).MOSTRAR_ALPHA;
        expect(propio.apt).toBe(true);

        // Y un indice propio sin alfa tampoco: la tarjeta llevaria la relativa nuestra sin la cifra.
        const propioSinAlfa = instrumento({
            calculadas: {
                computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', as_of: '2026-10-31',
                relative: { benchmark: { name: 'Un Indice NR EUR', instrument_id: 'IE0000000001' }, beta: { '3y': 0.9 } }
            }
        });
        propioSinAlfa.raiz = sinCategoria.raiz;
        const sinCifra = aptitudesDe({ raiz: propioSinAlfa.raiz, bloques: propioSinAlfa.bloques, calculadas: propioSinAlfa.calculadas }).MOSTRAR_ALPHA;
        expect(sinCifra.apt).toBe(false);
        expect(sinCifra.missing).toEqual(['computed/metrics.relative.r2', 'computed/metrics.relative.jensen_alpha']);
    });

    it('las metricas propias NO son aptas mientras no exista el analitico, y dice por que', () => {
        const sinAnalitico = aptitudesDe({ raiz: instrumento().raiz, bloques: instrumento().bloques });
        expect(sinAnalitico.METRICAS_PROPIAS.apt).toBe(false);
        expect(sinAnalitico.METRICAS_PROPIAS.missing?.join(' ')).toContain('analitico');

        const conAnalitico = aptitudesDe({
            raiz: instrumento().raiz,
            bloques: instrumento().bloques,
            calculadas: { computed_at: AHORA, method: 'GEOMETRIC_CAGR' }
        });
        expect(conAnalitico.METRICAS_PROPIAS.apt).toBe(true);
    });

    it('con el sello metrics_absence, el motivo nombra la causa y no el generico (LU0171283459, 09-11-2026)', () => {
        const base = instrumento();
        const parada = aptitudesDe({
            raiz: { ...base.raiz, metrics_absence: { reason: 'NOT_PROVIDED', code: 'SERIES_STOPPED' } },
            bloques: base.bloques
        }).METRICAS_PROPIAS;
        expect(parada.apt).toBe(false);
        expect(parada.missing).toEqual(['computed/metrics (la serie de precios está parada: la fuente dejó de servirla)']);
        expect(parada.missing?.join(' ')).not.toContain('almacen');

        // Sin sello, el generico sigue: es el caso en que de verdad no se sabe.
        const sinSello = aptitudesDe({ raiz: base.raiz, bloques: base.bloques }).METRICAS_PROPIAS;
        expect(sinSello.missing).toEqual(['computed/metrics (sin evidencia de la politica, o sin almacen analitico)']);

        // Un codigo que la tabla no conoce tampoco se traduce a ciegas.
        const raro = aptitudesDe({
            raiz: { ...base.raiz, metrics_absence: { reason: 'NOT_PROVIDED', code: 'OTRO' } },
            bloques: base.bloques
        }).METRICAS_PROPIAS;
        expect(raro.missing?.join(' ')).toContain('almacen analitico');

        // Los que el mapper sella NOT_APPLICABLE empiezan por «no aplica», que es lo que la ficha lee.
        const reparte = aptitudesDe({
            raiz: { ...base.raiz, metrics_absence: { reason: 'NOT_APPLICABLE', code: 'DISTRIBUTES' } },
            bloques: base.bloques
        }).METRICAS_PROPIAS;
        expect(reparte.missing?.[0]?.startsWith('no aplica')).toBe(true);

        // Con cifras propias el sello no cuenta: solo existe cuando no las hay.
        const conCifras = aptitudesDe({
            raiz: { ...base.raiz, metrics_absence: { reason: 'NOT_PROVIDED', code: 'SERIES_STOPPED' } },
            bloques: base.bloques,
            calculadas: { computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2' }
        }).METRICAS_PROPIAS;
        expect(conCifras.apt).toBe(true);
    });
});

describe('quality/latest', () => {
    it('valida contra su contrato y es del LOTE, no de la plataforma', () => {
        const calidad = calcularCalidad(instrumento(), AHORA);
        expect(validarForma('instrument-quality.v2.schema.json', calidad.documento).ok).toBe(true);
        expect(puedeEscribir('instrument-quality.v2.schema.json', 'batch')).toBe(true);
        expect(validarEscritura('instrument-quality.v2.schema.json', calidad.documento, 'platform').ok).toBe(false);
    });

    it('el denominador son las rutas APLICABLES, no todas las del contrato', () => {
        // Un fondo sin renta fija no tiene por que traer duracion efectiva: ese campo no le
        // falta, no le aplica, y no entra en el denominador.
        const soloRv = calcularCalidad(instrumento(), AHORA);
        const conRf = instrumento();
        conRf.bloques['declared/exposure'] = {
            ...(conRf.bloques['declared/exposure'] as object),
            asset_mix: { equity: 0.2, fixed_income: 0.8, cash: 0, other: 0 }
        };
        const mixto = calcularCalidad(conRf, AHORA);
        expect(mixto.aplicables).toBeGreaterThan(soloRv.aplicables);
        // Y las rutas de renta fija aparecen como ausentes SOLO en el que tiene renta fija.
        const rutasRf = (resultado: typeof soloRv) =>
            (resultado.documento['absences'] as { path: string }[]).filter((a) =>
                a.path.startsWith('declared/fixed_income')
            ).length;
        expect(rutasRf(soloRv)).toBe(0);
        expect(rutasRf(mixto)).toBeGreaterThan(0);
    });

    it('sin reparto no inventa el denominador: deja las rutas como indecidibles', () => {
        const sinReparto = instrumento();
        delete sinReparto.bloques['declared/exposure'];
        const calidad = calcularCalidad(sinReparto, AHORA);
        expect(calidad.indecidibles).toBeGreaterThan(0);
        expect(validarForma('instrument-quality.v2.schema.json', calidad.documento).ok).toBe(true);
    });

    it('cada ausencia dice POR QUE falta, que es lo que sustituye a los centinelas', () => {
        const calidad = calcularCalidad(instrumento(), AHORA);
        const ausencias = calidad.documento['absences'] as { path: string; reason: string }[];
        expect(ausencias.length).toBeGreaterThan(0);
        for (const ausencia of ausencias) {
            expect(['NOT_APPLICABLE', 'NOT_PROVIDED', 'NOT_YET_FETCHED']).toContain(ausencia.reason);
        }
    });

    it('nuestras metricas cuentan como presentes: viajan en `calculadas`, no en `bloques`', () => {
        /*
         * El 02-11-2026 la base afirmaba que faltaban 51.466 datos que si estaban: el 53 % de
         * todas las ausencias registradas de los 938 instrumentos con metricas propias. El
         * recorrido buscaba `computed/metrics` en `bloques`, donde no esta nunca, y daba por
         * ausentes sus 33 rutas en TODOS ellos. La cobertura de un fondo cualquiera figuraba
         * en el 43,8 % cuando rondaba el 71 %.
         *
         * Esta prueba es la que no deja que vuelva: si alguien recorre el registro por
         * `bloques` otra vez, el metodo que el instrumento de prueba SI trae aparecera como
         * ausente y esto se pone rojo.
         */
        const rutasDeMetricas = (material: InstrumentoLeido) =>
            (calcularCalidad(material, AHORA).documento['absences'] as { path: string }[])
                .filter((ausencia) => ausencia.path.startsWith('computed/metrics'))
                .map((ausencia) => ausencia.path);

        const conPropias = instrumento({
            calculadas: { computed_at: AHORA, method: 'GEOMETRIC_CAGR' }
        });
        expect(conPropias.calculadas?.['method']).toBeDefined();
        expect(rutasDeMetricas(conPropias)).not.toContain('computed/metrics.method');

        const sinPropias = instrumento();
        expect(sinPropias.calculadas).toBeUndefined();
        expect(rutasDeMetricas(sinPropias)).toContain('computed/metrics.method');

        // Y la diferencia se nota en la cobertura, que es lo que el asesor lee.
        expect(calcularCalidad(conPropias, AHORA).presentes).toBeGreaterThan(
            calcularCalidad(sinPropias, AHORA).presentes
        );
    });

    const motivoDe = (material: InstrumentoLeido, ruta: string): string | undefined =>
        (
            calcularCalidad(material, AHORA).documento['absences'] as {
                path: string;
                reason: string;
            }[]
        ).find((ausencia) => ausencia.path === ruta)?.reason;

    it('el motivo de la ausencia se hereda del bloque, como el predicado', () => {
        /*
         * El 02-11-2026, medidas sobre la base: 4.813 ausencias decian «falta» cuando su
         * contrato dice otra cosa, porque `x-absence` no bajaba a los hijos y
         * `x-applies-when` si. Son los tres campos de `availability` en los 771 fondos -el
         * bloque entero esta declarado NOT_YET_FETCHED, porque un fondo no pasa por el
         * resolutor de simbolos- y las cuatro ramas de identidad del indice en los 625
         * instrumentos sin indice, donde `relative` esta declarado NOT_APPLICABLE.
         *
         * No movia la cobertura -una ausencia cuenta igual sea cual sea su motivo-, movia lo
         * que la ficha dice: los tres motivos se pintan distintos a proposito.
         */
        const fondo = instrumento({ calculadas: { computed_at: AHORA, method: 'GEOMETRIC_CAGR' } });
        expect(fondo.raiz['availability']).toBeUndefined();

        expect(motivoDe(fondo, 'availability.state')).toBe('NOT_YET_FETCHED');
        expect(motivoDe(fondo, 'availability.last_checked')).toBe('NOT_YET_FETCHED');
        expect(motivoDe(fondo, 'computed/metrics.relative.benchmark.name')).toBe('NOT_APPLICABLE');
        expect(motivoDe(fondo, 'computed/metrics.relative.beta.1y')).toBe('NOT_APPLICABLE');
    });

    it('el bloque ausente gana al valor por defecto de un tipo compartido', () => {
        /*
         * El caso que obliga a que el antepasado gane, y el grande de los dos. Las ventanas de
         * las metricas relativas resuelven su nodo con un `$ref` a `cifra_ratio`, que declara
         * NOT_PROVIDED porque es el tipo que comparten TODAS las cifras del contrato. Si lo
         * propio ganara, el defecto de un tipo compartido pisaria lo que el contrato dice del
         * subarbol -`relative` es NOT_APPLICABLE- y un fondo sin indice leeria «falta» en sus
         * 24 ventanas relativas en vez de «no aplica».
         *
         * Lo mismo con la identidad del indice: `instrument_id` dice NOT_YET_FETCHED, que es
         * cierto cuando hay indice y no se ha resuelto, y falso cuando no hay indice: no se
         * puede pedir el id de algo que no existe.
         */
        const fondo = instrumento({ calculadas: { computed_at: AHORA, method: 'GEOMETRIC_CAGR' } });
        expect(motivoDe(fondo, 'computed/metrics.relative.beta.1y')).toBe('NOT_APPLICABLE');
        expect(motivoDe(fondo, 'computed/metrics.relative.benchmark.instrument_id')).toBe(
            'NOT_APPLICABLE'
        );
        expect(motivoDe(fondo, 'availability.reason')).toBe('NOT_YET_FETCHED');

        /* Y donde NO hay antepasado ausente que lo declare, manda lo propio: `sharpe` es una
           ventana del mismo tipo compartido, pero cuelga de la raiz de las metricas, que esta
           presente. Ahi NOT_PROVIDED es la respuesta buena. */
        expect(motivoDe(fondo, 'computed/metrics.sharpe.1y')).toBe('NOT_PROVIDED');
    });

    it('un bloque PRESENTE no explica la ausencia de un hijo suyo', () => {
        /*
         * La parte de la regla que parece de mas y no lo es. Si `availability` esta -una accion
         * resuelta, con su estado- y solo le falta un campo, el motivo del bloque no vale para
         * ese campo: que el bloque no se haya pedido es falso, se pidio y contesto.
         *
         * Hoy no cambia ninguna cifra de la base, porque donde falta el bloque falta entero.
         * Esta prueba es la que hace que la regla siga siendo cierta cuando eso deje de pasar.
         */
        const marcada = instrumento();
        marcada.raiz['availability'] = { state: 'TRADING' };

        expect(motivoDe(marcada, 'availability.state')).toBeUndefined();
        expect(motivoDe(marcada, 'availability.last_checked')).toBe('NOT_PROVIDED');
        expect(motivoDe(marcada, 'availability.since')).toBe('NOT_PROVIDED');
    });

    it('sin grupo de comparables el instrumento EXISTE, y lo que pierde lo dice la aptitud', () => {
        /*
         * El 02-11-2026, por decision de Oscar. Antes, un fondo cuyo proveedor no publica
         * categoria no tenia raiz: el contrato la exigia, y `LU2504555777` -vivo, 1.533 M€,
         * serie propia desde 2022- estaba fuera de la base con trece documentos colgando de un
         * padre que no existia. Inventar la categoria no era opcion y tirar el dato tampoco.
         *
         * Asi que existe, y la consecuencia esta aqui: sin categoria no se puede poner junto a
         * sus comparables, y lo demas lo sigue sirviendo. Lo que esta prueba fija es eso
         * ultimo, que es lo que distingue una etiqueta de un bloqueo.
         */
        const conCategoria = instrumento();
        expect(aptitudesDe(conCategoria).COMPARAR_CON_SU_GRUPO).toEqual({ apt: true });

        const sinCategoria = instrumento();
        delete (sinCategoria.raiz['classification'] as Record<string, unknown>)['category'];
        const veredictos = aptitudesDe(sinCategoria);
        expect(veredictos.COMPARAR_CON_SU_GRUPO).toEqual({
            apt: false,
            missing: ['classification.category']
        });
        /* Y pierde una sola cosa mas: el alfa del proveedor, que la tarjeta solo escribe nombrando la
           categoria (08-11-2026). Las demas aptitudes dicen lo mismo que con categoria. */
        expect(veredictos.MOSTRAR_ALPHA.apt).toBe(false);
        expect(veredictos.MOSTRAR_ALPHA.missing).toEqual([
            ...(aptitudesDe(conCategoria).MOSTRAR_ALPHA.missing ?? []),
            'classification.category'
        ]);
        for (const aptitud of APTITUDES) {
            if (aptitud === 'COMPARAR_CON_SU_GRUPO' || aptitud === 'MOSTRAR_ALPHA') continue;
            expect(veredictos[aptitud], aptitud).toEqual(aptitudesDe(conCategoria)[aptitud]);
        }
    });

    it('a una accion la agrupa su sector, no una categoria que no tiene', () => {
        const accion = instrumento();
        accion.raiz['instrument_type'] = 'STOCK';
        delete (accion.raiz['classification'] as Record<string, unknown>)['category'];

        accion.bloques['declared/equity'] = { source: 'eodhd', as_of: '2026-10-29', sector: 'Financial Services' };
        expect(aptitudesDe(accion).COMPARAR_CON_SU_GRUPO).toEqual({ apt: true });

        accion.bloques['declared/equity'] = { source: 'eodhd', as_of: '2026-10-29' };
        expect(aptitudesDe(accion).COMPARAR_CON_SU_GRUPO).toEqual({
            apt: false,
            missing: ['declared/equity.sector']
        });
    });

    it('la cobertura cuadra: presentes entre aplicables', () => {
        const calidad = calcularCalidad(instrumento(), AHORA);
        expect(calidad.presentes).toBeLessThanOrEqual(calidad.aplicables);
        expect(calidad.cobertura).toBeCloseTo(calidad.presentes / calidad.aplicables, 5);
        expect(calidad.documento['applicable_paths']).toBe(calidad.aplicables);
        expect(calidad.documento['present_paths']).toBe(calidad.presentes);
    });

    describe('la huella del conjunto contable (decision 16)', () => {
        /*
         * La cobertura depende de que entro en el denominador, y ese conjunto cambia cuando un contrato se corrige: el
         * 03-11 declarar que el Sharpe no aplica a una accion movia su cobertura +7,95 puntos de media sin tocar un
         * dato. La huella es lo que dice si dos coberturas estan calculadas sobre el mismo conjunto.
         */
        const huellaDe = (material: InstrumentoLeido): string =>
            calcularCalidad(material, AHORA).documento['applicable_paths_fingerprint'] as string;

        it('sale de la misma lista que el recuento, y valida', () => {
            const calidad = calcularCalidad(instrumento(), AHORA);
            expect(calidad.documento['applicable_paths_fingerprint']).toBe(calidad.huella);
            expect(calidad.huella).toMatch(/^[a-f0-9]{64}$/);
            expect(calidad.huella).toBe(huellaDeLasRutas(calidad.rutasAplicables));
            expect(calidad.rutasAplicables.length).toBe(calidad.documento['applicable_paths']);
            expect(new Set(calidad.rutasAplicables).size).toBe(calidad.rutasAplicables.length);
            /* Cada ausencia es una ruta del conjunto: se escriben igual, y por eso la huella se puede rehacer. */
            for (const ausencia of calidad.documento['absences'] as { path: string }[]) {
                expect(calidad.rutasAplicables).toContain(ausencia.path);
            }
            expect(validarForma('instrument-quality.v2.schema.json', calidad.documento).ok).toBe(true);
        });

        it('el mismo instrumento con la misma lista da la misma huella', () => {
            expect(huellaDe(instrumento())).toBe(huellaDe(instrumento()));
            expect(calcularCalidad(instrumento(), '2026-12-01T00:00:00.000Z').huella).toBe(huellaDe(instrumento()));
        });

        it('rellenar un dato mueve la cobertura y NO la huella: el denominador es el mismo', () => {
            const sinCoste = instrumento();
            sinCoste.bloques['declared/costs'] = { source: 'canonical:fondosdb', as_of: '2026-09-30' };
            const con = calcularCalidad(instrumento(), AHORA);
            const sin = calcularCalidad(sinCoste, AHORA);
            expect(sin.presentes).toBe(con.presentes - 1);
            expect(sin.aplicables).toBe(con.aplicables);
            expect(sin.huella).toBe(con.huella);
        });

        it('una ruta aplicable de mas o de menos da otra huella', () => {
            /* Con renta fija le aplican las rutas de renta fija: el conjunto crece y la huella cambia, en los dos sentidos. */
            const soloRv = calcularCalidad(instrumento(), AHORA);
            const conRf = instrumento();
            conRf.bloques['declared/exposure'] = {
                ...(conRf.bloques['declared/exposure'] as object),
                asset_mix: { equity: 0.2, fixed_income: 0.8, cash: 0, other: 0 }
            };
            const mixto = calcularCalidad(conRf, AHORA);
            expect(mixto.aplicables).toBeGreaterThan(soloRv.aplicables);
            expect(mixto.huella).not.toBe(soloRv.huella);

            /* Y basta una sola ruta, puesta o quitada. */
            const rutas = [...soloRv.rutasAplicables];
            expect(huellaDeLasRutas(rutas.slice(1))).not.toBe(soloRv.huella);
            expect(huellaDeLasRutas([...rutas, 'declared/costs.una_ruta_nueva'])).not.toBe(soloRv.huella);
        });

        it('el orden de entrada no importa: identifica el conjunto, no el recorrido', () => {
            const rutas = [...calcularCalidad(instrumento(), AHORA).rutasAplicables];
            const huella = huellaDeLasRutas(rutas);
            expect(huellaDeLasRutas([...rutas].reverse())).toBe(huella);
            const barajadas = rutas.map((ruta, i) => ({ ruta, clave: (i * 7919) % rutas.length })).sort((a, b) => a.clave - b.clave);
            expect(huellaDeLasRutas(barajadas.map((entrada) => entrada.ruta))).toBe(huella);
        });

        it('se rehace fuera de aqui: valores sacados con hashlib de Python, no de esta funcion', () => {
            // sha256 de «declared/costs.ongoing_charge\nidentity.name», ordenadas y unidas por un salto de linea.
            expect(huellaDeLasRutas(['identity.name', 'declared/costs.ongoing_charge'])).toBe(
                'a3399128e0a04a22f157c59f515cc8164c18586792648f39765879d8e569667b'
            );
            // El conjunto vacio es el sha256 del texto vacio.
            expect(huellaDeLasRutas([])).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        });
    });

    it('los cuatro avisos salen cuando tienen que salir, y no cuando no', () => {
        const avisos = avisosDe(instrumento()).map((aviso) => aviso.code);
        // Politica UNKNOWN e indice sin divisa: los dos se dan en el ejemplo.
        expect(avisos).toContain('POLITICA_DE_DISTRIBUCION_DESCONOCIDA');
        expect(avisos).toContain('INDICE_SIN_DIVISA_NI_VARIANTE');
        // Tiene reparto y coste, asi que esos dos NO.
        expect(avisos).not.toContain('SIN_REPARTO_DE_ACTIVOS');
        expect(avisos).not.toContain('SIN_COSTE_CORRIENTE');

        const pelado = instrumento();
        delete pelado.bloques['declared/exposure'];
        delete pelado.bloques['declared/costs'];
        const avisosPelados = avisosDe(pelado).map((aviso) => aviso.code);
        expect(avisosPelados).toContain('SIN_REPARTO_DE_ACTIVOS');
        expect(avisosPelados).toContain('SIN_COSTE_CORRIENTE');
        expect(avisosPelados.find((codigo) => codigo === 'SIN_COSTE_CORRIENTE')).toBeDefined();
    });

    it('el aviso del coste corriente es ERROR, porque es uno de los tres campos irreducibles', () => {
        const pelado = instrumento();
        delete pelado.bloques['declared/costs'];
        const aviso = avisosDe(pelado).find((candidato) => candidato.code === 'SIN_COSTE_CORRIENTE');
        expect(aviso?.severity).toBe('ERROR');
    });
});

describe('read/card', () => {
    it('valida, es del lote, y dice que sus metricas son del PROVEEDOR', () => {
        const calidad = calcularCalidad(instrumento(), AHORA);
        const tarjeta = componerTarjeta(instrumento(), calidad, AHORA)!;
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok).toBe(true);
        expect(validarEscritura('instrument-read-card.v2.schema.json', tarjeta, 'batch').ok).toBe(true);
        expect(validarEscritura('instrument-read-card.v2.schema.json', tarjeta, 'platform').ok).toBe(false);
        // Es la distincion que hoy no se puede hacer mirando la maestra.
        expect((tarjeta['metrics'] as Record<string, unknown>)['source']).toBe('PROVIDER');
    });

    it('se queda con el sujeto que se puede nombrar: fund en lo absoluto, vs_benchmark en lo relativo', () => {
        const calidad = calcularCalidad(instrumento(), AHORA);
        const metricas = componerTarjeta(instrumento(), calidad, AHORA)!['metrics'] as Record<string, any>;
        expect(metricas['volatility']?.['3y']).toBeCloseTo(0.1234, 10);
        // Lo relativo ya no va suelto: va con el indice contra el que se midio.
        expect(metricas['relative']['beta']['3y']).toBeCloseTo(0.98, 10);
        expect(metricas['relative']['r2']['3y']).toBeCloseTo(0.9304, 10);
        expect(metricas['relative']['jensen_alpha']['3y']).toBeCloseTo(0.015, 10);
        expect(metricas['beta']).toBeUndefined();
    });

    it('una cifra contra un indice NO se escribe sin nombrar el indice', () => {
        /*
         * Y el nombre tiene que ser el del indice contra el que se midio DE VERDAD. La cifra
         * del proveedor no esta medida contra el benchmark del folleto: medido el 01-11-2026,
         * 24 fondos que declaran «MSCI ACWI NR USD», con la misma fecha y la misma divisa,
         * traen diez volatilidades distintas del «indice», y agrupan por categoria. Asi que
         * la del proveedor nombra su CATEGORIA y NO puede llevar `benchmark`.
         */
        const calidad = calcularCalidad(instrumento(), AHORA);
        const relativa = (componerTarjeta(instrumento(), calidad, AHORA)!['metrics'] as Record<string, any>)[
            'relative'
        ];
        expect(relativa['source']).toBe('PROVIDER');
        expect(relativa['reference']).toBe('PROVIDER_CATEGORY_INDEX');
        expect(relativa['category']).toBe('RV Global');
        expect(relativa['benchmark']).toBeUndefined();
        expect(relativa['as_of']).toBe('2026-09-30');

        // Sin categoria no hay con que nombrar contra que se midio, y no se escribe nada.
        const sinCategoria = instrumento();
        sinCategoria.raiz = {
            ...sinCategoria.raiz,
            classification: { asset_class: 'EQUITY', official_benchmark: { name: 'Un Indice Global' } }
        };
        const metricas = componerTarjeta(sinCategoria, calcularCalidad(sinCategoria, AHORA), AHORA)![
            'metrics'
        ] as Record<string, unknown>;
        expect(metricas['relative']).toBeUndefined();
    });

    it('H2-06: la relativa nuestra lleva la fecha del cierre de las cifras y no la del último precio', () => {
        const propia = instrumento({
            calculadas: {
                computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', as_of: '2026-10-31',
                inputs: { last_date: '2026-11-02' },
                relative: { benchmark: { name: 'Un Indice NR EUR', instrument_id: 'IE0000000001' }, beta: { '3y': 0.9 }, r2: { '3y': 0.8 }, jensen_alpha: { '3y': 0.01 } }
            }
        });
        const relativa = (componerTarjeta(propia, calcularCalidad(propia, AHORA), AHORA)!['metrics'] as Record<string, any>)['relative'];
        expect(relativa['source']).toBe('COMPUTED');
        expect(relativa['as_of']).toBe('2026-10-31');
        // Sin cierre en el documento (los antiguos), cae a donde acaba la serie, como antes.
        const antigua = instrumento({
            calculadas: {
                computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', inputs: { last_date: '2026-11-02' },
                relative: { benchmark: { name: 'Un Indice NR EUR', instrument_id: 'IE0000000001' }, beta: { '3y': 0.9 }, r2: { '3y': 0.8 }, jensen_alpha: { '3y': 0.01 } }
            }
        });
        const vieja = (componerTarjeta(antigua, calcularCalidad(antigua, AHORA), AHORA)!['metrics'] as Record<string, any>)['relative'];
        expect(vieja['as_of']).toBe('2026-11-02');
    });

    it('el nombre del folleto NO se puede pegar a una cifra del proveedor', () => {
        // La puerta lo impide, no solo el codigo: con `reference` de categoria, un `benchmark`
        // al lado no valida. Es la unica barrera que sobrevive a que alguien reescriba esto.
        const base = componerTarjeta(instrumento(), calcularCalidad(instrumento(), AHORA), AHORA)!;
        const metricas = base['metrics'] as Record<string, unknown>;
        const falsa = {
            ...base,
            metrics: {
                ...metricas,
                relative: {
                    ...(metricas['relative'] as Record<string, unknown>),
                    benchmark: { name: 'Un Indice Global' }
                }
            }
        };
        expect(validarForma('instrument-read-card.v2.schema.json', falsa).ok).toBe(false);
    });

    it('el r2 viaja SIEMPRE con el alpha: el umbral es de lectura y nace apagado', () => {
        const calidad = calcularCalidad(instrumento(), AHORA);
        const relativa = (componerTarjeta(instrumento(), calidad, AHORA)!['metrics'] as Record<string, any>)[
            'relative'
        ];
        expect(relativa['jensen_alpha']).toBeDefined();
        expect(relativa['r2']).toBeDefined();

        // Y sin r2 no se escribe el alpha: sin el nadie puede juzgarlo.
        const sinR2 = instrumento();
        const riesgo = { ...(sinR2.bloques['declared/provider_risk'] as Record<string, unknown>) };
        delete riesgo['r2'];
        sinR2.bloques['declared/provider_risk'] = riesgo;
        const otra = (componerTarjeta(sinR2, calcularCalidad(sinR2, AHORA), AHORA)!['metrics'] as Record<
            string,
            any
        >)['relative'];
        expect(otra['jensen_alpha']).toBeUndefined();
        expect(otra['beta']['3y']).toBeCloseTo(0.98, 10);
    });

    it.each([
        ['KID_DECLARES_COMPOSITE', 'compuesto'],
        ['KID_DECLARES_NO_BENCHMARK', 'no tiene índice']
    ])('con %s la tarjeta no cae a la cifra del proveedor y dice por que', (motivo, frase) => {
        /* Decision 20 del 07-11-2026. Es el caso de BNP Clean Energy: el proveedor trae alfa contra su
           categoria, y esa categoria tiene la volatilidad de un indice mundial amplio. */
        const fondo = instrumento({
            calculadas: { computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', relative_absence: motivo }
        });
        const calidad = calcularCalidad(fondo, AHORA);
        const tarjeta = componerTarjeta(fondo, calidad, AHORA)!;
        const metricas = tarjeta['metrics'] as Record<string, unknown>;
        expect(metricas['relative']).toBeUndefined();
        expect(metricas['relative_absence']).toBe(motivo);
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).motivos).toEqual([]);
        const alfa = aptitudesDe({ raiz: fondo.raiz, bloques: fondo.bloques, calculadas: fondo.calculadas })[
            'MOSTRAR_ALPHA'
        ];
        expect(alfa.apt).toBe(false);
        expect(alfa.missing?.[0]).toMatch(/^no aplica: su KID declara/);
        expect(alfa.missing?.[0]).toContain(frase);
    });

    it('con HEDGED_SHARE_CLASS la tarjeta tampoco cae a la cifra del proveedor, y la aptitud lo dice (decision 30)', () => {
        /* El indice de la categoria del proveedor tampoco esta cubierto: su alfa contra la clase
           cubierta mediria la misma cobertura que la nuestra no quiere medir. */
        const fondo = instrumento({
            calculadas: { computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', relative_absence: 'HEDGED_SHARE_CLASS' }
        });
        const tarjeta = componerTarjeta(fondo, calcularCalidad(fondo, AHORA), AHORA)!;
        const metricas = tarjeta['metrics'] as Record<string, unknown>;
        expect(metricas['relative']).toBeUndefined();
        expect(metricas['relative_absence']).toBe('HEDGED_SHARE_CLASS');
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).motivos).toEqual([]);
        const alfa = aptitudesDe({ raiz: fondo.raiz, bloques: fondo.bloques, calculadas: fondo.calculadas })['MOSTRAR_ALPHA'];
        expect(alfa.apt).toBe(false);
        expect(alfa.missing?.[0]).toMatch(/^no aplica: es una clase con cobertura de divisa/);
    });

    it('con SAME_FUND_REFERENCE (C-28) la tarjeta copia el motivo y SI cae a la cifra del proveedor', () => {
        /* Lo que falla es nuestra serie del indice, otra clase del mismo fondo, no lo que mide el proveedor
           contra su categoria: el fondo queda como cualquiera sin proxy, y la aptitud se juzga con esa cifra. */
        const fondo = instrumento({
            calculadas: { computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', relative_absence: 'SAME_FUND_REFERENCE' }
        });
        const tarjeta = componerTarjeta(fondo, calcularCalidad(fondo, AHORA), AHORA)!;
        const metricas = tarjeta['metrics'] as Record<string, any>;
        expect(metricas['relative_absence']).toBe('SAME_FUND_REFERENCE');
        expect(metricas['relative']['source']).toBe('PROVIDER');
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).motivos).toEqual([]);
        const alfa = aptitudesDe({ raiz: fondo.raiz, bloques: fondo.bloques, calculadas: fondo.calculadas })['MOSTRAR_ALPHA'];
        expect(alfa.missing ?? []).not.toContainEqual(expect.stringMatching(/^no aplica/));
    });

    it('con el motivo de una accion la tarjeta lo copia y no cambia nada mas', () => {
        const fondo = instrumento({
            calculadas: { computed_at: AHORA, method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY', relative_absence: 'NO_REFERENCE_FOR_MARKET' }
        });
        const metricas = componerTarjeta(fondo, calcularCalidad(fondo, AHORA), AHORA)!['metrics'] as Record<string, any>;
        expect(metricas['relative_absence']).toBe('NO_REFERENCE_FOR_MARKET');
        expect(metricas['relative']['source']).toBe('PROVIDER');
    });

    it('la marca del KID de la decision 21 viaja con el indice de la nuestra', () => {
        const fondo = instrumento({
            calculadas: {
                computed_at: AHORA,
                method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY',
                relative: {
                    benchmark: {
                        name: 'MSCI EM Latin America 10/40',
                        currency: 'EUR',
                        variant: 'NR',
                        return_basis: 'TOTAL_RETURN',
                        kid_confirmation: 'NOT_CONFIRMED'
                    },
                    beta: { '3y': 1.01 },
                    r2: { '3y': 0.95 },
                    jensen_alpha: { '3y': -0.01 }
                }
            }
        });
        const tarjeta = componerTarjeta(fondo, calcularCalidad(fondo, AHORA), AHORA)!;
        const relativa = (tarjeta['metrics'] as Record<string, any>)['relative'];
        expect(relativa['source']).toBe('COMPUTED');
        expect(relativa['benchmark']['kid_confirmation']).toBe('NOT_CONFIRMED');
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).motivos).toEqual([]);
    });

    it('el indice equivalente al declarado viaja con el indice de la nuestra', () => {
        const fondo = instrumento({
            calculadas: {
                computed_at: AHORA,
                method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY',
                relative: {
                    benchmark: {
                        name: 'Bloomberg Euro Corp',
                        equivalent_of: 'ICE BofA Euro Corporate',
                        currency: 'EUR',
                        variant: 'TR',
                        return_basis: 'TOTAL_RETURN'
                    },
                    beta: { '3y': 1.03 },
                    r2: { '3y': 0.94 },
                    jensen_alpha: { '3y': 0.007 }
                }
            }
        });
        const tarjeta = componerTarjeta(fondo, calcularCalidad(fondo, AHORA), AHORA)!;
        const relativa = (tarjeta['metrics'] as Record<string, any>)['relative'];
        expect(relativa['benchmark']['name']).toBe('Bloomberg Euro Corp');
        expect(relativa['benchmark']['equivalent_of']).toBe('ICE BofA Euro Corporate');
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).motivos).toEqual([]);
    });

    it('el nivel del propio indice viaja a la tarjeta con su serie y sin instrument_id (decision 23)', () => {
        // Camino C: la referencia es la serie del propio indice en EODHD, no un ETF. La tarjeta
        // copia la identidad entera, y el contrato de la tarjeta la admite tal cual.
        const fondo = instrumento({
            calculadas: {
                computed_at: AHORA,
                method: 'EXTRACTOR_MONTHLY_V2', frequency: 'MONTHLY',
                relative: {
                    benchmark: {
                        name: 'S&P 500',
                        source_series_id: 'EODHD:SP500TR.INDX',
                        currency: 'EUR',
                        variant: 'TR',
                        return_basis: 'TOTAL_RETURN',
                        series_class: 'INDEX_LEVEL'
                    },
                    beta: { '3y': 0.93 },
                    r2: { '3y': 0.97 },
                    jensen_alpha: { '3y': -0.004 }
                }
            }
        });
        const tarjeta = componerTarjeta(fondo, calcularCalidad(fondo, AHORA), AHORA)!;
        const relativa = (tarjeta['metrics'] as Record<string, any>)['relative'];
        expect(relativa['source']).toBe('COMPUTED');
        expect(relativa['benchmark']['series_class']).toBe('INDEX_LEVEL');
        expect(relativa['benchmark']['source_series_id']).toBe('EODHD:SP500TR.INDX');
        expect(relativa['benchmark']).not.toHaveProperty('instrument_id');
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).motivos).toEqual([]);
    });

    it('el indicador de riesgo sale con su origen, y nunca un numero sin fuente', () => {
        const conSri = calcularCalidad(instrumento(), AHORA);
        const metricas = componerTarjeta(instrumento(), conSri, AHORA)!['metrics'] as Record<string, unknown>;
        expect(metricas['risk_score']).toBe(4);
        expect(metricas['risk_score_source']).toBe('SRI_KID');

        // Sin sri cae al srri, y lo dice.
        const sinSri = instrumento();
        sinSri.bloques['declared/regulatory'] = { source: 'x', as_of: '2026-09-30', srri: 5 };
        const tarjeta = componerTarjeta(sinSri, calcularCalidad(sinSri, AHORA), AHORA)!;
        const metricas2 = tarjeta['metrics'] as Record<string, unknown>;
        expect(metricas2['risk_score']).toBe(5);
        expect(metricas2['risk_score_source']).toBe('SRRI');

        // Sin ninguno de los dos, no se pone nada.
        const sinNada = instrumento();
        sinNada.bloques['declared/regulatory'] = { source: 'x', as_of: '2026-09-30' };
        const metricas3 = componerTarjeta(sinNada, calcularCalidad(sinNada, AHORA), AHORA)!['metrics'] as Record<
            string,
            unknown
        >;
        expect(metricas3['risk_score']).toBeUndefined();
        expect(metricas3['risk_score_source']).toBeUndefined();
    });

    it('un instrumento SIN composicion tambien tiene tarjeta', () => {
        // Exigir la composicion en la tarjeta dejaria sin ella a 161 de los 769: sin nombre,
        // sin coste y sin metricas en la pantalla, por una pieza que puede faltar.
        const sinReparto = instrumento();
        delete sinReparto.bloques['declared/exposure'];
        const tarjeta = componerTarjeta(sinReparto, calcularCalidad(sinReparto, AHORA), AHORA)!;
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok).toBe(true);
        expect(tarjeta['exposure']).toBeUndefined();
        expect((tarjeta['identity'] as Record<string, unknown>)['name']).toBe('Un fondo');
    });

    it('la tarjeta lleva los costes con su fuente y la fecha del KID, y las fuentes no cuentan para la cobertura', () => {
        /* Decision 43: lo que dice KID en un informe tiene que venir de aqui, y con tarjeta no hace falta otra lectura por posicion. */
        const base = instrumento();
        const conKid = instrumento();
        conKid.bloques['declared/costs'] = {
            ...conKid.bloques['declared/costs'],
            document_url: 'https://ejemplo.invalid/kid.pdf',
            document_date: '2026-08-19',
            ongoing_charge_source: 'KID',
            transaction_costs: 0.0037,
            transaction_costs_source: 'KID',
            entry_charge: 0.05,
            entry_charge_source: 'PROVIDER'
        };
        const tarjeta = componerTarjeta(conKid, calcularCalidad(conKid, AHORA), AHORA)!;
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok).toBe(true);
        expect(tarjeta['costs']).toMatchObject({
            ongoing_charge: 0.0053,
            transaction_costs: 0.0037,
            entry_charge: 0.05,
            document_url: 'https://ejemplo.invalid/kid.pdf',
            document_date: '2026-08-19',
            ongoing_charge_source: 'KID',
            transaction_costs_source: 'KID',
            entry_charge_source: 'PROVIDER'
        });
        /* Fuente y fecha son del sobre de la afirmacion: decir de donde sale una cifra no cambia la cobertura de nadie. */
        const soloElSobre = instrumento();
        soloElSobre.bloques['declared/costs'] = {
            ...soloElSobre.bloques['declared/costs'],
            document_url: 'https://ejemplo.invalid/kid.pdf',
            document_date: '2026-08-19',
            ongoing_charge_source: 'KID'
        };
        expect(calcularCalidad(soloElSobre, AHORA)).toEqual(calcularCalidad(base, AHORA));
    });

    it('available_sections sustituye a los punteros de la raiz', () => {
        const conPropias = instrumento({ calculadas: { computed_at: AHORA, method: 'GEOMETRIC_CAGR' } });
        const tarjeta = componerTarjeta(conPropias, calcularCalidad(conPropias, AHORA), AHORA)!;
        const secciones = tarjeta['available_sections'] as string[];
        expect(secciones).toContain('costs');
        expect(secciones).toContain('exposure');
        expect(secciones).not.toContain('fixed_income');
        /* Ninguna lleva su capa pegada: el lector no tiene por que saber quien escribe. */
        expect(secciones.filter((seccion) => seccion.includes('/'))).toEqual([]);
        /* Y la seccion que calculamos nosotros se declara como las demas (02-11-2026).
           Viaja en `calculadas` y no en `bloques`, asi que hasta ese dia la lista omitia
           las metricas propias de 938 instrumentos: la interfaz no podia saber que esa
           seccion existe sin abrir el bloque, que es lo que esta lista evita. */
        expect(secciones).toContain('metrics');
    });

    it('sin metricas propias, la seccion no se declara', () => {
        const sinCalculadas = instrumento();
        delete (sinCalculadas as { calculadas?: unknown }).calculadas;
        const tarjeta = componerTarjeta(sinCalculadas, calcularCalidad(sinCalculadas, AHORA), AHORA)!;
        expect(tarjeta['available_sections'] as string[]).not.toContain('metrics');
        // Y la raiz no lleva punteros: eso es lo que la tarjeta hace innecesario.
        expect(Object.keys(instrumento().raiz)).not.toContain('pointers');
    });

    it('proyecta patrimonio y sostenibilidad, que es por lo que una lista ordena', () => {
        /* 02-11-2026: la tarjeta es la fila de una LISTA, no la carga de una ficha. De las
           seis secciones que no proyectaba, entran las dos por las que se ordena y se
           filtra; las otras cuatro se leen en su documento. */
        const conAmbas = instrumento();
        conAmbas.bloques['declared/size'] = {
            source: 'canonical:fondosdb',
            as_of: '2026-09-30',
            aum: 1_234_567_890,
            currency: 'EUR'
        };
        conAmbas.bloques['declared/sustainability'] = {
            source: 'canonical:fondosdb',
            as_of: '2026-09-30',
            esg_globes: 4,
            esg_score: 21.4,
            carbon_intensity: 118.2
        };
        const tarjeta = componerTarjeta(conAmbas, calcularCalidad(conAmbas, AHORA), AHORA)!;
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok).toBe(true);

        expect(tarjeta['size']).toEqual({ aum: 1_234_567_890, currency: 'EUR', as_of: '2026-09-30' });
        /* Y solo la escala de 1 a 5: la puntuacion absoluta y el carbono son de ficha, y
           meterlos aqui engordaria cada fila de una lista de cientos. */
        expect(tarjeta['sustainability']).toEqual({ esg_globes: 4, as_of: '2026-09-30' });
    });

    it('sin los bloques, la tarjeta no inventa ni patrimonio ni sostenibilidad', () => {
        const tarjeta = componerTarjeta(instrumento(), calcularCalidad(instrumento(), AHORA), AHORA)!;
        expect(tarjeta['size']).toBeUndefined();
        expect(tarjeta['sustainability']).toBeUndefined();
    });

    it('una sostenibilidad sin la escala de 1 a 5 no se proyecta a medias', () => {
        /* El bloque puede existir trayendo solo la puntuacion absoluta. Proyectar
           `{as_of}` sin cifra dejaria una fecha afirmando una calificacion que no hay. */
        const soloPuntuacion = instrumento();
        soloPuntuacion.bloques['declared/sustainability'] = {
            source: 'canonical:fondosdb',
            as_of: '2026-09-30',
            esg_score: 21.4
        };
        const tarjeta = componerTarjeta(soloPuntuacion, calcularCalidad(soloPuntuacion, AHORA), AHORA)!;
        expect(tarjeta['sustainability']).toBeUndefined();
    });

    it('lleva los avisos de la calidad, para que la ficha pueda marcar sin bloquear', () => {
        const calidad = calcularCalidad(instrumento(), AHORA);
        const tarjeta = componerTarjeta(instrumento(), calidad, AHORA)!;
        const avisos = (tarjeta['quality'] as Record<string, unknown>)['warnings'] as { code: string }[];
        expect(avisos.map((aviso) => aviso.code)).toContain('POLITICA_DE_DISTRIBUCION_DESCONOCIDA');
    });
});

describe('el grado de evidencia llega a la tarjeta', () => {
    /**
     * Oscar decidio el 01-11 publicar las ~450 metricas propias con su grado declarado, y lo
     * decidio sobre la frase «el grado viaja declarado, asi que un informe puede decir en que
     * se apoya». Era verdad a medias: el grado estaba en `declared/profile` y NO en la
     * tarjeta, que es el documento que la aplicacion lee para no ir bloque a bloque.
     *
     * Por que importa y no es simetria: proyectado sobre los 752 fondos, en torno al 95 % de
     * las politicas se resolveran con PROVIDER_NO_RECORDS, el grado mas debil de los cuatro.
     * Una metrica apoyada en una ausencia afirmada por un tercero es defendible, pero un
     * informe tiene que poder decirlo.
     */
    const conGrado = (politica: string, grado?: string): InstrumentoLeido => {
        const base = instrumento();
        return {
            ...base,
            bloques: {
                ...base.bloques,
                'declared/profile': {
                    source: 'canonical:fondosdb',
                    as_of: '2026-09-30',
                    distribution_policy: politica,
                    ...(grado === undefined ? {} : { distribution_policy_resolution: grado })
                }
            }
        };
    };

    const metricasDe = (politica: string, grado?: string): Record<string, unknown> => {
        const material = conGrado(politica, grado);
        const t = componerTarjeta(material, calcularCalidad(material, AHORA), AHORA);
        return (t?.['metrics'] ?? {}) as Record<string, unknown>;
    };

    it('el grado del perfil aparece en la tarjeta, junto a la politica', () => {
        const m = metricasDe('ACCUMULATING', 'PROVIDER_NO_RECORDS');
        expect(m['distribution_policy']).toBe('ACCUMULATING');
        expect(m['distribution_policy_resolution']).toBe('PROVIDER_NO_RECORDS');
    });

    it('los cuatro grados pasan, porque se publican los cuatro', () => {
        for (const g of [
            'OFFICIAL_REGISTER',
            'PROVIDER_DISTRIBUTION_RECORDS',
            'OBSERVED_DISTRIBUTION',
            'PROVIDER_NO_RECORDS'
        ]) {
            expect(metricasDe('ACCUMULATING', g)['distribution_policy_resolution']).toBe(g);
        }
    });

    it('con la politica en UNKNOWN no hay grado que ensenar, y no se inventa', () => {
        const m = metricasDe('UNKNOWN');
        expect(m['distribution_policy']).toBe('UNKNOWN');
        expect(m['distribution_policy_resolution']).toBeUndefined();
    });

    it('la tarjeta con grado sigue validando contra su contrato', () => {
        const material = conGrado('ACCUMULATING', 'PROVIDER_NO_RECORDS');
        const t = componerTarjeta(material, calcularCalidad(material, AHORA), AHORA);
        expect(validarEscritura('instrument-read-card.v2.schema.json', t!, 'batch').motivos).toEqual([]);
    });

    it('un grado inventado NO valida en la tarjeta', () => {
        const material = conGrado('ACCUMULATING', 'NOMBRE_DE_LA_CLASE');
        const t = componerTarjeta(material, calcularCalidad(material, AHORA), AHORA);
        expect(validarEscritura('instrument-read-card.v2.schema.json', t!, 'batch').ok).toBe(false);
    });
});

describe('la tarjeta lleva NUESTRA cifra: los cuatro pasos de la decision 8', () => {
    /**
     * Lo que decide que una cifra es nuestra no es una preferencia: es que `computed/metrics`
     * exista. El extractor no lo escribe si la serie esta parada, si la clase reparte sin
     * historial de repartos o si la politica no tiene evidencia, asi que su presencia ya es
     * la auditoria de la serie que pedia la condicion de la decision.
     */
    const PROPIAS = {
        computed_at: '2026-11-01T18:39:49+00:00',
        method: 'EXTRACTOR_MONTHLY_V2',
        frequency: 'MONTHLY',
        return_basis: 'TOTAL_RETURN',
        inputs: {
            series_id: 'EODHD:IE00BYR8H148.EUFUND',
            currency: 'EUR',
            distribution_policy_resolution: 'PROVIDER_NO_RECORDS',
            observations: 60,
            first_date: '2021-10-29',
            last_date: '2026-10-29',
            risk_free_source: 'ESTR_EUR'
        },
        volatility: { '1y': 0.1101, '3y': 0.1239 },
        annualized_return: { '1y': 0.0712, '3y': 0.0845 },
        max_drawdown: { '3y': -0.0574 },
        sharpe: { '1y': 0.51, '3y': 0.44 },
        ytd_return: 0.0311
    } as Record<string, unknown>;

    function conPropias(cambios: Record<string, unknown> = {}): InstrumentoLeido {
        const material = instrumento();
        material.calculadas = { ...PROPIAS, ...cambios };
        return material;
    }

    const metricasDe = (material: InstrumentoLeido) =>
        componerTarjeta(material, calcularCalidad(material, AHORA), AHORA)!['metrics'] as Record<string, any>;

    it('paso 1: el titular es nuestro, con nuestro metodo y la fecha de NUESTRA serie', () => {
        // Una ficha con el valor liquidativo del 29-10 y una volatilidad del 30-09 se
        // contradice consigo misma.
        const m = metricasDe(conPropias());
        expect(m['source']).toBe('COMPUTED');
        expect(m['method']).toBe('EXTRACTOR_MONTHLY_V2');
        expect(m['frequency']).toBe('MONTHLY');
        expect(m['as_of']).toBe('2026-10-29');
        expect(m['volatility']['3y']).toBeCloseTo(0.1239, 10);
        expect(m['ytd_return']).toBeCloseTo(0.0311, 10);
    });

    it('paso 2: la del proveedor NO aparece en el titular, ni en otra ventana', () => {
        // El proveedor trae la volatilidad a 3 anios (0,1234) y la nuestra es 0,1239: la suya
        // se queda en `declared/provider_risk` de control, no al lado de la nuestra.
        const m = metricasDe(conPropias());
        expect(m['volatility']['3y']).not.toBeCloseTo(0.1234, 6);
        expect(m['provider']?.['volatility']).toBeUndefined();
        // Por MAGNITUD manda una sola fuente: ni media magnitud de cada uno.
        const soloUnaVentana = metricasDe(conPropias({ volatility: { '1y': 0.1101 } }));
        expect(Object.keys(soloUnaVentana['volatility'])).toEqual(['1y']);
    });

    it('paso 3: cuando el control discrepa queda la marca, y solo entonces', () => {
        // El Sharpe del proveedor es 0,42 y el nuestro 0,44: no hay nada que mirar.
        expect(metricasDe(conPropias())['control']).toBeUndefined();

        // Con 0,42 contra 1,30 la diferencia es 0,88, por encima del umbral medido de 0,5.
        const discrepa = metricasDe(conPropias({ sharpe: { '3y': 1.3 } }));
        expect(discrepa['control']).toEqual({
            source: 'PROVIDER',
            as_of: '2026-09-30',
            mismatch: ['sharpe.3y']
        });
    });

    it('paso 3: el umbral es POR VENTANA, porque la concordancia lo es', () => {
        /*
         * La leccion del 01-11: con un umbral unico se marcaban 159 de 642, una cuarta parte
         * del libro. El desfase del proveedor —27 dias de mediana— desplaza una ventana de 12
         * meses un mes entero, y a tres anios ese mes es un treintavo. Medido: el p99 de la
         * diferencia del Sharpe es 1,37 a un anio y 0,71 a tres.
         */
        const riesgoCon = (sharpe: Record<string, unknown>) => {
            const material = conPropias();
            material.bloques['declared/provider_risk'] = {
                ...(material.bloques['declared/provider_risk'] as Record<string, unknown>),
                sharpe
            };
            return material;
        };
        // A un anio, 0,51 contra 1,41 son 0,90 de diferencia y entra en lo normal.
        const aUnAnio = metricasDe(riesgoCon({ '1y': { fund: 1.41 } }));
        expect(aUnAnio['control']).toBeUndefined();
        // La MISMA diferencia a tres anios —0,44 contra 1,34— se marca.
        const aTresAnios = metricasDe(riesgoCon({ '3y': { fund: 1.34 } }));
        expect(aTresAnios['control']['mismatch']).toEqual(['sharpe.3y']);
    });

    it('paso 3: una ausencia no es una discrepancia', () => {
        const sinSharpeSuyo = conPropias();
        const riesgo = { ...(sinSharpeSuyo.bloques['declared/provider_risk'] as Record<string, unknown>) };
        delete riesgo['sharpe'];
        sinSharpeSuyo.bloques['declared/provider_risk'] = riesgo;
        expect(metricasDe(sinSharpeSuyo)['control']).toBeUndefined();
    });

    it('paso 4: el Sharpe que no calculamos va como SUYO, con su nombre y su fecha', () => {
        // 25 fondos del 01-11: clase fuera del euro, donde el metodo no resta un tipo libre
        // de riesgo de otra divisa. Y el Sharpe no se suprime bajo ningun concepto.
        const sinSharpePropio = conPropias();
        delete (sinSharpePropio.calculadas as Record<string, unknown>)['sharpe'];
        const m = metricasDe(sinSharpePropio);
        expect(m['sharpe']).toBeUndefined();
        expect(m['provider']).toEqual({
            source: 'PROVIDER',
            method: 'TRAILING_PROVIDER',
            as_of: '2026-09-30',
            sharpe: { '3y': 0.42 }
        });
        // Y sin nada que sobre, el bloque no existe.
        expect(metricasDe(conPropias())['provider']).toBeUndefined();
    });

    it('lo nuestro contra el indice trae la identidad entera y el ISIN del proxy', () => {
        const m = metricasDe(
            conPropias({
                relative: {
                    benchmark: {
                        name: 'MSCI World',
                        instrument_id: 'IE00B03HD191',
                        currency: 'EUR',
                        variant: 'NR',
                        return_basis: 'TOTAL_RETURN'
                    },
                    beta: { '3y': 1.3736 },
                    r2: { '3y': 0.842927 },
                    jensen_alpha: { '3y': -0.073206 },
                    active_return: { '3y': -0.0174 },
                    tracking_error: { '3y': 0.080125 },
                    information_ratio: { '3y': -0.2172 }
                }
            })
        );
        expect(m['relative']['source']).toBe('COMPUTED');
        expect(m['relative']['as_of']).toBe('2026-10-29');
        expect(m['relative']['benchmark']['instrument_id']).toBe('IE00B03HD191');
        expect(m['relative']['information_ratio']['3y']).toBeCloseTo(-0.2172, 10);
        // Y la del proveedor NO se cuela al lado: un solo bloque relativo.
        expect(m['relative']['beta']['3y']).toBeCloseTo(1.3736, 10);
    });

    it('sin proxy aprobado, lo relativo sigue siendo del proveedor y lo dice', () => {
        // 497 de los 642 el 01-11. No tener proxy no es un fallo, es no tenerlo.
        const m = metricasDe(conPropias());
        expect(m['relative']['source']).toBe('PROVIDER');
        expect(m['source']).toBe('COMPUTED');
    });

    it('todo lo que sale sigue validando y sigue siendo del lote', () => {
        const conIndice = {
            relative: {
                benchmark: {
                    name: 'MSCI World',
                    currency: 'EUR',
                    variant: 'NR',
                    return_basis: 'TOTAL_RETURN'
                },
                beta: { '3y': 1.37 }
            }
        };
        for (const material of [conPropias(), conPropias({ sharpe: { '3y': 1.3 } }), conPropias(conIndice)]) {
            const t = componerTarjeta(material, calcularCalidad(material, AHORA), AHORA)!;
            expect(validarEscritura('instrument-read-card.v2.schema.json', t, 'batch').motivos).toEqual([]);
            expect(validarEscritura('instrument-read-card.v2.schema.json', t, 'platform').ok).toBe(false);
        }
    });
});


describe('el control solo compara lo que mide lo mismo', () => {
    it('no compara una clase convertida desde otra divisa', () => {
        expect(medimosLoMismo('USD', '2026-10-31', '2026-10-31')).toBe(false);
    });

    it('no compara dos cierres de meses distintos', () => {
        expect(medimosLoMismo(undefined, '2026-10-31', '2026-09-30')).toBe(false);
    });

    it('compara en euros y en el mismo mes, aunque el dia no coincida', () => {
        expect(medimosLoMismo(undefined, '2026-10-31', '2026-10-30')).toBe(true);
        expect(medimosLoMismo('EUR', '2026-10-31', '2026-10-31')).toBe(true);
    });

    it('un documento sin cierre sigue comparandose, como hasta ahora', () => {
        expect(medimosLoMismo(undefined, undefined, '2026-10-31')).toBe(true);
    });
});

describe('la politica del emisor rellena el hueco del proveedor (decision 56)', () => {
    /* IE00B4L5Y983 tal como esta en la base: el proveedor dice UNKNOWN y iShares declara acumulacion. */
    const conEmisor = (politica: string, delEmisor?: string): InstrumentoLeido => {
        const base = instrumento();
        return {
            ...base,
            instrument_id: 'IE00B4L5Y983',
            bloques: {
                ...base.bloques,
                'declared/profile': { source: 'canonical:fondosdb', as_of: '2026-10-31', distribution_policy: politica },
                ...(delEmisor === undefined
                    ? {}
                    : { 'declared/issuer_data': { source: 'issuer:ishares', as_of: '2026-11-08', distribution_policy: { value: delEmisor } } })
            }
        };
    };

    it('con el proveedor en UNKNOWN y el emisor declarando, la aptitud se da por buena', () => {
        const ie00b4l5y983 = conEmisor('UNKNOWN', 'ACCUMULATING');
        const veredicto = aptitudesDe({ raiz: ie00b4l5y983.raiz, bloques: ie00b4l5y983.bloques }).COMPARAR_RENTABILIDAD;
        expect(veredicto.apt).toBe(true);
        expect(veredicto.missing).toBeUndefined();
    });

    it('la tarjeta lleva la del emisor y anota la fuente, y el aviso de calidad desaparece', () => {
        const ie00b4l5y983 = conEmisor('UNKNOWN', 'ACCUMULATING');
        const tarjeta = componerTarjeta(ie00b4l5y983, calcularCalidad(ie00b4l5y983, AHORA), AHORA)!;
        const metricas = tarjeta['metrics'] as Record<string, unknown>;
        expect(metricas['distribution_policy']).toBe('ACCUMULATING');
        expect(metricas['distribution_policy_source']).toBe('ISSUER');
        expect(metricas['distribution_policy_resolution']).toBeUndefined();
        expect(avisosDe(ie00b4l5y983).map((aviso) => aviso.code)).not.toContain('POLITICA_DE_DISTRIBUCION_DESCONOCIDA');
        expect(validarForma('instrument-read-card.v2.schema.json', tarjeta).ok).toBe(true);
    });

    it('sirve tambien cuando el perfil no trae el campo', () => {
        const sinPolitica = conEmisor('UNKNOWN', 'DISTRIBUTING');
        delete (sinPolitica.bloques['declared/profile'] as Record<string, unknown>)['distribution_policy'];
        expect(aptitudesDe({ raiz: sinPolitica.raiz, bloques: sinPolitica.bloques }).COMPARAR_RENTABILIDAD.apt).toBe(true);
    });

    it('donde el proveedor la da, manda el proveedor y la tarjeta no anota nada (IE00B0M62Q58)', () => {
        const distribuye = conEmisor('DISTRIBUTING', 'ACCUMULATING');
        distribuye.bloques['declared/profile']!['distribution_policy_resolution'] = 'OBSERVED_DISTRIBUTION';
        const tarjeta = componerTarjeta(distribuye, calcularCalidad(distribuye, AHORA), AHORA)!;
        const metricas = tarjeta['metrics'] as Record<string, unknown>;
        expect(metricas['distribution_policy']).toBe('DISTRIBUTING');
        expect(metricas['distribution_policy_resolution']).toBe('OBSERVED_DISTRIBUTION');
        expect(metricas['distribution_policy_source']).toBeUndefined();
    });

    it('sin bloque del emisor, o sin politica en el, sigue faltando y sigue el aviso', () => {
        for (const sinDato of [conEmisor('UNKNOWN'), conEmisor('UNKNOWN', 'MIXTA')]) {
            const veredicto = aptitudesDe({ raiz: sinDato.raiz, bloques: sinDato.bloques }).COMPARAR_RENTABILIDAD;
            expect(veredicto.apt).toBe(false);
            expect(veredicto.missing?.join(' ')).toContain('UNKNOWN');
            expect(avisosDe(sinDato).map((aviso) => aviso.code)).toContain('POLITICA_DE_DISTRIBUCION_DESCONOCIDA');
            const metricas = componerTarjeta(sinDato, calcularCalidad(sinDato, AHORA), AHORA)!['metrics'] as Record<string, unknown>;
            expect(metricas['distribution_policy']).toBe('UNKNOWN');
            expect(metricas['distribution_policy_source']).toBeUndefined();
        }
    });
});
