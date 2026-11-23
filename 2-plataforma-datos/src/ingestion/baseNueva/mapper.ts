/**
 * src/ingestion/baseNueva/mapper.ts — del canónico a la base nueva.
 *
 * Funciones puras: entra una ficha de `export_bdb/{ISIN}.json` y un registro de
 * `export/fondos.ndjson`, y sale la lista de documentos que habría que escribir. **No
 * escribe nada y no toca la red.** La puerta de escritura es
 * `src/config/baseNueva/validadores.ts`, y lo que decide escribir de verdad es el escritor.
 *
 * Dos reglas que gobiernan todo lo de aquí:
 *
 * 1. **Si no está, no se inventa.** Un campo que el canónico no trae no sale con un cero ni
 *    con un `'NA'`: no sale, y se anota por qué en `ausencias`. Eso es lo que el contrato
 *    declara con `x-absence`.
 * 2. **Si no se puede nombrar, no entra.** Un dato del canónico cuyo significado no se
 *    puede establecer no se traduce a medias: se cuenta en `perdidas` y se dice. Es el caso
 *    de las columnas `categoria` e `indice` de las cifras relativas.
 *
 * Este mapper produce SOLO la raíz y los bloques `declared/*`, que son los de
 * `x-owner: platform`. Ni `computed/*` (es del lote, desde el analítico) ni `quality/latest`
 * ni `read/card` (proyecciones) salen de aquí, y la puerta de dueño lo impide.
 */
import {
    CLASE_ACTIVO,
    DISPONIBILIDAD,
    DOMICILIO,
    ORIGEN_DE_DISPONIBILIDAD,
    CLASE_DE_SERIE,
    type ClaseDeSerie,
    AUSENCIA_RELATIVA_DECIDIDA,
    claveDelAvisoDeRelativas,
    COTIZACION_NO_PRINCIPAL,
    ausenciaRelativaDeAccion,
    CONFIRMACION_DEL_KID,
    AJUSTE_DE_SERIE,
    PAIS_DEL_MERCADO,
    PERIODO,
    SFDR,
    SUJETO_ABSOLUTO,
    SUJETO_RELATIVO,
    SUJETO_RELATIVO_SIN_SITIO,
    TIPO_PRODUCTO,
    TRAILING,
    TRAILING_SIN_SITIO,
    TraduccionDesconocida,
    escalonDeCalidad,
    REPLICA,
    traducir
} from './traducciones';
import { componerTrozos, pesoCreible } from './posiciones';
import { leerIndice } from './indice';
import { resolverDistribucion } from './distribucion';
import {
    aplicaAlInstrumento,
    pesoDeRentaFijaConConvertibles,
    UMBRAL_DE_RENTA_FIJA_DE_SUS_MAPAS,
    type RasgosDelInstrumento
} from './aplicabilidad';
import { apartarFueraDeRango, enRango, rangoDe } from '../../config/baseNueva/validadores';
import {
    CENTINELAS_PROHIBIDOS,
    CLAVES_DEL_SOBRE,
    TOLERANCIA_DEL_REPARTO
} from '../../config/baseNueva/vocabulario';
import type { Ausencia, BaseDeDisponibilidad, Disponibilidad, Dueno } from '../../config/baseNueva/vocabulario';

/** La ficha canónica, sin tipar de más: es un JSON de otro programa. */
export type FichaCanonica = Record<string, unknown>;
/** Un registro de `export/fondos.ndjson`. */
export type RegistroUniversal = Record<string, unknown>;

/** Un documento listo para la puerta de escritura. */
export interface DocumentoMapeado {
    /** La ruta de Firestore con las claves ya puestas. */
    ruta: string;
    /** El tipo, que es el nombre del fichero de esquema. */
    tipo: string;
    documento: Record<string, unknown>;
    /**
     * Como QUIEN se escribe este documento, cuando no es el dueño de la pasada.
     *
     * Existe desde el 01-11 porque este mapper es el mensajero de dos productores, no de
     * uno: casi todo lo que emite es `declared/*`, que la plataforma afirma a partir del
     * canónico, pero `computed/metrics` lo calculó `core.metricas v1` dentro del extractor,
     * que es un lote. El dueño de ese dato es `batch`, y la barrera de dueño tiene razón
     * al rechazarlo si se escribe como `platform`.
     *
     * La salida fácil era poner `x-owner: platform` en ese contrato. Sería mentir sobre
     * quién calculó la cifra para que pasara la puerta, que es exactamente lo que la
     * puerta existe para impedir.
     */
    comoDueno?: Dueno;
}

/** Una ausencia anotada: qué falta y por qué. */
export interface AusenciaAnotada {
    ruta: string;
    razon: Ausencia;
    detalle?: string;
    /** Solo en `computed/metrics`: el motivo que la ficha traduce a una frase. */
    motivo?: MotivoSinMetricas;
}

/** Por qué no hay métricas propias, en códigos que la interfaz sabe contar. */
export type MotivoSinMetricas =
    | 'DISTRIBUTES'
    | 'POLICY_UNKNOWN'
    | 'POLICY_PENDING'
    | 'NEEDS_FX'
    | 'SERIES_STOPPED'
    | 'NO_PRICES'
    | 'SHORT_HISTORY'
    | 'NO_METHOD'
    | 'UNIDENTIFIED_SERIES';

/** Deja en la raíz por qué no hay métricas: el documento que falta no puede decirlo. */
function sellarAusenciaDeMetricas(raiz: Record<string, unknown>, ausencias: AusenciaAnotada[]): void {
    const falta = ausencias.find((ausencia) => ausencia.ruta === 'computed/metrics');
    if (falta?.motivo !== undefined) {
        raiz['metrics_absence'] = { reason: falta.razon, code: falta.motivo };
    }
}

export interface ResultadoDeMapeo {
    instrument_id: string;
    documentos: DocumentoMapeado[];
    ausencias: AusenciaAnotada[];
    /** Datos del canónico que el contrato no sabe guardar. Se cuentan, no se tiran callados. */
    perdidas: string[];
    /** Lo que ha ido mal sin impedir el mapeo. */
    avisos: string[];
    /** Lo que ha impedido mapear el instrumento entero. */
    errores: string[];
}

// ---------------------------------------------------------------------------
// Lectura defensiva del canónico
// ---------------------------------------------------------------------------

export function obj(valor: unknown): Record<string, unknown> {
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
        ? (valor as Record<string, unknown>)
        : {};
}

export function en(raiz: unknown, ...tramos: string[]): unknown {
    let actual: unknown = raiz;
    for (const tramo of tramos) {
        if (actual === null || typeof actual !== 'object') return undefined;
        actual = (actual as Record<string, unknown>)[tramo];
    }
    return actual;
}

/** Un número de verdad, o nada. `NaN`, `Infinity` y las cadenas no cuentan. */
export function num(valor: unknown): number | undefined {
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : undefined;
}

/** De por ciento a fracción. Es la conversión que más veces falta hoy. */
export function frac(valor: unknown): number | undefined {
    const n = num(valor);
    return n === undefined ? undefined : n / 100;
}

/**
 * Texto con contenido, o nada. Y **un centinela no es contenido**: si el canónico trae
 * `'Not Benchmarked'`, `'N/A'` o `'None'`, eso es una ausencia disfrazada de valor y aquí
 * se queda fuera.
 *
 * Hace falta porque el contrato no puede cazarlo: el nombre de un índice es texto libre, y
 * un centinela es texto libre válido. La auditoría del 01-11 lo encontró escrito en la
 * base: **90 instrumentos con `'Not Benchmarked'` y 27 con `'N/A'` en el campo del nombre
 * del índice**, que es exactamente el defecto que la habilidad de arranque avisa de mirar
 * a mano después de sembrar. La lista de centinelas es la del vocabulario, no una propia.
 */
/**
 * Con qué versión del método calculó el extractor las cifras de una ficha. Lo dice la propia
 * ficha en `riesgo.historial_precios.metodo` («core.metricas v3: …»), y de ahí sale el
 * identificador que se publica (decisión A-158, 16-11-2026).
 *
 * No se pone de memoria: hasta la versión 2 el identificador estaba escrito aquí como una
 * constante, y con eso una ficha de una pasada anterior se habría publicado con la etiqueta de la
 * versión nueva sin haberse recalculado. Sin sello —las fichas de acciones anteriores a la
 * versión 3 no lo llevaban— o con un sello anterior, la cifra es de la versión 2 y así se llama:
 * por la §3 del método, una V2 y una V3 no se ordenan juntas, y tienen que poder distinguirse.
 *
 * La versión 4 (MET-6 y MET-7, 17-11-2026) entra igual: con su sello es la 4, y una ficha de la 3
 * sigue siendo de la 3 hasta que se recalcule. Un sello de una versión que aún no existe se lee
 * como la última conocida, la 4, porque el contrato no admitiría otra.
 */
export function versionDelMetodo(sello: unknown): 2 | 3 | 4 {
    const visto = typeof sello === 'string' ? /^core\.metricas v(\d+)\b/.exec(sello) : null;
    const version = visto === null ? 2 : Number(visto[1]);
    return version >= 4 ? 4 : version === 3 ? 3 : 2;
}

export function txt(valor: unknown): string | undefined {
    if (typeof valor !== 'string') return undefined;
    const limpio = valor.trim();
    if (limpio === '') return undefined;
    if ((CENTINELAS_PROHIBIDOS as readonly string[]).includes(limpio)) return undefined;
    return limpio;
}

const WINDOWS_1252 = new TextDecoder('windows-1252');

/**
 * Un texto largo del proveedor, sin lo que estorba y no se lee (decisión 93, medido el 05-11-2026): caracteres de control
 * de Windows-1252, que tienen una sola lectura (`\x96` es «–» en 6 actividades y `\x8a` es «Š» en la de Volkswagen),
 * espacios duros y de anchura cero (2 objetivos) y espacios dobles. Lo que ya perdió la letra se queda como está: el
 * `Alt?a` de Amadeus no se repara sin saber cuál era. Solo para Actividad y Objetivo: un nombre se corrige con autor, en
 * `config/correcciones.json` del extractor.
 */
export function textoLimpio(valor: unknown): string | undefined {
    return txt(
        txt(valor)
            ?.replace(/[\u0080-\u009f]/g, (c) => WINDOWS_1252.decode(Uint8Array.of(c.charCodeAt(0))))
            .replace(/[     ]/g, ' ')
            .replace(/[​﻿]/g, '')
            .replace(/ {2,}/g, ' ')
    );
}

/** Fecha pura, solo si lo es de verdad. Esto es lo que para el `0000-00-00`. */
export function fecha(valor: unknown): string | undefined {
    const t = txt(valor);
    if (t === undefined) return undefined;
    const soloFecha = t.slice(0, 10);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(soloFecha)) return undefined;
    const [anio, mes, dia] = soloFecha.split('-').map(Number);
    if (anio === undefined || mes === undefined || dia === undefined) return undefined;
    if (anio < 1900 || anio > 2200 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return undefined;
    return soloFecha;
}

/** Instante ISO con sufijo Z. */
function instante(valor: unknown): string | undefined {
    const t = txt(valor);
    if (t === undefined) return undefined;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Huella sha256 en minúsculas, o nada. */
function huella(valor: unknown): string | undefined {
    const t = txt(valor)?.toLowerCase();
    return t !== undefined && /^[a-f0-9]{64}$/.test(t) ? t : undefined;
}

/** Quita las claves vacías. Devuelve `undefined` si no queda nada: así no se escribe un bloque vacío. */
export function limpiar(entrada: Record<string, unknown>): Record<string, unknown> | undefined {
    const salida: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(entrada)) {
        if (valor === undefined || valor === null) continue;
        if (typeof valor === 'object' && !Array.isArray(valor)) {
            const dentro = limpiar(valor as Record<string, unknown>);
            if (dentro !== undefined) salida[clave] = dentro;
            continue;
        }
        if (Array.isArray(valor) && valor.length === 0) continue;
        salida[clave] = valor;
    }
    return Object.keys(salida).length === 0 ? undefined : salida;
}

/** La forma de `relative.benchmark.source_series_id`: proveedor y símbolo de la bolsa INDX. */
const PROVEEDOR_DE_LA_SERIE_DEL_INDICE = 'EODHD';

/**
 * Qué hizo de serie del índice: un INSTRUMENTO de la base (`instrument_id`, el fondo índice o el
 * ETF proxy) o el NIVEL DEL PROPIO ÍNDICE (`source_series_id`, la bolsa INDX de EODHD; camino C,
 * decisión 23 del 07-11-2026). Nunca las dos: el índice no es un instrumento de la base, y poner
 * su símbolo en `instrument_id` diría que lo replica un activo que no existe. La clase de serie
 * decide; sin ella, lo decide la forma del identificador, porque la retirada de unas relativas
 * anteriores a este cambio no la trae.
 */
function identidadDeLaSerieDelIndice(
    proxy: string | undefined,
    claseCanonica: unknown
): { instrument_id?: string; source_series_id?: string; series_class?: ClaseDeSerie; esNivelDeIndice: boolean } {
    const series_class =
        claseCanonica === undefined ? undefined : traducir(CLASE_DE_SERIE, 'clase_de_serie', claseCanonica);
    const esNivelDeIndice =
        series_class === 'INDEX_LEVEL' || (series_class === undefined && proxy !== undefined && proxy.endsWith('.INDX'));
    if (proxy === undefined) return { series_class, esNivelDeIndice };
    return esNivelDeIndice
        ? { source_series_id: `${PROVEEDOR_DE_LA_SERIE_DEL_INDICE}:${proxy}`, series_class, esNivelDeIndice }
        : { instrument_id: proxy, series_class, esNivelDeIndice };
}

/**
 * `disponibilidad` del canónico → `availability` de la raíz. Tercer eslabón de la decisión
 * 14 de Óscar (02-11-2026): un instrumento que deja de cotizar se marca, no desaparece.
 *
 * Devuelve `undefined` en dos casos, y los dos son «no se ha medido», que es un sexto caso
 * distinto de los cinco estados: cuando el canónico no trae el bloque —le pasa a los
 * fondos, que no pasan por el buscador de símbolos del proveedor— y cuando le faltan las
 * fechas que el contrato exige. Media marca no se escribe: `since` y `last_checked` son lo
 * que distingue un estado antiguo y vigente de uno recién visto, y sin ellas el estado
 * solo afirmaría algo sin decir desde cuándo.
 *
 * Desde el 07-11-2026 (decisión 10) dice además en qué se apoya el estado, `basis`: una marca
 * con `origen: "decision"` es `DECISION` y lleva `decision` con autor, fecha y motivo; sin
 * `origen`, `SOURCE_EVIDENCE`, que es lo que el extractor escribe cuando mide. Una decisión a
 * la que le falta algo no se escribe a medias ni se rebaja a evidencia: se queda fuera la
 * marca entera, con su aviso, igual que un estado que no se sabe traducir.
 */
/**
 * La réplica de Morningstar (`identificacion.replicacion`), traducida a su código. «No aplica» y la falta se quedan ausentes. Un literal
 * nuevo no para el instrumento, que es una ficha entera por un campo descriptivo: se anota y se queda ausente hasta que se mida.
 */
function replicaDelProveedor(valor: unknown, avisos: string[]): string | undefined {
    const literal = txt(valor);
    if (literal === undefined) return undefined;
    if (!(literal in REPLICA)) {
        avisos.push(`replicacion desconocida: ${literal}`);
        return undefined;
    }
    return REPLICA[literal] ?? undefined;
}

function disponibilidad(canonico: Record<string, unknown>, avisos: string[]): Record<string, unknown> | undefined {
    const bloque = obj(canonico['disponibilidad']);
    const estadoBruto = txt(bloque['estado']);
    if (estadoBruto === undefined) return undefined;
    let estado: Disponibilidad;
    try {
        estado = traducir(DISPONIBILIDAD, 'disponibilidad', estadoBruto);
    } catch (error) {
        avisos.push(error instanceof TraduccionDesconocida ? error.message : String(error));
        return undefined;
    }
    const desde = fecha(bloque['desde']);
    const visto = fecha(bloque['visto']);
    if (desde === undefined || visto === undefined) {
        avisos.push(`disponibilidad ${estadoBruto} sin fechas: falta ${desde === undefined ? 'desde' : 'visto'}`);
        return undefined;
    }
    const origenBruto = bloque['origen'];
    let base: BaseDeDisponibilidad = 'SOURCE_EVIDENCE';
    if (origenBruto !== undefined && origenBruto !== null) {
        try {
            base = traducir(ORIGEN_DE_DISPONIBILIDAD, 'disponibilidad.origen', origenBruto);
        } catch (error) {
            avisos.push(error instanceof TraduccionDesconocida ? error.message : String(error));
            return undefined;
        }
    }
    let decision: Record<string, unknown> | undefined;
    if (base === 'DECISION') {
        const fila = obj(bloque['decision']);
        decision = {
            decided_by: txt(fila['autor']),
            decided_at: fecha(fila['fecha_decision']),
            reason: txt(fila['motivo'])
        };
        const faltan = Object.entries(decision)
            .filter(([, valor]) => valor === undefined)
            .map(([clave]) => clave);
        if (faltan.length > 0) {
            avisos.push(`disponibilidad ${estadoBruto} decidida sin ${faltan.join(', ')}: no se escribe`);
            return undefined;
        }
    }
    return limpiar({
        state: estado,
        since: desde,
        last_checked: visto,
        reason: txt(bloque['detalle']),
        basis: base,
        decision
    });
}

/** Lo que de FIRDS va a la raíz: dos identificadores, la lista de centros y su fecha. */
export interface IdentidadFirds {
    cfi?: string;
    lei?: string;
    listings?: Record<string, string>[];
    listings_as_of?: string;
}

/** Tope de la lista, el del contrato: el máximo medido en el índice entero son 80 centros. */
const MAXIMO_DE_CENTROS = 120;

/**
 * `identidad_firds` del canónico → `identifiers.cfi`, `identifiers.lei`, `listings` y
 * `listings_as_of` de la raíz. Encargo «identidad» del 07-11-2026: el extractor lo tenía en
 * la ficha desde el paso 1 de FIRDS y no llegaba a la base.
 *
 * Tres reglas, y las tres son de no inventar:
 *
 * - **Nada decide el tipo.** El CFI va al lado de `instrument_type`; que el ETC de oro sea
 *   `EYAYFT` no lo saca de `OTHER` (decisión 2 del 07-11). Por eso `cfi_tipo`, que el
 *   canónico trae, no se guarda: es el CFI otra vez, leído con una regla nuestra.
 * - **Sin fecha del índice no se escribe nada de FIRDS.** Una admisión o una baja que no
 *   dice a qué día es verdad no se puede auditar, y el contrato ata `listings_as_of` a los
 *   tres campos.
 * - **Lo que no encaja en el patrón se cuenta y se salta**, no se arregla: un MIC que no
 *   son cuatro caracteres o un CFI que no son seis letras no es un dato que corregir aquí.
 */
export function identidadFirds(canonico: Record<string, unknown>, avisos: string[]): IdentidadFirds {
    const bloque = obj(canonico['identidad_firds']);
    if (Object.keys(bloque).length === 0) return {};
    const visto = fecha(bloque['visto']);
    if (visto === undefined) {
        avisos.push('identidad_firds sin fecha del indice: no se escribe nada de FIRDS');
        return {};
    }
    const salida: IdentidadFirds = {};
    const cfi = txt(bloque['cfi']);
    if (cfi !== undefined) {
        if (/^[A-Z]{6}$/.test(cfi)) salida.cfi = cfi;
        else avisos.push(`identidad_firds.cfi no es un CFI: ${cfi}`);
    }
    const lei = txt(bloque['lei_emisor']);
    if (lei !== undefined) {
        if (/^[A-Z0-9]{18}[0-9]{2}$/.test(lei)) salida.lei = lei;
        else avisos.push(`identidad_firds.lei_emisor no es un LEI: ${lei}`);
    }
    const porMic = new Map<string, Record<string, string>>();
    for (const bruto of Array.isArray(bloque['mercados']) ? bloque['mercados'] : []) {
        const m = obj(bruto);
        const mic = txt(m['mic']);
        if (mic === undefined || !/^[A-Z0-9]{4}$/.test(mic)) {
            avisos.push(`identidad_firds: centro sin MIC valido (${String(mic)})`);
            continue;
        }
        const centro: Record<string, string> = { mic };
        const admision = fecha(m['admision']);
        const primera = fecha(m['primera_negociacion']);
        const baja = fecha(m['baja']);
        if (admision !== undefined) centro['admission_date'] = admision;
        if (primera !== undefined) centro['first_trade_date'] = primera;
        if (baja !== undefined) centro['termination_date'] = baja;
        porMic.set(mic, centro);
    }
    const listings = [...porMic.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, c]) => c);
    if (listings.length > MAXIMO_DE_CENTROS) {
        avisos.push(`identidad_firds: ${listings.length} centros, mas que el tope de ${MAXIMO_DE_CENTROS}; no se escriben`);
    } else if (listings.length > 0) {
        salida.listings = listings;
    }
    if (Object.keys(salida).length > 0) salida.listings_as_of = visto;
    return salida;
}

/** Un peso del canónico: ya viene en fracción en `portfolio_exposure_v2`. */
function peso(valor: unknown): number | undefined {
    const n = num(valor);
    if (n === undefined) return undefined;
    if (n < 0 || n > 1) return undefined;
    return n;
}

/** Un mapa clave→peso, saltando lo que no sea un peso. */
function mapaDePesos(valor: unknown): Record<string, number> | undefined {
    const fuente = obj(valor);
    const salida: Record<string, number> = {};
    for (const [clave, bruto] of Object.entries(fuente)) {
        const p = peso(bruto);
        if (p !== undefined) salida[clave] = p;
    }
    return Object.keys(salida).length === 0 ? undefined : salida;
}

const TIPO_EXPOSICION = 'instrument-declared-exposure.v2.schema.json';

