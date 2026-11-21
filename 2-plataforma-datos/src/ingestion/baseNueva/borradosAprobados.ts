/**
 * src/ingestion/baseNueva/borradosAprobados.ts — los únicos documentos que esta base borra.
 *
 * El escritor no borra nada, y eso no cambia: nombra los sobrantes y decide alguien. Lo que hay aquí es lo
 * que ya se ha decidido, ruta a ruta, con quién y por qué. No hay patrones ni colecciones: lo que no esté
 * escrito en esta lista no se puede borrar por este camino, aunque alguien lo pida.
 *
 * Lo usan dos órdenes, cada una con su puerta: `npm run baseNueva:borrar` en el emulador y la subida del
 * catálogo en la nube. Las dos deciden con la misma función, para que lo que se ensaya aquí sea lo que
 * luego pase allí.
 */

export interface BorradoAprobado {
    ruta: string;
    /** Quién lo decidió y dónde consta. */
    decision: string;
    fecha: string;
    motivo: string;
    /**
     * El instrumento entero ha salido del universo, y que el origen no lo tenga es justo lo esperado. Sin esta marca
     * esa ausencia se lee como un fallo de lectura y no se borra nada. Con ella manda la otra comprobación: que el
     * origen sea un catálogo entero (`MINIMO_DE_INSTRUMENTOS_EN_EL_ORIGEN`) y no uno vacío o a medias.
     */
    instrumento_retirado?: true;
}

/** Honeywell «when issued»: 73 documentos del instrumento y su vínculo. El emisor `issuers/ISS_000258` NO va aquí, porque lo comparte el ISIN vigente, `US4385161066`. */
const RUTAS_DE_HONEYWELL_WHEN_ISSUED = [
    'instruments/US4385162056',
    'instruments/US4385162056/computed/metrics',
    'instruments/US4385162056/declared/dividends',
    'instruments/US4385162056/declared/equity',
    'instruments/US4385162056/declared/provenance',
    'instruments/US4385162056/declared/quote',
    'instruments/US4385162056/price_series/1962',
    'instruments/US4385162056/price_series/1963',
    'instruments/US4385162056/price_series/1964',
    'instruments/US4385162056/price_series/1965',
    'instruments/US4385162056/price_series/1966',
    'instruments/US4385162056/price_series/1967',
    'instruments/US4385162056/price_series/1968',
    'instruments/US4385162056/price_series/1969',
    'instruments/US4385162056/price_series/1970',
    'instruments/US4385162056/price_series/1971',
    'instruments/US4385162056/price_series/1972',
    'instruments/US4385162056/price_series/1973',
    'instruments/US4385162056/price_series/1974',
    'instruments/US4385162056/price_series/1975',
    'instruments/US4385162056/price_series/1976',
    'instruments/US4385162056/price_series/1977',
    'instruments/US4385162056/price_series/1978',
    'instruments/US4385162056/price_series/1979',
    'instruments/US4385162056/price_series/1980',
    'instruments/US4385162056/price_series/1981',
    'instruments/US4385162056/price_series/1982',
    'instruments/US4385162056/price_series/1983',
    'instruments/US4385162056/price_series/1984',
    'instruments/US4385162056/price_series/1985',
    'instruments/US4385162056/price_series/1986',
    'instruments/US4385162056/price_series/1987',
    'instruments/US4385162056/price_series/1988',
    'instruments/US4385162056/price_series/1989',
    'instruments/US4385162056/price_series/1990',
    'instruments/US4385162056/price_series/1991',
    'instruments/US4385162056/price_series/1992',
    'instruments/US4385162056/price_series/1993',
    'instruments/US4385162056/price_series/1994',
    'instruments/US4385162056/price_series/1995',
    'instruments/US4385162056/price_series/1996',
    'instruments/US4385162056/price_series/1997',
    'instruments/US4385162056/price_series/1998',
    'instruments/US4385162056/price_series/1999',
    'instruments/US4385162056/price_series/2000',
    'instruments/US4385162056/price_series/2001',
    'instruments/US4385162056/price_series/2002',
    'instruments/US4385162056/price_series/2003',
    'instruments/US4385162056/price_series/2004',
    'instruments/US4385162056/price_series/2005',
    'instruments/US4385162056/price_series/2006',
    'instruments/US4385162056/price_series/2007',
    'instruments/US4385162056/price_series/2008',
    'instruments/US4385162056/price_series/2009',
    'instruments/US4385162056/price_series/2010',
    'instruments/US4385162056/price_series/2011',
    'instruments/US4385162056/price_series/2012',
    'instruments/US4385162056/price_series/2013',
    'instruments/US4385162056/price_series/2014',
    'instruments/US4385162056/price_series/2015',
    'instruments/US4385162056/price_series/2016',
    'instruments/US4385162056/price_series/2017',
    'instruments/US4385162056/price_series/2018',
    'instruments/US4385162056/price_series/2019',
    'instruments/US4385162056/price_series/2020',
    'instruments/US4385162056/price_series/2021',
    'instruments/US4385162056/price_series/2022',
    'instruments/US4385162056/price_series/2023',
    'instruments/US4385162056/price_series/2024',
    'instruments/US4385162056/price_series/2025',
    'instruments/US4385162056/price_series/2026',
    'instruments/US4385162056/quality/latest',
    'instruments/US4385162056/read/card',
    'instrument_issuer/US4385162056_EQUITY_ISSUER'
] as const;

