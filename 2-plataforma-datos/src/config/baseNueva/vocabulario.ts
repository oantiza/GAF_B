/**
 * src/config/baseNueva/vocabulario.ts — el ÚNICO sitio donde vive el vocabulario cerrado
 * de la base nueva.
 *
 * Por qué existe: es el mismo patrón que `src/config/projectAllowlist.ts`, y por la misma
 * razón. La maestra de hoy tiene la unidad escondida en un sufijo `_pct` que nadie
 * comprueba, dos volatilidades a tres años con unidades distintas, 22 centinelas de texto
 * donde debería haber una ausencia declarada, y los periodos escritos `3a` en un sitio y
 * `3y` en otro. Todo eso son listas de valores válidos que estaban en la cabeza de quien
 * escribió cada fichero. Aquí están en un solo sitio, y las pruebas de
 * `tests/baseNuevaContratos.test.ts` las leen de aquí, no de copias.
 *
 * Nada de este fichero describe un dato: describe cómo se declara un dato. Si una lista de
 * aquí cambia, cambia a la vez en los esquemas y en las siete comprobaciones.
 */

/** Carpeta de los esquemas de la base nueva, relativa a la raíz de `2-plataforma-datos`. */
export const CARPETA_CONTRATOS = 'contracts/base-nueva';

/** Prefijo de `$id` de los esquemas de la base nueva. */
export const PREFIJO_ID = 'https://gestor-activos.local/contracts/base-nueva/';

// ---------------------------------------------------------------------------
// Las anotaciones del contrato
// ---------------------------------------------------------------------------

/**
 * `x-unit`: la unidad de la magnitud, declarada, no deducida de un sufijo.
 * `fraction` es 0,0253 para un 2,53 %; nunca 2.53.
 * `percent` existe para una sola cifra, `commercial_retro.retro_pct`, y es una excepción
 * declarada en su contrato. No es una segunda forma de escribir una fracción.
 */
export const UNIDADES = [
    'fraction',
    'ratio',
    'multiple',
    'currency_amount',
    'count',
    'date',
    'code',
    'text',
    'years',
    'percent'
] as const;
export type Unidad = (typeof UNIDADES)[number];

/**
 * `x-layer`: de dónde viene el dato. Cinco capas de datos más la proyección.
 * - `declared`: lo que afirma un tercero, con su documento y su fecha.
 * - `computed`: lo que sale de datos que tenemos, con su método.
 * - `ledger`: el libro de operaciones, que solo crece.
 * - `human`: lo que decidió una persona, con autor y razón.
 * - `metadata`: el sello de escritura (clave, versión, fecha).
 * - `projection`: copia derivada para leer barato. No es fuente de nada.
 */
export const CAPAS = ['declared', 'computed', 'ledger', 'human', 'metadata', 'projection'] as const;
export type Capa = (typeof CAPAS)[number];

/** Las capas que contienen datos de verdad: una magnitud vive en una sola de ellas. */
export const CAPAS_DE_DATOS: readonly Capa[] = ['declared', 'computed', 'ledger', 'human'];

/** `x-owner`: quién es el único que escribe ahí. */
export const DUENOS = ['platform', 'app', 'batch', 'human'] as const;
export type Dueno = (typeof DUENOS)[number];

