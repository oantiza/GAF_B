/**
 * src/ingestion/baseNueva/distribucion.ts — resuelve si una clase reparte o acumula, con el
 * grado de evidencia declarado.
 *
 * Por qué importa tanto, medido estos dos días: la política de distribución no es un campo
 * más de la ficha, es **la puerta de tres cosas a la vez**. Bloquea comparar rentabilidades
 * entre clases de forma directa; bloquea las métricas que calculemos nosotros, porque 756 de
 * los 769 instrumentos solo tienen serie de valor liquidativo y la serie de VL de una clase de
 * reparto baja el día del reparto —una caída que no es mercado—; y con ellas bloquea el alpha
 * propio.
 *
 * Y lo que resuelve este módulo es **lo que el canónico ya trae y se estaba tirando**, que es
 * la misma lección que el índice de referencia: el dato existe y se pierde en el camino.
 *
 * Cinco vías, todas del canónico, en orden de fuerza:
 *  - `documentos_oficiales.kid_politica`, lo que dice el KID de la clase. Gana porque es lo
 *    único que habla de ESTA clase y no de lo que un proveedor registró: 28 clases el 03-11.
 *  - `identificacion.politica_distribucion`, que el extractor rellena desde el registro
 *    oficial francés (procedencia `amf_geco:clase`): **19 fondos** el 01-11.
 *  - `distribuciones.historial`, los pagos con fecha e importe. Prueba que reparte, y es más
 *    fuerte que el rendimiento porque son hechos fechados y no un agregado.
 *  - `distribuciones.yield_12m_pct > 0`, que prueba que ha repartido: **11 fondos** el 01-11.
 *  - `distribuciones.historial_consultado` con el historial vacío: el proveedor afirma que no
 *    hay ningún reparto. Es evidencia de acumulación y es el grado **más débil**, porque es una
 *    ausencia afirmada por un tercero y no una declaración del folleto.
 *
 * Lo que NO hace, a propósito: leer la caché del extractor. El contrato entre extractor y
 * plataforma son los dos ficheros de `export`, y leer la caché sería un atajo que rompería en
 * cuanto alguien la pode, sin que nada avise. Hasta el 01-11 eso dejaba fuera 200 fondos cuya
 * respuesta solo estaba en la caché; ese día el extractor empezó a publicar el historial por
 * el canal declarado, así que ya entran por la puerta.
 *
 * Y lo que tampoco hace, aunque lo tenía apuntado como tarea: traducir
 * `riesgo.historial_precios.politica`, el motivo que calcula el extractor. Comprobado el
 * 01-11, ese motivo no aporta ni un dato que no esté aquí —es el mismo registro, los mismos
 * pagos y la misma marca de consultado, ya resueltos— y dos de sus siete valores
 * (`nombre_acumulacion`, `es_sin_reparto`) son suposiciones que aquí no pueden entrar como
 * evidencia. Resolver de los hechos y no de la conclusión de otro deja una sola verdad.
 */
import { POLITICAS_DISTRIBUCION } from '../../config/baseNueva/vocabulario';

/** Los grados de evidencia, de más fuerte a más débil. */
export const GRADOS_DE_EVIDENCIA = [
    'OFFICIAL_REGISTER',
    /* El KID de la clase, leído a mano y anotado con su huella en
       `1-extractor/config/politica_kid.json`. Si el documento cambia, el extractor deja de
       publicarlo, así que aquí no hace falta volver a comprobarlo. */
    'OFFICIAL_KID',
    'PROVIDER_DISTRIBUTION_RECORDS',
    'OBSERVED_DISTRIBUTION',
    'PROVIDER_NO_RECORDS'
] as const;
export type GradoDeEvidencia = (typeof GRADOS_DE_EVIDENCIA)[number];

