/**
 * src/ingestion/baseNueva/mercadoObjetivo.ts — el bloque `mercado_objetivo` del extractor en la base nueva
 * (decisión 58 de Óscar, 09-11-2026).
 *
 * Un solo documento, `instruments/{id}/declared/target_market`: el mercado objetivo que el fabricante declara en su EMT. Solo
 * EMT (el EET está aplazado), uso interno para el desarrollo (decisión 53) y fuera de la cobertura (`x-counts-when: NUNCA`). No
 * toca la calidad, la tarjeta ni ninguna métrica: ninguna de las tres lo lee.
 *
 * La forma de la entrada la fija Dirección y el lector de `1-extractor` la escribe ya normalizada; este módulo traduce, valida
 * fechas y vocabulario y, si algo no encaja, deja fuera ese dato con aviso. Sin `fecha_mercado_objetivo` válida no hay documento:
 * un mercado objetivo sin la fecha a la que se declara no se puede leer. El campo `03050` no tiene sitio a propósito (ver el
 * contrato): si alguna vez llegara, se avisa y no se escribe.
 *
 * Es puro: no lee ficheros ni la base.
 */
import { validarEscritura } from '../../config/baseNueva/validadores';
import { obj, txt, type DocumentoMapeado, type RegistroUniversal } from './mapper';
import {
    CANAL_DEL_EMT,
    CODIGO_DE_PERIODO_DEL_EMT,
    PREFERENCIAS_ESG_DEL_EMT,
    RESPUESTA_DEL_EMT,
    TIPO_PRODUCTO
} from './traducciones';

export const TIPO_MERCADO_OBJETIVO = 'instrument-declared-target-market.v2.schema.json';
export const SUFIJO_MERCADO_OBJETIVO = 'declared/target_market';

/** La fuente del extractor (`emisor:ishares`) y la del contrato (`issuer:ishares`). Abierta a más emisores. */
const FUENTE_DEL_EXTRACTOR = /^emisor:([a-z0-9_-]+)$/;
const VERSION_DE_PLANTILLA = /^V[0-9]+(\.[0-9]+)?$/;
const HUELLA = /^[a-f0-9]{64}$/;
const FECHA_ESTRICTA = /^(\d{4})-(\d{2})-(\d{2})$/;
/** El techo del contrato para `min_holding_period.years`. */
const ANOS_MAXIMOS = 100;

/**
 * Los grupos de respuestas del EMT: clave del extractor → clave del contrato, con el código EMT para los avisos. El orden es el
 * del contrato. Lo que no esté aquí no viaja: en `capacidad_perdidas`, el `03050` se queda fuera a propósito.
 */
const GRUPOS: readonly {
    extractor: string;
    contrato: string;
    campos: readonly { extractor: string; contrato: string; emt: string }[];
}[] = [
    {
        extractor: 'tipo_inversor',
        contrato: 'investor_type',
        campos: [
            { extractor: 'minorista', contrato: 'retail', emt: '01010' },
            { extractor: 'profesional', contrato: 'professional', emt: '01020' },
            { extractor: 'contraparte_elegible', contrato: 'eligible_counterparty', emt: '01030' }
        ]
    },
    {
        extractor: 'conocimiento',
        contrato: 'knowledge',
        campos: [
            { extractor: 'basico', contrato: 'basic', emt: '02010' },
            { extractor: 'informado', contrato: 'informed', emt: '02020' },
            { extractor: 'avanzado', contrato: 'advanced', emt: '02030' }
        ]
    },
    {
        extractor: 'capacidad_perdidas',
        contrato: 'loss_capacity',
        campos: [
            { extractor: 'sin_perdidas', contrato: 'no_loss', emt: '03010' },
            { extractor: 'sin_garantia', contrato: 'no_guarantee', emt: '03040' }
        ]
    },
    {
        extractor: 'objetivos',
        contrato: 'objectives',
        campos: [
            { extractor: 'crecimiento', contrato: 'capital_growth', emt: '05020' },
            { extractor: 'rentas', contrato: 'income', emt: '05030' }
        ]
    }
];

const CANALES: readonly { extractor: string; contrato: string; emt: string }[] = [
    { extractor: 'solo_ejecucion', contrato: 'execution_only', emt: '06010' },
    { extractor: 'conveniencia', contrato: 'appropriateness', emt: '06020' },
    { extractor: 'asesoramiento', contrato: 'advice', emt: '06030' },
    { extractor: 'gestion_cartera', contrato: 'portfolio_management', emt: '06040' }
];

/** Las claves de primer nivel que el bloque puede traer. Una que no esté se avisa: el contrato está cerrado. */
const CLAVES_DEL_BLOQUE = new Set([
    'fuente',
    'url_fichero',
    'sha256_fichero',
    'version_plantilla',
    'fichero_generado',
    'fecha_mercado_objetivo',
    'periodo_minimo',
    'preferencias_esg_consideradas',
    'distribucion',
    ...GRUPOS.map((grupo) => grupo.extractor)
]);

