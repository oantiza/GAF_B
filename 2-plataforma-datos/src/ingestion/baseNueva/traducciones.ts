/**
 * src/ingestion/baseNueva/traducciones.ts — el ÚNICO sitio donde el vocabulario del
 * canónico se traduce al de la base nueva.
 *
 * Todas las tablas de aquí son **exhaustivas y sin valor por defecto**, por la misma razón
 * que el mapa de tipos de operación: un valor que no esté en la tabla para la ingesta y
 * pide que alguien lo traduzca. Adivinar es lo que mete `OTHER` donde había un dato bueno,
 * y nadie vuelve a mirarlo.
 *
 * Las tablas están medidas sobre el canónico del 31-10-2026: 843 registros en
 * `export/fondos.ndjson`, de los que 770 no son acciones.
 */
import type {
    BaseDeDisponibilidad,
    ClaseDeActivo,
    Disponibilidad,
    Periodo,
    TipoDeInstrumento
} from '../../config/baseNueva/vocabulario';

/** Lo que no se puede traducir. No es un valor: es una parada. */
export class TraduccionDesconocida extends Error {
    constructor(
        readonly tabla: string,
        readonly valor: unknown
    ) {
        super(`${tabla}: no se sabe traducir ${JSON.stringify(valor)}`);
        this.name = 'TraduccionDesconocida';
    }
}

/**
 * `identificacion.tipo_producto` → `instrument_type`.
 * Medido: fondo 752, accion 73, etf 11, monetario 6, etc 1.
 *
 * `etc` es un *exchange-traded commodity*, que no es un fondo ni un ETF: va a `OTHER`, y es
 * un solo instrumento. Llamarlo ETF sería más cómodo y falso.
 */
export const TIPO_PRODUCTO: Readonly<Record<string, TipoDeInstrumento>> = {
    fondo: 'FUND',
    monetario: 'FUND',
    etf: 'ETF',
    accion: 'STOCK',
    etc: 'OTHER'
};

/**
 * `disponibilidad.estado` → `availability.state`. Decisión 14 de Óscar (02-11-2026).
 *
 * Exhaustiva y sin valor por defecto como las demás, y aquí eso importa más que en ninguna:
 * el estado que más fácil se confunde es `sin_determinar`, que es un intento fallido y
 * **nunca** una defunción. Un `OTHER` o un `UNDETERMINED` por defecto convertiría cualquier
 * estado nuevo del extractor en «no se sabe», que es justo la respuesta que parece
 * inofensiva y no lo es: una tarde sin red marcaría medio catálogo.
 */
export const DISPONIBILIDAD: Readonly<Record<string, Disponibilidad>> = {
    cotiza: 'TRADING',
    fuera_de_alcance: 'OUT_OF_SCOPE',
    dejo_de_cotizar: 'DELISTED',
    nunca_resuelto: 'NEVER_RESOLVED',
    sin_determinar: 'UNDETERMINED'
};

/**
 * `disponibilidad.origen` → `availability.basis` (07-11-2026, decisión 10).
 *
 * El extractor solo escribe `origen` cuando la marca es una decisión (`core/bajas_decididas.py`);
 * una marca medida no lo lleva, y por eso la ausencia se traduce a `SOURCE_EVIDENCE` en el
 * mapper y no aquí. Lo que sí es exhaustivo es lo que viene escrito: un `origen` que no está en
 * la tabla es una parada, no una evidencia por defecto, porque leer como dato de fuente algo
 * que alguien decidió es exactamente el error que este campo existe para no cometer.
 */
export const ORIGEN_DE_DISPONIBILIDAD: Readonly<Record<string, BaseDeDisponibilidad>> = {
    decision: 'DECISION'
};

/**
 * Las dos ortografías de la clase de activo → una sola.
 * `identificacion.clase_activo` es la primaria; `classification_v2.asset_type` es la
 * suplente, y cubre los 3 de 770 que la primaria no trae.
 */
