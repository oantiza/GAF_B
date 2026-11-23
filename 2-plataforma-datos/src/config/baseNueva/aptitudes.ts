/**
 * src/config/baseNueva/aptitudes.ts — las reglas de las cinco aptitudes, en un solo sitio.
 *
 * Cada regla dice qué le falta a un instrumento para servir a un uso, **nombrando las rutas**
 * que faltan. Eso es lo que convierte la respuesta en algo que se puede arreglar: «no apto
 * para mostrar alpha» no vale de nada; «no apto porque falta
 * `classification.official_benchmark.currency`» es una tarea.
 *
 * Son juicios con valor por defecto, no deducciones. Dos que conviene revisar:
 *
 * - **La radiografía** se da por buena con el reparto por clase de activo y su confianza, sin
 *   exigir el detalle de sectores. Una radiografía a ese nivel sigue siendo una radiografía;
 *   el detalle la refina. Si se exigiera el detalle, 561 instrumentos con renta variable
 *   tendrían que traerlo y los que no tienen renta variable quedarían fuera por un campo que
 *   no les aplica.
 * - **Mostrar alpha NO mira el R².** Ese umbral se decidió de lectura y naciendo apagado;
 *   meterlo aquí lo convertiría en una puerta de escritura, que es justo lo contrario.
 */
import { APTITUDES, type Aptitud } from './vocabulario';

/** Lo que una aptitud necesita saber del instrumento, ya leído de la base. */
export interface MaterialParaAptitudes {
    raiz: Record<string, unknown>;
    bloques: Partial<Record<string, Record<string, unknown> | undefined>>;
    /** `computed/metrics`, si existe. Hoy no existe para nadie: el analítico está por hacer. */
    calculadas?: Record<string, unknown> | undefined;
}

/** El veredicto de una aptitud: sí o no, y qué falta si no. */
export interface VeredictoDeAptitud {
    apt: boolean;
    /** Las rutas que faltan, nombradas. Vacío cuando es apto. */
    missing?: string[];
}

function en(documento: Record<string, unknown> | undefined, ruta: string): unknown {
    let actual: unknown = documento;
    for (const tramo of ruta.split('.')) {
        if (actual === null || typeof actual !== 'object') return undefined;
        actual = (actual as Record<string, unknown>)[tramo];
    }
    return actual;
}

/**
 * La política de reparto con la que se trabaja, y de quién es. Decisión 56: donde el proveedor no la sabe (falta o `UNKNOWN`) y el
 * emisor la declara, vale la del emisor; donde el proveedor la da, manda él (la 52: el emisor rellena, no sustituye). Está aquí y no en
 * la ficha para que la aptitud, el aviso de calidad y la tarjeta digan lo mismo.
 */
export function politicaDeReparto(
    bloques: MaterialParaAptitudes['bloques']
): { politica: unknown; delEmisor: boolean } {
    const delProveedor = en(bloques['declared/profile'], 'distribution_policy');
    if (delProveedor !== undefined && delProveedor !== 'UNKNOWN') return { politica: delProveedor, delEmisor: false };
    const delEmisor = en(bloques['declared/issuer_data'], 'distribution_policy.value');
    if (delEmisor === 'ACCUMULATING' || delEmisor === 'DISTRIBUTING') return { politica: delEmisor, delEmisor: true };
    return { politica: delProveedor, delEmisor: false };
}

/** Monta el veredicto a partir de la lista de lo que falta. */
function veredicto(faltan: string[]): VeredictoDeAptitud {
    return faltan.length === 0 ? { apt: true } : { apt: false, missing: faltan.slice(0, 10) };
}