export interface ResultadoDelMercadoObjetivo {
    /** El documento, o `null` si el registro no trae bloque o el bloque no se puede escribir. */
    documento: DocumentoMapeado | null;
    /** Solo cuando hay bloque y no sale documento: por qué. */
    ausencia?: { ruta: string; razon: 'NOT_PROVIDED'; detalle: string };
    avisos: string[];
}

/** `AAAA-MM-DD` exacto y una fecha que existe en el calendario: ni `2026-02-30` ni una hora detrás. */
export function fechaEstricta(valor: unknown): string | undefined {
    if (typeof valor !== 'string') return undefined;
    const partes = FECHA_ESTRICTA.exec(valor);
    if (partes === null) return undefined;
    const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
    if (anio < 1900 || anio > 2200) return undefined;
    const d = new Date(Date.UTC(anio, mes - 1, dia));
    return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? valor : undefined;
}

/** Traduce con una tabla; ausente si no viene, y fuera con aviso si viene con un valor que la tabla no conoce. */
function traducir<T>(tabla: Readonly<Record<string, T>>, valor: unknown, nombre: string, avisos: string[]): T | undefined {
    if (valor === undefined || valor === null) return undefined;
    const traducido = typeof valor === 'string' ? tabla[valor] : undefined;
    if (traducido === undefined) avisos.push(`${nombre}: valor fuera del vocabulario ${JSON.stringify(valor)}, fuera`);
    return traducido;
}

/** Avisa de las claves que el bloque trae y el contrato no sabe guardar. */
function clavesDeMas(bloque: Record<string, unknown>, conocidas: ReadonlySet<string>, donde: string, avisos: string[]): void {
    for (const clave of Object.keys(bloque)) {
        if (!conocidas.has(clave)) avisos.push(`${donde}.${clave}: el contrato no tiene sitio para esta clave, fuera`);
    }
}

/** Un subbloque de respuestas, o `undefined` si no queda ninguna. */
function respuestas(
    bloque: Record<string, unknown>,
    campos: readonly { extractor: string; contrato: string; emt: string }[],
    tabla: Readonly<Record<string, string>>,
    donde: string,
    avisos: string[]
): Record<string, string> | undefined {
    clavesDeMas(bloque, new Set(campos.map((c) => c.extractor)), donde, avisos);
    const salida: Record<string, string> = {};
    for (const campo of campos) {
        const valor = traducir(tabla, bloque[campo.extractor], `${donde}.${campo.extractor} (${campo.emt})`, avisos);
        if (valor !== undefined) salida[campo.contrato] = valor;
    }
    return Object.keys(salida).length > 0 ? salida : undefined;
}

/** El `05080` normalizado: `{anos}` o `{codigo}`, uno solo. Cualquier otra forma se queda fuera con aviso. */
function periodoMinimo(valor: unknown, donde: string, avisos: string[]): { years: number } | { code: string } | undefined {
    if (valor === undefined || valor === null) return undefined;
    const periodo = obj(valor);
    const claves = Object.keys(periodo);
    if (claves.length === 1 && claves[0] === 'anos') {
        const anos = periodo['anos'];
        if (typeof anos === 'number' && Number.isFinite(anos) && anos >= 0 && anos <= ANOS_MAXIMOS) return { years: anos };
        avisos.push(`${donde} (05080): anos no valido ${JSON.stringify(anos)}, fuera`);
        return undefined;
    }
    if (claves.length === 1 && claves[0] === 'codigo') {
        const codigo = traducir(CODIGO_DE_PERIODO_DEL_EMT, periodo['codigo'], `${donde}.codigo (05080)`, avisos);
        return codigo === undefined ? undefined : { code: codigo };
    }
    avisos.push(`${donde} (05080): se espera {anos} o {codigo}, llega ${JSON.stringify(valor)}, fuera`);
    return undefined;
}

/**
 * El bloque `mercado_objetivo` → el cuerpo de `declared/target_market`, o `null` si no se puede escribir.
 *
 * `null` cuando falta o no vale cualquiera de los cinco obligatorios (fuente, fichero, huella, versión de la plantilla y fecha del
 * mercado objetivo): sin ellos el dato no se puede rastrear hasta su fila. Todo lo demás es opcional campo a campo, y un valor que
 * no se reconoce deja fuera ese campo, no el documento. Lo que el emisor deja vacío llega ausente y ausente se queda.
 */
