/**
 * scripts/runBaseNuevaSeriesAudit.ts — audita la MATERIA PRIMA del almacén analítico: las
 * series de precios. SOLO LECTURA.
 *
 *   npm run audit:series
 *
 * Existe porque la pregunta «¿podemos calcular nosotros las métricas?» no se contesta con el
 * código del cálculo, se contesta mirando las series. Y la respuesta medida el 01-11 fue que
 * no, por una razón que no estaba en el plan: **de los 769 instrumentos, 756 solo tienen serie
 * de valor liquidativo**, y la base de rentabilidad de una serie de VL depende de si la clase
 * reparte o acumula, que es justo lo que no se sabe en ninguno de los 769.
 *
 * Una serie de VL de una clase de reparto baja el día del reparto. Esa caída no es mercado:
 * es dinero que salió al partícipe. Así que contamina la volatilidad, inventa caídas máximas
 * que no ocurrieron y sesga la rentabilidad. No es que la base de rentabilidad quede sin
 * etiquetar: es que **ninguna métrica calculada sobre esa serie es de fiar** mientras no se
 * sepa la política.
 *
 * Esta auditoría deja esos números reproducibles para que nadie tenga que volver a deducirlos.
 */
import * as path from 'path';

// Nada de `.env.local`: ese fichero es el destino de la base VIEJA (proyecto y puerto de
// siempre), y desde el 01-11-2026 la base nueva vive en su propio proyecto y su propio
// emulador. El destino lo pone el escritor, de la constante, y si el entorno pide otro se
// para en vez de ignorarlo. Ver `src/config/projectAllowlist.ts`.

import { obtenerDb } from '../src/loader/baseNuevaWriter';

/** Lo que hace falta saber de las series de un instrumento. */
interface SeriesDeInstrumento {
    tipos: Set<string>;
    cubos: number;
    puntos: number;
    /** `true` si algún cubo se convirtió a euros con un tipo que no es el del BCE. */
    fxDeProveedor: boolean;
    primera?: string;
    ultima?: string;
}

function cuenta<T>(mapa: Map<T, number>, clave: T, cuanto = 1): void {
    mapa.set(clave, (mapa.get(clave) ?? 0) + cuanto);
}

