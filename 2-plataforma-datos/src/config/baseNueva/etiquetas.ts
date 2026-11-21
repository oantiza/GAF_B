/**
 * Cómo se llama cada código cuando lo lee una persona.
 *
 * El vocabulario de `vocabulario.ts` es cerrado y riguroso, pero está escrito en códigos:
 * `DELISTED`, `NOT_YET_FETCHED`, `COMPARAR_COSTE`. Hasta el 02-11-2026 ninguno tenía nombre
 * en español en ningún sitio, así que cada superficie que mostrara uno tenía que inventarse
 * el suyo. Con tres superficies —la pantalla, el informe interno y el informe de cliente—
 * eso acaba en tres palabras distintas para la misma cosa delante de un cliente.
 *
 * Por eso las etiquetas viven aquí, al lado del vocabulario que nombran, y no en el
 * frontend: el nombre de un valor es parte del valor.
 *
 * Decidido el 02-11-2026, trabajando el rediseño del frontend.
 *
 * Dos campos, y la diferencia importa:
 * - `corta` es lo que cabe en una celda, un chip o una cabecera. Siempre existe.
 * - `glosa` es la frase que explica el valor cuando no es evidente, para un tooltip, una
 *   nota al pie o un estado vacío. Solo la llevan los valores que la necesitan.
 *
 * Regla de escritura: `corta` en mayúscula inicial y sin punto; `glosa` en frase completa
 * con punto. Nada de versalitas: eso es decisión de la hoja de estilo, no del dato.
 */

import {
    APTITUDES,
    AUSENCIAS,
    BASES_RENTABILIDAD,
    CLASES_DE_ACTIVO,
    CLASES_FLUJO,
    BASES_DE_DISPONIBILIDAD,
    DISPONIBILIDADES,
    PERIODOS,
    POLITICAS_DISTRIBUCION,
    ROLES_ENTIDAD,
    TIPOS_DE_INSTRUMENTO,
    TIPOS_OPERACION_VALIDOS,
    type Aptitud,
    type BaseDeDisponibilidad,
    type Ausencia,
    type ClaseDeActivo,
    type ClaseFlujo,
    type Disponibilidad,
    type Periodo,
    type RolEntidad,
    type TipoDeInstrumento
} from './vocabulario.js';

export interface Etiqueta {
    /** Lo que cabe en una celda o un chip. */
    readonly corta: string;
    /** La frase que lo explica, cuando el nombre corto no basta. */
    readonly glosa?: string;
}

/**
 * Lo que el asesor puede hacer con un instrumento. Se nombran en infinitivo porque son
 * acciones suyas, no propiedades del producto.
 */
export const ETIQUETAS_APTITUD: Readonly<Record<Aptitud, Etiqueta>> = {
    COMPARAR_COSTE: {
        corta: 'Comparar su coste',
        glosa: 'Su coste corriente se puede poner al lado del de otro producto.'
    },
    RADIOGRAFIA_DE_CARTERA: {
        corta: 'Entrar en una radiografía',
        glosa: 'Puede desglosarse dentro de una cartera por clase de activo y región.'
    },
    COMPARAR_RENTABILIDAD: {
        corta: 'Comparar su rentabilidad',
        glosa: 'Tiene rentabilidad anualizada con la que ponerlo junto a otro.'
    },
    MOSTRAR_ALPHA: {
        corta: 'Medir su alfa',
        glosa: 'Se puede medir contra el índice que declara su propio folleto.'
    },
    METRICAS_PROPIAS: {
        corta: 'Métricas nuestras',
        glosa: 'Volatilidad, Sharpe y caída máxima calculadas con nuestro método.'
    },
    COMPARAR_CON_SU_GRUPO: {
        corta: 'Comparar con sus iguales',
        glosa: 'Tiene con qué agruparlo: la categoría del proveedor, o el sector si es una acción.'
    }
};

/**
 * Si el instrumento sigue cotizando. Un instrumento que deja de cotizar se marca, no
 * desaparece (decisión 14, 02-11-2026), así que estas palabras se leen en la ficha.
 */
