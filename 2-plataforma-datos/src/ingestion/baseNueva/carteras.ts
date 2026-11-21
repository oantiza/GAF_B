/**
 * src/ingestion/baseNueva/carteras.ts — del trabajo guardado del asesor a la base nueva.
 *
 * Es el primer mapper del dominio de clientes, y no viene del canónico: viene de Firestore,
 * de `bdb_activos/{uid}/portfolios/{id}`, que es donde la aplicación guarda las carteras que
 * el asesor compone. Medido el 01-11-2026: **8 usuarios, 23 carteras, 235 posiciones** de 1 a
 * 27 por cartera.
 *
 * Y lo que esas 235 «posiciones» son de verdad, que es el hallazgo que decidió este fichero:
 * **pesos, no tenencias.** Traen `weight_percent` y `asset_id`, y ni títulos, ni coste, ni
 * valor de mercado. Una cartera de hoy es una propuesta. Por eso van a `targets`, que pide
 * exactamente `instrument_id` y `weight`, y no a `positions`, que pide `units` y es un libro
 * de operaciones que no existe en ninguna parte del sistema. Si uno va al nombre que suena
 * —«posiciones»— mete pesos en un campo de tenencias y nadie se entera.
 *
 * Las dos reglas son las del mapper de instrumentos, y por la misma razón:
 *  - lo que no está no se inventa, y se anota por qué falta;
 *  - lo que no se puede nombrar no entra, y se cuenta.
 */
import { asesorEnLaBaseNueva } from '../../config/baseNueva/asesores';
import { TOLERANCIA_DEL_REPARTO } from '../../config/baseNueva/vocabulario';
import type { Ausencia } from '../../config/baseNueva/vocabulario';
import type { AusenciaAnotada, DocumentoMapeado } from './mapper';

/** La forma REAL de una cartera guardada, medida en el emulador el 01-11-2026. */
export interface CarteraDelAsesor {
    portfolio_id?: unknown;
    owner_uid?: unknown;
    name?: unknown;
    positions?: unknown;
    base_currency?: unknown;
    source_kind?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    total_capital?: unknown;
}

export interface CarteraMapeada {
    documentos: DocumentoMapeado[];
    ausencias: AusenciaAnotada[];
    avisos: string[];
    perdidas: string[];
    errores: string[];
}

const TIPO_CARTERA = 'portfolio.v2.schema.json';
const TIPO_OBJETIVO = 'portfolio-target.v2.schema.json';

/** ISIN, que es lo que traen las 235 posiciones medidas, sin una excepción. */
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

function texto(valor: unknown): string | undefined {
    if (typeof valor !== 'string') return undefined;
    const limpio = valor.trim();
    return limpio === '' ? undefined : limpio;
}

function numero(valor: unknown): number | undefined {
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : undefined;
}

/**
 * Mapea una cartera guardada y sus pesos.
 *
 * `kind` es siempre `MODEL`: las 23 son `source_kind: BDB_APP_OWNED` y guardan pesos. El día
 * que haya un extracto de depositario detrás habrá carteras `REAL`, y entonces llevarán
 * `client_id` y un libro de operaciones.
 */