export const CLASE_ACTIVO: Readonly<Record<string, ClaseDeActivo>> = {
    /* identificacion.clase_activo */
    Equity: 'EQUITY',
    'Fixed Income': 'FIXED_INCOME',
    Allocation: 'ALLOCATION',
    'Alternative Strategies': 'ALTERNATIVE',
    'Real Assets': 'REAL_ASSETS',
    'Capital Preservation': 'CAPITAL_PRESERVATION',
    'Hybrid Securities': 'HYBRID',
    /* classification_v2.asset_type */
    equity: 'EQUITY',
    /*
     * `stock` es lo que `classification_v2.asset_type` dice de una ACCION, y era la primera
     * cosa que paraba el mapeo de las 73: `identificacion.clase_activo` no lo traen —es un
     * campo de ficha de fondo— así que la clase sale de la suplente, y la suplente decía
     * `'stock'`, que no estaba en esta tabla. Sin valor por defecto, `traducir` lanzaba y el
     * instrumento se quedaba fuera con «no se sabe traducir "stock"». Que la tabla parase en
     * vez de adivinar es justo lo que tenía que hacer: la respuesta no se inventa, se añade.
     */
    stock: 'EQUITY',
    fixed_income: 'FIXED_INCOME',
    allocation: 'ALLOCATION',
    alternative: 'ALTERNATIVE',
    real_assets: 'REAL_ASSETS',
    capital_preservation: 'CAPITAL_PRESERVATION',
    hybrid: 'HYBRID',
    other: 'OTHER'
};

/**
 * `identificacion.domicilio` llega en ISO 3166 alpha-3 y el contrato pide alpha-2. Medido:
 * solo hay 7 domicilios distintos en los 770 (LUX 547, ESP 95, IRL 77, FRA 38, FIN 5,
 * BEL 4, DEU 4), así que la tabla es pequeña y completa. Un alpha-3 que no esté aquí para
 * la ingesta en vez de inventarse un alpha-2 recortando letras.
 */
export const DOMICILIO: Readonly<Record<string, string>> = {
    LUX: 'LU',
    ESP: 'ES',
    IRL: 'IE',
    FRA: 'FR',
    FIN: 'FI',
    BEL: 'BE',
    DEU: 'DE',
    /* SPY y QQQ (20-11-2026): 2 fichas del canonico traen USA y se quedaban sin bloque `product`. */
    USA: 'US'
};

/**
 * `identificacion.pais` de una ACCION → ISO 3166-1 alpha-2, para `declared/equity.listing`.
 *
 * Llega como nombre en inglés y hay siete distintos en las 73 acciones, así que la tabla es
 * pequeña y completa, igual que `DOMICILIO`. Y sin valor por defecto por la misma razón: un
 * nombre que no esté aquí deja el campo ausente y lo dice, en vez de recortar letras.
 *
 * **Lo que esta tabla traduce NO es el domicilio de la empresa: es el país del MERCADO.** Está
 * medido el 01-11-2026 y la correspondencia es uno a uno con los mercados: 34 `Spain` para los
 * 32 `MC` y los 2 `MCE`, 14 `France` para 14 `PA`, 13 `Germany` para 13 `XETRA`, 5
 * `Netherlands` para 5 `AS`, 4 `UK` para 4 `LSE`, 2 `USA` para 2 `US` y 1 `Finland` para 1
 * `HE`. Una coincidencia perfecta en los siete no es casualidad: el campo sale del `Country`
 * del listado de EODHD. De ahí que el contrato lo llame `listing.country` y que nada de esta
 * base afirme hoy dónde está constituida una empresa —Ferrovial cotiza en Madrid y está
 * constituida en Países Bajos, y la especificación de fundamentales ya avisaba del caso—.
 */
export const PAIS_DEL_MERCADO: Readonly<Record<string, string>> = {
    Spain: 'ES',
    France: 'FR',
    Germany: 'DE',
    Netherlands: 'NL',
    UK: 'GB',
    USA: 'US',
    Finland: 'FI',
    /* Los seis de la ampliación de acciones (08-11-2026): 37 acciones se quedaban sin país del listado. */
    Switzerland: 'CH',
    Sweden: 'SE',
    Belgium: 'BE',
    Canada: 'CA',
    Denmark: 'DK',
    Austria: 'AT'
};

/**
 * `riesgo.historial_precios.source_history` → qué AJUSTE lleva esa serie, para
 * `computed/metrics.inputs.series_adjustment`.
 *
 * Es el campo que da el derecho a calcular en una acción, igual que el grado de la política de
 * reparto lo da en un fondo, así que no se puede poner a mano: sale de QUIÉN trajo la serie.
 *
 * Las dos fuentes están comprobadas en el código del extractor, no supuestas. `eodhd` construye
 * la serie sobre `adjusted_close`, que reparte hacia atrás los desdoblamientos y los dividendos.
 * `yahoo` la pide con `auto_adjust=True`, que hace lo mismo. Las dos usan además el mismo
 * calculador diario, así que las dos cifras son del mismo método.
 *
 * Sin valor por defecto, y aquí eso importa más que en las otras tablas: una fuente que no esté
 * aquí no es un campo que se quede ausente, es una métrica que **no se escribe**. Si mañana una
 * serie llegara sin ajustar, su rentabilidad sería de solo precio y se quedaría corta en el
 * dividendo entero —en una acción con un 3 % de rendimiento, tres puntos al año—, y publicarla
 * como retorno total sería el defecto de siempre con otra cara.
 */