/**
 * Uno de los tres mapas de la renta fija (`bond_types`, `duration_buckets` y `credit_buckets`), neto como lo da el
 * proveedor (decisión C-31 de Óscar, 21-11-2026, la regla del reparto por clase de la C-29 llevada a estos mapas).
 *
 * Un mapa con una parte fuera de 0-1 —la liquidez en negativo de un fondo con derivados o liquidez prestada, o una parte
 * por encima de 1 que la compensa— se escribe **tal cual, con su signo**, si todas sus partes caben en los topes del
 * contrato (de -5 a 6, `$defs.peso_de_mapa_neto`) y entre todas suman 1 con `TOLERANCIA_DEL_REPARTO`, la misma de la
 * C-29. Hasta ese día `mapaDePesos` saltaba lo que no era un peso, y el mapa sumaba de más: UBS Duración 0-2 escribía
 * gobierno, corporativa y titulizada sin su liquidez de -4,87 %, y sumaba 1,049.
 *
 * Lo que no cuadra —no suma 1, o una parte se sale de los topes— sigue con la regla de antes, `mapaDePesos`: se saltan
 * las partes fuera de 0-1 y se escribe el resto, sin comprobar la suma, que es lo que hacía el mapper con todos estos
 * mapas. Se avisa, para que la pasada lo cuente. Un mapa sin partes fuera de 0-1 no cambia.
 *
 * Las claves pasan tal cual, sin lista: son las del canónico. En `bond_types`, desde la decisión C-33 (21-11-2026), las
 * seis del proveedor —`government`, `municipal`, `corporate`, `securitized`, `cash` y `derivative`—; hasta ese día el
 * extractor no pasaba las dos que faltan, y por eso 49 mapas con la liquidez en negativo no sumaban 1.
 */
function mapaDeRentaFija(valor: unknown, campo: string, avisos: string[]): Record<string, number> | undefined {
    const partes = Object.entries(obj(valor)).flatMap(([clave, bruto]): [string, number][] => {
        const n = num(bruto);
        return n === undefined ? [] : [[clave, n]];
    });
    if (!partes.some(([, n]) => n < 0 || n > 1)) return mapaDePesos(valor);
    const suma = partes.reduce((total, [, n]) => total + n, 0);
    const fuera = partes.filter(([, n]) => !enRango(TIPO_EXPOSICION, `${campo}.*`, n));
    if (fuera.length === 0 && Math.abs(suma - 1) <= TOLERANCIA_DEL_REPARTO) return Object.fromEntries(partes);
    avisos.push(
        `${campo} neto que no se escribe tal cual (${fuera.length > 0 ? `${fuera.map(([clave, n]) => `${clave} ${n}`).join(', ')} fuera de los topes` : `suma ${suma.toFixed(5)}`}): ` +
            'se saltan sus partes fuera de 0-1, como antes de la C-31'
    );
    return mapaDePesos(valor);
}

/**
 * El peso de una clase en el reparto de activos. No es un `peso`: el proveedor da el reparto neto, y una
 * clase puede salirse de 0-1 hasta los topes del contrato, de -5 a 6 (decisión C-29 de Óscar, 21-11-2026;
 * hasta ese día, un punto por la A-63). La cifra pasa tal cual: un -0,08 no se escribe como cero, ni un
 * -2,43 de liquidez prestada.
 */
function pesoDeClase(valor: unknown): number | undefined {
    const n = num(valor);
    return n !== undefined && enRango(TIPO_EXPOSICION, 'asset_mix.equity', n) ? n : undefined;
}

/** Las nueve celdas de la caja de estilo y tamaño, con el nombre del contrato. */
const CELDAS_DE_ESTILO = [
    'large_value',
    'large_blend',
    'large_growth',
    'mid_value',
    'mid_blend',
    'mid_growth',
    'small_value',
    'small_blend',
    'small_growth'
] as const;

/**
 * Las nueve celdas, si son nueve y suman 1 (decisión 51 de Óscar, 05-11-2026). Si no, no hay caja, igual
 * que no hay reparto de activos si lo declarado no suma 1.
 *
 * No pasan por `mapaDePesos`, y es a propósito. Ese salta lo que no está entre 0 y 1, y aquí una celda
 * negativa es lo neto de cortos del fondo: quitarla dejaría ocho que ya no suman 1. Es lo que le pasa a
 * `equity_styles` y `market_caps` en los 12 fondos largos-cortos con un total negativo o por encima de 1.
 */
function cajaDeEstilo(valor: unknown, avisos: string[]): Record<string, number> | undefined {
    const fuente = obj(valor);
    if (Object.keys(fuente).length === 0) return undefined;
    const caja: Record<string, number> = {};
    for (const celda of CELDAS_DE_ESTILO) {
        const n = num(fuente[celda]);
        if (n === undefined || !enRango(TIPO_EXPOSICION, 'equity_style_box.*', n)) {
            avisos.push(`caja de estilo sin escribir: ${celda} vale ${String(fuente[celda])}`);
            return undefined;
        }
        caja[celda] = n;
    }
    const suma = Object.values(caja).reduce((total, celda) => total + celda, 0);
    if (Math.abs(suma - 1) > TOLERANCIA_DEL_REPARTO) {
        avisos.push(`caja de estilo que no suma 1: ${suma.toFixed(5)}`);
        return undefined;
    }
    return caja;
}

// ---------------------------------------------------------------------------
// Las ventanas del canónico
// ---------------------------------------------------------------------------

/**
 * Una cifra ABSOLUTA por ventana y sujeto: `volatilidad_pct.3a.fondo` → `3y.fund`.
 *
 * `elegir` decide hoja a hoja QUÉ valor entra, y existe para separar lo que calculamos
 * nosotros de lo que publica el proveedor. Las dos cosas llegan en el MISMO campo del
 * canónico y solo la procedencia las distingue: medido el 01-11, de las rutas
 * `volatilidad_pct.*.fondo` hay 1.385 de `vl_eodhd` —nuestras— y 1.070 de
 * `morningstar_lt`. Sin este filtro las nuestras acababan en un bloque llamado
 * `provider_risk`, que es un nombre que miente.
 *
 * Devuelve un valor distinto del que trae el campo, y no solo un sí o un no, porque donde
 * la nuestra desplazó a la del proveedor la del proveedor sigue existiendo, guardada en
 * `meta.contraste`. Un filtro que solo dijera «no» dejaría 452 fondos sin volatilidad
 * ninguna; sustituyendo, el hueco se cierra con la cifra de Morningstar y bajo su nombre.
 */
function ventanasAbsolutas(
    fuente: unknown,
    convertir: (valor: unknown) => number | undefined,
    elegir?: (periodoCanonico: string, sujetoCanonico: string, bruto: unknown) => unknown
): Record<string, Record<string, number>> | undefined {
    const salida: Record<string, Record<string, number>> = {};
    for (const [periodoCanonico, porSujeto] of Object.entries(obj(fuente))) {
        const ventana = PERIODO[periodoCanonico];
        if (ventana === undefined) continue;
        const dentro: Record<string, number> = {};
        for (const [sujetoCanonico, bruto] of Object.entries(obj(porSujeto))) {
            const sujeto = SUJETO_ABSOLUTO[sujetoCanonico];
            if (sujeto === undefined) continue;
            const elegido = elegir === undefined ? bruto : elegir(periodoCanonico, sujetoCanonico, bruto);
            const valor = convertir(elegido);
            if (valor !== undefined) dentro[sujeto] = valor;
        }
        if (Object.keys(dentro).length > 0) salida[ventana] = dentro;
    }
    return Object.keys(salida).length === 0 ? undefined : salida;
}

/**
 * Una cifra RELATIVA por ventana: solo la columna `fondo`, que es la única cuyo significado
 * se puede nombrar. Devuelve también cuántas columnas se han dejado fuera.
 */
function ventanasRelativas(
    fuente: unknown,
    convertir: (valor: unknown) => number | undefined
): { valores: Record<string, Record<string, number>> | undefined; descartadas: number } {
    const salida: Record<string, Record<string, number>> = {};
    let descartadas = 0;
    for (const [periodoCanonico, porSujeto] of Object.entries(obj(fuente))) {
        const ventana = PERIODO[periodoCanonico];
        if (ventana === undefined) continue;
        const dentro: Record<string, number> = {};
        for (const [sujetoCanonico, bruto] of Object.entries(obj(porSujeto))) {
            if (SUJETO_RELATIVO_SIN_SITIO.includes(sujetoCanonico)) {
                if (num(bruto) !== undefined) descartadas += 1;
                continue;
            }
            const sujeto = SUJETO_RELATIVO[sujetoCanonico];
            if (sujeto === undefined) continue;
            const valor = convertir(bruto);
            if (valor !== undefined) dentro[sujeto] = valor;
        }
        if (Object.keys(dentro).length > 0) salida[ventana] = dentro;
    }
    return { valores: Object.keys(salida).length === 0 ? undefined : salida, descartadas };
}

// ---------------------------------------------------------------------------
// El mapeo
// ---------------------------------------------------------------------------

/**
 * La base del sobre de un bloque `declared/*`: quién lo afirma y desde cuándo. Sin esto, un
 * bloque declarado no se puede escribir, y es deliberado: una cifra sin fuente ni fecha no
 * puede acabar en un informe de cliente.
 */
function sobre(fuente: string, asOf: string | undefined): Record<string, unknown> | undefined {
    if (asOf === undefined) return undefined;
    return { source: fuente, as_of: asOf };
}

/**
 * `declared/quote`: el último precio y el día al que corresponde. Lo usan las dos vías —fondos
 * y acciones— porque el bloque es el mismo para todos los tipos, y vive aquí para que no haya
 * dos versiones de la misma regla.
 *
 * Las tres cosas van juntas o no va ninguna. Un precio sin su día no se puede enseñar: medido
 * el 01-11-2026, de los 846 precios del canónico 770 son de octubre y 74 de julio. Y un precio
 * sin decir si es valor liquidativo o cierre de mercado no se compara con otro: en
 * `IE00B4L5Y983` el cierre de XETRA da 129,685 EUR y el valor liquidativo 144,71, que son la
 * misma cosa en dos divisas y parecen un desajuste del 11 %.
 *
 * `price_class` se DERIVA del tipo, y por eso el contrato declara ese campo en capa `computed`
 * dentro de un bloque declarado: el precio de un fondo es su valor liquidativo por definición,
 * y el de una acción o un ETF es el cierre de su mercado, que es lo que dice el código que los
 * trae. Un tipo del que no se pueda decidir no escribe el bloque, en vez de suponer.
 *
 * `currency` es la de ESTE precio, y en 13 de los 28 ETF no es la de la clase. Sin un código
 * de tres letras no se escribe: la pantalla dice entonces que no se sabe, en vez de suponer.
 *
 * Y si esa divisa contradice la de la serie o la de la negociación, tampoco (09-11-2026, en el
 * espíritu de la decisión 17 y de la octava: nos fiamos de la serie). Medido ese día sobre el
 * canónico: en SPY (`US78462F1030`), QQQ (`US46090E1038`) e `IE000DR59CI3` el extractor trae
 * como precio un valor liquidativo de justETF pasado a EUR, mientras su serie y su negociación
 * son en USD; publicado, era un «cierre de mercado en EUR» que no existe. La comparación es con
 * la serie (`historial_precios.divisa_origen`, que solo está cuando hubo cambio de divisa) y,
 * en lo que cotiza, con la negociación; NUNCA con la divisa de la clase: 14 clases en USD
 * cotizan en EUR en XETRA, con serie y precio en EUR, y están bien. La negociación de Londres
 * se dice en libras aunque el cierre venga en peniques (contrato, `trading.currency`), así que
 * GBX y GBP son la misma moneda frente a ella; frente a la serie, no: ahí sería un error de
 * escala de cien. Sin divisa de referencia, o sin divisa del precio, no se bloquea nada.
 */
const MISMA_MONEDA_EN_LA_NEGOCIACION: Record<string, string> = { GBX: 'GBP', GBp: 'GBP' };

type Cotizacion = { documento: Record<string, unknown> } | { bloqueo: string } | undefined;

function bloqueDeCotizacion(universal: Record<string, unknown>, tipo: string): Cotizacion {
    const valoracion = obj(universal['valoracion']);
    const negociacion = universal['negociacion'];
    const precio = num(valoracion['vl']);
    const dia = fecha(valoracion['vl_fecha']);
    const clase = tipo === 'FUND' ? 'NAV' : tipo === 'ETF' || tipo === 'STOCK' ? 'MARKET_PRICE' : undefined;
    if (precio === undefined || dia === undefined || clase === undefined) return undefined;
    if (precio < 0 || precio > 100_000_000) return undefined;
    /* De dónde viene ESTE precio, tal como lo escribe el extractor en `meta.procedencia` (decisión B-68 de Óscar,
       09-11-2026): el mismo vocabulario que `declared/provenance`. Medido ese día sobre `182481b2…`: 738 `vl_eodhd:eod`,
       542 `eodhd` y 31 `morningstar_lt:sal_quote`. Sin procedencia queda la reserva, `canonical:fondosdb`; los cinco
       registros que no la traen tampoco traen precio, así que hoy no la usa nadie. */
    const fuente = txt(obj(en(universal, 'meta', 'procedencia'))['valoracion.vl']);
    const divisa = txt(valoracion['vl_divisa']);
    if (divisa !== undefined) {
        const deLaSerie = txt(en(universal, 'riesgo', 'historial_precios', 'divisa_origen'));
        const deLaNegociacion = clase === 'MARKET_PRICE' ? txt(obj(negociacion)['divisa']) : undefined;
        const choca =
            deLaSerie !== undefined && deLaSerie !== divisa
                ? `la serie es en ${deLaSerie}`
                : deLaNegociacion !== undefined &&
                    (MISMA_MONEDA_EN_LA_NEGOCIACION[divisa] ?? divisa) !== (MISMA_MONEDA_EN_LA_NEGOCIACION[deLaNegociacion] ?? deLaNegociacion)
                  ? `la negociacion es en ${deLaNegociacion}`
                  : undefined;
        if (choca !== undefined) {
            return { bloqueo: `declared/quote sin escribir: el precio viene en ${divisa} (fuente ${fuente ?? 'sin procedencia'}) y ${choca}` };
        }
    }
    return {
        documento: {
            source: fuente ?? 'canonical:fondosdb',
            as_of: dia,
            price: precio,
            price_class: clase,
            ...(divisa !== undefined && /^[A-Z]{3}$/.test(divisa) ? { currency: divisa } : {}),
            ...(clase === 'MARKET_PRICE' && loNegociado(negociacion) !== undefined ? { trading: loNegociado(negociacion) } : {})
        }
    };
}

/**
 * Lo que se negocia, de `negociacion` en el canónico (decisión 108 de Óscar, 05-11-2026): `core/negociacion.py` en el
 * extractor. Sin la plaza, su fecha y sus sesiones no se escribe: una mediana sin decir de dónde es no dice nada. Un fondo no
 * llega aquí, y `ACCION IBEX 35` llega sin cuenta de sesiones sin volumen, porque el proveedor no se lo da.
 */
function loNegociado(negociacion: unknown): Record<string, unknown> | undefined {
    const dato = obj(negociacion);
    const plaza = txt(dato['plaza']);
    const corte = fecha(dato['fecha_corte']);
    const sesiones = num(dato['sesiones']);
    if (plaza === undefined || corte === undefined || sesiones === undefined || sesiones < 1) return undefined;
    const moneda = txt(dato['divisa']);
    const sinVolumen = num(dato['sesiones_sin_volumen']);
    const mediana = num(dato['mediana_negociada']);
    const deLaMediana = num(dato['sesiones_de_la_mediana']);
    return {
        exchange: plaza,
        ...(moneda !== undefined && /^[A-Z]{3}$/.test(moneda) ? { currency: moneda } : {}),
        as_of: corte,
        sessions: Math.trunc(sesiones),
        ...(sinVolumen === undefined ? {} : { sessions_without_volume: Math.trunc(sinVolumen) }),
        ...(mediana === undefined ? {} : { median_traded_value: mediana }),
        ...(deLaMediana === undefined ? {} : { median_sessions: Math.trunc(deLaMediana) })
    };
}

/**
 * Los huecos que le cuestan una ventana a la serie (decisión 111 de Óscar, 05-11-2026), con el nombre de ventana del contrato.
 * Sin esto, la ventana que falta se leería como una serie que no llega.
 */
function huecosDeLaSerie(historial: Record<string, unknown>): Record<string, unknown>[] | undefined {
    const huecos = Array.isArray(historial['huecos']) ? (historial['huecos'] as unknown[]) : [];
    const salida: Record<string, unknown>[] = [];
    for (const crudo of huecos) {
        const hueco = obj(crudo);
        const desde = fecha(hueco['desde']);
        const hasta = fecha(hueco['hasta']);
        const dias = num(hueco['dias']);
        const ventanas = (Array.isArray(hueco['ventanas']) ? (hueco['ventanas'] as unknown[]) : [])
            .map((ventana) => PERIODO[String(ventana)])
            .filter((ventana) => ventana !== undefined);
        if (desde !== undefined && hasta !== undefined && dias !== undefined && ventanas.length > 0) {
            salida.push({ from: desde, to: hasta, days: Math.trunc(dias), windows: ventanas });
        }
    }
    return salida.length > 0 ? salida : undefined;
}

/**
 * Decisión B-73 (Óscar, 09-11-2026): una cifra fuera del rango de su contrato bloquea solo su
 * ventana. Se aparta del documento y se anota en `out_of_range`, y el resto se escribe. El
 * rango lo aplica el propio contrato —el de una acción no es el de un fondo, y lo decide su
 * `allOf`—, así que aquí no hay un número. El aviso es el de siempre, para que se cuente.
 */
function conLoQueNoCabeApartado(tipo: string, documento: Record<string, unknown>, avisos: string[]): Record<string, unknown> {
    const { documento: apartado, apartadas } = apartarFueraDeRango(tipo, documento);
    for (const { tramos, valor } of apartadas) avisos.push(`${tramos.join('.')} fuera del rango del contrato: ${valor}`);
    return apartado;
}

/**
 * Un bloque por ventana del canónico, más la cifra del fondo que el proveedor daba y la serie desplazó aunque no llegue a esa ventana
 * (decisión 110 de Óscar, 05-11-2026). En el extractor el desplazamiento es por bloque, a propósito, y lo desplazado queda entero en
 * `meta.contraste`: lo que no se recuperaba era esto, porque aquí solo se miraban las rutas que el canónico aún traía. Allianz AT2
 * se quedaba sin sus 2,98, 2,18 y 0,95 % a 3, 5 y 10 años, y 538 fondos sin el Sharpe a 10 años, donde no hay €STR con el que calcular el nuestro.
 */
function conLoDesplazado(fuente: unknown, rutaBase: string, contraste: Record<string, unknown>): Record<string, unknown> {
    const salida: Record<string, unknown> = { ...obj(fuente) };
    for (const [ruta, entrada] of Object.entries(contraste)) {
        if (!ruta.startsWith(`${rutaBase}.`) || !ruta.endsWith('.fondo')) continue;
        const ventana = ruta.slice(rutaBase.length + 1, -'.fondo'.length);
        const porSujeto = obj(salida[ventana]);
        if (porSujeto['fondo'] === undefined) salida[ventana] = { ...porSujeto, fondo: obj(entrada)['valor'] };
    }
    return salida;
}

/**
 * Mapea un instrumento entero. `ahora` entra como argumento para que la función sea pura y
 * las pruebas puedan fijarlo.
 */
/** El reparto por clase de activo, ya cerrado, y cómo se cerró. */
interface RepartoDeActivos {
    mezcla: Record<string, unknown> | undefined;
    completado: 'REPORTED' | 'IMPLIED_BY_SUM' | undefined;
    /** Por qué no hay reparto, cuando no lo hay y se sabe decir mejor que «no suma 1». */
    sinReparto?: string;
}

/**
 * Las CUATRO clases que el canónico reparte. `alternative` y `real_asset` son una partición
 * más fina que esta fuente no da: se quedan ausentes, no a cero.
 */
/**
 * Cuantas posiciones caben en `declared/holdings.top`. Es el `maxItems` que declara
 * `instrument-declared-holdings.v2`, y esta aqui para que el mapper no emita una lista que el
 * contrato rechaza.
 */
const POSICIONES_DEL_TOP = 25;

const CUATRO_CLASES = ['equity', 'fixed_income', 'cash', 'other'] as const;

/**
 * El reparto por clase de activo. Está aquí, y no dentro del mapeo, porque lo necesitan DOS
 * sitios: `declared/exposure`, que es su destino, y la clase de activo de la raíz, que se
 * decide antes. Repetir el cálculo era la otra salida, y en este fichero ya hay escrito lo que
 * cuesta: el día que creciera uno, el otro se quedaría corto.
 *
 * Y cuando faltan algunas de las cuatro hay dos casos que NO son el mismo:
 *  - lo declarado suma 1 → las que faltan son cero POR ARITMÉTICA, y se completan diciéndolo
 *    (`IMPLIED_BY_SUM`). Eso no es suponer: la partición ya está cerrada.
 *  - lo declarado no suma 1 → no hay reparto. No se completa con ceros, porque un cero en un
 *    reparto afirma que el fondo no tiene nada de esa clase.
 *
 * Desde el 21-11-2026 (decisión C-29 de Óscar) el reparto es el NETO del proveedor, que suma 1: una
 * clase negativa (un corto, liquidez prestada) o por encima de 1 (apalancamiento) entra con su cifra.
 * Hasta ese día una clase que se salía de 0-1 más de un punto dejaba al fondo sin reparto aunque el
 * reparto cuadrase, y eran 95 fondos del canónico del 17-11; los 95 sumaban 1 y los 95 lo recuperan.
 *
 * Lo que sigue sin dejar reparto: lo que no suma 1 con la tolerancia, lo que no trae números, las
 * cuatro clases a cero y una clase que se sale de los TOPES del contrato (de -5 a 6), que ya no es un
 * reparto neto sino un error de unidades. Esa clase no es una clase sin declarar: hasta el 05-11-2026
 * se trataba como tal, y 52 fondos entraban con su negativo escrito como un cero y las demás sumando
 * de más.
 */