export function mapearCartera(cruda: CarteraDelAsesor): CarteraMapeada {
    const documentos: DocumentoMapeado[] = [];
    const ausencias: AusenciaAnotada[] = [];
    const avisos: string[] = [];
    const perdidas: string[] = [];
    const errores: string[] = [];

    const id = texto(cruda.portfolio_id);
    /* El dueño NO se copia de la fuente: su uid es de otro proyecto, y ahí no es nadie. La
       fuente dice a quién reconocer y `asesores.ts` dice quién es aquí. */
    const deOrigen = texto(cruda.owner_uid);
    const asesor = deOrigen === undefined ? undefined : asesorEnLaBaseNueva(deOrigen);
    const nombre = texto(cruda.name);
    const actualizada = texto(cruda.updated_at);
    const divisa = texto(cruda.base_currency);

    /* Sin estas cuatro no hay cartera que escribir, y ninguna se puede suplir: un id que no
       viene no se inventa, y una cartera sin dueño es justo el defecto que este cambio de
       ruta viene a arreglar. */
    if (id === undefined) errores.push('cartera sin portfolio_id');
    if (deOrigen === undefined) errores.push('cartera sin owner_uid: no se sabe de quién es');
    else if (asesor === undefined) {
        /* Un uid que no está en el mapa no se puede asignar «al asesor que hay»: de quién es
           una cartera no se supone, y escribirla con un uid de otro proyecto la deja ilegible. */
        errores.push(
            `owner_uid ${deOrigen} no es ningun asesor de este proyecto: ` +
                'un uid vale solo dentro del suyo, y la equivalencia se declara en asesores.ts'
        );
    }
    if (nombre === undefined) errores.push('cartera sin name');
    if (actualizada === undefined) errores.push('cartera sin updated_at');
    if (divisa !== 'EUR') {
        /* El contrato fija el euro como invariante del sistema, no como preferencia. Las 23
           medidas son todas EUR; una que no lo fuera no es un caso a tolerar, es una señal
           de que la invariante dejó de ser cierta. */
        errores.push(`divisa base ${divisa ?? '(ausente)'}: el contrato fija EUR`);
    }
    if (errores.length > 0) return { documentos, ausencias, avisos, perdidas, errores };

    const cartera: Record<string, unknown> = {
        portfolio_id: id,
        schema_version: 'base-nueva.portfolio.v2',
        updated_at: actualizada,
        kind: 'MODEL',
        advisor_id: asesor,
        name: nombre,
        /*
         * DRAFT, y es una elección, no un dato. `status` es obligatorio y la fuente no tiene
         * ninguno: la aplicación no guarda estado de una cartera, y al guardar sustituye sin
         * versionar. De los tres valores posibles, DRAFT es el que afirma menos. ACTIVE diría
         * que esta propuesta está en vigor para alguien, y no hay nadie: ninguna de las 23
         * cuelga de un cliente.
         */
        status: 'DRAFT',
        base_currency: 'EUR'
    };
    const creada = texto(cruda.created_at);
    if (creada !== undefined) cartera['created_at'] = creada;
    const capital = numero(cruda.total_capital);
    if (capital !== undefined && capital >= 0) {
        cartera['notional_capital'] = capital;
    } else {
        ausencias.push({ ruta: 'portfolio.notional_capital', razon: 'NOT_PROVIDED' as Ausencia });
    }

    documentos.push({ ruta: `portfolios/${id}`, tipo: TIPO_CARTERA, documento: cartera, comoDueno: 'app' });

    /* ---- los pesos ---- */

    const crudas = Array.isArray(cruda.positions) ? cruda.positions : [];
    const pesos: { instrumento: string; peso: number }[] = [];
    let suma = 0;
    for (const p of crudas) {
        const pos = (p ?? {}) as Record<string, unknown>;
        const instrumento = texto(pos['asset_id'])?.toUpperCase();
        const porCiento = numero(pos['weight_percent']);
        if (instrumento === undefined || !ISIN.test(instrumento)) {
            perdidas.push(`posición con asset_id no utilizable: ${String(pos['asset_id'])}`);
            continue;
        }
        if (porCiento === undefined) {
            perdidas.push(`posición de ${instrumento} sin weight_percent`);
            continue;
        }
        suma += porCiento;
        pesos.push({ instrumento, peso: porCiento / 100 });
        /*
         * Dos campos de la fuente que NO entran, y los dos a propósito:
         *
         * `label` (219 de 235) es el nombre del activo para mostrar. El nombre de un
         * instrumento vive en el instrumento, así que traerlo aquí sería el mismo dato en dos
         * sitios, y el día que se corrigiera uno habría dos verdades. No es una pérdida: es
         * la regla funcionando.
         *
         * `keep_euros` aparece en 23 posiciones y vale `false` en las 23, sin una excepción.
         * Un indicador que nunca cambia no informa de nada. El contrato tiene campo desde el
         * 03-11-2026 porque el constructor lo guarda, pero de esta fuente no hay nada que traer.
         */
    }

    if (pesos.length === 0) {
        ausencias.push({ ruta: 'portfolio.targets', razon: 'NOT_PROVIDED' as Ausencia });
        return { documentos, ausencias, avisos, perdidas, errores };
    }

    /*
     * Los pesos de una cartera tienen que sumar 1, y si no suman NO es un reparto.
     *
     * Es la misma regla que el `asset_mix` de un fondo y por la misma razón: escribir un
     * reparto que suma 1,81 hace que cualquier gráfico lo normalice y muestre una cartera que
     * no es la que el asesor compuso. Medido el 01-11: 22 de las 23 suman 100 %, y una suma
     * **181,25 %**. De esa se escribe la cartera —existe y tiene nombre— pero no sus pesos.
     */
    const total = suma / 100;
    if (Math.abs(total - 1) > TOLERANCIA_DEL_REPARTO) {
        avisos.push(`pesos que no suman 1: ${total.toFixed(5)} con ${pesos.length} posiciones`);
        ausencias.push({
            ruta: 'portfolio.targets',
            razon: 'NOT_PROVIDED' as Ausencia,
            detalle: `los pesos suman ${total.toFixed(5)} y no se escriben a medias`
        });
        return { documentos, ausencias, avisos, perdidas, errores };
    }

    for (const { instrumento, peso } of pesos) {
        documentos.push({
            ruta: `portfolios/${id}/targets/${instrumento}`,
            tipo: TIPO_OBJETIVO,
            documento: {
                instrument_id: instrumento,
                weight: peso,
                /* De quién es la cartera, copiado del padre. Es el campo por el que las reglas
                   conceden la lectura, y va aquí porque una consulta de grupo sobre `targets`
                   no puede mirar al padre sin un `get()` por documento. Si deja de coincidir
                   con el padre, un asesor pierde de vista sus objetivos o ve los de otro, y
                   `audit:base-nueva` lo caza. */
                advisor_id: asesor,
                /* Quién puso el peso. La fuente no lo guarda por posición, pero la cartera es
                   de un asesor y los pesos son suyos: es el dato que hay, no una suposición.
                   Registra la autoría y NO manda en el acceso: confundir las dos cosas es lo
                   que abrió E-3. */
                set_by: asesor,
                set_at: actualizada
            },
            comoDueno: 'app'
        });
    }

    return { documentos, ausencias, avisos, perdidas, errores };
}