/**
 * `x-applies-when`: a qué población aplica una ruta, **en forma evaluable**.
 *
 * Hace falta porque `x-applies-to` es prosa, y una cobertura calculada sobre una prosa no la
 * puede reproducir nadie. Y la cobertura es justo lo que hay que poder reproducir: la lección
 * del 30-10 es que el denominador tiene que ser la población a la que el campo aplica, no el
 * total de la base, y eso solo significa algo si «aplica» se puede decidir.
 *
 * La lista es cerrada y corta a propósito: son los predicados distintos que el contrato usa de
 * verdad. Cada uno tiene su función en `src/ingestion/baseNueva/aplicabilidad.ts`; la prosa se
 * queda en `x-applies-to` para que un humano la lea.
 *
 * `ACCION` entra el 01-11-2026 con el contrato de las acciones, y es el que hace que la
 * cobertura de una acción signifique algo. Sin él, los nueve bloques que tienen forma de fondo
 * —coste corriente, política de reparto, SRI del KID, cartera de posiciones— contaban como
 * aplicables a una acción y ausentes, así que una acción con todo lo que puede tener habría
 * salido con la cobertura por el suelo y una lista de ausencias que no eran lagunas sino
 * campos que no le tocan. Es la misma lección del 30-10 que obligó a `CON_RENTA_FIJA`: el
 * denominador es la población a la que el campo aplica.
 *
 * `CON_RENTA_FIJA_NO_RESIDUAL` entra el 21-11-2026 con la regla de Óscar de ese día para los tres mapas de la renta
 * fija de `declared/exposure` (`bond_types`, `duration_buckets` y `credit_buckets`): la renta fija, contando los
 * convertibles, pesa al menos un 0,5 % del reparto. No sustituye a `CON_RENTA_FIJA`, que sigue siendo `> 0` y sigue
 * gobernando `declared/fixed_income`. Su cuenta vive en `aplicabilidad.ts`, y el mapper decide con la misma función.
 */
export const PREDICADOS_DE_APLICABILIDAD = [
    'FONDO_O_ETF',
    'ACCION',
    /* Solo para `x-counts-when`: una ruta que no entra nunca en la cobertura. */
    'NUNCA',
    'CON_RENTA_VARIABLE',
    'CON_RENTA_FIJA',
    'CON_RENTA_FIJA_NO_RESIDUAL',
    'EMISOR_DE_ACCIONES',
    'CARTERA_REAL',
    'CARTERA_MODELO',
    'TRASPASO_EMPAREJADO',
    'OPERACION_CON_IMPORTE',
    'DIVISA_DISTINTA_DEL_EURO',
    'PERIODO_DE_UN_ANIO_O_MAS'
] as const;
export type PredicadoDeAplicabilidad = (typeof PREDICADOS_DE_APLICABILIDAD)[number];

/**
 * Las claves del sobre de un bloque `declared/*`: quién lo afirma y desde cuándo. No cuentan
 * para la cobertura, porque no son datos del instrumento sino de la afirmación.
 */
export const CLAVES_DEL_SOBRE: readonly string[] = [
    'source',
    'as_of',
    'document_url',
    'sha256',
    /* El sobre de las cifras de coste: de qué documento y de qué fecha sale cada una (decisión 43). */
    'document_date',
    'ongoing_charge_source',
    'transaction_costs_source',
    'entry_charge_source'
];

/**
 * **Para qué sirve un instrumento.** Decidido el 01-11, y sustituye al semáforo de cuatro
 * estados que colgaba de la cobertura.
 *
 * Por qué cambió: la cobertura es un número honesto —la fracción de rutas aplicables que
 * están presentes— pero **no discrimina**. Medida sobre los 769 instrumentos escritos, su
 * mediana es 59,1 % con el percentil 10 en 49,0 % y el 90 en 63,8 %: quince puntos entre el
 * mejor y el peor. La razón es que la mayor parte del denominador son rutas que le faltan a
 * casi todos a la vez —ventanas a 10 años, tracking error, ratio de información, ESG, FIGI—,
 * así que ese 59 % mide sobre todo cuánto declara el contrato de más, no cuánto tiene el
 * instrumento. Era una propiedad del contrato disfrazada de propiedad del fondo, y el
 * semáforo colgado de ella metía 761 de 769 en el mismo cajón.
 *
 * La pregunta que alguien hace de verdad no es qué fracción de campos tiene, es **para qué
 * sirve**, y eso es un sí o un no por uso. Estos son los cinco usos.
 *
 * Y no es un permiso, es una etiqueta: mismo criterio que el umbral del R² y que la política
 * de distribución, **no bloquear, marcar**. Un instrumento no apto para mostrar alpha se
 * sigue enseñando; lo que no se enseña es el alpha, y se dice por qué.
 */