/**
 * ¿Es un reparto neto con cortos o apalancamiento? Lo es si una clase queda por debajo de 0 o por encima de 1 más allá
 * del punto de redondeo y descubierto de tesorería que ya admitía la A-63 (`TOLERANCIA_DEL_REPARTO`): un -0,08 % de
 * Lazard no es una posición corta. Lo usan la clase de la raíz, que no se deduce de un reparto así, y los mapas de la
 * renta variable, que en un fondo así se escriben con la misma regla que tenían cuando no había reparto.
 */
export function esRepartoNeto(mezcla: Record<string, unknown> | undefined): boolean {
    if (mezcla === undefined) return false;
    return Object.values(mezcla).some(
        (valor) => typeof valor === 'number' && (valor < -TOLERANCIA_DEL_REPARTO || valor > 1 + TOLERANCIA_DEL_REPARTO)
    );
}

function repartoDeActivos(exposicion: Record<string, unknown>, avisos: string[]): RepartoDeActivos {
    const asignacion = obj(exposicion['asset_mix']);
    const fuera = ['equity', 'bond', 'cash', 'other'].filter(
        (clave) => num(asignacion[clave]) !== undefined && pesoDeClase(asignacion[clave]) === undefined
    );
    if (fuera.length > 0) {
        avisos.push(`asset_mix con una clase fuera de rango: ${fuera.map((clave) => `${clave} ${String(asignacion[clave])}`).join(', ')}`);
        const topes = rangoDe(TIPO_EXPOSICION, 'asset_mix.equity');
        return {
            mezcla: undefined,
            completado: undefined,
            sinReparto: `una clase se sale de los topes del contrato, de ${String(topes?.minimum)} a ${String(topes?.maximum)}: no es un reparto neto, es un error de unidades`
        };
    }
    const mezcla = limpiar({
        /* El canónico llama `bond` a la renta fija y no trae `real_asset`; aquí van con el
           nombre del contrato, y lo que no viene se queda ausente en vez de salir a cero.
           Un cero en un reparto es una afirmación: dice "no tiene nada de esto". */
        equity: pesoDeClase(asignacion['equity']),
        fixed_income: pesoDeClase(asignacion['bond']),
        cash: pesoDeClase(asignacion['cash']),
        alternative: pesoDeClase(asignacion['alternative']) ?? pesoDeClase(exposicion['alternatives']),
        real_asset: pesoDeClase(asignacion['real_asset']),
        other: pesoDeClase(asignacion['other'])
    });
    if (mezcla === undefined) return { mezcla: undefined, completado: undefined, sinReparto: 'el proveedor no trae numeros del reparto por clases' };

    const presentes = CUATRO_CLASES.filter((clave) => clave in mezcla);
    /*
     * Las cuatro clases a cero no son un fondo vacío: son un reparto que el proveedor no ha dado (Óscar, 21-11-2026). El
     * canónico las rellena con ceros cuando el extractor no trae la asignación (`asset_allocation_unavailable`). Ya se
     * quedaba sin reparto por no sumar 1; esto lo dice por su nombre, como regla y no por ISIN. Medido sobre el canónico
     * del 17-11-2026: 3 instrumentos, ES0132526031, LU1814994353 e IE00B4ND3602.
     */
    if (presentes.length === CUATRO_CLASES.length && presentes.every((clave) => Number(mezcla[clave]) === 0)) {
        avisos.push('asset_mix con las cuatro clases a 0: el proveedor no da el reparto');
        return { mezcla: undefined, completado: undefined, sinReparto: 'las cuatro clases llegan a 0: el reparto no se conoce, y no se escriben ceros' };
    }
    const suma = presentes.reduce((total, clave) => total + Number(mezcla[clave] ?? 0), 0);
    if (Math.abs(suma - 1) > TOLERANCIA_DEL_REPARTO) {
        /* Vale igual con las cuatro clases que con dos: si no suma 1, no es un reparto. Un
           reparto que suma 0,80 deja sin contar el 20 % del fondo, y escribirlo como si fuera
           la partición completa hace que cualquier gráfico lo normalice y muestre una
           composición que no es la del fondo. La primera versión solo comprobaba la suma
           cuando faltaban clases, y dejó pasar 58 de estos. */
        avisos.push(`asset_mix que no suma 1: ${suma.toFixed(5)} con ${presentes.length} clases`);
        return { mezcla: undefined, completado: undefined };
    }
    if (presentes.length === CUATRO_CLASES.length) return { mezcla, completado: 'REPORTED' };
    const completa = { ...mezcla };
    for (const clave of CUATRO_CLASES) if (!(clave in completa)) completa[clave] = 0;
    return { mezcla: completa, completado: 'IMPLIED_BY_SUM' };
}

/**
 * Cuánto tiene que pesar una clase para que el fondo SEA de esa clase, y cuánto tienen que
 * sumar dos para que sea mixto. Son dos juicios con valor por defecto, como los de las
 * aptitudes, y cambiarlos cambia lo que la base afirma de un fondo: van con nombre para que se
 * puedan discutir, no escondidos en un `if`.
 */
const PESO_PARA_SER_DE_UNA_CLASE = 0.8;

/** El peso mínimo de renta fija, convertibles incluidos, para escribir sus tres mapas. Vive en `aplicabilidad.ts`. */
export { UMBRAL_DE_RENTA_FIJA_DE_SUS_MAPAS };

/**
 * El `x-applies-when` de `bond_types`, `duration_buckets` y `credit_buckets` en `instrument-declared-exposure.v2`. El
 * mapper decide con él, y una prueba comprueba que es el que declara el contrato: si uno cambia sin el otro, falla.
 */
export const PREDICADO_DE_LOS_MAPAS_DE_RENTA_FIJA = 'CON_RENTA_FIJA_NO_RESIDUAL';

/**
 * Los rasgos con los que se decide si se escriben `bond_types`, `duration_buckets` y `credit_buckets`: los mismos que
 * leerá de la base el predicado `CON_RENTA_FIJA_NO_RESIDUAL` de su contrato —el reparto que se escribe y la categoría de
 * la raíz— más el peso propio de los convertibles del registro universal (`cartera.asignacion_activos.convertibles.neto`,
 * en por ciento), que la base no guarda. La regla no está aquí: está en `pesoDeRentaFijaConConvertibles`, una sola vez.
 */
function rasgosParaLosMapasDeRentaFija(
    mezcla: Record<string, unknown> | undefined,
    asignacionDelExtractor: Record<string, unknown>,
    categoria: string | undefined
): RasgosDelInstrumento {
    const propio = num(obj(asignacionDelExtractor['convertibles'])['neto']);
    return {
        instrument_type: 'FUND',
        asset_mix: mezcla as Record<string, number> | undefined,
        category: categoria,
        convertibles: propio === undefined ? undefined : propio / 100
    };
}

/**
 * Cuánto pesa la renta fija a efectos de escribir sus tres mapas, con los convertibles (Óscar, 21-11-2026). Sin reparto,
 * 0. Es `pesoDeRentaFijaConConvertibles` con lo que trae el canónico; se queda con este nombre porque lo leen las pruebas.
 */
export function pesoDeRentaFijaDeSusMapas(
    mezcla: Record<string, unknown> | undefined,
    asignacionDelExtractor: Record<string, unknown>,
    categoria: string | undefined
): number {
    return pesoDeRentaFijaConConvertibles(rasgosParaLosMapasDeRentaFija(mezcla, asignacionDelExtractor, categoria)) ?? 0;
}
const PESO_MINIMO_DE_LA_SEGUNDA = 0.1;

/**
 * La clase de activo deducida del reparto, cuando el proveedor no la dice.
 *
 * Por qué existe, medido el 02-11-2026: `LU2504555777` llega con
 * `classification_v2.asset_type: "other"` **y** con su propio reparto declarando 95,6 % de
 * renta variable, reportado y con confianza 0,9. Las dos cosas son del mismo proveedor y se
 * contradicen. Cargarlo como OTHER es fiel al campo y falso sobre el fondo: era el unico
 * OTHER de 1.077, y la radiografia de una cartera lo pintaba en «otros» siendo renta variable.
 *
 * Solo se deduce desde OTHER, que es el cajon de sastre. Una clase que el proveedor afirma no
 * se discute con una deduccion nuestra: si dice FIXED_INCOME y el reparto dice otra cosa, eso
 * es una discrepancia que hay que mirar, no un valor que haya que corregir por detras.
 */
function claseSegunElReparto(reparto: RepartoDeActivos): string | undefined {
    const mezcla = reparto.mezcla;
    if (mezcla === undefined) return undefined;
    /* Un reparto neto con cortos o apalancamiento (C-29) no dice de qué clase es el fondo: un 246 % de liquidez con la
       bolsa a -188 % no es un monetario, es un fondo que vende bolsa. Ahí manda lo que diga el proveedor, aunque sea OTHER.
       Medido el 21-11-2026 sobre el canónico del 17-11: ninguno de los 95 fondos con reparto neto llega como OTHER. */
    if (esRepartoNeto(mezcla)) return undefined;
    const peso = (clave: string): number => Number(mezcla[clave] ?? 0);

    const dominantes: Readonly<Record<string, string>> = {
        equity: 'EQUITY',
        fixed_income: 'FIXED_INCOME',
        cash: 'CAPITAL_PRESERVATION'
    };
    for (const [clave, clase] of Object.entries(dominantes)) {
        if (peso(clave) >= PESO_PARA_SER_DE_UNA_CLASE) return clase;
    }
    const variable = peso('equity');
    const fija = peso('fixed_income');
    if (
        variable + fija >= PESO_PARA_SER_DE_UNA_CLASE &&
        Math.min(variable, fija) >= PESO_MINIMO_DE_LA_SEGUNDA
    ) {
        return 'ALLOCATION';
    }
    return undefined;
}

/*
 * POR QUÉ no hay métricas propias, leído del motivo que dejó el extractor en vez de supuesto.
 *
 * Hasta el 03-11-2026 los dos sitios que registran esta ausencia escribían `NOT_YET_FETCHED`
 * **siempre**, y el comentario de uno de ellos ya nombraba el motivo real —«las clases donde el
 * extractor se negó a calcular»—, así que el código sabía más que la etiqueta que escribía.
 *
 * Medido ese día sobre la base: la razón era falsa en **137 de los 149** instrumentos sin
 * métricas. `NOT_YET_FETCHED` no es una ausencia cualquiera: su glosa dice «la fuente lo tiene
 * y todavía no lo hemos traído», o sea afirma algo **sobre la fuente**, y de eso no había
 * prueba en ninguno de los 137.
 *
 * Y la etiqueta no es cosmética, porque las tres se deciden al contrario: «aún no pedido» es
 * trabajo pendiente, «no facilitado» es un techo de la fuente y «no aplica» no es nada que
 * arreglar. Publicar la primera cuando la verdad es la segunda promete un dato que no va a
 * llegar.
 *
 * El vocabulario de motivos del extractor está **medido y es cerrado** (03-11-2026, sobre las
 * 1.092 filas de `export/fondos.ndjson`): `sin_metricas_historial_repartos` 46,
 * `sin_metricas_nombre_reparto` 30, `sin_metricas_politica_desconocida` 1, y `aviso_vl`
 * `serie_parada` 17. Un motivo que no esté en esta tabla NO se convierte en etiqueta: se anota
 * como pérdida, para que aparezca en el plan y en la auditoría en vez de disfrazarse de razón.
 */
export interface RazonDeAusencia {
    razon: Ausencia;
    detalle: string;
    motivo: MotivoSinMetricas;
}

export const MOTIVOS_DEL_EXTRACTOR: Readonly<Record<string, RazonDeAusencia>> = {
    /* La clase reparte: su VL cae al pagar, y el método mensual presupone retorno total. Con
       ESTE método no hay cifra que dar, y reponerla exigiría todos los pagos de la ventana con
       sus fechas e importes, que la fuente no entrega. */
    sin_metricas_historial_repartos: {
        motivo: 'DISTRIBUTES',
        razon: 'NOT_APPLICABLE',
        detalle:
            'la clase reparte y el metodo mensual presupone un VL de retorno total: no hay ' +
            'cifra que dar sin todos los pagos de la ventana'
    },
    /* Lo mismo, pero dicho por el KID de la clase y no por sus pagos. */
    sin_metricas_kid_distribucion: {
        motivo: 'DISTRIBUTES',
        razon: 'NOT_APPLICABLE',
        detalle:
            'el KID de la clase dice que reparte y el metodo mensual presupone un VL de retorno ' +
            'total: no hay cifra que dar sin todos los pagos de la ventana'
    },
    /* Aquí `NOT_YET_FETCHED` sí es verdad, y es el único grupo donde lo es: el cálculo se paró
       por el NOMBRE, y la política de la clase está en su KID. La fuente la tiene y no ha
       entrado en el canónico. Medido el 03-11: de 30 así, 26 acumulan y estaban bloqueadas sin
       motivo. */
    sin_metricas_nombre_reparto: {
        motivo: 'POLICY_PENDING',
        razon: 'NOT_YET_FETCHED',
        detalle:
            'el calculo se detuvo por el nombre de la clase, y su politica de reparto consta ' +
            'en su KID: la fuente la tiene y no ha entrado en el canonico'
    },
    /* El BCE no entrego el cambio de esa moneda en la pasada. Lo tiene y falta traerlo. */
    sin_metricas_sin_cambio: {
        motivo: 'NEEDS_FX',
        razon: 'NOT_YET_FETCHED',
        detalle: 'falta el cambio del BCE con el que llevar la serie a euros'
    },
    sin_metricas_politica_desconocida: {
        motivo: 'POLICY_UNKNOWN',
        razon: 'NOT_PROVIDED',
        detalle: 'ninguna fuente consultada declaro la politica de reparto de la clase'
    }
};

/*
 * Los productos para los que NINGUNA rama del extractor calcula hoy. No es que la fuente no
 * dé la serie: la da, y nadie calcula sobre ella. Hoy solo es el ETC. Desde el 04-11-2026 los ETF
 * se miden sobre su precio de mercado, y uno que llegue aquí con serie y sin cifras tampoco tiene
 * un hueco de la fuente, así que sigue en la lista.
 *
 * Por eso aquí la razón NO puede ser «la fuente no lo da»: diría que falta un dato que está.
 * Es «no aplica» **al método que hay**, y el detalle lo dice entero para que nadie lo lea como
 * un hueco de la fuente.
 */
const SIN_VIA_DE_CALCULO: ReadonlySet<string> = new Set(['ETF', 'OTHER']);

export function razonSinMetricasPropias(
    historial: Record<string, unknown>,
    tipo: string | undefined,
    perdidas: string[]
): RazonDeAusencia {
    const aviso = txt(historial['aviso_metricas']);
    if (aviso !== undefined) {
        const conocido = MOTIVOS_DEL_EXTRACTOR[aviso];
        if (conocido !== undefined) return conocido;
        /* Un motivo nuevo no se traduce a ciegas: se nombra. Es la diferencia entre no saber y
           afirmar. */
        perdidas.push(`riesgo.historial_precios.aviso_metricas = ${aviso}, sin clasificar`);
        return {
            motivo: 'UNIDENTIFIED_SERIES',
            razon: 'NOT_PROVIDED',
            detalle: `el extractor no calculo ninguna ventana y su motivo (${aviso}) no esta clasificado`
        };
    }

    const avisoVl = txt(historial['aviso_vl']);
    if (avisoVl !== undefined && avisoVl.startsWith('serie_parada')) {
        return {
            motivo: 'SERIES_STOPPED',
            razon: 'NOT_PROVIDED',
            detalle: `la fuente dejo de servir la serie: ${avisoVl}`
        };
    }

    /* Sin motivo escrito, lo que queda es la serie. Cero observaciones es que la fuente no
       entregó nada —un 404, o un 200 con el cuerpo vacío, que son los dos casos medidos— y eso
       sí es techo de la fuente, no una petición pendiente. */
    const observaciones = num(historial['observations_count']);
    if (observaciones === undefined || observaciones === 0) {
        return {
            motivo: 'NO_PRICES',
            razon: 'NOT_PROVIDED',
            detalle: 'la fuente no entrego serie de precios'
        };
    }
    const cuantas = String(Math.trunc(observaciones));
    /* Con serie y sin cálculo, la razón depende de si para este producto HAY cálculo. */
    if (tipo !== undefined && SIN_VIA_DE_CALCULO.has(tipo)) {
        return {
            motivo: 'NO_METHOD',
            razon: 'NOT_APPLICABLE',
            detalle: `serie de ${cuantas} observaciones y ninguna via de calculo publicada para este producto`
        };
    }
    return {
        motivo: 'SHORT_HISTORY',
        razon: 'NOT_PROVIDED',
        detalle: `serie de ${cuantas} observaciones: no alcanza la ventana mas corta`
    };
}

