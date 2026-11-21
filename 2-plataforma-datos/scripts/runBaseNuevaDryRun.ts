/**
 * scripts/runBaseNuevaDryRun.ts — pasa el canónico entero por el mapper y por las dos
 * puertas, y cuenta lo que saldría. **No escribe en Firestore y no toca la maestra.**
 *
 *   npm run dryrun:base-nueva
 *
 * Lo que contesta, que es la pregunta que de verdad importa antes de escribir nada: cuánto
 * de la base nueva puede llenar el canónico de hoy, qué se queda fuera y por qué. Un
 * escritor que se estrena sobre 770 instrumentos sin saber eso de antemano descubre los
 * huecos cuando ya están escritos.
 *
 * Deja el informe en `runs/base-nueva-dryrun.json` para poder comparar entre pasadas.
 */
import * as fs from 'fs';
import * as path from 'path';

import { mapearInstrumento, type FichaCanonica, type RegistroUniversal } from '../src/ingestion/baseNueva/mapper';
import { entradasDe, leerFicherosDelEmisor, mapearDelEmisor } from '../src/ingestion/baseNueva/emisorDeEtf';
import { mapearMercadoObjetivo } from '../src/ingestion/baseNueva/mercadoObjetivo';
import { validarEscritura } from '../src/config/baseNueva/validadores';
import { TIPO_PRODUCTO } from '../src/ingestion/baseNueva/traducciones';
import { leerSalidaDeEmisores, mapearEmisores, SALIDA_DEL_EXTRACTOR } from '../src/ingestion/baseNueva/emisores';

const RAIZ_EXTRACTOR = process.env['EXTRACTOR_DIR'] ?? path.resolve(__dirname, '..', '..', '1-extractor');
const CARPETA_FICHAS = path.join(RAIZ_EXTRACTOR, 'export_bdb');
const NDJSON = path.join(RAIZ_EXTRACTOR, 'export', 'fondos.ndjson');
const SALIDA = path.resolve(__dirname, '..', 'runs', 'base-nueva-dryrun.json');

interface Contador {
    [clave: string]: number;
}

function sumar(contador: Contador, clave: string, cuanto = 1): void {
    contador[clave] = (contador[clave] ?? 0) + cuanto;
}

function ordenado(contador: Contador): [string, number][] {
    return Object.entries(contador).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function percentil(valores: number[], p: number): number {
    if (valores.length === 0) return 0;
    const ordenados = [...valores].sort((a, b) => a - b);
    const indice = Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length));
    return ordenados[indice] ?? 0;
}

