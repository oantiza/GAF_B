import { describe, it, expect } from 'vitest';

import {
    TOLERANCIA_DE_LOS_PESOS,
    mapearCartera,
    motivoParaNoReoriginar,
    rutasPosiblesDeCartera,
    type CarteraDelAsesor
} from '../src/ingestion/baseNueva/carteras';
import { ASESOR_DE_LA_BASE_NUEVA } from '../src/config/baseNueva/asesores';
import { validarEscritura, validarForma } from '../src/config/baseNueva/validadores';
import { cargarEsquemas } from '../src/config/baseNueva/esquemas';

/**
 * El primer dominio de clientes que guarda algo.
 *
 * Lo que decidió estas pruebas: las 235 «posiciones» que la aplicación guarda son PESOS, no
 * tenencias. `weight_percent` y `asset_id`, sin títulos, sin coste y sin valor de mercado. Si
 * uno va al nombre que suena —posiciones— mete pesos en un campo de tenencias y nadie se
 * entera, porque un peso y un número de participaciones son los dos un número.
 */

/** El uid de Oscar en BDB, que es de donde vienen las 18 carteras importadas. */
const UID_EN_BDB = 'QMte7jgYd4PdutS3bLLXfY5uKzo1';

/** La forma real de una cartera guardada, copiada de una de las 23. */
function cartera(cambios: Partial<CarteraDelAsesor> = {}): CarteraDelAsesor {
    return {
        portfolio_id: 'c3abb136-018d-4c5d-8970-08e2cda49948',
        owner_uid: UID_EN_BDB,
        name: 'P30',
        base_currency: 'EUR',
        source_kind: 'BDB_APP_OWNED',
        created_at: '2026-08-19T13:07:06.413018+00:00',
        updated_at: '2026-08-19T13:07:06.413018+00:00',
        total_capital: 250000,
        positions: [
            { weight_percent: 60, asset_id: 'ES0178430E18', label: 'Telefonica' },
            { weight_percent: 40, asset_id: 'LU0171289902', label: 'Un fondo', keep_euros: false }
        ],
        ...cambios
    };
}

const doc = (r: ReturnType<typeof mapearCartera>, sufijo: string) =>
    r.documentos.find((d) => d.ruta.endsWith(sufijo));

describe('la cartera del asesor', () => {
    it('cuelga de si misma y no de un cliente, porque no hay cliente', () => {
        const r = mapearCartera(cartera());
        expect(r.errores).toEqual([]);
        expect(doc(r, 'portfolios/c3abb136-018d-4c5d-8970-08e2cda49948')?.ruta).toBe(
            'portfolios/c3abb136-018d-4c5d-8970-08e2cda49948'
        );
        const d = doc(r, '/c3abb136-018d-4c5d-8970-08e2cda49948')?.documento as Record<string, unknown>;
        expect(d['advisor_id']).toBe(ASESOR_DE_LA_BASE_NUEVA);
        expect(d['client_id']).toBeUndefined();
        expect(d['kind']).toBe('MODEL');
    });

    it('todo lo que sale pasa las dos puertas', () => {
        const r = mapearCartera(cartera());
        for (const d of r.documentos) {
            const veredicto = validarEscritura(d.tipo, d.documento, d.comoDueno ?? 'app');
            expect(veredicto.motivos, d.ruta).toEqual([]);
        }
    });

    it('una cartera modelo con client_id NO valida, ni una real con advisor_id', () => {
        // El dinero es de uno: no puede tener los dos dueños.
        const base = {
            portfolio_id: 'p1',
            schema_version: 'base-nueva.portfolio.v2',
            updated_at: '2026-08-19T13:07:06Z',
            name: 'P30',
            status: 'DRAFT',
            base_currency: 'EUR'
        };
        expect(validarForma('portfolio.v2.schema.json', { ...base, kind: 'MODEL', advisor_id: 'u1' }).ok).toBe(true);
        expect(
            validarForma('portfolio.v2.schema.json', { ...base, kind: 'MODEL', advisor_id: 'u1', client_id: 'c1' }).ok
        ).toBe(false);
        expect(validarForma('portfolio.v2.schema.json', { ...base, kind: 'MODEL' }).ok).toBe(false);
        expect(validarForma('portfolio.v2.schema.json', { ...base, kind: 'REAL', client_id: 'c1' }).ok).toBe(true);
        expect(validarForma('portfolio.v2.schema.json', { ...base, kind: 'REAL', advisor_id: 'u1' }).ok).toBe(false);
    });

    it('la ruta del contrato ya no nombra al cliente', () => {
        const porFichero = new Map(cargarEsquemas().map((e) => [e.fichero, e.coleccion]));
        expect(porFichero.get('portfolio.v2.schema.json')).toBe('portfolios/{portfolio_id}');
        expect(porFichero.get('portfolio-target.v2.schema.json')).toBe(
            'portfolios/{portfolio_id}/targets/{instrument_id}'
        );
        // El cliente sigue siendo un registro, para el dia que se decida que es.
        expect(porFichero.get('client.v2.schema.json')).toBe('clients/{client_id}');
    });
});

