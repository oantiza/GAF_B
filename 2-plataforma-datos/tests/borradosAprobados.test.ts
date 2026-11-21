import * as fs from 'fs';
import * as path from 'path';

import { describe, it, expect } from 'vitest';

import {
    BORRADOS_APROBADOS,
    describirPlan,
    ejecutarBorrados,
    MINIMO_DE_INSTRUMENTOS_EN_EL_ORIGEN,
    planDeBorrados as planConLaLista,
    type BaseDeBorrados,
    type BorradoAprobado,
    type DecisionDeBorrado
} from '../src/ingestion/baseNueva/borradosAprobados';

/**
 * Lo único que esta base borra. Se prueba con una base de mentira porque lo que importa es qué DECIDE: lo
 * que Firestore hace de verdad lo comprueba el postverify. El mecanismo se prueba con una lista de prueba, un
 * ISIN inventado para no confundirlo con ningún fondo; la lista de verdad tiene su bloque aparte.
 */

const RUTA = 'instruments/XX0000000001/declared/exposure';
const RAIZ = 'instruments/XX0000000001';
const OTRAS = [
    'instruments/XX0000000001/declared/costs',
    'instruments/XX0000000001/read/card',
    'instruments/IE00B4L5Y983/declared/exposure'
];
const LISTA_DE_PRUEBA: readonly BorradoAprobado[] = [
    { ruta: RUTA, decision: 'una decision de prueba', fecha: '2026-11-05', motivo: 'un motivo de prueba' }
];
const planDeBorrados = (base: BaseDeBorrados, delOrigen: ReadonlySet<string>) => planConLaLista(base, delOrigen, LISTA_DE_PRUEBA);

function baseDeMentira(rutas: string[]) {
    const guardado = new Map<string, Record<string, unknown>>(rutas.map((ruta) => [ruta, { as_of: '2026-06-30' }]));
    const borradas: string[] = [];
    const base: BaseDeBorrados = {
        doc(ruta: string) {
            return {
                async get() {
                    return { exists: guardado.has(ruta), data: () => guardado.get(ruta) };
                },
                async delete() {
                    borradas.push(ruta);
                    guardado.delete(ruta);
                }
            };
        }
    };
    return { base, guardado, borradas };
}

describe('la lista de lo que se puede borrar', () => {
    it('una ruta aprobada es una ruta entera, nunca un patrón', () => {
        for (const { ruta } of LISTA_DE_PRUEBA) {
            expect(ruta).toMatch(/^instruments\/[A-Z0-9]{12}\/declared\/[a-z_]+$/);
        }
    });
});

describe('qué se decide', () => {
    it('se borra lo que está en el destino y el origen ya no tiene', async () => {
        const { base, borradas } = baseDeMentira([RUTA, ...OTRAS]);
        const plan = await planDeBorrados(base, new Set([RAIZ, ...OTRAS]));
        expect(plan.map((decision) => [decision.ruta, decision.destino])).toEqual([[RUTA, 'SE_BORRA']]);
        expect(plan[0]!.as_of).toBe('2026-06-30');
        /* Planificar no borra. */
        expect(borradas).toEqual([]);
    });

    it('si el origen vuelve a tenerla, hay un reparto que cuadra: no se borra', async () => {
        const { base } = baseDeMentira([RUTA]);
        const plan = await planDeBorrados(base, new Set([RAIZ, RUTA]));
        expect(plan[0]!.destino).toBe('EL_ORIGEN_LA_TRAE');
    });

    it('un origen vacío no es un origen que no lo tenga: un fallo de lectura no borra nada', async () => {
        const { base } = baseDeMentira([RUTA]);
        const plan = await planDeBorrados(base, new Set());
        expect(plan[0]!.destino).toBe('ORIGEN_SIN_EL_INSTRUMENTO');
    });

    it('lo que ya no está no se vuelve a borrar', async () => {
        const { base } = baseDeMentira(OTRAS);
        const plan = await planDeBorrados(base, new Set([RAIZ, ...OTRAS]));
        expect(plan[0]!.destino).toBe('YA_NO_ESTA');
    });

    it('el plan lo enseña como un borrado explícito de esa ruta, y solo esa', async () => {
        const { base } = baseDeMentira([RUTA, ...OTRAS]);
        const lineas = describirPlan(await planDeBorrados(base, new Set([RAIZ, ...OTRAS]))).join('\n');
        expect(lineas).toContain(`SE BORRARIA (dato del 2026-06-30): ${RUTA}`);
        for (const otra of OTRAS) expect(lineas).not.toContain(otra);
    });
});

