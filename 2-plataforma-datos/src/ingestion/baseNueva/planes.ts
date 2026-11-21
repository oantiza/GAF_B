/**
 * src/ingestion/baseNueva/planes.ts — el catálogo de planes de pensiones y EPSV, en la base nueva.
 *
 * Decisión D-11 de Óscar (13-11-2026, `DECISIONES_ADQUISICION_2026-10-30.md`). Un plan de
 * pensiones o una EPSV forman parte del patrimonio de un cliente pero no de su cartera —no se
 * gestionan con ella, por fiscalidad—, así que este catálogo va **aparte** de `instruments`:
 * otra colección, otro contrato, y ninguna cartera puede apuntar aquí. Sirve para ver la ficha
 * de un plan y ponerla junto a la de otro, en Jubilación.
 *
 * El extractor hace la parte que necesita red (`python main.py planes`) y deja
 * `export_planes/planes.json`. Aquí solo se traduce a dos documentos por producto:
 *
 * - `pension_plans/{plan_id}`: la ficha, con lo que da el proveedor.
 * - `pension_plans/{plan_id}/series/monthly`: el último valor de cada mes, para el gráfico.
 *   Aparte, porque es lo que pesa y listar los planes no debe arrastrarlo.
 *
 * **Aquí no se calcula nada.** Lo único que cambia entre el fichero y la base es la escala: el
 * proveedor escribe 3,03 para un 3,03 % y la base escribe 0,0303, como en todo lo demás. Y la
 * regla de siempre del mapeo: una cifra que el contrato rechaza por su rango no se emite —se deja
 * fuera y se cuenta en `apartadas`—, y un producto sin lo obligatorio no se escribe y se nombra.
 */
import { enRango } from '../../config/baseNueva/validadores';
import type { DocumentoMapeado } from './mapper';

export const COLECCION_PLANES = 'pension_plans';
export const TIPO_PLAN = 'pension-plan.v2.schema.json';
export const TIPO_SERIE_DEL_PLAN = 'pension-plan-series.v2.schema.json';
export const ESQUEMA_DE_ENTRADA = 'fondosdb.planes.v1';
export const FUENTE = 'MORNINGSTAR';

const PATRON_ID = /^[A-Z0-9]{10}$/;
const PATRON_FECHA = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** El tipo como lo escribe el extractor, y como lo escribe la base. */
const TIPOS: Readonly<Record<string, 'PENSION_PLAN' | 'EPSV'>> = {
    PLAN_DE_PENSIONES: 'PENSION_PLAN',
    EPSV: 'EPSV'
};

/** Un producto tal como lo deja el extractor (`fondosdb.planes.v1`). Las cifras, en tanto por ciento. */
export interface PlanDelExtractor {
    id: string;
    nombre: string;
    nombre_legal?: string;
    tipo: string;
    empleo_simplificado?: boolean;
    codigo_dgsfp?: string;
    gestora?: string;
    categoria?: string;
    estrellas?: number;
    estrellas_fecha?: string;
    divisa?: string;
    fecha_inicio?: string;
    patrimonio?: number;
    inversion_minima?: number;
    valor_participacion?: { valor: number; fecha: string };
    rentabilidad?: Partial<Record<'m1' | 'm6' | 'ytd' | 'a1' | 'a3' | 'a5' | 'a10', number>>;
    rentabilidad_fecha?: string;
    volatilidad?: Partial<Record<'a1' | 'a3', number>>;
    ratios?: Partial<Record<'sharpe_a3' | 'alfa_a3' | 'beta_a3' | 'r2_a3' | 'informacion_a3', number>>;
    comisiones?: { gestion?: number };
    serie_mensual?: [string, number][];
    serie?: { desde: string; hasta: string; puntos_diarios: number };
}

export interface FicheroDePlanes {
    schema_version: string;
    generado?: string;
    fuente?: { nombre?: string; consultado?: string };
    planes: PlanDelExtractor[];
}

/** Una cifra que no se emite porque el contrato la rechaza, con su producto y su ruta. */
export interface CifraApartada {
    plan: string;
    nombre: string;
    ruta: string;
    valor: number;
}