async function main(): Promise<void> {
    const db = obtenerDb();

    console.log('');
    console.log('=== auditoria de las series de precios: la materia prima del analitico ===');

    const deLaBaseNueva = new Set((await db.collection('instruments').get()).docs.map((doc) => doc.id));
    const grupo = await db.collectionGroup('price_series').get();

    const porInstrumento = new Map<string, SeriesDeInstrumento>();
    const porTipo = new Map<string, number>();
    const porIntervalo = new Map<string, number>();
    const porDivisaOrigen = new Map<string, number>();
    let cubosVivos = 0;
    let cubosArchivados = 0;
    let puntosTotales = 0;
    let cubosFxDeProveedor = 0;
    let cubosConValorDeOrigen = 0;

    for (const doc of grupo.docs) {
        const tramos = doc.ref.path.split('/');
        if (tramos[0] !== 'assets') {
            cubosArchivados += 1;
            continue;
        }
        cubosVivos += 1;
        const instrumento = tramos[1]!;
        const datos = doc.data() as Record<string, unknown>;
        const puntos = Array.isArray(datos['points']) ? (datos['points'] as unknown[]) : [];
        puntosTotales += puntos.length;

        cuenta(porTipo, String(datos['series_type']));
        cuenta(porIntervalo, String(datos['interval']));
        const origen = String(datos['source_currency'] ?? datos['currency'] ?? '?');
        cuenta(porDivisaOrigen, origen);

        const politica = String(datos['fx_policy'] ?? datos['fx_source'] ?? '');
        const convertidaSinBce = origen !== 'EUR' && !/ECB/i.test(politica);
        if (convertidaSinBce) {
            cubosFxDeProveedor += 1;
            /* Solo cuenta entre los sucios: son los unicos que hay que reconvertir, y un
               contador sobre todos los cubos daria un numero mayor que el de los sucios,
               que es lo que decia la primera version de esta auditoria. */
            if (
                puntos.some((punto) => (punto as Record<string, unknown> | undefined)?.['source_value'] !== undefined)
            ) {
                cubosConValorDeOrigen += 1;
            }
        }

        let ficha = porInstrumento.get(instrumento);
        if (ficha === undefined) {
            ficha = { tipos: new Set(), cubos: 0, puntos: 0, fxDeProveedor: false };
            porInstrumento.set(instrumento, ficha);
        }
        ficha.tipos.add(String(datos['series_type']));
        ficha.cubos += 1;
        ficha.puntos += puntos.length;
        if (convertidaSinBce) ficha.fxDeProveedor = true;
        const primera = typeof datos['first_date'] === 'string' ? (datos['first_date'] as string) : undefined;
        const ultima = typeof datos['last_date'] === 'string' ? (datos['last_date'] as string) : undefined;
        if (primera !== undefined && (ficha.primera === undefined || primera < ficha.primera)) ficha.primera = primera;
        if (ultima !== undefined && (ficha.ultima === undefined || ultima > ficha.ultima)) ficha.ultima = ultima;
    }

    console.log('');
    console.log(`cubos en colecciones vivas : ${cubosVivos}`);
    console.log(`cubos en archivadas        : ${cubosArchivados}`);
    console.log(`puntos en total            : ${puntosTotales.toLocaleString('es-ES')}`);
    console.log(`instrumentos con serie     : ${porInstrumento.size}`);
    console.log('');
    console.log(`tipos de serie   : ${JSON.stringify([...porTipo.entries()])}`);
    console.log(`intervalos       : ${JSON.stringify([...porIntervalo.entries()])}`);
    console.log(
        `divisa de origen : ${JSON.stringify([...porDivisaOrigen.entries()].sort((a, b) => b[1] - a[1]))}`
    );

    console.log('');
    console.log('--- el tipo de cambio ---');
    console.log(`cubos convertidos a euros SIN el BCE : ${cubosFxDeProveedor}`);
    console.log(`de ellos, con el valor de origen guardado y por tanto reconvertibles: ${cubosConValorDeOrigen}`);
    console.log('Oscar decidio el 31-10 que el tipo del BCE vale en las dos partes, series y');
    console.log('operaciones. Mientras eso no se cumpla, el contrato de computed/metrics NO deja');
    console.log('escribir una metrica calculada sobre esas series: inputs.fx_source solo admite');
    console.log('ECB_REFERENCE. Es el contrato negandose a escribir lo que no se decidio.');

    /* Lo que de verdad decide si podemos calcular: el tipo de serie de los instrumentos de la
       base nueva. */
    let soloVl = 0;
    let soloAjustado = 0;
    let ambos = 0;
    let sinSerie = 0;
    let conFxSucio = 0;
    /* Los ISIN, no solo el recuento: hace falta poder cruzarlos contra los que
       reciben metricas propias, que es la pregunta que de verdad importa. */
    const conFxSucioIds: string[] = [];
    const aptosParaCalcular: string[] = [];
    for (const instrumento of deLaBaseNueva) {
        const ficha = porInstrumento.get(instrumento);
        if (ficha === undefined) {
            sinSerie += 1;
            continue;
        }
        if (ficha.fxDeProveedor) {
            conFxSucio += 1;
            conFxSucioIds.push(instrumento);
        }
        const vl = ficha.tipos.has('NAV');
        const ajustado = ficha.tipos.has('ADJUSTED_CLOSE');
        if (vl && ajustado) ambos += 1;
        else if (vl) soloVl += 1;
        else if (ajustado) {
            soloAjustado += 1;
            if (!ficha.fxDeProveedor) aptosParaCalcular.push(instrumento);
        }
    }

    console.log('');
    console.log('--- lo que decide si podemos calcular: el tipo de serie ---');
    console.log(`instrumentos de la base nueva      : ${deLaBaseNueva.size}`);
    console.log(`  sin serie                        : ${sinSerie}`);
    console.log(`  solo valor liquidativo (NAV)     : ${soloVl}`);
    console.log(`  solo cierre ajustado             : ${soloAjustado}`);
    console.log(`  las dos                          : ${ambos}`);
    console.log(`  con algun cubo convertido sin BCE: ${conFxSucio}`);
    console.log('');
    console.log(`APTOS para calcular metricas hoy   : ${aptosParaCalcular.length}`);
    if (conFxSucioIds.length > 0) {
        console.log('');
        console.log('--- los instrumentos con algun cubo convertido sin el BCE ---');
        console.log(conFxSucioIds.sort().join(' '));
    }
    console.log('');
    console.log('Por que tan pocos: una serie de VL de una clase de REPARTO baja el dia del');
    console.log('reparto, y esa caida no es mercado, es dinero que salio al participe. Contamina');
    console.log('la volatilidad, inventa caidas maximas y sesga la rentabilidad. Asi que sin saber');
    console.log('si la clase reparte o acumula, NINGUNA metrica sobre esa serie es de fiar, y eso');
    console.log('es exactamente lo que no se sabe en los 769 (distribution_policy: UNKNOWN).');
    console.log('Un cierre ajustado si: el ajuste ES la reinversion, asi que su base es total.');

    process.exit(0);
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