/** Prysmian: 10 documentos del instrumento, su vínculo y su emisor, que solo la tenía a ella. */
const RUTAS_DE_PRYSMIAN = [
    'instruments/IT0004176001',
    'instruments/IT0004176001/computed/metrics',
    'instruments/IT0004176001/declared/dividends',
    'instruments/IT0004176001/declared/equity',
    'instruments/IT0004176001/declared/provenance',
    'instruments/IT0004176001/declared/quote',
    'instruments/IT0004176001/price_series/2025',
    'instruments/IT0004176001/price_series/2026',
    'instruments/IT0004176001/quality/latest',
    'instruments/IT0004176001/read/card',
    'instrument_issuer/IT0004176001_EQUITY_ISSUER',
    'issuers/ISS_000478'
] as const;

/**
 * Allianz: los cinco años de la línea de Fráncfort anteriores al primer dato de Xetra (01-02-1994). El instrumento se
 * queda; solo sobran estos años, que dejarían la serie empalmada entre dos plazas (decisión 49).
 */
const RUTAS_DE_ALLIANZ_ANTERIORES_A_XETRA = [
    'instruments/DE0008404005/price_series/1989',
    'instruments/DE0008404005/price_series/1990',
    'instruments/DE0008404005/price_series/1991',
    'instruments/DE0008404005/price_series/1992',
    'instruments/DE0008404005/price_series/1993'
] as const;

/**
 * iShares MSCI ACWI (IUSQ.XETRA): EODHD ha recortado la serie, que empezaba el 21-10-2011 y ahora empieza el 02-04-2012.
 * El año 2011 (50 puntos) quedó colgando y dejaría un hueco de enero a marzo de 2012 (decisión B-64). El instrumento se
 * queda; la pérdida es del proveedor, no del fondo, que cotiza desde octubre de 2011.
 */
const RUTAS_DE_IUSQ_ANTERIORES_AL_RECORTE = ['instruments/IE00B6R52259/price_series/2011'] as const;

/**
 * Seis acciones a las que EODHD ha recortado la historia (16-11-2026): el 10-11 su serie empezaba antes y hoy el proveedor
 * ya no da esos años. Comprobado en su propia respuesta, no en lo que el extractor hace con ella: HSBC (HSBA.LSE) empezaba
 * el 05-07-1988 y empieza el 11-06-1992; SSE (SSE.LSE), del 18-06-1991 al 01-07-1993; AMD y Exxon Mobil, del 17-03-1980 al
 * 05-11-1984; Texas Instruments, del 01-06-1972 al 17-03-1980; y Xcel Energy, del 21-02-1973 al 05-11-1984. Sobran los años
 * enteros anteriores al primero que hoy trae cada una; ese primero se reescribe con lo que hay. Es el caso de IUSQ (B-64),
 * seis veces: los instrumentos se quedan, y la pérdida es del proveedor. No toca ninguna cifra publicada, porque las ventanas
 * llegan como mucho a diez años (decisión B-82).
 */