describe('los pesos van a targets, no a positions', () => {
    it('un peso entra como FRACCION y en su propio documento por instrumento', () => {
        const r = mapearCartera(cartera());
        const t = doc(r, '/targets/ES0178430E18')?.documento as Record<string, unknown>;
        expect(t['weight']).toBeCloseTo(0.6, 10);
        expect(t['instrument_id']).toBe('ES0178430E18');
        expect(t['set_by']).toBe(ASESOR_DE_LA_BASE_NUEVA);
    });

    it('cada objetivo declara el dueno de SU cartera, y es el mismo que el de la raiz', () => {
        // Es la invariante de la que dependen las reglas de Firestore desde el 03-11-2026:
        // conceden el objetivo por su `advisor_id`, no por `set_by`. Si el escritor deja de
        // copiarlo, o lo copia distinto del padre, un asesor pierde de vista sus propios
        // objetivos o ve los de otro, y las reglas no se enteran. La misma igualdad la
        // comprueba `audit:base-nueva` sobre la base ya escrita; aqui se comprueba sobre lo
        // que el escritor produce, que es antes.
        const r = mapearCartera(cartera());
        const raiz = r.documentos.find((d) => !d.ruta.includes('/targets/'))?.documento as Record<
            string,
            unknown
        >;
        const objetivos = r.documentos.filter((d) => d.ruta.includes('/targets/'));
        expect(objetivos.length).toBeGreaterThan(0);
        for (const objetivo of objetivos) {
            expect((objetivo.documento as Record<string, unknown>)['advisor_id']).toBe(raiz['advisor_id']);
        }
    });

    it('NINGUN peso acaba en un campo de tenencias', () => {
        // El 60 % no puede acabar como 60 participaciones. `positions` exige `units`, que es
        // un libro de operaciones y no existe en el sistema.
        const r = mapearCartera(cartera());
        expect(r.documentos.some((d) => d.ruta.includes('/positions/'))).toBe(false);
        for (const d of r.documentos) {
            expect(Object.keys(d.documento)).not.toContain('units');
        }
    });

    it('el nombre del activo NO se copia: vive en el instrumento', () => {
        const r = mapearCartera(cartera());
        const t = doc(r, '/targets/ES0178430E18')?.documento as Record<string, unknown>;
        expect(t['label']).toBeUndefined();
        // Y no se cuenta como perdida, porque no se pierde: esta en su sitio.
        expect(r.perdidas).toEqual([]);
    });

    it('un asset_id que no es un ISIN se queda fuera y se CUENTA', () => {
        const r = mapearCartera(
            cartera({ positions: [{ weight_percent: 100, asset_id: 'EFECTIVO' }] })
        );
        expect(r.perdidas.some((p) => p.includes('EFECTIVO'))).toBe(true);
        expect(r.documentos.some((d) => d.ruta.includes('/targets/'))).toBe(false);
    });
});

