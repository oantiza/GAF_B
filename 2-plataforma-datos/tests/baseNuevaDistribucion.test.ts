import { describe, it, expect } from 'vitest';

import {
    GRADOS_DE_EVIDENCIA,
    POLITICA_DEL_REGISTRO,
    resolverDistribucion } from '../src/ingestion/baseNueva/distribucion';
import { validarForma } from '../src/config/baseNueva/validadores';
import { aptitudesDe } from '../src/config/baseNueva/aptitudes';

/**
 * Si una clase reparte o acumula, y con qué evidencia.
 *
 * Es la puerta de tres cosas: comparar rentabilidades entre clases, las métricas que
 * calculemos de la serie de valor liquidativo, y el alpha propio. Por eso lo que importa aquí
 * no es que salga un valor, es que **nunca salga sin decir de dónde viene**.
 */

describe('resolver si reparte o acumula', () => {
    it('el registro oficial manda, y es el grado mas fuerte', () => {
        expect(resolverDistribucion({ politicaDeclarada: 'acumulacion' })).toEqual({
            policy: 'ACCUMULATING',
            resolution: 'OFFICIAL_REGISTER'
        });
        expect(resolverDistribucion({ politicaDeclarada: 'reparto' })).toEqual({
            policy: 'DISTRIBUTING',
            resolution: 'OFFICIAL_REGISTER'
        });
    });

    it('un rendimiento repartido PRUEBA que reparte', () => {
        expect(resolverDistribucion({ rendimiento12m: 3.05 })).toEqual({
            policy: 'DISTRIBUTING',
            resolution: 'OBSERVED_DISTRIBUTION'
        });
    });

    it('un rendimiento de CERO no prueba que acumule', () => {
        // El canonico tiene 749 ceros exactos, que es demasiado redondo para ser cierto en
        // todos: un cero ahi es tanto "no reparte" como "no tengo el dato".
        expect(resolverDistribucion({ rendimiento12m: 0 })).toEqual({ policy: 'UNKNOWN' });
    });

    it('sin ninguna senal, UNKNOWN y sin grado', () => {
        const resuelta = resolverDistribucion({});
        expect(resuelta.policy).toBe('UNKNOWN');
        expect(resuelta.resolution).toBeUndefined();
    });

    it('el registro gana al rendimiento cuando estan los dos', () => {
        const resuelta = resolverDistribucion({ politicaDeclarada: 'acumulacion', rendimiento12m: 2 });
        expect(resuelta.resolution).toBe('OFFICIAL_REGISTER');
        expect(resuelta.policy).toBe('ACCUMULATING');
    });

    it('un valor del registro que no esta en la tabla NO se interpreta', () => {
        // Equivocarse aqui mete un sesgo que a cinco anios llega a dieciseis puntos.
        expect(resolverDistribucion({ politicaDeclarada: 'mixta' })).toEqual({ policy: 'UNKNOWN' });
        expect(POLITICA_DEL_REGISTRO['mixta']).toBeUndefined();
    });

    it('la tabla del registro cubre las dos ortografias del canonico, con y sin tilde', () => {
        expect(POLITICA_DEL_REGISTRO['acumulacion']).toBe('ACCUMULATING');
        expect(POLITICA_DEL_REGISTRO['acumulación']).toBe('ACCUMULATING');
        expect(POLITICA_DEL_REGISTRO['distribución']).toBe('DISTRIBUTING');
    });
});

describe('el contrato exige la procedencia de la politica', () => {
    const base = { source: 'canonical:fondosdb', as_of: '2026-09-30' };
    const TIPO = 'instrument-declared-profile.v2.schema.json';

    it('UNKNOWN puede ir sin grado: obligatorio significa declararlo, no conocerlo', () => {
        expect(validarForma(TIPO, { ...base, distribution_policy: 'UNKNOWN' }).ok).toBe(true);
    });

    it('una politica CONOCIDA sin grado NO valida', () => {
        // Sin esto, 'ACCUMULATING' a secas vuelve a ser una suposicion, que es el defecto que
        // todo este contrato persigue. Lo comprueba el esquema, no la disciplina.
        const sinGrado = validarForma(TIPO, { ...base, distribution_policy: 'ACCUMULATING' });
        expect(sinGrado.ok).toBe(false);
        expect(sinGrado.motivos.join(' ')).toContain('distribution_policy_resolution');
    });

    it('con grado, valida', () => {
        expect(
            validarForma(TIPO, {
                ...base,
                distribution_policy: 'ACCUMULATING',
                distribution_policy_resolution: 'OFFICIAL_REGISTER'
            }).ok
        ).toBe(true);
    });
});

