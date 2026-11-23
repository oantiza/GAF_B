/**
 * src/ingestion/baseNueva/calidadYTarjeta.ts — lo que produce el LOTE: `quality/latest` y
 * `read/card`.
 *
 * Son los dos documentos de `x-owner: batch`, y no los escribe el escritor de plataforma: la
 * puerta de dueño se lo impide a propósito. Funciones puras, sin I/O.
 *
 * **La calidad** cuenta, para cada instrumento, cuántas de las rutas que le APLICAN están
 * presentes. El denominador sale del contrato y del predicado `x-applies-when`, no de una
 * cuenta a mano: es la lección del 30-10 convertida en código. Y por cada ruta que falta
 * guarda **por qué** falta, que es lo que sustituye a los 22 centinelas.
 *
 * **La tarjeta** compone en un solo documento lo que la app consume. Existe por una razón
 * medida: con los bloques sueltos, la pantalla de una cartera de 25 posiciones pasaría de 25
 * lecturas a 75. Duplica a propósito, lleva `computed_at` y no es fuente de nada: si la
 * tarjeta y el bloque declarado dicen cosas distintas, el bloque tiene razón.
 */
import { createHash } from 'crypto';

import { CLAVES_DEL_SOBRE, type Ausencia } from '../../config/baseNueva/vocabulario';
import { aptitudesDe, esMateriaPrimaSinReparto, politicaDeReparto } from '../../config/baseNueva/aptitudes';

export { esMateriaPrimaSinReparto };
import { cargarEsquemas, rutasDe, type RutaDeclarada } from '../../config/baseNueva/esquemas';
import { aplicaAlInstrumento, rasgosDeLoEscrito, type RasgosDelInstrumento } from './aplicabilidad';
import { BLOQUES_DE_INSTRUMENTO } from './mapper';

/** Un instrumento tal como está en la base: su raíz y sus bloques. */
export interface InstrumentoLeido {
    instrument_id: string;
    raiz: Record<string, unknown>;
    /** Clave = sufijo de `BLOQUES_DE_INSTRUMENTO`; `undefined` = ese bloque no está. */
    bloques: Partial<Record<string, Record<string, unknown> | undefined>>;
    /**
     * `computed/metrics`, si existe: 642 de 772 el 01-11-2026, escrito por el extractor con
     * `core.metricas v1`. Su presencia es lo que hace que la tarjeta lleve NUESTRA cifra, y su
     * ausencia lo que la hace caer a la del proveedor.
     */
    calculadas?: Record<string, unknown> | undefined;
    /**
     * Desde cuando vale la serie de este fondo: `usable_from` en `fund_history_policies.json`, la lista de Functions. Lo anterior es la
     * historia previa a la clase, sin revisar. No es un dato del canonico, y lo trae el lote (decision 112 de Oscar, 05-11-2026).
     */
    serieValidaDesde?: string | undefined;
}

/**
 * El sufijo del unico bloque que NO viaja en `bloques`.
 *
 * `computed/metrics` esta en `BLOQUES_DE_INSTRUMENTO` -la cobertura y la deteccion de
 * sobrantes tienen que conocerlo- pero el lector lo trae en `calculadas`, aparte, porque lo
 * escribe el extractor y no el proveedor. Quien recorra el registro y lo busque en `bloques`
 * no lo encontrara nunca y concluira que falta.
 *
 * Ya ha pasado dos veces el 02-11-2026: primero `available_sections` no declaraba `metrics`,
 * y despues la cobertura marcaba ausentes las 33 rutas de nuestras propias metricas en los
 * 938 instrumentos que las tienen -51.466 ausencias falsas, el 53 % del total, medidas sobre
 * la base-. De ahi este accesor: el registro se recorre por aqui, no por `bloques`.
 */
const SUFIJO_DE_METRICAS = 'computed/metrics';

/** El documento de un bloque, venga de `bloques` o de `calculadas`. */
function documentoDe(
    instrumento: InstrumentoLeido,
    sufijo: string
): Record<string, unknown> | undefined {
    return sufijo === SUFIJO_DE_METRICAS ? instrumento.calculadas : instrumento.bloques[sufijo];
}

/** Una ruta del contrato que cuenta para la cobertura. */
interface RutaContable {
    /** La ruta dentro de su documento. */
    ruta: string;
    /** El predicado de aplicabilidad, si lo declara. Es el que decide si cuenta en la cobertura (`x-counts-when` primero). */
    aplicaCuando: string | undefined;
    /**
     * Solo `x-applies-when`, heredado, SIN `x-counts-when`: a quien aplica el campo. Es el que lee la comprobación
     * de campos presentes donde no aplica (decisión C-17). No es `aplicaCuando`: `relative` cuenta solo en fondos
     * (`x-counts-when`) pero se rellena también en una acción, y eso no es un error.
     */
    aplicaSolo: string | undefined;
    /**
     * Lo que significa su ausencia, declarado en ESTA ruta. `undefined` = no lo dice ella, y
     * entonces lo dice un antepasado o, si ninguno lo dice, es `NOT_PROVIDED`.
     */
    ausencia: Ausencia | undefined;
    /**
     * Los antepasados que sí declaran qué significa su ausencia, del más cercano al más lejano.
     *
     * Existe porque el motivo NO se heredaba y el predicado sí, y esa asimetría se veía en el
     * dato: medidas sobre la base el 02-11-2026, 4.813 ausencias decían «falta» cuando su
     * contrato dice otra cosa -2.313 de `availability` en los 771 fondos, que es «sin pedir»,
     * y 2.500 de la identidad del índice en 625 instrumentos sin índice, que es «no aplica»-.
     * Un motivo equivocado no mueve la cobertura; mueve lo que la ficha le dice a quien la lee,
     * y la ficha pinta los tres motivos distintos a propósito.
     */
    heredables: readonly { ruta: string; motivo: Ausencia }[];
}

/**
 * Las rutas que cuentan de un tipo de documento. Se calcula una vez por proceso.
 *
 * Qué NO cuenta, y por qué: el sello de escritura (`x-layer: metadata`), porque no es un dato
 * del instrumento; el sobre de la afirmación (`source`, `as_of`, `document_url`, `sha256`),
 * por lo mismo; y todo lo que cuelga de `_overrides`, porque es una decisión humana y su
 * ausencia es lo normal, no una laguna.
 */
function rutasContables(tipo: string): RutaContable[] {
    const esquema = cargarEsquemas().find((candidato) => candidato.fichero === tipo);
    if (esquema === undefined) return [];

    const cuenta = (ruta: RutaDeclarada): boolean => {
        if (ruta.ruta.includes('*') || ruta.ruta.includes('[]')) return false;
        if (ruta.ruta.startsWith('_overrides')) return false;
        if (ruta.capa === 'metadata') return false;
        if (!ruta.ruta.includes('.') && CLAVES_DEL_SOBRE.includes(ruta.ruta)) return false;
        const esMapa = ruta.nodo['additionalProperties'] !== undefined && ruta.nodo['additionalProperties'] !== false;
        const esLista = ruta.nodo['type'] === 'array';
        return ruta.esHoja || esMapa || esLista;
    };

    /* Quién declara qué significa una ausencia, SIN filtrar por `cuenta`: un objeto intermedio
       no cuenta para la cobertura -no es donde vive un valor- pero es justo quien suele
       declararlo. `availability` es el caso: lo declara el bloque, no sus cuatro campos. */
    const declara = new Map<string, Ausencia>();
    for (const ruta of rutasDe(esquema)) {
        const propia = ruta.nodo['x-absence'];
        if (typeof propia === 'string') declara.set(ruta.ruta, propia as Ausencia);
    }

    const antepasadosQueDeclaran = (ruta: string): { ruta: string; motivo: Ausencia }[] => {
        const partes = ruta.split('.');
        const salida: { ruta: string; motivo: Ausencia }[] = [];
        for (let corte = partes.length - 1; corte > 0; corte -= 1) {
            const antepasado = partes.slice(0, corte).join('.');
            const motivo = declara.get(antepasado);
            if (motivo !== undefined) salida.push({ ruta: antepasado, motivo });
        }
        return salida;
    };

    return rutasDe(esquema)
        .filter(cuenta)
        .map((ruta) => ({
            ruta: ruta.ruta,
            /* El predicado viene ya heredado del antepasado más cercano que lo declare, raíz
               del esquema incluida: lo resuelve `rutasDe`, que es donde se ve el árbol. Antes
               se resolvía aquí y solo miraba dos niveles —el nodo y la raíz—, así que un
               subárbol marcado en medio no gobernaba a sus hijos. */
            aplicaCuando: ruta.cuentaCuando ?? ruta.aplicaCuando,
            aplicaSolo: ruta.aplicaCuando,
            ausencia:
                typeof ruta.nodo['x-absence'] === 'string'
                    ? (ruta.nodo['x-absence'] as Ausencia)
                    : undefined,
            heredables: antepasadosQueDeclaran(ruta.ruta)
        }));
}