export function mapearInstrumento(
    ficha: FichaCanonica,
    universal: RegistroUniversal,
    ahora: string
): ResultadoDeMapeo {
    /*
     * Una ACCION se mapea aparte, y no es una comodidad: es que casi nada de lo que sigue le
     * aplica. De los doce bloques `declared/*` de un fondo, una accion no tiene diez —no hay
     * TER, ni posiciones, ni politica de reparto de clase, ni SRI de un KID que no existe— y
     * los dos que comparte, la procedencia y el precio, son genericos. Meter el tipo en las
     * veinte decisiones de abajo habria dejado una funcion donde cada rama hay que leer dos
     * veces para saber a quien le toca, y sobre todo habria puesto los 772 fondos que ya estan
     * escritos y verificados a merced de un `if` mal puesto.
     */
    if (TIPO_PRODUCTO[String(obj(universal['identificacion'])['tipo_producto'])] === 'STOCK') {
        return mapearAccion(ficha, universal, ahora);
    }

    const ausencias: AusenciaAnotada[] = [];
    const perdidas: string[] = [];
    const avisos: string[] = [];
    const errores: string[] = [];
    const documentos: DocumentoMapeado[] = [];

    const isin = txt(ficha['isin']) ?? txt(universal['_id']) ?? '';
    const vacio: ResultadoDeMapeo = { instrument_id: isin, documentos, ausencias, perdidas, avisos, errores };

    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
        errores.push(`el ISIN no tiene forma de ISIN: ${JSON.stringify(isin)}`);
        return vacio;
    }

    /**
     * Un valor numérico solo entra si cabe en el rango que el CONTRATO declara para su
     * ruta. El rango se lee del contrato, no se repite aquí: si estuviera en los dos
     * sitios, el día que cambiara uno tendríamos dos verdades.
     *
     * La regla: un mapper no emite nunca un valor que el contrato rechaza. Si el canónico
     * trae uno, se queda fuera y se cuenta como aviso, en vez de tirar el documento entero
     * por un campo. Medido el 01-11: 8 valores de renta fija y 1 de costes caen aquí.
     */
    const siCabe = (tipo: string, ruta: string, valor: number | undefined): number | undefined => {
        if (valor === undefined) return undefined;
        if (enRango(tipo, ruta, valor)) return valor;
        avisos.push(`${ruta} fuera del rango del contrato: ${valor}`);
        return undefined;
    };

    const identificacion = obj(universal['identificacion']);
    const regulatory = obj(ficha['regulatory']);
    const ms = obj(ficha['ms']);
    const exposicion = obj(ficha['portfolio_exposure_v2']);
    const clasificacion = obj(ficha['classification_v2']);
    const riesgo = obj(universal['riesgo']);
    const rentabilidad = obj(universal['rentabilidad']);
    const costes = obj(universal['costes']);
    const valoracion = obj(universal['valoracion']);

    /* ---- la raíz ---- */

    let tipo: string;
    try {
        tipo = traducir(TIPO_PRODUCTO, 'tipo_producto', identificacion['tipo_producto']);
    } catch (error) {
        errores.push(error instanceof TraduccionDesconocida ? error.message : String(error));
        return vacio;
    }

    let claseDeActivo: string | undefined;
    const claseBruta = txt(identificacion['clase_activo']) ?? txt(clasificacion['asset_type']);
    if (claseBruta === undefined) {
        errores.push('sin clase de activo en ninguna de las dos ortografias del canonico');
        return vacio;
    }
    try {
        claseDeActivo = traducir(CLASE_ACTIVO, 'clase_activo', claseBruta);
    } catch (error) {
        errores.push(error instanceof TraduccionDesconocida ? error.message : String(error));
        return vacio;
    }

    /* El reparto se calcula aquí, antes de la raíz, porque la clase de activo lo necesita.
       Su destino sigue siendo `declared/exposure`, más abajo, con este mismo resultado. */
    const reparto = repartoDeActivos(exposicion, avisos);
    let resolucionDeLaClase = 'PROVIDER';
    if (claseDeActivo === 'OTHER') {
        const deducida = claseSegunElReparto(reparto);
        if (deducida !== undefined) {
            claseDeActivo = deducida;
            resolucionDeLaClase = 'DERIVED_FROM_ASSET_MIX';
            avisos.push(
                `clase de activo deducida del reparto: el proveedor dice "other" y su propio reparto dice ${deducida}`
            );
        }
    }

    const nombre = txt(ficha['name']) ?? txt(identificacion['nombre']);
    if (nombre === undefined) {
        errores.push('sin nombre');
        return vacio;
    }

    /* El valor liquidativo trae la suya: `ES0132526031` no declara otra, y sin esto no entraba. */
    const divisa =
        txt(ficha['currency']) ?? txt(identificacion['divisa_base']) ?? txt(valoracion['vl_divisa']);
    if (divisa === undefined || !/^[A-Z]{3}$/.test(divisa)) {
        errores.push(`sin divisa utilizable: ${JSON.stringify(divisa)}`);
        return vacio;
    }

    const categoria = txt(ms['category_morningstar']) ?? txt(identificacion['categoria_morningstar']);
    if (categoria === undefined) {
        ausencias.push({ ruta: 'classification.category', razon: 'NOT_PROVIDED' });
    }

    /* Solo la estrella entera de 1 a 5. Cualquier otra cosa se trata como que no la hay: una
       estrella inventada o redondeada es peor que no enseñarla. */
    const estrellasCrudas = ms['rating_stars'];
    const estrellas =
        typeof estrellasCrudas === 'number' && Number.isInteger(estrellasCrudas) && estrellasCrudas >= 1 && estrellasCrudas <= 5
            ? estrellasCrudas
            : undefined;
    if (estrellas === undefined) {
        ausencias.push({ ruta: 'classification.morningstar_rating', razon: 'NOT_PROVIDED' });
    }

    const nombreIndice = txt(identificacion['indice_benchmark_oficial']) ?? txt(clasificacion['official_benchmark']);
    /*
     * La divisa y la variante se LEEN del nombre del índice, y eso no es lo mismo que deducir
     * la política de distribución del nombre de un fondo. `MSCI Europe NR EUR` es el nombre
     * del índice: `NR` y `EUR` son los sufijos oficiales que lo distinguen de
     * `MSCI Europe GR USD`, que es otro índice. Lo que sale viaja con `resolution` para que no
     * se confunda con un dato declarado por la fuente.
     */
    const indice = nombreIndice === undefined ? undefined : leerIndice(nombreIndice);
    if (indice === undefined) {
        ausencias.push({ ruta: 'classification.official_benchmark', razon: 'NOT_PROVIDED' });
    } else {
        if (indice.currency === undefined) {
            ausencias.push({
                ruta: 'classification.official_benchmark.currency',
                razon: 'NOT_PROVIDED',
                detalle: 'el nombre del indice no la nombra'
            });
        }
        if (indice.variant === undefined) {
            ausencias.push({
                ruta: 'classification.official_benchmark.variant',
                razon: 'NOT_PROVIDED',
                detalle: 'el nombre del indice no la nombra; suele pasar cuando no es un indice sino un tipo'
            });
        }
    }

    let domicilio: string | undefined;
    const domicilioBruto = txt(identificacion['domicilio']) ?? txt(regulatory['domicile']);
    if (domicilioBruto !== undefined) {
        try {
            domicilio = traducir(DOMICILIO, 'domicilio', domicilioBruto);
        } catch (error) {
            avisos.push(error instanceof TraduccionDesconocida ? error.message : String(error));
        }
    }

    const firds = identidadFirds(ficha, avisos);
    const raiz = limpiar({
        instrument_id: isin,
        instrument_type: tipo,
        schema_version: 'base-nueva.instrument.v2',
        updated_at: ahora,
        identity: {
            name: nombre,
            name_folded: plegar(nombre),
            currency: divisa
        },
        identifiers: {
            ticker: txt(en(ficha, 'identifiers', 'ticker')),
            figi: undefined,
            cfi: firds.cfi,
            lei: firds.lei
        },
        classification: limpiar({
            category: categoria,
            morningstar_rating: estrellas,
            asset_class: claseDeActivo,
            asset_class_resolution: resolucionDeLaClase,
            official_benchmark: indice
        }),
        product:
            domicilio === undefined
                ? undefined
                : limpiar({
                      domicile: domicilio,
                      legal_structure: txt(identificacion['marco_legal']) ?? txt(regulatory['legal_framework']),
                      replication: replicaDelProveedor(identificacion['replicacion'], avisos),
                      inception_date:
                          fecha(identificacion['fecha_lanzamiento_clase']) ?? fecha(regulatory['launch_date_class']),
                      share_class: undefined
                  }),
        listings: firds.listings,
        listings_as_of: firds.listings_as_of,
        availability: disponibilidad(ficha, avisos)
    });
    if (raiz === undefined) {
        errores.push('la raiz ha salido vacia');
        return vacio;
    }
    if (domicilio === undefined) {
        ausencias.push({ ruta: 'product', razon: 'NOT_PROVIDED', detalle: 'sin domicilio traducible' });
    }
    documentos.push({ ruta: `instruments/${isin}`, tipo: 'instrument.v2.schema.json', documento: raiz });

    /* ---- declared/profile ---- */

    const fechaFicha = fecha(ms['report_date']) ?? fecha(ficha['report_date']) ?? fecha(identificacion['fecha_dato']);
    const sfdrBruto = txt(regulatory['sfdr_article']);
    /*
     * La política de distribución, con el grado de evidencia al lado. El canónico SÍ la trae
     * en parte y la primera versión de este mapper la tiraba: 19 fondos la tienen del registro
     * oficial francés y 11 más la prueban con el rendimiento repartido de los últimos doce
     * meses. Lo que no se resuelve sigue en UNKNOWN, que es la respuesta honesta.
     */
    /* El bloque de repartos del canónico, que desde el 01-11 trae el historial de pagos.
       Se lee una sola vez y sirve a dos sitios: resuelve la política aquí y se publica
       entero en `declared/distributions` más abajo. */
    const repartos = obj(universal['distribuciones']);
    const pagosCrudos = Array.isArray(repartos['historial']) ? repartos['historial'] : [];
    const historialConsultado =
        typeof repartos['historial_consultado'] === 'boolean'
            ? (repartos['historial_consultado'] as boolean)
            : undefined;
    const distribucion = resolverDistribucion({
        politicaDelKid: txt(en(universal, 'documentos_oficiales', 'kid_politica')),
        politicaDeclarada: txt(identificacion['politica_distribucion']),
        rendimiento12m: num(en(universal, 'distribuciones', 'yield_12m_pct')),
        repartosConImporte: pagosCrudos.filter(
            (p) => (num(obj(p)['importe_por_participacion']) ?? 0) > 0
        ).length,
        historialConsultado
    });
    const perfil = limpiar({
        ...(sobre('canonical:fondosdb', fechaFicha) ?? {}),
        /* Decidido el 01-11: obligatorio, y UNKNOWN es un valor válido, porque obligatorio
           significa declararlo y no conocerlo. Y NUNCA se deduce del nombre del fondo: por
           nombre salen 258 Acc y 46 Dis/Inc, y 540 de 844 no dicen nada. */
        distribution_policy: distribucion.policy,
        distribution_policy_resolution: distribucion.resolution,
        objective: textoLimpio(ms['objective']) ?? textoLimpio(identificacion['estrategia_inversion_texto']),
        sfdr_article: sfdrBruto === undefined ? undefined : SFDR[sfdrBruto],
        hedged_class: typeof identificacion['clase_cubierta'] === 'boolean' ? identificacion['clase_cubierta'] : undefined
    });
    if (perfil !== undefined && fechaFicha !== undefined) {
        documentos.push({
            ruta: `instruments/${isin}/declared/profile`,
            tipo: 'instrument-declared-profile.v2.schema.json',
            documento: perfil
        });
        if (distribucion.policy === 'UNKNOWN') {
            ausencias.push({
                ruta: 'declared/profile.distribution_policy',
                razon: 'NOT_PROVIDED',
                detalle:
                    'declarado UNKNOWN: ni el registro oficial ni un rendimiento repartido, y no se deduce del nombre'
            });
        }
        if (sfdrBruto !== undefined && SFDR[sfdrBruto] === undefined) {
            avisos.push(`sfdr_article desconocido: ${sfdrBruto}`);
        }
    } else {
        ausencias.push({ ruta: 'declared/profile', razon: 'NOT_PROVIDED', detalle: 'sin fecha de ficha' });
    }

    /* ---- declared/costs ---- */

    const TIPO_COSTES = 'instrument-declared-costs.v2.schema.json';
    const kid = obj(regulatory['kid']);
    /*
     * Manda el KID, con su fecha, y donde no lo haya, el proveedor: decisión 43 de Óscar, 05-11-2026.
     * Cifra a cifra y no fondo a fondo, porque un KID puede dar el coste corriente y dar la entrada
     * solo en euros (PIMCO: «492 EUR»), y por eso cada cifra lleva su fuente: un enlace al KID no prueba
     * que una cifra salga de él. Hasta este día aquí iba ese enlace junto a un coste de operación y
     * una entrada que eran del proveedor. Sin documento que citar, lo que traiga no cuenta como KID.
     */
    const delKid = txt(kid['url']) !== undefined && huella(kid['sha256']) !== undefined ? obj(kid['costs']) : {};
    const laCifra = (ruta: string, enElKid: unknown, delProveedor: number | undefined): Record<string, unknown> => {
        const delDocumento = siCabe(TIPO_COSTES, ruta, frac(enElKid));
        if (delDocumento !== undefined) return { [ruta]: delDocumento, [`${ruta}_source`]: 'KID' };
        const delTercero = siCabe(TIPO_COSTES, ruta, delProveedor);
        return delTercero === undefined ? {} : { [ruta]: delTercero, [`${ruta}_source`]: 'PROVIDER' };
    };
    /* Un fondo no cuesta cero. Un 0 % en esa fila solo puede ser una mala lectura, y un cero creíble es lo peor que puede salir de aquí. */
    const corrienteDelKid = num(delKid['management_and_other_pct']);
    const corriente = laCifra(
        'ongoing_charge',
        corrienteDelKid !== undefined && corrienteDelKid > 0 ? corrienteDelKid : undefined,
        frac(costes['ter_pct']) ?? frac(en(ms, 'costs', 'ter'))
    );
    const costesDoc = limpiar({
        ...(sobre('canonical:fondosdb', fechaFicha) ?? {}),
        document_url: txt(kid['url']),
        sha256: huella(kid['sha256']),
        /* La del propio documento, si se ha podido leer. No se sustituye por otra: 17 no la tienen, y lo dicen. */
        document_date: fecha(kid['date']),
        ...corriente,
        management_fee: siCabe(
            TIPO_COSTES,
            'management_fee',
            frac(costes['comision_gestion_aplicada_pct']) ?? frac(en(ms, 'costs', 'management_fee'))
        ),
        ...laCifra('entry_charge', delKid['entry_pct'], frac(costes['comision_suscripcion_max_pct'])),
        exit_charge: siCabe(TIPO_COSTES, 'exit_charge', frac(costes['comision_reembolso_max_pct'])),
        ...laCifra('transaction_costs', delKid['transaction_pct'], frac(en(costes, 'mifid_emt_exante', 'transaccion_pct')))
    });
    if (corriente['ongoing_charge'] !== undefined && costesDoc !== undefined && fechaFicha !== undefined) {
        documentos.push({
            ruta: `instruments/${isin}/declared/costs`,
            tipo: 'instrument-declared-costs.v2.schema.json',
            documento: costesDoc
        });
    } else {
        ausencias.push({
            ruta: 'declared/costs.ongoing_charge',
            razon: 'NOT_PROVIDED',
            detalle: 'el coste corriente es uno de los tres campos irreducibles'
        });
    }

    /* ---- declared/regulatory ---- */

    const urlKid = txt(kid['url']);
    const huellaKid = huella(kid['sha256']);
    const fechaKid = fecha(kid['date']);
    const sri = num(regulatory['sri']) ?? num(riesgo['sri_kid_1a7']);
    const hayEvidencia = urlKid !== undefined && huellaKid !== undefined && fechaKid !== undefined;
    const evidenciaIsin = urlKid !== undefined && urlKid.toLowerCase().includes(isin.toLowerCase()) ? 'DOCUMENT_URL' : 'NONE';
    /*
     * El periodo de mantenimiento recomendado del KID (`regulatory.kid.recommended_holding_years`, que el extractor lee del PDF en
     * `riesgo.kid_periodo_mantenimiento_anos`). Con la misma regla que el SRI: se cita como del KID, así que solo va con documento,
     * huella y fecha. Un 0 no es un plazo: aviso y fuera, porque el contrato pide más de 0 y un documento entero no se pierde por él.
     */
    const anosDelKid = num(kid['recommended_holding_years']);
    if (anosDelKid !== undefined && anosDelKid <= 0) avisos.push(`regulatory.kid.recommended_holding_years no es un plazo: ${anosDelKid}`);
    const mantenimiento =
        hayEvidencia && anosDelKid !== undefined && anosDelKid > 0
            ? siCabe('instrument-declared-regulatory.v2.schema.json', 'recommended_holding_years', anosDelKid)
            : undefined;
    const reg = limpiar({
        ...(sobre('canonical:fondosdb', fechaFicha) ?? {}),
        sri: hayEvidencia && sri !== undefined ? Math.trunc(sri) : undefined,
        srri: num(regulatory['srri']) === undefined ? num(riesgo['srri_1a7']) : num(regulatory['srri']),
        recommended_holding_years: mantenimiento,
        kid_evidence: hayEvidencia
            ? {
                  document_url: urlKid,
                  sha256: huellaKid,
                  document_date: fechaKid,
                  isin_evidence: evidenciaIsin
              }
            : undefined
    });
    if (reg !== undefined && fechaFicha !== undefined) {
        documentos.push({
            ruta: `instruments/${isin}/declared/regulatory`,
            tipo: 'instrument-declared-regulatory.v2.schema.json',
            documento: reg
        });
    }
    if (sri !== undefined && !hayEvidencia) {
        ausencias.push({
            ruta: 'declared/regulatory.sri',
            razon: 'NOT_PROVIDED',
            detalle: 'hay numero pero no hay documento, huella y fecha detras'
        });
    }
    if (anosDelKid !== undefined && anosDelKid > 0 && !hayEvidencia) {
        ausencias.push({
            ruta: 'declared/regulatory.recommended_holding_years',
            razon: 'NOT_PROVIDED',
            detalle: 'hay plazo del KID pero no hay documento, huella y fecha detras'
        });
    }

    /* ---- declared/exposure ---- */

    const confianza = num(exposicion['exposure_confidence']);
    /* Calculado arriba, antes de la raíz, porque la clase de activo lo necesita. Es el MISMO
       resultado: un solo cálculo con dos lectores. */
    const mezclaFinal = reparto.mezcla;
    const completado = reparto.completado;
    const completa = mezclaFinal !== undefined && completado !== undefined;
    /* Solo si tiene renta variable: un campo presente donde no aplica es un error (decisión 17), y sin
       renta variable no hay a qué peso multiplicar las celdas. Sin reparto, lo dice la cifra del proveedor, aunque
       no se enseñe: el fondo de la India trae 101,6 %, y uno corto, −13,4 %. */
    const conRentaVariable = (completa ? Number(mezclaFinal?.['equity'] ?? 0) : num(obj(exposicion['asset_mix'])['equity']) ?? 0) > 0;
    const cajaDelFondo = conRentaVariable ? cajaDeEstilo(exposicion['equity_style_box'], avisos) : undefined;
    /* Lo de la renta variable, que no depende de que el reparto por clases cuadre (decisión 109 de Óscar, 05-11-2026). */
    /* Y sin reparto, solo si todo el mapa son pesos. `mapaDePesos` salta lo que no lo es, y de un fondo con una zona al 448 %, como BLK
       Systematic, dejaría un 36 % suelto que antes no se enseñaba: son los 13 de hasta 7.646 %, que no se arreglan aquí y no se empeoran. */
    /* Y con un reparto neto (C-29, 21-11-2026), la misma regla que cuando no había reparto: hasta ese día esos 95 fondos no
       lo tenían, y BLK Systematic, que es uno de ellos, dejaría ahora su 36 % suelto. Recuperar el reparto no cambia sus mapas. */
    const entero = (mapa: unknown): boolean => Object.values(obj(mapa)).every((bruto) => num(bruto) === undefined || peso(bruto) !== undefined);
    const sinGuarda = completa && !esRepartoNeto(mezclaFinal);
    const sectores = sinGuarda || entero(exposicion['sectors']) ? mapaDePesos(exposicion['sectors']) : undefined;
    const regiones = sinGuarda || entero(exposicion['equity_regions']) ? mapaDePesos(exposicion['equity_regions']) : undefined;
    const conPeso = (mapa: Record<string, number> | undefined): boolean => Object.values(mapa ?? {}).some((valor) => valor > 0);
    const queda = conPeso(sectores) || conPeso(regiones);
    /*
     * Del reparto ya cerrado, con el nombre del contrato: `bond` es `fixed_income` aquí. Lo leen dos sitios, los
     * tres mapas de renta fija de este bloque y `declared/fixed_income`, y por eso se calcula una vez, aquí arriba.
     *
     * Los tres mapas, solo si hay renta fija (Óscar, 21-11-2026; decisión 17: un campo presente donde no aplica es
     * un error). El contrato ya lo decía —`x-applies-when: CON_RENTA_FIJA`, el mismo predicado y el mismo `> 0`—,
     * pero el mapper los escribía con que el reparto cerrase. Medido el 21-11-2026 sobre la base nueva: 224 fondos
     * y ETF con `fixed_income` 0 llevaban `bond_types`, 148 de ellos `{cash: 1}`, que es el 100 % de nada
     * repartido al efectivo; y la equivalencia de fondos los comparaba en «Tipo de emisor».
     *
     * Y con un umbral, decidido por Óscar el mismo día: los tres, solo si la renta fija pesa al menos un 0,5 % del
     * reparto («los que tienen menos son posiciones residuales, no representativas»), contando como renta fija los
     * convertibles (ver `pesoDeRentaFijaDeSusMapas`). `tieneRentaFija` sigue siendo `> 0`: es lo que decide
     * `declared/fixed_income`, y eso no lo cambia esta decisión.
     *
     * Y se decide con el MISMO predicado que declara su contrato desde el 21-11-2026, `CON_RENTA_FIJA_NO_RESIDUAL`, y con
     * la misma función que lo evalúa al medir la calidad y al auditar la base: así no puede escribirse un mapa que la base
     * llame «presente donde no aplica», ni dejarse uno sin escribir que la calidad cuente como «falta».
     */
    const tieneRentaFija = Number(reparto.mezcla?.['fixed_income'] ?? 0) > 0;
    const rasgosDeSusMapas = rasgosParaLosMapasDeRentaFija(
        completa ? mezclaFinal : undefined,
        obj(en(universal, 'cartera', 'asignacion_activos')),
        categoria
    );
    const pesoParaSusMapas = pesoDeRentaFijaConConvertibles(rasgosDeSusMapas) ?? 0;
    const conRentaFija = aplicaAlInstrumento(PREDICADO_DE_LOS_MAPAS_DE_RENTA_FIJA, rasgosDeSusMapas) === true;
    /*
     * Lo único que la base no puede reproducir: el peso propio de los convertibles, que no se guarda. Si cambia el
     * veredicto, la calidad y la auditoría de la base dirán otra cosa que este mapper, y eso se dice aquí en vez de
     * descubrirlo allí. Medido el 21-11-2026 sobre el canónico del 17-11: no pasa en ninguno de los 1.334.
     */
    const desdeLaBase = aplicaAlInstrumento(PREDICADO_DE_LOS_MAPAS_DE_RENTA_FIJA, { ...rasgosDeSusMapas, convertibles: undefined }) === true;
    if (completa && desdeLaBase !== conRentaFija) {
        avisos.push(
            `mapas de renta fija: el peso propio de los convertibles (${((rasgosDeSusMapas.convertibles ?? 0) * 100).toFixed(2)} %) ` +
                `decide que ${conRentaFija ? 'se escriben' : 'no se escriben'}, y la base, que no lo guarda, dira lo contrario`
        );
    }
    const exposicionDoc = limpiar({
        ...(sobre('canonical:fondosdb', fecha(en(ms, 'portfolio', 'as_of')) ?? fechaFicha) ?? {}),
        asset_mix: completa ? mezclaFinal : undefined,
        asset_mix_completion: completa ? completado : undefined,
        sectors: sectores,
        equity_regions: regiones,
        equity_styles: mapaDePesos(exposicion['equity_styles']),
        market_caps: mapaDePesos(exposicion['market_caps']),
        equity_style_box: cajaDelFondo,
        /* Estos tres son de la renta fija, y la decisión solo conserva lo de la variable. Netos, con su signo, si
           suman 1 (C-31, 21-11-2026): `mapaDeRentaFija`. */
        bond_types: conRentaFija ? mapaDeRentaFija(exposicion['bond_types'], 'bond_types', avisos) : undefined,
        duration_buckets: conRentaFija ? mapaDeRentaFija(exposicion['duration'], 'duration_buckets', avisos) : undefined,
        credit_buckets: conRentaFija ? mapaDeRentaFija(exposicion['credit'], 'credit_buckets', avisos) : undefined,
        confidence: confianza
    });
    if (completa && !conRentaFija) {
        /* Con el reparto cerrado se SABE que no hay renta fija, o que es residual: no aplica, no falta. Sin reparto
           no se sabe, y ahí no se afirma nada (la ausencia de `asset_mix` ya va abajo). */
        for (const ruta of ['bond_types', 'duration_buckets', 'credit_buckets']) {
            ausencias.push({
                ruta: `declared/exposure.${ruta}`,
                razon: 'NOT_APPLICABLE',
                detalle: `renta fija, con convertibles, del ${(pesoParaSusMapas * 100).toFixed(2)} %: por debajo del 0,5 %`
            });
        }
    }
    if ((completa || queda) && confianza !== undefined && exposicionDoc !== undefined) {
        documentos.push({
            ruta: `instruments/${isin}/declared/exposure`,
            tipo: TIPO_EXPOSICION,
            documento: exposicionDoc
        });
        if (conRentaVariable && cajaDelFondo === undefined) {
            ausencias.push({ ruta: 'declared/exposure.equity_style_box', razon: 'NOT_PROVIDED' });
        }
    }
    if (!completa) {
        ausencias.push({
            ruta: 'declared/exposure.asset_mix',
            razon: 'NOT_PROVIDED',
            detalle: reparto.sinReparto ?? 'lo declarado no suma 1, y no se completa con ceros'
        });
    } else if (confianza === undefined) {
        ausencias.push({ ruta: 'declared/exposure.confidence', razon: 'NOT_PROVIDED' });
    }

    /* ---- declared/fixed_income ---- */

    const rf = obj(ms['fixed_income']);
    let calidad: string | undefined;
    const calidadBruta = txt(rf['avg_credit_quality']);
    if (calidadBruta !== undefined) {
        try {
            calidad = escalonDeCalidad(calidadBruta);
        } catch {
            avisos.push(`calidad crediticia no reconocida: ${calidadBruta}`);
        }
    }
    const TIPO_RF = 'instrument-declared-fixed-income.v2.schema.json';
    const rfDoc = limpiar({
        ...(sobre('canonical:fondosdb', fechaFicha) ?? {}),
        effective_duration: siCabe(TIPO_RF, 'effective_duration', num(rf['effective_duration'])),
        modified_duration: siCabe(TIPO_RF, 'modified_duration', num(rf['modified_duration'])),
        effective_maturity: siCabe(TIPO_RF, 'effective_maturity', num(rf['effective_maturity'])),
        yield_to_maturity: siCabe(TIPO_RF, 'yield_to_maturity', frac(rf['yield_to_maturity'])),
        investment_grade: siCabe(TIPO_RF, 'investment_grade', frac(rf['investment_grade_pct'])),
        high_yield: siCabe(TIPO_RF, 'high_yield', frac(rf['high_yield_pct'])),
        avg_credit_quality: calidad
    });
    if (rfDoc !== undefined && Object.keys(rfDoc).length > 2 && fechaFicha !== undefined) {
        documentos.push({
            ruta: `instruments/${isin}/declared/fixed_income`,
            tipo: 'instrument-declared-fixed-income.v2.schema.json',
            documento: rfDoc
        });
    } else if (tieneRentaFija) {
        ausencias.push({
            ruta: 'declared/fixed_income',
            razon: 'NOT_PROVIDED',
            detalle: 'tiene renta fija y el canonico no trae su detalle'
        });
    } else {
        ausencias.push({ ruta: 'declared/fixed_income', razon: 'NOT_APPLICABLE' });
    }
    if (txt(rf['yield_to_worst']) !== undefined || num(rf['yield_to_worst']) !== undefined) {
        perdidas.push('ms.fixed_income.yield_to_worst');
    }

    /* ---- de quién es cada cifra ---- */

    /*
     * La procedencia campo a campo del canónico universal, que es lo único que distingue
     * una cifra del proveedor de una que calculamos nosotros: las dos llegan en el mismo
     * campo. `vl_eodhd` es nuestro calculador de hoy —`core.metricas v1` del extractor,
     * sobre la serie de valor liquidativo de EODHD—; `morningstar_lt` es el proveedor.
     *
     * El defecto que esto arregla, medido el 01-11: 469 fondos tenían métricas calculadas
     * por nosotros archivadas en `declared/provider_risk`, un bloque cuyo nombre dice que
     * son del proveedor. La procedencia por campo sí se conservaba en `declared/provenance`,
     * así que no se perdía información; lo que estaba mal era el sitio.
     */
    const procedenciaDelCampo = obj(en(universal, 'meta', 'procedencia'));
    const esNuestra = (ruta: string): boolean =>
        String(procedenciaDelCampo[ruta] ?? '').startsWith('vl_eodhd');

    /*
     * Y la cifra del proveedor que la nuestra desplazó, que el canónico no tira: la guarda
     * en `meta.contraste` con su fuente y su valor. La tienen 468 de los 752 fondos para la
     * volatilidad del fondo.
     *
     * Es lo que hace asumible retirar las nuestras. Sin esto, exigir evidencia dejaba 452
     * fondos sin volatilidad de nadie; con esto, el bloque del proveedor recupera la de
     * Morningstar, que siempre estuvo ahí, y queda un bloque donde todo es del proveedor
     * de verdad.
     */
    const contraste = obj(en(universal, 'meta', 'contraste'));
    const delProveedor = (ruta: string, bruto: unknown): unknown => {
        if (!esNuestra(ruta)) return bruto;
        const desplazada = obj(contraste[ruta]);
        return desplazada['valor'];
    };
    /* La fecha del proveedor, que es la suya y no la de nuestro cálculo: donde nuestras
       cifras desplazaron a las suyas, el canónico guarda también su `fecha_dato`. */
    const fechaDesplazada = (ruta: string): string | undefined =>
        fecha(obj(contraste[ruta])['valor']);
    const volatilidadesDelCanonico = conLoDesplazado(riesgo['volatilidad_pct'], 'riesgo.volatilidad_pct', contraste);
    const sharpesDelCanonico = conLoDesplazado(riesgo['sharpe'], 'riesgo.sharpe', contraste);

    /* ---- declared/provider_risk ---- */

    /* La fecha del PROVEEDOR. Donde nuestras cifras desplazaron a las suyas, `fecha_dato`
       es la de nuestro cálculo, y poner esa fecha en un bloque donde todo es de
       Morningstar fecharía su dato con nuestro reloj. El canónico guarda la suya. */
    const fechaRiesgo = fechaDesplazada('riesgo.fecha_dato') ?? fecha(riesgo['fecha_dato']) ?? fechaFicha;
    const beta = ventanasRelativas(riesgo['beta'], num);
    const r2 = ventanasRelativas(riesgo['r2'], frac);
    const alpha = ventanasRelativas(riesgo['alpha'], frac);
    const te = ventanasRelativas(riesgo['tracking_error_pct'], frac);
    const ir = ventanasRelativas(riesgo['information_ratio'], num);
    const descartadas = beta.descartadas + r2.descartadas + alpha.descartadas + te.descartadas + ir.descartadas;
    for (let i = 0; i < descartadas; i += 1) {
        perdidas.push('columna relativa categoria/indice, de significado no establecido');
    }

    const caida = obj(riesgo['max_drawdown']);
    const ventanaCaida = PERIODO[txt(caida['periodo']) ?? ''];
    const caidaFrac = frac(caida['pct']);

    const riesgoDoc = limpiar({
        ...(sobre('canonical:fondosdb', fechaRiesgo) ?? {}),
        /* La rentabilidad del proveedor es TOTAL_RETURN por convención del proveedor, no por
           la política del fondo: reinvierte las distribuciones al calcularla. Se declara
           aquí porque este bloque lleva provider_alpha, y un alpha es una diferencia de
           rentabilidades. */
        return_basis: 'TOTAL_RETURN',
        volatility: ventanasAbsolutas(volatilidadesDelCanonico, frac, (p, s, b) =>
            delProveedor(`riesgo.volatilidad_pct.${p}.${s}`, b)
        ),
        sharpe: ventanasAbsolutas(sharpesDelCanonico, num, (p, s, b) =>
            delProveedor(`riesgo.sharpe.${p}.${s}`, b)
        ),
        max_drawdown: ((): Record<string, Record<string, number>> | undefined => {
            const bruto = delProveedor('riesgo.max_drawdown.pct', caida['pct']);
            const valor = frac(bruto);
            return ventanaCaida !== undefined && valor !== undefined
                ? { [ventanaCaida]: { fund: valor } }
                : undefined;
        })(),
        beta: beta.valores,
        r2: r2.valores,
        provider_alpha: alpha.valores,
        tracking_error: te.valores,
        information_ratio: ir.valores
    });
    if (riesgoDoc !== undefined && fechaRiesgo !== undefined && Object.keys(riesgoDoc).length > 3) {
        documentos.push({
            ruta: `instruments/${isin}/declared/provider_risk`,
            tipo: 'instrument-declared-provider-risk.v2.schema.json',
            documento: riesgoDoc
        });
    } else {
        ausencias.push({ ruta: 'declared/provider_risk', razon: 'NOT_PROVIDED' });
    }

    /* ---- declared/provider_returns ---- */

    const trailing = conLoDesplazado(rentabilidad['trailing_pct'], 'rentabilidad.trailing_pct', contraste);
    const porVentana: Record<string, Record<string, number>> = {};
    /* Las nuestras, que salen de aquí y van a `computed/metrics`. */
    const nuestrasAnualizadas: Record<string, Record<string, number>> = {};
    for (const [claveCanonica, porSujeto] of Object.entries(trailing)) {
        const ventana = TRAILING[claveCanonica];
        if (ventana === undefined) {
            if (TRAILING_SIN_SITIO.includes(claveCanonica)) perdidas.push(`rentabilidad.trailing_pct.${claveCanonica}`);
            continue;
        }
        const dentro: Record<string, number> = {};
        for (const [sujetoCanonico, bruto] of Object.entries(obj(porSujeto))) {
            const sujeto = SUJETO_ABSOLUTO[sujetoCanonico];
            if (sujeto === undefined) continue;
            const ruta = `rentabilidad.trailing_pct.${claveCanonica}.${sujetoCanonico}`;
            if (esNuestra(ruta)) {
                /* Solo la columna del fondo puede ser nuestra: la de la categoría y la del
                   índice son del proveedor siempre, y `computed/metrics` no tiene sitio
                   para ellas porque no son cifras de este instrumento. */
                const nuestra = frac(bruto);
                if (sujeto === 'fund' && nuestra !== undefined) {
                    (nuestrasAnualizadas[ventana] ??= {})['fund'] = nuestra;
                }
                /* Y la del proveedor, que la nuestra desplazó, vuelve a su bloque. */
                const suya = frac(obj(contraste[ruta])['valor']);
                if (suya !== undefined) dentro[sujeto] = suya;
                continue;
            }
            const valor = frac(bruto);
            if (valor !== undefined) dentro[sujeto] = valor;
        }
        if (Object.keys(dentro).length > 0) porVentana[ventana] = dentro;
    }
    const ytd = obj(trailing['ytd']);
    const ytdPorSujeto: Record<string, number> = {};
    let ytdNuestro: number | undefined;
    for (const [sujetoCanonico, bruto] of Object.entries(ytd)) {
        const sujeto = SUJETO_ABSOLUTO[sujetoCanonico];
        if (sujeto === undefined) continue;
        const ruta = `rentabilidad.trailing_pct.ytd.${sujetoCanonico}`;
        if (esNuestra(ruta)) {
            const nuestra = frac(bruto);
            if (sujeto === 'fund' && nuestra !== undefined) ytdNuestro = nuestra;
            const suya = frac(obj(contraste[ruta])['valor']);
            if (suya !== undefined) ytdPorSujeto[sujeto] = suya;
            continue;
        }
        const valor = frac(bruto);
        if (valor !== undefined) ytdPorSujeto[sujeto] = valor;
    }

    /*
     * La rentabilidad por año natural no tiene bloque en ningún contrato, ni el del
     * proveedor ni el nuestro, así que se queda fuera. Lo que cambia hoy es que se CUENTA:
     * hasta ahora el mapper no la leía y desaparecían 4.229 rutas sin que nada lo dijera,
     * que es justo la contabilidad que esta base viene a quitar. No es una pérdida nueva,
     * es una pérdida que ya ocurría en silencio.
     */
    const porAnio = obj(rentabilidad['por_año_natural']);
    if (Object.keys(porAnio).length > 0) {
        perdidas.push(`rentabilidad.por_año_natural (${Object.keys(porAnio).length} años, sin bloque)`);
    }
    const fechaRent =
        fechaDesplazada('rentabilidad.fecha_dato') ?? fecha(rentabilidad['fecha_dato']) ?? fechaFicha;
    /*
     * Una fecha por cifra (decisión B-74, Óscar, 09-11-2026). Morningstar da el 1 mes, el año en
     * curso y el 1 año de un sitio, a fin de mes, y el 3, 5 y 10 años anualizados de otro, a fin de
     * trimestre: medido el 09-11 a las 20:38, 437 de las 795 fichas con cifra traen las dos fechas, y una sola
     * `fecha_dato` fechaba mal la mitad del bloque. El canónico trae la de cada ventana en
     * `rentabilidad.fecha_dato_por_ventana`, por su clave canónica; si no la trae, la ventana lleva
     * la de siempre.
     *
     * Lo desplazado sigue su regla, ventana a ventana: si la cifra del fondo de esa ventana es
     * nuestra, la del proveedor vuelve de `meta.contraste`, y su fecha también, con la clave
     * `rentabilidad.fecha_dato_por_ventana.<ventana>` (1-extractor d1f04ef, 09-11-2026). Medido
     * ese día, es el caso de 747 de las 795 fichas con cifra. Sin esa fecha en el contraste, la del
     * bloque desplazada, como hasta ahora: nunca una que haya escrito nuestro cálculo.
     *
     * Y si nuestra cifra de esa ventana NO existe pero el bloque se desplazó igual —una ventana con un
     * hueco de más de 31 días no se publica (decisión 111), y la del proveedor vuelve del contraste—,
     * la fecha de la ventana ya no está en el canónico, porque se fue al contraste con su bloque: se
     * toma de ahí antes que la del bloque. Medido el 11-11-2026 en LU1683285321 (D-9): sin esto, su
     * 1 año del proveedor, a 31-10, salía fechado el 30-09.
     */
    const fechasDelCanonico = obj(rentabilidad['fecha_dato_por_ventana']);
    const fechaDeVentana = (claveCanonica: string): string | undefined => {
        const ruta = `rentabilidad.fecha_dato_por_ventana.${claveCanonica}`;
        if (esNuestra(`rentabilidad.trailing_pct.${claveCanonica}.fondo`) || esNuestra(ruta)) {
            return fechaDesplazada(ruta) ?? fechaRent;
        }
        return fecha(fechasDelCanonico[claveCanonica]) ?? fechaDesplazada(ruta) ?? fechaRent;
    };
    const fechasPorVentana: Record<string, string | undefined> = {};
    for (const [claveCanonica, ventana] of Object.entries(TRAILING)) {
        if (porVentana[ventana] !== undefined) fechasPorVentana[ventana] = fechaDeVentana(claveCanonica);
    }
    if (Object.keys(ytdPorSujeto).length > 0) fechasPorVentana['ytd'] = fechaDeVentana('ytd');
    const fechasDelBloque = Object.values(fechasPorVentana);
    const hayCifrasDelProveedor = fechasDelBloque.length > 0;
    /* `as_of` es la más reciente del bloque, o la común; sin la de alguna ventana no hay bloque, como antes sin `fecha_dato`. */
    const asOfRent = !hayCifrasDelProveedor
        ? fechaRent
        : fechasDelBloque.some((f) => f === undefined)
          ? undefined
          : (fechasDelBloque as string[]).reduce((a, b) => (b > a ? b : a));
    /* El mapa solo se escribe si las fechas difieren: cuando coinciden, `as_of` ya lo dice todo. */
    const asOfPorVentana = new Set(fechasDelBloque).size > 1 ? (fechasPorVentana as Record<string, string>) : undefined;
    const retornosDoc = limpiar({
        ...(sobre('canonical:fondosdb', asOfRent) ?? {}),
        as_of_by_window: asOfPorVentana,
        return_basis: 'TOTAL_RETURN',
        trailing_return: Object.keys(porVentana).length > 0 ? porVentana : undefined,
        ytd_return: Object.keys(ytdPorSujeto).length > 0 ? ytdPorSujeto : undefined
    });
    if (retornosDoc !== undefined && asOfRent !== undefined && hayCifrasDelProveedor) {
        documentos.push({
            ruta: `instruments/${isin}/declared/provider_returns`,
            tipo: 'instrument-declared-provider-returns.v2.schema.json',
            documento: retornosDoc
        });
    } else {
        ausencias.push({ ruta: 'declared/provider_returns', razon: 'NOT_PROVIDED' });
    }

    /* ---- declared/sustainability ---- */

    const TIPO_ESG = 'instrument-declared-sustainability.v2.schema.json';
    const globos = num(ms['sustainability_rating']);
    const sostenibilidad = limpiar({
        ...(sobre('canonical:fondosdb', fechaFicha) ?? {}),
        esg_globes: globos === undefined ? undefined : siCabe(TIPO_ESG, 'esg_globes', Math.trunc(globos))
    });
    if (sostenibilidad !== undefined && Object.keys(sostenibilidad).length > 2 && fechaFicha !== undefined) {
        documentos.push({
            ruta: `instruments/${isin}/declared/sustainability`,
            tipo: TIPO_ESG,
            documento: sostenibilidad
        });
    } else {
        ausencias.push({ ruta: 'declared/sustainability', razon: 'NOT_PROVIDED' });
    }
    if (txt(ms['medalist_rating']) !== undefined) {
        /* `ms.medalist_rating` es la opinión de un analista sobre el fondo (Neutral, Bronze,
           Silver, Gold), NO una calificación de sostenibilidad. La primera versión de este
           mapper la metía en `esg_rating`, que es exactamente el defecto que este diseño
           persigue: un dato bueno en un campo que significa otra cosa. No tiene sitio en el
           contrato y se cuenta como pérdida hasta que alguien decida si hace falta. */
        perdidas.push('ms.medalist_rating (opinion de analista, sin campo en el contrato)');
    }

    /* ---- declared/size ---- */

    const patrimonioMillones = num(valoracion['patrimonio_fondo_meur']);
    const divisaPatrimonio = txt(valoracion['patrimonio_divisa']);
    const tamano = limpiar({
        ...(sobre('canonical:fondosdb', fecha(valoracion['patrimonio_fecha']) ?? fechaFicha) ?? {}),
        aum: patrimonioMillones === undefined ? undefined : patrimonioMillones * 1_000_000,
        currency: divisaPatrimonio !== undefined && /^[A-Z]{3}$/.test(divisaPatrimonio) ? divisaPatrimonio : undefined
    });
    if (tamano !== undefined && 'aum' in tamano && 'currency' in tamano) {
        documentos.push({
            ruta: `instruments/${isin}/declared/size`,
            tipo: 'instrument-declared-size.v2.schema.json',
            documento: tamano
        });
    } else {
        ausencias.push({ ruta: 'declared/size', razon: 'NOT_PROVIDED' });
    }

    /* ---- declared/quote ---- */

    const cotizacion = bloqueDeCotizacion(universal, tipo);
    if (cotizacion !== undefined && 'documento' in cotizacion) {
        documentos.push({
            ruta: `instruments/${isin}/declared/quote`,
            tipo: 'instrument-declared-quote.v2.schema.json',
            documento: cotizacion.documento
        });
    } else if (cotizacion !== undefined) {
        avisos.push(`${isin}: ${cotizacion.bloqueo}`);
        ausencias.push({ ruta: 'declared/quote', razon: 'NOT_PROVIDED', detalle: cotizacion.bloqueo });
    } else {
        ausencias.push({
            ruta: 'declared/quote',
            razon: 'NOT_PROVIDED',
            detalle: 'sin precio, sin su fecha, o sin poder decir de que clase de precio se trata'
        });
    }

    /* ---- declared/holdings ---- */

    const estadisticas = obj(ms['holdings_stats']);
    /*
     * El top de posiciones. Se prefiere `holdings_top`, que trae 25 -el tope que este
     * contrato declara desde el primer dia-, y se cae a `holdings_top10` para un canonico
     * generado antes del 02-11-2026, que solo traia 10.
     *
     * Lo que cambia con 25, medido ese dia sobre las 760 fichas con diez posiciones o mas:
     * la mediana de cartera explicada pasa del 40,9 % al 61,4 %, y los fondos explicados al
     * 90 % de 53 a 129. No resuelve la radiografia -para eso hace falta la lista entera, que
     * este contrato manda al analitico- pero deja de guardar menos de lo que se puede.
     */
    const topDeclarado = Array.isArray(ms['holdings_top']) ? (ms['holdings_top'] as unknown[]) : undefined;
    const topBruto = topDeclarado ?? (Array.isArray(ms['holdings_top10']) ? (ms['holdings_top10'] as unknown[]) : []);
    let topConPesosImposibles = false;
    const top = topBruto
        .map((linea) => {
            const l = obj(linea);
            const nombreLinea = txt(l['name']) ?? txt(l['nombre']);
            const pesoLinea = frac(l['weight']) ?? peso(l['peso']);
            if (nombreLinea === undefined || pesoLinea === undefined) return undefined;
            if (!pesoCreible(pesoLinea)) {
                topConPesosImposibles = true;
                return undefined;
            }
            return limpiar({
                name: nombreLinea,
                isin: txt(l['isin']),
                weight: pesoLinea,
                sector: txt(l['sector']),
                country: txt(l['country']),
                holding_type_code: txt(l['holding_type_code'])
            });
        })
        .filter((linea): linea is Record<string, unknown> => linea !== undefined)
        /* El tope del contrato, aplicado aqui tambien: un mapper no emite nunca un valor que
           el contrato rechaza. Si un canonico futuro manda 40, el documento entero quedaria
           bloqueado por una lista demasiado larga en vez de guardar las 25 que caben. */
        .slice(0, POSICIONES_DEL_TOP);
    const cuantas = num(estadisticas['holdings_count_bond']) ?? num(estadisticas['holdings_count_equity']);
    /*
     * Los titulos de la cartera, acciones mas bonos (decision 55 de Oscar, 08-11-2026). No es
     * `cuantas`: esa cifra es los bonos o, si no hay, las acciones, y en un fondo mixto se queda
     * corta. Esta es la que se pone frente al recuento de titulos que declara un emisor.
     * Con una sola clase, esa; con ninguna, nada, y un cero tampoco es un recuento.
     */
    const accionesDeclaradas = num(estadisticas['holdings_count_equity']);
    const bonosDeclarados = num(estadisticas['holdings_count_bond']);
    const sumaDeTitulos =
        accionesDeclaradas === undefined && bonosDeclarados === undefined
            ? undefined
            : Math.trunc((accionesDeclaradas ?? 0) + (bonosDeclarados ?? 0));
    const titulos = sumaDeTitulos !== undefined && sumaDeTitulos >= 1 && sumaDeTitulos <= 100000 ? sumaDeTitulos : undefined;
    /*
     * La cobertura: que fraccion del patrimonio cubren las posiciones guardadas.
     *
     * El canonico manda la SUMA de los pesos del top, que es un hecho. Llamarla cobertura es
     * otra cosa, y no siempre se puede: una cartera con nocionales de derivado suma mas del
     * 100 % -un futuro del S&P al 109,7 %, por ejemplo- y ahi la suma no es una
     * fraccion del patrimonio de nadie. Medido el 02-11-2026: el contrato bloqueo 63
     * documentos por eso, y hacia bien.
     *
     * Asi que donde no se puede afirmar, no se afirma: se queda ausente con su motivo, en vez
     * de recortarla a 1 y decir que la cartera esta cubierta al 100 %.
     *
     * Si se ha quitado una linea con un peso imposible, la suma del canonico la sigue contando,
     * asi que se rehace con las que quedan: esa linea no era un nocional, era un error de escala.
     */
    const sumaDelTop = topConPesosImposibles
        ? top.reduce((suma, linea) => suma + Number(linea['weight']) * 100, 0)
        : num(ms['holdings_top_weight_sum']);
    /* Tampoco si es negativa: con posiciones cortas el top puede restar, y eso no es cobertura. */
    const cobertura =
        sumaDelTop !== undefined && sumaDelTop >= 0 && sumaDelTop <= 100 ? frac(sumaDelTop) : undefined;
    if (sumaDelTop !== undefined && sumaDelTop > 100) {
        ausencias.push({
            ruta: 'declared/holdings.coverage',
            razon: 'NOT_APPLICABLE',
            detalle: `los pesos del top suman ${sumaDelTop.toFixed(2)} %: hay nocionales de derivado`
        });
    }
    const fechaCartera = fecha(en(ms, 'portfolio', 'as_of')) ?? fechaFicha;
    if (cuantas !== undefined && top.length > 0 && fechaCartera !== undefined) {
        const cartera = limpiar({
            source: 'canonical:fondosdb',
            as_of: fechaCartera,
            positions_count: Math.trunc(cuantas),
            securities_count: titulos,
            top10_weight: frac(estadisticas['top10_weight']),
            /* Que fraccion del patrimonio cubren las posiciones que SI estan. El contrato lo
               pide con una frase que explica por que, y hasta el 02-11-2026 nadie lo
               escribia: «sin esto, una lista parcial parece completa».
               El canonico da la SUMA de los pesos guardados, que es una medicion; llamarla
               cobertura es una afirmacion, y solo cabe si no pasa del 100 %. Ver `cobertura`
               arriba: con nocionales de derivado no cabe, y entonces no se escribe. */
            coverage: cobertura,
            top
        });
        if (titulos === undefined) {
            ausencias.push({
                ruta: 'declared/holdings.securities_count',
                razon: 'NOT_PROVIDED',
                detalle: 'la fuente no da acciones ni bonos que sumen un recuento'
            });
        }
        if (cartera !== undefined) {
            documentos.push({
                ruta: `instruments/${isin}/declared/holdings`,
                tipo: 'instrument-declared-holdings.v2.schema.json',
                documento: cartera
            });
            /* Y la cartera COMPLETA, troceada. El resumen de arriba se queda: es el camino
               caliente -una fila de lista, una tarjeta- y leer veinte trozos para pintar las
               diez primeras posiciones seria pagar la lista entera por el resumen. */
            const completa = Array.isArray(ms['holdings_all']) ? (ms['holdings_all'] as unknown[]) : [];
            if (completa.length > 0) {
                const trozos = componerTrozos(
                    isin,
                    completa as { name?: unknown; weight?: unknown }[],
                    'canonical:fondosdb',
                    fechaCartera
                );
                documentos.push(...trozos.documentos);
                if (trozos.descartadas > 0) {
                    avisos.push(
                        `cartera completa: ${trozos.descartadas} lineas sin nombre o sin peso, no escritas`
                    );
                }
                if (trozos.pesosImposibles.length > 0) {
                    avisos.push(
                        `cartera completa: ${trozos.pesosImposibles.length} lineas con un peso imposible, no escritas: ${trozos.pesosImposibles.join('; ')}`
                    );
                }
            }
        }
    } else {
        ausencias.push({ ruta: 'declared/holdings', razon: 'NOT_PROVIDED' });
    }

    /* ---- computed/metrics ---- */

    /*
     * Lo que calculamos NOSOTROS, por primera vez en su sitio. Hasta el 01-11 este bloque
     * estaba vacío para los 769 y las 469 métricas propias vivían en `declared/provider_risk`.
     *
     * Dos diferencias de forma con el bloque del proveedor, y las dos son a propósito:
     * aquí una cifra es un número y no un mapa de sujetos, porque es la cifra de ESTE
     * instrumento y no hay categoría ni índice que declarar; y el documento dice con qué se
     * calculó —serie, divisa, tipo libre de riesgo— además del número.
     *
     * Y la barrera: `inputs.distribution_policy_resolution` es obligatorio en el contrato,
     * así que sin evidencia de la política NO se puede escribir. Es lo que convierte la
     * recomendación en una barrera, y lo comprueba el esquema y no la disciplina.
     */
    const TIPO_METRICAS = 'instrument-computed-metrics.v2.schema.json';
    const historial = obj(riesgo['historial_precios']);

    /*
     * Lo que calculamos CONTRA un índice: beta, R², alpha de Jensen, rentabilidad
     * activa, tracking error y ratio de información. Llegan de `riesgo.relativas`, el
     * bloque propio del extractor, y no de `riesgo.beta`, donde vive la de Morningstar:
     * dos cifras de la misma magnitud en el mismo campo es como se acaba sin saber cuál
     * calculó quién.
     *
     * Todo el bloque vive o muere con la identidad del índice. El contrato exige nombre,
     * divisa, variante y base de rentabilidad, y con razón: un alpha contra «MSCI World»
     * sin decir qué variante ni en qué divisa no se puede defender ante nadie. Si falta
     * cualquiera de las cuatro, no se escribe nada.
     *
     * Y viaja el ISIN del PROXY, que es el instrumento que hizo de índice. Es lo que
     * permite que un informe diga «medido contra este fondo índice» en vez de insinuar
     * que teníamos la serie del índice, que no la tenemos.
     */
    const relativas = obj(riesgo['relativas']);
    const porVentanaDeRelativa = (
        nombre: string,
        convertir: (valor: unknown) => number | undefined
    ): Record<string, number> | undefined => {
        const salida: Record<string, number> = {};
        for (const [periodoCanonico, bruto] of Object.entries(obj(relativas[nombre]))) {
            const ventana = PERIODO[periodoCanonico];
            if (ventana === undefined) continue;
            const valor = convertir(bruto);
            if (valor !== undefined) salida[ventana] = valor;
        }
        return Object.keys(salida).length === 0 ? undefined : salida;
    };
    const indiceNombre = txt(relativas['indice_nombre']);
    const indiceVariante = txt(relativas['indice_variante']);
    const indiceBase = txt(relativas['base_indice']);
    /* Qué hizo de serie del índice: un instrumento de la base o el nivel del propio índice
       (camino C, decisión 23). Y sobre qué se midió esa serie, que es el ruido que lleva la
       cifra: el proxy de MSCI ACWI es un ETF, precio de mercado; el IBEX TR es el índice. */
    const serieDelIndice = identidadDeLaSerieDelIndice(
        txt(relativas['indice_proxy']),
        relativas['indice_clase_de_serie']
    );
    const relativasPropias =
        indiceNombre === undefined || indiceVariante === undefined || indiceBase === undefined
            ? undefined
            : limpiar({
                  benchmark: limpiar({
                      name: indiceNombre,
                      instrument_id: serieDelIndice.instrument_id,
                      source_series_id: serieDelIndice.source_series_id,
                      /* El proxy es una clase en euros y solo se calcula cuando la del
                         fondo también lo es, así que el euro no es un supuesto. */
                      currency: 'EUR',
                      variant: indiceVariante,
                      return_basis: indiceBase,
                      series_class: serieDelIndice.series_class,
                      /* El índice que declara el fondo, si el medido es otro equivalente: `name` sigue
                         siendo el que de verdad se midió, y este el que no se puede medir. */
                      equivalent_of: txt(relativas['equivalente_de']),
                      /* Decisión 21: se mide igual, y se dice que su KID no confirma este índice. */
                      kid_confirmation:
                          relativas['kid_no_confirma'] === true
                              ? traducir(CONFIRMACION_DEL_KID, 'kid_estado', relativas['kid_estado'])
                              : undefined
                  }),
                  beta: porVentanaDeRelativa('beta', num),
                  r2: porVentanaDeRelativa('r2', frac),
                  jensen_alpha: porVentanaDeRelativa('jensen_alpha', frac),
                  active_return: porVentanaDeRelativa('rentabilidad_activa', frac),
                  tracking_error: porVentanaDeRelativa('tracking_error', frac),
                  information_ratio: porVentanaDeRelativa('information_ratio', num)
              });
    if (relativasPropias === undefined && Object.keys(relativas).length > 0 && relativas['aviso'] === undefined) {
        avisos.push('riesgo.relativas sin identidad completa del indice: no se escribe');
    }
    if (relativasPropias !== undefined && serieDelIndice.esNivelDeIndice) {
        /* No es un hueco: el índice no es un instrumento de la base. Sin esto, la ausencia se
           leería como «pendiente de alta», que es lo que la ficha dice de un proxy que falta. */
        ausencias.push({
            ruta: 'computed/metrics.relative.benchmark.instrument_id',
            razon: 'NOT_APPLICABLE',
            detalle: 'se mide contra la serie del propio indice (source_series_id), que no es un instrumento de la base'
        });
    }
    /*
     * Decisión 20 del 07-11-2026: su KID declara un índice compuesto o ninguno, y no se mide contra el
     * que le atribuye Morningstar. Es una AFIRMACIÓN, no un hueco, así que la base la guarda: el
     * motivo, la frase del KID que lo justifica y, si antes se publicaban cifras, desde cuándo ya no
     * (§10 del método). Las tres solo cuando no hay `relative`: con cifras, decir que no las hay sería
     * contradecirse. Decisión 30: la clase cubierta es otro motivo decidido, sin frase ni retirada,
     * porque sale del nombre de la clase y nunca tuvo cifras. C-28 (21-11-2026): la serie de su índice era
     * otra clase del mismo fondo. Sí tuvo cifras, y la retirada la escribe el extractor, que es quien sabe desde
     * cuándo ya no se publican, con el mismo mecanismo que la del KID (desde el 21-11-2026): aquí viaja igual.
     */
    /* Sin el paréntesis que lleva detrás el de la C-28 (el proxy que resultó ser otra clase del mismo fondo). */
    const avisoDeRelativasCompleto = txt(relativas['aviso']);
    const avisoDeRelativas =
        avisoDeRelativasCompleto === undefined ? undefined : claveDelAvisoDeRelativas(avisoDeRelativasCompleto);
    /* Un aviso del KID que no esté en la tabla rompe el mapeo (es una decisión que no sabemos nombrar);
       los avisos del cálculo (`sin_relativas_divisa_*`) no son una decisión y no escriben motivo. */
    const esAvisoDecidido =
        avisoDeRelativas !== undefined &&
        (avisoDeRelativas in AUSENCIA_RELATIVA_DECIDIDA || avisoDeRelativas.startsWith('sin_relativas_kid_'));
    const ausenciaPorKid =
        relativasPropias === undefined && esAvisoDecidido
            ? traducir(AUSENCIA_RELATIVA_DECIDIDA, 'riesgo.relativas.aviso', avisoDeRelativas)
            : undefined;
    const retiradaDeRelativas = obj(relativas['retirada']);
    const serieRetirada = identidadDeLaSerieDelIndice(
        txt(retiradaDeRelativas['indice_proxy']),
        retiradaDeRelativas['indice_clase_de_serie']
    );
    const pruebaDeLaAusencia =
        ausenciaPorKid === undefined || txt(relativas['kid_texto']) === undefined
            ? undefined
            : limpiar({
                  kid_excerpt: txt(relativas['kid_texto']),
                  kid_sha256: txt(relativas['kid_sha256']),
                  checked_on: fecha(relativas['kid_fecha_comprobacion'])
              });
    const retiradaPorKid =
        ausenciaPorKid === undefined || fecha(retiradaDeRelativas['fecha']) === undefined
            ? undefined
            : limpiar({
                  withdrawn_on: fecha(retiradaDeRelativas['fecha']),
                  decision: txt(retiradaDeRelativas['decision']),
                  benchmark_name: txt(retiradaDeRelativas['indice_nombre']),
                  benchmark_instrument_id: serieRetirada.instrument_id,
                  benchmark_source_series_id: serieRetirada.source_series_id,
                  last_as_of: fecha(retiradaDeRelativas['ultima_fecha_dato'])
              });
    /** Las nuestras, en la forma del bloque: una cifra por ventana, sin sujeto. */
    const nuestrasPorVentana = (
        fuente: unknown,
        rutaBase: string,
        convertir: (valor: unknown) => number | undefined
    ): Record<string, number> | undefined => {
        const salida: Record<string, number> = {};
        for (const [periodoCanonico, porSujeto] of Object.entries(obj(fuente))) {
            const ventana = PERIODO[periodoCanonico];
            if (ventana === undefined) continue;
            if (!esNuestra(`${rutaBase}.${periodoCanonico}.fondo`)) continue;
            /* El rango del contrato NO se mira aquí: lo aplica `conLoQueNoCabeApartado` al
               documento entero, ventana a ventana y para todas las cifras (decisión B-73). Un
               Sortino de 23 existe de verdad —una serie casi monótona deja una desviación a la
               baja minúscula— y el contrato topa los ratios en 20: se aparta esa ventana, se
               anota en `out_of_range`, y la volatilidad y el Sharpe, que están bien, se escriben. */
            const valor = convertir(obj(porSujeto)['fondo']);
            if (valor !== undefined) salida[ventana] = valor;
        }
        return Object.keys(salida).length === 0 ? undefined : salida;
    };

    const volPropia = nuestrasPorVentana(riesgo['volatilidad_pct'], 'riesgo.volatilidad_pct', frac);
    const sharpePropio = nuestrasPorVentana(riesgo['sharpe'], 'riesgo.sharpe', num);
    /* El Sortino, que el contrato declara a cuatro ventanas y que hasta el 02-11-2026 no
       calculaba nadie: figuraba ausente en los 1.077 instrumentos. Ahora el extractor lo
       escribe en `riesgo.sortino.{plazo}.fondo` y aquí se lee como el Sharpe, con el mismo
       recorrido. Si se hubiera dejado sin mapear, la cifra se calcularía y se tiraría, que
       es exactamente el defecto que esta pasada corrige para la caída máxima. */
    const sortinoPropio = nuestrasPorVentana(riesgo['sortino'], 'riesgo.sortino', num);
    /*
     * La caída máxima, por ventana.
     *
     * Hasta el 02-11-2026 el canónico solo traía un escalar con la mejor ventana
     * disponible (`riesgo.max_drawdown.pct` + `periodo`), así que de las cuatro ventanas
     * que el contrato declara solo se poblaba una: 625 instrumentos la tenían a tres años,
     * 290 a cinco y ninguno a uno. El extractor publica ahora
     * `riesgo.max_drawdown_pct.{plazo}.fondo` como volatilidad y sharpe, y esto la lee con
     * el mismo recorrido genérico que ellas.
     *
     * El escalar se mantiene como respaldo: un canónico generado antes de ese cambio
     * sigue dando su única ventana en vez de quedarse sin ninguna.
     */
    const caidaPorVentana = nuestrasPorVentana(
        riesgo['max_drawdown_pct'],
        'riesgo.max_drawdown_pct',
        frac
    );
    const caidaPropia =
        caidaPorVentana ??
        (ventanaCaida !== undefined && caidaFrac !== undefined && esNuestra('riesgo.max_drawdown.pct')
            ? { [ventanaCaida]: caidaFrac }
            : undefined);
    const hayCifraPropia =
        volPropia !== undefined ||
        sharpePropio !== undefined ||
        sortinoPropio !== undefined ||
        caidaPropia !== undefined ||
        Object.keys(nuestrasAnualizadas).length > 0 ||
        ytdNuestro !== undefined;

    if (hayCifraPropia) {
        const grado = distribucion.resolution;
        const serie = txt(historial['source_listing_id']);
        const divisaCalculo = txt(historial['divisa_metricas']);
        const calculadoEn = txt(ficha['generated_at']) ?? fechaRiesgo;
        /* Un ETF se mide sobre su cierre de mercado ajustado (Oscar, 04-11-2026). Su derecho a
           calcular no es la politica de reparto, porque el dividendo ya va dentro de la serie:
           es el ajuste, igual que en una accion. El ETC no entra: su metodo no esta decidido. */
        const ajusteDeMercado =
            txt(historial['clase_de_serie']) === 'PRECIO_DE_MERCADO' && tipo !== 'OTHER'
                ? AJUSTE_DE_SERIE[txt(historial['source_history']) ?? '']
                : undefined;
        if (ajusteDeMercado === undefined && (grado === undefined || distribucion.policy !== 'ACCUMULATING')) {
            /*
             * La razón de ser de todo esto. La serie de una clase que reparte baja el día
             * del pago, y esa caída no es mercado: calcular sobre ella sin corregirla
             * inventa riesgo. Sin evidencia de que la clase acumula no tenemos derecho a
             * publicar la cifra como nuestra, aunque el extractor la haya calculado.
             *
             * No se pierde nada que tuviéramos: la cifra del proveedor, cuando existe,
             * sigue en `declared/provider_risk` con su nombre. Lo que se retira es la
             * nuestra, que se apoyaba en el nombre de la clase.
             */
            ausencias.push({
                ruta: 'computed/metrics',
                motivo: distribucion.policy === 'DISTRIBUTING' ? 'DISTRIBUTES' : 'POLICY_UNKNOWN',
                razon: 'NOT_APPLICABLE',
                detalle: `politica ${distribucion.policy} sin evidencia: no hay derecho a calcular`
            });
        } else if (divisaCalculo !== undefined && divisaCalculo !== 'EUR') {
            /* Metodo V2: solo se publica en euros. Una ficha aun en la divisa de la clase viene
               de una pasada anterior y no se puede comparar ni combinar con las demas. */
            ausencias.push({
                ruta: 'computed/metrics',
                motivo: 'NEEDS_FX',
                razon: 'NOT_YET_FETCHED',
                detalle: `calculada en ${divisaCalculo}: falta recalcularla en euros`
            });
        } else if (serie === undefined || divisaCalculo === undefined || calculadoEn === undefined) {
            /* Una cifra sin decir de qué serie y en qué divisa sale no es publicable: el
               contrato exige las dos, y con razón, porque dos volatilidades en divisas
               distintas no son la misma magnitud. */
            ausencias.push({
                ruta: 'computed/metrics',
                motivo: 'UNIDENTIFIED_SERIES',
                razon: 'NOT_PROVIDED',
                detalle: 'faltan la serie, la divisa del calculo o la fecha'
            });
        } else {
            const metricas = limpiar({
                computed_at: calculadoEn,
                /* El cierre de mes al que miden, que no es cuando se calcularon ni donde acaba
                   la serie. Solo si la fecha es nuestra y no la del proveedor. */
                as_of: esNuestra('rentabilidad.fecha_dato') ? fecha(rentabilidad['fecha_dato']) : undefined,
                /* La versión la dice la ficha, no esta línea: ver `versionDelMetodo`. */
                method: `EXTRACTOR_MONTHLY_V${versionDelMetodo(historial['metodo'])}`,
                frequency: 'MONTHLY',
                /* La clase acumula con evidencia, así que su serie de valor liquidativo YA
                   es de retorno total: no hay reparto que reponer. Se deriva, no se supone.
                   En un ETF lo es porque el cierre ajustado lleva el dividendo dentro. */
                return_basis: 'TOTAL_RETURN',
                inputs: limpiar({
                    series_id: serie,
                    series_class: ajusteDeMercado === undefined ? undefined : 'MARKET_PRICE',
                    currency: divisaCalculo,
                    source_currency: txt(historial['divisa_origen']),
                    fx_source: txt(historial['fx_source']),
                    distribution_policy_resolution: ajusteDeMercado === undefined ? grado : undefined,
                    series_adjustment: ajusteDeMercado,
                    risk_free_source: txt(historial['rf_referencia']),
                    observations: siCabe(
                        TIPO_METRICAS,
                        'inputs.observations',
                        num(historial['observations_count']) === undefined
                            ? undefined
                            : Math.trunc(num(historial['observations_count']) as number)
                    ),
                    first_date: fecha(historial['first_date']),
                    last_date: fecha(historial['last_date']),
                    series_gaps: huecosDeLaSerie(historial)
                }),
                volatility: volPropia,
                sharpe: sharpePropio,
                sortino: sortinoPropio,
                max_drawdown: caidaPropia,
                annualized_return:
                    Object.keys(nuestrasAnualizadas).length > 0
                        ? Object.fromEntries(
                              Object.entries(nuestrasAnualizadas).map(([v, porSujeto]) => [v, porSujeto['fund']])
                          )
                        : undefined,
                ytd_return: ytdNuestro,
                relative: relativasPropias,
                relative_absence: ausenciaPorKid,
                relative_absence_evidence: pruebaDeLaAusencia,
                relative_withdrawal: retiradaPorKid
            });
            if (metricas !== undefined) {
                documentos.push({
                    ruta: `instruments/${isin}/computed/metrics`,
                    tipo: TIPO_METRICAS,
                    documento: conLoQueNoCabeApartado(TIPO_METRICAS, metricas, avisos),
                    /* Lo calculó un lote, aunque lo traiga la plataforma. */
                    comoDueno: 'batch'
                });
            }
        }
    } else {
        /* Ni una cifra propia, y la razón sale del motivo que dejó el extractor. El comentario
           que había aquí ya decía que lo normal es que «el extractor se negó a calcular», que
           NO es «aún no lo hemos pedido»: ver `razonSinMetricasPropias`. */
        ausencias.push({ ruta: 'computed/metrics', ...razonSinMetricasPropias(historial, tipo, perdidas) });
    }

    /* ---- declared/distributions ---- */

    /*
     * Los pagos, que son lo que permite ARREGLAR la serie y no solo decidir si fiarse de
     * ella. Un pago sin fecha o sin importe no entra: sin fecha no se puede sumar a la
     * serie, y sin importe no hay nada que sumar. El resto del registro —el valor
     * liquidativo del día, la renta y las plusvalías— es opcional, y el valor liquidativo
     * es el que convierte la lista en serie reconstruible, porque el reparto se
     * reinvierte a ese precio.
     */
    const TIPO_REPARTOS = 'instrument-declared-distributions.v2.schema.json';
    const pagos: Record<string, unknown>[] = [];
    let pagosIncompletos = 0;
    for (const crudo of pagosCrudos) {
        const p = obj(crudo);
        const fecha = txt(p['fecha']);
        const importe = siCabe(
            TIPO_REPARTOS,
            'payments[].amount_per_share',
            num(p['importe_por_participacion'])
        );
        if (fecha === undefined || importe === undefined) {
            pagosIncompletos += 1;
            continue;
        }
        const pago = limpiar({
            date: fecha,
            amount_per_share: importe,
            nav_on_date: siCabe(TIPO_REPARTOS, 'payments[].nav_on_date', num(p['vl_en_la_fecha'])),
            income: siCabe(TIPO_REPARTOS, 'payments[].income', num(p['renta'])),
            capital_gains: siCabe(TIPO_REPARTOS, 'payments[].capital_gains', num(p['plusvalias']))
        });
        if (pago !== undefined) pagos.push(pago);
    }
    if (pagosIncompletos > 0) {
        avisos.push(`${pagosIncompletos} repartos sin fecha o sin importe, fuera`);
    }

    /* Un importe sin divisa no es un importe, y el contrato lo exige en cuanto hay un pago.
       Si llegaran pagos sin divisa, los pagos se quedan fuera y el bloque sigue: la marca
       de consultado vale por sí sola, y vale más que tirar el documento entero. */
    const divisaDelReparto = txt(repartos['divisa']);
    if (pagos.length > 0 && divisaDelReparto === undefined) {
        avisos.push(`${pagos.length} repartos sin divisa, fuera`);
        pagos.length = 0;
    }

    /*
     * `records_checked` es obligatorio en el contrato, y cuando el canónico no trae la
     * marca el valor honesto es `false`: la marca la pone el extractor solo si el
     * proveedor contestó, así que su ausencia ES «no hay respuesta». No es inventar un
     * dato, es registrar que no llegó.
     *
     * Importa que sea así y no «sin marca, sin bloque»: el rendimiento repartido lo traen
     * 765 de las 843 clases y la marca solo 45 a mitad de la pasada del 01-11. Exigir la
     * marca para publicar el bloque dejaría ese rendimiento sin publicar, y en las clases
     * donde Morningstar no tiene endpoint de reparto la marca no va a llegar nunca.
     *
     * Lo que NO cambia es qué cuenta como evidencia: `resolverDistribucion` solo acepta
     * `true`, así que un `false` no resuelve nada y la política se queda en UNKNOWN.
     */
    const hayAlgoQueDecir =
        historialConsultado !== undefined ||
        pagos.length > 0 ||
        num(repartos['yield_12m_pct']) !== undefined;
    const bloqueRepartos = !hayAlgoQueDecir
        ? undefined
        : limpiar({
              ...(sobre('canonical:fondosdb', fechaFicha) ?? {}),
              records_checked: historialConsultado ?? false,
              currency: pagos.length > 0 ? divisaDelReparto : undefined,
              yield_12m: siCabe(TIPO_REPARTOS, 'yield_12m', frac(repartos['yield_12m_pct'])),
              payments: pagos
          });
    if (bloqueRepartos !== undefined && fechaFicha !== undefined) {
        documentos.push({
            ruta: `instruments/${isin}/declared/distributions`,
            tipo: TIPO_REPARTOS,
            documento: bloqueRepartos
        });
    } else {
        /* NOT_YET_FETCHED y no NOT_PROVIDED: el proveedor tiene el dato y el extractor ya
           sabe pedirlo; lo que falta es la pasada. El 01-11 faltaba en 568 clases. */
        ausencias.push({ ruta: 'declared/distributions', razon: 'NOT_YET_FETCHED' });
    }

    /* ---- declared/provenance ---- */

    const campos = obj(en(ficha, 'provenance', 'fields'));
    const procedencia: Record<string, unknown> = {};
    for (const [ruta, fuente] of Object.entries(campos)) {
        const f = txt(fuente);
        if (f === undefined || fechaFicha === undefined) continue;
        procedencia[ruta] = { source: f, as_of: fechaFicha };
    }
    const paquete = txt(en(ficha, 'provenance', 'version')) ?? txt(ficha['generated_at']);
    if (paquete !== undefined && Object.keys(procedencia).length > 0) {
        documentos.push({
            ruta: `instruments/${isin}/declared/provenance`,
            tipo: 'instrument-declared-provenance.v2.schema.json',
            documento: { package_id: paquete, fields: procedencia }
        });
    } else {
        ausencias.push({ ruta: 'declared/provenance', razon: 'NOT_PROVIDED' });
    }

    sellarAusenciaDeMetricas(raiz, ausencias);
    return { instrument_id: isin, documentos, ausencias, perdidas, avisos, errores };
}