/** Un catálogo creíble: raíces de instrumento inventadas, tantas como el suelo pide. */
const catalogoEntero = () =>
    new Set(Array.from({ length: MINIMO_DE_INSTRUMENTOS_EN_EL_ORIGEN }, (_, i) => `instruments/YY${String(i).padStart(10, '0')}`));

describe('un instrumento retirado entero', () => {
    const RETIRADA: readonly BorradoAprobado[] = [{ ...LISTA_DE_PRUEBA[0]!, instrumento_retirado: true }];
    const plan = (base: BaseDeBorrados, delOrigen: ReadonlySet<string>) => planConLaLista(base, delOrigen, RETIRADA);

    it('que el origen no lo tenga es lo esperado: se borra', async () => {
        const { base } = baseDeMentira([RUTA]);
        expect((await plan(base, catalogoEntero()))[0]!.destino).toBe('SE_BORRA');
    });

    it('sin la marca, ese mismo origen no borra nada', async () => {
        const { base } = baseDeMentira([RUTA]);
        expect((await planConLaLista(base, catalogoEntero(), LISTA_DE_PRUEBA))[0]!.destino).toBe('ORIGEN_SIN_EL_INSTRUMENTO');
    });

    it('un origen vacío o a medias no vale: un fallo de lectura no borra nada', async () => {
        const { base, borradas } = baseDeMentira([RUTA]);
        for (const origen of [new Set<string>(), new Set([...catalogoEntero()].slice(1))]) {
            const decidido = await plan(base, origen);
            expect(decidido[0]!.destino).toBe('ORIGEN_INCOMPLETO');
            expect(await ejecutarBorrados(base, decidido, true, RETIRADA)).toEqual({ borrados: [], siguen: [] });
        }
        expect(borradas).toEqual([]);
    });

    it('si el instrumento vuelve al origen, no se borra', async () => {
        const { base } = baseDeMentira([RUTA]);
        expect((await plan(base, new Set([...catalogoEntero(), RAIZ])))[0]!.destino).toBe('EL_ORIGEN_LA_TRAE');
    });

    it('si en el destino ya no está, no hay nada que hacer', async () => {
        const { base } = baseDeMentira([]);
        expect((await plan(base, catalogoEntero()))[0]!.destino).toBe('YA_NO_ESTA');
    });
});

