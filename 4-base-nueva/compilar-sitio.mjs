/**
 * compilar-sitio.mjs — compila la aplicación contra el proyecto real, en `4-base-nueva/sitio/`.
 *
 *   node 4-base-nueva/compilar-sitio.mjs
 *
 * Compila el ÚLTIMO COMMIT de `3-BDB-ACTIVOS_app`, en una copia temporal: esa carpeta la
 * comparten varias sesiones y lo que esté a medias no debe llegar a la web.
 *
 * Usa el modo `nube` de Vite para no cargar `.env.production`, que lleva la clave de App Check
 * de otro proyecto. La configuración web sale de `VITE_BASE_NUEVA_*` en el `.env.local` de la
 * app, que no va al repositorio.
 *
 * El sitio se publica desde aquí porque este `firebase.json` despliega a un solo proyecto y
 * lleva la puerta. El de la app declara también Functions y sus propias reglas.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { commitDe, escribirVersion } from './version.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = join(AQUI, '..', '3-BDB-ACTIVOS_app');
const SITIO = join(AQUI, 'sitio');
const PROYECTO = 'bdb-gestor-de-activos';
const CLAVES = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID'];

function abortar(mensaje) {
    console.error(`NO SE COMPILA: ${mensaje}`);
    process.exit(1);
}

function ejecutar(comando, argumentos, cwd) {
    const r = spawnSync(comando, argumentos, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`${comando} ${argumentos.join(' ')} termino con ${r.status}`);
}

const entorno = new Map();
for (const linea of readFileSync(join(APP, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^(VITE_BASE_NUEVA_[A-Z_]+)=(.*)$/);
    if (m) entorno.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''));
}
for (const clave of CLAVES) {
    if (!entorno.get(`VITE_BASE_NUEVA_${clave}`)) abortar(`falta VITE_BASE_NUEVA_${clave} en el .env.local de la app`);
}
if (entorno.get('VITE_BASE_NUEVA_PROJECT_ID') !== PROYECTO) {
    abortar(`VITE_BASE_NUEVA_PROJECT_ID no es ${PROYECTO}`);
}

/* Las funciones que `.env.production` enciende. Una que falte aqui se apagaria en silencio, asi que
   se aborta: o se copia, o se decide apagarla escribiendola con su valor. */
const BANDERAS = ['VITE_BDB_ENABLE_REAL_FRONTIER=true', 'VITE_BDB_ENABLE_ROBUST_FRONTIER_V2=true'];
for (const linea of readFileSync(join(APP, '.env.production'), 'utf8').split(/\r?\n/)) {
    const bandera = linea.match(/^(VITE_BDB_ENABLE_[A-Z0-9_]+)=/)?.[1];
    if (bandera && !BANDERAS.some((b) => b.startsWith(`${bandera}=`))) {
        abortar(`${bandera} esta en .env.production y esta compilacion no la lleva`);
    }
}

/* SEG-3: el commit que se compila, que es `HEAD` y no lo que haya a medias en la carpeta. Se estampa en el sitio. */
const commit = commitDe(APP);
const temporal = mkdtempSync(join(tmpdir(), 'sitio-'));
/* Desde la unificacion de repositorios (10-11-2026) la copia de trabajo trae el repositorio entero:
   la app queda dentro, en su carpeta, y es ahi donde se compila. */
const copiaDelRepositorio = join(temporal, 'repo');
const copia = join(copiaDelRepositorio, '3-BDB-ACTIVOS_app');
let creada = false;
try {
    ejecutar('git', ['worktree', 'add', '--detach', copiaDelRepositorio, 'HEAD'], APP);
    creada = true;
    symlinkSync(join(APP, 'node_modules'), join(copia, 'node_modules'), 'junction');
    writeFileSync(
        join(copia, '.env.nube.local'),
        [
            ...CLAVES.map((clave) => `VITE_FIREBASE_${clave}=${entorno.get(`VITE_BASE_NUEVA_${clave}`)}`),
            'VITE_FIREBASE_USE_EMULATORS=false',
            'VITE_FIREBASE_APPCHECK_DISABLED=true',
            /* Este modo no carga `.env.production`, y sin esto la compilacion publicada se quedo sin
               frontera historica ni optimizador, sin ningun aviso, desde el primer despliegue. */
            ...BANDERAS,
            ''
        ].join('\n')
    );
    /* P2-09 (21-11-2026): las dos puertas de `npm run build`, que esta compilación se saltaba por llamar a Vite
       directamente. Los tipos antes, sobre el mismo commit; el presupuesto de la entrada después, sobre `dist`, y
       las dos antes de tocar `sitio/`: si una falla, el sitio que hay se queda como estaba. */
    ejecutar('npm', ['run', 'typecheck'], copia);
    ejecutar('npx', ['vite', 'build', '--mode', 'nube'], copia);
    ejecutar('npm', ['run', 'check:bundle'], copia);
    rmSync(SITIO, { recursive: true, force: true });
    cpSync(join(copia, 'dist'), SITIO, { recursive: true });
} finally {
    if (creada) {
        /* El enlace se quita antes: si no, borrar la copia podría alcanzar el node_modules real. */
        rmSync(join(copia, 'node_modules'), { force: true, recursive: false });
        spawnSync('git', ['worktree', 'remove', '--force', copiaDelRepositorio], { cwd: APP, shell: process.platform === 'win32' });
    }
    rmSync(temporal, { recursive: true, force: true });
}

if (!existsSync(join(SITIO, 'index.html'))) abortar('la compilacion no dejo index.html');
const version = escribirVersion(SITIO, commit);
console.log(`Sitio listo en ${SITIO}`);
console.log(`Sale del commit ${version.corto} (${version.fecha_del_commit}). Va en version.json, junto al índice.`);