export function documentoDelMercadoObjetivo(bloque: unknown, avisos: string[], donde = 'mercado_objetivo'): Record<string, unknown> | null {
    const mo = obj(bloque);
    if (Object.keys(mo).length === 0) return null;
    clavesDeMas(mo, CLAVES_DEL_BLOQUE, donde, avisos);

    const faltan: string[] = [];
    const fuente = txt(mo['fuente']);
    const delEmisor = fuente === undefined ? null : FUENTE_DEL_EXTRACTOR.exec(fuente);
    if (delEmisor === null) faltan.push(`fuente ${JSON.stringify(mo['fuente'])}`);
    const url = txt(mo['url_fichero']);
    if (url === undefined) faltan.push('url_fichero');
    const huella = typeof mo['sha256_fichero'] === 'string' && HUELLA.test(mo['sha256_fichero']) ? mo['sha256_fichero'] : undefined;
    if (huella === undefined) faltan.push(`sha256_fichero ${JSON.stringify(mo['sha256_fichero'])}`);
    const version = typeof mo['version_plantilla'] === 'string' && VERSION_DE_PLANTILLA.test(mo['version_plantilla']) ? mo['version_plantilla'] : undefined;
    if (version === undefined) faltan.push(`version_plantilla ${JSON.stringify(mo['version_plantilla'])}`);
    const fechaDelMercado = fechaEstricta(mo['fecha_mercado_objetivo']);
    if (fechaDelMercado === undefined) faltan.push(`fecha_mercado_objetivo (01000) ${JSON.stringify(mo['fecha_mercado_objetivo'])}`);
    if (faltan.length > 0) {
        avisos.push(`${donde}: sin documento, falta o no vale: ${faltan.join('; ')}`);
        return null;
    }

    const documento: Record<string, unknown> = {
        source: `issuer:${delEmisor![1]}`,
        source_url: url,
        sha256: huella,
        template_version: version,
        target_market_as_of: fechaDelMercado
    };

    if (mo['fichero_generado'] !== undefined && mo['fichero_generado'] !== null) {
        const generado = fechaEstricta(mo['fichero_generado']);
        if (generado === undefined) avisos.push(`${donde}.fichero_generado (00005): fecha no valida ${JSON.stringify(mo['fichero_generado'])}, fuera`);
        else documento['file_generated_at'] = generado;
    }

    for (const grupo of GRUPOS) {
        const crudo = mo[grupo.extractor];
        if (crudo === undefined || crudo === null) continue;
        const dentro = respuestas(obj(crudo), grupo.campos, RESPUESTA_DEL_EMT, `${donde}.${grupo.extractor}`, avisos);
        if (dentro !== undefined) documento[grupo.contrato] = dentro;
    }

    const periodo = periodoMinimo(mo['periodo_minimo'], `${donde}.periodo_minimo`, avisos);
    if (periodo !== undefined) documento['min_holding_period'] = periodo;

    const esg = traducir(PREFERENCIAS_ESG_DEL_EMT, mo['preferencias_esg_consideradas'], `${donde}.preferencias_esg_consideradas (05105)`, avisos);
    if (esg !== undefined) documento['esg_preferences_considered'] = esg;

    if (mo['distribucion'] !== undefined && mo['distribucion'] !== null) {
        const canales = respuestas(obj(mo['distribucion']), CANALES, CANAL_DEL_EMT, `${donde}.distribucion`, avisos);
        if (canales !== undefined) documento['distribution'] = canales;
    }

    return documento;
}

/**
 * El documento de un registro del canónico universal. Sin bloque `mercado_objetivo` no devuelve nada ni avisa: la mayoría no lo
 * tiene. Solo FUND y ETF (`x-applies-when: FONDO_O_ETF`); en otro tipo, aviso y fuera. Lo que sale pasa ya por la puerta de
 * escritura: un documento que no valide no se devuelve.
 */
export function mapearMercadoObjetivo(universal: RegistroUniversal): ResultadoDelMercadoObjetivo {
    const avisos: string[] = [];
    const bloque = universal['mercado_objetivo'];
    if (bloque === undefined || bloque === null) return { documento: null, avisos };

    const isin = txt(universal['_id']) ?? '';
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
        avisos.push(`mercado objetivo sin ISIN valido: ${JSON.stringify(isin)}`);
        return { documento: null, avisos };
    }
    const tipo = TIPO_PRODUCTO[String(obj(universal['identificacion'])['tipo_producto'])];
    if (tipo !== 'ETF' && tipo !== 'FUND') {
        avisos.push(`${isin}: mercado objetivo en un tipo sin contrato (${String(tipo)}), fuera`);
        return { documento: null, avisos };
    }
    const sinDocumento = (detalle: string): ResultadoDelMercadoObjetivo => ({
        documento: null,
        ausencia: { ruta: SUFIJO_MERCADO_OBJETIVO, razon: 'NOT_PROVIDED', detalle },
        avisos
    });

    const cuerpo = documentoDelMercadoObjetivo(bloque, avisos, `${isin} mercado_objetivo`);
    if (cuerpo === null) return sinDocumento('bloque mercado_objetivo incompleto');

    const veredicto = validarEscritura(TIPO_MERCADO_OBJETIVO, cuerpo, 'platform');
    if (!veredicto.ok) {
        avisos.push(`${isin}: declared/target_market no valida su contrato: ${veredicto.motivos.join('; ')}`);
        return sinDocumento('el documento no valida su contrato');
    }
    return {
        documento: { ruta: `instruments/${isin}/${SUFIJO_MERCADO_OBJETIVO}`, tipo: TIPO_MERCADO_OBJETIVO, documento: cuerpo },
        avisos
    };
}