describe('lo que desbloquea', () => {
    const conPolitica = (politica: string, grado?: string) => ({
        raiz: { instrument_type: 'FUND', classification: { category: 'X', asset_class: 'EQUITY' } },
        bloques: {
            'declared/profile': {
                source: 'x',
                as_of: '2026-09-30',
                distribution_policy: politica,
                ...(grado === undefined ? {} : { distribution_policy_resolution: grado })
            },
            'declared/provider_returns': { return_basis: 'TOTAL_RETURN', trailing_return: { '3y': { fund: 0.02 } } }
        }
    });

    it('con la politica conocida, su rentabilidad ya se puede comparar', () => {
        expect(aptitudesDe(conPolitica('ACCUMULATING', 'OFFICIAL_REGISTER')).COMPARAR_RENTABILIDAD.apt).toBe(true);
        expect(aptitudesDe(conPolitica('DISTRIBUTING', 'OBSERVED_DISTRIBUTION')).COMPARAR_RENTABILIDAD.apt).toBe(true);
    });

    it('con UNKNOWN sigue sin poderse comparar, y lo dice', () => {
        const veredicto = aptitudesDe(conPolitica('UNKNOWN'));
        expect(veredicto.COMPARAR_RENTABILIDAD.apt).toBe(false);
        expect(veredicto.COMPARAR_RENTABILIDAD.missing?.join(' ')).toContain('UNKNOWN');
    });
});

describe('los pagos registrados, que son la via fuerte', () => {
    it('un pago con importe PRUEBA que reparte, y con el grado de los registros', () => {
        expect(resolverDistribucion({ repartosConImporte: 5 })).toEqual({
            policy: 'DISTRIBUTING',
            resolution: 'PROVIDER_DISTRIBUTION_RECORDS'
        });
    });

    it('gana al rendimiento, porque son hechos fechados y no un agregado', () => {
        // Los dos dicen que reparte; lo que cambia es con que fuerza se puede defender, y
        // con los pagos ademas se puede reconstruir la serie.
        const resuelta = resolverDistribucion({ repartosConImporte: 2, rendimiento12m: 3.05 });
        expect(resuelta.resolution).toBe('PROVIDER_DISTRIBUTION_RECORDS');
    });

    it('una lista de pagos de importe CERO no prueba que reparta', () => {
        // El mismo cuidado que con el rendimiento: el proveedor lista a veces repartos de
        // importe cero, y contar la longitud de la lista los daria por buenos.
        expect(resolverDistribucion({ repartosConImporte: 0 })).toEqual({ policy: 'UNKNOWN' });
    });

    it('el registro oficial sigue mandando sobre los pagos', () => {
        const resuelta = resolverDistribucion({
            politicaDeclarada: 'acumulacion',
            repartosConImporte: 3
        });
        expect(resuelta.resolution).toBe('OFFICIAL_REGISTER');
    });
});

describe('la ausencia afirmada por el proveedor', () => {
    it('consultado y sin pagos es evidencia de ACUMULACION, en el grado mas debil', () => {
        expect(resolverDistribucion({ historialConsultado: true })).toEqual({
            policy: 'ACCUMULATING',
            resolution: 'PROVIDER_NO_RECORDS'
        });
    });

    it('consultado NO contradice unos pagos: si hay pagos, reparte', () => {
        const resuelta = resolverDistribucion({ historialConsultado: true, repartosConImporte: 1 });
        expect(resuelta.policy).toBe('DISTRIBUTING');
    });

    it('un false no resuelve nada: no preguntar no es evidencia de nada', () => {
        expect(resolverDistribucion({ historialConsultado: false })).toEqual({ policy: 'UNKNOWN' });
    });

    it('los grados estan ordenados de mas fuerte a mas debil', () => {
        // El orden no es decorativo: un informe puede decir en que se apoya, y
        // PROVIDER_NO_RECORDS es una ausencia afirmada por un tercero, no el folleto.
        // OFFICIAL_KID entro el 03-11-2026 y va segundo: es el documento de LA CLASE, que es
        // mas fuerte que cualquier cosa que un proveedor registre sobre sus pagos, y mas debil
        // que el registro oficial, que es el que la inscribe.
        expect([...GRADOS_DE_EVIDENCIA]).toEqual([
            'OFFICIAL_REGISTER',
            'OFFICIAL_KID',
            'PROVIDER_DISTRIBUTION_RECORDS',
            'OBSERVED_DISTRIBUTION',
            'PROVIDER_NO_RECORDS'
        ]);
    });

    it('el KID verificado gana a la ausencia de pagos, y solo en las clases declaradas', () => {
        /*
         * Los dos casos medidos el 03-11-2026 contrastando 28 KID: el proveedor devolvio el
         * historial vacio y la regla concluia ACCUMULATING, pero el documento de la clase dice
         * que reparte. Un historial vacio no acredita acumulacion en una clase facultada para
         * pagar.
         *
         * Y lo que esta prueba protege en la otra direccion: la regla acerto en 26 de los 28,
         * asi que la correccion NO puede alcanzar a una clase que no este declarada. Cambiar
         * la regla habria cambiado 26 respuestas correctas por dos.
         */
        const sinPagos = { historialConsultado: true };
        const conKid = resolverDistribucion({ ...sinPagos, politicaDelKid: 'distribucion' });
        expect(conKid.policy).toBe('DISTRIBUTING');
        expect(conKid.resolution).toBe('OFFICIAL_KID');
        // Y una clase sin KID leido sigue resolviendo como antes.
        const otra = resolverDistribucion(sinPagos);
        expect(otra.policy).toBe('ACCUMULATING');
        expect(otra.resolution).toBe('PROVIDER_NO_RECORDS');
    });

    it('el KID que dice que acumula sube el grado, y un valor raro no resuelve nada', () => {
        const r = resolverDistribucion({ historialConsultado: true, politicaDelKid: 'acumulacion' });
        expect(r.policy).toBe('ACCUMULATING');
        expect(r.resolution).toBe('OFFICIAL_KID');
        expect(resolverDistribucion({ politicaDelKid: 'quiza' }).policy).toBe('UNKNOWN');
        // Gana a los pagos: el documento habla de esta clase.
        const conPagos = resolverDistribucion({ repartosConImporte: 3, politicaDelKid: 'acumulacion' });
        expect(conPagos.resolution).toBe('OFFICIAL_KID');
    });
});