export const AJUSTE_DE_SERIE: Readonly<Record<string, 'SPLIT_AND_DIVIDEND_ADJUSTED' | 'SPLIT_ADJUSTED_ONLY' | 'UNADJUSTED'>> = {
    eodhd: 'SPLIT_AND_DIVIDEND_ADJUSTED',
    yahoo: 'SPLIT_AND_DIVIDEND_ADJUSTED'
};

/** Los periodos del canónico (`3a`) → los de la base (`3y`). Nunca dos ortografías. */
export const PERIODO: Readonly<Record<string, Periodo>> = {
    '1a': '1y',
    '3a': '3y',
    '5a': '5y',
    '10a': '10y'
};

/**
 * Las claves de `rentabilidad.trailing_pct` que caben en una de las cuatro ventanas.
 *
 * Las que NO caben están a propósito fuera, y son datos que se pierden: `1m`, `3m`, `6m`
 * (770 registros cada una) y `desde_lanzamiento_anualizada` (287). No hay ventana de un
 * mes en el contrato, y meterlas en `1y` sería mentir. Si hacen falta, el contrato tiene
 * que declararlas; mientras no las declare, el dry-run las cuenta como pérdida.
 */
export const TRAILING: Readonly<Record<string, Periodo>> = {
    '1a': '1y',
    '3a_anualizada': '3y',
    '5a_anualizada': '5y',
    '10a_anualizada': '10y'
};

/**
 * Claves de `trailing_pct` que el contrato no sabe guardar. Se cuentan, no se tiran calladas.
 *
 * `ytd` NO está en esta lista a propósito: tiene su propio campo, `ytd_return`, y se mapea
 * aparte. Estaba aquí en la primera versión y salía contada como pérdida a la vez que se
 * escribía, que es el tipo de contabilidad que hace creer que falta algo que está.
 */
export const TRAILING_SIN_SITIO: readonly string[] = ['1m', '3m', '6m', 'desde_lanzamiento_anualizada'];

/** Los tres sujetos del canónico → los de una cifra ABSOLUTA (de quién es). */
export const SUJETO_ABSOLUTO: Readonly<Record<string, 'fund' | 'category' | 'benchmark'>> = {
    fondo: 'fund',
    categoria: 'category',
    indice: 'benchmark'
};

/**
 * Para una cifra RELATIVA el canónico usa las mismas tres columnas con otro significado, y
 * solo una de las tres es legible: `fondo` es la cifra del fondo contra su índice.
 *
 * `categoria` e `indice` NO se traducen, a propósito. Medido el 31-10: `beta.3a.indice`
 * tiene mediana 0,360 y `r2.3a.indice` mediana 17,08 %, cifras que solo tienen sentido si
 * el sujeto volviera a significar «de quién» —el índice medido contra algo más amplio—, y
 * no hay nada en el dato que lo diga. Una cifra cuyo significado no se puede nombrar no
 * entra en una base de la que salen informes de cliente.
 */
export const SUJETO_RELATIVO: Readonly<Record<string, 'vs_benchmark'>> = {
    fondo: 'vs_benchmark'
};

/** Columnas de una cifra relativa que se dejan fuera, y por qué. Las cuenta el dry-run. */
export const SUJETO_RELATIVO_SIN_SITIO: readonly string[] = ['categoria', 'indice'];

/**
 * `identificacion.replicacion` es la réplica que da Morningstar para un ETF o un fondo índice. Medido el 12-11-2026 en el export: 37
 * de 1.334 la traen, con cuatro literales: `Physical Full` 18, `Physical Sample` 12, `Synthetic Replication` 5 y `NOT Applicable` 2. El
 * último es «no aplica», y un campo presente donde no aplica es un error (C-17): se queda ausente (`null` en la tabla). Hace falta para
 * decir que un ETF sintético replica con una permuta y no que «no publica» su cartera (Óscar, 12-11-2026). Es dato del proveedor,
 * no del emisor (B-53), así que puede ir al papel del cliente.
 */