describe('unos pesos que no suman 1 no son un reparto', () => {
    it('se escribe la cartera pero NO sus pesos, y se dice por que', () => {
        // Medido el 01-11: 22 de las 23 suman 100 %, y una suma 181,25 %. Escribirlos haria
        // que cualquier grafico los normalizara y mostrara una cartera que no es la compuesta.
        const r = mapearCartera(
            cartera({
                positions: [
                    { weight_percent: 100, asset_id: 'ES0178430E18' },
                    { weight_percent: 81.25, asset_id: 'LU0171289902' }
                ]
            })
        );
        expect(doc(r, '/c3abb136-018d-4c5d-8970-08e2cda49948')).toBeDefined();
        expect(r.documentos.some((d) => d.ruta.includes('/targets/'))).toBe(false);
        expect(r.avisos.some((a) => a.includes('1.81250'))).toBe(true);
        expect(r.ausencias.find((a) => a.ruta === 'portfolio.targets')?.detalle).toContain('1.81250');
    });

    it('la tolerancia es la MISMA que la del reparto de un fondo', () => {
        // 99,5 % + 0,5 % entra; el redondeo de un proveedor no es un defecto de la cartera.
        const r = mapearCartera(
            cartera({
                positions: [
                    { weight_percent: 99.5, asset_id: 'ES0178430E18' },
                    { weight_percent: 0.4, asset_id: 'LU0171289902' }
                ]
            })
        );
        expect(r.documentos.filter((d) => d.ruta.includes('/targets/')).length).toBe(2);
    });
});

describe('lo que no esta no se inventa', () => {
    it('sin owner_uid no hay cartera: una cartera sin dueno es el defecto que esto arregla', () => {
        const r = mapearCartera(cartera({ owner_uid: undefined }));
        expect(r.errores.some((e) => e.includes('owner_uid'))).toBe(true);
        expect(r.documentos).toEqual([]);
    });

    /*
     * El uid de la fuente NO se copia. Es de BDB, y aqui no es nadie: las reglas conceden una
     * cartera comparando `advisor_id` con el uid de la sesion, asi que copiarlo escribe
     * documentos que su dueno no puede leer y la app dice «ninguna cartera guardada» con la
     * base entera dentro. Paso el 11-07-2026 en BDB con una rotacion de credenciales.
     */
    it('el uid de la fuente no se escribe en NINGUN campo', () => {
        const r = mapearCartera(cartera());
        expect(r.errores).toEqual([]);
        expect(JSON.stringify(r.documentos)).not.toContain(UID_EN_BDB);
        expect(JSON.stringify(r.documentos)).toContain(ASESOR_DE_LA_BASE_NUEVA);
    });

    it('un uid de origen que no esta declarado no se asigna al asesor que hay', () => {
        const r = mapearCartera(cartera({ owner_uid: 'de-otra-base' }));
        expect(r.errores.some((e) => e.includes('de-otra-base'))).toBe(true);
        expect(r.documentos).toEqual([]);
    });

    it('una divisa base que no es el euro es un error, no un caso a tolerar', () => {
        const r = mapearCartera(cartera({ base_currency: 'USD' }));
        expect(r.errores.some((e) => e.includes('EUR'))).toBe(true);
    });

    it('sin total_capital se anota la ausencia, no se pone un cero', () => {
        // Lo traen 19 de 23. Un cero diria que la propuesta es de cero euros.
        const r = mapearCartera(cartera({ total_capital: undefined }));
        const d = doc(r, '/c3abb136-018d-4c5d-8970-08e2cda49948')?.documento as Record<string, unknown>;
        expect(d['notional_capital']).toBeUndefined();
        expect(r.ausencias.find((a) => a.ruta === 'portfolio.notional_capital')?.razon).toBe('NOT_PROVIDED');
    });

    it('el estado es DRAFT, y es una eleccion declarada: la fuente no tiene ninguno', () => {
        const r = mapearCartera(cartera());
        const d = doc(r, '/c3abb136-018d-4c5d-8970-08e2cda49948')?.documento as Record<string, unknown>;
        // ACTIVE diria que la propuesta esta en vigor para alguien, y no cuelga de nadie.
        expect(d['status']).toBe('DRAFT');
    });

    it('created_at se conserva: lo traen las 23 y no tenia campo', () => {
        const r = mapearCartera(cartera());
        const d = doc(r, '/c3abb136-018d-4c5d-8970-08e2cda49948')?.documento as Record<string, unknown>;
        expect(d['created_at']).toBe('2026-08-19T13:07:06.413018+00:00');
    });
});