describe('el contrato de los repartos', () => {
    const TIPO = 'instrument-declared-distributions.v2.schema.json';
    const base = { source: 'canonical:fondosdb', as_of: '2026-09-30' };
    const pago = { date: '2026-03-06', amount_per_share: 1.25 };

    it('records_checked es obligatorio: sin el, una lista ausente dice dos cosas a la vez', () => {
        expect(validarForma(TIPO, base).ok).toBe(false);
        expect(validarForma(TIPO, { ...base, records_checked: false }).ok).toBe(true);
    });

    it('un pago sin fecha no vale: sin fecha no se puede sumar a la serie', () => {
        const sinFecha = validarForma(TIPO, {
            ...base,
            records_checked: true,
            currency: 'EUR',
            payments: [{ amount_per_share: 1.25 }]
        });
        expect(sinFecha.ok).toBe(false);
    });

    it('un pago sin importe tampoco: no hay nada que sumar', () => {
        expect(
            validarForma(TIPO, {
                ...base,
                records_checked: true,
                currency: 'EUR',
                payments: [{ date: '2026-03-06' }]
            }).ok
        ).toBe(false);
    });

    it('con un solo pago, la divisa pasa a ser obligatoria', () => {
        expect(validarForma(TIPO, { ...base, records_checked: true, payments: [pago] }).ok).toBe(false);
        expect(
            validarForma(TIPO, { ...base, records_checked: true, currency: 'EUR', payments: [pago] }).ok
        ).toBe(true);
    });

    it('sin pagos NO exige divisa: una clase que acumula no tiene importes', () => {
        expect(validarForma(TIPO, { ...base, records_checked: true }).ok).toBe(true);
    });

    it('un importe negativo no entra: un reparto no quita dinero al participe', () => {
        expect(
            validarForma(TIPO, {
                ...base,
                records_checked: true,
                currency: 'EUR',
                payments: [{ date: '2026-03-06', amount_per_share: -1 }]
            }).ok
        ).toBe(false);
    });

    it('el valor liquidativo del dia del reparto tiene sitio: es lo que capitaliza', () => {
        expect(
            validarForma(TIPO, {
                ...base,
                records_checked: true,
                currency: 'EUR',
                payments: [{ ...pago, nav_on_date: 49.54 }]
            }).ok
        ).toBe(true);
    });

    it('una clave no declarada no entra, como en todo bloque', () => {
        expect(
            validarForma(TIPO, { ...base, records_checked: true, politica: 'historial_repartos' }).ok
        ).toBe(false);
    });

    it('el rendimiento es FRACCION, y el rango caza el por ciento sin convertir', () => {
        // 2,51509 es el `yield_12m_pct` crudo de DE0005318406. Como fraccion seria un 251 %
        // repartido en doce meses, asi que el contrato lo rechaza: el rango no es decoracion,
        // es lo que detiene la conversion olvidada, que es el defecto que mas veces aparece.
        expect(validarForma(TIPO, { ...base, records_checked: false, yield_12m: 0.0251509 }).ok).toBe(true);
        expect(validarForma(TIPO, { ...base, records_checked: false, yield_12m: 2.51509 }).ok).toBe(false);
        expect(validarForma(TIPO, { ...base, records_checked: false, yield_12m: -1 }).ok).toBe(false);
        // Pero no lo caza todo: un por ciento entre 0 y 200 pasaria como fraccion sin que
        // nada avise. Lo que lo detiene de verdad es la prueba del mapper.
        expect(validarForma(TIPO, { ...base, records_checked: false, yield_12m: 1.5 }).ok).toBe(true);
    });
});