describe('la lista de verdad (decisiones 45, 49, B-64, B-67, B-70 y B-82)', () => {
    const rutas = BORRADOS_APROBADOS.map((aprobado) => aprobado.ruta);
    const deHoneywell = rutas.filter((ruta) => ruta.includes('US4385162056'));
    const dePrysmian = rutas.filter((ruta) => ruta.includes('IT0004176001') || ruta === 'issuers/ISS_000478');
    const deAllianz = rutas.filter((ruta) => ruta.includes('DE0008404005'));
    const deIusq = rutas.filter((ruta) => ruta.includes('IE00B6R52259'));
    const deBlackRock = rutas.filter((ruta) => ruta.includes('LU0171283459'));
    const deXtrackers = rutas.filter((ruta) => ruta.includes('LU0290358497'));
    /* Las seis acciones a las que EODHD recortó la historia (B-82), con los años enteros que sobran de cada una. */
    const RECORTADAS: Record<string, [number, number]> = {
        GB0005405286: [1988, 1991], // HSBC: hoy empieza el 11-06-1992
        GB0007908733: [1991, 1992], // SSE: el 01-07-1993
        US0079031078: [1980, 1983], // AMD: el 05-11-1984
        US30233Q1085: [1980, 1983], // Exxon Mobil: el 05-11-1984
        US8825081040: [1972, 1979], // Texas Instruments: el 17-03-1980
        US98389B1008: [1973, 1983] //  Xcel Energy: el 05-11-1984
    };
    const deLasRecortadas = rutas.filter((ruta) => Object.keys(RECORTADAS).some((isin) => ruta.includes(isin)));

    it('son 182, sin repetir y sin ninguna más', () => {
        /* 149 hasta la B-70, y 33 de la B-82: 4 + 2 + 4 + 4 + 8 + 11. */
        expect(rutas).toHaveLength(182);
        expect(new Set(rutas).size).toBe(182);
        expect(deLasRecortadas).toHaveLength(33);
        expect(deHoneywell).toHaveLength(74);
        expect(dePrysmian).toHaveLength(12);
        expect(deAllianz).toHaveLength(5);
        expect(deIusq).toHaveLength(1);
        expect(deBlackRock).toHaveLength(1);
        expect(deXtrackers).toHaveLength(56);
    });

    it('del Xtrackers monetario sale el instrumento entero: raíz, 2 computed, 11 declared, 20 años de VL y 20 de serie, calidad y tarjeta (decisión B-70)', () => {
        const bloque = (ruta: string) => ruta.split('/')[2] ?? 'raiz';
        const porBloque = deXtrackers.reduce<Record<string, number>>((cuenta, ruta) => {
            cuenta[bloque(ruta)] = (cuenta[bloque(ruta)] ?? 0) + 1;
            return cuenta;
        }, {});
        expect(porBloque).toEqual({ raiz: 1, computed: 2, declared: 11, issuer_nav: 20, price_series: 20, quality: 1, read: 1 });
        const anos = (sub: string) =>
            deXtrackers.filter((ruta) => ruta.includes(`/${sub}/`)).map((ruta) => Number(ruta.split('/').pop()));
        const de2007a2026 = Array.from({ length: 20 }, (_, i) => 2007 + i);
        expect(anos('issuer_nav')).toEqual(de2007a2026);
        expect(anos('price_series')).toEqual(de2007a2026);
        expect(rutas.filter((ruta) => ruta.startsWith('instrument_issuer/LU0290358497'))).toEqual([]);
        for (const ruta of deXtrackers) {
            const aprobado = BORRADOS_APROBADOS.find((candidato) => candidato.ruta === ruta)!;
            expect(aprobado).toMatchObject({ decision: 'decisión B-70 de Óscar', fecha: '2026-11-09', instrumento_retirado: true });
            expect(aprobado.motivo).toContain('único monetario');
            expect(aprobado.motivo).toContain('Rendimiento');
        }
    });

    it('de BlackRock Global Allocation solo salen sus métricas viejas, y ni la raíz ni otro bloque (decisión B-67)', () => {
        expect(deBlackRock).toEqual(['instruments/LU0171283459/computed/metrics']);
        const aprobado = BORRADOS_APROBADOS.find((candidato) => candidato.ruta === deBlackRock[0])!;
        expect(aprobado).toMatchObject({ decision: 'decisión B-67 de Óscar, 09-11-2026', fecha: '2026-11-09' });
        expect(aprobado.motivo).toContain('SERIES_STOPPED');
        expect(aprobado.instrumento_retirado).toBeUndefined();
    });

    it('BlackRock: con el instrumento en el origen y sin métricas, se borran; si el origen las vuelve a traer, no; sin el instrumento, tampoco', async () => {
        const raiz = 'instruments/LU0171283459';
        const metricas = `${raiz}/computed/metrics`;
        const cotizacion = `${raiz}/declared/quote`;
        const soloBlackRock = BORRADOS_APROBADOS.filter((aprobado) => aprobado.ruta === metricas);
        const { base, borradas, guardado } = baseDeMentira([raiz, metricas, cotizacion]);
        expect((await planConLaLista(base, new Set([raiz, cotizacion, metricas]), soloBlackRock))[0]!.destino).toBe('EL_ORIGEN_LA_TRAE');
        expect((await planConLaLista(base, catalogoEntero(), soloBlackRock))[0]!.destino).toBe('ORIGEN_SIN_EL_INSTRUMENTO');
        const plan = await planConLaLista(base, new Set([...catalogoEntero(), raiz, cotizacion]), soloBlackRock);
        expect(plan.map((decision) => decision.destino)).toEqual(['SE_BORRA']);
        expect(await ejecutarBorrados(base, plan, true)).toEqual({ borrados: [metricas], siguen: [] });
        expect(borradas).toEqual([metricas]);
        expect(guardado.has(raiz)).toBe(true);
        expect(guardado.has(cotizacion)).toBe(true);
    });

    it('de cada acción recortada salen los años enteros anteriores al primero que hoy da el proveedor, y nada más (decisión B-82)', () => {
        for (const [isin, [desde, hasta]] of Object.entries(RECORTADAS)) {
            const suyas = rutas.filter((ruta) => ruta.includes(isin));
            const esperadas = Array.from({ length: hasta - desde + 1 }, (_, i) => `instruments/${isin}/price_series/${desde + i}`);
            expect(suyas, isin).toEqual(esperadas);
        }
        for (const ruta of deLasRecortadas) {
            const aprobado = BORRADOS_APROBADOS.find((candidato) => candidato.ruta === ruta)!;
            expect(aprobado).toMatchObject({ decision: 'decisión B-82 de Óscar', fecha: '2026-11-16' });
            expect(aprobado.motivo).toContain('EODHD recortó la serie');
            /* El instrumento se queda: solo sobran años de su serie. */
            expect(aprobado.instrumento_retirado).toBeUndefined();
        }
    });

    it('AMD: con el instrumento en el origen y sin esos años, se borran; el año en que hoy empieza se queda; si un año vuelve, ese no', async () => {
        const raiz = 'instruments/US0079031078';
        const ano = (n: number) => `${raiz}/price_series/${n}`;
        const sobran = [1980, 1981, 1982, 1983].map(ano);
        const soloAmd = BORRADOS_APROBADOS.filter((aprobado) => aprobado.ruta.startsWith(`${raiz}/`));
        expect(soloAmd.map((aprobado) => aprobado.ruta)).toEqual(sobran);
        const { base, borradas, guardado } = baseDeMentira([raiz, ...sobran, ano(1984), ano(1985)]);
        /* Sin el instrumento en el origen no se puede decir que sobra nada. */
        expect((await planConLaLista(base, catalogoEntero(), soloAmd)).map((d) => d.destino)).toEqual(Array(4).fill('ORIGEN_SIN_EL_INSTRUMENTO'));
        /* Si el proveedor vuelve a dar 1983, ese se escribe y no se borra; los otros tres siguen sobrando. */
        const conUnoDeVuelta = await planConLaLista(base, new Set([...catalogoEntero(), raiz, ano(1983), ano(1984), ano(1985)]), soloAmd);
        expect(conUnoDeVuelta.map((d) => d.destino)).toEqual(['SE_BORRA', 'SE_BORRA', 'SE_BORRA', 'EL_ORIGEN_LA_TRAE']);
        /* Lo de hoy: el origen trae desde 1984. */
        const plan = await planConLaLista(base, new Set([...catalogoEntero(), raiz, ano(1984), ano(1985)]), soloAmd);
        expect(plan.map((d) => d.destino)).toEqual(Array(4).fill('SE_BORRA'));
        const hecho = await ejecutarBorrados(base, plan, true);
        expect([...hecho.borrados].sort()).toEqual(sobran);
        expect(hecho.siguen).toEqual([]);
        expect([...borradas].sort()).toEqual(sobran);
        expect(guardado.has(raiz)).toBe(true);
        expect(guardado.has(ano(1984))).toBe(true);
        expect(guardado.has(ano(1985))).toBe(true);
    });

    it('de IUSQ solo sale el año que el proveedor recortó, 2011, y ni la raíz ni 2012 (decisión B-64)', () => {
        expect(deIusq).toEqual(['instruments/IE00B6R52259/price_series/2011']);
        const aprobado = BORRADOS_APROBADOS.find((candidato) => candidato.ruta === deIusq[0])!;
        expect(aprobado).toMatchObject({ decision: 'decisión B-64 de Óscar', fecha: '2026-11-09' });
        expect(aprobado.motivo).toContain('recortó la serie');
        expect(aprobado.instrumento_retirado).toBeUndefined();
    });

    it('IUSQ: con el instrumento en el origen y sin 2011, se borra; si 2011 vuelve, no; sin el instrumento, tampoco', async () => {
        const raiz = 'instruments/IE00B6R52259';
        const ano2011 = `${raiz}/price_series/2011`;
        const ano2012 = `${raiz}/price_series/2012`;
        const soloIusq = BORRADOS_APROBADOS.filter((aprobado) => aprobado.ruta === ano2011);
        const { base, borradas, guardado } = baseDeMentira([raiz, ano2011, ano2012]);
        expect((await planConLaLista(base, new Set([raiz, ano2012, ano2011]), soloIusq))[0]!.destino).toBe('EL_ORIGEN_LA_TRAE');
        expect((await planConLaLista(base, catalogoEntero(), soloIusq))[0]!.destino).toBe('ORIGEN_SIN_EL_INSTRUMENTO');
        const plan = await planConLaLista(base, new Set([...catalogoEntero(), raiz, ano2012]), soloIusq);
        expect(plan.map((decision) => decision.destino)).toEqual(['SE_BORRA']);
        expect(await ejecutarBorrados(base, plan, true)).toEqual({ borrados: [ano2011], siguen: [] });
        expect(borradas).toEqual([ano2011]);
        expect(guardado.has(raiz)).toBe(true);
        expect(guardado.has(ano2012)).toBe(true);
    });

    it('de Allianz solo salen los años anteriores a Xetra, y ni la raíz ni 1994', () => {
        expect(deAllianz).toEqual([1989, 1990, 1991, 1992, 1993].map((ano) => `instruments/DE0008404005/price_series/${ano}`));
    });

    it('cada una es una ruta entera y conocida, nunca un patrón', () => {
        for (const ruta of rutas) {
            expect(ruta).toMatch(
                /^(instruments\/[A-Z0-9]{12}(\/(computed\/(metrics|premium_discount)|read\/card|quality\/latest|declared\/[a-z_]+|(price_series|issuer_nav)\/[0-9]{4}))?|instrument_issuer\/[A-Z0-9]{12}_EQUITY_ISSUER|issuers\/ISS_[0-9]{6})$/
            );
        }
    });

    it('no toca lo que se queda: ni el ISIN vigente de Honeywell ni su emisor, que los dos ISIN compartían', () => {
        expect(rutas.filter((ruta) => ruta.includes('US4385161066'))).toEqual([]);
        expect(rutas).not.toContain('issuers/ISS_000258');
    });

    it('cada una dice su decisión, y solo las de un instrumento que se va llevan la marca de retirado', () => {
        for (const aprobado of BORRADOS_APROBADOS) {
            const esDeAllianz = deAllianz.includes(aprobado.ruta);
            const esDeIusq = deIusq.includes(aprobado.ruta);
            const esDeBlackRock = deBlackRock.includes(aprobado.ruta);
            const esRecortada = deLasRecortadas.includes(aprobado.ruta);
            expect(aprobado.instrumento_retirado).toBe(esDeAllianz || esDeIusq || esDeBlackRock || esRecortada ? undefined : true);
            expect(aprobado.decision).toContain(
                esRecortada
                    ? 'decisión B-82'
                    : esDeAllianz
                    ? 'decisión 49'
                    : esDeIusq
                      ? 'decisión B-64'
                      : esDeBlackRock
                        ? 'decisión B-67'
                        : deXtrackers.includes(aprobado.ruta)
                          ? 'decisión B-70'
                          : deHoneywell.includes(aprobado.ruta)
                            ? 'decisión 39'
                            : 'decisión 44'
            );
            expect(aprobado.fecha).toBe(
                esRecortada ? '2026-11-16' : esDeIusq || esDeBlackRock || deXtrackers.includes(aprobado.ruta) ? '2026-11-09' : '2026-11-08'
            );
        }
    });

    it('con un catálogo entero que no los trae se borran las 182 y ni una más', async () => {
        const quedan = [
            'instruments/US4385161066',
            'issuers/ISS_000258',
            'instrument_issuer/US4385161066_EQUITY_ISSUER',
            'instruments/DE0008404005',
            'instruments/DE0008404005/price_series/1994',
            'instruments/IE00B6R52259',
            'instruments/IE00B6R52259/price_series/2012',
            'instruments/LU0171283459',
            'instruments/LU0171283459/declared/quote',
            /* Las seis recortadas siguen en el catálogo, con el año en que hoy empieza su serie. */
            ...Object.entries(RECORTADAS).flatMap(([isin, [, hasta]]) => [`instruments/${isin}`, `instruments/${isin}/price_series/${hasta + 1}`])
        ];
        const { base, borradas, guardado } = baseDeMentira([...rutas, ...quedan]);
        const plan = await planConLaLista(base, new Set([...catalogoEntero(), ...quedan]));
        expect(plan.every((decision) => decision.destino === 'SE_BORRA')).toBe(true);
        expect((await ejecutarBorrados(base, plan, true)).borrados).toHaveLength(182);
        expect(borradas).toHaveLength(182);
        for (const ruta of quedan) expect(guardado.has(ruta)).toBe(true);
    });
});

