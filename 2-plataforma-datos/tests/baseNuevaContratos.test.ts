import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import {
    AUSENCIAS,
    BASES_RENTABILIDAD,
    CAPAS,
    CENTINELAS_PROHIBIDOS,
    DIVISA_BASE,
    DUENOS,
    GRUPOS_SINONIMOS,
    PERIODOS,
    SUFIJOS_DE_UNIDAD_PROHIBIDOS,
    TIPOS_OPERACION,
    TIPOS_OPERACION_VALIDOS,
    TOPE_LISTA,
    UNIDADES,
    claseDeFlujo,
    magnitudDe,
    unidadEsperada
} from '../src/config/baseNueva/vocabulario';
import {
    cargarEsquemas,
    coleccionesRaizDeclaradas,
    hojaDe,
    rutasDe,
    subcoleccionesDeclaradas,
    type NodoEsquema
} from '../src/config/baseNueva/esquemas';

/**
 * Las siete comprobaciones de la base nueva.
 *
 * Siguen el patron de `tests/projectAllowlist.test.ts`, que es el que funciona en este
 * proyecto: una sola fuente para el vocabulario —aqui, `src/config/baseNueva/vocabulario.ts`—
 * y pruebas que la leen de ahi en vez de repetir sus literales. Sin estas pruebas el
 * contrato es una promesa; con ellas, una barrera.
 *
 * Cada una nombra el defecto medido de la maestra de hoy que habria parado.
 */

const ESQUEMAS = cargarEsquemas();
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

/** Todas las rutas, con el fichero que las declara. */
const RUTAS = ESQUEMAS.flatMap((esquema) => rutasDe(esquema));

/** Las capas que escriben datos de verdad; la proyeccion no es fuente de nada. */
const esProyeccion = (fichero: string): boolean => {
    const esquema = ESQUEMAS.find((candidato) => candidato.fichero === fichero);
    return esquema?.json['x-layer'] === 'projection';
};

/** Magnitudes que son una rentabilidad: sin base declarada no se pueden leer. */
const MAGNITUDES_DE_RENTABILIDAD = new Set([
    'annualized_return',
    'trailing_return',
    'ytd_return',
    'twr',
    'mwr',
    'mwr_annualized',
    'jensen_alpha',
    'active_return',
    'provider_alpha'
]);

/** Que dueno puede escribir en que capa. `metadata` lo escribe quien escribe el documento. */
const DUENOS_POR_CAPA: Record<string, readonly string[]> = {
    declared: ['platform', 'app'],
    computed: ['platform', 'batch'],
    ledger: ['app'],
    human: ['human', 'app'],
    projection: ['batch'],
    metadata: ['platform', 'app', 'batch', 'human']
};

describe('base nueva: el vocabulario es uno solo', () => {
    it('declara las listas cerradas y ninguna esta vacia', () => {
        expect(UNIDADES.length).toBeGreaterThan(0);
        expect(CAPAS).toContain('declared');
        expect(CAPAS).toContain('computed');
        expect(CAPAS).toContain('ledger');
        expect(CAPAS).toContain('human');
        expect(DUENOS).toEqual(['platform', 'app', 'batch', 'human']);
        expect(AUSENCIAS).toEqual(['NOT_APPLICABLE', 'NOT_PROVIDED', 'NOT_YET_FETCHED']);
        expect(PERIODOS).toEqual(['1y', '3y', '5y', '10y']);
        expect(DIVISA_BASE).toBe('EUR');
    });

    it('el mapa de tipos de operacion no tiene valor por defecto', () => {
        // El clasificador de hoy acaba en `return 'OTRO', False`, y ese False significa
        // interno, que significa "cuenta como rentabilidad". Aqui un tipo desconocido es
        // undefined y la ingesta tiene que pararse.
        expect(claseDeFlujo('UN_TIPO_QUE_NO_EXISTE')).toBeUndefined();
        expect(claseDeFlujo('')).toBeUndefined();
        expect(claseDeFlujo(undefined)).toBeUndefined();
        expect(claseDeFlujo('OTRO')).toBeUndefined();
    });

    it('clasifica el dinero que entra y sale del titular como externo, y el coste como interno', () => {
        expect(claseDeFlujo('CASH_IN')).toBe('EXTERNAL');
        expect(claseDeFlujo('CASH_OUT')).toBe('EXTERNAL');
        expect(claseDeFlujo('FEE')).toBe('INTERNAL');
        expect(claseDeFlujo('DIVIDEND')).toBe('INTERNAL');
        // Las marcas sin importe tienen clase propia: hoy APERTURA cae en interno y no
        // hace dano solo porque el importe viene vacio.
        expect(claseDeFlujo('ACCOUNT_OPEN')).toBe('NON_CASH');
        // Los traspasos no son una funcion del tipo: se resuelven emparejando las patas.
        expect(claseDeFlujo('TRANSFER_IN')).toBe('PAIRING');
        expect(claseDeFlujo('TRANSFER_OUT')).toBe('PAIRING');
    });

    it('todo tipo del mapa tiene una clase, y ninguna clase inventada', () => {
        const permitidas = new Set(['EXTERNAL', 'INTERNAL', 'NON_CASH', 'PAIRING']);
        for (const [tipo, clase] of Object.entries(TIPOS_OPERACION)) {
            expect(permitidas.has(clase), `${tipo} declara ${clase}`).toBe(true);
        }
    });

    it('normaliza la magnitud quitando periodo y sujeto', () => {
        expect(magnitudDe('volatility.3y.fund')).toBe('volatility');
        expect(magnitudDe('metrics.volatility_3y')).toBe('volatility');
        expect(unidadEsperada('volatility.3y.benchmark')).toBe('fraction');
        expect(unidadEsperada('sharpe.5y.fund')).toBe('ratio');
        expect(unidadEsperada('effective_duration')).toBe('years');
    });
});