export interface PlanesMapeados {
    documentos: DocumentoMapeado[];
    /** Productos que no se escriben, con el motivo. */
    errores: string[];
    apartadas: CifraApartada[];
    /** Todo lo que esta pasada podría producir para sus productos: ficha y serie de cada uno. */
    rutasPosibles: string[];
    cuentas: { planes: number; planes_de_pensiones: number; epsv: number; con_serie: number };
}

/**
 * De tanto por ciento a fracción: 3,03 → 0,0303. Redondea al décimo decimal, que es lo que
 * quita el ruido de la coma flotante (3,03 / 100 da 0,030299999999999997) sin tocar ninguna
 * cifra que el proveedor dé, que llegan con cinco decimales como mucho.
 */
export function fraccion(porCiento: number): number {
    return Math.round(porCiento * 1e8) / 1e10;
}

function esNumero(valor: unknown): valor is number {
    return typeof valor === 'number' && Number.isFinite(valor);
}

function esTexto(valor: unknown): valor is string {
    return typeof valor === 'string' && valor.trim() !== '';
}

function esFecha(valor: unknown): valor is string {
    return typeof valor === 'string' && PATRON_FECHA.test(valor);
}

/** La ruta de la ficha de un plan. */
export function rutaDelPlan(id: string): string {
    return `${COLECCION_PLANES}/${id}`;
}

/** La ruta de su serie mensual. */
export function rutaDeLaSerie(id: string): string {
    return `${COLECCION_PLANES}/${id}/series/monthly`;
}

/** Un bloque por ventanas: de las claves del extractor a las de la base, con su conversión. */
function ventanas(
    plan: PlanDelExtractor,
    bloque: string,
    origen: Partial<Record<string, number>> | undefined,
    claves: readonly (readonly [string, string])[],
    convierte: (valor: number) => number,
    apartadas: CifraApartada[]
): Record<string, number> | undefined {
    const salida: Record<string, number> = {};
    for (const [deAqui, deAlli] of claves) {
        const crudo = origen?.[deAlli];
        if (!esNumero(crudo)) continue;
        const valor = convierte(crudo);
        const ruta = `${bloque}.${deAqui}`;
        if (!enRango(TIPO_PLAN, ruta, valor)) {
            apartadas.push({ plan: plan.id, nombre: plan.nombre, ruta, valor });
            continue;
        }
        salida[deAqui] = valor;
    }
    return Object.keys(salida).length > 0 ? salida : undefined;
}

/** Una cifra suelta, con la misma regla: si el contrato la rechaza, no sale y se cuenta. */
function cifra(
    plan: PlanDelExtractor,
    ruta: string,
    crudo: unknown,
    convierte: (valor: number) => number,
    apartadas: CifraApartada[]
): number | undefined {
    if (!esNumero(crudo)) return undefined;
    const valor = convierte(crudo);
    if (!enRango(TIPO_PLAN, ruta, valor)) {
        apartadas.push({ plan: plan.id, nombre: plan.nombre, ruta, valor });
        return undefined;
    }
    return valor;
}

const igual = (valor: number): number => valor;

/**
 * Los documentos de un producto: su ficha y, si el proveedor dio serie, su serie mensual.
 * `consultado` es cuándo contestó el proveedor la lista (ISO con hora).
 */
