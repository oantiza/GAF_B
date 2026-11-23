/**
 * src/ingestion/baseNueva/aplicabilidad.ts — decide si una ruta del contrato APLICA a un
 * instrumento concreto.
 *
 * Es la pieza que convierte la lección del 30-10 en código. Esa lección decía: *el
 * denominador tiene que ser la población a la que el campo aplica, no el total de la base*,
 * y por no cumplirla la primera versión de `CAMPOS_NECESARIOS` dijo que la composición
 * estaba entre el 20 % y el 77 % cuando está entre el 96 % y el 99 %. La duración efectiva
 * al 57 % no es un 57 % de cobertura: es el 57 % de los fondos que tienen renta fija, y en
 * un fondo de renta variable no es que el campo falte, es que no aplica.
 *
 * El contrato declara el predicado con `x-applies-when`, de una lista cerrada de nueve. Aquí
 * está la función de cada uno. Un predicado que no esté aquí **no se da por cierto**: se
 * devuelve «no lo sé» y quien pregunta decide, en vez de contar como aplicable y falsear la
 * cobertura hacia abajo.
 */
import type { PredicadoDeAplicabilidad } from '../../config/baseNueva/vocabulario';

/** Lo que hace falta saber de un instrumento para decidir si una ruta le aplica. */
export interface RasgosDelInstrumento {
    instrument_type: string;
    /** El reparto por clase de activo, si lo hay. Sin él no se puede decidir mucho. */
    asset_mix?: Record<string, number> | undefined;
    /**
     * La categoría del proveedor, `classification.category` de la raíz. La lee `CON_RENTA_FIJA_NO_RESIDUAL`: en un
     * fondo de convertibles, lo que el reparto llama «otros» son sus convertibles.
     */
    category?: string | undefined;
    /**
     * El peso propio de los convertibles, en FRACCIÓN, cuando la fuente lo separa. Hoy solo lo tiene el mapper, que lo
     * lee del registro universal (`cartera.asignacion_activos.convertibles.neto`): la base no lo guarda, así que quien
     * lee de la base no lo pasa. Ver `pesoDeRentaFijaConConvertibles`.
     */
    convertibles?: number | undefined;
}

/** `true`, `false`, o `undefined` si el predicado no se puede evaluar con lo que hay. */
export type Veredicto = boolean | undefined;

/** Los rasgos de un instrumento tal como está escrito en la base: su raíz y su `declared/exposure`. */
export function rasgosDeLoEscrito(
    raiz: Record<string, unknown>,
    exposicion: Record<string, unknown> | undefined
): RasgosDelInstrumento {
    const clasificacion = raiz['classification'];
    const categoria =
        clasificacion !== null && typeof clasificacion === 'object'
            ? (clasificacion as Record<string, unknown>)['category']
            : undefined;
    return {
        instrument_type: String(raiz['instrument_type'] ?? ''),
        asset_mix: exposicion?.['asset_mix'] as Record<string, number> | undefined,
        category: typeof categoria === 'string' ? categoria : undefined
    };
}

/**
 * El peso mínimo de la renta fija, convertibles incluidos, para que le apliquen `bond_types`, `duration_buckets` y
 * `credit_buckets` (Óscar, 21-11-2026: «los que tienen menos son posiciones residuales, no representativas»). El borde
 * cuenta: un 0,5 % justo aplica.
 */
export const UMBRAL_DE_RENTA_FIJA_DE_SUS_MAPAS = 0.005;

/** Una categoría de convertibles del proveedor: «EAA Fund Convertible Bond - Global, EUR Hedged» y sus hermanas. */
const CATEGORIA_DE_CONVERTIBLES = /convertible/i;

/**
 * Cuánto pesa la renta fija a efectos de sus tres mapas: la del reparto más los convertibles, que Óscar decidió el
 * 21-11-2026 que cuentan como renta fija PARA ESTO y solo para esto. El reparto por clase no se toca: ahí los
 * convertibles siguen en `other`, como los da el canónico. `undefined` sin reparto: entonces no se sabe.
 *
 * Es la ÚNICA definición de la regla. La usan el mapper, para decidir si escribe los tres mapas, y el predicado
 * `CON_RENTA_FIJA_NO_RESIDUAL`, para decidir si aplican cuando se mide la calidad o se audita la base (C-17): si
 * fueran dos copias, la base podría decir «falta» donde el mapper dijo «no aplica».
 *
 * De dónde salen los convertibles, medido el 21-11-2026 sobre el canónico del 17-11:
 *  - el peso propio (`convertibles`), cuando la fuente lo separa. Lo traen 46 fondos, en ninguno es un fondo de
 *    convertibles y en siete no es cero, todos por debajo del 0,4 %.
 *  - si no, en un fondo cuya categoría es de convertibles (6 fondos), lo que el proveedor llama «otros» ES su cartera
 *    de convertibles: Lazard Global Convertibles Recovery trae renta fija 0, otros 95,3 % y `bond_types` con
 *    `corporate` al 98 %. Es una lectura de la categoría, no un dato del reparto, y por eso solo vale en esa categoría.
 */