describe('1. cobertura: nada se escribe sin estar declarado', () => {
    it('todos los esquemas compilan, asi que pueden hacer de puerta', () => {
        for (const esquema of ESQUEMAS) {
            expect(() => ajv.compile(esquema.json), esquema.fichero).not.toThrow();
        }
        expect(ESQUEMAS.length).toBeGreaterThanOrEqual(20);
    });

    it('todo esquema declara la coleccion de Firestore que describe', () => {
        const sinColeccion = ESQUEMAS.filter((esquema) => esquema.coleccion === '').map((e) => e.fichero);
        expect(sinColeccion).toEqual([]);
    });

    it('todo objeto con propiedades esta CERRADO: una clave no declarada no entra', () => {
        // Esta es la prueba de cobertura en forma de contrato. Hoy la maestra escribe 986
        // rutas de 1.088 que el contrato no declara, y puede hacerlo porque los bloques
        // estan abiertos. Con additionalProperties:false en todos, no puede.
        const abiertos: string[] = [];
        for (const esquema of ESQUEMAS) {
            for (const { ruta, nodo } of rutasDe(esquema).map((r) => ({ ruta: r.ruta, nodo: r.nodo }))) {
                if (nodo['properties'] === undefined) continue;
                if (nodo['additionalProperties'] !== false) abiertos.push(`${esquema.fichero}:${ruta}`);
            }
            if (esquema.json['properties'] !== undefined && esquema.json['additionalProperties'] !== false) {
                abiertos.push(`${esquema.fichero}:<raiz>`);
            }
        }
        expect(abiertos).toEqual([]);
    });

    it('un documento con una clave no declarada NO valida', () => {
        const instrumento = ESQUEMAS.find((e) => e.fichero === 'instrument.v2.schema.json');
        expect(instrumento).toBeDefined();
        const valida = ajv.compile(instrumento!.json);
        const bueno = {
            instrument_id: 'IE00BYR8H148',
            instrument_type: 'FUND',
            schema_version: 'base-nueva.instrument.v2',
            updated_at: '2026-11-01T00:00:00Z',
            identity: { name: 'Un fondo', name_folded: 'un fondo', currency: 'EUR' },
            classification: { category: 'RV Global', asset_class: 'EQUITY' }
        };
        expect(valida(bueno), JSON.stringify(valida.errors)).toBe(true);
        expect(valida({ ...bueno, volatilidad_3a: 0.12 })).toBe(false);
    });
});