export function mapearPlan(
    plan: PlanDelExtractor,
    consultado: string
): { documentos: DocumentoMapeado[]; error?: string; apartadas: CifraApartada[] } {
    const apartadas: CifraApartada[] = [];
    if (!esTexto(plan.id) || !PATRON_ID.test(plan.id)) {
        return { documentos: [], error: `${String(plan.id)}: el identificador no tiene la forma del proveedor`, apartadas };
    }
    if (!esTexto(plan.nombre)) return { documentos: [], error: `${plan.id}: sin nombre`, apartadas };
    const tipo = TIPOS[plan.tipo];
    if (tipo === undefined) {
        /* Sin tipo no se escribe: decir si es plan o EPSV es lo que este catálogo no puede callar. */
        return { documentos: [], error: `${plan.id} ${plan.nombre}: tipo desconocido '${String(plan.tipo)}'`, apartadas };
    }
    if (tipo === 'PENSION_PLAN' && !esTexto(plan.codigo_dgsfp)) {
        return { documentos: [], error: `${plan.id} ${plan.nombre}: plan de pensiones sin codigo de la DGSFP`, apartadas };
    }
    if (tipo === 'EPSV' && plan.codigo_dgsfp !== undefined) {
        return { documentos: [], error: `${plan.id} ${plan.nombre}: EPSV con codigo de la DGSFP`, apartadas };
    }

    const identidad: Record<string, unknown> = { name: plan.nombre.trim() };
    if (esTexto(plan.nombre_legal)) identidad['legal_name'] = plan.nombre_legal.trim();
    if (esTexto(plan.gestora)) identidad['manager_name'] = plan.gestora.trim();
    if (esTexto(plan.divisa)) identidad['currency'] = plan.divisa;

    const documento: Record<string, unknown> = {
        plan_id: plan.id,
        schema_version: 'base-nueva.pension-plan.v2',
        updated_at: consultado,
        source: FUENTE,
        checked_at: consultado.slice(0, 10),
        product_type: tipo,
        identity: identidad,
        /* No reparte: lo que gana queda en el valor de la participación. Ver el contrato. */
        return_basis: 'TOTAL_RETURN'
    };
    if (plan.empleo_simplificado === true) documento['modality'] = 'SIMPLIFIED_EMPLOYMENT';
    if (esTexto(plan.codigo_dgsfp)) documento['dgsfp_code'] = plan.codigo_dgsfp;
    if (esTexto(plan.categoria)) documento['provider_category'] = plan.categoria.trim();
    if (esNumero(plan.estrellas) && Number.isInteger(plan.estrellas) && plan.estrellas >= 1 && plan.estrellas <= 5) {
        documento['star_rating'] = plan.estrellas;
        if (esFecha(plan.estrellas_fecha)) documento['star_rating_as_of'] = plan.estrellas_fecha;
    }
    if (esFecha(plan.fecha_inicio)) documento['inception_date'] = plan.fecha_inicio;
    const patrimonio = cifra(plan, 'aum', plan.patrimonio, igual, apartadas);
    if (patrimonio !== undefined) documento['aum'] = patrimonio;
    const minima = cifra(plan, 'minimum_investment', plan.inversion_minima, igual, apartadas);
    if (minima !== undefined) documento['minimum_investment'] = minima;

    const valor = plan.valor_participacion;
    if (valor !== undefined && esNumero(valor.valor) && valor.valor > 0 && esFecha(valor.fecha)) {
        documento['nav'] = { value: valor.valor, date: valor.fecha };
    }

    const rentabilidad = ventanas(
        plan,
        'trailing_return',
        plan.rentabilidad,
        [
            ['1m', 'm1'],
            ['6m', 'm6'],
            ['1y', 'a1'],
            ['3y', 'a3'],
            ['5y', 'a5'],
            ['10y', 'a10']
        ],
        fraccion,
        apartadas
    );
    if (rentabilidad !== undefined) documento['trailing_return'] = rentabilidad;
    const enElAnio = cifra(plan, 'ytd_return', plan.rentabilidad?.ytd, fraccion, apartadas);
    if (enElAnio !== undefined) documento['ytd_return'] = enElAnio;
    if ((rentabilidad !== undefined || enElAnio !== undefined) && esFecha(plan.rentabilidad_fecha)) {
        documento['returns_as_of'] = plan.rentabilidad_fecha;
    }

    const volatilidad = ventanas(
        plan,
        'volatility',
        plan.volatilidad,
        [
            ['1y', 'a1'],
            ['3y', 'a3']
        ],
        fraccion,
        apartadas
    );
    if (volatilidad !== undefined) documento['volatility'] = volatilidad;

    /* Cada ratio en su bloque, con la ventana de tres años que es la que da el proveedor. El alfa
       y el R2 llegan en tanto por ciento; el Sharpe, la beta y el ratio de información, no. */
    const ratios: readonly (readonly [string, keyof NonNullable<PlanDelExtractor['ratios']>, (v: number) => number])[] = [
        ['sharpe', 'sharpe_a3', igual],
        ['provider_alpha', 'alfa_a3', fraccion],
        ['beta', 'beta_a3', igual],
        ['r2', 'r2_a3', fraccion],
        ['information_ratio', 'informacion_a3', igual]
    ];
    for (const [bloque, clave, convierte] of ratios) {
        const sale = cifra(plan, `${bloque}.3y`, plan.ratios?.[clave], convierte, apartadas);
        if (sale !== undefined) documento[bloque] = { '3y': sale };
    }

    const gestion = cifra(plan, 'management_fee', plan.comisiones?.gestion, fraccion, apartadas);
    if (gestion !== undefined) documento['management_fee'] = gestion;

    const documentos: DocumentoMapeado[] = [];
    const puntos = (plan.serie_mensual ?? [])
        .filter((punto) => Array.isArray(punto) && esFecha(punto[0]) && esNumero(punto[1]) && punto[1] > 0)
        .map(([fecha, valorDelMes]) => ({ date: fecha, value: valorDelMes }));
    const primero = puntos[0];
    const ultimo = puntos[puntos.length - 1];
    if (primero !== undefined && ultimo !== undefined && plan.serie !== undefined && esNumero(plan.serie.puntos_diarios)) {
        documento['series'] = {
            first_date: primero.date,
            last_date: ultimo.date,
            daily_observations: plan.serie.puntos_diarios,
            monthly_points: puntos.length
        };
        const serie: Record<string, unknown> = {
            plan_id: plan.id,
            schema_version: 'base-nueva.pension-plan-series.v2',
            updated_at: consultado,
            source: FUENTE,
            price_class: 'NAV',
            frequency: 'MONTH_END',
            first_date: primero.date,
            last_date: ultimo.date,
            observations: puntos.length,
            points: puntos
        };
        if (esTexto(plan.divisa)) serie['currency'] = plan.divisa;
        documentos.push({ ruta: rutaDeLaSerie(plan.id), tipo: TIPO_SERIE_DEL_PLAN, documento: serie });
    }

    documentos.unshift({ ruta: rutaDelPlan(plan.id), tipo: TIPO_PLAN, documento });
    return { documentos, apartadas };
}