export const APTITUDES = [
    'COMPARAR_COSTE',
    'RADIOGRAFIA_DE_CARTERA',
    'COMPARAR_RENTABILIDAD',
    'MOSTRAR_ALPHA',
    'METRICAS_PROPIAS',
    'COMPARAR_CON_SU_GRUPO'
] as const;
export type Aptitud = (typeof APTITUDES)[number];

/**
 * Qué decide cada aptitud, en una frase, para que el contrato pueda explicarse solo.
 *
 * Las reglas son JUICIOS, no deducciones, y están puestas con un valor por defecto que Óscar
 * puede cambiar. Dos que conviene mirar: la radiografía se da por buena con el reparto por
 * clase de activo, sin exigir el detalle de sectores —una radiografía a ese nivel sigue
 * siendo una radiografía, y el detalle la refina—; y mostrar alpha **no** mira el R², porque
 * ese umbral se decidió que fuera de lectura y naciera apagado, y meterlo aquí lo convertiría
 * en una puerta de escritura.
 */
export const QUE_DECIDE_CADA_APTITUD: Readonly<Record<Aptitud, string>> = {
    COMPARAR_COSTE: 'Se puede comparar por coste: hay coste corriente.',
    RADIOGRAFIA_DE_CARTERA:
        'Puede entrar en una radiografia de cartera: hay reparto por clase de activo con su confianza.',
    COMPARAR_RENTABILIDAD:
        'Su rentabilidad se puede comparar con la de otra clase: se sabe si reparte o acumula, y hay rentabilidad.',
    MOSTRAR_ALPHA:
        'Se puede mostrar un alpha: el indice esta nombrado con su divisa y su variante, y la tarjeta lleva un alpha con su R2, el nuestro o el del proveedor nombrando su categoria.',
    METRICAS_PROPIAS: 'Sus metricas de riesgo las calculamos nosotros de la serie, no las copia de un proveedor.',
    COMPARAR_CON_SU_GRUPO:
        'Se puede poner junto a sus comparables: un fondo o ETF tiene categoria de proveedor, y una accion, sector.'
};

/** `x-absence`: qué significa que el campo no esté. Sustituye a los centinelas. */
export const AUSENCIAS = ['NOT_APPLICABLE', 'NOT_PROVIDED', 'NOT_YET_FETCHED'] as const;
export type Ausencia = (typeof AUSENCIAS)[number];

/**
 * Por qué un instrumento trae o no trae datos. Decisión 14 de Óscar (02-11-2026): **un
 * instrumento que deja de cotizar se marca, no desaparece**, porque si un cliente lo tuvo,
 * su historia hace falta para sus informes.
 *
 * Cinco valores y no un booleano, por la misma razón que la etiqueta del índice tiene tres
 * estados: un `available: false` fundiría cosas que son opuestas para quien lee una ficha.
 * Que esté fuera de alcance es **una decisión nuestra y reversible mañana**; que haya
 * dejado de cotizar **no se deshace**; y que no lo sepamos porque la petición falló no es
 * ninguna de las dos.
 *
 * - `TRADING`        — el proveedor lo resuelve hoy.
 * - `OUT_OF_SCOPE`   — decidido por nosotros; no se le piden datos. Reversible.
 * - `DELISTED`       — el proveedor contestó y ya no resuelve un símbolo que antes sí.
 * - `NEVER_RESOLVED` — contestó y nunca lo resolvió. No es una defunción: puede ser un
 *                      ISIN que ninguna fuente cubre.
 * - `UNDETERMINED`   — el intento falló: red caída, proveedor con error, modo sin red.
 *                      **Nunca** es una defunción, y es el que más fácil se confunde.
 *
 * Y el campo AUSENTE es un sexto caso que no es ninguno de estos cinco: que no se ha
 * medido. Le pasa a los fondos, que no pasan por el buscador de símbolos del proveedor,
 * único sitio donde alguien puede contestar «no lo tengo».
 */