/** Lo que el canónico dice de la distribución de una clase. */
export interface SenalesDeDistribucion {
    /** `documentos_oficiales.kid_politica`, del KID de la clase. */
    politicaDelKid?: string | undefined;
    /** `identificacion.politica_distribucion`, del registro oficial. */
    politicaDeclarada?: string | undefined;
    /** `distribuciones.yield_12m_pct`. */
    rendimiento12m?: number | undefined;
    /**
     * Cuántos pagos de `distribuciones.historial` traen un importe MAYOR QUE CERO. Se cuenta
     * así, y no la longitud de la lista, por la misma razón que un rendimiento de cero no
     * prueba acumulación: el proveedor lista a veces repartos de importe cero, y una lista de
     * ceros no prueba que la clase reparta.
     */
    repartosConImporte?: number | undefined;
    /**
     * `distribuciones.historial_consultado`: si se le preguntó al proveedor. Solo vale de
     * evidencia cuando es `true` y no hay ningún reparto con importe.
     */
    historialConsultado?: boolean | undefined;
}

export interface PoliticaResuelta {
    policy: (typeof POLITICAS_DISTRIBUCION)[number];
    resolution?: GradoDeEvidencia;
}

/**
 * Traduce el valor del registro oficial. Es una tabla CERRADA y sin valor por defecto: un
 * valor que no esté aquí deja la política sin resolver, porque equivocarse en esto mete un
 * sesgo que a cinco años llega a dieciséis puntos.
 */
export const POLITICA_DEL_REGISTRO: Readonly<Record<string, (typeof POLITICAS_DISTRIBUCION)[number]>> = {
    acumulacion: 'ACCUMULATING',
    acumulación: 'ACCUMULATING',
    accumulation: 'ACCUMULATING',
    capitalizacion: 'ACCUMULATING',
    capitalización: 'ACCUMULATING',
    reparto: 'DISTRIBUTING',
    distribucion: 'DISTRIBUTING',
    distribución: 'DISTRIBUTING',
    distribution: 'DISTRIBUTING'
};

/**
 * Resuelve la política con el grado más fuerte disponible. `UNKNOWN` sin grado es la respuesta
 * honesta cuando no hay ninguna de las dos señales: obligatorio significa declararlo, no
 * conocerlo.
 */
export function resolverDistribucion(senales: SenalesDeDistribucion): PoliticaResuelta {
    /* El documento de la clase va delante de todo lo demás. El 03-11-2026 se contrastaron 28
       KID contra la regla del historial vacío: acertó en 26 y falló en 2 clases facultadas para
       pagar, así que esa regla no se toca y lo que corrige es el documento, clase a clase. */
    const delKid = POLITICA_DEL_REGISTRO[senales.politicaDelKid?.trim().toLowerCase() ?? ''];
    if (delKid !== undefined) return { policy: delKid, resolution: 'OFFICIAL_KID' };

    const declarada = senales.politicaDeclarada?.trim().toLowerCase();
    if (declarada !== undefined && declarada !== '') {
        const traducida = POLITICA_DEL_REGISTRO[declarada];
        if (traducida !== undefined) return { policy: traducida, resolution: 'OFFICIAL_REGISTER' };
    }

    /* Pagos registrados con fecha e importe. Van delante del rendimiento porque son hechos
       fechados: con ellos no solo se sabe que reparte, se puede reconstruir la serie. */
    const conImporte = senales.repartosConImporte ?? 0;
    if (conImporte > 0) {
        return { policy: 'DISTRIBUTING', resolution: 'PROVIDER_DISTRIBUTION_RECORDS' };
    }

    /* Un rendimiento repartido en los ultimos doce meses PRUEBA que reparte. Un cero NO prueba
       que acumule: puede ser un dato que falta, y de hecho el canonico tiene 749 ceros
       exactos, que es demasiado redondo para ser cierto en todos. */
    if (typeof senales.rendimiento12m === 'number' && senales.rendimiento12m > 0) {
        return { policy: 'DISTRIBUTING', resolution: 'OBSERVED_DISTRIBUTION' };
    }

    /* El proveedor dice que no tiene ningun reparto de esta clase. Es el grado mas debil y va
       ultimo, pero es evidencia y no una suposicion, asi que gana al nombre de la clase, que
       es lo que se usaba antes. Se dijo que el nombre fallo en 1 de los 16 casos verificables, y
       ese caso era BNY H Acc: su KID dice que acumula y el que fallaba era el registro de pagos
       (decision 78, 05-11-2026). Por eso el KID va delante de todo. */
    if (senales.historialConsultado === true) {
        return { policy: 'ACCUMULATING', resolution: 'PROVIDER_NO_RECORDS' };
    }

    return { policy: 'UNKNOWN' };
}