describe('qué se borra', () => {
    it('sin la puerta no borra, aunque el plan diga que sí', async () => {
        const { base, borradas, guardado } = baseDeMentira([RUTA]);
        const plan = await planDeBorrados(base, new Set([RAIZ]));
        await expect(ejecutarBorrados(base, plan, false)).rejects.toThrow('puerta');
        expect(borradas).toEqual([]);
        expect(guardado.has(RUTA)).toBe(true);
    });

    it('con la puerta borra esa ruta y no toca ninguna otra', async () => {
        const { base, borradas, guardado } = baseDeMentira([RUTA, ...OTRAS]);
        const plan = await planDeBorrados(base, new Set([RAIZ, ...OTRAS]));
        const resultado = await ejecutarBorrados(base, plan, true, LISTA_DE_PRUEBA);
        expect(resultado).toEqual({ borrados: [RUTA], siguen: [] });
        expect(borradas).toEqual([RUTA]);
        for (const otra of OTRAS) expect(guardado.has(otra)).toBe(true);
    });

    it('un plan no puede ampliar lo aprobado: una ruta que no está en la lista no se borra', async () => {
        const { base, borradas } = baseDeMentira(OTRAS);
        const trucado: DecisionDeBorrado[] = [
            { ruta: OTRAS[0]!, decision: 'nadie', fecha: '2026-11-05', motivo: 'porque si', destino: 'SE_BORRA' }
        ];
        await expect(ejecutarBorrados(base, trucado, true, LISTA_DE_PRUEBA)).rejects.toThrow('BORRADOS_APROBADOS');
        expect(borradas).toEqual([]);
    });

    it('solo borra lo que el plan marca para borrar', async () => {
        const { base, borradas } = baseDeMentira([RUTA]);
        const plan = await planDeBorrados(base, new Set([RAIZ, RUTA]));
        expect(await ejecutarBorrados(base, plan, true, LISTA_DE_PRUEBA)).toEqual({ borrados: [], siguen: [] });
        expect(borradas).toEqual([]);
    });

    it('si al volver a leer sigue ahí, lo dice', async () => {
        const terco: BaseDeBorrados = {
            doc: () => ({
                get: async () => ({ exists: true, data: () => ({ as_of: '2026-06-30' }) }),
                delete: async () => undefined
            })
        };
        const plan = await planDeBorrados(terco, new Set([RAIZ]));
        expect(await ejecutarBorrados(terco, plan, true, LISTA_DE_PRUEBA)).toEqual({ borrados: [RUTA], siguen: [RUTA] });
    });
});

