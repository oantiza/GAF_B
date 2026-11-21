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
}

/** `true`, `false`, o `undefined` si el predicado no se puede evaluar con lo que hay. */
export type Veredicto = boolean | undefined;

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