export const DISPONIBILIDADES = [
    'TRADING',
    'OUT_OF_SCOPE',
    'DELISTED',
    'NEVER_RESOLVED',
    'UNDETERMINED'
] as const;
export type Disponibilidad = (typeof DISPONIBILIDADES)[number];

/**
 * En qué se apoya el estado de la disponibilidad: `availability.basis` (07-11-2026, decisión 10
 * de `DECISIONES_DATOS_2026-11-07.md`).
 *
 * - `SOURCE_EVIDENCE` — lo dice lo que contestó la fuente del precio. Es como se mide el estado
 *                       desde la decisión 14, y lo que se lee cuando el campo falta.
 * - `DECISION`        — lo decidió una persona, con autor, fecha y motivo en
 *                       `availability.decision`: las bajas de `config/bajas_decididas.csv` del
 *                       extractor. Un asesor tiene que poder ver que «dejó de cotizar» es una
 *                       decisión nuestra y no un dato del proveedor.
 */
export const BASES_DE_DISPONIBILIDAD = ['SOURCE_EVIDENCE', 'DECISION'] as const;
export type BaseDeDisponibilidad = (typeof BASES_DE_DISPONIBILIDAD)[number];

/**
 * Tope de cualquier lista del contrato. Es lo que hace imposible el techo: ningún
 * documento puede crecer con el universo. Los cuatro agregados que hoy revientan
 * —`fund_data_quality`, `admin_asset_inventory`, `search_index` y `holdings/latest`—
 * tenían listas sin tope.
 */
export const TOPE_LISTA = 500;

/** Los periodos, con un solo nombre en toda la base. */
export const PERIODOS = ['1y', '3y', '5y', '10y'] as const;
export type Periodo = (typeof PERIODOS)[number];

/**
 * El sujeto de una cifra del proveedor, y son dos cosas distintas que el canónico de hoy
 * mete en las mismas tres columnas:
 * - `fund`, `category`, `benchmark` — **de quién** es la cifra. Vale para las absolutas:
 *   volatilidad, Sharpe, caída máxima.
 * - `vs_benchmark`, `vs_category` — **contra qué** se mide. Vale para las relativas: alpha,
 *   beta, R², tracking error, ratio de información.
 *
 * Las columnas `fondo/categoria/indice` del canónico significan lo primero para la
 * volatilidad y lo segundo para el alpha, y no hay nada en el dato que lo diga. Por eso
 * aquí tienen nombres distintos.
 */
export const SUJETOS = ['fund', 'category', 'benchmark', 'vs_benchmark', 'vs_category'] as const;

/** Sufijos de unidad prohibidos en un nombre de ruta: la unidad va en `x-unit`. */
export const SUFIJOS_DE_UNIDAD_PROHIBIDOS = ['_pct', '_eur', '_usd', '_bps', '_meur', '_pc'] as const;

/**
 * Valores de texto que no pueden aparecer en ningún campo. Son los 22 centinelas de la
 * maestra de hoy, generalizados: cada uno existía para decir «no lo sé» en un campo que no
 * permitía decirlo. Ahora eso lo dice la ausencia del campo más `x-absence`.
 */
export const CENTINELAS_PROHIBIDOS = [
    '',
    '-',
    '--',
    'NA',
    'N/A',
    'N.A.',
    'N.D.',
    'ND',
    '#N/A',
    'null',
    'NULL',
    'undefined',
    'None',
    'none',
    'Not Benchmarked',
    'NOT BENCHMARKED',
    'No Benchmark',
    'Unknown',
    'unknown',
    '0000-00-00',
    '1970-01-01'
] as const;

// ---------------------------------------------------------------------------
// Invariantes del sistema
// ---------------------------------------------------------------------------