const RUTAS_DE_SEIS_ACCIONES_RECORTADAS_POR_EODHD = [
    'instruments/GB0005405286/price_series/1988',
    'instruments/GB0005405286/price_series/1989',
    'instruments/GB0005405286/price_series/1990',
    'instruments/GB0005405286/price_series/1991',
    'instruments/GB0007908733/price_series/1991',
    'instruments/GB0007908733/price_series/1992',
    'instruments/US0079031078/price_series/1980',
    'instruments/US0079031078/price_series/1981',
    'instruments/US0079031078/price_series/1982',
    'instruments/US0079031078/price_series/1983',
    'instruments/US30233Q1085/price_series/1980',
    'instruments/US30233Q1085/price_series/1981',
    'instruments/US30233Q1085/price_series/1982',
    'instruments/US30233Q1085/price_series/1983',
    'instruments/US8825081040/price_series/1972',
    'instruments/US8825081040/price_series/1973',
    'instruments/US8825081040/price_series/1974',
    'instruments/US8825081040/price_series/1975',
    'instruments/US8825081040/price_series/1976',
    'instruments/US8825081040/price_series/1977',
    'instruments/US8825081040/price_series/1978',
    'instruments/US8825081040/price_series/1979',
    'instruments/US98389B1008/price_series/1973',
    'instruments/US98389B1008/price_series/1974',
    'instruments/US98389B1008/price_series/1975',
    'instruments/US98389B1008/price_series/1976',
    'instruments/US98389B1008/price_series/1977',
    'instruments/US98389B1008/price_series/1978',
    'instruments/US98389B1008/price_series/1979',
    'instruments/US98389B1008/price_series/1980',
    'instruments/US98389B1008/price_series/1981',
    'instruments/US98389B1008/price_series/1982',
    'instruments/US98389B1008/price_series/1983'
] as const;

/**
 * BlackRock Global Allocation A2 (LU0171283459): su serie está parada y la raíz lleva `metrics_absence: SERIES_STOPPED`, así
 * que el extractor ya no escribe `computed/metrics`; el que queda son las métricas V2 a 30-09-2026, que ya no aplican y
 * convivían con el sello que dice que no hay. Es el primer caso de «un campo presente donde no aplica es un error» (A-17),
 * decidido uno a uno (decisión B-67). El instrumento se queda; solo sobra ese documento.
 */
const RUTAS_DE_METRICAS_CON_LA_SERIE_PARADA = ['instruments/LU0171283459/computed/metrics'] as const;

/**
 * Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C: los 56 documentos del instrumento, medidos sobre el emulador el
 * 09-11-2026 (raíz, 2 `computed`, 11 `declared`, 20 años de `issuer_nav` y 20 de `price_series` de 2007 a 2026, calidad
 * y tarjeta). No tiene vínculo en `instrument_issuer` ni emisor propio. Los dos DWS Kaldemorgen que lo llevan en su top 10
 * conservan esa posición: es su cartera, no un documento de este instrumento.
 */