export const ETIQUETAS_DISPONIBILIDAD: Readonly<Record<Disponibilidad, Etiqueta>> = {
    TRADING: {
        corta: 'Cotiza',
        glosa: 'El proveedor lo resuelve hoy.'
    },
    OUT_OF_SCOPE: {
        corta: 'Fuera de alcance',
        glosa: 'Decidido por nosotros: no se le piden datos. Se puede revertir.'
    },
    DELISTED: {
        corta: 'Dejó de cotizar',
        glosa: 'El proveedor ya no resuelve un símbolo que antes sí resolvía.'
    },
    NEVER_RESOLVED: {
        corta: 'Nunca se resolvió',
        glosa: 'Ninguna fuente lo ha cubierto. No es que haya dejado de existir.'
    },
    UNDETERMINED: {
        corta: 'Sin comprobar',
        glosa: 'El intento de comprobarlo falló. Nunca significa que haya dejado de cotizar.'
    }
};

/**
 * En qué se apoya ese estado (`availability.basis`, 07-11-2026). Va al lado del estado y no
 * dentro de su glosa: «Dejó de cotizar» se sigue llamando igual, y lo que cambia es si lo dice
 * la fuente o lo decidimos nosotros.
 */
export const ETIQUETAS_BASE_DE_DISPONIBILIDAD: Readonly<Record<BaseDeDisponibilidad, Etiqueta>> = {
    SOURCE_EVIDENCE: {
        corta: 'Dato de la fuente',
        glosa: 'Lo dice lo que contestó la fuente del precio.'
    },
    DECISION: {
        corta: 'Decisión nuestra',
        glosa: 'Lo decidió una persona, con fecha y motivo, porque ninguna fuente lo prueba o porque la fuente dice otra cosa.'
    }
};

/**
 * El sexto caso de la disponibilidad: que el campo no esté.
 *
 * Le pasa a los fondos, que no pasan por el buscador de símbolos del proveedor, así que de
 * ellos no se ha medido nunca si siguen vivos. El contrato ya lo dice —`availability` lleva
 * `x-absence: NOT_YET_FETCHED`—, pero eso vive en el esquema y no en nada que la pantalla
 * lea en tiempo de ejecución.
 *
 * Se resolvió así, y no con un sexto valor en `DISPONIBILIDADES`, porque el contrato exige
 * `since` y `last_checked` dentro de `availability`: un estado «sin medir» no tiene fecha
 * que poner, y admitirlo obligaría a hacer esas dos fechas opcionales para los cinco
 * estados que sí las tienen. Son justo las dos que impiden leer un estado viejo como si
 * fuera recién comprobado. No merece la pena perderlas por nombrar una ausencia.
 */
export const ETIQUETA_DISPONIBILIDAD_SIN_MEDIR: Etiqueta = {
    corta: 'Sin medir',
    glosa: 'No se ha comprobado si sigue cotizando. Les pasa a los fondos, que no pasan por el buscador de símbolos del proveedor.'
};

/**
 * Cómo se llama la disponibilidad de un instrumento, incluido el caso de que no la haya.
 * Un solo sitio al que preguntar, para que ninguna pantalla se invente la palabra de la
 * ausencia ni la confunda con «sin comprobar», que es un intento fallido y no lo mismo.
 */
export function etiquetaDeDisponibilidad(estado: Disponibilidad | undefined): Etiqueta {
    return estado === undefined ? ETIQUETA_DISPONIBILIDAD_SIN_MEDIR : ETIQUETAS_DISPONIBILIDAD[estado];
}

/**
 * Por qué falta un dato. Son tres cosas distintas y la pantalla no puede pintarlas igual:
 * la primera nunca se va a poder rellenar y las otras dos sí.
 */