/** `true` si el instrumento es una acción. Decide qué regla se aplica en tres de las cinco. */
/**
 * Un producto de materias primas que no es un fondo —un ETC: `instrument_type` OTHER y clase REAL_ASSETS, que en esta
 * base son oro y materias primas y nunca inmobiliario (decisión 13)— y no trae reparto. Su composición se deduce del tipo,
 * como la de una acción: 100 % en «otros», que es donde el programa pone las materias primas (Óscar, 21-11-2026).
 *
 * Es la regla más estrecha que cubre el caso. Medido sobre la base del 16/17-11: un solo instrumento la cumple,
 * IE00B4ND3602 (iShares Physical Gold ETC), cuyo proveedor da las cuatro clases a 0. Los dos fondos REAL_ASSETS que
 * hay son FUND y publican su reparto, y quedan fuera. No va a `declared/exposure`: ese bloque no aplica a un OTHER
 * (`FONDO_O_ETF`), y es lo que afirma un tercero; va a la tarjeta, marcado `BY_INSTRUMENT_TYPE`.
 */
export function esMateriaPrimaSinReparto(instrumento: MaterialParaAptitudes): boolean {
    const clase = (instrumento.raiz['classification'] as Record<string, unknown> | undefined)?.['asset_class'];
    return (
        instrumento.raiz['instrument_type'] === 'OTHER' &&
        clase === 'REAL_ASSETS' &&
        instrumento.bloques['declared/exposure']?.['asset_mix'] === undefined
    );
}

function esAccion(material: MaterialParaAptitudes): boolean {
    return material.raiz['instrument_type'] === 'STOCK';
}

/**
 * Las tres aptitudes que una ACCIÓN no puede tener, con el motivo en vez de una ruta.
 *
 * Son `apt: false`, igual que una laguna de datos, y eso merece una explicación porque la
 * respuesta no es la misma: aquí no falta un dato, falta el concepto. El contrato de `aptitud`
 * es `{apt, missing}` y no tiene un tercer estado, así que el motivo va donde el lector lo va a
 * mirar —`missing`, que la ficha ya usa para decir POR QUÉ no sirve— y empieza por «no aplica»
 * para que no se confunda con una tarea pendiente. Un tercer estado habría cambiado el contrato
 * y la tarjeta de los 772 fondos por un caso que se resuelve con una frase.
 *
 * Y lo que no cambia: no es un permiso, es una etiqueta. Una acción no apta para comparar por
 * coste se sigue enseñando entera; lo que no se enseña es una columna de coste vacía.
 */
const NO_APLICA_A_UNA_ACCION: Readonly<Partial<Record<Aptitud, string>>> = {
    COMPARAR_COSTE:
        'no aplica: una acción no tiene coste corriente. Lo que paga un inversor por comprarla es el corretaje de su intermediario, que es suyo y no del instrumento',
    MOSTRAR_ALPHA:
        'no aplica: de una acción se publican beta y R², porque su alfa no se distingue de cero. Decisión 24.',
};

/** Un fondo cuyo KID declara un índice compuesto o ninguno (decisión 20 del 07-11-2026), o una clase cubierta (decisión 30).
    `SAME_FUND_REFERENCE` (C-28) no: la tarjeta cae a la cifra del proveedor, y la aptitud se juzga con ella. */
const NO_APLICA_POR_DECISION: Readonly<Record<string, string>> = {
    KID_DECLARES_COMPOSITE:
        'no aplica: su KID declara un índice compuesto, y no se mide contra una sola de sus piezas. Decisión 20 del 07-11-2026.',
    KID_DECLARES_NO_BENCHMARK:
        'no aplica: su KID declara que no tiene índice de referencia. Decisión 20 del 07-11-2026.',
    HEDGED_SHARE_CLASS:
        'no aplica: es una clase con cobertura de divisa, y contra un índice sin cubrir la diferencia sería la cobertura, no la gestión. Decisión 30 del 07-11-2026.'
};

/**
 * Por qué no hay métricas propias, dicho con el sello que el mapper deja en la raíz (`metrics_absence.code`, el vocabulario cerrado de
 * `instrument.v2`). Hasta el 09-11-2026 la aptitud decía lo mismo en todos los casos —«sin evidencia de la politica, o sin almacen
 * analitico»— aunque la raíz supiera la causa: en `LU0171283459` la serie está parada y el motivo hablaba de la política.
 *
 * Las dos que el mapper sella como `NOT_APPLICABLE` empiezan por «no aplica», que es lo que la ficha lee para decir «No aplica» y no
 * «Falta el dato». La fecha de la serie parada no está aquí porque el sello solo guarda `reason` y `code`: llevarla exige ampliar el
 * contrato de `metrics_absence`.
 */