/** La divisa base de toda cartera. No es un campo que varíe: es una constante. */
export const DIVISA_BASE = 'EUR';

/** La única fuente de tipo de cambio admitida, en series y en operaciones. */
export const FUENTE_FX = 'ECB_REFERENCE';

/** Patrón de ISIN. */
export const PATRON_ISIN = '^[A-Z]{2}[A-Z0-9]{9}[0-9]$';

/** Patrón de código de divisa ISO 4217. El euro es una divisa, no un ISIN ficticio. */
export const PATRON_DIVISA = '^[A-Z]{3}$';

/** Las dos formas que admite la clave de `instruments`, y no se solapan (12 frente a 3). */
export const PATRON_INSTRUMENT_ID = '^([A-Z]{2}[A-Z0-9]{9}[0-9]|[A-Z]{3})$';

/** Los tipos de instrumento. `CURRENCY` es la liquidez: una posición en una divisa. */
export const TIPOS_DE_INSTRUMENTO = ['FUND', 'ETF', 'STOCK', 'INDEX', 'CURRENCY', 'OTHER'] as const;
export type TipoDeInstrumento = (typeof TIPOS_DE_INSTRUMENTO)[number];

/**
 * La clase de activo, como vocabulario CERRADO. Hoy es texto libre y llega escrito de dos
 * maneras a la vez: `identificacion.clase_activo` dice `'Fixed Income'` y
 * `classification_v2.asset_type` dice `'fixed_income'` para la misma cosa. Dos ortografías
 * de un mismo valor son dos valores para cualquier comparación, y de ahí a una tabla que
 * agrupa mal hay un paso.
 */
export const CLASES_DE_ACTIVO = [
    'EQUITY',
    'FIXED_INCOME',
    'ALLOCATION',
    'ALTERNATIVE',
    'REAL_ASSETS',
    'CAPITAL_PRESERVATION',
    'HYBRID',
    'OTHER'
] as const;
export type ClaseDeActivo = (typeof CLASES_DE_ACTIVO)[number];

/** Roles que una entidad puede tener. El contrato declara los tres desde el principio. */
export const ROLES_ENTIDAD = ['EQUITY_ISSUER', 'FUND_MANAGER', 'DEPOSITARY'] as const;
export type RolEntidad = (typeof ROLES_ENTIDAD)[number];

/** Política de distribución. Obligatoria en todo fondo y ETF; `UNKNOWN` es un valor válido. */
export const POLITICAS_DISTRIBUCION = ['ACCUMULATING', 'DISTRIBUTING', 'UNKNOWN'] as const;

/** Base de rentabilidad. Obligatoria en toda ventana calculada y en toda lista comparada. */
export const BASES_RENTABILIDAD = ['TOTAL_RETURN', 'PRICE_RETURN'] as const;

/**
 * Cuánto se le permite a un reparto de activos no sumar exactamente 1. Un punto porcentual:
 * admite el redondeo del proveedor y deja fuera lo que no cuadra de verdad. Medido el 01-11,
 * de los 63 repartos escritos que no sumaban 1, solo 5 estaban entre 0,99 y 1,01; los otros
 * 58 andaban por el 0,80-0,99, con dos que sumaban exactamente 0.
 *
 * Está aquí, y no en el mapper, porque el escritor y la auditoría tienen que usar LA MISMA.
 * La primera versión tenía 0,01 en el mapper y 0,005 en la auditoría, y entonces la
 * auditoría marcaba como defecto 13 repartos que el escritor había aceptado con todo
 * derecho: dos tolerancias son dos verdades, que es el defecto que este diseño persigue.
 */
export const TOLERANCIA_DEL_REPARTO = 0.01;

// ---------------------------------------------------------------------------
// El libro: tipos de operación y clase de flujo
// ---------------------------------------------------------------------------

/** Qué hace la TWR con un flujo. */
export const CLASES_FLUJO = ['EXTERNAL', 'INTERNAL', 'NON_CASH'] as const;
export type ClaseFlujo = (typeof CLASES_FLUJO)[number];