const RUTAS_DEL_XTRACKERS_MONETARIO = [
    'instruments/LU0290358497',
    'instruments/LU0290358497/computed/metrics',
    'instruments/LU0290358497/computed/premium_discount',
    'instruments/LU0290358497/declared/costs',
    'instruments/LU0290358497/declared/distributions',
    'instruments/LU0290358497/declared/exposure',
    'instruments/LU0290358497/declared/issuer_data',
    'instruments/LU0290358497/declared/profile',
    'instruments/LU0290358497/declared/provenance',
    'instruments/LU0290358497/declared/provider_returns',
    'instruments/LU0290358497/declared/provider_risk',
    'instruments/LU0290358497/declared/quote',
    'instruments/LU0290358497/declared/regulatory',
    'instruments/LU0290358497/declared/size',
    'instruments/LU0290358497/issuer_nav/2007',
    'instruments/LU0290358497/issuer_nav/2008',
    'instruments/LU0290358497/issuer_nav/2009',
    'instruments/LU0290358497/issuer_nav/2010',
    'instruments/LU0290358497/issuer_nav/2011',
    'instruments/LU0290358497/issuer_nav/2012',
    'instruments/LU0290358497/issuer_nav/2013',
    'instruments/LU0290358497/issuer_nav/2014',
    'instruments/LU0290358497/issuer_nav/2015',
    'instruments/LU0290358497/issuer_nav/2016',
    'instruments/LU0290358497/issuer_nav/2017',
    'instruments/LU0290358497/issuer_nav/2018',
    'instruments/LU0290358497/issuer_nav/2019',
    'instruments/LU0290358497/issuer_nav/2020',
    'instruments/LU0290358497/issuer_nav/2021',
    'instruments/LU0290358497/issuer_nav/2022',
    'instruments/LU0290358497/issuer_nav/2023',
    'instruments/LU0290358497/issuer_nav/2024',
    'instruments/LU0290358497/issuer_nav/2025',
    'instruments/LU0290358497/issuer_nav/2026',
    'instruments/LU0290358497/price_series/2007',
    'instruments/LU0290358497/price_series/2008',
    'instruments/LU0290358497/price_series/2009',
    'instruments/LU0290358497/price_series/2010',
    'instruments/LU0290358497/price_series/2011',
    'instruments/LU0290358497/price_series/2012',
    'instruments/LU0290358497/price_series/2013',
    'instruments/LU0290358497/price_series/2014',
    'instruments/LU0290358497/price_series/2015',
    'instruments/LU0290358497/price_series/2016',
    'instruments/LU0290358497/price_series/2017',
    'instruments/LU0290358497/price_series/2018',
    'instruments/LU0290358497/price_series/2019',
    'instruments/LU0290358497/price_series/2020',
    'instruments/LU0290358497/price_series/2021',
    'instruments/LU0290358497/price_series/2022',
    'instruments/LU0290358497/price_series/2023',
    'instruments/LU0290358497/price_series/2024',
    'instruments/LU0290358497/price_series/2025',
    'instruments/LU0290358497/price_series/2026',
    'instruments/LU0290358497/quality/latest',
    'instruments/LU0290358497/read/card'
] as const;

/*
 * Una ruta entra aquí solo con la aprobación de Óscar. El único borrado anterior, el reparto de junio de Lazard Small
 * Caps Euro I (decisión 52), dejó de serlo el mismo día con la decisión B-63: su reparto de septiembre ya pasa el contrato.
 *
 * Estas son las dos primeras retiradas de un instrumento entero (decisión 45 de DECISIONES_DATOS_2026-11-07, 08-11-2026).
 * La tercera es el Xtrackers monetario, LU0290358497 (decisión B-70, 09-11-2026).
 */
export const BORRADOS_APROBADOS: readonly BorradoAprobado[] = [
    ...RUTAS_DE_HONEYWELL_WHEN_ISSUED.map(
        (ruta): BorradoAprobado => ({
            ruta,
            decision: 'decisión 39 de Óscar, autorizada en la decisión 45',
            fecha: '2026-11-08',
            motivo: 'línea «when issued» de Honeywell: comparte símbolo y serie con el ISIN vigente US4385161066',
            instrumento_retirado: true
        })
    ),
    ...RUTAS_DE_PRYSMIAN.map(
        (ruta): BorradoAprobado => ({
            ruta,
            decision: 'decisión 44 de Óscar, autorizada en la decisión 45',
            fecha: '2026-11-08',
            motivo: 'Prysmian sale del universo: su cotización en Xetra empieza en 09-2025 y la de Londres es fina',
            instrumento_retirado: true
        })
    ),
    ...RUTAS_DE_ALLIANZ_ANTERIORES_A_XETRA.map(
        (ruta): BorradoAprobado => ({
            ruta,
            decision: 'aprobado por Óscar en la sesión de la decisión 49',
            fecha: '2026-11-08',
            motivo: 'Allianz pasa de Fráncfort a Xetra, cuya serie empieza en 1994: este año era de la línea anterior'
        })
    ),
    ...RUTAS_DE_IUSQ_ANTERIORES_AL_RECORTE.map(
        (ruta): BorradoAprobado => ({
            ruta,
            decision: 'decisión B-64 de Óscar',
            fecha: '2026-11-09',
            motivo:
                'EODHD recortó la serie de IUSQ.XETRA, que ahora empieza el 02-04-2012: el documento anual de 2011 quedó colgando y dejaría un hueco de enero a marzo de 2012'
        })
    ),
    ...RUTAS_DE_METRICAS_CON_LA_SERIE_PARADA.map(
        (ruta): BorradoAprobado => ({
            ruta,
            decision: 'decisión B-67 de Óscar, 09-11-2026',
            fecha: '2026-11-09',
            motivo:
                'serie parada: la raíz lleva el sello metrics_absence SERIES_STOPPED y estas son las métricas V2 a 30-09-2026, que ya no aplican'
        })
    ),
    ...RUTAS_DEL_XTRACKERS_MONETARIO.map(
        (ruta): BorradoAprobado => ({
            ruta,
            decision: 'decisión B-70 de Óscar',
            fecha: '2026-11-09',
            motivo:
                'retirado del catálogo por decisión: era el único monetario, y Rendimiento deja de usarlo como referencia y respaldo del libre de riesgo, que pasan al €STR de la base',
            instrumento_retirado: true
        })
    ),
    ...RUTAS_DE_SEIS_ACCIONES_RECORTADAS_POR_EODHD.map(
        (ruta): BorradoAprobado => ({
            ruta,
            decision: 'decisión B-82 de Óscar',
            fecha: '2026-11-16',
            motivo:
                'EODHD recortó la serie de seis acciones (HSBC, SSE, AMD, Exxon Mobil, Texas Instruments y Xcel Energy): este año es anterior al primero que el proveedor da hoy y quedó colgando'
        })
    )
];