describe('2. sin centinelas: la ausencia se declara, no se cifra en el valor', () => {
    it('ningun vocabulario cerrado admite un centinela', () => {
        const culpables: string[] = [];
        for (const { fichero, ruta, nodo } of RUTAS) {
            const candidatos: unknown[] = [];
            if (Array.isArray(nodo['enum'])) candidatos.push(...(nodo['enum'] as unknown[]));
            if (nodo['const'] !== undefined) candidatos.push(nodo['const']);
            if (nodo['default'] !== undefined) candidatos.push(nodo['default']);
            for (const valor of candidatos) {
                if (typeof valor !== 'string') continue;
                if ((CENTINELAS_PROHIBIDOS as readonly string[]).includes(valor)) {
                    culpables.push(`${fichero}:${ruta} = ${JSON.stringify(valor)}`);
                }
            }
        }
        expect(culpables).toEqual([]);
    });

    it('ningun campo admite null: si falta, falta', () => {
        // La maestra de hoy esta llena de ["string","null"], y un null es un centinela con
        // otra cara: no distingue "no aplica" de "no lo se".
        const conNull = RUTAS.filter(({ nodo }) => {
            const tipo = nodo['type'];
            if (tipo === 'null') return true;
            return Array.isArray(tipo) && (tipo as unknown[]).includes('null');
        }).map(({ fichero, ruta }) => `${fichero}:${ruta}`);
        expect(conNull).toEqual([]);
    });

    it('toda fecha pura lleva el patron ISO, que excluye 0000-00-00', () => {
        const sinPatron = RUTAS.filter(({ nodo, unidad }) => {
            if (unidad !== 'date') return false;
            if (nodo['format'] !== 'date') return false;
            return typeof nodo['pattern'] !== 'string';
        }).map(({ fichero, ruta }) => `${fichero}:${ruta}`);
        expect(sinPatron).toEqual([]);
    });

    it('todo campo opcional dice por que puede faltar', () => {
        // x-absence es lo que sustituye a los centinelas: no aplica, no lo dan, o no se ha
        // pedido todavia. Un campo que no es obligatorio y no lo declara deja la pregunta
        // "por que falta" sin respuesta, que es como nacieron los 22 centinelas.
        const sinAusencia = RUTAS.filter(({ nodo, esHoja, requeridaPorElPadre, ruta }) => {
            if (!esHoja) return false;
            if (requeridaPorElPadre) return false;
            // Los elementos de una lista y las claves libres de un mapa no son opcionales:
            // o esta el elemento entero o no esta.
            if (ruta.includes('[]') || ruta.endsWith('.*')) return false;
            return typeof nodo['x-absence'] !== 'string';
        }).map(({ fichero, ruta }) => `${fichero}:${ruta}`);
        expect(sinAusencia).toEqual([]);
    });

    it('toda x-absence es una de las tres', () => {
        const malas = RUTAS.filter(({ nodo }) => {
            const ausencia = nodo['x-absence'];
            if (ausencia === undefined) return false;
            return typeof ausencia !== 'string' || !(AUSENCIAS as readonly string[]).includes(ausencia);
        }).map(({ fichero, ruta }) => `${fichero}:${ruta}`);
        expect(malas).toEqual([]);
    });
});

describe('3. unidad coherente: la unidad se declara, no se deduce de un sufijo', () => {
    it('toda hoja declara una x-unit del catalogo', () => {
        const sinUnidad = RUTAS.filter(({ esHoja, unidad }) => {
            if (!esHoja) return false;
            return unidad === undefined || !(UNIDADES as readonly string[]).includes(unidad);
        }).map(({ fichero, ruta, unidad }) => `${fichero}:${ruta} (${String(unidad)})`);
        expect(sinUnidad).toEqual([]);
    });

    it('una misma magnitud lleva la misma unidad en toda la base', () => {
        // Es el defecto de las dos volatilidades a 3 anios, una en % y otra en decimal.
        const incoherentes: string[] = [];
        for (const { fichero, ruta, esHoja, unidad } of RUTAS) {
            if (!esHoja) continue;
            const esperada = unidadEsperada(ruta);
            if (esperada === undefined) continue;
            if (unidad !== esperada) {
                incoherentes.push(`${fichero}:${ruta} declara ${String(unidad)}, le toca ${esperada}`);
            }
        }
        expect(incoherentes).toEqual([]);
    });

    it('ningun nombre de ruta lleva la unidad dentro', () => {
        // Hoy la unidad vive en un sufijo _pct que nadie comprueba. La unica excepcion es
        // la tarjeta de lectura, cuya forma la manda el consumidor que ya existe; ahi la
        // unidad sigue declarada en x-unit, que es lo que importa. La otra es `retro_pct`, que
        // la escriben la app y sus recibos: su contrato explica por que.
        const conSufijo: string[] = [];
        for (const { fichero, ruta } of RUTAS) {
            if (esProyeccion(fichero)) continue;
            if (fichero === 'commercial-retro.v2.schema.json' && ruta === 'retro_pct') continue;
            const hoja = hojaDe(ruta);
            for (const sufijo of SUFIJOS_DE_UNIDAD_PROHIBIDOS) {
                if (hoja.endsWith(sufijo)) conSufijo.push(`${fichero}:${ruta}`);
            }
        }
        expect(conSufijo).toEqual([]);
    });

    it('toda fraccion y todo ratio declara su rango', () => {
        // Un x-unit fraction fuera de [-5, 5] es casi seguro un error de escala: es como se
        // cuela un por ciento guardado como decimal.
        const sinRango = RUTAS.filter(({ esHoja, unidad, nodo }) => {
            if (!esHoja) return false;
            if (unidad !== 'fraction' && unidad !== 'ratio' && unidad !== 'multiple') return false;
            return typeof nodo['minimum'] !== 'number' || typeof nodo['maximum'] !== 'number';
        }).map(({ fichero, ruta }) => `${fichero}:${ruta}`);
        expect(sinRango).toEqual([]);
    });
});