/**
 * Los bloques de un fondo que a una ACCION no le aplican, con el porqué de cada uno.
 *
 * Están aquí, y no sueltos en el código, porque la pregunta que esta tabla contesta se va a
 * hacer muchas veces: *¿por qué esta acción no tiene coste corriente?* Un campo ausente sin
 * explicación es la próxima persona preguntándose si se olvidó, y la respuesta tiene que estar
 * en la base —`quality/latest.absences` con razón `NOT_APPLICABLE`— y no en la cabeza de
 * quien escribió el mapper.
 *
 * Todos son `NOT_APPLICABLE` y ninguno es `NOT_PROVIDED`: la diferencia es exactamente la que
 * esta base viene a establecer. `NOT_PROVIDED` dice «existe y no lo tenemos», que manda a
 * alguien a buscarlo; `NOT_APPLICABLE` dice «no existe para este producto», que cierra la
 * pregunta.
 */
export const BLOQUES_QUE_NO_APLICAN_A_UNA_ACCION: Readonly<Record<string, string>> = {
    'declared/profile':
        'es el perfil de una CLASE de fondo: su campo obligatorio es la politica de reparto, y una accion no tiene clases. Lo que una accion si tiene —a que se dedica, su sector— esta en declared/equity',
    'declared/costs':
        'una accion no tiene coste corriente ni comision de gestion. Lo que paga un inversor por comprarla es el corretaje de su intermediario, que es un coste SUYO y no del instrumento, y no es comparable entre productos',
    'declared/regulatory':
        'el SRI sale de un KID de PRIIPs y el SRRI de un DFI de UCITS, y una accion no tiene ninguno de los dos documentos. Es la decision de Oscar del 01-11-2026: una accion se queda sin el 1-7 y la ficha lo dice, en vez de recalcularlo con un cubo de volatilidad y archivarlo como si fuera regulatorio',
    'declared/exposure':
        'el reparto de una accion es renta variable al 100 % POR SER una accion, no porque un tercero lo haya medido a una fecha. Escribir una tautologia en la capa de lo que afirma un tercero seria mentir sobre quien lo afirma; la tarjeta si lo lleva, marcado BY_INSTRUMENT_TYPE, porque una proyeccion es el sitio de una copia derivada',
    'declared/fixed_income':
        'no tiene renta fija. Ya lo decia el predicado CON_RENTA_FIJA, que es anterior a las acciones',
    'declared/provider_risk':
        'no hay cifra de proveedor que guardar: medido el 01-11-2026, las metricas de las 73 acciones salen de NUESTRO calculo sobre la serie de EODHD, con su tipo libre de riesgo y sus observaciones. Escribirlas aqui es el defecto que mas veces ha aparecido en la base vieja, y el mapper no lo hace ni por omision',
    'declared/provider_returns': 'lo mismo que el riesgo del proveedor: la rentabilidad es nuestra y va a computed/metrics',
    'declared/sustainability':
        'el canonico no trae globos de sostenibilidad de ninguna accion. Es NOT_APPLICABLE y no NOT_PROVIDED porque esos globos son una calificacion de FONDOS: la de una empresa seria otra cosa y tendria otro contrato',
    'declared/size':
        'el patrimonio de un fondo es el dinero que le han confiado, y una accion no tiene eso. Su «tamano» es la capitalizacion, que es lo que vale la empresa en bolsa: ni es la misma magnitud ni la declara la misma persona, y vive con los fundamentales del emisor. Ponerla en el campo `aum` seria la version de libro del defecto que motiva esta base',
    'declared/holdings':
        'una accion no tiene cartera. Ya lo decia el predicado FONDO_O_ETF de ese bloque, que es anterior',
    'declared/distributions':
        'ese bloque es la politica y el historial de reparto de una CLASE, y existe para ARREGLAR la serie. Una accion paga dividendos de verdad, que van a declared/dividends, y su serie ya esta ajustada por ellos: no hay nada que arreglar'
};