/**
 * Para los traspasos la clase no es una función del tipo: se resuelve emparejando las dos
 * patas. Si existe la contraria en la misma cuenta y dentro de la ventana, es interno; si
 * no, es externo.
 */
export const RESUELVE_EMPAREJANDO = 'PAIRING';

/** Ventana, en días, para emparejar las dos patas de un traspaso. */
export const VENTANA_EMPAREJAMIENTO_DIAS = 15;

/**
 * El mapa canónico `transaction_type → flow_class`. Es uno solo para todos los
 * depositarios, vive aquí y **no tiene valor por defecto**: un tipo que no esté en este
 * mapa para la ingesta y pide la traducción, no se adivina.
 *
 * Por qué importa tanto: el clasificador del servidor
 * (`functions_python/portfolio_real/parser.py:classify_movement`, borrado el 17-11-2026; está en
 * la etiqueta de Git `referencia-portfolio-real-2026-11-17`) terminaba en
 * `return 'OTRO', False`, y ese `False` significa «interno», es decir «cuenta como
 * rentabilidad». Medido sobre un extracto real de todas las cuentas de un cliente, el 59 %
 * de las operaciones de valores caía en `OTRO`, y una compra con tarjeta —que es dinero que
 * sale de verdad— casaba con la regla de `COMPRA` y bajaba la rentabilidad medida.
 */
export const TIPOS_OPERACION: Readonly<Record<string, ClaseFlujo | typeof RESUELVE_EMPAREJANDO>> = {
    /* Dentro de la cartera: compra, venta, rendimiento o coste. La TWR no los descuenta. */
    BUY: 'INTERNAL',
    SELL: 'INTERNAL',
    SUBSCRIPTION: 'INTERNAL',
    REDEMPTION: 'INTERNAL',
    DIVIDEND: 'INTERNAL',
    COUPON: 'INTERNAL',
    FEE: 'INTERNAL',
    TAX: 'INTERNAL',
    TAX_REFUND: 'INTERNAL',
    REPO: 'INTERNAL',
    /* Dinero que entra o sale por decisión del titular. La TWR los descuenta. */
    CASH_IN: 'EXTERNAL',
    CASH_OUT: 'EXTERNAL',
    /* Traspasos: la clase se resuelve emparejando las patas. */
    TRANSFER_IN: RESUELVE_EMPAREJANDO,
    TRANSFER_OUT: RESUELVE_EMPAREJANDO,
    /* Marcas sin importe. La TWR las ignora. */
    ACCOUNT_OPEN: 'NON_CASH',
    ACCOUNT_CLOSE: 'NON_CASH',
    CORPORATE_ACTION_NO_CASH: 'NON_CASH',
    NOTE: 'NON_CASH'
};

/** Tipos de operación válidos, derivados del mapa. No hay otra lista. */
export const TIPOS_OPERACION_VALIDOS: readonly string[] = Object.keys(TIPOS_OPERACION);

/** La clase de flujo de un tipo, o `undefined` si el tipo no está declarado. */
export function claseDeFlujo(
    tipo: string | undefined | null
): ClaseFlujo | typeof RESUELVE_EMPAREJANDO | undefined {
    if (typeof tipo !== 'string') return undefined;
    return TIPOS_OPERACION[tipo];
}

// ---------------------------------------------------------------------------
// Convenciones de rentabilidad
// ---------------------------------------------------------------------------

/** Si un flujo del día cuenta al principio o al final de ese día. */
export const CONVENCIONES_FLUJO = ['END_OF_DAY', 'START_OF_DAY'] as const;

/** Cada cuánto se revalora para encadenar la TWR. */
export const FRECUENCIAS_VALORACION = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

/** Neta de qué. */
export const BASES_COMISION = ['NET_OF_ALL_CHARGED', 'GROSS'] as const;