describe('una posicion retirada tiene que verse como sobrante', () => {
    /**
     * Una cartera se guarda SUSTITUYENDO: el asesor quita una posicion y la cartera se graba
     * otra vez sin ella. El plan solo marca como sobrante lo que esta en la base Y en la
     * lista de rutas posibles, asi que si esa lista se construyera solo con lo que trae la
     * fuente, el objetivo de la posicion retirada no aparecería y se quedaria en la base para
     * siempre. La cartera leida tendria una posicion que el asesor ya borro.
     */
    const ID = 'c3abb136';

    it('la ruta del instrumento retirado entra, para que el plan pueda marcarla', () => {
        const rutas = rutasPosiblesDeCartera(ID, ['ES0178430E18'], ['ES0178430E18', 'LU0171289902']);
        expect(rutas).toContain(`portfolios/${ID}/targets/LU0171289902`);
        expect(rutas).toContain(`portfolios/${ID}/targets/ES0178430E18`);
        expect(rutas).toContain(`portfolios/${ID}`);
    });

    it('sin la lista de la base, el retirado NO entra: es el defecto que esto evita', () => {
        const soloFuente = rutasPosiblesDeCartera(ID, ['ES0178430E18']);
        expect(soloFuente).not.toContain(`portfolios/${ID}/targets/LU0171289902`);
    });

    it('no repite una ruta que esta en las dos listas', () => {
        const rutas = rutasPosiblesDeCartera(ID, ['ES0178430E18'], ['ES0178430E18']);
        expect(rutas).toEqual([`portfolios/${ID}`, `portfolios/${ID}/targets/ES0178430E18`]);
    });

    it('la raiz de la cartera esta siempre, aunque no haya ni un peso', () => {
        expect(rutasPosiblesDeCartera(ID, [])).toEqual([`portfolios/${ID}`]);
    });
});

describe('el paso C: que cartera de la base vieja se re-origina y que no', () => {
    /*
     * `PLAN_INDEPENDENCIA_2026-11-01.md` tenia decidido que las 23 carteras nacieran de cero
     * «porque son Prueba 30 y similares, una con los pesos al 181,25 %». Medido el 02-11-2026
     * sobre la base vieja: eso es cierto de 4 y falso de las otras 19, que son trabajo de
     * cliente con 8 a 27 posiciones y capitales de 112.851 € a 1.130.987 €. Oscar decidio
     * traerlas, y estas pruebas fijan la frontera.
     */
    const cartera = (cambios: Record<string, unknown> = {}) => ({
        portfolio_id: 'local-20260907T085504332Z',
        owner_uid: UID_EN_BDB,
        name: 'AAXPE TOTAL',
        base_currency: 'EUR',
        source_kind: 'BDB_APP_OWNED',
        updated_at: '2026-09-15T10:00:00.000Z',
        total_capital: 512661,
        positions: [
            { asset_id: 'LU0210531983', weight_percent: 60 },
            { asset_id: 'IE00BYR8H148', weight_percent: 40 }
        ],
        ...cambios
    });

    it('una cartera de cliente con los pesos cuadrados entra', () => {
        expect(motivoParaNoReoriginar(cartera())).toBeUndefined();
    });

    it('una prueba no entra, y se dice que es una prueba', () => {
        expect(motivoParaNoReoriginar(cartera({ name: 'Prueba 30' }))).toBe('es una prueba, no una cartera');
        expect(motivoParaNoReoriginar(cartera({ name: 'P30' }))).toBe('es una prueba, no una cartera');
        /* Y el nombre se compara entero, no por parecido: una cartera real llamada «P40» o
           «Prueba de Carlos» no es una prueba de las cuatro que hay. */
        expect(motivoParaNoReoriginar(cartera({ name: 'P40' }))).toBeUndefined();
        expect(motivoParaNoReoriginar(cartera({ name: 'Prueba de Carlos' }))).toBeUndefined();
    });

    it('unos pesos que no suman 100 % dejan la cartera fuera, y NO se normalizan', () => {
        /* El caso real: `cp`, 8 posiciones, 100.000 €, pesos al 181,25 %. Normalizarla seria
           inventar los pesos que el asesor no puso. */
        const rota = cartera({
            name: 'cp',
            positions: [
                { asset_id: 'LU0210531983', weight_percent: 100 },
                { asset_id: 'IE00BYR8H148', weight_percent: 81.25 }
            ]
        });
        expect(motivoParaNoReoriginar(rota)).toBe('los pesos suman 181.25 % y no 100 %');
    });

    it('la tolerancia es del contrato de aqui, no de cada llamada', () => {
        /* 100,002 % entra: es el redondeo de catorce posiciones, medido en `carlos 2`. */
        expect(TOLERANCIA_DE_LOS_PESOS).toBe(0.5);
        const redondeo = cartera({
            positions: [
                { asset_id: 'LU0210531983', weight_percent: 60.001 },
                { asset_id: 'IE00BYR8H148', weight_percent: 40.001 }
            ]
        });
        expect(motivoParaNoReoriginar(redondeo)).toBeUndefined();
    });

    it('sin nombre o sin posiciones no hay cartera que traer', () => {
        expect(motivoParaNoReoriginar(cartera({ name: '   ' }))).toBe('sin nombre');
        expect(motivoParaNoReoriginar(cartera({ positions: [] }))).toBe('sin posiciones');
    });
});