/** Cuánto atrás cuenta una fecha ex-dividendo como señal de que la acción pagó en los últimos doce meses. */
const DIAS_DE_PAGOS_RECIENTES = 365;

/**
 * «Pagado en 12 meses»: un cero que el propio proveedor desmiente no se escribe (Óscar, 21-11-2026).
 *
 * El importe llega de Yahoo (`trailingAnnualDividendRate`), y medido el 21-11-2026 sobre las 508 acciones con bloque de
 * dividendos, 144 lo traen a 0 y 49 de ellas tienen a la vez rentabilidad por dividendo o dividendo previsto mayor que
 * cero (Roche, yield 2,2 % y 12,9 previstos), y 2 más una fecha ex-dividendo de los últimos doce meses. El proveedor se
 * contradice consigo mismo, y un cero creíble es peor que un hueco: ese importe no entra, y queda como no proporcionado.
 *
 * Sin ninguna de las tres señales el cero SÍ se escribe: es una empresa que no paga, y decir que falta el dato sería
 * esconderlo. Las tres señales son del mismo proveedor y no hay historial de pagos con el que contrastarlas (la serie
 * está ajustada por dividendos): es una regla sobre la coherencia del dato, no una comprobación contra los pagos.
 *
 * La fecha de referencia es la de la ficha, no la de la pasada, para que la misma ficha dé siempre lo mismo. Una
 * ex-dividendo posterior a la ficha no cuenta: es un dividendo anunciado, y eso ya lo dice el previsto.
 */