export const REPLICA: Readonly<Record<string, 'PHYSICAL_FULL' | 'PHYSICAL_SAMPLING' | 'SYNTHETIC' | null>> = {
    'Physical Full': 'PHYSICAL_FULL',
    'Physical Sample': 'PHYSICAL_SAMPLING',
    'Synthetic Replication': 'SYNTHETIC',
    'NOT Applicable': null
};

/** `regulatory.sfdr_article` llega como `'8'`. */
export const SFDR: Readonly<Record<string, string>> = {
    '6': 'ARTICLE_6',
    '8': 'ARTICLE_8',
    '9': 'ARTICLE_9'
};

/**
 * `ms.fixed_income.avg_credit_quality` llega con el matiz de la agencia (`'A+'`, `'BBB-'`) y
 * el contrato guarda el escalón. El matiz se pierde a propósito: un `A+` y un `A-` son el
 * mismo escalón para repartir una cartera, y conservar las dos escalas obligaría a declarar
 * cuál usa cada comparación.
 */
export function escalonDeCalidad(valor: string): string {
    const limpio = valor.trim().toUpperCase().replace(/[+-]$/, '');
    const escalones = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'C', 'D', 'NR'];
    if (!escalones.includes(limpio)) throw new TraduccionDesconocida('calidad_crediticia', valor);
    return limpio;
}

/** Traduce con una tabla, o para. */
export function traducir<T>(tabla: Readonly<Record<string, T>>, nombre: string, valor: unknown): T {
    if (typeof valor !== 'string') throw new TraduccionDesconocida(nombre, valor);
    const traducido = tabla[valor];
    if (traducido === undefined) throw new TraduccionDesconocida(nombre, valor);
    return traducido;
}

/**
 * `riesgo.relativas.indice_clase_de_serie` dice SOBRE QUÉ se midió la serie del índice, que
 * es la cuestión del ruido y no la de la base de rentabilidad: son dos cosas distintas y
 * confundirlas costó 69 fondos el 01-11-2026.
 *
 * Hace falta en la base porque de los cuatro proxies aprobados uno es un ETF —el de MSCI
 * ACWI, que toca a 57 fondos— y una serie de precio de mercado lleva más ruido que un valor
 * liquidativo: medido ese día, un ETF cotizado infla la volatilidad 1,2 puntos a un año,
 * porque XETRA cierra a las 17:30 y el VL se calcula tras el cierre de EE.UU. Quien lea un
 * tracking error contra ese proxy tiene derecho a saberlo sin ir a buscar el ISIN.
 */
export type ClaseDeSerie = 'NAV' | 'MARKET_PRICE' | 'RATE' | 'INDEX_LEVEL';
export const CLASE_DE_SERIE: Readonly<Record<string, ClaseDeSerie>> = {
    VALOR_LIQUIDATIVO: 'NAV',
    PRECIO_DE_MERCADO: 'MARKET_PRICE',
    TASA: 'RATE',
    /* El nivel del propio índice, de la bolsa INDX de EODHD (camino C, decisión 23 del
       07-11-2026): sin desfase de cierre ni coste de réplica. La serie no es un instrumento de
       la base, así que viaja en `source_series_id` y no en `instrument_id`. */
    NIVEL_DE_INDICE: 'INDEX_LEVEL'
};

/**
 * Los vocabularios del bloque `emisor.*` del extractor (decisiones 51 y 52). Medidos el 08-11-2026 sobre las 15 fichas que lo llevan
 * y sobre lo que declaran los seis adaptadores. Cada traducción que falte no para el instrumento: deja fuera ese dato y lo avisa.
 */