/** Lo que se hace con cada ruta aprobada, y por qué. */
export type DestinoDelBorrado =
    /** Está en el destino, y el origen no la tiene: se borra. */
    | 'SE_BORRA'
    /** Ya no está en el destino: no hay nada que hacer. */
    | 'YA_NO_ESTA'
    /** El origen vuelve a tenerla: hay un reparto que cuadra, y se escribe en vez de borrarse. */
    | 'EL_ORIGEN_LA_TRAE'
    /** El origen no tiene ni el instrumento: no sirve para decir que el documento sobra. */
    | 'ORIGEN_SIN_EL_INSTRUMENTO'
    /** Para retirar un instrumento hace falta un origen que sea un catálogo entero, y este no lo es. */
    | 'ORIGEN_INCOMPLETO';

export interface DecisionDeBorrado extends BorradoAprobado {
    destino: DestinoDelBorrado;
    /** La fecha del documento que se borraría, para reconocerlo en el plan. */
    as_of?: string;
}

/** Lo justo de Firestore que hace falta, para poder probarlo con una base de mentira. */
export interface BaseDeBorrados {
    doc(ruta: string): {
        get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
        delete(): Promise<unknown>;
    };
}

/**
 * Cuántas raíces de instrumento ha de tener el origen para que «no lo tiene» signifique algo. Son 1.316 el
 * 08-11-2026; el suelo no intenta acertar el número, solo distinguir un catálogo de una lectura fallida o a medias.
 */
export const MINIMO_DE_INSTRUMENTOS_EN_EL_ORIGEN = 1000;

/** `instruments/X/declared/exposure` → `instruments/X`. */
function raizDe(ruta: string): string {
    return ruta.split('/').slice(0, 2).join('/');
}

/**
 * Decide qué pasa con cada ruta aprobada, SIN tocar nada. `delOrigen` son las rutas que hoy produce la
 * fuente de la verdad: lo que el mapeo saca del canónico, para el emulador; lo que hay en el emulador,
 * para la nube.
 *
 * El instrumento tiene que estar en el origen, y no es un adorno: si un emulador vacío se tomara por
 * «no lo tiene», se borraría en la nube por un fallo de lectura. La excepción son los instrumentos retirados
 * enteros, que no pueden estar: ahí lo que se exige es que el origen sea un catálogo entero.
 */