export function pagadoQueNoSeContradice(
    pagado: number | undefined,
    rendimiento: number | undefined,
    previsto: number | undefined,
    exDividendo: string | undefined,
    fechaDeLaFicha: string | undefined
): { valor: number | undefined; contradicho?: string } {
    if (pagado !== 0) return { valor: pagado };
    const senales: string[] = [];
    if (rendimiento !== undefined && rendimiento > 0) senales.push(`rentabilidad por dividendo ${rendimiento}`);
    if (previsto !== undefined && previsto > 0) senales.push(`dividendo previsto ${previsto}`);
    if (exDividendo !== undefined && fechaDeLaFicha !== undefined) {
        const dias = (Date.parse(`${fechaDeLaFicha}T00:00:00Z`) - Date.parse(`${exDividendo}T00:00:00Z`)) / 86_400_000;
        if (dias >= 0 && dias <= DIAS_DE_PAGOS_RECIENTES) senales.push(`ex-dividendo el ${exDividendo}`);
    }
    return senales.length === 0 ? { valor: 0 } : { valor: undefined, contradicho: senales.join(', ') };
}

/**
 * Mapea una ACCION. Produce la raíz, los tres bloques que una acción sí tiene
 * —`declared/equity`, `declared/dividends` y `declared/quote`—, `computed/metrics` cuando hay
 * derecho a calcularlo, y una ausencia `NOT_APPLICABLE` por cada bloque de fondo que no le
 * toca, con el porqué escrito.
 *
 * **Lo que esta función hace a propósito, y es la razón de que exista:** no escribe NUNCA
 * `declared/provider_risk` ni `declared/provider_returns`. Está medido el 01-11-2026 y es el
 * hallazgo que condicionó el diseño entero de F1: las volatilidades, los Sharpe, las caídas
 * máximas y las rentabilidades de las 73 acciones las calculamos NOSOTROS, en
 * `core/metricas.py::metricas_diarias`, sobre la serie diaria ajustada de EODHD y contra el
 * €STR del BCE. No hay proveedor detrás de ninguna.
 *
 * Y el mapper de fondos las habría archivado como del proveedor sin que nada chillara. El
 * filtro que separa las nuestras de las suyas es `meta.procedencia`, y **las acciones no lo
 * traen: 0 de 73**. Con la procedencia vacía, `esNuestra()` dice «no» para todas las rutas,
 * así que la rama de `provider_risk` se habría llevado las cifras y `computed/metrics` se
 * habría quedado vacío. Eso es exactamente el segundo de los cinco defectos que motivan esta
 * base —métricas propias archivadas como del proveedor— reproducido en la base nueva el primer
 * día que entra un tipo de instrumento nuevo. Aquí no hay filtro que pueda fallar: para una
 * acción, la cifra es nuestra porque no existe otra.
 */