describe('4. sin agregado abierto: ningun documento crece con el universo', () => {
    it('toda lista declara maxItems, y por debajo del tope', () => {
        // Los cuatro techos de hoy —fund_data_quality, admin_asset_inventory, search_index
        // y holdings/latest— eran listas sin tope.
        const malas: string[] = [];
        for (const { fichero, ruta, nodo } of RUTAS) {
            if (nodo['type'] !== 'array') continue;
            const tope = nodo['maxItems'];
            if (typeof tope !== 'number') malas.push(`${fichero}:${ruta} sin maxItems`);
            else if (tope > TOPE_LISTA) malas.push(`${fichero}:${ruta} maxItems ${tope} > ${TOPE_LISTA}`);
        }
        expect(malas).toEqual([]);
    });

    it('todo mapa de claves libres declara maxProperties', () => {
        // Un mapa abierto crece igual que una lista abierta: es la misma forma de techo con
        // otra cara, y por eso cuenta en esta prueba.
        const malas: string[] = [];
        for (const { fichero, ruta, nodo } of RUTAS) {
            const libres = nodo['additionalProperties'];
            if (libres === null || typeof libres !== 'object') continue;
            const tope = nodo['maxProperties'];
            if (typeof tope !== 'number') malas.push(`${fichero}:${ruta} sin maxProperties`);
        }
        for (const esquema of ESQUEMAS) {
            const libres = esquema.json['additionalProperties'];
            if (libres === null || typeof libres !== 'object') continue;
            if (typeof esquema.json['maxProperties'] !== 'number') {
                malas.push(`${esquema.fichero}:<raiz> sin maxProperties`);
            }
        }
        expect(malas).toEqual([]);
    });

    it('la lista mas larga de toda la base cabe en un documento de Firestore', () => {
        // El limite que de verdad aprieta en Firestore es 1 MiB por documento, no el
        // volumen total. 500 elementos de unos 200 bytes son 100 KB: una decima parte.
        const topes = RUTAS.filter(({ nodo }) => nodo['type'] === 'array').map(({ nodo }) =>
            Number(nodo['maxItems'])
        );
        expect(topes.length).toBeGreaterThan(0);
        expect(Math.max(...topes)).toBeLessThanOrEqual(TOPE_LISTA);
    });
});

describe('5. un dato, un sitio', () => {
    it('ningun documento declara dos nombres que signifiquen lo mismo', () => {
        // El defecto medido: asset_id e identifiers.isin son la misma cadena en los 1.097
        // documentos de la maestra.
        const culpables: string[] = [];
        for (const esquema of ESQUEMAS) {
            const hojas = rutasDe(esquema)
                .filter((ruta) => ruta.esHoja && !ruta.bajoReferencia)
                .map((ruta) => ({ ruta: ruta.ruta, nombre: hojaDe(ruta.ruta) }));
            for (const grupo of GRUPOS_SINONIMOS) {
                const encontradas = hojas.filter((hoja) => grupo.includes(hoja.nombre));
                if (encontradas.length > 1) {
                    culpables.push(`${esquema.fichero}: ${encontradas.map((h) => h.ruta).join(' y ')}`);
                }
            }
        }
        expect(culpables).toEqual([]);
    });

    it('ningun documento repite su propia clave dentro', () => {
        const culpables: string[] = [];
        for (const esquema of ESQUEMAS) {
            const coincidencia = /\{([a-z_]+)\}\s*$/.exec(esquema.coleccion);
            const clave = coincidencia?.[1];
            if (clave === undefined) continue;
            const hojas = rutasDe(esquema).filter((ruta) => ruta.esHoja && !ruta.bajoReferencia);
            const repetidas = hojas.filter((hoja) => hojaDe(hoja.ruta) === clave && hoja.ruta !== clave);
            for (const repetida of repetidas) culpables.push(`${esquema.fichero}:${repetida.ruta}`);
        }
        expect(culpables).toEqual([]);
    });
});