const CONTABLES = new Map<string, RutaContable[]>();
function contablesDe(tipo: string): RutaContable[] {
    let rutas = CONTABLES.get(tipo);
    if (rutas === undefined) {
        rutas = rutasContables(tipo);
        CONTABLES.set(tipo, rutas);
    }
    return rutas;
}

/** Busca una ruta con puntos dentro de un documento. */
function valorEn(documento: Record<string, unknown> | undefined, ruta: string): unknown {
    let actual: unknown = documento;
    for (const tramo of ruta.split('.')) {
        if (actual === null || typeof actual !== 'object') return undefined;
        actual = (actual as Record<string, unknown>)[tramo];
    }
    return actual;
}

/**
 * Qué significa que esta ruta falte.
 *
 * El orden es: lo dice el antepasado más cercano que lo declare **y esté él mismo ausente**; si
 * no hay ninguno, lo que declare la propia ruta; y si nadie lo dice, `NOT_PROVIDED`, que es lo
 * neutro.
 *
 * Que el antepasado tenga que estar ausente es la parte que parece de más y no lo es: un padre
 * presente al que solo le falta un hijo no explica nada de ese hijo.
 *
 * Y que el antepasado ausente gane a lo propio es lo que arregla el caso grande, no un detalle.
 * Las ventanas de las métricas relativas -`beta.1y` y sus 23 hermanas- resuelven su nodo con un
 * `$ref` a `cifra_ratio`, que declara `NOT_PROVIDED` porque es el tipo que comparten TODAS las
 * cifras del contrato. Eso no es una afirmación sobre la beta de un fondo sin índice: la
 * afirmación está en `relative`, que dice `NOT_APPLICABLE`. Con lo propio ganando, el valor por
 * defecto de un tipo compartido pisaba lo que el contrato dice del subárbol, y la ficha
 * contestaba «falta» donde la verdad es «no aplica».
 */
function motivoDeLaAusencia(
    documento: Record<string, unknown> | undefined,
    contable: RutaContable
): Ausencia {
    for (const antepasado of contable.heredables) {
        if (valorEn(documento, antepasado.ruta) === undefined) return antepasado.motivo;
    }
    return contable.ausencia ?? 'NOT_PROVIDED';
}

/** Un aviso que la ficha debe mostrar. */
export interface AvisoDeCalidad {
    code: string;
    severity: 'INFO' | 'WARN' | 'ERROR';
    message: string;
}

/**
 * Los avisos que de verdad cambian cómo se lee una cifra. No son todos los que se podrían
 * dar: son los cuatro que los hallazgos de estos días dejaron medidos, y cada uno dice qué
 * cálculo queda tocado.
 */
export function avisosDe(instrumento: InstrumentoLeido): AvisoDeCalidad[] {
    const avisos: AvisoDeCalidad[] = [];
    const exposicion = instrumento.bloques['declared/exposure'];
    const costes = instrumento.bloques['declared/costs'];
    const indice = valorEn(instrumento.raiz, 'classification.official_benchmark');

    /*
     * Una ACCIÓN tiene sus propios avisos, y los cuatro de un fondo no le aplican: ninguno
     * describe una laguna suya. Dejarlos saltar habría puesto en la ficha de las 73 un
     * «falta el coste corriente» con severidad ERROR por un coste que no existe, que es
     * convertir una propiedad del producto en un defecto de nuestros datos.
     *
     * Los de aquí son los tres que de verdad cambian cómo se lee una cifra de una acción.
     */
    if (instrumento.raiz['instrument_type'] === 'STOCK') {
        avisos.push({
            code: 'SIN_INDICADOR_REGULATORIO',
            severity: 'INFO',
            message:
                'Una acción no tiene indicador de riesgo de 1 a 7, porque no hay KID de PRIIPs detrás. No es un dato que falte: el indicador no existe para este producto. Lo que sí hay es nuestra volatilidad, con su método y su ventana al lado.'
        });
        const metodo = valorEn(instrumento.calculadas, 'method');
        /* El muestreo diario, en la versión que sea: el aviso es de la frecuencia, no de la versión. */
        if (typeof metodo === 'string' && metodo.startsWith('EXTRACTOR_DAILY_')) {
            avisos.push({
                code: 'METRICAS_DE_MUESTREO_DIARIO',
                severity: 'INFO',
                message:
                    'Nuestras métricas de esta acción se calculan con rentabilidades DIARIAS y ventanas contadas desde el último día de la serie; las de un fondo, con rentabilidades mensuales y meses cerrados. Son dos métodos y no dos juegos de datos, así que una tabla que ordene las dos cosas por volatilidad está mezclando dos escalas.'
            });
        }
        /*
         * Por la divisa del CÁLCULO y no por la de cotización (P1-05, 21-11-2026): desde la
         * versión 2 la serie de una acción se lleva a euros antes de calcular, y una acción en
         * dólares con sus métricas en euros tiene el Sharpe que le corresponde. Mirar la
         * cotización avisaba en falso en las 259 que no cotizan en euros y lo tienen.
         */
        const divisaDelCalculo = valorEn(instrumento.calculadas, 'inputs.currency');
        if (
            instrumento.calculadas !== undefined &&
            divisaDelCalculo !== 'EUR' &&
            valorEn(instrumento.calculadas, 'sharpe') === undefined
        ) {
            avisos.push({
                code: 'SIN_SHARPE_POR_DIVISA',
                severity: 'WARN',
                message: `Las métricas de esta acción están calculadas en ${String(divisaDelCalculo)} y el único tipo libre de riesgo que tenemos es el EUR del BCE, así que su Sharpe mezclaría una rentabilidad en una divisa con un tipo en otra y no se publica. No es que se oculte: es un ingrediente que falta, y tampoco hay cifra de proveedor a la que caer.`
            });
        }
        return avisos;
    }

    /* Por el campo y no por el documento: desde la decision 109 puede haber documento sin reparto. */
    if (exposicion?.['asset_mix'] === undefined && !esMateriaPrimaSinReparto(instrumento)) {
        avisos.push({
            code: 'SIN_REPARTO_DE_ACTIVOS',
            severity: 'WARN',
            message:
                'No hay reparto por clase de activo del que responder: lo que declara la fuente no suma 1. Cualquier radiografía de cartera que incluya este instrumento queda incompleta, y no se rellena con ceros.'
        });
    }
    /* Decisión 56: si el emisor la declara, ya se sabe, y este aviso diría lo contrario. */
    if (politicaDeReparto(instrumento.bloques).politica === 'UNKNOWN') {
        avisos.push({
            code: 'POLITICA_DE_DISTRIBUCION_DESCONOCIDA',
            severity: 'WARN',
            message:
                'No se sabe si la clase reparte o acumula, así que su rentabilidad no es comparable con la de otra clase sin más. El sesgo medido entre gemelas llega al 6,82 % anual.'
        });
    }
    if (costes?.['ongoing_charge'] === undefined) {
        avisos.push({
            code: 'SIN_COSTE_CORRIENTE',
            severity: 'ERROR',
            message:
                'Falta el coste corriente, que es uno de los tres campos irreducibles: sin él no hay comparación neta honesta.'
        });
    }
    if (indice !== undefined && typeof indice === 'object') {
        const conDivisa = (indice as Record<string, unknown>)['currency'];
        const conVariante = (indice as Record<string, unknown>)['variant'];
        if (conDivisa === undefined || conVariante === undefined) {
            avisos.push({
                code: 'INDICE_SIN_DIVISA_NI_VARIANTE',
                severity: 'WARN',
                message:
                    'Hay nombre de índice pero no su divisa ni su variante, así que se puede nombrar la referencia pero NO calcular un alpha contra ella: mezclaría el movimiento del mercado con el del tipo de cambio.'
            });
        }
    }
    return avisos;
}