export function mapearAccion(
    ficha: FichaCanonica,
    universal: RegistroUniversal,
    ahora: string
): ResultadoDeMapeo {
    const ausencias: AusenciaAnotada[] = [];
    const perdidas: string[] = [];
    const avisos: string[] = [];
    const errores: string[] = [];
    const documentos: DocumentoMapeado[] = [];

    const isin = txt(ficha['isin']) ?? txt(universal['_id']) ?? '';
    const vacio: ResultadoDeMapeo = { instrument_id: isin, documentos, ausencias, perdidas, avisos, errores };
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
        errores.push(`el ISIN no tiene forma de ISIN: ${JSON.stringify(isin)}`);
        return vacio;
    }

    const siCabe = (tipoDoc: string, ruta: string, valor: number | undefined): number | undefined => {
        if (valor === undefined) return undefined;
        if (enRango(tipoDoc, ruta, valor)) return valor;
        avisos.push(`${ruta} fuera del rango del contrato: ${valor}`);
        return undefined;
    };

    const identificacion = obj(universal['identificacion']);
    const valoracion = obj(universal['valoracion']);
    const riesgo = obj(universal['riesgo']);
    const rentabilidad = obj(universal['rentabilidad']);
    const historial = obj(riesgo['historial_precios']);
    const fundamentales = obj(universal['fundamentales']);
    const clasificacion = obj(ficha['classification_v2']);

    /* ---- la raíz ---- */

    const nombre = txt(ficha['name']) ?? txt(identificacion['nombre']);
    if (nombre === undefined) {
        errores.push('sin nombre');
        return vacio;
    }
    const divisa = txt(ficha['currency']) ?? txt(identificacion['divisa_base']);
    if (divisa === undefined || !/^[A-Z]{3}$/.test(divisa)) {
        errores.push(`sin divisa utilizable: ${JSON.stringify(divisa)}`);
        return vacio;
    }
    /*
     * La clase de activo de una acción sale de `classification_v2.asset_type`, que dice
     * `'stock'`, y no de `identificacion.clase_activo`, que las acciones no traen porque es un
     * campo de ficha de fondo. La tabla lo traduce a `EQUITY` y para si no lo conoce.
     */
    let claseDeActivo: string;
    const claseBruta = txt(identificacion['clase_activo']) ?? txt(clasificacion['asset_type']);
    if (claseBruta === undefined) {
        errores.push('sin clase de activo en ninguna de las dos ortografias del canonico');
        return vacio;
    }
    try {
        claseDeActivo = traducir(CLASE_ACTIVO, 'clase_activo', claseBruta);
    } catch (error) {
        errores.push(error instanceof TraduccionDesconocida ? error.message : String(error));
        return vacio;
    }

    const firds = identidadFirds(ficha, avisos);
    const raiz = limpiar({
        instrument_id: isin,
        instrument_type: 'STOCK',
        schema_version: 'base-nueva.instrument.v2',
        updated_at: ahora,
        identity: { name: nombre, name_folded: plegar(nombre), currency: divisa },
        identifiers: { ticker: txt(identificacion['ticker']), cfi: firds.cfi, lei: firds.lei },
        /* Ni categoría de proveedor ni índice de referencia: las 73 traen la categoría a null
           y una acción no declara benchmark en ningún folleto. El contrato lo sabe —los dos
           campos están condicionados al tipo— así que la raíz sale válida sin ellos. */
        /* En una acción la clase la dice el proveedor y punto: `asset_type: "stock"` se traduce
           a EQUITY, y no hay reparto del que deducir nada porque una acción no reparte. */
        classification: { asset_class: claseDeActivo, asset_class_resolution: 'PROVIDER' },
        listings: firds.listings,
        listings_as_of: firds.listings_as_of,
        availability: disponibilidad(ficha, avisos)
    });
    if (raiz === undefined) {
        errores.push('la raiz ha salido vacia');
        return vacio;
    }
    documentos.push({ ruta: `instruments/${isin}`, tipo: 'instrument.v2.schema.json', documento: raiz });
    ausencias.push({
        ruta: 'classification.category',
        razon: 'NOT_APPLICABLE',
        detalle: 'una accion no tiene categoria de proveedor; lo que la agrupa es su sector'
    });
    ausencias.push({
        ruta: 'classification.official_benchmark',
        razon: 'NOT_APPLICABLE',
        detalle: 'una accion no declara indice de referencia en ningun folleto'
    });
    ausencias.push({
        ruta: 'product',
        razon: 'NOT_APPLICABLE',
        detalle: 'domicilio, marco legal, fecha de lanzamiento y clase son de un fondo'
    });

    /* ---- declared/equity ---- */

    const fechaFicha = fecha(ficha['report_date']) ?? fecha(identificacion['fecha_dato']) ?? fecha(valoracion['vl_fecha']);
    const mercado = txt(identificacion['mercado']);
    let paisDelMercado: string | undefined;
    const paisBruto = txt(identificacion['pais']);
    if (paisBruto !== undefined) {
        paisDelMercado = PAIS_DEL_MERCADO[paisBruto];
        if (paisDelMercado === undefined) avisos.push(`pais del mercado sin traduccion: ${paisBruto}`);
    }
    /* Decisión 46. Un motivo que la tabla no conozca para la ingesta, como en todas las traducciones. */
    let noPrincipal: string | undefined;
    const avisoDeCotizacion = txt(identificacion['cotizacion_aviso']);
    if (avisoDeCotizacion !== undefined) {
        try {
            noPrincipal = traducir(COTIZACION_NO_PRINCIPAL, 'identificacion.cotizacion_aviso', avisoDeCotizacion);
        } catch (error) {
            errores.push(error instanceof TraduccionDesconocida ? error.message : String(error));
            return vacio;
        }
    }
    const equity = limpiar({
        ...(sobre('canonical:fondosdb', fechaFicha) ?? {}),
        listing: { exchange: mercado, country: paisDelMercado, non_primary_reason: noPrincipal },
        sector: txt(identificacion['sector']),
        industry: txt(identificacion['industria']),
        business_description: textoLimpio(identificacion['descripcion']) ?? textoLimpio(en(ficha, 'ms', 'objective'))
    });
    if (equity !== undefined && mercado !== undefined && fechaFicha !== undefined) {
        documentos.push({
            ruta: `instruments/${isin}/declared/equity`,
            tipo: 'instrument-declared-equity.v2.schema.json',
            documento: equity
        });
        if (txt(identificacion['sector']) === undefined) {
            ausencias.push({
                ruta: 'declared/equity.sector',
                razon: 'NOT_PROVIDED',
                detalle: 'el canonico trae la cadena vacia, que es un centinela y no entra'
            });
        }
    } else {
        ausencias.push({
            ruta: 'declared/equity',
            razon: 'NOT_PROVIDED',
            detalle: 'sin mercado o sin fecha de ficha: sin el mercado no se puede nombrar de donde sale el precio'
        });
    }

    /* ---- declared/dividends ---- */

    const TIPO_DIVIDENDOS = 'instrument-declared-dividends.v2.schema.json';
    const bloqueDividendos = obj(fundamentales['dividends']);
    const porAccion = obj(fundamentales['per_share']);
    /*
     * El rendimiento llega en dos sitios y en dos unidades a la vez —`dividends.yield_ratio` en
     * fracción y `dividend_yield_pct` en por ciento, 0,0316 y 3,16 en la misma ficha—, que es
     * la unidad escondida en el nombre en su forma más pura. Entra la fracción; si no está,
     * el por ciento dividido, que es la misma cifra con la unidad declarada aparte.
     */
    const rendimiento =
        num(bloqueDividendos['yield_ratio']) ?? frac(fundamentales['dividend_yield_pct']);
    const divisaDelDividendo = txt(fundamentales['currency']) ?? divisa;
    const anunciado = num(bloqueDividendos['forward_annual_rate']);
    const exDividendo = fecha(bloqueDividendos['ex_dividend_date']);
    const pagado = pagadoQueNoSeContradice(num(porAccion['dividend']), rendimiento, anunciado, exDividendo, fechaFicha);
    if (pagado.contradicho) {
        ausencias.push({
            ruta: 'declared/dividends.trailing_amount_per_share',
            razon: 'NOT_PROVIDED',
            detalle: `el proveedor da 0 pagado en 12 meses y a la vez ${pagado.contradicho}`
        });
    }
    const dividendos = limpiar({
        ...(sobre('canonical:fondosdb', fechaFicha) ?? {}),
        currency: pagado.valor !== undefined || anunciado !== undefined ? divisaDelDividendo : undefined,
        yield_12m: siCabe(TIPO_DIVIDENDOS, 'yield_12m', rendimiento),
        trailing_amount_per_share: siCabe(TIPO_DIVIDENDOS, 'trailing_amount_per_share', pagado.valor),
        forward_amount_per_share: siCabe(TIPO_DIVIDENDOS, 'forward_amount_per_share', anunciado),
        ex_dividend_date: exDividendo
    });
    const hayDividendo =
        dividendos !== undefined && Object.keys(dividendos).some((clave) => !CLAVES_DEL_SOBRE.includes(clave));
    if (hayDividendo && fechaFicha !== undefined) {
        documentos.push({
            ruta: `instruments/${isin}/declared/dividends`,
            tipo: TIPO_DIVIDENDOS,
            documento: dividendos as Record<string, unknown>
        });
    } else {
        /* `NOT_PROVIDED` y no `NOT_APPLICABLE`: una empresa que no reparte dividendo y una de
           la que no tenemos el dato se ven igual desde aquí, y afirmar que no reparte sin
           saberlo es justo lo que esta base no hace. */
        ausencias.push({
            ruta: 'declared/dividends',
            razon: 'NOT_PROVIDED',
            detalle: 'sin dato de dividendo; no se sabe si no reparte o si no lo tenemos'
        });
    }
    if (num(bloqueDividendos['payout_ratio']) !== undefined) {
        /* Es una razón contable de la EMPRESA —dividendo partido por beneficio— y su sitio es
           `issuers/{id}/fundamentals/latest.dividends.payout_ratio`, que existe desde el 01-11
           y está vacío porque esta base no puebla emisores todavía. Se cuenta, no se tira
           callada, y no se cuela en el bloque del instrumento. */
        perdidas.push('fundamentales.dividends.payout_ratio (es del emisor, y issuers no se puebla en F1)');
    }

    /* ---- declared/quote ---- */

    const cotizacion = bloqueDeCotizacion(universal, 'STOCK');
    if (cotizacion !== undefined && 'documento' in cotizacion) {
        documentos.push({
            ruta: `instruments/${isin}/declared/quote`,
            tipo: 'instrument-declared-quote.v2.schema.json',
            documento: cotizacion.documento
        });
    } else if (cotizacion !== undefined) {
        avisos.push(`${isin}: ${cotizacion.bloqueo}`);
        ausencias.push({ ruta: 'declared/quote', razon: 'NOT_PROVIDED', detalle: cotizacion.bloqueo });
    } else {
        ausencias.push({ ruta: 'declared/quote', razon: 'NOT_PROVIDED', detalle: 'sin precio o sin su fecha' });
    }

    /* ---- computed/metrics: NUESTRAS, y por eso no hay bloque de proveedor ---- */

    const TIPO_METRICAS = 'instrument-computed-metrics.v2.schema.json';
    const porVentanaDelFondo = (
        fuente: unknown,
        convertir: (valor: unknown) => number | undefined
    ): Record<string, number> | undefined => {
        const salida: Record<string, number> = {};
        for (const [periodoCanonico, porSujeto] of Object.entries(obj(fuente))) {
            const ventana = PERIODO[periodoCanonico];
            if (ventana === undefined) continue;
            /* El rango del contrato lo aplica `conLoQueNoCabeApartado` al documento entero,
               como en los fondos (decisión B-73): una ventana que no cabe se aparta y se anota,
               y ni se lleva por delante el documento ni se recorta. */
            const valor = convertir(obj(porSujeto)['fondo']);
            if (valor !== undefined) salida[ventana] = valor;
        }
        return Object.keys(salida).length === 0 ? undefined : salida;
    };

    const volatilidad = porVentanaDelFondo(riesgo['volatilidad_pct'], frac);
    /* La rentabilidad usa su propia tabla de ventanas: el canónico la llama `3a_anualizada` y
       no `3a`, y las claves que no caben en una de las cuatro ventanas se cuentan. */
    const anualizada: Record<string, number> = {};
    for (const [claveCanonica, porSujeto] of Object.entries(obj(rentabilidad['trailing_pct']))) {
        const ventana = TRAILING[claveCanonica];
        if (ventana === undefined) {
            if (TRAILING_SIN_SITIO.includes(claveCanonica)) {
                perdidas.push(`rentabilidad.trailing_pct.${claveCanonica}`);
            }
            continue;
        }
        const valor = frac(obj(porSujeto)['fondo']);
        if (valor !== undefined) anualizada[ventana] = valor;
    }

    /*
     * La divisa EN LA QUE SE CALCULÓ, que no es la del listado. Desde la versión 2 del método
     * (§5 de `METODO_PROPIO_METRICAS`) el extractor lleva la serie de toda acción a euros con el
     * cambio del BCE antes de calcular, y lo sella en `historial_precios.divisa_metricas`; una
     * ficha anterior sin el sello solo cuenta como euros si su serie ya lo era.
     */
    const divisaDelCalculo =
        txt(historial['divisa_metricas']) ?? (txt(historial['divisa']) === 'EUR' ? 'EUR' : undefined);

    /*
     * El Sharpe, que va con la divisa del CÁLCULO y no con la del listado (P1-05, 21-11-2026).
     *
     * Hasta la versión 1 la rentabilidad estaba en la divisa del listado y restarle el €STR
     * mezclaba dos divisas, así que aquí se miraba la divisa de cotización y fuera del euro no
     * se publicaba. Desde la 2 la serie llega en euros y el €STR es el tipo que le corresponde:
     * mirar la cotización borraba un Sharpe coherente en todas las acciones que no cotizan en
     * euros —259 de 261 en la exportación del 17-11-2026— y dejaba una ausencia falsa.
     *
     * Lo que no cambia: el de una acción no se ENSEÑA (Óscar, 04-11-2026; §9 del método), y la
     * tarjeta ya lo quita. Se guarda en `computed/metrics`, como el de las que cotizan en euros.
     * Y una ficha calculada en otra divisa no publica ninguna métrica (`NEEDS_FX`, más abajo).
     */
    const sharpeCalculado = porVentanaDelFondo(riesgo['sharpe'], num);
    const sharpe = divisaDelCalculo === 'EUR' ? sharpeCalculado : undefined;

    /*
     * La caída máxima de una acción, en TODAS sus ventanas.
     *
     * Medido el 02-11-2026 sobre la base ya escrita: de las 297 acciones con métricas
     * nuestras, 290 tenían caída máxima y las 290 la tenían SOLO a cinco años, porque el
     * canónico traía un escalar con la mejor ventana disponible y su `periodo` suelto. El
     * cálculo de las otras dos estaba hecho y se tiraba.
     *
     * El escalar se queda como respaldo: un canónico generado antes de ese cambio sigue
     * dando su única ventana en vez de quedarse sin ninguna. Y el `inferior_5a` que el
     * extractor escribe cuando la serie no llega a cinco años sigue sin entrar: una caída
     * sin saber sobre qué ventana se midió no se puede comparar con otra.
     */
    const caida = obj(riesgo['max_drawdown']);
    const ventanaCaida = PERIODO[txt(caida['periodo']) ?? ''];
    const caidaFrac = frac(caida['pct']);
    const caidaPorVentana = porVentanaDelFondo(riesgo['max_drawdown_pct'], frac);
    let caidaMaxima: Record<string, number> | undefined = caidaPorVentana;
    if (caidaMaxima === undefined && caidaFrac !== undefined && ventanaCaida !== undefined) {
        caidaMaxima = { [ventanaCaida]: caidaFrac };
    } else if (caidaMaxima === undefined && caidaFrac !== undefined) {
        perdidas.push(`riesgo.max_drawdown.periodo = ${String(txt(caida['periodo']))}, sin ventana del contrato`);
    }
    /* El Sortino por el camino diario todavía no lo calcula nadie —`METRICAS_POR_VENTANA` en
       `fetchers/eodhd.py` no lo lleva—, así que hoy esto vale `undefined` en las 297. Está
       mapeado igual porque el contrato lo declara y el día que esa tabla crezca la cifra
       llega sin tocar la plataforma, que es la asimetría que acabamos de pagar con la caída. */
    const sortino = porVentanaDelFondo(riesgo['sortino'], num);

    const serie = txt(historial['source_listing_id']);
    /*
     * El ajuste de la serie, que es lo que da derecho a calcular: sale de QUIÉN la trajo y no
     * de una constante. Las dos fuentes de hoy —EODHD y Yahoo— entregan serie ajustada por
     * desdoblamientos y dividendos, comprobado en su código. Una fuente que no esté en la
     * tabla no escribe métricas, porque una serie sin ajustar da rentabilidad de solo precio y
     * publicarla como retorno total es el defecto de siempre con otra cara.
     */
    const ajuste = AJUSTE_DE_SERIE[txt(historial['source_history']) ?? ''];
    const hayCifra =
        volatilidad !== undefined ||
        sharpeCalculado !== undefined ||
        sortino !== undefined ||
        caidaMaxima !== undefined ||
        Object.keys(anualizada).length > 0;

    /*
     * Beta y R² contra la referencia de donde cotiza (decisiones 12 y 24). Las dos únicas: el
     * extractor no escribe más en una acción, y el contrato prohíbe el alfa en esta referencia.
     * El alcance viaja porque la ficha tiene que poder decir si el índice es de su plaza o de
     * su área: una beta contra MSCI Europe no es una beta contra su mercado.
     */
    const contraSuReferencia = obj(riesgo['relativas']);
    const alcanceDeLaReferencia = txt(contraSuReferencia['alcance']);
    const ventanasDeLaReferencia = (
        nombre: string,
        convertir: (valor: unknown) => number | undefined
    ): Record<string, number> | undefined => {
        const salida: Record<string, number> = {};
        for (const [periodo, bruto] of Object.entries(obj(contraSuReferencia[nombre]))) {
            const ventana = PERIODO[periodo];
            const valor = convertir(bruto);
            if (ventana !== undefined && valor !== undefined) salida[ventana] = valor;
        }
        return Object.keys(salida).length === 0 ? undefined : salida;
    };
    const serieDeLaReferencia = identidadDeLaSerieDelIndice(
        txt(contraSuReferencia['indice_proxy']),
        contraSuReferencia['indice_clase_de_serie']
    );
    const relativaDeLaAccion =
        txt(contraSuReferencia['indice_nombre']) === undefined ||
        txt(contraSuReferencia['indice_variante']) === undefined ||
        txt(contraSuReferencia['base_indice']) === undefined ||
        (alcanceDeLaReferencia !== 'AREA' && alcanceDeLaReferencia !== 'MERCADO')
            ? undefined
            : limpiar({
                  reference: alcanceDeLaReferencia === 'AREA' ? 'ASSIGNED_AREA_INDEX' : 'ASSIGNED_MARKET_INDEX',
                  frequency: 'MONTHLY',
                  benchmark: limpiar({
                      name: txt(contraSuReferencia['indice_nombre']),
                      /* La referencia de una acción es hoy un fondo índice; si un día fuera el
                         nivel del índice, viaja igual que en un fondo (decisión 23). */
                      instrument_id: serieDeLaReferencia.instrument_id,
                      source_series_id: serieDeLaReferencia.source_series_id,
                      currency: 'EUR',
                      variant: txt(contraSuReferencia['indice_variante']),
                      return_basis: txt(contraSuReferencia['base_indice']),
                      series_class: serieDeLaReferencia.series_class
                  }),
                  beta: ventanasDeLaReferencia('beta', num),
                  r2: ventanasDeLaReferencia('r2', frac)
              });
    /* Las dos son decisiones por bolsa, y por eso ninguna es un hueco: una fila que dice que no hay referencia, o una
       bolsa sin fila, que el extractor avisa desde la decisión 40 y la base dice desde la 46. */
    const ausenciaDecidida = ausenciaRelativaDeAccion(txt(contraSuReferencia['aviso']));

    if (!hayCifra) {
        ausencias.push({ ruta: 'computed/metrics', ...razonSinMetricasPropias(historial, 'STOCK', perdidas) });
    } else if (divisaDelCalculo !== 'EUR') {
        /* Metodo V2: solo se publica en euros. Una ficha anterior, en la divisa del listado,
           espera su recalculo en vez de publicarse como si fuera comparable. */
        ausencias.push({
            ruta: 'computed/metrics',
            motivo: 'NEEDS_FX',
            razon: 'NOT_YET_FETCHED',
            detalle: `calculada en ${String(txt(historial['divisa']))}: falta recalcularla en euros`
        });
    } else if (serie === undefined) {
        ausencias.push({
            ruta: 'computed/metrics',
            motivo: 'UNIDENTIFIED_SERIES',
            razon: 'NOT_PROVIDED',
            detalle: 'hay cifras pero no se puede nombrar la serie con la que se calcularon'
        });
    } else if (ajuste === undefined) {
        ausencias.push({
            ruta: 'computed/metrics',
            motivo: 'UNIDENTIFIED_SERIES',
            razon: 'NOT_PROVIDED',
            detalle: `serie de ${String(txt(historial['source_history']))}, cuyo ajuste no esta declarado: sin saberlo no hay derecho a publicar la cifra como retorno total`
        });
        avisos.push(`fuente de serie sin ajuste declarado: ${String(txt(historial['source_history']))}`);
    } else {
        /*
         * El tipo libre de riesgo, con el único matiz del bloque. El canónico lo etiqueta en
         * `historial_precios.rf_referencia`, y las 73 fichas NO lo traen: el valor del tipo sí
         * viaja —`riesgo.rf_pct` está en 72 de 73— pero la etiqueta no. No se inventa: el
         * campo se queda ausente y se anota.
         *
         * Por qué eso no impide publicar el Sharpe, que es la pregunta justa: la función que
         * calcula ese tipo con el €STR está en el extractor desde el 22-06-2026 y la etiqueta
         * se añadió el 14-10-2026, y estas fichas son del 18-07. Comprobado en la historia de
         * Git, no deducido. Así que la cifra se calculó con el €STR y lo que falta es el sello
         * de la pasada que la produjo, que la siguiente pondrá. Tirar 71 Sharpe coherentes por
         * una etiqueta recuperable sí sería suprimir el Sharpe.
         */
        const tipoLibre = txt(historial['rf_referencia']);
        if (tipoLibre === undefined && sharpe !== undefined) {
            ausencias.push({
                ruta: 'computed/metrics.inputs.risk_free_source',
                razon: 'NOT_PROVIDED',
                detalle: 'la pasada del 18-07-2026 no sellaba la etiqueta del tipo; el valor si viaja en riesgo.rf_pct'
            });
        }
        const metricas = limpiar({
            computed_at: fecha(riesgo['fecha_dato']) ?? fechaFicha ?? ahora,
            as_of: fecha(riesgo['fecha_dato']),
            /* No es `EXTRACTOR_MONTHLY_*`: ese es el de los fondos, con rentabilidades
               mensuales y ventanas de meses cerrados. El de una acción muestrea DIARIO y
               cuenta la ventana desde el último día de la serie. Cuatro parámetros distintos,
               así que otro nombre de método: `METODO_PROPIO_METRICAS` dice que cambiar un
               parámetro cambia la versión, porque las cifras no son comparables. Y la versión
               la dice la ficha (`versionDelMetodo`): la 3 anualiza la volatilidad con las
               observaciones que hay, y una ficha sin sello es de la 2. */
            method: `EXTRACTOR_DAILY_V${versionDelMetodo(historial['metodo'])}`,
            frequency: 'DAILY',
            /* Se DERIVA del ajuste de la serie y no se supone: el cierre ajustado de EODHD
               reparte hacia atrás los desdoblamientos y los dividendos, así que el dividendo
               ya está dentro del precio con el que se calcula. */
            return_basis: 'TOTAL_RETURN',
            inputs: limpiar({
                series_id: serie,
                currency: divisaDelCalculo,
                source_currency: txt(historial['divisa_origen']),
                fx_source: txt(historial['fx_source']),
                series_adjustment: ajuste,
                risk_free_source: tipoLibre,
                observations: siCabe(
                    TIPO_METRICAS,
                    'inputs.observations',
                    num(historial['observations_count']) === undefined
                        ? undefined
                        : Math.trunc(num(historial['observations_count']) as number)
                ),
                first_date: fecha(historial['first_date']),
                last_date: fecha(historial['last_date']),
                series_gaps: huecosDeLaSerie(historial)
            }),
            volatility: volatilidad,
            sharpe,
            sortino,
            max_drawdown: caidaMaxima,
            annualized_return: Object.keys(anualizada).length > 0 ? anualizada : undefined,
            relative: relativaDeLaAccion,
            relative_absence: ausenciaDecidida
        });
        if (metricas !== undefined) {
            documentos.push({
                ruta: `instruments/${isin}/computed/metrics`,
                tipo: TIPO_METRICAS,
                documento: conLoQueNoCabeApartado(TIPO_METRICAS, metricas, avisos),
                /* Lo calculó un lote dentro del extractor, aunque lo traiga la plataforma. */
                comoDueno: 'batch'
            });
        }
    }
    if (relativaDeLaAccion === undefined) {
        ausencias.push({
            ruta: 'computed/metrics.relative',
            razon: ausenciaDecidida !== undefined ? 'NOT_APPLICABLE' : 'NOT_PROVIDED',
            detalle:
                ausenciaDecidida === 'NO_REFERENCE_FOR_MARKET'
                    ? 'decidido: no se mide contra un indice de otra plaza'
                    : ausenciaDecidida === 'NO_REFERENCE_DECIDED_FOR_MARKET'
                      ? 'su bolsa no tiene fila en indices_de_accion.csv: es una decision por bolsa, no un dato que falte'
                      : 'sin tres anos de serie comun con su referencia'
        });
    }

    /* ---- declared/provenance ---- */

    const campos = obj(en(ficha, 'provenance', 'fields'));
    const procedencia: Record<string, unknown> = {};
    for (const [ruta, fuente] of Object.entries(campos)) {
        const f = txt(fuente);
        if (f === undefined || fechaFicha === undefined) continue;
        procedencia[ruta] = { source: f, as_of: fechaFicha };
    }
    const paquete = txt(en(ficha, 'provenance', 'version')) ?? txt(ficha['generated_at']);
    if (paquete !== undefined && Object.keys(procedencia).length > 0) {
        documentos.push({
            ruta: `instruments/${isin}/declared/provenance`,
            tipo: 'instrument-declared-provenance.v2.schema.json',
            documento: { package_id: paquete, fields: procedencia }
        });
    } else {
        /* Medido el 01-11-2026: las 73 acciones traen las doce claves de
           `provenance.fields` a null, así que no hay procedencia por campo que guardar. Es
           `NOT_PROVIDED` y no `NOT_APPLICABLE`: el canónico tiene el hueco hecho y lo deja
           vacío, así que el dato existiría si la pasada lo rellenara. */
        ausencias.push({
            ruta: 'declared/provenance',
            razon: 'NOT_PROVIDED',
            detalle: 'el canonico trae las claves de provenance.fields a null en las 73 acciones'
        });
    }

    /* ---- y lo que no aplica, con el porqué de cada uno ---- */

    for (const [bloque, porQue] of Object.entries(BLOQUES_QUE_NO_APLICAN_A_UNA_ACCION)) {
        ausencias.push({ ruta: bloque, razon: 'NOT_APPLICABLE', detalle: porQue });
    }

    /*
     * Los fundamentales, contados y no tirados callados. Existen —71 de las 73 traen el resumen
     * `bdb.fundamentals-summary.v1` entero— y no entran en F1 por dos razones distintas: son de
     * la EMPRESA y no de la acción, y su sitio es `issuers/{id}/fundamentals/latest`, que esta
     * base no puebla todavía porque emparejar cada nombre con su entidad es una decisión
     * humana por instrumento.
     */
    const bloquesDeFundamentales = ['valuation', 'profitability', 'growth', 'per_share', 'capital', 'technicals', 'analyst'].filter(
        (clave) => Object.keys(obj(fundamentales[clave])).length > 0
    );
    if (bloquesDeFundamentales.length > 0) {
        perdidas.push(
            `fundamentales.{${bloquesDeFundamentales.join(',')}} (son del emisor; issuers/{id}/fundamentals/latest existe y no se puebla en F1)`
        );
    }

    sellarAusenciaDeMetricas(raiz, ausencias);
    return { instrument_id: isin, documentos, ausencias, perdidas, avisos, errores };
}

/**
 * Los bloques que este mapper PUEDE producir para un instrumento, con su esquema. Es la
 * lista que el escritor necesita para detectar sobrantes y la auditoría para contar, y
 * existe en un solo sitio para que las tres no se desincronicen.
 */
export const BLOQUES_DE_INSTRUMENTO: Readonly<Record<string, string>> = {
    'declared/profile': 'instrument-declared-profile.v2.schema.json',
    'declared/costs': 'instrument-declared-costs.v2.schema.json',
    'declared/regulatory': 'instrument-declared-regulatory.v2.schema.json',
    'declared/exposure': 'instrument-declared-exposure.v2.schema.json',
    'declared/fixed_income': 'instrument-declared-fixed-income.v2.schema.json',
    'declared/provider_risk': 'instrument-declared-provider-risk.v2.schema.json',
    'declared/provider_returns': 'instrument-declared-provider-returns.v2.schema.json',
    'declared/sustainability': 'instrument-declared-sustainability.v2.schema.json',
    'declared/size': 'instrument-declared-size.v2.schema.json',
    'declared/holdings': 'instrument-declared-holdings.v2.schema.json',
    'declared/distributions': 'instrument-declared-distributions.v2.schema.json',
    'declared/provenance': 'instrument-declared-provenance.v2.schema.json',
    /* Lo que publica el emisor de un ETF (decisiones 51 y 52). Va en el registro para que la deteccion de sobrantes y la tarjeta lo
       conozcan; sus contratos llevan `x-counts-when: NUNCA` y por eso no mueven la cobertura de nadie. */
    'declared/issuer_data': 'instrument-declared-issuer-data.v2.schema.json',
    'computed/premium_discount': 'instrument-computed-premium-discount.v2.schema.json',
    /* La cartera completa del emisor de un ETF (decisión B-79): uso interno, solo para el asesor. Lo escribe `carteraDelEmisor.ts`, con
       sus trozos en `issuer_holdings_chunks`; `x-counts-when: NUNCA`, así que no mueve la cobertura de nadie. */
    'declared/issuer_holdings': 'instrument-declared-issuer-holdings.v2.schema.json',
    /* El mercado objetivo del EMT del fabricante (decisión 58). Mismo motivo: sobrantes, auditoría y lote lo conocen, y su
       `x-counts-when: NUNCA` lo deja fuera de la cobertura. Lo escribe `mercadoObjetivo.ts`, enganchado junto al del emisor. */
    'declared/target_market': 'instrument-declared-target-market.v2.schema.json',
    /* El precio, que hasta el 01-11-2026 no tenía sitio en ningún contrato y es de TODOS los
       tipos: un fondo tampoco lo tenía. Ver `instrument-declared-quote.v2`. */
    'declared/quote': 'instrument-declared-quote.v2.schema.json',
    /* Los dos de las ACCIONES. Están en el registro porque la cobertura y la detección de
       sobrantes tienen que conocerlos; el predicado `ACCION` de sus contratos es lo que hace
       que no cuenten en un fondo. */
    'declared/equity': 'instrument-declared-equity.v2.schema.json',
    'declared/dividends': 'instrument-declared-dividends.v2.schema.json',
    /* El único que no es `declared/*`: lo calculamos nosotros, y por eso vive en otra capa
       y con otro dueño. Entró en el registro el 01-11, cuando dejó de estar vacío. */
    'computed/metrics': 'instrument-computed-metrics.v2.schema.json'
};

/** Todas las rutas que el mapper podría escribir para un instrumento. */
export function rutasPosiblesDe(isin: string): string[] {
    return [
        `instruments/${isin}`,
        ...Object.keys(BLOQUES_DE_INSTRUMENTO).map((sufijo) => `instruments/${isin}/${sufijo}`)
    ];
}

/** Minúsculas y sin diacríticos, para la búsqueda por subcadena. */
export function plegar(texto: string): string {
    return texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}