export const ETIQUETAS_AUSENCIA: Readonly<Record<Ausencia, Etiqueta>> = {
    NOT_APPLICABLE: {
        corta: 'No aplica',
        glosa: 'No existe para este producto. No es un dato que falte.'
    },
    NOT_PROVIDED: {
        corta: 'No facilitado',
        glosa: 'La fuente no lo da.'
    },
    NOT_YET_FETCHED: {
        corta: 'Aún no pedido',
        glosa: 'La fuente lo tiene y todavía no lo hemos traído.'
    }
};

export const ETIQUETAS_TIPO_DE_INSTRUMENTO: Readonly<Record<TipoDeInstrumento, Etiqueta>> = {
    FUND: { corta: 'Fondo' },
    ETF: { corta: 'ETF' },
    STOCK: { corta: 'Acción' },
    INDEX: { corta: 'Índice' },
    CURRENCY: { corta: 'Divisa' },
    OTHER: { corta: 'Otro' }
};

export const ETIQUETAS_CLASE_DE_ACTIVO: Readonly<Record<ClaseDeActivo, Etiqueta>> = {
    EQUITY: { corta: 'Renta variable' },
    FIXED_INCOME: { corta: 'Renta fija' },
    ALLOCATION: { corta: 'Mixto' },
    ALTERNATIVE: { corta: 'Alternativos' },
    REAL_ASSETS: { corta: 'Activos reales' },
    CAPITAL_PRESERVATION: {
        corta: 'Preservación de capital',
        glosa: 'Monetarios y equivalentes: el objetivo es no perder, no ganar.'
    },
    HYBRID: { corta: 'Híbrido' },
    OTHER: { corta: 'Otros' }
};

/** `UNKNOWN` es un valor válido y se enseña como tal: no es lo mismo que no tener el campo. */
export const ETIQUETAS_POLITICA_DISTRIBUCION: Readonly<
    Record<(typeof POLITICAS_DISTRIBUCION)[number], Etiqueta>
> = {
    ACCUMULATING: { corta: 'Acumulación', glosa: 'Reinvierte las rentas dentro del fondo.' },
    DISTRIBUTING: { corta: 'Reparto', glosa: 'Paga las rentas al partícipe.' },
    UNKNOWN: { corta: 'Sin determinar', glosa: 'Ninguna fuente lo declara con evidencia suficiente.' }
};

export const ETIQUETAS_BASE_RENTABILIDAD: Readonly<
    Record<(typeof BASES_RENTABILIDAD)[number], Etiqueta>
> = {
    TOTAL_RETURN: { corta: 'Rentabilidad total', glosa: 'Incluye las rentas reinvertidas.' },
    PRICE_RETURN: { corta: 'Solo precio', glosa: 'No incluye las rentas repartidas.' }
};

export const ETIQUETAS_PERIODO: Readonly<Record<Periodo, Etiqueta>> = {
    '1y': { corta: '1 año' },
    '3y': { corta: '3 años' },
    '5y': { corta: '5 años' },
    '10y': { corta: '10 años' }
};

export const ETIQUETAS_ROL_ENTIDAD: Readonly<Record<RolEntidad, Etiqueta>> = {
    EQUITY_ISSUER: { corta: 'Emisor' },
    FUND_MANAGER: { corta: 'Gestora' },
    DEPOSITARY: { corta: 'Depositario' }
};

export const ETIQUETAS_CLASE_FLUJO: Readonly<Record<ClaseFlujo, Etiqueta>> = {
    EXTERNAL: { corta: 'Flujo externo', glosa: 'Entra o sale dinero de la cartera.' },
    INTERNAL: { corta: 'Movimiento interno', glosa: 'El dinero se mueve dentro de la cartera.' },
    NON_CASH: { corta: 'Sin efectivo', glosa: 'Cambia lo que se tiene sin mover dinero.' }
};