const MOTIVO_SIN_METRICAS: Readonly<Record<string, string>> = {
    DISTRIBUTES:
        'no aplica: la clase reparte, y el método mensual presupone un valor liquidativo de retorno total; sin todos los pagos de la ventana no hay cifra que dar',
    NO_METHOD: 'no aplica: hay serie de precios, pero ninguna vía de cálculo publicada para este tipo de producto',
    POLICY_UNKNOWN:
        'computed/metrics (no consta con evidencia si la clase reparte o acumula, y sin eso la cifra no se publica como nuestra)',
    POLICY_PENDING:
        'computed/metrics (el cálculo se detuvo por el nombre de la clase; su política de reparto consta en su KID y aún no ha entrado en el canónico)',
    NEEDS_FX: 'computed/metrics (falta llevar la serie a euros con el cambio del BCE)',
    SERIES_STOPPED: 'computed/metrics (la serie de precios está parada: la fuente dejó de servirla)',
    NO_PRICES: 'computed/metrics (la fuente no entregó serie de precios)',
    SHORT_HISTORY: 'computed/metrics (la serie de precios es más corta que la ventana más corta del método)',
    UNIDENTIFIED_SERIES:
        'computed/metrics (no se puede nombrar la serie, su divisa o su ajuste, o el motivo del extractor no está clasificado)'
};

/** El motivo por el sello de la raíz, o `undefined` si no lo lleva o es un código que esta tabla no conoce. */
function motivoSinMetricas(material: MaterialParaAptitudes): string | undefined {
    return MOTIVO_SIN_METRICAS[String(en(material.raiz, 'metrics_absence.code'))];
}

