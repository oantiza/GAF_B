/**
 * scripts/runCarterasDryRun.ts — qué saldría del trabajo guardado del asesor, sin escribir.
 *
 * Lee `bdb_activos/{uid}/portfolios/{id}` del emulador y pasa cada cartera por el mapper y
 * por las dos puertas. No escribe nada: es la pasada en seco del primer trozo del dominio de
 * clientes, igual que `dryrun:base-nueva` lo es del de instrumentos.
 *
 * SOLO LECTURA a propósito, y por eso no pide el gate de escritura: una pasada en seco que
 * exigiera el gate obligaría a abrirlo para mirar, que es como se acaba escribiendo sin
 * querer. El mismo motivo por el que `audit:consistency` se niega a correr con el gate
 * puesto.
 */
import * as fs from 'fs';
import * as path from 'path';

import * as dotenv from 'dotenv';
import * as admin from 'firebase-admin';

/* El host del emulador y el project id del clon viven en `.env.local`, igual que en
   `runBaseNuevaWrite.ts`. Se cargan aqui y no se pasan a mano. */
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { mapearCartera, type CarteraDelAsesor } from '../src/ingestion/baseNueva/carteras';
import { validarEscritura } from '../src/config/baseNueva/validadores';
import { ALLOWED_PROJECT_IDS } from '../src/config/projectAllowlist';

const SALIDA = path.resolve(__dirname, '..', 'runs', 'carteras-dryrun.json');

function cuenta<T>(mapa: Map<T, number>, clave: T): void {
    mapa.set(clave, (mapa.get(clave) ?? 0) + 1);
}

async function main(): Promise<void> {
    const projectId = process.env['FIREBASE_PROJECT_ID'] ?? '';
    if (!ALLOWED_PROJECT_IDS.has(projectId)) {
        throw new Error(`Project id fuera de la allowlist de plataforma: ${projectId || '(vacio)'}`);
    }
    if (!process.env['FIRESTORE_EMULATOR_HOST']) {
        throw new Error('FIRESTORE_EMULATOR_HOST sin poner: este dry-run solo lee el emulador');
    }

    admin.initializeApp({ projectId });
    const db = admin.firestore();

    const usuarios = await db.collection('bdb_activos').get();
    let carteras = 0;
    const porTipo = new Map<string, number>();
    const avisos = new Map<string, number>();
    const perdidas = new Map<string, number>();
    const ausencias = new Map<string, number>();
    const errores = new Map<string, number>();
    let bloqueados = 0;
    let objetivos = 0;
    const sinPesos: string[] = [];

    for (const u of usuarios.docs) {
        for (const c of (await u.ref.collection('portfolios').get()).docs) {
            carteras += 1;
            const r = mapearCartera(c.data() as CarteraDelAsesor);
            for (const e of r.errores) cuenta(errores, e);
            for (const a of r.avisos) cuenta(avisos, a);
            for (const p of r.perdidas) cuenta(perdidas, p);
            for (const a of r.ausencias) cuenta(ausencias, `${a.ruta} [${a.razon}]`);
            if (r.documentos.length > 0 && !r.documentos.some((d) => d.ruta.includes('/targets/'))) {
                sinPesos.push(String((c.data() as CarteraDelAsesor).name ?? c.id));
            }
            for (const d of r.documentos) {
                cuenta(porTipo, d.tipo);
                if (d.ruta.includes('/targets/')) objetivos += 1;
                const veredicto = validarEscritura(d.tipo, d.documento, d.comoDueno ?? 'app');
                if (!veredicto.ok) {
                    bloqueados += 1;
                    cuenta(errores, `${d.tipo}: ${veredicto.motivos.join('; ')}`);
                }
            }
        }
    }

    const total = [...porTipo.values()].reduce((a, b) => a + b, 0);
    const linea = (n: number, t: string): string => `${String(n).padStart(5)}  ${t}`;
    console.log('\n=== carteras del asesor, dry-run ===');
    console.log(`proyecto: ${projectId} (emulador ${process.env['FIRESTORE_EMULATOR_HOST']})\n`);
    console.log(`usuarios con carteras : ${usuarios.size}`);
    console.log(`carteras guardadas    : ${carteras}`);
    console.log(`documentos que saldrian: ${total}`);
    console.log(`  pasan las dos puertas: ${total - bloqueados}`);
    console.log(`  NO pasan             : ${bloqueados}`);
    console.log(`pesos escritos        : ${objetivos}`);

    console.log('\n--- documentos por tipo ---');
    for (const [t, n] of [...porTipo].sort((a, b) => b[1] - a[1])) console.log(linea(n, t));

    for (const [titulo, mapa] of [
        ['errores', errores],
        ['avisos', avisos],
        ['datos sin sitio', perdidas],
        ['ausencias declaradas', ausencias]
    ] as const) {
        if (mapa.size === 0) continue;
        console.log(`\n--- ${titulo} ---`);
        for (const [k, n] of [...mapa].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(linea(n, k));
    }

    if (sinPesos.length > 0) {
        console.log('\n--- carteras escritas SIN sus pesos ---');
        for (const n of sinPesos) console.log(`       ${n}`);
    }

    fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
    fs.writeFileSync(
        SALIDA,
        JSON.stringify(
            {
                generado: new Date().toISOString(),
                usuarios: usuarios.size,
                carteras,
                documentos: total,
                bloqueados,
                objetivos,
                porTipo: Object.fromEntries(porTipo),
                avisos: Object.fromEntries(avisos),
                perdidas: Object.fromEntries(perdidas),
                ausencias: Object.fromEntries(ausencias),
                errores: Object.fromEntries(errores),
                sinPesos
            },
            null,
            2
        ),
        'utf-8'
    );
    console.log(`\ninforme en ${SALIDA}`);
    console.log('NADA escrito en Firestore.');
}

main().catch((e: Error) => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
});