describe('nivel de perfil y horizonte de la cartera modelo (decision 59)', () => {
    /*
     * La app los guarda en la raiz de `portfolios/{id}` desde el 09-11-2026, y el contrato tenia
     * `additionalProperties: false`: sin estos dos campos declarados, la auditoria y la subida
     * habrian marcado como no valida cualquier cartera que Oscar hubiese definido. Ausente es
     * ausente: los dos son opcionales y ninguno se deduce del otro.
     */
    const modelo = {
        portfolio_id: 'p1',
        schema_version: 'base-nueva.portfolio.v2',
        updated_at: '2026-11-09T10:00:00Z',
        kind: 'MODEL',
        advisor_id: 'u1',
        name: 'P30',
        status: 'DRAFT',
        base_currency: 'EUR'
    };
    const valida = (cambios: Record<string, unknown>) =>
        validarForma('portfolio.v2.schema.json', { ...modelo, ...cambios }).ok;

    it('una cartera con los dos campos valida, y una sin ninguno tambien', () => {
        expect(valida({ risk_profile_level: 4, horizon_years: 5 })).toBe(true);
        expect(valida({})).toBe(true);
    });

    it('cada uno puede ir sin el otro: no se deducen', () => {
        expect(valida({ risk_profile_level: 7 })).toBe(true);
        expect(valida({ horizon_years: 3 })).toBe(true);
        expect(valida({ horizon_years: 0.5 })).toBe(true);
    });

    it('los extremos de la escala valen: nivel 1 y 10, horizonte 100', () => {
        expect(valida({ risk_profile_level: 1 })).toBe(true);
        expect(valida({ risk_profile_level: 10 })).toBe(true);
        expect(valida({ horizon_years: 100 })).toBe(true);
    });

    it('se rechazan el nivel 0 y el 11, y un nivel que no es entero', () => {
        expect(valida({ risk_profile_level: 0 })).toBe(false);
        expect(valida({ risk_profile_level: 11 })).toBe(false);
        expect(valida({ risk_profile_level: 4.5 })).toBe(false);
        expect(valida({ risk_profile_level: '4' })).toBe(false);
    });

    it('se rechazan el horizonte 0, uno negativo y uno de mas de un siglo', () => {
        expect(valida({ horizon_years: 0 })).toBe(false);
        expect(valida({ horizon_years: -1 })).toBe(false);
        expect(valida({ horizon_years: 101 })).toBe(false);
    });

    it('un nulo no es una ausencia: la app no escribe el campo', () => {
        expect(valida({ risk_profile_level: null })).toBe(false);
        expect(valida({ horizon_years: null })).toBe(false);
    });

    it('el mapper de la base vieja no los inventa: la fuente no los trae', () => {
        const r = mapearCartera(cartera());
        const raiz = doc(r, '/c3abb136-018d-4c5d-8970-08e2cda49948')?.documento as Record<string, unknown>;
        expect(raiz['risk_profile_level']).toBeUndefined();
        expect(raiz['horizon_years']).toBeUndefined();
    });
});