const REGLAS: Readonly<Record<Aptitud, (material: MaterialParaAptitudes) => VeredictoDeAptitud>> = {
    COMPARAR_COSTE: (material) => {
        if (esAccion(material)) return veredicto([NO_APLICA_A_UNA_ACCION.COMPARAR_COSTE as string]);
        const faltan: string[] = [];
        if (en(material.bloques['declared/costs'], 'ongoing_charge') === undefined) {
            faltan.push('declared/costs.ongoing_charge');
        }
        return veredicto(faltan);
    },

    RADIOGRAFIA_DE_CARTERA: (material) => {
        /*
         * Una acción SÍ entra en una radiografía, y con el reparto más fiable que hay: es
         * renta variable al 100 % por ser una acción. No se le pide `declared/exposure`
         * —no lo tiene a propósito, porque escribir una tautología en la capa de lo que
         * afirma un tercero sería mentir sobre quién lo afirma— sino la clase de activo de
         * la raíz, que es obligatoria y es un vocabulario cerrado nuestro.
         *
         * Si se le exigiera el bloque, las 73 acciones saldrían no aptas para la radiografía
         * teniendo la composición más conocida de la base, y alguien iría a buscar un dato
         * que no existe porque no hace falta.
         */
        if (esAccion(material)) {
            const clase = en(material.raiz, 'classification.asset_class');
            return veredicto(clase === undefined ? ['classification.asset_class'] : []);
        }
        /* Lo mismo un ETC de materias primas sin reparto: su 100 % en «otros» se deduce del tipo (21-11-2026). */
        if (esMateriaPrimaSinReparto(material)) return veredicto([]);
        const faltan: string[] = [];
        const exposicion = material.bloques['declared/exposure'];
        if (en(exposicion, 'asset_mix') === undefined) faltan.push('declared/exposure.asset_mix');
        if (en(exposicion, 'confidence') === undefined) faltan.push('declared/exposure.confidence');
        return veredicto(faltan);
    },

    COMPARAR_RENTABILIDAD: (material) => {
        /*
         * En una acción esta aptitud no depende de ninguna política de reparto, y eso es lo
         * que la separa de un fondo: su serie es el cierre AJUSTADO, que ya lleva los
         * dividendos dentro, así que la rentabilidad calculada sobre ella ya es de retorno
         * total y es comparable con otra de la misma base. Comprobado en el código que
         * produce la serie, no supuesto.
         *
         * Es la buena noticia del tipo: de las 469 métricas propias de fondos, 449 se
         * retiraron el 01-11-2026 por no tener evidencia de la política. Una acción no
         * hereda ese problema.
         */
        if (esAccion(material)) {
            const nuestra = en(material.calculadas, 'annualized_return');
            return veredicto(nuestra === undefined ? ['computed/metrics.annualized_return'] : []);
        }
        const faltan: string[] = [];
        const { politica } = politicaDeReparto(material.bloques);
        if (politica === undefined) {
            faltan.push('declared/profile.distribution_policy');
        } else if (politica === 'UNKNOWN') {
            /* UNKNOWN es un valor valido y no bloquea nada en la ficha, pero sin saber si la
               clase reparte o acumula su rentabilidad NO es comparable con la de otra: el
               sesgo medido entre gemelas llega al 6,82 % anual. */
            faltan.push('declared/profile.distribution_policy (es UNKNOWN)');
        }
        if (en(material.bloques['declared/provider_returns'], 'trailing_return') === undefined) {
            faltan.push('declared/provider_returns.trailing_return');
        }
        return veredicto(faltan);
    },

    MOSTRAR_ALPHA: (material) => {
        if (esAccion(material)) return veredicto([NO_APLICA_A_UNA_ACCION.MOSTRAR_ALPHA as string]);
        /* Decisión 20 del 07-11-2026: no es una laguna, es que su KID declara otra cosa, y empieza por
           «no aplica» por la misma razón que las de una acción. */
        const porDecision = NO_APLICA_POR_DECISION[String(en(material.calculadas, 'relative_absence'))];
        if (porDecision !== undefined) return veredicto([porDecision]);
        const faltan: string[] = [];
        const indice = en(material.raiz, 'classification.official_benchmark');
        if (indice === undefined) {
            faltan.push('classification.official_benchmark');
        } else {
            const delIndice = indice as Record<string, unknown>;
            if (delIndice['currency'] === undefined) faltan.push('classification.official_benchmark.currency');
            if (delIndice['variant'] === undefined) faltan.push('classification.official_benchmark.variant');
            /*
             * Y la comprobación que de verdad protege el alpha: el fondo y el índice tienen
             * que compartir base de rentabilidad. Un fondo medido en rentabilidad total
             * contra un índice de solo precio da un alpha positivo que es el dividendo del
             * mercado, no el acierto del gestor.
             */
            const baseDelIndice = delIndice['return_basis'];
            const baseDelFondo =
                en(material.bloques['declared/provider_returns'], 'return_basis') ??
                en(material.bloques['declared/provider_risk'], 'return_basis');
            if (baseDelIndice !== undefined && baseDelFondo !== undefined && baseDelIndice !== baseDelFondo) {
                faltan.push(
                    `base distinta: el indice es ${String(baseDelIndice)} y el fondo ${String(baseDelFondo)}`
                );
            }
        }
        /*
         * Y que la tarjeta vaya a llevar un alfa, con las mismas condiciones con que la escribe
         * `calidadYTarjeta.ts`: con índice propio, el nuestro, que viaja con su R²; sin él, el del
         * proveedor, que solo se escribe nombrando su categoría y con su R². Medido el 08-11-2026:
         * `LU2504555777` era apto por el alfa del proveedor y su tarjeta no lo llevaba por no tener
         * categoría, y la ficha decía «Sí» sin cifra. Es la presencia del R², no su valor: el umbral
         * sigue siendo de lectura.
         */
        const propias = en(material.calculadas, 'relative') as Record<string, unknown> | undefined;
        if (en(propias, 'benchmark.name') !== undefined) {
            if (en(propias, 'r2') === undefined) faltan.push('computed/metrics.relative.r2');
            if (en(propias, 'jensen_alpha') === undefined) faltan.push('computed/metrics.relative.jensen_alpha');
        } else {
            const riesgo = material.bloques['declared/provider_risk'];
            if (en(riesgo, 'provider_alpha') === undefined) faltan.push('declared/provider_risk.provider_alpha');
            if (en(riesgo, 'r2') === undefined) faltan.push('declared/provider_risk.r2');
            if (en(material.raiz, 'classification.category') === undefined) faltan.push('classification.category');
        }
        return veredicto(faltan);
    },

    METRICAS_PROPIAS: (material) => {
        const faltan: string[] = [];
        if (esAccion(material)) {
            /* En una acción la causa de la ausencia es una sola —no hay serie de la que
               calcular— y no las dos de un fondo: el derecho a calcular lo da el ajuste de la
               serie y no una política de reparto que haya que averiguar. */
            if (material.calculadas === undefined) {
                faltan.push(motivoSinMetricas(material) ?? 'computed/metrics (sin serie de precios)');
            }
            return veredicto(faltan);
        }
        if (material.calculadas === undefined) {
            /*
             * Desde el 01-11 este bloque ya existe para algunos: lo llena `core.metricas v1`
             * del extractor, y el almacen analitico sigue por hacer. Asi que ahora su
             * ausencia tiene DOS causas y el mensaje no puede nombrar solo una.
             *
             * Y la segunda es la que importa de verdad: la cifra existe calculada pero no se
             * publica porque no hay evidencia de si la clase reparte, y la serie de una clase
             * que reparte baja el dia del pago. Medido ese dia: de 469 metricas propias, 449
             * se retiran por eso y 18 se publican. En esos 449 la ficha muestra la cifra del
             * proveedor, que sigue en su sitio y con su nombre.
             */
            faltan.push(
                motivoSinMetricas(material) ?? 'computed/metrics (sin evidencia de la politica, o sin almacen analitico)'
            );
        }
        return veredicto(faltan);
    },

    COMPARAR_CON_SU_GRUPO: (material) => {
        /*
         * Existe por un caso concreto, del 02-11-2026. `LU2504555777` -un fondo de recursos
         * naturales, vivo, 1.533 M€ y serie desde 2022- no tenía raíz en la base: el contrato
         * exigía `classification.category` en todo fondo y Morningstar no la publica para ese,
         * así que trece de sus documentos colgaban de una raíz que no existía y no los miraba
         * nadie. Las dos salidas obvias eran malas: inventar la categoría, o tirar dato bueno
         * y con fuente.
         *
         * La salida es esta: el fondo existe con la ausencia declarada, y **la consecuencia
         * vive aquí**, que es donde se dice para qué sirve un instrumento. Sin grupo de
         * comparables no se puede poner junto a sus iguales; todo lo demás lo sigue sirviendo.
         * Un bloqueo hacía desaparecer el fondo entero para proteger una comparación.
         *
         * El grupo no es el mismo según el tipo, y eso NO es una excepción: una acción no
         * tiene categoría de proveedor -medido el 01-11, las 73 la traían a null- y lo que la
         * agrupa es su sector, que vive en `declared/equity` con su fuente y su fecha.
         */
        if (esAccion(material)) {
            const faltan: string[] = [];
            if (en(material.bloques['declared/equity'], 'sector') === undefined) {
                faltan.push('declared/equity.sector');
            }
            return veredicto(faltan);
        }
        const faltan: string[] = [];
        if (en(material.raiz, 'classification.category') === undefined) {
            faltan.push('classification.category');
        }
        return veredicto(faltan);
    }
};

/** Las aptitudes de un instrumento. Siempre todas, para que se pueda preguntar. */
export function aptitudesDe(material: MaterialParaAptitudes): Record<Aptitud, VeredictoDeAptitud> {
    const salida = {} as Record<Aptitud, VeredictoDeAptitud>;
    for (const aptitud of APTITUDES) salida[aptitud] = REGLAS[aptitud](material);
    return salida;
}