export interface ResultadoDeCalidad {
    documento: Record<string, unknown>;
    aplicables: number;
    presentes: number;
    cobertura: number;
    /** Rutas que no se han podido decidir porque faltaba el dato del que depende el predicado. */
    indecidibles: number;
    /**
     * Las rutas que forman el denominador de la cobertura, escritas como `absences.path`, en el orden en que se
     * recorrieron. `aplicables` es su longitud y `huella` su huella: las tres salen de esta lista y no pueden separarse.
     */
    rutasAplicables: readonly string[];
    /** `applicable_paths_fingerprint`: la identidad del conjunto sobre el que está calculada la cobertura (decisión 16). */
    huella: string;
}

/**
 * La huella de un conjunto de rutas contables (decisión 16 de la base nueva): SHA-256, en hexadecimal en minúsculas, de
 * las rutas ordenadas por código de carácter y unidas por un salto de línea, sin salto final.
 *
 * Ordena ella, para que el orden en que se recorrió el contrato no entre en la huella: lo que identifica es el conjunto,
 * no el recorrido. El orden es el de `sort()` sin comparador —por unidad de código, no por idioma—, que es el mismo en
 * cualquier máquina y el que da `sorted()` en Python sobre rutas ASCII, así que la huella se puede rehacer fuera de aquí.
 * Una ruta repetida sería un defecto del recorrido y no se esconde quitándola: cambia la huella, como cambia el recuento.
 */
export function huellaDeLasRutas(rutas: readonly string[]): string {
    return createHash('sha256').update([...rutas].sort().join('\n'), 'utf8').digest('hex');
}

/** Un campo que está en la base donde el contrato dice que no aplica a ese instrumento (decisión C-17). */
export interface CampoDondeNoAplica {
    /** El sufijo del bloque: `computed/metrics`, `declared/costs`... o `` para la raíz. */
    bloque: string;
    ruta: string;
    /** El predicado `x-applies-when` que resultó falso. */
    predicado: string;
}

/**
 * Los campos que tienen valor y cuyo `x-applies-when` es FALSO para este instrumento: la lectura de la decisión C-17 en
 * el sentido que faltaba. Un predicado que no se puede evaluar (`undefined`) no entra aquí: eso ya se cuenta aparte como
 * indecidible. Se evalúa contra el contrato de hoy y no contra la historia.
 */
export function camposPresentesDondeNoAplica(instrumento: InstrumentoLeido): CampoDondeNoAplica[] {
    const rasgos: RasgosDelInstrumento = rasgosDeLoEscrito(instrumento.raiz, instrumento.bloques['declared/exposure']);
    const salida: CampoDondeNoAplica[] = [];
    const revisar = (tipo: string, documento: Record<string, unknown> | undefined, bloque: string): void => {
        if (documento === undefined) return;
        for (const contable of contablesDe(tipo)) {
            if (contable.aplicaSolo === undefined) continue;
            if (aplicaAlInstrumento(contable.aplicaSolo, rasgos) !== false) continue;
            if (valorEn(documento, contable.ruta) === undefined) continue;
            salida.push({ bloque, ruta: contable.ruta, predicado: contable.aplicaSolo });
        }
    };
    revisar('instrument.v2.schema.json', instrumento.raiz, '');
    for (const [sufijo, tipo] of Object.entries(BLOQUES_DE_INSTRUMENTO)) {
        revisar(tipo, documentoDe(instrumento, sufijo), sufijo);
    }
    return salida;
}

/** Calcula `quality/latest` de un instrumento. */
export function calcularCalidad(instrumento: InstrumentoLeido, ahora: string): ResultadoDeCalidad {
    const rasgos: RasgosDelInstrumento = rasgosDeLoEscrito(instrumento.raiz, instrumento.bloques['declared/exposure']);

    const ausencias: { path: string; reason: Ausencia }[] = [];
    /* El denominador, ruta a ruta. Es la única fuente: el recuento es su longitud y la huella, su huella (decisión 16),
       así que no puede publicarse un recuento de una lista y una huella de otra. */
    const rutasAplicables: string[] = [];
    let presentes = 0;
    let indecidibles = 0;

    const revisar = (tipo: string, documento: Record<string, unknown> | undefined, prefijo: string): void => {
        for (const contable of contablesDe(tipo)) {
            const veredicto = aplicaAlInstrumento(contable.aplicaCuando, rasgos);
            if (veredicto === undefined) {
                indecidibles += 1;
                continue;
            }
            if (!veredicto) continue;
            rutasAplicables.push(`${prefijo}${contable.ruta}`);
            const valor = valorEn(documento, contable.ruta);
            if (valor === undefined) {
                ausencias.push({
                    path: `${prefijo}${contable.ruta}`,
                    reason: motivoDeLaAusencia(documento, contable)
                });
            } else {
                presentes += 1;
            }
        }
    };

    revisar('instrument.v2.schema.json', instrumento.raiz, '');
    for (const [sufijo, tipo] of Object.entries(BLOQUES_DE_INSTRUMENTO)) {
        revisar(tipo, documentoDe(instrumento, sufijo), `${sufijo}.`);
    }

    const aplicables = rutasAplicables.length;
    const huella = huellaDeLasRutas(rutasAplicables);
    const cobertura = aplicables === 0 ? 0 : presentes / aplicables;
    const avisos = avisosDe(instrumento);

    /* El contrato topa `absences` en 500. Si hubiera mas, se cortan y el aviso lo dice: un
       documento que crece sin limite es el techo de siempre, y aqui no se repite. */
    const TOPE = 500;
    const recortadas = ausencias.slice(0, TOPE);
    if (ausencias.length > TOPE) {
        avisos.push({
            code: 'AUSENCIAS_RECORTADAS',
            severity: 'INFO',
            message: `Hay ${ausencias.length} ausencias y el contrato guarda ${TOPE}.`
        });
    }

    const documento: Record<string, unknown> = {
        computed_at: ahora,
        /* Para qué sirve, uso por uso. Es lo que sustituye al semáforo de cuatro estados: la
           cobertura mide bien, pero no discrimina —761 de 769 caían en el mismo cajón— y la
           pregunta que alguien hace es «para qué sirve», que es un sí o un no por uso. */
        fitness: aptitudesDe({
            raiz: instrumento.raiz,
            bloques: instrumento.bloques,
            calculadas: instrumento.calculadas
        }),
        coverage: Number(cobertura.toFixed(6)),
        applicable_paths: aplicables,
        /* Con qué conjunto está calculada la cobertura (decisión 16): dos coberturas solo se comparan si coincide. */
        applicable_paths_fingerprint: huella,
        present_paths: presentes,
        absences: recortadas
    };
    if (avisos.length > 0) documento['warnings'] = avisos;

    return { documento, aplicables, presentes, cobertura, indecidibles, rutasAplicables, huella };
}

/** Quita las claves vacías, en profundidad; `undefined` si no queda nada. */
function limpiar(entrada: Record<string, unknown>): Record<string, unknown> | undefined {
    const salida: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(entrada)) {
        if (valor === undefined || valor === null) continue;
        if (Array.isArray(valor)) {
            if (valor.length > 0) salida[clave] = valor;
            continue;
        }
        if (typeof valor === 'object') {
            const dentro = limpiar(valor as Record<string, unknown>);
            if (dentro !== undefined) salida[clave] = dentro;
            continue;
        }
        salida[clave] = valor;
    }
    return Object.keys(salida).length === 0 ? undefined : salida;
}