describe('6. capa y dueno: cada ruta sabe de donde viene y quien la escribe', () => {
    it('toda ruta declara x-layer y x-owner validos', () => {
        const malas: string[] = [];
        for (const { fichero, ruta, capa, dueno } of RUTAS) {
            if (capa === undefined || !(CAPAS as readonly string[]).includes(capa)) {
                malas.push(`${fichero}:${ruta} x-layer ${String(capa)}`);
            }
            if (dueno === undefined || !(DUENOS as readonly string[]).includes(dueno)) {
                malas.push(`${fichero}:${ruta} x-owner ${String(dueno)}`);
            }
        }
        expect(malas).toEqual([]);
    });

    it('todo esquema declara su capa y su dueno en la raiz', () => {
        const malas: string[] = [];
        for (const esquema of ESQUEMAS) {
            const capa = esquema.json['x-layer'];
            const dueno = esquema.json['x-owner'];
            if (typeof capa !== 'string' || !(CAPAS as readonly string[]).includes(capa)) {
                malas.push(`${esquema.fichero} x-layer`);
            }
            if (typeof dueno !== 'string' || !(DUENOS as readonly string[]).includes(dueno)) {
                malas.push(`${esquema.fichero} x-owner`);
            }
        }
        expect(malas).toEqual([]);
    });

    it('el dueno encaja con la capa: un lote no escribe el libro, la app no escribe lo declarado por un tercero', () => {
        const malas: string[] = [];
        for (const { fichero, ruta, capa, dueno } of RUTAS) {
            if (capa === undefined || dueno === undefined) continue;
            const permitidos = DUENOS_POR_CAPA[capa];
            if (permitidos === undefined) continue;
            if (!permitidos.includes(dueno)) malas.push(`${fichero}:${ruta} capa ${capa} con dueno ${dueno}`);
        }
        expect(malas).toEqual([]);
    });

    it('toda decision humana lleva autor, fecha y razon donde la razon importa', () => {
        // La tercera capa es la que hoy no tiene sitio: las correcciones del extractor, las
        // retrocesiones y los emparejamientos de entidad son irreproducibles, asi que se
        // migran siempre y necesitan saber quien y por que.
        const conAutor = RUTAS.filter(({ ruta }) => hojaDe(ruta) === 'decided_by' || hojaDe(ruta) === 'set_by');
        expect(conAutor.length).toBeGreaterThan(0);
        for (const { fichero, ruta } of conAutor) {
            const hermanas = RUTAS.filter((otra) => otra.fichero === fichero).map((otra) => hojaDe(otra.ruta));
            const padre = ruta.split('.').slice(0, -1).join('.');
            expect(
                hermanas.includes('decided_at') || hermanas.includes('set_at'),
                `${fichero}:${padre} declara autor sin fecha`
            ).toBe(true);
        }
    });
});