describe('las dos órdenes que borran', () => {
    const fuente = (fichero: string) => fs.readFileSync(path.join(__dirname, '..', 'scripts', fichero), 'utf-8');

    it('la subida no borra por su cuenta: solo por `ejecutarBorrados`, después de la vuelta de `--escribe`', () => {
        const subida = fuente('subirALaNube.ts');
        expect(subida).not.toMatch(/\.delete\(/);
        expect(subida).not.toMatch(/recursiveDelete/);
        expect(subida.match(/ejecutarBorrados\(/g)).toHaveLength(1);
        const seca = subida.indexOf('NADA escrito ni borrado en la nube');
        const borra = subida.indexOf('ejecutarBorrados(');
        expect(seca).toBeGreaterThan(-1);
        expect(borra).toBeGreaterThan(seca);
        expect(subida).toContain('escribir && process.env[PUERTA] === FRASE');
    });

    it('la subida exige la frase antes de leer nada, y carteras no decide borrados', () => {
        const subida = fuente('subirALaNube.ts');
        expect(subida).toContain("parte === 'catalogo' || parte === 'todo'");
        expect(subida.indexOf('leerElEmulador(parte, conCarteraDelEmisor)')).toBeGreaterThan(-1);
        expect(subida.indexOf('falta la puerta')).toBeLessThan(subida.indexOf('leerElEmulador(parte, conCarteraDelEmisor)'));
    });

    it('la orden del emulador no acepta rutas: solo la lista, y con las barreras del escritor', () => {
        const orden = fuente('runBaseNuevaBorrados.ts');
        expect(orden).toContain('motivosParaNoEscribir()');
        expect(orden).toContain('obtenerDb()');
        expect(orden).not.toMatch(/\.delete\(/);
        expect(orden).not.toMatch(/process\.argv\[/);
        expect(orden).toContain("process.argv.includes('--write')");
    });
});