/** Se queda con el sujeto `fund` de una cifra absoluta por ventanas. */
function soloDelFondo(porVentana: unknown): Record<string, number> | undefined {
    if (porVentana === null || typeof porVentana !== 'object') return undefined;
    const salida: Record<string, number> = {};
    for (const [ventana, porSujeto] of Object.entries(porVentana as Record<string, unknown>)) {
        const valor = (porSujeto as Record<string, unknown> | undefined)?.['fund'];
        if (typeof valor === 'number') salida[ventana] = valor;
    }
    return Object.keys(salida).length === 0 ? undefined : salida;
}

/** Se queda con `vs_benchmark` de una cifra relativa por ventanas. */
function soloContraElIndice(porVentana: unknown): Record<string, number> | undefined {
    if (porVentana === null || typeof porVentana !== 'object') return undefined;
    const salida: Record<string, number> = {};
    for (const [ventana, porSujeto] of Object.entries(porVentana as Record<string, unknown>)) {
        const valor = (porSujeto as Record<string, unknown> | undefined)?.['vs_benchmark'];
        if (typeof valor === 'number') salida[ventana] = valor;
    }
    return Object.keys(salida).length === 0 ? undefined : salida;
}

/** Una cifra por ventanas de `computed/metrics`, que ya viaja sin sujeto. */
function porVentanas(porVentana: unknown): Record<string, number> | undefined {
    if (porVentana === null || typeof porVentana !== 'object') return undefined;
    const salida: Record<string, number> = {};
    for (const [ventana, cifra] of Object.entries(porVentana as Record<string, unknown>)) {
        if (typeof cifra === 'number') salida[ventana] = cifra;
    }
    return Object.keys(salida).length === 0 ? undefined : salida;
}

const obj = (valor: unknown): Record<string, unknown> =>
    valor !== null && typeof valor === 'object' ? (valor as Record<string, unknown>) : {};
const txt = (valor: unknown): string | undefined => (typeof valor === 'string' ? valor : undefined);
const nmr = (valor: unknown): number | undefined => (typeof valor === 'number' ? valor : undefined);

/**
 * Los umbrales con los que el control del proveedor se considera DISCREPANTE, **por ventana**.
 *
 * El umbral es por ventana porque la concordancia lo es. Medido el 01-11-2026 sobre los pares
 * que existen de verdad, la diferencia relativa de la volatilidad va del 0,32 % de mediana a
 * un percentil 99 del **20,1 %** a un año, y del 0,26 % a un p99 del **7,4 %** a tres; la del
 * Sharpe, de 0,183 de mediana y p99 de **1,37** a un año, a 0,067 y **0,71** a tres.
 *
 * La razón es el desfase: la cifra del proveedor es más vieja que el fin de nuestra serie en
 * 468 de 468 fondos, con una mediana de 27 días, y 27 días desplazan una ventana de 12 meses
 * un mes entero. A tres o cinco años ese mes es un treintavo de la ventana.
 *
 * Un umbral único era mi primera versión y marcaba **159 de 642**, una cuarta parte del libro:
 * eso no es una lista que una persona mire, es ruido. Con el umbral por ventana, puesto en el
 * percentil 98-99 de cada una, y con el suelo absoluto de abajo, se marcan **31 de 642**.
 *
 * Y lo que la marca significa, dicho sin adornos: este fondo discrepa más que el 99 % del
 * libro. No es una cota de error —no tenemos con qué calcularla—, es un detector de extremos,
 * que es exactamente lo que pide «que lo mire una persona antes de que llegue a un cliente».
 *
 * El Sharpe se compara en ABSOLUTO porque es un ratio: una diferencia relativa cerca de cero
 * no significa nada. La volatilidad, en relativo, porque su escala cambia con el fondo.
 */
const UMBRALES_DEL_CONTROL: Record<string, Record<string, number>> = {
    volatility: { '1y': 0.2, '3y': 0.075, '5y': 0.075, '10y': 0.075 },
    sharpe: { '1y': 1.25, '3y': 0.75, '5y': 0.75, '10y': 0.75 }
};

/** Cómo se mide la diferencia de cada magnitud. */
const CLASE_DEL_CONTROL: Record<string, 'relativa' | 'absoluta'> = {
    volatility: 'relativa',
    sharpe: 'absoluta'
};

/**
 * El suelo de una comparación relativa: por debajo de esta diferencia ABSOLUTA no se marca
 * aunque la relativa se dispare.
 *
 * Sin él, la primera lista de 33 traía cuatro fondos monetarios marcados por diferencias de
 * volatilidad de 0,02 puntos —0,04 % contra 0,06 % a un año— que en relativo son el 22 % y en
 * la ficha de un cliente no son nada. Medio punto de volatilidad es el mínimo que cambia una
 * lectura.
 */
const SUELO_RELATIVO: Record<string, number> = { volatility: 0.005 };

/**
 * Las ventanas donde la cifra del proveedor discrepa de la nuestra más de lo que explica su
 * desfase. Solo compara donde EXISTEN las dos: una ausencia no es una discrepancia.
 */
/**
 * Si nuestra cifra y la del proveedor miden lo mismo. Si no, la diferencia no dice nada.
 *
 * Revisados los 61 marcados el 04-11-2026, 21 lo estaban porque el proveedor mide la clase en
 * dólares y nosotros en euros, y al calcular sin convertir salía su cifra casi exacta. Otros
 * cerraban un mes antes. Una marca que ya tiene explicación solo tapa las que no la tienen. Se
 * compara el mes y no el día: un cierre puede ser el último día hábil o el último del mes.
 */
export function medimosLoMismo(
    divisaDeOrigen: string | undefined,
    cierreNuestro: string | undefined,
    cierreSuyo: string | undefined
): boolean {
    if (divisaDeOrigen !== undefined && divisaDeOrigen !== 'EUR') return false;
    if (cierreNuestro === undefined || cierreSuyo === undefined) return true;
    return cierreNuestro.slice(0, 7) === cierreSuyo.slice(0, 7);
}

function discrepanciasDelControl(
    nuestras: Record<string, Record<string, number> | number | undefined>,
    suyas: Record<string, Record<string, number> | number | undefined>
): string[] {
    const salida: string[] = [];
    for (const [magnitud, porVentana] of Object.entries(UMBRALES_DEL_CONTROL)) {
        const nuestra = nuestras[magnitud];
        const suya = suyas[magnitud];
        if (nuestra === undefined || typeof nuestra === 'number') continue;
        if (suya === undefined || typeof suya === 'number') continue;
        for (const [ventana, mia] of Object.entries(nuestra)) {
            const suyo = suya[ventana];
            const umbral = porVentana[ventana];
            if (suyo === undefined || umbral === undefined) continue;
            const absoluta = Math.abs(mia - suyo);
            if (absoluta < (SUELO_RELATIVO[magnitud] ?? 0)) continue;
            const diferencia =
                CLASE_DEL_CONTROL[magnitud] === 'absoluta'
                    ? absoluta
                    : suyo === 0
                      ? Infinity
                      : absoluta / Math.abs(suyo);
            if (diferencia > umbral) salida.push(`${magnitud}.${ventana}`);
        }
    }
    return salida.sort();
}

/** La misma fecha, tantos años antes: el 31-10-2026 a 10 años es el 31-10-2016. Un 29 de febrero cae en el 28. Como `map_quant_metrics`. */
function aniosAntes(dia: string, anios: number): string {
    const anio = Number(dia.slice(0, 4)) - anios;
    const resto = dia.slice(4, 10);
    const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
    return `${anio}${resto === '-02-29' && !bisiesto ? '-02-28' : resto}`;
}

const ANIOS_DE_LA_VENTANA: Readonly<Record<string, number>> = { '1y': 1, '3y': 3, '5y': 5, '10y': 10 };