function main(): void {
    if (!fs.existsSync(NDJSON)) {
        console.error(`no encuentro el canonico universal en ${NDJSON}`);
        console.error('pasa EXTRACTOR_DIR si el extractor esta en otro sitio');
        process.exitCode = 1;
        return;
    }

    const ahora = new Date().toISOString();

    /* El canónico son DOS salidas y las dos hacen falta: la ficha trae lo regulatorio, los
       costes con evidencia y la composición; el universal trae el riesgo y la rentabilidad
       del proveedor. Ningún fichero de export_bdb contiene la palabra volatilidad. */
    const fichas = new Map<string, FichaCanonica>();
    for (const nombre of fs.readdirSync(CARPETA_FICHAS)) {
        if (!nombre.endsWith('.json')) continue;
        const isin = nombre.replace(/\.json$/, '');
        fichas.set(isin, JSON.parse(fs.readFileSync(path.join(CARPETA_FICHAS, nombre), 'utf-8')) as FichaCanonica);
    }

    const porTipoDeDocumento: Contador = {};
    const ausenciasPorRuta: Contador = {};
    const ausenciasPorRazon: Contador = {};
    const perdidas: Contador = {};
    const avisos: Contador = {};
    const erroresDeMapeo: Contador = {};
    const fallosDeValidacion: Contador = {};
    const tamanos: Record<string, number[]> = {};

    let registros = 0;
    let acciones = 0;
    let sinFicha = 0;
    let mapeados = 0;
    let conError = 0;
    let documentosValidos = 0;
    let documentosInvalidos = 0;

    /* La población de entidades: se MIDE, no se puebla. Decidido el 01-11, el contrato
       declara los tres roles y el alfa solo llena EQUITY_ISSUER, que viene de las acciones,
       no de los fondos. Medirlo ahora dice lo que costaría el día que se quiera. */
    const gestoras = new Set<string>();
    const gestorasLegales = new Set<string>();
    const depositarios = new Set<string>();
    let conLei = 0;
    const isinsMapeados = new Set<string>();

    const ficherosDelEmisor = leerFicherosDelEmisor(RAIZ_EXTRACTOR);
    const lineas = fs.readFileSync(NDJSON, 'utf-8').split('\n');
    for (const linea of lineas) {
        if (linea.trim() === '') continue;
        registros += 1;
        const universal = JSON.parse(linea) as RegistroUniversal;
        const identificacion = (universal['identificacion'] ?? {}) as Record<string, unknown>;

        /* Las ACCIONES ya no se saltan: desde el 01-11-2026 hay contrato que las acepta.
           Se siguen CONTANDO aparte, porque sus cifras no se leen igual —otro metodo y
           otros bloques— y un total que las mezcle no dice nada de ninguna de las dos. */
        if (TIPO_PRODUCTO[String(identificacion['tipo_producto'])] === 'STOCK') acciones += 1;

        const isin = String(universal['_id'] ?? '');
        const ficha = fichas.get(isin);
        if (ficha === undefined) {
            sinFicha += 1;
            continue;
        }

        const regulatory = (ficha['regulatory'] ?? {}) as Record<string, unknown>;
        const gestora = (identificacion['gestora'] ?? regulatory['management_company']) as unknown;
        if (typeof gestora === 'string' && gestora.trim() !== '') gestoras.add(gestora.trim());
        const legal = (identificacion['gestora_legal'] ?? regulatory['management_company_legal']) as unknown;
        if (typeof legal === 'string' && legal.trim() !== '') gestorasLegales.add(legal.trim());
        const deposito = regulatory['depositary'];
        if (typeof deposito === 'string' && deposito.trim() !== '') depositarios.add(deposito.trim());
        if (typeof regulatory['management_company_lei'] === 'string') conLei += 1;

        const resultado = mapearInstrumento(ficha, universal, ahora);
        if (universal['emisor'] !== undefined && resultado.errores.length === 0) {
            const delBloque = mapearDelEmisor(universal, entradasDe(isin, ficherosDelEmisor), ahora);
            resultado.documentos.push(...delBloque.documentos);
            resultado.ausencias.push(...delBloque.ausencias);
            resultado.perdidas.push(...delBloque.perdidas);
            resultado.avisos.push(...delBloque.avisos);
        }
        /* El mercado objetivo del EMT (decision 58), del mismo registro. */
        if (universal['mercado_objetivo'] !== undefined && resultado.errores.length === 0) {
            const mercado = mapearMercadoObjetivo(universal);
            if (mercado.documento !== null) resultado.documentos.push(mercado.documento);
            if (mercado.ausencia !== undefined) resultado.ausencias.push(mercado.ausencia);
            resultado.avisos.push(...mercado.avisos);
        }
        if (resultado.errores.length > 0) {
            conError += 1;
            for (const error of resultado.errores) sumar(erroresDeMapeo, error.slice(0, 120));
            continue;
        }
        mapeados += 1;
        isinsMapeados.add(isin);

        for (const ausencia of resultado.ausencias) {
            sumar(ausenciasPorRuta, `${ausencia.ruta} [${ausencia.razon}]`);
            sumar(ausenciasPorRazon, ausencia.razon);
        }
        for (const perdida of resultado.perdidas) sumar(perdidas, perdida);
        for (const aviso of resultado.avisos) sumar(avisos, aviso.slice(0, 120));

        for (const documento of resultado.documentos) {
            sumar(porTipoDeDocumento, documento.tipo);
            const bytes = Buffer.byteLength(JSON.stringify(documento.documento), 'utf-8');
            (tamanos[documento.tipo] ??= []).push(bytes);

            const veredicto = validarEscritura(documento.tipo, documento.documento, documento.comoDueno ?? 'platform');
            if (veredicto.ok) {
                documentosValidos += 1;
            } else {
                documentosInvalidos += 1;
                for (const motivo of veredicto.motivos) sumar(fallosDeValidacion, `${documento.tipo} ${motivo}`);
            }
        }
    }

    /* Los emisores de las acciones por LEI (decision 8 de DECISIONES_DATOS_2026-11-07): la
       entidad y el vinculo salen de export_entidades/emisores.json, que deja
       `python main.py emisores`, y pasan las mismas dos puertas que el resto. El vinculo se
       valida como `human`, que es su dueno: la regla la decidio Oscar. */
    const salidaEmisores = leerSalidaDeEmisores(RAIZ_EXTRACTOR);
    const emisores = salidaEmisores === undefined ? undefined : mapearEmisores(salidaEmisores, ahora, isinsMapeados);
    for (const documento of emisores?.documentos ?? []) {
        sumar(porTipoDeDocumento, documento.tipo);
        (tamanos[documento.tipo] ??= []).push(Buffer.byteLength(JSON.stringify(documento.documento), 'utf-8'));
        const veredicto = validarEscritura(documento.tipo, documento.documento, documento.comoDueno ?? 'platform');
        if (veredicto.ok) {
            documentosValidos += 1;
        } else {
            documentosInvalidos += 1;
            for (const motivo of veredicto.motivos) sumar(fallosDeValidacion, `${documento.tipo} ${motivo}`);
        }
    }
    for (const aviso of emisores?.avisos ?? []) sumar(avisos, aviso.slice(0, 120));

    const linea = (texto: string): void => console.log(texto);
    linea('');
    linea('=== base nueva, dry-run del escritor de plataforma ===');
    linea(`canonico: ${RAIZ_EXTRACTOR}`);
    linea('');
    linea(`registros en el canonico universal : ${registros}`);
    linea(`  de ellos, acciones               : ${acciones}`);
    linea(`  sin ficha en export_bdb          : ${sinFicha}`);
    linea(`  mapeados                         : ${mapeados}`);
    linea(`  parados por error de mapeo       : ${conError}`);
    linea('');
    linea(`documentos que saldrian  : ${documentosValidos + documentosInvalidos}`);
    linea(`  pasan las dos puertas  : ${documentosValidos}`);
    linea(`  NO pasan               : ${documentosInvalidos}`);
    linea('');
    linea('--- documentos por tipo, con su tamano en bytes ---');
    for (const [tipo, cuantos] of ordenado(porTipoDeDocumento)) {
        const bytes = tamanos[tipo] ?? [];
        const total = bytes.reduce((a, b) => a + b, 0);
        linea(
            `${String(cuantos).padStart(5)}  ${tipo.replace('.v2.schema.json', '').padEnd(34)}` +
                ` mediana ${String(percentil(bytes, 50)).padStart(6)} B` +
                `  max ${String(Math.max(0, ...bytes)).padStart(7)} B` +
                `  total ${(total / 1024 / 1024).toFixed(2)} MB`
        );
    }

    if (conError > 0) {
        linea('');
        linea('--- errores de mapeo (paran el instrumento entero) ---');
        for (const [error, cuantos] of ordenado(erroresDeMapeo).slice(0, 20)) {
            linea(`${String(cuantos).padStart(5)}  ${error}`);
        }
    }

    if (documentosInvalidos > 0) {
        linea('');
        linea('--- documentos que NO pasan las puertas ---');
        for (const [motivo, cuantos] of ordenado(fallosDeValidacion).slice(0, 30)) {
            linea(`${String(cuantos).padStart(5)}  ${motivo}`);
        }
    }

    linea('');
    linea('--- ausencias declaradas, por razon ---');
    for (const [razon, cuantas] of ordenado(ausenciasPorRazon)) linea(`${String(cuantas).padStart(6)}  ${razon}`);
    linea('');
    linea('--- ausencias declaradas, por ruta (las 25 primeras) ---');
    for (const [ruta, cuantas] of ordenado(ausenciasPorRuta).slice(0, 25)) {
        linea(`${String(cuantas).padStart(5)}  ${ruta}`);
    }

    linea('');
    linea('--- datos del canonico SIN SITIO en el contrato ---');
    if (Object.keys(perdidas).length === 0) linea('  ninguno');
    for (const [perdida, cuantas] of ordenado(perdidas)) linea(`${String(cuantas).padStart(5)}  ${perdida}`);

    if (Object.keys(avisos).length > 0) {
        linea('');
        linea('--- avisos ---');
        for (const [aviso, cuantos] of ordenado(avisos).slice(0, 20)) linea(`${String(cuantos).padStart(5)}  ${aviso}`);
    }

    linea('');
    linea('--- emisores de acciones (EQUITY_ISSUER, un LEI un emisor, decision 8) ---');
    if (salidaEmisores === undefined || emisores === undefined) {
        linea(`  sin ${SALIDA_DEL_EXTRACTOR} en el extractor: corre python main.py emisores. No sale ninguno.`);
    } else {
        const c = salidaEmisores.cuentas ?? {};
        linea(`acciones en el canonico        : ${String(c['acciones'] ?? '?')}`);
        linea(`  con LEI de FIRDS             : ${String(c['con_lei'] ?? '?')} (${String(c['leis_distintos'] ?? '?')} LEI distintos)`);
        linea(`issuers que saldrian           : ${emisores.emisores}`);
        linea(`instrument_issuer que saldrian : ${emisores.vinculos}`);
        linea(`acciones sin LEI, sin emisor   : ${(salidaEmisores.sin_lei ?? []).length}`);
        for (const x of salidaEmisores.sin_lei ?? []) linea(`    ${x.isin}  ${String(x.nombre ?? '')}: ${x.motivo}`);
        linea(`LEI que GLEIF no resuelve      : ${(salidaEmisores.lei_sin_gleif ?? []).length}`);
        for (const x of salidaEmisores.lei_sin_gleif ?? []) linea(`    ${x.isin}  ${x.lei}: ${x.motivo}`);
        linea(`sin fecha de FIRDS             : ${(salidaEmisores.sin_fecha ?? []).length}`);
    }
    linea('');
    linea('--- gestoras y depositarios (MEDIDOS, no poblados: sin LEI casarlos es decision humana) ---');
    linea(`gestoras distintas por nombre comercial : ${gestoras.size}`);
    linea(`gestoras distintas por nombre legal     : ${gestorasLegales.size}`);
    linea(`depositarios distintos                  : ${depositarios.size}`);
    linea(`fondos con LEI de gestora               : ${conLei} de ${mapeados}`);
    linea('Esa cifra es lo que costaria emparejar entidades a mano el dia que se quiera.');

    fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
    fs.writeFileSync(
        SALIDA,
        JSON.stringify(
            {
                generado_at: ahora,
                canonico: RAIZ_EXTRACTOR,
                registros,
                acciones,
                sin_ficha: sinFicha,
                mapeados,
                con_error: conError,
                documentos_validos: documentosValidos,
                documentos_invalidos: documentosInvalidos,
                por_tipo: porTipoDeDocumento,
                tamanos_mediana: Object.fromEntries(
                    Object.entries(tamanos).map(([tipo, bytes]) => [tipo, percentil(bytes, 50)])
                ),
                tamanos_max: Object.fromEntries(
                    Object.entries(tamanos).map(([tipo, bytes]) => [tipo, Math.max(0, ...bytes)])
                ),
                ausencias_por_razon: ausenciasPorRazon,
                ausencias_por_ruta: ausenciasPorRuta,
                perdidas,
                avisos,
                errores_de_mapeo: erroresDeMapeo,
                fallos_de_validacion: fallosDeValidacion,
                entidades: {
                    gestoras_nombre_comercial: gestoras.size,
                    gestoras_nombre_legal: gestorasLegales.size,
                    depositarios: depositarios.size,
                    con_lei: conLei
                },
                emisores:
                    emisores === undefined
                        ? null
                        : {
                              issuers: emisores.emisores,
                              instrument_issuer: emisores.vinculos,
                              sin_lei: salidaEmisores?.sin_lei ?? [],
                              lei_sin_gleif: salidaEmisores?.lei_sin_gleif ?? [],
                              sin_fecha: salidaEmisores?.sin_fecha ?? []
                          }
            },
            null,
            2
        ),
        'utf-8'
    );
    linea('');
    linea(`informe en ${SALIDA}`);
    linea('NADA escrito en Firestore. La maestra sigue intacta.');
}

main();