export async function planDeBorrados(
    base: BaseDeBorrados,
    delOrigen: ReadonlySet<string>,
    aprobados: readonly BorradoAprobado[] = BORRADOS_APROBADOS
): Promise<DecisionDeBorrado[]> {
    const plan: DecisionDeBorrado[] = [];
    const instrumentosDelOrigen = [...delOrigen].filter((ruta) => /^instruments\/[^/]+$/.test(ruta)).length;
    for (const aprobado of aprobados) {
        const leido = await base.doc(aprobado.ruta).get();
        const asOf = leido.exists ? leido.data()?.['as_of'] : undefined;
        const enElOrigen = delOrigen.has(aprobado.ruta);
        const raizEnElOrigen = delOrigen.has(raizDe(aprobado.ruta));
        const segunElDestino = leido.exists ? 'SE_BORRA' : 'YA_NO_ESTA';
        const destino: DestinoDelBorrado = aprobado.instrumento_retirado
            ? enElOrigen || raizEnElOrigen
                ? 'EL_ORIGEN_LA_TRAE'
                : instrumentosDelOrigen < MINIMO_DE_INSTRUMENTOS_EN_EL_ORIGEN
                  ? 'ORIGEN_INCOMPLETO'
                  : segunElDestino
            : !raizEnElOrigen
              ? 'ORIGEN_SIN_EL_INSTRUMENTO'
              : enElOrigen
                ? 'EL_ORIGEN_LA_TRAE'
                : segunElDestino;
        plan.push({ ...aprobado, destino, ...(typeof asOf === 'string' ? { as_of: asOf } : {}) });
    }
    return plan;
}

/** Cómo se cuenta cada decisión en un plan, para quien la va a autorizar. */
export function describirPlan(plan: readonly DecisionDeBorrado[]): string[] {
    const lineas: string[] = [];
    for (const decision of plan) {
        const fecha = decision.as_of === undefined ? '' : ` (dato del ${decision.as_of})`;
        const texto: Record<DestinoDelBorrado, string> = {
            SE_BORRA: `SE BORRARIA${fecha}: ${decision.ruta}`,
            YA_NO_ESTA: `ya no esta: ${decision.ruta}`,
            EL_ORIGEN_LA_TRAE: `NO se borra, porque el origen vuelve a tenerla: ${decision.ruta}`,
            ORIGEN_SIN_EL_INSTRUMENTO: `NO se borra, porque el origen no tiene ese instrumento: ${decision.ruta}`,
            ORIGEN_INCOMPLETO: `NO se borra, porque el origen no es un catalogo entero: ${decision.ruta}`
        };
        lineas.push(`  ${texto[decision.destino]}`);
        lineas.push(`    ${decision.decision}, ${decision.fecha}.`);
    }
    return lineas;
}

export interface ResultadoDeBorrados {
    borrados: string[];
    /** Lo que se mandó borrar y sigue ahí al volver a leer. Tiene que quedar vacío. */
    siguen: string[];
}

/**
 * Borra lo que el plan dice, con la puerta de quien llama abierta. Vuelve a comprobar cada ruta contra la
 * lista: un plan es un dato, y no puede ampliar lo que se aprobó.
 */
export async function ejecutarBorrados(
    base: BaseDeBorrados,
    plan: readonly DecisionDeBorrado[],
    puertaAbierta: boolean,
    aprobados: readonly BorradoAprobado[] = BORRADOS_APROBADOS
): Promise<ResultadoDeBorrados> {
    if (!puertaAbierta) throw new Error('borrado bloqueado: la puerta de escritura no esta abierta.');
    const aprobadas = new Set(aprobados.map((aprobado) => aprobado.ruta));
    /*
     * De las hojas a la raíz (auditoría del 16-11-2026, PLA-6). Las listas ponen primero la raíz del
     * instrumento, y borrándola primero un corte a medias dejaba su tarjeta y sus series colgando de una
     * raíz que ya no existe: huérfanos que en la nube no mira nadie. Con la raíz al final, un corte deja un
     * instrumento al que le faltan bloques, que sigue viéndose y que relanzar termina de borrar.
     */
    const profundidad = (ruta: string): number => ruta.split('/').length;
    const aBorrar = plan
        .filter((decision) => decision.destino === 'SE_BORRA')
        .map((decision, orden) => ({ decision, orden }))
        .sort((a, b) => profundidad(b.decision.ruta) - profundidad(a.decision.ruta) || a.orden - b.orden)
        .map(({ decision }) => decision);
    for (const decision of aBorrar) {
        if (!aprobadas.has(decision.ruta)) {
            throw new Error(`borrado bloqueado: ${decision.ruta} no esta en BORRADOS_APROBADOS.`);
        }
    }
    const borrados: string[] = [];
    const siguen: string[] = [];
    for (const { ruta } of aBorrar) {
        await base.doc(ruta).delete();
        borrados.push(ruta);
        if ((await base.doc(ruta).get()).exists) siguen.push(ruta);
    }
    return { borrados, siguen };
}