/**
 * Si el periodo de una ventana toca lo que la serie no tiene revisado (decisiones 73 y 112): empieza el día de cierre menos N años, y la
 * cifra sale si eso cae en o después de `desde`. Sin cierre no se sabe dónde empieza, y no sale.
 */
export function ventanaTocaLoSinRevisar(ventana: string, cierre: string | undefined, desde: string): boolean {
    if (cierre === undefined) return true;
    if (ventana === 'ytd') return `${Number(cierre.slice(0, 4)) - 1}-12-31` < desde;
    const anios = ANIOS_DE_LA_VENTANA[ventana];
    return anios === undefined || aniosAntes(cierre, anios) < desde;
}

/** El cierre puede ser uno para todas las ventanas o uno por ventana (decisión B-74). */
type Cierre = string | undefined | ((ventana: string) => string | undefined);

function sinLoQueToca<T>(porVentana: Record<string, T> | undefined, cierre: Cierre, desde: string | undefined): Record<string, T> | undefined {
    if (porVentana === undefined || desde === undefined) return porVentana;
    const cierreDe = (ventana: string): string | undefined => (typeof cierre === 'function' ? cierre(ventana) : cierre);
    const salida = Object.fromEntries(Object.entries(porVentana).filter(([ventana]) => !ventanaTocaLoSinRevisar(ventana, cierreDe(ventana), desde)));
    return Object.keys(salida).length === 0 ? undefined : salida;
}

/**
 * Las rutas de lo que `computed/metrics` apartó por rango (decisión B-73), en la forma
 * `annualized_return.1y`: cada hoja de `out_of_range` es un `{value, limit}`. La tarjeta no
 * lleva la cifra, solo dónde falta y por qué.
 */
function rutasApartadas(fuera: unknown, prefijo = ''): string[] {
    if (fuera === null || typeof fuera !== 'object') return [];
    const salida: string[] = [];
    for (const [clave, valor] of Object.entries(fuera as Record<string, unknown>)) {
        const ruta = `${prefijo}${clave}`;
        if (valor !== null && typeof valor === 'object' && 'value' in valor) salida.push(ruta);
        else salida.push(...rutasApartadas(valor, `${ruta}.`));
    }
    return salida;
}

/**
 * Las fechas de las rentabilidades del proveedor que la tarjeta ENSEÑA en `metrics.provider`
 * (decisión B-74). Si son una sola, `returns_as_of` como hasta hoy: solo cuando no es la de su
 * riesgo. Si difieren, `returns_as_of` es la más reciente y `returns_as_of_by_window` da la de
 * cada ventana enseñada, igual que `as_of` y `as_of_by_window` en `declared/provider_returns`.
 */
function fechasDeLasQueEnsena(
    ensenadas: Record<string, number> | undefined,
    fechaDe: (ventana: string) => string | undefined,
    fechaDeSuRiesgo: string | undefined
): Record<string, unknown> {
    if (ensenadas === undefined) return {};
    const porVentana = Object.fromEntries(Object.keys(ensenadas).map((ventana) => [ventana, fechaDe(ventana)]));
    const fechas = Object.values(porVentana);
    if (fechas.length === 0 || fechas.some((fecha) => fecha === undefined)) return {};
    const distintas = new Set(fechas);
    if (distintas.size > 1) {
        return {
            returns_as_of: (fechas as string[]).reduce((a, b) => (b > a ? b : a)),
            returns_as_of_by_window: porVentana
        };
    }
    const unica = fechas[0];
    return unica !== fechaDeSuRiesgo ? { returns_as_of: unica } : {};
}

/** Las ventanas de `suya` que no están en `nuestra`: lo que nunca lleva `metrics.provider` es una cifra que el titular ya trae (decisión 110). */
function lasQueNoTenemos(suya: Record<string, number> | undefined, nuestra: Record<string, number> | undefined): Record<string, number> | undefined {
    if (suya === undefined) return undefined;
    const salida = Object.fromEntries(Object.entries(suya).filter(([ventana]) => nuestra?.[ventana] === undefined));
    return Object.keys(salida).length === 0 ? undefined : salida;
}

/**
 * Compone `read/card`.
 *
 * Las métricas del titular son **nuestras** donde existe `computed/metrics`, y las del
 * proveedor donde no; `source` y `as_of` lo dicen siempre. Es la decisión 8 del 01-11-2026
 * —nos fiamos de la serie, no de la cifra, porque la serie se puede auditar— y sus cuatro
 * pasos están aquí:
 *
 * 1. **El titular lleva nuestra cifra.** Una ficha con el valor liquidativo del 29-10 y una
 *    volatilidad del 30-09 se contradice consigo misma, y la del proveedor es más vieja que
 *    el fin de nuestra serie en 468 de 468 fondos, con una mediana de 27 días.
 * 2. **La del proveedor no es una alternativa en el titular.** Por magnitud y ventana manda una sola
 *    fuente: si la nuestra trae la volatilidad a 3 años, la suya a 3 años no entra. Se
 *    queda en `declared/provider_risk` de control. Dos cifras de la misma magnitud al lado
 *    no son información, son duda presentada como dato.
 * 3. **Una marca cuando el control discrepa**, en `control`, para que esos pocos fondos los
 *    mire una persona antes de que lleguen a un cliente.
 * 4. **Lo que no calculamos va como suyo, con su nombre y su fecha**: en `provider` las
 *    ventanas que el titular no trae (decisión 110 de Óscar, 05-11-2026) y en
 *    `relative` las cifras contra el índice cuando no tenemos proxy aprobado.
 * 5. **Lo que toca la historia sin revisar no viaja, sea de quien sea** (decisión 112): ver
 *    `series_valid_from` en el contrato, con la medida que lo decide.
 *
 * Lo que decide si una cifra es nuestra NO es una preferencia: es que el documento exista.
 * El extractor no escribe `computed/metrics` si la serie está parada, si la clase reparte sin
 * historial de repartos o si la política no tiene evidencia, así que su presencia ya es la
 * auditoría de la serie que pedía la condición de la decisión.
 */