/**
 * Todas las rutas que podrían pertenecer a una cartera, para que el plan sepa qué sobra.
 *
 * Toma los instrumentos de la FUENTE y los que ya están EN LA BASE, y devuelve la unión. Las
 * dos listas hacen falta y por una razón concreta: una cartera se guarda sustituyendo —el
 * asesor quita una posición y la cartera se graba otra vez sin ella—, así que con solo la
 * fuente, el objetivo de la posición retirada no aparecería en las rutas posibles y el plan
 * no lo marcaría como sobrante. Se quedaría en la base para siempre, y la cartera leída
 * tendría una posición que el asesor ya borró.
 */
export function rutasPosiblesDeCartera(
    portfolioId: string,
    deLaFuente: readonly string[],
    enLaBase: readonly string[] = []
): string[] {
    const instrumentos = [...new Set([...deLaFuente, ...enLaBase])].sort();
    return [
        `portfolios/${portfolioId}`,
        ...instrumentos.map((isin) => `portfolios/${portfolioId}/targets/${isin}`)
    ];
}

/** Cuánto puede desviarse del 100 % la suma de los pesos para seguir siendo un reparto. */
export const TOLERANCIA_DE_LOS_PESOS = 0.5;

/**
 * Los nombres que son una prueba y no una cartera. Van literales porque son cuatro y se
 * conocen una por una, no un patrón que mañana se coma una cartera de verdad llamada «P40».
 */
const NOMBRES_DE_PRUEBA = new Set(['p30', 'prueba30']);

/**
 * Por qué una cartera de la base vieja NO se re-origina, o `undefined` si entra.
 *
 * La regla está aquí y no en el script porque decide **qué dato existe**, y eso no es un
 * detalle de orquestación. `PLAN_INDEPENDENCIA_2026-11-01.md` tenía decidido que las 23
 * carteras nacieran de cero «porque son Prueba 30 y similares, una con los pesos al 181,25 %».
 * Medido el 02-11-2026: eso es cierto de 4 y falso de las otras 19, que son trabajo de cliente
 * con 8 a 27 posiciones y capitales de 112.851 € a 1.130.987 €. Óscar decidió traerlas, y la
 * frontera entre lo que entra y lo que no es esta función.
 *
 * Lo que NO hace, y es la parte que importa: un reparto que suma 181,25 % no se normaliza. No
 * es un reparto mal escalado, es una cartera que alguien dejó a medias, y escribirla
 * normalizada inventaría los pesos que el asesor no puso. Se nombra y se queda fuera.
 */
export function motivoParaNoReoriginar(cartera: CarteraDelAsesor): string | undefined {
    const nombre = typeof cartera.name === 'string' ? cartera.name.toLowerCase().replace(/\s+/g, '') : '';
    if (nombre === '') return 'sin nombre';
    if (NOMBRES_DE_PRUEBA.has(nombre)) return 'es una prueba, no una cartera';
    const posiciones = Array.isArray(cartera.positions) ? cartera.positions : [];
    if (posiciones.length === 0) return 'sin posiciones';
    const suma = posiciones.reduce((total: number, posicion: unknown) => {
        const peso = (posicion as { weight_percent?: unknown } | null)?.weight_percent;
        return total + (typeof peso === 'number' ? peso : 0);
    }, 0);
    if (Math.abs(suma - 100) > TOLERANCIA_DE_LOS_PESOS) return `los pesos suman ${suma.toFixed(2)} % y no 100 %`;
    return undefined;
}