describe('7. base de rentabilidad: una tabla de comparacion no puede mentir', () => {
    it('todo esquema con una rentabilidad declara return_basis, y es obligatorio', () => {
        // Sin esto, una lista ordenada mezcla clases de reparto y de acumulacion. Medido en
        // los 16 casos fiables de la maestra, el sesgo es de 3,05 % anual en mediana, lo que
        // a cinco anios hace parecer a una clase de reparto ~16 puntos peor que su gemela.
        const culpables: string[] = [];
        for (const esquema of ESQUEMAS) {
            const rutas = rutasDe(esquema);
            const tieneRentabilidad = rutas.some(
                (ruta) => ruta.esHoja && MAGNITUDES_DE_RENTABILIDAD.has(magnitudDe(ruta.ruta))
            );
            if (!tieneRentabilidad) continue;
            const bases = rutas.filter((ruta) => hojaDe(ruta.ruta) === 'return_basis');
            if (bases.length === 0) {
                culpables.push(`${esquema.fichero} tiene rentabilidades y ningun return_basis`);
                continue;
            }
            if (!bases.some((base) => base.requeridaPorElPadre)) {
                culpables.push(`${esquema.fichero} declara return_basis pero no lo exige`);
            }
        }
        expect(culpables).toEqual([]);
    });

    it('todo return_basis admite exactamente las dos bases', () => {
        const bases = RUTAS.filter(({ ruta }) => hojaDe(ruta) === 'return_basis');
        expect(bases.length).toBeGreaterThan(0);
        for (const { fichero, ruta, nodo } of bases) {
            expect(nodo['enum'], `${fichero}:${ruta}`).toEqual([...BASES_RENTABILIDAD]);
        }
    });

    it('la valoracion puede comprobar el invariante gratis: sin flujos externos, TWR = MWR', () => {
        // Es la unica prueba de la rentabilidad que no necesita ningun dato de referencia.
        const valoracion = ESQUEMAS.find((e) => e.fichero === 'portfolio-valuation.v2.schema.json');
        expect(valoracion).toBeDefined();
        const requeridas = valoracion!.json['required'] as string[];
        expect(requeridas).toContain('external_flows_count');
        expect(requeridas).toContain('flow_convention');
        expect(requeridas).toContain('valuation_frequency');
        expect(requeridas).toContain('fee_basis');
    });
});

describe('invariantes del sistema, sostenidas por el contrato', () => {
    it('la divisa base de una cartera es una constante, no un campo libre', () => {
        const cartera = ESQUEMAS.find((e) => e.fichero === 'portfolio.v2.schema.json');
        expect(cartera).toBeDefined();
        const propiedades = cartera!.json['properties'] as Record<string, NodoEsquema>;
        expect(propiedades['base_currency']?.['const']).toBe(DIVISA_BASE);
        expect((cartera!.json['required'] as string[])).toContain('base_currency');
    });

    it('el euro entra como divisa, no como ISIN ficticio', () => {
        const posicion = ESQUEMAS.find((e) => e.fichero === 'portfolio-position.v2.schema.json');
        expect(posicion).toBeDefined();
        const propiedades = posicion!.json['properties'] as Record<string, NodoEsquema>;
        const patron = String(propiedades['instrument_id']?.['pattern']);
        expect(new RegExp(patron).test('EUR')).toBe(true);
        expect(new RegExp(patron).test('IE00BYR8H148')).toBe(true);
        expect(new RegExp(patron).test('XX0000000EUR')).toBe(false);
    });

    it('el libro admite exactamente los tipos del vocabulario, sin uno mas', () => {
        const operacion = ESQUEMAS.find((e) => e.fichero === 'portfolio-transaction.v2.schema.json');
        expect(operacion).toBeDefined();
        const propiedades = operacion!.json['properties'] as Record<string, NodoEsquema>;
        const declarados = propiedades['transaction_type']?.['enum'] as string[];
        expect([...declarados].sort()).toEqual([...TIPOS_OPERACION_VALIDOS].sort());
    });

    it('el diccionario de un depositario traduce a los mismos tipos y a ninguno mas', () => {
        const diccionario = ESQUEMAS.find((e) => e.fichero === 'custodian-dictionary.v2.schema.json');
        expect(diccionario).toBeDefined();
        const entrada = rutasDe(diccionario!).find((ruta) => ruta.ruta === 'entries[].transaction_type');
        expect(entrada).toBeDefined();
        const declarados = entrada!.nodo['enum'] as string[];
        expect([...declarados].sort()).toEqual([...TIPOS_OPERACION_VALIDOS].sort());
    });

    it('el depositario entra por id opaco, nunca por nombre', () => {
        // Decidido el 01-11: el programa es neutro y el nombre comercial de un banco no es
        // nunca su marca. Como dato, el nombre de una entidad sale con normalidad; como
        // clave de nada.
        const conDepositario = RUTAS.filter(({ ruta }) => hojaDe(ruta) === 'custodian_id');
        expect(conDepositario.length).toBeGreaterThan(0);
        for (const { fichero, ruta, nodo } of conDepositario) {
            expect(nodo['pattern'], `${fichero}:${ruta}`).toBe('^CUST_[0-9]{3}$');
        }
    });

    it('el texto libre del extracto no tiene donde guardarse', () => {
        // Decidido el 31-10. Es lo que deja fuera de la base los nombres de terceras
        // personas que aparecen en los conceptos de transferencia.
        const operacion = ESQUEMAS.find((e) => e.fichero === 'portfolio-transaction.v2.schema.json');
        const propiedades = operacion!.json['properties'] as Record<string, NodoEsquema>;
        for (const prohibida of ['raw_type', 'raw_literal', 'concept', 'description', 'counterparty_name']) {
            expect(Object.keys(propiedades)).not.toContain(prohibida);
        }
        expect(Object.keys(propiedades)).toContain('dictionary_entry');
    });
});