/** Lo que aparece en el libro de una cartera real. */
export const ETIQUETAS_TIPO_OPERACION: Readonly<Record<string, Etiqueta>> = {
    BUY: { corta: 'Compra' },
    SELL: { corta: 'Venta' },
    SUBSCRIPTION: { corta: 'Suscripción' },
    REDEMPTION: { corta: 'Reembolso' },
    DIVIDEND: { corta: 'Dividendo' },
    COUPON: { corta: 'Cupón' },
    FEE: { corta: 'Comisión' },
    TAX: { corta: 'Retención' },
    TAX_REFUND: { corta: 'Devolución de retención' },
    REPO: { corta: 'Repo' },
    CASH_IN: { corta: 'Entrada de efectivo' },
    CASH_OUT: { corta: 'Salida de efectivo' },
    TRANSFER_IN: { corta: 'Traspaso de entrada' },
    TRANSFER_OUT: { corta: 'Traspaso de salida' },
    ACCOUNT_OPEN: { corta: 'Apertura de cuenta' },
    ACCOUNT_CLOSE: { corta: 'Cierre de cuenta' },
    CORPORATE_ACTION_NO_CASH: { corta: 'Operación societaria sin efectivo' },
    NOTE: { corta: 'Nota' }
};

/** La severidad de un aviso de calidad. */
export const ETIQUETAS_SEVERIDAD: Readonly<Record<'INFO' | 'WARN' | 'ERROR', Etiqueta>> = {
    INFO: { corta: 'Informativo' },
    WARN: { corta: 'Aviso' },
    ERROR: { corta: 'Error' }
};

/**
 * Cada vocabulario con etiquetas, para que una prueba pueda recorrerlos y fallar si alguien
 * añade un valor y se olvida de nombrarlo. Sin esto, el valor nuevo llegaría a pantalla como
 * su código en mayúsculas y nadie se enteraría hasta verlo en un informe.
 */
export const VOCABULARIOS_ETIQUETADOS: ReadonlyArray<{
    readonly nombre: string;
    readonly valores: readonly string[];
    readonly etiquetas: Readonly<Record<string, Etiqueta>>;
}> = [
    { nombre: 'APTITUDES', valores: APTITUDES, etiquetas: ETIQUETAS_APTITUD },
    { nombre: 'DISPONIBILIDADES', valores: DISPONIBILIDADES, etiquetas: ETIQUETAS_DISPONIBILIDAD },
    {
        nombre: 'BASES_DE_DISPONIBILIDAD',
        valores: BASES_DE_DISPONIBILIDAD,
        etiquetas: ETIQUETAS_BASE_DE_DISPONIBILIDAD
    },
    { nombre: 'AUSENCIAS', valores: AUSENCIAS, etiquetas: ETIQUETAS_AUSENCIA },
    {
        nombre: 'TIPOS_DE_INSTRUMENTO',
        valores: TIPOS_DE_INSTRUMENTO,
        etiquetas: ETIQUETAS_TIPO_DE_INSTRUMENTO
    },
    { nombre: 'CLASES_DE_ACTIVO', valores: CLASES_DE_ACTIVO, etiquetas: ETIQUETAS_CLASE_DE_ACTIVO },
    {
        nombre: 'POLITICAS_DISTRIBUCION',
        valores: POLITICAS_DISTRIBUCION,
        etiquetas: ETIQUETAS_POLITICA_DISTRIBUCION
    },
    {
        nombre: 'BASES_RENTABILIDAD',
        valores: BASES_RENTABILIDAD,
        etiquetas: ETIQUETAS_BASE_RENTABILIDAD
    },
    { nombre: 'PERIODOS', valores: PERIODOS, etiquetas: ETIQUETAS_PERIODO },
    { nombre: 'ROLES_ENTIDAD', valores: ROLES_ENTIDAD, etiquetas: ETIQUETAS_ROL_ENTIDAD },
    { nombre: 'CLASES_FLUJO', valores: CLASES_FLUJO, etiquetas: ETIQUETAS_CLASE_FLUJO },
    {
        nombre: 'TIPOS_OPERACION',
        valores: TIPOS_OPERACION_VALIDOS,
        etiquetas: ETIQUETAS_TIPO_OPERACION
    }
];