export type ClaseDeSerieDelEmisor = 'ISSUER_NAV' | 'ISSUER_NAV_DERIVED' | 'ISSUER_CUMULATIVE_RETURN';
export const CLASE_DE_SERIE_DEL_EMISOR: Readonly<Record<string, ClaseDeSerieDelEmisor>> = {
    VL_EMISOR: 'ISSUER_NAV',
    VL_EMISOR_DERIVADO: 'ISSUER_NAV_DERIVED',
    RENTABILIDAD_ACUMULADA_EMISOR: 'ISSUER_CUMULATIVE_RETURN'
};
export const POLITICA_DEL_EMISOR: Readonly<Record<string, 'ACCUMULATING' | 'DISTRIBUTING'>> = {
    acumulacion: 'ACCUMULATING',
    distribucion: 'DISTRIBUTING'
};
export const REPLICA_DEL_EMISOR: Readonly<Record<string, 'PHYSICAL' | 'SYNTHETIC'>> = {
    fisica: 'PHYSICAL',
    sintetica: 'SYNTHETIC'
};
export const NATURALEZA_DE_LA_CARTERA: Readonly<Record<string, 'SUBSTITUTE_BASKET'>> = {
    cesta_de_sustitucion: 'SUBSTITUTE_BASKET'
};
/** El tipo de una línea de la cartera del emisor (decisión B-79), tal como lo traduce `1-extractor/core/cartera_emisor.py`. */
export type TipoDePosicionDelEmisor = 'EQUITY' | 'FIXED_INCOME' | 'DERIVATIVE' | 'CASH' | 'FUND' | 'OTHER';
export const TIPO_DE_POSICION_DEL_EMISOR: Readonly<Record<string, TipoDePosicionDelEmisor>> = {
    accion: 'EQUITY',
    renta_fija: 'FIXED_INCOME',
    derivado: 'DERIVATIVE',
    liquidez: 'CASH',
    fondo: 'FUND',
    otro: 'OTHER'
};
/** Por qué la cartera del emisor no sirve para medir (`motivo_no_medir` del extractor). */
export const MOTIVO_PARA_NO_MEDIR: Readonly<Record<string, 'SUBSTITUTE_BASKET' | 'TRUNCATED' | 'REPLICATION_NOT_DECLARED'>> = {
    cesta_de_sustitucion: 'SUBSTITUTE_BASKET',
    recortada: 'TRUNCATED',
    replica_no_declarada: 'REPLICATION_NOT_DECLARED'
};
export const ORIGEN_DE_LA_DIVISA_DEL_REPARTO: Readonly<Record<string, 'DECLARED' | 'ASSUMED_SHARE_CLASS'>> = {
    declarada: 'DECLARED',
    divisa_de_la_clase: 'ASSUMED_SHARE_CLASS'
};
export const MOTIVO_SIN_ANCLAJE: Readonly<
    Record<
        string,
        'SHARE_CLASS_DISTRIBUTES' | 'POLICY_NOT_DECLARED' | 'NO_DECLARED_NAV' | 'CURRENCY_MISMATCH' | 'NAV_DATE_OUTSIDE_SERIES'
    >
> = {
    clase_que_reparte: 'SHARE_CLASS_DISTRIBUTES',
    politica_no_declarada: 'POLICY_NOT_DECLARED',
    sin_vl_declarado: 'NO_DECLARED_NAV',
    divisa_distinta: 'CURRENCY_MISMATCH',
    fecha_del_vl_fuera_de_la_serie: 'NAV_DATE_OUTSIDE_SERIES'
};

/**
 * Los vocabularios del bloque `mercado_objetivo` del extractor, el EMT del fabricante (decisión 58 de Óscar, 09-11-2026). La forma
 * la fija Dirección y el lector del extractor la escribe ya normalizada: aquí solo se traduce, y lo que no está en la tabla se queda
 * fuera con aviso. NEUTRAL no es un sí, y una celda vacía llega ausente, nunca como NEUTRAL.
 */
export type RespuestaDelEmt = 'YES' | 'NO' | 'NEUTRAL';
export const RESPUESTA_DEL_EMT: Readonly<Record<string, RespuestaDelEmt>> = {
    SI: 'YES',
    NO: 'NO',
    NEUTRAL: 'NEUTRAL'
};
/** El `05105` del EMT no admite NO: o considera las preferencias de sostenibilidad o no se pronuncia. */
export const PREFERENCIAS_ESG_DEL_EMT: Readonly<Record<string, 'YES' | 'NEUTRAL'>> = {
    SI: 'YES',
    NEUTRAL: 'NEUTRAL'
};
/** Los canales `06010`-`06040`: R minoristas, P profesionales, B los dos, N ninguno. Pasan tal cual. */
export const CANAL_DEL_EMT: Readonly<Record<string, 'R' | 'P' | 'B' | 'N'>> = { R: 'R', P: 'P', B: 'B', N: 'N' };
/** El `05080` cuando no viene en años: V muy corto, S corto, M medio, L largo, H hasta vencimiento. */
export const CODIGO_DE_PERIODO_DEL_EMT: Readonly<Record<string, 'V' | 'S' | 'M' | 'L' | 'H'>> = {
    V: 'V',
    S: 'S',
    M: 'M',
    L: 'L',
    H: 'H'
};