export function componerTarjeta(
    instrumento: InstrumentoLeido,
    calidad: ResultadoDeCalidad,
    ahora: string
): Record<string, unknown> | undefined {
    const raiz = instrumento.raiz;
    const esAccion = raiz['instrument_type'] === 'STOCK';
    const accion = instrumento.bloques['declared/equity'];
    const dividendos = instrumento.bloques['declared/dividends'];
    const cotizacion = instrumento.bloques['declared/quote'];
    const perfil = instrumento.bloques['declared/profile'];
    const politica = politicaDeReparto(instrumento.bloques);
    const costes = instrumento.bloques['declared/costs'];
    const riesgo = instrumento.bloques['declared/provider_risk'];
    const retornos = instrumento.bloques['declared/provider_returns'];
    const exposicion = instrumento.bloques['declared/exposure'];
    const rentaFija = instrumento.bloques['declared/fixed_income'];
    const cartera = instrumento.bloques['declared/holdings'];
    const regulatorio = instrumento.bloques['declared/regulatory'];
    /* Los dos que entraron el 02-11-2026, trabajando el rediseno del frontend: son los dos
       unicos de las secciones sin proyectar que una LISTA necesita, no una ficha. Ver la
       nota de `size` mas abajo. */
    const patrimonio = instrumento.bloques['declared/size'];
    const sostenibilidad = instrumento.bloques['declared/sustainability'];
    const calidadDoc = calidad.documento;

    const identidad = raiz['identity'] as Record<string, unknown> | undefined;
    const clasificacion = raiz['classification'] as Record<string, unknown> | undefined;
    const indice = clasificacion?.['official_benchmark'] as Record<string, unknown> | undefined;
    const disponibilidad = raiz['availability'] as Record<string, unknown> | undefined;

    /* El indicador de riesgo con su origen declarado al lado: con evidencia del KID es
       SRI_KID; si no, el SRRI; y si tampoco, no se pone nada. Nunca un numero sin fuente. */
    let riesgoIndicador: number | undefined;
    let origenDelIndicador: string | undefined;
    if (typeof regulatorio?.['sri'] === 'number') {
        riesgoIndicador = regulatorio['sri'] as number;
        origenDelIndicador = 'SRI_KID';
    } else if (typeof regulatorio?.['srri'] === 'number') {
        riesgoIndicador = regulatorio['srri'] as number;
        origenDelIndicador = 'SRRI';
    }

    const avisos = calidadDoc['warnings'] as AvisoDeCalidad[] | undefined;

    /* Las del PROVEEDOR, que es lo que la tarjeta llevaba siempre: una columna de sujetos
       reducida al fondo, y el alpha y la beta reducidos a «contra su índice». */
    const suyas = {
        volatility: soloDelFondo(riesgo?.['volatility']),
        annualized_return: soloDelFondo(retornos?.['trailing_return']),
        max_drawdown: soloDelFondo(riesgo?.['max_drawdown']),
        sharpe: soloDelFondo(riesgo?.['sharpe']),
        ytd_return: nmr((retornos?.['ytd_return'] as Record<string, unknown> | undefined)?.['fund'])
    };
    const fechaSuya = txt(riesgo?.['as_of']) ?? txt(retornos?.['as_of']);
    /* Son dos bloques suyos con dos fechas: en 445 fondos, la rentabilidad del 30-09 y el riesgo del 31-10. */
    const fechaDeSuRentabilidad = txt(retornos?.['as_of']) ?? fechaSuya;
    /* Y desde la decisión B-74, una fecha por ventana cuando el bloque las trae distintas: el 1 año de
       Morningstar es de fin de mes y el 3, 5 y 10 de fin de trimestre. Sin el mapa, la del bloque. */
    const fechasDeSuRentabilidad = obj(retornos?.['as_of_by_window']);
    const fechaDeSuVentana = (ventana: string): string | undefined =>
        txt(fechasDeSuRentabilidad[ventana]) ?? fechaDeSuRentabilidad;

    /* Y las NUESTRAS, si el extractor las calculó. `inputs.last_date` es la fecha a la que se
       refieren: el fin de la serie con la que se calcularon, no cuándo se compuso la tarjeta. */
    const calculadas = instrumento.calculadas;
    const entradas = obj(calculadas?.['inputs']);
    /* El cierre al que miden las cifras. `last_date` es donde acaba la serie, y decia 2 de
       noviembre en cifras cerradas a 31 de octubre: queda solo para los documentos sin cierre. */
    const fechaDelTitular =
        calculadas === undefined ? fechaSuya : txt(calculadas['as_of']) ?? txt(entradas['last_date']);

    /* Lo que toca la historia sin revisar se queda fuera de la tarjeta, de las dos fuentes (decisión 112). `computed/metrics` y los
       bloques del proveedor lo siguen teniendo: son la fuente, y esto es lo que se enseña. */
    const desde = instrumento.serieValidaDesde;
    const nuestras =
        calculadas === undefined
            ? undefined
            : {
                  volatility: sinLoQueToca(porVentanas(calculadas['volatility']), fechaDelTitular, desde),
                  annualized_return: sinLoQueToca(porVentanas(calculadas['annualized_return']), fechaDelTitular, desde),
                  max_drawdown: sinLoQueToca(porVentanas(calculadas['max_drawdown']), fechaDelTitular, desde),
                  sharpe: sinLoQueToca(porVentanas(calculadas['sharpe']), fechaDelTitular, desde),
                  sortino: sinLoQueToca(porVentanas(calculadas['sortino']), fechaDelTitular, desde),
                  ytd_return:
                      desde !== undefined && ventanaTocaLoSinRevisar('ytd', fechaDelTitular, desde) ? undefined : nmr(calculadas['ytd_return'])
              };
    const suyasVigentes = {
        volatility: sinLoQueToca(suyas.volatility, txt(riesgo?.['as_of']), desde),
        annualized_return: sinLoQueToca(suyas.annualized_return, fechaDeSuVentana, desde),
        max_drawdown: sinLoQueToca(suyas.max_drawdown, txt(riesgo?.['as_of']), desde),
        sharpe: sinLoQueToca(suyas.sharpe, txt(riesgo?.['as_of']), desde),
        ytd_return:
            desde !== undefined && suyas.ytd_return !== undefined && ventanaTocaLoSinRevisar('ytd', fechaDeSuVentana('ytd'), desde)
                ? undefined
                : suyas.ytd_return
    };
    const titular = nuestras ?? suyasVigentes;
    /* Lo que se ha quedado fuera por esa fecha, para que quien lea pueda decir por qué falta. */
    const ventanasFuera =
        desde === undefined
            ? []
            : ['ytd', '1y', '3y', '5y', '10y'].filter((ventana) => ventanaTocaLoSinRevisar(ventana, fechaDelTitular, desde));
    /* Las que de verdad tenían alguna cifra: decir «falta» de una ventana a la que la serie no llega sería otro motivo. */
    const hayCifraEn = (ventana: string): boolean =>
        ventana === 'ytd'
            ? nmr(calculadas?.['ytd_return']) !== undefined || suyas.ytd_return !== undefined
            : [
                  calculadas?.['volatility'],
                  calculadas?.['annualized_return'],
                  calculadas?.['max_drawdown'],
                  calculadas?.['sharpe'],
                  calculadas?.['sortino'],
                  suyas.volatility,
                  suyas.annualized_return,
                  suyas.max_drawdown,
                  suyas.sharpe
              ].some((mapa) => obj(mapa)[ventana] !== undefined);
    const ventanasConCifraFuera = ventanasFuera.filter(hayCifraEn);

    /* El paso 4: lo que el titular no trae, ventana a ventana y dicho como del proveedor, con su fecha. Sin su
       fecha no entra, porque una cifra suya sin fecha no se puede comparar con la nuestra. */
    const sobras =
        nuestras === undefined || fechaSuya === undefined
            ? undefined
            : limpiar({
                  volatility: lasQueNoTenemos(suyasVigentes.volatility, nuestras.volatility),
                  annualized_return: lasQueNoTenemos(suyasVigentes.annualized_return, nuestras.annualized_return),
                  max_drawdown: lasQueNoTenemos(suyasVigentes.max_drawdown, nuestras.max_drawdown),
                  sharpe: lasQueNoTenemos(suyasVigentes.sharpe, nuestras.sharpe)
              });
    const delProveedor =
        sobras === undefined
            ? undefined
            : {
                  source: 'PROVIDER',
                  method: 'TRAILING_PROVIDER',
                  as_of: fechaSuya,
                  ...fechasDeLasQueEnsena(sobras['annualized_return'] as Record<string, number> | undefined, fechaDeSuVentana, fechaSuya),
                  ...sobras
              };

    /* El paso 3: la marca cuando el control discrepa. Sin discrepancia no se escribe nada. */
    const discrepa =
        nuestras === undefined ||
        !medimosLoMismo(txt(entradas['source_currency']), txt(calculadas?.['as_of']), fechaSuya)
            ? []
            : discrepanciasDelControl(nuestras, suyas);
    const control =
        discrepa.length === 0 || fechaSuya === undefined
            ? undefined
            : { source: 'PROVIDER', as_of: fechaSuya, mismatch: discrepa };

    /*
     * Contra el índice, y CONTRA QUÉ se midió, que no es lo mismo que quién lo calculó.
     *
     * La nuestra trae la identidad entera del índice y el ISIN del fondo índice que hizo de
     * serie. La del proveedor **no se puede etiquetar con el benchmark del folleto**, y eso se
     * midió el 01-11-2026: 24 fondos que declaran «MSCI ACWI NR USD», con la misma fecha de
     * dato y la misma divisa, traen DIEZ volatilidades distintas del «índice», del 9,61 % al
     * 22,42 %. Descartadas fecha y divisa, la cifra agrupa por CATEGORÍA Morningstar, y 78 de
     * 105 categorías traen una sola. Controlando las dos, 218 de 476 fondos comparables
     * discrepan de la cifra mayoritaria de su propio benchmark.
     *
     * Así que la cifra del proveedor va nombrando lo que sigue —su categoría— y no lo que el
     * folleto declara. Sin categoría no hay con qué nombrarla y el bloque entero no se escribe:
     * un alpha sin decir contra qué se midió es lo que un asesor no puede defender.
     *
     * El r2 viaja siempre con el alpha, así que un alpha sin r2 no se escribe: sin él nadie
     * puede juzgarlo.
     */
    const relativasPropias = obj(calculadas?.['relative']);
    const categoriaSuya = txt(clasificacion?.['category']);
    const alphaSuyo = soloContraElIndice(riesgo?.['provider_alpha']);
    const r2Suyo = soloContraElIndice(riesgo?.['r2']);
    /*
     * Decisión 20 del 07-11-2026: su KID declara un índice compuesto o ninguno, y retiramos las
     * nuestras. Tampoco sale la del proveedor: la mide contra el índice de su categoría, y en BNP Clean
     * Energy esa categoría tiene la volatilidad de un índice mundial amplio (13,9 % a un año frente al
     * 38 % del fondo), así que sería publicar por otra puerta el mismo alfa que se retira.
     * Decisión 30: con una clase cubierta pasa lo mismo, porque el índice de la categoría del
     * proveedor tampoco está cubierto y su alfa mediría la cobertura que la nuestra no quiere medir.
     * `SAME_FUND_REFERENCE` (C-28) NO está aquí, a propósito: lo que falla es nuestra serie del índice
     * —otra clase del mismo fondo—, no lo que mide el proveedor, así que cae a su cifra como un fondo sin proxy.
     */
    const ausenciaRelativa = txt(calculadas?.['relative_absence']);
    const sinRelativasPorElKid =
        ausenciaRelativa?.startsWith('KID_DECLARES_') === true || ausenciaRelativa === 'HEDGED_SHARE_CLASS';
    const relativa = sinRelativasPorElKid
        ? undefined
        : obj(relativasPropias['benchmark'])['name'] !== undefined
            ? limpiar({
                  source: 'COMPUTED',
                  reference: txt(relativasPropias['reference']) ?? 'DECLARED_BENCHMARK_PROXY',
                  /* H2-06 (22-11-2026): las cifras relativas son al cierre de mes, como todas las de `computed/metrics`.
                     `inputs.last_date` es donde acaba la serie de precios (2 de noviembre en cifras de 31 de octubre) y
                     chocaba con MET-7: 741 tarjetas fechaban la relativa con el último precio. Sale el mismo cierre
                     que el titular. */
                  as_of: fechaDelTitular,
                  benchmark: relativasPropias['benchmark'],
                  beta: relativasPropias['beta'],
                  r2: relativasPropias['r2'],
                  jensen_alpha:
                      relativasPropias['r2'] === undefined ? undefined : relativasPropias['jensen_alpha'],
                  active_return: relativasPropias['active_return'],
                  tracking_error: relativasPropias['tracking_error'],
                  information_ratio: relativasPropias['information_ratio']
              })
            : categoriaSuya === undefined ||
                (alphaSuyo === undefined &&
                    r2Suyo === undefined &&
                    soloContraElIndice(riesgo?.['beta']) === undefined)
              ? undefined
              : limpiar({
                    source: 'PROVIDER',
                    reference: 'PROVIDER_CATEGORY_INDEX',
                    category: categoriaSuya,
                    as_of: fechaSuya,
                    beta: soloContraElIndice(riesgo?.['beta']),
                    r2: r2Suyo,
                    jensen_alpha: r2Suyo === undefined ? undefined : alphaSuyo
                });

    const tarjeta = limpiar({
        instrument_id: instrumento.instrument_id,
        computed_at: ahora,
        instrument_type: raiz['instrument_type'],
        identity: {
            name: identidad?.['name'],
            currency: identidad?.['currency'],
            ticker: (raiz['identifiers'] as Record<string, unknown> | undefined)?.['ticker']
        },
        classification: {
            category: clasificacion?.['category'],
            morningstar_rating: clasificacion?.['morningstar_rating'],
            asset_class: clasificacion?.['asset_class'],
            /* Viaja con la clase, no aparte: la pantalla que pinta «Renta variable» tiene que
               poder decir si eso lo afirma el proveedor o lo dedujimos de su reparto. */
            asset_class_resolution: clasificacion?.['asset_class_resolution'],
            benchmark_name: indice?.['name'],
            /* Lo que ocupa, en una ACCIÓN, el sitio de la categoría del proveedor y del
               nombre del índice: con qué se compara y dónde cotiza. Son las tres cosas que
               Óscar decidió que enseña su ficha y que un fondo no tiene. */
            sector: accion?.['sector'],
            industry: accion?.['industry'],
            exchange: valorEn(accion, 'listing.exchange')
        },
        costs: {
            ongoing_charge: costes?.['ongoing_charge'],
            management_fee: costes?.['management_fee'],
            /* Con su fuente: lo que dice «KID» en un informe tiene que venir de aquí, no de suponerlo. */
            transaction_costs: costes?.['transaction_costs'],
            entry_charge: costes?.['entry_charge'],
            document_url: costes?.['document_url'],
            document_date: costes?.['document_date'],
            ongoing_charge_source: costes?.['ongoing_charge_source'],
            transaction_costs_source: costes?.['transaction_costs_source'],
            entry_charge_source: costes?.['entry_charge_source']
        },
        /* El precio y su día, que la base no guardaba de nada hasta el 01-11-2026. Las tres
           claves van juntas o no va ninguna: el contrato las exige las tres. La divisa, si la
           hay, va con ellas: la de un ETF no tiene por qué ser la de su clase. */
        quote:
            cotizacion === undefined
                ? undefined
                : {
                      price: cotizacion['price'],
                      as_of: cotizacion['as_of'],
                      price_class: cotizacion['price_class'],
                      currency: cotizacion['currency']
                  },
        /* Si cotiza y desde cuándo: es lo que deja marcar la fila del buscador sin leer la raíz de
           cada instrumento. Sin fecha no se proyecta, porque la marca se escribe con ella. */
        availability:
            typeof disponibilidad?.['state'] === 'string' && typeof disponibilidad['since'] === 'string'
                ? { state: disponibilidad['state'], since: disponibilidad['since'] }
                : undefined,
        dividends:
            dividendos === undefined
                ? undefined
                : {
                      yield_12m: dividendos['yield_12m'],
                      trailing_amount_per_share: dividendos['trailing_amount_per_share'],
                      forward_amount_per_share: dividendos['forward_amount_per_share'],
                      currency: dividendos['currency'],
                      ex_dividend_date: dividendos['ex_dividend_date']
                  },
        /*
         * Y si no hay NINGUNA cifra, no hay bloque. Pasa en una de las 73 acciones
         * —`ES0105394003`, 48 observaciones desde mayo— y no puede pasar en un fondo, porque
         * siempre queda la del proveedor. Rellenar el método que se aplicaría si hubiera
         * cifras es afirmar algo sobre un conjunto vacío; dejar el bloque fuera es decir la
         * verdad, y el resto de la tarjeta —nombre, sector, precio— sigue sirviendo.
         */
        metrics: esAccion && instrumento.calculadas === undefined ? undefined : {
            /* Quién calculó el titular, con qué método y a qué fecha. Es la diferencia que en
               la maestra no se puede ver: allí dos volatilidades a tres años conviven sin que
               nada diga cuál es cuál. */
            source: nuestras === undefined ? 'PROVIDER' : 'COMPUTED',
            method: nuestras === undefined ? 'TRAILING_PROVIDER' : calculadas?.['method'],
            frequency: nuestras === undefined ? 'PROVIDER' : calculadas?.['frequency'],
            as_of: fechaDelTitular,
            /* Decisión B-74: con el titular del proveedor, `as_of` es la de su riesgo y su rentabilidad lleva la
               suya: por ventana si el bloque trae el mapa, y si no, la del bloque cuando no es la del riesgo. Es la
               misma regla que `provider`: una rentabilidad del 30-09 bajo un `as_of` del 31-10 es lo que la decisión quita. */
            ...(nuestras === undefined
                ? fechasDeLasQueEnsena(
                      {
                          ...(titular.annualized_return ?? {}),
                          ...(titular.ytd_return === undefined ? {} : { ytd: titular.ytd_return })
                      },
                      fechaDeSuVentana,
                      fechaDelTitular
                  )
                : {}),
            series_valid_from: desde,
            windows_before_series_valid_from: ventanasConCifraFuera,
            /* Lo que el titular no trae porque se salía del rango del contrato (decisión B-73). */
            windows_out_of_range:
                nuestras === undefined ? undefined : ((r) => (r.length > 0 ? r : undefined))(rutasApartadas(calculadas?.['out_of_range'])),
            series_class: nuestras === undefined ? undefined : obj(calculadas?.['inputs'])['series_class'],
            return_basis:
                (nuestras === undefined ? undefined : calculadas?.['return_basis']) ??
                riesgo?.['return_basis'] ??
                retornos?.['return_basis'] ??
                'TOTAL_RETURN',
            distribution_policy: politica.politica,
            /* Decisión 56: solo cuando la política la pone el emisor porque el proveedor no la sabe. Si no, no se escribe. */
            distribution_policy_source: politica.delEmisor ? 'ISSUER' : undefined,
            /*
             * Y CON QUÉ se sabe. Oscar decidió el 01-11 publicar las ~450 métricas propias
             * con su grado declarado; el grado estaba en `declared/profile` y no aquí, y la
             * tarjeta es justo el documento que la aplicación lee para no ir bloque a
             * bloque. Sin esto, «un informe puede decir en qué se apoya» era verdad a
             * medias. Y hace falta: en torno al 95 % de las políticas se van a resolver con
             * el grado más débil de los cuatro.
             */
            distribution_policy_resolution: perfil?.['distribution_policy_resolution'],
            volatility: titular.volatility,
            annualized_return: titular.annualized_return,
            max_drawdown: titular.max_drawdown,
            /* El de una acción no se enseña (Óscar, 04-11-2026; §9 del método). Sigue en
               `computed/metrics`, donde su retirada tiene su propio camino. */
            sharpe: esAccion ? undefined : titular.sharpe,
            /* Solo nuestro: el proveedor no lo da. La ficha lo leía del bloque; Comparar, no. */
            sortino: nuestras?.sortino,
            ytd_return: titular.ytd_return,
            relative: relativa,
            relative_absence: ausenciaRelativa,
            provider: delProveedor,
            control,
            risk_score: riesgoIndicador,
            risk_score_source: origenDelIndicador
        },
        /*
         * La composición. En un fondo es la que midió un tercero; en una ACCIÓN se compone
         * aquí, y marcada: una acción es renta variable al 100 % por ser una acción, así que
         * no hay `declared/exposure` que proyectar —una tautología no es algo que afirme un
         * tercero— y la tarjeta es el único documento donde una copia derivada está en su
         * sitio. `derivation` es lo que impide que las dos se lean igual.
         *
         * Lo que esto habilita, y era el riesgo de no hacerlo: una radiografía de cartera que
         * mezcle fondos y acciones puede sumarlas sin tratar a la acción como un hueco.
         */
        exposure: esAccion
            ? {
                  asset_mix: { equity: 1, fixed_income: 0, cash: 0, other: 0 },
                  confidence: 1,
                  derivation: 'BY_INSTRUMENT_TYPE'
              }
            : esMateriaPrimaSinReparto(instrumento)
              ? {
                    asset_mix: { equity: 0, fixed_income: 0, cash: 0, other: 1 },
                    confidence: 1,
                    derivation: 'BY_INSTRUMENT_TYPE'
                }
              : exposicion === undefined
              ? undefined
              : {
                    /* Puede no estar, y lo demás sigue valiendo (decisión 109). */
                    asset_mix: exposicion['asset_mix'],
                    sectors: exposicion['sectors'],
                    equity_regions: exposicion['equity_regions'],
                    equity_styles: exposicion['equity_styles'],
                    market_caps: exposicion['market_caps'],
                    confidence: exposicion['confidence'],
                    derivation: 'DECLARED'
                },
        fixed_income:
            rentaFija === undefined
                ? undefined
                : {
                      effective_duration: rentaFija['effective_duration'],
                      modified_duration: rentaFija['modified_duration'],
                      effective_maturity: rentaFija['effective_maturity'],
                      yield_to_maturity: rentaFija['yield_to_maturity'],
                      investment_grade: rentaFija['investment_grade'],
                      high_yield: rentaFija['high_yield'],
                      avg_credit_quality: rentaFija['avg_credit_quality']
                  },
        holdings_summary:
            cartera === undefined
                ? undefined
                : {
                      positions_count: cartera['positions_count'],
                      top10_weight: cartera['top10_weight'],
                      as_of: cartera['as_of']
                  },
        /*
         * Patrimonio y sostenibilidad, desde el 02-11-2026.
         *
         * De las doce secciones que un fondo declara, la tarjeta traia bloque propio de
         * cuatro y nada de seis, asi que «la interfaz lee la tarjeta y pinta lo que declara»
         * no se sostenia: para la mitad habia que bajar al documento.
         *
         * La salida no fue proyectarlas las seis, sino decidir para QUIEN es la tarjeta.
         * La tarjeta es la fila de una LISTA —el buscador, el comparador—, no la carga de
         * una ficha: una ficha es un instrumento y puede permitirse varias lecturas; una
         * lista son cientos y no puede. Con ese criterio solo dos de las seis entran, y
         * entran porque se ordena y se filtra por ellas: el patrimonio de un fondo y su
         * calificacion de sostenibilidad. Las otras cuatro —distribuciones, procedencia,
         * y la rentabilidad y el riesgo del proveedor— solo se leen con la ficha delante,
         * y se quedan en su documento.
         *
         * Del bloque de sostenibilidad entra solo la escala de 1 a 5, que es por la que se
         * filtra; la puntuacion absoluta y la intensidad de carbono son de ficha.
         */
        size:
            patrimonio === undefined
                ? undefined
                : {
                      aum: patrimonio['aum'],
                      currency: patrimonio['currency'],
                      as_of: patrimonio['as_of']
                  },
        sustainability:
            sostenibilidad === undefined || sostenibilidad['esg_globes'] === undefined
                ? undefined
                : {
                      esg_globes: sostenibilidad['esg_globes'],
                      as_of: sostenibilidad['as_of']
                  },
        quality: {
            fitness: calidadDoc['fitness'],
            coverage: calidadDoc['coverage'],
            warnings: avisos
        },
        /* Sustituye a los punteros de la raiz: la app ya no necesita leer la raiz para saber
           que bloques existen.

           El nombre sale SIN su capa: `declared/costs` sale como `costs`. La capa dice
           quien escribe el documento, que es asunto nuestro; el lector solo necesita el
           nombre de la seccion.

           Y `metrics` se anade aparte, que es el arreglo del 02-11-2026. `computed/metrics`
           no viaja en `bloques` como los quince declarados, sino en su propio campo
           `calculadas`, asi que esta lista -que dice QUE SECCIONES EXISTEN- se dejaba fuera
           precisamente la unica que calculamos nosotros: 938 instrumentos de 1077 tenian
           metricas propias y ninguna tarjeta lo declaraba. La interfaz no podia saber que
           esa seccion existe sin mirar dentro del bloque, que es justo lo que esta lista
           existe para evitar. */
        available_sections: [
            ...Object.entries(instrumento.bloques)
                .filter(([, documento]) => documento !== undefined)
                .map(([sufijo]) => sufijo.slice(sufijo.lastIndexOf('/') + 1)),
            ...(instrumento.calculadas === undefined ? [] : ['metrics'])
        ].sort()
    });

    return tarjeta;
}