/** Ventana de calendario o desde el primer flujo del cliente. Se nombran distinto a propósito. */
export const CLASES_PERIODO = ['CALENDAR', 'SINCE_INCEPTION'] as const;

/** Lo que el diseño fija para la versión alfa, y queda declarado en cada valoración. */
export const CONVENCIONES_POR_DEFECTO = {
    flow_convention: 'END_OF_DAY',
    valuation_frequency: 'DAILY',
    fee_basis: 'NET_OF_ALL_CHARGED'
} as const;

// ---------------------------------------------------------------------------
// Magnitudes: qué unidad lleva cada cosa, en toda la base
// ---------------------------------------------------------------------------

/**
 * Una magnitud, una unidad, en toda la base. Es lo que impide que vuelvan a convivir dos
 * volatilidades a tres años, una en por ciento y otra en decimal.
 *
 * La clave es el nombre del campo sin el periodo ni el sujeto: `volatility.3y.fund` y
 * `volatility_3y` son los dos la magnitud `volatility`.
 */
export const UNIDAD_POR_MAGNITUD: Readonly<Record<string, Unidad>> = {
    volatility: 'fraction',
    annualized_return: 'fraction',
    trailing_return: 'fraction',
    ytd_return: 'fraction',
    max_drawdown: 'fraction',
    tracking_error: 'fraction',
    jensen_alpha: 'fraction',
    active_return: 'fraction',
    provider_alpha: 'fraction',
    twr: 'fraction',
    mwr: 'fraction',
    mwr_annualized: 'fraction',
    weight: 'fraction',
    band_min: 'fraction',
    band_max: 'fraction',
    ongoing_charge: 'fraction',
    management_fee: 'fraction',
    performance_fee: 'fraction',
    entry_charge: 'fraction',
    exit_charge: 'fraction',
    transaction_costs: 'fraction',
    yield_to_maturity: 'fraction',
    /* El rendimiento repartido en doce meses. Es la MISMA magnitud en un fondo (sobre el valor
       liquidativo) y en una acción (sobre el precio), así que lleva el mismo nombre y la misma
       unidad: dos nombres para una magnitud son dos valores para cualquier comparación. */
    yield_12m: 'fraction',
    /* Los dividendos de una acción, por acción y en la divisa del listado. Lo pagado y lo
       anunciado son dos magnitudes distintas a propósito —un hecho y una expectativa— y por eso
       están las dos aquí y no comparten campo. */
    trailing_amount_per_share: 'currency_amount',
    forward_amount_per_share: 'currency_amount',
    /* El precio del instrumento, que hasta el 01-11-2026 no tenía sitio en ningún contrato.
       `price` y `unit_price` NO son sinónimos y por eso no están en un grupo: uno es el último
       precio publicado del instrumento y el otro el precio al que se ejecutó una operación
       concreta del libro. */
    price: 'currency_amount',
    investment_grade: 'fraction',
    high_yield: 'fraction',
    top10_weight: 'fraction',
    coverage: 'fraction',
    confidence: 'fraction',
    r2: 'fraction',
    equity: 'fraction',
    fixed_income: 'fraction',
    cash: 'fraction',
    alternative: 'fraction',
    real_asset: 'fraction',
    other: 'fraction',
    sharpe: 'ratio',
    sortino: 'ratio',
    information_ratio: 'ratio',
    beta: 'ratio',
    fx_rate: 'ratio',
    effective_duration: 'years',
    modified_duration: 'years',
    effective_maturity: 'years',
    horizon_years: 'years',
    market_value: 'currency_amount',
    avg_cost: 'currency_amount',
    unit_price: 'currency_amount',
    amount: 'currency_amount',
    gross_amount: 'currency_amount',
    net_amount: 'currency_amount',
    charges: 'currency_amount',
    taxes: 'currency_amount',
    cash_amount: 'currency_amount',
    cash_balance: 'currency_amount',
    aum: 'currency_amount',
    units: 'count',
    positions_count: 'count',
    securities_count: 'count',
    observations: 'count',
    external_flows_count: 'count'
};