export type AusenciaRelativaDecidida =
    | 'KID_DECLARES_COMPOSITE'
    | 'KID_DECLARES_NO_BENCHMARK'
    | 'HEDGED_SHARE_CLASS'
    | 'SAME_FUND_REFERENCE';

/**
 * `riesgo.relativas.aviso` cuando no medir es una DECISIÓN sobre el fondo, y la base lo dice en
 * `relative_absence`: el KID declara un índice compuesto o ninguno (decisión 20 del 07-11-2026), o la
 * clase cubre la divisa y el índice declarado no (decisión 30 del mismo día: la diferencia sería la
 * cobertura, 4,9 puntos a un año medidos el 01-11, y no la gestión). Hasta la decisión 30 el aviso de
 * clase cubierta se dejaba sin valor a propósito, como «decisión sobre el cálculo»; la ficha lo leía
 * como un hueco. Lo que sigue sin valor es `sin_relativas_divisa_*`: falta el cambio, no se ha decidido nada.
 *
 * C-28 (Óscar, 21-11-2026, regla 3): la serie de su índice es otra clase del mismo fondo, la misma cartera
 * con otra comisión, y saldría beta 1 y R² 100. El extractor lo escribe con el proxy entre paréntesis
 * —`sin_relativas_referencia_del_mismo_fondo(IE00B03HD191)`—, así que la clave es lo de antes del
 * paréntesis (`claveDelAvisoDeRelativas`).
 */
export const AUSENCIA_RELATIVA_DECIDIDA: Readonly<Record<string, AusenciaRelativaDecidida>> = {
    sin_relativas_kid_compuesto: 'KID_DECLARES_COMPOSITE',
    sin_relativas_kid_sin_indice: 'KID_DECLARES_NO_BENCHMARK',
    sin_relativas_clase_cubierta: 'HEDGED_SHARE_CLASS',
    sin_relativas_referencia_del_mismo_fondo: 'SAME_FUND_REFERENCE'
};

/** El aviso de las relativas sin el paréntesis que algunos llevan detrás (el proxy, en la C-28). */
export function claveDelAvisoDeRelativas(aviso: string): string {
    return aviso.split('(')[0] as string;
}

export type AusenciaRelativaDeAccion = 'NO_REFERENCE_FOR_MARKET' | 'NO_REFERENCE_DECIDED_FOR_MARKET';

/**
 * `riesgo.relativas.aviso` de una ACCION, sin el paréntesis de la bolsa: `sin_referencia_de_mercado(TO)`.
 * El primero es una fila de `indices_de_accion.csv` que dice que no hay referencia; el segundo, una bolsa sin
 * fila, es decir sin decisión todavía (decisión 46 del 08-11-2026). Lo que no esté aquí no es un motivo.
 */
export const AUSENCIA_RELATIVA_DE_ACCION: Readonly<Record<string, AusenciaRelativaDeAccion>> = {
    sin_referencia_de_mercado: 'NO_REFERENCE_FOR_MARKET',
    sin_relativas_bolsa_sin_referencia: 'NO_REFERENCE_DECIDED_FOR_MARKET'
};

export function ausenciaRelativaDeAccion(aviso: string | undefined): AusenciaRelativaDeAccion | undefined {
    return aviso === undefined ? undefined : AUSENCIA_RELATIVA_DE_ACCION[aviso.split('(')[0] as string];
}

export type CotizacionNoPrincipal = 'HOME_MARKET_NOT_AVAILABLE' | 'HOME_CURRENCY_NOT_AVAILABLE';

/**
 * `identificacion.cotizacion_aviso` → `declared/equity.listing.non_primary_reason` (decisión 46 del 08-11-2026).
 * Exhaustiva y sin valor por defecto: un motivo nuevo del extractor para la ingesta hasta que alguien lo nombre.
 */
export const COTIZACION_NO_PRINCIPAL: Readonly<Record<string, CotizacionNoPrincipal>> = {
    mercado_de_origen_no_disponible: 'HOME_MARKET_NOT_AVAILABLE',
    divisa_de_origen_no_disponible: 'HOME_CURRENCY_NOT_AVAILABLE'
};

/**
 * `riesgo.relativas.kid_estado` cuando se mide igual y se marca (decisión 21): el KID no nombra el
 * índice, o solo nombra su familia.
 */
export const CONFIRMACION_DEL_KID: Readonly<Record<string, 'NOT_CONFIRMED' | 'BRAND_ONLY'>> = {
    NO_CONFIRMADO: 'NOT_CONFIRMED',
    CONFIRMADO_MARCA: 'BRAND_ONLY'
};