describe('las colecciones raiz se deducen del contrato, no de una lista a mano', () => {
    /*
     * La auditoria contaba andando desde `instruments`, asi que una coleccion RAIZ le era
     * invisible: el 02-11-2026, con el indice de busqueda recien escrito, seguia diciendo
     * 14.751 documentos habiendo 14.754 y no validaba ninguno de sus tres fragmentos. Estas
     * pruebas sostienen la regla que lo arregla, que es leer `x-collection` por tramos.
     */
    it('un `x-collection` de dos tramos es raiz; uno de cuatro, no', () => {
        const raices = coleccionesRaizDeclaradas();

        expect(raices.get('instruments')).toBe('instrument.v2.schema.json');
        expect(raices.get('search_shards')).toBe('search-shard.v2.schema.json');
        expect(raices.get('clients')).toBe('client.v2.schema.json');

        /* `instruments/{isin}/declared/profile` y `clients/{id}/portfolios/{id}` cuelgan de
           otro documento: no son colecciones raiz y no deben aparecer. */
        expect(raices.has('declared')).toBe(false);
        expect(raices.has('read')).toBe(false);
        expect(raices.has('quality')).toBe(false);
        expect(raices.has('computed')).toBe(false);
        expect(raices.has('portfolios/targets')).toBe(false);
    });

    it('toda coleccion raiz declarada tiene un contrato que la nombra', () => {
        for (const [coleccion, fichero] of coleccionesRaizDeclaradas()) {
            const esquema = ESQUEMAS.find((e) => e.fichero === fichero);
            expect(esquema, `${coleccion} apunta a ${fichero}`).toBeDefined();
            expect(esquema!.coleccion.split('/')[0]).toBe(coleccion);
        }
    });

    it('ninguna coleccion raiz se queda sin contar por no tener contrato', () => {
        /* Al reves de la anterior: todo contrato cuyo `x-collection` sea de dos tramos tiene
           que estar en el mapa. Si alguien escribe un contrato raiz nuevo y esta prueba
           sigue verde, la auditoria lo contara el dia que se escriba el primer documento. */
        const esperadas = ESQUEMAS.filter((e) => e.coleccion.split('/').length === 2).map((e) => e.fichero);
        expect([...coleccionesRaizDeclaradas().values()].sort()).toEqual(esperadas.sort());
    });
});

describe('las subcolecciones tambien se deducen del contrato', () => {
    it('un `x-collection` de cuatro tramos es una subcoleccion de documento', () => {
        /* El 02-11-2026 se escribieron 18 carteras con 220 objetivos y la auditoria conto 18:
           miraba los documentos de la coleccion raiz y no lo que cuelga de cada uno. */
        const subs = subcoleccionesDeclaradas();
        expect(subs.get('portfolios/*/targets/*')).toBe('portfolio-target.v2.schema.json');
        expect(subs.get('instruments/*/quality/latest')).toBe('instrument-quality.v2.schema.json');
        expect(subs.get('instruments/*/declared/costs')).toBe('instrument-declared-costs.v2.schema.json');
        expect(subs.get('instruments/*/declared/profile')).toBe('instrument-declared-profile.v2.schema.json');
        expect(subs.get('issuers/*/fundamentals/latest')).toBe('issuer-fundamentals.v2.schema.json');
        /* Una raiz no es una subcoleccion de nadie. */
        expect(subs.has('portfolios')).toBe(false);
        expect(subs.has('instruments')).toBe(false);
    });

    it('ninguna subcoleccion declarada se queda sin contar', () => {
        const esperadas = ESQUEMAS.filter((e) => e.coleccion.split('/').length === 4).map((e) => e.fichero);
        expect([...subcoleccionesDeclaradas().values()].sort()).toEqual(esperadas.sort());
    });
});