/**
 * Un dato, un sitio. Cada grupo son nombres que significan LO MISMO, y ningún documento
 * puede declarar dos miembros del mismo grupo: eso sería el mismo dato en dos rutas.
 *
 * Los dos primeros grupos son los dos defectos medidos de la maestra de hoy:
 * `asset_id` e `identifiers.isin` son la misma cadena en los 1.097 documentos, y la
 * distribución de TIR convive con nombre español y nombre inglés en el mismo bloque.
 */
export const GRUPOS_SINONIMOS: readonly (readonly string[])[] = [
    ['instrument_id', 'asset_id', 'isin'],
    ['yield_to_maturity', 'ytw', 'ytm', 'tir', 'rentabilidad_vencimiento'],
    ['ongoing_charge', 'ter', 'gastos_corrientes', 'ongoing_charges'],
    ['issuer_id', 'gestora_id', 'manager_id'],
    ['instrument_type', 'asset_type', 'tipo_producto'],
    ['distribution_policy', 'dividend_policy', 'politica_distribucion'],
    ['net_amount', 'importe_neto'],
    ['gross_amount', 'importe_bruto'],
    ['market_value', 'valor_mercado', 'valuation'],
    ['positions_count', 'num_posiciones', 'holdings_count'],
    ['effective_duration', 'duracion_efectiva']
];

/*
 * Ojo con lo que NO es un grupo: `sri` y `srri` NO son sinonimos. Son dos indicadores
 * distintos, de dos documentos distintos y con dos escalas distintas, y declared/regulatory
 * los lleva los dos a proposito. Meterlos en el mismo campo es el defecto que hay hoy.
 *
 * Tampoco lo son, y conviene dejarlo escrito antes de que alguien lo junte:
 *
 * - `aum` y `market_cap`. El patrimonio de un fondo es el dinero que le han confiado; la
 *   capitalizacion de una empresa es lo que vale en bolsa. Las dos son «tamano» y un importe,
 *   y ahi acaba el parecido: una la declara la gestora y la otra sale del precio por las
 *   acciones en circulacion. Escribir una capitalizacion en el campo `aum` de `declared/size`
 *   seria la version de libro del defecto que motiva esta base. Por eso `declared/size` es de
 *   fondos y ETF, y la capitalizacion vive con los fundamentales del emisor.
 * - `positions_count` y `securities_count`. El primero son los bonos o, si no hay, las acciones; el
 *   segundo, los titulos de las dos clases. En una cartera mixta no dan lo mismo (decision 55).
 * - `price` y `unit_price`. Ver el catalogo de magnitudes.
 * - `yield_12m` y `yield_to_maturity`. El primero es lo repartido; el segundo, la rentabilidad
 *   a vencimiento de una cartera de renta fija. El grupo de sinonimos del segundo existe
 *   justamente porque convivia con dos nombres, y el primero no entra en el.
 */

/**
 * Quita el periodo y el sujeto del final de un nombre de ruta para quedarse con la
 * magnitud. `volatility.3y.fund` → `volatility`; `volatility_3y` → `volatility`.
 */
export function magnitudDe(ruta: string): string {
    const partes = ruta.split('.').filter((parte) => {
        if ((PERIODOS as readonly string[]).includes(parte)) return false;
        if ((SUJETOS as readonly string[]).includes(parte)) return false;
        return true;
    });
    const ultima = partes[partes.length - 1] ?? '';
    const sinPeriodo = ultima.replace(/_(1y|3y|5y|10y)$/, '');
    return sinPeriodo.replace(/_(fund|category|benchmark)$/, '');
}

/** La unidad que le toca a una ruta, si su magnitud está en el catálogo. */
export function unidadEsperada(ruta: string): Unidad | undefined {
    return UNIDAD_POR_MAGNITUD[magnitudDe(ruta)];
}