export function pesoDeRentaFijaConConvertibles(rasgos: RasgosDelInstrumento): number | undefined {
    const mezcla = rasgos.asset_mix;
    if (mezcla === undefined) return undefined;
    const fija = Number(mezcla['fixed_income'] ?? 0);
    if (rasgos.convertibles !== undefined) return fija + rasgos.convertibles;
    if (rasgos.category !== undefined && CATEGORIA_DE_CONVERTIBLES.test(rasgos.category)) return fija + Number(mezcla['other'] ?? 0);
    return fija;
}

/** Las funciones del dominio de instrumentos. Los otros predicados son de otros dominios. */
const DEL_INSTRUMENTO: Partial<Record<PredicadoDeAplicabilidad, (rasgos: RasgosDelInstrumento) => Veredicto>> = {
    FONDO_O_ETF: (rasgos) => rasgos.instrument_type === 'FUND' || rasgos.instrument_type === 'ETF',
    /*
     * Una acción. Es el predicado que hace que la cobertura de una acción signifique algo, y
     * su efecto es el mismo que el de `CON_RENTA_FIJA` en un fondo de renta variable: lo que
     * no le toca no cuenta como que falta.
     *
     * Medido el 01-11-2026 con los contratos de ese día: sin él, y sin el `FONDO_O_ETF` que
     * ahora llevan los diez bloques con forma de fondo, una acción contaba **230** rutas
     * aplicables; con los dos, **53**. Leído sobre `DE0005140008`, que tiene 18 presentes, eso
     * es la diferencia entre decir que su cobertura es del **7,8 %** y decir que es del
     * **34,0 %**. Las 177 rutas de diferencia no eran lagunas: eran el coste corriente de un
     * producto sin coste corriente, la política de reparto de un producto sin clases y el SRI
     * de un producto sin KID. Un 7,8 % manda a alguien a buscar datos que no existen.
     */
    ACCION: (rasgos) => rasgos.instrument_type === 'STOCK',
    NUNCA: () => false,
    CON_RENTA_VARIABLE: (rasgos) => {
        const peso = rasgos.asset_mix?.['equity'];
        /* Sin reparto no se sabe si tiene renta variable. Decir que sí la tiene contaría
           sectores y estilos como ausentes en fondos que a lo mejor no los necesitan, y
           bajaría la cobertura por una suposición nuestra. */
        return typeof peso === 'number' ? peso > 0 : undefined;
    },
    CON_RENTA_FIJA: (rasgos) => {
        const peso = rasgos.asset_mix?.['fixed_income'];
        return typeof peso === 'number' ? peso > 0 : undefined;
    },
    /*
     * Los tres mapas de la renta fija de `declared/exposure` (Óscar, 21-11-2026). No es `CON_RENTA_FIJA` con otro
     * umbral: cuenta los convertibles, y con ellos Lazard Global Convertibles —renta fija 0— sí tiene renta fija para
     * esto. Medido ese día sobre el canónico del 17-11: los 129 fondos con renta fija entre 0 y el 0,5 % pasan a no
     * aplicar, y Lazard pasa a aplicar.
     */
    CON_RENTA_FIJA_NO_RESIDUAL: (rasgos) => {
        const peso = pesoDeRentaFijaConConvertibles(rasgos);
        return peso === undefined ? undefined : peso >= UMBRAL_DE_RENTA_FIJA_DE_SUS_MAPAS;
    }
};

/**
 * ¿Aplica esta ruta a este instrumento? `undefined` significa que no se puede decidir con lo
 * que hay —normalmente porque falta el reparto de activos—, y entonces la ruta se queda
 * fuera del denominador en vez de contar como ausente.
 */
export function aplicaAlInstrumento(
    predicado: string | undefined,
    rasgos: RasgosDelInstrumento
): Veredicto {
    if (predicado === undefined) return true;
    const funcion = DEL_INSTRUMENTO[predicado as PredicadoDeAplicabilidad];
    if (funcion === undefined) return undefined;
    return funcion(rasgos);
}

/** Los predicados que este módulo sabe evaluar. Lo demás es de otro dominio. */
export const PREDICADOS_DEL_INSTRUMENTO: readonly string[] = Object.keys(DEL_INSTRUMENTO);