/** El fichero entero. Lanza si no es el que se espera: un esquema distinto no se interpreta. */
export function mapearPlanes(fichero: FicheroDePlanes): PlanesMapeados {
    if (fichero.schema_version !== ESQUEMA_DE_ENTRADA) {
        throw new Error(`el fichero de planes dice '${String(fichero.schema_version)}' y se esperaba '${ESQUEMA_DE_ENTRADA}'`);
    }
    if (!Array.isArray(fichero.planes)) throw new Error('el fichero de planes no trae la lista de planes');
    const consultado = fichero.fuente?.consultado ?? (esFecha(fichero.generado) ? `${fichero.generado}T00:00:00+00:00` : undefined);
    if (consultado === undefined) throw new Error('el fichero de planes no dice cuando se consulto la fuente');

    const documentos: DocumentoMapeado[] = [];
    const errores: string[] = [];
    const apartadas: CifraApartada[] = [];
    const rutasPosibles: string[] = [];
    const vistos = new Set<string>();
    const cuentas = { planes: 0, planes_de_pensiones: 0, epsv: 0, con_serie: 0 };

    for (const plan of fichero.planes) {
        if (vistos.has(plan.id)) {
            errores.push(`${plan.id}: repetido en el fichero`);
            continue;
        }
        vistos.add(plan.id);
        const mapeado = mapearPlan(plan, consultado);
        apartadas.push(...mapeado.apartadas);
        if (mapeado.error !== undefined) {
            errores.push(mapeado.error);
            continue;
        }
        documentos.push(...mapeado.documentos);
        rutasPosibles.push(rutaDelPlan(plan.id), rutaDeLaSerie(plan.id));
        cuentas.planes += 1;
        if (TIPOS[plan.tipo] === 'EPSV') cuentas.epsv += 1;
        else cuentas.planes_de_pensiones += 1;
        if (mapeado.documentos.length > 1) cuentas.con_serie += 1;
    }
    return { documentos, errores, apartadas, rutasPosibles, cuentas };
}
